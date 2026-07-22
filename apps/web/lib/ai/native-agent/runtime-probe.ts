/**
 * Server-side probe for the user's local Claude Code runtime.
 *
 * Single source of truth for "can the user talk to Claude right now". It
 * replaces the previous reliance on `process.env.ANTHROPIC_*` for
 * AI-provider readiness — the user's host-side `claude auth login` is the
 * actual signal, not whatever env vars happened to be set when the
 * OpenLoomi process started.
 *
 * The plugin (plugins/claude) reads this probe via `/api/preferences/ai`
 * rather than spawning its own copies of `claude --version` /
 * `claude auth status`. One probe per node process, cached briefly.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { delimiter, join } from "node:path";
import { homedir, platform } from "node:os";

import { createLogger } from "@/lib/utils/logger";

const PROBE_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 30_000;

const logger = createLogger("NativeClaudeRuntime");

export type NativeRuntimeStatus =
  | "CLAUDE_CLI_AUTHENTICATED"
  | "CLAUDE_CLI_AUTH_REQUIRED"
  | "CLAUDE_CLI_AUTH_STATUS_TIMEOUT"
  | "CLAUDE_CLI_AUTH_STATUS_UNAVAILABLE"
  | "CLAUDE_CLI_VERSION_FAILED"
  | "CLAUDE_CLI_VERSION_TIMEOUT"
  | "CLAUDE_CLI_UNAVAILABLE";

export type ProbeResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error: { code: string; message: string } | null;
  elapsedMs: number;
  timedOut: boolean;
};

export type NativeRuntimeProbe = {
  checked: true;
  available: boolean;
  authenticated: boolean;
  active: boolean;
  ready: boolean;
  reason: NativeRuntimeStatus;
  defaultAgent: "claude";
  cliPathPresent: boolean;
  cliPathSource: "PATH" | "CLAUDE_CODE_PATH" | "FALLBACK" | null;
  versionPresent: boolean;
  probes: {
    version?: ProbeResult;
    auth?: ProbeResult;
  };
};

let cache: { at: number; value: NativeRuntimeProbe | null } | null = null;

function candidateBinaries(): string[] {
  // On Windows the user's installer can drop `claude.exe` (native) or a
  // `claude.cmd` shim; npm globals also produce `claude.ps1` + `claude.cmd`
  // pairs. The portable `.exe` is what we want to spawn, but checking all
  // three keeps us aligned with how Windows resolves PATH lookups.
  if (platform() === "win32") {
    return ["claude.exe", "claude.cmd", "claude"];
  }
  return ["claude"];
}

// GUI apps launched via `open -a` (or directly by launchd on macOS) inherit
// a stripped PATH that usually drops user bin dirs like `~/Library/pnpm`,
// `~/.nvm/versions/node/*/bin`, `~/.local/bin`, etc. The bridge plugin
// works around this with its own `getClaudeCliProbePath()` — we mirror
// that here and additionally glob the nvm versions dir, since nvm can't
// be expressed as a single PATH entry. Without this, `claude auth status`
// appears "missing" to the embedded Next.js server even though the user's
// terminal can run it just fine, which makes the "API key needed" onboarding
// card falsely appear.
function buildClaudeSearchPath(): string {
  const home = homedir();
  const dirs: string[] = [process.env.PATH || ""];

  if (platform() === "win32") {
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
      join(home, ".bun", "bin"),
      join(home, "Library", "pnpm"),
      join(home, ".local", "share", "pnpm"),
      join(home, "code", "node", "npm_global", "bin"),
    );
  }

  return Array.from(new Set(dirs.filter(Boolean))).join(delimiter);
}

// nvm bins aren't on PATH under launchd and can't be added as a single
// entry, so we glob `~/.nvm/versions/node/*/bin/claude` and return the
// newest version's binary. Empty list means no nvm-managed claude (or
// no nvm at all).
function listNvmClaudeBinaries(): string[] {
  try {
    const nvmBase = join(homedir(), ".nvm", "versions", "node");
    if (!existsSync(nvmBase)) return [];
    return readdirSync(nvmBase)
      .sort()
      .reverse() // newest version first
      .map((version) => join(nvmBase, version, "bin", "claude"))
      .filter((candidate) => existsSync(candidate));
  } catch {
    return [];
  }
}

function resolveClaudeCliPath(): {
  path: string | null;
  source: "PATH" | "CLAUDE_CODE_PATH" | "FALLBACK" | null;
} {
  const explicit = process.env.CLAUDE_CODE_PATH;
  if (explicit && existsSync(explicit)) {
    return { path: explicit, source: "CLAUDE_CODE_PATH" };
  }

  // 1. Standard PATH walk, augmented with the common install dirs above.
  const pathEnv = buildClaudeSearchPath();
  const pathDirs = pathEnv.split(delimiter).filter(Boolean);
  for (const bin of candidateBinaries()) {
    for (const dir of pathDirs) {
      const candidate = join(dir, bin);
      if (existsSync(candidate)) {
        return { path: candidate, source: "PATH" };
      }
    }
  }

  // 2. nvm version glob — covers installs under `~/.nvm/versions/node/*`.
  const nvmBins = listNvmClaudeBinaries();
  if (nvmBins.length > 0) {
    return { path: nvmBins[0], source: "FALLBACK" };
  }

  return { path: null, source: null };
}

function runCli(
  command: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<ProbeResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    let timedOut = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      resolve(result);
    };

    let proc: ChildProcess;
    try {
      proc = spawn(command, [...args], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, CLAUDECODE: "" },
        windowsHide: true,
      });
    } catch (error) {
      settle({
        ok: false,
        stdout: "",
        stderr: "",
        exitCode: null,
        error: {
          code: "SPAWN_FAILED",
          message: error instanceof Error ? error.message : String(error),
        },
        elapsedMs: 0,
        timedOut: false,
      });
      return;
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    proc.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill("SIGKILL");
      } catch {
        // already dead
      }
    }, timeoutMs);

    proc.on("error", (error) => {
      settle({
        ok: false,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        exitCode: null,
        error: { code: "SPAWN_FAILED", message: error.message },
        elapsedMs: Date.now() - startedAt,
        timedOut: false,
      });
    });

    proc.on("close", (code) => {
      settle({
        ok: code === 0 && !timedOut,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        exitCode: code,
        error: null,
        elapsedMs: Date.now() - startedAt,
        timedOut,
      });
    });
  });
}

function classifyAuthFailure(result: ProbeResult): NativeRuntimeStatus {
  if (result.timedOut) return "CLAUDE_CLI_AUTH_STATUS_TIMEOUT";
  const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (
    combined.includes("not authenticated") ||
    combined.includes("not logged") ||
    combined.includes("not signed") ||
    combined.includes("please login") ||
    combined.includes("/login")
  ) {
    return "CLAUDE_CLI_AUTH_REQUIRED";
  }
  if (
    combined.includes("unknown command") ||
    combined.includes("invalid command")
  ) {
    return "CLAUDE_CLI_AUTH_STATUS_UNAVAILABLE";
  }
  return "CLAUDE_CLI_AUTH_REQUIRED";
}

export async function probeNativeClaudeRuntime(): Promise<NativeRuntimeProbe | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }

  const resolved = resolveClaudeCliPath();
  if (!resolved.path) {
    const probe: NativeRuntimeProbe = {
      checked: true,
      available: false,
      authenticated: false,
      active: false,
      ready: false,
      reason: "CLAUDE_CLI_UNAVAILABLE",
      defaultAgent: "claude",
      cliPathPresent: false,
      cliPathSource: null,
      versionPresent: false,
      probes: {},
    };
    cache = { at: Date.now(), value: probe };
    return probe;
  }

  const versionProbe = await runCli(
    resolved.path,
    ["--version"],
    PROBE_TIMEOUT_MS,
  );
  if (!versionProbe.ok) {
    const probe: NativeRuntimeProbe = {
      checked: true,
      available: true,
      authenticated: false,
      active: false,
      ready: false,
      reason: versionProbe.timedOut
        ? "CLAUDE_CLI_VERSION_TIMEOUT"
        : "CLAUDE_CLI_VERSION_FAILED",
      defaultAgent: "claude",
      cliPathPresent: true,
      cliPathSource: resolved.source,
      versionPresent: false,
      probes: { version: versionProbe },
    };
    logger.warn(
      `[NativeClaudeRuntime] version probe failed: ${probe.reason} (${resolved.path})`,
    );
    cache = { at: Date.now(), value: probe };
    return probe;
  }

  const authProbe = await runCli(
    resolved.path,
    ["auth", "status"],
    PROBE_TIMEOUT_MS,
  );

  if (!authProbe.ok) {
    const reason = classifyAuthFailure(authProbe);
    const probe: NativeRuntimeProbe = {
      checked: true,
      available: true,
      authenticated: false,
      active: false,
      ready: false,
      reason,
      defaultAgent: "claude",
      cliPathPresent: true,
      cliPathSource: resolved.source,
      versionPresent: true,
      probes: { version: versionProbe, auth: authProbe },
    };
    cache = { at: Date.now(), value: probe };
    return probe;
  }

  const probe: NativeRuntimeProbe = {
    checked: true,
    available: true,
    authenticated: true,
    active: true,
    ready: true,
    reason: "CLAUDE_CLI_AUTHENTICATED",
    defaultAgent: "claude",
    cliPathPresent: true,
    cliPathSource: resolved.source,
    versionPresent: true,
    probes: { version: versionProbe, auth: authProbe },
  };
  cache = { at: Date.now(), value: probe };
  return probe;
}

export function clearNativeClaudeRuntimeCache(): void {
  cache = null;
}
