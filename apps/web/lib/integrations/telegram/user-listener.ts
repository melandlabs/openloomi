/**
 * Telegram User Account Listener
 *
 * Listens to the user's own Telegram account (not bot) for Saved Messages
 * When user sends a message to themselves, it triggers Agent Runtime
 *
 * Uses gramjs event-driven architecture (addEventHandler + NewMessage event)
 * No manual polling needed - MTProto protocol handles real-time updates
 */

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Api } from "telegram";
import bigInt from "big-integer";
import {
  getIntegrationAccountsByUserId,
  loadIntegrationCredentials,
} from "@/lib/db/queries";
import type { IntegrationAccount } from "@/lib/db/schema";
import { handleAgentRuntime } from "./handlers";
import { TelegramConversationStore } from "@openloomi/integrations/telegram/conversation-store";
import { getAppMemoryDir } from "@/lib/utils/path";
import { createTaskSession } from "@/lib/files/workspace/sessions";
import { getReceivedAndExecutingMessage } from "./saved-messages-i18n";
import { markdownToTelegramHtml } from "@openloomi/integrations/telegram/markdown";
import { DEFAULT_AI_MODEL, AI_PROXY_BASE_URL } from "@/lib/env/constants";

// Singleton instance for Telegram conversation history
const telegramConversationStore = new TelegramConversationStore(
  getAppMemoryDir(),
);

// Development environment logging switch
const DEBUG = process.env.NODE_ENV === "development";
// AI reply identifier suffix
const AI_SUFFIX = "(By openloomi AI)";

// Extended message type to include properties that gramjs types don't properly expose
interface TelegramMessageExtended {
  chatId: bigInt.BigInteger | number | string;
  message?: string;
  out?: boolean;
  id?: number;
  date?: number;
  media?: any;
}

interface UserListenerConfig {
  userId: string;
  authToken?: string; // Cloud auth token for API configuration
}

class TelegramUserListener {
  private clients: Map<string, TelegramClient> = new Map();
  private userId: string;
  private authToken?: string; // Store cloud auth token for API configuration
  private accounts: Map<string, IntegrationAccount> = new Map();
  // Reconnection state
  private reconnectAttempts: Map<string, number> = new Map();
  private reconnectTimers: Map<string, ReturnType<typeof setTimeout>> =
    new Map();
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  // Connection state tracking
  private connectionState: Map<string, string> = new Map();
  // Watchdog: Track last event time, detect connection stale
  private lastEventTime: Map<string, number> = new Map();
  private watchdogTimers: Map<string, ReturnType<typeof setInterval>> =
    new Map();
  // Connection stale threshold (ms): No events received beyond this time means connection is stale
  private readonly WATCHDOG_INTERVAL_MS = 90_000; // Check every 90 seconds
  private readonly STALE_THRESHOLD_MS = 3 * 60_000; // 3 minutes with no events considered stale

  // Polling mode state
  private pollingTimers: Map<string, ReturnType<typeof setInterval>> =
    new Map();
  private lastProcessedMessageIds: Map<string, number> = new Map();
  private ownSentMessageIds: Set<number> = new Set(); // Track message IDs we sent ourselves
  private readonly OWN_SENT_IDS_MAX = 200; // cap to prevent unbounded growth
  private readonly POLLING_INTERVAL_MS = 3000; // Poll every 3 seconds
  private readonly usePollingMode = true;

  constructor(config: UserListenerConfig) {
    this.userId = config.userId;
    this.authToken = config.authToken;
  }

  /** Add a sent message ID and evict oldest entries when the cap is exceeded. */
  private addOwnSentMessageId(id: number): void {
    this.ownSentMessageIds.add(id);
    if (this.ownSentMessageIds.size > this.OWN_SENT_IDS_MAX) {
      const oldest = this.ownSentMessageIds.values().next().value;
      if (oldest !== undefined) this.ownSentMessageIds.delete(oldest);
    }
  }

  /**
   * Get connected client for specified accountId (for external reuse, e.g., TelegramAdapter)
   */
  getClient(accountId: string): TelegramClient | undefined {
    const client = this.clients.get(accountId);
    if (client?.connected) return client;
    return undefined;
  }

  /**
   * Find connected client by session key
   */
  getClientBySessionKey(sessionKey: string): TelegramClient | undefined {
    for (const [accountId, account] of this.accounts.entries()) {
      const credentials = loadIntegrationCredentials<{
        sessionKey?: string;
      }>(account);
      if (credentials?.sessionKey === sessionKey) {
        return this.getClient(accountId);
      }
    }
    return undefined;
  }

  /**
   * Start listening to all Telegram accounts for this user
   */
  async start(): Promise<void> {
    if (DEBUG)
      console.log(`[TelegramUserListener] Starting for user ${this.userId}`);

    // Check if already running and stop old listeners first
    if (this.clients.size > 0) {
      if (DEBUG)
        console.log(
          `[TelegramUserListener] Stopping ${this.clients.size} existing client(s) before starting new ones`,
        );
      await this.stop();
    }

    // Get all integration accounts and filter for Telegram
    const allAccounts = await getIntegrationAccountsByUserId({
      userId: this.userId,
    });

    const accounts = allAccounts.filter((acc) => acc.platform === "telegram");

    if (!accounts || accounts.length === 0) {
      if (DEBUG)
        console.log(
          `[TelegramUserListener] No Telegram accounts found for user ${this.userId}`,
        );
      return;
    }

    if (DEBUG)
      console.log(
        `[TelegramUserListener] Found ${accounts.length} Telegram account(s)`,
      );

    // Store account info for reconnection
    for (const account of accounts) {
      this.accounts.set(account.id, account);
    }

    for (const account of accounts) {
      try {
        await this.connectAccount(account);
      } catch (error) {
        console.error(
          `[TelegramUserListener] Failed to connect account ${account.id}:`,
          error,
        );
        // Trigger reconnection for failed accounts
        this.handleConnectionError(account.id, error, account);
      }
    }
  }

  /**
   * Connect to a single Telegram account and listen for messages
   * Uses gramjs event-driven architecture (NewMessage event)
   */
  private async connectAccount(account: IntegrationAccount): Promise<void> {
    // Decrypt credentials using the utility function
    const credentials = loadIntegrationCredentials<{
      sessionKey?: string;
    }>(account);

    const sessionKey = credentials?.sessionKey;
    if (!sessionKey) {
      if (DEBUG)
        console.warn(
          `[TelegramUserListener] Account ${account.id} has no sessionKey. Account data:`,
          JSON.stringify({
            id: account.id,
            hasCredentialsEncrypted: !!account.credentialsEncrypted,
          }),
        );
      return;
    }

    if (DEBUG)
      console.log(
        `[TelegramUserListener] Found sessionKey for account ${account.id}`,
      );

    const appId = Number(process.env.TG_APP_ID ?? "0");
    const appHash = process.env.TG_APP_HASH ?? "";

    if (!appId || !appHash) {
      throw new Error("TG_APP_ID and TG_APP_HASH must be configured");
    }

    const session = new StringSession(sessionKey);
    const client = new TelegramClient(session, appId, appHash, {
      connectionRetries: 10,
      timeout: 60, // Increase timeout to 60 seconds
      requestRetries: 5, // Request retry count
      floodSleepThreshold: 60, // Wait time when flood-limited
    });

    if (DEBUG)
      console.log(
        `[TelegramUserListener] Connecting to account ${account.id}...`,
      );
    await client.connect();

    // Get user info to verify connection
    const me = await client.getMe();
    if (DEBUG)
      console.log(
        `[TelegramUserListener] Connected as: ${me.firstName || me.username || me.id.toString()}`,
      );

    // Store client and account for later cleanup / client sharing
    this.clients.set(account.id, client);
    this.accounts.set(account.id, account);

    if (DEBUG)
      console.log("[TelegramUserListener] Setting up event handlers...");

    // Capture account ID in closure for event handler
    const accountId = account.id;

    // Connection established - send a test message to confirm listener is working
    if (DEBUG)
      console.log(
        `[TelegramUserListener] [${accountId}] Client connected successfully. User ID: ${me.id.toString()}`,
      );

    // Test the connection by trying to get dialog count
    try {
      // Try to get "Saved Messages" dialog specifically
      const selfPeer = new Api.InputPeerUser({
        userId: me.id,
        accessHash: me.accessHash ? bigInt(me.accessHash) : bigInt(0),
      });

      const historyResult = await client.invoke(
        new Api.messages.GetHistory({
          peer: selfPeer,
          limit: 1,
        }),
      );

      const msgCount =
        historyResult instanceof Api.messages.Messages
          ? historyResult.messages.length
          : historyResult instanceof Api.messages.MessagesSlice
            ? historyResult.messages.length
            : 0;

      // Also get total dialog count
      const dialogResult = await client.invoke(
        new Api.messages.GetDialogs({
          offsetDate: 0,
          offsetId: 0,
          offsetPeer: new Api.InputPeerEmpty(),
          limit: 10,
          hash: bigInt(0),
        }),
      );

      const dialogCount =
        dialogResult instanceof Api.messages.Dialogs
          ? dialogResult.dialogs.length
          : dialogResult instanceof Api.messages.DialogsSlice
            ? dialogResult.dialogs.length
            : 0;

      if (DEBUG)
        console.log(
          `[TelegramUserListener] [${accountId}] Connection test successful. Found ${dialogCount} dialogs`,
        );
    } catch (error) {
      console.error(
        `[TelegramUserListener] [${accountId}] Connection test failed:`,
        error,
      );
    }

    // Start watchdog, periodically check if connection is stale
    this.startWatchdog(accountId, account);
    // Record initial event time
    this.lastEventTime.set(accountId, Date.now());

    // Choose message reception mode based on configuration
    if (this.usePollingMode) {
      if (DEBUG)
        console.log(
          `[TelegramUserListener] [${accountId}] Using POLLING mode for message reception`,
        );
      this.startPolling(client, accountId, account, me);
    } else {
      if (DEBUG)
        console.log(
          `[TelegramUserListener] [${accountId}] Using EVENT-DRIVEN mode for message reception`,
        );
      this.startEventHandler(client, accountId, account, me);
    }
  }

  /**
   * Start event-driven mode (original method)
   */
  private startEventHandler(
    client: TelegramClient,
    accountId: string,
    account: IntegrationAccount,
    me: Api.User,
  ): void {
    let eventCounter = 0;

    // Use gramjs event-driven architecture to listen for new messages
    // This is NOT polling - MTProto handles real-time updates
    client.addEventHandler(async (event) => {
      eventCounter++;
      // Update lastEventTime on every event received, for watchdog detection
      this.lastEventTime.set(accountId, Date.now());
      try {
        // Log ALL events for debugging
        const eventName = event.constructor.name;
        const className = (event as any).className;

        // Handle UpdateConnectionState events separately to reduce log noise
        if (
          eventName === "UpdateConnectionState" ||
          className === "UpdateConnectionState"
        ) {
          const state = (event as any).state; // Could be: connecting, connected, disconnected, etc.
          const prevState = this.connectionState.get(accountId);

          // Map numeric state to string for better logging
          const stateMap: Record<number, string> = {
            0: "connecting",
            1: "connected",
            2: "disconnected",
            "-1": "connectionLost",
          };
          const stateStr = stateMap[state as number] || `unknown(${state})`;

          // Only log when state actually changes
          if (prevState !== stateStr) {
            if (DEBUG)
              console.log(
                `[TelegramUserListener] [${accountId}] Connection state changed: ${prevState || "unknown"} -> ${stateStr}`,
              );
            this.connectionState.set(accountId, stateStr);

            // Trigger reconnection if disconnected (state 2, -1, or any non-positive state except 0 and 1)
            const isConnected = state === 1 || stateStr === "connected";
            const isConnecting = state === 0 || stateStr === "connecting";

            if (!isConnected && !isConnecting) {
              if (DEBUG)
                console.warn(
                  `[TelegramUserListener] [${accountId}] Connection lost (state=${state}), scheduling reconnection...`,
                );
              // Schedule reconnection
              this.handleConnectionError(
                accountId,
                new Error(`Connection lost (state: ${stateStr})`),
                account,
              );
            }
          }
          return; // Skip further processing for connection state events
        }

        // Only log important event types to reduce noise
        const importantEvents = [
          "UpdateNewMessage",
          "UpdateNewChannelMessage",
          "UpdateShortMessage",
          "Updates",
          "UpdateShort",
        ];

        if (
          importantEvents.includes(eventName) ||
          importantEvents.includes(className)
        ) {
          if (DEBUG)
            console.log(
              `[TelegramUserListener] [${eventCounter}] ===== MESSAGE EVENT ===== type=${eventName} className=${className}`,
            );
        }

        let message: TelegramMessageExtended | null = null;
        let originalMessage: any = null; // Keep original message for downloadMedia

        // Try instanceof check first (for normal events)
        if (event instanceof Api.UpdateNewMessage) {
          originalMessage = event.message;
          message = event.message as TelegramMessageExtended;
          if (DEBUG)
            console.log(
              `[TelegramUserListener] -> UpdateNewMessage (instanceof), chatId=${message?.chatId}`,
            );
        } else if (event instanceof Api.UpdateNewChannelMessage) {
          originalMessage = event.message;
          message = event.message as TelegramMessageExtended;
          if (DEBUG)
            console.log(
              `[TelegramUserListener] -> UpdateNewChannelMessage (instanceof), chatId=${message?.chatId}`,
            );
        }
        // Fallback to className check (for wrapped events)
        else if (className === "UpdateNewMessage") {
          originalMessage = (event as any).message;
          message = originalMessage as TelegramMessageExtended;
          if (DEBUG)
            console.log(
              `[TelegramUserListener] -> UpdateNewMessage (className), chatId=${message?.chatId}`,
            );
        } else if (className === "UpdateNewChannelMessage") {
          originalMessage = (event as any).message;
          message = originalMessage as TelegramMessageExtended;
          if (DEBUG)
            console.log(
              `[TelegramUserListener] -> UpdateNewChannelMessage (className), chatId=${message?.chatId}`,
            );
        } else if (className === "UpdateShortMessage") {
          // UpdateShortMessage is for private chats without the full message object
          if (DEBUG)
            console.log(
              `[TelegramUserListener] UpdateShortMessage - userId: ${(event as any).userId}, out: ${(event as any).out}`,
            );
          const chatIdBigInt = bigInt((event as any).userId);
          const userIdBigInt = bigInt(me.id);

          if (chatIdBigInt.equals(userIdBigInt)) {
            // This is a self-message, construct a minimal message object
            message = {
              chatId: (event as any).userId,
              message: (event as any).message,
              out: (event as any).out,
              id: (event as any).id,
              date: (event as any).date,
              media: (event as any).fwdFrom
                ? { fwdFrom: (event as any).fwdFrom }
                : undefined,
            };
          }
        } else if (className === "Updates") {
          if (DEBUG)
            console.log(
              `[TelegramUserListener] Updates - contains ${(event as any).updates.length} updates`,
            );
          // Process updates inside the Updates container
          for (const update of (event as any).updates) {
            if (update.className === "UpdateNewMessage") {
              originalMessage = update.message;
              message = originalMessage as TelegramMessageExtended;
              if (DEBUG)
                console.log(
                  `[TelegramUserListener] Updates.UpdateNewMessage - chatId=${message?.chatId}`,
                );
              break;
            }
            if (update.className === "UpdateNewChannelMessage") {
              originalMessage = update.message;
              message = originalMessage as TelegramMessageExtended;
              if (DEBUG)
                console.log(
                  `[TelegramUserListener] Updates.UpdateNewChannelMessage - chatId=${message?.chatId}`,
                );
              break;
            }
          }
        } else if (className === "UpdateShort") {
          if (DEBUG)
            console.log(
              `[TelegramUserListener] UpdateShort - update: ${(event as any).update.className}`,
            );
          if ((event as any).update.className === "UpdateNewMessage") {
            originalMessage = (event as any).update.message;
            message = originalMessage as TelegramMessageExtended;
            if (DEBUG)
              console.log(
                `[TelegramUserListener] UpdateShort.UpdateNewMessage - chatId=${message?.chatId}`,
              );
            // Check for AI suffix in new messages - case-insensitive
            const newMsgText = message?.message || "";
            if (newMsgText.toLowerCase().includes(AI_SUFFIX.toLowerCase())) {
              if (DEBUG)
                console.log(
                  "[TelegramUserListener] Skipping AI reply message in UpdateNewMessage",
                );
              return;
            }
          } else if ((event as any).update.className === "UpdateShortMessage") {
            // Check for AI suffix in short messages (e.g., sent via sendMessage)
            const shortMsg = (event as any).update;
            const shortMsgText = shortMsg.message || "";
            if (shortMsgText.toLowerCase().includes(AI_SUFFIX.toLowerCase())) {
              if (DEBUG)
                console.log(
                  "[TelegramUserListener] Skipping AI reply message in UpdateShort",
                );
              return;
            }
          }
        }

        if (!message) {
          return;
        }

        // Check if this is a message sent to "Saved Messages" (self-message)
        // In Telegram, Saved Messages has chatId equal to the user's own ID
        const chatId = message.chatId;
        const userId = me.id;

        // Skip if chatId is undefined
        if (chatId === undefined) {
          return;
        }

        // Convert both to BigInteger for comparison
        // Use String() to normalize the value before passing to bigInt
        const chatIdBigInt = bigInt(String(chatId));
        const userIdBigInt = bigInt(userId);

        if (DEBUG)
          console.log(
            `[TelegramUserListener] Comparing chatId=${chatIdBigInt} with userId=${userIdBigInt}, equals: ${chatIdBigInt.equals(userIdBigInt)}`,
          );

        // Check if this is a self-message (Saved Messages)
        if (chatIdBigInt.equals(userIdBigInt)) {
          const messageText = message.message || "";

          // Skip messages containing AI suffix (our own replies) - case-insensitive
          if (messageText.toLowerCase().includes(AI_SUFFIX.toLowerCase())) {
            if (DEBUG)
              console.log("[TelegramUserListener] Skipping AI reply message");
            return;
          }

          // Once confirmed as self-message with content, immediately send "Received, executing" notification (before workDir/download attachments to ensure user sees it immediately)
          const hasContent = messageText.length > 0 || !!message.media;
          let notificationMessageId: number | null = null;
          if (hasContent) {
            try {
              const notifText = getReceivedAndExecutingMessage(me.langCode);
              const notifResult = await client.sendMessage(chatIdBigInt, {
                message: notifText,
              });
              notificationMessageId =
                typeof notifResult?.id === "number" ? notifResult.id : null;
              if (notificationMessageId != null) {
                if (DEBUG)
                  console.log(
                    "[TelegramUserListener] Sent notification message, ID:",
                    notificationMessageId,
                  );
                // Record notification message ID to prevent loop processing
                this.addOwnSentMessageId(notificationMessageId);
              }
            } catch (err) {
              if (DEBUG)
                console.warn(
                  "[TelegramUserListener] Failed to send notification message:",
                  err,
                );
            }
          }

          // Create workDir early (before file processing)
          const taskId = `telegram-${me.id.toString()}-${Date.now()}`;
          const workDir = createTaskSession(taskId);
          if (DEBUG)
            console.log(`[TelegramUserListener] Created workDir: ${workDir}`);

          // Detect and extract attachments (images AND other files)
          const images: Array<{ data: string; mimeType: string }> = [];
          const fileAttachments: Array<{
            name: string;
            data: string;
            mimeType: string;
          }> = [];

          if (message.media) {
            try {
              let fileName = "";
              let mimeType = "";
              let buffer: Buffer | string | null = null;

              // Check for photo media
              if (originalMessage?.media instanceof Api.MessageMediaPhoto) {
                const downloaded = await client.downloadMedia(originalMessage);
                buffer =
                  Buffer.isBuffer(downloaded) || typeof downloaded === "string"
                    ? downloaded
                    : null;
                mimeType = "image/jpeg";
                fileName = `photo-${Date.now()}.jpg`;

                if (Buffer.isBuffer(buffer)) {
                  // Check size limit (100MB)
                  if (buffer.length > 100 * 1024 * 1024) {
                    if (DEBUG)
                      console.log(
                        `[TelegramUserListener] Photo too large (${(buffer.length / 1024 / 1024).toFixed(2)}MB), skipping`,
                      );
                    buffer = null;
                  } else {
                    const base64 = `data:image/jpeg;base64,${buffer.toString("base64")}`;
                    images.push({ data: base64, mimeType });
                    if (DEBUG)
                      console.log(
                        "[TelegramUserListener] Extracted photo from message",
                      );
                  }
                }
              }
              // Check for document media (PDF, Office docs, images as files, etc.)
              else if (
                originalMessage?.media instanceof Api.MessageMediaDocument
              ) {
                const document = originalMessage.media.document;
                if (document instanceof Api.Document) {
                  mimeType = document.mimeType || "application/octet-stream";

                  // Get filename from document attributes
                  if (document.attributes) {
                    for (const attr of document.attributes) {
                      if (attr instanceof Api.DocumentAttributeFilename) {
                        fileName = attr.fileName;
                        break;
                      }
                    }
                  }

                  // Fallback filename if not found
                  if (!fileName) {
                    const ext = mimeType.split("/")[1] || "bin";
                    fileName = `document-${Date.now()}.${ext}`;
                  }

                  const downloaded =
                    await client.downloadMedia(originalMessage);
                  buffer =
                    Buffer.isBuffer(downloaded) ||
                    typeof downloaded === "string"
                      ? downloaded
                      : null;
                  if (Buffer.isBuffer(buffer)) {
                    if (DEBUG)
                      console.log(
                        `[TelegramUserListener] Downloaded document: ${fileName}, size: ${(buffer.length / 1024).toFixed(2)}KB, type: ${mimeType}`,
                      );

                    // Check size limit (100MB for documents)
                    if (buffer.length > 100 * 1024 * 1024) {
                      if (DEBUG)
                        console.log(
                          `[TelegramUserListener] Document too large (${(buffer.length / 1024 / 1024).toFixed(2)}MB), skipping`,
                        );
                      buffer = null;
                    } else {
                      // For images, also add to images array for vision
                      if (mimeType.startsWith("image/")) {
                        const base64 = `data:${mimeType};base64,${buffer.toString("base64")}`;
                        images.push({ data: base64, mimeType });
                        if (DEBUG)
                          console.log(
                            `[TelegramUserListener] Added image to vision array: ${fileName}`,
                          );
                      }

                      // Add to fileAttachments for Agent to read (Agent will save to disk)
                      const base64 = buffer.toString("base64");
                      fileAttachments.push({
                        name: fileName,
                        data: base64,
                        mimeType,
                      });
                      if (DEBUG)
                        console.log(
                          `[TelegramUserListener] Added file to attachments: ${fileName}`,
                        );
                    }
                  }
                }
              }

              // Note: Files are NOT saved here anymore - Agent SDK will save them
              // This avoids duplicate file saves
            } catch (error) {
              console.error(
                "[TelegramUserListener] Failed to extract attachment:",
                error,
              );
              // Continue processing text even if attachment extraction fails
            }
          }

          // Process if there's text content OR images OR files
          if (
            messageText.length > 0 ||
            images.length > 0 ||
            fileAttachments.length > 0
          ) {
            const attachmentInfo = [
              images.length > 0 ? `${images.length} image(s)` : null,
              fileAttachments.length > 0
                ? `${fileAttachments.length} file(s)`
                : null,
            ]
              .filter(Boolean)
              .join(", ");

            const previewText =
              messageText.length > 0
                ? messageText.substring(0, 50)
                : attachmentInfo || "(attachment)";
            if (DEBUG)
              console.log(
                `[TelegramUserListener] Self-message detected: ${previewText}${attachmentInfo ? ` [${attachmentInfo}]` : ""}...`,
              );

            // Get conversation history
            const conversationHistory =
              telegramConversationStore.getConversationHistory(
                this.userId,
                account.id,
              );

            // Call Agent Runtime with conversation history, images, fileAttachments, userId, and a callback to send the reply
            await handleAgentRuntime(
              messageText.length > 0
                ? messageText
                : `(Attachment: ${attachmentInfo || "file"})`,
              {
                conversation: conversationHistory,
                images: images.length > 0 ? images : undefined,
                fileAttachments:
                  fileAttachments.length > 0 ? fileAttachments : undefined,
                userId: this.userId, // Pass userId for internal API (bypasses auth)
                accountId: account.id, // Account ID for per-day file persistence
                workDir, // Pass work directory to track generated files
                // Add modelConfig for API configuration (needed in Tauri mode)
                ...(this.authToken && {
                  modelConfig: {
                    apiKey: this.authToken, // User's cloud auth token
                    baseUrl: AI_PROXY_BASE_URL, // Local proxy for Tauri mode
                    model: DEFAULT_AI_MODEL, // Default model
                  },
                }),
              },
              async (reply) => {
                try {
                  if (DEBUG) {
                    console.log(
                      "[TelegramUserListener] Raw reply length:",
                      reply.length,
                    );
                    console.log(
                      "[TelegramUserListener] First 200 chars:",
                      reply.slice(0, 200),
                    );
                  }
                  const htmlText = markdownToTelegramHtml(reply);
                  if (DEBUG) {
                    console.log(
                      "[TelegramUserListener] HTML converted length:",
                      htmlText.length,
                    );
                    console.log(
                      "[TelegramUserListener] HTML first 200 chars:",
                      htmlText.slice(0, 200),
                    );
                  }
                  let sentMessageId: number | undefined;
                  // Edit notification message if available, otherwise send new message
                  if (notificationMessageId != null) {
                    try {
                      await client.editMessage(chatIdBigInt, {
                        message: notificationMessageId,
                        text: `${htmlText}\n\n${AI_SUFFIX}`,
                        parseMode: "html",
                      });
                      sentMessageId = notificationMessageId;
                      if (DEBUG)
                        console.log(
                          "[TelegramUserListener] ✓ Edited notification message to reply, ID:",
                          notificationMessageId,
                        );
                    } catch (editErr) {
                      // Edit failed (e.g., message too old), fallback to sending new message
                      if (DEBUG)
                        console.warn(
                          "[TelegramUserListener] Failed to edit notification message, sending new message:",
                          editErr,
                        );
                      const result = await client.sendMessage(chatIdBigInt, {
                        message: `${htmlText}\n\n${AI_SUFFIX}`,
                        parseMode: "html",
                      });
                      sentMessageId =
                        typeof result?.id === "number" ? result.id : undefined;
                      if (DEBUG)
                        console.log(
                          "[TelegramUserListener] ✓ Reply sent successfully (fallback), message ID:",
                          result?.id,
                        );
                    }
                  } else {
                    // No notification message ID, send new message directly
                    const result = await client.sendMessage(chatIdBigInt, {
                      message: `${htmlText}\n\n${AI_SUFFIX}`,
                      parseMode: "html",
                    });
                    sentMessageId =
                      typeof result?.id === "number" ? result.id : undefined;
                    if (DEBUG)
                      console.log(
                        "[TelegramUserListener] ✓ Reply sent successfully, message ID:",
                        result?.id,
                      );
                  }

                  // Record message IDs we sent ourselves, to prevent loop processing
                  if (sentMessageId !== undefined) {
                    this.addOwnSentMessageId(sentMessageId);
                  }

                  // Save user message and assistant reply to conversation store
                  if (messageText.length > 0) {
                    telegramConversationStore.addMessage(
                      this.userId,
                      account.id,
                      "user",
                      messageText,
                    );
                  }
                  telegramConversationStore.addMessage(
                    this.userId,
                    account.id,
                    "assistant",
                    reply,
                  );
                } catch (error) {
                  console.error(
                    "[TelegramUserListener] ✗ Failed to send reply:",
                    error,
                  );
                }
              },
            );

            // After Agent completes, check for generated files and send them
            try {
              const fs = await import("node:fs");
              const path = await import("node:path");

              // Check if work directory exists and contains files
              if (fs.existsSync(workDir)) {
                const files = fs.readdirSync(workDir);
                const generatedFiles = files.filter((f: string) => {
                  const filePath = path.join(workDir, f);
                  const stat = fs.statSync(filePath);
                  return stat.isFile() && !f.startsWith(".");
                });

                if (generatedFiles.length > 0) {
                  if (DEBUG)
                    console.log(
                      `[TelegramUserListener] Found ${generatedFiles.length} generated files, sending to user...`,
                    );

                  for (const file of generatedFiles) {
                    const filePath = path.join(workDir, file);
                    try {
                      if (DEBUG)
                        console.log(
                          `[TelegramUserListener] Sending file: ${file}`,
                        );

                      const result = await client.sendFile(chatIdBigInt, {
                        file: filePath,
                        caption: `📄 ${file}`,
                      });

                      // Record file message ID to prevent loop processing
                      if (result?.id !== undefined) {
                        this.addOwnSentMessageId(result.id);
                      }

                      if (DEBUG)
                        console.log(
                          `[TelegramUserListener] ✓ File sent successfully, message ID: ${result?.id}`,
                        );
                    } catch (error) {
                      console.error(
                        `[TelegramUserListener] ✗ Failed to send file ${file}:`,
                        error,
                      );
                    }
                  }
                }
              }
            } catch (error) {
              console.error(
                "[TelegramUserListener] Error checking for generated files:",
                error,
              );
            }
          }
        }
      } catch (error) {
        console.error("[TelegramUserListener] Error handling message:", error);
      }
    });
  }

  /**
   * Start polling mode (as alternative to event-driven)
   * Periodically check for new messages in Saved Messages
   */
  private startPolling(
    client: TelegramClient,
    accountId: string,
    account: IntegrationAccount,
    me: Api.User,
  ): void {
    const chatIdBigInt = bigInt(me.id);

    if (DEBUG)
      console.log(
        `[TelegramUserListener] [${accountId}] Polling: Getting initial message ID from chat ${chatIdBigInt}...`,
      );

    // First get the latest message ID as starting point
    client
      .getMessages(chatIdBigInt, { limit: 1 })
      .then((messages) => {
        if (messages.length > 0) {
          const latestMsg = messages[0];
          if (latestMsg?.id) {
            this.lastProcessedMessageIds.set(accountId, latestMsg.id);
            if (DEBUG)
              console.log(
                `[TelegramUserListener] [${accountId}] Polling: Starting from message ID ${latestMsg.id}`,
              );
          }
        }
      })
      .catch((err) => {
        console.error(
          `[TelegramUserListener] [${accountId}] Failed to get initial message ID:`,
          err,
        );
      });

    // Start polling timer
    // Clear old timers first to prevent accumulation
    const existingTimer = this.pollingTimers.get(accountId);
    if (existingTimer) {
      clearInterval(existingTimer);
      this.pollingTimers.delete(accountId);
    }

    let pollCount = 0;
    const timer = setInterval(async () => {
      pollCount++;
      try {
        // Check connection status, reconnect if disconnected
        if (!client.connected) {
          try {
            await client.connect();
          } catch (connectErr) {
            return; // Wait for next retry
          }
        }

        // Get latest messages (max 10)
        const messages = await client.getMessages(chatIdBigInt, { limit: 10 });
        const lastProcessedId =
          this.lastProcessedMessageIds.get(accountId) ?? 0;

        // Process messages from old to new
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          // Only process new messages
          if (msg.id > lastProcessedId && msg instanceof Api.Message) {
            // Skip messages we sent ourselves (notifications and AI replies)
            if (this.ownSentMessageIds.has(msg.id)) {
              this.lastProcessedMessageIds.set(accountId, msg.id);
              continue;
            }

            this.lastProcessedMessageIds.set(accountId, msg.id);

            // Update lastEventTime for watchdog
            this.lastEventTime.set(accountId, Date.now());

            // Process message - reuse existing processing logic
            await this.processMessage(
              client,
              accountId,
              account,
              me,
              chatIdBigInt,
              msg,
            );
          }
        }
      } catch (error) {
        console.error(
          `[TelegramUserListener] [${accountId}] Polling error:`,
          error,
        );
      }
    }, this.POLLING_INTERVAL_MS);

    this.pollingTimers.set(accountId, timer);
    if (DEBUG)
      console.log(
        `[TelegramUserListener] [${accountId}] Polling started (interval: ${this.POLLING_INTERVAL_MS}ms)`,
      );
  }

  /**
   * Process single message (shared by event-driven and polling modes)
   */
  private async processMessage(
    client: TelegramClient,
    accountId: string,
    account: IntegrationAccount,
    me: Api.User,
    chatIdBigInt: bigInt.BigInteger,
    message: Api.Message,
  ): Promise<void> {
    const messageText = message.message || "";

    const hasContent = messageText.length > 0 || !!message.media;

    if (!hasContent) {
      return;
    }

    // Skip messages containing AI suffix (our own replies) - case-insensitive
    if (messageText.toLowerCase().includes(AI_SUFFIX.toLowerCase())) {
      if (DEBUG)
        console.log(
          "[TelegramUserListener] Skipping AI reply message in poll mode",
        );
      return;
    }

    // Send "Received, executing" notification
    let notificationMessageId: number | null = null;
    try {
      const notifText = getReceivedAndExecutingMessage(me.langCode);
      const notifResult = await client.sendMessage(chatIdBigInt, {
        message: notifText,
      });
      notificationMessageId =
        typeof notifResult?.id === "number" ? notifResult.id : null;
      // Record notification message ID to prevent loop processing
      if (notificationMessageId !== null) {
        this.addOwnSentMessageId(notificationMessageId);
      }
    } catch {
      // Ignore notification send failure
    }

    // Create workDir
    const taskId = `telegram-${me.id.toString()}-${Date.now()}`;
    const workDir = createTaskSession(taskId);

    // Detect and extract attachments
    const images: Array<{ data: string; mimeType: string }> = [];
    const fileAttachments: Array<{
      name: string;
      data: string;
      mimeType: string;
    }> = [];

    if (message.media) {
      try {
        // Handle photo media
        if (message.media instanceof Api.MessageMediaPhoto) {
          const downloaded = await client.downloadMedia(message);
          const buffer =
            Buffer.isBuffer(downloaded) || typeof downloaded === "string"
              ? downloaded
              : null;
          if (Buffer.isBuffer(buffer) && buffer.length <= 100 * 1024 * 1024) {
            const base64 = `data:image/jpeg;base64,${buffer.toString("base64")}`;
            images.push({ data: base64, mimeType: "image/jpeg" });
          }
        }
        // Handle document media
        else if (message.media instanceof Api.MessageMediaDocument) {
          const document = message.media.document;
          if (document instanceof Api.Document) {
            const mimeType = document.mimeType || "application/octet-stream";
            let fileName = `document-${Date.now()}`;

            for (const attr of document.attributes || []) {
              if (attr instanceof Api.DocumentAttributeFilename) {
                fileName = attr.fileName;
                break;
              }
            }

            const downloaded = await client.downloadMedia(message);
            const buffer =
              Buffer.isBuffer(downloaded) || typeof downloaded === "string"
                ? downloaded
                : null;

            if (Buffer.isBuffer(buffer) && buffer.length <= 100 * 1024 * 1024) {
              if (mimeType.startsWith("image/")) {
                const base64 = `data:${mimeType};base64,${buffer.toString("base64")}`;
                images.push({ data: base64, mimeType });
              }

              const base64 = buffer.toString("base64");
              fileAttachments.push({
                name: fileName,
                data: base64,
                mimeType,
              });
            }
          }
        }
      } catch (error) {
        console.error(
          "[TelegramUserListener] Failed to extract attachment:",
          error,
        );
      }
    }

    // Get conversation history
    const conversationHistory =
      telegramConversationStore.getConversationHistory(this.userId, account.id);

    // Call Agent Runtime
    await handleAgentRuntime(
      messageText.length > 0
        ? messageText
        : `(Attachment: ${images.length > 0 ? "image" : "file"})`,
      {
        conversation: conversationHistory,
        images: images.length > 0 ? images : undefined,
        fileAttachments:
          fileAttachments.length > 0 ? fileAttachments : undefined,
        userId: this.userId,
        accountId: account.id, // Account ID for per-day file persistence
        workDir,
        // Add modelConfig for API configuration (needed in Tauri mode)
        ...(this.authToken && {
          modelConfig: {
            apiKey: this.authToken, // User's cloud auth token
            baseUrl: AI_PROXY_BASE_URL, // Local proxy for Tauri mode
            model: DEFAULT_AI_MODEL, // Default model
          },
        }),
      },
      async (reply) => {
        try {
          if (DEBUG) {
            console.log(
              "[TelegramUserListener] Raw reply length:",
              reply.length,
            );
          }
          const htmlText = markdownToTelegramHtml(reply);
          if (DEBUG) {
            console.log(
              "[TelegramUserListener] HTML converted length:",
              htmlText.length,
            );
          }
          let sentMessageId: number | undefined;

          // Edit notification message to reply
          if (notificationMessageId != null) {
            try {
              await client.editMessage(chatIdBigInt, {
                message: notificationMessageId,
                text: `${htmlText}\n\n${AI_SUFFIX}`,
                parseMode: "html",
              });
              sentMessageId = notificationMessageId;
            } catch {
              // Edit failed, send new message
              const result = await client.sendMessage(chatIdBigInt, {
                message: `${htmlText}\n\n${AI_SUFFIX}`,
                parseMode: "html",
              });
              sentMessageId =
                typeof result?.id === "number" ? result.id : undefined;
            }
          } else {
            const result = await client.sendMessage(chatIdBigInt, {
              message: `${htmlText}\n\n${AI_SUFFIX}`,
              parseMode: "html",
            });
            sentMessageId =
              typeof result?.id === "number" ? result.id : undefined;
          }

          // Record message IDs we sent ourselves, to prevent loop processing
          if (sentMessageId !== undefined) {
            this.addOwnSentMessageId(sentMessageId);
          }

          // Save to conversation store
          if (messageText.length > 0) {
            telegramConversationStore.addMessage(
              this.userId,
              account.id,
              "user",
              messageText,
            );
          }
          telegramConversationStore.addMessage(
            this.userId,
            account.id,
            "assistant",
            reply,
          );
        } catch (error) {
          console.error("[TelegramUserListener] Failed to send reply:", error);
        }
      },
    );

    // Check for generated files and send them
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");

      if (fs.existsSync(workDir)) {
        const files = fs.readdirSync(workDir);
        const generatedFiles = files.filter((f: string) => {
          const filePath = path.join(workDir, f);
          const stat = fs.statSync(filePath);
          return stat.isFile() && !f.startsWith(".");
        });

        for (const file of generatedFiles) {
          const filePath = path.join(workDir, file);
          try {
            const result = await client.sendFile(chatIdBigInt, {
              file: filePath,
              caption: `📄 ${file}`,
            });

            // Record file message ID to prevent loop processing
            if (result?.id !== undefined) {
              this.addOwnSentMessageId(result.id);
            }
          } catch (error) {
            console.error(
              `[TelegramUserListener] Failed to send file ${file}:`,
              error,
            );
          }
        }
      }
    } catch (error) {
      console.error(
        "[TelegramUserListener] Error checking for generated files:",
        error,
      );
    }
  }

  /**
   * Start watchdog timer to detect if connection is stale
   * If connection state is "connected" but no events received beyond STALE_THRESHOLD_MS,
   * consider connection broken by external factors (e.g., session conflict), force reconnection.
   */
  private startWatchdog(accountId: string, account: IntegrationAccount): void {
    // Clean up existing watchdog
    this.stopWatchdog(accountId);

    const timer = setInterval(async () => {
      const lastTime = this.lastEventTime.get(accountId) ?? 0;
      const elapsed = Date.now() - lastTime;
      const connState = this.connectionState.get(accountId);

      // Only trigger reconnection when connection state is "connected" and elapsed time exceeds threshold without receiving events
      if (connState === "connected" && elapsed > this.STALE_THRESHOLD_MS) {
        if (DEBUG)
          console.warn(
            `[TelegramUserListener] [${accountId}] Watchdog: Connection stale ${Math.round(elapsed / 1000)}s no events received, forcing reconnection...`,
          );

        // Stop current watchdog (new one will start after successful reconnection)
        this.stopWatchdog(accountId);

        // Disconnect old connection
        const oldClient = this.clients.get(accountId);
        if (oldClient) {
          try {
            await oldClient.disconnect();
          } catch (e) {
            // Ignore disconnect errors
          }
          this.clients.delete(accountId);
        }

        // Reset connection state
        this.connectionState.delete(accountId);
        this.reconnectAttempts.delete(accountId);

        // Initiate reconnection
        try {
          await this.connectAccount(account);
          if (DEBUG)
            console.log(
              `[TelegramUserListener] [${accountId}] Watchdog: Reconnection successful`,
            );
        } catch (err) {
          console.error(
            `[TelegramUserListener] [${accountId}] Watchdog: Reconnection failed, delegating to handleConnectionError`,
            err,
          );
          this.handleConnectionError(accountId, err, account);
        }
      }
    }, this.WATCHDOG_INTERVAL_MS);

    this.watchdogTimers.set(accountId, timer);
    if (DEBUG)
      console.log(
        `[TelegramUserListener] [${accountId}] Watchdog started (interval ${this.WATCHDOG_INTERVAL_MS / 1000}s, threshold ${this.STALE_THRESHOLD_MS / 1000}s)`,
      );
  }

  /**
   * Stop watchdog for specified accountId
   */
  private stopWatchdog(accountId: string): void {
    const existing = this.watchdogTimers.get(accountId);
    if (existing) {
      clearInterval(existing);
      this.watchdogTimers.delete(accountId);
    }
  }

  /**
   * Stop all clients and clean up
   */
  async stop(): Promise<void> {
    if (DEBUG)
      console.log(`[TelegramUserListener] Stopping for user ${this.userId}`);

    // Clean up all watchdog timers
    for (const [accountId] of this.watchdogTimers.entries()) {
      this.stopWatchdog(accountId);
    }
    this.watchdogTimers.clear();
    this.lastEventTime.clear();

    // Clean up all polling timers
    for (const [accountId, timer] of this.pollingTimers.entries()) {
      clearInterval(timer);
      if (DEBUG)
        console.log(
          `[TelegramUserListener] Cleared polling timer for ${accountId}`,
        );
    }
    this.pollingTimers.clear();
    this.lastProcessedMessageIds.clear();

    // Clear all reconnection timers
    for (const [accountId, timer] of this.reconnectTimers.entries()) {
      clearTimeout(timer);
      if (DEBUG)
        console.log(
          `[TelegramUserListener] Cleared reconnection timer for ${accountId}`,
        );
    }
    this.reconnectTimers.clear();
    this.reconnectAttempts.clear();
    this.connectionState.clear(); // Also clear connection states

    // Disconnect all clients
    for (const [accountId, client] of this.clients.entries()) {
      try {
        if (DEBUG)
          console.log(
            `[TelegramUserListener] Disconnecting account ${accountId}...`,
          );
        await client.disconnect();
      } catch (error) {
        console.error(
          `[TelegramUserListener] Error disconnecting account ${accountId}:`,
          error,
        );
      }
    }

    this.clients.clear();
    this.accounts.clear();
  }

  /**
   * Handle connection error with exponential backoff reconnection
   */
  private async handleConnectionError(
    accountId: string,
    _error: unknown,
    account: IntegrationAccount,
  ): Promise<void> {
    const attempts = this.reconnectAttempts.get(accountId) || 0;

    if (attempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[TelegramUserListener] Max reconnection attempts reached for account ${accountId}. Giving up.`,
      );
      this.reconnectAttempts.delete(accountId);
      return;
    }

    // Calculate exponential backoff delay: 5s, 10s, 20s, 40s, 80s
    const backoffDelay = 5000 * 2 ** attempts;

    if (DEBUG)
      console.log(
        `[TelegramUserListener] Scheduling reconnection for account ${accountId} in ${backoffDelay / 1000}s (attempt ${attempts + 1}/${this.MAX_RECONNECT_ATTEMPTS})`,
      );
    if (DEBUG)
      console.log(
        `[TelegramUserListener] Will attempt to reconnect at ${new Date(Date.now() + backoffDelay).toLocaleTimeString()}`,
      );

    // Clear any existing reconnection timer for this account
    const existingTimer = this.reconnectTimers.get(accountId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new reconnection timer
    const timer = setTimeout(async () => {
      if (DEBUG)
        console.log(
          `[TelegramUserListener] Attempting to reconnect account ${accountId}...`,
        );

      try {
        // Disconnect old client if exists
        const oldClient = this.clients.get(accountId);
        if (oldClient) {
          try {
            await oldClient.disconnect();
          } catch (e) {
            // Ignore disconnect errors
          }
        }

        // Attempt reconnection
        await this.connectAccount(account);

        // Successfully reconnected - reset attempts and connection state
        this.reconnectAttempts.delete(accountId);
        this.reconnectTimers.delete(accountId);
        this.connectionState.set(accountId, "connected"); // Reset connection state

        if (DEBUG)
          console.log(
            `[TelegramUserListener] Successfully reconnected account ${accountId}`,
          );
      } catch (reconnectError) {
        console.error(
          `[TelegramUserListener] Reconnection failed for account ${accountId}:`,
          reconnectError,
        );

        // Increment attempt counter and retry
        this.reconnectAttempts.set(accountId, attempts + 1);
        await this.handleConnectionError(accountId, reconnectError, account);
      }
    }, backoffDelay);

    this.reconnectTimers.set(accountId, timer);
  }
}

// Global registry of user listeners
const userListeners = new Map<string, TelegramUserListener>();

/**
 * Start User Listener for a specific user
 */
export async function startTelegramUserListener(
  userId: string,
  authToken?: string, // Cloud auth token for API configuration
): Promise<void> {
  // Stop existing listener if any
  if (userListeners.has(userId)) {
    if (DEBUG)
      console.log(
        `[TelegramUserListener] Stopping existing listener for user ${userId}`,
      );
    await stopTelegramUserListener(userId);
  }

  const listener = new TelegramUserListener({
    userId,
    authToken,
  });

  userListeners.set(userId, listener);
  await listener.start();
}

/**
 * Stop User Listener for a specific user
 */
export async function stopTelegramUserListener(userId: string): Promise<void> {
  const listener = userListeners.get(userId);
  if (listener) {
    await listener.stop();
    userListeners.delete(userId);
  }
}

/**
 * Check if User Listener is running for a user
 */
export function isUserListenerRunning(userId: string): boolean {
  return userListeners.has(userId);
}

/**
 * Get active listener's connected client by session key
 * For TelegramAdapter reuse, avoid creating multiple MTProto connections for same session causing conflicts
 */
export function getActiveListenerClientBySession(
  sessionKey: string,
): TelegramClient | undefined {
  for (const [, listener] of userListeners) {
    const client = listener.getClientBySessionKey(sessionKey);
    if (client) return client;
  }
  return undefined;
}
