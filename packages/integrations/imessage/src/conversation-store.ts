/**
 * iMessage Conversation Store
 *
 * File-backed per-day in-memory store for conversation history with AI.
 * Data persists to ~/.alloomi/memory/imessage/YYYY-MM-DD.json
 *
 * Token trimming is handled by handleAgentRuntime (40K budget) — not here.
 */

import {
  saveChannelMessage,
  loadChannelDay,
  clearChannelConversationFromAllDays,
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

class IMessageConversationStore {
  private cache: Map<string, Map<string, ConversationMessage[]>> = new Map();
  private loadedPairs = new Set<string>();
  private readonly EXPIRY_HOURS = 24;
  private readonly PREFIX = "imessage";
  private readonly memoryDir: string;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(memoryDir?: string) {
    this.memoryDir = memoryDir ?? getAppMemoryDir();
    this.startCleanupInterval();
  }

  private pairKey(userKey: string, channelId: string): string {
    return `${userKey}::${channelId}`;
  }

  private ensureLoaded(userKey: string, channelId: string): void {
    const pk = this.pairKey(userKey, channelId);
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
      channelId,
    ) as ConversationMessage[];
    this.cache.get(userKey)?.set(channelId, msgs);
    this.loadedPairs.add(pk);
  }

  getConversationHistory(
    userId: string,
    channelId: string,
  ): Array<{ role: "user" | "assistant"; content: string }> {
    const userKey = this.getUserKey(userId);
    this.ensureLoaded(userKey, channelId);
    return (this.cache.get(userKey)?.get(channelId) ?? []).map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  addMessage(
    userId: string,
    channelId: string,
    role: "user" | "assistant",
    content: string,
  ): void {
    const userKey = this.getUserKey(userId);
    this.ensureLoaded(userKey, channelId);

    const message: ConversationMessage = {
      role,
      content,
      timestamp: Date.now(),
    };

    this.cache.get(userKey)?.get(channelId)?.push(message);
    saveChannelMessage(
      this.memoryDir,
      this.PREFIX,
      userKey,
      channelId,
      message,
    );
  }

  clearConversation(userId: string, channelId: string): void {
    const userKey = this.getUserKey(userId);
    const pk = this.pairKey(userKey, channelId);

    this.cache.get(userKey)?.get(channelId)?.splice(0);
    this.loadedPairs.delete(pk);
    clearChannelConversationFromAllDays(
      this.memoryDir,
      this.PREFIX,
      userKey,
      channelId,
    );
  }

  private clearExpiredConversations(): void {
    const now = Date.now();
    const expiryMs = this.EXPIRY_HOURS * 60 * 60 * 1000;
    let changed = false;

    for (const [userKey, channels] of this.cache.entries()) {
      for (const [channelId, messages] of channels.entries()) {
        if (messages.length === 0) continue;
        // biome-ignore lint/style/noNonNullAssertion: checked length > 0 above
        const lastMsg = messages[messages.length - 1]!;
        if (now - lastMsg.timestamp > expiryMs) {
          channels.delete(channelId);
          changed = true;
          clearChannelConversationFromAllDays(
            this.memoryDir,
            this.PREFIX,
            userKey,
            channelId,
          );
        }
      }
      if (channels.size === 0) {
        this.cache.delete(userKey);
      }
    }

    for (const pk of [...this.loadedPairs]) {
      const [uk, cid] = pk.split("::");
      if (!this.cache.get(uk)?.has(cid)) {
        this.loadedPairs.delete(pk);
      }
    }
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

  private getUserKey(userId: string): string {
    return `imessage:${userId}`;
  }
}

export { IMessageConversationStore };
