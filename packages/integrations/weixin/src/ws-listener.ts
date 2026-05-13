/**
 * WeChat iLink Long-Polling Listener
 *
 * Protocol-level WebSocket listener for WeChat iLink protocol.
 * Sits in packages/integrations since it's platform protocol code.
 * Receives messages via long-polling and forwards to the provided callback.
 *
 * The web application provides:
 * - onMessage: InboundMessageHandler callback for message processing
 * - credentialStore: CredentialStore interface for account data
 */

import type {
  CredentialStore,
  InboundMessageHandler,
} from "@openloomi/integrations/core";
import {
  weixinGetUpdates,
  weixinGetConfig,
  weixinSendTyping,
  downloadAndDecryptBuffer,
  detectImageMimeType,
  CDN_BASE_URL,
  MessageType as MSG_TYPE,
  MessageItemType,
  TypingStatus,
} from "@openloomi/integrations/weixin/ilink-client";
import type {
  WeixinIlinkCredentials,
  WeixinMessage,
} from "@openloomi/integrations/weixin/ilink-client";

const DEBUG = process.env.DEBUG_WEIXIN === "true";
const DEDUP_TTL_MS = 5 * 60 * 1000;
const DEDUP_MAX_SIZE = 5000;

// Module-level deduplication cache
const processedMessageIds = new Map<string, number>();

// Use official library enum constants (MessageType, MessageItemType)
const MSG_TYPE_BOT = MSG_TYPE.BOT;
const TEXT_ITEM_TYPE = MessageItemType.TEXT;
const IMAGE_ITEM_TYPE = MessageItemType.IMAGE;
const VOICE_ITEM_TYPE = MessageItemType.VOICE;
const FILE_ITEM_TYPE = MessageItemType.FILE;
const VIDEO_ITEM_TYPE = MessageItemType.VIDEO;

const MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024;

type WeixinConn = {
  accountId: string;
  userId: string;
  credentials: WeixinIlinkCredentials;
  stopped: boolean;
  loopPromise: Promise<void> | null;
};

const connections = new Map<string, WeixinConn>();

// Prevent concurrent startWeixinConnection calls for the same accountId
// (e.g. two callers racing during startup)
const pendingStarts = new Map<string, Promise<void>>();

function pruneProcessedIds(): void {
  const now = Date.now();
  for (const [key, ts] of processedMessageIds.entries()) {
    if (now - ts > DEDUP_TTL_MS) processedMessageIds.delete(key);
  }
  // Enforce max size to prevent unbounded memory growth
  if (processedMessageIds.size > DEDUP_MAX_SIZE) {
    const entries = [...processedMessageIds.entries()].sort(
      (a, b) => a[1] - b[1],
    );
    const toRemove = entries
      .slice(0, Math.floor(entries.length / 2))
      .map((e) => e[0]);
    toRemove.forEach((k) => processedMessageIds.delete(k));
  }
}

// Image CDN download task, executed asynchronously in message loop
type ImageDownloadTask = {
  encryptQueryParam: string;
  aesKeyBase64: string;
};

// File download task (voice/file)
type FileDownloadTask = {
  encryptQueryParam: string;
  aesKeyBase64: string;
  fileName: string;
  mimeType: string;
  hintOnSuccess?: string;
};

function guessMimeTypeByFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".amr")) return "audio/amr";
  if (lower.endsWith(".silk")) return "audio/silk";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

function voiceExtByEncodeType(encodeType?: number): string {
  switch (encodeType) {
    case 5:
      return "amr";
    case 6:
      return "silk";
    case 7:
      return "mp3";
    case 8:
      return "ogg";
    default:
      return "audio";
  }
}

/**
 * Extract text content, media hints, and image download tasks from messages
 */
function extractContent(msg: WeixinMessage): {
  text: string;
  mediaHints: string[];
  imageDownloadTasks: ImageDownloadTask[];
  fileDownloadTasks: FileDownloadTask[];
} {
  const items = msg.item_list ?? [];
  let text = "";
  const mediaHints: string[] = [];
  const imageDownloadTasks: ImageDownloadTask[] = [];
  const fileDownloadTasks: FileDownloadTask[] = [];

  for (const it of items) {
    switch (it.type) {
      case TEXT_ITEM_TYPE:
        if (it.text_item?.text) {
          text = it.text_item.text.trim();
        }
        break;

      case IMAGE_ITEM_TYPE: {
        const img = it.image_item;
        const encryptQueryParam = img?.media?.encrypt_query_param;
        if (encryptQueryParam) {
          const aesKeyBase64 = img?.aeskey
            ? Buffer.from(img.aeskey, "hex").toString("base64")
            : img?.media?.aes_key;
          if (aesKeyBase64) {
            imageDownloadTasks.push({ encryptQueryParam, aesKeyBase64 });
          } else {
            mediaHints.push("[User sent an image (missing decryption key)]");
          }
        } else {
          mediaHints.push("[User sent an image]");
        }
        break;
      }

      case VOICE_ITEM_TYPE: {
        const voiceMedia = it.voice_item?.media;
        const voiceEncryptQueryParam = voiceMedia?.encrypt_query_param;
        const voiceAesKeyBase64 = voiceMedia?.aes_key;
        const voiceText = it.voice_item?.text?.trim();
        const durationSec = Math.round((it.voice_item?.playtime ?? 0) / 1000);
        if (voiceText) {
          text = voiceText;
          if (durationSec > 0) {
            mediaHints.push(
              `[Voice message, duration ${durationSec}s, below is the transcribed content]`,
            );
          }
        } else {
          mediaHints.push(
            durationSec > 0
              ? `[User sent a ${durationSec}s voice message (no transcription text yet)]`
              : "[User sent a voice message]",
          );

          if (voiceEncryptQueryParam && voiceAesKeyBase64) {
            const ext = voiceExtByEncodeType(it.voice_item?.encode_type);
            const fileName = `weixin-voice-${msg.message_id ?? Date.now()}.${ext}`;
            fileDownloadTasks.push({
              encryptQueryParam: voiceEncryptQueryParam,
              aesKeyBase64: voiceAesKeyBase64,
              fileName,
              mimeType: guessMimeTypeByFileName(fileName),
              hintOnSuccess:
                durationSec > 0
                  ? `[Downloaded voice attachment: ${fileName} (${durationSec}s), can try auto-transcription]`
                  : `[Downloaded voice attachment: ${fileName}, can try auto-transcription]`,
            });
          }
        }
        break;
      }

      case FILE_ITEM_TYPE: {
        const fileName = it.file_item?.file_name?.trim() || "Unknown file";
        const fileSizeBytes = Number(it.file_item?.len ?? 0);
        const fileSizeStr =
          fileSizeBytes > 0
            ? fileSizeBytes >= 1024 * 1024
              ? `${(fileSizeBytes / 1024 / 1024).toFixed(1)} MB`
              : `${Math.round(fileSizeBytes / 1024)} KB`
            : "Unknown size";
        mediaHints.push(
          `[User sent a file: ${fileName}, size: ${fileSizeStr}]`,
        );

        const fileEncryptQueryParam = it.file_item?.media?.encrypt_query_param;
        const fileAesKeyBase64 = it.file_item?.media?.aes_key;
        if (fileEncryptQueryParam && fileAesKeyBase64) {
          fileDownloadTasks.push({
            encryptQueryParam: fileEncryptQueryParam,
            aesKeyBase64: fileAesKeyBase64,
            fileName,
            mimeType: guessMimeTypeByFileName(fileName),
            hintOnSuccess: `[Downloaded file attachment: ${fileName}]`,
          });
        }
        break;
      }

      case VIDEO_ITEM_TYPE: {
        const videoSec = Math.round((it.video_item?.play_length ?? 0) / 1000);
        mediaHints.push(
          videoSec > 0
            ? `[User sent a ${videoSec} second video]`
            : "[User sent a video]",
        );
        break;
      }

      default:
        if (DEBUG && it.type) {
          console.log("[Weixin] Unrecognized message item type:", it.type);
        }
    }
  }

  return { text, mediaHints, imageDownloadTasks, fileDownloadTasks };
}

export interface WeixinWsListenerOptions {
  credentialStore: CredentialStore;
  onMessage: InboundMessageHandler;
}

/**
 * Start the polling loop for a WeChat connection
 */
function runPollLoop(conn: WeixinConn, onMessage: InboundMessageHandler): void {
  let buf = "";

  const tick = async (): Promise<void> => {
    while (!conn.stopped) {
      try {
        const resp = await weixinGetUpdates({
          credentials: conn.credentials,
          getUpdatesBuf: buf,
        });
        if (typeof resp.get_updates_buf === "string") {
          buf = resp.get_updates_buf;
        }
        // errcode=-14: iLink session or Token has expired
        if (resp.ret !== 0 && resp.errcode === -14) {
          console.error(
            "[Weixin] iLink session expired (errcode=-14), long polling stopped for this account. Please rescan QR code.",
            conn.accountId,
          );
          conn.stopped = true;
          connections.delete(conn.accountId);
          return;
        }
        const nextTimeout = resp.longpolling_timeout_ms;
        const msgs = resp.msgs ?? [];
        for (const raw of msgs) {
          if (conn.stopped) return;
          // Skip bot's own messages
          if (raw.message_type === MSG_TYPE_BOT) {
            continue;
          }
          const fromId = raw.from_user_id?.trim();
          if (!fromId) continue;
          const { text, mediaHints, imageDownloadTasks, fileDownloadTasks } =
            extractContent(raw);
          // Skip if both text and media hints are empty
          if (
            !text &&
            mediaHints.length === 0 &&
            imageDownloadTasks.length === 0
          )
            continue;
          const messageId = String(
            raw.message_id ?? raw.seq ?? `${fromId}-${raw.create_time_ms}`,
          );
          const contextToken = raw.context_token?.trim() ?? "";
          if (!contextToken) {
            if (DEBUG)
              console.warn(
                "[Weixin] Message has no context_token, skipping messageId=%s",
                messageId,
              );
            continue;
          }

          const dedupKey = `${conn.accountId}:${messageId}`;
          if (processedMessageIds.has(dedupKey)) continue;
          processedMessageIds.set(dedupKey, Date.now());
          pruneProcessedIds();

          // Download images (CDN AES-128-ECB decryption)
          const downloadedImages: Array<{ data: string; mimeType: string }> =
            [];
          const downloadedFiles: Array<{
            name: string;
            data: string;
            mimeType: string;
          }> = [];
          if (imageDownloadTasks.length > 0) {
            const cdnBase = conn.credentials.baseUrl?.trim()
              ? CDN_BASE_URL
              : CDN_BASE_URL;
            for (const task of imageDownloadTasks) {
              try {
                const buf = await downloadAndDecryptBuffer(
                  task.encryptQueryParam,
                  task.aesKeyBase64,
                  cdnBase,
                  "ws-listener-image",
                );
                const mimeType = detectImageMimeType(buf);
                downloadedImages.push({
                  data: buf.toString("base64"),
                  mimeType,
                });
                if (DEBUG) {
                  console.log(
                    `[Weixin] Image download decryption successful ${buf.length} bytes mimeType=${mimeType}`,
                  );
                }
              } catch (err) {
                console.error(
                  "[Weixin] Image CDN download/decryption failed:",
                  err,
                );
                mediaHints.push("[User sent an image (download failed)]");
              }
            }
          }

          // Download voice/file (CDN AES-128-ECB decryption)
          if (fileDownloadTasks.length > 0) {
            const cdnBase = CDN_BASE_URL;
            for (const task of fileDownloadTasks) {
              try {
                const buf = await downloadAndDecryptBuffer(
                  task.encryptQueryParam,
                  task.aesKeyBase64,
                  cdnBase,
                  "ws-listener-file",
                );
                if (buf.length > MAX_ATTACHMENT_SIZE_BYTES) {
                  mediaHints.push(
                    `[Attachment ${task.fileName} too large (${(buf.length / 1024 / 1024).toFixed(1)}MB), skipped auto parsing]`,
                  );
                  continue;
                }
                downloadedFiles.push({
                  name: task.fileName,
                  data: buf.toString("base64"),
                  mimeType: task.mimeType,
                });
                if (task.hintOnSuccess) {
                  mediaHints.push(task.hintOnSuccess);
                }
              } catch (err) {
                console.error(
                  "[Weixin] File/voice CDN download or decryption failed:",
                  err,
                );
                mediaHints.push(
                  `[Attachment ${task.fileName} download failed]`,
                );
              }
            }
          }

          const mediaDesc =
            mediaHints.length > 0 ||
            downloadedImages.length > 0 ||
            downloadedFiles.length > 0
              ? ` [with media: ${[
                  ...mediaHints,
                  ...downloadedImages.map((_, i) => `Image ${i + 1}`),
                  ...downloadedFiles.map((f) => `Attachment: ${f.name}`),
                ].join(", ")}]`
              : "";
          console.log(
            `[Weixin] Received message messageId=${messageId} fromId=${fromId.slice(0, 12)}… contextToken=${contextToken.slice(0, 16)}…(len=${contextToken.length})${mediaDesc}`,
          );

          // Call the onMessage callback with the processed message
          await onMessage({
            platform: "weixin",
            accountId: conn.accountId,
            message: {
              chatId: fromId,
              msgId: messageId,
              senderId: fromId,
              text,
              chatType: "p2p",
              raw: {
                mediaHints,
                images: downloadedImages,
                fileAttachments: downloadedFiles,
                contextToken,
                userId: conn.userId,
              },
            },
          });
        }
        // Use server-suggested timeout if available
        if (typeof nextTimeout === "number" && nextTimeout > 0) {
          await new Promise((r) => setTimeout(r, 0));
        }
      } catch (e) {
        if (conn.stopped) return;
        console.error(
          "[Weixin] getUpdates error accountId=%s",
          conn.accountId,
          e,
        );
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  };

  conn.loopPromise = tick();
}

/**
 * Start a WeChat connection for an account
 */
export async function startWeixinConnection(
  accountId: string,
  userId: string,
  credentials: WeixinIlinkCredentials,
  onMessage: InboundMessageHandler,
): Promise<void> {
  // Prevent concurrent calls from creating duplicate poll loops
  const pending = pendingStarts.get(accountId);
  if (pending) {
    await pending;
    // Re-check after pending resolved — another call may have created the conn
    const recheck = connections.get(accountId);
    if (recheck) return;
  }

  const startPromise = (async () => {
    // Double-check inside the lock scope
    if (connections.get(accountId)) return;

    const conn: WeixinConn = {
      accountId,
      userId,
      credentials,
      stopped: false,
      loopPromise: null,
    };
    connections.set(accountId, conn);
    if (DEBUG)
      console.log("[Weixin] Starting long polling accountId=%s", accountId);
    runPollLoop(conn, onMessage);
  })();

  pendingStarts.set(accountId, startPromise);
  startPromise.finally(() => pendingStarts.delete(accountId));
  await startPromise;
}

/**
 * Stop a WeChat connection
 */
export function stopWeixinConnection(accountId: string): void {
  const conn = connections.get(accountId);
  if (!conn) return;
  conn.stopped = true;
  connections.delete(accountId);
  if (DEBUG) console.log("[Weixin] Stopped accountId=%s", accountId);
}

/**
 * Start WeChat listeners for all accounts of a user
 */
export async function startWeixinListenersForUser(
  userId: string,
  credentialStore: CredentialStore,
  onMessage: InboundMessageHandler,
): Promise<void> {
  const accounts = await credentialStore.getAccountsByUserId(userId);
  const weixinAccounts = accounts.filter((a) => a.platform === "weixin");
  for (const account of weixinAccounts) {
    // Get credentials from account
    const credentials = extractWeixinCredentials(account);
    if (credentials) {
      await startWeixinConnection(
        account.id,
        account.userId,
        credentials,
        onMessage,
      );
    }
  }
}

/**
 * Extract WeChat credentials from an integration account
 */
function extractWeixinCredentials(account: {
  credentials: Record<string, unknown> | null;
}): WeixinIlinkCredentials | null {
  const creds = account.credentials as {
    ilinkToken?: string;
    baseUrl?: string;
    routeTag?: string;
  } | null;
  if (!creds?.ilinkToken) return null;
  return {
    ilinkToken: creds.ilinkToken,
    baseUrl: creds.baseUrl?.trim() || undefined,
    routeTag: creds.routeTag?.trim() || undefined,
  };
}

/**
 * Stop all WeChat connections
 */
export function stopAllWeixinConnections(): void {
  for (const [accountId] of connections) {
    stopWeixinConnection(accountId);
  }
}
