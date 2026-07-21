#!/usr/bin/env node
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const DEFAULT_BASE_URLS = ["http://127.0.0.1:3414", "http://127.0.0.1:3515"];
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_PROBE_TIMEOUT_MS = 2_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const SAFE_PRECONNECT_ERRORS = new Set([
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "ETIMEDOUT",
]);

// Keep this list aligned with the platforms that the Desktop connector UI can
// start today. Connection setup itself intentionally remains in Desktop so an
// agent never receives connector credentials or QR/login challenges.
const PLATFORMS = [
  { id: "telegram", name: "Telegram", aliases: ["tg"] },
  { id: "whatsapp", name: "WhatsApp", aliases: [] },
  { id: "imessage", name: "iMessage", aliases: [] },
  { id: "feishu", name: "Lark/Feishu", aliases: ["lark", "飞书"] },
  { id: "dingtalk", name: "DingTalk", aliases: ["钉钉"] },
  { id: "qqbot", name: "QQ", aliases: ["qq", "qq_bot"] },
  {
    id: "weixin",
    name: "WeChat",
    aliases: ["wechat", "微信", "wechat_work", "wecom", "企业微信"],
  },
];

const ALIAS_TO_PLATFORM = new Map();
for (const platform of PLATFORMS) {
  ALIAS_TO_PLATFORM.set(platform.id, platform.id);
  for (const alias of platform.aliases) {
    ALIAS_TO_PLATFORM.set(alias.toLowerCase(), platform.id);
  }
}

class ConnectorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ConnectorError";
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return { code: this.code, message: this.message, ...this.details };
  }
}

function resolvePlatform(input) {
  if (typeof input !== "string") return null;
  return ALIAS_TO_PLATFORM.get(input.trim().toLowerCase()) || null;
}

function getTokenPath() {
  return (
    process.env.OPENLOOMI_TOKEN_PATH?.trim() ||
    path.join(os.homedir(), ".openloomi", "token")
  );
}

function readTokenState() {
  let encoded;
  try {
    encoded = fs.readFileSync(getTokenPath(), "utf8").trim();
  } catch (error) {
    if (error?.code === "ENOENT") return { present: false, token: null };
    throw new ConnectorError(
      "AUTH_TOKEN_UNREADABLE",
      "OpenLoomi's local authentication token could not be read.",
      { tokenPresent: false },
    );
  }

  if (!encoded) return { present: false, token: null };
  try {
    const bytes = Buffer.from(encoded, "base64");
    const canonical = bytes.toString("base64").replace(/=+$/, "");
    if (canonical !== encoded.replace(/=+$/, "")) {
      return { present: true, token: null, invalid: true };
    }
    const decoded = Buffer.from(encoded, "base64").toString("utf8").trim();
    if (!decoded || decoded.includes("\0")) {
      return { present: true, token: null, invalid: true };
    }
    return { present: true, token: decoded, invalid: false };
  } catch {
    return { present: true, token: null, invalid: true };
  }
}

function getAuthToken() {
  try {
    return readTokenState().token || null;
  } catch {
    return null;
  }
}

function requireAuthToken() {
  const state = readTokenState();
  if (state.invalid) {
    throw new ConnectorError(
      "AUTH_TOKEN_INVALID",
      "OpenLoomi's local authentication token is invalid. Sign in again in OpenLoomi Desktop.",
      { tokenPresent: true },
    );
  }
  if (!state.token) {
    throw new ConnectorError(
      "AUTH_TOKEN_MISSING",
      "OpenLoomi's local authentication token is missing. Sign in in OpenLoomi Desktop first.",
      { tokenPresent: false },
    );
  }
  return state.token;
}

function normalizeLoopbackUrl(value, envName) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
      throw new Error("must be an http loopback URL");
    }
    if (url.username || url.password) throw new Error("must not include credentials");
    if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
      throw new Error("must contain only an origin");
    }
    return url.toString().replace(/\/$/, "");
  } catch (error) {
    throw new ConnectorError(
      "INVALID_API_URL",
      `${envName} must be an HTTP URL on localhost, 127.0.0.1, or ::1.`,
      { env: envName, reason: error.message },
    );
  }
}

function getBaseUrls() {
  if (process.env.OPENLOOMI_API_URL?.trim()) {
    return [normalizeLoopbackUrl(process.env.OPENLOOMI_API_URL.trim(), "OPENLOOMI_API_URL")];
  }
  if (process.env.OPENLOOMI_BASE_URL?.trim()) {
    return [normalizeLoopbackUrl(process.env.OPENLOOMI_BASE_URL.trim(), "OPENLOOMI_BASE_URL")];
  }
  return [...DEFAULT_BASE_URLS];
}

function redact(value, depth = 0) {
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (!value || typeof value !== "object") {
    if (typeof value !== "string") return value;
    const token = getAuthToken();
    const withoutToken = token ? value.split(token).join("[redacted]") : value;
    const withoutBearer = withoutToken.replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]");
    return withoutBearer.length > 1_000 ? `${withoutBearer.slice(0, 1_000)}…` : withoutBearer;
  }
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|password|credential|authorization|cookie/i.test(key)) {
      result[key] = "[redacted]";
    } else {
      result[key] = redact(item, depth + 1);
    }
  }
  return result;
}

function configuredTimeout(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!/^\d+$/.test(raw) || !Number.isInteger(parsed) || parsed < 50 || parsed > 60_000) {
    throw new ConnectorError(
      "INVALID_TIMEOUT",
      `${name} must be an integer between 50 and 60000 milliseconds.`,
    );
  }
  return parsed;
}

function parseResponseBody(text, context) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new ConnectorError(
      "INVALID_API_RESPONSE",
      "OpenLoomi returned malformed JSON.",
      context,
    );
  }
}

function requestOnce(
  baseUrl,
  endpoint,
  {
    method = "GET",
    body = null,
    token = null,
    timeoutMs = configuredTimeout("OPENLOOMI_API_TIMEOUT_MS", DEFAULT_REQUEST_TIMEOUT_MS),
  } = {},
) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, `${baseUrl}/`);
    let connected = false;
    let settled = false;
    const payload = body === null ? null : JSON.stringify(body);
    const req = http.request(
      url,
      {
        method,
        headers: {
          Accept: "application/json",
          ...(payload && {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        connected = true;
        let responseText = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          if (responseText.length < 1_000_000) responseText += chunk;
        });
        res.on("end", () => {
          if (settled) return;
          settled = true;
          const status = res.statusCode || 0;
          if (status < 200 || status >= 300) {
            let responseBody = responseText;
            try {
              responseBody = responseText ? JSON.parse(responseText) : null;
            } catch {
              // Preserve a bounded, redacted response excerpt for diagnostics.
            }
            const authenticationFailure = status === 401 || status === 403;
            reject(
              new ConnectorError(
                authenticationFailure ? "AUTH_FAILED" : "API_HTTP_ERROR",
                authenticationFailure
                  ? "OpenLoomi rejected the local authentication token. Sign in again in OpenLoomi Desktop."
                  : `OpenLoomi returned HTTP ${status}.`,
                {
                  status,
                  method,
                  endpoint: url.pathname,
                  ...(authenticationFailure ? {} : { response: redact(responseBody) }),
                },
              ),
            );
            return;
          }
          let responseBody;
          try {
            responseBody = parseResponseBody(responseText, {
              status,
              method,
              endpoint: url.pathname,
            });
          } catch (error) {
            reject(error);
            return;
          }
          resolve({ data: responseBody, status, baseUrl });
        });
        const rejectResponseFailure = (sourceError) => {
          if (settled) return;
          settled = true;
          const error = sourceError instanceof Error ? sourceError : new Error("Response was aborted");
          error.code ||= "ECONNRESET";
          error.connected = true;
          reject(error);
        };
        res.on("aborted", () => rejectResponseFailure());
        res.on("error", rejectResponseFailure);
      },
    );

    req.on("socket", (socket) => {
      if (!socket.connecting) connected = true;
      socket.once("connect", () => {
        connected = true;
      });
    });
    req.setTimeout(timeoutMs, () => {
      const error = new Error(`Request timed out after ${timeoutMs}ms`);
      error.code = "ETIMEDOUT";
      req.destroy(error);
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      error.connected = connected;
      reject(error);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function matchesOpenLoomiProviderShape(data) {
  return Boolean(
    data &&
      typeof data === "object" &&
      Array.isArray(data.agents) &&
      typeof data.defaultAgent === "string",
  );
}

function attemptSummary(baseUrl, stage, error) {
  return {
    baseUrl,
    stage,
    code: error.code || "UNKNOWN_ERROR",
    ...(error.details?.status ? { status: error.details.status } : {}),
    connected: Boolean(error.connected),
  };
}

function isTransportError(error) {
  return !(error instanceof ConnectorError) && typeof error?.code === "string";
}

function unreachableError(attempts, tokenPresent) {
  const transportAttempts = attempts.filter((attempt) =>
    [
      "ECONNREFUSED",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "ENETDOWN",
      "ETIMEDOUT",
      "ECONNRESET",
    ].includes(attempt.code),
  );
  const loopbackAccessAmbiguous =
    transportAttempts.length > 0 &&
    transportAttempts.every((attempt) =>
      ["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ENETDOWN", "ETIMEDOUT", "ECONNRESET"].includes(
        attempt.code,
      ),
    );
  const sandboxDisabled = process.env.CODEX_SANDBOX_NETWORK_DISABLED === "1";
  return new ConnectorError(
    sandboxDisabled ? "SANDBOX_BLOCKED" : "LOCAL_API_UNREACHABLE",
    sandboxDisabled
      ? "Codex sandbox network access is disabled; the local OpenLoomi API cannot be reached."
      : "The local OpenLoomi API could not be reached or identified.",
    { attempts, tokenPresent, loopbackAccessAmbiguous },
  );
}

async function probeCandidate(baseUrl) {
  const response = await requestOnce(baseUrl, "/api/native/providers", {
    timeoutMs: configuredTimeout("OPENLOOMI_API_PROBE_TIMEOUT_MS", DEFAULT_PROBE_TIMEOUT_MS),
  });
  if (!matchesOpenLoomiProviderShape(response.data)) {
    throw new ConnectorError(
      "NOT_OPENLOOMI_API",
      "The loopback service did not match the expected OpenLoomi API response shape.",
      { baseUrl, endpoint: "/api/native/providers" },
    );
  }
  return response;
}

async function discoverOpenLoomi() {
  const attempts = [];
  let tokenPresent = false;
  try {
    tokenPresent = readTokenState().present;
  } catch {
    // Connection handoff does not require a token; token state is diagnostic only.
  }
  for (const baseUrl of getBaseUrls()) {
    try {
      await probeCandidate(baseUrl);
      return { baseUrl, attempts };
    } catch (error) {
      attempts.push(attemptSummary(baseUrl, "probe", error));
    }
  }
  throw unreachableError(attempts, tokenPresent);
}

async function apiRequest(endpoint, method = "GET", body = null) {
  const upperMethod = method.toUpperCase();
  const readOnly = upperMethod === "GET" || upperMethod === "HEAD";
  const token = requireAuthToken();
  const attempts = [];

  for (const baseUrl of getBaseUrls()) {
    try {
      await probeCandidate(baseUrl);
    } catch (error) {
      attempts.push(attemptSummary(baseUrl, "probe", error));
      continue;
    }

    try {
      const response = await requestOnce(baseUrl, endpoint, {
        method: upperMethod,
        body,
        token,
      });
      return response.data;
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      attempts.push(attemptSummary(baseUrl, "request", error));
      if (readOnly) continue;
      if (!error.connected && SAFE_PRECONNECT_ERRORS.has(error.code)) continue;
      throw new ConnectorError(
        "REQUEST_OUTCOME_UNKNOWN",
        `The ${upperMethod} request failed after connecting; it will not be retried automatically.`,
        { method: upperMethod, endpoint, baseUrl, cause: error.code || "NETWORK_ERROR" },
      );
    }
  }

  throw unreachableError(attempts, Boolean(token));
}

function sanitizeAccount(account) {
  if (!account || typeof account !== "object") return null;
  const allowed = [
    "id",
    "platform",
    "displayName",
    "status",
    "createdAt",
    "updatedAt",
    "botId",
    "hasValidContextToken",
  ];
  return Object.fromEntries(allowed.filter((key) => account[key] !== undefined).map((key) => [key, account[key]]));
}

async function listPlatforms() {
  return { platforms: PLATFORMS.map(({ id, name, aliases }) => ({ id, name, aliases })), total: PLATFORMS.length };
}

async function listAccounts() {
  const data = await apiRequest("/api/integrations/accounts");
  const accounts = Array.isArray(data) ? data : data?.accounts;
  if (!Array.isArray(accounts)) {
    throw new ConnectorError(
      "INVALID_API_RESPONSE",
      "OpenLoomi's accounts response did not contain an accounts array.",
    );
  }
  const sanitized = accounts.map(sanitizeAccount).filter(Boolean);
  return { accounts: sanitized, total: sanitized.length };
}

async function getStatus(platform) {
  const platformId = resolvePlatform(platform);
  if (!platformId) {
    throw new ConnectorError("UNKNOWN_PLATFORM", "Unsupported native connector platform.", {
      supportedPlatforms: PLATFORMS.map(({ id }) => id),
    });
  }
  const { accounts } = await listAccounts();
  const matching = accounts.filter((account) => account.platform === platformId);
  return {
    platform: platformId,
    connected: matching.some((account) => account.status === "active"),
    accounts: matching.map(({ platform: _platform, ...account }) => account),
  };
}

async function connectPlatform(platform, options = {}) {
  const platformId = resolvePlatform(platform);
  if (!platformId) {
    throw new ConnectorError("UNKNOWN_PLATFORM", "Unsupported native connector platform.", {
      supportedPlatforms: PLATFORMS.map(({ id }) => id),
    });
  }
  if (options && Object.keys(options).length > 0) {
    throw new ConnectorError(
      "SECRETS_NOT_ACCEPTED",
      "Connect accepts no credentials or secrets. Complete setup in OpenLoomi Desktop.",
    );
  }
  const { baseUrl } = await discoverOpenLoomi();
  const handoff = new URL("/connectors", `${baseUrl}/`);
  handoff.searchParams.set("addPlatform", "true");
  handoff.searchParams.set("platform", platformId);
  return {
    platform: platformId,
    handoffUrl: handoff.toString(),
    instructions: "Open this URL in the running OpenLoomi Desktop app to complete the connection.",
  };
}

async function disconnectAccount(accountId) {
  if (typeof accountId !== "string" || !accountId.trim()) {
    throw new ConnectorError("INVALID_ARGUMENT", "Account ID is required.");
  }
  const result = await apiRequest(
    `/api/integrations/${encodeURIComponent(accountId.trim())}`,
    "DELETE",
  );
  return requireOperationSuccess(result, "disconnect");
}

async function queryContacts(options = {}) {
  const page = Number.isInteger(options.page) && options.page > 0 ? options.page : 1;
  const pageSize = Number.isInteger(options.pageSize) && options.pageSize > 0 ? Math.min(options.pageSize, 100) : 10;
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (typeof options.name === "string" && options.name.trim()) params.set("name", options.name.trim());
  return apiRequest(`/api/contacts?${params}`);
}

async function sendReply(options = {}) {
  const { botId, recipients, message, subject, cc, bcc } = options;
  const validStringList = (value, { required = false } = {}) =>
    value === undefined
      ? !required
      : Array.isArray(value) &&
        (!required || value.length > 0) &&
        value.every(
          (item) => typeof item === "string" && item.trim().length > 0,
        );
  if (
    typeof botId !== "string" ||
    !botId.trim() ||
    !validStringList(recipients, { required: true }) ||
    typeof message !== "string" ||
    !message.trim() ||
    (subject !== undefined && typeof subject !== "string") ||
    !validStringList(cc) ||
    !validStringList(bcc)
  ) {
    throw new ConnectorError("INVALID_ARGUMENT", "botId, a non-empty recipients array, and message are required.");
  }
  const result = await apiRequest("/api/messages", "POST", {
    botId: botId.trim(),
    recipients: recipients.map((item) => item.trim()),
    message,
    subject,
    cc: cc?.map((item) => item.trim()),
    bcc: bcc?.map((item) => item.trim()),
  });
  return requireOperationSuccess(result, "send_reply");
}

function requireOperationSuccess(result, operation) {
  if (result && typeof result === "object" && result.success === true) {
    return result;
  }
  if (result && typeof result === "object" && result.success === false) {
    throw new ConnectorError(
      "API_OPERATION_FAILED",
      `OpenLoomi could not complete ${operation}.`,
      { operation },
    );
  }
  throw new ConnectorError(
    "INVALID_API_RESPONSE",
    `OpenLoomi returned an invalid ${operation} response.`,
    { operation },
  );
}

function parseNamedArgs(args) {
  const result = {};
  for (const arg of args) {
    if (!arg.startsWith("--") || !arg.includes("=")) continue;
    const separator = arg.indexOf("=");
    result[arg.slice(2, separator)] = arg.slice(separator + 1);
  }
  return result;
}

function printJson(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  try {
    let result;
    switch (command) {
      case "list-platforms":
        result = await listPlatforms();
        break;
      case "list-accounts":
        result = await listAccounts();
        break;
      case "status":
        result = await getStatus(args[0]);
        break;
      case "connect": {
        if (!args[0]) throw new ConnectorError("INVALID_ARGUMENT", "Platform is required: connect <platform>.");
        if (args.length > 1) {
          throw new ConnectorError(
            "SECRETS_NOT_ACCEPTED",
            "Connect accepts only a platform name. Complete setup in OpenLoomi Desktop.",
          );
        }
        const named = parseNamedArgs(args.slice(1));
        result = await connectPlatform(args[0], named);
        break;
      }
      case "disconnect":
        if (parseNamedArgs(args.slice(1)).confirmed !== "true") {
          throw new ConnectorError(
            "CONFIRMATION_REQUIRED",
            "Disconnect requires --confirmed=true after the user approves the exact account.",
          );
        }
        result = await disconnectAccount(args[0]);
        break;
      case "query-contacts": {
        const named = parseNamedArgs(args);
        result = await queryContacts({
          name: named.name,
          page: named.page ? Number.parseInt(named.page, 10) : 1,
          pageSize: named.pageSize ? Number.parseInt(named.pageSize, 10) : 10,
        });
        break;
      }
      case "send-reply": {
        const named = parseNamedArgs(args);
        if (named.confirmed !== "true") {
          throw new ConnectorError(
            "CONFIRMATION_REQUIRED",
            "Sending requires --confirmed=true after the user approves the exact bot, recipients, and message.",
          );
        }
        result = await sendReply({
          botId: named.botId,
          recipients: named.recipients?.split(",").map((item) => item.trim()).filter(Boolean),
          message: named.message,
          subject: named.subject,
          cc: named.cc?.split(",").map((item) => item.trim()).filter(Boolean),
          bcc: named.bcc?.split(",").map((item) => item.trim()).filter(Boolean),
        });
        break;
      }
      case undefined:
      case "help":
      case "--help":
      case "-h":
        result = {
          usage: [
            "list-platforms",
            "list-accounts",
            "status <platform>",
            "connect <platform>",
            "disconnect <accountId> --confirmed=true",
            "query-contacts [--name=] [--page=] [--pageSize=]",
            "send-reply --botId= --recipients= --message= --confirmed=true [--subject=] [--cc=] [--bcc=]",
          ],
        };
        break;
      default:
        throw new ConnectorError(
          "UNKNOWN_COMMAND",
          "Unknown command. Run with --help for usage.",
        );
    }
    printJson(result);
  } catch (error) {
    const structured = error instanceof ConnectorError
      ? error.toJSON()
      : { code: "INTERNAL_ERROR", message: error?.message || "Unexpected connector error." };
    printJson({ error: structured }, process.stderr);
    process.exitCode = 1;
  }
}

module.exports = {
  ConnectorError,
  PLATFORMS,
  apiRequest,
  connectPlatform,
  disconnectAccount,
  discoverOpenLoomi,
  getBaseUrls,
  getStatus,
  listAccounts,
  listPlatforms,
  queryContacts,
  readTokenState,
  resolvePlatform,
  sanitizeAccount,
  sendReply,
};

if (require.main === module) {
  main();
}
