/**
 * Shared Agent Runtime Handler
 *
 * Common agent runtime logic used by Telegram and WhatsApp
 */

import type { AgentConfig, AgentOptions } from "@openloomi/ai/agent/types";
import { getAgentRegistry } from "@openloomi/ai/agent/registry";
import {
  getUserTypeForService,
  getUserInsightSettings,
} from "@/lib/db/queries";
import { registerPlugins } from "./register-plugins";
import { triggerCompactionAsync } from "@/lib/ai";
import type { CompactionPlatform } from "@/lib/ai";
import {
  prepareConversationWindows,
  type ConversationWindowMessage,
} from "@/lib/ai";
import { sanitizeCompactionMessages } from "@openloomi/ai/agent";
import { saveCompactionSummary } from "@openloomi/ai/store";
import { getAppMemoryDir } from "@/lib/utils/path";
import { stripMalformedToolCalls } from "@/lib/utils/tool-names";
import { formatAgentStreamErrorForUser } from "./format-error";

/**
 * Maximum tokens allowed in conversation history passed to the agent.
 * Conservative limit to stay well below the 200K Claude context window.
 * System prompt + current message + tool results all consume additional tokens.
 */
export const MAX_CONVERSATION_HISTORY_TOKENS = 40_000;

/**
 * Threshold ratio at which a context usage warning is logged (75% of max).
 */
export const WARN_CONVERSATION_HISTORY_RATIO = 0.75;

// Track if plugins have been registered
let pluginsRegistered = false;

function ensurePluginsRegistered() {
  if (!pluginsRegistered) {
    registerPlugins();
    pluginsRegistered = true;
  }
}

export { formatAgentStreamErrorForUser } from "./format-error";

/**
 * Get display name for a tool (similar to Web UI)
 * Extracts the base name and returns a readable format
 * Supports both English and Chinese
 */
function getToolDisplayName(
  toolName: string,
  language: string | null = null,
): string {
  // Extract tool name without prefix (e.g., "mcp__business-tools__chatInsight" -> "chatInsight")
  const nameWithoutPrefix = toolName.includes("__")
    ? toolName.split("__").pop() || toolName
    : toolName;

  // Determine if user prefers Chinese (zh-Hans or zh-CN)
  const isChinese =
    language === "zh-Hans" ||
    language === "zh-CN" ||
    (language?.startsWith?.("zh") ?? false);

  // Tool display names - English and Chinese
  const enNames: Record<string, string> = {
    Read: "Read",
    Write: "Write",
    Edit: "Edit",
    Bash: "Bash",
    WebSearch: "WebSearch",
    WebFetch: "WebFetch",
    Glob: "Glob",
    Grep: "Grep",
    TodoWrite: "TodoWrite",
    Skill: "Skill",
    LSP: "LSP",
    Task: "Task",
    chatInsight: "Chat Insight",
    queryContacts: "Query Contacts",
    queryIntegrations: "Query Integrations",
    sendReply: "Send Reply",
    createInsight: "Create Insight",
    modifyInsight: "Modify Insight",
    searchKnowledgeBase: "Search Knowledge Base",
    getFullDocumentContent: "Get Document",
    listKnowledgeBaseDocuments: "List Knowledge Base",
    searchMemoryPath: "Search Memory",
    getRawMessages: "Get Raw Messages",
    searchRawMessages: "Search Messages",
  };

  const zhNames: Record<string, string> = {
    Read: "读取文件",
    Write: "写入文件",
    Edit: "编辑文件",
    Bash: "执行命令",
    WebSearch: "网络搜索",
    WebFetch: "获取网页",
    Glob: "搜索文件",
    Grep: "搜索内容",
    TodoWrite: "管理待办",
    Skill: "调用技能",
    LSP: "代码分析",
    Task: "运行子任务",
    chatInsight: "查询聊天洞察",
    queryContacts: "查询联系人",
    queryIntegrations: "查询集成",
    sendReply: "发送回复",
    createInsight: "创建洞察",
    modifyInsight: "修改洞察",
    searchKnowledgeBase: "搜索知识库",
    getFullDocumentContent: "读取文档",
    listKnowledgeBaseDocuments: "列出知识库文档",
    searchMemoryPath: "搜索记忆",
    getRawMessages: "搜索消息",
    searchRawMessages: "搜索原始消息",
  };

  const names = isChinese ? zhNames : enNames;
  return names[nameWithoutPrefix] || nameWithoutPrefix;
}

/**
 * Options for handleAgentRuntime
 */
export interface HandleAgentRuntimeOptions {
  conversation?: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    timestamp?: number; // Optional; if present, used by compaction for date range
  }>;
  images?: Array<{ data: string; mimeType: string }>;
  fileAttachments?: Array<{ name: string; data: string; mimeType: string }>;
  userId?: string; // Add userId for direct Agent calls
  workDir?: string; // Working directory for file operations
  stream?: boolean; // Enable streaming output (default: true)
  aiSoulPrompt?: string | null; // User-defined AI Soul prompt
  language?: string | null; // User language preference
  /** Caller controls timeout (e.g., Feishu inbound must respond within a reasonable time) */
  abortController?: AbortController;
  modelConfig?: {
    // Model configuration for custom API endpoints
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    thinkingLevel?: "disabled" | "low" | "adaptive";
  };
  silentTools?: boolean; // Don't send tool_use notifications to the user
  accountId?: string; // Account ID for per-day file persistence (used by compaction)
}

/**
 * Handle agent runtime call - Shared implementation
 *
 * @param prompt - The message content
 * @param options - Agent options
 * @param replyCallback - Callback to send the reply
 */
export async function handleAgentRuntime(
  prompt: string,
  options: HandleAgentRuntimeOptions,
  replyCallback: (message: string) => Promise<void>,
  platform:
    | "telegram"
    | "whatsapp"
    | "imessage"
    | "gmail"
    | "feishu"
    | "dingtalk"
    | "qqbot"
    | "weixin",
): Promise<void> {
  console.log(
    `[${platform}] handleAgentRuntime called with prompt:`,
    prompt.substring(0, 100),
  );

  try {
    // If userId is provided, run Agent directly (server-side, bypasses HTTP/auth)
    if (options.userId) {
      // Get user type and settings to build a complete session object
      // This enables business-tools (chatInsight, modifyInsight, etc.)
      const userType = await getUserTypeForService(options.userId);
      const userSettings = await getUserInsightSettings(options.userId);

      // Build a minimal session object for business-tools MCP server (includes current session platform for sendReply etc. tools to distinguish channels)
      const session = {
        user: {
          id: options.userId,
          type: userType,
        },
        platform,
      };

      // Build agent config (only provider-related config)
      const agentConfig: AgentConfig = {
        provider: "claude",
        ...(options.workDir && { workDir: options.workDir }), // Pass workDir for file generation
      };

      // Add model config if provided
      if (options.modelConfig) {
        if (options.modelConfig.apiKey) {
          agentConfig.apiKey = options.modelConfig.apiKey;
        }
        if (options.modelConfig.baseUrl) {
          agentConfig.baseUrl = options.modelConfig.baseUrl;
        }
        if (options.modelConfig.model) {
          agentConfig.model = options.modelConfig.model;
        }
      }

      if (options.workDir) {
        console.log(
          `[${platform}] workDir set to: ${options.workDir}`,
          "Agent will create files in this directory",
        );
      }

      // Build agent options (conversation, images, etc.)
      const agentOptions: AgentOptions = {
        permissionMode: "bypassPermissions", // Bypass permissions to allow business-tools
        skillsConfig: {
          enabled: true,
          userDirEnabled: true,
          appDirEnabled: false,
        },
        mcpConfig: {
          enabled: true, // Enable MCP to support business-tools
          userDirEnabled: false,
          appDirEnabled: false,
        },
        session, // Pass session for business-tools
        // Pass stream option (default: true for web, false for Telegram/WhatsApp)
        stream: options.stream ?? false, // Default to false for non-web platforms
        aiSoulPrompt: userSettings?.aiSoulPrompt ?? null,
        ...(options.abortController
          ? { abortController: options.abortController }
          : {}),
      };

      // Add conversation history if provided, with sliding-window monitoring
      if (options.conversation && options.conversation.length > 0) {
        const prepared = prepareConversationWindows(
          options.conversation as ConversationWindowMessage[],
          {
            maxTokens: MAX_CONVERSATION_HISTORY_TOKENS,
          },
        );

        console.log(`[${platform}] [WindowTest] prepared conversation`, {
          totalTokens: prepared.totalTokens,
          immediateCount: prepared.immediate.length,
          immediateTokens: prepared.immediateTokens,
          compactionCandidateCount: prepared.candidatesForCompaction.length,
          compactionCandidateTokens: prepared.compactionCandidateTokens,
          usageRatio: prepared.usageRatio,
          level: prepared.level,
          bucketStats: prepared.bucketStats,
        });
        const warnThreshold = Math.floor(
          MAX_CONVERSATION_HISTORY_TOKENS * WARN_CONVERSATION_HISTORY_RATIO,
        );

        if (prepared.usageRatio >= 1) {
          console.warn(
            `[${platform}] [TokenMonitor] Conversation history exceeded budget ` +
              `(~${prepared.totalTokens} tokens, limit ${MAX_CONVERSATION_HISTORY_TOKENS}). ` +
              `Keeping ${prepared.immediate.length} windowed messages ` +
              `(~${prepared.immediateTokens} tokens), ` +
              `marking ${prepared.candidatesForCompaction.length} old messages ` +
              `(~${prepared.compactionCandidateTokens} tokens) for async compaction.`,
          );
        } else if (prepared.totalTokens > warnThreshold) {
          console.warn(
            `[${platform}] [TokenMonitor] Conversation history approaching limit ` +
              `(~${prepared.totalTokens} tokens, ${Math.round(prepared.usageRatio * 100)}% of ${MAX_CONVERSATION_HISTORY_TOKENS} max). ` +
              `recent=${prepared.bucketStats.recent.messages}, ` +
              `warm=${prepared.bucketStats.warm.messages}, ` +
              `cold=${prepared.bucketStats.cold.messages}, ` +
              `archive=${prepared.bucketStats.archive.messages}.`,
          );
        } else {
          console.log(
            `[${platform}] [TokenMonitor] Conversation history: ~${prepared.totalTokens} tokens ` +
              `(${Math.round(prepared.usageRatio * 100)}% of limit), ` +
              `kept=${prepared.immediate.length}, ` +
              `compactionCandidates=${prepared.candidatesForCompaction.length}.`,
          );
        }

        agentOptions.conversation = prepared.immediate.map(
          ({ role, content }) => ({
            role,
            content,
          }),
        );

        if (
          prepared.candidatesForCompaction.length > 10 &&
          prepared.level &&
          options.userId &&
          options.accountId
        ) {
          const userId = options.userId;
          const accountId = options.accountId;
          const authToken = options.modelConfig?.apiKey;

          // prepareConversationWindows separates the messages needed for this
          // turn's active context window (`immediate`) from the older messages
          // that should be compacted (`candidatesForCompaction`) by timestamp.
          // triggerCompactionAsync sends those compaction candidates to the
          // compaction endpoint asynchronously, then persists the resulting
          // summary so it can be inserted back into the conversation history.
          if (authToken) {
            // Platform runtimes only retain role/content pairs, so this extra
            // sanitize pass is the last chance to strip oversized blobs before
            // the summary request is billed.
            const compactionMessages = sanitizeCompactionMessages(
              prepared.candidatesForCompaction.map(({ role, content }) => ({
                role,
                type: "message" as const,
                content,
              })),
            ).map(({ role, content }) => ({
              role,
              content,
            }));

            if (compactionMessages.length > 0) {
              void triggerCompactionAsync({
                messages: compactionMessages,
                level: prepared.level,
                platform: platform as CompactionPlatform,
                authToken,
                persistSummary: (result) => {
                  const timestamps = prepared.candidatesForCompaction
                    .map((m) => m.timestamp)
                    .filter((t): t is number => t !== undefined);
                  const rangeStart =
                    timestamps.length > 0
                      ? new Date(Math.min(...timestamps))
                          .toISOString()
                          .slice(0, 10)
                      : new Date().toISOString().slice(0, 10);
                  const rangeEnd =
                    timestamps.length > 0
                      ? new Date(Math.max(...timestamps))
                          .toISOString()
                          .slice(0, 10)
                      : new Date().toISOString().slice(0, 10);
                  saveCompactionSummary(
                    getAppMemoryDir(),
                    platform,
                    userId,
                    accountId,
                    result.summary,
                    result.messageCount,
                    rangeStart,
                    rangeEnd,
                  );
                },
              }).catch((err) => {
                console.error(
                  `[${platform}] [CompactionClient] Async compaction failed:`,
                  err,
                );
              });
            }
          }
        }
      }

      // Add images if provided
      if (options.images && options.images.length > 0) {
        agentOptions.images = options.images;
      }

      // Add fileAttachments if provided
      if (options.fileAttachments && options.fileAttachments.length > 0) {
        agentOptions.fileAttachments = options.fileAttachments;
        console.log(
          `[${platform}] Added ${options.fileAttachments.length} file attachment(s)`,
        );
      }

      // Ensure plugins are registered before creating agent
      ensurePluginsRegistered();

      // Create and run agent
      const agent = getAgentRegistry().create(agentConfig);

      // Add platform context to prompt so AI knows where it's running
      const platformPrompt = `[PLATFORM CONTEXT]
You are running on the USER'S COMPUTER, accessed via a ${platform.toUpperCase()} bot conversation.

IMPORTANT CAPABILITIES:
- You can ACCESS files on the user's computer (Desktop, Documents, Downloads, etc.)
- You can READ, WRITE, COPY files from anywhere on the system
- To SEND a file to the user: Copy it to your workDir (${options.workDir || "default directory"})
- Any file in workDir will be AUTOMATICALLY sent to the user via ${platform.toUpperCase()}
- When the user asks you to remind them or notify them at a specific time, you MUST explicitly state in the timer/scheduler that the notification will be sent via ${platform.toUpperCase()}. Few-shot examples:
  - User: "Remind me to call John at 3pm" → Response: "I'll remind you to call John at 3pm via ${platform.toUpperCase()}"
  - User: "Notify me when the file is ready" → Response: "I'll notify you via ${platform.toUpperCase()} when the file is ready"
  - User: "Tell me the weather tomorrow morning" → Response: "I'll send you the weather update via ${platform.toUpperCase()} tomorrow morning"

Examples:
- "Send me screenshot.png from Desktop" → Copy ~/Desktop/screenshot.png to workDir
- "Send me my resume" → Copy ~/Documents/resume.pdf to workDir
- "Generate a report" → Create report.md in workDir (auto-sent)

${"=".repeat(60)}

${prompt}`;

      const generator = agent.run(platformPrompt, agentOptions);

      let finalResponse = "";
      let toolUseCount = 0;
      const usedToolNames: string[] = []; // Track names of used tools
      let lastSentContent = "";
      let hasSentFinalResponse = false; // Track if we've already sent the response
      let textMessageCount = 0; // Count text messages

      console.log(`[${platform}] ===== Starting agent message loop =====`);

      // Process messages from generator
      for await (const message of generator) {
        // Log all message types with details
        console.log(`[${platform}] Received message type: ${message.type}`, {
          hasContent: "content" in message,
          hasName: "name" in message,
          hasOutput: "output" in message,
          hasToolUseId: "toolUseId" in message,
          keys: Object.keys(message),
        });

        if (message.type === "text" && message.content) {
          textMessageCount++;
          finalResponse = message.content;
          const currentLength = finalResponse.length;

          console.log(
            `[${platform}] Received text chunk #${textMessageCount}, length: ${currentLength}`,
            `lastSentContent length: ${lastSentContent.length}`,
            `are they equal: ${finalResponse === lastSentContent}`,
          );

          // Send update immediately if content has changed (Agent SDK sends complete text at once)
          // But we should still send it to show user what's happening
          if (finalResponse !== lastSentContent) {
            // Only send the NEW part (incremental) to avoid duplicate output
            const incrementalChunk = finalResponse.substring(
              lastSentContent.length,
            );
            // Skip empty incremental chunks to avoid sending just "🤖 "
            if (incrementalChunk.length > 0) {
              console.log(
                `[${platform}] 🔄 Sending text update #${textMessageCount} (${incrementalChunk.length} new chars, ${currentLength} total chars)...`,
                `hasSentFinalResponse before: ${hasSentFinalResponse}`,
              );
              await replyCallback(`🤖 ${incrementalChunk}`);
              console.log(
                `[${platform}] ✓ Text update sent successfully`,
                `hasSentFinalResponse after: ${hasSentFinalResponse}`,
              );
            }
            lastSentContent = finalResponse;
            hasSentFinalResponse = true; // Mark that we've sent the response
          } else {
            console.log(
              `[${platform}] ⏭️  Skipping duplicate text (content hasn't changed)`,
            );
          }
        }
        if (message.type === "tool_use") {
          toolUseCount++;
          // Track tool names for display (deduplicate)
          if (message.name && !usedToolNames.includes(message.name)) {
            usedToolNames.push(message.name);
          }
          console.log(
            `[${platform}] Tool used, total:`,
            toolUseCount,
            "name:",
            message.name,
            "input:",
            message.input,
          );
          // Real-time notification to user about tools being used and their inputs (skipped in silentTools mode)
          if (message.name && !options.silentTools) {
            const toolDisplayName = getToolDisplayName(
              message.name,
              options.language,
            );

            // Extract key input information
            let inputInfo = "";
            if (message.input) {
              const input = message.input as Record<string, unknown>;
              // Extract tool name (remove prefix, consistent with getToolDisplayName)
              const toolNameWithoutPrefix = message.name.includes("__")
                ? message.name.split("__").pop() || message.name
                : message.name;
              // Check if it's a Skill tool
              const isSkillTool = toolNameWithoutPrefix === "Skill";
              if (input.command) {
                // Bash tool shows command
                const cmd = String(input.command);
                inputInfo =
                  cmd.length > 100 ? `${cmd.substring(0, 100)}...` : cmd;
              } else if (input.file_path) {
                // File operation shows path
                inputInfo = String(input.file_path);
              } else if (input.query) {
                // Search shows keyword
                inputInfo = String(input.query);
              } else if (input.url) {
                // URL-related
                inputInfo = String(input.url);
              } else if (isSkillTool && input.skill) {
                // Skill tool shows skill name
                inputInfo = String(input.skill);
              } else if (isSkillTool && input.args) {
                // Skill tool args parameter
                inputInfo =
                  typeof input.args === "string"
                    ? String(input.args)
                    : JSON.stringify(input.args).slice(0, 60);
              }
            }

            if (inputInfo) {
              await replyCallback(`🔧 ${toolDisplayName}(${inputInfo})`);
            } else {
              await replyCallback(`🔧 ${toolDisplayName}()`);
            }
          }
        }
        if (message.type === "tool_result") {
          console.log(
            `[${platform}] Tool result:`,
            message.toolUseId,
            "isError:",
            message.isError,
            "output length:",
            message.output?.length || 0,
          );
          // Real-time display of tool execution results
          if (message.output && message.output.length > 0) {
            console.log(
              `[${platform}] Tool output preview:`,
              message.output.substring(0, Math.min(500, message.output.length)),
            );
          }
        }
        if (message.type === "error") {
          await replyCallback(
            formatAgentStreamErrorForUser(
              platform,
              message.message ?? "(unknown)",
            ),
          );
          return;
        }
        if (message.type === "result") {
          // Log cost/usage summary for observability
          const costUsd =
            typeof message.cost === "number" ? message.cost : null;
          const durationMs =
            typeof message.duration === "number" ? message.duration : null;
          console.log(
            `[${platform}] [TokenMonitor] Agent result:`,
            `subtype: ${message.content}`,
            costUsd !== null
              ? `cost: $${costUsd.toFixed(6)} USD`
              : "cost: unknown",
            durationMs !== null
              ? `duration: ${(durationMs / 1000).toFixed(1)}s`
              : "",
          );
          // Handle error result types
          if (message.content === "error_during_execution") {
            await replyCallback(
              "Error: Agent execution failed. Please try again.",
            );
            return;
          }
          if (message.content === "error_max_turns") {
            await replyCallback("Error: Agent reached maximum turn limit.");
            return;
          }
          if (message.content === "error_max_budget_usd") {
            await replyCallback("Error: Agent reached maximum budget.");
            return;
          }
          if (message.content === "error_max_structured_output_retries") {
            await replyCallback(
              "Error: Agent failed to produce valid structured output.",
            );
            return;
          }
        }
        if (message.type === "done") {
          break;
        }
      }

      console.log(
        `[${platform}] ===== Agent execution complete =====`,
        `textMessageCount: ${textMessageCount}`,
        `toolUseCount: ${toolUseCount}`,
        `finalResponse length: ${finalResponse.length}`,
        `hasSentFinalResponse: ${hasSentFinalResponse}`,
      );

      // Only send final response if we haven't already sent it
      if (!hasSentFinalResponse && finalResponse) {
        const maxLength = 4000;
        // Strip malformed tool calls (e.g., XML format output from some models like MiniMax)
        let messageToSend = stripMalformedToolCalls(finalResponse);
        if (messageToSend.length > maxLength) {
          messageToSend = `${messageToSend.slice(0, maxLength)}\n\n... (truncated)`;
        }
        console.log(
          `[${platform}] 🔄 Sending FINAL response (not sent during loop)...`,
          `hasSentFinalResponse: ${hasSentFinalResponse}`,
        );
        await replyCallback(`🤖 ${messageToSend}`);
        console.log(`[${platform}] ✓ Final response sent successfully`);
      } else if (!finalResponse) {
        console.log(`[${platform}] ⚠️  No final response to send`);
      } else {
        // Response was already sent during loop
        console.log(
          `[${platform}] ⏭️  Skipping final response (already sent during loop)`,
          `hasSentFinalResponse: ${hasSentFinalResponse}`,
        );
      }

      return;
    }

    // If no userId provided, this should not happen in current implementation
    console.error(`[${platform}] ❌ userId is required for agent runtime`);
    await replyCallback("Error: userId is required");
  } catch (error) {
    console.error(`[${platform}] Agent runtime failed:`, error);
    await replyCallback("An error occurred. Please try again later.");
  }
}
