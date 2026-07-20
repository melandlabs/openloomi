import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentConfig,
  AgentOptions,
  AgentSupplementalInputSource,
} from "@openloomi/ai/agent/types";

import {
  type McpServerConfig,
  createBusinessToolsMcpServer,
} from "@/lib/ai/mcp";

import { createCanUseToolOption } from "./permissions";
import { createClaudeSupplementalInputHooks } from "./runtime";
import type { ClaudeRuntimeLogger } from "./skills";

// Baseline tool surface for Claude Code sessions. Extra tool groups, such as
// sandbox and business tools, are appended later when their MCP servers exist.
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

// Keep this list colocated with business-tools MCP attachment so the SDK allow
// list is updated whenever OpenLoomi registers that MCP server.
const BUSINESS_TOOL_NAMES = [
  "chatInsight",
  "modifyInsight",
  "createInsight",
  "deleteInsight",
  "createScheduledJob",
  "listScheduledJobs",
  "deleteScheduledJob",
  "toggleScheduledJob",
  "updateScheduledJob",
  "executeScheduledJob",
  "sendReply",
  "queryContacts",
  "queryIntegrations",
  "searchKnowledgeBase",
  "searchUnifiedMemory",
  "searchMemoryPath",
  "getRawMessages",
  "searchRawMessages",
  "getFullDocumentContent",
  "listKnowledgeBaseDocuments",
  "downloadInsightAttachment",
  "time",
];

// `index.ts` owns the concrete sandbox MCP implementation. This extracted
// helper only needs a factory so query option assembly stays reusable.
export type CreateSandboxMcpServer = (sandboxProvider?: string) => unknown;

/**
 * Assemble the common Claude SDK query options used by run/plan/execute.
 */
export function createClaudeQueryOptions({
  sessionId,
  cwd,
  settingSources,
  settings,
  allowedTools,
  agentOptions,
  supplementalInput,
  abortController,
  env,
  config,
  claudeCodePath,
  isDev,
  debugFilePath,
  logger,
  spawnClaudeCodeProcess,
  systemPrompt,
  stderrLabel,
  permissionMode,
  permissionLogMode,
  tools,
  maxTurns,
  includePartialMessages,
}: {
  sessionId: string;
  cwd: string;
  settingSources: ("user" | "project")[];
  settings?: string;
  allowedTools: string[];
  agentOptions?: Pick<
    AgentOptions,
    "permissionMode" | "onPermissionRequest" | "disallowedTools"
  >;
  supplementalInput?: AgentSupplementalInputSource;
  abortController: AbortController;
  env: Record<string, string>;
  config: AgentConfig;
  claudeCodePath: string;
  isDev: boolean;
  debugFilePath: string;
  logger: ClaudeRuntimeLogger;
  spawnClaudeCodeProcess: NonNullable<Options["spawnClaudeCodeProcess"]>;
  systemPrompt: string;
  stderrLabel?: string;
  permissionMode?: AgentOptions["permissionMode"];
  permissionLogMode: "run" | "execute";
  tools?: Options["tools"];
  maxTurns?: number;
  includePartialMessages?: boolean;
}): Options {
  const effectivePermissionMode = permissionMode || "bypassPermissions";
  const supplementalHooks = createClaudeSupplementalInputHooks({
    supplementalInput,
    sessionId,
    logger,
  });

  return {
    cwd,
    // `tools` can be omitted for plan-only calls; run/execute use the Claude
    // Code preset so the SDK exposes file, shell, and search tools.
    ...(tools ? { tools } : {}),
    allowedTools,
    settingSources,
    settings,
    // Keep bypassPermissions as the historical default. Any stricter mode
    // registers canUseTool below so desktop UI and CLI prompts can decide.
    permissionMode: effectivePermissionMode,
    ...(agentOptions?.disallowedTools?.length
      ? { disallowedTools: agentOptions.disallowedTools }
      : {}),
    allowDangerouslySkipPermissions:
      effectivePermissionMode === "bypassPermissions",
    abortController,
    env,
    model: config.model,
    pathToClaudeCodeExecutable: claudeCodePath,
    ...(maxTurns !== undefined ? { maxTurns } : {}),
    ...(includePartialMessages !== undefined ? { includePartialMessages } : {}),
    ...(isDev ? { debug: true, debugFile: debugFilePath } : {}),
    stderr: (data: string) => {
      const label = stderrLabel ? ` ${stderrLabel}` : "";
      // Keep stderr on the shared logger instead of stdout so CLI JSON output
      // stays machine-readable.
      logger.error(`[Claude ${sessionId}]${label} STDERR: ${data}`);
    },
    spawnClaudeCodeProcess,
    systemPrompt,
    ...(supplementalHooks ? { hooks: supplementalHooks } : {}),
    ...createCanUseToolOption({
      sessionId,
      options: agentOptions,
      logger,
      mode: permissionLogMode,
    }),
  } as Options;
}

/**
 * Attach OpenLoomi MCP servers and keep allowedTools consistent with them.
 */
export function attachClaudeMcpServers({
  queryOptions,
  userMcpServers,
  agentOptions,
  createSandboxMcpServer,
  logger,
  sessionId,
  mode,
}: {
  queryOptions: Options;
  userMcpServers: Record<string, McpServerConfig>;
  agentOptions: AgentOptions;
  createSandboxMcpServer: CreateSandboxMcpServer;
  logger: ClaudeRuntimeLogger;
  sessionId: string;
  mode: "run" | "execute";
}) {
  const mcpServers: Record<string, unknown> = {
    ...userMcpServers,
  };

  // Sandbox MCP is optional and contributes its own command execution tools.
  if (agentOptions.sandbox?.enabled) {
    mcpServers.sandbox = createSandboxMcpServer(agentOptions.sandbox.provider);
    queryOptions.allowedTools = [
      ...(agentOptions.allowedTools || DEFAULT_ALLOWED_TOOLS),
      "sandbox_run_script",
      "sandbox_run_command",
    ];
  }

  // Business tools need a logged-in user session because they can access
  // OpenLoomi data such as insights, contacts, memory, and scheduled jobs.
  if (agentOptions.session) {
    try {
      mcpServers["business-tools"] = createBusinessToolsMcpServer(
        agentOptions.session,
        agentOptions.authToken,
        agentOptions.onInsightChange,
        agentOptions.sessionId,
        {
          excludeTools: agentOptions.excludeTools,
        },
      );
      queryOptions.allowedTools = [
        ...(queryOptions.allowedTools || DEFAULT_ALLOWED_TOOLS),
        ...BUSINESS_TOOL_NAMES,
      ];
      if (mode === "execute") {
        logger.info(
          `[Claude ${sessionId}] Execute: Business tools MCP server loaded with user session`,
        );
      }
    } catch (error) {
      const prefix =
        mode === "execute"
          ? "Execute: Failed to create business tools MCP server:"
          : "Failed to create business tools MCP server:";
      logger.error(`[Claude ${sessionId}] ${prefix}`, error);
    }
  }

  // Apply excludes after every tool source has been appended so callers can
  // remove both default SDK tools and dynamically added MCP tools.
  if (agentOptions.excludeTools && agentOptions.excludeTools.length > 0) {
    const excludeSet = new Set(agentOptions.excludeTools);
    queryOptions.allowedTools = (queryOptions.allowedTools || []).filter(
      (tool: string) => !excludeSet.has(tool),
    );
    const label = mode === "execute" ? "Execute: " : "";
    logger.info(
      `[Claude ${sessionId}] ${label}Excluded tools: ${agentOptions.excludeTools.join(", ")}`,
    );
  }

  // disallowedTools is stronger than allowedTools: it removes tools from the
  // model context. Filter any auto-allowed list after MCP attachment so a
  // caller cannot accidentally re-add a forbidden tool through another source.
  if (agentOptions.disallowedTools && agentOptions.disallowedTools.length > 0) {
    const disallowedSet = new Set(agentOptions.disallowedTools);
    queryOptions.allowedTools = (queryOptions.allowedTools || []).filter(
      (tool: string) => !disallowedSet.has(tool),
    );
    queryOptions.disallowedTools = [
      ...new Set([
        ...(queryOptions.disallowedTools || []),
        ...agentOptions.disallowedTools,
      ]),
    ];
    const label = mode === "execute" ? "Execute: " : "";
    logger.info(
      `[Claude ${sessionId}] ${label}Disallowed tools: ${agentOptions.disallowedTools.join(", ")}`,
    );
  }

  // The SDK accepts mcpServers only when there is at least one configured
  // server. Leaving it unset keeps plan-only and minimal runs clean.
  if (Object.keys(mcpServers).length > 0) {
    queryOptions.mcpServers = mcpServers as Options["mcpServers"];
  } else if (mode === "execute") {
    logger.warn(`[Claude ${sessionId}] Execute: No MCP servers configured`);
  } else {
    logger.warn(
      `[Claude ${sessionId}] No MCP servers configured (sandbox disabled or no user MCP servers)`,
    );
  }
}
