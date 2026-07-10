#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// loomi-bridge.mjs — single Node 18+ ESM entrypoint for the OpenLoomi
// Claude Code plugin.
//
// This file is intentionally dependency-free (only Node built-ins). It
// implements every subcommand advertised by `plugin.json` and called by
// the slash commands in `commands/`. Every side-effect path is opt-in.
//
// Subcommands:
//   version                          print plugin version
//   setup                            discover → install? → login → sync → status
//   setup-status [--json]            stable JSON
//   install [--yes]                  user-approved install
//   login                            open OpenLoomi login surface
//   sync-claude-env                  read Claude env → POST /api/ai/provider/config
//   pet <state>                      set OpenLoomi Pet state
//   state <name> [--event <e>]       fire-and-forget state (hook internal)
//   archive                          archive last Stop transcript (hook internal)
//   usage                            GET /api/llm/usage/summary
//   install-hooks                    merge into ~/.claude/settings.json
//   uninstall-hooks                  strip only the plugin's block
//   hooks-status                     report merge state
//
// IMPORTANT (secrets contract):
//   - ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN are read once locally
//     inside `sync-claude-env` and immediately dropped after use.
//   - ~/.openloomi/token is read at most for base64-decode to obtain
//     the bearer; its contents are never printed.
//   - All status checks report presence/absence only.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  statSync,
  chmodSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { EOL } from 'node:os';
import { homedir, platform, tmpdir } from 'node:os';
import { join, delimiter, sep, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants & state
// ---------------------------------------------------------------------------

const PLUGIN_VERSION = '0.1.0';
const DEFAULT_PROVIDER_BASE = 'https://api.anthropic.com';
const DEFAULT_PROVIDER_MODEL = 'claude-opus-4-6';
const OPENLOOMI_PORT_DEFAULT = 8787;
const STATE_HTTP_TIMEOUT_MS = 2000;
const ARCHIVE_HTTP_TIMEOUT_MS = 15_000;
const ARCHIVE_MAX_BYTES = 5 * 1024 * 1024;       // 5 MB cap on transcripts
const ARCHIVE_MAX_TURNS = 6;                      // 6 user+assistant turns
const ARCHIVE_MAX_CONTENT_CHARS = 6000;           // 6k char summary cap

// 9-state capybara sprite set (apps/web/public/loomi-pet/assets/capybara/).
// The plugin ships fox-sprite branding in `assets/`, but the bridge itself
// is theme-agnostic — it validates state names against the superset of
// names used by both the capybara and fox (loomi-*) sprite sets; the
// OpenLoomi runtime's `map_state_to_pet` watcher decides which sprite
// to render per the user's chosen theme.
const CAPYBARA_STATES = new Set([
  'happy',
  'idle',
  'juggling',
  'needsinput',
  'presenting',
  'sleeping',
  'sweeping',
  'thinking',
  'working',
]);

const MARKER = '_openloomi_plugin';
const PLUGIN_BLOCK_KEY = '__openloomi_claude_plugin_hooks__';
const PLUGIN_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOKS_FILE = join(PLUGIN_DIR, 'hooks', 'hooks.json');
const PLUGIN_DATA_DIR = (() => {
  const explicit = process.env.CLAUDE_PLUGIN_DATA;
  if (explicit) return explicit;
  return join(homedir(), '.claude', 'plugins', 'openloomi');
})();

const NEXT_ACTIONS = new Set([
  'install_openloomi',
  'provide_install_or_repo_path',
  'build_or_stage_openloomi',
  'login_openloomi',
  'configure_ai_provider',
  'configure_connectors',
  'show_openloomi_skills',
  'run',
]);

function pluginDataDir() {
  if (!existsSync(PLUGIN_DATA_DIR)) {
    try {
      mkdirSync(PLUGIN_DATA_DIR, { recursive: true });
    } catch {
      /* non-fatal */
    }
  }
  return PLUGIN_DATA_DIR;
}

function readSavedBinPath() {
  try {
    const cfg = join(pluginDataDir(), 'config.json');
    if (!existsSync(cfg)) return null;
    const txt = readFileSync(cfg, 'utf8');
    const j = JSON.parse(txt);
    if (typeof j?.binPath === 'string' && existsSync(j.binPath)) {
      return j.binPath;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function saveBinPath(p) {
  try {
    const cfg = join(pluginDataDir(), 'config.json');
    writeFileSync(cfg, JSON.stringify({ binPath: p, savedAt: Date.now() }, null, 2));
  } catch {
    /* non-fatal */
  }
}

// ---------------------------------------------------------------------------
// Tiny utilities
// ---------------------------------------------------------------------------

const isTTY = !!process.stdout.isTTY;

function out(obj, exitCode = 0) {
  process.stdout.write(JSON.stringify(obj, null, 2) + EOL);
  if (exitCode !== 0) process.exit(exitCode);
}

function err(code, msg, extra = {}) {
  out({ ok: false, code, error: msg, ...extra }, 1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function detectPlatform() {
  const p = platform();
  if (p === 'darwin') return 'macos';
  if (p === 'win32') return 'windows';
  return 'linux';
}

function envBool(v) {
  if (v == null) return false;
  const s = String(v).toLowerCase().trim();
  return s === '1' || s === 'true' || s === 'yes';
}

function normPath(p) {
  if (!p) return null;
  return p.endsWith('/') || p.endsWith('\\') ? p.replace(/[\\/]+$/, '') : p;
}

// ---------------------------------------------------------------------------
// Argv parsing (tiny, no deps)
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Path resolution & discovery
// ---------------------------------------------------------------------------

function isExecutable(p) {
  try {
    const st = statSync(p);
    return st.isFile();
  } catch {
    return false;
  }
}

// Platform default locations for the OpenLoomi **main binary** (`openloomi`).
// This is the Tauri desktop app — what users actually launch. The bridge
// always discovers and invokes `openloomi`; an internal helper CLI bundled
// alongside it is reached transparently via the runtime's own entry point.
function packageDefaults() {
  const home = homedir();
  switch (detectPlatform()) {
    case 'macos':
      return [
        // Standard macOS install (where Drag-to-Applications puts it).
        '/Applications/OpenLoomi.app/Contents/MacOS/openloomi',
        // Some users install to a per-user Applications folder.
        join(home, 'Applications', 'OpenLoomi.app', 'Contents', 'MacOS', 'openloomi'),
      ];
    case 'windows':
      return [
        join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'OpenLoomi', 'openloomi.exe'),
      ];
    default:
      return [
        join(home, '.local', 'bin', 'openloomi'),
        '/opt/openloomi/openloomi',
        '/usr/local/bin/openloomi',
      ];
  }
}

// Detect whether the user-visible OpenLoomi desktop app is installed.
// We treat the *desktop app* (OpenLoomi.app on macOS, etc.) as the install
// signal, not the helper CLI's filename — users know "OpenLoomi", not the
// internal binary name. This way, a brand-new install where the app is
// This way, a brand-new install where the app is present but the ctl hasn't
// been laid down yet is reported as `installed: true / reason:
// OPENLOOMI_NOT_FINALIZED` instead of `installed: false / OPENLOOMI_NOT_INSTALLED`.
function detectDesktopInstalled() {
  const home = homedir();
  switch (detectPlatform()) {
    case 'macos':
      for (const root of ['/Applications', join(home, 'Applications')]) {
        const marker = join(root, 'OpenLoomi.app');
        if (existsSync(marker)) return { installed: true, marker };
      }
      return { installed: false, marker: null };
    case 'windows': {
      const roots = [
        process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'),
        process.env.PROGRAMFILES || 'C:\\Program Files',
      ];
      for (const root of roots) {
        for (const marker of [join(root, 'OpenLoomi'), join(root, 'OpenLoomi', 'OpenLoomi.exe')]) {
          if (existsSync(marker)) return { installed: true, marker };
        }
      }
      return { installed: false, marker: null };
    }
    default:
      for (const marker of [
        '/opt/openloomi',
        join(home, '.local', 'share', 'openloomi'),
        join(home, '.local', 'share', 'applications', 'openloomi.desktop'),
      ]) {
        if (existsSync(marker)) return { installed: true, marker };
      }
      return { installed: false, marker: null };
  }
}

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return homedir() + p.slice(1);
  if (p.startsWith('~\\')) return homedir() + p.slice(2);
  return p;
}

function lookupOnPath(name) {
  const pathEnv = process.env.PATH || '';
  const exts = detectPlatform() === 'windows' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of pathEnv.split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

// Look for the OpenLoomi main binary inside a known install layout. We
// search for the Tauri main binary only; the bridge does not depend on
// the layout of any internal helper CLI the runtime may bundle.
function searchInstallRoot(root) {
  if (!root) return null;
  const exe = detectPlatform() === 'windows' ? 'openloomi.exe' : 'openloomi';
  const candidates = [
    join(root, exe),
    join(root, 'Contents', 'MacOS', exe),       // macOS bundle
    join(root, 'bin', exe),                    // Linux packaging
  ];
  for (const c of candidates) {
    if (isExecutable(c)) return c;
  }
  return null;
}

// Look for the OpenLoomi main binary inside a source checkout. The Tauri
// main binary lives in `target/release/`.
function searchRepoLayout(root) {
  if (!root) return null;
  const exe = detectPlatform() === 'windows' ? 'openloomi.exe' : 'openloomi';
  const candidates = [
    join(root, 'apps', 'web', 'src-tauri', 'target', 'release', exe),
  ];
  for (const c of candidates) {
    if (isExecutable(c)) return c;
  }
  return null;
}

function discovery({ explicit = null } = {}) {
  // Step 1: OPENLOOMI_BIN
  if (process.env.OPENLOOMI_BIN && isExecutable(process.env.OPENLOOMI_BIN)) {
    return { binPath: normPath(process.env.OPENLOOMI_BIN), mode: 'env', source: 'OPENLOOMI_BIN' };
  }
  // Step 2: OPENLOOMI_HOME / OPENLOOMI_INSTALL_DIR
  for (const k of ['OPENLOOMI_HOME', 'OPENLOOMI_INSTALL_DIR']) {
    const v = expandHome(process.env[k]);
    const hit = searchInstallRoot(v);
    if (hit) return { binPath: normPath(hit), mode: 'packaged', source: k };
  }
  // Step 3: OPENLOOMI_REPO_DIR
  if (process.env.OPENLOOMI_REPO_DIR) {
    const repoHit = searchRepoLayout(expandHome(process.env.OPENLOOMI_REPO_DIR));
    if (repoHit) {
      return { binPath: normPath(repoHit), mode: 'source', source: 'OPENLOOMI_REPO_DIR' };
    }
    // Source dir is set but the main binary isn't built yet — return a hint.
    const exe = detectPlatform() === 'windows' ? 'openloomi.exe' : 'openloomi';
    return {
      binPath: null,
      mode: 'source',
      source: 'OPENLOOMI_REPO_DIR',
      hint: {
        repoDir: expandHome(process.env.OPENLOOMI_REPO_DIR),
        needed: join('apps', 'web', 'src-tauri', 'target', 'release', exe),
      },
    };
  }
  // Step 4: PATH lookup for the main `openloomi` binary
  const onPath = lookupOnPath(detectPlatform() === 'windows' ? 'openloomi.exe' : 'openloomi');
  if (onPath) {
    return { binPath: normPath(onPath), mode: 'packaged', source: 'PATH' };
  }
  // Step 5: Platform default packaged install paths
  for (const def of packageDefaults()) {
    if (isExecutable(def)) {
      return { binPath: normPath(def), mode: 'packaged', source: 'platform-default' };
    }
  }
  // Step 6: Saved plugin config
  const saved = readSavedBinPath();
  if (saved) {
    return { binPath: normPath(saved), mode: 'packaged', source: 'saved-config' };
  }
  // Step 7: User-provided --bin-path
  if (explicit && isExecutable(explicit)) {
    return { binPath: normPath(explicit), mode: 'packaged', source: 'flag' };
  }
  // Step 8: No main `openloomi` binary found via the explicit paths above.
// Still detect whether the OpenLoomi desktop app itself is present. If it
// is, try to derive the binary path from the install marker — many users
// have `OpenLoomi.app` in /Applications but the inner main binary lives
// under Contents/MacOS and isn't always on PATH.
const desktop = detectDesktopInstalled();
if (desktop.installed) {
  const exe = detectPlatform() === 'windows' ? 'openloomi.exe' : 'openloomi';
  const candidate = join(desktop.marker, 'Contents', 'MacOS', exe);
  const winCandidate = join(desktop.marker, exe);
  const bin =
    isExecutable(candidate) ? candidate :
    isExecutable(winCandidate) ? winCandidate :
    null;
  if (bin) {
    return {
      binPath: normPath(bin),
      mode: 'packaged',
      source: 'desktop-marker',
      desktopInstalled: true,
      desktopMarker: desktop.marker,
    };
  }
  return {
    binPath: null,
    mode: 'packaged',
    source: 'desktop-only',
    desktopInstalled: true,
    desktopMarker: desktop.marker,
  };
}
return { binPath: null, mode: 'unconfigured', source: null, desktopInstalled: false, desktopMarker: null };
}

async function runBin(binPath, args, { stdin = null, timeoutMs = 120_000 } = {}) {
  return await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let resolved = false;
    const child = spawn(binPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { child.kill('SIGKILL'); } catch { /* noop */ }
        resolve({ ok: false, error: { code: 'timeout', message: `helper timed out after ${timeoutMs}ms` } });
      }
    }, timeoutMs);
    child.stdout.on('data', (b) => (stdout += b.toString('utf8')));
    child.stderr.on('data', (b) => (stderr += b.toString('utf8')));
    child.on('error', (e) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve({ ok: false, error: { code: 'spawn_failed', message: String(e?.message || e) }, stderr });
    });
    child.on('exit', (code, signal) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true, stdout, stderr });
      } else {
        resolve({ ok: false, error: { code: `exit_${code ?? signal ?? 'unknown'}` }, stdout, stderr });
      }
    });
    if (stdin != null) {
      try {
        child.stdin.end(stdin);
      } catch {
        /* noop */
      }
    } else {
      try { child.stdin.end(); } catch { /* noop */ }
    }
  });
}

// ---------------------------------------------------------------------------
// Auth (presence-only)
// ---------------------------------------------------------------------------

function readOpenloomiTokenPath() {
  const p = join(homedir(), '.openloomi', 'token');
  return existsSync(p) ? p : null;
}

function tokenPresent() {
  if (process.env.OPENLOOMI_AUTH_TOKEN) return true;
  return readOpenloomiTokenPath() != null;
}

// Mirrors the Tauri runtime's `save_token` (see
// apps/web/src-tauri/src/storage.rs): base64-encode the bearer and write
// to `~/.openloomi/token` with 0o600 perms. The directory is created if
// missing. Returns the on-disk path.
function saveOpenloomiToken(token) {
  if (typeof token !== 'string' || !token.trim()) {
    return { ok: false, code: 'EMPTY_TOKEN' };
  }
  const p = join(homedir(), '.openloomi', 'token');
  try {
    const dir = dirname(p);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const encoded = Buffer.from(token, 'utf8').toString('base64');
    writeFileSync(p, encoded, { mode: 0o600 });
    // Belt-and-braces: chmod after the fact too, since some platforms
    // ignore the mode arg on writeFileSync (e.g. when the file already
    // exists with looser perms).
    try { chmodSync(p, 0o600); } catch { /* noop on platforms without chmod */ }
    return { ok: true, path: p };
  } catch (e) {
    return { ok: false, code: 'WRITE_FAILED', error: String(e?.message || e) };
  }
}

function loadBearerToken() {
  // Returns the bearer token locally; NEVER prints it.
  // Env-var path returns the raw value (no decode).
  // File path is base64-encoded by the Tauri runtime
  // (see apps/web/src-tauri/src/storage.rs -> save_token / load_token),
  // so we mirror that here: decode once, trim, return.
  const envTok = process.env.OPENLOOMI_AUTH_TOKEN;
  if (envTok && envTok.trim()) return envTok.trim();
  const p = readOpenloomiTokenPath();
  if (!p) return null;
  try {
    const raw = readFileSync(p, 'utf8').trim();
    if (!raw) return null;
    // Strict path: token files are always base64(STANDARD). If decode
    // fails, fall back to the raw text — covers any hand-rolled token
    // file a power user might have dropped in before this fix.
    try {
      const decoded = Buffer.from(raw, 'base64').toString('utf8').trim();
      // A successful decode of a JWT payload.sig yields the two segments
      // joined with a `.`; if we don't see that, the file was probably
      // not base64-encoded and the raw text is the actual token.
      if (decoded && decoded.includes('.')) return decoded;
      return raw;
    } catch {
      return raw;
    }
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Local API
// ---------------------------------------------------------------------------

function openloomiBaseUrl() {
  if (process.env.OPENLOOMI_BASE_URL) return process.env.OPENLOOMI_BASE_URL.replace(/\/+$/, '');
  return `http://127.0.0.1:${OPENLOOMI_PORT_DEFAULT}`;
}

async function apiGET(path, { timeoutMs = 5000 } = {}) {
  const bearer = loadBearerToken();
  const headers = { Accept: 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(openloomiBaseUrl() + path, { method: 'GET', headers, signal: ctrl.signal });
    const text = await res.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    return { ok: false, status: 0, error: { code: 'network', message: String(e?.message || e) } };
  } finally {
    clearTimeout(t);
  }
}

async function apiPOST(path, body, { timeoutMs = 10_000 } = {}) {
  const bearer = loadBearerToken();
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(openloomiBaseUrl() + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    return { ok: false, status: 0, error: { code: 'network', message: String(e?.message || e) } };
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

async function readBinVersion(binPath) {
  if (!binPath) return null;
  // The OpenLoomi main `openloomi` binary launches the GUI app on any CLI
  // invocation, so calling --version would flash a window. Skip the call
  // for that case and return null — the user can confirm the version by
  // launching the app. Anything else (a different binary the user pointed
  // us at via OPENLOOMI_BIN, etc.) gets probed with --version.
  const base = basename(binPath).toLowerCase();
  const isMainTauriBinary =
    (base === 'openloomi' || base === 'openloomi.exe');
  if (isMainTauriBinary) return null;
  const r = await runBin(binPath, ['--version'], { timeoutMs: 5000 });
  if (!r.ok) return null;
  // Match a semver-ish version (e.g. "0.7.0", "1.2.3-rc.1") anywhere in
  // the --version output. Real binaries print "<name> 0.7.0"; tests
  // just print "9.9.9" — both should parse.
  const m = (r.stdout || '').match(/(\d+\.\d+\.\d+(?:[-+][\w.\-]+)?)/);
  return m ? m[1].trim() : (r.stdout || '').trim();
}

async function probeAiProvider() {
  // Probes a server-side config; the actual response shapes vary across
  // OpenLoomi versions, so we treat any 2xx as "configured" and 4xx as
  // "missing", 5xx / network as "unknown".
  const r = await apiGET('/api/ai/provider/config', { timeoutMs: 3000 });
  if (r.ok) return { ok: true, configured: r.json?.configured !== false };
  if (r.status === 404) return { ok: false, configured: false, reason: 'endpoint_missing' };
  if (r.status === 401 || r.status === 403) return { ok: true, configured: false, reason: 'auth_required' };
  return { ok: false, configured: false, reason: r.error?.code || 'unknown' };
}

async function probeApiReachable() {
  // /api/remote-auth/user is documented in skills/openloomi-api to exist
  // and to return 401 fast when auth is missing. We treat any HTTP
  // response as "reachable" — including 401.
  const r = await apiGET('/api/remote-auth/user', { timeoutMs: 2500 });
  return r.status > 0;
}

async function buildStatus({ json = true, explicit = null } = {}) {
  const claudeEnvPresent = !!(
    process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
  );
  const claudeEnvSyncable = !!(
    (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) &&
    (process.env.ANTHROPIC_BASE_URL || 'default') &&
    (process.env.ANTHROPIC_MODEL || 'default')
  );

  const disc = discovery({ explicit });

  // Source checkout detected but CLI not yet built: report that BEFORE
  // the generic "!binPath → OPENLOOMI_NOT_INSTALLED" branch.
  if (disc.mode === 'source' && disc.hint) {
    return {
      mode: 'source',
      installed: false,
      binPath: null,
      version: null,
      tokenPresent: tokenPresent(),
      aiProviderConfigured: false,
      claudeEnvSyncable,
      apiReachable: false,
      hooksInstalled: detectHooksInstalled(),
      ready: false,
      nextAction: 'build_or_stage_openloomi',
      reason: 'SOURCE_FOUND_CLI_NOT_BUILT',
      source: disc.source,
      hint: disc.hint,
    };
  }

  if (!disc.binPath) {
    // ctl is missing. Distinguish "never installed" from "OpenLoomi is
    // there, just hasn't placed the ctl yet" — user-only install detection
    // (OpenLoomi.app present) means we should NOT try to install again.
    const desktop = disc.desktopInstalled || false;
    const apiReachable = await probeApiReachable();
    if (desktop) {
      return {
        mode: disc.mode,
        installed: true,
        binPath: null,
        version: null,
        tokenPresent: tokenPresent(),
        aiProviderConfigured: (await probeAiProvider()).configured,
        claudeEnvSyncable,
        apiReachable,
        canGuestLogin: apiReachable,
        hooksInstalled: detectHooksInstalled(),
        ready: false,
        nextAction: 'launch_openloomi_to_finalize',
        reason: 'OPENLOOMI_NOT_FINALIZED',
        source: disc.source,
        desktopMarker: disc.desktopMarker,
        hint: {
          message:
            'OpenLoomi is installed but the local helper is not yet laid down. Launch the OpenLoomi desktop app once so it can finalize the install, then re-run /openloomi:setup.',
          actions: {
            macos: 'open -a "' + (disc.desktopMarker || '/Applications/OpenLoomi.app') + '"',
          },
        },
      };
    }
    return {
      mode: disc.mode,
      installed: false,
      binPath: null,
      version: null,
      tokenPresent: tokenPresent(),
      aiProviderConfigured: false,
      claudeEnvSyncable,
      apiReachable: false,
      canGuestLogin: false,
      hooksInstalled: detectHooksInstalled(),
      ready: false,
      nextAction: 'install_openloomi',
      reason: 'OPENLOOMI_NOT_INSTALLED',
      source: disc.source,
      hint: disc.hint || null,
    };
  }

  const version = await readBinVersion(disc.binPath);

  const aiProvider = await probeAiProvider();
  const apiReachable = await probeApiReachable();

  if (!tokenPresent()) {
    return {
      mode: disc.mode,
      installed: true,
      binPath: disc.binPath,
      version,
      tokenPresent: false,
      aiProviderConfigured: aiProvider.configured,
      claudeEnvSyncable,
      apiReachable,
      canGuestLogin: apiReachable,
      hooksInstalled: detectHooksInstalled(),
      ready: false,
      nextAction: 'login_openloomi',
      reason: 'LOGIN_REQUIRED',
      source: disc.source,
    };
  }

  if (!aiProvider.configured && claudeEnvPresent) {
    return {
      mode: disc.mode,
      installed: true,
      binPath: disc.binPath,
      version,
      tokenPresent: true,
      aiProviderConfigured: false,
      claudeEnvSyncable,
      apiReachable,
      canGuestLogin: apiReachable,
      hooksInstalled: detectHooksInstalled(),
      ready: false,
      nextAction: 'configure_ai_provider',
      reason: 'AI_PROVIDER_REQUIRED',
      source: disc.source,
      claudeEnvHint: { hasKey: true, hasBase: !!process.env.ANTHROPIC_BASE_URL, hasModel: !!process.env.ANTHROPIC_MODEL },
    };
  }

  if (!aiProvider.configured) {
    return {
      mode: disc.mode,
      installed: true,
      binPath: disc.binPath,
      version,
      tokenPresent: true,
      aiProviderConfigured: false,
      claudeEnvSyncable: false,
      apiReachable,
      canGuestLogin: apiReachable,
      hooksInstalled: detectHooksInstalled(),
      ready: false,
      nextAction: 'configure_ai_provider',
      reason: 'AI_PROVIDER_REQUIRED',
      source: disc.source,
      claudeEnvHint: {
        hasKey: false,
        hasBase: !!process.env.ANTHROPIC_BASE_URL,
        hasModel: !!process.env.ANTHROPIC_MODEL,
      },
    };
  }

  return {
    mode: disc.mode,
    installed: true,
    binPath: disc.binPath,
    version,
    tokenPresent: true,
    aiProviderConfigured: true,
    claudeEnvSyncable,
    apiReachable,
    canGuestLogin: apiReachable,
    hooksInstalled: detectHooksInstalled(),
    ready: true,
    nextAction: 'run',
    reason: 'READY',
    source: disc.source,
  };
}

// ---------------------------------------------------------------------------
// Hooks install/uninstall (settings merge)
// ---------------------------------------------------------------------------

function settingsPath() {
  return join(homedir(), '.claude', 'settings.json');
}

function readSettings() {
  const p = settingsPath();
  if (!existsSync(p)) return { raw: '{}', json: {}, path: p };
  try {
    const raw = readFileSync(p, 'utf8');
    const json = JSON.parse(raw);
    return { raw, json, path: p };
  } catch {
    return { raw: '{}', json: {}, path: p };
  }
}

function atomicWriteJson(filePath, jsonObj) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${randomUUID()}.tmp`);
  writeFileSync(tmp, JSON.stringify(jsonObj, null, 2));
  renameSync(tmp, filePath);
}

function loadHooksTemplate() {
  try {
    const raw = readFileSync(HOOKS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { hooks: {} };
  }
}

function pluginHookEntriesPerEvent(template) {
  // template = { hooks: { SessionStart: [...], UserPromptSubmit: [...], ... } }
  // Returns a wrapper that we'll insert under settings.hooks.__openloomi_claude_plugin_hooks__
  const wrapped = {};
  for (const [event, entries] of Object.entries(template?.hooks || {})) {
    wrapped[event] = Array.isArray(entries) ? entries : [entries];
  }
  return wrapped;
}

function detectHooksInstalled() {
  const s = readSettings();
  if (!s.json || typeof s.json !== 'object') return false;
  const hooks = s.json.hooks || {};
  if (hooks[PLUGIN_BLOCK_KEY]) return true;
  for (const event of Object.keys(hooks)) {
    if (event === PLUGIN_BLOCK_KEY) continue;
    const arr = hooks[event];
    if (!Array.isArray(arr)) continue;
    for (const entry of arr) {
      if (entry && entry[MARKER]) return true;
      if (entry && entry.hooks) {
        for (const h of entry.hooks) {
          if (h && typeof h.command === 'string' && h.command.includes('loomi-bridge.mjs')) return true;
        }
      }
    }
  }
  return false;
}

function installHooks({ yes = false } = {}) {
  const settings = readSettings();
  const j = settings.json || {};
  if (!j.hooks || typeof j.hooks !== 'object') j.hooks = {};

  if (j.hooks[PLUGIN_BLOCK_KEY]) {
    return { ok: true, alreadyInstalled: true, path: settings.path };
  }

  const template = loadHooksTemplate();
  const block = pluginHookEntriesPerEvent(template);
  if (Object.keys(block).length === 0) {
    return { ok: false, error: 'No hooks loaded from template', path: settings.path };
  }

  j.hooks[PLUGIN_BLOCK_KEY] = { [MARKER]: true, hooks: block, installedAt: new Date().toISOString() };

  // Diff summary
  const summary = {
    events: Object.keys(block),
    note: 'Plugin block stored under hooks.__openloomi_claude_plugin_hooks__. Other plugins untouched.',
  };

  atomicWriteJson(settings.path, j);
  return { ok: true, alreadyInstalled: false, path: settings.path, summary };
}

function uninstallHooks() {
  const settings = readSettings();
  const j = settings.json || {};
  let removed = false;
  if (j.hooks && j.hooks[PLUGIN_BLOCK_KEY]) {
    delete j.hooks[PLUGIN_BLOCK_KEY];
    removed = true;
  } else if (j.hooks) {
    // Legacy / per-event fallback — strip our marker entries.
    for (const event of Object.keys(j.hooks)) {
      const arr = j.hooks[event];
      if (!Array.isArray(arr)) continue;
      const before = arr.length;
      const filtered = arr.filter((entry) => {
        if (!entry) return false;
        if (entry[MARKER]) return false;
        if (entry.hooks && Array.isArray(entry.hooks)) {
          const inner = entry.hooks.filter((h) => !(h && typeof h.command === 'string' && h.command.includes('loomi-bridge.mjs')));
          if (inner.length === 0) return false;
          entry.hooks = inner;
          return true;
        }
        return true;
      });
      j.hooks[event] = filtered;
      if (filtered.length !== before) removed = true;
    }
  }
  atomicWriteJson(settings.path, j);
  return { ok: true, removed, path: settings.path };
}

// ---------------------------------------------------------------------------
// sync-claude-env (secrets-sensitive path)
// ---------------------------------------------------------------------------
//
// NOTE on env-source contract:
// process.env is populated by Claude Code's runtime from
// `~/.claude/settings.json` (the `env:` block) BEFORE this bridge is
// spawned. We do NOT re-parse settings.json here, on purpose: that would
// re-do work the framework already does, and would diverge from any
// future Claude Code env merge semantics. The visible failure mode if
// the framework ever stops honoring settings.json env is a clean
// `claudeEnvSyncable: false` in `setup-status` JSON, never silent
// data loss.

async function syncClaudeEnv() {
  // Read env ONCE, locally. Never persist. Never log. Never echo.
  const apiKey = (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || '').trim();
  const baseUrl = (process.env.ANTHROPIC_BASE_URL || DEFAULT_PROVIDER_BASE).trim();
  const model = (process.env.ANTHROPIC_MODEL || DEFAULT_PROVIDER_MODEL).trim();

  const checked = {
    ANTHROPIC_API_KEY: { present: !!process.env.ANTHROPIC_API_KEY, source: 'env' },
    ANTHROPIC_AUTH_TOKEN: { present: !!process.env.ANTHROPIC_AUTH_TOKEN, source: 'env' },
    ANTHROPIC_BASE_URL: { present: !!process.env.ANTHROPIC_BASE_URL, source: 'env' },
    ANTHROPIC_MODEL: { present: !!process.env.ANTHROPIC_MODEL, source: 'env' },
  };

  if (!apiKey) {
    return {
      ok: false,
      code: 'CLAUDE_ENV_NOT_SET',
      message: 'No ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN in environment',
      checked,
    };
  }

  const payload = {
    providerType: 'anthropic_compatible',
    apiKey,
    baseUrl,
    model,
    source: 'claude-code-plugin',
  };

  const res = await apiPOST('/api/ai/provider/config', payload, { timeoutMs: 10_000 });
  // We explicitly drop the apiKey from our local variable.
  // eslint-disable-next-line no-unused-vars
  const _drop = apiKey; // marker for review

  if (res.status === 404) {
    return {
      ok: false,
      code: 'ENDPOINT_MISSING',
      message:
        'OpenLoomi runtime does not yet expose POST /api/ai/provider/config. Configure the Anthropic-compatible provider manually in OpenLoomi Desktop Preferences → API Settings.',
      provider: 'anthropic_compatible',
      baseUrl,
      model,
      checked,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      code: 'SYNC_FAILED',
      status: res.status,
      message: res.json?.error || res.error?.message || 'Provider sync failed',
      checked,
    };
  }
  return {
    ok: true,
    provider: 'anthropic_compatible',
    model,
    baseUrl, // baseUrl is not secret; the apiKey was never included in the body
    response: res.json,
    checked,
  };
}

// ---------------------------------------------------------------------------
// pet / state (Pet mirror)
// ---------------------------------------------------------------------------

async function cmdPet(state) {
  if (!state || !CAPYBARA_STATES.has(state)) {
    return { ok: false, code: 'INVALID_STATE', validStates: [...CAPYBARA_STATES] };
  }
  const res = await apiPOST('/api/pet/state', { state, source: 'claude-code-plugin' }, { timeoutMs: STATE_HTTP_TIMEOUT_MS });
  if (res.status === 404) {
    return {
      ok: false,
      code: 'ENDPOINT_MISSING',
      message:
        'OpenLoomi runtime does not yet expose POST /api/pet/state. Pending endpoint — would have set state to "' +
        state +
        '".',
      state,
    };
  }
  if (!res.ok) {
    return { ok: false, code: 'PET_FAILED', status: res.status, error: res.json || res.error };
  }
  return { ok: true, state, response: res.json };
}

// One-tap guest login: POST /api/remote-auth/guest → mint a bearer →
// persist to ~/.openloomi/token (base64-encoded to match the Tauri
// runtime's `save_token`). Used by the setup wizard as a fallback when
// `LOGIN_REQUIRED` fires and the user doesn't want to open the desktop
// app to sign in with their existing account.
async function cmdGuestLogin({ baseUrl = null } = {}) {
  // The /api/remote-auth/guest endpoint does NOT require an existing
  // token, so we deliberately bypass the `Authorization: Bearer` header
  // path here by calling the server directly without a bearer.
  const target = (baseUrl || openloomiBaseUrl()) + '/api/remote-auth/guest';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({}),
      signal: ctrl.signal,
    });
    const text = await res.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    if (!res.ok) {
      return {
        ok: false,
        code: res.status === 404 ? 'ENDPOINT_MISSING' : `http_${res.status}`,
        status: res.status,
        error: json,
      };
    }
    const token = json?.token;
    if (typeof token !== 'string' || !token.trim()) {
      return { ok: false, code: 'NO_TOKEN_IN_RESPONSE', response: json };
    }
    const saved = saveOpenloomiToken(token);
    if (!saved.ok) {
      return { ok: false, code: saved.code || 'TOKEN_WRITE_FAILED', error: saved.error || null };
    }
    return {
      ok: true,
      user: json.user || null,
      tokenPath: saved.path,
    };
  } catch (e) {
    return { ok: false, code: 'NETWORK', error: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

async function cmdState(name, { event } = {}) {
  if (!CAPYBARA_STATES.has(name)) {
    // Hooks should never reach this with an invalid name, but be safe.
    return { ok: false, archive: 'skipped', reason: 'invalid_state', state: name };
  }
  try {
    const res = await apiPOST(
      '/api/pet/state',
      { state: name, source: 'claude-code-hook', event: event || null },
      { timeoutMs: STATE_HTTP_TIMEOUT_MS }
    );
    if (res.status === 404) {
      return { ok: false, archive: 'skipped', reason: 'endpoint_missing', state: name };
    }
    if (!res.ok) {
      return { ok: false, archive: 'skipped', reason: `http_${res.status}`, state: name };
    }
    return { ok: true, state: name };
  } catch {
    return { ok: false, archive: 'skipped', reason: 'exception', state: name };
  }
}

// ---------------------------------------------------------------------------
// archive (Stop hook)
// ---------------------------------------------------------------------------

async function readStdinJson({ maxBytes = 64 * 1024 } = {}) {
  return await new Promise((resolve) => {
    let total = 0;
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      total += Buffer.byteLength(chunk, 'utf8');
      if (total <= maxBytes) buf += chunk;
    });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', () => resolve(''));
    // If nothing arrives, resolve after 200ms with empty.
    setTimeout(() => resolve(buf), 200);
  });
}

async function cmdArchive() {
  // Always exit 0. Never block Claude.
  let payload = {};
  try {
    const stdinRaw = await readStdinJson({ maxBytes: 32 * 1024 });
    if (stdinRaw) {
      try { payload = JSON.parse(stdinRaw); } catch { payload = {}; }
    }
  } catch { payload = {}; }

  const eventName = payload.hook_event_name || payload.event || '';
  if (eventName !== 'Stop') {
    return { continue: true, _openloomi: { archive: 'skipped', reason: 'not_stop_event', event: eventName } };
  }

  const transcriptPath = payload.transcript_path || payload.transcriptPath || null;
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return { continue: true, _openloomi: { archive: 'skipped', reason: 'transcript_missing' } };
  }

  let raw;
  try {
    const st = statSync(transcriptPath);
    if (st.size > ARCHIVE_MAX_BYTES) {
      // Truncate by reading last ~ARCHIVE_MAX_BYTES bytes.
      const fd = await import('node:fs/promises');
      const fh = await fd.open(transcriptPath, 'r');
      try {
        const start = Math.max(0, st.size - ARCHIVE_MAX_BYTES);
        const buf = Buffer.alloc(st.size - start);
        await fh.read(buf, 0, buf.length, start);
        raw = buf.toString('utf8');
      } finally {
        await fh.close();
      }
    } else {
      raw = await readFile(transcriptPath, 'utf8');
    }
  } catch {
    return { continue: true, _openloomi: { archive: 'skipped', reason: 'transcript_unreadable' } };
  }

  const lines = raw.split(/\r?\n/).filter(Boolean);
  const parsed = [];
  for (const line of lines) {
    try {
      const o = JSON.parse(line);
      if (o && (o.type === 'user' || o.type === 'human' || o.type === 'assistant')) {
        parsed.push(o);
      }
    } catch { /* skip */ }
  }
  if (parsed.length === 0) {
    return { continue: true, _openloomi: { archive: 'skipped', reason: 'no_messages' } };
  }
  const tail = parsed.slice(-ARCHIVE_MAX_TURNS);
  const summaryText = buildArchiveSummary(tail, payload.session_id || null);
  if (!summaryText) {
    return { continue: true, _openloomi: { archive: 'skipped', reason: 'empty_summary' } };
  }

  const bearer = loadBearerToken();
  if (!bearer) {
    return { continue: true, _openloomi: { archive: 'skipped', reason: 'auth_missing' } };
  }

  const res = await apiPOST(
    '/api/insights',
    {
      type: 'note',
      groups: ['claude-code'],
      content: summaryText,
      sessionId: payload.session_id || null,
      source: 'claude-code-plugin-stop-hook',
      capturedAt: new Date().toISOString(),
    },
    { timeoutMs: ARCHIVE_HTTP_TIMEOUT_MS }
  );

  if (!res.ok) {
    return {
      continue: true,
      _openloomi: {
        archive: 'skipped',
        reason: res.status === 404 ? 'endpoint_missing' : `http_${res.status}`,
        details: res.json || res.error || null,
      },
    };
  }
  return { continue: true, _openloomi: { archive: 'ok', session: payload.session_id || null, insightId: res.json?.id || null } };
}

function buildArchiveSummary(turns, sessionId) {
  const parts = [];
  let total = 0;
  for (const t of turns) {
    const content = extractMessageText(t);
    if (!content) continue;
    const role = t.role || t.type || 'message';
    const tag = role === 'user' || role === 'human' ? 'user' : role === 'assistant' ? 'assistant' : role;
    const slice = `${tag}: ${content}`.slice(0, 1500);
    parts.push(slice);
    total += slice.length;
    if (total > ARCHIVE_MAX_CONTENT_CHARS) break;
  }
  if (parts.length === 0) return null;
  const header = `[claude-code session${sessionId ? ' ' + sessionId : ''}]`;
  const joined = parts.join('\n');
  const capped = joined.length > ARCHIVE_MAX_CONTENT_CHARS
    ? joined.slice(0, ARCHIVE_MAX_CONTENT_CHARS) + '…'
    : joined;
  return `${header}\n${capped}`;
}

function extractMessageText(obj) {
  const msg = obj?.message || obj;
  const c = msg?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((p) => {
        if (!p) return '';
        if (typeof p === 'string') return p;
        if (p.type === 'text' && typeof p.text === 'string') return p.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

// ---------------------------------------------------------------------------
// usage
// ---------------------------------------------------------------------------

async function cmdUsage() {
  const r = await apiGET('/api/llm/usage/summary', { timeoutMs: 5000 });
  if (!r.ok && r.status === 0) {
    return { ok: false, code: 'API_UNREACHABLE', error: r.error };
  }
  return { ok: r.ok, status: r.status, usage: r.json };
}

// ---------------------------------------------------------------------------
// install (user-approved)
// ---------------------------------------------------------------------------

async function promptYesNo(question) {
  if (!isTTY) return false;
  process.stdout.write(`${question} [y/N] `);
  return await new Promise((resolve) => {
    let buf = '';
    const onData = (b) => {
      buf += b.toString('utf8');
      if (buf.includes('\n')) {
        process.stdin.removeListener('data', onData);
        const answer = buf.trim().toLowerCase();
        resolve(answer === 'y' || answer === 'yes');
      }
    };
    process.stdin.on('data', onData);
    process.stdin.resume();
  });
}

async function runInstallScript({ platformName, yes }) {
  const filename =
    platformName === 'macos'
      ? 'setup.macos.sh'
      : platformName === 'windows'
      ? 'setup.windows.ps1'
      : 'setup.linux.sh';
  const candidates = [
    join(PLUGIN_DIR, 'scripts', 'install-assets', filename),
    join(PLUGIN_DIR, 'install-assets', filename),
  ];
  let scriptPath = null;
  for (const c of candidates) {
    if (existsSync(c)) { scriptPath = c; break; }
  }
  if (!scriptPath) {
    return {
      ok: false,
      code: 'INSTALL_SCRIPT_MISSING',
      message: `No install script shipped for ${platformName}. Open https://openloomi.ai/docs/install and follow the manual steps.`,
    };
  }
  if (!yes) {
    if (!isTTY) {
      return {
        ok: false,
        code: 'NON_INTERACTIVE_REQUIRES_YES',
        message:
          'Install invoked without --yes from a non-interactive shell (no TTY). Re-run with --yes to confirm consent, or run directly in a terminal so the y/N prompt can be answered.',
      };
    }
    const proceed = await promptYesNo(
      `This will execute ${filename} from the OpenLoomi plugin to install OpenLoomi locally. Proceed?`
    );
    if (!proceed) return { ok: false, code: 'CANCELLED', message: 'User cancelled installation.' };
  }
  let cmd, args;
  if (platformName === 'windows') {
    cmd = 'powershell';
    args = ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-File', scriptPath];
  } else {
    cmd = 'bash';
    args = [scriptPath];
  }
  return await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (b) => (stdout += b.toString('utf8')));
    child.stderr.on('data', (b) => (stderr += b.toString('utf8')));
    child.on('error', (e) => resolve({ ok: false, code: 'SPAWN_FAILED', message: String(e?.message || e) }));
    child.on('exit', (code) =>
      resolve({ ok: code === 0, code: code === 0 ? 'OK' : `EXIT_${code}`, stdout, stderr })
    );
  });
}

async function cmdInstall({ yes = false } = {}) {
  const platformName = detectPlatform();
  const r = await runInstallScript({ platformName, yes });
  // After install, refresh discovery state.
  const status = await buildStatus({ json: true });
  return { install: r, status };
}

// ---------------------------------------------------------------------------
// Command routing
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const sub = args._[0];

  switch (sub) {
    case 'version': {
      out({ ok: true, plugin: 'openloomi', version: PLUGIN_VERSION });
      return;
    }
    case 'setup-status': {
      const status = await buildStatus({ json: true, explicit: args['bin-path'] || null });
      out(status);
      return;
    }
    case 'setup': {
      const status = await buildStatus({ json: true, explicit: args['bin-path'] || null });
      if (!status.installed && status.nextAction === 'install_openloomi') {
        const r = await cmdInstall({ yes: !!args.yes });
        out({ ok: r.install?.ok, setup: 'install_attempted', install: r.install, status: r.status });
        return;
      }
      if (status.installed && status.reason === 'OPENLOOMI_NOT_FINALIZED') {
        // The user-visible desktop app IS installed; we just need the user
        // to launch it once so it lays down the local helper binary.
        // Do NOT re-run the installer — that path will fail again.
        out({
          ok: false,
          setup: 'awaiting_user_finalization',
          code: 'OPENLOOMI_NOT_FINALIZED',
          message: 'OpenLoomi is installed but not yet finalized.',
          userAction: 'Launch OpenLoomi from ' + (status.desktopMarker || 'the Applications folder') + ' once, then re-run /openloomi:setup.',
          actions: status.hint?.actions || {},
          status,
        });
        return;
      }
      if (status.reason === 'LOGIN_REQUIRED' && status.canGuestLogin) {
        // One-tap guest login: mint a bearer via the local runtime and
        // persist it to ~/.openloomi/token, then re-check status. The
        // user does NOT need to interactively open the desktop app to
        // sign in with an existing account.
        const g = await cmdGuestLogin();
        if (g.ok) {
          const refreshed = await buildStatus({ json: true, explicit: args['bin-path'] || null });
          out({ ok: true, setup: 'guest_login_ok', guest: g, status: refreshed });
        } else {
          out({
            ok: false,
            setup: 'guest_login_failed',
            code: g.code,
            message: 'Guest login failed. Open OpenLoomi Desktop to sign in with your existing account, then re-run /openloomi:setup.',
            guest: g,
            status,
          });
        }
        return;
      }
      if (status.tokenPresent && status.claudeEnvSyncable && !status.aiProviderConfigured) {
        const syncRes = await syncClaudeEnv();
        const refreshed = await buildStatus({ json: true, explicit: args['bin-path'] || null });
        out({ ok: true, setup: 'sync_attempted', sync: { ok: syncRes.ok, code: syncRes.code, provider: syncRes.provider, model: syncRes.model }, status: refreshed });
        return;
      }
      out({ ok: true, setup: 'noop', status });
      return;
    }
    case 'install': {
      const r = await cmdInstall({ yes: !!args.yes });
      out(r);
      return;
    }
    case 'login': {
      // We deliberately do not spawn a browser here — the user can open
      // OpenLoomi Desktop themselves. We just report token presence.
      const status = await buildStatus({ json: true });
      out({
        ok: true,
        loginRequired: !status.tokenPresent,
        instructions: status.tokenPresent
          ? 'Already authenticated. No action required.'
          : 'Open OpenLoomi Desktop and complete sign-in. The plugin will detect the token automatically. Alternatively, run `guest-login` for a one-tap guest account.',
        status,
      });
      return;
    }
    case 'guest-login': {
      const r = await cmdGuestLogin({ baseUrl: process.env.OPENLOOMI_BASE_URL || null });
      // Sanitize: never echo the raw token; report the path on success so
      // the caller can confirm the file landed.
      if (r.ok) {
        out({ ok: true, guest: 'ok', user: r.user, tokenPath: r.tokenPath });
      } else {
        out({ ok: false, guest: r.code || 'failed', error: r.error || null, status: r.status || null }, 1);
      }
      return;
    }
    case 'sync-claude-env': {
      const syncRes = await syncClaudeEnv();
      // Ensure no key content slips into the response by accident.
      const sanitized = { ...syncRes };
      delete sanitized.apiKey;
      delete sanitized.key;
      out(sanitized, syncRes.ok ? 0 : 1);
      return;
    }
    case 'pet': {
      const state = args._[1];
      const r = await cmdPet(state);
      out(r, r.ok ? 0 : 1);
      return;
    }
    case 'state': {
      const name = args._[1];
      const event = args.event || null;
      const r = await cmdState(name, { event });
      out(r);
      return;
    }
    case 'archive': {
      // Hooks must always exit 0. We capture the result and print, but
      // never set a non-zero exit code from this path.
      try {
        const r = await cmdArchive();
        process.stdout.write(JSON.stringify(r) + EOL);
      } catch {
        process.stdout.write(JSON.stringify({ continue: true, _openloomi: { archive: 'skipped', reason: 'exception' } }) + EOL);
      }
      process.exit(0);
      return;
    }
    case 'usage': {
      const r = await cmdUsage();
      out(r, r.ok ? 0 : 0);
      return;
    }
    case 'install-hooks': {
      const r = installHooks({ yes: !!args.yes });
      out(r, r.ok ? 0 : 1);
      return;
    }
    case 'uninstall-hooks': {
      const r = uninstallHooks();
      out(r, r.ok ? 0 : 1);
      return;
    }
    case 'hooks-status': {
      const installed = detectHooksInstalled();
      const settings = readSettings();
      out({
        ok: true,
        installed,
        settingsPath: settings.path,
        marker: MARKER,
        blockKey: PLUGIN_BLOCK_KEY,
      });
      return;
    }
    case 'help': {
      process.stdout.write(
        [
          'loomi-bridge.mjs <subcommand> [...flags]',
          '',
          'Subcommands:',
          '  version                          print plugin version',
          '  setup                            full setup wizard',
          '  setup-status [--json]            stable JSON status',
          '  install [--yes]                  user-approved install',
          '  login                            check token presence',
          '  guest-login                      one-tap guest bearer (writes ~/.openloomi/token)',
          '  sync-claude-env                  read Claude env → OpenLoomi provider',
          '  pet <state>                      set OpenLoomi Pet state',
          '  state <name> [--event E]         fire-and-forget state (hook)',
          '  archive                          archive last Stop transcript (hook)',
          '  usage                            GET /api/llm/usage/summary',
          '  install-hooks                    merge into ~/.claude/settings.json',
          '  uninstall-hooks                  strip plugin hook block',
          '  hooks-status                     report merge state',
          '  help                             this help',
          '',
        ].join('\n')
      );
      return;
    }
    default: {
      err('UNKNOWN_SUBCOMMAND', `Unknown subcommand: ${sub || '(none)'}`, { valid: [
        'version', 'setup', 'setup-status', 'install', 'login', 'guest-login', 'sync-claude-env',
        'pet', 'state', 'archive', 'usage',
        'install-hooks', 'uninstall-hooks', 'hooks-status', 'help',
      ] });
      return;
    }
  }
}

main().catch((e) => {
  // Top-level catch: print JSON, exit 1.
  process.stdout.write(
    JSON.stringify({ ok: false, code: 'UNEXPECTED', error: String(e?.stack || e?.message || e) }) + EOL
  );
  process.exit(1);
});
