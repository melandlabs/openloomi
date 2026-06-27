import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import util from "node:util";

import type {
  AuthenticatedNativeAgentSession,
  NativeAgentRequest,
} from "@/lib/ai/native-agent/runner";
import type { AgentMessage } from "@openloomi/ai/agent/types";

interface NativeAgentCliInput extends NativeAgentRequest {
  authToken: string;
}

interface NativeAgentCliOutput {
  response: string;
  session_id: string | null;
  event_count: number;
  text_event_count: number;
  tool_calls: string[];
  permission_requests: number;
  cost: number | null;
  duration_ms: number | null;
  error: string | null;
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

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => resolve(input));
    process.stdin.on("error", reject);
  });
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
): { session: AuthenticatedNativeAgentSession; userId: string } {
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

  const session: AuthenticatedNativeAgentSession = {
    user: {
      id: payload.id,
      email: payload.email,
      name: payload.name,
      type: (payload.type ??
        "regular") as AuthenticatedNativeAgentSession["user"]["type"],
    },
    platform,
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  } as AuthenticatedNativeAgentSession;

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

function initialOutput(): NativeAgentCliOutput {
  return {
    response: "",
    session_id: null,
    event_count: 0,
    text_event_count: 0,
    tool_calls: [],
    permission_requests: 0,
    cost: null,
    duration_ms: null,
    error: null,
  };
}

function writeOutputAndExit(output: NativeAgentCliOutput, exitCode: number) {
  process.stdout.write(`${JSON.stringify(output)}\n`, () => {
    process.exit(exitCode);
  });
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

async function run() {
  redirectConsoleToStderr();
  loadLocalEnv();

  // Match the environment expected by the Tauri-backed server runtime when the
  // runner is invoked directly instead of through Next.js.
  process.env.IS_TAURI ??= "true";
  process.env.TAURI_MODE ??= "1";
  process.env.DEPLOYMENT_MODE ??= "tauri";

  const input = parseInput(await readStdin());
  const { session, userId } = createSessionFromToken(
    input.authToken,
    input.platform,
  );
  const abortController = new AbortController();

  process.once("SIGINT", () => abortController.abort());
  process.once("SIGTERM", () => abortController.abort());

  const { runNativeAgentRequest } =
    await import("@/lib/ai/native-agent/runner");
  const run = await runNativeAgentRequest(input, {
    session,
    userId,
    abortController,
  });

  const output = initialOutput();
  // The shared runner is streaming-first. one-shot mode collapses that stream
  // into a compact JSON summary before handing control back to Rust.
  for await (const message of run.generator) {
    applyAgentMessage(output, message);
  }

  writeOutputAndExit(output, output.error ? 1 : 0);
}

run().catch((error) => {
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
