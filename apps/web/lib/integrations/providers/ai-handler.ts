/**
 * WebAIHandler - AI Handler implementation for apps/web
 *
 * Implements the AIHandler interface from @openloomi/integrations/core
 * by delegating to the shared handleAgentRuntime implementation.
 */

import type { AIHandler, AIHandlerOptions } from "@openloomi/integrations/core";
import { handleAgentRuntime as sharedHandleAgentRuntime } from "@/lib/ai/runtime/shared";

/**
 * Options for handleAgentRuntime
 */
export interface WebAIHandlerOptions {
  conversation?: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    timestamp?: number;
  }>;
  images?: Array<{ data: string; mimeType: string }>;
  fileAttachments?: Array<{ name: string; data: string; mimeType: string }>;
  userId?: string;
  workDir?: string;
  aiSoulPrompt?: string | null;
  language?: string | null;
  modelConfig?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    thinkingLevel?: "disabled" | "low" | "adaptive";
  };
  silentTools?: boolean;
  accountId?: string;
  abortController?: AbortController;
}

/**
 * Implementation of AIHandler that delegates to the shared runtime
 */
export class WebAIHandler implements AIHandler {
  /**
   * Handle an agent runtime request
   *
   * @param prompt - The user's message/prompt
   * @param options - Additional options (conversation history, images, etc.)
   * @param replyCallback - Callback to send replies back to the platform
   * @param platform - The platform identifier
   */
  async handleAgentRuntime(
    prompt: string,
    options: AIHandlerOptions,
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
    // Convert AIHandlerOptions to WebAIHandlerOptions
    const webOptions: WebAIHandlerOptions = {
      conversation: options.conversation,
      images: options.images,
      fileAttachments: options.fileAttachments,
      userId: options.userId,
      workDir: options.workDir,
      aiSoulPrompt: options.aiSoulPrompt,
      language: options.language,
      modelConfig: options.modelConfig,
    };

    // Delegate to the shared implementation with platform
    return sharedHandleAgentRuntime(
      prompt,
      webOptions,
      replyCallback,
      platform,
    );
  }
}

/**
 * Singleton instance of WebAIHandler
 */
export const webAIHandler = new WebAIHandler();
