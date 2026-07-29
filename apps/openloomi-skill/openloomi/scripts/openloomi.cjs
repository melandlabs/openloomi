#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_BASE_URLS = [
  "http://127.0.0.1:3414",
  "http://127.0.0.1:3515",
  "http://127.0.0.1:3415",
];
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_AGENT_TIMEOUT_MS = 30 * 60 * 1000;
const TOKEN_PATH = path.join(os.homedir(), ".openloomi", "token");

const SAFE_AGENT_ALLOWED_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "Skill",
  "LSP",
  "TodoWrite",
];
const SAFE_AGENT_DISALLOWED_TOOLS = ["Edit", "Write", "Bash", "Agent", "Task"];

class OpenLoomiError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "OpenLoomiError";
    this.code = code;
    this.details = details;
    if (details.status) {
      this.status = details.status;
    }
  }
}

function normalizeBaseUrl(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new OpenLoomiError(
      "invalid_config",
      `Invalid OpenLoomi base URL: ${value}`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OpenLoomiError(
      "invalid_config",
      `OpenLoomi base URL must use http or https: ${value}`,
    );
  }
  return url.toString().replace(/\/+$/, "");
}

function resolveBaseUrls(env = process.env) {
  const values = [
    env.OPENLOOMI_API_URL,
    env.OPENLOOMI_BASE_URL,
    ...DEFAULT_BASE_URLS,
  ];
  const seen = new Set();
  const urls = [];
  for (const value of values) {
    const normalized = normalizeBaseUrl(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    urls.push(normalized);
  }
  return urls;
}

function looksLikeJwt(value) {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?$/.test(value);
}

function maybeDecodeToken(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    return null;
  }
  if (looksLikeJwt(trimmed)) {
    return { token: trimmed, encoded: false };
  }

  const decoded = Buffer.from(trimmed, "base64").toString("utf8").trim();
  if (decoded && looksLikeJwt(decoded)) {
    return { token: decoded, encoded: true };
  }
  return { token: trimmed, encoded: false };
}

function readAuthToken(env = process.env, fileSystem = fs) {
  const envToken = maybeDecodeToken(env.OPENLOOMI_AUTH_TOKEN);
  if (envToken?.token) {
    return {
      available: true,
      source: "env:OPENLOOMI_AUTH_TOKEN",
      token: envToken.token,
      encoded: envToken.encoded,
    };
  }

  const tokenPath = env.OPENLOOMI_TOKEN_PATH || TOKEN_PATH;
  try {
    const token = maybeDecodeToken(fileSystem.readFileSync(tokenPath, "utf8"));
    if (token?.token) {
      return {
        available: true,
        source: "file",
        tokenPath,
        token: token.token,
        encoded: token.encoded,
      };
    }
  } catch {
    // Missing local OpenLoomi token is a normal first-run state.
  }

  return {
    available: false,
    source: "none",
    token: null,
  };
}

function publicAuthInfo(auth) {
  return {
    available: auth.available === true,
    source: auth.source,
    encoded: auth.encoded === true,
    tokenPath: auth.tokenPath,
  };
}

function parseCommandArgs(args) {
  const flags = {};
  const positionals = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const withoutPrefix = arg.slice(2);
    const eqIndex = withoutPrefix.indexOf("=");
    if (eqIndex >= 0) {
      const key = withoutPrefix.slice(0, eqIndex);
      flags[key] = withoutPrefix.slice(eqIndex + 1);
      continue;
    }

    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
      flags[withoutPrefix] = next;
      i += 1;
    } else {
      flags[withoutPrefix] = true;
    }
  }

  return { flags, positionals };
}

function parsePositiveInteger(value, fallback, name) {
  if (value === undefined || value === null || value === true || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new OpenLoomiError("usage", `${name} must be a positive integer.`);
  }
  return parsed;
}

function parseOptionalNumber(value, name) {
  if (value === undefined || value === null || value === true || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new OpenLoomiError("usage", `${name} must be a number.`);
  }
  return parsed;
}

function extractMessage(body, fallbackText) {
  if (body && typeof body === "object") {
    if (typeof body.message === "string") {
      return body.message;
    }
    if (typeof body.error === "string") {
      return body.error;
    }
    if (body.error && typeof body.error.message === "string") {
      return body.error.message;
    }
    if (typeof body.code === "string") {
      return body.code;
    }
  }
  const text = String(fallbackText || "").trim();
  return text || null;
}

function httpErrorCode(status) {
  if (status === 401 || status === 403) return "not_authenticated";
  if (status === 404) return "not_found";
  if (status === 405) return "method_not_allowed";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "service_unavailable";
  if (status >= 400) return "bad_request";
  return "http_error";
}

function parseJsonMaybe(text) {
  if (typeof text !== "string" || text.trim().length === 0) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  if (typeof fetch !== "function") {
    throw new OpenLoomiError(
      "unsupported_runtime",
      "This skill wrapper requires Node.js 18 or newer with global fetch support.",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new OpenLoomiError("timeout", `Request timed out: ${url}`);
    }
    throw new OpenLoomiError(
      "network",
      `Could not connect to OpenLoomi at ${url}: ${error?.message || error}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function apiRequest(baseUrl, endpoint, options = {}) {
  const {
    method = "GET",
    body,
    auth,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    accept = "application/json",
  } = options;
  const url = new URL(endpoint, baseUrl).toString();
  const headers = {
    Accept: accept,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (auth?.token) {
    headers.Authorization = `Bearer ${auth.token}`;
  }

  const response = await fetchWithTimeout(
    url,
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    timeoutMs,
  );
  const text = await response.text();
  const parsed = parseJsonMaybe(text);

  if (!response.ok) {
    const message =
      extractMessage(parsed, text) ||
      `${method} ${endpoint} returned HTTP ${response.status}`;
    throw new OpenLoomiError(httpErrorCode(response.status), message, {
      status: response.status,
      endpoint,
      baseUrl,
      body: parsed ?? text,
    });
  }

  return {
    baseUrl,
    endpoint,
    status: response.status,
    body: parsed ?? text,
    text,
  };
}

function unwrapData(body) {
  if (body && typeof body === "object" && "data" in body) {
    return body.data;
  }
  return body;
}

function formatAttempt(baseUrl, error) {
  return {
    baseUrl,
    ok: false,
    code: error.code || "unknown",
    message: error.message,
    status: error.status,
  };
}

async function locateBaseUrl(env, auth, timeoutMs = 5000) {
  const attempts = [];
  for (const baseUrl of resolveBaseUrls(env)) {
    try {
      const probe = await apiRequest(baseUrl, "/api/remote-auth/user", {
        auth,
        timeoutMs,
      });
      return { baseUrl, probe, attempts };
    } catch (error) {
      attempts.push(formatAttempt(baseUrl, error));
    }
  }

  throw new OpenLoomiError(
    "service_unavailable",
    "OpenLoomi local API is unreachable. Open OpenLoomi Desktop and retry.",
    { attempts },
  );
}

function sanitizeUser(user) {
  if (!user || typeof user !== "object") {
    return user;
  }
  return {
    id: user.id ?? null,
    email: user.email ?? null,
    name: user.name ?? null,
    authenticated: user.authenticated === true,
  };
}

async function statusCommand(args, context) {
  const { flags } = parseCommandArgs(args);
  const timeoutMs = parsePositiveInteger(
    flags["timeout-ms"],
    DEFAULT_TIMEOUT_MS,
    "--timeout-ms",
  );
  const auth = readAuthToken(context.env, context.fs);
  const attempts = [];

  for (const baseUrl of resolveBaseUrls(context.env)) {
    try {
      const userProbe = await apiRequest(baseUrl, "/api/remote-auth/user", {
        auth,
        timeoutMs,
      });
      let providersProbe;
      try {
        providersProbe = await apiRequest(baseUrl, "/api/native/providers", {
          auth,
          timeoutMs,
        });
      } catch (error) {
        providersProbe = { error };
      }

      const user = unwrapData(userProbe.body);
      const providerBody =
        providersProbe && !providersProbe.error
          ? unwrapData(providersProbe.body)
          : null;

      return {
        ok: true,
        command: "status",
        baseUrl,
        auth: publicAuthInfo(auth),
        probes: {
          user: {
            ok: true,
            status: userProbe.status,
            authenticated: user?.authenticated === true,
            user: sanitizeUser(user),
          },
          providers: providersProbe.error
            ? {
                ok: false,
                code: providersProbe.error.code,
                message: providersProbe.error.message,
                status: providersProbe.error.status,
              }
            : {
                ok: true,
                status: providersProbe.status,
                defaultAgent: providerBody?.defaultAgent ?? null,
                agents: Array.isArray(providerBody?.agents)
                  ? providerBody.agents
                  : [],
              },
        },
        attempts,
      };
    } catch (error) {
      attempts.push(formatAttempt(baseUrl, error));
    }
  }

  throw new OpenLoomiError(
    "service_unavailable",
    "OpenLoomi local API is unreachable. Open OpenLoomi Desktop and retry.",
    { attempts, auth: publicAuthInfo(auth) },
  );
}

function shouldFallbackToRag(error) {
  return error?.code === "not_found" || error?.code === "method_not_allowed";
}

async function memorySearchCommand(args, context) {
  const { flags, positionals } = parseCommandArgs(args);
  const query = positionals.join(" ").trim();
  if (!query) {
    throw new OpenLoomiError(
      "usage",
      'Query required: memory-search "your query" [--limit=5]',
    );
  }

  const limit = parsePositiveInteger(flags.limit, 5, "--limit");
  const threshold = parseOptionalNumber(flags.threshold, "--threshold");
  const auth = readAuthToken(context.env, context.fs);
  const located = await locateBaseUrl(context.env, auth);

  const body = { query, limit };
  if (threshold !== undefined) {
    body.threshold = threshold;
  }

  let endpoint = "/api/memory/search";
  let response;
  try {
    response = await apiRequest(located.baseUrl, endpoint, {
      method: "POST",
      auth,
      body,
    });
  } catch (error) {
    if (!shouldFallbackToRag(error)) {
      throw error;
    }
    endpoint = "/api/rag/search";
    response = await apiRequest(located.baseUrl, endpoint, {
      method: "POST",
      auth,
      body,
    });
  }

  return {
    ok: true,
    command: "memory-search",
    baseUrl: located.baseUrl,
    endpoint,
    query,
    limit,
    result: response.body,
  };
}

async function connectorsListCommand(args, context) {
  const { flags } = parseCommandArgs(args);
  const auth = readAuthToken(context.env, context.fs);
  const located = await locateBaseUrl(context.env, auth);
  const response = await apiRequest(
    located.baseUrl,
    "/api/integrations/accounts",
    { auth },
  );
  const body = unwrapData(response.body);
  const accounts = Array.isArray(body?.accounts) ? body.accounts : [];
  const platform =
    typeof flags.platform === "string" ? flags.platform.trim() : null;
  const filteredAccounts = platform
    ? accounts.filter((account) => account.platform === platform)
    : accounts;

  return {
    ok: true,
    command: "connectors-list",
    baseUrl: located.baseUrl,
    endpoint: "/api/integrations/accounts",
    platform: platform || undefined,
    accounts: filteredAccounts,
    total: filteredAccounts.length,
    result: response.body,
  };
}

function addUnique(values, value) {
  if (value && !values.includes(value)) {
    values.push(value);
  }
}

function extractSkillName(input) {
  if (typeof input === "string") {
    const trimmed = input.trim();
    return trimmed || null;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  for (const key of ["skill", "skillName", "skill_name", "name", "command"]) {
    if (typeof input[key] === "string" && input[key].trim()) {
      return input[key].trim();
    }
  }
  return null;
}

function recordAgentEvent(result, event) {
  result.eventCount += 1;
  const type = typeof event.type === "string" ? event.type : "";

  if (type === "text" || type === "direct_answer") {
    if (typeof event.content === "string") {
      result.response += event.content;
      result.textEventCount += 1;
    }
    return;
  }

  if (type === "session") {
    result.sessionId = event.sessionId || event.session_id || result.sessionId;
    return;
  }

  if (type === "tool_use") {
    if (typeof event.name === "string") {
      result.toolCalls.push(event.name);
      addUnique(result.tools, event.name);
      if (event.name === "Skill") {
        addUnique(result.skills, extractSkillName(event.input));
      }
    }
    return;
  }

  if (type === "permission_request") {
    result.permissionRequests += 1;
    return;
  }

  if (type === "result") {
    result.cost = typeof event.cost === "number" ? event.cost : result.cost;
    result.durationMs =
      typeof event.duration === "number" ? event.duration : result.durationMs;
    result.usage = event.usage || result.usage;
    if (!result.response && typeof event.content === "string") {
      result.response = event.content;
    }
    return;
  }

  if (type === "error") {
    result.error =
      event.message ||
      event.content ||
      result.error ||
      "agent returned an error event";
  }
}

function resultFromPlainJson(value) {
  const response =
    typeof value?.text === "string"
      ? value.text
      : typeof value?.content === "string"
        ? value.content
        : typeof value?.message === "string"
          ? value.message
          : typeof value?.result === "string"
            ? value.result
            : "";
  return {
    response,
    eventCount: 0,
    textEventCount: response ? 1 : 0,
    toolCalls: [],
    tools: [],
    skills: [],
    permissionRequests: 0,
    cost: typeof value?.cost === "number" ? value.cost : null,
    durationMs: typeof value?.duration === "number" ? value.duration : null,
    usage: value?.usage,
    sessionId: value?.sessionId || value?.session_id || null,
    error:
      typeof value?.error === "string"
        ? value.error
        : typeof value?.error?.message === "string"
          ? value.error.message
          : null,
  };
}

function parseAgentSse(raw) {
  const result = {
    response: "",
    eventCount: 0,
    textEventCount: 0,
    toolCalls: [],
    tools: [],
    skills: [],
    permissionRequests: 0,
    cost: null,
    durationMs: null,
    usage: undefined,
    sessionId: null,
    error: null,
  };

  for (const line of String(raw || "").split(/\r?\n/)) {
    if (!line.startsWith("data:")) {
      continue;
    }
    const data = line.slice("data:".length).trim();
    if (!data || data === "[DONE]") {
      continue;
    }
    let event;
    try {
      event = JSON.parse(data);
    } catch (error) {
      throw new OpenLoomiError(
        "agent_response",
        `Failed to parse agent SSE event: ${error.message}`,
      );
    }
    recordAgentEvent(result, event);
  }

  if (result.eventCount > 0) {
    return result;
  }

  const json = parseJsonMaybe(raw);
  if (json && typeof json === "object") {
    return resultFromPlainJson(json);
  }

  const response = String(raw || "").trim();
  if (response) {
    return {
      ...result,
      response,
      textEventCount: 1,
    };
  }

  throw new OpenLoomiError(
    "agent_response",
    "Agent API response did not contain SSE data events.",
  );
}

function buildAgentRequest(prompt, auth, flags = {}) {
  const body = {
    prompt,
    platform:
      typeof flags.platform === "string" && flags.platform.trim()
        ? flags.platform.trim()
        : "workbuddy",
    workDir: process.cwd(),
    useProvidedWorkDir: true,
    permissionMode: "dontAsk",
    allowedTools: SAFE_AGENT_ALLOWED_TOOLS,
    disallowedTools: SAFE_AGENT_DISALLOWED_TOOLS,
    excludeTools: [],
    skillsConfig: {
      enabled: true,
      userDirEnabled: true,
      appDirEnabled: true,
    },
    mcpConfig: {
      enabled: true,
      userDirEnabled: true,
      appDirEnabled: true,
    },
  };

  if (typeof flags["session-id"] === "string" && flags["session-id"].trim()) {
    body.sessionId = flags["session-id"].trim();
  }
  if (
    typeof flags["memory-retrieval-mode"] === "string" &&
    flags["memory-retrieval-mode"].trim()
  ) {
    body.memoryRetrievalMode = flags["memory-retrieval-mode"].trim();
  }
  if (auth?.token) {
    body.authToken = auth.token;
  }
  return body;
}

async function agentRunCommand(args, context) {
  const { flags, positionals } = parseCommandArgs(args);
  const prompt = positionals.join(" ").trim();
  if (!prompt) {
    throw new OpenLoomiError(
      "usage",
      'Prompt required: agent-run "Draft an email. Do not send it."',
    );
  }

  const timeoutMs = parsePositiveInteger(
    flags["timeout-ms"],
    DEFAULT_AGENT_TIMEOUT_MS,
    "--timeout-ms",
  );
  const auth = readAuthToken(context.env, context.fs);
  const located = await locateBaseUrl(context.env, auth);
  const response = await apiRequest(located.baseUrl, "/api/native/agent", {
    method: "POST",
    auth,
    body: buildAgentRequest(prompt, auth, flags),
    timeoutMs,
    accept: "text/event-stream",
  });
  const result = parseAgentSse(response.text);

  if (result.error) {
    throw new OpenLoomiError("agent_error", result.error, { result });
  }

  return {
    ok: true,
    command: "agent-run",
    baseUrl: located.baseUrl,
    endpoint: "/api/native/agent",
    response: result.response,
    result,
  };
}

function helpResult() {
  return {
    ok: true,
    commands: {
      status: 'node "$SKILL_DIR/scripts/openloomi.cjs" status',
      "memory-search":
        'node "$SKILL_DIR/scripts/openloomi.cjs" memory-search "query" --limit=5',
      "connectors-list":
        'node "$SKILL_DIR/scripts/openloomi.cjs" connectors-list [--platform=gmail]',
      "agent-run":
        'node "$SKILL_DIR/scripts/openloomi.cjs" agent-run "Prompt. Do not perform side effects without confirmation."',
    },
  };
}

async function runCommand(argv, context = { env: process.env, fs }) {
  const [command, ...args] = argv;

  switch (command) {
    case "help":
    case "--help":
    case "-h":
    case undefined:
      return helpResult();
    case "status":
      return statusCommand(args, context);
    case "memory-search":
      return memorySearchCommand(args, context);
    case "connectors-list":
      return connectorsListCommand(args, context);
    case "agent-run":
      return agentRunCommand(args, context);
    default:
      throw new OpenLoomiError(
        "usage",
        `Unknown command: ${command}. Run openloomi.cjs help.`,
      );
  }
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function errorToJson(error) {
  if (error instanceof OpenLoomiError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      ...error.details,
    };
  }
  return {
    ok: false,
    code: "unknown",
    message: error?.message || String(error),
  };
}

async function main() {
  try {
    printJson(
      await runCommand(process.argv.slice(2), { env: process.env, fs }),
    );
  } catch (error) {
    printJson(errorToJson(error));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}

module.exports = {
  OpenLoomiError,
  buildAgentRequest,
  errorToJson,
  parseAgentSse,
  readAuthToken,
  resolveBaseUrls,
  runCommand,
};
