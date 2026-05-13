/**
 * QQ Bot inbound message handling (Bot mode, consistent with Feishu)
 * User → QQ Bot → openloomi replies on behalf
 */
import { sendReplyByBotId } from "@/lib/bots/send-reply";
import type { IntegrationAccountWithBot } from "@/lib/db/queries";
import { DEFAULT_AI_MODEL, AI_PROXY_BASE_URL } from "@/lib/env/constants";
import { handleAgentRuntime } from "@/lib/ai/runtime/shared";

/** Reply target: openid for DM, group_openid for group chat */
function getReplyRecipient(params: {
  chatType: "c2c" | "group" | "channel";
  openid?: string;
  groupOpenid?: string;
  channelId?: string;
}): string | null {
  if (params.chatType === "c2c" && params.openid) return params.openid;
  if (params.chatType === "group" && params.groupOpenid)
    return params.groupOpenid;
  if (params.chatType === "channel" && params.channelId)
    return params.channelId;
  return null;
}

/**
 * Handle single user message received by QQ bot: generate reply and send back as bot
 * @param options.authToken Cloud token used by bot when calling AI in Tauri
 */
export async function handleQQInboundMessage(
  account: IntegrationAccountWithBot,
  params: {
    openid?: string;
    groupOpenid?: string;
    channelId?: string;
    messageId: string;
    content: string;
    chatType: "c2c" | "group" | "channel";
    senderId?: string;
  },
  options?: { authToken?: string },
): Promise<void> {
  const { userId } = account;
  const bot = account.bot;
  if (!bot || bot.adapter !== "qqbot") {
    console.warn("[QQBot] Account not linked to QQ bot, skipping");
    return;
  }

  const recipient = getReplyRecipient(params);
  if (!recipient) {
    console.warn("[QQBot] Failed to parse reply target", params);
    return;
  }
  if (!params.content?.trim()) return;

  const text = params.content.trim();
  const LOG_QQ = process.env.DEBUG_QQBOT === "true";

  try {
    const prompt = [
      "You are the openloomi assistant. Help the user based on the following cross-platform message summaries.",
      "When information is insufficient, say so instead of making up content.",
      "",
      "=== User's question (this single message to the bot) ===",
      text,
      "",
      "Answer concisely.",
    ].join("\n");

    if (LOG_QQ) {
      console.log(
        "[QQBot] Initiating model generation messageId=%s contentLength=%d",
        params.messageId,
        text.length,
      );
    }

    const token = options?.authToken;
    if (!token) {
      console.warn(
        "[QQBot] No cloud auth token found in Tauri. Please complete cloud login and pass token when connecting QQ.",
      );
    }
    const replyParts: string[] = [];
    await handleAgentRuntime(
      prompt,
      {
        userId,
        conversation: [],
        stream: false,
        ...(token && {
          modelConfig: {
            apiKey: token,
            baseUrl: AI_PROXY_BASE_URL,
            model: DEFAULT_AI_MODEL,
          },
        }),
      },
      async (chunk) => {
        replyParts.push(chunk);
      },
      "qqbot",
    );
    const answer = replyParts.join("").trim();

    const toSend =
      answer || "Insufficient information to answer, please try again later.";
    await sendReplyByBotId({
      id: bot.id,
      userId,
      recipients: [recipient],
      message: toSend,
      withAppSuffix: true,
    });
  } catch (error) {
    console.error("[QQBot] Failed to process inbound message:", error);
    try {
      await sendReplyByBotId({
        id: bot.id,
        userId,
        recipients: [recipient],
        message:
          "An error occurred while processing your message, please try again later.",
        withAppSuffix: false,
      });
    } catch (e) {
      console.error("[QQBot] Failed to send error notification:", e);
    }
  }
}
