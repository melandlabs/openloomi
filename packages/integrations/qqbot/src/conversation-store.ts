/**
 * QQBot Conversation Store
 *
 * File-backed per-day in-memory store for conversation history with AI.
 * Data persists to ~/.alloomi/data/memory/channels/qqbot/YYYY-MM-DD.json
 *
 * Token trimming is handled by handleAgentRuntime (40K budget) — not here.
 */

import {
  saveChannelMessage,
  loadChannelDay,
  clearChannelConversationFromAllDays,
  clearAllChannelForUser,
} from "@alloomi/ai/store";
import { join } from "node:path";
import { homedir } from "node:os";

function getAppMemoryDir(): string {
  return join(homedir(), ".alloomi", "data", "memory");
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

const PLATFORM = "qqbot";

class QQBotConversationStore {
  private cache: Map<string, Map<string, ConversationMessage[]>> = new Map();
  private loadedPairs = new Set<string>();
  private readonly memoryDir: string;

  constructor(memoryDir?: string) {
    this.memoryDir = memoryDir ?? getAppMemoryDir();
  }

  private pairKey(userKey: string, accountId: string): string {
    return `${userKey}::${accountId}`;
  }

  private ensureLoaded(userKey: string, accountId: string): void {
    const pk = this.pairKey(userKey, accountId);
    if (this.loadedPairs.has(pk)) return;

    if (!this.cache.has(userKey)) {
      this.cache.set(userKey, new Map());
    }

    const today = new Date().toISOString().slice(0, 10);
    const msgs = loadChannelDay(
      this.memoryDir,
      PLATFORM,
      today,
      userKey,
      accountId,
    ) as ConversationMessage[];
    this.cache.get(userKey)?.set(accountId, msgs);
    this.loadedPairs.add(pk);
  }

  getConversationHistory(
    senderId: string,
    accountId: string,
  ): Array<{ role: "user" | "assistant"; content: string }> {
    const userKey = this.getUserKey(senderId);
    this.ensureLoaded(userKey, accountId);
    return (this.cache.get(userKey)?.get(accountId) ?? []).map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  addMessage(
    senderId: string,
    accountId: string,
    role: "user" | "assistant",
    content: string,
  ): void {
    const userKey = this.getUserKey(senderId);
    this.ensureLoaded(userKey, accountId);

    const message: ConversationMessage = {
      role,
      content,
      timestamp: Date.now(),
    };

    this.cache.get(userKey)?.get(accountId)?.push(message);
    saveChannelMessage(this.memoryDir, PLATFORM, userKey, accountId, message);

    console.log(
      `[QQBotConversationStore] Added ${role} message for sender ${senderId}, account ${accountId}`,
    );
  }

  clearConversation(senderId: string, accountId: string): void {
    const userKey = this.getUserKey(senderId);
    const pk = this.pairKey(userKey, accountId);

    this.cache.get(userKey)?.get(accountId)?.splice(0);
    this.loadedPairs.delete(pk);
    clearChannelConversationFromAllDays(
      this.memoryDir,
      PLATFORM,
      userKey,
      accountId,
    );

    console.log(
      `[QQBotConversationStore] Cleared conversation for sender ${senderId}, account ${accountId}`,
    );
  }

  clearAllConversations(senderId: string): void {
    const userKey = this.getUserKey(senderId);

    for (const pk of [...this.loadedPairs]) {
      if (pk.startsWith(`${userKey}::`)) {
        this.loadedPairs.delete(pk);
      }
    }
    this.cache.delete(userKey);
    clearAllChannelForUser(this.memoryDir, PLATFORM, userKey);

    console.log(
      `[QQBotConversationStore] Cleared all conversations for sender ${senderId}`,
    );
  }

  private getUserKey(senderId: string): string {
    return `qqbot:${senderId}`;
  }
}

export { QQBotConversationStore };
