import { App, LogLevel } from "@slack/bolt";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { MessagePlatformAdapter } from "@openloomi/integrations/channels";
import type {
  Messages,
  At,
  Image,
  Message,
} from "@openloomi/integrations/channels";
import type { Attachment } from "@openloomi/shared";
import type { UserType } from "@/app/(auth)/auth";
import { ingestExternalAttachment } from "@/lib/files/external-ingest";
import {
  delay,
  timeBeforeHours,
  type ExtractedMessageInfo,
} from "@openloomi/shared";
import type {
  MessageEvent,
  MessageTarget,
} from "@openloomi/integrations/channels";

const DEBUG = process.env.DEBUG_SLACK === "true";

const DEFAULT_MAX_MESSAGE_CHUNK_COUNT = 40;
const FIRST_LANDING_MESSAGE_CHUNK_COUNT = 10;
const SLACK_MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024; // 100MB

type SlackBlock =
  | {
      type: "section";
      text: { type: "mrkdwn"; text: string };
    }
  | {
      type: "image";
      image_url: string;
      alt_text: string;
    };

export type SlackUserInfo = {
  name?: string | null;
  email?: string | null;
};

export class SlackAdapter extends MessagePlatformAdapter {
  private botUserId?: string;
  private botUserName?: string;
  private botId: string;
  private token: string;
  private ownerUserId?: string;
  private ownerUserType?: UserType;

  messages: Messages;
  app: App;
  private userCache = new Map<
    string,
    { name: string | undefined; nickname: string | undefined }
  >();

  private asyncIteratorState = {
    channels: [] as any[],
    currentDialogIndex: 0,
    currentMessageIndex: 0,
    offsetDate: 0,
    isInitialized: false,
  };

  // Rate limit retry configuration
  private readonly MAX_RETRIES = 3;
  private readonly BASE_RETRY_DELAY_MS = 1000;

  constructor(opts?: {
    botId?: string;
    token?: string;
    appToken?: string;
    signingSecret?: string;
    scopes?: string;
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
    socketMode?: boolean;
    ownerUserId?: string;
    ownerUserType?: UserType;
  }) {
    super();
    this.token =
      opts?.token ??
      process.env.SLACK_TOKEN ??
      process.env.SLACK_USER_TOKEN ??
      process.env.SLACK_BOT_TOKEN ??
      "";

    this.botId = opts?.botId ?? "";

    if (!this.token) {
      throw new Error(
        "Slack token (SLACK_TOKEN or SLACK_USER_TOKEN or SLACK_BOT_TOKEN) is required.",
      );
    }
    // Setup OAuth settings if client ID and secret are provided.
    if (opts?.clientId && opts?.clientSecret) {
      this.app = new App({
        token: this.token,
        signingSecret: opts?.signingSecret || process.env.SLACK_SIGNING_SECRET,
        appToken: opts?.appToken || process.env.SLACK_APP_TOKEN,
        socketMode: opts?.socketMode ?? false,
        logLevel: LogLevel.INFO,
        // OAuth settings
        clientId: opts.clientId,
        clientSecret: opts.clientSecret,
        redirectUri: opts.redirectUri || process.env.SLACK_REDIRECT_URI,
        scopes: opts.scopes || process.env.SLACK_SCOPES,
      });
    } else {
      this.app = new App({
        token: this.token,
        signingSecret: opts?.signingSecret || process.env.SLACK_SIGNING_SECRET,
        appToken: opts?.appToken || process.env.SLACK_APP_TOKEN,
        socketMode: opts?.socketMode ?? false,
        logLevel: LogLevel.INFO,
      });
    }

    this.messages = [];
    this.ownerUserId = opts?.ownerUserId;
    this.ownerUserType = opts?.ownerUserType;
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
    await this.dispatchMessages(id, messages);
  }

  async replyMessages(
    event: MessageEvent & { sourceMessageId?: string; target?: { id: string } },
    messages: Messages,
    quoteOrigin = false,
  ): Promise<void> {
    if (!event.target) {
      return;
    }

    await this.dispatchMessages(
      event.target.id,
      messages,
      event.sourceMessageId,
    );
  }

  async getChatsByChunk(
    since: number,
    types = "public_channel,private_channel,mpim,im",
    chunkSize?: number,
  ) {
    const extractedMessages: ExtractedMessageInfo[] = [];
    // Use passed chunkSize or default value
    const maxMessageChunkCount = chunkSize ?? DEFAULT_MAX_MESSAGE_CHUNK_COUNT;

    // 2. Initialize on first call: load channels + set state (avoid duplicate initialization)
    if (!this.asyncIteratorState.isInitialized) {
      // Load all valid channels (filter out invalid items without entity/ID)
      const channels = await this.getAllChannels(types);
      this.asyncIteratorState.channels = channels;
      // Reset traversal start point (first time starts from channel 0, message 0)
      this.asyncIteratorState.currentDialogIndex = 0;
      this.asyncIteratorState.currentMessageIndex = 0;
      // Mark as initialized (avoid reloading channels on next call)
      this.asyncIteratorState.isInitialized = true;
      this.asyncIteratorState.offsetDate = since;

      if (DEBUG)
        console.log(
          `[Bot ${this.botId}] [slack] Batch fetch initialization complete: ${this.asyncIteratorState.channels.length} valid channels, batch size: ${maxMessageChunkCount}`,
        );
      if (this.asyncIteratorState.channels.length === 0) {
        if (DEBUG)
          console.log(`[Bot ${this.botId}] No valid channels to process`);
        this.asyncIteratorState.isInitialized = false;
        this.asyncIteratorState.currentDialogIndex = 0;
        this.asyncIteratorState.currentMessageIndex = 0;
        return { messages: extractedMessages, hasMore: false };
      }
    }

    let { currentDialogIndex, currentMessageIndex } = this.asyncIteratorState;

    const targetDialogs = this.asyncIteratorState.channels;
    const MIN_MESSAGES_PER_CHANNEL = 5;

    for (
      let dialogIdx = currentDialogIndex;
      dialogIdx < targetDialogs.length;
      dialogIdx++
    ) {
      const dialog = targetDialogs[dialogIdx];
      try {
        // 4. Get all messages matching time conditions for current channel (no API offset, fetch all at once)
        const rawMessages = await this.getChannelChatsByTime(
          dialog.id,
          this.asyncIteratorState.offsetDate,
        );
        await delay(500);

        if (DEBUG)
          console.log(
            `[Bot ${this.botId}] [slack] Fetched ${rawMessages.length} messages in the dialog id ${dialog.id}`,
          );

        // 5. Start processing from current message index (avoid processing already extracted messages)
        const startMsgIdx = currentMessageIndex;
        let channelMessageCount = 0; // Track messages from this channel

        for (let msgIdx = startMsgIdx; msgIdx < rawMessages.length; msgIdx++) {
          const rawMsg = rawMessages[msgIdx];
          extractedMessages.push(rawMsg);
          channelMessageCount++;
          // 6. If current batch reaches 50 messages, stop immediately and save current position
          if (extractedMessages.length >= maxMessageChunkCount) {
            this.asyncIteratorState.currentDialogIndex = dialogIdx; // Continue from current channel next time
            this.asyncIteratorState.currentMessageIndex = msgIdx + 1; // Continue from next message next time
            if (DEBUG)
              console.log(
                `[Bot ${this.botId}] Batch full (${maxMessageChunkCount}), will continue from message ${msgIdx + 1} in channel ${dialog.id}`,
              );
            return {
              messages: extractedMessages,
              hasMore: true,
            };
          }
        }

        // If fewer than MIN_MESSAGES_PER_CHANNEL messages were fetched from this channel, try to fetch more historical messages
        // If 0 messages were fetched initially, no need to fetch more
        if (
          channelMessageCount < MIN_MESSAGES_PER_CHANNEL &&
          rawMessages.length > 0
        ) {
          const neededCount = MIN_MESSAGES_PER_CHANNEL - channelMessageCount;
          if (DEBUG)
            console.log(
              `[Bot ${this.botId}] [slack] Channel ${dialog.id} has only ${channelMessageCount} messages, fetching ${neededCount} more without time filter`,
            );

          try {
            // Fetch more messages without time filter using getChannelHistory
            const additionalMessages = await this.getChannelHistory(
              dialog.id,
              neededCount,
            );

            for (const msg of additionalMessages) {
              extractedMessages.push(msg);
              channelMessageCount++;
              if (extractedMessages.length >= maxMessageChunkCount) {
                this.asyncIteratorState.currentDialogIndex = dialogIdx;
                this.asyncIteratorState.currentMessageIndex =
                  rawMessages.length;
                if (DEBUG)
                  console.log(
                    `[Bot ${this.botId}] Batch full (${maxMessageChunkCount}), will continue from channel ${dialog.id}`,
                  );
                return {
                  messages: extractedMessages,
                  hasMore: true,
                };
              }
            }

            if (DEBUG)
              console.log(
                `[Bot ${this.botId}] [slack] Fetched ${additionalMessages.length} additional messages for channel ${dialog.id}, total: ${channelMessageCount}`,
              );
          } catch (error) {
            console.warn(
              `[Bot ${this.botId}] [slack] Failed to fetch additional messages for channel ${dialog.id}:`,
              error,
            );
          }
        }

        currentMessageIndex = 0;
        this.asyncIteratorState.currentMessageIndex = 0; // Next channel starts from message 0
        this.asyncIteratorState.currentDialogIndex = dialogIdx + 1; // Next time starts from next channel
      } catch (error) {
        // Single channel processing failed: skip this channel to avoid affecting overall traversal
        console.error(
          `[Bot ${this.botId}] Failed to process channel ${dialog.id}:`,
          error,
        );
        this.asyncIteratorState.currentDialogIndex = dialogIdx + 1; // Skip current dialog next time
        this.asyncIteratorState.currentMessageIndex = 0;
      }
    }

    if (DEBUG)
      console.log(
        `[Bot ${this.botId}] All dialogs processed, returning remaining ${extractedMessages.length} messages`,
      );
    this.asyncIteratorState.isInitialized = false; // Mark as uninitialized, reload on next call
    this.asyncIteratorState.currentDialogIndex = 0;
    this.asyncIteratorState.currentMessageIndex = 0;

    return {
      messages: extractedMessages,
      hasMore: false,
    };
  }

  async getChatsByChunkHours(
    hours = 8,
    types = "public_channel,private_channel,mpim,im",
  ) {
    const since = timeBeforeHours(hours);
    return this.getChatsByChunk(since, types);
  }

  /**
   * Execute an API call with automatic rate limit retry
   * Handles Slack's rate_limited errors with exponential backoff
   */
  private async callWithRetry<T>(
    apiCall: () => Promise<T>,
    operationName: string,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        const result = await apiCall();

        // Check if result indicates rate limiting (Slack API response format)
        const response = result as {
          ok?: boolean;
          error?: string;
          retry_after?: number;
        };
        if (!response.ok && response.error === "rate_limited") {
          const retryAfter =
            response.retry_after ?? this.BASE_RETRY_DELAY_MS * 2 ** attempt;
          console.log(
            `[Bot ${this.botId}] [slack] Rate limited on ${operationName}, waiting ${retryAfter}s before retry (attempt ${attempt + 1}/${this.MAX_RETRIES})`,
          );
          await delay(retryAfter * 1000);
          lastError = new Error(`Rate limited: ${response.error}`);
          continue;
        }

        return result;
      } catch (error) {
        lastError = error as Error;

        // Check if it's a rate limit error from the SDK
        const errorMessage = `${error}`;
        if (
          errorMessage.includes("rate_limited") ||
          errorMessage.includes("rate_limit_exceeded")
        ) {
          const retryDelay = this.BASE_RETRY_DELAY_MS * 2 ** attempt;
          console.log(
            `[Bot ${this.botId}] [slack] Rate limited on ${operationName}, waiting ${retryDelay}ms before retry (attempt ${attempt + 1}/${this.MAX_RETRIES})`,
          );
          await delay(retryDelay);
          continue;
        }

        // For non-rate-limit errors, throw immediately
        throw error;
      }
    }

    throw (
      lastError ||
      new Error(`Failed after ${this.MAX_RETRIES} retries: ${operationName}`)
    );
  }

  /**
   * Fetch all message history from a channel
   * @param channelId - ID of the target channel
   * @param limit - Max messages per request (default: 20)
   * @returns Array of messages
   */
  async getChannelHistory(channelId: string, limit = 20) {
    try {
      const messages: ExtractedMessageInfo[] = [];
      let cursor: string | undefined;

      const channelInfo = await this.app.client.conversations.info({
        channel: channelId,
      });
      const channelName = channelInfo.channel?.name ?? channelId;
      const isPrivate =
        channelInfo.channel?.is_im || channelInfo.channel?.is_mpim;

      do {
        const response = await this.callWithRetry(
          () =>
            this.app.client.conversations.history({
              channel: channelId,
              limit,
              cursor,
            }),
          `conversations.history (${channelId})`,
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch history: ${response.error}`);
        }

        for (const message of response.messages || []) {
          if ("user" in message && message.user) {
            const userInfo = await this.getUserNameById(message.user);
            message.username =
              userInfo.name ||
              userInfo.nickname ||
              `anonymous user ${message.user}`;
          }

          const baseMessage: ExtractedMessageInfo = {
            chatType: isPrivate ? "private" : "group",
            chatName: channelName,
            sender: message.username ?? "",
            text: message.text ?? "",
            timestamp: message.ts ? Number.parseFloat(message.ts) : Date.now(),
          };

          const attachments = await this.extractSlackAttachments(message);

          messages.push(
            attachments.length > 0
              ? { ...baseMessage, attachments }
              : baseMessage,
          );
        }

        cursor = response.response_metadata?.next_cursor;
        if (messages.length >= limit) {
          break;
        }
      } while (cursor);
      return messages;
    } catch (error) {
      console.error(
        `[Bot ${this.botId}] [slack] Failed to fetch channel history for ${channelId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get a user's nickname/username by their Slack user ID
   * @param userId - Slack user ID (e.g., U096WQDCUJE)
   * @returns User's username (preferred) or nickname.
   */
  async getUserNameById(
    userId: string,
  ): Promise<{ name: string | undefined; nickname: string | undefined }> {
    const cachedUser = this.userCache.get(userId);
    if (cachedUser) {
      return cachedUser;
    }

    try {
      const response = await this.app.client.users.info({
        user: userId,
      });

      if (!response.ok || !response.user) {
        throw new Error(
          `Failed to fetch user info: ${response.error || "Unknown error"}`,
        );
      }

      const user = response.user;
      const userInfo = {
        name: user.name,
        nickname: user.profile?.real_name,
      };

      this.userCache.set(userId, userInfo);
      return userInfo;
    } catch (error) {
      console.error(`Failed to get name for user ${userId}:`, error);
      return { name: undefined, nickname: undefined };
    }
  }

  /**
   * Fetch all channels in the workspace (public, private, DMs, etc.)
   * @param types - Comma-separated channel types to fetch (default: all types)
   * @returns Array of channel objects with key details
   */
  async getAllChannels(types = "public_channel,private_channel,mpim,im") {
    try {
      const channels = [];
      let cursor: string | undefined;

      do {
        const response = await this.app.client.conversations.list({
          types,
          limit: 1000,
          cursor,
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch channels: ${response.error}`);
        }

        if (response.channels) {
          channels.push(...response.channels);
        }

        cursor = response.response_metadata?.next_cursor;
        if (DEBUG)
          console.log(
            `[Bot ${this.botId}] [slack] fetched ${channels.length} channels so far. More pages: ${!!cursor}`,
          );
      } while (cursor);
      return channels;
    } catch (error) {
      console.error("Failed to fetch channels:", error);
      throw error;
    }
  }

  /**
   * Fetch all channels history in the workspace (public, private, DMs, etc.)
   * @param types - Comma-separated channel types to fetch (default: all types)
   * @param filters - Set of channel names to include (if empty, include all channels)
   * @returns Array of channel history objects with key details and channel names.
   */
  async getAllChannelsHistory(
    filters: Set<string> = new Set(),
    types = "public_channel,private_channel,mpim,im",
  ) {
    // Get all channels including general channels and direct messages
    const channels = await this.getAllChannels(types);
    const messages: Array<{
      chatType: string;
      channel: string | undefined;
      content: ExtractedMessageInfo[];
    }> = [];

    for (const channel of channels) {
      // Skip channels without an ID (invalid channels)
      if (!channel.id) continue;

      // Filter logic:
      // - If filters is NOT empty: only include channels whose names are in the filters set
      // - If filters IS empty: include all channels
      const isFiltered =
        filters.size > 0
          ? !filters.has(channel.name || "") // Exclude if name not in filters
          : false; // No filter: don't exclude

      if (isFiltered) continue;

      const history = await this.getChannelHistory(channel.id);
      messages.push({
        chatType: channel.name ? "group" : "private",
        channel: channel.name,
        content: history,
      });
    }

    return { userIdMapping: this.userCache, messages: messages };
  }

  async getChatsByTime(
    cutoffDate: number,
    filters: Set<string> = new Set(),
    types = "public_channel,private_channel,mpim,im",
  ) {
    // Get all channels including general channels and direct messages
    const channels = await this.getAllChannels(types);
    const messages: Array<{
      chatType: string;
      channel: string | undefined;
      content: ExtractedMessageInfo[];
    }> = [];

    for (const channel of channels) {
      // Skip channels without an ID (invalid channels)
      if (!channel.id) continue;

      // Filter logic:
      // - If filters is NOT empty: only include channels whose names are in the filters set
      // - If filters IS empty: include all channels
      const isFiltered =
        filters.size > 0
          ? !filters.has(channel.name || "") // Exclude if name not in filters
          : false; // No filter: don't exclude

      if (isFiltered) continue;

      // Fetch history for the channel and add to results
      const history = await this.getChannelChatsByTime(channel.id, cutoffDate);
      messages.push({
        chatType: channel.name ? "group" : "private",
        channel: channel.name,
        content: history,
      });
    }

    return { userIdMapping: this.userCache, messages: messages };
  }

  async getChatsByDays(days = 1) {
    const cutoffDate = Math.floor(
      (Date.now() - days * 24 * 60 * 60 * 1000) / 1000,
    );
    return await this.getChatsByTime(cutoffDate);
  }

  async getChatsByHours(hours = 1) {
    const cutoffDate = Math.floor((Date.now() - hours * 60 * 60 * 1000) / 1000);
    return await this.getChatsByTime(cutoffDate);
  }

  async getChannelChatsByTime(channelId: string, cutoffDate: number) {
    try {
      const messages: ExtractedMessageInfo[] = [];
      let cursor: string | undefined;

      const channelInfo = await this.app.client.conversations.info({
        channel: channelId,
      });
      const channelName = channelInfo.channel?.name ?? channelId;
      const isPrivate =
        channelInfo.channel?.is_im || channelInfo.channel?.is_mpim;

      do {
        const response = await this.callWithRetry(
          () =>
            this.app.client.conversations.history({
              channel: channelId,
              oldest: cutoffDate.toString(),
              cursor,
            }),
          `conversations.history (${channelId})`,
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch history: ${response.error}`);
        }

        const receivedMessages = response.messages || [];

        if (DEBUG)
          console.log(
            `[Bot ${this.botId}] [slack] Fetched ${receivedMessages.length} messages in the channel id ${channelId}`,
          );

        for (const message of receivedMessages) {
          if (message.user) {
            const userInfo = await this.getUserNameById(message.user);
            message.username = userInfo.name || userInfo.nickname || "Unknown";
          }

          const baseMessage: ExtractedMessageInfo = {
            chatType: isPrivate ? "private" : "group",
            chatName: channelName,
            text: message.text ?? "",
            sender: message.username ?? "",
            timestamp: message.ts ? Number.parseFloat(message.ts) : Date.now(),
          };

          const attachments = await this.extractSlackAttachments(message);

          messages.push(
            attachments.length > 0
              ? { ...baseMessage, attachments }
              : baseMessage,
          );
        }

        cursor = response.response_metadata?.next_cursor;
      } while (cursor);
      return messages;
    } catch (error) {
      console.error(
        `[Bot ${this.botId}] [slack] Failed to fetch channel history for ${channelId}:`,
        error,
      );
      throw error;
    }
  }

  async kill(): Promise<boolean> {
    await this.app.stop();
    return true;
  }

  private partitionMessages(messages: Messages): {
    textParts: string[];
    images: Image[];
  } {
    const textParts: string[] = [];
    const images: Image[] = [];

    for (const message of messages) {
      if (this.isImageMessage(message)) {
        images.push(message);
        continue;
      }

      const text = slackMessageToSlackText(message);
      if (text.trim().length > 0) {
        textParts.push(text);
      }
    }

    return { textParts, images };
  }

  private isImageMessage(message: Message): message is Image {
    return (
      typeof message === "object" &&
      message !== null &&
      "url" in message &&
      typeof (message as Image).url === "string" &&
      (message as Image).url.length > 0
    );
  }

  private async extractSlackAttachments(message: any): Promise<Attachment[]> {
    if (!this.ownerUserId || !this.ownerUserType) {
      return [];
    }
    if (!Array.isArray(message.files) || message.files.length === 0) {
      return [];
    }

    const attachments: Attachment[] = [];

    for (const file of message.files) {
      const downloadUrl = file.url_private_download ?? file.url_private ?? null;
      if (!downloadUrl) {
        continue;
      }

      const declaredSize =
        typeof file.size === "number" ? file.size : undefined;

      try {
        const ingestResult = await ingestExternalAttachment({
          source: "slack",
          userId: this.ownerUserId,
          maxSizeBytes: SLACK_MAX_ATTACHMENT_BYTES,
          sizeHintBytes: declaredSize ?? null,
          mimeTypeHint: file.mimetype ?? null,
          originalFileName: file.name ?? file.title ?? file.id ?? null,
          downloadAttachment: async () => {
            const response = await fetch(downloadUrl, {
              headers: {
                Authorization: `Bearer ${this.token}`,
              },
            });

            if (!response.ok) {
              throw new Error(
                `Slack attachment download failed (${response.status} ${response.statusText})`,
              );
            }

            const arrayBuffer = await response.arrayBuffer();
            const contentType =
              response.headers.get("content-type") ??
              file.mimetype ??
              undefined;
            const sizeHeader = response.headers.get("content-length");

            return {
              data: arrayBuffer,
              contentType,
              sizeBytes: sizeHeader
                ? Number.parseInt(sizeHeader, 10)
                : (declaredSize ?? arrayBuffer.byteLength),
            };
          },
        });

        if (!ingestResult.success) {
          console.warn(
            `[slack] Skip attachment ${file.id} due to ${ingestResult.reason}`,
          );
          continue;
        }

        attachments.push({
          name: ingestResult.attachment.fileName,
          url: ingestResult.attachment.url,
          downloadUrl: ingestResult.attachment.downloadUrl,
          contentType: ingestResult.attachment.contentType,
          sizeBytes: ingestResult.attachment.sizeBytes,
          blobPath: ingestResult.attachment.blobPath,
          source: "slack",
        });
      } catch (error) {
        console.error(`[slack] Failed to ingest attachment ${file.id}`, error);
      }
    }

    return attachments;
  }

  private async dispatchMessages(
    channel: string,
    messages: Messages,
    threadTs?: string,
  ): Promise<void> {
    const { textParts, images } = this.partitionMessages(messages);
    const text = textParts.join("\n").trim();

    const remoteImages = images.filter(
      (image) => image.url && !image.base64 && !image.path,
    );
    const uploadImages = images.filter((image) => image.base64 || image.path);

    let baseThreadTs = threadTs;
    let postedMessage = false;

    const blocks: SlackBlock[] = [];

    if (text) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text,
        },
      });
    }

    remoteImages.forEach((image, index) => {
      blocks.push({
        type: "image",
        image_url: image.url,
        alt_text: this.inferAltText(image, index),
      });
    });

    if (blocks.length > 0) {
      const response = await this.app.client.chat.postMessage({
        channel,
        text: text || "Image attachment",
        blocks,
        thread_ts: threadTs,
      });

      postedMessage = true;
      if (!baseThreadTs && response.ts) {
        baseThreadTs = response.ts;
      }
    }

    const shouldUseInitialComment = !postedMessage;
    let usedInitialComment = false;

    for (const [index, image] of uploadImages.entries()) {
      const initialComment =
        shouldUseInitialComment && !usedInitialComment
          ? text || "Image attachment"
          : undefined;

      if (initialComment) {
        usedInitialComment = true;
      }

      await this.uploadImageFile(channel, image, baseThreadTs, initialComment);
    }

    if (
      !postedMessage &&
      !usedInitialComment &&
      text &&
      uploadImages.length === 0
    ) {
      // No images were sent but we still have text to deliver
      await this.app.client.chat.postMessage({
        channel,
        text,
        thread_ts: threadTs,
      });
    }
  }

  private inferAltText(image: Image, index: number): string {
    if (image.id && image.id.trim().length > 0) {
      return image.id;
    }
    if (image.contentType) {
      return image.contentType;
    }
    if (image.url) {
      try {
        const url = new URL(image.url);
        const pathname = url.pathname.split("/").pop();
        if (pathname && pathname.trim().length > 0) {
          return pathname;
        }
      } catch (error) {
        console.warn(
          `[Bot ${this.botId}] [slack] Failed to derive alt text from URL`,
          error,
        );
      }
    }
    return `image-${index + 1}`;
  }

  private inferFileName(image: Image, index: number): string {
    if (image.id && image.id.trim().length > 0) {
      const inferredExtension = this.mimeToExtension(image.contentType);
      if (image.id.includes(".")) {
        return image.id;
      }
      return `${image.id}.${inferredExtension}`;
    }

    if (image.path) {
      return basename(image.path);
    }

    if (image.url) {
      try {
        const url = new URL(image.url);
        const filename = url.pathname.split("/").pop();
        if (filename && filename.trim().length > 0) {
          return filename;
        }
      } catch (error) {
        console.warn(
          `[Bot ${this.botId}] [slack] Failed to parse filename from URL`,
          error,
        );
      }
    }

    const extension = this.mimeToExtension(image.contentType);
    return `image-${Date.now()}-${index}.${extension}`;
  }

  private mimeToExtension(contentType?: string): string {
    if (!contentType) return "jpg";
    const slashIndex = contentType.indexOf("/");
    if (slashIndex === -1) return contentType;
    return contentType.slice(slashIndex + 1) || "jpg";
  }

  private async uploadImageFile(
    channel: string,
    image: Image,
    threadTs?: string,
    initialComment?: string,
  ): Promise<void> {
    const filename = this.inferFileName(image, 0);

    const payload: Record<string, unknown> = {
      channels: channel,
      filename,
    };

    if (threadTs) {
      payload.thread_ts = threadTs;
    }

    if (initialComment) {
      payload.initial_comment = initialComment;
    }

    if (image.base64) {
      const base64Content = image.base64.includes(",")
        ? (image.base64.split(",").pop() ?? image.base64)
        : image.base64;
      payload.file = Buffer.from(base64Content, "base64");
    } else if (image.path) {
      payload.file = createReadStream(image.path);
    } else if (image.url) {
      // Use remote image directly via chat blocks; uploads are not required here
      return;
    } else {
      throw new Error("Unable to resolve Slack attachment payload");
    }

    if (image.contentType) {
      payload.filetype = this.mimeToExtension(image.contentType);
    }

    const response = await this.app.client.files.upload(payload as any);
    if (!response.ok) {
      throw new Error(
        `Slack file upload failed: ${response.error || "Unknown Error"}`,
      );
    }
  }
}

export function slackMessageToopenloomiMessage(
  message: any,
  bot_self?: string,
): Messages {
  const messages: Messages = [];

  if (message.text) {
    messages.push(
      ...parseSlackMessageText(message.text, bot_self, message.user),
    );
  }

  if (message.files && message.files.length > 0) {
    for (const file of message.files) {
      if (file.mimetype?.startsWith("image/")) {
        messages.push({
          id: file.id,
          size: file.size,
          url: file.url_private,
        } as Image);
      }

      if (file.initial_comment?.comment) {
        messages.push(
          ...parseSlackMessageText(
            file.initial_comment.comment,
            bot_self,
            message.user,
          ),
        );
      }
    }
  }

  return messages;
}

export function slackMessageToSlackText(message: Message): string {
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
      .map((node: any) => slackMessageToSlackText(node))
      .join("");
  }
  return "";
}

export function parseSlackMessageText(
  text: string,
  bot_self?: string,
  senderId?: string,
): Messages {
  const messages: Messages = [];
  let textAfterDeal = text;

  const mentionRegex = /<@([A-Z0-9]+)>/g;
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
