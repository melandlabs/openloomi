/**
 * WeChat iLink Conversation Store
 *
 * File-backed per-day in-memory store for conversation history with AI.
 * Data persists to ~/.alloomi/memory/weixin/YYYY-MM-DD.json
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

class WeixinConversationStore {
  private cache: Map<string, Map<string, ConversationMessage[]>> = new Map();
  private loadedPairs = new Set<string>();
  private readonly PREFIX = "weixin";
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
      this.PREFIX,
      today,
      userKey,
      accountId,
    ) as ConversationMessage[];
    this.cache.get(userKey)?.set(accountId, msgs);
    this.loadedPairs.add(pk);
  }

  getConversationHistory(
    userId: string,
    accountId: string,
  ): Array<{ role: "user" | "assistant"; content: string }> {
    const userKey = this.getUserKey(userId);
    this.ensureLoaded(userKey, accountId);
    return (this.cache.get(userKey)?.get(accountId) ?? []).map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  addMessage(
    userId: string,
    accountId: string,
    role: "user" | "assistant",
    content: string,
  ): void {
    const userKey = this.getUserKey(userId);
    this.ensureLoaded(userKey, accountId);

    const message: ConversationMessage = {
      role,
      content,
      timestamp: Date.now(),
    };

    this.cache.get(userKey)?.get(accountId)?.push(message);
    saveChannelMessage(
      this.memoryDir,
      this.PREFIX,
      userKey,
      accountId,
      message,
    );

    console.log(
      `[WeixinConversationStore] Added ${role} message for user ${userId}, account ${accountId}`,
    );
  }

  clearConversation(userId: string, accountId: string): void {
    const userKey = this.getUserKey(userId);
    const pk = this.pairKey(userKey, accountId);

    this.cache.get(userKey)?.get(accountId)?.splice(0);
    this.loadedPairs.delete(pk);
    clearChannelConversationFromAllDays(
      this.memoryDir,
      this.PREFIX,
      userKey,
      accountId,
    );

    console.log(
      `[WeixinConversationStore] Cleared conversation for user ${userId}, account ${accountId}`,
    );
  }

  clearAllConversations(userId: string): void {
    const userKey = this.getUserKey(userId);

    for (const pk of [...this.loadedPairs]) {
      if (pk.startsWith(`${userKey}::`)) {
        this.loadedPairs.delete(pk);
      }
    }
    this.cache.delete(userKey);
    clearAllChannelForUser(this.memoryDir, this.PREFIX, userKey);

    console.log(
      `[WeixinConversationStore] Cleared all conversations for user ${userId}`,
    );
  }

  private getUserKey(userId: string): string {
    return `weixin:${userId}`;
  }
}

export { WeixinConversationStore };
