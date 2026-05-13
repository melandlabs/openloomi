/**
 * WeChat (OpenClaw iLink) Platform Adapter
 * Sends messages via iLink HTTP API using ilink_token, paired with a long-polling listener to receive messages
 * Protocol reference: @tencent-weixin/openclaw-weixin
 *
 * Exports:
 * - WeixinAdapter: Message sending adapter
 * - WeixinConversationStore: Conversation history store
 * - WeixinWsListener: Long-polling listener (protocol-level)
 * - ilink-client utilities
 */

import { MessagePlatformAdapter } from "@openloomi/integrations/channels";
import type {
  Messages,
  Message,
  Image,
  File as FileMsg,
} from "@openloomi/integrations/channels";
import type {
  MessageEvent,
  MessageTarget,
} from "@openloomi/integrations/channels";
import {
  weixinSendTextMessage,
  weixinSendImageMessage,
  weixinSendFileMessage,
  CDN_BASE_URL,
} from "@openloomi/integrations/weixin/ilink-client";
import type { WeixinIlinkCredentials } from "@openloomi/integrations/weixin/ilink-client";

// Re-export ws-listener
export {
  startWeixinConnection,
  stopWeixinConnection,
  startWeixinListenersForUser,
  stopAllWeixinConnections,
} from "./ws-listener";

// Re-export conversation store
export { WeixinConversationStore } from "./conversation-store";

// Re-export ilink-client utilities
export {
  weixinSendTextMessage,
  weixinSendImageMessage,
  weixinSendFileMessage,
  weixinGetUpdates,
  weixinGetConfig,
  CDN_BASE_URL,
} from "./ilink-client";

export type { WeixinIlinkCredentials, WeixinMessage } from "./ilink-client";

function isPlainText(m: Message): m is string {
  return typeof m === "string";
}

function isImageMessage(message: Message): message is Image {
  return (
    typeof message === "object" &&
    message !== null &&
    "url" in message &&
    typeof (message as Image).url === "string" &&
    (message as Image).url.length > 0
  );
}

function isFileMessage(message: Message): message is FileMsg {
  return (
    typeof message === "object" &&
    message !== null &&
    "name" in message &&
    "url" in message &&
    typeof (message as FileMsg).name === "string" &&
    typeof (message as FileMsg).url === "string"
  );
}

/**
 * Get raw Buffer from Image message
 * Priority: base64 > url (download); path is already resolved to url or base64 in server-side scenario
 */
async function imageToBuffer(img: Image): Promise<Buffer> {
  // base64 data (may include data URI prefix)
  if (img.base64) {
    const b64 = img.base64.includes(",")
      ? img.base64.split(",")[1]
      : img.base64;
    return Buffer.from(b64, "base64");
  }

  // Local file path (file:// or absolute path)
  if (img.url.startsWith("file://") || img.url.startsWith("/")) {
    const { readFile } = await import("node:fs/promises");
    const filePath = img.url.startsWith("file://")
      ? new URL(img.url).pathname
      : img.url;
    return readFile(filePath);
  }

  // Remote HTTP(S) URL
  const res = await fetch(img.url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    throw new Error(
      `[WeixinAdapter] Image download failed HTTP ${res.status}: ${img.url.slice(0, 100)}`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Get raw Buffer from File message
 */
async function fileToBuffer(file: FileMsg): Promise<Buffer> {
  if (file.url.startsWith("file://") || file.url.startsWith("/")) {
    const { readFile } = await import("node:fs/promises");
    const filePath = file.url.startsWith("file://")
      ? new URL(file.url).pathname
      : file.url;
    return readFile(filePath);
  }

  const res = await fetch(file.url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) {
    throw new Error(
      `[WeixinAdapter] File download failed HTTP ${res.status}: ${file.url.slice(0, 100)}`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

export class WeixinAdapter extends MessagePlatformAdapter {
  name = "Weixin";
  private credentials: WeixinIlinkCredentials;
  private botId: string;

  constructor(opts: { botId: string; credentials: WeixinIlinkCredentials }) {
    super();
    this.botId = opts.botId ?? "";
    this.credentials = opts.credentials;
  }

  /**
   * WeChat reply must include context_token (from the other party's previous message)
   * Text and image messages are sent separately: text first, then images one by one
   */
  async sendMessagesWithContext(
    peerUserId: string,
    messages: Messages,
    contextToken: string,
  ): Promise<void> {
    if (!contextToken?.trim()) {
      throw new Error(
        "[WeixinAdapter] Missing context_token, please ask user to send a message to the bot first",
      );
    }
    const ctx = contextToken.trim();

    const textParts: string[] = [];
    const imageMessages: Image[] = [];
    const fileMessages: FileMsg[] = [];

    for (const m of messages) {
      if (isPlainText(m)) {
        if (m.trim()) textParts.push(m.trim());
      } else if (isFileMessage(m)) {
        fileMessages.push(m);
      } else if (isImageMessage(m)) {
        imageMessages.push(m);
      }
    }

    const combinedText = textParts.join("\n").trim();

    if (
      combinedText &&
      imageMessages.length === 0 &&
      fileMessages.length === 0
    ) {
      await weixinSendTextMessage({
        credentials: this.credentials,
        toUserId: peerUserId,
        contextToken: ctx,
        text: combinedText,
      });
      return;
    }

    // Has images: text description goes with the first image
    if (imageMessages.length > 0) {
      for (let i = 0; i < imageMessages.length; i++) {
        const img = imageMessages[i];
        const caption = i === 0 ? combinedText : undefined;
        try {
          const buf = await imageToBuffer(img);
          await weixinSendImageMessage({
            credentials: this.credentials,
            toUserId: peerUserId,
            contextToken: ctx,
            imageBuffer: buf,
            caption,
            cdnBaseUrl: CDN_BASE_URL,
          });
        } catch (err) {
          console.error(
            `[WeixinAdapter] Image send failed (${i + 1}), falling back to text notification`,
            err,
          );
          const fallbackText =
            i === 0 && combinedText
              ? `${combinedText}\n[Image failed to send, please retry]`
              : "[Image failed to send, please retry]";
          await weixinSendTextMessage({
            credentials: this.credentials,
            toUserId: peerUserId,
            contextToken: ctx,
            text: fallbackText,
          });
        }
      }
    }

    // Send files
    if (fileMessages.length > 0) {
      // If no images and has text, send text first
      if (imageMessages.length === 0 && combinedText) {
        await weixinSendTextMessage({
          credentials: this.credentials,
          toUserId: peerUserId,
          contextToken: ctx,
          text: combinedText,
        });
      }
      for (const file of fileMessages) {
        try {
          const buf = await fileToBuffer(file);
          await weixinSendFileMessage({
            credentials: this.credentials,
            toUserId: peerUserId,
            contextToken: ctx,
            fileBuffer: buf,
            fileName: file.name,
            cdnBaseUrl: CDN_BASE_URL,
          });
        } catch (err) {
          console.error(
            `[WeixinAdapter] File send failed ${file.name}, falling back to text notification`,
            err,
          );
          await weixinSendTextMessage({
            credentials: this.credentials,
            toUserId: peerUserId,
            contextToken: ctx,
            text: `[File ${file.name} failed to send, please retry]`,
          });
        }
      }
    }

    if (
      imageMessages.length === 0 &&
      fileMessages.length === 0 &&
      !combinedText
    ) {
      throw new Error(
        "[WeixinAdapter] No content to send, cannot call sendmessage",
      );
    }
  }

  async sendMessages(
    target: MessageTarget,
    id: string,
    messages: Messages,
  ): Promise<void> {
    throw new Error(
      "[WeixinAdapter] Please use sendMessagesWithContext(peerUserId, messages, contextToken)",
    );
  }

  async replyMessages(
    event: MessageEvent,
    messages: Messages,
    _quoteOrigin = false,
  ): Promise<void> {
    const raw = event.sourcePlatformObject as
      | {
          to_user_id?: string;
          context_token?: string;
        }
      | undefined;
    const peerId = raw?.to_user_id ?? (event.sender as { id?: string })?.id;
    const ctx = raw?.context_token;
    if (!peerId || !ctx) {
      throw new Error(
        "[WeixinAdapter] replyMessages missing to_user_id or context_token",
      );
    }
    await this.sendMessagesWithContext(peerId, messages, ctx);
  }

  async kill(): Promise<void> {
    // No long connection
  }
}
