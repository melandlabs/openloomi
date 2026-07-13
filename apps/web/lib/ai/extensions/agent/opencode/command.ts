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

export interface OpenCodeProviderConfig {
  opencodePath?: string;
  agent?: string;
  files?: string[];
  allowAutoApprove?: boolean;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface OpenCodeRunCommandOptions {
  prompt: string;
  cwd: string;
  model?: string;
  permissionMode?: AgentOptions["permissionMode"];
  providerConfig?: Record<string, unknown>;
  attachmentFiles?: string[];
}

export interface OpenCodeRunCommand {
  command: string;
  args: string[];
}

export type OpenCodeCliEvent =
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

export class OpenCodeCommandNotFoundError extends Error {
  constructor(command: string) {
    super(
      `OpenCode CLI executable not found: ${command}. Install OpenCode or set providerConfig.opencodePath to the opencode executable.`,
    );
    this.name = "OpenCodeCommandNotFoundError";
  }
}

export function normalizeOpenCodeProviderConfig(
  value: Record<string, unknown> | undefined,
): OpenCodeProviderConfig {
  const files = Array.isArray(value?.files)
    ? value.files
        .filter((file): file is string => typeof file === "string")
        .map((file) => file.trim())
        .filter((file) => file.length > 0 && !file.startsWith("-"))
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
    opencodePath:
      typeof value?.opencodePath === "string" && value.opencodePath.trim()
        ? value.opencodePath
        : undefined,
    agent:
      typeof value?.agent === "string" && value.agent.trim()
        ? value.agent
        : undefined,
    files,
    allowAutoApprove: value?.allowAutoApprove === true,
    timeoutMs:
      typeof value?.timeoutMs === "number" &&
      Number.isInteger(value.timeoutMs) &&
      value.timeoutMs > 0
        ? value.timeoutMs
        : undefined,
    env,
  };
}

export function buildOpenCodeRunCommand(
  options: OpenCodeRunCommandOptions,
): OpenCodeRunCommand {
  const providerConfig = normalizeOpenCodeProviderConfig(
    options.providerConfig,
  );
  const args = ["run", "--format", "json", "--dir", options.cwd];

  if (options.model) {
    args.push("--model", options.model);
  }
  if (providerConfig.agent) {
    args.push("--agent", providerConfig.agent);
  }
  for (const file of providerConfig.files ?? []) {
    args.push("--file", file);
  }
  for (const file of options.attachmentFiles ?? []) {
    args.push("--file", file);
  }
  if (
    options.permissionMode === "bypassPermissions" &&
    providerConfig.allowAutoApprove
  ) {
    args.push("--auto");
  }

  args.push(options.prompt);

  return {
    command: providerConfig.opencodePath || "opencode",
    args,
  };
}

export async function* runOpenCodeCli(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: Record<string, string>;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): AsyncGenerator<OpenCodeCliEvent> {
  const startTime = Date.now();
  const events: OpenCodeCliEvent[] = [];
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

  const push = (event: OpenCodeCliEvent) => {
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
    // OpenCode accepts the prompt positionally. Close the otherwise unused
    // pipe so current CLI versions do not wait for additional stdin input.
    proc.stdin.end();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (isCommandNotFoundError(err)) {
      throw new OpenCodeCommandNotFoundError(command);
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
        `OpenCode CLI emitted a JSON line larger than ${MAX_CLI_PROTOCOL_LINE_CHARS} characters`,
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
      ? new OpenCodeCommandNotFoundError(command)
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

function isCommandNotFoundError(error: Error & { code?: string }) {
  return error.code === "ENOENT";
}
