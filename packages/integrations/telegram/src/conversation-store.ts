/**
 * Telegram Self-Chat Conversation Store
 *
 * File-backed per-day in-memory store for conversation history with AI.
 * Data persists to ~/.alloomi/memory/telegram/YYYY-MM-DD.json
 *
 * Token trimming is handled by handleAgentRuntime (40K budget) — not here.
 */

import {
  saveChannelMessage,
  loadChannelDay,
  clearChannelConversationFromAllDays,
  clearChannelForUserPrefix,
} from "@alloomi/ai/store";
import { join } from "node:path";
import { homedir } from "node:os";

function getAppMemoryDir(): string {
  return join(homedir(), ".alloomi", "data", "memory");
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ConversationContext {
  userId: string;
  accountId: string;
  messages: ConversationMessage[];
  maxMessages: number;
  lastUpdated: Date;
}

class TelegramConversationStore {
  private cache: Map<string, ConversationContext> = new Map();
  private loadedPairs = new Set<string>();
  private readonly DEFAULT_MAX_MESSAGES = 50;
  private readonly EXPIRY_HOURS = 24;
  private readonly PREFIX = "telegram";
  private readonly memoryDir: string;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(memoryDir?: string) {
    this.memoryDir = memoryDir ?? getAppMemoryDir();
    this.startCleanupInterval();
  }

  private pairKey(userId: string, accountId: string): string {
    return `${userId}::${accountId}`;
  }

  private ensureLoaded(userId: string, accountId: string): void {
    const pk = this.pairKey(userId, accountId);
    if (this.loadedPairs.has(pk)) return;

    const key = this.buildKey(userId, accountId);
    const today = new Date().toISOString().slice(0, 10);

    // loadDay returns all messages for the full key + accountId pair
    const rawMsgs = loadChannelDay(
      this.memoryDir,
      this.PREFIX,
      today,
      key,
      "",
    ) as Array<ConversationMessage & { timestamp?: number }>;

    this.cache.set(key, {
      userId,
      accountId,
      messages: rawMsgs.map(({ timestamp: _t, ...rest }) => rest),
      maxMessages: this.DEFAULT_MAX_MESSAGES,
      lastUpdated: new Date(),
    });
    this.loadedPairs.add(pk);
  }

  getConversation(userId: string, accountId: string): ConversationContext {
    const key = this.buildKey(userId, accountId);

    if (!this.cache.has(key)) {
      this.cache.set(key, {
        userId,
        accountId,
        messages: [],
        maxMessages: this.DEFAULT_MAX_MESSAGES,
        lastUpdated: new Date(),
      });
      console.log(
        `[TelegramConversationStore] Created new conversation for ${key}`,
      );
    }

    this.ensureLoaded(userId, accountId);
    // biome-ignore lint/style/noNonNullAssertion: cache entry is guaranteed by getConversation() creating it above
    return this.cache.get(key)!;
  }

  addMessage(
    userId: string,
    accountId: string,
    role: "user" | "assistant",
    content: string,
  ): void {
    const key = this.buildKey(userId, accountId);
    const conversation = this.getConversation(userId, accountId);

    const msg: ConversationMessage = { role, content };
    conversation.messages.push(msg);
    conversation.lastUpdated = new Date();

    saveChannelMessage(this.memoryDir, this.PREFIX, key, "", {
      ...msg,
      timestamp: Date.now(),
    });

    console.log(`[TelegramConversationStore] Added ${role} message for ${key}`);
  }

  getConversationHistory(
    userId: string,
    accountId: string,
  ): ConversationMessage[] {
    const conversation = this.getConversation(userId, accountId);
    return [...conversation.messages];
  }

  clearConversation(userId: string, accountId: string): void {
    const key = this.buildKey(userId, accountId);
    const pk = this.pairKey(userId, accountId);

    this.cache.delete(key);
    this.loadedPairs.delete(pk);
    clearChannelConversationFromAllDays(this.memoryDir, this.PREFIX, key, "");

    console.log(`[TelegramConversationStore] Cleared conversation: ${key}`);
  }

  clearUserConversations(userId: string): void {
    const prefix = `telegram:self-chat:${userId}:`;
    let clearedCount = 0;

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        clearedCount++;
      }
    }
    for (const pk of [...this.loadedPairs]) {
      if (pk.startsWith(`${userId}::`)) {
        this.loadedPairs.delete(pk);
      }
    }

    clearChannelForUserPrefix(this.memoryDir, this.PREFIX, prefix);

    console.log(
      `[TelegramConversationStore] Cleared ${clearedCount} conversation(s) for user ${userId}`,
    );
  }

  private clearExpiredConversations(): void {
    const now = new Date();
    let clearedCount = 0;

    for (const [key, conversation] of this.cache.entries()) {
      const hoursSinceLastUpdate =
        (now.getTime() - conversation.lastUpdated.getTime()) / (1000 * 60 * 60);

      if (hoursSinceLastUpdate > this.EXPIRY_HOURS) {
        this.cache.delete(key);
        clearedCount++;
        clearChannelConversationFromAllDays(
          this.memoryDir,
          this.PREFIX,
          key,
          "",
        );
        console.log(
          `[TelegramConversationStore] Cleared expired conversation: ${key} (${hoursSinceLastUpdate.toFixed(1)}h old)`,
        );
      }
    }

    if (clearedCount > 0) {
      console.log(
        `[TelegramConversationStore] Cleanup: ${clearedCount} expired conversation(s) cleared`,
      );
    }
  }

  getStats(): {
    totalConversations: number;
    totalMessages: number;
    oldestConversation: Date | null;
    newestConversation: Date | null;
  } {
    const now = new Date();
    let totalMessages = 0;
    let oldest: Date | null = null;
    let newest: Date | null = null;

    for (const conversation of this.cache.values()) {
      totalMessages += conversation.messages.length;
      if (!oldest || conversation.lastUpdated < oldest)
        oldest = conversation.lastUpdated;
      if (!newest || conversation.lastUpdated > newest)
        newest = conversation.lastUpdated;
    }

    return {
      totalConversations: this.cache.size,
      totalMessages,
      oldestConversation: oldest,
      newestConversation: newest,
    };
  }

  private startCleanupInterval(): void {
    if (this.cleanupInterval) return;
    this.cleanupInterval = setInterval(
      () => this.clearExpiredConversations(),
      60 * 60 * 1000,
    );
  }

  stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  private buildKey(userId: string, accountId: string): string {
    return `telegram:self-chat:${userId}:${accountId}`;
  }
}

export { TelegramConversationStore };
