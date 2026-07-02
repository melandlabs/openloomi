/**
 * Agent SDK Abstraction Layer - Type Definitions
 *
 * This module defines the common interfaces for different agent implementations.
 * Supports: Claude Agent SDK, DeepAgents.js, and custom implementations.
 */

// ============================================================================
// Re-export from sandbox package
// ============================================================================

import type { SandboxConfig, SandboxProviderType } from "./sandbox/types";
import type { PromptCacheStats } from "./billing/model-pricing";

// Re-export as types (for external consumers)
export type { SandboxConfig, SandboxProviderType };

// ============================================================================
// Minimal inlined types (from provider-core)
// ============================================================================

export interface ProviderCapabilities {
  [key: string]: boolean | string | string[] | undefined;
}

// ============================================================================
// Model Configuration
// ============================================================================

/**
 * Model configuration for custom API endpoints
 */
export interface ModelConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  thinkingLevel?: "disabled" | "low" | "adaptive";
}

export interface AgentSubagentDefinition {
  /** Natural-language description of when this subagent should be used. */
  description: string;
  /** Dedicated system prompt for the subagent. */
  prompt: string;
  /** Tool names the subagent may use. Omit to inherit provider defaults. */
  tools?: string[];
  /** Tool names explicitly unavailable to the subagent. */
  disallowedTools?: string[];
  /** Model alias or concrete model id. "inherit" uses the parent model. */
  model?: "inherit" | "haiku" | "sonnet" | "opus" | string;
}

// ============================================================================
// Message Types
// ============================================================================

export type AgentMessageType =
  | "session"
  | "text"
  | "tool_use"
  | "tool_result"
  | "result"
  | "error"
  | "done"
  | "plan"
  | "direct_answer"
  | "question"
  | "capabilityRequest"
  | "insightsRefresh"
  | "permission_request"
  | "password_input"
  | "reasoning"
  | "rulesUpdated"
  | "memoryUpdate"
  | "artifact_baseline"
  | "scheduleNotice"
  | "retry";

export interface AgentMessage {
  type: AgentMessageType;
  /** Unique identifier for deduplication */
  messageId?: string;
  sessionId?: string;
  content?: string;
  name?: string;
  id?: string;
  input?: unknown;
  cost?: number;
  duration?: number;
  /** Tool result fields */
  toolUseId?: string;
  output?: string;
  isError?: boolean;
  /**
   * Content-addressed snapshots of files this tool result produced, keyed by
   * the generated-file path as resolved from the tool input/output. Values
   * are session-relative paths under `.snapshots/`. Attached server-side on
   * `tool_result` messages so chat message parts can reference the immutable
   * version that existed when the message was created, even after the live
   * file is edited in place.
   */
  fileSnapshots?: Record<string, string>;
  /** Plan fields */
  plan?: TaskPlan;
  /** Error fields */
  message?: string;
  /** Question fields (for interactive skills) */
  question?: AgentQuestion;
  /**
   * Capability authorization request — emitted when the agent calls the
   * `requestAuthorization` MCP tool because the user is missing a connector or
   * native permission needed to fulfil the request. The agent loop PARKS until
   * the client resolves it (the user connects what they want and clicks
   * Continue), so the model cannot fabricate an empty result in the meantime.
   * `primaryCapabilityIds` and `secondaryCapabilityIds` preserve the LLM's
   * priority judgement from the maintained connector capability guide plus the
   * user's intent. `capabilityIds` is the merged compatibility list (connector
   * platform ids like "slack" or permission ids like
   * "macos:screen-recording"); the client resolves them to concrete
   * capabilities and renders the unified guidance card.
   */
  capabilityRequest?: {
    id: string;
    capabilityIds: string[];
    primaryCapabilityIds?: string[];
    secondaryCapabilityIds?: string[];
    reason?: string | null;
    status?: "pending" | "resolved" | "cancelled";
  };
  /** Insight change fields (for optimistic updates) */
  action?: "create" | "update" | "delete";
  insightId?: string;
  insight?: Record<string, unknown>;
  /** Scoped assistant behavior rules updated by the agent. */
  rulesUpdated?: {
    scopeType: "global" | "task";
    scopeId: string;
    rules: Array<{
      id: string;
      ruleType: string;
      ruleKey: string;
      value: Record<string, unknown>;
      displayLabel: string;
      enabled: boolean;
      source: string;
    }>;
  };
  /**
   * Memory update fields — fired when the agent writes a user-fact markdown
   * file under the memory directory (people / projects / notes / strategy).
   * The UI surfaces this as a notification card so the user can see which
   * pieces of their information the agent just updated.
   */
  memoryUpdate?: {
    category: string;
    fileName: string;
    displayLabel: string;
    action: "create" | "update";
    description?: string;
    filePath?: string;
  };
  /**
   * Task schedule notice — fired during the first task turn when the async
   * bootstrap could not apply the recurring schedule the user asked for
   * (e.g. an interval below the supported minimum). The UI surfaces this as a
   * warning toast so the user perceives that no automatic schedule was set.
   */
  scheduleNotice?: "below_minimum";
  /** Prompt cache statistics — populated on 'result' messages when cache data is available */
  cacheStats?: PromptCacheStats;
  /** Raw token usage from SDK — populated on 'result' messages */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Permission request fields */
  permissionRequest?: {
    toolName: string;
    toolInput: Record<string, unknown>;
    toolUseID: string;
    decisionReason?: string;
    blockedPath?: string;
  };
  /** Password input fields (for sudo commands) */
  passwordInput?: {
    toolUseID: string;
    originalCommand: string;
  };
  /** Workspace artifact attribution baseline timestamp. */
  artifactBaselineAt?: string;
  /**
   * Retry fields — emitted on 'retry' messages when the provider restarts a
   * query after a transient error (issue #2488). `attempt` is the 1-based
   * number of the upcoming attempt and `maxAttempts` the total it may run.
   * The UI uses these to surface a clear, localized retry notice and to drop
   * the reasoning accumulated in the aborted round (which the restart
   * re-generates) so duplicate thinking does not stack up.
   */
  attempt?: number;
  maxAttempts?: number;
}

/**
 * Agent question for interactive skills (AskUserQuestion)
 */
export interface AgentQuestion {
  id: string;
  questions: Question[];
  status?: "pending" | "answered" | "cancelled";
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
  /** Image file paths attached to this message (saved to workspace) */
  imagePaths?: string[];
}

/**
 * Delivery semantics for input that arrives while a run is active.
 *
 * - "steer": the user wants to redirect the agent NOW. The host interrupts the
 *   current assistant turn so the input is seen immediately (the only way to
 *   get the model's attention before the turn boundary with the current SDK).
 * - "inform": a notification the agent should pick up at the next natural
 *   boundary (next tool result, or the turn boundary) WITHOUT interrupting —
 *   e.g. "the user just authorized Gmail". Never aborts in-flight work and
 *   never produces interrupt markers in the transcript.
 */
export type AgentSupplementalInputIntent = "steer" | "inform";

export interface AgentSupplementalInput {
  id: string;
  content: string;
  createdAt: string;
  /** Defaults to "steer" when absent (legacy producers). */
  intent?: AgentSupplementalInputIntent;
}

export interface AgentSupplementalInputSource extends AsyncIterable<AgentSupplementalInput> {
  /**
   * Called by provider implementations so the host can interrupt the current
   * assistant turn when a user sends new input into the active run. Only
   * "steer" inputs trigger this handler; "inform" inputs wait for a boundary.
   */
  setInterruptHandler?: (handler: (() => Promise<void> | void) | null) => void;
  /** Returns true when user input is queued but not yet yielded to the SDK. */
  hasPending?: () => boolean;
  /**
   * Atomically removes and returns queued "inform" inputs so an adapter can
   * surface them at a tool boundary (appended to the tool result) instead of
   * waiting for the turn boundary. Inputs returned here are considered
   * consumed and will not be yielded by the async iterator.
   */
  takePendingInform?: () => AgentSupplementalInput[];
  /** Closes the input stream once the active run no longer accepts input. */
  close?: () => void;
}

/**
 * Image attachment for vision capabilities
 * Either data (base64) or url (cloud-accessible) must be provided.
 */
export interface ImageAttachment {
  /** Base64 encoded image data */
  data?: string;
  /** Cloud-accessible URL (e.g. TUS blobUrl) */
  url?: string;
  mimeType: string; // e.g. 'image/png', 'image/jpeg'
}

/**
 * PDF attachment for native PDF API support
 * Used with Anthropic Claude and Google Gemini models that support PDF document blocks
 * Either data (base64) or url (cloud-accessible) must be provided.
 */
export interface PDFAttachment {
  /** Base64 encoded PDF data */
  data?: string;
  /** Cloud-accessible URL (e.g. TUS blobUrl) */
  url?: string;
  mimeType: string; // 'application/pdf'
  pageCount?: number; // Number of pages in the PDF
}

/**
 * File attachment for workspace operations
 * Used to save files to the agent's working directory
 */
export interface FileAttachment {
  name: string; // Original filename
  data: string; // Base64 encoded file data
  mimeType: string; // e.g. 'image/png', 'application/pdf', 'text/plain'
  /**
   * Category of the file attachment.
   * - "input-image": User-uploaded image that should be saved to __inputs__/ directory
   * - undefined: Default behavior, saved to workspace root (backward compatible)
   */
  category?: "input-image";
}

// ============================================================================
// Plan Types
// ============================================================================

export interface TaskPlan {
  id: string;
  goal: string;
  steps: PlanStep[];
  notes?: string;
  createdAt: Date;
}

export interface PlanStep {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
}

// ============================================================================
// Agent Configuration
// ============================================================================

export type BuiltinAgentProvider = "claude" | "codex" | "deepagents" | "custom";
export type AgentProvider = BuiltinAgentProvider | (string & {});

export interface AgentConfig {
  /** Agent provider to use */
  provider: AgentProvider;
  /** API key for the provider */
  apiKey?: string;
  /** Custom API base URL (for third-party API endpoints) */
  baseUrl?: string;
  /** Model to use (provider-specific) */
  model?: string;
  /** Thinking level for extended thinking (Claude 4.6+) */
  thinkingLevel?: "disabled" | "low" | "adaptive";
  /** Working directory for file operations */
  workDir?: string;
  /** Custom configuration for the provider */
  providerConfig?: Record<string, unknown>;
}

/**
 * Skills configuration for loading skills from different directories
 */
export interface SkillsConfig {
  /** Whether skills are globally enabled */
  enabled: boolean;
  /** Whether to load skills from user directory (~/.openloomi/skills) */
  userDirEnabled: boolean;
  /** Whether to load skills from app directory (workspace/skills) */
  appDirEnabled: boolean;
  /** Custom skills directory path (legacy support) */
  skillsPath?: string;
}

/**
 * MCP configuration for loading MCP servers from different config files
 */
export interface McpConfig {
  /** Whether MCP is globally enabled */
  enabled: boolean;
  /** Whether to load MCP servers from user directory (claude config) */
  userDirEnabled: boolean;
  /** Whether to load MCP servers from app directory (openloomi config) */
  appDirEnabled: boolean;
  /** Custom MCP config file path (legacy support) */
  mcpConfigPath?: string;
}

export interface AgentOptions {
  /** Session ID for continuing conversations */
  sessionId?: string;
  /** User session for authentication and context (used for business tools) */
  session?: any; // Session from next-auth
  /** Cloud auth token for embeddings API (needed in native mode) */
  authToken?: string;
  /** Conversation history */
  conversation?: ConversationMessage[];
  /** Additional user inputs delivered to an already-active run. */
  supplementalInput?: AgentSupplementalInputSource;
  /** Working directory */
  cwd?: string;
  /** Use cwd exactly instead of wrapping it in an OpenLoomi session folder */
  useProvidedWorkDir?: boolean;
  /** Allowed tools */
  allowedTools?: string[];
  /** Tools that must be unavailable even if the provider preset exposes them */
  disallowedTools?: string[];
  /** Tools to exclude from the allowed list */
  excludeTools?: string[];
  /**
   * When true, task-config mutation tools (createTask / updateTaskSettings /
   * bootstrapTaskConfiguration / findReusableExecutors / linkExecutorToTask /
   * createScheduledExecutorForTask) are NOT registered for the agent. Used on
   * the async first turn while background bootstrap is the sole writer of the
   * task config, so the agent cannot race it and create a duplicate scheduled
   * executor.
   */
  suppressTaskConfigMutations?: boolean;
  /** Provider-level subagents that can be invoked by the main agent. */
  subagents?: Record<string, AgentSubagentDefinition>;
  /** Task ID for tracking */
  taskId?: string;
  /** Abort controller for cancellation */
  abortController?: AbortController;
  /** Permission mode */
  permissionMode?:
    | "default"
    | "acceptEdits"
    | "bypassPermissions"
    | "plan"
    | "dontAsk";
  /** Sandbox configuration for isolated execution */
  sandbox?: SandboxConfig;
  /** Image attachments for vision capabilities */
  images?: ImageAttachment[];
  /** PDF attachments for native PDF API support */
  pdfs?: PDFAttachment[];
  /** File attachments to be saved to workspace */
  fileAttachments?: FileAttachment[];
  /** Skills configuration */
  skillsConfig?: SkillsConfig;
  /** MCP configuration */
  mcpConfig?: McpConfig;
  /** Active character (mate) ID for character-scoped chat */
  characterId?: string;
  /** Focused insight IDs (from web agent) */
  focusedInsightIds?: string[];
  /** Focused insights data (from web agent) */
  focusedInsights?: Array<{
    id: string;
    title: string;
    description?: string | null;
    details?: unknown[] | null;
    timeline?: Array<{ title?: string; description?: string }> | null;
    groups?: string[] | null;
    platform?: string | null;
  }>;
  /** Callback for insight changes (used for optimistic updates in native agent mode) */
  onInsightChange?: (data: {
    action: "create" | "update" | "delete";
    insightId?: string;
    insight?: Record<string, unknown>;
  }) => void;
  /** Callback invoked after provider-managed user inputs have been materialized. */
  onInputsMaterialized?: () => void | Promise<void>;
  /**
   * Callback invoked when the MCP-backed `AskUserQuestion` tool needs to ask
   * the user. Presence of this callback gates registration of the
   * `ask-user-question` MCP server — non-interactive contexts (cron,
   * subagent, execute) should not pass it.
   */
  onAskUserQuestion?: (question: AgentQuestion) => void;
  /** Callback invoked when the MCP Bash tool detects a sudo password prompt. */
  onPasswordRequired?: (request: { id: string; command: string }) => void;
  /** Callback for scoped assistant rule updates from upsertAssistantRules. */
  onRulesUpdated?: (data: {
    scopeType: "global" | "task";
    scopeId: string;
    rules: Array<{
      id: string;
      ruleType: string;
      ruleKey: string;
      value: Record<string, unknown>;
      displayLabel: string;
      enabled: boolean;
      source: string;
    }>;
  }) => void;
  /**
   * Called when the agent SDK has fully resolved a tool call's input — i.e.
   * after streaming `input_json_delta` finishes and the assistant message
   * is materialized. Hosts use this to inspect tool inputs that aren't
   * available at the initial `tool_use` emission (which fires at
   * `content_block_start` with empty/partial input under Anthropic's
   * streaming protocol). Fires at most once per `toolUseId`.
   */
  onToolUseSeen?: (data: {
    toolUseId: string;
    toolName: string;
    input: unknown;
  }) => void;
  /**
   * Called after a first-party memory tool successfully persists a durable
   * user fact. The host surfaces this as a chat notification card.
   */
  onMemoryUpdate?: (data: {
    category: string;
    fileName: string;
    displayLabel: string;
    action: "create" | "update";
    description?: string;
    filePath?: string;
  }) => void;
  /** Callback for handling permission requests from SDK */
  onPermissionRequest?: (request: {
    toolName: string;
    toolInput: Record<string, unknown>;
    toolUseID: string;
    decisionReason?: string;
    blockedPath?: string;
    title?: string;
    displayName?: string;
    description?: string;
    agentID?: string;
  }) => Promise<{
    behavior: "allow" | "deny";
    updatedInput?: Record<string, unknown>;
    message?: string;
  }>;
  /** Enable streaming output (default: true) */
  stream?: boolean;
  /** User-defined AI Soul prompt (custom instructions) */
  aiSoulPrompt?: string | null;
  /** User language preference for agent responses */
  language?: string | null;
  /** User timezone for date/time operations */
  timezone?: string | null;
}

export interface PlanOptions extends AgentOptions {
  /** Planning-specific options */
}

export interface ExecuteOptions extends AgentOptions {
  /** Plan ID to execute */
  planId: string;
  /** Original prompt that created the plan */
  originalPrompt: string;
  /** Sandbox configuration */
  sandbox?: SandboxConfig;
  /** Plan object (optional - if not provided, will look up by planId) */
  plan?: TaskPlan;
}

// ============================================================================
// Agent Interface
// ============================================================================

/**
 * Base interface for all agent implementations.
 * Each provider (Claude, DeepAgents, etc.) must implement this interface.
 */
export interface IAgent {
  /** Provider name */
  readonly provider: AgentProvider;

  /**
   * Run the agent with a prompt (direct execution mode)
   */
  run(prompt: string, options?: AgentOptions): AsyncGenerator<AgentMessage>;

  /**
   * Run planning phase only (returns a plan for approval)
   */
  plan(prompt: string, options?: PlanOptions): AsyncGenerator<AgentMessage>;

  /**
   * Execute an approved plan
   */
  execute(options: ExecuteOptions): AsyncGenerator<AgentMessage>;

  /**
   * Stop the current execution
   */
  stop(sessionId: string): Promise<void>;

  /**
   * Get a stored plan by ID
   */
  getPlan(planId: string): TaskPlan | undefined;

  /**
   * Delete a stored plan
   */
  deletePlan(planId: string): void;
}

// ============================================================================
// Session Management
// ============================================================================

export interface AgentSession {
  id: string;
  createdAt: Date;
  phase: "planning" | "executing" | "idle";
  isAborted: boolean;
  abortController: AbortController;
  config?: AgentConfig;
}

// ============================================================================
// Tool Definitions
// ============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const DEFAULT_ALLOWED_TOOLS = [
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
  "Bash",
  "WebSearch",
  "WebFetch",
  "Skill",
  "Task",
  "LSP",
  "TodoWrite",
];

// ============================================================================
// Factory Types
// ============================================================================

export type AgentFactory = (config: AgentConfig) => IAgent;

export type AgentRegistryInterface = {
  register(provider: AgentProvider, factory: AgentFactory): void;
  get(provider: AgentProvider): AgentFactory | undefined;
  create(config: AgentConfig): IAgent;
};

/**
 * API Request type for agent endpoints
 */
export interface AgentRequest {
  prompt: string;
  sessionId?: string;
  conversation?: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;
  /** Two-phase execution control */
  phase?: "plan" | "execute";
  planId?: string; // Reference to approved plan
  /** Workspace settings */
  workDir?: string; // Working directory for session outputs
  taskId?: string; // Task ID for session folder
  /** Provider selection (optional, defaults to env config) */
  provider?: AgentProvider;
  /** Provider-specific configuration */
  providerConfig?: Record<string, unknown>;
  /** Custom model configuration */
  modelConfig?: ModelConfig;
  /** Sandbox configuration for isolated execution */
  sandboxConfig?: SandboxConfig;
  /** Cloud auth token for embeddings API (needed in native mode) */
  authToken?: string;
}
