import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

import {
  appendCapturedCliOutput,
  buildCliEnvironment,
  MAX_CLI_PROTOCOL_LINE_CHARS,
  shouldDetachCliProcess,
  terminateCliProcessTree,
} from "../cli-process";

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

export type AcpStdioClientEvent =
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

export type AcpStdioClientRequestHandler = (request: {
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

export class AcpCommandNotFoundError extends Error {
  constructor(runtimeName: string, command: string) {
    super(
      `${runtimeName} ACP executable not found: ${command}. Install ${runtimeName} with ACP support or configure its OPENLOOMI_AGENT_*_COMMAND environment variable.`,
    );
    this.name = "AcpCommandNotFoundError";
  }
}

export class AcpExitError extends Error {
  constructor(
    message: string,
    readonly exitCode?: number,
  ) {
    super(message);
    this.name = "AcpExitError";
  }
}

export class AcpJsonRpcError extends Error {
  constructor(
    readonly runtimeName: string,
    readonly method: string,
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(`${runtimeName} ACP ${method} failed: ${message}`);
    this.name = "AcpJsonRpcError";
  }
}

export class AcpStdioClient {
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
  private eventQueue = new AsyncQueue<AcpStdioClientEvent>();
  private resolveClosed?: () => void;
  private readonly stdoutDecoder = new StringDecoder("utf8");
  private readonly stderrDecoder = new StringDecoder("utf8");
  private readonly closedPromise = new Promise<void>((resolve) => {
    this.resolveClosed = resolve;
  });

  constructor(
    private readonly runtimeName: string,
    private readonly command: string,
    private readonly args: string[],
    private readonly options: {
      cwd: string;
      signal?: AbortSignal;
      timeoutMs?: number;
      onRequest?: AcpStdioClientRequestHandler;
    },
  ) {}

  start(): void {
    if (this.proc) {
      return;
    }

    try {
      this.proc = spawn(this.command, this.args, {
        cwd: this.options.cwd,
        env: buildCliEnvironment(),
        detached: shouldDetachCliProcess(),
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
      const text = this.stdoutDecoder.write(chunk);
      this.stdout = appendCapturedCliOutput(this.stdout, text);
      this.stdoutBuffer += text;
      if (this.stdoutBuffer.length > MAX_CLI_PROTOCOL_LINE_CHARS) {
        const error = new AcpExitError(
          `${this.runtimeName} ACP emitted a JSON line larger than ${MAX_CLI_PROTOCOL_LINE_CHARS} characters`,
        );
        this.rejectAll(error);
        this.eventQueue.push({ type: "diagnostic", message: error.message });
        this.kill();
        return;
      }
      this.flushStdoutLines();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      this.stderr = appendCapturedCliOutput(
        this.stderr,
        this.stderrDecoder.write(chunk),
      );
    });

    proc.on("error", (error: Error & { code?: string }) => {
      const err = isCommandNotFoundError(error)
        ? new AcpCommandNotFoundError(this.runtimeName, this.command)
        : error;
      this.rejectAll(err);
      this.eventQueue.push({ type: "diagnostic", message: err.message });
      this.finish();
    });

    proc.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      const finalStdout = this.stdoutDecoder.end();
      if (finalStdout) {
        this.stdout = appendCapturedCliOutput(this.stdout, finalStdout);
        this.stdoutBuffer += finalStdout;
      }
      this.stderr = appendCapturedCliOutput(
        this.stderr,
        this.stderrDecoder.end(),
      );
      const exitCode = this.timedOut ? 124 : (code ?? (signal ? 130 : 0));
      const closeEvent: AcpStdioClientEvent = {
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

      const exitError =
        this.formatExitError(closeEvent) ??
        this.formatPendingRequestExitError(closeEvent);
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

  nextEvent(): Promise<AcpStdioClientEvent | undefined> {
    return this.eventQueue.shift();
  }

  drainEvents(): AcpStdioClientEvent[] {
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

    terminateCliProcessTree(this.proc);
  }

  private readonly abortHandler = () => {
    this.cancelPendingAgentRequests();
    this.kill();
  };

  private write(message: Record<string, unknown>): void {
    if (!this.proc || this.closed) {
      throw new Error(`${this.runtimeName} ACP process is not running`);
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
        message: `${this.runtimeName} ACP emitted invalid JSON: ${line}`,
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
          new AcpJsonRpcError(
            this.runtimeName,
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
      const diagnostic = `Unsupported ${this.runtimeName} ACP client method: ${message.method}`;
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
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.pendingAgentRequests.clear();
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
      ? new AcpCommandNotFoundError(this.runtimeName, this.command)
      : err;
  }

  private formatExitError(
    closeEvent: Extract<AcpStdioClientEvent, { type: "close" }>,
  ): AcpExitError | undefined {
    if (closeEvent.exitCode === 0) {
      return undefined;
    }

    const output = closeEvent.stderr.trim() || closeEvent.stdout.trim();
    if (closeEvent.timedOut) {
      return new AcpExitError(
        output
          ? `${this.runtimeName} ACP timed out after ${closeEvent.timeoutMs}ms: ${output}`
          : `${this.runtimeName} ACP timed out after ${closeEvent.timeoutMs}ms`,
        closeEvent.exitCode,
      );
    }

    return new AcpExitError(
      output
        ? `${this.runtimeName} ACP exited with code ${closeEvent.exitCode}: ${output}`
        : `${this.runtimeName} ACP exited with code ${closeEvent.exitCode}`,
      closeEvent.exitCode,
    );
  }

  private formatPendingRequestExitError(
    closeEvent: Extract<AcpStdioClientEvent, { type: "close" }>,
  ): AcpExitError | undefined {
    if (this.pendingRequests.size === 0) {
      return undefined;
    }

    const methods = [
      ...new Set(
        [...this.pendingRequests.values()].map((request) => request.method),
      ),
    ].join(", ");
    return new AcpExitError(
      `${this.runtimeName} ACP exited before responding to pending request(s): ${methods}`,
      closeEvent.exitCode,
    );
  }
}

class AsyncQueue<T> {
  private items: T[] = [];
  private waiters: Array<(value: T | undefined) => void> = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) {
      return;
    }
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

function isCommandNotFoundError(error: Error & { code?: string }) {
  return error.code === "ENOENT";
}

function isJsonRpcResponse(
  message: JsonRpcMessage,
): message is JsonRpcResponse {
  return "id" in message && message.id !== undefined;
}
