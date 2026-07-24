import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";

import spawn from "cross-spawn";

import {
  appendCapturedCliOutput,
  buildCliEnvironment,
  MAX_CLI_PROTOCOL_LINE_CHARS,
  shouldDetachCliProcess,
  terminateCliProcessTree,
} from "../cli-process";
import {
  CodexCommandNotFoundError,
  runCodexCli,
  type CodexProviderConfig,
} from "./command";

const PREFLIGHT_TIMEOUT_MS = 5_000;
const PREFLIGHT_CACHE_TTL_MS = 60_000;
const MAX_MODEL_PAGES = 20;
const MAX_MODELS_IN_ERROR = 8;
const PREFLIGHT_CLIENT_VERSION = "1.0.0";

type JsonRpcId = string | number;

interface JsonRpcResponse {
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface ModelListEntry {
  id?: string;
  model?: string;
  displayName?: string;
}

interface ModelListResult {
  data: ModelListEntry[];
  nextCursor?: string | null;
}

export interface CodexRuntimePreflightOptions {
  command: string;
  cwd: string;
  model?: string;
  providerConfig: CodexProviderConfig;
  signal?: AbortSignal;
}

export interface CodexRuntimePreflightResult {
  version: string;
  availableModels?: string[];
  modelCatalogChecked: boolean;
}

export class CodexRuntimePreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexRuntimePreflightError";
  }
}

export class CodexModelCompatibilityError extends Error {
  constructor(
    readonly model: string,
    readonly installedVersion: string,
    readonly availableModels: string[],
  ) {
    const availableSummary = availableModels
      .slice(0, MAX_MODELS_IN_ERROR)
      .join(", ");
    const availableSuffix =
      availableModels.length > MAX_MODELS_IN_ERROR ? ", …" : "";
    const availableHint = availableSummary
      ? ` Models available from this installation include: ${availableSummary}${availableSuffix}.`
      : "";

    super(
      `The selected model "${model}" is not available in Codex CLI ${installedVersion}. It may require a newer Codex CLI or may not be available to this account. Upgrade Codex with \`codex update\` (or install the latest \`@openai/codex\`), restart OpenLoomi, or choose a compatible model.${availableHint}`,
    );
    this.name = "CodexModelCompatibilityError";
  }
}

interface CachedPreflight {
  expiresAt: number;
  result: Promise<CodexRuntimePreflightResult>;
}

const preflightCache = new Map<string, CachedPreflight>();

/**
 * Validate the installed Codex binary before starting a generation request.
 *
 * The version probe is mandatory because a missing or broken executable cannot
 * service the request. Model compatibility uses Codex's official app-server
 * `model/list` capability discovery instead of an OpenLoomi-maintained version
 * matrix that would become stale. Catalog discovery deliberately fails open:
 * older CLIs and temporary app-server/auth failures still get a chance to run
 * `codex exec`, whose original stderr is preserved for the user.
 */
export async function preflightCodexRuntime(
  options: CodexRuntimePreflightOptions,
): Promise<CodexRuntimePreflightResult> {
  throwIfAborted(options.signal);

  const cacheKey = createPreflightCacheKey(options);
  const now = Date.now();
  let cached = preflightCache.get(cacheKey);
  if (cached && cached.expiresAt <= now) {
    preflightCache.delete(cacheKey);
    cached = undefined;
  }

  if (!cached) {
    const result = runPreflight(options).catch((error) => {
      if (!(error instanceof CodexModelCompatibilityError)) {
        preflightCache.delete(cacheKey);
      }
      throw error;
    });
    cached = {
      expiresAt: now + PREFLIGHT_CACHE_TTL_MS,
      result,
    };
    preflightCache.set(cacheKey, cached);
  }

  const result = await awaitWithAbort(cached.result, options.signal);
  throwIfAborted(options.signal);
  return result;
}

export function clearCodexRuntimePreflightCache(): void {
  preflightCache.clear();
}

export function parseCodexVersion(output: string): string | undefined {
  const match = output.match(
    /(?:^|\s)(?:codex(?:-cli)?\s+)?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?=\s|$)/i,
  );
  return match?.[1];
}

async function runPreflight(
  options: CodexRuntimePreflightOptions,
): Promise<CodexRuntimePreflightResult> {
  const version = await probeCodexVersion(options);
  if (!options.model) {
    return {
      version,
      modelCatalogChecked: false,
    };
  }

  let availableModels: string[];
  try {
    availableModels = await probeCodexModels(options);
  } catch {
    return {
      version,
      modelCatalogChecked: false,
    };
  }

  if (availableModels.length === 0) {
    return {
      version,
      modelCatalogChecked: false,
    };
  }

  if (!availableModels.includes(options.model)) {
    throw new CodexModelCompatibilityError(
      options.model,
      version,
      availableModels,
    );
  }

  return {
    version,
    availableModels,
    modelCatalogChecked: true,
  };
}

async function probeCodexVersion(
  options: CodexRuntimePreflightOptions,
): Promise<string> {
  let closeEvent:
    | {
        stdout: string;
        stderr: string;
        exitCode: number;
        timedOut?: boolean;
      }
    | undefined;

  for await (const event of runCodexCli(options.command, ["--version"], {
    cwd: options.cwd,
    stdin: "",
    env: options.providerConfig.env,
    timeoutMs: PREFLIGHT_TIMEOUT_MS,
  })) {
    if (event.type === "close") {
      closeEvent = event;
    }
  }

  if (!closeEvent) {
    throw new CodexRuntimePreflightError(
      "Codex CLI preflight ended before reporting its version. Run `codex --version` to verify the installation.",
    );
  }

  const output = [closeEvent.stdout, closeEvent.stderr]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n");

  if (closeEvent.timedOut) {
    throw new CodexRuntimePreflightError(
      `Codex CLI version check timed out after ${PREFLIGHT_TIMEOUT_MS}ms. Run \`${options.command} --version\` and repair or upgrade the Codex installation.`,
    );
  }

  if (closeEvent.exitCode !== 0) {
    const outputSuffix = output ? `: ${output}` : "";
    throw new CodexRuntimePreflightError(
      `Codex CLI version check failed with code ${closeEvent.exitCode}${outputSuffix}. Run \`${options.command} --version\` and repair or upgrade the Codex installation.`,
    );
  }

  const version = parseCodexVersion(output);
  if (!version) {
    throw new CodexRuntimePreflightError(
      `OpenLoomi could not determine the installed Codex CLI version from \`${options.command} --version\`. Output: ${output || "(empty)"}. Upgrade Codex or verify providerConfig.codexPath.`,
    );
  }

  return version;
}

async function probeCodexModels(
  options: CodexRuntimePreflightOptions,
): Promise<string[]> {
  const args: string[] = [];
  if (options.providerConfig.profile) {
    args.push("-p", options.providerConfig.profile);
  }
  args.push("app-server", "--stdio");

  const client = new CodexAppServerProbeClient(options.command, args, {
    cwd: options.cwd,
    env: options.providerConfig.env,
    timeoutMs: PREFLIGHT_TIMEOUT_MS,
  });

  try {
    client.start();
    await client.request("initialize", {
      clientInfo: {
        name: "openloomi",
        title: "OpenLoomi",
        version: PREFLIGHT_CLIENT_VERSION,
      },
      capabilities: {},
    });
    client.notify("initialized", {});

    const models = new Set<string>();
    let cursor: string | undefined;
    let catalogComplete = false;
    for (let page = 0; page < MAX_MODEL_PAGES; page += 1) {
      const result = parseModelListResult(
        await client.request("model/list", {
          limit: 100,
          includeHidden: true,
          ...(cursor ? { cursor } : {}),
        }),
      );
      for (const entry of result.data) {
        if (entry.id?.trim()) {
          models.add(entry.id.trim());
        }
        if (entry.model?.trim()) {
          models.add(entry.model.trim());
        }
      }

      const nextCursor = result.nextCursor?.trim();
      if (!nextCursor || nextCursor === cursor) {
        catalogComplete = true;
        break;
      }
      cursor = nextCursor;
    }

    if (!catalogComplete) {
      throw new Error(
        `Codex app-server model/list exceeded ${MAX_MODEL_PAGES} pages`,
      );
    }

    return [...models].sort();
  } finally {
    await client.shutdown();
  }
}

function parseModelListResult(value: unknown): ModelListResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Codex app-server returned an invalid model/list result");
  }

  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new Error("Codex app-server model/list result is missing data");
  }

  const entries = data.filter(
    (entry): entry is ModelListEntry =>
      Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
  );
  const nextCursor = (value as { nextCursor?: unknown }).nextCursor;

  return {
    data: entries,
    nextCursor:
      typeof nextCursor === "string" || nextCursor === null
        ? nextCursor
        : undefined,
  };
}

class CodexAppServerProbeClient {
  private proc?: ChildProcessWithoutNullStreams;
  private requestCounter = 0;
  private stdout = "";
  private stderr = "";
  private stdoutBuffer = "";
  private timeout?: ReturnType<typeof setTimeout>;
  private timedOut = false;
  private closed = false;
  private pendingRequests = new Map<JsonRpcId, PendingRequest>();
  private resolveClosed?: () => void;
  private readonly stdoutDecoder = new StringDecoder("utf8");
  private readonly stderrDecoder = new StringDecoder("utf8");
  private readonly closedPromise = new Promise<void>((resolve) => {
    this.resolveClosed = resolve;
  });

  constructor(
    private readonly command: string,
    private readonly args: string[],
    private readonly options: {
      cwd: string;
      env?: Record<string, string>;
      timeoutMs: number;
    },
  ) {}

  start(): void {
    if (this.proc) {
      return;
    }

    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawn(this.command, this.args, {
        cwd: this.options.cwd,
        env: buildCliEnvironment(this.options.env),
        detached: shouldDetachCliProcess(),
        windowsHide: true,
      }) as ChildProcessWithoutNullStreams;
      this.proc = proc;
    } catch (error) {
      throw normalizeProbeSpawnError(error, this.command);
    }

    this.timeout = setTimeout(() => {
      this.timedOut = true;
      this.rejectAll(this.createExitError());
      this.kill();
    }, this.options.timeoutMs);

    proc.stdin.on("error", (error: Error) => {
      this.rejectAll(error);
      this.kill();
    });

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = this.stdoutDecoder.write(chunk);
      this.stdout = appendCapturedCliOutput(this.stdout, text);
      this.stdoutBuffer += text;
      if (this.stdoutBuffer.length > MAX_CLI_PROTOCOL_LINE_CHARS) {
        this.rejectAll(
          new Error(
            `Codex app-server emitted a JSON line larger than ${MAX_CLI_PROTOCOL_LINE_CHARS} characters`,
          ),
        );
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
      this.rejectAll(normalizeProbeSpawnError(error, this.command));
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
      if (this.stdoutBuffer.trim()) {
        this.handleLine(this.stdoutBuffer);
        this.stdoutBuffer = "";
      }

      if (this.pendingRequests.size > 0) {
        this.rejectAll(this.createExitError(code ?? (signal ? 130 : 0)));
      }
      this.finish();
    });
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = ++this.requestCounter;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { method, resolve, reject });
      try {
        this.write({ id, method, params });
      } catch (error) {
        this.pendingRequests.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params?: unknown): void {
    this.write({ method, params });
  }

  async shutdown(): Promise<void> {
    if (!this.proc) {
      return;
    }
    this.kill();
    this.cleanup();
    await Promise.race([
      this.closedPromise,
      new Promise<void>((resolve) => {
        setTimeout(resolve, 1_000);
      }),
    ]);
  }

  private write(message: Record<string, unknown>): void {
    if (!this.proc || this.closed) {
      throw new Error("Codex app-server preflight process is not running");
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
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (isIncomingJsonRpcRequest(message)) {
      this.write({
        id: message.id,
        error: {
          code: -32601,
          message: `Unsupported OpenLoomi preflight method: ${message.method}`,
        },
      });
      return;
    }

    if (!isJsonRpcResponse(message)) {
      return;
    }

    const pending = this.pendingRequests.get(message.id);
    if (!pending) {
      return;
    }
    this.pendingRequests.delete(message.id);

    if (message.error) {
      pending.reject(
        new Error(
          `Codex app-server ${pending.method} failed${
            typeof message.error.code === "number"
              ? ` (${message.error.code})`
              : ""
          }: ${message.error.message || "unknown error"}`,
        ),
      );
      return;
    }
    pending.resolve(message.result);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private createExitError(exitCode?: number): Error {
    const output = this.stderr.trim() || this.stdout.trim();
    if (this.timedOut) {
      return new Error(
        output
          ? `Codex app-server preflight timed out after ${this.options.timeoutMs}ms: ${output}`
          : `Codex app-server preflight timed out after ${this.options.timeoutMs}ms`,
      );
    }

    return new Error(
      output
        ? `Codex app-server exited before completing model discovery${
            exitCode === undefined ? "" : ` (code ${exitCode})`
          }: ${output}`
        : `Codex app-server exited before completing model discovery${
            exitCode === undefined ? "" : ` (code ${exitCode})`
          }`,
    );
  }

  private kill(): void {
    if (this.proc && !this.proc.killed) {
      terminateCliProcessTree(this.proc);
    }
  }

  private finish(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.cleanup();
    this.resolveClosed?.();
  }

  private cleanup(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
  }
}

function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" || typeof id === "number";
}

function isIncomingJsonRpcRequest(
  value: unknown,
): value is { id: JsonRpcId; method: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as { id?: unknown; method?: unknown };
  return (
    (typeof candidate.id === "string" || typeof candidate.id === "number") &&
    typeof candidate.method === "string"
  );
}

function normalizeProbeSpawnError(error: unknown, command: string): Error {
  const normalized = error instanceof Error ? error : new Error(String(error));
  return (normalized as Error & { code?: string }).code === "ENOENT"
    ? new CodexCommandNotFoundError(command)
    : normalized;
}

function createPreflightCacheKey(
  options: CodexRuntimePreflightOptions,
): string {
  const envFingerprint = createHash("sha256")
    .update(
      JSON.stringify(
        Object.entries(options.providerConfig.env ?? {}).sort(
          ([left], [right]) => left.localeCompare(right),
        ),
      ),
    )
    .digest("hex");

  return JSON.stringify([
    options.command,
    options.cwd,
    options.providerConfig.profile ?? "",
    options.model ?? "",
    envFingerprint,
  ]);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The Codex request was aborted", "AbortError");
}

function awaitWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) {
    return promise;
  }
  throwIfAborted(signal);

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException("The Codex request was aborted", "AbortError"),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
