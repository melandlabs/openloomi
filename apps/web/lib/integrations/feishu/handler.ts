/**
 * Feishu Bot Inbound Message Handler (Bot Mode, based on OpenClaw)
 *
 * Unlike Telegram/iMessage self mode: this is "user → bot → openloomi replies on behalf".
 * - One im.message.receive_v1 contains one user message.
 * - Group chat @ activation: incrementally pull Feishu session history based on local latest message time (window up to 3 days), write to session file,
 *   then combine with locally built model context (historical text total limit approximately 20,000 Unicode characters).
 * - Tauri: uses modelConfig to request /api/ai; Non-Tauri: direct LLM.
 */
import { sendReplyByBotId } from "@/lib/bots/send-reply";
import {
  type IntegrationAccountWithBot,
  getUserTypeForService,
  getUserById,
  getUserInsightSettings,
  loadIntegrationCredentials,
} from "@/lib/db/queries";
import { DEFAULT_AI_MODEL, AI_PROXY_BASE_URL } from "@/lib/env/constants";
import { getCloudAuthToken } from "@/lib/auth/token-manager";
import { handleAgentRuntime } from "@/lib/ai/runtime/shared";
import {
  FeishuConversationStore,
  type ChatType,
  type QuotedMessage,
  type RuntimeConversationMessage,
} from "@openloomi/integrations/feishu/conversation-store";
import { FeishuAdapter } from "@openloomi/integrations/feishu";

type FeishuCredentials = {
  appId?: string;
  appSecret?: string;
  domain?: "feishu" | "lark";
};

/** Aligned with history pull window: includes session file records up to 3 days */
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const THREE_DAYS_SEC = Math.floor(THREE_DAYS_MS / 1000);
/** Model context: historical conversation text total character limit (Unicode code point approximation) */
const CONTEXT_HISTORY_MAX_CHARS = 20_000;

/** Matches Insight settings language, used for Feishu-side visible text */
function userPrefersChinese(language: string | null | undefined): boolean {
  const n = (language ?? "").trim().toLowerCase();
  return n.startsWith("zh");
}

function pickUserLocale<T extends { zh: string; en: string }>(
  bundle: T,
  zh: boolean,
): string {
  return zh ? bundle.zh : bundle.en;
}

/** Feishu bot prompts sent to end users (CN/EN) */
const FEISHU_USER_COPY = {
  timeoutFallback: {
    zh: "处理超时，请缩短问题或稍后再试。（若经常在桌面端出现，请确认已登录云端并完成飞书连接时的鉴权。）",
    en: "The reply took too long. Try a shorter question or try again later. In the desktop app, ensure you are signed in to the cloud and Feishu has finished connecting.",
  },
  insufficient: {
    zh: "当前信息不足，无法可靠回答。",
    en: "Not enough context to answer reliably.",
  },
  authFailure: {
    zh: "云端令牌无效或已过期，请在 openloomi 内重新登录后再向机器人发消息。（重启后请稍等界面加载完成再发。）",
    en: "Your cloud session token is invalid or expired. Please sign in to openloomi again, then message the bot. After a restart, wait until the app has loaded.",
  },
  internalPlaceholder: {
    zh: "模型服务暂时异常，请稍后再试。若刚重启应用，请确认已登录并等待几秒后再发消息。",
    en: "The assistant service is temporarily unavailable. If you just restarted the app, wait a few seconds, make sure you are signed in, then try again.",
  },
  processingError: {
    zh: "处理消息时出错了，请稍后重试。",
    en: "Something went wrong while processing your message. Please try again later.",
  },
} as const;

function formatTs(tsMs: number): string {
  const d = new Date(tsMs);
  const yyyy = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
}

function normalizeSenderLabel(entry: QuotedMessage): string {
  const name = entry.senderName?.trim();
  if (name) return name;
  const sid = entry.senderId?.trim();
  return sid && sid.length > 0 ? sid : "unknown";
}

function formatEntryForModel(entry: QuotedMessage): RuntimeConversationMessage {
  const roleTag = entry.role.toUpperCase();
  const sender = normalizeSenderLabel(entry);
  const prefix = `[${formatTs(entry.timestamp)}][${roleTag}][${sender}] `;
  return {
    role: entry.role,
    content: `${prefix}${entry.content}`,
  };
}

/**
 * Process single user message received by Feishu bot: use account owner's insight context + this message content to generate reply, sent as bot
 * @param options.authToken Cloud token for bot to call AI in Tauri mode
 */
export async function handleFeishuInboundMessage(
  account: IntegrationAccountWithBot,
  params: {
    chatId: string;
    messageId: string;
    senderId: string;
    senderName?: string;
    text: string;
    quoteIds?: string[];
    imageKeys?: string[];
    chatType: "p2p" | "group";
  },
  options?: { authToken?: string },
): Promise<void> {
  const { userId } = account;
  const bot = account.bot;
  if (!bot || bot.adapter !== "feishu") {
    console.warn("[Feishu] Account not linked to a Feishu bot, skipping");
    return;
  }

  const {
    chatId,
    text,
    messageId,
    chatType,
    senderId,
    senderName,
    quoteIds,
    imageKeys,
  } = params;
  const normalizedInputText = text?.trim() ?? "";
  const hasInputImages = (imageKeys?.length ?? 0) > 0;
  if (!normalizedInputText && !hasInputImages) {
    return;
  }

  const LOG_FEISHU = process.env.DEBUG_FEISHU === "true";
  const logMsg = (label: string, ...args: unknown[]) => {
    if (LOG_FEISHU) console.log("[Feishu]", label, ...args);
  };

  let zhUiForUserCopy = false;

  try {
    const insightSettings = await getUserInsightSettings(userId);
    zhUiForUserCopy = userPrefersChinese(insightSettings?.language);
    await getUserTypeForService(userId);
    await getUserById(userId);

    const credentials = loadIntegrationCredentials<FeishuCredentials>(account);
    const domain: "feishu" | "lark" =
      credentials?.domain === "lark" ? "lark" : "feishu";
    const appId = credentials?.appId?.trim();
    const appSecret = credentials?.appSecret?.trim();

    const conversationStore = new FeishuConversationStore(
      domain,
      undefined,
      account.id,
    );
    const retainNotBeforeMs = Date.now() - THREE_DAYS_MS;

    const hasFeishuAppCredentials = Boolean(appId && appSecret);
    const shouldInitAdapter =
      hasFeishuAppCredentials &&
      (chatType === "group" ||
        (imageKeys?.length ?? 0) > 0 ||
        (quoteIds?.length ?? 0) > 0);
    let adapter: FeishuAdapter | null = null;
    if (shouldInitAdapter && appId && appSecret) {
      adapter = new FeishuAdapter({
        botId: bot.id,
        appId,
        appSecret,
        domain,
      });
    }
    if (chatType === "group" && adapter) {
      try {
        const nowSec = Math.floor(Date.now() / 1000);
        const floorSec = nowSec - THREE_DAYS_SEC;
        const latestLocalSec = conversationStore.getLatestStoredTimestampSec(
          userId,
          chatId,
          "group",
        );
        const sinceForPull =
          latestLocalSec != null
            ? Math.max(floorSec, latestLocalSec + 1)
            : floorSec;

        if (sinceForPull <= nowSec) {
          const fetched = await adapter.fetchChatMessagesSince({
            chatId,
            chatType: "group",
            sinceSec: sinceForPull,
          });

          const botOpenId = await adapter.getBotOpenId();

          const mergeItems = fetched.map((msg) => {
            const isAssistant = Boolean(botOpenId && msg.sender === botOpenId);
            const role: "user" | "assistant" = isAssistant
              ? "assistant"
              : "user";
            return {
              messageId: String(msg.id ?? `${chatId}-${msg.timestamp}`),
              timestampSec: msg.timestamp,
              senderId: msg.sender,
              senderName: msg.senderName,
              role,
              content: msg.text,
              quoteIds: msg.quoteIds,
              imageKeys: msg.imageKeys,
            };
          });

          await conversationStore.mergePulledMessages({
            userId,
            chatId,
            chatType: "group",
            items: mergeItems,
            retainNotBeforeMs,
          });

          console.log(
            "[Feishu] Incremental session history pull chat_id=%s sinceSec=%s merged=%d latestLocalWas=%s",
            chatId,
            sinceForPull,
            mergeItems.length,
            latestLocalSec ?? "(none)",
          );
        }
      } catch (historyErr) {
        console.warn(
          "[Feishu] Failed to pull and merge session history, will use local file only:",
          historyErr,
        );
      }
    }

    const imagesForModel: Array<{ data: string; mimeType: string }> = [];
    if (adapter && messageId && imageKeys && imageKeys.length > 0) {
      for (const imageKey of imageKeys) {
        try {
          const image = await adapter.downloadMessageImage(messageId, imageKey);
          if (!image) continue;
          imagesForModel.push(image);
        } catch (imageErr) {
          console.warn(
            "[Feishu] Failed to download image message_id=%s image_key=%s",
            messageId,
            imageKey,
            imageErr,
          );
        }
      }
      if (LOG_FEISHU) {
        console.log(
          "[Feishu][DEBUG_IMAGE] inbound image_keys=%d downloaded=%d message_id=%s",
          imageKeys.length,
          imagesForModel.length,
          messageId,
        );
      }
    }

    const excludeIds = new Set<string>();
    if (messageId) excludeIds.add(messageId);

    const historyEntries = conversationStore.getHistoryEntriesForContext(
      userId,
      chatId,
      chatType as ChatType,
      CONTEXT_HISTORY_MAX_CHARS,
      { excludeMessageIds: excludeIds },
    );
    const conversationHistory: RuntimeConversationMessage[] =
      historyEntries.map(formatEntryForModel);

    const resolvedQuotes = conversationStore.getQuotedMessagesByIds(
      userId,
      chatId,
      chatType as ChatType,
      quoteIds ?? [],
    );
    if (adapter && resolvedQuotes.length > 0) {
      // Prefer direct reply target (first quoteId: parent_id), then root/others.
      const primaryQuote = resolvedQuotes[0];
      const primaryMid = primaryQuote?.messageId?.trim();
      let primaryImageKeys = (primaryQuote?.imageKeys ?? [])
        .map((k) => k?.trim())
        .filter((k): k is string => Boolean(k));

      if (primaryMid && primaryImageKeys.length === 0) {
        primaryImageKeys = await adapter.getMessageImageKeys(primaryMid);
        if (primaryImageKeys.length > 0) {
          await conversationStore.patchMessageImageKeys({
            userId,
            chatId,
            chatType: chatType as ChatType,
            messageId: primaryMid,
            imageKeys: primaryImageKeys,
          });
          if (LOG_FEISHU) {
            console.log(
              "[Feishu][DEBUG_IMAGE] patched session imageKeys for quoted message_id=%s count=%d",
              primaryMid,
              primaryImageKeys.length,
            );
          }
        }
      }

      if (primaryMid && primaryImageKeys.length > 0) {
        const seenImageKeys = new Set<string>();
        for (const imageKey of primaryImageKeys) {
          if (seenImageKeys.has(imageKey)) continue;
          seenImageKeys.add(imageKey);
          try {
            const image = await adapter.downloadMessageImage(
              primaryMid,
              imageKey,
            );
            if (!image) continue;
            imagesForModel.push(image);
          } catch (imageErr) {
            console.warn(
              "[Feishu] Failed to download quoted message image message_id=%s image_key=%s",
              primaryMid,
              imageKey,
              imageErr,
            );
          }
        }
      }

      if (LOG_FEISHU) {
        console.log(
          "[Feishu][DEBUG_IMAGE] primary_quoted_id=%s primary_quoted_image_keys=%d total_images_for_model=%d",
          primaryMid ?? "(none)",
          primaryImageKeys.length,
          imagesForModel.length,
        );
      }
    }
    if (LOG_FEISHU) {
      console.log(
        "[Feishu][DEBUG_IMAGE] final images_for_model=%d message_id=%s quote_ids=%s",
        imagesForModel.length,
        messageId || "(empty)",
        (quoteIds ?? []).join(",") || "(none)",
      );
    }
    if (LOG_FEISHU) {
      console.log(
        "[Feishu][DEBUG_QUOTE] incoming_quote_ids=%s resolved_quotes=%d",
        (quoteIds ?? []).join(",") || "(none)",
        resolvedQuotes.length,
      );
    }
    const quoteSection =
      resolvedQuotes.length > 0
        ? [
            "=== Quoted Messages (explicitly referenced by current user message) ===",
            ...resolvedQuotes.map((m) => {
              const sender = normalizeSenderLabel(m);
              return `[${formatTs(m.timestamp)}][${m.role.toUpperCase()}][${sender}] ${m.content}`;
            }),
            "",
          ].join("\n")
        : "";
    const latestQuoted = resolvedQuotes.at(-1);
    const quoteResolutionSection =
      latestQuoted != null
        ? [
            "=== Quote Resolution ===",
            "The current user message is a reply/quote action.",
            "If the user asks to translate/rewrite/summarize/count 'this sentence/this text' without restating full source text, use the latest quoted message as the primary target.",
            `Latest quoted message id: ${latestQuoted.messageId}`,
            `Latest quoted message time: ${formatTs(latestQuoted.timestamp)}`,
            `Latest quoted message sender: ${normalizeSenderLabel(latestQuoted)}`,
            `Latest quoted message content: ${latestQuoted.content}`,
            "",
          ].join("\n")
        : "";

    const historySection =
      conversationHistory.length > 0
        ? [
            "=== Conversation History ===",
            ...conversationHistory.map(
              (msg: { content: string }) => msg.content,
            ),
            "",
          ].join("\n")
        : "";

    const imagePrioritySection =
      imagesForModel.length > 0
        ? [
            "=== Image Priority Rules ===",
            "First complete an image-only understanding step, then use history only as supporting context.",
            "When image evidence conflicts with conversation history, trust the image(s).",
            "Do not answer image-specific questions using only historical text.",
            "",
          ].join("\n")
        : "";

    console.log(
      "[Feishu] Bot initiating model generation message_id=%s user message length=%d conversationHistory.length=%d approxCharsBudget=%d",
      messageId,
      normalizedInputText.length,
      conversationHistory.length,
      CONTEXT_HISTORY_MAX_CHARS,
    );

    const token =
      options?.authToken?.trim() || getCloudAuthToken()?.trim() || undefined;
    if (!token) {
      console.warn(
        "[Feishu] No cloud auth token (connection + in-memory unset). Open the desktop app, sign in, wait for the Feishu listener to initialize, or re-save Feishu in Connectors.",
      );
    }

    const abortController = new AbortController();
    const agentTimeoutMs = Number.parseInt(
      process.env.FEISHU_AGENT_TIMEOUT_MS || "",
      10,
    );
    const FEISHU_AGENT_MAX_MS = Number.isFinite(agentTimeoutMs)
      ? Math.max(30_000, agentTimeoutMs)
      : 180_000;
    let hardTimeout = false;
    const deadline = setTimeout(() => {
      hardTimeout = true;
      abortController.abort();
      console.warn(
        `[Feishu] Agent exceeded ${FEISHU_AGENT_MAX_MS}ms without finishing; aborted and will send timeout hint message_id=%s`,
        messageId,
      );
    }, FEISHU_AGENT_MAX_MS);

    let imageUnderstandingSection = "";
    if (imagesForModel.length > 0) {
      const imageUnderstandingPrompt = [
        "You are performing IMAGE-ONLY UNDERSTANDING.",
        "Ignore conversation history and quoted text for this step.",
        "Analyze only the provided image(s) and output concise factual findings.",
        "If text is visible in image, transcribe key parts.",
        "If uncertain, explicitly say what is uncertain.",
        "",
        "User request:",
        normalizedInputText ||
          "[The user sent an image. Please analyze the image.]",
      ].join("\n");
      const imageStepParts: string[] = [];
      await handleAgentRuntime(
        imageUnderstandingPrompt,
        {
          userId,
          ...(imagesForModel.length > 0 ? { images: imagesForModel } : {}),
          stream: false,
          silentTools: true,
          language: insightSettings?.language ?? null,
          abortController,
          ...(token && {
            modelConfig: {
              apiKey: token,
              baseUrl: AI_PROXY_BASE_URL,
              model: DEFAULT_AI_MODEL,
            },
          }),
        },
        async (chunk) => {
          imageStepParts.push(chunk);
        },
        "feishu",
      );
      const imageUnderstanding = imageStepParts.join("").trim();
      if (imageUnderstanding) {
        imageUnderstandingSection = [
          "=== Image Understanding (step-1, image-only) ===",
          imageUnderstanding,
          "",
        ].join("\n");
      }
      if (LOG_FEISHU) {
        console.log(
          "[Feishu][DEBUG_IMAGE] image-only step finished chars=%d",
          imageUnderstanding.length,
        );
      }
    }

    const prompt = [
      "You are the openloomi assistant. Help the user based on the following cross-platform message summaries.",
      "When information is insufficient, say so instead of making up content.",
      "",
      imagePrioritySection,
      imageUnderstandingSection,
      historySection,
      quoteSection,
      quoteResolutionSection,
      "=== User's current question ===",
      normalizedInputText ||
        "[The user sent an image. Please analyze the image.]",
      "",
      "Answer concisely, taking into account the context above.",
    ]
      .filter((line) => line !== "")
      .join("\n");

    if (LOG_FEISHU) {
      console.log("[Feishu][DEBUG_PROMPT] ===== BEGIN PROMPT =====");
      console.log(prompt);
      console.log("[Feishu][DEBUG_PROMPT] ===== END PROMPT =====");
    }

    const replyParts: string[] = [];
    try {
      await handleAgentRuntime(
        prompt,
        {
          userId,
          conversation: conversationHistory,
          ...(imagesForModel.length > 0 ? { images: imagesForModel } : {}),
          stream: false,
          silentTools: true,
          language: insightSettings?.language ?? null,
          abortController,
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
        "feishu",
      );
    } finally {
      clearTimeout(deadline);
      await adapter?.kill().catch(() => {});
    }

    const answer = replyParts.join("").trim();

    try {
      await conversationStore.appendTurn({
        userId,
        chatId,
        chatType: chatType as ChatType,
        message: {
          messageId,
          role: "user",
          content:
            normalizedInputText ||
            "[The user sent an image. Please analyze the image.]",
          timestamp: Date.now(),
          senderId,
          senderName,
          quoteIds: quoteIds && quoteIds.length > 0 ? quoteIds : undefined,
          imageKeys: imageKeys && imageKeys.length > 0 ? imageKeys : undefined,
        },
      });
    } catch (saveError) {
      console.error(
        "[Feishu] Failed to save conversation messages:",
        saveError,
      );
    }

    const looksLikeAuthOrProxyFailure = (s: string) =>
      s.includes("invalid token") ||
      s.includes("new_api_error") ||
      /Failed to authenticate/i.test(s) ||
      (/\b401\b/.test(s) &&
        /token|authenticate|unauthorized|API Error/i.test(s));

    const looksLikeInternalPlaceholder = (s: string) =>
      s.includes("__INTERNAL_ERROR__") ||
      s.includes("__API_KEY_ERROR__") ||
      s.includes("__TIMEOUT_ERROR__");

    let toSend = hardTimeout
      ? answer.trim() ||
        pickUserLocale(FEISHU_USER_COPY.timeoutFallback, zhUiForUserCopy)
      : answer ||
        pickUserLocale(FEISHU_USER_COPY.insufficient, zhUiForUserCopy);

    if (looksLikeAuthOrProxyFailure(answer)) {
      toSend = pickUserLocale(FEISHU_USER_COPY.authFailure, zhUiForUserCopy);
    } else if (looksLikeInternalPlaceholder(answer)) {
      toSend = pickUserLocale(
        FEISHU_USER_COPY.internalPlaceholder,
        zhUiForUserCopy,
      );
    }
    logMsg("sending full reply content", toSend.slice(0, 500));

    await sendReplyByBotId({
      id: bot.id,
      userId,
      recipients: [chatId],
      message: toSend,
      withAppSuffix: true,
    });
  } catch (error) {
    console.error("[Feishu] Failed to process inbound message:", error);
    try {
      await sendReplyByBotId({
        id: bot.id,
        userId,
        recipients: [chatId],
        message: pickUserLocale(
          FEISHU_USER_COPY.processingError,
          zhUiForUserCopy,
        ),
        withAppSuffix: false,
      });
    } catch (e) {
      console.error("[Feishu] Failed to send error message:", e);
    }
  }
}
