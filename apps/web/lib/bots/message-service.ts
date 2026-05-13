/**
 * Message Service - Unified message sending service layer
 * Handles message sending logic for all platforms, decouples AI tools and UI components
 */

import { sendReplyByBotId } from "./send-reply";
import { AppError } from "@openloomi/shared/errors";
import type { Attachment } from "@openloomi/shared";

export interface SendMessageParams {
  botId: string;
  recipients: string[];
  message: string;
  messageHtml?: string;
  subject?: string; // Email subject (only applicable to email channel)
  cc?: string[];
  bcc?: string[];
  attachments?: Attachment[];
  withAppSuffix?: boolean;
  dryRun?: boolean; // If true, only validates without sending
}

export interface SendMessageResult {
  success: boolean;
  skipped?: boolean;
  message?: string;
  recipients?: string[];
  error?: string;
  mock?: boolean; // Whether this is a mock send (used for environment variable MOCK_INSIGHT_REPLY_SUCCESS)
}

/**
 * Unified message sending service
 * @param params Send parameters
 * @param userId User ID (optional, will be fetched from bot if not provided)
 * @returns Send result
 */
export async function sendMessage(
  params: SendMessageParams,
  userId?: string,
): Promise<SendMessageResult> {
  const {
    botId,
    recipients,
    message,
    messageHtml,
    subject,
    cc,
    bcc,
    attachments,
    withAppSuffix = true,
    dryRun = false,
  } = params;

  // Validate required parameters
  if (!botId) {
    return {
      success: false,
      error: "Bot ID is required",
    };
  }

  if (!recipients || recipients.length === 0) {
    return {
      success: false,
      error: "At least one recipient is required",
    };
  }

  if (!message || message.trim().length === 0) {
    return {
      success: false,
      error: "Message content is required",
    };
  }

  // If dry run mode, only validate without sending
  if (dryRun) {
    return {
      success: true,
      skipped: true,
      message: "Message validated successfully (dry run)",
      recipients,
    };
  }

  // Check environment variable MOCK_INSIGHT_REPLY_SUCCESS
  // If enabled, return success directly without actually sending the message
  if (process.env.MOCK_INSIGHT_REPLY_SUCCESS === "true") {
    console.log(
      "[MessageService] MOCK_INSIGHT_REPLY_SUCCESS is enabled, returning mock success",
    );
    return {
      success: true,
      mock: true,
      message: "Message sent successfully (mock mode)",
      recipients,
    };
  }

  try {
    const result = await sendReplyByBotId({
      id: botId,
      userId,
      recipients,
      cc,
      bcc,
      message,
      messageHtml,
      subject,
      attachments,
      withAppSuffix,
    });

    // Check if skipped (e.g., manual bot)
    if (
      result &&
      typeof result === "object" &&
      "skipped" in result &&
      result.skipped
    ) {
      return {
        success: false,
        skipped: true,
        message: result.message,
      };
    }

    return {
      success: true,
      recipients,
      message: "Message sent successfully",
    };
  } catch (error) {
    console.error("[MessageService] Failed to send message:", error);

    const errorMessage =
      error instanceof AppError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);

    // Preserve all properties of the error object (including similarContacts)
    const result: SendMessageResult = {
      success: false,
      error: errorMessage,
    };

    // If error object contains similar contacts, pass them to the return value
    if (error && typeof error === "object" && "similarContacts" in error) {
      (result as any).similarContacts = (error as any).similarContacts;
    }

    return result;
  }
}

/**
 * Validate message parameters without sending
 */
export async function validateMessage(
  params: SendMessageParams,
): Promise<SendMessageResult> {
  return sendMessage({ ...params, dryRun: true });
}
