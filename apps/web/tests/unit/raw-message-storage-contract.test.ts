import type {
  MemoryStage,
  MemorySummaryQuery,
  MemorySummaryRecord,
  RawMessage,
  RawMessageEmbeddingUpdate,
  RawMessageQuery,
  RawMessageStats,
  RawMessageStorage,
} from "../../../../packages/indexeddb/src/storage";
import {
  createConformanceRawMessage,
  createRawMessageStorageConformanceSuite,
} from "../helpers/raw-message-storage-conformance";

class InMemoryRawMessageStorage implements RawMessageStorage {
  private nextId = 1;
  private messages = new Map<string, RawMessage>();
  private summaries = new Map<string, MemorySummaryRecord>();

  async storeMessage(message: RawMessage): Promise<number> {
    const existing = this.messages.get(message.messageId);
    const normalized: RawMessage = {
      ...message,
      id: existing?.id ?? this.nextId++,
      memoryStage: message.memoryStage ?? "short",
      accessCount: message.accessCount ?? 0,
      importanceScore: message.importanceScore ?? 0,
      isPinned: message.isPinned ?? false,
    };
    this.messages.set(
      message.messageId,
      existing ? { ...existing, ...normalized } : normalized,
    );
    return normalized.id ?? 0;
  }

  async storeMessages(messages: RawMessage[]): Promise<number[]> {
    const ids: number[] = [];
    for (const message of messages) {
      ids.push(await this.storeMessage(message));
    }
    return ids;
  }

  async queryMessages(query: RawMessageQuery): Promise<RawMessage[]> {
    let items = Array.from(this.messages.values());

    if (query.userId) {
      items = items.filter((item) => item.userId === query.userId);
    }
    if (query.platform) {
      items = items.filter((item) => item.platform === query.platform);
    }
    if (query.botId) {
      items = items.filter((item) => item.botId === query.botId);
    }
    if (query.channel) {
      const channel = query.channel.toLowerCase();
      items = items.filter((item) =>
        item.channel?.toLowerCase().includes(channel),
      );
    }
    if (query.person) {
      const person = query.person.toLowerCase();
      items = items.filter((item) =>
        item.person?.toLowerCase().includes(person),
      );
    }
    if (query.startTime !== undefined) {
      const startTime = query.startTime;
      items = items.filter((item) => item.timestamp >= startTime);
    }
    if (query.endTime !== undefined) {
      const endTime = query.endTime;
      items = items.filter((item) => item.timestamp < endTime);
    }
    if (query.keywords?.length) {
      const keywords = query.keywords.map((item) => item.toLowerCase());
      items = items.filter((item) => {
        const searchable =
          `${item.content} ${item.channel ?? ""} ${item.person ?? ""}`.toLowerCase();
        return keywords.some((keyword) => searchable.includes(keyword));
      });
    }
    if (query.memoryStages?.length) {
      const stages = new Set(query.memoryStages);
      items = items.filter((item) => stages.has(item.memoryStage ?? "short"));
    }
    if (!query.includeArchived) {
      items = items.filter((item) => item.archivedAt === undefined);
    }

    items.sort((a, b) => a.timestamp - b.timestamp);
    if (query.reverse) {
      items.reverse();
    }

    const offset = query.offset ?? 0;
    const pageSize = query.pageSize ?? query.limit ?? 50;
    return items.slice(offset, offset + pageSize).map((item) => ({ ...item }));
  }

  async queryMessagesGrouped(
    query: RawMessageQuery,
  ): Promise<Record<string, RawMessage[]>> {
    const messages = await this.queryMessages({
      ...query,
      limit: query.limit ? query.limit * 10 : 1000,
    });

    if (!query.groupBy || query.groupBy === "none") {
      return { all: messages };
    }

    const grouped: Record<string, RawMessage[]> = {};
    for (const message of messages) {
      const date = new Date(message.timestamp * 1000);
      let key = date.toISOString().split("T")[0];
      if (query.groupBy === "month") {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      } else if (query.groupBy === "week") {
        const monday = new Date(date);
        const day = date.getDay();
        monday.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
        key = `Week of ${monday.toISOString().split("T")[0]}`;
      }
      grouped[key] = grouped[key] ?? [];
      grouped[key].push(message);
    }

    return Object.fromEntries(
      Object.entries(grouped).sort(([a], [b]) => b.localeCompare(a)),
    );
  }

  async getStats(): Promise<RawMessageStats> {
    const stats: RawMessageStats = {
      totalMessages: 0,
      messagesByPlatform: {},
      messagesByBot: {},
    };

    for (const message of this.messages.values()) {
      stats.totalMessages += 1;
      stats.messagesByPlatform[message.platform] =
        (stats.messagesByPlatform[message.platform] ?? 0) + 1;
      stats.messagesByBot[message.botId] =
        (stats.messagesByBot[message.botId] ?? 0) + 1;
      stats.oldestMessage =
        stats.oldestMessage === undefined
          ? message.timestamp
          : Math.min(stats.oldestMessage, message.timestamp);
      stats.newestMessage =
        stats.newestMessage === undefined
          ? message.timestamp
          : Math.max(stats.newestMessage, message.timestamp);
    }

    return stats;
  }

  async getMessageById(messageId: string): Promise<RawMessage | null> {
    const message = this.messages.get(messageId);
    return message ? { ...message } : null;
  }

  async deleteOldMessages(olderThan: number, userId?: string): Promise<number> {
    let deleted = 0;
    for (const [messageId, message] of this.messages.entries()) {
      if (userId && message.userId !== userId) {
        continue;
      }
      if (message.createdAt < olderThan) {
        this.messages.delete(messageId);
        deleted += 1;
      }
    }
    return deleted;
  }

  async clearAll(): Promise<void> {
    this.messages.clear();
    this.summaries.clear();
    this.nextId = 1;
  }

  async upsertSummaries(summaries: MemorySummaryRecord[]): Promise<void> {
    for (const summary of summaries) {
      this.summaries.set(summary.summaryId, { ...summary });
    }
  }

  async querySummaries(
    query: MemorySummaryQuery,
  ): Promise<MemorySummaryRecord[]> {
    let items = Array.from(this.summaries.values()).filter(
      (item) => item.userId === query.userId,
    );

    if (query.summaryTiers?.length) {
      const tiers = new Set(query.summaryTiers);
      items = items.filter((item) => tiers.has(item.summaryTier));
    }
    if (query.startTime !== undefined) {
      const startTime = query.startTime;
      items = items.filter((item) => item.endTimestamp >= startTime);
    }
    if (query.endTime !== undefined) {
      const endTime = query.endTime;
      items = items.filter((item) => item.startTimestamp < endTime);
    }
    if (query.keywords?.length) {
      const keywords = query.keywords.map((item) => item.toLowerCase());
      items = items.filter((item) => {
        const searchable =
          `${item.keywordsText ?? ""} ${item.summaryText}`.toLowerCase();
        return keywords.some((keyword) => searchable.includes(keyword));
      });
    }
    if (query.dimensions) {
      items = items.filter((item) => {
        const dimensions = item.dimensions ?? {};
        return Object.entries(query.dimensions ?? {}).every(
          ([key, value]) => value === undefined || dimensions[key] === value,
        );
      });
    }

    items.sort((a, b) => a.endTimestamp - b.endTimestamp);
    if (query.reverse ?? true) {
      items.reverse();
    }

    const offset = query.offset ?? 0;
    const pageSize = query.pageSize ?? query.limit ?? 50;
    return items.slice(offset, offset + pageSize).map((item) => ({ ...item }));
  }

  async markMessagesAccessed(
    messageIds: string[],
    at = Date.now(),
    userId?: string,
  ): Promise<number> {
    return this.updateMessagesById(messageIds, userId, (message) => ({
      ...message,
      accessCount: (message.accessCount ?? 0) + 1,
      lastAccessAt: at,
    }));
  }

  async promoteMessagesToStage(
    messageIds: string[],
    stage: MemoryStage,
    options?: { userId?: string; summaryRefId?: string; promotedAt?: number },
  ): Promise<number> {
    return this.updateMessagesById(messageIds, options?.userId, (message) => ({
      ...message,
      memoryStage: stage,
      summaryRefId: options?.summaryRefId ?? message.summaryRefId,
      metadata: {
        ...(message.metadata ?? {}),
        ...(options?.promotedAt
          ? { memoryPromotedAt: options.promotedAt }
          : {}),
      },
    }));
  }

  async archiveMessages(
    messageIds: string[],
    archivedAt = Date.now(),
    userId?: string,
  ): Promise<number> {
    return this.updateMessagesById(messageIds, userId, (message) => ({
      ...message,
      archivedAt,
    }));
  }

  async hardDeleteArchived(
    olderThan: number,
    userId?: string,
  ): Promise<number> {
    let deleted = 0;
    for (const [messageId, message] of this.messages.entries()) {
      if (userId && message.userId !== userId) {
        continue;
      }
      if (message.archivedAt !== undefined && message.archivedAt < olderThan) {
        this.messages.delete(messageId);
        deleted += 1;
      }
    }
    return deleted;
  }

  async updateMessageEmbeddings(
    updates: RawMessageEmbeddingUpdate[],
    userId?: string,
  ): Promise<number> {
    const updatesById = new Map(
      updates.map((update) => [update.messageId, update]),
    );
    return this.updateMessagesById(
      Array.from(updatesById.keys()),
      userId,
      (message) => {
        const update = updatesById.get(message.messageId);
        if (!update) {
          return message;
        }
        return {
          ...message,
          embedding: update.embedding,
          embeddingModel: update.embeddingModel,
          embeddingContentHash: update.embeddingContentHash,
          embeddingDimensions:
            update.embeddingDimensions ?? update.embedding.length,
          embeddingUpdatedAt: update.embeddingUpdatedAt,
        };
      },
    );
  }

  private async updateMessagesById(
    messageIds: string[],
    userId: string | undefined,
    update: (message: RawMessage) => RawMessage,
  ): Promise<number> {
    const ids = new Set(messageIds);
    let updated = 0;
    for (const [messageId, message] of this.messages.entries()) {
      if (!ids.has(messageId)) {
        continue;
      }
      if (userId && message.userId !== userId) {
        continue;
      }
      this.messages.set(messageId, update(message));
      updated += 1;
    }
    return updated;
  }
}

createRawMessageStorageConformanceSuite("in-memory", () => ({
  storage: new InMemoryRawMessageStorage(),
}));

createRawMessageStorageConformanceSuite(
  "in-memory with prefilled clear",
  async () => {
    const storage = new InMemoryRawMessageStorage();
    await storage.storeMessage(
      createConformanceRawMessage({
        messageId: "prefilled",
        content: "clearAll should remove this fixture",
      }),
    );
    return { storage };
  },
);
