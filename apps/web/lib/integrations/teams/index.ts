import { MessagePlatformAdapter } from "@openloomi/integrations/channels";
import type { Messages, Message } from "@openloomi/integrations/channels";
import type {
  MessageEvent,
  MessageTarget,
} from "@openloomi/integrations/channels";
import type { Attachment } from "@openloomi/shared";
import {
  coerceDate,
  delay,
  type DialogInfo,
  type ExtractedMessageInfo,
} from "@openloomi/integrations/channels/sources/types";
import { ingestAttachmentForUser } from "@/lib/integrations/utils/attachments";
import type { UserType } from "@/app/(auth)/auth";
import { updateIntegrationAccount } from "@/lib/db/queries";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const DEFAULT_SCOPES =
  process.env.TEAMS_OAUTH_SCOPE ??
  [
    "offline_access",
    "User.Read",
    "Chat.Read",
    "Chat.ReadWrite",
    "ChannelMessage.Read.All",
    "ChannelMessage.Send",
    "Team.ReadBasic.All",
  ].join(" ");
const DEFAULT_maxMessageChunkCount = 40;
const FIRST_LANDING_MESSAGE_CHUNK_COUNT = 10;

type GraphChat = {
  id: string;
  topic?: string | null;
  chatType?: string | null;
  lastUpdatedDateTime?: string | null;
};

type GraphTeam = {
  id: string;
  displayName?: string | null;
};

type GraphChannel = {
  id: string;
  displayName?: string | null;
  description?: string | null;
};

type GraphMessage = {
  id?: string;
  body?: {
    contentType?: string | null;
    content?: string | null;
  };
  from?: {
    user?: { displayName?: string | null; id?: string | null };
    application?: { displayName?: string | null };
    device?: { displayName?: string | null };
  };
  createdDateTime?: string | null;
  lastModifiedDateTime?: string | null;
  attachments?: GraphAttachment[];
};

type GraphAttachment = {
  id?: string;
  name?: string | null;
  contentType?: string | null;
  contentUrl?: string | null;
  size?: number | null;
};

export type TeamsCredentials = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: number | null;
  expiresIn?: number | null;
  scope?: string | null;
  tokenType?: string | null;
  tenantId?: string | null;
  userId?: string | null;
  userPrincipalName?: string | null;
  displayName?: string | null;
  mail?: string | null;
};

export type TeamsContactMeta = {
  platform: "teams";
  type: "chat" | "channel";
  teamId?: string;
  teamName?: string | null;
  channelId?: string;
  channelName?: string | null;
  chatType?: string | null;
};

type ChannelEntry = { team: GraphTeam; channel: GraphChannel };

export class TeamsAdapter extends MessagePlatformAdapter {
  private credentials: TeamsCredentials;
  private botId?: string;
  private platformAccountId?: string;
  private accountUserId?: string;
  private ownerUserId?: string;
  private ownerUserType?: UserType;
  private chatsCache: GraphChat[] = [];
  private channelsCache: ChannelEntry[] = [];

  constructor(opts: {
    credentials: TeamsCredentials;
    botId?: string;
    platformAccountId?: string | null;
    accountUserId?: string;
    ownerUserId?: string;
    ownerUserType?: UserType;
  }) {
    super();
    this.credentials = opts.credentials;
    this.botId = opts.botId ?? "";
    this.platformAccountId = opts.platformAccountId ?? undefined;
    this.accountUserId = opts.accountUserId;
    this.ownerUserId = opts.ownerUserId;
    this.ownerUserType = opts.ownerUserType;
    this.name = "Microsoft Teams";

    if (!this.credentials?.accessToken) {
      throw new Error("Teams access token is required to initialize adapter");
    }
  }

  async sendMessage(
    target: MessageTarget,
    id: string,
    message: string,
  ): Promise<void> {
    await this.sendMessages(target, id, [message]);
  }

  async sendMessages(
    target: MessageTarget,
    id: string,
    messages: Messages,
  ): Promise<void> {
    const text = messages
      .map((msg) => this.renderMessage(msg))
      .filter((msg) => msg.trim().length > 0)
      .join("\n")
      .trim();

    if (!text || !id) {
      return;
    }

    const htmlContent = this.plainTextToHtml(text);

    // Channel IDs are encoded as teamId:channelId
    if (id.includes(":")) {
      const [teamId, channelId] = id.split(":");
      if (teamId && channelId) {
        await this.postChannelMessage(teamId, channelId, htmlContent);
        return;
      }
    }

    const targetType =
      target === "private" || target === "group" ? target : "group";
    if (targetType === "private") {
      await this.postChatMessage(id, htmlContent);
    } else {
      await this.postChatMessage(id, htmlContent);
    }
  }

  async replyMessages(event: MessageEvent, messages: Messages): Promise<void> {
    // Teams doesn't expose the reply target structure in our generic event type;
    // fall back to a direct send when possible.
    const targetId =
      (event as any)?.target?.id ??
      (event as any)?.chatId ??
      (event as any)?.conversationId;
    if (!targetId) {
      return;
    }
    const targetType =
      (event as any)?.targetType === "private" ? "private" : "group";
    await this.sendMessages(targetType, targetId, messages);
  }

  async getDialogs(): Promise<DialogInfo[]> {
    const dialogs: DialogInfo[] = [];
    const chats = await this.listChats();
    for (const chat of chats) {
      dialogs.push({
        id: chat.id,
        name: deriveChatName(chat),
        type: chat.chatType === "oneOnOne" ? "private" : "group",
        metadata: {
          platform: "teams",
          type: "chat",
          chatType: chat.chatType ?? null,
        } satisfies TeamsContactMeta,
      });
    }

    const channels = await this.listChannels();
    for (const { team, channel } of channels) {
      dialogs.push({
        id: `${team.id}:${channel.id}`,
        name: buildChannelLabel(team, channel),
        type: "group",
        metadata: {
          platform: "teams",
          type: "channel",
          teamId: team.id,
          teamName: team.displayName ?? null,
          channelId: channel.id,
          channelName: channel.displayName ?? null,
        } satisfies TeamsContactMeta,
      });
    }

    return dialogs;
  }

  async getChatsByChunk(
    since: number,
    chunkSize?: number,
  ): Promise<{ messages: ExtractedMessageInfo[]; hasMore: boolean }> {
    // Use the passed chunkSize or default value
    const maxMessageChunkCount = chunkSize ?? DEFAULT_maxMessageChunkCount;

    const collected: ExtractedMessageInfo[] = [];
    const sinceIso = new Date(since * 1000).toISOString();

    const chats = this.chatsCache.length
      ? this.chatsCache
      : await this.listChats();
    for (const chat of chats) {
      const messages = await this.fetchChatMessages(chat, sinceIso);
      for (const message of messages) {
        const extracted = await this.mapChatMessage(chat, message);
        if (extracted) {
          collected.push(extracted);
          if (collected.length >= maxMessageChunkCount) {
            return { messages: collected, hasMore: true };
          }
        }
      }
    }

    const channels = this.channelsCache.length
      ? this.channelsCache
      : await this.listChannels();
    for (const entry of channels) {
      const messages = await this.fetchChannelMessages(entry, sinceIso);
      for (const message of messages) {
        const extracted = await this.mapChannelMessage(entry, message);
        if (extracted) {
          collected.push(extracted);
          if (collected.length >= maxMessageChunkCount) {
            return { messages: collected, hasMore: true };
          }
        }
      }
    }

    return { messages: collected, hasMore: false };
  }

  private async fetchChatMessages(
    chat: GraphChat,
    sinceIso: string,
  ): Promise<GraphMessage[]> {
    const url = `/chats/${chat.id}/messages?$top=50&$filter=lastModifiedDateTime ge ${encodeURIComponent(sinceIso)}`;
    try {
      const response = await this.graphFetch<{ value?: GraphMessage[] }>(url);
      return (response.value ?? []).filter((msg) =>
        this.isMessageAfter(msg, sinceIso),
      );
    } catch (error) {
      console.warn(
        `[Bot ${this.botId ?? ""}] [teams] Failed to fetch chat messages for ${chat.id}:`,
        error,
      );
      return [];
    }
  }

  private async fetchChannelMessages(
    entry: ChannelEntry,
    sinceIso: string,
  ): Promise<GraphMessage[]> {
    const url = `/teams/${entry.team.id}/channels/${entry.channel.id}/messages?$top=50&$filter=lastModifiedDateTime ge ${encodeURIComponent(sinceIso)}`;
    try {
      const response = await this.graphFetch<{ value?: GraphMessage[] }>(url);
      return (response.value ?? []).filter((msg) =>
        this.isMessageAfter(msg, sinceIso),
      );
    } catch (error) {
      console.warn(
        `[Bot ${this.botId ?? ""}] [teams] Failed to fetch channel messages for ${entry.team.id}:${entry.channel.id}:`,
        error,
      );
      return [];
    }
  }

  private async listChats(): Promise<GraphChat[]> {
    try {
      const response = await this.graphFetch<{ value?: GraphChat[] }>(
        "/me/chats?$top=50",
      );
      this.chatsCache = response.value ?? [];
    } catch (error) {
      console.warn("[teams] Failed to list chats:", error);
      this.chatsCache = [];
    }
    return this.chatsCache;
  }

  private async listChannels(): Promise<ChannelEntry[]> {
    const entries: ChannelEntry[] = [];
    try {
      const teams = await this.graphFetch<{ value?: GraphTeam[] }>(
        "/me/joinedTeams?$select=id,displayName&$top=20",
      );
      for (const team of teams.value ?? []) {
        await delay(200);
        try {
          const channels = await this.graphFetch<{ value?: GraphChannel[] }>(
            `/teams/${team.id}/channels?$select=id,displayName,description&$top=40`,
          );
          for (const channel of channels.value ?? []) {
            entries.push({ team, channel });
            if (entries.length >= 60) {
              break;
            }
          }
        } catch (channelError) {
          console.warn(
            `[teams] Failed to fetch channels for team ${team.id}:`,
            channelError,
          );
        }
        if (entries.length >= 60) {
          break;
        }
      }
    } catch (error) {
      console.warn("[teams] Failed to list teams/channels:", error);
    }
    this.channelsCache = entries;
    return entries;
  }

  private async mapChatMessage(
    chat: GraphChat,
    message: GraphMessage,
  ): Promise<ExtractedMessageInfo | null> {
    const timestamp = this.resolveTimestamp(message);
    const text = this.normalizeMessageBody(message.body?.content ?? "");
    const attachments = await this.extractAttachments(message.attachments);

    if (!text && attachments.length === 0) {
      return null;
    }

    return {
      chatType: chat.chatType === "oneOnOne" ? "private" : "group",
      chatName: deriveChatName(chat),
      sender: this.resolveSender(message),
      text,
      timestamp,
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  }

  private async mapChannelMessage(
    entry: ChannelEntry,
    message: GraphMessage,
  ): Promise<ExtractedMessageInfo | null> {
    const timestamp = this.resolveTimestamp(message);
    const text = this.normalizeMessageBody(message.body?.content ?? "");
    const attachments = await this.extractAttachments(message.attachments);

    if (!text && attachments.length === 0) {
      return null;
    }

    return {
      chatType: "group",
      chatName: buildChannelLabel(entry.team, entry.channel),
      sender: this.resolveSender(message),
      text,
      timestamp,
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  }

  private async extractAttachments(
    attachments: GraphAttachment[] | undefined,
  ): Promise<Attachment[]> {
    if (!attachments || attachments.length === 0) {
      return [];
    }
    if (!this.ownerUserId || !this.ownerUserType) {
      return [];
    }

    const collected: Attachment[] = [];
    for (const att of attachments) {
      if (!att?.contentUrl) continue;
      const name = att.name ?? att.id ?? "teams-attachment";
      const contentType = att.contentType ?? "application/octet-stream";
      try {
        const ingested = await ingestAttachmentForUser({
          ownerUserId: this.ownerUserId,
          ownerUserType: this.ownerUserType,
          source: "teams",
          originalFileName: name,
          mimeTypeHint: contentType,
          sizeHintBytes: att.size ?? undefined,
          logContext: "[teams]",
          downloadAttachment: async () => {
            const token = await this.ensureAccessToken();
            const response = await fetch(att.contentUrl as string, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!response.ok) {
              throw new Error(
                `Failed to download attachment ${att.id}: ${response.status}`,
              );
            }
            const buffer = Buffer.from(await response.arrayBuffer());
            return {
              data: buffer,
              contentType,
              sizeBytes: buffer.byteLength,
            };
          },
        });
        if (ingested) {
          collected.push(ingested);
        }
      } catch (error) {
        console.warn("[teams] Failed to ingest attachment", error);
      }
    }

    return collected;
  }

  private resolveSender(message: GraphMessage): string {
    return (
      message.from?.user?.displayName ??
      message.from?.application?.displayName ??
      message.from?.device?.displayName ??
      "Unknown"
    );
  }

  private resolveTimestamp(message: GraphMessage): number {
    const date = coerceDate(
      message.lastModifiedDateTime ??
        message.createdDateTime ??
        Date.now() / 1000,
    );
    return Math.floor(date.getTime() / 1000);
  }

  private normalizeMessageBody(content: string): string {
    const replaced = content
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .trim();
    return replaced;
  }

  private renderMessage(message: Message): string {
    if (typeof message === "string") return message;
    if (typeof (message as any)?.text === "string") {
      return (message as any).text as string;
    }
    if ("url" in (message as any) && typeof (message as any).url === "string") {
      return (message as any).url as string;
    }
    return JSON.stringify(message);
  }

  private plainTextToHtml(text: string): string {
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return escaped.replace(/\n/g, "<br/>");
  }

  private async postChatMessage(chatId: string, htmlContent: string) {
    await this.graphFetch(`/chats/${chatId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: {
          contentType: "html",
          content: htmlContent,
        },
      }),
    });
  }

  private async postChannelMessage(
    teamId: string,
    channelId: string,
    htmlContent: string,
  ) {
    await this.graphFetch(`/teams/${teamId}/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: {
          contentType: "html",
          content: htmlContent,
        },
      }),
    });
  }

  private async graphFetch<T>(
    path: string,
    init?: RequestInit,
    retry = false,
  ): Promise<T> {
    const token = await this.ensureAccessToken();
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(
      path.startsWith("http") ? path : `${GRAPH_BASE}${path}`,
      {
        ...init,
        headers,
        cache: "no-store",
      },
    );

    if (response.status === 401 && !retry && this.credentials.refreshToken) {
      await this.refreshAccessToken();
      return this.graphFetch<T>(path, init, true);
    }

    if (!response.ok) {
      throw new Error(
        `Graph request failed (${response.status}): ${await response
          .text()
          .catch(() => "unknown error")}`,
      );
    }

    if (response.status === 204) {
      return {} as T;
    }

    return (await response.json()) as T;
  }

  private async ensureAccessToken(): Promise<string> {
    const expiresAt = this.credentials.expiresAt;
    if (
      expiresAt &&
      expiresAt > 0 &&
      Date.now() > expiresAt - 60 * 1000 &&
      this.credentials.refreshToken
    ) {
      await this.refreshAccessToken();
    }
    if (!this.credentials.accessToken) {
      throw new Error("Missing Teams access token");
    }
    return this.credentials.accessToken;
  }

  private async refreshAccessToken() {
    if (!this.credentials.refreshToken) {
      throw new Error("Missing Teams refresh token");
    }
    const clientId = process.env.TEAMS_CLIENT_ID;
    const clientSecret = process.env.TEAMS_CLIENT_SECRET;
    const tenant = process.env.TEAMS_TENANT_ID || "common";

    if (!clientId || !clientSecret) {
      throw new Error("Teams OAuth is not configured");
    }

    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: this.credentials.refreshToken,
      scope: DEFAULT_SCOPES,
    });

    const response = await fetch(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "unknown error");
      throw new Error(
        `Failed to refresh Teams access token (${response.status}): ${text}`,
      );
    }

    const body = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
    };

    const expiresIn = body.expires_in ?? null;
    const expiresAt =
      expiresIn && Number.isFinite(expiresIn)
        ? Date.now() + Math.max(0, expiresIn - 60) * 1000
        : (this.credentials.expiresAt ?? null);

    const updated: TeamsCredentials = {
      ...this.credentials,
      accessToken: body.access_token ?? this.credentials.accessToken,
      refreshToken: body.refresh_token ?? this.credentials.refreshToken ?? null,
      expiresIn,
      expiresAt,
      scope: body.scope ?? this.credentials.scope ?? null,
      tokenType: body.token_type ?? this.credentials.tokenType ?? null,
    };

    await this.persistCredentials(updated);
  }

  private async persistCredentials(updated: TeamsCredentials) {
    this.credentials = updated;
    if (this.platformAccountId && this.accountUserId) {
      try {
        await updateIntegrationAccount({
          userId: this.accountUserId,
          platformAccountId: this.platformAccountId,
          credentials: updated,
        });
      } catch (error) {
        console.warn("[teams] Failed to persist refreshed credentials", error);
      }
    }
  }

  private isMessageAfter(msg: GraphMessage, sinceIso: string): boolean {
    const sinceTime = new Date(sinceIso).getTime();
    const ts = coerceDate(
      msg.lastModifiedDateTime ?? msg.createdDateTime ?? Date.now(),
    ).getTime();
    return ts >= sinceTime;
  }
}

function deriveChatName(chat: GraphChat): string {
  if (chat.topic && chat.topic.trim().length > 0) {
    return chat.topic;
  }
  if (chat.chatType) {
    return chat.chatType;
  }
  return chat.id;
}

function buildChannelLabel(team: GraphTeam, channel: GraphChannel): string {
  const teamName = team.displayName ?? "Team";
  const channelName = channel.displayName ?? "Channel";
  return `${teamName} #${channelName}`;
}
