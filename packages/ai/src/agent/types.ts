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
  | "insightsRefresh"
  | "permission_request"
  | "password_input"
  | "reasoning";

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
  /** Plan fields */
  plan?: TaskPlan;
  /** Error fields */
  message?: string;
  /** Question fields (for interactive skills) */
  question?: AgentQuestion;
  /** Insight change fields (for optimistic updates) */
  action?: "create" | "update" | "delete";
  insightId?: string;
  insight?: Record<string, unknown>;
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

export type AgentProvider = "claude" | "codex" | "deepagents" | "custom";

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
  /** Whether to load skills from user directory (~/.alloomi/skills) */
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
  /** Whether to load MCP servers from app directory (alloomi config) */
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
  /** Working directory */
  cwd?: string;
  /** Allowed tools */
  allowedTools?: string[];
  /** Tools to exclude from the allowed list */
  excludeTools?: string[];
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
  /**
   * Callback invoked when the MCP-backed `AskUserQuestion` tool needs to ask
   * the user. Presence of this callback gates registration of the
   * `ask-user-question` MCP server — non-interactive contexts (cron,
   * subagent, execute) should not pass it.
   */
  onAskUserQuestion?: (question: AgentQuestion) => void;
  /** Callback for handling permission requests from SDK */
  onPermissionRequest?: (request: {
    toolName: string;
    toolInput: Record<string, unknown>;
    toolUseID: string;
    decisionReason?: string;
    blockedPath?: string;
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
  /** Internal scheduled-job execution report submission hook */
  executionReport?: {
    enabled: boolean;
    onSubmit: (report: unknown) => void;
  };
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
  provider?: "claude" | "deepagents";
  /** Custom model configuration */
  modelConfig?: ModelConfig;
  /** Sandbox configuration for isolated execution */
  sandboxConfig?: SandboxConfig;
  /** Cloud auth token for embeddings API (needed in native mode) */
  authToken?: string;
}
