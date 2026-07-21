#!/usr/bin/env node
"use strict";

const readline = require("node:readline");
const connectors = require("../skills/openloomi-connectors/scripts/openloomi-connectors.cjs");
const pluginManifest = require("../.codex-plugin/plugin.json");

const SERVER_INFO = {
  name: "openloomi-connectors",
  version: pluginManifest.version,
};
const PROTOCOL_VERSION = "2025-03-26";
const MAX_REQUEST_BYTES = 1024 * 1024;

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const TOOLS = [
  {
    name: "list_platforms",
    description:
      "List the seven connector platforms supported by the local OpenLoomi Desktop app.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
  },
  {
    name: "list_accounts",
    description:
      "List connected OpenLoomi accounts with credential and metadata fields removed.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
  },
  {
    name: "connector_status",
    description:
      "Check whether a supported connector platform has connected accounts.",
    inputSchema: {
      type: "object",
      properties: {
        platform: {
          type: "string",
          minLength: 1,
          description: "Platform ID or supported alias.",
        },
      },
      required: ["platform"],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
  },
  {
    name: "connect",
    description:
      "Return a handoff URL for completing a connector login in the running OpenLoomi Desktop app. This tool never accepts secrets.",
    inputSchema: {
      type: "object",
      properties: {
        platform: {
          type: "string",
          minLength: 1,
          description: "Platform ID or supported alias.",
        },
      },
      required: ["platform"],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
  },
  {
    name: "disconnect",
    description:
      "Disconnect an OpenLoomi connector account. Requires confirmed=true because this deletes the connection.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: {
          type: "string",
          minLength: 1,
          description: "Account ID returned by list_accounts.",
        },
        confirmed: {
          type: "boolean",
          const: true,
          description: "Explicit confirmation of disconnection.",
        },
      },
      required: ["accountId", "confirmed"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "query_contacts",
    description: "Search contacts available to connected OpenLoomi accounts.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1 },
        page: { type: "integer", minimum: 1, default: 1 },
        pageSize: { type: "integer", minimum: 1, maximum: 100, default: 10 },
      },
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations,
  },
  {
    name: "send_reply",
    description:
      "Send a message through a connected bot. Requires confirmed=true because delivery is an external side effect.",
    inputSchema: {
      type: "object",
      properties: {
        botId: { type: "string", minLength: 1 },
        recipients: {
          type: "array",
          minItems: 1,
          items: { type: "string", minLength: 1 },
        },
        message: { type: "string", minLength: 1 },
        subject: { type: "string", minLength: 1 },
        cc: {
          type: "array",
          items: { type: "string", minLength: 1 },
        },
        bcc: {
          type: "array",
          items: { type: "string", minLength: 1 },
        },
        confirmed: {
          type: "boolean",
          const: true,
          description: "Explicit confirmation to send.",
        },
      },
      required: ["botId", "recipients", "message", "confirmed"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
];

function connectorError(error) {
  if (error instanceof connectors.ConnectorError) return error.toJSON();
  return {
    code: "INTERNAL_ERROR",
    message: error?.message || "Unexpected connector error.",
  };
}

function toolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function requireConfirmation(args, action) {
  if (args.confirmed !== true) {
    throw new connectors.ConnectorError(
      "CONFIRMATION_REQUIRED",
      `${action} requires confirmed=true after the user explicitly approves it.`,
    );
  }
}

function checkedArguments(args, allowedKeys) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new connectors.ConnectorError(
      "INVALID_ARGUMENT",
      "Tool arguments must be an object.",
    );
  }
  const unexpected = Object.keys(args).filter(
    (key) => !allowedKeys.includes(key),
  );
  if (unexpected.length > 0) {
    throw new connectors.ConnectorError(
      "INVALID_ARGUMENT",
      "Unexpected tool arguments were provided.",
    );
  }
  return args;
}

function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new connectors.ConnectorError(
      "INVALID_ARGUMENT",
      `${field} must be a non-empty string.`,
    );
  }
  return value.trim();
}

function optionalString(value, field) {
  return value === undefined ? undefined : requiredString(value, field);
}

function stringArray(value, field, { required = false } = {}) {
  if (value === undefined && !required) return undefined;
  if (
    !Array.isArray(value) ||
    (required && value.length === 0) ||
    value.some((item) => typeof item !== "string" || !item.trim())
  ) {
    throw new connectors.ConnectorError(
      "INVALID_ARGUMENT",
      `${field} must be ${required ? "a non-empty" : "an"} array of non-empty strings.`,
    );
  }
  return value.map((item) => item.trim());
}

function optionalInteger(value, field, maximum) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new connectors.ConnectorError(
      "INVALID_ARGUMENT",
      `${field} must be an integer between 1 and ${maximum}.`,
    );
  }
  return value;
}

async function callTool(name, args = {}) {
  switch (name) {
    case "list_platforms":
      checkedArguments(args, []);
      return connectors.listPlatforms();
    case "list_accounts":
      checkedArguments(args, []);
      return connectors.listAccounts();
    case "connector_status": {
      const input = checkedArguments(args, ["platform"]);
      return connectors.getStatus(requiredString(input.platform, "platform"));
    }
    case "connect": {
      const input = checkedArguments(args, ["platform"]);
      return connectors.connectPlatform(
        requiredString(input.platform, "platform"),
      );
    }
    case "disconnect": {
      const input = checkedArguments(args, ["accountId", "confirmed"]);
      requireConfirmation(input, "Disconnect");
      return connectors.disconnectAccount(
        requiredString(input.accountId, "accountId"),
      );
    }
    case "query_contacts": {
      const input = checkedArguments(args, ["name", "page", "pageSize"]);
      return connectors.queryContacts({
        name: optionalString(input.name, "name"),
        page: optionalInteger(input.page, "page", Number.MAX_SAFE_INTEGER),
        pageSize: optionalInteger(input.pageSize, "pageSize", 100),
      });
    }
    case "send_reply": {
      const input = checkedArguments(args, [
        "botId",
        "recipients",
        "message",
        "subject",
        "cc",
        "bcc",
        "confirmed",
      ]);
      requireConfirmation(input, "Sending a reply");
      return connectors.sendReply({
        botId: requiredString(input.botId, "botId"),
        recipients: stringArray(input.recipients, "recipients", {
          required: true,
        }),
        message: requiredString(input.message, "message"),
        subject: optionalString(input.subject, "subject"),
        cc: stringArray(input.cc, "cc"),
        bcc: stringArray(input.bcc, "bcc"),
      });
    }
    default:
      throw new connectors.ConnectorError(
        "UNKNOWN_TOOL",
        "Unknown connector tool.",
      );
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleRequest(request) {
  const { id, method, params = {} } = request;
  if (
    method === "notifications/initialized" ||
    method === "notifications/cancelled"
  )
    return;
  if (id === undefined || id === null) return;

  try {
    let result;
    switch (method) {
      case "initialize":
        result = {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            "Use these host-side tools for native OpenLoomi connector operations. Never place connector credentials in tool arguments; connect returns a Desktop UI handoff.",
        };
        break;
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = { tools: TOOLS };
        break;
      case "tools/call":
        try {
          result = toolResult(
            await callTool(params.name, params.arguments || {}),
          );
        } catch (error) {
          const structured = { error: connectorError(error) };
          result = { ...toolResult(structured), isError: true };
        }
        break;
      default:
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
        return;
    }
    send({ jsonrpc: "2.0", id, result });
  } catch (error) {
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: error?.message || "Internal error" },
    });
  }
}

function startServer() {
  const input = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });
  input.on("line", (line) => {
    if (!line.trim()) return;
    if (Buffer.byteLength(line) > MAX_REQUEST_BYTES) {
      send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "MCP request exceeded 1 MiB." },
      });
      return;
    }
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
      return;
    }
    void handleRequest(request);
  });
}

module.exports = { TOOLS, callTool, handleRequest, startServer };

if (require.main === module) {
  startServer();
}
