/**
 * QQ bot platform adapter
 * Send messages via QQ Open Platform API using appId / appSecret
 * Needs to work with QQ WebSocket listener to receive messages
 * Reference: https://bot.q.qq.com/wiki/
 */
import { MessagePlatformAdapter } from "@alloomi/integrations/channels";
import type { Messages, Message, Image } from "@alloomi/integrations/channels";
import type {
  MessageEvent,
  MessageTarget,
} from "@alloomi/integrations/channels";
import type { Friend } from "@alloomi/integrations/channels";

const DEBUG = process.env.DEBUG_QQBOT === "true";
const QQ_TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const QQ_API_BASE = "https://api.sgroup.qq.com";
const TOKEN_EXPIRE_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 minutes early

export type QQBotCredentials = {
  appId: string;
  appSecret: string;
};

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

/** Convert Alloomi Messages to plain text (first version only supports text, images as placeholders) */
function messagesToQQText(messages: Messages): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (isPlainText(m)) {
      parts.push(m);
    } else if (isImageMessage(m)) {
      parts.push("[Image]");
    } else {
      parts.push("[Content]");
    }
  }
  return parts.join("\n").trim() || "";
}

export class QQBotAdapter extends MessagePlatformAdapter {
  name = "QQBot";
  private credentials: QQBotCredentials;
  private botId: string;
  private tokenCache: { token: string; expiresAtMs: number } | null = null;

  constructor(opts: { botId: string; appId: string; appSecret: string }) {
    super();
    this.botId = opts.botId ?? "";
    this.credentials = {
      appId: opts.appId,
      appSecret: opts.appSecret,
    };
  }

  /** Get QQ Open Platform access_token (with memory cache) */
  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (
      this.tokenCache &&
      this.tokenCache.expiresAtMs - now > TOKEN_EXPIRE_BUFFER_MS
    ) {
      return this.tokenCache.token;
    }

    const resp = await fetch(QQ_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appId: this.credentials.appId,
        clientSecret: this.credentials.appSecret,
      }),
    });

    const json = (await resp.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
      message?: string;
    } | null;

    if (!resp.ok || !json?.access_token) {
      const msg = json?.message ?? `HTTP ${resp.status}`;
      throw new Error(`[QQBotAdapter] Failed to get access_token: ${msg}`);
    }

    const expireSec =
      typeof json.expires_in === "number" ? json.expires_in : 7200;
    this.tokenCache = {
      token: json.access_token,
      expiresAtMs: now + expireSec * 1000,
    };
    return json.access_token;
  }

  private async qqApiRequest<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const token = await this.getAccessToken();
    const url = `${QQ_API_BASE}${path}`;
    const options: RequestInit = {
      method,
      headers: {
        Authorization: `QQBot ${token}`,
        "Content-Type": "application/json",
      },
    };
    if (body) options.body = JSON.stringify(body);

    const resp = await fetch(url, options);
    const data = (await resp.json().catch(() => null)) as T & {
      message?: string;
      code?: number;
    };

    if (!resp.ok) {
      const msg = data?.message ?? `HTTP ${resp.status}`;
      throw new Error(`[QQBotAdapter] ${method} ${path} failed: ${msg}`);
    }
    return data as T;
  }

  /**
   * Send message
   * When target === "private", id is openid (private chat)
   * When target === "group", id is group_openid (group chat)
   */
  async sendMessages(
    target: MessageTarget,
    id: string,
    messages: Messages,
  ): Promise<void> {
    const text = messagesToQQText(messages);
    if (!text) {
      if (DEBUG) console.log("[QQBotAdapter] No text content, skipping send");
      return;
    }

    if (target === "private") {
      await this.qqApiRequest("POST", `/v2/users/${id}/messages`, {
        content: text,
        msg_type: 0,
      });
      if (DEBUG) console.log(`[QQBotAdapter] Sent private chat openid=${id}`);
    } else {
      await this.qqApiRequest("POST", `/v2/groups/${id}/messages`, {
        content: text,
        msg_type: 0,
      });
      if (DEBUG)
        console.log(`[QQBotAdapter] Sent group chat group_openid=${id}`);
    }
  }

  async replyMessages(
    event: MessageEvent,
    messages: Messages,
    _quoteOrigin = false,
  ): Promise<void> {
    const raw = event.sourcePlatformObject;
    const targetId = (raw?.group_openid ??
      raw?.openid ??
      (event.sender as Friend)?.id) as string | undefined;
    const messageId = raw?.id ?? raw?.message_id;
    if (!targetId) {
      await this.sendMessages(
        event.targetType,
        (event.sender as Friend).id as string,
        messages,
      );
      return;
    }

    const text = messagesToQQText(messages);
    if (!text) return;

    const target: MessageTarget = raw?.group_openid ? "group" : "private";
    const body: Record<string, unknown> = {
      content: text,
      msg_type: 0,
    };
    if (messageId) body.msg_id = messageId;

    if (target === "private") {
      await this.qqApiRequest("POST", `/v2/users/${targetId}/messages`, body);
    } else {
      await this.qqApiRequest("POST", `/v2/groups/${targetId}/messages`, body);
    }
    if (DEBUG)
      console.log(`[QQBotAdapter] Replied target=${target} id=${targetId}`);
  }

  async kill(): Promise<void> {
    this.tokenCache = null;
  }
}

export { QQBotConversationStore } from "./conversation-store";
