import { describe, expect, it } from "vitest";
import type {
  IndexedDBManager,
  MemoryStage,
  MemorySummaryRecord,
  RawMessage,
  RawMessageQuery,
} from "../../../../packages/indexeddb/src/manager";
import {
  queryMemoryWithFallback,
  runMemoryForgettingCycle,
} from "../../../../packages/indexeddb/src/forgetting";

const DAY_MS = 24 * 60 * 60 * 1000;

class InMemoryManager {
  rawMessages: RawMessage[] = [];
  summaries: MemorySummaryRecord[] = [];
  accessedIds: string[] = [];

  async queryMessages(query: RawMessageQuery): Promise<RawMessage[]> {
    let items = [...this.rawMessages];

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
      const key = query.channel.toLowerCase();
      items = items.filter((item) => item.channel?.toLowerCase().includes(key));
    }
    if (query.person) {
      const key = query.person.toLowerCase();
      items = items.filter((item) => item.person?.toLowerCase().includes(key));
    }
    if (query.startTime !== undefined) {
      const startTime = query.startTime;
      items = items.filter((item) => item.timestamp >= startTime);
    }
    if (query.endTime !== undefined) {
      const endTime = query.endTime;
      items = items.filter((item) => item.timestamp < endTime);
    }
    if (query.memoryStages?.length) {
      const stages = new Set(query.memoryStages);
      items = items.filter((item) => stages.has(item.memoryStage ?? "short"));
    }
    if (!query.includeArchived) {
      items = items.filter((item) => item.archivedAt === undefined);
    }
    if (query.keywords?.length) {
      const keys = query.keywords.map((item) => item.toLowerCase());
      items = items.filter((item) => {
        const text =
          `${item.content} ${item.channel ?? ""} ${item.person ?? ""}`.toLowerCase();
        return keys.some((key) => text.includes(key));
      });
    }

    const reverse = query.reverse ?? false;
    items.sort((a, b) => a.timestamp - b.timestamp);
    if (reverse) {
      items.reverse();
    }

    const offset = query.offset ?? 0;
    const pageSize = query.pageSize ?? query.limit ?? 50;
    return items.slice(offset, offset + pageSize);
  }

  async upsertSummaries(summaries: MemorySummaryRecord[]): Promise<void> {
    for (const summary of summaries) {
      const index = this.summaries.findIndex(
        (item) => item.summaryId === summary.summaryId,
      );
      if (index >= 0) {
        this.summaries[index] = summary;
      } else {
        this.summaries.push(summary);
      }
    }
  }

  async querySummaries(query: {
    userId: string;
    keywords?: string[];
    startTime?: number;
    endTime?: number;
    reverse?: boolean;
    summaryTiers?: ("L1" | "L2" | "L3")[];
    pageSize?: number;
    limit?: number;
    offset?: number;
  }): Promise<MemorySummaryRecord[]> {
    let items = this.summaries.filter((item) => item.userId === query.userId);

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
      const keys = query.keywords.map((item) => item.toLowerCase());
      items = items.filter((item) => {
        const text =
          `${item.summaryText} ${(item.keywords ?? []).join(" ")}`.toLowerCase();
        return keys.some((key) => text.includes(key));
      });
    }

    const reverse = query.reverse ?? true;
    items.sort((a, b) => a.endTimestamp - b.endTimestamp);
    if (reverse) {
      items.reverse();
    }

    const offset = query.offset ?? 0;
    const pageSize = query.pageSize ?? query.limit ?? 50;
    return items.slice(offset, offset + pageSize);
  }

  async markMessagesAccessed(
    ids: string[],
    at = Date.now(),
    userId?: string,
  ): Promise<number> {
    let count = 0;
    for (const message of this.rawMessages) {
      if (!ids.includes(message.messageId)) continue;
      if (userId && message.userId !== userId) continue;
      message.accessCount = (message.accessCount ?? 0) + 1;
      message.lastAccessAt = at;
      this.accessedIds.push(message.messageId);
      count++;
    }
    return count;
  }

  async promoteMessagesToStage(
    ids: string[],
    stage: MemoryStage,
    options?: { userId?: string; summaryRefId?: string },
  ): Promise<number> {
    let count = 0;
    for (const message of this.rawMessages) {
      if (!ids.includes(message.messageId)) continue;
      if (options?.userId && message.userId !== options.userId) continue;
      message.memoryStage = stage;
      if (options?.summaryRefId) {
        message.summaryRefId = options.summaryRefId;
      }
      count++;
    }
    return count;
  }

  async archiveMessages(
    ids: string[],
    archivedAt = Date.now(),
    userId?: string,
  ): Promise<number> {
    let count = 0;
    for (const message of this.rawMessages) {
      if (!ids.includes(message.messageId)) continue;
      if (userId && message.userId !== userId) continue;
      message.archivedAt = archivedAt;
      count++;
    }
    return count;
  }

  async hardDeleteArchived(
    olderThan: number,
    userId?: string,
  ): Promise<number> {
    const before = this.rawMessages.length;
    this.rawMessages = this.rawMessages.filter((item) => {
      if (item.archivedAt === undefined) return true;
      if (item.archivedAt >= olderThan) return true;
      if (userId && item.userId !== userId) return true;
      return false;
    });
    return before - this.rawMessages.length;
  }
}

function createRaw(input: {
  messageId: string;
  userId: string;
  stage: MemoryStage;
  timestampSec: number;
  text: string;
  embedding?: number[];
  embeddingModel?: string;
  embeddingContentHash?: string;
  embeddingDimensions?: number;
  embeddingUpdatedAt?: number;
}): RawMessage {
  return {
    messageId: input.messageId,
    platform: "slack",
    botId: "bot-1",
    userId: input.userId,
    channel: "general",
    person: "alice",
    timestamp: input.timestampSec,
    content: input.text,
    embedding: input.embedding,
    embeddingModel: input.embeddingModel,
    embeddingContentHash: input.embeddingContentHash,
    embeddingDimensions: input.embeddingDimensions,
    embeddingUpdatedAt: input.embeddingUpdatedAt,
    createdAt: input.timestampSec,
    memoryStage: input.stage,
    accessCount: 0,
    importanceScore: 0,
    isPinned: false,
  };
}

describe("indexeddb forgetting bridge", () => {
  it("runs forgetting cycle and applies transition/archive/delete", async () => {
    const now = Date.now();
    const manager = new InMemoryManager();

    const shortOldSec = Math.floor((now - 10 * DAY_MS) / 1000);
    const midOldSec = Math.floor((now - 120 * DAY_MS) / 1000);

    manager.rawMessages = [
      createRaw({
        messageId: "s1",
        userId: "u1",
        stage: "short",
        timestampSec: shortOldSec,
        text: "simple note one",
      }),
      createRaw({
        messageId: "s2",
        userId: "u1",
        stage: "short",
        timestampSec: shortOldSec + 10,
        text: "simple note two",
      }),
      createRaw({
        messageId: "s3",
        userId: "u1",
        stage: "short",
        timestampSec: shortOldSec + 20,
        text: "simple note three",
      }),
      createRaw({
        messageId: "m1",
        userId: "u1",
        stage: "mid",
        timestampSec: midOldSec,
        text: "old mid one",
      }),
      createRaw({
        messageId: "m2",
        userId: "u1",
        stage: "mid",
        timestampSec: midOldSec + 10,
        text: "old mid two",
      }),
      createRaw({
        messageId: "m3",
        userId: "u1",
        stage: "mid",
        timestampSec: midOldSec + 20,
        text: "old mid three",
      }),
    ];

    const result = await runMemoryForgettingCycle(
      manager as unknown as IndexedDBManager,
      "u1",
      {
        now,
        dryRun: false,
        hardDeleteArchivedOlderThan: now + 1,
      },
    );

    expect(result.status).toBe("success");
    expect(result.createdSummaries).toBeGreaterThanOrEqual(2);
    expect(result.transitionedRecords).toBe(6);
    expect(result.archivedDetailRecords).toBe(3);
    expect(result.hardDeletedRecords).toBe(3);

    const shortToMid = manager.rawMessages.filter(
      (item) => item.messageId.startsWith("s") && item.memoryStage === "mid",
    );
    expect(shortToMid.length).toBe(3);
    expect(manager.summaries.length).toBeGreaterThanOrEqual(2);
  });

  it("queries summaries as fallback when raw is insufficient", async () => {
    const now = Date.now();
    const manager = new InMemoryManager();

    manager.rawMessages = [
      createRaw({
        messageId: "r1",
        userId: "u1",
        stage: "short",
        timestampSec: Math.floor((now - DAY_MS) / 1000),
        text: "only one raw hit",
        embedding: [0.2, 0.4, 0.6],
        embeddingModel: "text-embedding-3-small",
        embeddingContentHash: "memory-record-embedding-text-v1:abc",
        embeddingDimensions: 3,
        embeddingUpdatedAt: now - DAY_MS,
      }),
    ];

    manager.summaries = [
      {
        summaryId: "sum-1",
        userId: "u1",
        summaryTier: "L1",
        sourceTier: "short",
        startTimestamp: now - 3 * DAY_MS,
        endTimestamp: now - 2 * DAY_MS,
        messageCount: 5,
        sourceRecordIds: ["a", "b", "c", "d", "e"],
        keyPoints: ["k1"],
        keywords: ["planning"],
        keywordsText: "planning",
        summaryText: "weekly planning summary",
        createdAt: now - 2 * DAY_MS,
        updatedAt: now - 2 * DAY_MS,
      },
    ];

    const result = await queryMemoryWithFallback(
      manager as unknown as IndexedDBManager,
      {
        userId: "u1",
        pageSize: 3,
        minRawResultsWithoutFallback: 2,
      },
    );

    expect(result.rawCount).toBe(1);
    expect(result.summaryCount).toBe(1);
    expect(result.items.length).toBe(2);
    expect(result.items.some((item) => item.sourceType === "summary")).toBe(
      true,
    );
    const rawHit = result.items.find((item) => item.sourceType === "raw");
    expect(rawHit?.sourceType).toBe("raw");
    if (rawHit?.sourceType === "raw") {
      expect(rawHit.record.embedding).toEqual([0.2, 0.4, 0.6]);
      expect(rawHit.record.embeddingModel).toBe("text-embedding-3-small");
      expect(rawHit.record.embeddingContentHash).toBe(
        "memory-record-embedding-text-v1:abc",
      );
      expect(rawHit.record.embeddingDimensions).toBe(3);
      expect(rawHit.record.embeddingUpdatedAt).toBe(now - DAY_MS);
    }
    expect(manager.accessedIds).toContain("r1");
  });
});
