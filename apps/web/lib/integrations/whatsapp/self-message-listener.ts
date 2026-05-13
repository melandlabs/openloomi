/**
 * WhatsApp Self Message Listener
 *
 * Uses an in-memory store + real-time events to detect Note to Self messages.
 * Baileys v7 removed the built-in makeInMemoryStore, so we implement a minimal
 * one ourselves that captures messages via messages.upsert events.
 */

import { loadIntegrationCredentials } from "@/lib/db/queries";
import { getIntegrationAccountsByUserId } from "@/lib/db/queries";
import { WhatsAppAdapter, activeAdapters } from "@/lib/integrations/whatsapp";
import type { WASocket } from "@whiskeysockets/baileys";
import type { WAMessage } from "@whiskeysockets/baileys/lib/Types/Message";
import { downloadMediaMessage } from "@whiskeysockets/baileys/lib/Utils/messages";
import { whatsappClientRegistry } from "./client-registry";
import { handleAgentRuntime } from "./runtime";
import { WhatsAppConversationStore } from "@openloomi/integrations/whatsapp/conversation-store";
import { getAppMemoryDir } from "@/lib/utils/path";
import { markdownToWhatsApp } from "@openloomi/integrations/whatsapp/markdown";
import { createTaskSession } from "@/lib/files/workspace/sessions";
import { DEFAULT_AI_MODEL, AI_PROXY_BASE_URL } from "@/lib/env/constants";

// Singleton instance for WhatsApp conversation history
const whatsappConversationStore = new WhatsAppConversationStore(
  getAppMemoryDir(),
);

const AI_SUFFIX = "(By openloomi AI)";
const WHATSAPP_MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const POLL_INTERVAL_MS = 3000;
const POLL_MESSAGE_COUNT = 10;

/**
 * Minimal in-memory store for Baileys v7.
 * Baileys v7 removed makeInMemoryStore, so we implement a simple one that
 * captures messages via messages.upsert events and provides loadMessages.
 * Capped at MAX_MESSAGES_PER_JID to prevent memory overflow.
 */
const MAX_MESSAGES_PER_JID = 500;

class InMemoryStore {
  private messages: Map<string, WAMessage[]> = new Map();

  /**
   * Attach event listeners to a WASocket to populate the store.
   */
  attach(sock: WASocket): void {
    sock.ev.on("messages.upsert", ({ messages }) => {
      this.addMessages(messages);
    });

    sock.ev.on("chats.upsert", (chats) => {
      for (const chat of chats) {
        if (!chat.id) continue;
        if (!this.messages.has(chat.id)) {
          this.messages.set(chat.id, []);
        }
      }
    });
  }

  /**
   * Add an array of messages to the store. Used to populate historical
   * messages from messaging-history.set events.
   */
  addMessages(msgs: WAMessage[]): void {
    for (const msg of msgs) {
      const jid = msg.key.remoteJid;
      if (!jid) continue;
      const existing = this.messages.get(jid) ?? [];
      if (!existing.some((m) => m.key.id === msg.key.id)) {
        existing.push(msg);
        if (existing.length > MAX_MESSAGES_PER_JID) {
          existing.splice(0, existing.length - MAX_MESSAGES_PER_JID);
        }
        this.messages.set(jid, existing);
      }
    }
  }

  /**
   * Load messages for a given JID (chat).
   */
  async loadMessages(
    jid: string,
    count: number,
    _opts: object,
  ): Promise<WAMessage[]> {
    const msgs = this.messages.get(jid) ?? [];
    return msgs.slice(-count);
  }
}

interface SelfMessageListenerConfig {
  userId: string;
  authToken?: string;
}

interface AccountListener {
  sock: WASocket;
  adapter?: WhatsAppAdapter;
  pollInterval?: ReturnType<typeof setInterval>;
  lastSeenMsgId?: string;
  /** Use Long | number to match v7 messageTimestamp type (proto.IWebMessageInfo.messageTimestamp) */
  lastSeenMsgTimestamp?: number | null;
  accountId: string;
  /** In-memory store for message history (Baileys v7 removed the built-in store) */
  store: InMemoryStore;
  /** IDs of AI-sent file messages — used to skip recursive processing */
  sentFileMsgIds: Set<string>;
  /** IDs of already-processed messages — immediate deduplication before processing */
  processedMsgIds: Set<string>;
}

class WhatsAppSelfMessageListener {
  private userId: string;
  private authToken?: string;
  private accountListeners: Map<string, AccountListener> = new Map();

  constructor(config: SelfMessageListenerConfig) {
    this.userId = config.userId;
    this.authToken = config.authToken;
  }

  async start(): Promise<void> {
    console.log(`[WhatsAppSelfListener] Starting for user ${this.userId}`);

    const allAccounts = await getIntegrationAccountsByUserId({
      userId: this.userId,
    });

    const accounts = allAccounts.filter((acc) => acc.platform === "whatsapp");

    if (!accounts || accounts.length === 0) {
      console.log(
        `[WhatsAppSelfListener] No WhatsApp accounts found for user ${this.userId}`,
      );
      return;
    }

    console.log(
      `[WhatsAppSelfListener] Found ${accounts.length} WhatsApp account(s)`,
    );

    for (const account of accounts) {
      const sessionKey = (account.metadata as Record<string, unknown>)
        ?.sessionKey as string | undefined;
      const credentials = loadIntegrationCredentials<{ sessionKey?: string }>(
        account,
      );
      const credSessionKey = credentials?.sessionKey;
      const sk = sessionKey ?? credSessionKey;

      // Find existing socket: match the insight bot's lookup order:
      // 1. whatsappClientRegistry (registered when connection opens)
      // 2. activeAdapters (QR adapter's socket)
      let existingSock = whatsappClientRegistry.get(account.id);
      if (!existingSock) {
        const adapter = activeAdapters.get(account.id);
        if (adapter?.sock) existingSock = adapter.sock || undefined;
      }
      // Don't reuse a closed socket (stop() may have killed the adapter).
      if (existingSock && (existingSock as any).ws?.readyState !== 1) {
        console.log(
          `[WhatsAppSelfListener] Existing socket for ${account.id} is closed (readyState=${(existingSock as any).ws?.readyState}), not reusing`,
        );
        existingSock = undefined;
      }
      if (existingSock) {
        console.log(
          `[WhatsAppSelfListener] Found existing socket for ${account.id} (sock.user=${existingSock.user?.id}), reusing via attachToSocket`,
        );
        // Reuse the existing socket with attachToSocket — same pattern as the insight bot.
        // This prevents creating a second socket which would steal WhatsApp message delivery.
        const adapter = new WhatsAppAdapter({
          botId: account.id,
          sessionKey: sk,
        });
        adapter.attachToSocket(existingSock);
        void this.startListening(account.id, existingSock, adapter);
        continue;
      }

      // No existing socket — create one (same as before)
      console.log(
        `[WhatsAppSelfListener] No socket in registry for ${account.id}, creating adapter (will call startSocket → createSocket)`,
      );
      let adapter: WhatsAppAdapter;
      try {
        adapter = new WhatsAppAdapter({
          botId: account.id,
          sessionKey: sk,
        });
        // Set activeAdapters BEFORE startSocket() so the bot can find the adapter
        // immediately (even if sock is not ready yet) and await its initialization.
        activeAdapters.set(account.id, adapter);
        const sock = await adapter.startSocket();
        void this.startListening(account.id, sock, adapter);
      } catch (error) {
        console.error(
          `[WhatsAppSelfListener] Failed to create socket for ${account.id}:`,
          error,
        );
      }
    }
  }

  /**
   * Set up socket event listeners for self-message detection.
   * Called after socket is ready (either reused or newly created).
   */
  private startListening(
    accountId: string,
    sock: WASocket,
    adapter: WhatsAppAdapter,
  ): void {
    // Create in-memory store and attach to socket so loadMessages works.
    // Baileys v7 removed the built-in makeInMemoryStore, so we use our own.
    const store = new InMemoryStore();
    store.attach(sock);
    // Expose store on the socket so the bot (via WhatsAppAdapter) can call
    // sock.store.loadMessages() when reading chat history.
    (sock as any).store = store;
    console.log(
      `[WhatsAppSelfListener] [${accountId}] InMemoryStore attached and set on sock.store, sock.ev exists: ${!!sock.ev}`,
    );

    // Shared message processing helper used by both messages.upsert and messaging-history.set
    const processMessages = (messages: WAMessage[], source: string) => {
      const currentSock = whatsappClientRegistry.get(accountId);
      if (currentSock && currentSock !== sock) {
        console.log(
          `[WhatsAppSelfListener] [${accountId}] Stale socket handler, skipping ${source}`,
        );
        return;
      }
      const listener = this.accountListeners.get(accountId);
      for (const msg of messages) {
        const jid = msg.key.remoteJid || "(none)";
        const fromMe = msg.key.fromMe ?? false;
        const msgId = msg.key.id ?? "";
        const participant = msg.key.participant || "(none)";
        console.log(
          `[WhatsAppSelfListener] [${accountId}] MSG [${source}]: jid=${jid} participant=${participant} fromMe=${fromMe} id=${msgId}`,
        );

        // Skip messages sent to others — only process Note to Self (fromMe + own JID)
        if (!fromMe) continue;
        const myJid = currentSock?.user?.id;
        if (myJid && jid !== myJid) continue;

        // Immediate deduplication: check Set BEFORE processing to handle rapid
        // duplicate deliveries (e.g. messages.upsert + messaging-history.set).
        if (listener?.processedMsgIds.has(msgId)) {
          console.log(
            `[WhatsAppSelfListener] [${accountId}] Skipping already-processed msg id=${msgId}`,
          );
          continue;
        }

        // Mark as processed immediately — before handleIncomingMessage runs
        listener?.processedMsgIds.add(msgId);

        // Skip already-seen messages (deduplicate with polling)
        if (listener?.lastSeenMsgId && msgId === listener.lastSeenMsgId) {
          continue;
        }

        // Skip AI-sent file messages to prevent recursive processing
        if (listener?.sentFileMsgIds.has(msgId)) {
          console.log(
            `[WhatsAppSelfListener] [${accountId}] Skipping AI-sent file msg id=${msgId}`,
          );
          continue;
        }

        // Skip our own AI replies
        const text = this.extractText(msg);
        if (text.includes(AI_SUFFIX)) continue;

        console.log(
          `[WhatsAppSelfListener] [${accountId}] Self-message detected [${source}]: id=${msgId}, text=${text.substring(0, 50)}`,
        );

        // Process immediately
        this.handleIncomingMessage(msg, accountId, sock);

        // Update lastSeenMsgId so the polling loop skips this message
        if (listener && !listener.lastSeenMsgId) {
          listener.lastSeenMsgId = msgId;
          listener.lastSeenMsgTimestamp = Number(msg.messageTimestamp);
        }
      }
      // Advance lastSeenMsgId to the newest message so polling starts after it
      const newest = messages[messages.length - 1];
      if (newest?.key.id && listener) {
        listener.lastSeenMsgId = newest.key.id;
        listener.lastSeenMsgTimestamp = Number(newest.messageTimestamp);
      }
    };

    // Real-time incoming messages — always process (the existing lastSeenMsgId check
    // inside processMessages deduplicates against messages already seen).
    sock.ev.on("messages.upsert", (data) => {
      console.log(
        `[WhatsAppSelfListener] [${accountId}] *** messages.upsert FIRED! type=${data.type} count=${data.messages.length} sock.user=${sock.user?.id}`,
      );
      for (const msg of data.messages) {
        console.log(
          `[WhatsAppSelfListener] [${accountId}] upsert msg: jid=${msg.key.remoteJid} fromMe=${msg.key.fromMe} id=${msg.key.id}`,
        );
      }
      processMessages(data.messages, "upsert");
    });

    // History sync — update lastSeenMsgId to the newest history message if it is
    // newer than what messages.upsert has already set (compare by timestamp).
    // This ensures polling starts after all history, regardless of event ordering.
    sock.ev.on("messaging-history.set", (data) => {
      const currentSock = whatsappClientRegistry.get(accountId);
      if (currentSock && currentSock !== sock) {
        console.log(
          `[WhatsAppSelfListener] [${accountId}] Stale socket handler, skipping messaging-history.set`,
        );
        return;
      }
      console.log(
        `[WhatsAppSelfListener] [${accountId}] *** messaging-history.set FIRED! chats=${data.chats.length} msgs=${data.messages.length} isLatest=${data.isLatest}`,
      );

      // Populate the InMemoryStore with historical messages so getChatsByChunk
      // (insight bot) can read them via store.loadMessages().
      // messages.upsert only fires for real-time messages; historical messages
      // come through messaging-history.set instead.
      const listener = this.accountListeners.get(accountId);
      if (listener?.store) {
        listener.store.addMessages(data.messages);
        console.log(
          `[WhatsAppSelfListener] [${accountId}] InMemoryStore populated with ${data.messages.length} history messages`,
        );
      } else {
        console.log(
          `[WhatsAppSelfListener] [${accountId}] No store found on listener yet, skipping history population`,
        );
      }
      const newest = data.messages[data.messages.length - 1];
      if (newest?.key.id && newest?.messageTimestamp && listener) {
        const historyTs = Number(newest.messageTimestamp);
        const currentTs = listener.lastSeenMsgTimestamp ?? 0;
        if (historyTs > currentTs) {
          listener.lastSeenMsgId = newest.key.id;
          listener.lastSeenMsgTimestamp = historyTs;
          console.log(
            `[WhatsAppSelfListener] [${accountId}] Advanced lastSeenMsgId=${newest.key.id} ts=${historyTs} from messaging-history.set`,
          );
        } else {
          console.log(
            `[WhatsAppSelfListener] [${accountId}] Skipping lastSeenMsgId advance — existing ts=${currentTs} >= history ts=${historyTs}`,
          );
        }
      }
      // After restart, the in-memory store is empty. Manually trigger app state sync
      // to repopulate it with all chats and messages. This ensures messages.upsert
      // (skipped for history) and messaging-history.set fire with complete data.
      const sockExtra = sock as unknown as {
        resyncAppState?: (
          collections: string[],
          isInitialSync: boolean,
        ) => Promise<void>;
      };
      sockExtra.resyncAppState?.(
        [
          "critical_block",
          "critical_unblock_low",
          "regular_high",
          "regular_low",
          "regular",
        ],
        true,
      );

      // Add history message IDs to processedMsgIds so they won't be processed
      // again if messages.upsert fires for the same messages later.
      // Also prune to prevent unbounded growth.
      if (listener) {
        for (const msg of data.messages) {
          if (msg.key.id) {
            listener.processedMsgIds.add(msg.key.id);
          }
        }
        if (listener.processedMsgIds.size > 1000) {
          // Keep only the 500 most recent
          const arr = [...listener.processedMsgIds];
          listener.processedMsgIds = new Set(arr.slice(-500));
        }
      }
    });

    // Verify the messages.upsert listener is attached by checking sock.ev listener count
    const listenerCount =
      (sock.ev as any).events?.["messages.upsert"]?.length ?? "unknown";
    console.log(
      `[WhatsAppSelfListener] [${accountId}] messages.upsert listener count: ${listenerCount}`,
    );

    this.startPolling(accountId, sock, store, adapter);
  }

  private startPolling(
    accountId: string,
    sock: WASocket,
    store: InMemoryStore,
    adapter?: WhatsAppAdapter,
  ): void {
    console.log(
      `[WhatsAppSelfListener] Starting polling for account ${accountId}, sock.user=${sock.user?.id}, POLL_INTERVAL=${POLL_INTERVAL_MS}ms`,
    );

    const pollInterval = setInterval(async () => {
      try {
        await this.pollForSelfMessages(accountId, sock, store);
      } catch (error) {
        console.error(
          `[WhatsAppSelfListener] [${accountId}] Poll error:`,
          error,
        );
      }
    }, POLL_INTERVAL_MS);

    this.accountListeners.set(accountId, {
      sock,
      adapter,
      pollInterval,
      accountId,
      store,
      sentFileMsgIds: new Set(),
      processedMsgIds: new Set(),
    });

    // Run first poll immediately
    void this.pollForSelfMessages(accountId, sock, store);
  }

  private async pollForSelfMessages(
    accountId: string,
    sock: WASocket,
    store: InMemoryStore,
  ): Promise<void> {
    const listener = this.accountListeners.get(accountId);

    // Always look up the socket from the registry — it may have been replaced
    // by the insights bot (which creates a new WhatsAppAdapter + socket).
    const currentSock = whatsappClientRegistry.get(accountId) ?? listener?.sock;

    if (!currentSock) return;

    const myJid = currentSock.user?.id;
    if (!myJid) {
      console.log(
        `[WhatsAppSelfListener] [${accountId}] sock.user is not set yet, skipping poll`,
      );
      return;
    }

    // Detect socket swap and update stored references so we use the live socket.
    // IMPORTANT: Each Baileys socket has its own ev EventEmitter, so event listeners
    // registered on the old socket won't fire for the new socket. We must re-register
    // the messages.upsert and messaging-history.set listeners on the new socket.
    if (currentSock !== listener?.sock) {
      console.log(
        `[WhatsAppSelfListener] [${accountId}] Socket changed (${listener?.sock ? "old sock !== new sock" : "first socket"}), re-registering event listeners on new socket`,
      );
      if (listener?.adapter) {
        // Re-register the adapter's internal listeners on the new socket
        listener.adapter.setupListenersOnSocket(currentSock);
      }
      if (listener) {
        listener.sock = currentSock;
        if (listener.adapter) (listener.adapter as any).sock = currentSock;
        // Also re-attach our InMemoryStore to the new socket
        listener.store.attach(currentSock);
      }
    }

    const lastSeenMsgId = listener?.lastSeenMsgId;

    try {
      const messages: WAMessage[] = await store.loadMessages(
        myJid,
        POLL_MESSAGE_COUNT,
        {},
      );

      if (!messages || messages.length === 0) {
        return;
      }

      // Process messages newest-first
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        const msgId = msg.key.id;

        if (!msgId) continue;

        // Skip if we've already seen this message
        if (lastSeenMsgId && msgId === lastSeenMsgId) {
          break;
        }

        // Skip our own AI reply (has AI suffix)
        const text = this.extractText(msg);
        if (text.includes(AI_SUFFIX)) continue;

        // Only process messages sent by us (self-chat)
        const isFromMe = msg.key.fromMe ?? false;
        if (!isFromMe) continue;
        // Only process Note to Self (messages sent to our own JID)
        const msgRemoteJid = msg.key.remoteJid || "";
        if (msgRemoteJid !== myJid) continue;

        this.handleIncomingMessage(msg, accountId, currentSock);

        // Update last seen (first one wins as we go newest-first)
        if (listener && !listener.lastSeenMsgId) {
          listener.lastSeenMsgId = msgId;
          listener.lastSeenMsgTimestamp = Number(msg.messageTimestamp);
        }
      }

      // Update lastSeenMsgId to the newest message we've processed
      const newestMsg = messages[messages.length - 1];
      if (newestMsg?.key.id && listener) {
        listener.lastSeenMsgId = newestMsg.key.id;
        listener.lastSeenMsgTimestamp = Number(newestMsg.messageTimestamp);
      }
    } catch (error) {
      console.error(
        `[WhatsAppSelfListener] [${accountId}] Failed to load self messages:`,
        error,
      );
    }
  }

  private async handleIncomingMessage(
    msg: WAMessage,
    accountId: string,
    sock: WASocket,
  ): Promise<void> {
    const remoteJid = msg.key.remoteJid;
    if (!remoteJid) return;

    const messageText = this.extractText(msg);

    // Skip empty messages
    if (!messageText.trim() && !this.hasMedia(msg)) {
      return;
    }

    // Create workDir first so we can save attachments there.
    const taskId = `whatsapp-${accountId}-${Date.now()}`;
    const workDir = createTaskSession(taskId);
    console.log(
      `[WhatsAppSelfListener] Created workDir for task ${taskId}: ${workDir}`,
    );

    // Download all attachments (images as base64, documents as fileAttachments).
    const images: Array<{ data: string; mimeType: string }> = [];
    const fileAttachments: Array<{
      name: string;
      data: string;
      mimeType: string;
    }> = [];

    if (this.hasMedia(msg)) {
      await this.downloadAllMedia(msg, images, fileAttachments);
    }

    const previewText =
      messageText.length > 0
        ? messageText.substring(0, 50)
        : `(no text, ${images.length} image(s), ${fileAttachments.length} file(s))`;
    console.log(
      `[WhatsAppSelfListener] Processing self-message: ${previewText}...`,
    );

    const prompt = messageText.length > 0 ? messageText : "(Image attached)";

    const conversationHistory =
      whatsappConversationStore.getConversationHistory(this.userId, accountId);

    // Resolve target JID once — used by both text and file sending.
    const myPhoneJid = sock.user?.id
      ? `${sock.user.id.split(":")[0]}@s.whatsapp.net`
      : remoteJid;

    // Track files already sent so we don't re-send on incremental text updates.
    const sentFilePaths = new Set<string>();

    await handleAgentRuntime(
      prompt,
      {
        conversation: conversationHistory,
        images: images.length > 0 ? images : undefined,
        fileAttachments:
          fileAttachments.length > 0 ? fileAttachments : undefined,
        userId: this.userId,
        accountId,
        workDir,
        ...(this.authToken && {
          modelConfig: {
            apiKey: this.authToken,
            baseUrl: AI_PROXY_BASE_URL,
            model: DEFAULT_AI_MODEL,
          },
        }),
      },
      async (reply) => {
        try {
          // Note to Self messages arrive with remoteJid in LID format (@lid).
          // LID cannot be used for sending — convert to phone-number JID instead.
          console.log(
            `[WhatsAppSelfListener] Sending reply to phone jid=${myPhoneJid} (from remoteJid=${remoteJid})`,
          );
          const replyWithSuffix = `${markdownToWhatsApp(reply)}\n\n${AI_SUFFIX}`;
          const sent = await sock.sendMessage(myPhoneJid, {
            text: replyWithSuffix,
          });
          console.log(
            `[WhatsAppSelfListener] sendMessage result: id=${sent?.key?.id}, jid=${sent?.key?.remoteJid}, fromMe=${sent?.key?.fromMe}`,
          );
          // Cache sent message for msgRetry requests (Note-to-Self delivery fix).
          const cache = (sock as any).sentMessageCache as
            | Map<string, unknown>
            | undefined;
          if (sent?.message && sent.key.id && cache) {
            cache.set(sent.key.id, sent.message);
            console.log(
              `[WhatsAppSelfListener] Cached message id=${sent.key.id} (cache size=${cache.size})`,
            );
            if (cache.size > 256) {
              const oldest = cache.keys().next().value;
              if (oldest) cache.delete(oldest);
            }
          } else {
            console.log(
              `[WhatsAppSelfListener] WARNING: did NOT cache message. sent.message=${!!sent?.message} sent.key.id=${sent?.key?.id} cache=${!!cache}`,
            );
          }
          console.log("[WhatsAppSelfListener] Reply sent successfully");

          if (messageText.length > 0) {
            whatsappConversationStore.addMessage(
              this.userId,
              accountId,
              "user",
              messageText,
            );
          }
          whatsappConversationStore.addMessage(
            this.userId,
            accountId,
            "assistant",
            reply,
          );
        } catch (error) {
          console.error("[WhatsAppSelfListener] Failed to send reply:", error);
        }
      },
    );

    // After the agent finishes, scan workDir for generated files and send them.
    await this.sendGeneratedFiles(
      workDir,
      myPhoneJid,
      accountId,
      sock,
      sentFilePaths,
    );
  }

  /**
   * Scan a workDir for files and send each one as a WhatsApp document message.
   */
  private async sendGeneratedFiles(
    workDir: string,
    chatId: string,
    accountId: string,
    sock: WASocket,
    skipPaths: Set<string>,
  ): Promise<void> {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");

      if (!fs.existsSync(workDir)) return;

      const entries = fs.readdirSync(workDir);
      const files = entries.filter((f: string) => {
        if (f.startsWith(".")) return false;
        const filePath = path.join(workDir, f);
        const stat = fs.statSync(filePath);
        return stat.isFile();
      });

      if (files.length === 0) return;

      console.log(
        `[WhatsAppSelfListener] Found ${files.length} generated file(s) in ${workDir}, sending...`,
      );

      for (const fileName of files) {
        const filePath = path.join(workDir, fileName);
        if (skipPaths.has(filePath)) continue;

        try {
          const buffer = fs.readFileSync(filePath);
          const mimetype = this.guessMimeType(fileName);

          const sent = await sock.sendMessage(chatId, {
            document: buffer,
            mimetype,
            fileName,
            caption: `📄 ${fileName}\n\n${AI_SUFFIX}`,
          });

          if (sent?.message && sent.key.id) {
            // Record this file message ID so processMessages skips it (no recursive AI).
            this.accountListeners
              .get(accountId)
              ?.sentFileMsgIds.add(sent.key.id);

            const cache = (sock as any).sentMessageCache as
              | Map<string, unknown>
              | undefined;
            if (cache) {
              cache.set(sent.key.id, sent.message);
              if (cache.size > 256) {
                const oldest = cache.keys().next().value;
                if (oldest) cache.delete(oldest);
              }
            }
          }

          console.log(
            `[WhatsAppSelfListener] Sent file ${fileName} to ${chatId}`,
          );
        } catch (error) {
          console.error(
            `[WhatsAppSelfListener] Failed to send file ${fileName}:`,
            error,
          );
        }
      }
    } catch (error) {
      console.error("[WhatsAppSelfListener] Error scanning workDir:", error);
    }
  }

  private guessMimeType(fileName: string): string {
    const ext = fileName.split(".").pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ppt: "application/vnd.ms-powerpoint",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      txt: "text/plain",
      csv: "text/csv",
      zip: "application/zip",
      mp3: "audio/mpeg",
      wav: "audio/wav",
      mp4: "video/mp4",
      mov: "video/quicktime",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
    };
    return mimeTypes[ext ?? ""] ?? "application/octet-stream";
  }

  /**
   * Download all media from a message: images as inline base64, documents/audio/video as
   * base64 in fileAttachments (aligns with Telegram's approach).
   */
  private async downloadAllMedia(
    msg: WAMessage,
    images: Array<{ data: string; mimeType: string }>,
    fileAttachments: Array<{ name: string; data: string; mimeType: string }>,
  ): Promise<void> {
    const m = msg.message;
    if (!m) return;

    try {
      const buffer = await downloadMediaMessage(msg, "buffer", {});

      if (buffer.byteLength > WHATSAPP_MAX_ATTACHMENT_BYTES) {
        console.log(
          `[WhatsAppSelfListener] Attachment too large (${buffer.byteLength} bytes), skipping`,
        );
        return;
      }

      // Image → inline base64 for vision
      if (m.imageMessage) {
        const mimeType = m.imageMessage.mimetype ?? "image/jpeg";
        const base64 = Buffer.from(buffer).toString("base64");
        images.push({ data: `data:${mimeType};base64,${base64}`, mimeType });
        console.log("[WhatsAppSelfListener] Extracted image attachment");
        return;
      }

      // Video / document / audio → base64 in fileAttachments (agent saves to disk)
      if (m.videoMessage || m.documentMessage || m.audioMessage) {
        const video = m.videoMessage;
        const doc = m.documentMessage ?? m.audioMessage;
        const mimeType =
          video?.mimetype ?? doc?.mimetype ?? "application/octet-stream";
        let fileName = "";
        if (video) {
          fileName = `video_${msg.key.id ?? Date.now()}.mp4`;
        } else if (doc) {
          fileName =
            (doc as any).fileName ??
            (doc as any).title ??
            `file_${msg.key.id ?? Date.now()}`;
        }
        const base64 = Buffer.from(buffer).toString("base64");
        fileAttachments.push({ name: fileName, data: base64, mimeType });
        console.log(
          `[WhatsAppSelfListener] Added file attachment: ${fileName} (${(buffer.byteLength / 1024).toFixed(1)}KB)`,
        );
      }
    } catch (error) {
      console.error("[WhatsAppSelfListener] Failed to download media:", error);
    }
  }

  private extractText(msg: WAMessage): string {
    const m = msg.message;
    if (!m) return "";

    if (m.conversation) return m.conversation;
    if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
    if (m.imageMessage?.caption) return m.imageMessage.caption;
    if (m.videoMessage?.caption) return m.videoMessage.caption;
    if (m.documentMessage?.title) return m.documentMessage.title;
    if (m.documentMessage?.caption) return m.documentMessage.caption;
    if (m.ephemeralMessage?.message?.extendedTextMessage?.text) {
      return m.ephemeralMessage.message.extendedTextMessage.text;
    }
    if (m.ephemeralMessage?.message?.imageMessage?.caption) {
      return m.ephemeralMessage.message.imageMessage.caption;
    }
    if (m.ephemeralMessage?.message?.conversation) {
      return m.ephemeralMessage.message.conversation;
    }
    return "";
  }

  private hasMedia(msg: WAMessage): boolean {
    const m = msg.message;
    if (!m) return false;
    return !!(
      m.imageMessage ||
      m.videoMessage ||
      m.audioMessage ||
      m.stickerMessage ||
      m.documentMessage ||
      m.ephemeralMessage?.message
    );
  }

  async stop(): Promise<void> {
    console.log(`[WhatsAppSelfListener] Stopping for user ${this.userId}`);

    for (const [
      accountId,
      { sock, pollInterval, adapter },
    ] of this.accountListeners.entries()) {
      if (pollInterval) clearInterval(pollInterval);
      console.log(
        `[WhatsAppSelfListener] Stopped polling for account ${accountId}`,
      );

      // Remove the specific event listeners this listener registered on the socket.
      // Without this, restart creates duplicate handlers on the same socket,
      // causing messages to be processed twice (two replies).
      // Note: removeAllListeners(eventName) removes ALL handlers for that event,
      // including InMemoryStore's own messages.upsert handler (same event name).
      if (sock?.ev) {
        sock.ev.removeAllListeners("messages.upsert");
        sock.ev.removeAllListeners("chats.upsert");
        sock.ev.removeAllListeners("messaging-history.set");
        console.log(
          `[WhatsAppSelfListener] Removed socket event listeners for account ${accountId}`,
        );
      }

      // Always unregister from whatsappClientRegistry, even for reused sockets.
      // This ensures the registry doesn't hold a stale reference to a closed socket.
      try {
        const { whatsappClientRegistry } = require("./client-registry");
        whatsappClientRegistry.unregister(accountId);
        console.log(
          `[WhatsAppSelfListener] Unregistered socket from whatsappClientRegistry for ${accountId}`,
        );
      } catch (e) {
        // ignore if not registered
      }

      if (adapter) {
        try {
          await adapter.kill();
          console.log(
            `[WhatsAppSelfListener] Killed self-created adapter for account ${accountId}`,
          );
        } catch (error) {
          console.error(
            `[WhatsAppSelfListener] Error killing adapter for ${accountId}:`,
            error,
          );
        }
      }
    }

    this.accountListeners.clear();
  }
}

const selfMessageListeners = new Map<string, WhatsAppSelfMessageListener>();

export async function startWhatsAppSelfMessageListener(
  userId: string,
  authToken?: string,
): Promise<void> {
  if (selfMessageListeners.has(userId)) {
    console.log(
      `[WhatsAppSelfListener] Stopping existing listener for user ${userId}`,
    );
    await stopWhatsAppSelfMessageListener(userId);
  }

  const listener = new WhatsAppSelfMessageListener({ userId, authToken });
  selfMessageListeners.set(userId, listener);
  await listener.start();
}

export async function stopWhatsAppSelfMessageListener(
  userId: string,
): Promise<void> {
  const listener = selfMessageListeners.get(userId);
  if (listener) {
    await listener.stop();
    selfMessageListeners.delete(userId);
  }
}

export function isSelfMessageListenerRunning(userId: string): boolean {
  return selfMessageListeners.has(userId);
}
