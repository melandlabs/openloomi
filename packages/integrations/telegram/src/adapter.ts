/**
 * Telegram Adapter - Platform adapter for Telegram messaging
 *
 * This adapter handles sending/receiving messages through the Telegram Bot API
 * using the gramjs library.
 */

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Api } from "telegram/tl";
import { MessagePlatformAdapter } from "@alloomi/integrations/channels";
import type {
  Messages,
  At,
  Image,
  Message,
} from "@alloomi/integrations/channels";
import type { Attachment } from "@alloomi/shared";
import type {
  MessageEvent,
  MessageTarget,
} from "@alloomi/integrations/channels";
import type { Entity } from "telegram/define";
import bigInt, { type BigInteger } from "big-integer";
import { markdownToTelegramHtml } from "./markdown";
import type { TotalList } from "telegram/Helpers";
import type { Dialog } from "telegram/tl/custom/dialog";
import { CustomFile } from "telegram/client/uploads";
import {
  delay,
  isEmptyMessage,
  timeBeforeHours,
  type DialogInfo,
  type ExtractedMessageInfo,
} from "@alloomi/integrations/channels/sources/types";
import type { FileIngester, ClientRegistry } from "@alloomi/integrations/core";
import type {
  ContactMeta,
  TelegramContactMeta,
} from "@alloomi/integrations/contacts";
import { isTelegramContactMeta } from "@alloomi/integrations/contacts";

const DEBUG = process.env.DEBUG_TELEGRAM === "true";

const maxDialogCount = 50;
const maxMessageCount = 200;
const DEFAULT_MAX_MESSAGE_CHUNK_COUNT = 40;
const FIRST_LANDING_MESSAGE_CHUNK_COUNT = 10;
const TELEGRAM_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const dialogCacheFetchLimit = 200;

// Timeout constants for network operations (in ms)
export const CONNECT_TIMEOUT_MS = 60_000; // 60 seconds for initial connection
export const SEND_MESSAGE_TIMEOUT_MS = 30_000; // 30 seconds for sending a message

/**
 * Wraps a promise with a timeout. If the promise doesn't resolve within the timeout,
 * the promise is rejected with a timeout error.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  operationName: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${ms}ms`));
    }, ms);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// Cache interfaces
interface EntityCache {
  [id: string]: {
    entity: Entity;
    timestamp: number;
  };
}

export class TelegramAdapter extends MessagePlatformAdapter {
  client: TelegramClient;
  messages: Messages;
  botId: string;
  appId: number;
  appHash: string;
  session: StringSession;
  name = "";
  private ownerUserId?: string;
  private ownerUserType?: string;
  private fileIngester?: FileIngester;
  private clientRegistry?: ClientRegistry;

  // Caches with TTL (1 hour default)
  private senderCache: EntityCache = {};
  private chatCache: EntityCache = {};
  private dialogs: DialogInfo[] = [];
  private dialogEntityCache: EntityCache = {};
  private dialogsFetchedAt = 0;
  private contactMetadata: Record<string, TelegramContactMeta> = {};
  private cacheTTL = 3600000; // 1 hour in milliseconds

  private botToken?: string;
  private ownUserId?: BigInteger;

  // Flag indicating if using shared client from User Listener (should not disconnect when shared)
  private _isSharedClient = false;

  private asyncIteratorState = {
    dialogs: [] as TotalList<Dialog>,
    currentDialogIndex: 0,
    currentMessageIndex: 0,
    offsetDate: 0,
    isInitialized: false,
  };

  constructor(opts?: {
    botId?: string;
    botToken?: string;
    session?: string;
    appId?: number;
    appHash?: string;
    cacheTTL?: number;
    ownerUserId?: string;
    ownerUserType?: string;
    fileIngester?: FileIngester;
    clientRegistry?: ClientRegistry;
  }) {
    super();
    this.session = new StringSession(opts?.session ?? "");
    this.botId = opts?.botId ?? "";
    this.appId = opts?.appId ?? Number(process.env.TG_APP_ID ?? "0");
    this.appHash = opts?.appHash ?? process.env.TG_APP_HASH ?? "";

    // Prefer to reuse connected client from User Listener via ClientRegistry, avoid creating multiple MTProto connections for same session
    // Multiple connections cause session conflicts and disrupt User Listener's real-time event reception
    const sessionKey = opts?.session ?? "";
    const clientRegistry = opts?.clientRegistry;
    let sharedClient: TelegramClient | undefined;

    if (!opts?.botToken && sessionKey && clientRegistry) {
      sharedClient = clientRegistry.getClientBySessionKey(sessionKey) as
        | TelegramClient
        | undefined;
    }

    if (sharedClient) {
      this.client = sharedClient;
      this._isSharedClient = true;
      if (DEBUG)
        console.log(
          `[Bot ${opts?.botId}] [telegram] Reusing existing connection from User Listener to avoid session conflict`,
        );
    } else {
      this.client = new TelegramClient(this.session, this.appId, this.appHash, {
        connectionRetries: 10,
        timeout: 60,
        requestRetries: 5,
        floodSleepThreshold: 60,
      });
    }

    this.botToken = opts?.botToken;
    this.messages = [];
    this.ownerUserId = opts?.ownerUserId;
    this.ownerUserType = opts?.ownerUserType;
    this.fileIngester = opts?.fileIngester;
    this.clientRegistry = clientRegistry;

    // Allow custom cache TTL if provided
    if (opts?.cacheTTL) {
      this.cacheTTL = opts.cacheTTL;
    }
  }

  primeContactMetadata(contactId: string, metadata?: ContactMeta | null): void {
    if (!contactId || !metadata) {
      return;
    }

    if (isTelegramContactMeta(metadata)) {
      this.contactMetadata[contactId] = {
        ...metadata,
        peerId: metadata.peerId ?? contactId,
      };
    }
  }

  async connect() {
    try {
      // Shared client already maintained by User Listener, no need to reconnect
      if (this._isSharedClient) {
        if (!this.client.connected) {
          console.warn(
            `[Bot ${this.botId}] [telegram] Shared client disconnected, falling back to independent connection`,
          );
          this._isSharedClient = false;
          this.client = new TelegramClient(
            this.session,
            this.appId,
            this.appHash,
            {
              connectionRetries: 10,
              timeout: 60,
              requestRetries: 5,
              floodSleepThreshold: 60,
            },
          );
        } else {
          return;
        }
      }
      if (!this.client.connected) {
        if (this.botToken) {
          await this.client.start({
            botAuthToken: this.botToken,
          });
        } else {
          await this.client.start({
            phoneNumber: async () =>
              await this.prompt("Please enter your phone number: "),
            password: async () =>
              await this.prompt("Please enter your password: "),
            phoneCode: async () =>
              await this.prompt("Please enter the verification code: "),
            onError: (err) =>
              console.error(`[Bot ${this.botId}] [telegram] Login error:`, err),
          });
        }
      }
    } catch (error) {
      console.error(
        `[Bot ${this.botId}] [telegram] Telegram connection error:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Disconnect. If using shared client (from User Listener), skip disconnect
   * to avoid disrupting User Listener's persistent connection.
   */
  async disconnect(): Promise<undefined> {
    if (this._isSharedClient) {
      if (DEBUG)
        console.log(
          `[Bot ${this.botId}] [telegram] Using shared client, skipping disconnect`,
        );
      return undefined;
    }
    if (this.client?.connected) {
      await this.client.disconnect();
    }
    return undefined;
  }

  private async prompt(question: string): Promise<string> {
    return new Promise((resolve) => {
      const readline = require("node:readline").createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      readline.question(question, (answer: string) => {
        readline.close();
        resolve(answer);
      });
    });
  }

  async getDialogs(): Promise<DialogInfo[]> {
    if (!this.client.connected) {
      await this.client.connect();
    }
    await this.refreshDialogsCache();
    return this.dialogs;
  }

  private async refreshDialogsCache(force = false): Promise<void> {
    if (!this.client.connected) {
      await this.client.connect();
    }

    const shouldRefresh =
      force ||
      this.dialogs.length === 0 ||
      Date.now() - this.dialogsFetchedAt > this.cacheTTL;

    if (!shouldRefresh) {
      return;
    }

    const dialogs = await this.client.getDialogs({
      limit: dialogCacheFetchLimit,
    });

    const nextDialogs: DialogInfo[] = [];

    for (const dialog of dialogs) {
      if (!dialog.id || !dialog.entity) {
        continue;
      }

      const idStr = dialog.id.toString();
      const type =
        dialog.isUser === true
          ? "private"
          : dialog.isChannel || dialog.isGroup
            ? "group"
            : "unknown";
      const resolvedName =
        dialog.name && dialog.name.trim().length > 0
          ? dialog.name
          : this.getChatName(dialog.entity);

      const metadata = this.buildMetadataFromEntity(idStr, dialog.entity);
      nextDialogs.push({
        id: idStr,
        name: resolvedName,
        type,
        metadata: metadata ?? undefined,
      });

      this.addDialogEntityToCache(idStr, dialog.entity);
    }

    this.dialogs = nextDialogs;
    this.dialogsFetchedAt = Date.now();
  }

  // Cache management methods
  private isCacheValid(cacheEntry: { timestamp: number }): boolean {
    return Date.now() - cacheEntry.timestamp < this.cacheTTL;
  }

  private getFromCache(cache: EntityCache, id: BigInteger): Entity | null {
    const idStr = id.toString();
    const entry = cache[idStr];
    if (entry && this.isCacheValid(entry)) {
      return entry.entity;
    }
    // Remove expired entry
    if (entry) {
      delete cache[idStr];
    }
    return null;
  }

  private addToCache(cache: EntityCache, id: BigInteger, entity: Entity): void {
    cache[id.toString()] = {
      entity,
      timestamp: Date.now(),
    };
  }

  private addDialogEntityToCache(id: string, entity: Entity): void {
    this.dialogEntityCache[id] = {
      entity,
      timestamp: Date.now(),
    };
    this.registerMetadataFromEntity(id, entity);
  }

  private registerMetadataFromEntity(id: string, entity: Entity): void {
    const metadata = this.buildMetadataFromEntity(id, entity);
    if (metadata) {
      this.contactMetadata[id] = metadata;
    }
  }

  private buildMetadataFromEntity(
    id: string,
    entity: Entity,
  ): TelegramContactMeta | null {
    if (entity instanceof Api.User) {
      const firstName = entity.firstName ?? null;
      const lastName = entity.lastName ?? null;
      const displayName =
        firstName && lastName
          ? `${firstName} ${lastName}`.trim()
          : firstName || lastName || entity.username || null;

      return {
        platform: "telegram",
        peerId: id,
        peerType: "user",
        accessHash: entity.accessHash
          ? entity.accessHash.toString()
          : undefined,
        username: entity.username ?? null,
        firstName,
        lastName,
        displayName,
      };
    }

    if (entity instanceof Api.Channel) {
      return {
        platform: "telegram",
        peerId: id,
        peerType: "channel",
        accessHash: entity.accessHash
          ? entity.accessHash.toString()
          : undefined,
        username: entity.username ?? null,
        displayName: entity.title || null,
      };
    }

    if (entity instanceof Api.Chat) {
      return {
        platform: "telegram",
        peerId: id,
        peerType: "chat",
        displayName: entity.title || null,
      };
    }

    return null;
  }

  // Convert peer to input peer for API calls
  private peerToInputPeer(peer: Api.TypePeer): Api.TypeInputPeer {
    if (peer instanceof Api.PeerUser) {
      return new Api.InputPeerUser({
        userId: peer.userId,
        accessHash: bigInt(0),
      });
    }
    if (peer instanceof Api.PeerChat) {
      return new Api.InputPeerChat({ chatId: peer.chatId });
    }
    if (peer instanceof Api.PeerChannel) {
      return new Api.InputPeerChannel({
        channelId: peer.channelId,
        accessHash: bigInt(0), // Use BigInt literal instead
      });
    }
    return new Api.InputPeerEmpty();
  }

  // Get entity with caching
  private async getEntityWithCache(
    cache: EntityCache,
    entityId: BigInteger | Api.TypePeer, // Use native bigint type
  ): Promise<Entity | null> {
    // Convert to appropriate input peer type
    let inputPeer: Api.TypeInputPeer;
    let id: BigInteger;

    if (entityId instanceof Api.PeerUser) {
      id = entityId.userId;
      inputPeer = this.peerToInputPeer(entityId);
    } else if (entityId instanceof Api.PeerChat) {
      id = entityId.chatId;
      inputPeer = this.peerToInputPeer(entityId);
    } else if (entityId instanceof Api.PeerChannel) {
      id = entityId.channelId;
      inputPeer = this.peerToInputPeer(entityId);
    } else if (
      entityId instanceof Api.InputPeerUser ||
      entityId instanceof Api.InputPeerChat ||
      entityId instanceof Api.InputPeerChannel
    ) {
      // Handle existing input peers
      if (entityId instanceof Api.InputPeerUser) {
        id = entityId.userId;
      } else if (entityId instanceof Api.InputPeerChat) {
        id = entityId.chatId;
      } else {
        id = entityId.channelId;
      }
      inputPeer = entityId;
    } else {
      id = entityId;
      const entity = await this.client.getEntity(entityId);
      this.addToCache(cache, id, entity);
      return entity;
    }

    // Check cache first
    const cachedEntity = this.getFromCache(cache, id);
    if (cachedEntity) {
      return cachedEntity;
    }

    // Fetch from API if not in cache
    try {
      const entity = await this.client.getEntity(inputPeer);
      this.addToCache(cache, id, entity);
      return entity;
    } catch (error) {
      console.error(
        `[Bot ${this.botId}] [telegram] Error fetching entity ${id}:`,
        error,
      );
      return null;
    }
  }

  async sendMessage(
    target: MessageTarget,
    id: string,
    message: string,
  ): Promise<void> {
    await this.sendMessages(target, id, [message as unknown as Message]);
  }

  /**
   * Reply to a message
   * @param event - Source message event
   * @param messages - Message chain to send as reply
   * @param quoteOrigin - Whether to quote the original message (default: false)
   */
  async sendMessages(
    target: MessageTarget,
    id: string,
    messages: Messages,
  ): Promise<void> {
    if (!this.client.connected) {
      await withTimeout(
        this.client.connect(),
        CONNECT_TIMEOUT_MS,
        `[Bot ${this.botId}] Telegram client.connect()`,
      );
    }

    if (messages.length === 0) {
      return;
    }

    const { textParts, images } = this.partitionMessages(messages);
    await this.dispatchMessages(id, textParts, images);
  }

  async replyMessages(
    event: MessageEvent,
    messages: Messages,
    quoteOrigin = false,
  ): Promise<void> {
    if (!this.client.connected) {
      await withTimeout(
        this.client.connect(),
        CONNECT_TIMEOUT_MS,
        `[Bot ${this.botId}] Telegram client.connect()`,
      );
    }

    if (messages.length === 0) {
      return;
    }

    const id =
      event.targetType === "group" ? event.sender.group.id : event.sender.id;
    const { textParts, images } = this.partitionMessages(messages);
    await this.dispatchMessages(id.toString(), textParts, images);
  }

  async getChatsByChunk(
    since: number,
    chunkSize?: number,
  ): Promise<{
    messages: ExtractedMessageInfo[];
    hasMore: boolean;
  }> {
    // Use passed chunkSize or default value
    const maxMessageChunkCount = chunkSize ?? DEFAULT_MAX_MESSAGE_CHUNK_COUNT;
    // 1. Ensure client is connected
    if (!this.client.connected) {
      if (DEBUG) console.log("[Telegram] Client not connected, connecting...");
      await this.client.connect();
      await delay(500);
    }

    const extractedMessages: ExtractedMessageInfo[] = [];
    // 2. Initialize on first call: load dialogs + set state (avoid duplicate initialization)
    if (!this.asyncIteratorState.isInitialized) {
      // Load all valid dialogs (filter out invalid entries without entity/ID)
      const allDialogs = await this.client.getDialogs();
      this.asyncIteratorState.dialogs = allDialogs.filter(
        (dialog) => dialog.entity && dialog.id,
      );
      // Reset traversal starting point (first dialog, first message on first call)
      this.asyncIteratorState.currentDialogIndex = 0;
      this.asyncIteratorState.currentMessageIndex = 0;
      // Mark as initialized (avoid reloading dialogs on next call)
      this.asyncIteratorState.isInitialized = true;
      this.asyncIteratorState.offsetDate = since;

      if (DEBUG)
        console.log(
          `[Bot ${this.botId}] [telegram] Batch fetch initialization complete: ${this.asyncIteratorState.dialogs.length} valid dialogs`,
        );
      if (this.asyncIteratorState.dialogs.length === 0) {
        if (DEBUG)
          console.log(`[Bot ${this.botId}] No valid dialogs to process`);
        this.asyncIteratorState.isInitialized = false;
        this.asyncIteratorState.currentDialogIndex = 0;
        this.asyncIteratorState.currentMessageIndex = 0;
        return { messages: extractedMessages, hasMore: false };
      }
    }

    let { currentDialogIndex, currentMessageIndex, offsetDate } =
      this.asyncIteratorState;

    const targetDialogs = this.asyncIteratorState.dialogs;

    const MIN_MESSAGES_PER_DIALOG = 5;
    const REQUEST_DELAY_MS = 150; // Delay between requests to avoid triggering Telegram rate limits

    for (
      let dialogIdx = currentDialogIndex;
      dialogIdx < targetDialogs.length;
      dialogIdx++
    ) {
      const dialog = targetDialogs[dialogIdx];
      try {
        if (!this.client.connected) {
          if (DEBUG)
            console.log("[Telegram] Client not connected, connecting...");
          await this.client.connect();
          await delay(500);
        }

        // Add request delay (except for first request)
        if (dialogIdx > currentDialogIndex) {
          await delay(REQUEST_DELAY_MS);
        }

        // 4. Get all messages from current dialog that meet time criteria (no API offset, fetch all at once)
        const rawMessages = await this.client.getMessages(dialog.id, {
          offsetDate: offsetDate,
          reverse: true,
        });
        if (DEBUG)
          console.log(
            `[Bot ${this.botId}] [telegram] Fetched ${rawMessages.length} messages in the dialog id ${dialog.id}`,
          );

        if (rawMessages.length === 0 && dialogIdx >= 10) {
          break;
        }

        // 5. Process starting from current message index (avoid reprocessing extracted messages)
        const startMsgIdx = currentMessageIndex;
        let dialogMessageCount = 0; // Track messages from this dialog

        for (let msgIdx = startMsgIdx; msgIdx < rawMessages.length; msgIdx++) {
          const rawMsg = rawMessages[msgIdx];
          // Only process Api.Message type (filter non-message type updates)
          if (!(rawMsg instanceof Api.Message)) continue;
          // Extract message details (reuse existing logic)
          const extractedInfo = await this.extractMessageInfo(rawMsg);
          if (extractedInfo && !isEmptyMessage(extractedInfo)) {
            extractedMessages.push(extractedInfo);
            dialogMessageCount++;
            // 6. Stop immediately if current batch reaches 40, save current position
            if (extractedMessages.length >= maxMessageChunkCount) {
              this.asyncIteratorState.currentDialogIndex = dialogIdx; // Continue from current dialog next time
              this.asyncIteratorState.currentMessageIndex = msgIdx + 1; // Start from next message next time
              if (DEBUG)
                console.log(
                  `[Bot ${this.botId}] Batch full (${maxMessageChunkCount}), continue from dialog ${dialog.id} message ${msgIdx + 1}`,
                );
              return {
                messages: extractedMessages,
                hasMore: true,
              };
            }
          }
        }

        // If fewer than MIN_MESSAGES_PER_DIALOG messages fetched from this dialog, try fetching more history
        // If 0 messages fetched initially, no need to fetch more
        if (
          dialogMessageCount < MIN_MESSAGES_PER_DIALOG &&
          rawMessages.length > 0
        ) {
          const neededCount = MIN_MESSAGES_PER_DIALOG - dialogMessageCount;
          if (DEBUG)
            console.log(
              `[Bot ${this.botId}] [telegram] Dialog ${dialog.id} has only ${dialogMessageCount} messages, fetching ${neededCount} more without time filter`,
            );

          // Add delay to avoid triggering rate limit
          await delay(REQUEST_DELAY_MS);

          // Fetch more messages without time filter
          try {
            const additionalMessages = await this.client.getMessages(
              dialog.id,
              {
                limit: neededCount,
              },
            );

            // Process additional messages
            for (const rawMsg of additionalMessages) {
              if (!(rawMsg instanceof Api.Message)) continue;
              const extractedInfo = await this.extractMessageInfo(rawMsg);
              if (extractedInfo && !isEmptyMessage(extractedInfo)) {
                extractedMessages.push(extractedInfo);
                dialogMessageCount++;
                if (extractedMessages.length >= maxMessageChunkCount) {
                  this.asyncIteratorState.currentDialogIndex = dialogIdx;
                  this.asyncIteratorState.currentMessageIndex =
                    rawMessages.length;
                  if (DEBUG)
                    console.log(
                      `[Bot ${this.botId}] Batch full (${maxMessageChunkCount}), continue from dialog ${dialog.id}`,
                    );
                  return {
                    messages: extractedMessages,
                    hasMore: true,
                  };
                }
              }
            }

            if (DEBUG)
              console.log(
                `[Bot ${this.botId}] [telegram] Fetched ${additionalMessages.length} additional messages for dialog ${dialog.id}, total: ${dialogMessageCount}`,
              );
          } catch (error) {
            console.warn(
              `[Bot ${this.botId}] [telegram] Failed to fetch additional messages for dialog ${dialog.id}:`,
              error,
            );
          }
        }

        currentMessageIndex = 0;
        this.asyncIteratorState.currentMessageIndex = 0; // Next dialog starts from message 0
        this.asyncIteratorState.currentDialogIndex = dialogIdx + 1; // Next time start from next dialog
      } catch (error) {
        // Single dialog processing failed: skip this dialog, avoid affecting overall traversal
        console.error(
          `[Bot ${this.botId}] Failed to process dialog ${dialog.id}:`,
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

  async getChatsByChunkHours(hours = 8): Promise<{
    messages: ExtractedMessageInfo[];
    hasMore: boolean;
  }> {
    return this.getChatsByChunk(timeBeforeHours(hours));
  }

  async getChatsByTime(cutoffDate: number): Promise<ExtractedMessageInfo[]> {
    if (!this.client.connected) {
      await this.client.connect();
    }

    const extractedMessages: ExtractedMessageInfo[] = [];
    const dialogs = await this.client.getDialogs({});

    if (DEBUG)
      console.log(
        `[Bot ${this.botId}] [telegram] Fetched ${dialogs.length} dialogs`,
      );

    let dialogIndex = 0;
    const REQUEST_DELAY_MS = 150; // Delay between each request

    for (const dialog of dialogs) {
      if (!dialog.entity || !dialog.id) {
        dialogIndex += 1;
        continue;
      }

      // Cache the dialog entity
      this.addToCache(this.chatCache, dialog.id, dialog.entity);

      // Add delay (except for first request)
      if (dialogIndex > 0) {
        await delay(REQUEST_DELAY_MS);
      }

      const messages = await this.client.getMessages(dialog.id, {
        offsetDate: cutoffDate,
        reverse: true,
      });

      if (DEBUG)
        console.log(
          `[Bot ${this.botId}] [telegram] Fetched ${messages.length} messages in the dialog id ${dialog.id}`,
        );

      // No more latest messages before the cutoffDate.
      // TODO: fix the hardcode pinned message group 10
      if (
        (messages.length === 0 && dialogIndex >= 10) ||
        dialogIndex >= maxDialogCount
      ) {
        break;
      }
      dialogIndex += 1;

      let msgIndex = 0;
      for (const msg of messages) {
        if (msgIndex >= maxMessageCount) {
          break;
        }
        if (msg instanceof Api.Message) {
          msgIndex += 1;
          const extractedInfo = await this.extractMessageInfo(msg);
          if (extractedInfo && !isEmptyMessage(extractedInfo)) {
            extractedMessages.push(extractedInfo);
          }
        }
      }
    }

    if (DEBUG)
      console.log(
        `[Bot ${this.botId}] [telegram] Fetched ${extractedMessages.length} total messages (capped at ${maxMessageCount})`,
      );
    return extractedMessages;
  }

  async getChatsByDays(days = 1): Promise<ExtractedMessageInfo[]> {
    const cutoffDate = Math.floor(
      (Date.now() - days * 24 * 60 * 60 * 1000) / 1000,
    );
    return await this.getChatsByTime(cutoffDate);
  }

  async getChatsByHours(hours = 1): Promise<ExtractedMessageInfo[]> {
    const cutoffDate = Math.floor((Date.now() - hours * 60 * 60 * 1000) / 1000);
    return await this.getChatsByTime(cutoffDate);
  }

  // Extract detailed information from a message with caching
  private async extractMessageInfo(
    message: Api.Message,
    depth = 0,
    maxDepth = 1,
  ): Promise<ExtractedMessageInfo | null> {
    try {
      // Get chat information with caching
      const chat =
        (await this.getEntityWithCache(this.chatCache, message.peerId)) ??
        (await this.client.getEntity(message.peerId));
      if (!chat) {
        return null;
      }

      const chatType = this.determineChatType(chat);

      // Filter out Saved Messages (self-messages)
      // In Telegram, Saved Messages has chatId equal to the user's own ID
      if (chatType === "private" && chat instanceof Api.User) {
        try {
          // Lazy load and cache own user ID
          if (!this.ownUserId) {
            const me = await this.client.getMe();
            this.ownUserId = me.id;
          }
          if (chat.id.equals(this.ownUserId)) {
            // This is a Saved Messages conversation (self-chat), skip it
            return null;
          }
        } catch (error) {
          console.warn(
            `[Bot ${this.botId}] [telegram] Failed to get user info for self-message filter:`,
            error,
          );
        }
      }

      // Get sender information with caching
      let sender: Entity | null = null;
      if (chatType === "channel" || chatType === "group") {
        if (message.fromId) {
          sender = await this.getEntityWithCache(
            this.senderCache,
            message.fromId,
          );
        }
      } else {
        if (message.senderId) {
          sender = await this.getEntityWithCache(
            this.senderCache,
            message.senderId,
          );
        }
      }

      const senderName = this.getSenderName(sender);
      const chatName = this.getChatName(chat);
      const chatUserName = "username" in chat ? chat.username : null;

      const msgInfo = {
        id: message.id, // Save Telegram original message ID for deduplication
        sender:
          chatType === "private"
            ? (senderName ?? chatName)
            : (senderName ??
              chatUserName ??
              `anonymous user ${message.senderId}`),
        chatName: chatName,
        chatType: chatType,
        text: message.message || "",
        timestamp: message.date,
        // Use message.out property to determine message direction: true means sent by me, false means received from others
        isOutgoing: message.out,
      };

      if (msgInfo.sender.includes("anonymous user") && message.senderId) {
        sender = await this.getEntityWithCache(
          this.senderCache,
          message.senderId,
        );
        const senderName = this.getSenderName(sender);
        if (senderName) {
          msgInfo.sender = senderName;
        }
      }

      let quoted: ExtractedMessageInfo | null = null;

      if (message.replyToMsgId && depth < maxDepth) {
        try {
          const quotedMsgList = await this.client.getMessages(message.peerId, {
            ids: message.replyToMsgId,
          });
          if (
            quotedMsgList.length > 0 &&
            quotedMsgList[0] instanceof Api.Message
          ) {
            quoted = await this.extractMessageInfo(
              quotedMsgList[0],
              depth + 1,
              maxDepth,
            );
          }
        } catch (error) {}
      }
      const result = isEmptyMessage(quoted) ? msgInfo : { ...msgInfo, quoted };
      // Only add attachments to non-referenced messages, as they may be added repeatedly.
      const attachments =
        depth === 0 ? await this.extractAttachmentsFromMessage(message) : [];
      return attachments.length > 0 ? { ...result, attachments } : result;
    } catch (error) {
      console.error(
        `[Bot ${this.botId}] [telegram] Error extracting message info:`,
        error,
      );
      return null;
    }
  }

  // Determine the type of chat
  private determineChatType(
    chat: Entity,
  ): "private" | "group" | "channel" | "unknown" {
    if (chat instanceof Api.User) return "private";
    if (chat instanceof Api.Chat) return "group";
    if (chat instanceof Api.Channel) return "channel";
    return "unknown";
  }

  // Get appropriate chat name based on entity type
  private getChatName(chat: Entity): string {
    if (chat instanceof Api.User) {
      const name = `${chat.firstName || ""} ${chat.lastName || ""}`.trim();
      if (name) return name;
      // Fallback to username if display name is empty
      if (chat.username) return `@${chat.username}`;
      return "Private Chat";
    }
    if (chat instanceof Api.Chat) {
      // For regular chats, try title, then use ID as fallback
      if (chat.title) return chat.title;
      const chatId = chat.id?.toString();
      if (chatId) {
        console.warn(
          `[Bot ${this.botId}] [telegram] Chat ${chatId} missing title, using ID as fallback`,
        );
        return `Chat ${chatId}`;
      }
      return "Unnamed Chat";
    }
    if (chat instanceof Api.Channel) {
      // For channels/supergroups, try title, then username, then ID
      if (chat.title) return chat.title;
      if (chat.username) return `@${chat.username}`;
      const channelId = chat.id?.toString();
      if (channelId) {
        console.warn(
          `[Bot ${this.botId}] [telegram] Channel ${channelId} missing title and username, using ID as fallback`,
        );
        return `Channel ${channelId}`;
      }
      return "Unnamed Chat";
    }
    // Unknown entity type - log for debugging
    console.warn(
      `[Bot ${this.botId}] [telegram] Unknown entity type in getChatName:`,
      chat?.className,
    );
    return "Unknown Chat";
  }

  private getSenderName(sender: Entity | null): string | null {
    if (!sender) return null;
    if (sender instanceof Api.User) {
      if (sender.firstName || sender.lastName) {
        return `${sender.firstName || ""} ${sender.lastName || ""}`.trim();
      }
      return sender.username ?? "";
    }
    if (sender instanceof Api.Channel) {
      return sender.title;
    }
    if (sender instanceof Api.Chat) {
      return sender.title;
    }
    return null;
  }

  // Clear cache manually if needed
  clearCache(): void {
    this.senderCache = {};
    this.chatCache = {};
  }

  private isImageMessage(message: Message): message is Image {
    return (
      typeof message === "object" &&
      message !== null &&
      "url" in message &&
      !("name" in message) &&
      typeof (message as Image).url === "string" &&
      (message as Image).url.length > 0
    );
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

      const text = alloomiMessageToTgText(message);
      if (text.trim().length > 0) {
        textParts.push(text);
      }
    }

    return { textParts, images };
  }

  private inferFileName(image: Image): string {
    if (image.id && image.id.trim().length > 0) {
      return image.id;
    }

    if (image.path) {
      const segments = image.path.split("/");
      const candidate = segments[segments.length - 1];
      if (candidate) return candidate;
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
          `[Bot ${this.botId}] [telegram] Failed to parse filename from URL`,
          error,
        );
      }
    }

    return `image-${Date.now()}.jpg`;
  }

  private decodeBase64Payload(image: Image): Buffer | null {
    if (!image.base64) {
      return null;
    }

    const base64String = image.base64.includes(",")
      ? image.base64.split(",").pop()
      : image.base64;

    if (!base64String) {
      return null;
    }

    try {
      return Buffer.from(base64String, "base64");
    } catch (error) {
      console.error(
        `[Bot ${this.botId}] [telegram] Failed to decode base64 image payload`,
        error,
      );
      return null;
    }
  }

  private async downloadMediaBuffer(
    message: Api.Message,
  ): Promise<Buffer | null> {
    try {
      const result = await this.client.downloadMedia(message);
      if (!result) return null;
      if (Buffer.isBuffer(result)) {
        return result;
      }
      if (typeof result === "string") {
        const fs = await import("node:fs/promises");
        return await fs.readFile(result);
      }
      return null;
    } catch (error) {
      console.error(
        `[Bot ${this.botId}] [telegram] Failed to download media buffer`,
        error,
      );
      return null;
    }
  }

  private async extractAttachmentsFromMessage(
    message: Api.Message,
  ): Promise<Attachment[]> {
    if (!this.ownerUserId || !this.ownerUserType) {
      return [];
    }

    if (!message.media) {
      return [];
    }

    const attachments: Attachment[] = [];

    const pushAttachment = async (
      buffer: Buffer,
      fileName: string,
      mimeType: string,
    ) => {
      if (!this.ownerUserId || !this.ownerUserType) {
        return;
      }

      const downloadPayload = async () => ({
        data: buffer as unknown as ArrayBuffer,
        contentType: mimeType,
        sizeBytes: buffer.length,
      });

      if (this.fileIngester) {
        const result = await this.fileIngester.ingestExternal({
          source: "telegram",
          userId: this.ownerUserId,
          maxSizeBytes: TELEGRAM_MAX_ATTACHMENT_BYTES,
          mimeTypeHint: mimeType,
          originalFileName: fileName,
          downloadAttachment: downloadPayload,
        });

        if (!result.success) {
          console.warn(
            `[Bot ${this.botId}] [telegram] Skipped attachment due to ${result.reason} mimeType=${mimeType} fileName=${fileName}`,
          );
          return;
        }

        if (!result.attachment) {
          return;
        }

        const ingested = result.attachment;
        attachments.push({
          name: ingested.name,
          url: ingested.url,
          downloadUrl: ingested.downloadUrl,
          contentType: ingested.contentType,
          sizeBytes: ingested.sizeBytes,
          blobPath: ingested.blobPath,
          source: "telegram",
        });
      }
    };

    if (message.media instanceof Api.MessageMediaPhoto) {
      const buffer = await this.downloadMediaBuffer(message);
      if (buffer) {
        const fileName = `telegram-photo-${message.id ?? Date.now()}.jpg`;
        await pushAttachment(buffer, fileName, "image/jpeg");
      }
      return attachments;
    }

    if (message.media instanceof Api.MessageMediaDocument) {
      const document = message.media.document;
      if (!document || !(document instanceof Api.Document)) {
        return attachments;
      }

      const buffer = await this.downloadMediaBuffer(message);
      if (!buffer) {
        return attachments;
      }

      const mimeType = document.mimeType ?? "application/octet-stream";
      let fileName = `telegram-file-${document.id ?? message.id ?? Date.now()}`;

      for (const attr of document.attributes ?? []) {
        if (attr instanceof Api.DocumentAttributeFilename) {
          fileName = attr.fileName;
          break;
        }
      }

      await pushAttachment(buffer, fileName, mimeType);
      return attachments;
    }

    return attachments;
  }

  private async resolveTelegramFile(
    image: Image,
  ): Promise<string | CustomFile> {
    if (image.base64) {
      const buffer = this.decodeBase64Payload(image);
      if (buffer) {
        const name = this.inferFileName(image);
        return new CustomFile(name, buffer.length, "", buffer);
      }
    }

    if (image.path) {
      return image.path;
    }

    if (image.url) {
      return image.url;
    }

    throw new Error(
      "Unable to resolve Telegram file source from image payload",
    );
  }

  /**
   * Build InputPeer based on contactId and metadata
   * If metadata lacks accessHash, will try to resolve entity from Telegram API
   */
  private async buildInputPeerFromMetadata(
    contactId: string,
  ): Promise<Api.TypeInputPeer> {
    const metadata = this.contactMetadata[contactId];

    if (!metadata) {
      // If no metadata, try to resolve entity from Telegram API
      return await this.resolveEntityToInputPeer(contactId);
    }

    const peerId = bigInt(metadata.peerId);

    if (metadata.peerType === "user") {
      if (metadata.accessHash) {
        return new Api.InputPeerUser({
          userId: peerId,
          accessHash: bigInt(metadata.accessHash),
        });
      }
      // No accessHash, try to resolve entity from Telegram API
      return await this.resolveEntityToInputPeer(contactId, peerId, "user");
    }

    if (metadata.peerType === "channel") {
      if (metadata.accessHash) {
        return new Api.InputPeerChannel({
          channelId: peerId,
          accessHash: bigInt(metadata.accessHash),
        });
      }
      // No accessHash, try to resolve entity from Telegram API
      return await this.resolveEntityToInputPeer(contactId, peerId, "channel");
    }

    if (metadata.peerType === "chat") {
      // Check if peerId is negative
      // Negative ID is actually channel/supergroup, not regular chat
      if (peerId.isNegative()) {
        // Negative ID needs to be handled as channel, try to resolve if no accessHash
        return await this.resolveEntityToInputPeer(
          contactId,
          peerId,
          "channel",
        );
      }
      return new Api.InputPeerChat({
        chatId: peerId,
      });
    }

    // Unknown type, try to resolve
    return await this.resolveEntityToInputPeer(contactId);
  }

  /**
   * Try to resolve entity from Telegram API and build InputPeer
   * Updates contactMetadata cache after successful resolution
   */
  private async resolveEntityToInputPeer(
    contactId: string,
    fallbackPeerId?: BigInteger,
    fallbackType?: "user" | "channel",
  ): Promise<Api.TypeInputPeer> {
    try {
      if (!this.client.connected) {
        await this.client.connect();
      }

      // Try to resolve entity directly using contactId
      const entity = await this.client.getEntity(contactId);
      if (!entity) {
        throw new Error(`Entity not found for contactId: ${contactId}`);
      }

      // Build and cache metadata
      const metadata = this.buildMetadataFromEntity(contactId, entity);
      if (metadata) {
        this.contactMetadata[contactId] = metadata;
      }

      // Build corresponding InputPeer based on entity type
      if (entity instanceof Api.User) {
        const userId = entity.id.valueOf();
        const accessHash = entity.accessHash
          ? bigInt(entity.accessHash)
          : bigInt(0);
        const inputPeer = new Api.InputPeerUser({
          userId: bigInt(userId),
          accessHash,
        });
        return inputPeer;
      }

      if (entity instanceof Api.Channel) {
        const channelId = entity.id.valueOf();
        const accessHash = entity.accessHash
          ? bigInt(entity.accessHash)
          : bigInt(0);
        const inputPeer = new Api.InputPeerChannel({
          channelId: bigInt(channelId),
          accessHash,
        });
        return inputPeer;
      }

      if (entity instanceof Api.Chat) {
        const chatId = entity.id.valueOf();
        const inputPeer = new Api.InputPeerChat({
          chatId: bigInt(chatId),
        });
        return inputPeer;
      }

      throw new Error(`Unsupported entity type for contactId: ${contactId}`);
    } catch (error) {
      console.error(
        `[Bot ${this.botId}] [telegram] Failed to resolve entity for ${contactId}:`,
        error,
      );
      throw new Error(
        `Cannot resolve Telegram peer for ${contactId}. The contact may not exist or may not be accessible.`,
      );
    }
  }

  private async dispatchMessages(
    peer: string,
    textParts: string[],
    images: Image[],
  ): Promise<void> {
    const text = textParts.join("\n").trim();

    // Build correct InputPeer using metadata (now async)
    const inputPeer = await this.buildInputPeerFromMetadata(peer);

    if (images.length === 0) {
      if (text.length === 0) {
        return;
      }

      await withTimeout(
        this.client.sendMessage(inputPeer, {
          message: markdownToTelegramHtml(text),
          parseMode: "html",
        }),
        SEND_MESSAGE_TIMEOUT_MS,
        `[Bot ${this.botId}] Telegram client.sendMessage()`,
      );
      if (DEBUG) {
        console.log(
          `[Bot ${this.botId}] [telegram] Message sent successfully to ${peer}`,
        );
      }
      return;
    }

    const caption = text.length > 0 ? text : undefined;
    let captionDelivered = false;

    for (let index = 0; index < images.length; index++) {
      const image = images[index];
      let fileLike: string | CustomFile;
      try {
        fileLike = await this.resolveTelegramFile(image);
      } catch (error) {
        console.error(
          `[Bot ${this.botId}] [telegram] Failed to resolve file for upload`,
          error,
        );
        continue;
      }

      const options: Parameters<TelegramClient["sendFile"]>[1] = {
        file: fileLike,
      };

      if (index === 0 && caption) {
        options.caption = caption;
      }

      await withTimeout(
        this.client.sendFile(inputPeer, options),
        SEND_MESSAGE_TIMEOUT_MS,
        `[Bot ${this.botId}] Telegram client.sendFile()`,
      );

      if (index === 0 && caption) {
        captionDelivered = true;
      }

      if (DEBUG) {
        console.log(
          `[Bot ${this.botId}] [telegram] File sent successfully to ${peer}`,
        );
      }
    }

    if (caption && !captionDelivered) {
      await withTimeout(
        this.client.sendMessage(inputPeer, {
          message: markdownToTelegramHtml(text),
          parseMode: "html",
        }),
        SEND_MESSAGE_TIMEOUT_MS,
        `[Bot ${this.botId}] Telegram client.sendMessage()`,
      );
      if (DEBUG) {
        console.log(
          `[Bot ${this.botId}] [telegram] Caption message sent successfully to ${peer}`,
        );
      }
    }
  }
}

export { getTgUserNameString } from "@alloomi/integrations/channels/sources/types";
export type {
  DialogInfo,
  TgUserInfo,
  ExtractedMessageInfo,
} from "@alloomi/integrations/channels/sources/types";

export function alloomiMessageToTgText(message: Message): string {
  if (typeof message === "string") {
    return message;
  }
  if ("text" in message) {
    return message.text;
  }
  if ("target" in message) {
    return `@${message.target}`;
  }
  if ("nodes" in message) {
    return message.nodes
      .map((node) => alloomiMessageToTgText(node as Message))
      .join("");
  }
  return "";
}

export function tgMessageToAlloomiMessage(message: Api.Message): Messages {
  const messages: Messages = [];

  if (!message.message) {
    if (message.media) {
      messages.push("[Media content]");
    }
    return messages;
  }

  messages.push(message.message);

  if (message.entities) {
    for (const entity of message.entities) {
      if (entity instanceof Api.MessageEntityMention) {
        const mentionText = message.message.substr(
          entity.offset,
          entity.length,
        );
        messages.push({ target: mentionText.replace("@", "") } as At);
      }
    }
  }

  return messages;
}
