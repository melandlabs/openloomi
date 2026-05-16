import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  MemorySummaryRecord,
  RawMessage,
  RawMessageStorage,
} from "../../../../packages/indexeddb/src/storage";

export interface RawMessageStorageConformanceContext {
  storage: RawMessageStorage;
  cleanup?: () => Promise<void> | void;
}

export type RawMessageStorageConformanceFactory = () =>
  | RawMessageStorageConformanceContext
  | Promise<RawMessageStorageConformanceContext>;

export function createConformanceRawMessage(
  overrides: Partial<RawMessage> = {},
): RawMessage {
  return {
    messageId: "msg-1",
    platform: "slack",
    botId: "bot-1",
    userId: "user-1",
    channel: "general",
    person: "alice",
    timestamp: 1774500000,
    content: "Project launch planning update",
    attachments: [
      {
        name: "brief.txt",
        url: "https://example.test/brief.txt",
        contentType: "text/plain",
        sizeBytes: 128,
      },
    ],
    metadata: { source: "conformance" },
    createdAt: 1774500000000,
    memoryStage: "short",
    accessCount: 0,
    importanceScore: 0,
    isPinned: false,
    ...overrides,
  };
}

function createConformanceSummary(
  overrides: Partial<MemorySummaryRecord> = {},
): MemorySummaryRecord {
  return {
    summaryId: "summary-1",
    userId: "user-1",
    summaryTier: "L1",
    sourceTier: "short",
    startTimestamp: 1774400000000,
    endTimestamp: 1774500000000,
    messageCount: 2,
    sourceRecordIds: ["msg-1", "msg-2"],
    keyPoints: ["launch plan"],
    keywords: ["launch", "planning"],
    keywordsText: "launch planning",
    summaryText: "The team discussed launch planning.",
    dimensions: { platform: "slack", channel: "general" },
    qualityScore: 0.9,
    createdAt: 1774500000000,
    updatedAt: 1774500000000,
    ...overrides,
  };
}

export function createRawMessageStorageConformanceSuite(
  name: string,
  factory: RawMessageStorageConformanceFactory,
): void {
  describe(`${name} raw message storage contract`, () => {
    let context: RawMessageStorageConformanceContext;
    let storage: RawMessageStorage;

    beforeEach(async () => {
      context = await factory();
      storage = context.storage;
      await storage.clearAll();
    });

    afterEach(async () => {
      await context.cleanup?.();
    });

    it("stores, upserts, fetches, and reports stats for raw messages", async () => {
      const stored = await storage.storeMessages([
        createConformanceRawMessage({ messageId: "msg-1" }),
        createConformanceRawMessage({
          messageId: "msg-2",
          platform: "discord",
          botId: "bot-2",
          content: "Support escalation follow up",
          timestamp: 1774500060,
        }),
      ]);
      expect(stored).toHaveLength(2);

      await storage.storeMessage(
        createConformanceRawMessage({
          messageId: "msg-1",
          content: "Updated launch planning note",
          timestamp: 1774500120,
        }),
      );

      const msg1 = await storage.getMessageById("msg-1");
      expect(msg1).toMatchObject({
        messageId: "msg-1",
        content: "Updated launch planning note",
        platform: "slack",
      });
      expect(msg1?.attachments?.[0]).toMatchObject({
        name: "brief.txt",
        contentType: "text/plain",
      });

      const all = await storage.queryMessages({
        userId: "user-1",
        pageSize: 10,
      });
      expect(all.map((item) => item.messageId).sort()).toEqual([
        "msg-1",
        "msg-2",
      ]);

      const stats = await storage.getStats();
      expect(stats.totalMessages).toBe(2);
      expect(stats.messagesByPlatform).toMatchObject({ slack: 1, discord: 1 });
      expect(stats.messagesByBot).toMatchObject({ "bot-1": 1, "bot-2": 1 });
      expect(stats.oldestMessage).toBe(1774500060);
      expect(stats.newestMessage).toBe(1774500120);
    });

    it("applies raw message filters, ordering, pagination, and archive visibility", async () => {
      await storage.storeMessages([
        createConformanceRawMessage({
          messageId: "old-general",
          timestamp: 1774500000,
          content: "alpha launch note",
        }),
        createConformanceRawMessage({
          messageId: "new-general",
          timestamp: 1774500100,
          person: "bob",
          content: "beta rollout note",
        }),
        createConformanceRawMessage({
          messageId: "support",
          timestamp: 1774500200,
          channel: "support-room",
          person: "carol",
          content: "customer support topic",
          memoryStage: "mid",
        }),
        createConformanceRawMessage({
          messageId: "archived",
          timestamp: 1774500300,
          content: "archived topic",
          archivedAt: 1774600000000,
        }),
        createConformanceRawMessage({
          messageId: "other-user",
          userId: "user-2",
          timestamp: 1774500400,
          content: "other user launch",
        }),
      ]);

      const newestPage = await storage.queryMessages({
        userId: "user-1",
        reverse: true,
        pageSize: 2,
      });
      expect(newestPage.map((item) => item.messageId)).toEqual([
        "support",
        "new-general",
      ]);

      const keywordHits = await storage.queryMessages({
        userId: "user-1",
        keywords: ["support"],
        pageSize: 10,
      });
      expect(keywordHits.map((item) => item.messageId)).toEqual(["support"]);

      const fuzzyHits = await storage.queryMessages({
        userId: "user-1",
        channel: "support",
        person: "car",
        pageSize: 10,
      });
      expect(fuzzyHits.map((item) => item.messageId)).toEqual(["support"]);

      const stagedHits = await storage.queryMessages({
        userId: "user-1",
        memoryStages: ["mid"],
        pageSize: 10,
      });
      expect(stagedHits.map((item) => item.messageId)).toEqual(["support"]);

      const timeBoundHits = await storage.queryMessages({
        userId: "user-1",
        startTime: 1774500050,
        endTime: 1774500250,
        pageSize: 10,
      });
      expect(timeBoundHits.map((item) => item.messageId)).toEqual([
        "new-general",
        "support",
      ]);

      const withArchived = await storage.queryMessages({
        userId: "user-1",
        includeArchived: true,
        reverse: true,
        pageSize: 1,
      });
      expect(withArchived.map((item) => item.messageId)).toEqual(["archived"]);
    });

    it("groups raw messages by calendar buckets", async () => {
      await storage.storeMessages([
        createConformanceRawMessage({
          messageId: "march",
          timestamp: 1774500000,
        }),
        createConformanceRawMessage({
          messageId: "april",
          timestamp: 1777092000,
        }),
      ]);

      const grouped = await storage.queryMessagesGrouped({
        userId: "user-1",
        groupBy: "month",
        pageSize: 10,
      });

      expect(
        Object.values(grouped)
          .flat()
          .map((item) => item.messageId),
      ).toEqual(["april", "march"]);
    });

    it("upserts and queries memory summaries", async () => {
      await storage.upsertSummaries([
        createConformanceSummary({ summaryId: "summary-1" }),
        createConformanceSummary({
          summaryId: "summary-2",
          summaryTier: "L2",
          sourceTier: "mid",
          endTimestamp: 1774600000000,
          keywords: ["support"],
          keywordsText: "support",
          summaryText: "Support handoff summary.",
          dimensions: { platform: "slack", channel: "support-room" },
        }),
      ]);
      await storage.upsertSummaries([
        createConformanceSummary({
          summaryId: "summary-1",
          summaryText: "Updated launch summary.",
          keywords: ["launch"],
          keywordsText: "launch",
        }),
      ]);

      const summaries = await storage.querySummaries({
        userId: "user-1",
        keywords: ["launch"],
        summaryTiers: ["L1"],
        dimensions: { platform: "slack", channel: "general" },
        pageSize: 10,
      });

      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toMatchObject({
        summaryId: "summary-1",
        summaryText: "Updated launch summary.",
      });

      const reversePage = await storage.querySummaries({
        userId: "user-1",
        reverse: true,
        pageSize: 1,
      });
      expect(reversePage.map((item) => item.summaryId)).toEqual(["summary-2"]);
    });

    it("updates access, lifecycle state, archive cleanup, and embeddings", async () => {
      await storage.storeMessages([
        createConformanceRawMessage({ messageId: "msg-1" }),
        createConformanceRawMessage({ messageId: "msg-2", userId: "user-2" }),
      ]);

      expect(
        await storage.markMessagesAccessed(
          ["msg-1", "msg-2"],
          1774600000000,
          "user-1",
        ),
      ).toBe(1);
      expect(
        await storage.promoteMessagesToStage(["msg-1", "msg-2"], "mid", {
          userId: "user-1",
          summaryRefId: "summary-1",
          promotedAt: 1774600000000,
        }),
      ).toBe(1);
      expect(
        await storage.updateMessageEmbeddings(
          [
            {
              messageId: "msg-1",
              embedding: [0.1, 0.2],
              embeddingModel: "model-a",
              embeddingContentHash: "hash-a",
              embeddingDimensions: 2,
              embeddingUpdatedAt: 1774600000000,
            },
          ],
          "user-1",
        ),
      ).toBe(1);

      const updated = await storage.getMessageById("msg-1");
      expect(updated).toMatchObject({
        accessCount: 1,
        lastAccessAt: 1774600000000,
        memoryStage: "mid",
        summaryRefId: "summary-1",
        embeddingModel: "model-a",
        embeddingContentHash: "hash-a",
        embeddingDimensions: 2,
        embeddingUpdatedAt: 1774600000000,
      });
      expect(updated?.embedding).toHaveLength(2);
      expect(updated?.embedding?.[0]).toBeCloseTo(0.1);
      expect(updated?.embedding?.[1]).toBeCloseTo(0.2);

      expect(
        await storage.archiveMessages(["msg-1"], 1774700000000, "user-1"),
      ).toBe(1);
      expect(await storage.hardDeleteArchived(1774700000001, "user-1")).toBe(1);
      expect(await storage.getMessageById("msg-1")).toBeNull();
      expect(await storage.getMessageById("msg-2")).not.toBeNull();
    });

    it("deletes old messages with optional user scoping", async () => {
      await storage.storeMessages([
        createConformanceRawMessage({
          messageId: "old-user-1",
          createdAt: 100,
        }),
        createConformanceRawMessage({
          messageId: "new-user-1",
          createdAt: 300,
        }),
        createConformanceRawMessage({
          messageId: "old-user-2",
          userId: "user-2",
          createdAt: 100,
        }),
      ]);

      expect(await storage.deleteOldMessages(200, "user-1")).toBe(1);
      expect(await storage.getMessageById("old-user-1")).toBeNull();
      expect(await storage.getMessageById("old-user-2")).not.toBeNull();

      expect(await storage.deleteOldMessages(200)).toBe(1);
      expect(await storage.getMessageById("old-user-2")).toBeNull();
      expect(await storage.getMessageById("new-user-1")).not.toBeNull();
    });
  });
}
