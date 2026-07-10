import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { platform } from "node:os";

const terminatingProcesses = new WeakSet<ChildProcessWithoutNullStreams>();
const POSIX_TERMINATION_GRACE_MS = 2_000;
export const MAX_CLI_PROTOCOL_LINE_CHARS = 16 * 1024 * 1024;
const MAX_CAPTURED_OUTPUT_CHARS = 1024 * 1024;
const DEFAULT_CLI_ENV_KEYS = new Set([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "TMP",
  "TEMP",
  "TMPDIR",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
]);
const RUNTIME_ENV_PREFIXES = ["OPENCODE_", "HERMES_", "OPENCLAW_"];

export function shouldDetachCliProcess(): boolean {
  return platform() !== "win32";
}

/**
 * Build a least-privilege environment for local agent CLIs. Runtime-specific
 * and model credentials are preserved, while unrelated app/database/auth
 * secrets are not inherited. Deployments can opt additional names in through
 * OPENLOOMI_AGENT_ENV_ALLOWLIST.
 */
export function buildCliEnvironment(
  overrides?: Record<string, string>,
): NodeJS.ProcessEnv {
  const extraKeys = new Set(
    (process.env.OPENLOOMI_AGENT_ENV_ALLOWLIST ?? "")
      .split(",")
      .map((key) => key.trim().toUpperCase())
      .filter(Boolean),
  );
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const normalizedKey = key.toUpperCase();
    if (
      DEFAULT_CLI_ENV_KEYS.has(normalizedKey) ||
      extraKeys.has(normalizedKey) ||
      RUNTIME_ENV_PREFIXES.some((prefix) => normalizedKey.startsWith(prefix))
    ) {
      env[key] = value;
    }
  }

  return { ...env, ...overrides };
}

export function appendCapturedCliOutput(
  current: string,
  chunk: string,
): string {
  const combined = current + chunk;
  return combined.length <= MAX_CAPTURED_OUTPUT_CHARS
    ? combined
    : combined.slice(-MAX_CAPTURED_OUTPUT_CHARS);
}

/**
 * Stop the CLI and descendants it launched. POSIX children are spawned as a
 * process-group leader so a disconnect cannot leave tool processes running.
 */
export function terminateCliProcessTree(
  proc: ChildProcessWithoutNullStreams,
): void {
  if (
    terminatingProcesses.has(proc) ||
    proc.exitCode !== null ||
    proc.signalCode !== null
  ) {
    return;
  }
  terminatingProcesses.add(proc);

  if (platform() === "win32" && proc.pid) {
    spawn("taskkill", ["/F", "/T", "/PID", String(proc.pid)], {
      windowsHide: true,
      stdio: "ignore",
    }).on("error", () => {
      proc.kill();
    });
    return;
  }

  signalPosixProcessGroup(proc, "SIGTERM");
  const forceKillTimer = setTimeout(() => {
    if (proc.exitCode === null && proc.signalCode === null) {
      signalPosixProcessGroup(proc, "SIGKILL");
    }
  }, POSIX_TERMINATION_GRACE_MS);
  forceKillTimer.unref();
  proc.once("close", () => clearTimeout(forceKillTimer));
}

function signalPosixProcessGroup(
  proc: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): void {
  try {
    if (proc.pid) {
      process.kill(-proc.pid, signal);
    } else {
      proc.kill(signal);
    }
  } catch {
    try {
      proc.kill(signal);
    } catch {
      // The process exited between the state check and the signal.
    }
  }
}
