/**
 * @openloomi/agent - Agent SDK Abstraction Layer
 *
 * Core types, base class, plugin system, and registry for agent providers.
 */

// Types
export type {
  AgentConfig,
  AgentMessage,
  AgentMessageType,
  AgentOptions,
  BuiltinAgentProvider,
  AgentProvider,
  AgentQuestion,
  AgentRequest,
  AgentSession,
  AgentSubagentDefinition,
  ConversationMessage,
  ExecuteOptions,
  FileAttachment,
  IAgent,
  ImageAttachment,
  McpConfig,
  ModelConfig,
  PDFAttachment,
  PlanOptions,
  PlanStep,
  ProviderCapabilities,
  Question,
  QuestionOption,
  SandboxConfig,
  SandboxProviderType,
  SkillsConfig,
  TaskPlan,
  ToolDefinition,
  AgentFactory,
  AgentRegistryInterface,
} from "./types";

export { DEFAULT_ALLOWED_TOOLS } from "./types";

// Compaction preprocessing
// Exported from the package root so apps can depend on the shared algorithm
// without reaching into app-specific source paths.
export {
  sanitizeCompactionMessage,
  sanitizeCompactionMessages,
  groupCompactionMessages,
  flattenCompactionGroups,
  truncateOldestCompactionGroups,
  preprocessCompactionMessages,
  type CompactionPreprocessMessage,
  type CompactionMessageGroup,
  type CompactionPreprocessOptions,
} from "./compaction-preprocess";

// Plugin system
export {
  defineAgentPlugin,
  CLAUDE_CONFIG_SCHEMA,
  CODEX_CONFIG_SCHEMA,
  DEEPAGENTS_CONFIG_SCHEMA,
  CLAUDE_METADATA,
  CODEX_METADATA,
  DEEPAGENTS_METADATA,
  DEFAULT_AGENT_MODEL,
  DEFAULT_WORK_DIR,
  type AgentPlugin,
  type AgentProviderMetadata,
  type ProviderMetadata,
} from "./plugin";

// Base agent
export {
  BaseAgent,
  CLAUDE_CODE_READ_TOOL_WORKAROUND_INSTRUCTION,
  PLANNING_INSTRUCTION,
  getWorkspaceInstruction,
  formatPlanForExecution,
  parsePlanningResponse,
  parsePlanFromResponse,
  getLanguageInstructionForBase,
  getProfessionalOutputStyleInstruction,
  withClaudeCodeReadToolWorkaroundForSubagents,
  withClaudeCodeReadToolWorkaround,
  type AgentCapabilities,
  type SandboxOptions,
  type PlanningResponse,
} from "./base";

// Registry
export {
  AgentRegistry,
  getAgentRegistry,
  registerAgentProvider,
  registerAgentPlugin,
  createAgentFromConfig,
  getAgentInstance,
  getAvailableAgentProviders,
  getRegisteredAgentProviders,
  getAllAgentMetadata,
  stopAllAgentProviders,
} from "./registry";

// Sandbox
export * from "./sandbox";

// Billing (tokens, pricing)
export * from "./billing";

// Compaction
export * from "./compaction";

// Context (conversation windows)
export * from "./context";

// Model providers
export * from "./model";

// Routing
export * from "./routing";

// Runtime
export * from "./runtime";

// Native agent runner
export * from "./native-runner";

// Native agent CLI
export * from "./native-cli";

// Video Generation
export * from "./video-gen";

// Utils
export { extractJsonFromMarkdown } from "./utils";

// Language directive (ports + default adapter)
export type {
  DirectiveChannel,
  LanguageDirectiveBuilder,
} from "./ports/language-directive.port";
export {
  DefaultLanguageDirectiveBuilder,
  defaultLanguageDirectiveBuilder,
} from "./adapters/default-language-directive-builder";
