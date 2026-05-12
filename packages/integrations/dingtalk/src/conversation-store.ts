/**
 * DingTalk Conversation Store
 *
 * File-backed per-day in-memory store for conversation history with AI.
 * Data persists to ~/.alloomi/data/memory/channels/dingtalk/YYYY-MM-DD.json
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

const PLATFORM = "dingtalk";

class DingTalkConversationStore {
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
    chatId: string,
  ): Array<{ role: "user" | "assistant"; content: string }> {
    const userKey = this.getUserKey(senderId);
    this.ensureLoaded(userKey, chatId);
    return (this.cache.get(userKey)?.get(chatId) ?? []).map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  addMessage(
    senderId: string,
    chatId: string,
    role: "user" | "assistant",
    content: string,
  ): void {
    const userKey = this.getUserKey(senderId);
    this.ensureLoaded(userKey, chatId);

    const message: ConversationMessage = {
      role,
      content,
      timestamp: Date.now(),
    };

    this.cache.get(userKey)?.get(chatId)?.push(message);
    saveChannelMessage(this.memoryDir, PLATFORM, userKey, chatId, message);

    console.log(
      `[DingTalkConversationStore] Added ${role} message for sender ${senderId}, chat ${chatId}`,
    );
  }

  clearConversation(senderId: string, chatId: string): void {
    const userKey = this.getUserKey(senderId);
    const pk = this.pairKey(userKey, chatId);

    this.cache.get(userKey)?.get(chatId)?.splice(0);
    this.loadedPairs.delete(pk);
    clearChannelConversationFromAllDays(
      this.memoryDir,
      PLATFORM,
      userKey,
      chatId,
    );

    console.log(
      `[DingTalkConversationStore] Cleared conversation for sender ${senderId}, chat ${chatId}`,
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
      `[DingTalkConversationStore] Cleared all conversations for sender ${senderId}`,
    );
  }

  private getUserKey(senderId: string): string {
    return `dingtalk:${senderId}`;
  }
}

export { DingTalkConversationStore };
