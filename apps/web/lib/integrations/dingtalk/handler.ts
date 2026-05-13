/**
 * DingTalk bot inbound message processing (Stream mode, consistent with Feishu Bot mode)
 *
 * Generate reply for single user message, send back to corresponding conversation via DingTalkAdapter.
 */
import { sendReplyByBotId } from "@/lib/bots/send-reply";
import {
  type IntegrationAccountWithBot,
  getUserTypeForService,
  getUserById,
} from "@/lib/db/queries";
import { DEFAULT_AI_MODEL, AI_PROXY_BASE_URL } from "@/lib/env/constants";
import { handleAgentRuntime } from "@/lib/ai/runtime/shared";
import { mkdir, readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";
import type { Attachment } from "@openloomi/shared";
import { dingTalkLogger } from "@/lib/utils/logger";

function guessContentTypeByName(fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".amr") return "audio/amr";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".txt") return "text/plain";
  if (ext === ".md") return "text/markdown";
  if (ext === ".json") return "application/json";
  return "application/octet-stream";
}

async function collectWorkDirAttachments(
  workDir: string,
): Promise<Attachment[]> {
  const entries = await readdir(workDir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  const attachments: Attachment[] = [];
  for (const name of files) {
    const absPath = join(workDir, name);
    const st = await stat(absPath);
    if (!st.isFile() || st.size <= 0) continue;
    attachments.push({
      name: basename(name),
      url: `file://${absPath}`,
      contentType: guessContentTypeByName(name),
      sizeBytes: st.size,
      blobPath: absPath,
      source: "local",
    });
  }
  return attachments;
}

function collectAttachmentsFromAnswerText(answer: string): Attachment[] {
  const results: Attachment[] = [];
  // Match markdown links: [name](url)
  const mdLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null = mdLinkRegex.exec(answer);
  while (match !== null) {
    const name = (match[1] || "").trim();
    const url = (match[2] || "").trim();
    if (!url) continue;
    if (
      url.startsWith("http://") ||
      url.startsWith("https://") ||
      url.startsWith("file://")
    ) {
      const finalName = name || basename(url);
      results.push({
        name: finalName,
        url,
        contentType: guessContentTypeByName(finalName),
      });
    }
    match = mdLinkRegex.exec(answer);
  }
  return results;
}

/**
 * Handle single user message received by DingTalk bot
 */
export async function handleDingTalkInboundMessage(
  account: IntegrationAccountWithBot,
  params: {
    chatId: string;
    msgId: string;
    senderId: string;
    senderName?: string;
    text: string;
    chatType: "p2p" | "group";
    mediaHints?: string[];
    images?: Array<{ data: string; mimeType: string }>;
    fileAttachments?: Array<{ name: string; data: string; mimeType: string }>;
  },
  options?: { authToken?: string },
): Promise<void> {
  const { userId } = account;
  const bot = account.bot;
  if (!bot || bot.adapter !== "dingtalk") {
    dingTalkLogger.warn("Account not linked to DingTalk bot, skipping");
    return;
  }

  const { chatId, msgId } = params;
  const text = params.text?.trim() ?? "";
  const mediaHints = params.mediaHints ?? [];
  const images = params.images ?? [];
  const fileAttachments = params.fileAttachments ?? [];
  if (
    !text &&
    mediaHints.length === 0 &&
    images.length === 0 &&
    fileAttachments.length === 0
  ) {
    return;
  }

  const LOG_DT = process.env.DEBUG_DINGTALK === "true";
  const logMsg = (label: string, ...args: unknown[]) => {
    if (LOG_DT) dingTalkLogger.debug(label, ...args);
  };

  try {
    const userType = await getUserTypeForService(userId);
    const user = await getUserById(userId);

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
      "If the user sent media (image/voice/file) without text, acknowledge what was received and respond appropriately.",
      "",
      mediaSection,
      "",
      "=== User's question (this single message to the bot) ===",
      userContent,
      "",
      "Answer concisely.",
    ].join("\n");

    dingTalkLogger.info(
      `Bot initiating model generation msgId=${msgId} user message length=${text.length}`,
      { content: text.slice(0, 200) },
    );
    logMsg("prompt total length", prompt.length);

    let generatedAttachments: Attachment[] = [];

    const token = options?.authToken;
    if (!token) {
      dingTalkLogger.warn(
        "No cloud token passed in Tauri mode, unable to call AI. Please ensure logged in and connected to DingTalk",
      );
    }
    const replyParts: string[] = [];
    const workDir = join(tmpdir(), "openloomi-dingtalk-out", userId, msgId);
    await mkdir(workDir, { recursive: true });
    await handleAgentRuntime(
      prompt,
      {
        userId,
        conversation: [],
        stream: false,
        silentTools: true,
        workDir,
        ...(images.length > 0 && { images }),
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
        replyParts.push(chunk);
      },
      "dingtalk",
    );
    const answer = replyParts.join("").trim();
    generatedAttachments = await collectWorkDirAttachments(workDir);
    if (generatedAttachments.length > 0) {
      dingTalkLogger.debug(
        "Detected %d files generated by Agent",
        generatedAttachments.length,
      );
    }

    const toSend = answer || "I don't have enough context to answer that.";
    const linkAttachments = collectAttachmentsFromAnswerText(toSend);
    const allOutgoingAttachments = [
      ...generatedAttachments,
      ...linkAttachments,
    ];
    dingTalkLogger.debug(
      `Preparing to send reply: textLen=${toSend.length} workDirFiles=${generatedAttachments.length} linkFiles=${linkAttachments.length} totalAttachments=${allOutgoingAttachments.length}`,
    );
    dingTalkLogger.debug(
      `Bot sending reply msgId=${msgId} reply length=${toSend.length}`,
    );

    await sendReplyByBotId({
      id: bot.id,
      userId,
      recipients: [chatId],
      message: toSend,
      attachments: allOutgoingAttachments,
      withAppSuffix: true,
    });
  } catch (error) {
    dingTalkLogger.error("Failed to process inbound message:", error);
    try {
      await sendReplyByBotId({
        id: bot.id,
        userId,
        recipients: [chatId],
        message:
          "An error occurred while processing your message. Please try again later.",
        withAppSuffix: false,
      });
    } catch (e) {
      dingTalkLogger.error("Failed to send error notification:", e);
    }
  }
}
