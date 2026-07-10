import type { AgentProviderMetadata } from "@openloomi/ai/agent/plugin";

export const HERMES_CONFIG_SCHEMA = {
  type: "object",
  properties: {
    model: {
      type: "string",
      description:
        "Hermes ACP model id, optionally qualified as provider:model",
    },
    workDir: {
      type: "string",
      description: "Working directory for Hermes ACP sessions",
    },
    providerConfig: {
      type: "object",
      properties: {
        hermesPath: {
          type: "string",
          description: "Path to the Hermes CLI executable",
        },
        profile: {
          type: "string",
          description: "Hermes profile passed as --profile before acp",
        },
        timeoutMs: {
          type: "number",
          description: "Maximum Hermes ACP prompt runtime in milliseconds",
        },
      },
    },
  },
};

export const HERMES_METADATA: AgentProviderMetadata = {
  type: "hermes",
  name: "Hermes",
  version: "1.0.0",
  description:
    "Hermes ACP runtime provider using hermes acp over stdio JSON-RPC.",
  configSchema: HERMES_CONFIG_SCHEMA,
  builtin: true,
  supportsPlan: true,
  supportsStreaming: true,
  supportsSandbox: false,
  tags: ["hermes", "acp", "coding-agent"],
};
