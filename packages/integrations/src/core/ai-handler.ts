/**
 * AI Handler Interface
 *
 * Defines the contract for AI runtime handlers used by platform integrations.
 * The web application provides an implementation that delegates to its specific
 * AI runtime (e.g., Claude via @openloomi/ai).
 */

import type { PlatformId } from "./index.js";

export interface AIHandlerOptions {
  conversation?: Array<{
    role: "user" | "assistant";
    content: string;
    timestamp?: number;
  }>;
  images?: Array<{ data: string; mimeType: string }>;
  fileAttachments?: Array<{ name: string; data: string; mimeType: string }>;
  userId?: string;
  accountId?: string;
  workDir?: string;
  aiSoulPrompt?: string | null;
  language?: string | null;
  modelConfig?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
}

/**
 * Interface for AI runtime handlers used by platform integrations.
 *
 * Implementations should delegate to the application's specific AI runtime
 * (e.g., Claude Agent via @openloomi/ai).
 */
export interface AIHandler {
  /**
   * Handle an agent runtime request
   *
   * @param prompt - The user's message/prompt
   * @param options - Additional options (conversation history, images, etc.)
   * @param replyCallback - Callback to send replies back to the platform
   * @param platform - The platform identifier
   */
  handleAgentRuntime(
    prompt: string,
    options: AIHandlerOptions,
    replyCallback: (message: string) => Promise<void>,
    platform: PlatformId,
  ): Promise<void>;
}
