import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { platform } from "node:os";

import type { AgentOptions } from "@openloomi/ai/agent/types";

export interface OpenCodeProviderConfig {
  opencodePath?: string;
  agent?: string;
  files?: string[];
  allowAutoApprove?: boolean;
  env?: Record<string, string>;
}

export interface OpenCodeRunCommandOptions {
  prompt: string;
  cwd: string;
  model?: string;
  permissionMode?: AgentOptions["permissionMode"];
  providerConfig?: Record<string, unknown>;
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
  },
): AsyncGenerator<OpenCodeCliEvent> {
  const startTime = Date.now();
  const events: OpenCodeCliEvent[] = [];
  let notify: (() => void) | undefined;
  let stdout = "";
  let stderr = "";
  let stdoutBuffer = "";
  let done = false;
  let spawnError: Error | undefined;
  let proc: ChildProcessWithoutNullStreams;

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
      env: { ...process.env, ...options.env },
      windowsHide: true,
    });
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
    killProcessTree(proc);
  };

  options.signal?.addEventListener("abort", abortHandler, { once: true });
  if (options.signal?.aborted) {
    abortHandler();
  }

  proc.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stdout += text;
    stdoutBuffer += text;
    flushStdoutLines();
  });

  proc.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  proc.on("error", (error: Error & { code?: string }) => {
    spawnError = isCommandNotFoundError(error)
      ? new OpenCodeCommandNotFoundError(command)
      : error;
    done = true;
    wake();
  });

  proc.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
    if (stdoutBuffer.trim()) {
      push({ type: "line", line: stdoutBuffer });
      stdoutBuffer = "";
    }
    push({
      type: "close",
      stdout,
      stderr,
      exitCode: code ?? (signal ? 130 : 0),
      duration: Date.now() - startTime,
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
    options.signal?.removeEventListener("abort", abortHandler);
  }
}

function killProcessTree(proc: ChildProcessWithoutNullStreams) {
  if (proc.killed) {
    return;
  }

  if (platform() === "win32" && proc.pid) {
    spawn("taskkill", ["/F", "/T", "/PID", String(proc.pid)], {
      windowsHide: true,
      stdio: "ignore",
    }).on("error", () => {
      proc.kill();
    });
    return;
  }

  proc.kill("SIGTERM");
}

function isCommandNotFoundError(error: Error & { code?: string }) {
  return error.code === "ENOENT";
}
