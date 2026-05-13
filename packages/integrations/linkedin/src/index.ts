import { AppError } from "@openloomi/shared/errors";
import type { ExtractedMessageInfo } from "@openloomi/shared";
import type { Platform } from "@openloomi/integrations/channels/sources/types";

export type LinkedInCredentials = {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: number | null;
};

type LinkedInAdapterOptions = {
  botId: string;
  credentials: LinkedInCredentials;
  clientId: string;
  clientSecret: string;
};

type LinkedInConversation = {
  entityUrn?: string;
  participants?: Array<{ name?: string; email?: string; urn?: string }>;
  subject?: string;
};

type LinkedInEvent = {
  createdAt?: number;
  eventContent?: {
    attributedBody?: { text?: string };
    body?: string;
    text?: string;
  };
  from?: { name?: string; email?: string; urn?: string };
};

export class LinkedInAdapter {
  private botId: string;
  private accessToken: string | null;
  private refreshToken: string | null;
  private expiresAt: number | null;
  private clientId: string;
  private clientSecret: string;

  constructor(options: LinkedInAdapterOptions) {
    this.botId = options.botId;
    this.accessToken = options.credentials.accessToken ?? null;
    this.refreshToken = options.credentials.refreshToken ?? null;
    this.expiresAt = options.credentials.expiresAt ?? null;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;

    if (!this.accessToken) {
      throw new AppError(
        "bad_request:bot",
        "LinkedIn access token is missing. Reconnect your account.",
      );
    }
  }

  private async ensureAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.expiresAt && this.expiresAt - now > 60_000) {
      return this.accessToken ?? "";
    }
    if (!this.refreshToken) {
      return this.accessToken ?? "";
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const response = await fetch(
      "https://www.linkedin.com/oauth/v2/accessToken",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
    );

    if (!response.ok) {
      console.error(
        `[Bot ${this.botId}] LinkedIn refresh failed ${response.status}`,
        await response.text(),
      );
      return this.accessToken ?? "";
    }

    const data = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (data.access_token) {
      this.accessToken = data.access_token;
      this.expiresAt = data.expires_in
        ? Date.now() + data.expires_in * 1000
        : null;
    }
    return this.accessToken ?? "";
  }

  private async fetchLinkedIn<T>(url: string): Promise<T | null> {
    const token = await this.ensureAccessToken();
    if (!token) {
      return null;
    }
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Restli-Protocol-Version": "2.0.0",
        "LinkedIn-Version": "202401",
      },
    });
    if (!response.ok) {
      console.error(
        `[Bot ${this.botId}] LinkedIn API ${url} failed ${response.status}`,
        await response.text(),
      );
      return null;
    }
    return (await response.json()) as T;
  }

  private buildSenderLabel(participant?: {
    name?: string;
    email?: string;
    urn?: string;
  }): string {
    if (!participant) return "LinkedIn User";
    if (participant.name?.trim()) return participant.name.trim();
    if (participant.email?.trim()) return participant.email.trim();
    if (participant.urn?.trim()) return participant.urn.trim();
    return "LinkedIn User";
  }

  async getMessagesByTime(
    since: number,
    platform: Platform = "linkedin",
  ): Promise<ExtractedMessageInfo[]> {
    const conversationsResponse = await this.fetchLinkedIn<{
      elements?: LinkedInConversation[];
    }>("https://api.linkedin.com/rest/conversations?q=recent&count=20");

    const conversations = conversationsResponse?.elements ?? [];
    const messages: ExtractedMessageInfo[] = [];

    for (const conversation of conversations) {
      const conversationId = conversation.entityUrn?.split(":").pop();
      if (!conversationId) continue;

      const eventsResponse = await this.fetchLinkedIn<{
        elements?: LinkedInEvent[];
      }>(
        `https://api.linkedin.com/rest/conversations/${conversationId}/events?count=50&sort=CREATED_DESC`,
      );
      const events = eventsResponse?.elements ?? [];
      const participants = conversation.participants ?? [];

      for (const event of events) {
        const createdMs = event.createdAt ?? 0;
        if (createdMs < since * 1000) {
          continue;
        }

        const senderLabel = this.buildSenderLabel(event.from);
        const chatName =
          conversation.subject ??
          participants.map((p) => this.buildSenderLabel(p)).join(", ") ??
          "LinkedIn Chat";
        const text =
          event.eventContent?.attributedBody?.text ||
          event.eventContent?.text ||
          event.eventContent?.body ||
          "";

        messages.push({
          chatType: "private",
          chatName,
          sender: senderLabel,
          text: text.trim(),
          timestamp: Math.floor(createdMs / 1000),
          attachments: [],
        });
      }
    }

    return messages;
  }
}
