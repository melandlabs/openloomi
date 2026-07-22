import type { AgentProviderMetadata } from "@openloomi/ai/agent/plugin";

export const CODEX_CONFIG_SCHEMA = {
  type: "object",
  properties: {
    model: {
      type: "string",
      description:
        "Codex model id (e.g. gpt-5.4 or a configured alias from ~/.codex/config.toml).",
    },
    workDir: {
      type: "string",
      description: "Working directory for Codex file operations.",
    },
    providerConfig: {
      type: "object",
      properties: {
        codexPath: {
          type: "string",
          description: "Path to the codex CLI executable.",
        },
        profile: {
          type: "string",
          description: "Optional Codex profile passed as -p <name>.",
        },
        sandbox: {
          type: "string",
          enum: ["read-only", "workspace-write", "danger-full-access"],
          description:
            "Sandbox mode forwarded to the Codex CLI. Planning always uses read-only. Execution defaults to workspace-write, which OpenLoomi maps to danger-full-access on macOS so Codex can reach local and remote services.",
        },
        askForApproval: {
          type: "string",
          enum: ["untrusted", "on-failure", "on-request", "never"],
          description:
            "Approval policy forwarded to the Codex CLI. Defaults to on-request.",
        },
        fullAuto: {
          type: "boolean",
          default: false,
          description:
            "Allow passing --full-auto when OpenLoomi permissionMode is bypassPermissions.",
        },
        skipGitRepoCheck: {
          type: "boolean",
          default: true,
          description:
            "Pass --skip-git-repo-check so Codex can run outside a git working tree.",
        },
        timeoutMs: {
          type: "number",
          description: "Maximum Codex CLI runtime in milliseconds.",
        },
        extraArgs: {
          type: "array",
          items: { type: "string" },
          description:
            "Additional CLI args appended after a guard so caller-provided values cannot inject Codex flags.",
        },
      },
    },
  },
};

export const CODEX_METADATA: AgentProviderMetadata = {
  type: "codex",
  name: "Codex CLI",
  version: "1.0.0",
  description:
    "OpenAI Codex CLI runtime integration using `codex exec --json` (NDJSON event stream).",
  configSchema: CODEX_CONFIG_SCHEMA,
  builtin: true,
  supportsPlan: true,
  supportsStreaming: true,
  supportsSandbox: false,
  supportedModels: [
    "gpt-5.4",
    "gpt-5-codex",
    "gpt-5",
    "o4-mini",
    "o3",
    "gpt-4.1",
    "gpt-4o",
  ],
  defaultModel: "gpt-5.4",
  tags: ["openai", "codex", "cli", "coding-agent"],
};
