import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import util from "node:util";

import {
  runNativeAgentRequest,
  type NativeAgentHost,
  type NativeAgentRequest,
  type NativeAgentSession,
} from "../native-runner";
import type {
  AgentRuntimePermissionDecision,
  AgentRuntimePermissionHandler,
  AgentRuntimePermissionRequest,
} from "../runtime";
import { DEFAULT_ALLOWED_TOOLS, type AgentMessage } from "../types";

interface NativeAgentCliInput extends NativeAgentRequest {
  authToken: string;
  cliPermissionMode?: "ask" | "deny" | "bypass";
}

interface NativeAgentCliOutput {
  response: string;
  session_id: string | null;
  event_count: number;
  text_event_count: number;
  tool_calls: string[];
  tools: string[];
  skills: string[];
  permission_requests: number;
  cost: number | null;
  duration_ms: number | null;
  error: string | null;
}

const CLI_PERMISSION_GATED_TOOLS = ["Edit", "Write", "Bash", "Agent", "Task"];

type NativePermissionRequest = AgentRuntimePermissionRequest;
type NativePermissionDecision = AgentRuntimePermissionDecision;

interface PermissionResponseMessage {
  kind: "permission_response";
  toolUseID: string;
  behavior: "allow" | "deny";
  updatedInput?: Record<string, unknown>;
}

class NativeAgentCliError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NativeAgentCliError";
  }
}

export async function runNativeAgentCli(host: NativeAgentHost) {
  redirectConsoleToStderr();
  loadLocalEnv();

  // Match the environment expected by the Tauri-backed runtime when the runner
  // is invoked directly instead of through Next.js.
  process.env.IS_TAURI ??= "true";
  process.env.TAURI_MODE ??= "1";
  process.env.DEPLOYMENT_MODE ??= "tauri";

  const protocol = createJsonLineProtocol();
  const input = applyCliPermissionToolPolicy(
    parseInput(await protocol.readInitialInput()),
  );
  const { session, userId } = createSessionFromToken(
    input.authToken,
    input.platform,
  );
  const abortController = new AbortController();
  const output = initialOutput();

  process.once("SIGINT", () => abortController.abort());
  process.once("SIGTERM", () => abortController.abort());

  const run = await runNativeAgentRequest(
    input,
    {
      session,
      userId,
      abortController,
      emitPermissionRequestEvents: false,
      permissionHandler: createPermissionHandler({
        mode: input.cliPermissionMode ?? "deny",
        output,
        requestPermission: protocol.requestPermission,
      }),
    },
    host,
  );

  // The shared runner is streaming-first. one-shot mode collapses that stream
  // into a compact JSON summary before handing control back to Rust.
  for await (const message of run.generator) {
    applyAgentMessage(output, message);
  }

  writeOutputAndExit(output, output.error ? 1 : 0);
}

export function runNativeAgentCliMain(host: NativeAgentHost) {
  void runNativeAgentCli(host).catch((error) => {
    console.error("[native-agent-cli] Fatal error:", error);
    const output = initialOutput();
    output.error =
      error instanceof NativeAgentCliError
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);
    writeOutputAndExit(output, 1);
  });
}

function redirectConsoleToStderr() {
  // stdout is reserved for the single machine-readable JSON result consumed by
  // the Rust CLI. Any app/runtime logs must go to stderr instead.
  const write = (level: string, args: unknown[]) => {
    const line = args
      .map((arg) =>
        typeof arg === "string"
          ? arg
          : util.inspect(arg, { depth: 5, colors: false }),
      )
      .join(" ");
    process.stderr.write(`[${level}] ${line}\n`);
  };

  console.log = (...args: unknown[]) => write("log", args);
  console.info = (...args: unknown[]) => write("info", args);
  console.warn = (...args: unknown[]) => write("warn", args);
  console.error = (...args: unknown[]) => write("error", args);
}

function createJsonLineProtocol() {
  let buffer = "";
  let initialInputResolved = false;
  let resolveInitialInput!: (value: string) => void;
  let rejectInitialInput!: (error: Error) => void;
  const pendingPermissions = new Map<
    string,
    {
      resolve: (decision: NativePermissionDecision) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  const initialInput = new Promise<string>((resolve, reject) => {
    resolveInitialInput = resolve;
    rejectInitialInput = reject;
  });

  const writeProtocolMessage = (message: unknown) => {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  };

  const denyPendingPermissions = () => {
    for (const [toolUseID, pending] of pendingPermissions) {
      clearTimeout(pending.timeout);
      pending.resolve({ behavior: "deny" });
      pendingPermissions.delete(toolUseID);
    }
  };

  const handleProtocolLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line) {
      return;
    }

    if (!initialInputResolved) {
      initialInputResolved = true;
      resolveInitialInput(line);
      return;
    }

    let message: PermissionResponseMessage;
    try {
      message = JSON.parse(line) as PermissionResponseMessage;
    } catch (error) {
      console.error(
        "[native-agent-cli] Ignoring invalid protocol line:",
        error,
      );
      return;
    }

    if (message.kind !== "permission_response") {
      console.error(
        "[native-agent-cli] Ignoring unknown protocol message:",
        message,
      );
      return;
    }

    const pending = pendingPermissions.get(message.toolUseID);
    if (!pending) {
      console.error(
        "[native-agent-cli] Permission response had no pending request:",
        message.toolUseID,
      );
      return;
    }

    clearTimeout(pending.timeout);
    pendingPermissions.delete(message.toolUseID);
    pending.resolve({
      behavior: message.behavior,
      updatedInput: message.updatedInput,
    });
  };

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      handleProtocolLine(line);
      newlineIndex = buffer.indexOf("\n");
    }
  });
  process.stdin.on("end", () => {
    if (buffer.trim()) {
      handleProtocolLine(buffer);
      buffer = "";
    }
    if (!initialInputResolved) {
      rejectInitialInput(
        new NativeAgentCliError("usage", "stdin JSON input is required."),
      );
    }
    denyPendingPermissions();
  });
  process.stdin.on("error", (error) => {
    if (!initialInputResolved) {
      rejectInitialInput(error);
    }
    denyPendingPermissions();
  });

  const requestPermission = (
    request: NativePermissionRequest,
  ): Promise<NativePermissionDecision> => {
    writeProtocolMessage({
      kind: "permission_request",
      toolName: request.toolName,
      toolUseID: request.toolUseID,
      toolInput: request.toolInput,
      decisionReason: request.decisionReason,
      blockedPath: request.blockedPath,
      title: request.title,
      displayName: request.displayName,
      description: request.description,
      agentID: request.agentID,
    });

    return new Promise((resolve) => {
      const timeout = setTimeout(
        () => {
          pendingPermissions.delete(request.toolUseID);
          resolve({ behavior: "deny" });
        },
        5 * 60 * 1000,
      );
      pendingPermissions.set(request.toolUseID, { resolve, timeout });
    });
  };

  return {
    readInitialInput: () => initialInput,
    requestPermission,
  };
}

function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const separator = trimmed.indexOf("=");
  if (separator === -1) {
    return null;
  }

  const key = trimmed.slice(0, separator).trim();
  let value = trimmed.slice(separator + 1).trim();
  if (!key) {
    return null;
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return [key, value];
}

function loadLocalEnv() {
  // Match Next.js local development behavior, but never override variables the
  // parent shell already provided for a scripted CLI run.
  const shellEnvKeys = new Set(Object.keys(process.env));
  for (const fileName of [".env", ".env.local"]) {
    const envPath = join(process.cwd(), fileName);
    if (!existsSync(envPath)) {
      continue;
    }

    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) {
        continue;
      }

      const [key, value] = parsed;
      if (!shellEnvKeys.has(key)) {
        process.env[key] = value;
      }
    }
  }
}

function decodeBase64UrlJson<T>(value: string): T | null {
  try {
    let base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4 !== 0) {
      base64 += "=";
    }
    return JSON.parse(Buffer.from(base64, "base64").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function parseToken(token: string): {
  id?: string;
  email?: string;
  name?: string;
  type?: string;
  exp?: number;
} | null {
  const parts = token.split(".");
  const encodedPayload = parts.length === 2 ? parts[0] : parts[1];
  if (!encodedPayload) {
    return null;
  }
  return decodeBase64UrlJson(encodedPayload);
}

function createSessionFromToken(
  token: string,
  platform?: string,
): { session: NativeAgentSession; userId: string } {
  // The direct runner bypasses NextAuth's request pipeline, so reconstruct the
  // minimal authenticated session shape expected by runNativeAgentRequest.
  const payload = parseToken(token);
  if (!payload?.id) {
    throw new NativeAgentCliError(
      "not_authenticated",
      "auth token could not be parsed.",
    );
  }

  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new NativeAgentCliError("not_authenticated", "auth token expired.");
  }

  const session: NativeAgentSession = {
    user: {
      id: payload.id,
      email: payload.email,
      name: payload.name,
      type: payload.type ?? "regular",
    },
    platform,
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };

  return { session, userId: payload.id };
}

function parseInput(rawInput: string): NativeAgentCliInput {
  if (!rawInput.trim()) {
    throw new NativeAgentCliError("usage", "stdin JSON input is required.");
  }

  let input: NativeAgentCliInput;
  try {
    input = JSON.parse(rawInput) as NativeAgentCliInput;
  } catch (error) {
    throw new NativeAgentCliError(
      "usage",
      `failed to parse stdin JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!input.prompt || typeof input.prompt !== "string") {
    throw new NativeAgentCliError(
      "usage",
      "prompt must be a non-empty string.",
    );
  }

  if (!input.authToken || typeof input.authToken !== "string") {
    throw new NativeAgentCliError(
      "not_authenticated",
      "authToken is required.",
    );
  }

  return input;
}

function applyCliPermissionToolPolicy(
  input: NativeAgentCliInput,
): NativeAgentCliInput {
  // In Claude SDK, allowedTools means "auto-allowed without prompting". CLI ask
  // and deny modes therefore must remove protected tools from allowedTools so
  // real permission decisions happen at the tool-call boundary.
  const cliPermissionMode = input.cliPermissionMode ?? "deny";
  if (cliPermissionMode === "bypass") {
    return {
      ...input,
      cliPermissionMode,
      permissionMode: input.permissionMode ?? "bypassPermissions",
    };
  }

  const gatedTools = new Set(CLI_PERMISSION_GATED_TOOLS);
  const allowedTools = (input.allowedTools ?? DEFAULT_ALLOWED_TOOLS).filter(
    (tool) => !gatedTools.has(tool),
  );

  if (cliPermissionMode === "deny") {
    return {
      ...input,
      cliPermissionMode,
      permissionMode: input.permissionMode ?? "dontAsk",
      allowedTools,
      disallowedTools: [
        ...new Set([
          ...(input.disallowedTools ?? []),
          ...CLI_PERMISSION_GATED_TOOLS,
        ]),
      ],
    };
  }

  return {
    ...input,
    cliPermissionMode,
    permissionMode: input.permissionMode ?? "default",
    allowedTools,
    disallowedTools: input.disallowedTools,
  };
}

function addUnique(values: string[], value: string) {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function extractSkillName(input: unknown): string | null {
  if (typeof input === "string") {
    const trimmed = input.trim();
    return trimmed || null;
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  for (const key of ["skill", "skillName", "skill_name", "name", "command"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function initialOutput(): NativeAgentCliOutput {
  return {
    response: "",
    session_id: null,
    event_count: 0,
    text_event_count: 0,
    tool_calls: [],
    tools: [],
    skills: [],
    permission_requests: 0,
    cost: null,
    duration_ms: null,
    error: null,
  };
}

function writeOutputAndExit(output: NativeAgentCliOutput, exitCode: number) {
  process.stdout.write(
    `${JSON.stringify({ kind: "result", output })}\n`,
    () => {
      process.exit(exitCode);
    },
  );
}

function applyAgentMessage(
  output: NativeAgentCliOutput,
  message: AgentMessage,
) {
  output.event_count += 1;

  switch (message.type) {
    case "session":
      if (message.sessionId) {
        output.session_id = message.sessionId;
      }
      break;
    case "text":
      if (message.content) {
        output.response += message.content;
        output.text_event_count += 1;
      }
      break;
    case "tool_use":
      if (message.name) {
        output.tool_calls.push(message.name);
        addUnique(output.tools, message.name);
        if (message.name === "Skill") {
          const skillName = extractSkillName(message.input);
          if (skillName) {
            addUnique(output.skills, skillName);
          }
        }
      }
      break;
    case "permission_request":
      output.permission_requests += 1;
      break;
    case "result":
      output.cost = message.cost ?? output.cost;
      output.duration_ms = message.duration ?? output.duration_ms;
      break;
    case "error":
      output.error = message.message || message.content || "agent error";
      break;
  }
}

function createPermissionHandler({
  mode,
  output,
  requestPermission,
}: {
  mode: NativeAgentCliInput["cliPermissionMode"];
  output: NativeAgentCliOutput;
  requestPermission: (
    request: NativePermissionRequest,
  ) => Promise<NativePermissionDecision>;
}): AgentRuntimePermissionHandler {
  const decisionsByTool = new Map<string, NativePermissionDecision>();

  return async (request) => {
    output.permission_requests += 1;

    if (mode === "bypass") {
      return { behavior: "allow" };
    }
    if (mode === "deny") {
      return { behavior: "deny" };
    }

    // CLI ask mode is intentionally run-scoped: once the user approves or
    // denies a tool such as Bash, repeat calls to that same tool reuse the
    // decision for this one-shot invocation instead of interrupting every time.
    const toolKey = request.toolName.trim();
    const cachedDecision = decisionsByTool.get(toolKey);
    if (cachedDecision) {
      return cachedDecision;
    }

    const decision = await requestPermission(request);
    decisionsByTool.set(toolKey, decision);
    return decision;
  };
}
