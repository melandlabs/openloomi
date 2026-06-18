/**
 * MCP Business Tools - Combined exports
 *
 * This module combines all business tool factories and creates the MCP server.
 */

import {
  createSdkMcpServer,
  type SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import type { Session } from "next-auth";
import type { InsightChangeCallback } from "./shared";

import { createTimeTool } from "./time";
import { createChatInsightTool } from "./chat-insight";
import { createDownloadAttachmentTool } from "./download-attachment";
import { createContactsTool } from "./contacts";
import { createIntegrationsTool } from "./integrations";
import { createSendReplyTool } from "./send-reply";
import { createInsightCrudTools } from "./insight-crud";
import { createSearchKnowledgeTools } from "./search-knowledge";
import { createRawMessagesTools } from "./raw-messages";
import { createUnifiedMemorySearchTool } from "./unified-memory";
import { createMemoryPathTool } from "./memory-path";
import { createSchedulerTools } from "./scheduler";
import { createUserMemoryTool, type MemoryUpdateCallback } from "./user-memory";

export type BusinessToolsMcpOptions = {
  excludeTools?: string[];
  onMemoryUpdate?: MemoryUpdateCallback;
};

/**
 * Create business tools MCP server
 *
 * This server provides business logic tools that interact with the database
 * and external services. It requires a user session to function properly.
 *
 * @param session - User session for authentication and context
 * @param cloudAuthToken - Optional cloud auth token for embeddings API
 * @param onInsightChange - Optional callback to notify frontend of insight changes
 * @param chatId - Optional chat ID for associating insights with conversations
 * @param options - Optional runtime tool configuration
 * @returns MCP server instance
 */
export function createBusinessToolsMcpServer(
  session: Session,
  cloudAuthToken?: string,
  onInsightChange?: InsightChangeCallback,
  chatId?: string,
  options?: BusinessToolsMcpOptions,
) {
  // Store cloudAuthToken for embeddings API (needed when cloud calls tools)
  const embeddingsAuthToken = cloudAuthToken;
  const tools: SdkMcpToolDefinition<any>[] = [
    // time tool - no session needed
    createTimeTool(),

    // Session-based tools
    createChatInsightTool(session),
    createDownloadAttachmentTool(session, chatId),
    createContactsTool(session),
    createIntegrationsTool(session),
    createSendReplyTool(session),

    // Insight CRUD tools
    ...createInsightCrudTools(
      session,
      chatId,
      onInsightChange,
      embeddingsAuthToken,
    ),

    // Search knowledge tools
    ...createSearchKnowledgeTools(session, embeddingsAuthToken),

    // Unified memory search tool
    createUnifiedMemorySearchTool(session, embeddingsAuthToken),

    // Raw messages tools
    ...createRawMessagesTools(session),

    // Memory path tool
    createMemoryPathTool(session),

    // Scheduler tools
    ...createSchedulerTools(session, embeddingsAuthToken),

    // User memory tool
    createUserMemoryTool(session, options?.onMemoryUpdate),
  ];

  const excludeSet = new Set(options?.excludeTools ?? []);
  const filteredTools =
    excludeSet.size > 0
      ? tools.filter((businessTool) => {
          const toolName = (businessTool as { name: string }).name;
          return !excludeSet.has(toolName);
        })
      : tools;

  return createSdkMcpServer({
    name: "business-tools",
    version: "1.0.0",
    tools: filteredTools,
  });
}

// Re-export shared types for external use
export type { InsightChangeCallback, TaskInput } from "./shared";
export { INSIGHT_FILTER_KINDS } from "./shared";
export type { MemoryUpdateCallback } from "./user-memory";
