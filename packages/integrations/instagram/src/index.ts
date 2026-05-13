import { AppError } from "@openloomi/shared/errors";
import type { ExtractedMessageInfo } from "@openloomi/integrations/channels/sources/types";
import type { Messages } from "@openloomi/integrations/channels";

type InstagramAdapterOptions = {
  botId: string;
  accessToken: string;
  igBusinessId: string;
  pageId: string;
  username?: string | null;
};

type InstagramMessage = {
  id?: string;
  text?: string | null;
  from?: { id?: string | null; username?: string | null };
  to?: { data?: { id?: string | null; username?: string | null }[] };
  created_time?: string;
};

type InstagramConversation = {
  id?: string;
  participants?: {
    data?: { id?: string | null; username?: string | null }[];
  };
  messages?: { data?: InstagramMessage[] };
};

export class InstagramAdapter {
  private accessToken: string;
  private igBusinessId: string;
  private pageId: string;
  private username?: string | null;
  private botId: string;

  constructor(options: InstagramAdapterOptions) {
    this.accessToken = options.accessToken;
    this.igBusinessId = options.igBusinessId;
    this.pageId = options.pageId;
    this.username = options.username ?? null;
    this.botId = options.botId;
  }

  private async fetchGraph<T>(path: string, params?: Record<string, string>) {
    const search = new URLSearchParams({
      access_token: this.accessToken,
      ...(params ?? {}),
    });
    const url = `https://graph.facebook.com/v20.0/${path}?${search.toString()}`;
    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text();
      console.error(`[Bot ${this.botId}] Instagram API error ${path}: ${text}`);
      throw new AppError(
        "bad_request:bot",
        `Instagram API failed (${response.status})`,
      );
    }
    return (await response.json()) as T;
  }

  async getMessagesByTime(since: number): Promise<ExtractedMessageInfo[]> {
    const conversationsResponse = await this.fetchGraph<{
      data?: InstagramConversation[];
    }>(`${this.igBusinessId}/conversations`, {
      fields:
        "id,participants{id,username},messages.limit(50){id,text,from,to,created_time}",
      limit: "20",
    });

    const conversations = conversationsResponse.data ?? [];
    const result: ExtractedMessageInfo[] = [];

    for (const convo of conversations) {
      const messages = convo.messages?.data ?? [];
      for (const message of messages) {
        const created = message.created_time
          ? new Date(message.created_time).getTime()
          : Date.now();
        if (created < since * 1000) continue;

        const sender =
          message.from?.username ??
          message.from?.id ??
          convo.participants?.data?.[0]?.username ??
          "Instagram User";
        const chatName =
          convo.participants?.data
            ?.map((p) => p.username ?? p.id)
            .filter(Boolean)
            .join(", ") ?? "Instagram DM";

        result.push({
          chatType: "private",
          chatName,
          sender,
          text: message.text ?? "",
          timestamp: Math.floor(created / 1000),
          attachments: [],
        });
      }
    }

    return result;
  }

  async sendMessages(
    _channel: "private",
    recipients: string[],
    messages: Messages,
  ): Promise<void> {
    if (recipients.length === 0) {
      throw new AppError("bad_request:bot", "No Instagram recipient provided.");
    }
    const textPart = messages.find(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    );
    if (!textPart) {
      throw new AppError(
        "bad_request:bot",
        "Instagram DM requires text content.",
      );
    }
    const recipientId = recipients[0];
    const body = new URLSearchParams({
      recipient: JSON.stringify({ id: recipientId }),
      message: textPart,
      messaging_type: "RESPONSE",
      access_token: this.accessToken,
    });

    const response = await fetch(
      `https://graph.facebook.com/v20.0/${this.pageId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
    );
    if (!response.ok) {
      const text = await response.text();
      console.error(`[Bot ${this.botId}] Instagram send DM failed: ${text}`);
      throw new AppError(
        "bad_request:bot",
        `Instagram send failed (${response.status})`,
      );
    }
  }

  async kill(): Promise<void> {
    // nothing to cleanup for HTTP-based adapter
  }
}
