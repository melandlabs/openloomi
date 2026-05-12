/**
 * DingTalk bot adapter (Stream receive messages + OpenAPI send messages)
 * Credentials are Open Platform Client ID (AppKey) and Client Secret, consistent with nanobot dingtalk channel
 */
import { MessagePlatformAdapter } from "@alloomi/integrations/channels";
import type {
  Messages,
  Message,
  Image,
  Voice,
  File as FileMsg,
} from "@alloomi/integrations/channels";
import type {
  GroupMessageEvent,
  MessageEvent,
  MessageTarget,
} from "@alloomi/integrations/channels";
import type {
  Friend,
  Group,
  GroupMember,
} from "@alloomi/integrations/channels";
import type { Permission } from "@alloomi/integrations/channels";
import type { ExtractedMessageInfo } from "@alloomi/integrations/channels/sources/types";

const DEBUG = process.env.DEBUG_DINGTALK === "true";

export type DingTalkCredentials = {
  clientId: string;
  clientSecret: string;
};

function isPlainText(m: Message): m is string {
  return typeof m === "string";
}

/**
 * Image object characteristics: has url, has contentType property (always set when constructed by send-reply), no name
 * Voice object characteristics: has url, no contentType, no name
 * File object characteristics: has name (required) and has url
 */
function isFileMessage(message: Message): message is FileMsg {
  return (
    typeof message === "object" &&
    message !== null &&
    "name" in message &&
    typeof (message as FileMsg).name === "string" &&
    (message as FileMsg).name.length > 0 &&
    "url" in message
  );
}

function isVoiceMessage(message: Message): message is Voice {
  return (
    typeof message === "object" &&
    message !== null &&
    "url" in message &&
    !("name" in message) &&
    !("contentType" in message)
  );
}

function isImageMessage(message: Message): message is Image {
  return (
    typeof message === "object" &&
    message !== null &&
    "url" in message &&
    !("name" in message)
  );
}

function messagesToMarkdown(messages: Messages): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (isPlainText(m)) {
      parts.push(m);
    } else if (isImageMessage(m)) {
      const imageTitle = m.id ? `Image(${m.id})` : "Image";
      parts.push(`[${imageTitle}](${m.url})`);
    } else if (isVoiceMessage(m)) {
      const voiceTitle = m.length ? `Voice(${m.length})` : "Voice";
      parts.push(`[${voiceTitle}](${m.url})`);
    } else if (isFileMessage(m)) {
      const fileTitle = m.name || "File";
      parts.push(`[${fileTitle}](${m.url})`);
    } else {
      parts.push("[Content]");
    }
  }
  return parts.join("\n").trim() || "";
}

async function fetchRemoteBuffer(
  url: string,
  timeoutMs: number,
): Promise<Buffer> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

async function mediaToBuffer(media: {
  url: string;
  path?: string;
  base64?: string;
}): Promise<Buffer> {
  if (media.base64) {
    const b64 = media.base64.includes(",")
      ? media.base64.split(",")[1]
      : media.base64;
    return Buffer.from(b64, "base64");
  }
  if (media.path?.trim()) {
    const { readFile } = await import("node:fs/promises");
    return readFile(media.path);
  }
  if (media.url.startsWith("file://") || media.url.startsWith("/")) {
    const { readFile } = await import("node:fs/promises");
    const filePath = media.url.startsWith("file://")
      ? new URL(media.url).pathname
      : media.url;
    return readFile(filePath);
  }
  return fetchRemoteBuffer(media.url, 60_000);
}

export class DingTalkAdapter extends MessagePlatformAdapter {
  name = "DingTalk";
  private credentials: DingTalkCredentials;
  private botId: string;
  private accessTokenCache: { token: string; expiresAtMs: number } | null =
    null;

  constructor(opts: { botId: string; clientId: string; clientSecret: string }) {
    super();
    this.botId = opts.botId ?? "";
    this.credentials = {
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
    };
  }

  /** Get new OpenAPI accessToken (consistent with nanobot _get_access_token) */
  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (
      this.accessTokenCache &&
      this.accessTokenCache.expiresAtMs - now > 60_000
    ) {
      return this.accessTokenCache.token;
    }

    const resp = await fetch(
      "https://api.dingtalk.com/v1.0/oauth2/accessToken",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appKey: this.credentials.clientId,
          appSecret: this.credentials.clientSecret,
        }),
      },
    );

    const json = (await resp.json().catch(() => null)) as {
      accessToken?: string;
      expireIn?: number;
      code?: string;
      message?: string;
    } | null;

    if (!resp.ok || !json?.accessToken) {
      const msg = json?.message ?? json?.code ?? `HTTP ${resp.status}`;
      throw new Error(`[DingTalkAdapter] Failed to get accessToken: ${msg}`);
    }

    const expireSec = typeof json.expireIn === "number" ? json.expireIn : 7200;
    this.accessTokenCache = {
      token: json.accessToken,
      expiresAtMs: now + expireSec * 1000 - 60_000,
    };
    return json.accessToken;
  }

  private async postRobotMessage(
    id: string,
    msgKey: string,
    msgParam: Record<string, unknown>,
  ): Promise<void> {
    const token = await this.getAccessToken();
    const headers = {
      "Content-Type": "application/json",
      "x-acs-dingtalk-access-token": token,
    };

    let url: string;
    let body: Record<string, unknown>;
    if (id.startsWith("group:")) {
      url = "https://api.dingtalk.com/v1.0/robot/groupMessages/send";
      body = {
        robotCode: this.credentials.clientId,
        openConversationId: id.slice("group:".length),
        msgKey,
        msgParam: JSON.stringify(msgParam),
      };
    } else {
      url = "https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend";
      body = {
        robotCode: this.credentials.clientId,
        userIds: [id],
        msgKey,
        msgParam: JSON.stringify(msgParam),
      };
    }

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const raw = await resp.text();
    console.log(
      `[DingTalkAdapter] postRobotMessage msgKey=${msgKey} target=${id} status=${resp.status}`,
    );
    let parsed: { errcode?: number } = {};
    try {
      parsed = JSON.parse(raw) as { errcode?: number };
    } catch {
      /* ignore */
    }
    if (!resp.ok) {
      throw new Error(
        `[DingTalkAdapter] Send failed HTTP ${resp.status} ${raw.slice(0, 300)}`,
      );
    }
    if (typeof parsed.errcode === "number" && parsed.errcode !== 0) {
      throw new Error(
        `[DingTalkAdapter] Send failed errcode=${parsed.errcode} ${raw.slice(0, 300)}`,
      );
    }
  }

  /**
   * Upload media file to DingTalk, return media_id
   * API endpoint: https://oapi.dingtalk.com/media/upload (old OAPI endpoint, not the new api.dingtalk.com)
   */
  private async uploadMedia(
    fileType: "image" | "voice" | "file",
    fileName: string,
    content: Buffer,
    mimeType = "application/octet-stream",
  ): Promise<string> {
    const token = await this.getAccessToken();
    const formData = new FormData();
    formData.append(
      "media",
      new Blob([new Uint8Array(content)], { type: mimeType }),
      fileName,
    );
    // Note: Must use oapi.dingtalk.com not api.dingtalk.com
    const uploadUrl = `https://oapi.dingtalk.com/media/upload?access_token=${encodeURIComponent(token)}&type=${encodeURIComponent(fileType)}`;
    const resp = await fetch(uploadUrl, { method: "POST", body: formData });
    const raw = await resp.text();
    console.log(
      `[DingTalkAdapter] uploadMedia type=${fileType} file=${fileName} status=${resp.status}`,
    );
    let parsed: { errcode?: number; media_id?: string; errmsg?: string } = {};
    try {
      parsed = JSON.parse(raw) as {
        errcode?: number;
        media_id?: string;
        errmsg?: string;
      };
    } catch {
      /* ignore */
    }
    if (!resp.ok) {
      throw new Error(
        `[DingTalkAdapter] Upload media failed HTTP ${resp.status} ${raw.slice(0, 300)}`,
      );
    }
    if (typeof parsed.errcode === "number" && parsed.errcode !== 0) {
      throw new Error(
        `[DingTalkAdapter] Upload media failed errcode=${parsed.errcode} errmsg=${parsed.errmsg} ${raw.slice(0, 300)}`,
      );
    }
    if (!parsed.media_id) {
      throw new Error(
        `[DingTalkAdapter] Upload media failed: missing media_id ${raw.slice(0, 300)}`,
      );
    }
    if (DEBUG)
      console.log(
        `[DingTalkAdapter] Upload ${fileType} successful media_id=${parsed.media_id}`,
      );
    return parsed.media_id;
  }

  /**
   * chatId: Private chat is the other party's userId (staffId/openId, etc. string); Group chat is group:{openConversationId}
   */
  async sendMessages(
    target: MessageTarget,
    id: string,
    messages: Messages,
  ): Promise<void> {
    const textParts: string[] = [];
    const imageParts: Image[] = [];
    const voiceParts: Voice[] = [];
    const fileParts: FileMsg[] = [];

    for (const m of messages) {
      if (isPlainText(m)) {
        if (m.trim()) textParts.push(m.trim());
      } else if (isFileMessage(m)) {
        // Check File before Image/Voice, because File has name which is the most precise distinction
        fileParts.push(m);
      } else if (isVoiceMessage(m)) {
        voiceParts.push(m);
      } else if (isImageMessage(m)) {
        imageParts.push(m);
      }
    }

    const text = textParts.join("\n").trim();
    if (text) {
      await this.postRobotMessage(id, "sampleMarkdown", {
        text,
        title: "Alloomi",
      });
    }

    const mediaErrors: string[] = [];

    for (const image of imageParts) {
      try {
        if (/^https?:\/\//i.test(image.url)) {
          // Prefer to try public URL; fallback to uploading media_id on failure
          try {
            await this.postRobotMessage(id, "sampleImageMsg", {
              photoURL: image.url,
            });
            continue;
          } catch (urlSendError) {
            if (DEBUG) {
              console.warn(
                "[DingTalkAdapter] Direct image URL send failed, fallback to upload media_id",
                urlSendError,
              );
            }
          }
        }
        // Local file / base64 → upload as image type, then send using media_id
        const imageName =
          image.id?.trim() ||
          `image-${Date.now()}.${image.contentType?.split("/")[1] ?? "png"}`;
        const imageBuffer = await mediaToBuffer({
          url: image.url,
          path: image.path,
          base64: image.base64,
        });
        const mimeType = image.contentType || "image/png";
        const mediaId = await this.uploadMedia(
          "image",
          imageName,
          imageBuffer,
          mimeType,
        );
        // photoURL field of sampleImageMsg can accept media_id (verified by nanobot in production)
        try {
          await this.postRobotMessage(id, "sampleImageMsg", {
            photoURL: mediaId,
          });
        } catch {
          // Fallback to file attachment
          if (DEBUG)
            console.log(
              "[DingTalkAdapter] sampleImageMsg failed, degrade to sampleFile",
            );
          await this.postRobotMessage(id, "sampleFile", {
            mediaId,
            fileName: imageName,
            fileType: imageName.split(".").pop() || "png",
          });
        }
      } catch (error) {
        console.error(
          "[DingTalkAdapter] Image send failed, degrade to text hint",
          error,
        );
        mediaErrors.push(
          `Image(${image.id ?? image.url}) send failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    for (const voice of voiceParts) {
      try {
        const ext = voice.url.split(".").pop()?.toLowerCase() || "mp3";
        const voiceName = voice.id?.trim() || `voice-${Date.now()}.${ext}`;
        const voiceBuffer = await mediaToBuffer({
          url: voice.url,
          path: voice.path,
          base64: voice.base64,
        });
        const mediaId = await this.uploadMedia(
          "voice",
          voiceName,
          voiceBuffer,
          "audio/amr",
        );
        // duration unit is seconds (integer)
        const durationSec = voice.length
          ? Math.max(1, Math.round(Number(voice.length)))
          : 1;
        await this.postRobotMessage(id, "sampleAudio", {
          mediaId,
          duration: durationSec,
        });
      } catch (error) {
        console.error(
          "[DingTalkAdapter] Voice send failed, degrade to text hint",
          error,
        );
        mediaErrors.push(
          `Voice(${voice.id ?? voice.url}) send failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    for (const file of fileParts) {
      try {
        const fileName = file.name || `file-${Date.now()}.bin`;
        const fileBuffer = await mediaToBuffer({ url: file.url });
        const mediaId = await this.uploadMedia("file", fileName, fileBuffer);
        await this.postRobotMessage(id, "sampleFile", {
          mediaId,
          fileName,
          fileType: fileName.split(".").pop() || "bin",
        });
      } catch (error) {
        console.error(
          "[DingTalkAdapter] File send failed, degrade to text hint",
          error,
        );
        mediaErrors.push(
          `File(${file.name}) send failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (
      !text &&
      imageParts.length === 0 &&
      voiceParts.length === 0 &&
      fileParts.length === 0
    ) {
      const fallback = messagesToMarkdown(messages);
      if (fallback) {
        await this.postRobotMessage(id, "sampleMarkdown", {
          text: fallback,
          title: "Alloomi",
        });
      }
    }
    if (mediaErrors.length > 0) {
      throw new Error(
        `[DingTalkAdapter] Media send failed: ${mediaErrors.join(" | ")}`,
      );
    }
    if (DEBUG) console.log(`[DingTalkAdapter] Sent to chatId=${id}`);
  }

  async replyMessages(
    event: MessageEvent,
    messages: Messages,
    _quoteOrigin = false,
  ): Promise<void> {
    if (event.targetType === "private") {
      await this.sendMessages("private", String(event.sender.id), messages);
      return;
    }
    const gm = event as GroupMessageEvent;
    const gid = String(gm.sender.group.id);
    const chatId = gid.startsWith("group:") ? gid : `group:${gid}`;
    await this.sendMessages("group", chatId, messages);
  }

  async getFriends(): Promise<Friend[]> {
    return [];
  }

  async getGroups(): Promise<Group[]> {
    return [];
  }

  async getGroupMembers(_groupId: string): Promise<GroupMember[]> {
    return [];
  }

  async getPermissions(): Promise<Permission[]> {
    return [];
  }

  async getMessages(
    _friend: Friend,
    _limit?: number,
    _beforeTimestamp?: number,
  ): Promise<ExtractedMessageInfo[]> {
    return [];
  }

  async getGroupMessages(
    _group: Group,
    _limit?: number,
    _beforeTimestamp?: number,
  ): Promise<ExtractedMessageInfo[]> {
    return [];
  }

  async kill(): Promise<void> {
    this.accessTokenCache = null;
  }
}

export { DingTalkConversationStore } from "./conversation-store";
