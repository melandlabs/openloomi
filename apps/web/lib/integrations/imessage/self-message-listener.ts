/**
 * iMessage Self-Message Listener
 *
 * Listens for messages that users send to themselves via iMessage, recognizes
 * them as chat conversations, and executes them.
 * Inspired by Telegram Saved Messages pattern.
 *
 * How it works:
 * - Uses @photon-ai/imessage-kit SDK to poll the iMessage database for new messages
 * - Identifies self-message conversations via the user's configured phone number/email
 * - Distinguishes user messages from AI responses via the "(By openloomi AI)" suffix
 * - User messages trigger Agent Runtime execution
 * - AI responses are sent back to the self-chat via iMessage, tagged with "(By openloomi AI)"
 *
 * macOS only; requires full disk access permission
 */

import type { Message as IMessage } from "@photon-ai/imessage-kit";
import {
  isIMessageAvailable,
  formatIMessageChatId,
} from "@openloomi/integrations/imessage";
import { handleAgentRuntime } from "./handlers";
import { IMessageConversationStore } from "@openloomi/integrations/imessage/conversation-store";
import { getAppMemoryDir } from "@/lib/utils/path";
import { createTaskSession } from "@/lib/files/workspace/sessions";

// Singleton instance for iMessage conversation history
const imessageConversationStore = new IMessageConversationStore(
  getAppMemoryDir(),
);
import { DEFAULT_AI_MODEL, AI_PROXY_BASE_URL } from "@/lib/env/constants";

const DEBUG = process.env.NODE_ENV === "development";

// AI response suffix marker
const AI_SUFFIX = "(By openloomi AI)";

// Polling interval (milliseconds)
const POLLING_INTERVAL_MS = 3000;

// iMessage SDK type
type IMessageSDKType = InstanceType<
  typeof import("@photon-ai/imessage-kit").IMessageSDK
>;

interface SelfMessageListenerConfig {
  userId: string;
  selfIdentifier?: string; // User's own phone number or email (optional; auto-detected if not provided)
  authToken?: string; // Cloud auth token for API configuration
}

class IMessageSelfMessageListener {
  private userId: string;
  private authToken?: string; // Store cloud auth token for API configuration
  private sdk: IMessageSDKType | null = null;
  // Primary self-chat chatId (used for sending replies), e.g. "iMessage;xx@hotmail.com"
  private selfChatId: string | null = null;
  // Set of all known self-chat chatIds (user may have multiple phone numbers/emails, used for message matching)
  private selfChatIds: Set<string> = new Set();
  // Core identifiers (used for message matching), e.g. "xx@hotmail.com", "+8613800138000"
  private selfCoreIdentifiers: string[] = [];
  private selfIdentifier: string | null = null;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  // Listener start time; only process messages after this time
  private startTime: Date | null = null;
  // Set of processed message GUIDs to avoid duplicate processing
  private processedGuids: Set<string> = new Set();
  // GUIDs of messages we sent ourselves to prevent circular processing (text and file messages)
  private ownSentGuids: Set<string> = new Set();
  // Content-based deduplication: the same message in an iMessage self-chat produces two DB records
  // (send + receive) with different GUIDs.
  // key = message text, value = processing timestamp
  private recentlyProcessedTexts: Map<string, number> = new Map();
  // Whether a message is currently being processed (prevents concurrency)
  private isProcessing = false;
  // Polling counter (for debugging)
  private pollCount = 0;

  constructor(config: SelfMessageListenerConfig) {
    this.userId = config.userId;
    this.authToken = config.authToken;
    this.selfIdentifier = config.selfIdentifier ?? null;
    if (this.selfIdentifier) {
      // Store full chatId format so the SDK can correctly route via chat id when sending
      this.selfChatId = formatIMessageChatId(this.selfIdentifier);
      this.selfChatIds.add(this.selfChatId);
    }
  }

  /**
   * Start the iMessage self-message listener
   */
  async start(): Promise<void> {
    if (!isIMessageAvailable()) {
      console.log("[iMessageSelfListener] Not macOS, skipping initialization");
      return;
    }

    // If an instance is already running, stop it first
    if (this.sdk) {
      await this.stop();
    }

    try {
      // Dynamically import SDK
      const { IMessageSDK } = await import("@photon-ai/imessage-kit");
      this.sdk = new IMessageSDK({ debug: false });

      if (DEBUG) {
        console.log(
          `[iMessageSelfListener] SDK initialized, user: ${this.userId}`,
        );
      }

      // If no self-chat identifier is configured, attempt auto-detection
      if (!this.selfChatId) {
        await this.detectSelfChat();
      }

      if (!this.selfChatId) {
        console.warn(
          "[iMessageSelfListener] Failed to detect self-chat chatId; please configure phone number or email manually",
        );
        return;
      }

      // Record start time; only process new messages after this point
      this.startTime = new Date();

      // Start polling
      this.startPolling();

      console.log(
        `[iMessageSelfListener] Listener started, polling interval: ${POLLING_INTERVAL_MS}ms`,
      );
    } catch (error) {
      console.error("[iMessageSelfListener] Failed to start:", error);
      throw error;
    }
  }

  /**
   * Auto-detect self-chat chatId
   *
   * Users may have multiple phone numbers and email addresses, each potentially
   * corresponding to a separate self-chat.
   * This method tries to find all self-chats rather than just the first match.
   *
   * Multi-strategy detection:
   * 1. Extract the user's own phone number/email from the message.account field in the iMessage database
   * 2. Get iChat account and Apple ID email from macOS system plist
   * 3. Match all identifiers against the chat list and collect all matching self-chats
   */
  private async detectSelfChat(): Promise<void> {
    if (!this.sdk) return;

    try {
      // Step 1: Get all identifiers for the user (phone numbers, emails)
      const userIdentifiers = await this.getSystemIdentifiers();
      // Step 2: Get DM chat list
      const chats = await this.sdk.listChats({
        type: "dm",
        limit: 100,
        sortBy: "recent",
      });

      if (DEBUG) {
        console.log(
          `[iMessageSelfListener] Found ${chats?.length ?? 0} DM chats`,
        );
      }

      // Step 3: Match all self-chats via identifiers (do not return early; collect all)
      // chatIds returned by listChats() are validated by the SDK and can be safely used in send()
      if (userIdentifiers.length > 0 && chats && chats.length > 0) {
        for (const chat of chats) {
          if (this.identifierMatchesChatId(userIdentifiers, chat.chatId)) {
            this.selfChatIds.add(chat.chatId);
          }
        }
      }

      // Select the primary selfChatId from all matched self-chats
      // Priority: iMessage+email > iMessage+phone > SMS+email > others
      if (this.selfChatIds.size > 0 && !this.selfChatId) {
        const all = [...this.selfChatIds];
        const imsgEmail = all.find(
          (id) => id.startsWith("iMessage;") && this.isEmailBasedChatId(id),
        );
        const selected =
          imsgEmail ||
          all.find((id) => id.startsWith("iMessage;")) ||
          all.find((id) => this.isEmailBasedChatId(id)) ||
          all[0];
        // Normalize to 3-segment format (e.g. "iMessage;-;user@example.com").
        // The 3-segment format causes the SDK to use sendToGroup (chat id) path,
        // which is more reliable than the buddy approach.
        this.selfChatId = formatIMessageChatId(this.extractCoreId(selected));
      }

      // Save all collected identifiers
      this.selfCoreIdentifiers = userIdentifiers;

      // Step 4: If we have identifiers but found no chats, use email identifier
      if (!this.selfChatId && userIdentifiers.length > 0) {
        const emailId = userIdentifiers.find((id) => id.includes("@"));
        const preferred = emailId || userIdentifiers[0];
        const fullChatId = formatIMessageChatId(preferred);
        this.selfChatId = fullChatId;
        this.selfChatIds.add(fullChatId);
        console.log(
          `[iMessageSelfListener] Using system identifier (user has not created a self-chat yet): ${this.selfChatId}`,
        );
        return;
      }

      if (this.selfChatIds.size > 0) {
        console.log(
          `[iMessageSelfListener] Detected ${this.selfChatIds.size} self-chats: ${[...this.selfChatIds].join(", ")}`,
        );
      } else {
        console.warn(
          "[iMessageSelfListener] Failed to auto-detect self-chat; please configure phone number or email manually",
        );
      }
    } catch (error) {
      console.error(
        "[iMessageSelfListener] Auto-detection of self-chat failed:",
        error,
      );
    }
  }

  /**
   * Strip prefixes from iMessage account field ("e:", "p:", etc.) and return the bare identifier
   */
  private stripAccountPrefix(account: string): string {
    const lower = account.toLowerCase();
    if (lower.startsWith("e:") || lower.startsWith("p:")) {
      return account.slice(2);
    }
    return account;
  }

  /**
   * Add an identifier to the list (with deduplication)
   */
  private addIdentifier(
    identifiers: string[],
    identifier: string,
    source: string,
  ): void {
    const trimmed = identifier.trim();
    if (!trimmed) return;
    if (identifiers.includes(trimmed)) return;
    identifiers.push(trimmed);
    if (DEBUG) {
      console.log(
        `[iMessageSelfListener] Got identifier from ${source}: ${trimmed}`,
      );
    }
  }

  /**
   * Get the user's iMessage identifiers from the macOS system
   *
   * Multiple strategies run in parallel to collect as many phone numbers and emails as possible:
   * 1. chat.db message.account — the account used when the user sent a message ("e:email" / "p:+phone")
   * 2. com.apple.iChat Accounts plist — system-registered iMessage accounts LoginAs
   * 3. MobileMeAccounts — Apple ID email
   *
   * Note: Uses better-sqlite3 to directly access the database to avoid permission issues with external sqlite3 commands
   */
  private async getSystemIdentifiers(): Promise<string[]> {
    const identifiers: string[] = [];

    try {
      const { execSync } = await import("node:child_process");
      const { homedir } = await import("node:os");
      const home = homedir();
      const dbPath = `${home}/Library/Messages/chat.db`;

      // Strategy 1: Use better-sqlite3 to directly access chat.db
      // This avoids permission inheritance issues when using the system sqlite3 command
      try {
        const Database = (await import("better-sqlite3")).default;
        const db = new Database(dbPath, {
          readonly: true,
          fileMustExist: true,
        });

        db.pragma("journal_mode = WAL");
        db.pragma("busy_timeout = 5000");

        // Strategy 1: Get user sending account from chat.db message.account
        try {
          const rows = db
            .prepare(
              "SELECT DISTINCT account FROM message WHERE is_from_me = 1 AND account IS NOT NULL AND account != '' ORDER BY rowid DESC LIMIT 20",
            )
            .all() as Array<{ account: string }>;

          for (const row of rows) {
            const account = row.account;
            if (!account) continue;
            this.addIdentifier(
              identifiers,
              this.stripAccountPrefix(account),
              "chat.db account",
            );
          }
        } catch (error) {
          if (DEBUG) {
            console.warn(
              "[iMessageSelfListener] Failed to get identifiers from chat.db account:",
              error instanceof Error ? error.message : error,
            );
          }
        }

        db.close();
      } catch (error) {
        // If better-sqlite3 access fails (possibly due to permissions), log and continue with other strategies
        console.error(
          "[iMessageSelfListener] Failed to access chat.db via better-sqlite3:",
          error instanceof Error ? error.message : error,
        );
      }

      // Strategy 2: Get all registered iMessage accounts from com.apple.iChat Accounts
      // The LoginAs field in each entry of the Accounts array contains the registered identifier
      try {
        const output = execSync(
          "defaults read com.apple.iChat Accounts 2>/dev/null",
          { encoding: "utf-8", timeout: 5000 },
        );
        const loginMatches = output.matchAll(/LoginAs\s*=\s*"?([^";\n}]+)"?/g);
        for (const match of loginMatches) {
          const loginId = match[1]?.trim();
          if (loginId) {
            this.addIdentifier(
              identifiers,
              loginId,
              "com.apple.iChat Accounts",
            );
          }
        }
      } catch {
        if (DEBUG) {
          console.warn(
            "[iMessageSelfListener] Failed to get accounts from com.apple.iChat",
          );
        }
      }

      // Strategy 3: Get Apple ID email from MobileMeAccounts
      try {
        const output = execSync(
          "defaults read MobileMeAccounts Accounts 2>/dev/null",
          { encoding: "utf-8", timeout: 5000 },
        );
        const emailMatches = output.matchAll(
          /AccountID\s*=\s*"?([^";\s\n]+@[^";\s\n]+)"?/g,
        );
        for (const match of emailMatches) {
          if (match[1]) {
            this.addIdentifier(identifiers, match[1], "MobileMeAccounts");
          }
        }
      } catch {
        if (DEBUG) {
          console.warn(
            "[iMessageSelfListener] Failed to get Apple ID from MobileMeAccounts",
          );
        }
      }
    } catch (error) {
      if (DEBUG) {
        console.warn(
          "[iMessageSelfListener] Failed to get system identifiers:",
          error,
        );
      }
    }

    return identifiers;
  }

  /**
   * Check if a user identifier matches a chatId
   * Handles different formats: iMessage;-;+phone, +phone, email, etc.
   */
  private identifierMatchesChatId(
    identifiers: string[],
    chatId: string,
  ): boolean {
    // Normalize format: spaces, hyphens, parentheses
    const normalizeForMatch = (s: string) =>
      s.replace(/[\s\-\(\)]/g, "").toLowerCase();

    const normChatId = normalizeForMatch(chatId);

    for (const identifier of identifiers) {
      const normId = normalizeForMatch(identifier);
      // chatId contains the identifier, or ends with it
      if (normChatId.includes(normId) || normChatId.endsWith(normId)) {
        return true;
      }
      // Reverse check: identifier contains the chatId core (strip iMessage;-; prefix)
      const coreId = normChatId.replace(/^imessage;[+-];/, "");
      if (coreId && normId.includes(coreId)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Start the polling timer
   */
  private startPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
    }

    this.pollingTimer = setInterval(async () => {
      await this.pollMessages();
    }, POLLING_INTERVAL_MS);
  }

  /**
   * Extract core identifier from chatId (strip prefixes like iMessage;-;)
   */
  private extractCoreId(chatId: string): string {
    // "iMessage;-;user@example.com" -> "user@example.com"
    // "iMessage;user@example.com" -> "user@example.com"
    // "user@example.com" -> "user@example.com"
    return chatId.replace(/^iMessage;[+-]?;?/i, "");
  }

  /**
   * Check if a chatId is email-based (as opposed to phone number)
   */
  private isEmailBasedChatId(chatId: string): boolean {
    return this.extractCoreId(chatId).includes("@");
  }

  /**
   * Send a text reply
   *
   * Uses AppleScript directly, skipping the SDK.
   * The SDK's buddy approach does not specify a service, causing Messages.app to fall back to SMS;
   * also, the SDK waits for message confirmation and throws on timeout, triggering duplicate sends.
   */
  private async sendReply(
    text: string,
  ): Promise<{ guid?: string } | undefined> {
    if (!this.selfChatId) return;
    const guid = await this.sendViaAppleScript(this.selfChatId, text);
    return { guid: guid ?? undefined };
  }

  /**
   * Send a file
   */
  private async sendFileMessage(filePath: string): Promise<string | null> {
    if (!this.selfChatId) return null;
    return this.sendFileViaAppleScript(this.selfChatId, filePath);
  }

  /**
   * Send text via osascript
   *
   * Uses chat id method for sending (compatible with newer macOS Ventura+).
   * After sending, queries the DB for the message guid.
   */
  private async sendViaAppleScript(
    chatId: string,
    text: string,
  ): Promise<string | null> {
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);

    const escapedText = text
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r");

    const coreId = this.extractCoreId(chatId);
    const normalizedChatId = formatIMessageChatId(coreId);
    const escapedChatId = normalizedChatId
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');

    // New macOS (Ventura+) AppleScript: send directly
    const sendScript = `tell application "Messages"
    set targetChat to chat id "${escapedChatId}"
    send "${escapedText}" to targetChat
end tell`;

    try {
      const escaped = sendScript.replace(/'/g, "'\\''");
      await execAsync(`osascript -e '${escaped}'`, {
        timeout: 30000,
        encoding: "utf-8",
      });
      console.log("[iMessageSelfListener] AppleScript send succeeded");
    } catch (e) {
      console.warn(
        "[iMessageSelfListener] AppleScript send failed:",
        e instanceof Error ? e.message : e,
      );
      throw new Error(`AppleScript send failed, target: ${chatId}`);
    }

    // Query the DB for the guid of the message just sent
    return this.getLatestMessageGuidFromDb();
  }

  /**
   * Query the iMessage database for the guid of the most recently sent message
   * Directly queries recent messages without relying on text matching
   */
  private async getLatestMessageGuidFromDb(): Promise<string | null> {
    try {
      const Database = (await import("better-sqlite3")).default;
      const { homedir } = await import("node:os");
      const dbPath = `${homedir()}/Library/Messages/chat.db`;
      const db = new Database(dbPath, { readonly: true, fileMustExist: true });

      // iMessage date is in nanoseconds, starting from 2001-01-01
      // Unix timestamp (seconds) - 978307200 (offset from 2001-01-01) = Apple timestamp (seconds)
      // Then multiply by 1_000_000_000 to convert to nanoseconds
      const APPLE_EPOCH_OFFSET = 978307200;
      const fiveSecondsAgoInAppleNanos =
        (Math.floor((Date.now() - 5000) / 1000) - APPLE_EPOCH_OFFSET) *
        1_000_000_000;

      // Directly query messages sent within the last 5 seconds (ordered by time descending)
      const rows = db
        .prepare(
          `SELECT guid, text, date FROM message
           WHERE is_from_me = 1 AND date > ?
           ORDER BY date DESC LIMIT 1`,
        )
        .all(fiveSecondsAgoInAppleNanos) as Array<{
        guid: string;
        text: string;
        date: number;
      }>;

      db.close();

      if (rows.length > 0) {
        console.log(
          "[iMessageSelfListener] Got message guid from DB:",
          rows[0].guid,
          "text:",
          rows[0].text?.substring(0, 30),
        );
        return rows[0].guid;
      }
      console.log("[iMessageSelfListener] No recent message found");
    } catch (e) {
      console.warn(
        "[iMessageSelfListener] Failed to query guid from DB:",
        e instanceof Error ? e.message : e,
      );
    }
    return null;
  }

  /**
   * Send a file via osascript
   */
  private async sendFileViaAppleScript(
    chatId: string,
    filePath: string,
  ): Promise<string | null> {
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);

    const coreId = this.extractCoreId(chatId);
    const escapedPath = filePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    const normalizedChatId = formatIMessageChatId(coreId);
    const escapedChatId = normalizedChatId
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');

    // New macOS: send file directly
    const sendScript = `tell application "Messages"
    set targetChat to chat id "${escapedChatId}"
    send (POSIX file "${escapedPath}") as alias to targetChat
end tell`;

    try {
      const escaped = sendScript.replace(/'/g, "'\\''");
      await execAsync(`osascript -e '${escaped}'`, {
        timeout: 30000,
        encoding: "utf-8",
      });
      console.log("[iMessageSelfListener] AppleScript file send succeeded");
    } catch (e) {
      console.warn(
        "[iMessageSelfListener] AppleScript file send failed:",
        e instanceof Error ? e.message : e,
      );
      throw new Error(`AppleScript file send failed, target: ${chatId}`);
    }

    // For file messages: query the most recent message with an attachment
    return this.getLatestFileMessageGuidFromDb();
  }

  /**
   * Query the DB for the guid of the most recently sent file message
   */
  private async getLatestFileMessageGuidFromDb(): Promise<string | null> {
    try {
      const Database = (await import("better-sqlite3")).default;
      const { homedir } = await import("node:os");
      const dbPath = `${homedir()}/Library/Messages/chat.db`;
      const db = new Database(dbPath, { readonly: true, fileMustExist: true });

      // iMessage date is in nanoseconds, starting from 2001-01-01
      // Unix timestamp (seconds) - 978307200 (offset from 2001-01-01) = Apple timestamp (seconds)
      // Then multiply by 1_000_000_000 to convert to nanoseconds
      const APPLE_EPOCH_OFFSET = 978307200;
      const fiveSecondsAgoInAppleNanos =
        (Math.floor((Date.now() - 5000) / 1000) - APPLE_EPOCH_OFFSET) *
        1_000_000_000;

      const rows = db
        .prepare(
          `SELECT m.guid FROM message m
           JOIN message_attachment_join maj ON m.rowid = maj.message_id
           WHERE m.is_from_me = 1 AND m.date > ?
           ORDER BY m.date DESC LIMIT 1`,
        )
        .all(fiveSecondsAgoInAppleNanos) as Array<{ guid: string }>;

      db.close();

      if (rows.length > 0) {
        console.log(
          "[iMessageSelfListener] Got file message guid from DB:",
          rows[0].guid,
        );
        return rows[0].guid;
      }
    } catch (e) {
      console.warn(
        "[iMessageSelfListener] Failed to query file guid from DB:",
        e instanceof Error ? e.message : e,
      );
    }
    return null;
  }

  /**
   * Check if a message's chatId belongs to a self-chat
   *
   * Supports multi-identifier matching: users may have multiple phone numbers/emails,
   * each potentially corresponding to a separate self-chat chatId.
   * When a match is found, the newly discovered chatId is added to the known set (runtime learning).
   */
  private isSelfChatMessage(messageChatId: string): boolean {
    if (this.selfChatIds.size === 0 && !this.selfChatId) return false;

    const normalize = (s: string) => s.replace(/[\s\-\(\)]/g, "").toLowerCase();
    const normMsgChatId = normalize(messageChatId);

    // Match against all known self-chat chatIds
    for (const knownChatId of this.selfChatIds) {
      if (normMsgChatId === normalize(knownChatId)) return true;
    }

    // Match against the primary selfChatId's core identifier
    if (this.selfChatId) {
      const selfCore = normalize(this.extractCoreId(this.selfChatId));
      const msgCore = normalize(this.extractCoreId(messageChatId));
      if (msgCore && selfCore && msgCore === selfCore) {
        this.selfChatIds.add(messageChatId);
        return true;
      }
    }

    // Match against all known user identifiers
    const msgCore = normalize(this.extractCoreId(messageChatId));
    for (const identifier of this.selfCoreIdentifiers) {
      const normId = normalize(identifier);
      if (normMsgChatId.includes(normId) || msgCore === normId) {
        // Discovered a new self-chat chatId at runtime; add to known set
        this.selfChatIds.add(messageChatId);
        if (DEBUG) {
          console.log(
            `[iMessageSelfListener] Runtime discovery of new self-chat chatId: ${messageChatId}`,
          );
        }
        return true;
      }
    }

    return false;
  }

  /**
   * Poll for new messages
   *
   * Does not use the SDK's chatId filtering (to avoid format mismatches).
   * Instead, fetches all recent messages and manually filters for self-chat messages.
   */
  private async pollMessages(): Promise<void> {
    if (!this.sdk || !this.selfChatId || !this.startTime || this.isProcessing)
      return;

    try {
      this.pollCount++;

      // Fetch all recent messages since start time (no chatId filtering)
      const result = await this.sdk.getMessages({
        limit: 20,
        excludeOwnMessages: false,
        excludeReactions: true,
        since: this.startTime,
      });

      if (!result || result.messages.length === 0) return;

      // Manually filter for messages belonging to self-chat
      const selfMessages = result.messages.filter((msg) =>
        this.isSelfChatMessage(msg.chatId),
      );

      if (selfMessages.length === 0) {
        return;
      }

      const sortedMessages = [...selfMessages].sort(
        (a, b) => a.date.getTime() - b.date.getTime(),
      );

      for (const msg of sortedMessages) {
        if (this.processedGuids.has(msg.guid)) continue;
        this.processedGuids.add(msg.guid);

        // Skip messages we sent ourselves (AI responses), including text and file messages (identified by guid)
        if (this.ownSentGuids.has(msg.guid)) continue;

        const text = msg.text || "";

        // Skip empty messages
        if (text.trim().length === 0) continue;

        // Skip system-generated placeholder messages (e.g. file transfer indicator " ")
        const trimmedText = text.trim();
        if (trimmedText === " " || /^[\s ]+$/.test(trimmedText)) {
          if (DEBUG)
            console.log("[iMessageSelfListener] Skipping system message");
          continue;
        }

        // Distinguish AI responses from user messages via "(By openloomi AI)" suffix
        // Check if message contains the AI suffix (may appear at the end or in the middle)
        if (text.includes(AI_SUFFIX)) {
          if (DEBUG)
            console.log("[iMessageSelfListener] Skipping AI response message");
          continue;
        }

        // Content-based deduplication: the same message in an iMessage self-chat produces two DB records
        // (send copy is_from_me=1 and receive copy is_from_me=0) with different GUIDs.
        // Use message text + time window for secondary deduplication.
        const DEDUP_WINDOW_MS = 1 * 60 * 60 * 1000; // 1 hour for identical message deduplication
        const dedupKey = text.trim();
        const lastProcessedTime = this.recentlyProcessedTexts.get(dedupKey);
        if (
          lastProcessedTime &&
          Date.now() - lastProcessedTime < DEDUP_WINDOW_MS
        ) {
          console.log(
            `[iMessageSelfListener] Skipping duplicate message (same text processed ${Math.round((Date.now() - lastProcessedTime) / 1000)}s ago)`,
          );
          continue;
        }
        this.recentlyProcessedTexts.set(dedupKey, Date.now());

        console.log(
          `[iMessageSelfListener] Detected user message: "${text.substring(0, 80)}" (chatId: ${msg.chatId})`,
        );

        // Mark as processing to prevent concurrency
        this.isProcessing = true;
        try {
          await this.processMessage(msg);
        } finally {
          this.isProcessing = false;
        }
      }

      // Periodically clean up processed GUIDs (keep the most recent 200)
      if (this.processedGuids.size > 200) {
        const guidsArray = Array.from(this.processedGuids);
        this.processedGuids = new Set(guidsArray.slice(-200));
      }
      if (this.ownSentGuids.size > 100) {
        const guidsArray = Array.from(this.ownSentGuids);
        this.ownSentGuids = new Set(guidsArray.slice(-100));
      }
      // Clean up expired text deduplication records after 2 hours
      const DEDUP_CLEANUP_MS = 2 * 60 * 60 * 1000;
      const now = Date.now();
      for (const [key, time] of this.recentlyProcessedTexts) {
        if (now - time > DEDUP_CLEANUP_MS) {
          this.recentlyProcessedTexts.delete(key);
        }
      }
    } catch (error) {
      console.error("[iMessageSelfListener] Polling error:", error);
    }
  }

  /**
   * Handle /new command: clear conversation context and start a new conversation
   * Returns true if handled (pure command); caller should skip subsequent processing
   * Returns false if /new has content after it; context was cleared, continue processing the rest
   */
  private async handleNewCommand(
    messageText: string,
  ): Promise<{ handled: boolean; remainingText: string }> {
    const trimmed = messageText.trim();
    const isNewCommand =
      trimmed.toLowerCase() === "/new" ||
      trimmed.toLowerCase().startsWith("/new ");

    if (!isNewCommand) {
      return { handled: false, remainingText: messageText };
    }

    // Clear conversation history
    imessageConversationStore.clearConversation(this.userId, "self");
    console.log(
      `[iMessageSelfListener] /new command: conversation context cleared, user: ${this.userId}`,
    );

    // Extract text after /new as the first message of the new conversation
    const remainingText = trimmed.slice(4).trim();

    if (!remainingText) {
      // Pure /new command; send confirmation message
      try {
        const confirmMsg = `Context cleared. Starting fresh!\n\n${AI_SUFFIX}`;
        const sendResult = await this.sendReply(confirmMsg);
        if (sendResult?.guid) {
          this.ownSentGuids.add(sendResult.guid);
        }
      } catch (error) {
        console.error(
          "[iMessageSelfListener] Failed to send /new confirmation:",
          error,
        );
      }
      return { handled: true, remainingText: "" };
    }

    return { handled: false, remainingText };
  }

  /**
   * Process a single user message
   */
  private async processMessage(message: IMessage): Promise<void> {
    if (!this.sdk || !this.selfChatId) return;

    let messageText = message.text || "";

    if (DEBUG)
      console.log(
        `[iMessageSelfListener] Processing message: ${messageText.substring(0, 80)}`,
      );

    // Handle /new command
    const newCmdResult = await this.handleNewCommand(messageText);
    if (newCmdResult.handled) return;
    messageText = newCmdResult.remainingText;

    // Create working directory
    const taskId = `imessage-${Date.now()}`;
    const workDir = createTaskSession(taskId);

    // Process attachments (images)
    const images: Array<{ data: string; mimeType: string }> = [];

    if (message.attachments && message.attachments.length > 0) {
      for (const attachment of message.attachments) {
        if (attachment.isImage) {
          try {
            const fs = await import("node:fs");
            if (fs.existsSync(attachment.path)) {
              const buffer = fs.readFileSync(attachment.path);
              // Limit to 100MB
              if (buffer.length <= 100 * 1024 * 1024) {
                const mimeType = attachment.mimeType || "image/jpeg";
                const base64 = `data:${mimeType};base64,${buffer.toString("base64")}`;
                images.push({ data: base64, mimeType });
                if (DEBUG)
                  console.log(
                    `[iMessageSelfListener] Extracted image attachment: ${attachment.filename}`,
                  );
              }
            }
          } catch (error) {
            console.error(
              "[iMessageSelfListener] Failed to extract attachment:",
              error,
            );
          }
        }
      }
    }

    // Get conversation history
    const conversationHistory =
      imessageConversationStore.getConversationHistory(this.userId, "self");

    // Call Agent Runtime
    const promptText =
      messageText.length > 0
        ? messageText
        : images.length > 0
          ? "(Image attachment)"
          : "(Attachment)";

    // Add modelConfig for API configuration (needed in Tauri mode)
    const runtimeOptions: Parameters<typeof handleAgentRuntime>[1] = {
      conversation: conversationHistory,
      images: images.length > 0 ? images : undefined,
      userId: this.userId,
      accountId: "self", // Account ID for per-day file persistence
      workDir,
    };

    // Only add modelConfig if authToken is set
    if (this.authToken && this.authToken.trim().length > 0) {
      console.log(
        "[iMessageSelfListener] Adding modelConfig with apiKey prefix:",
        `${this.authToken.substring(0, 10)}...`,
      );
      runtimeOptions.modelConfig = {
        apiKey: this.authToken, // User's cloud auth token
        baseUrl: AI_PROXY_BASE_URL, // Local proxy for Tauri mode
        model: DEFAULT_AI_MODEL, // Default model
      };
    } else {
      console.warn(
        "[iMessageSelfListener] No authToken set, modelConfig will not be added",
      );
    }

    // Immediately send each reply fragment (streaming output like Telegram)
    let fullReply = "";

    await handleAgentRuntime(promptText, runtimeOptions, async (reply) => {
      fullReply += reply;
      try {
        // All AI replies get the suffix appended
        const replyWithSuffix = `${reply}\n\n${AI_SUFFIX}`;
        // Immediately send intermediate reply
        const sendResult = await this.sendReply(replyWithSuffix);
        if (sendResult?.guid) {
          this.ownSentGuids.add(sendResult.guid);
        }
        // Add sent text to deduplication set (match using text with suffix)
        this.recentlyProcessedTexts.set(replyWithSuffix.trim(), Date.now());
      } catch (error) {
        console.error(
          "[iMessageSelfListener] Failed to send intermediate reply:",
          error,
        );
      }
    });

    // Save to conversation history
    if (fullReply.length > 0) {
      try {
        if (messageText.length > 0) {
          imessageConversationStore.addMessage(
            this.userId,
            "self",
            "user",
            messageText,
          );
        }
        imessageConversationStore.addMessage(
          this.userId,
          "self",
          "assistant",
          fullReply,
        );

        if (DEBUG) console.log("[iMessageSelfListener] Reply sent");
      } catch (error) {
        console.error(
          "[iMessageSelfListener] Failed to save conversation history:",
          error,
        );
      }
    }

    // Check for generated files in the working directory and send them
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");

      if (fs.existsSync(workDir)) {
        const files = fs.readdirSync(workDir);
        const generatedFiles = files.filter((f: string) => {
          const filePath = path.join(workDir, f);
          return fs.statSync(filePath).isFile() && !f.startsWith(".");
        });

        if (generatedFiles.length > 0) {
          if (DEBUG)
            console.log(
              `[iMessageSelfListener] Found ${generatedFiles.length} generated file(s), sending...`,
            );

          for (const file of generatedFiles) {
            const filePath = path.join(workDir, file);
            try {
              const guid = await this.sendFileMessage(filePath);
              if (guid) {
                this.ownSentGuids.add(guid);
              }
              if (DEBUG)
                console.log(`[iMessageSelfListener] File sent: ${file}`);
            } catch (error) {
              console.error(
                `[iMessageSelfListener] Failed to send file ${file}:`,
                error,
              );
            }
          }
        }
      }
    } catch (error) {
      console.error(
        "[iMessageSelfListener] Error checking for generated files:",
        error,
      );
    }
  }

  /**
   * Stop the listener and release resources
   */
  async stop(): Promise<void> {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }

    if (this.sdk) {
      try {
        await this.sdk.close();
      } catch (error) {
        console.error("[iMessageSelfListener] Failed to close SDK:", error);
      }
      this.sdk = null;
    }

    this.processedGuids.clear();
    this.ownSentGuids.clear();
    this.recentlyProcessedTexts.clear();
    this.selfChatIds.clear();
    this.startTime = null;
    this.isProcessing = false;
  }
}

// Global listener registry
const selfMessageListeners = new Map<string, IMessageSelfMessageListener>();

/**
 * Start the iMessage self-message listener
 * @param userId User ID
 * @param selfIdentifier User's own phone number or email (optional; auto-detected if not provided)
 * @param authToken Cloud auth token for API configuration
 */
export async function startIMessageSelfListener(
  userId: string,
  selfIdentifier?: string,
  authToken?: string,
): Promise<void> {
  // Stop any existing listener
  if (selfMessageListeners.has(userId)) {
    console.log(
      `[iMessageSelfListener] Stopping existing listener, user: ${userId}`,
    );
    await stopIMessageSelfListener(userId);
  }

  const listener = new IMessageSelfMessageListener({
    userId,
    selfIdentifier,
    authToken,
  });

  selfMessageListeners.set(userId, listener);
  await listener.start();
}

/**
 * Stop the iMessage self-message listener
 */
export async function stopIMessageSelfListener(userId: string): Promise<void> {
  const listener = selfMessageListeners.get(userId);
  if (listener) {
    await listener.stop();
    selfMessageListeners.delete(userId);
  }
}

/**
 * Check if the iMessage self-message listener is currently running
 */
export function isIMessageSelfListenerRunning(userId: string): boolean {
  return selfMessageListeners.has(userId);
}
