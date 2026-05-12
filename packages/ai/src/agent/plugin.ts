/**
 * Agent Plugin System
 *
 * Provides plugin definition and registration for agent providers.
 * Supports extending the system with custom agent implementations.
 */

import type { AgentConfig, AgentProvider, IAgent, TaskPlan } from "./types";

// ============================================================================
// Inlined constants (previously from lib/config/constants)
// ============================================================================

/** Default agent model */
export const DEFAULT_AGENT_MODEL = "claude-sonnet-4.6";

/** Default work directory path (relative to home) */
export const DEFAULT_WORK_DIR = "~/.alloomi";

// ============================================================================
// Minimal inlined types (from provider-core)
// ============================================================================

/**
 * Provider metadata interface (minimal version)
 */
export interface ProviderMetadata {
  /** Unique type identifier */
  type: string;
  /** Human-readable name */
  name: string;
  /** Description of the provider */
  description?: string;
  /** Version string */
  version?: string;
  /** Provider capabilities */
  capabilities?: Record<string, unknown>;
  /** Configuration schema for validation */
  configSchema?: Record<string, unknown>;
}

// ============================================================================
// Agent Plugin Types
// ============================================================================

/**
 * Extended metadata for agent providers
 */
export interface AgentProviderMetadata extends ProviderMetadata {
  /** Whether this is a built-in provider */
  builtin?: boolean;
  /** Whether the agent supports planning phase */
  supportsPlan: boolean;
  /** Whether the agent supports streaming responses */
  supportsStreaming: boolean;
  /** Supported models (if configurable) */
  supportedModels?: string[];
  /** Default model */
  defaultModel?: string;
  /** Whether sandbox mode is supported */
  supportsSandbox: boolean;
  /** Tags for categorization */
  tags?: string[];
}

/**
 * Agent provider plugin
 */
export interface AgentPlugin {
  metadata: AgentProviderMetadata;
  factory: (config: AgentConfig) => IAgent;
  onInit?: () => Promise<void>;
  onDestroy?: () => Promise<void>;
}

// ============================================================================
// Plugin Definition Helper
// ============================================================================

/**
 * Define an agent plugin with type safety
 *
 * @example
 * ```typescript
 * export default defineAgentPlugin({
 *   metadata: {
 *     type: "claude",
 *     name: "Claude Agent",
 *     version: "1.0.0",
 *     description: "Claude Agent SDK integration",
 *     configSchema: {...},
 *     supportsPlan: true,
 *     supportsStreaming: true,
 *     supportsSandbox: true,
 *   },
 *   factory: (config) => new ClaudeAgent(config),
 * });
 * ```
 */
export function defineAgentPlugin(plugin: AgentPlugin): AgentPlugin {
  // Validate required fields
  if (!plugin.metadata.type) {
    throw new Error("Agent plugin must have a type");
  }
  if (!plugin.metadata.name) {
    throw new Error("Agent plugin must have a name");
  }
  if (typeof plugin.factory !== "function") {
    throw new Error("Agent plugin must have a factory function");
  }

  return plugin;
}

// ============================================================================
// Default Config Schemas
// ============================================================================

/**
 * JSON Schema for Claude agent configuration
 */
export const CLAUDE_CONFIG_SCHEMA = {
  type: "object",
  properties: {
    apiKey: {
      type: "string",
      description: "Anthropic API key",
    },
    baseUrl: {
      type: "string",
      description: "Custom API base URL",
    },
    model: {
      type: "string",
      default: DEFAULT_AGENT_MODEL,
      description: "Claude model to use",
    },
    workDir: {
      type: "string",
      default: DEFAULT_WORK_DIR,
      description: "Working directory for file operations",
    },
  },
};

/**
 * JSON Schema for Codex agent configuration
 */
export const CODEX_CONFIG_SCHEMA = {
  type: "object",
  properties: {
    apiKey: {
      type: "string",
      description: "OpenAI API key",
    },
    codexPath: {
      type: "string",
      description: "Path to codex CLI executable",
    },
    model: {
      type: "string",
      default: "gpt-4",
      description: "OpenAI model to use",
    },
    workDir: {
      type: "string",
      default: DEFAULT_WORK_DIR,
      description: "Working directory for file operations",
    },
  },
};

/**
 * JSON Schema for DeepAgents configuration
 */
export const DEEPAGENTS_CONFIG_SCHEMA = {
  type: "object",
  properties: {
    apiKey: {
      type: "string",
      description: "API key for the underlying LLM provider",
    },
    model: {
      type: "string",
      default: DEFAULT_AGENT_MODEL,
      description: "Model to use",
    },
    workDir: {
      type: "string",
      default: DEFAULT_WORK_DIR,
      description: "Working directory for file operations",
    },
  },
};

// ============================================================================
// Built-in Plugin Metadata
// ============================================================================

/**
 * Metadata for built-in Claude agent
 */
export const CLAUDE_METADATA: AgentProviderMetadata = {
  type: "claude",
  name: "Claude Agent",
  version: "1.0.0",
  description:
    "Claude Agent SDK integration with full planning and execution support. Uses Anthropic Claude models.",
  configSchema: CLAUDE_CONFIG_SCHEMA,
  builtin: true,
  supportsPlan: true,
  supportsStreaming: true,
  supportsSandbox: true,
  supportedModels: [
    "anthropic/claude-sonnet-4.6",
    "anthropic/claude-sonnet-4.5",
    "anthropic/claude-opus-4.6",
    "anthropic/claude-opus-4.7",
    "anthropic/claude-haiku-4.5",
    "google/gemini-3-flash-preview",
    "google/gemini-3-pro-preview",
    "google/gemini-3.1-flash-lite-preview",
    "google/gemini-3.1-pro-preview",
    "x-ai/grok-4.3",
    "x-ai/grok-4.20",
    "deepseek/deepseek-v4-flash",
    "deepseek/deepseek-v4-pro",
    "z-ai/glm-5",
    "z-ai/glm-5.1",
    "moonshotai/kimi-k2.5",
    "moonshotai/kimi-k2.6",
    "minimax/minimax-m2.5",
    "minimax/minimax-m2.7",
    "stepfun/step-3.5-flash",
    "xiaomi/mimo-v2.5",
    "xiaomi/mimo-v2.5-pro",
    "qwen/qwen3.6-flash",
    "qwen/qwen3.6-plus",
  ],
  defaultModel: "claude-sonnet-4-20250514",
  tags: ["anthropic", "claude", "planning", "streaming"],
};

/**
 * Metadata for built-in Codex agent
 */
export const CODEX_METADATA: AgentProviderMetadata = {
  type: "codex",
  name: "Codex CLI",
  version: "1.0.0",
  description:
    "OpenAI Codex CLI integration. Uses OpenAI models through the codex command-line tool.",
  configSchema: CODEX_CONFIG_SCHEMA,
  builtin: true,
  supportsPlan: true,
  supportsStreaming: true,
  supportsSandbox: true,
  supportedModels: ["gpt-5.4", "gpt-4", "gpt-4-turbo", "gpt-3.5-turbo"],
  defaultModel: "gpt-5.4",
  tags: ["openai", "codex", "cli"],
};

/**
 * Metadata for built-in DeepAgents adapter
 */
export const DEEPAGENTS_METADATA: AgentProviderMetadata = {
  type: "deepagents",
  name: "DeepAgents",
  version: "1.0.0",
  description:
    "DeepAgents.js framework integration using LangGraph. Supports multiple LLM providers.",
  configSchema: DEEPAGENTS_CONFIG_SCHEMA,
  builtin: true,
  supportsPlan: true,
  supportsStreaming: true,
  supportsSandbox: false,
  tags: ["langgraph", "deepagents", "multi-provider"],
};
