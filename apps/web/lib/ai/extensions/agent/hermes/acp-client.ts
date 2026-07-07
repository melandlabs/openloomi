import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { platform } from "node:os";

type JsonRpcId = string | number;

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc?: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse;

export type HermesAcpClientEvent =
  | { type: "notification"; method: string; params?: unknown }
  | { type: "diagnostic"; message: string }
  | {
      type: "close";
      exitCode: number;
      stderr: string;
      stdout: string;
      timedOut?: boolean;
      timeoutMs?: number;
    };

export type HermesAcpClientRequestHandler = (request: {
  id: JsonRpcId;
  method: string;
  params?: unknown;
}) => Promise<unknown>;

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface PendingAgentRequest {
  method: string;
}

export class HermesAcpCommandNotFoundError extends Error {
  constructor(command: string) {
    super(
      `Hermes ACP executable not found: ${command}. Install Hermes with ACP support or set OPENLOOMI_AGENT_HERMES_COMMAND to the Hermes executable.`,
    );
    this.name = "HermesAcpCommandNotFoundError";
  }
}

export class HermesAcpExitError extends Error {
  constructor(
    message: string,
    readonly exitCode?: number,
  ) {
    super(message);
    this.name = "HermesAcpExitError";
  }
}

export class HermesAcpJsonRpcError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(`Hermes ACP ${method} failed: ${message}`);
    this.name = "HermesAcpJsonRpcError";
  }
}

export class HermesAcpClient {
  private proc?: ChildProcessWithoutNullStreams;
  private requestCounter = 0;
  private stdout = "";
  private stderr = "";
  private stdoutBuffer = "";
  private timeout?: ReturnType<typeof setTimeout>;
  private timedOut = false;
  private closed = false;
  private pendingRequests = new Map<JsonRpcId, PendingRequest>();
  private pendingAgentRequests = new Map<JsonRpcId, PendingAgentRequest>();
  private eventQueue = new AsyncQueue<HermesAcpClientEvent>();
  private resolveClosed?: () => void;
  private readonly closedPromise = new Promise<void>((resolve) => {
    this.resolveClosed = resolve;
  });

  constructor(
    private readonly command: string,
    private readonly args: string[],
    private readonly options: {
      cwd: string;
      signal?: AbortSignal;
      timeoutMs?: number;
      onRequest?: HermesAcpClientRequestHandler;
    },
  ) {}

  start(): void {
    if (this.proc) {
      return;
    }

    try {
      this.proc = spawn(this.command, this.args, {
        cwd: this.options.cwd,
        env: process.env,
        windowsHide: true,
      });
    } catch (error) {
      const err = this.normalizeSpawnError(error);
      throw err;
    }

    const proc = this.proc;

    this.options.signal?.addEventListener("abort", this.abortHandler, {
      once: true,
    });
    if (this.options.signal?.aborted) {
      this.abortHandler();
    }

    if (this.options.timeoutMs && this.options.timeoutMs > 0) {
      this.timeout = setTimeout(() => {
        this.timedOut = true;
        this.kill();
      }, this.options.timeoutMs);
    }

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      this.stdout += text;
      this.stdoutBuffer += text;
      this.flushStdoutLines();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString();
    });

    proc.on("error", (error: Error & { code?: string }) => {
      const err = isCommandNotFoundError(error)
        ? new HermesAcpCommandNotFoundError(this.command)
        : error;
      this.rejectAll(err);
      this.eventQueue.push({ type: "diagnostic", message: err.message });
      this.finish();
    });

    proc.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      const exitCode = this.timedOut ? 124 : (code ?? (signal ? 130 : 0));
      const closeEvent: HermesAcpClientEvent = {
        type: "close",
        exitCode,
        stderr: this.stderr,
        stdout: this.stdout,
        timedOut: this.timedOut,
        timeoutMs: this.timedOut ? this.options.timeoutMs : undefined,
      };

      if (this.stdoutBuffer.trim()) {
        this.handleLine(this.stdoutBuffer);
        this.stdoutBuffer = "";
      }

      const exitError = this.formatExitError(closeEvent);
      if (exitError) {
        this.rejectAll(exitError);
      }

      this.eventQueue.push(closeEvent);
      this.finish();
    });
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = ++this.requestCounter;
    const message = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { method, resolve, reject });
      try {
        this.write(message);
      } catch (error) {
        this.pendingRequests.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  nextEvent(): Promise<HermesAcpClientEvent | undefined> {
    return this.eventQueue.shift();
  }

  drainEvents(): HermesAcpClientEvent[] {
    return this.eventQueue.drain();
  }

  async cancel(sessionId?: string): Promise<void> {
    this.cancelPendingAgentRequests();

    if (sessionId && !this.closed) {
      try {
        this.notify("session/cancel", { sessionId });
      } catch {
        // The process may already be gone; shutdown will still kill it.
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
    this.kill();
  }

  async shutdown(): Promise<void> {
    this.cancelPendingAgentRequests();
    this.kill();
    this.cleanup();
    await Promise.race([
      this.closedPromise,
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
  }

  kill(): void {
    if (!this.proc || this.proc.killed) {
      return;
    }

    killProcessTree(this.proc);
  }

  private readonly abortHandler = () => {
    this.cancelPendingAgentRequests();
    this.kill();
  };

  private write(message: Record<string, unknown>): void {
    if (!this.proc || this.closed) {
      throw new Error("Hermes ACP process is not running");
    }

    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private flushStdoutLines(): void {
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) {
        this.handleLine(line);
      }
    }
  }

  private handleLine(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.eventQueue.push({
        type: "diagnostic",
        message: `Hermes ACP emitted invalid JSON: ${line}`,
      });
      return;
    }

    if ("method" in message && message.method) {
      this.handleIncomingRequestOrNotification(message);
      return;
    }

    if (isJsonRpcResponse(message)) {
      this.handleResponse(message);
    }
  }

  private handleResponse(message: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(message.id);
    if (pending) {
      this.pendingRequests.delete(message.id);
      if (message.error) {
        pending.reject(
          new HermesAcpJsonRpcError(
            pending.method,
            message.error.code,
            message.error.message,
            message.error.data,
          ),
        );
        return;
      }
      pending.resolve(message.result);
      return;
    }

    if (this.pendingAgentRequests.has(message.id)) {
      this.pendingAgentRequests.delete(message.id);
    }
  }

  private handleIncomingRequestOrNotification(message: JsonRpcRequest): void {
    if (message.id === undefined) {
      this.eventQueue.push({
        type: "notification",
        method: message.method,
        params: message.params,
      });
      return;
    }

    if (message.method !== "session/request_permission") {
      const diagnostic = `Unsupported Hermes ACP client method: ${message.method}`;
      this.respondError(message.id, -32601, diagnostic);
      this.eventQueue.push({ type: "diagnostic", message: diagnostic });
      return;
    }

    this.pendingAgentRequests.set(message.id, { method: message.method });

    Promise.resolve(
      this.options.onRequest?.({
        id: message.id,
        method: message.method,
        params: message.params,
      }) ?? { outcome: { outcome: "cancelled" } },
    )
      .then((result) => {
        if (!this.pendingAgentRequests.has(message.id as JsonRpcId)) {
          return;
        }
        this.pendingAgentRequests.delete(message.id as JsonRpcId);
        this.respondResult(message.id as JsonRpcId, result);
      })
      .catch((error) => {
        if (!this.pendingAgentRequests.has(message.id as JsonRpcId)) {
          return;
        }
        this.pendingAgentRequests.delete(message.id as JsonRpcId);
        this.respondError(
          message.id as JsonRpcId,
          -32000,
          error instanceof Error ? error.message : String(error),
        );
      });
  }

  private respondResult(id: JsonRpcId, result: unknown): void {
    try {
      this.write({ jsonrpc: "2.0", id, result });
    } catch {
      // The process may have exited while the handler was resolving.
    }
  }

  private respondError(id: JsonRpcId, code: number, message: string): void {
    try {
      this.write({
        jsonrpc: "2.0",
        id,
        error: { code, message },
      });
    } catch {
      // The process may have exited while the handler was resolving.
    }
  }

  private cancelPendingAgentRequests(): void {
    for (const id of this.pendingAgentRequests.keys()) {
      this.respondResult(id, { outcome: { outcome: "cancelled" } });
      this.pendingAgentRequests.delete(id);
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private finish(): void {
    this.closed = true;
    this.cleanup();
    this.eventQueue.close();
    this.resolveClosed?.();
  }

  private cleanup(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
    this.options.signal?.removeEventListener("abort", this.abortHandler);
  }

  private normalizeSpawnError(error: unknown): Error {
    const err = error instanceof Error ? error : new Error(String(error));
    return isCommandNotFoundError(err as Error & { code?: string })
      ? new HermesAcpCommandNotFoundError(this.command)
      : err;
  }

  private formatExitError(
    closeEvent: Extract<HermesAcpClientEvent, { type: "close" }>,
  ): HermesAcpExitError | undefined {
    if (closeEvent.exitCode === 0) {
      return undefined;
    }

    const output = closeEvent.stderr.trim() || closeEvent.stdout.trim();
    if (closeEvent.timedOut) {
      return new HermesAcpExitError(
        output
          ? `Hermes ACP timed out after ${closeEvent.timeoutMs}ms: ${output}`
          : `Hermes ACP timed out after ${closeEvent.timeoutMs}ms`,
        closeEvent.exitCode,
      );
    }

    return new HermesAcpExitError(
      output
        ? `Hermes ACP exited with code ${closeEvent.exitCode}: ${output}`
        : `Hermes ACP exited with code ${closeEvent.exitCode}`,
      closeEvent.exitCode,
    );
  }
}

class AsyncQueue<T> {
  private items: T[] = [];
  private waiters: Array<(value: T | undefined) => void> = [];
  private closed = false;

  push(item: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
      return;
    }
    this.items.push(item);
  }

  shift(): Promise<T | undefined> {
    const item = this.items.shift();
    if (item !== undefined) {
      return Promise.resolve(item);
    }
    if (this.closed) {
      return Promise.resolve(undefined);
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter(undefined);
    }
  }

  drain(): T[] {
    return this.items.splice(0);
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

function isJsonRpcResponse(
  message: JsonRpcMessage,
): message is JsonRpcResponse {
  return "id" in message && message.id !== undefined;
}
