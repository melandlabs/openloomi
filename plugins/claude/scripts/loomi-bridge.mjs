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
//   pet <state>                      set OpenLoomi Pet state
//   state <name> [--event <e>]       fire-and-forget state (hook internal)
//   archive                          archive last Stop transcript (hook internal)
//   usage                            GET /api/llm/usage/summary
//   install-hooks                    merge into ~/.claude/settings.json
//   uninstall-hooks                  strip only the plugin's block
//   hooks-status                     report merge state
//
// IMPORTANT (secrets contract):
//   - This bridge never reads AI-provider env vars. AI provider
//     configuration lives entirely inside the OpenLoomi runtime,
//     which detects the user's `claude` CLI auth on its own. The
//     plugin's job is "Claude Code ↔ OpenLoomi Pet/state/usage";
//     AI config is the runtime's.
//   - ~/.openloomi/token is read at most for base64-decode to obtain
//     the bearer; its contents are never printed.
//   - All status checks report presence/absence only.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  statSync,
  chmodSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { EOL } from "node:os";
import { homedir, platform, tmpdir } from "node:os";
import { join, delimiter, sep, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Constants & state
// ---------------------------------------------------------------------------

const PLUGIN_VERSION = "0.1.0";
const CLAUDE_NATIVE_PROVIDER = "claude";
const DEFAULT_PROVIDER_BASE = "https://api.anthropic.com";
const DEFAULT_PROVIDER_MODEL = "claude-opus-4-6";
// Matches the documented ports in skills/openloomi-api/SKILL.md; the
// desktop app falls back to 3515 when 3414 is busy.
const OPENLOOMI_PORT_DEFAULT = 3414;
const OPENLOOMI_PORT_FALLBACK = 3515;
let _resolvedPort = OPENLOOMI_PORT_DEFAULT;
const STATE_HTTP_TIMEOUT_MS = 2000;
const ARCHIVE_HTTP_TIMEOUT_MS = 15_000;
const CLAUDE_CLI_PROBE_TIMEOUT_MS = 5000;
const ARCHIVE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB cap on transcripts
const ARCHIVE_MAX_TURNS = 6; // 6 user+assistant turns
const ARCHIVE_MAX_CONTENT_CHARS = 6000; // 6k char summary cap

// ---------------------------------------------------------------------------
// Per-stage setup timeouts (issue #397)
//
// First-run /openloomi:setup chains four different waits behind one command:
//   1. install  (download + lay down the .app bundle via the platform script)
//   2. launch   (open -a / gtk-launch / start "" — short)
//   3. api_ready (poll the local HTTP API until it responds)
//   4. permission_grace (extra budget on top of api_ready for the first call
//                        in case macOS is showing a TCC/Accessibility prompt
//                        that the user has to dismiss by hand)
//
// The legacy `--max-wait` flag is kept as a global cap. The per-stage flags
// below are the new defaults: each is independently tunable so a slow
// download does not steal budget from the API wait, and vice versa.
// ---------------------------------------------------------------------------
const DEFAULT_INSTALL_TIMEOUT_MS = 300_000; //  5 min — covers slow 50 Mbps
const DEFAULT_LAUNCH_TIMEOUT_MS = 10_000; // 10 s
const DEFAULT_API_TIMEOUT_MS = 120_000; //  2 min — first-run default
const DEFAULT_PERMISSION_GRACE_MS = 60_000; //  1 min extra for TCC prompts
const SETUP_MAX_WAIT_DEFAULT_MS = 120_000; // --max-wait legacy default

// Throttle live progress lines to ~1 Hz so we don't spam the terminal.
// The value is the most-recent full-second tick we already printed for a
// given stage; same-tick calls are silent.
const _lastProgressSecond = Object.create(null);

// 9-state capybara sprite set (apps/web/public/loomi-pet/assets/capybara/).
// The plugin ships fox-sprite branding in `assets/`, but the bridge itself
// is theme-agnostic — it validates state names against the superset of
// names used by both the capybara and fox (loomi-*) sprite sets; the
// OpenLoomi runtime's `map_state_to_pet` watcher decides which sprite
// to render per the user's chosen theme.
const CAPYBARA_STATES = new Set([
  "happy",
  "idle",
  "juggling",
  "needsinput",
  "presenting",
  "sleeping",
  "sweeping",
  "thinking",
  "working",
]);

const MARKER = "_openloomi_plugin";
const PLUGIN_BLOCK_KEY = "__openloomi_claude_plugin_hooks__";
const PLUGIN_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOKS_FILE = join(PLUGIN_DIR, "hooks", "hooks.json");
const PLUGIN_DATA_DIR = (() => {
  const explicit = process.env.CLAUDE_PLUGIN_DATA;
  if (explicit) return explicit;
  return join(homedir(), ".claude", "plugins", "openloomi");
})();

const NEXT_ACTIONS = new Set([
  "install_openloomi",
  "provide_install_or_repo_path",
  "build_or_stage_openloomi",
  "login_openloomi",
  "configure_ai_provider",
  "install_claude_cli",
  "login_claude_cli",
  "inspect_claude_cli",
  "configure_connectors",
  "show_openloomi_skills",
  "run",
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
    const cfg = join(pluginDataDir(), "config.json");
    if (!existsSync(cfg)) return null;
    const txt = readFileSync(cfg, "utf8");
    const j = JSON.parse(txt);
    if (typeof j?.binPath === "string" && existsSync(j.binPath)) {
      return j.binPath;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function saveBinPath(p) {
  try {
    const cfg = join(pluginDataDir(), "config.json");
    writeFileSync(
      cfg,
      JSON.stringify({ binPath: p, savedAt: Date.now() }, null, 2),
    );
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

// Format a millisecond duration as a compact "Ns" string for status lines.
// `ms <= 0` returns "0s"; values up to ~540s render as integer seconds; beyond
// that we fall back to "XmYYs" so the line still fits on a terminal.
function formatMs(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  if (total < 600) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return s ? `${m}m${s}s` : `${m}m`;
  }
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

// Throttled live-progress writer for the setup wizard. Returns a function
// the caller invokes periodically (e.g. once per poll iteration). At most
// one line per stage per second is emitted, on stderr so the JSON payload
// on stdout stays parseable.
//
// `stage`  — short human-readable label, e.g. "wait_api".
// `startedAt` — Date.now() when the stage began. The returned ticker also
//               handles a synthetic "0 s / max Z s …" first beat so the
//               user sees feedback within ~1 s of starting a long stage.
//
// The returned function is safe to call from a tight loop; it does its own
// throttling and never throws.
function makeStageTicker(stage, budgetMs) {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    return () => {}; // negative budget = no-op ticker
  }
  const startedAt = Date.now();
  // Prime the throttle slot so the first non-zero tick is emitted.
  _lastProgressSecond[stage] = -1;
  return function tick({ force = false } = {}) {
    const elapsedMs = Date.now() - startedAt;
    const sec = Math.floor(elapsedMs / 1000);
    if (!force && _lastProgressSecond[stage] === sec) return;
    _lastProgressSecond[stage] = sec;
    const label = STAGE_LABELS[stage] || stage;
    try {
      process.stderr.write(
        `  \u00b7 ${label}  (${formatMs(elapsedMs)} / max ${formatMs(budgetMs)}) \u2026\n`,
      );
    } catch {
      /* non-fatal: stderr may be piped */
    }
  };
}

// Stable, safe-to-print human labels for the stages used by the wizard.
const STAGE_LABELS = Object.freeze({
  install: "installing OpenLoomi",
  launch: "launching desktop app",
  wait_api: "waiting for local API",
  permission_grace: "waiting on macOS permission prompt",
});

// ---------------------------------------------------------------------------
// Network retry helper
//
// `fetchWithRetry(url, init, opts)` is a thin wrapper around `fetch` that
// retries on transient failures:
//
//   * network errors (fetch threw, e.g. ECONNRESET / "fetch failed")
//   * per-attempt timeouts (our AbortController fired)
//   * HTTP 5xx
//   * HTTP 429 (honoring Retry-After when present)
//
// Non-retryable:
//   * HTTP 4xx other than 429 — the server actively rejected the request
//   * AbortError caused by an *external* caller signal (init.signal) — we
//     don't override the caller's intent to cancel.
//
// Backoff is exponential with full jitter, capped at `maxDelayMs`. Defaults
// give 3 total attempts (initial + 2 retries) with 250 ms / 750 ms sleeps,
// adding at most ~1 s of latency in the worst case. Each attempt has its
// own `timeoutMs` budget, so a 5 s timeout means a hard ceiling of ~15 s
// per call across all attempts.
//
// Designed for the local OpenLoomi API (127.0.0.1), where brief hiccups
// are common during desktop-app launches. The helper is dependency-free
// and safe to use from any of the existing call sites.
// ---------------------------------------------------------------------------
const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const DEFAULT_RETRY_MAX_DELAY_MS = 2000;
const DEFAULT_RETRY_ATTEMPTS = 2; // initial + 2 retries = 3 total

function defaultIsRetryable({ status, error }) {
  if (error) {
    // External caller-initiated aborts are not transient.
    if (error.name === "AbortError" && error.__external) return false;
    return true; // network error / our-internal timeout
  }
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

// Pick a Retry-After value from a Response (seconds or HTTP-date), or null.
// Spec: https://datatracker.ietf.org/doc/html/rfc7231#section-7.1.3
function readRetryAfterMs(res) {
  const v = res?.headers?.get?.("retry-after");
  if (!v) return null;
  const asNum = Number(v);
  if (Number.isFinite(asNum)) return Math.max(0, asNum * 1000);
  const asDate = Date.parse(v);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

function computeBackoffMs(attempt, baseDelayMs, maxDelayMs) {
  // attempt is 1-based: 1 -> base, 2 -> 2*base, ...
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  // Full jitter: pick a random value in [baseDelayMs, exp] so a thundering
  // herd of plugins retrying in lockstep doesn't synchronize. Lower bound
  // stays at baseDelayMs so we still back off meaningfully on attempt 1.
  const lo = Math.min(baseDelayMs, exp);
  return lo + Math.floor(Math.random() * Math.max(1, exp - lo));
}

async function fetchWithRetry(url, init = {}, opts = {}) {
  const {
    timeoutMs,
    retries = DEFAULT_RETRY_ATTEMPTS,
    baseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_RETRY_MAX_DELAY_MS,
    isRetryable = defaultIsRetryable,
    onRetry,
    sleepFn = sleep,
  } = opts;

  const externalSignal = init.signal || null;
  const maxAttempts = Math.max(1, retries + 1);
  let lastError = null;
  let lastStatus = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // Per-attempt controller. If we time out, the AbortError carries our
    // internal reason so defaultIsRetryable knows to retry it.
    const ctrl = new AbortController();
    const onExternalAbort = () => ctrl.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        const e = new Error("aborted");
        e.name = "AbortError";
        e.__external = true;
        throw e;
      }
      externalSignal.addEventListener("abort", onExternalAbort, {
        once: true,
      });
    }
    let timer = null;
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        const e = new Error(`request timed out after ${timeoutMs}ms`);
        e.name = "AbortError";
        e.__external = false;
        ctrl.abort();
      }, timeoutMs);
    }

    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      lastStatus = res.status;

      if (
        !isRetryable({ status: res.status, error: null }) ||
        attempt === maxAttempts
      ) {
        return res;
      }

      // Retryable HTTP status — back off and try again.
      const retryAfter = readRetryAfterMs(res);
      const delayMs =
        retryAfter ?? computeBackoffMs(attempt, baseDelayMs, maxDelayMs);
      if (typeof onRetry === "function") {
        try {
          onRetry({ attempt, delayMs, reason: `http_${res.status}` });
        } catch {
          /* non-fatal */
        }
      }
      // Drain the body so the underlying socket can be reused / closed cleanly.
      try {
        await res.arrayBuffer();
      } catch {
        /* ignore */
      }
      await sleepFn(delayMs);
      continue;
    } catch (error) {
      lastError = error;
      const retryable = isRetryable({ status: 0, error });
      if (!retryable || attempt === maxAttempts) {
        throw error;
      }
      const delayMs = computeBackoffMs(attempt, baseDelayMs, maxDelayMs);
      if (typeof onRetry === "function") {
        try {
          onRetry({
            attempt,
            delayMs,
            reason: error?.name === "AbortError" ? "timeout" : "network",
          });
        } catch {
          /* non-fatal */
        }
      }
      await sleepFn(delayMs);
      continue;
    } finally {
      if (timer) clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onExternalAbort);
      }
    }
  }

  // Unreachable: the loop above always either returns or throws. Defensive
  // throw so callers can rely on this function never resolving to undefined.
  if (lastError) throw lastError;
  const e = new Error(
    `fetch failed after ${maxAttempts} attempts (status ${lastStatus})`,
  );
  e.__lastStatus = lastStatus;
  throw e;
}

// Compose the per-stage + global budgets from CLI args. Each per-stage flag
// wins; otherwise we fall back to the legacy `--max-wait` (so existing
// callers keep working unchanged), and finally to the documented default.
//
// Returns: { installMs, launchMs, apiMs, permissionMs, totalMs }
//   - totalMs is the global cap; the wizard short-circuits when (sum of
//     elapsed across all stages) > totalMs.
function readStageTimeouts(args) {
  const totalMs = Number(args["max-wait"] || SETUP_MAX_WAIT_DEFAULT_MS);
  const num = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const apiMs = num(
    args["api-timeout"] ?? args["api-timeout-ms"],
    num(args["max-wait"], DEFAULT_API_TIMEOUT_MS),
  );
  const installMs = num(
    args["install-timeout"] ?? args["install-timeout-ms"],
    num(args["max-wait"], DEFAULT_INSTALL_TIMEOUT_MS),
  );
  const launchMs = num(
    args["launch-timeout"] ?? args["launch-timeout-ms"],
    DEFAULT_LAUNCH_TIMEOUT_MS,
  );
  const permissionMs = num(
    args["permission-timeout"] ?? args["permission-timeout-ms"],
    DEFAULT_PERMISSION_GRACE_MS,
  );
  return { installMs, launchMs, apiMs, permissionMs, totalMs };
}

// Compose a concrete `/openloomi:setup --yes ...` resume command for an
// install failure. The install timeout flag is raised to a level that
// comfortably covers a slow 50 Mbps download so the user's retry doesn't
// hit the same wall.
function installResumeCommand() {
  const tuned = Math.max(DEFAULT_INSTALL_TIMEOUT_MS, 600_000);
  return `/openloomi:setup --yes --install-timeout ${tuned}`;
}

// Map a non-OK install result to a stable, human `message` and at least
// one concrete next action in `hints[]`. Resumable cases additionally
// receive `canResume: true` and a pre-built `resumeCommand` so the chat
// layer doesn't have to invent the flags.
//
// Covers at minimum the codes the platform helpers can emit today:
//   EXIT_22, EXIT_28, EXIT_35, INSTALL_TIMEOUT / TIMEOUT,
//   SPAWN_FAILED, INSTALL_SCRIPT_MISSING, NON_INTERACTIVE_REQUIRES_YES,
//   CANCELLED, and a generic `EXIT_*` fallback.
//
// `result.elapsedMs` (when present) is preserved; `result.stdout` /
// `result.stderr` are preserved as-is so the chat layer can echo the
// raw helper output if it wants to. Already-populated `message` /
// `hints` on `result` win so callers can override.
function installErrorGuidance(result) {
  const code = result?.code || "EXIT_NONZERO";
  const baseHints = [
    "Re-run /openloomi:setup to retry — already-completed steps will be skipped.",
  ];
  // Allow callers to seed either field; we only fill in what's missing.
  const out = {
    code,
    message: typeof result?.message === "string" ? result.message : null,
    hints:
      Array.isArray(result?.hints) && result.hints.length > 0
        ? result.hints.slice()
        : null,
    canResume: typeof result?.canResume === "boolean" ? result.canResume : true,
    resumeCommand: result?.resumeCommand || installResumeCommand(),
  };

  switch (code) {
    case "EXIT_22": {
      if (!out.message) {
        out.message =
          "The GitHub asset server returned an HTTP error (curl exit 22). The release may not exist, your network blocked the CDN, or a rate limit was hit.";
      }
      out.hints = out.hints || [
        "If you are on a corporate network, see https://openloomi.ai/docs/install/restricted-network.",
        "Pin a known-good release with OPENLOOMI_VERSION=vX.Y.Z and re-run /openloomi:setup.",
        "Pre-stage a local bundle: export OPENLOOMI_DMG_PATH=/path/to/file.dmg (mac) and re-run setup.",
        ...baseHints,
      ];
      break;
    }
    case "EXIT_28": {
      if (!out.message) {
        out.message =
          "The download timed out (curl exit 28). The connection is too slow or unstable to complete the asset transfer within the current budget.";
      }
      out.hints = out.hints || [
        `Re-run /openloomi:setup --yes --install-timeout ${Math.max(DEFAULT_INSTALL_TIMEOUT_MS, 600_000)} to give the download more time.`,
        "If you are on a slow or metered connection, see https://openloomi.ai/docs/install/restricted-network.",
        "Pre-stage a local bundle with OPENLOOMI_DMG_PATH (mac) or --offline <path> and re-run setup.",
      ];
      break;
    }
    case "EXIT_35": {
      if (!out.message) {
        out.message =
          "TLS handshake to the asset CDN failed (curl exit 35). Your network may require a corporate CA bundle or a TLS-inspection proxy.";
      }
      out.hints = out.hints || [
        "If you are behind a corporate proxy or TLS inspection, see https://openloomi.ai/docs/install/restricted-network.",
        "Set NODE_EXTRA_CA_CERTS=/path/to/corp-ca.pem (or add the CA via macOS Profiles) and re-run setup.",
        "Pre-stage a local bundle with OPENLOOMI_DMG_PATH (mac) or --offline <path> and re-run setup.",
        ...baseHints,
      ];
      break;
    }
    case "INSTALL_TIMEOUT":
    case "TIMEOUT": {
      const ms =
        Number.isFinite(result?.budgetMs) && result.budgetMs > 0
          ? `${result.budgetMs}ms`
          : `${DEFAULT_INSTALL_TIMEOUT_MS}ms`;
      if (!out.message) {
        out.message = `Install exceeded the time budget (${ms}).`;
      }
      out.hints = out.hints || [
        `Re-run /openloomi:setup --yes --install-timeout ${Math.max(DEFAULT_INSTALL_TIMEOUT_MS, 600_000)} to give the download more time.`,
        "If you are on a slow or metered connection, see https://openloomi.ai/docs/install/restricted-network.",
      ];
      break;
    }
    case "SPAWN_FAILED": {
      if (!out.message) {
        out.message =
          "Could not start the platform install helper. Make sure bash (macOS/Linux) or PowerShell (Windows) is on PATH.";
      }
      out.hints = out.hints || [
        "Verify that bash (macOS/Linux) or PowerShell (Windows) is on PATH.",
        "Re-run /openloomi:setup --yes from a regular terminal session.",
      ];
      break;
    }
    case "INSTALL_SCRIPT_MISSING": {
      if (!out.message) {
        out.message = "No install script shipped for this platform.";
      }
      out.hints = out.hints || [
        "Visit https://openloomi.ai/docs/install and follow the manual steps.",
        "Re-run /openloomi:setup from inside the plugin directory so the helper scripts are reachable.",
      ];
      break;
    }
    case "CANCELLED":
    case "NON_INTERACTIVE_REQUIRES_YES": {
      out.hints = out.hints || [
        "Re-run /openloomi:setup --yes to pre-approve the install in non-interactive shells.",
      ];
      break;
    }
    default: {
      // Generic EXIT_<n> / unknown code
      const numeric = String(code).replace(/^EXIT_/, "");
      if (!out.message) {
        out.message = `Install exited with code ${numeric}.`;
      }
      out.hints = out.hints || [
        "See the install helper's stderr output (printed above) for details.",
        "If you are behind a corporate proxy, see https://openloomi.ai/docs/install/restricted-network.",
        ...baseHints,
      ];
    }
  }
  return out;
}

// Build the actionable hints list for an API timeout. Order is deliberate:
// the most likely cause goes first so it survives any UI truncation.
// All entries are safe to print verbatim — no secrets, no installation
// paths the user shouldn't see.
function apiNotReadyHints({ stage, platformName, canResume }) {
  const hints = [];
  if (platformName === "macos" || /darwin/i.test(String(process.platform))) {
    hints.push(
      "If macOS is showing a permission prompt for OpenLoomi, approve it and run /openloomi:setup again.",
    );
  }
  hints.push("Run /openloomi:setup --max-wait 180000 to give it more time.");
  hints.push(
    "If you are offline or behind a corporate proxy, see https://openloomi.ai/docs/install/restricted-network.",
  );
  if (canResume) {
    hints.push(
      "Re-run /openloomi:setup to keep waiting — already-completed steps will be skipped.",
    );
  }
  return hints;
}

function detectPlatform() {
  const p = platform();
  if (p === "darwin") return "macos";
  if (p === "win32") return "windows";
  return "linux";
}

function envBool(v) {
  if (v == null) return false;
  const s = String(v).toLowerCase().trim();
  return s === "1" || s === "true" || s === "yes";
}

function normPath(p) {
  if (!p) return null;
  return p.endsWith("/") || p.endsWith("\\") ? p.replace(/[\\/]+$/, "") : p;
}

// ---------------------------------------------------------------------------
// Argv parsing (tiny, no deps)
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
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
    case "macos":
      return [
        // Standard macOS install (where Drag-to-Applications puts it).
        // We deliberately do NOT also look at ~/Applications — the user
        // installed OpenLoomi system-wide and we want a single source of
        // truth (/Applications) so the bridge never disagrees with the
        // desktop app about where the bundle lives.
        "/Applications/OpenLoomi.app/Contents/MacOS/openloomi",
      ];
    case "windows":
      return [
        join(
          process.env.LOCALAPPDATA || join(home, "AppData", "Local"),
          "OpenLoomi",
          "openloomi.exe",
        ),
      ];
    default:
      return [
        join(home, ".local", "bin", "openloomi"),
        "/opt/openloomi/openloomi",
        "/usr/local/bin/openloomi",
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
    case "macos":
      // System-wide /Applications only. We do NOT fall back to
      // ~/Applications — the bridge and the desktop app must agree on
      // a single install location.
      {
        const marker = "/Applications/OpenLoomi.app";
        if (existsSync(marker)) return { installed: true, marker };
      }
      return { installed: false, marker: null };
    case "windows": {
      const roots = [
        process.env.LOCALAPPDATA || join(home, "AppData", "Local"),
        process.env.PROGRAMFILES || "C:\\Program Files",
      ];
      for (const root of roots) {
        for (const marker of [
          join(root, "OpenLoomi"),
          join(root, "OpenLoomi", "OpenLoomi.exe"),
        ]) {
          if (existsSync(marker)) return { installed: true, marker };
        }
      }
      return { installed: false, marker: null };
    }
    default:
      for (const marker of [
        "/opt/openloomi",
        join(home, ".local", "share", "openloomi"),
        join(home, ".local", "share", "applications", "openloomi.desktop"),
      ]) {
        if (existsSync(marker)) return { installed: true, marker };
      }
      return { installed: false, marker: null };
  }
}

function expandHome(p) {
  if (!p) return p;
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  if (p.startsWith("~\\")) return homedir() + p.slice(2);
  return p;
}

function lookupOnPath(name, pathEnv = process.env.PATH || "") {
  const exts =
    detectPlatform() === "windows" ? [".exe", ".cmd", ".bat", ""] : [""];
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
  const exe = detectPlatform() === "windows" ? "openloomi.exe" : "openloomi";
  const candidates = [
    join(root, exe),
    join(root, "Contents", "MacOS", exe), // macOS bundle
    join(root, "bin", exe), // Linux packaging
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
  const exe = detectPlatform() === "windows" ? "openloomi.exe" : "openloomi";
  const candidates = [
    join(root, "apps", "web", "src-tauri", "target", "release", exe),
  ];
  for (const c of candidates) {
    if (isExecutable(c)) return c;
  }
  return null;
}

// Given a binary path, returns the parent .app bundle if the binary lives
// inside one (e.g. /Applications/OpenLoomi.app/Contents/MacOS/openloomi
// → /Applications/OpenLoomi.app). Returns null otherwise. Used so callers
// have a stable bundle path for `open -a` regardless of how discovery
// resolved the inner binary.
function desktopBundleForBin(binPath) {
  if (!binPath) return null;
  // Walk up from Contents/MacOS/<exe> to Contents to <App>.app.
  const macos = dirname(binPath); // Contents/MacOS
  const contents = dirname(macos); // Contents
  const bundle = dirname(contents); // <App>.app
  if (!bundle || bundle === "." || bundle === contents) return null;
  if (!bundle.endsWith(".app")) return null;
  // Sanity check: Info.plist must exist for this to be a real bundle.
  if (!existsSync(join(bundle, "Contents", "Info.plist"))) return null;
  return bundle;
}

function discovery({ explicit = null } = {}) {
  // Step 1: OPENLOOMI_BIN
  if (process.env.OPENLOOMI_BIN && isExecutable(process.env.OPENLOOMI_BIN)) {
    return {
      binPath: normPath(process.env.OPENLOOMI_BIN),
      mode: "env",
      source: "OPENLOOMI_BIN",
    };
  }
  // Step 2: OPENLOOMI_HOME / OPENLOOMI_INSTALL_DIR
  for (const k of ["OPENLOOMI_HOME", "OPENLOOMI_INSTALL_DIR"]) {
    const v = expandHome(process.env[k]);
    const hit = searchInstallRoot(v);
    if (hit) return { binPath: normPath(hit), mode: "packaged", source: k };
  }
  // Step 3: OPENLOOMI_REPO_DIR
  if (process.env.OPENLOOMI_REPO_DIR) {
    const repoHit = searchRepoLayout(
      expandHome(process.env.OPENLOOMI_REPO_DIR),
    );
    if (repoHit) {
      return {
        binPath: normPath(repoHit),
        mode: "source",
        source: "OPENLOOMI_REPO_DIR",
      };
    }
    // Source dir is set but the main binary isn't built yet — return a hint.
    const exe = detectPlatform() === "windows" ? "openloomi.exe" : "openloomi";
    return {
      binPath: null,
      mode: "source",
      source: "OPENLOOMI_REPO_DIR",
      hint: {
        repoDir: expandHome(process.env.OPENLOOMI_REPO_DIR),
        needed: join("apps", "web", "src-tauri", "target", "release", exe),
      },
    };
  }
  // Step 4: PATH lookup for the main `openloomi` binary
  const onPath = lookupOnPath(
    detectPlatform() === "windows" ? "openloomi.exe" : "openloomi",
  );
  if (onPath) {
    return { binPath: normPath(onPath), mode: "packaged", source: "PATH" };
  }
  // Step 5: Platform default packaged install paths
  for (const def of packageDefaults()) {
    if (isExecutable(def)) {
      // When the resolved binary lives inside a macOS .app bundle, surface
      // the bundle path as desktopMarker so callers can `open -a` it
      // without re-deriving the path.
      const desktopMarker = desktopBundleForBin(def);
      return {
        binPath: normPath(def),
        mode: "packaged",
        source: "platform-default",
        desktopInstalled: !!desktopMarker,
        desktopMarker,
      };
    }
  }
  // Step 6: Saved plugin config
  const saved = readSavedBinPath();
  if (saved) {
    return {
      binPath: normPath(saved),
      mode: "packaged",
      source: "saved-config",
    };
  }
  // Step 7: User-provided --bin-path
  if (explicit && isExecutable(explicit)) {
    return { binPath: normPath(explicit), mode: "packaged", source: "flag" };
  }
  // Step 8: No main `openloomi` binary found via the explicit paths above.
  // Still detect whether the OpenLoomi desktop app itself is present. If it
  // is, try to derive the binary path from the install marker — many users
  // have `OpenLoomi.app` in /Applications but the inner main binary lives
  // under Contents/MacOS and isn't always on PATH.
  const desktop = detectDesktopInstalled();
  if (desktop.installed) {
    const exe = detectPlatform() === "windows" ? "openloomi.exe" : "openloomi";
    const candidate = join(desktop.marker, "Contents", "MacOS", exe);
    const winCandidate = join(desktop.marker, exe);
    const bin = isExecutable(candidate)
      ? candidate
      : isExecutable(winCandidate)
        ? winCandidate
        : null;
    if (bin) {
      return {
        binPath: normPath(bin),
        mode: "packaged",
        source: "desktop-marker",
        desktopInstalled: true,
        desktopMarker: desktop.marker,
      };
    }
    return {
      binPath: null,
      mode: "packaged",
      source: "desktop-only",
      desktopInstalled: true,
      desktopMarker: desktop.marker,
    };
  }
  return {
    binPath: null,
    mode: "unconfigured",
    source: null,
    desktopInstalled: false,
    desktopMarker: null,
  };
}

async function runBin(
  binPath,
  args,
  { stdin = null, timeoutMs = 120_000, env = process.env, shell = false } = {},
) {
  return await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let resolved = false;
    const child = spawn(binPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
      shell,
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          child.kill("SIGKILL");
        } catch {
          /* noop */
        }
        resolve({
          ok: false,
          error: {
            code: "timeout",
            message: `helper timed out after ${timeoutMs}ms`,
          },
        });
      }
    }, timeoutMs);
    child.stdout.on("data", (b) => (stdout += b.toString("utf8")));
    child.stderr.on("data", (b) => (stderr += b.toString("utf8")));
    child.on("error", (e) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        error: { code: "spawn_failed", message: String(e?.message || e) },
        stderr,
      });
    });
    child.on("exit", (code, signal) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true, stdout, stderr });
      } else {
        resolve({
          ok: false,
          error: { code: `exit_${code ?? signal ?? "unknown"}` },
          stdout,
          stderr,
        });
      }
    });
    if (stdin != null) {
      try {
        child.stdin.end(stdin);
      } catch {
        /* noop */
      }
    } else {
      try {
        child.stdin.end();
      } catch {
        /* noop */
      }
    }
  });
}

function getClaudeCliProbePath() {
  const home = homedir();
  const dirs = [process.env.PATH || ""];

  if (detectPlatform() === "windows") {
    dirs.push(
      join(home, "AppData", "Roaming", "npm"),
      join(home, "AppData", "Local", "Programs", "nodejs"),
      join(home, ".volta", "bin"),
      "C:\\Program Files\\nodejs",
      "C:\\Program Files (x86)\\nodejs",
    );
  } else {
    dirs.push(
      "/usr/local/bin",
      "/opt/homebrew/bin",
      join(home, ".local", "bin"),
      join(home, ".npm-global", "bin"),
      join(home, ".volta", "bin"),
      join(home, "code", "node", "npm_global", "bin"),
    );
  }

  return Array.from(new Set(dirs.filter(Boolean))).join(delimiter);
}

function resolveClaudeCliPath() {
  const explicit = expandHome(process.env.CLAUDE_CODE_PATH);
  if (explicit) {
    if (isExecutable(explicit)) {
      return {
        path: normPath(explicit),
        source: "CLAUDE_CODE_PATH",
        reason: "CLAUDE_CLI_FOUND",
      };
    }
    return {
      path: null,
      source: "CLAUDE_CODE_PATH",
      reason: "CLAUDE_CODE_PATH_INVALID",
    };
  }

  const pathEnv = getClaudeCliProbePath();
  const found = lookupOnPath("claude", pathEnv);
  if (found) {
    return {
      path: normPath(found),
      source: "PATH",
      reason: "CLAUDE_CLI_FOUND",
    };
  }

  return {
    path: null,
    source: null,
    reason: "CLAUDE_CLI_UNAVAILABLE",
  };
}

async function runClaudeCli(
  claudePath,
  args,
  { timeoutMs = CLAUDE_CLI_PROBE_TIMEOUT_MS } = {},
) {
  if (detectPlatform() === "windows" && /\.ps1$/i.test(claudePath)) {
    return await runBin(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        claudePath,
        ...args,
      ],
      {
        timeoutMs,
        env: { ...process.env, PATH: getClaudeCliProbePath() },
      },
    );
  }

  const shell =
    detectPlatform() === "windows" && /\.(cmd|bat)$/i.test(claudePath);
  return await runBin(claudePath, args, {
    timeoutMs,
    shell,
    env: { ...process.env, PATH: getClaudeCliProbePath() },
  });
}

function summarizeCliProbeResult(result) {
  return {
    ok: !!result?.ok,
    code: result?.error?.code || null,
    stdoutPresent: !!result?.stdout,
    stderrPresent: !!result?.stderr,
  };
}

function classifyClaudeAuthFailure(result) {
  if (result?.error?.code === "timeout")
    return "CLAUDE_CLI_AUTH_STATUS_TIMEOUT";

  const output =
    `${result?.stdout || ""}\n${result?.stderr || ""}`.toLowerCase();
  if (
    output.includes("not authenticated") ||
    output.includes("not logged") ||
    output.includes("not signed") ||
    output.includes("please login") ||
    output.includes("please log in") ||
    output.includes("sign in") ||
    output.includes("/login")
  ) {
    return "CLAUDE_CLI_AUTH_REQUIRED";
  }

  if (
    output.includes("unknown command") ||
    output.includes("invalid command")
  ) {
    return "CLAUDE_CLI_AUTH_STATUS_UNAVAILABLE";
  }

  // `claude auth status` is a status command; a non-zero exit usually means
  // there is no usable local Claude Code authentication.
  return "CLAUDE_CLI_AUTH_REQUIRED";
}

async function probeClaudeNativeRuntime(aiProvider) {
  const defaultAgent =
    typeof aiProvider?.defaultAgent === "string"
      ? aiProvider.defaultAgent
      : null;
  const active = defaultAgent === CLAUDE_NATIVE_PROVIDER;

  if (!active) {
    return {
      checked: false,
      available: false,
      authenticated: false,
      active: false,
      ready: false,
      reason: defaultAgent
        ? "CLAUDE_RUNTIME_INACTIVE"
        : "DEFAULT_AGENT_UNAVAILABLE",
      defaultAgent,
      cliPathPresent: false,
      cliPathSource: null,
      versionPresent: false,
      probes: {},
    };
  }

  const resolved = resolveClaudeCliPath();
  if (!resolved.path) {
    return {
      checked: true,
      available: false,
      authenticated: false,
      active: true,
      ready: false,
      reason: resolved.reason,
      defaultAgent,
      cliPathPresent: false,
      cliPathSource: resolved.source,
      versionPresent: false,
      probes: {},
      nextAction:
        resolved.reason === "CLAUDE_CODE_PATH_INVALID"
          ? "inspect_claude_cli"
          : "install_claude_cli",
    };
  }

  const versionProbe = await runClaudeCli(resolved.path, ["--version"]);
  if (!versionProbe.ok) {
    return {
      checked: true,
      available: false,
      authenticated: false,
      active: true,
      ready: false,
      reason:
        versionProbe?.error?.code === "timeout"
          ? "CLAUDE_CLI_VERSION_TIMEOUT"
          : "CLAUDE_CLI_VERSION_FAILED",
      defaultAgent,
      cliPathPresent: true,
      cliPathSource: resolved.source,
      versionPresent: false,
      probes: {
        version: summarizeCliProbeResult(versionProbe),
      },
      nextAction: "inspect_claude_cli",
    };
  }

  const authProbe = await runClaudeCli(resolved.path, [
    "auth",
    "status",
    "--json",
  ]);
  if (authProbe.ok) {
    return {
      checked: true,
      available: true,
      authenticated: true,
      active: true,
      ready: true,
      reason: "CLAUDE_CLI_AUTHENTICATED",
      defaultAgent,
      cliPathPresent: true,
      cliPathSource: resolved.source,
      versionPresent: !!(versionProbe.stdout || "").trim(),
      probes: {
        version: summarizeCliProbeResult(versionProbe),
        auth: summarizeCliProbeResult(authProbe),
      },
      nextAction: "run",
    };
  }

  const reason = classifyClaudeAuthFailure(authProbe);
  return {
    checked: true,
    available: true,
    authenticated: false,
    active: true,
    ready: false,
    reason,
    defaultAgent,
    cliPathPresent: true,
    cliPathSource: resolved.source,
    versionPresent: !!(versionProbe.stdout || "").trim(),
    probes: {
      version: summarizeCliProbeResult(versionProbe),
      auth: summarizeCliProbeResult(authProbe),
    },
    nextAction:
      reason === "CLAUDE_CLI_AUTH_REQUIRED"
        ? "login_claude_cli"
        : "inspect_claude_cli",
  };
}

function getExecutionProviderStatus(aiProvider, nativeRuntime) {
  // `source` is the user-facing label for *how* the runtime is reaching
  // an LLM. The HTTP probe (`aiProvider`) reports `configured: true`
  // when EITHER a user-saved `anthropic_compatible` row OR the runtime's
  // own nativeRuntime probe says "ready" — they're conflated in that
  // field. We disambiguate using `directApi.userConfigured` (the
  // per-user row flag carried alongside `configured`) so the label
  // reflects the actual mechanism the user set up:
  //   - "ai_provider" → the user explicitly saved an
  //     `anthropic_compatible` row with a key
  //   - "native_claude_runtime" → the user authenticated the host's
  //     `claude` CLI (no direct API key)
  if (aiProvider?.configured) {
    return {
      ready: true,
      source: aiProvider.directApi?.userConfigured
        ? "ai_provider"
        : "native_claude_runtime",
    };
  }

  if (nativeRuntime?.ready) {
    return {
      ready: true,
      source: "native_claude_runtime",
    };
  }

  return {
    ready: false,
    source: null,
  };
}

function providerStatusFields(aiProvider, nativeRuntime) {
  const executionProvider = getExecutionProviderStatus(
    aiProvider,
    nativeRuntime,
  );
  // `aiProviderConfigured` is the public "can the runtime talk to an LLM
  // right now" signal. It's an OR of two sources:
  //   1. `aiProvider.configured` — derived from the runtime's
  //      `/api/preferences/ai` payload (per-user `anthropic_compatible`
  //      row + nativeRuntime.authenticated as the runtime reports it).
  //      This path can 401 for the bridge because the route requires a
  //      NextAuth cookie, not the Bearer token the bridge sends.
  //   2. `nativeRuntime.authenticated` — the bridge's own local
  //      `claude auth status` probe via `probeClaudeNativeRuntime()`.
  //      This always reflects the host's real CLI state, regardless
  //      of the HTTP path's auth outcome.
  // We OR them so the documented semantics hold:
  // "`aiProviderConfigured` is derived from the runtime's `nativeRuntime`
  // probe, with user-saved `anthropic_compatible` rows as a fallback"
  // (see apps/marketing/content/plugins/claude.mdx).
  return {
    aiProviderConfigured: !!(
      aiProvider?.configured || nativeRuntime?.authenticated
    ),
    aiProviderStatus:
      aiProvider?.status ||
      (aiProvider?.ok ? "unknown" : aiProvider?.reason || "unknown"),
    executionProviderReady: executionProvider.ready,
    executionProviderSource: executionProvider.source,
    nativeRuntimeActive: !!nativeRuntime?.active,
    nativeRuntimeProvider: nativeRuntime?.defaultAgent || null,
    nativeRuntimeStatus: nativeRuntime?.reason || null,
    nativeRuntime: {
      checked: !!nativeRuntime?.checked,
      available: !!nativeRuntime?.available,
      authenticated: !!nativeRuntime?.authenticated,
      active: !!nativeRuntime?.active,
      ready: !!nativeRuntime?.ready,
      reason: nativeRuntime?.reason || null,
      defaultAgent: nativeRuntime?.defaultAgent || null,
      cliPathPresent: !!nativeRuntime?.cliPathPresent,
      cliPathSource: nativeRuntime?.cliPathSource || null,
      versionPresent: !!nativeRuntime?.versionPresent,
      probes: nativeRuntime?.probes || {},
    },
  };
}

// ---------------------------------------------------------------------------
// Auth (presence-only)
// ---------------------------------------------------------------------------

function readOpenloomiTokenPath() {
  const p = join(homedir(), ".openloomi", "token");
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
  if (typeof token !== "string" || !token.trim()) {
    return { ok: false, code: "EMPTY_TOKEN" };
  }
  const p = join(homedir(), ".openloomi", "token");
  try {
    const dir = dirname(p);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const encoded = Buffer.from(token, "utf8").toString("base64");
    writeFileSync(p, encoded, { mode: 0o600 });
    // Belt-and-braces: chmod after the fact too, since some platforms
    // ignore the mode arg on writeFileSync (e.g. when the file already
    // exists with looser perms).
    try {
      chmodSync(p, 0o600);
    } catch {
      /* noop on platforms without chmod */
    }
    return { ok: true, path: p };
  } catch (e) {
    return { ok: false, code: "WRITE_FAILED", error: String(e?.message || e) };
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
    const raw = readFileSync(p, "utf8").trim();
    if (!raw) return null;
    // Strict path: token files are always base64(STANDARD). If decode
    // fails, fall back to the raw text — covers any hand-rolled token
    // file a power user might have dropped in before this fix.
    try {
      const decoded = Buffer.from(raw, "base64").toString("utf8").trim();
      // A successful decode of a JWT payload.sig yields the two segments
      // joined with a `.`; if we don't see that, the file was probably
      // not base64-encoded and the raw text is the actual token.
      if (decoded && decoded.includes(".")) return decoded;
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
  if (process.env.OPENLOOMI_BASE_URL)
    return process.env.OPENLOOMI_BASE_URL.replace(/\/+$/, "");
  return `http://127.0.0.1:${_resolvedPort}`;
}

// Probes the default then fallback port for any HTTP response from
// /api/remote-auth/user, caches whichever port answered for the
// lifetime of the process, and returns the resolved base URL. Returns
// null if neither port responds.
async function probeOpenLoomiBaseUrl() {
  for (const port of [OPENLOOMI_PORT_DEFAULT, OPENLOOMI_PORT_FALLBACK]) {
    const url = `http://127.0.0.1:${port}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    try {
      // 1.5 s per-attempt budget; probe runs once per port (no retry) so a
      // desktop app still booting doesn't burn the whole 5 s budget on the
      // first port before falling through to the fallback.
      const res = await fetchWithRetry(
        `${url}/api/remote-auth/user`,
        { method: "GET", signal: ctrl.signal },
        { timeoutMs: 1500, retries: 0 },
      );
      if (res.status > 0) {
        _resolvedPort = port;
        return url;
      }
    } catch {
      // connection refused / timeout — try the next port
    } finally {
      clearTimeout(t);
    }
  }
  return null;
}

async function apiGET(path, { timeoutMs = 5000 } = {}) {
  const bearer = loadBearerToken();
  const headers = { Accept: "application/json" };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  try {
    const res = await fetchWithRetry(
      openloomiBaseUrl() + path,
      { method: "GET", headers },
      { timeoutMs },
    );
    const text = await res.text().catch(() => "");
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: { code: "network", message: String(e?.message || e) },
    };
  }
}

async function apiPOST(path, body, { timeoutMs = 10_000 } = {}) {
  const bearer = loadBearerToken();
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  try {
    const res = await fetchWithRetry(
      openloomiBaseUrl() + path,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
      { timeoutMs },
    );
    const text = await res.text().catch(() => "");
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: { code: "network", message: String(e?.message || e) },
    };
  }
}

async function apiPUT(path, body, { timeoutMs = 10_000 } = {}) {
  // Same contract as apiPOST — Bearer + JSON. Used for the per-user
  // /api/preferences/ai upsert, which is the runtime's source of truth
  // for AI provider config (see apps/web/app/(chat)/api/preferences/ai/route.ts).
  const bearer = loadBearerToken();
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  try {
    const res = await fetchWithRetry(
      openloomiBaseUrl() + path,
      {
        method: "PUT",
        headers,
        body: JSON.stringify(body),
      },
      { timeoutMs },
    );
    const text = await res.text().catch(() => "");
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: { code: "network", message: String(e?.message || e) },
    };
  }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

// Module-level cache of the last install script's structured stdout line.
// The install scripts print a single JSON object describing what they
// installed (version / tag / assetUrl / binPath). We keep it here so
// `buildStatus` can surface the resolved version without re-curl'ing the
// GitHub API and without calling --version on the inner Tauri binary
// (which flashes a GUI window).
let _installInfo = null;
function getInstallInfo() {
  return _installInfo;
}
function setInstallInfo(info) {
  _installInfo = info;
}

// Reads CFBundleShortVersionString from an .app bundle's Info.plist.
// We deliberately avoid calling --version on the main Tauri binary
// because it launches the GUI. Info.plist is the canonical, side-
// effect-free source for the version of a packaged macOS app.
// Uses `plutil -p` on macOS (always present) and falls back to a
// minimal binary plist scan if plutil isn't available.
async function readBundleVersion(appPath) {
  if (!appPath) return null;
  const platformName = detectPlatform();
  if (platformName !== "macos") return null;
  const infoPlist = join(appPath, "Contents", "Info.plist");
  if (!existsSync(infoPlist)) return null;
  // Try plutil first — it prints a stable `key: "value"` text format.
  const r = await runBin("plutil", ["-p", infoPlist], { timeoutMs: 3000 });
  if (r.ok && r.stdout) {
    // plutil output is like:  "CFBundleShortVersionString" => "0.8.6"
    // or (older):            CFBundleShortVersionString = "0.8.6"
    const m = r.stdout.match(
      /["']?CFBundleShortVersionString["']?\s*(?:=>|=)\s*["']([^"']+)["']/,
    );
    if (m) return m[1].trim();
  }
  // Binary plist fallback: scan for the ASCII run "CFBundleShortVersionString"
  // followed shortly by a UTF-16 string token. This is best-effort; on real
  // installs plutil will always succeed.
  try {
    const raw = readFileSync(infoPlist);
    const ascii = raw.toString("binary");
    const idx = ascii.indexOf("CFBundleShortVersionString");
    if (idx >= 0) {
      // After the key, look for a UTF-16BE string value. Format in binary
      // plist: ...<len-byte><UTF-16BE bytes>. We just grab the next chunk
      // of printable UTF-16.
      const slice = ascii.slice(idx, idx + 256);
      const m2 = slice.match(/[A-Za-z0-9.\-+]+\x00/);
      if (m2) return m2[0].replace(/\x00+$/g, "").trim();
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

async function readBinVersion(binPath) {
  if (!binPath) return null;
  // The OpenLoomi main `openloomi` binary launches the GUI app on any CLI
  // invocation, so calling --version would flash a window. For that case,
  // we resolve the version from the .app bundle's Info.plist instead.
  const base = basename(binPath).toLowerCase();
  const isMainTauriBinary = base === "openloomi" || base === "openloomi.exe";
  if (isMainTauriBinary) {
    // Walk up from .../<App>.app/Contents/MacOS/openloomi to .../<App>.app
    const parent = dirname(binPath); // Contents/MacOS
    const grand = dirname(parent); // Contents
    const great = dirname(grand); // <App>.app
    return await readBundleVersion(great);
  }
  // For non-main binaries (e.g. an OPENLOOMI_BIN pointing at a CLI helper),
  // --version is safe and doesn't flash a GUI.
  const r = await runBin(binPath, ["--version"], { timeoutMs: 5000 });
  if (!r.ok) return null;
  // Match a semver-ish version (e.g. "0.8.6", "1.2.3-rc.1") anywhere in
  // the --version output. Real binaries print "<name> 0.8.6"; tests
  // just print "9.9.9" — both should parse.
  const m = (r.stdout || "").match(/(\d+\.\d+\.\d+(?:[-+][\w.\-]+)?)/);
  return m ? m[1].trim() : (r.stdout || "").trim();
}

async function probeAiProvider() {
  // The runtime exposes per-user AI settings and the native Claude CLI
  // probe at /api/preferences/ai (apps/web/app/(chat)/api/preferences/ai/
  // route.ts). A provider is "configured" when EITHER:
  //   - the runtime reports the user's local `claude` CLI as authenticated
  //     (`nativeRuntime.authenticated`), so the runtime can talk to Claude
  //     without any per-user key, OR
  //   - the user has saved an explicit `anthropic_compatible` row with a key.
  // We never read the AI provider env vars the runtime may have inherited;
  // the runtime's own `nativeRuntime` probe is the source of truth.
  const r = await apiGET("/api/preferences/ai", { timeoutMs: 3000 });
  if (r.ok && r.json) {
    const native = r.json?.nativeRuntime;
    const fromNative = !!(native && native.authenticated);
    const defaultAgent =
      typeof r.json?.defaultAgent === "string" ? r.json.defaultAgent : null;
    const fromUser =
      Array.isArray(r.json?.settings) &&
      r.json.settings.some(
        (s) =>
          s?.providerType === "anthropic_compatible" &&
          s?.enabled !== false &&
          s?.hasApiKey,
      );
    const configured = fromNative || fromUser;
    return {
      ok: true,
      configured,
      status: configured ? "direct_api_configured" : "direct_api_missing",
      defaultAgent,
      directApi: {
        nativeRuntimeAuthenticated: fromNative,
        userConfigured: fromUser,
      },
    };
  }
  if (r.status === 401 || r.status === 403) {
    return {
      ok: true,
      configured: false,
      status: "auth_required",
      reason: "auth_required",
      defaultAgent: null,
    };
  }
  return {
    ok: false,
    configured: false,
    status: "runtime_status_unavailable",
    reason: r.error?.code || "unknown",
    defaultAgent: null,
  };
}

async function probeApiReachable() {
  // Tries the default port (3414) first, then the documented fallback
  // (3515). Any HTTP response — including 401 — counts as "reachable";
  // only network errors / timeouts mean the runtime is not running.
  return (await probeOpenLoomiBaseUrl()) !== null;
}

async function buildStatus({ json = true, explicit = null } = {}) {
  // AI provider readiness is the runtime's job — the bridge never reads
  // AI provider env vars. The runtime's `/api/preferences/ai` endpoint
  // surfaces `nativeRuntime` (Claude CLI auth probe) and
  // `aiProviderConfigured`, and those are the only signals we trust.
  const disc = discovery({ explicit });

  // Source checkout detected but CLI not yet built: report that BEFORE
  // the generic "!binPath → OPENLOOMI_NOT_INSTALLED" branch.
  if (disc.mode === "source" && disc.hint) {
    return {
      mode: "source",
      installed: false,
      binPath: null,
      version: null,
      tokenPresent: tokenPresent(),
      aiProviderConfigured: false,
      apiReachable: false,
      hooksInstalled: detectHooksInstalled(),
      ready: false,
      nextAction: "build_or_stage_openloomi",
      reason: "SOURCE_FOUND_CLI_NOT_BUILT",
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
        apiReachable,
        canGuestLogin: apiReachable,
        hooksInstalled: detectHooksInstalled(),
        ready: false,
        nextAction: "launch_openloomi_to_finalize",
        reason: "OPENLOOMI_NOT_FINALIZED",
        source: disc.source,
        desktopMarker: disc.desktopMarker,
        hint: {
          message:
            "OpenLoomi is installed but the local helper is not yet laid down. Launch the OpenLoomi desktop app once so it can finalize the install, then re-run /openloomi:setup.",
          actions: {
            macos:
              'open -a "' +
              (disc.desktopMarker || "/Applications/OpenLoomi.app") +
              '"',
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
      apiReachable: false,
      canGuestLogin: false,
      hooksInstalled: detectHooksInstalled(),
      ready: false,
      nextAction: "install_openloomi",
      reason: "OPENLOOMI_NOT_INSTALLED",
      source: disc.source,
      hint: disc.hint || null,
    };
  }

  const version = await readBinVersion(disc.binPath);
  // Fall back to the version reported by the install script. We don't
  // want to call --version on the main Tauri binary (it flashes a GUI
  // window) and Info.plist is sometimes stripped from dev builds, so the
  // install-time tag is the most reliable source when both are missing.
  const resolvedVersion = version || getInstallInfo()?.version || null;

  const aiProvider = await probeAiProvider();
  const nativeRuntime = await probeClaudeNativeRuntime(aiProvider);
  const providerFields = providerStatusFields(aiProvider, nativeRuntime);
  const apiReachable = await probeApiReachable();

  if (!tokenPresent()) {
    return {
      mode: disc.mode,
      installed: true,
      binPath: disc.binPath,
      version: resolvedVersion,
      tokenPresent: false,
      ...providerFields,
      apiReachable,
      canGuestLogin: apiReachable,
      hooksInstalled: detectHooksInstalled(),
      ready: false,
      nextAction: "login_openloomi",
      reason: "LOGIN_REQUIRED",
      source: disc.source,
      desktopMarker: disc.desktopMarker,
    };
  }

  if (!aiProvider.configured && nativeRuntime.ready) {
    return {
      mode: disc.mode,
      installed: true,
      binPath: disc.binPath,
      version: resolvedVersion,
      tokenPresent: true,
      ...providerFields,
      apiReachable,
      canGuestLogin: apiReachable,
      hooksInstalled: detectHooksInstalled(),
      ready: true,
      nextAction: "run",
      reason: "READY",
      readinessSource: "native_claude_runtime",
      message:
        "OpenLoomi is ready through the authenticated native Claude Code runtime. A separate Anthropic-compatible API key is not required for native Claude execution.",
      source: disc.source,
      desktopMarker: disc.desktopMarker,
    };
  }

  if (
    !aiProvider.configured &&
    nativeRuntime.active &&
    nativeRuntime.checked &&
    !nativeRuntime.ready
  ) {
    return {
      mode: disc.mode,
      installed: true,
      binPath: disc.binPath,
      version: resolvedVersion,
      tokenPresent: true,
      ...providerFields,
      apiReachable,
      canGuestLogin: apiReachable,
      hooksInstalled: detectHooksInstalled(),
      ready: false,
      nextAction: nativeRuntime.nextAction || "inspect_claude_cli",
      reason: nativeRuntime.reason,
      message:
        nativeRuntime.reason === "CLAUDE_CLI_AUTH_REQUIRED"
          ? "The native Claude runtime is selected, but Claude Code CLI is not authenticated. Run `claude auth login` or configure a direct Anthropic-compatible provider."
          : "The native Claude runtime is selected, but Claude Code CLI readiness could not be confirmed. Install or repair Claude Code CLI, or configure a direct Anthropic-compatible provider.",
      source: disc.source,
      desktopMarker: disc.desktopMarker,
    };
  }

  if (!aiProvider.configured) {
    return {
      mode: disc.mode,
      installed: true,
      binPath: disc.binPath,
      version: resolvedVersion,
      tokenPresent: true,
      ...providerFields,
      apiReachable,
      canGuestLogin: apiReachable,
      hooksInstalled: detectHooksInstalled(),
      ready: false,
      nextAction: "configure_ai_provider",
      reason: "AI_PROVIDER_REQUIRED",
      source: disc.source,
      desktopMarker: disc.desktopMarker,
    };
  }

  return {
    mode: disc.mode,
    installed: true,
    binPath: disc.binPath,
    version: resolvedVersion,
    tokenPresent: true,
    ...providerFields,
    apiReachable,
    canGuestLogin: apiReachable,
    hooksInstalled: detectHooksInstalled(),
    ready: true,
    nextAction: "run",
    reason: "READY",
    source: disc.source,
    desktopMarker: disc.desktopMarker,
  };
}

// ---------------------------------------------------------------------------
// Hooks install/uninstall (settings merge)
// ---------------------------------------------------------------------------

function settingsPath() {
  return join(homedir(), ".claude", "settings.json");
}

function readSettings() {
  const p = settingsPath();
  if (!existsSync(p)) return { raw: "{}", json: {}, path: p };
  try {
    const raw = readFileSync(p, "utf8");
    const json = JSON.parse(raw);
    return { raw, json, path: p };
  } catch {
    return { raw: "{}", json: {}, path: p };
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
    const raw = readFileSync(HOOKS_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return { hooks: {} };
  }
}

// Resolve `${CLAUDE_PLUGIN_ROOT}` placeholders in a hook command to the
// plugin's absolute path. Claude Code only injects this env var when hooks
// are loaded directly from a plugin manifest; when we install them into
// user-level `~/.claude/settings.json` we have to substitute ourselves or
// the placeholder expands to empty and Node tries to resolve
// `/scripts/loomi-bridge.mjs` from the filesystem root.
function substitutePluginRoot(command) {
  if (
    typeof command !== "string" ||
    !command.includes("${CLAUDE_PLUGIN_ROOT}")
  ) {
    return command;
  }
  // Wrap the substituted path in double quotes so paths with spaces parse
  // correctly under the shell. The original template has the placeholder
  // unquoted (e.g. `node ${CLAUDE_PLUGIN_ROOT}/scripts/...`), so quote just
  // the path component by replacing the placeholder with `"<pluginDir>"`.
  const quoted = `"${PLUGIN_DIR}"`;
  return command.split("${CLAUDE_PLUGIN_ROOT}").join(quoted);
}

function materializeHookEntry(entry) {
  // Deep-clone so we don't mutate the shared template, then rewrite each
  // inner command's placeholder to an absolute path.
  const cloned = JSON.parse(JSON.stringify(entry));
  if (cloned && Array.isArray(cloned.hooks)) {
    cloned.hooks = cloned.hooks.map((h) => {
      if (h && typeof h.command === "string") {
        return { ...h, command: substitutePluginRoot(h.command) };
      }
      return h;
    });
  }
  return cloned;
}

function detectHooksInstalled() {
  const s = readSettings();
  if (!s.json || typeof s.json !== "object") return false;
  const hooks = s.json.hooks || {};
  // Legacy nested block from older broken versions.
  if (hooks[PLUGIN_BLOCK_KEY]) return true;
  // Current schema: per-event arrays with _openloomi_plugin marker.
  for (const event of Object.keys(hooks)) {
    if (event === PLUGIN_BLOCK_KEY) continue;
    const arr = hooks[event];
    if (!Array.isArray(arr)) continue;
    for (const entry of arr) {
      if (entry?.[MARKER]) return true;
      if (entry?.hooks) {
        for (const h of entry.hooks) {
          if (
            h &&
            typeof h.command === "string" &&
            h.command.includes("loomi-bridge.mjs")
          )
            return true;
        }
      }
    }
  }
  return false;
}

function installHooks({ yes = false } = {}) {
  const settings = readSettings();
  const j = settings.json || {};
  if (!j.hooks || typeof j.hooks !== "object") j.hooks = {};

  // Legacy cleanup: drop the old nested block from previous broken versions.
  // Safe to run unconditionally — if absent, this is a no-op.
  if (j.hooks[PLUGIN_BLOCK_KEY]) {
    delete j.hooks[PLUGIN_BLOCK_KEY];
  }

  const template = loadHooksTemplate();
  const templateHooks = template?.hooks || {};
  if (Object.keys(templateHooks).length === 0) {
    return {
      ok: false,
      error: "No hooks loaded from template",
      path: settings.path,
    };
  }

  // Merge per-event into settings.hooks (Claude Code's actual schema is
  // `{ EventName: [matcher-group, ...] }`). Each entry we add carries the
  // `_openloomi_plugin: true` marker so uninstallHooks can strip just our
  // entries without touching other plugins.
  let added = 0;
  let already = 0;
  for (const [event, rawEntries] of Object.entries(templateHooks)) {
    const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
    if (!Array.isArray(j.hooks[event])) j.hooks[event] = [];
    for (const entry of entries) {
      // Compare against the post-substitution command so dedup still
      // works after the placeholder has been rewritten to the absolute
      // plugin path (otherwise the second run would see a fresh-looking
      // template string and append a duplicate entry).
      const cmd0 = substitutePluginRoot(entry?.hooks?.[0]?.command || "");
      const isDup = j.hooks[event].some(
        (e) =>
          e && e[MARKER] === true && e.hooks?.some((h) => h?.command === cmd0),
      );
      if (isDup) {
        already++;
        continue;
      }
      j.hooks[event].push({ ...materializeHookEntry(entry), [MARKER]: true });
      added++;
    }
  }

  const summary = {
    events: Object.keys(templateHooks),
    added,
    alreadyInstalled: already,
    note: "Per-event merge into settings.hooks (Claude Code schema-compliant). Other plugins untouched.",
  };

  atomicWriteJson(settings.path, j);
  return {
    ok: true,
    alreadyInstalled: added === 0,
    path: settings.path,
    summary,
  };
}

function uninstallHooks() {
  const settings = readSettings();
  const j = settings.json || {};
  let removed = false;
  if (!j.hooks || typeof j.hooks !== "object") {
    atomicWriteJson(settings.path, j);
    return { ok: true, removed, path: settings.path };
  }

  // Always strip the legacy nested block from older broken versions, even
  // if per-event marker entries also exist.
  if (j.hooks[PLUGIN_BLOCK_KEY]) {
    delete j.hooks[PLUGIN_BLOCK_KEY];
    removed = true;
  }

  // Strip per-event marker entries (current schema) and any inner
  // loomi-bridge.mjs commands from mixed entries — defensive against any
  // future tool that merges our marker-bearing entry into someone else's.
  for (const event of Object.keys(j.hooks)) {
    if (event === PLUGIN_BLOCK_KEY) continue;
    const arr = j.hooks[event];
    if (!Array.isArray(arr)) continue;
    const before = arr.length;
    const filtered = arr.filter((entry) => {
      if (!entry) return false;
      if (entry[MARKER]) return false;
      if (entry.hooks && Array.isArray(entry.hooks)) {
        const inner = entry.hooks.filter(
          (h) =>
            !(
              h &&
              typeof h.command === "string" &&
              h.command.includes("loomi-bridge.mjs")
            ),
        );
        if (inner.length === 0) return false;
        entry.hooks = inner;
        return true;
      }
      return true;
    });
    j.hooks[event] = filtered;
    if (filtered.length !== before) removed = true;
  }

  atomicWriteJson(settings.path, j);
  return { ok: true, removed, path: settings.path };
}

// ---------------------------------------------------------------------------
// pet / state (Pet mirror)
// ---------------------------------------------------------------------------

async function cmdPet(state) {
  if (!state || !CAPYBARA_STATES.has(state)) {
    return {
      ok: false,
      code: "INVALID_STATE",
      validStates: [...CAPYBARA_STATES],
    };
  }
  const res = await apiPOST(
    "/api/pet/state",
    { state, source: "claude-code-plugin" },
    { timeoutMs: STATE_HTTP_TIMEOUT_MS },
  );
  if (res.status === 404) {
    return {
      ok: false,
      code: "ENDPOINT_MISSING",
      message:
        'OpenLoomi runtime does not yet expose POST /api/pet/state. Pending endpoint — would have set state to "' +
        state +
        '".',
      state,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      code: "PET_FAILED",
      status: res.status,
      error: res.json || res.error,
    };
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
  const target = (baseUrl || openloomiBaseUrl()) + "/api/remote-auth/guest";
  try {
    // 10 s per-attempt timeout, 2 retries — total budget ~30 s worst case.
    // POST without a body is safely idempotent in the runtime's eyes: a 5xx
    // means the token wasn't minted, so a follow-up call mints a fresh one.
    const res = await fetchWithRetry(
      target,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({}),
      },
      { timeoutMs: 10_000 },
    );
    const text = await res.text().catch(() => "");
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      return {
        ok: false,
        code: res.status === 404 ? "ENDPOINT_MISSING" : `http_${res.status}`,
        status: res.status,
        error: json,
      };
    }
    const token = json?.token;
    if (typeof token !== "string" || !token.trim()) {
      return { ok: false, code: "NO_TOKEN_IN_RESPONSE", response: json };
    }
    const saved = saveOpenloomiToken(token);
    if (!saved.ok) {
      return {
        ok: false,
        code: saved.code || "TOKEN_WRITE_FAILED",
        error: saved.error || null,
      };
    }
    return {
      ok: true,
      user: json.user || null,
      tokenPath: saved.path,
    };
  } catch (e) {
    return { ok: false, code: "NETWORK", error: String(e?.message || e) };
  }
}

async function cmdState(name, { event } = {}) {
  if (!CAPYBARA_STATES.has(name)) {
    // Hooks should never reach this with an invalid name, but be safe.
    return {
      ok: false,
      archive: "skipped",
      reason: "invalid_state",
      state: name,
    };
  }
  try {
    const res = await apiPOST(
      "/api/pet/state",
      { state: name, source: "claude-code-plugin", event: event || null },
      { timeoutMs: STATE_HTTP_TIMEOUT_MS },
    );
    if (res.status === 404) {
      return {
        ok: false,
        archive: "skipped",
        reason: "endpoint_missing",
        state: name,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        archive: "skipped",
        reason: `http_${res.status}`,
        state: name,
      };
    }
    return { ok: true, state: name };
  } catch {
    return { ok: false, archive: "skipped", reason: "exception", state: name };
  }
}

// ---------------------------------------------------------------------------
// archive (Stop hook)
// ---------------------------------------------------------------------------

async function readStdinJson({ maxBytes = 64 * 1024 } = {}) {
  return await new Promise((resolve) => {
    let total = 0;
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      total += Buffer.byteLength(chunk, "utf8");
      if (total <= maxBytes) buf += chunk;
    });
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", () => resolve(""));
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
      try {
        payload = JSON.parse(stdinRaw);
      } catch {
        payload = {};
      }
    }
  } catch {
    payload = {};
  }

  const eventName = payload.hook_event_name || payload.event || "";
  if (eventName !== "Stop") {
    return {
      continue: true,
      _openloomi: {
        archive: "skipped",
        reason: "not_stop_event",
        event: eventName,
      },
    };
  }

  const transcriptPath =
    payload.transcript_path || payload.transcriptPath || null;
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return {
      continue: true,
      _openloomi: { archive: "skipped", reason: "transcript_missing" },
    };
  }

  let raw;
  try {
    const st = statSync(transcriptPath);
    if (st.size > ARCHIVE_MAX_BYTES) {
      // Truncate by reading last ~ARCHIVE_MAX_BYTES bytes.
      const fd = await import("node:fs/promises");
      const fh = await fd.open(transcriptPath, "r");
      try {
        const start = Math.max(0, st.size - ARCHIVE_MAX_BYTES);
        const buf = Buffer.alloc(st.size - start);
        await fh.read(buf, 0, buf.length, start);
        raw = buf.toString("utf8");
      } finally {
        await fh.close();
      }
    } else {
      raw = await readFile(transcriptPath, "utf8");
    }
  } catch {
    return {
      continue: true,
      _openloomi: { archive: "skipped", reason: "transcript_unreadable" },
    };
  }

  const lines = raw.split(/\r?\n/).filter(Boolean);
  const parsed = [];
  for (const line of lines) {
    try {
      const o = JSON.parse(line);
      if (
        o &&
        (o.type === "user" || o.type === "human" || o.type === "assistant")
      ) {
        parsed.push(o);
      }
    } catch {
      /* skip */
    }
  }
  if (parsed.length === 0) {
    return {
      continue: true,
      _openloomi: { archive: "skipped", reason: "no_messages" },
    };
  }
  const tail = parsed.slice(-ARCHIVE_MAX_TURNS);
  const summaryText = buildArchiveSummary(tail, payload.session_id || null);
  if (!summaryText) {
    return {
      continue: true,
      _openloomi: { archive: "skipped", reason: "empty_summary" },
    };
  }

  const bearer = loadBearerToken();
  if (!bearer) {
    return {
      continue: true,
      _openloomi: { archive: "skipped", reason: "auth_missing" },
    };
  }

  const res = await apiPOST(
    "/api/insights",
    {
      type: "note",
      title: `Claude Code session${payload.session_id ? " " + String(payload.session_id).slice(0, 8) : ""} (${new Date().toISOString().slice(0, 10)})`,
      description: summaryText,
      platform: "claude-code",
      groups: ["claude-code"],
      sessionId: payload.session_id || null,
      source: "claude-code-plugin-stop-hook",
      capturedAt: new Date().toISOString(),
    },
    { timeoutMs: ARCHIVE_HTTP_TIMEOUT_MS },
  );

  if (!res.ok) {
    return {
      continue: true,
      _openloomi: {
        archive: "skipped",
        reason: res.status === 404 ? "endpoint_missing" : `http_${res.status}`,
        details: res.json || res.error || null,
      },
    };
  }
  return {
    continue: true,
    _openloomi: {
      archive: "ok",
      session: payload.session_id || null,
      insightId: res.json?.id || null,
    },
  };
}

function buildArchiveSummary(turns, sessionId) {
  const parts = [];
  let total = 0;
  for (const t of turns) {
    const content = extractMessageText(t);
    if (!content) continue;
    const role = t.role || t.type || "message";
    const tag =
      role === "user" || role === "human"
        ? "user"
        : role === "assistant"
          ? "assistant"
          : role;
    const slice = `${tag}: ${content}`.slice(0, 1500);
    parts.push(slice);
    total += slice.length;
    if (total > ARCHIVE_MAX_CONTENT_CHARS) break;
  }
  if (parts.length === 0) return null;
  const header = `[claude-code session${sessionId ? " " + sessionId : ""}]`;
  const joined = parts.join("\n");
  const capped =
    joined.length > ARCHIVE_MAX_CONTENT_CHARS
      ? joined.slice(0, ARCHIVE_MAX_CONTENT_CHARS) + "…"
      : joined;
  return `${header}\n${capped}`;
}

function extractMessageText(obj) {
  const msg = obj?.message || obj;
  const c = msg?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((p) => {
        if (!p) return "";
        if (typeof p === "string") return p;
        if (p.type === "text" && typeof p.text === "string") return p.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

// ---------------------------------------------------------------------------
// usage
// ---------------------------------------------------------------------------

async function cmdUsage() {
  const r = await apiGET("/api/llm/usage/summary", { timeoutMs: 5000 });
  if (!r.ok && r.status === 0) {
    return { ok: false, code: "API_UNREACHABLE", error: r.error };
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
    let buf = "";
    const onData = (b) => {
      buf += b.toString("utf8");
      if (buf.includes("\n")) {
        process.stdin.removeListener("data", onData);
        const answer = buf.trim().toLowerCase();
        resolve(answer === "y" || answer === "yes");
      }
    };
    process.stdin.on("data", onData);
    process.stdin.resume();
  });
}

async function runInstallScript({
  platformName,
  yes,
  onTick = null,
  budgetMs = null,
}) {
  const filename =
    platformName === "macos"
      ? "setup.macos.sh"
      : platformName === "windows"
        ? "setup.windows.ps1"
        : "setup.linux.sh";
  const candidates = [
    join(PLUGIN_DIR, "scripts", "install-assets", filename),
    join(PLUGIN_DIR, "install-assets", filename),
  ];
  let scriptPath = null;
  for (const c of candidates) {
    if (existsSync(c)) {
      scriptPath = c;
      break;
    }
  }
  if (!scriptPath) {
    return {
      ok: false,
      code: "INSTALL_SCRIPT_MISSING",
      message: `No install script shipped for ${platformName}. Open https://openloomi.ai/docs/install and follow the manual steps.`,
    };
  }
  if (!yes) {
    if (!isTTY) {
      return {
        ok: false,
        code: "NON_INTERACTIVE_REQUIRES_YES",
        message:
          "Install invoked without --yes from a non-interactive shell (no TTY). Re-run with --yes to confirm consent, or run directly in a terminal so the y/N prompt can be answered.",
      };
    }
    const proceed = await promptYesNo(
      `This will execute ${filename} from the OpenLoomi plugin to install OpenLoomi locally. Proceed?`,
    );
    if (!proceed)
      return {
        ok: false,
        code: "CANCELLED",
        message: "User cancelled installation.",
      };
  }
  let cmd, args;
  if (platformName === "windows") {
    cmd = "powershell";
    args = ["-ExecutionPolicy", "Bypass", "-NoProfile", "-File", scriptPath];
  } else {
    cmd = "bash";
    args = [scriptPath];
  }
  // The install helper reads `OPENLOOMI_VERSION`, `OPENLOOMI_DMG_PATH`,
  // `OPENLOOMI_REPO`, `OPENLOOMI_DOCS_BASE`, `OPENLOOMI_INSTALL_ROOT`,
  // `GITHUB_TOKEN` / `GH_TOKEN`, etc. from the parent process env. Those
  // propagate by default — no explicit `env` override. See issue #401
  // (restricted-network / corporate proxy install) for the full contract,
  // and openloomi.ai/docs/install/restricted-network for the user-facing
  // narrative. The bridge intentionally does NOT strip these here: doing
  // so would silently break `--offline <path>` and the env-var form of
  // the same path.
  const startedAt = Date.now();
  return await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let tickHandle = null;
    let budgetHandle = null;
    let resolved = false;
    // Latest `[openloomi-installer] stage=...` line seen on stderr. Kept
    // only for diagnostics; the helper's raw stderr is forwarded to
    // process.stderr as it arrives so the user sees progress in real time.
    let lastStage = null;
    // Detect stage lines emitted by the install helpers — they're
    // verbose by design so the chat layer can surface them as a
    // structured `stage=` field without re-parsing free-form prose.
    const stageLineRe = /^\[openloomi-installer\]\s+(?:stage=([a-z_]+))/;
    const finalize = (result) => {
      // Guard against double-resolve: timeout + exit / spawn + exit
      // can race. The first writer wins; later calls become no-ops.
      if (resolved) return;
      resolved = true;
      if (tickHandle) {
        clearInterval(tickHandle);
        tickHandle = null;
      }
      if (budgetHandle) {
        clearTimeout(budgetHandle);
        budgetHandle = null;
      }
      const elapsedMs = Date.now() - startedAt;
      const base = {
        elapsedMs,
        lastStage,
        stdout,
        stderr,
        budgetMs: Number.isFinite(budgetMs) ? budgetMs : null,
      };
      // OK passes through untouched — only failure paths need the
      // mapper to guarantee non-empty `hints` and a concrete next step.
      const merged = result.ok
        ? { ...base, ...result }
        : { ...base, ...result };
      if (!result.ok) {
        Object.assign(merged, installErrorGuidance(merged));
      }
      resolve(merged);
    };
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (b) => (stdout += b.toString("utf8")));
    // Tee child stderr to process.stderr as it arrives (so the user
    // sees progress live, instead of waiting for the child to exit)
    // while still buffering the full text for the final result. This
    // is the fix for issue #398: a 200 MB DMG download previously
    // buffered silently until the helper returned.
    child.stderr.on("data", (b) => {
      const text = b.toString("utf8");
      stderr += text;
      try {
        process.stderr.write(text);
      } catch {
        /* stderr may be piped / closed; not fatal */
      }
      // Update diagnostics only — never filter or rewrite the bytes the
      // user sees. We scan the last tail so chunked writes still match.
      const tail = text.split(/\r?\n/);
      for (const line of tail) {
        const m = stageLineRe.exec(line);
        if (m) lastStage = m[1];
      }
    });
    child.on("error", (e) =>
      finalize({
        ok: false,
        code: "SPAWN_FAILED",
        message: String(e?.message || e),
      }),
    );
    child.on("exit", (code, signal) => {
      // Parse the install script's structured stdout line (if any). The
      // script emits a single JSON object describing what it installed.
      // We extract it from the captured stdout so we don't have to re-curl
      // the GitHub API and we never call --version on the inner Tauri
      // binary.
      const infoLineMatch = stdout.match(/\{[^{}]*"version"[^{}]*\}/);
      if (infoLineMatch) {
        try {
          const parsed = JSON.parse(infoLineMatch[0]);
          setInstallInfo(parsed);
        } catch {
          /* ignore malformed */
        }
      }
      // If the per-stage budget killed the child with SIGKILL we still
      // want a stable INSTALL_TIMEOUT code (the timeout handler will
      // have already called finalize, but if the child happened to exit
      // first we want the timeout-friendly code path here too).
      if (signal === "SIGKILL" && Number.isFinite(budgetMs) && budgetMs > 0) {
        finalize({
          ok: false,
          code: "INSTALL_TIMEOUT",
          message: `Install exceeded ${budgetMs}ms budget. Re-run with a higher --install-timeout (default ${DEFAULT_INSTALL_TIMEOUT_MS}ms).`,
        });
        return;
      }
      finalize({
        ok: code === 0,
        code: code === 0 ? "OK" : `EXIT_${code}`,
        signal: signal || null,
      });
    });
    // Drive a 1 Hz heartbeat on stderr so the user sees the install is
    // still progressing (per issue #397). The interval is best-effort:
    // we unref() it so it never blocks process exit, and we clear it as
    // soon as the child exits.
    if (onTick) {
      try {
        onTick();
      } catch {
        /* ticker is best-effort */
      }
      tickHandle = setInterval(() => {
        try {
          onTick();
        } catch {
          /* ignore */
        }
      }, 1000);
      if (tickHandle.unref) tickHandle.unref();
    }
    // Per-stage budget. SIGKILL on overshoot so a stuck installer never
    // strands the wizard — the bridge returns INSTALL_TIMEOUT and the
    // user can retry with --install-timeout <N> or --yes to bypass.
    if (Number.isFinite(budgetMs) && budgetMs > 0) {
      budgetHandle = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already exited */
        }
        finalize({
          ok: false,
          code: "INSTALL_TIMEOUT",
          message: `Install exceeded ${budgetMs}ms budget. Re-run with a higher --install-timeout (default ${DEFAULT_INSTALL_TIMEOUT_MS}ms).`,
        });
      }, budgetMs);
      if (budgetHandle.unref) budgetHandle.unref();
    }
  });
}

async function cmdInstall({
  yes = false,
  onTick = null,
  budgetMs = null,
} = {}) {
  const platformName = detectPlatform();
  const r = await runInstallScript({ platformName, yes, onTick, budgetMs });
  // After install, refresh discovery state.
  const status = await buildStatus({ json: true });
  return { install: r, status, installInfo: getInstallInfo() };
}

// Checks whether the desktop GUI binary is actually running. Used by the
// setup state machine to decide whether the user is already looking at
// an OpenLoomi window (in which case setup can declare success) or
// whether we need to call `open -a <bundle>` to surface the window.
//
// We deliberately don't reuse `buildStatus`'s `apiReachable` flag here —
// the HTTP API can be up (Next.js server child process) while the Tauri
// GUI window is closed or never started (e.g. after a headless dev run,
// or if the user dismissed the window). The bridge relies on `binPath`
// (the Tauri binary path under the .app bundle) as the discriminator.
//
// Per-platform: macOS/Linux use `pgrep -if <pattern>` — the Tauri main
// process argv[0] carries the bundle path, so matching the distinctive
// `Contents/MacOS/<binName>` suffix won't false-positive on the inner
// `node server.js` (whose argv[0] is the node binary, not the Tauri one).
// Windows uses `tasklist /FI "IMAGENAME eq <binName>"`.
async function probeDesktopProcessRunning(binPath) {
  if (!binPath) return false;
  const platformName = detectPlatform();
  if (platformName === "windows") {
    const binName = binPath.split(/[\\/]/).pop() || "";
    return await new Promise((resolve) => {
      const proc = spawn("tasklist", ["/FI", `IMAGENAME eq ${binName}`], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      let out = "";
      proc.stdout?.on("data", (b) => (out += b.toString("utf8")));
      proc.on("exit", () => resolve(out.includes(binName)));
      proc.on("error", () => resolve(false));
    });
  }
  // Match the distinctive `Contents/MacOS/<binName>` suffix (Linux has no
  // such prefix, so we fall back to the binary basename there) rather than
  // the full absolute path: the installed bundle can differ in case from
  // our discovered `binPath` (e.g. `/Applications/openloomi.app/...` on
  // disk vs. `/Applications/OpenLoomi.app/...` as resolved), and macOS
  // `pgrep -f` is case-sensitive. `-i` makes the match case-insensitive so
  // the discriminator still avoids false-positiving on the inner
  // `node server.js` while surviving the case mismatch.
  const binName = binPath.split(/[\\/]/).pop() || "";
  const pattern =
    platformName === "macos" ? `Contents/MacOS/${binName}` : binName;
  return await new Promise((resolve) => {
    const proc = spawn("pgrep", ["-if", pattern], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    proc.stdout?.on("data", (b) => (out += b.toString("utf8")));
    proc.on("exit", (code) => {
      // pgrep exits 1 when no match, 2+ on error. Treat both as "not running".
      if (code !== 0) {
        resolve(false);
        return;
      }
      const pids = out.split("\n").filter(Boolean);
      resolve(pids.length > 0);
    });
    proc.on("error", () => resolve(false));
  });
}

// Marks the next desktop launch as plugin-initiated by setting
// OPENLOOMI_LAUNCH_MODE=plugin in the environment the desktop
// process will see. The Codex plugin's `applyRuntimeEnvChange` is
// not reused here because it brings in a LaunchAgent plist /
// environment.d / dry-run pipeline that's overkill for this
// single-use side-band. We just want to leave a flag in the right
// spot, no rollback semantics, no persistence guarantees.
//
// Per-platform notes:
//
// * macOS — `open -a` hands off to LaunchServices; the new app
//   process inherits from launchd, not from this Node process.
//   Set via `launchctl setenv` so the freshly-spawned Tauri process
//   sees it.
//
// * Windows — `cmd /c start "" <exe>` forks without inheriting the
//   parent env in the same reliable way as Mac/Linux. The
//   `launchDesktopApp` spawn site below passes the env explicitly
//   via the `env` option, so this helper is a no-op on Windows.
//
// * Linux — gtk-launch / direct fork inherit `process.env`
//   automatically. We still inject the env into the spawn call
//   below as belt-and-braces in case a hook scrubbed it.
async function ensureLaunchModeEnvForLaunch() {
  if (process.env.OPENLOOMI_LAUNCH_MODE === "plugin") {
    return { ok: true, platform: process.platform, method: "already-set" };
  }
  const platform = process.platform;
  if (platform === "darwin") {
    const r = await runBin(
      "launchctl",
      ["setenv", "OPENLOOMI_LAUNCH_MODE", "plugin"],
      { timeoutMs: 5000 },
    );
    if (r.ok) {
      return { ok: true, platform, method: "launchctl setenv" };
    }
    return {
      ok: false,
      platform,
      method: "launchctl setenv",
      error: r.error?.message || r.stderr || "unknown",
    };
  }
  // Non-darwin: the spawn site in launchDesktopApp passes the env
  // explicitly. Mark success so the caller doesn't log a warning.
  return { ok: true, platform, method: "spawn-env" };
}

// Programmatically launches the OpenLoomi desktop app so the helper binary
// gets laid down and the local HTTP API comes up. This is what unblocks
// `canGuestLogin: true` and the auto-login step in the setup state
// machine. We do NOT touch the GUI (no AppleScript, no keystrokes); the
// app starts in its normal state and we just poll for the API.
//
// Per-platform: macOS uses `open -a <bundle>`, Linux uses
// `gtk-launch <desktopId>` (best-effort) and Windows uses `cmd /c start "" <exe>`.
// If the platform doesn't support auto-launch, we return ok=false with
// a clear reason and let the user launch it once manually.
async function launchDesktopApp({ desktopMarker, binPath } = {}) {
  const platformName = detectPlatform();
  // We need either the .app bundle (macOS) or a runnable exe (Win/Linux).
  const target = desktopMarker || binPath || null;
  if (!target) {
    return {
      ok: false,
      code: "NO_LAUNCH_TARGET",
      message: "No OpenLoomi app path or binary to launch.",
    };
  }
  // Mark this launch as plugin-initiated. The freshly-spawned desktop
  // reads OPENLOOMI_LAUNCH_MODE from its environment and uses the
  // value to route pet left-clicks to the compact status card
  // instead of the main dashboard — surfacing two dialogs for the
  // same chat (plugin + main) would be confusing. The user can
  // still reach the main window via the pet right-click "Open
  // Loomi" or the card's "Open in dashboard" CTA.
  //
  // Non-fatal on purpose: a failure here means the desktop falls
  // back to standalone behaviour (pet click → main window), which is
  // the same UX the user had before this code existed. We don't
  // promote the failure to a launch-blocker.
  const launchModeEnvResult = await ensureLaunchModeEnvForLaunch();
  if (!launchModeEnvResult.ok) {
    console.warn(
      "[loomi-bridge] failed to set OPENLOOMI_LAUNCH_MODE=plugin; " +
        "pet click will fall back to standalone behaviour",
      launchModeEnvResult,
    );
  }
  let cmd;
  let args;
  let spawnEnv = process.env;
  if (platformName === "macos") {
    cmd = "open";
    args = ["-a", desktopMarker || target];
  } else if (platformName === "windows") {
    cmd = "cmd";
    args = ["/c", "start", '""', target];
  } else {
    // Linux: try gtk-launch with a guessed desktopId; fall back to executing the
    // binary directly if that fails. We don't ship a .desktop file from the
    // plugin, so gtk-launch is best-effort.
    cmd = "gtk-launch";
    args = ["openloomi"];
    // On Linux, gtk-launch / direct fork inherit `process.env` from the
    // plugin's Node process. Inject OPENLOOMI_LAUNCH_MODE explicitly so
    // the desktop sees it even if the parent process was started
    // without it (e.g. by a hook that scrubbed the env).
    spawnEnv = { ...process.env, OPENLOOMI_LAUNCH_MODE: "plugin" };
  }
  const spawnResult = await new Promise((resolve) => {
    let stderr = "";
    let stdout = "";
    let child;
    try {
      child = spawn(cmd, args, {
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
        env: spawnEnv,
      });
    } catch (e) {
      resolve({
        ok: false,
        code: "SPAWN_FAILED",
        message: String(e?.message || e),
      });
      return;
    }
    child.stdout?.on("data", (b) => (stdout += b.toString("utf8")));
    child.stderr?.on("data", (b) => (stderr += b.toString("utf8")));
    child.on("error", (e) =>
      resolve({
        ok: false,
        code: "SPAWN_FAILED",
        message: String(e?.message || e),
      }),
    );
    // `open -a` and `start ""` return immediately; gtk-launch returns after
    // the app is forked. Treat any non-error exit (or no exit within the
    // short window) as success — what we really care about is whether the
    // API comes up, which we verify in waitForApi().
    child.on("exit", (code) => {
      if (code === 0 || code === null) {
        resolve({ ok: true, code: "OK", stdout, stderr, via: cmd });
      } else {
        // Try the binary directly as a Linux fallback before giving up.
        if (platformName === "linux" && binPath) {
          spawn(binPath, [], {
            stdio: "ignore",
            detached: true,
            // Mirror the gtk-launch branch above: inject the launch
            // mode so the desktop sees OPENLOOMI_LAUNCH_MODE=plugin
            // even on the direct-spawn fallback path.
            env: { ...process.env, OPENLOOMI_LAUNCH_MODE: "plugin" },
          }).unref();
          resolve({ ok: true, code: "OK_FALLBACK_DIRECT", via: binPath });
          return;
        }
        resolve({ ok: false, code: `EXIT_${code}`, stdout, stderr, via: cmd });
      }
    });
    // Hard cap so we don't block forever on platforms where the launcher
    // doesn't exit (some `open -a` invocations under launchd behave that way).
    setTimeout(
      () => resolve({ ok: true, code: "OK_TIMEOUT", via: cmd, stdout, stderr }),
      2000,
    ).unref();
  });
  // Surface `launchMode` so callers (notably the setup state machine)
  // can record it as a distinct audit step. The env write is logically
  // a separate action from the spawn — they have different failure
  // modes (e.g. macOS TCC blocking `launchctl setenv` succeeds the
  // spawn but loses the signal) and different operators (env state
  // vs process state). Merging them into one step would obscure both.
  return { ...spawnResult, launchMode: launchModeEnvResult };
}

// Polls the local OpenLoomi HTTP API until it responds, or the timeout
// elapses. Used after launching the desktop app to confirm the runtime
// is up before minting a guest bearer / syncing the AI provider.
//
// Per-issue #397:
//   - Accepts an optional `onProgress` ticker (typically built with
//     makeStageTicker("wait_api", timeoutMs)) so the caller can drive a
//     1 Hz "waiting for local API (12s / max 90s) …" line on stderr.
//   - Returns the stable `code: "API_NOT_READY"` on timeout (the older
//     `code: "TIMEOUT"` is preserved as `legacyCode` so existing callers
//     that grep for it keep working).
//   - When the desktop process is confirmed running but the API still
//     has not woken up, `code` is upgraded to `"PERMISSION_PROMPT_LIKELY"`
//     so the wizard can surface a TCC-prompt hint instead of a generic
//     "did not respond" message. `binPath` is forwarded by the caller.
async function waitForApi({
  timeoutMs = 30_000,
  intervalMs = 500,
  onProgress = null,
  binPath = null,
  isPermissionLikely = null, // async () => bool — defaults to probing the bin
} = {}) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const url = await probeOpenLoomiBaseUrl();
      if (url) return { ok: true, elapsedMs: Date.now() - start, url };
    } catch (e) {
      lastError = e;
    }
    if (onProgress) {
      try {
        onProgress({ stage: "wait_api", elapsedMs: Date.now() - start });
      } catch {
        /* ticker is best-effort */
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const elapsedMs = Date.now() - start;
  let permissionLikely = false;
  try {
    permissionLikely = isPermissionLikely
      ? await isPermissionLikely()
      : binPath
        ? await probeDesktopProcessRunning(binPath)
        : false;
  } catch {
    permissionLikely = false;
  }
  return {
    ok: false,
    legacyCode: "TIMEOUT",
    code: permissionLikely ? "PERMISSION_PROMPT_LIKELY" : "API_NOT_READY",
    stage: "wait_api",
    elapsedMs,
    permissionLikely,
    lastError: lastError ? String(lastError?.message || lastError) : null,
    message: permissionLikely
      ? `OpenLoomi desktop process is running but the local API did not respond within ${timeoutMs}ms — macOS is likely showing a permission prompt that needs to be approved.`
      : `OpenLoomi local API did not respond within ${timeoutMs}ms.${lastError ? " last error: " + String(lastError?.message || lastError) : ""}`,
  };
}

// ---------------------------------------------------------------------------
// Command routing
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const sub = args._[0];

  switch (sub) {
    case "version": {
      out({ ok: true, plugin: "openloomi", version: PLUGIN_VERSION });
      return;
    }
    case "launch-mode-info": {
      // Diagnostic surface for OPENLOOMI_LAUNCH_MODE. The desktop
      // app reads this env var to route pet left-clicks: plugin
      // sessions default to the compact status card instead of the
      // main dashboard, so the user doesn't see "two dialogs" for
      // the same chat. Mirrors `codex-runtime-info` on the Codex
      // plugin side — same shape so tests can grep for the key.
      const platformName = detectPlatform();
      out({
        ok: true,
        purpose:
          "Mark the next OpenLoomi desktop launch as plugin-initiated " +
          "so the pet left-click defaults to the compact status card.",
        envKey: "OPENLOOMI_LAUNCH_MODE",
        envValue: "plugin",
        platform: platformName,
        perPlatform: {
          darwin:
            "Sets the env var via `launchctl setenv` before `open -a`. " +
            "The freshly-spawned Tauri process inherits from launchd.",
          linux:
            "Spawns gtk-launch / fallback binary with `env` containing " +
            "OPENLOOMI_LAUNCH_MODE=plugin (parent process.env is also " +
            "inherited by default).",
          win32:
            "Passes `env` containing OPENLOOMI_LAUNCH_MODE=plugin to the " +
            "`cmd /c start \"\" <exe>` spawn site.",
        },
        // The same helper that `launchDesktopApp` invokes. Surfaced
        // here so tests can grep for it and operators can confirm the
        // key matches what the desktop reads in `launch_mode.rs`.
        helper: "ensureLaunchModeEnvForLaunch",
        consumerFile: "apps/web/src-tauri/src/launch_mode.rs",
        // Name of the audit step the setup state machine records
        // when `launchDesktopApp` runs the helper. Lets operators
        // and tests confirm the wizard surfaces this side-band —
        // it isn't merged into `launch` / `launch_gui` because it
        // has a distinct failure mode (env write vs process spawn).
        auditStep: "launch_mode_env",
      });
      return;
    }
    case "launch-mode-apply": {
      // Test-only entry point. Invokes the same helper that
      // `launchDesktopApp` calls before spawning the desktop
      // process, so tests can mock `launchctl` on PATH and assert
      // the right env var key + value land in the mock's argv.
      const result = await ensureLaunchModeEnvForLaunch();
      out(result);
      return;
    }
    case "setup-status": {
      const status = await buildStatus({
        json: true,
        explicit: args["bin-path"] || null,
      });
      out(status);
      return;
    }
    case "setup": {
      // End-to-end wizard. Walks the full state machine in one invocation:
      //   install → launch app → wait API → guest login → sync env → READY.
      // Every transition is automatic — we never ask the user to click
      // anything. If a step can't be auto-resolved (e.g. AI provider needed
      // but no env key, or login failed), we return `awaiting_user_action`
      // with a clear `nextAction` and stop.
      //
      // Per-issue #397: timeouts are now per-stage (install / launch /
      // wait_api + permission_grace), each independently configurable
      // through CLI flags. `--max-wait` is kept as a global cap. Long
      // stages emit a throttled "stage X (Ys / max Zs) …" heartbeat on
      // stderr so the user sees progress in their terminal.
      const explicit = args["bin-path"] || null;
      const yesFlag = !!args.yes;
      const stages = readStageTimeouts(args);
      const maxSteps = 8; // hard ceiling on chained transitions
      const steps = [];
      const stageStartedAt = Date.now();

      const record = (name, ok, detail) => {
        steps.push({ step: name, ok, at: Date.now(), ...detail });
      };

      for (let i = 0; i < maxSteps; i++) {
        const status = await buildStatus({ json: true, explicit });
        // Augment with a per-call desktop-process probe. `buildStatus`
        // only knows about the .app bundle and the local API — not
        // whether the Tauri GUI window is actually up. Without this,
        // a setup call after a server-only prior run would land on
        // READY immediately while the user is staring at nothing.
        status.desktopProcessRunning = status.binPath
          ? await probeDesktopProcessRunning(status.binPath)
          : false;

        // Surface the desktop window if it's not already up. We do
        // this BEFORE the READY check so a "ready in everything but
        // the GUI" state falls into this branch instead of returning
        // success. `open -a <bundle>` is idempotent — a running app
        // just gets its window forwarded, so a redundant launch
        // alongside the existing 2a/2b branches is harmless.
        if (
          status.installed &&
          status.desktopMarker &&
          !status.desktopProcessRunning
        ) {
          const launch = await launchDesktopApp({
            desktopMarker: status.desktopMarker,
            binPath: status.binPath,
          });
          // The env write happens before the spawn in `launchDesktopApp`,
          // so record it first — the audit trail is chronological.
          if (launch.launchMode) {
            record("launch_mode_env", launch.launchMode.ok, {
              platform: launch.launchMode.platform,
              method: launch.launchMode.method,
              error: launch.launchMode.error,
            });
          }
          record("launch_gui", launch.ok, {
            code: launch.code,
            via: launch.via,
          });
          if (!launch.ok) {
            out({
              ok: false,
              setup: "gui_launch_failed",
              steps,
              launch,
              status,
            });
            return;
          }
          continue;
        }

        // Truly ready requires both the local API and the desktop GUI
        // process to be running. If the GUI isn't up, the branch above
        // has already launched it — the next iteration will land here
        // with both signals green.
        if (status.reason === "READY" && status.desktopProcessRunning) {
          out({ ok: true, setup: "ready", steps, status });
          return;
        }

        // 1. Install.
        if (!status.installed && status.nextAction === "install_openloomi") {
          const installTicker = makeStageTicker("install", stages.installMs);
          installTicker();
          const r = await cmdInstall({
            yes: yesFlag,
            onTick: () => installTicker(),
            budgetMs: stages.installMs,
          });
          record("install", !!r.install?.ok, {
            code: r.install?.code,
            elapsedMs:
              r.install && Number.isFinite(r.install.elapsedMs)
                ? r.install.elapsedMs
                : null,
          });
          if (!r.install?.ok) {
            const elapsedMs = Date.now() - stageStartedAt;
            // `runInstallScript` already maps every non-OK result to a
            // human message + non-empty hints + concrete resume command
            // via `installErrorGuidance`. Surface those fields directly
            // so the chat layer has a stable shape regardless of which
            // exit code or failure mode the helper produced (issue #398).
            const ins = r.install || {};
            out({
              ok: false,
              setup: "install_failed",
              code: ins.code || "EXIT_NONZERO",
              stage: "install",
              elapsedMs,
              message: ins.message,
              hints:
                Array.isArray(ins.hints) && ins.hints.length > 0
                  ? ins.hints
                  : undefined,
              canResume:
                typeof ins.canResume === "boolean" ? ins.canResume : true,
              resumeCommand: ins.resumeCommand,
              lastStage: ins.lastStage || null,
              steps,
              install: ins,
              status: r.status,
            });
            return;
          }
          continue;
        }

        // 2. .app installed but helper binary / local API not yet on disk.
        //    Auto-launch the desktop app (signed bundle, safe to do) and
        //    poll for the API to come up.
        if (status.installed && status.reason === "OPENLOOMI_NOT_FINALIZED") {
          const launch = await launchDesktopApp({
            desktopMarker: status.desktopMarker,
            binPath: status.binPath,
          });
          if (launch.launchMode) {
            record("launch_mode_env", launch.launchMode.ok, {
              platform: launch.launchMode.platform,
              method: launch.launchMode.method,
              error: launch.launchMode.error,
            });
          }
          record("launch", launch.ok, { code: launch.code, via: launch.via });
          if (!launch.ok) {
            out({ ok: false, setup: "launch_failed", steps, launch, status });
            return;
          }
          const apiTicker = makeStageTicker("wait_api", stages.apiMs);
          // Prime the ticker so the user sees feedback within ~1 s.
          apiTicker();
          const wait = await waitForApi({
            timeoutMs: stages.apiMs,
            onProgress: () => apiTicker(),
            binPath: status.binPath,
          });
          record("wait_api", wait.ok, {
            elapsedMs: wait.elapsedMs,
            url: wait.url,
            code: wait.code,
            permissionLikely: wait.permissionLikely,
          });
          if (!wait.ok) {
            const elapsedMs = Date.now() - stageStartedAt;
            // Apply the permission_grace budget on top of apiMs only when
            // the desktop process is actually running. That way a slow
            // download does NOT silently extend the wait — permission
            // grace is exclusively for "process up but TCC blocking".
            let effectiveBudget = stages.apiMs;
            if (wait.permissionLikely) {
              effectiveBudget += stages.permissionMs;
              // One more bounded wait_for_api cycle for the permission
              // prompt to be approved by the user.
              const graceTicker = makeStageTicker(
                "permission_grace",
                stages.permissionMs,
              );
              graceTicker();
              const graceWait = await waitForApi({
                timeoutMs: stages.permissionMs,
                onProgress: () => graceTicker(),
                binPath: status.binPath,
              });
              if (graceWait.ok) {
                record("wait_api.grace", true, {
                  elapsedMs: graceWait.elapsedMs,
                  url: graceWait.url,
                });
                continue;
              }
              record("wait_api.grace", false, {
                elapsedMs: graceWait.elapsedMs,
                code: graceWait.code,
              });
            }
            // Honor the global cap (--max-wait) once we know the user
            // asked for a ceiling smaller than what we've already spent.
            const overCap = elapsedMs > stages.totalMs + stages.permissionMs;
            const hints = apiNotReadyHints({
              stage: wait.stage || "wait_api",
              platformName: detectPlatform(),
              canResume: true,
            });
            out({
              ok: false,
              setup: "api_not_ready",
              code: wait.code,
              stage: wait.stage || "wait_api",
              elapsedMs,
              effectiveBudgetMs: effectiveBudget,
              overCap,
              canResume: true,
              resumeCommand:
                "/openloomi:setup --yes --max-wait " +
                Math.max(stages.totalMs, 180_000),
              hints,
              steps,
              wait,
              status,
            });
            return;
          }
          continue;
        }

        // 2b. .app is installed AND inner binary exists, but the desktop
        //     process isn't running yet so the API is unreachable. We
        //     launch it the same way as the NOT_FINALIZED branch — this is
        //     the normal "first time you call setup on a fresh install"
        //     path (the user has not yet opened OpenLoomi.app).
        if (status.installed && !status.apiReachable && status.desktopMarker) {
          const launch = await launchDesktopApp({
            desktopMarker: status.desktopMarker,
            binPath: status.binPath,
          });
          if (launch.launchMode) {
            record("launch_mode_env", launch.launchMode.ok, {
              platform: launch.launchMode.platform,
              method: launch.launchMode.method,
              error: launch.launchMode.error,
            });
          }
          record("launch", launch.ok, { code: launch.code, via: launch.via });
          if (!launch.ok) {
            out({ ok: false, setup: "launch_failed", steps, launch, status });
            return;
          }
          const apiTicker = makeStageTicker("wait_api", stages.apiMs);
          // Prime the ticker so the user sees feedback within ~1 s.
          apiTicker();
          const wait = await waitForApi({
            timeoutMs: stages.apiMs,
            onProgress: () => apiTicker(),
            binPath: status.binPath,
          });
          record("wait_api", wait.ok, {
            elapsedMs: wait.elapsedMs,
            url: wait.url,
            code: wait.code,
            permissionLikely: wait.permissionLikely,
          });
          if (!wait.ok) {
            const elapsedMs = Date.now() - stageStartedAt;
            // Apply the permission_grace budget on top of apiMs only when
            // the desktop process is actually running. That way a slow
            // download does NOT silently extend the wait — permission
            // grace is exclusively for "process up but TCC blocking".
            let effectiveBudget = stages.apiMs;
            if (wait.permissionLikely) {
              effectiveBudget += stages.permissionMs;
              // One more bounded wait_for_api cycle for the permission
              // prompt to be approved by the user.
              const graceTicker = makeStageTicker(
                "permission_grace",
                stages.permissionMs,
              );
              graceTicker();
              const graceWait = await waitForApi({
                timeoutMs: stages.permissionMs,
                onProgress: () => graceTicker(),
                binPath: status.binPath,
              });
              if (graceWait.ok) {
                record("wait_api.grace", true, {
                  elapsedMs: graceWait.elapsedMs,
                  url: graceWait.url,
                });
                continue;
              }
              record("wait_api.grace", false, {
                elapsedMs: graceWait.elapsedMs,
                code: graceWait.code,
              });
            }
            // Honor the global cap (--max-wait) once we know the user
            // asked for a ceiling smaller than what we've already spent.
            const overCap = elapsedMs > stages.totalMs + stages.permissionMs;
            const hints = apiNotReadyHints({
              stage: wait.stage || "wait_api",
              platformName: detectPlatform(),
              canResume: true,
            });
            out({
              ok: false,
              setup: "api_not_ready",
              code: wait.code,
              stage: wait.stage || "wait_api",
              elapsedMs,
              effectiveBudgetMs: effectiveBudget,
              overCap,
              canResume: true,
              resumeCommand:
                "/openloomi:setup --yes --max-wait " +
                Math.max(stages.totalMs, 180_000),
              hints,
              steps,
              wait,
              status,
            });
            return;
          }
          continue;
        }

        // 3. Login needed and API reachable → mint a one-tap guest bearer.
        if (status.reason === "LOGIN_REQUIRED" && status.canGuestLogin) {
          const g = await cmdGuestLogin();
          record("guest_login", !!g.ok, { code: g.code, user: g.user });
          if (!g.ok) {
            out({
              ok: false,
              setup: "guest_login_failed",
              code: g.code,
              message:
                "Guest login failed. Open OpenLoomi Desktop and sign in with an existing account, then re-run /openloomi:setup.",
              guest: g,
              steps,
              status,
            });
            return;
          }
          continue;
        }

        // 5. No automatic transition matches. Surface a clear next step.
        //    The two realistic stops here are:
        //      - LOGIN_REQUIRED but canGuestLogin=false → API is down
        //        (we couldn't reach it after launch). Tell the user to
        //        sign in via the GUI and re-run setup.
        //      - AI_PROVIDER_REQUIRED with no env key → walk them through
        //        OpenLoomi Desktop → API Settings.
        out({
          ok: true,
          setup: "awaiting_user_action",
          steps,
          status,
        });
        return;
      }

      // Hit the step ceiling without reaching READY — return current state.
      const final = await buildStatus({ json: true, explicit });
      out({ ok: false, setup: "step_limit_reached", steps, status: final });
      return;
    }
    case "install": {
      // Honor --install-timeout for the direct install path so users
      // running `node loomi-bridge.mjs install --yes` get the same 1 Hz
      // heartbeat as the `/openloomi:setup` wizard (issue #398). The
      // setup wizard passes its own ticker; this branch owns it itself.
      const stages = readStageTimeouts(args);
      const installTicker = makeStageTicker("install", stages.installMs);
      installTicker();
      const tickHandle = setInterval(() => installTicker(), 1000);
      if (tickHandle.unref) tickHandle.unref();
      try {
        const r = await cmdInstall({
          yes: !!args.yes,
          onTick: () => installTicker(),
          budgetMs: stages.installMs,
        });
        out(r);
      } finally {
        clearInterval(tickHandle);
      }
      return;
    }
    case "login": {
      // We deliberately do not spawn a browser here — the user can open
      // OpenLoomi Desktop themselves. We just report token presence.
      const status = await buildStatus({ json: true });
      out({
        ok: true,
        loginRequired: !status.tokenPresent,
        instructions: status.tokenPresent
          ? "Already authenticated. No action required."
          : "Open OpenLoomi Desktop and complete sign-in. The plugin will detect the token automatically. Alternatively, run `guest-login` for a one-tap guest account.",
        status,
      });
      return;
    }
    case "guest-login": {
      const r = await cmdGuestLogin({
        baseUrl: process.env.OPENLOOMI_BASE_URL || null,
      });
      // Sanitize: never echo the raw token; report the path on success so
      // the caller can confirm the file landed.
      if (r.ok) {
        out({ ok: true, guest: "ok", user: r.user, tokenPath: r.tokenPath });
      } else {
        out(
          {
            ok: false,
            guest: r.code || "failed",
            error: r.error || null,
            status: r.status || null,
          },
          1,
        );
      }
      return;
    }
    case "pet": {
      const state = args._[1];
      const r = await cmdPet(state);
      out(r, r.ok ? 0 : 1);
      return;
    }
    case "state": {
      const name = args._[1];
      const event = args.event || null;
      const r = await cmdState(name, { event });
      out(r);
      return;
    }
    case "archive": {
      // Hooks must always exit 0. We capture the result and print, but
      // never set a non-zero exit code from this path.
      try {
        const r = await cmdArchive();
        process.stdout.write(JSON.stringify(r) + EOL);
      } catch {
        process.stdout.write(
          JSON.stringify({
            continue: true,
            _openloomi: { archive: "skipped", reason: "exception" },
          }) + EOL,
        );
      }
      process.exit(0);
      return;
    }
    case "usage": {
      const r = await cmdUsage();
      out(r, r.ok ? 0 : 0);
      return;
    }
    case "install-hooks": {
      const r = installHooks({ yes: !!args.yes });
      out(r, r.ok ? 0 : 1);
      return;
    }
    case "uninstall-hooks": {
      const r = uninstallHooks();
      out(r, r.ok ? 0 : 1);
      return;
    }
    case "hooks-status": {
      const installed = detectHooksInstalled();
      const settings = readSettings();
      out({
        ok: true,
        installed,
        settingsPath: settings.path,
        marker: MARKER,
        legacyBlockKey: PLUGIN_BLOCK_KEY,
        schema: "per-event",
      });
      return;
    }
    case "help": {
      process.stdout.write(
        [
          "loomi-bridge.mjs <subcommand> [...flags]",
          "",
          "Subcommands:",
          "  version                          print plugin version",
          "  setup                            full setup wizard",
          "  setup-status [--json]            stable JSON status",
          "  install [--yes]                  user-approved install",
          "  login                            check token presence",
          "  guest-login                      one-tap guest bearer (writes ~/.openloomi/token)",
          "  pet <state>                      set OpenLoomi Pet state",
          "  state <name> [--event E]         fire-and-forget state (hook)",
          "  archive                          archive last Stop transcript (hook)",
          "  usage                            GET /api/llm/usage/summary",
          "  install-hooks                    merge into ~/.claude/settings.json",
          "  uninstall-hooks                  strip plugin hook block",
          "  hooks-status                     report merge state",
          "  help                             this help",
          "",
        ].join("\n"),
      );
      return;
    }
    default: {
      err("UNKNOWN_SUBCOMMAND", `Unknown subcommand: ${sub || "(none)"}`, {
        valid: [
          "version",
          "setup",
          "setup-status",
          "install",
          "login",
          "guest-login",
          "pet",
          "state",
          "archive",
          "usage",
          "install-hooks",
          "uninstall-hooks",
          "hooks-status",
          "help",
        ],
      });
      return;
    }
  }
}

main().catch((e) => {
  // Top-level catch: print JSON, exit 1.
  process.stdout.write(
    JSON.stringify({
      ok: false,
      code: "UNEXPECTED",
      error: String(e?.stack || e?.message || e),
    }) + EOL,
  );
  process.exit(1);
});
