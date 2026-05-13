import {
  ChannelType,
  Client,
  GatewayIntentBits,
  type BaseGuildTextChannel,
  type ClientUser,
  type DMChannel,
  type Guild,
  type GuildBasedChannel,
  type Message as DiscordMessage,
} from "discord.js";
import { once } from "node:events";
import { MessagePlatformAdapter } from "@openloomi/integrations/channels";
import type {
  Messages,
  At,
  Image,
  Message,
} from "@openloomi/integrations/channels";
import type { Attachment } from "@openloomi/shared";
import type { UserType } from "@/app/(auth)/auth";
import { ingestAttachmentForUser } from "@/lib/integrations/utils/attachments";
import {
  timeBeforeHoursMs,
  type ExtractedMessageInfo,
} from "@openloomi/integrations/channels/sources/types";
import type {
  MessageEvent,
  MessageTarget,
} from "@openloomi/integrations/channels";

const DEBUG = process.env.DEBUG_DISCORD === "true";

const DEFAULT_MAX_MESSAGE_CHUNK_COUNT = 40;
const FIRST_LANDING_MESSAGE_CHUNK_COUNT = 10;
const DISCORD_MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

type DiscordDialog = {
  id: string;
  name: string;
  type: "group" | "private";
};

function buildSummaryText(message: DiscordMessage): string {
  const textParts: string[] = [];
  if (message.content?.trim()) {
    textParts.push(message.content.trim());
  }

  const attachments = Array.from(message.attachments.values()).map(
    (attachment) =>
      attachment.contentType?.startsWith("image/")
        ? `[Image] ${attachment.url}`
        : `[Attachment] ${attachment.name ?? attachment.id}: ${attachment.url}`,
  );
  if (attachments.length > 0) {
    textParts.push(attachments.join("\n"));
  }

  const embedTexts = message.embeds
    .map((embed) => {
      const pieces = [embed.title, embed.description, embed.url]
        .filter(Boolean)
        .map((piece) => String(piece).trim());
      return pieces.length > 0 ? pieces.join(" — ") : null;
    })
    .filter((value): value is string => Boolean(value));
  if (embedTexts.length > 0) {
    textParts.push(embedTexts.join("\n"));
  }

  return textParts.join("\n").trim();
}

export class DiscordAdapter extends MessagePlatformAdapter {
  private client: Client;
  private token: string;
  private botUser?: ClientUser | null;
  private guildId?: string;
  private botId?: string;
  private readyPromise: Promise<void> | null = null;
  private dialogsCache: DiscordDialog[] = [];
  messages: Messages = [];
  private ownerUserId?: string;
  private ownerUserType?: UserType;

  constructor(opts?: {
    token?: string;
    guildId?: string;
    botId?: string;
    ownerUserId?: string;
    ownerUserType?: UserType;
  }) {
    super();
    this.token = opts?.token ?? process.env.DISCORD_BOT_TOKEN ?? "";
    this.guildId = opts?.guildId ?? process.env.DISCORD_GUILD_ID ?? undefined;
    this.botId = opts?.botId;
    this.ownerUserId = opts?.ownerUserId;
    this.ownerUserType = opts?.ownerUserType;

    if (!this.token) {
      throw new Error(
        "Discord bot token is required. Provide it in options or set DISCORD_BOT_TOKEN environment variable.",
      );
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
      ],
    });
  }

  private async ensureReady(): Promise<void> {
    if (this.client.isReady()) {
      return;
    }

    if (!this.readyPromise) {
      this.readyPromise = this.client
        .login(this.token)
        .then(async () => {
          if (!this.client.isReady()) {
            await once(this.client, "ready");
          }
          this.botUser = this.client.user;
          this.name = this.botUser?.username ?? "";
          if (DEBUG)
            console.log(
              `[Bot ${this.botId ? ` ${this.botId}` : ""}][discord] logged in as ${this.botUser?.tag}`,
            );
        })
        .catch((error) => {
          this.readyPromise = null;
          throw error;
        });
    }

    await this.readyPromise;
  }

  private async getTargetGuild(): Promise<Guild | null> {
    await this.ensureReady();
    if (this.guildId) {
      try {
        return await this.client.guilds.fetch(this.guildId);
      } catch (error) {
        console.warn(
          `[discord${this.botId ? ` ${this.botId}` : ""}] Failed to fetch guild ${this.guildId}:`,
          error,
        );
      }
    }

    const guilds = await this.client.guilds.fetch();
    const firstGuild = guilds.first();
    if (!firstGuild) {
      return null;
    }
    return await this.client.guilds.fetch(firstGuild.id);
  }

  private async getGuildChannels(
    guild: Guild,
  ): Promise<BaseGuildTextChannel[]> {
    const channels = await guild.channels.fetch();
    const textChannels: BaseGuildTextChannel[] = [];
    channels.forEach((channel: GuildBasedChannel | null) => {
      if (
        channel &&
        (channel.type === ChannelType.GuildText ||
          channel.type === ChannelType.GuildAnnouncement)
      ) {
        textChannels.push(channel as BaseGuildTextChannel);
      }
    });
    return textChannels;
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
    await this.ensureReady();

    const text = messages
      .map((msg) => discordMessageToDiscordText(msg))
      .filter((msg) => msg.trim().length > 0)
      .join("\n");

    if (!text) {
      return;
    }

    if (target === "private") {
      const user = await this.client.users.fetch(id);
      const dmChannel = await user.createDM();
      await dmChannel.send(text);
    } else {
      const channel = await this.client.channels.fetch(id);
      if (
        !channel ||
        (channel.type !== ChannelType.GuildText &&
          channel.type !== ChannelType.GuildAnnouncement)
      ) {
        throw new Error(
          `[Bot ${this.botId ? ` ${this.botId}` : ""}] [discord] Cannot send message to channel ${id}`,
        );
      }
      if (this.guildId && channel.guildId !== this.guildId) {
        throw new Error(
          `[Bot ${this.botId ? ` ${this.botId}` : ""}] [discord] Channel ${id} not in guild ${this.guildId}`,
        );
      }
      await (channel as BaseGuildTextChannel).send(text);
    }
  }

  async replyMessages(
    event: MessageEvent & { sourceMessageId?: string; target?: { id: string } },
    messages: Messages,
    quoteOrigin = true,
  ): Promise<void> {
    await this.ensureReady();

    if (!event.sourceMessageId || !event.target) {
      await this.sendMessages("group", event.target?.id || "", messages);
      return;
    }

    const text = messages
      .map((msg) => discordMessageToDiscordText(msg))
      .filter((msg) => msg.trim().length > 0)
      .join("\n");

    if (!text) {
      return;
    }

    const channel = await this.client.channels.fetch(event.target.id);

    if (!channel) {
      return;
    }

    if (channel.type === ChannelType.DM) {
      await (channel as DMChannel).send(text);
      return;
    }

    if (
      channel.type === ChannelType.GuildText ||
      channel.type === ChannelType.GuildAnnouncement
    ) {
      const options: Record<string, unknown> = { content: text };
      if (quoteOrigin) {
        options.messageReference = { messageId: event.sourceMessageId };
      }
      await (channel as BaseGuildTextChannel).send(options);
    }
  }

  async getDialogs(forceRefresh = false): Promise<DiscordDialog[]> {
    await this.ensureReady();
    if (this.dialogsCache.length > 0 && !forceRefresh) {
      return this.dialogsCache;
    }

    const guild = await this.getTargetGuild();
    if (!guild) {
      return [];
    }

    const channels = await this.getGuildChannels(guild);
    this.dialogsCache = channels.map((channel) => ({
      id: channel.id,
      name: `${guild.name} #${channel.name}`,
      type: "group",
    }));

    return this.dialogsCache;
  }

  async getChatsByChunk(
    since: number,
    chunkSize?: number,
  ): Promise<{ messages: ExtractedMessageInfo[]; hasMore: boolean }> {
    // Use the passed chunkSize or default value
    const maxMessageChunkCount = chunkSize ?? DEFAULT_MAX_MESSAGE_CHUNK_COUNT;

    await this.ensureReady();
    const guild = await this.getTargetGuild();
    if (!guild) {
      return { messages: [], hasMore: false };
    }

    const sinceMs = since * 1000;
    const sinceSnowflake = timestampToSnowflake(sinceMs);
    const channels = await this.getGuildChannels(guild);
    const extracted: ExtractedMessageInfo[] = [];
    const MIN_MESSAGES_PER_CHANNEL = 5;

    for (const channel of channels) {
      try {
        const fetched = await channel.messages.fetch({
          limit: 200,
          after: sinceSnowflake,
        });
        // Note the unit of createdTimestamp is `ms` instead of `s`
        const messages = Array.from(fetched.values());
        if (DEBUG)
          console.log(
            `[discord] fetch ${messages.length} messages since ${sinceMs} after snowflake ${sinceSnowflake}`,
          );

        let channelMessageCount = 0;

        for (const message of messages) {
          const summaryText = buildSummaryText(message);
          if (!summaryText) continue;

          const attachments = await this.extractDiscordAttachments(message);

          extracted.push({
            id: message.id, // Save Discord original message ID for deduplication
            chatType: "group",
            chatName: `${guild.name} #${channel.name}`,
            sender: message.author?.username ?? "Unknown",
            text: summaryText,
            timestamp: Math.round(message.createdTimestamp / 1000),
            attachments,
          });
          channelMessageCount++;

          if (extracted.length >= maxMessageChunkCount) {
            return { messages: extracted, hasMore: true };
          }
        }

        // If fewer messages were fetched from this channel than MIN_MESSAGES_PER_CHANNEL, try to fetch more historical messages
        // If 0 messages were fetched on first attempt, no need to fetch more
        if (
          channelMessageCount < MIN_MESSAGES_PER_CHANNEL &&
          messages.length > 0
        ) {
          const neededCount = MIN_MESSAGES_PER_CHANNEL - channelMessageCount;
          if (DEBUG)
            console.log(
              `[discord] Channel ${channel.id} has only ${channelMessageCount} messages, fetching ${neededCount} more without time filter`,
            );

          try {
            // Fetch more messages without time filter (using before instead of after)
            const additionalFetched = await channel.messages.fetch({
              limit: neededCount,
            });

            const additionalMessages = Array.from(additionalFetched.values());

            for (const message of additionalMessages) {
              const summaryText = buildSummaryText(message);
              if (!summaryText) continue;

              const attachments = await this.extractDiscordAttachments(message);

              extracted.push({
                id: message.id, // Save Discord original message ID for deduplication
                chatType: "group",
                chatName: `${guild.name} #${channel.name}`,
                sender: message.author?.username ?? "Unknown",
                text: summaryText,
                timestamp: Math.round(message.createdTimestamp / 1000),
                attachments,
              });
              channelMessageCount++;

              if (extracted.length >= maxMessageChunkCount) {
                return { messages: extracted, hasMore: true };
              }
            }

            if (DEBUG)
              console.log(
                `[discord] Fetched ${additionalMessages.length} additional messages for channel ${channel.id}, total: ${channelMessageCount}`,
              );
          } catch (error) {
            console.warn(
              `[discord] Failed to fetch additional messages for channel ${channel.id}:`,
              error,
            );
          }
        }
      } catch (error) {
        console.warn(
          `[Bot ${this.botId ? ` ${this.botId}` : ""}] [discord] Failed to fetch messages for channel ${channel.id}:`,
          error,
        );
      }
    }

    return { messages: extracted, hasMore: false };
  }

  async getChatsByChunkHours(
    hours = 8,
  ): Promise<{ messages: ExtractedMessageInfo[]; hasMore: boolean }> {
    return this.getChatsByChunk(timeBeforeHoursMs(hours));
  }

  private async extractDiscordAttachments(
    message: DiscordMessage,
  ): Promise<Attachment[]> {
    if (!this.ownerUserId || !this.ownerUserType) {
      return [];
    }

    if (!message.attachments.size) {
      return [];
    }

    const collected: Attachment[] = [];

    for (const attachment of message.attachments.values()) {
      if (!attachment.url) {
        continue;
      }

      const ingested = await ingestAttachmentForUser({
        source: "discord",
        ownerUserId: this.ownerUserId,
        ownerUserType: this.ownerUserType,
        maxSizeBytes: DISCORD_MAX_ATTACHMENT_BYTES,
        originalFileName: attachment.name ?? attachment.id,
        mimeTypeHint: attachment.contentType ?? null,
        sizeHintBytes:
          typeof attachment.size === "number" ? attachment.size : null,
        downloadAttachment: async () => {
          const response = await fetch(attachment.url);
          if (!response.ok) {
            throw new Error(
              `Discord attachment download failed (${response.status} ${response.statusText})`,
            );
          }
          const arrayBuffer = await response.arrayBuffer();
          const contentType =
            response.headers.get("content-type") ??
            attachment.contentType ??
            undefined;
          const sizeHeader = response.headers.get("content-length");

          return {
            data: arrayBuffer,
            contentType,
            sizeBytes: sizeHeader
              ? Number.parseInt(sizeHeader, 10)
              : arrayBuffer.byteLength,
          };
        },
        logContext: this.botId ? `[Bot ${this.botId}]` : "[discord]",
      });

      if (ingested) {
        collected.push(ingested);
      }
    }

    return collected;
  }

  async kill(): Promise<boolean> {
    this.dialogsCache = [];
    if (this.client.isReady()) {
      await this.client.destroy();
    }
    this.readyPromise = null;
    return true;
  }
}

export function discordMessageToopenloomiMessage(
  message: DiscordMessage,
  bot_self?: string,
): Messages {
  const messages: Messages = [];

  if (message.content) {
    messages.push(
      ...parseDiscordMessageText(message.content, bot_self, message.author.id),
    );
  }

  message.attachments.forEach((attachment) => {
    if (attachment.contentType?.startsWith("image/")) {
      messages.push({
        id: attachment.id,
        size: attachment.size,
        url: attachment.url,
      } as Image);
    }

    if (attachment.description) {
      messages.push(attachment.description);
    }
  });

  return messages;
}

export function discordMessageToDiscordText(message: Message): string {
  if (typeof message === "string") {
    return message;
  }
  if ("text" in message) {
    return message.text;
  }
  if ("target" in message) {
    return `<@${message.target}>`;
  }
  if ("nodes" in message) {
    return message.nodes
      .map((node: any) => discordMessageToDiscordText(node))
      .join("");
  }
  if ("url" in message) {
    return message.url;
  }
  return "";
}

export function parseDiscordMessageText(
  text: string,
  bot_self?: string,
  senderId?: string,
): Messages {
  const messages: Messages = [];
  let textAfterDeal = text;

  const mentionRegex = /<@!?(\d+)>/g;
  let match: RegExpExecArray | null = null;

  match = mentionRegex.exec(text);
  while (match !== null) {
    const userId = match[1];
    const mentionText = match[0];

    if (bot_self && userId === bot_self) {
      messages.push({ target: bot_self } as At);
      textAfterDeal = textAfterDeal.replace(mentionText, "").trim();
    } else {
      messages.push({ target: userId } as At);
      textAfterDeal = textAfterDeal.replace(mentionText, "").trim();
    }
    match = mentionRegex.exec(text);
  }

  if (textAfterDeal) {
    messages.push(textAfterDeal);
  }

  return messages;
}

export const DISCORD_EPOCH = 1420070400000; // Discord epoch timestamp (in milliseconds)

/**
 * Converts a timestamp to a Discord Snowflake ID (for use with API pagination parameters like after/before),
 * Reference: https://discord.com/developers/docs/reference#snowflakes
 * @param timestampMs Target timestamp in milliseconds (e.g., Date.now())
 * @returns Corresponding Snowflake string (first 42 bits are time offset, last 22 bits are 0)
 */
export function timestampToSnowflake(timestampMs: number): string {
  // Boundary handling: return the minimum Snowflake ("0") if timestamp is earlier than Discord epoch
  if (timestampMs < DISCORD_EPOCH) {
    console.warn(
      `[discord] Timestamp ${timestampMs} is earlier than Discord epoch (${DISCORD_EPOCH}), returning default Snowflake "0"`,
    );
    return "0";
  }

  // Core calculation: time offset << 22 (pad last 22 bits with 0)
  const timeOffset = BigInt(timestampMs) - BigInt(DISCORD_EPOCH);
  const snowflakeBigInt = timeOffset << 22n;

  // Convert to string (avoid JavaScript number overflow, compliant with Discord API requirements)
  return snowflakeBigInt.toString();
}
