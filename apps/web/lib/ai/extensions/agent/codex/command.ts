import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

import spawn from "cross-spawn";

import type { AgentOptions } from "@openloomi/ai/agent/types";
import {
  appendCapturedCliOutput,
  buildCliEnvironment,
  MAX_CLI_PROTOCOL_LINE_CHARS,
  shouldDetachCliProcess,
  terminateCliProcessTree,
} from "../cli-process";

export type CodexSandboxMode =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

export type CodexApprovalPolicy =
  | "untrusted"
  | "on-failure"
  | "on-request"
  | "never";

export type CodexRunMode = "run" | "plan" | "execute";

export interface CodexProviderConfig {
  codexPath?: string;
  profile?: string;
  sandbox?: CodexSandboxMode;
  /**
   * @deprecated Codex CLI 0.144 removed the `--ask-for-approval` flag and
   * replaced it with a single `--dangerously-bypass-approvals-and-sandbox`
   * switch. This field is preserved so existing user/provider config keeps
   * parsing, but `buildCodexRunCommand` no longer forwards it to the CLI.
   */
  askForApproval?: CodexApprovalPolicy;
  fullAuto?: boolean;
  skipGitRepoCheck?: boolean;
  timeoutMs?: number;
  extraArgs?: string[];
  env?: Record<string, string>;
}

export interface CodexRunCommandOptions {
  prompt: string;
  cwd: string;
  model?: string;
  permissionMode?: AgentOptions["permissionMode"];
  /**
   * Planning-mode callers pass `plan` to force `read-only` sandbox and disable
   * `--full-auto`. The plan/execute contract mirrors the OpenCode runtime.
   */
  mode?: CodexRunMode;
  providerConfig?: Record<string, unknown>;
}

export interface CodexRunCommand {
  command: string;
  args: string[];
}

export type CodexCliEvent =
  | { type: "line"; line: string }
  | {
      type: "close";
      stdout: string;
      stderr: string;
      exitCode: number;
      duration: number;
      timedOut?: boolean;
      timeoutMs?: number;
    };

export class CodexCommandNotFoundError extends Error {
  constructor(command: string) {
    super(
      `Codex CLI executable not found: ${command}. Install the Codex CLI (https://github.com/openai/codex) or set providerConfig.codexPath to the codex executable.`,
    );
    this.name = "CodexCommandNotFoundError";
  }
}

const SANDBOX_VALUES: ReadonlySet<CodexSandboxMode> = new Set([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);

const APPROVAL_VALUES: ReadonlySet<CodexApprovalPolicy> = new Set([
  "untrusted",
  "on-failure",
  "on-request",
  "never",
]);

export function normalizeCodexProviderConfig(
  value: Record<string, unknown> | undefined,
): CodexProviderConfig {
  const sandbox = readString(value?.sandbox);
  const askForApproval = readString(value?.askForApproval);
  const extraArgs = Array.isArray(value?.extraArgs)
    ? value.extraArgs
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0 && !entry.startsWith("-"))
    : undefined;
  const env =
    value?.env && typeof value.env === "object" && !Array.isArray(value.env)
      ? Object.fromEntries(
          Object.entries(value.env as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : undefined;

  return {
    codexPath: readString(value?.codexPath),
    profile: readString(value?.profile),
    sandbox:
      sandbox && SANDBOX_VALUES.has(sandbox as CodexSandboxMode)
        ? (sandbox as CodexSandboxMode)
        : undefined,
    askForApproval:
      askForApproval &&
      APPROVAL_VALUES.has(askForApproval as CodexApprovalPolicy)
        ? (askForApproval as CodexApprovalPolicy)
        : undefined,
    fullAuto: value?.fullAuto === true,
    skipGitRepoCheck: value?.skipGitRepoCheck !== false,
    timeoutMs:
      typeof value?.timeoutMs === "number" &&
      Number.isInteger(value.timeoutMs) &&
      value.timeoutMs > 0
        ? value.timeoutMs
        : undefined,
    extraArgs,
    env,
  };
}

/**
 * Resolve the sandbox that OpenLoomi passes to `codex exec`.
 *
 * Codex's macOS `workspace-write` sandbox blocks all outbound networking,
 * including loopback requests to OpenLoomi's local API. OpenLoomi therefore
 * runs execution turns without that sandbox on macOS. The explicit
 * `danger-full-access` value is intentional: omitting `--sandbox` would let a
 * Codex profile or CLI default silently re-enable the network-blocking sandbox.
 * Planning remains read-only, and an explicitly configured read-only sandbox
 * is preserved.
 */
export function resolveCodexSandboxMode(
  mode: CodexRunMode,
  configuredSandbox: CodexSandboxMode | undefined,
  platform: NodeJS.Platform = process.platform,
): CodexSandboxMode {
  if (mode === "plan") {
    return "read-only";
  }

  const sandbox = configuredSandbox ?? "workspace-write";
  if (platform === "darwin" && sandbox === "workspace-write") {
    return "danger-full-access";
  }

  return sandbox;
}

/**
 * Build the `codex exec --json ...` argv. Every provider-configurable value
 * passes through normalization first so unexpected input cannot inject Codex
 * flags or override `--full-auto`/`--sandbox` policy decisions.
 */
export function buildCodexRunCommand(
  options: CodexRunCommandOptions,
): CodexRunCommand {
  const providerConfig = normalizeCodexProviderConfig(options.providerConfig);
  const mode = options.mode ?? "run";

  const args = ["exec", "--json"];

  if (providerConfig.profile) {
    args.push("-p", providerConfig.profile);
  }
  if (options.model) {
    args.push("-m", options.model);
  }
  args.push("--sandbox", resolveCodexSandboxMode(mode, providerConfig.sandbox));
  if (providerConfig.skipGitRepoCheck) {
    args.push("--skip-git-repo-check");
  }
  if (
    mode !== "plan" &&
    options.permissionMode === "bypassPermissions" &&
    providerConfig.fullAuto
  ) {
    args.push("--full-auto");
  }

  if (providerConfig.extraArgs && providerConfig.extraArgs.length > 0) {
    args.push("--", ...providerConfig.extraArgs);
  }

  args.push(options.prompt);

  return {
    command: providerConfig.codexPath || "codex",
    args,
  };
}

export async function* runCodexCli(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: Record<string, string>;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): AsyncGenerator<CodexCliEvent> {
  const startTime = Date.now();
  const events: CodexCliEvent[] = [];
  let notify: (() => void) | undefined;
  let stdout = "";
  let stderr = "";
  let stdoutBuffer = "";
  let done = false;
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let spawnError: Error | undefined;
  let proc: ChildProcessWithoutNullStreams;
  const stdoutDecoder = new StringDecoder("utf8");
  const stderrDecoder = new StringDecoder("utf8");

  const push = (event: CodexCliEvent) => {
    events.push(event);
    notify?.();
    notify = undefined;
  };

  const wake = () => {
    notify?.();
    notify = undefined;
  };

  try {
    proc = spawn(command, args, {
      cwd: options.cwd,
      env: buildCliEnvironment(options.env),
      detached: shouldDetachCliProcess(),
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
    // Codex CLI 0.144+ reads the prompt from argv but ALSO blocks waiting
    // for stdin to reach EOF whenever stdin is a piped stream (e.g.
    // `node`'s default `pipe` stdio). Without this explicit close the
    // child process hangs in "Reading additional input from stdin..."
    // forever and the SSE stream never receives any events. We never write
    // to stdin ourselves (the prompt is passed positionally), so closing
    // it immediately is safe and signals EOF to the CLI.
    proc.stdin.end();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (isCommandNotFoundError(err)) {
      throw new CodexCommandNotFoundError(command);
    }
    throw err;
  }

  const flushStdoutLines = () => {
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) {
        push({ type: "line", line });
      }
    }
  };

  const abortHandler = () => {
    terminateCliProcessTree(proc);
  };

  options.signal?.addEventListener("abort", abortHandler, { once: true });
  if (options.signal?.aborted) {
    abortHandler();
  }
  if (options.timeoutMs && options.timeoutMs > 0) {
    timeout = setTimeout(() => {
      timedOut = true;
      terminateCliProcessTree(proc);
    }, options.timeoutMs);
  }

  proc.stdout.on("data", (chunk: Buffer) => {
    const text = stdoutDecoder.write(chunk);
    stdout = appendCapturedCliOutput(stdout, text);
    stdoutBuffer += text;
    if (stdoutBuffer.length > MAX_CLI_PROTOCOL_LINE_CHARS) {
      spawnError = new Error(
        `Codex CLI emitted a JSON line larger than ${MAX_CLI_PROTOCOL_LINE_CHARS} characters`,
      );
      done = true;
      terminateCliProcessTree(proc);
      wake();
      return;
    }
    flushStdoutLines();
  });

  proc.stderr.on("data", (chunk: Buffer) => {
    stderr = appendCapturedCliOutput(stderr, stderrDecoder.write(chunk));
  });

  proc.on("error", (error: Error & { code?: string }) => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
    }
    spawnError = isCommandNotFoundError(error)
      ? new CodexCommandNotFoundError(command)
      : error;
    done = true;
    wake();
  });

  proc.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
    }
    const finalStdout = stdoutDecoder.end();
    if (finalStdout) {
      stdout = appendCapturedCliOutput(stdout, finalStdout);
      stdoutBuffer += finalStdout;
    }
    stderr = appendCapturedCliOutput(stderr, stderrDecoder.end());
    if (stdoutBuffer.trim()) {
      push({ type: "line", line: stdoutBuffer });
      stdoutBuffer = "";
    }
    push({
      type: "close",
      stdout,
      stderr,
      exitCode: timedOut ? 124 : (code ?? (signal ? 130 : 0)),
      duration: Date.now() - startTime,
      timedOut,
      timeoutMs: timedOut ? options.timeoutMs : undefined,
    });
    done = true;
    wake();
  });

  try {
    while (!done || events.length > 0) {
      const event = events.shift();
      if (event) {
        yield event;
        continue;
      }
      if (spawnError) {
        throw spawnError;
      }
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
      if (spawnError) {
        throw spawnError;
      }
    }
    if (spawnError) {
      throw spawnError;
    }
  } finally {
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
    }
    options.signal?.removeEventListener("abort", abortHandler);
    if (!done) {
      terminateCliProcessTree(proc);
    }
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isCommandNotFoundError(error: Error & { code?: string }) {
  return error.code === "ENOENT";
}
