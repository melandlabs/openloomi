import type { AgentProviderMetadata } from "@openloomi/ai/agent/plugin";

export const OPENCLAW_CONFIG_SCHEMA = {
  type: "object",
  properties: {
    workDir: {
      type: "string",
      description: "Working directory for OpenClaw ACP sessions",
    },
    providerConfig: {
      type: "object",
      properties: {
        openclawPath: { type: "string" },
        gatewayUrl: { type: "string" },
        tokenFile: { type: "string" },
        passwordFile: { type: "string" },
        session: { type: "string" },
        sessionLabel: { type: "string" },
        requireExisting: { type: "boolean" },
        resetSession: { type: "boolean" },
        noPrefixCwd: { type: "boolean" },
        provenance: {
          type: "string",
          enum: ["off", "meta", "meta+receipt"],
        },
        timeoutMs: { type: "number" },
      },
    },
  },
};

export const OPENCLAW_METADATA: AgentProviderMetadata = {
  type: "openclaw",
  name: "OpenClaw",
  version: "1.0.0",
  description:
    "OpenClaw Gateway-backed ACP bridge using openclaw acp over stdio.",
  configSchema: OPENCLAW_CONFIG_SCHEMA,
  builtin: true,
  supportsPlan: true,
  supportsStreaming: true,
  supportsSandbox: false,
  tags: ["openclaw", "acp", "gateway", "browser-agent"],
};
