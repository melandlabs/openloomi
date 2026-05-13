/**
 * Shared Agent Runtime Handler (Client Version)
 *
 * Pure frontend version, no database dependency
 * Used for iMessage Tauri frontend environment
 */

import type { AgentConfig, AgentOptions } from "@openloomi/ai/agent/types";
import { getAgentRegistry } from "@openloomi/ai/agent/registry";
import { registerPlugins } from "./register-plugins";
import { formatAgentStreamErrorForUser } from "./shared";

// Track if plugins have been registered
let pluginsRegistered = false;

function ensurePluginsRegistered() {
  if (!pluginsRegistered) {
    registerPlugins();
    pluginsRegistered = true;
  }
}

/**
 * Get display name for a tool (similar to Web UI)
 * Extracts base name and returns a readable format
 */
function getToolDisplayName(toolName: string): string {
  // Extract tool name without prefix (e.g., "mcp__business-tools__chatInsight" -> "chatInsight")
  const nameWithoutPrefix = toolName.includes("__")
    ? toolName.split("__").pop() || toolName
    : toolName;

  // Tool display names
  const names: Record<string, string> = {
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

  return names[nameWithoutPrefix] || nameWithoutPrefix;
}

/**
 * Options for handleAgentRuntime
 */
export interface HandleAgentRuntimeOptions {
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
  images?: Array<{ data: string; mimeType: string }>;
  fileAttachments?: Array<{ name: string; data: string; mimeType: string }>;
  userId?: string; // Add userId for direct Agent calls
  workDir?: string; // Working directory for file operations
  stream?: boolean; // Enable streaming output (default: true)
  aiSoulPrompt?: string | null; // User-defined AI Soul prompt
  language?: string | null; // User language preference
  modelConfig?: {
    // Model configuration for custom API endpoints
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    thinkingLevel?: "disabled" | "low" | "adaptive";
  };
}

/**
 * Handle agent runtime call - Shared implementation (Client Version)
 *
 * @param prompt - The message content
 * @param options - Agent options
 * @param replyCallback - Callback to send reply
 */
export async function handleAgentRuntime(
  prompt: string,
  options: HandleAgentRuntimeOptions,
  replyCallback: (message: string) => Promise<void>,
  platform:
    | "telegram"
    | "whatsapp"
    | "imessage"
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
    if (!options.userId) {
      console.error(`[${platform}] ❌ userId is required for agent runtime`);
      await replyCallback("Error: userId is required");
      return;
    }

    console.log(
      `[${platform}] Running Agent directly (client-side) for user:`,
      options.userId,
    );

    // Build a minimal session object (client version, no database query), includes platform for business-tools to distinguish channels
    const session = {
      user: {
        id: options.userId,
        type: "free", // Client version defaults to free type
      },
      platform,
    };

    // Build agent config
    const agentConfig: AgentConfig = {
      provider: "claude",
      ...(options.workDir && { workDir: options.workDir }),
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

    // Build agent options
    const agentOptions: AgentOptions = {
      permissionMode: "bypassPermissions",
      skillsConfig: {
        enabled: true,
        userDirEnabled: true,
        appDirEnabled: false,
      },
      mcpConfig: {
        enabled: true,
        userDirEnabled: false,
        appDirEnabled: false,
      },
      session,
      stream: options.stream ?? false,
      aiSoulPrompt: options.aiSoulPrompt ?? null,
    };

    // Add conversation history if provided
    if (options.conversation && options.conversation.length > 0) {
      agentOptions.conversation = options.conversation;
    }

    // Add images if provided
    if (options.images && options.images.length > 0) {
      agentOptions.images = options.images;
    }

    // Add fileAttachments if provided
    if (options.fileAttachments && options.fileAttachments.length > 0) {
      agentOptions.fileAttachments = options.fileAttachments;
    }

    // Ensure plugins are registered before creating agent
    ensurePluginsRegistered();

    // Create and run agent
    const agent = getAgentRegistry().create(agentConfig);

    // Add platform context to prompt
    const platformPrompt = `[PLATFORM CONTEXT]
You are running on USER'S COMPUTER, accessed via a ${platform.toUpperCase()} bot conversation.

RESPONSE STYLE (CRITICAL):
- Go directly to conclusions. DO NOT start with "Sure", "Okay", "Got it", "Of course", "Certainly", "No problem", "Sure thing" or similar filler phrases
- Answer in the same language as the user's question
- Be concise and specific

IMPORTANT CAPABILITIES:
- You can ACCESS files on user's computer (Desktop, Documents, Downloads, etc.)
- You can READ, WRITE, COPY files from anywhere on the system
- To SEND a file to user: Copy it to your workDir (${options.workDir || "default directory"})
- Any file in workDir will be AUTOMATICALLY sent to user via ${platform.toUpperCase()}

Examples:
- "Send me screenshot.png from Desktop" → Copy ~/Desktop/screenshot.png to workDir
- "Send me my resume" → Copy ~/Documents/resume.pdf to workDir
- "Generate a report" → Create report.md in workDir (auto-sent)

${"=".repeat(60)}

${prompt}`;

    const generator = agent.run(platformPrompt, agentOptions);

    let finalResponse = "";
    let toolUseCount = 0;
    const usedToolNames: string[] = [];
    let lastSentContent = "";
    let hasSentFinalResponse = false;
    let textMessageCount = 0;

    // Process messages from generator
    for await (const message of generator) {
      if (message.type === "text" && message.content) {
        textMessageCount++;
        finalResponse = message.content;

        if (finalResponse !== lastSentContent) {
          const incrementalChunk = finalResponse.substring(
            lastSentContent.length,
          );
          // Skip empty incremental chunks to avoid sending just "🤖 "
          if (incrementalChunk.length > 0) {
            await replyCallback(`🤖 ${incrementalChunk}`);
          }
          lastSentContent = finalResponse;
          hasSentFinalResponse = true;
        }
      }
      if (message.type === "tool_use") {
        toolUseCount++;
        if (message.name && !usedToolNames.includes(message.name)) {
          usedToolNames.push(message.name);
        }
        // Real-time notification to user about tools being used and their inputs
        if (message.name) {
          const toolDisplayName = getToolDisplayName(message.name);

          // Extract key input information
          let inputInfo = "";
          if (message.input) {
            const input = message.input as Record<string, unknown>;
            if (input.command) {
              const cmd = String(input.command);
              inputInfo =
                cmd.length > 100 ? `${cmd.substring(0, 100)}...` : cmd;
            } else if (input.file_path) {
              inputInfo = String(input.file_path);
            } else if (input.query) {
              inputInfo = String(input.query);
            } else if (input.url) {
              inputInfo = String(input.url);
            }
          }

          if (inputInfo) {
            await replyCallback(`🔧 ${toolDisplayName}(${inputInfo})`);
          } else {
            await replyCallback(`🔧 ${toolDisplayName}()`);
          }
        }
      }
      if (message.type === "error") {
        const userFriendlyError = formatAgentStreamErrorForUser(
          platform,
          message.message ?? "(unknown)",
        );
        await replyCallback(`Error: ${userFriendlyError}`);
        return;
      }
      if (message.type === "done") {
        break;
      }
    }

    // Only send final response if we haven't already sent it
    if (!hasSentFinalResponse && finalResponse) {
      const maxLength = 4000;
      let messageToSend = finalResponse;
      if (messageToSend.length > maxLength) {
        messageToSend = `${messageToSend.slice(0, maxLength)}\n\n... (truncated)`;
      }
      await replyCallback(`🤖 ${messageToSend}`);
    }

    return;
  } catch (error) {
    console.error(`[${platform}] Agent runtime failed:`, error);
    await replyCallback("An error occurred. Please try again later.");
  }
}
