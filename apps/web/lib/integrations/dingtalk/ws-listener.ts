/**
 * DingTalk Stream Mode Listener (for bot to receive messages)
 *
 * Use official Node SDK `dingtalk-stream` to establish long connection, aligned with Python nanobot/channels/dingtalk.py behavior:
 * - TOPIC_ROBOT (/v1.0/im/bot/messages/get) to receive user messages
 * - Quick socketCallBackResponse to avoid server retry
 * - Private chat chatId is senderStaffId/senderId; group chat is group:{openConversationId}
 */
import { DWClient, EventAck, TOPIC_ROBOT } from "dingtalk-stream";
import {
  bulkUpsertContacts,
  getIntegrationAccountsByUserId,
  insertDingTalkInsightMessageIgnoreDuplicate,
  loadIntegrationCredentials,
} from "@/lib/db/queries";
import { handleDingTalkInboundMessage } from "./handler";

const DEBUG = process.env.DEBUG_DINGTALK === "true";

type DingTalkCredentials = { clientId?: string; clientSecret?: string };

interface DingTalkConnection {
  accountId: string;
  userId: string;
  account: Awaited<ReturnType<typeof getIntegrationAccountsByUserId>>[number];
  client: DWClient;
  authToken?: string;
}

const connections = new Map<string, DingTalkConnection>();

const processedMsgIds = new Map<string, number>();
const DEDUP_TTL_MS = 5 * 60 * 1000;
const DEDUP_MAX_SIZE = 5000;
const MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024;

function pruneDedup(): void {
  if (processedMsgIds.size <= DEDUP_MAX_SIZE) return;
  const now = Date.now();
  for (const [key, ts] of processedMsgIds.entries()) {
    if (now - ts > DEDUP_TTL_MS) processedMsgIds.delete(key);
  }
  if (processedMsgIds.size > DEDUP_MAX_SIZE) {
    const entries = [...processedMsgIds.entries()].sort((a, b) => a[1] - b[1]);
    entries
      .slice(0, Math.floor(entries.length / 2))
      .forEach((e) => processedMsgIds.delete(e[0]));
  }
}

/** Parse text from Stream callback payload (refer to open-dingtalk example and nanobot) */
/** Parse second-level timestamp from DingTalk event body (createAt is often in milliseconds) */
function parseDingTalkTsSec(data: Record<string, unknown>): number {
  const raw = data.createAt ?? data.create_at;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return Math.floor(Date.now() / 1000);
  }
  if (n > 1_000_000_000_000) {
    return Math.floor(n / 1000);
  }
  return Math.floor(n);
}

/**
 * DingTalk message field structure (from reverse engineering of official Python SDK chatbot.py):
 * - text:     { msgtype:"text",     text:     { content:"..." } }
 * - picture:  { msgtype:"picture",  content:  { downloadCode:"..." } }
 * - audio:    { msgtype:"audio",    content:  { downloadCode:"...", duration:ms } }
 * - file:     { msgtype:"file",     content:  { downloadCode:"...", fileName:"..." } }
 * - richText: { msgtype:"richText", content:  { richText:[ {type:"text",text:"..."}, {type:"picture",downloadCode:"..."} ] } }
 *
 * Download process (two steps):
 * 1. POST https://api.dingtalk.com/v1.0/robot/messageFiles/download
 *    { downloadCode, robotCode } + header x-acs-dingtalk-access-token
 *    -> { downloadUrl: "..." }
 * 2. GET downloadUrl (no additional auth headers needed)
 */

type DownloadTask = {
  downloadCode: string;
  fileName: string;
  mimeType: string;
  hintOnSuccess?: string;
  kind: "image" | "file";
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function firstNonEmptyString(values: unknown[]): string {
  for (const v of values) {
    const s = asString(v).trim();
    if (s) return s;
  }
  return "";
}

function guessMimeTypeByFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".amr")) return "audio/amr";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".md")) return "text/markdown";
  return "application/octet-stream";
}

/**
 * Parse various content types from DingTalk Stream messages, extract text, media hints, and download tasks
 * Field paths verified against official Python SDK (dingtalk_stream/chatbot.py)
 */
function parseInboundContent(data: Record<string, unknown>): {
  text: string;
  mediaHints: string[];
  downloadTasks: DownloadTask[];
} {
  // Official SDK preserves original case, doesn't convert to lowercase
  const msgtype = asString(data.msgtype).trim();
  const mediaHints: string[] = [];
  const downloadTasks: DownloadTask[] = [];
  let text = "";

  // ---------- text ----------
  if (msgtype === "text") {
    const textObj = asRecord(data.text);
    text = firstNonEmptyString([textObj?.content]);
  }

  // For all non-text types, put media info in data.content
  const content = asRecord(data.content);

  // ---------- picture ----------
  if (msgtype === "picture") {
    const downloadCode = firstNonEmptyString([
      content?.downloadCode,
      // Compatible with old SDK versions that may use pictureDownloadCode
      content?.pictureDownloadCode,
    ]);
    if (downloadCode) {
      downloadTasks.push({
        downloadCode,
        fileName: "dingtalk-image.jpg",
        mimeType: "image/jpeg",
        hintOnSuccess: "[Image attachment downloaded]",
        kind: "image",
      });
    } else {
      mediaHints.push("[User sent an image]");
    }
  }

  // ---------- file ----------
  if (msgtype === "file") {
    const fileName =
      firstNonEmptyString([content?.fileName, content?.filename]) ||
      "dingtalk-file";
    const downloadCode = firstNonEmptyString([content?.downloadCode]);
    mediaHints.push(`[User sent file: ${fileName}]`);
    if (downloadCode) {
      downloadTasks.push({
        downloadCode,
        fileName,
        mimeType: guessMimeTypeByFileName(fileName),
        hintOnSuccess: `[File attachment downloaded: ${fileName}]`,
        kind: "file",
      });
    }
  }

  // ---------- audio / voice ----------
  if (msgtype === "audio" || msgtype === "voice") {
    // duration unit is milliseconds
    const duration = Number(content?.duration ?? 0);
    const sec = duration > 0 ? Math.max(1, Math.round(duration / 1000)) : 0;
    // Server-side recognized text (present in some scenarios)
    const transcript = firstNonEmptyString([
      content?.recognition,
      content?.text,
      content?.transcript,
    ]);
    if (transcript) {
      text = transcript;
      mediaHints.push(
        sec > 0
          ? `[Voice message, duration ${sec} seconds, transcript below]`
          : "[Voice message, transcript below]",
      );
    } else {
      mediaHints.push(
        sec > 0
          ? `[User sent a ${sec} second voice message]`
          : "[User sent a voice message]",
      );
    }
    const downloadCode = firstNonEmptyString([content?.downloadCode]);
    if (downloadCode) {
      const fileName = `dingtalk-voice-${Date.now()}.amr`;
      downloadTasks.push({
        downloadCode,
        fileName,
        mimeType: "audio/amr",
        hintOnSuccess: `[Voice attachment downloaded: ${fileName}, auto-transcription attempted]`,
        kind: "file",
      });
    }
  }

  // ---------- richText ----------
  if (msgtype === "richText") {
    // richText list is in content.richText field
    const richTextList = Array.isArray(content?.richText)
      ? (content.richText as unknown[])
      : [];
    for (const item of richTextList) {
      const itemRecord = asRecord(item);
      if (!itemRecord) continue;
      const itemType = asString(itemRecord.type).toLowerCase();
      if (itemType === "text") {
        const seg = firstNonEmptyString([itemRecord.text, itemRecord.content]);
        if (seg) text = [text, seg].filter(Boolean).join("\n").trim();
      } else if (itemType === "picture" || itemType === "image") {
        const downloadCode = firstNonEmptyString([
          itemRecord.downloadCode,
          itemRecord.pictureDownloadCode,
        ]);
        if (downloadCode) {
          downloadTasks.push({
            downloadCode,
            fileName: `dingtalk-rich-img-${Date.now()}.jpg`,
            mimeType: "image/jpeg",
            hintOnSuccess: "[Image attachment in rich text downloaded]",
            kind: "image",
          });
        } else {
          mediaHints.push(
            "[Rich text contains image but missing download code]",
          );
        }
      }
    }
    if (!text && downloadTasks.length === 0 && mediaHints.length === 0) {
      mediaHints.push("[User sent a rich text message]");
    }
  }

  return { text: text.trim(), mediaHints, downloadTasks };
}

export async function startDingTalkConnection(
  account: Awaited<ReturnType<typeof getIntegrationAccountsByUserId>>[number],
  authToken?: string,
): Promise<void> {
  if (account.platform !== "dingtalk") return;

  const credentials = loadIntegrationCredentials<DingTalkCredentials>(account);
  const clientId = credentials?.clientId?.trim();
  const clientSecret = credentials?.clientSecret?.trim();
  if (!clientId || !clientSecret) {
    if (DEBUG) {
      console.warn(
        `[DingTalk] Account ${account.id} missing clientId/clientSecret, skipping`,
      );
    }
    return;
  }

  const accountId = account.id;
  const existing = connections.get(accountId);
  if (existing) {
    if (authToken?.trim()) existing.authToken = authToken.trim();
    if (DEBUG) {
      console.log(
        `[DingTalk] Account ${accountId} already connected, authToken updated`,
      );
    }
    return;
  }

  const client = new DWClient({
    clientId,
    clientSecret,
    debug: DEBUG,
  });

  client
    .registerCallbackListener(TOPIC_ROBOT, (res) => {
      void (async () => {
        const messageId = res.headers?.messageId ?? "";
        try {
          const raw = typeof res.data === "string" ? res.data : "{}";
          const data = JSON.parse(raw) as Record<string, unknown>;

          // ACK as soon as possible, avoid re-push within 60s (consistent with socketCallBackResponse in official example)
          try {
            client.socketCallBackResponse(messageId, {
              errcode: 0,
              errmsg: "ok",
            });
          } catch (ackErr) {
            console.warn("[DingTalk] socketCallBackResponse failed:", ackErr);
          }

          const conn = connections.get(accountId);
          if (!conn) return;

          const { text, mediaHints, downloadTasks } = parseInboundContent(data);
          if (!text && mediaHints.length === 0 && downloadTasks.length === 0) {
            if (DEBUG) {
              console.log(
                "[DingTalk] Ignoring message without text msgtype=%s",
                String(data.msgtype ?? ""),
              );
            }
            return;
          }

          const conversationType = String(data.conversationType ?? "");
          const openConversationId = String(
            data.openConversationId ?? data.conversationId ?? data.chatId ?? "",
          );
          const senderStaffId = String(data.senderStaffId ?? "");
          const senderId = String(data.senderId ?? "");
          const senderNick = String(data.senderNick ?? "Unknown");

          const senderForPrivate = senderStaffId || senderId;
          const isGroup =
            conversationType === "2" && openConversationId.length > 0;
          const chatId = isGroup
            ? `group:${openConversationId}`
            : senderForPrivate;

          if (!chatId) {
            if (DEBUG) console.warn("[DingTalk] Failed to parse chatId", data);
            return;
          }

          const msgId = String(data.msgId ?? messageId ?? "");
          const downloadedImages: Array<{ data: string; mimeType: string }> =
            [];
          const downloadedFiles: Array<{
            name: string;
            data: string;
            mimeType: string;
          }> = [];
          // Only fetch token when there are download tasks (lazy loading, reuse within same message)
          let accessTokenCache: string | null = null;
          const getOrFetchToken = async (): Promise<string> => {
            if (accessTokenCache) return accessTokenCache;
            const tokenResp = await fetch(
              "https://api.dingtalk.com/v1.0/oauth2/accessToken",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  appKey: clientId,
                  appSecret: clientSecret,
                }),
              },
            );
            const tokenJson = (await tokenResp.json().catch(() => null)) as {
              accessToken?: string;
            } | null;
            if (!tokenResp.ok || !tokenJson?.accessToken) {
              throw new Error(
                `Failed to get accessToken HTTP ${tokenResp.status}`,
              );
            }
            accessTokenCache = tokenJson.accessToken;
            return accessTokenCache;
          };

          for (const task of downloadTasks) {
            try {
              // Step 1: Use downloadCode to exchange for temporary download link
              const token = await getOrFetchToken();
              const dlResp = await fetch(
                "https://api.dingtalk.com/v1.0/robot/messageFiles/download",
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-acs-dingtalk-access-token": token,
                  },
                  body: JSON.stringify({
                    downloadCode: task.downloadCode,
                    robotCode: clientId,
                  }),
                  signal: AbortSignal.timeout(15_000),
                },
              );
              const dlJson = (await dlResp.json().catch(() => null)) as {
                downloadUrl?: string;
              } | null;
              if (!dlResp.ok || !dlJson?.downloadUrl) {
                throw new Error(
                  `Failed to get download URL HTTP ${dlResp.status} ${JSON.stringify(dlJson).slice(0, 200)}`,
                );
              }

              if (DEBUG) {
                console.log(
                  "[DingTalk] Downloading media URL=%s",
                  dlJson.downloadUrl,
                );
              }

              // Step 2: Download file content (direct GET, no additional auth headers needed)
              const fileResp = await fetch(dlJson.downloadUrl, {
                signal: AbortSignal.timeout(30_000),
              });
              if (!fileResp.ok) {
                throw new Error(
                  `Failed to download file HTTP ${fileResp.status}`,
                );
              }
              const buf = Buffer.from(await fileResp.arrayBuffer());
              if (buf.length > MAX_ATTACHMENT_SIZE_BYTES) {
                mediaHints.push(
                  `[Attachment ${task.fileName} too large (${(buf.length / 1024 / 1024).toFixed(1)}MB), auto-parsing skipped]`,
                );
                continue;
              }
              if (task.kind === "image") {
                downloadedImages.push({
                  data: buf.toString("base64"),
                  mimeType: task.mimeType || "image/jpeg",
                });
              } else {
                downloadedFiles.push({
                  name: task.fileName,
                  data: buf.toString("base64"),
                  mimeType: task.mimeType || "application/octet-stream",
                });
              }
              if (task.hintOnSuccess) {
                mediaHints.push(task.hintOnSuccess);
              }
            } catch (downloadError) {
              mediaHints.push(`[Attachment ${task.fileName} download failed]`);
              if (DEBUG) {
                console.warn(
                  "[DingTalk] Attachment download failed file=%s err=%o",
                  task.fileName,
                  downloadError,
                );
              }
            }
          }

          const dedupKey = `${accountId}:${msgId || messageId}`;
          if (processedMsgIds.has(dedupKey)) {
            console.log("[DingTalk] Deduplication skip msgId=%s", dedupKey);
            return;
          }
          processedMsgIds.set(dedupKey, Date.now());
          pruneDedup();

          const accountRecord = conn.account;
          const botId = accountRecord.bot?.id;
          const stableMsgId = msgId || messageId;
          if (botId && stableMsgId) {
            const tsSec = parseDingTalkTsSec(data);
            void insertDingTalkInsightMessageIgnoreDuplicate({
              userId: accountRecord.userId,
              botId,
              chatId,
              msgId: stableMsgId,
              senderId: senderForPrivate || senderId || null,
              senderName: senderNick,
              text,
              tsSec,
            });
          }
          if (botId) {
            bulkUpsertContacts([
              {
                userId: accountRecord.userId,
                contactId: chatId,
                contactName: isGroup ? openConversationId : senderNick,
                type: isGroup ? "group" : "private",
                botId,
                contactMeta: {
                  platform: "dingtalk",
                  chatId,
                  chatType: isGroup ? "group" : "private",
                },
              },
            ]).catch((err) => {
              console.error("[DingTalk] bulkUpsertContacts failed:", err);
            });
          }

          console.log(
            "[DingTalk] Received user message chatId=%s sender=%s text=%s",
            chatId,
            senderNick,
            text.slice(0, 120),
          );

          setImmediate(() => {
            handleDingTalkInboundMessage(
              conn.account,
              {
                chatId,
                msgId: msgId || messageId,
                senderId: senderForPrivate || senderId,
                senderName: senderNick,
                text,
                chatType: isGroup ? "group" : "p2p",
                mediaHints,
                images: downloadedImages,
                fileAttachments: downloadedFiles,
              } as any,
              { authToken: conn.authToken },
            ).catch((err) => {
              console.error(
                "[DingTalk] Failed to process inbound message asynchronously:",
                err,
              );
            });
          });
        } catch (e) {
          console.error("[DingTalk] Stream callback exception:", e);
        }
      })();
    })
    .registerAllEventListener(() => ({ status: EventAck.SUCCESS }));

  const conn: DingTalkConnection = {
    accountId,
    userId: account.userId,
    account,
    client,
    authToken: authToken?.trim() || undefined,
  };
  connections.set(accountId, conn);

  // connect() will auto-retry on internal failure and won't reject on failure path, so don't await to avoid misjudgment
  void client.connect();
  if (DEBUG)
    console.log(
      `[DingTalk] Stream connection scheduled accountId=${accountId}`,
    );
}

export function stopDingTalkConnection(accountId: string): void {
  const conn = connections.get(accountId);
  if (!conn) return;
  try {
    conn.client.disconnect();
  } catch (e) {
    console.warn("[DingTalk] disconnect exception", e);
  }
  connections.delete(accountId);
}

export async function startDingTalkListenersForUser(
  userId: string,
  authToken?: string,
): Promise<void> {
  const accounts = await getIntegrationAccountsByUserId({ userId });
  const rows = accounts.filter((a) => a.platform === "dingtalk");
  for (const account of rows) {
    await startDingTalkConnection(account, authToken);
  }
}

export async function startAllDingTalkListeners(
  authToken?: string,
): Promise<void> {
  const { db } = await import("@/lib/db");
  const { integrationAccounts } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");

  const rows = await db
    .select({ userId: integrationAccounts.userId })
    .from(integrationAccounts)
    .where(eq(integrationAccounts.platform, "dingtalk"));

  const userIdList: string[] = rows
    .map((row: { userId: string | null }) => row.userId)
    .filter(
      (id: string | null): id is string =>
        typeof id === "string" && id.length > 0,
    );
  const uniqueUserIds = Array.from(new Set(userIdList));
  let total = 0;
  for (const uid of uniqueUserIds) {
    await startDingTalkListenersForUser(uid, authToken);
    const accounts = await getIntegrationAccountsByUserId({ userId: uid });
    total += accounts.filter((a) => a.platform === "dingtalk").length;
  }
  if (DEBUG) console.log(`[DingTalk] Started ${total} connections`);
}
