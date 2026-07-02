#!/usr/bin/env node
/**
 * Obsidian vault scanner for openloomi-loop
 *
 * Reads $OBSIDIAN_VAULT (a directory configured by the user) and emits one
 * `obsidian_note_changed` signal per .md file whose mtime is newer than the
 * last successful scan. The mtime cache lives in $SKILL_DIR/data/obsidian.state.json
 * so the scan is incremental — typical ticks only emit a handful of signals
 * even if the vault has thousands of files.
 *
 * Output:
 *   - appends one NDJSON line per change to $SKILL_DIR/data/signals.jsonl
 *   - overwrites $SKILL_DIR/data/obsidian.state.json with the new mtime map
 *   - emits a single `obsidian_scan_overflow` signal if the cap is exceeded
 *   - exits 0 on success, 1 if OBSIDIAN_VAULT is not set
 *
 * Usage:
 *   OBSIDIAN_VAULT=/Users/you/Documents/ObsidianVault \
 *     node scripts/obsidian-scan.cjs
 *
 * Optional env:
 *   OBSIDIAN_VAULT_EXT  — comma-separated extensions (default: ".md")
 *   OBSIDIAN_VAULT_CAP  — max changes per tick (default: 50)
 *   OBSIDIAN_VAULT_RECURSIVE — "0" or "1" (default: "1")
 *
 * Platform:
 *   - Runs only in Node (the loop daemon / cron / launchd).
 *   - Reads the vault via node:fs/promises; the returned entry shape
 *     (name/path/isDirectory/mtimeMs/size) mirrors PlatformFileSystem.listDirectory
 *     so the same signal payload format is used.
 *   - The Tauri / browser adapters implement their own scanner using the
 *     shared primitive; they don't invoke this skill's CLI.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const lib = require('./loop-lib.cjs');

const SKILL_DIR = path.resolve(__dirname, '..');
const SIGNALS_PATH = path.join(SKILL_DIR, 'data', 'signals.jsonl');
const STATE_PATH = path.join(SKILL_DIR, 'data', 'obsidian.state.json');

// Use the shared lib's append so every emitted signal gets a stable `id`
// (sig_xxxxxxxx). The daemon's dedup in generateDecisions() keys off
// signal.id — without it, an obsidian change re-emits a fresh decision on
// every tick.
const { signals } = lib;
const CAP = Number.parseInt(process.env.OBSIDIAN_VAULT_CAP || '50', 10);
const EXT = (process.env.OBSIDIAN_VAULT_EXT || '.md')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const RECURSIVE = process.env.OBSIDIAN_VAULT_RECURSIVE !== '0';

const VAULT = process.env.OBSIDIAN_VAULT;

function log(...args) {
  console.error('[obsidian-scan]', ...args);
}

function nowIso() {
  return new Date().toISOString();
}

async function readState() {
  try {
    const raw = await fsp.readFile(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      log('state read failed, starting fresh:', err.message);
    }
  }
  return { vault: VAULT, mtimes: {} };
}

async function writeState(state) {
  await fsp.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fsp.writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

async function appendSignal(signal) {
  await fsp.mkdir(path.dirname(SIGNALS_PATH), { recursive: true });
  await fsp.appendFile(SIGNALS_PATH, `${JSON.stringify(signal)}\n`);
}

async function listVault(vault) {
  // Recursive walk with extension filter. Returned entries mirror the
  // shape of PlatformFileSystem.listDirectory (DirEntry[]):
  // { name, path, isDirectory, mtimeMs, size }.
  const out = [];
  async function walk(dir, base) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      log(`readdir failed for ${dir}:`, err.message);
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = base ? path.posix.join(base, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (!RECURSIVE) continue;
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        await walk(abs, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (EXT.length > 0) {
        const lower = entry.name.toLowerCase();
        if (!EXT.some((e) => lower.endsWith(e))) continue;
      }
      let mtimeMs = 0;
      let size = 0;
      try {
        const stat = await fsp.stat(abs);
        mtimeMs = stat.mtimeMs || 0;
        size = stat.size || 0;
      } catch {
        // best-effort
      }
      out.push({
        name: entry.name,
        path: rel.split(path.sep).join('/'),
        isDirectory: false,
        mtimeMs,
        size,
      });
    }
  }
  await walk(vault, '');
  return out;
}

async function main() {
  if (!VAULT) {
    log('OBSIDIAN_VAULT not set, skipping scan');
    process.exit(1);
  }

  let exists = false;
  try {
    const stat = await fsp.stat(VAULT);
    exists = stat.isDirectory();
  } catch {
    exists = false;
  }
  if (!exists) {
    log(`vault path is not a directory: ${VAULT}`);
    process.exit(1);
  }

  const entries = await listVault(VAULT);

  const prev = await readState();
  const prevMtimes = prev.mtimes || {};

  // Reset state when the vault path changes — we don't want stale mtimes
  // for files in a different vault to look like "new".
  const state =
    prev.vault && prev.vault !== VAULT ? { vault: VAULT, mtimes: {} } : { ...prev, vault: VAULT };

  const newMtimes = {};
  const changes = [];
  for (const entry of entries) {
    newMtimes[entry.path] = entry.mtimeMs;
    const old = prevMtimes[entry.path];
    if (old !== entry.mtimeMs) {
      changes.push(entry);
    }
  }

  // Files that no longer exist in the vault drop out of the mtime map
  // automatically because we rebuild newMtimes from scratch each tick.

  let emitted = 0;
  for (const change of changes) {
    if (emitted >= CAP) {
      signals.append('obsidian', 'obsidian_scan_overflow', {
        vault: VAULT,
        dropped: changes.length - emitted,
        cap: CAP,
      });
      log(`overflow: ${changes.length - emitted} additional changes dropped`);
      break;
    }
    signals.append('obsidian', 'obsidian_note_changed', {
      path: change.path,
      mtime_ms: change.mtimeMs,
      size: change.size,
      vault: VAULT,
    });
    emitted += 1;
  }

  state.mtimes = newMtimes;
  state.lastTick = nowIso();
  state.lastTickEmitted = emitted;
  await writeState(state);

  log(
    `vault=${VAULT} entries=${entries.length} changes=${emitted} cap=${CAP}`,
  );
  console.log(
    JSON.stringify({
      vault: VAULT,
      scanned: entries.length,
      changes: emitted,
      cap: CAP,
    }),
  );
}

main().catch((err) => {
  log('scan failed:', err?.stack ? err.stack : err);
  process.exit(1);
});
