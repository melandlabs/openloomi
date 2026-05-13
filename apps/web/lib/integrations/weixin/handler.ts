/**
 * WeChat iLink inbound message handling (consistent with QQ / Feishu Bot mode)
 */
import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { LRUCache } from "lru-cache";
import { sendReplyByBotId } from "@/lib/bots/send-reply";
import {
  type IntegrationAccountWithBot,
  getContact,
  getUserById,
  getUserTypeForService,
  loadIntegrationCredentials,
  upsertContact,
} from "@/lib/db/queries";
import type { UserType } from "@/app/(auth)/auth";
import { DEFAULT_AI_MODEL, AI_PROXY_BASE_URL } from "@/lib/env/constants";
import { handleAgentRuntime } from "@/lib/ai/runtime/shared";
import {
  weixinSendImageMessage,
  weixinSendFileMessage,
  CDN_BASE_URL,
} from "@openloomi/integrations/weixin/ilink-client";
import type { WeixinIlinkCredentials } from "@openloomi/integrations/weixin/ilink-client";
import { WeixinConversationStore } from "@openloomi/integrations/weixin/conversation-store";
import { getAppMemoryDir } from "@/lib/utils/path";
import { weixinLogger } from "@/lib/utils/logger";

// Singleton instance for WeChat conversation history
const weixinConversationStore = new WeixinConversationStore(getAppMemoryDir());

/** Image extensions considered as auto-sendable in Agent workDir */
const SEND_IMAGE_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
]);

// Guard against duplicate processing of the same messageId
// (e.g. two poll loops racing before the async lock in ws-listener kicks in)
const processingMessages = new LRUCache<string, boolean>({ max: 500 });

/**
 * Scan workDir, send images and files one by one to WeChat user via CDN
 * Images use IMAGE message, other files use FILE message
 */
async function sendWorkDirFilesToWeixin(
  workDir: string,
  credentials: WeixinIlinkCredentials,
  toUserId: string,
  contextToken: string,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(workDir);
  } catch {
    return;
  }

  const mediaFiles = entries.filter((f) => !f.startsWith("."));
  if (mediaFiles.length === 0) return;

  weixinLogger.debug(
    `Found ${mediaFiles.length} files in workDir, preparing to send`,
  );

  for (const filename of mediaFiles) {
    const filePath = path.join(workDir, filename);
    const ext = path.extname(filename).toLowerCase();
    try {
      const buf = await readFile(filePath);
      if (SEND_IMAGE_EXTS.has(ext)) {
        await weixinSendImageMessage({
          credentials,
          toUserId,
          contextToken,
          imageBuffer: buf,
          cdnBaseUrl: CDN_BASE_URL,
        });
        weixinLogger.debug(`workDir image sent: ${filename}`);
      } else {
        await weixinSendFileMessage({
          credentials,
          toUserId,
          contextToken,
          fileBuffer: buf,
          fileName: filename,
          cdnBaseUrl: CDN_BASE_URL,
        });
        weixinLogger.debug(`workDir file sent: ${filename}`);
      }
    } catch (err) {
      weixinLogger.error(`Failed to send workDir file ${filename}:`, err);
    }
  }
}

export async function handleWeixinInboundMessage(
  account: IntegrationAccountWithBot,
  params: {
    fromUserId: string;
    messageId: string;
    text: string;
    /** Description list for non-text content like images/voice/files/video */
    mediaHints?: string[];
    /** Decrypted image data (base64 + mimeType), passed to vision model */
    images?: Array<{ data: string; mimeType: string }>;
    /** Decrypted file attachments (including voice), passed to Agent for parsing/transcription */
    fileAttachments?: Array<{ name: string; data: string; mimeType: string }>;
    contextToken: string;
  },
  options?: { authToken?: string },
): Promise<void> {
  const { userId } = account;

  // Skip if this messageId is already being processed
  if (processingMessages.has(params.messageId)) {
    weixinLogger.debug(
      `Skipping duplicate processing for messageId=${params.messageId}`,
    );
    return;
  }
  processingMessages.set(params.messageId, true);
  try {
    return await processWeixinInboundMessage(account, params, options);
  } finally {
    processingMessages.delete(params.messageId);
  }
}

async function processWeixinInboundMessage(
  account: IntegrationAccountWithBot,
  params: {
    fromUserId: string;
    messageId: string;
    text: string;
    mediaHints?: string[];
    images?: Array<{ data: string; mimeType: string }>;
    fileAttachments?: Array<{ name: string; data: string; mimeType: string }>;
    contextToken: string;
  },
  options?: { authToken?: string },
): Promise<void> {
  const { userId } = account;
  const bot = account.bot;
  if (!bot || bot.adapter !== "weixin") {
    weixinLogger.warn("Account not linked to weixin bot, skipping");
    return;
  }

  const text = params.text?.trim();
  const mediaHints = params.mediaHints ?? [];
  const images = params.images ?? [];
  const fileAttachments = params.fileAttachments ?? [];
  // If text, media hints, and image data are all empty, nothing to process
  if (
    !text &&
    mediaHints.length === 0 &&
    images.length === 0 &&
    fileAttachments.length === 0
  )
    return;

  const LOG = process.env.DEBUG_WEIXIN === "true";
  let userType: UserType;

  // Persist contextToken for future proactive push (cron notifications)
  if (params.contextToken?.trim()) {
    try {
      const existingContact = await getContact(userId, params.fromUserId);
      const currentMeta =
        (existingContact?.contactMeta as Record<string, any>) ?? {};
      await upsertContact({
        userId,
        botId: bot.id,
        contactId: params.fromUserId,
        contactName: existingContact?.contactName ?? params.fromUserId,
        type: existingContact?.type ?? "p2p",
        contactMeta: {
          ...currentMeta,
          lastContextToken: params.contextToken.trim(),
          lastContextTokenAt: Date.now(),
        },
      });
    } catch (e) {
      weixinLogger.warn("Failed to persist weixin contextToken:", e);
    }
  }

  try {
    userType = await getUserTypeForService(userId);
    const user = await getUserById(userId);

    // Skip insight content fetching for weixin
    const context = "No summary data available";

    // Build media description paragraph (images/voice/files/video etc.)
    const imageDesc =
      images.length > 0
        ? images
            .map(
              (_, i) =>
                `[Image ${i + 1}: embedded, please view and analyze directly]`,
            )
            .join("\n")
        : "";
    const fileDesc =
      fileAttachments.length > 0
        ? fileAttachments
            .map(
              (f, i) =>
                `[Attachment ${i + 1}: ${f.name}, type ${f.mimeType}, please try to read/transcribe content first]`,
            )
            .join("\n")
        : "";
    const allMediaHints = [
      ...mediaHints,
      ...(imageDesc ? [imageDesc] : []),
      ...(fileDesc ? [fileDesc] : []),
    ];
    const mediaSection =
      allMediaHints.length > 0
        ? [
            "",
            "=== Media content in user message ===",
            allMediaHints.join("\n"),
          ].join("\n")
        : "";

    const userContent = text || allMediaHints.join("\n");

    const prompt = [
      "You are the openloomi assistant. Help the user based on the following cross-platform message summaries.",
      "When information is insufficient, say so instead of making up content.",
      "If the user sent media (image/voice/file/video) without text, acknowledge what was received and respond appropriately.",
      "",
      "=== User's latest summaries (may be empty) ===",
      context,
      mediaSection,
      "",
      "=== User's question (this single message to the bot) ===",
      userContent,
      "",
      "Answer concisely.",
    ].join("\n");

    if (LOG) {
      weixinLogger.debug(
        `Initiate model generation messageId=${params.messageId} length=${text.length}`,
      );
    }

    const conversationHistory = weixinConversationStore.getConversationHistory(
      userId,
      params.fromUserId,
    );

    const token = options?.authToken;
    if (!token) {
      weixinLogger.warn(
        "No cloud auth token found under Tauri. Please complete cloud login and pass the token when connecting.",
      );
    }

    // Allocate independent workDir for this message to ensure precise scanning after Agent completes
    const workDir = `${process.env.HOME ?? "~"}/.openloomi/sessions/weixin-${params.messageId}`;

    // Agent callback is "🤖" + optional variant selector + space + incremental body; do not use fixed slice(2), do not join multiple 🤖 segments
    const assembled = { value: "" };
    const appendStreamChunk = (chunk: string) => {
      const t = chunk.replace(/^\uFEFF/, "").trimStart();
      if (t.startsWith("🔧")) return;
      if (/^🤖/u.test(t)) {
        assembled.value += t.replace(/^🤖(?:\uFE0F)?\s*/u, "");
        return;
      }
      if (t.startsWith("Error:")) {
        assembled.value = t;
        return;
      }
      assembled.value += t;
    };
    await handleAgentRuntime(
      prompt,
      {
        userId,
        accountId: account.id, // Account ID for per-day file persistence
        workDir,
        conversation: conversationHistory,
        stream: false,
        silentTools: true,
        // Pass downloaded and decrypted images to vision model (only pass when images are available)
        ...(images.length > 0 && { images }),
        // Pass voice/file attachments to Agent (can be used for auto-transcription or document reading)
        ...(fileAttachments.length > 0 && { fileAttachments }),
        ...(token && {
          modelConfig: {
            apiKey: token,
            baseUrl: AI_PROXY_BASE_URL,
            model: DEFAULT_AI_MODEL,
          },
        }),
      },
      async (chunk) => {
        appendStreamChunk(chunk);
      },
      "weixin",
    );
    const answer = assembled.value.trim();
    if (!answer) {
      weixinLogger.error(
        "Agent callback did not produce body text (please confirm if callback contains 🤖 prefix). Will use default prompt.",
      );
    }

    // After Agent completes, scan workDir and send generated/downloaded images to WeChat user
    const rawCreds = loadIntegrationCredentials<{
      ilinkToken?: string;
      baseUrl?: string;
      routeTag?: string;
    }>(account);
    if (rawCreds?.ilinkToken) {
      const credentials: WeixinIlinkCredentials = {
        ilinkToken: rawCreds.ilinkToken,
        baseUrl: rawCreds.baseUrl?.trim() || undefined,
        routeTag: rawCreds.routeTag?.trim() || undefined,
      };
      await sendWorkDirFilesToWeixin(
        workDir,
        credentials,
        params.fromUserId,
        params.contextToken,
      );
    }

    const toSend =
      answer || "Insufficient information to answer, please try again later.";
    weixinLogger.debug(
      `Calling sendReplyByBotId, body length=${toSend.length} messageId=${params.messageId}`,
    );
    await sendReplyByBotId({
      id: bot.id,
      userId,
      recipients: [params.fromUserId],
      message: toSend,
      withAppSuffix: true,
      weixinContextToken: params.contextToken,
    });

    // Store conversation history
    if (userContent.length > 0) {
      weixinConversationStore.addMessage(
        userId,
        params.fromUserId,
        "user",
        userContent,
      );
    }
    if (toSend.length > 0) {
      weixinConversationStore.addMessage(
        userId,
        params.fromUserId,
        "assistant",
        toSend,
      );
    }
  } catch (error) {
    weixinLogger.error("Failed to process inbound message:", error);
    try {
      await sendReplyByBotId({
        id: bot.id,
        userId,
        recipients: [params.fromUserId],
        message:
          "An error occurred while processing your message, please try again later.",
        withAppSuffix: false,
        weixinContextToken: params.contextToken,
      });
    } catch (e) {
      weixinLogger.error("Failed to send error notification:", e);
    }
  }
}
