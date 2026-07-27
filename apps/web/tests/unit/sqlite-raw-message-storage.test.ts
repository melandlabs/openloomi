import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MEMORY_SUMMARY_OWNER_SCOPE_CONFLICT,
  MEMORY_SUMMARY_WRITE_CONFLICT,
  type MemorySummaryRecord,
  type RawMessage,
} from "../../../../packages/indexeddb/src/storage";
import { SQLiteRawMessageManager } from "../../../../packages/sqlite/src/raw-message-manager";
import { createRawMessageStorageConformanceSuite } from "../helpers/raw-message-storage-conformance";

function summary(
  summaryId: string,
  userId: string,
  overrides: Partial<MemorySummaryRecord> = {},
): MemorySummaryRecord {
  return {
    summaryId,
    userId,
    summaryTier: "L1",
    sourceTier: "short",
    startTimestamp: 1774400000000,
    endTimestamp: 1774500000000,
    messageCount: 1,
    sourceRecordIds: ["source-1"],
    keyPoints: ["key point"],
    keywords: ["memory"],
    summaryText: "published summary",
    createdAt: 1774500000000,
    updatedAt: 1774500000000,
    ...overrides,
  };
}

createRawMessageStorageConformanceSuite("sqlite", async () => {
  const storage = new SQLiteRawMessageManager(":memory:");
  await storage.init();
  return {
    storage,
    cleanup: () => storage.close(),
  };
});

describe("sqlite raw message search", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults createdAt to unix seconds for retention cleanup", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T00:00:00.000Z"));

    const storage = new SQLiteRawMessageManager(":memory:");
    await storage.init();
    try {
      await storage.storeMessage({
        messageId: "default-created-at",
        platform: "slack",
        botId: "bot-1",
        userId: "user-1",
        timestamp: 1774500000,
        content: "retention cleanup candidate",
      } as RawMessage);

      const stored = await storage.getMessageById("default-created-at");
      const nowSeconds = Math.floor(Date.now() / 1000);
      expect(stored?.createdAt).toBe(nowSeconds);
      expect(await storage.deleteOldMessages(nowSeconds + 1, "user-1")).toBe(1);
    } finally {
      await storage.close();
    }
  });

  it("compare-and-swaps the graph ledger by durable version", async () => {
    const storage = new SQLiteRawMessageManager(":memory:");
    await storage.init();
    const ledger = (version: string): RawMessage => ({
      messageId: "__openloomi_memory_graph__:user-1",
      platform: "openloomi-memory-graph",
      botId: "bot-1",
      userId: "user-1",
      timestamp: 1774500000,
      content: "OpenLoomi internal memory graph ledger",
      metadata: {
        memoryGraphLedger: { snapshot: { version } },
      },
      createdAt: 1774500000,
    });

    try {
      await expect(
        storage.compareAndSwapGraphLedger(ledger("1"), {
          expectedVersion: "0",
          metadataKey: "memoryGraphLedger",
        }),
      ).resolves.toBe(true);
      await expect(
        storage.compareAndSwapGraphLedger(ledger("2"), {
          expectedVersion: "0",
          metadataKey: "memoryGraphLedger",
        }),
      ).resolves.toBe(false);
      expect(
        (
          (await storage.getMessageById(ledger("1").messageId))?.metadata
            ?.memoryGraphLedger as { snapshot: { version: string } }
        ).snapshot.version,
      ).toBe("1");

      await expect(
        storage.compareAndSwapGraphLedger(ledger("2"), {
          expectedVersion: "1",
          metadataKey: "memoryGraphLedger",
        }),
      ).resolves.toBe(true);
    } finally {
      await storage.close();
    }
  });

  it("keeps FTS index in sync across insert, update, and delete", async () => {
    const storage = new SQLiteRawMessageManager(":memory:");
    await storage.init();
    try {
      await storage.storeMessages([
        {
          messageId: "fts-1",
          platform: "slack",
          botId: "bot-1",
          userId: "user-1",
          channel: "general",
          person: "alice",
          timestamp: 1774500000,
          content: "alpha launch planning",
          createdAt: 1774500000000,
        },
        {
          messageId: "fts-2",
          platform: "slack",
          botId: "bot-1",
          userId: "user-1",
          channel: "support-room",
          person: "bob",
          timestamp: 1774500010,
          content: "customer support handoff",
          createdAt: 1774500000000,
        },
      ]);

      await expect(
        storage.queryMessages({ userId: "user-1", keywords: ["launch"] }),
      ).resolves.toMatchObject([{ messageId: "fts-1" }]);

      await storage.storeMessage({
        messageId: "fts-1",
        platform: "slack",
        botId: "bot-1",
        userId: "user-1",
        channel: "general",
        person: "alice",
        timestamp: 1774500000,
        content: "renamed roadmap planning",
        createdAt: 1774500000000,
      });

      await expect(
        storage.queryMessages({ userId: "user-1", keywords: ["launch"] }),
      ).resolves.toEqual([]);
      await expect(
        storage.queryMessages({ userId: "user-1", keywords: ["roadmap"] }),
      ).resolves.toMatchObject([{ messageId: "fts-1" }]);

      await storage.deleteOldMessages(1774500000001, "user-1");
      await expect(
        storage.queryMessages({ userId: "user-1", keywords: ["roadmap"] }),
      ).resolves.toEqual([]);
    } finally {
      await storage.close();
    }
  });

  it("returns semantic results ordered by vector similarity", async () => {
    const storage = new SQLiteRawMessageManager({
      dbPath: ":memory:",
      vectorDimensions: 2,
    });
    await storage.init();
    try {
      await storage.storeMessages([
        {
          messageId: "near",
          platform: "slack",
          botId: "bot-1",
          userId: "user-1",
          channel: "product",
          person: "alice",
          timestamp: 1774500003,
          content: "Project feedback was positive.",
          embedding: [1, 0],
          embeddingModel: "model-a",
          embeddingContentHash: "hash-near",
          embeddingDimensions: 2,
          embeddingUpdatedAt: 1774500000000,
          createdAt: 1774500000000,
        },
        {
          messageId: "far",
          platform: "slack",
          botId: "bot-1",
          userId: "user-1",
          channel: "product",
          person: "bob",
          timestamp: 1774500002,
          content: "Lunch menu discussion.",
          embedding: [0, 1],
          embeddingModel: "model-a",
          embeddingContentHash: "hash-far",
          embeddingDimensions: 2,
          embeddingUpdatedAt: 1774500000000,
          createdAt: 1774500000000,
        },
        {
          messageId: "other-user",
          platform: "slack",
          botId: "bot-1",
          userId: "user-2",
          channel: "product",
          person: "carol",
          timestamp: 1774500001,
          content: "Other user project note.",
          embedding: [1, 0],
          embeddingModel: "model-a",
          embeddingContentHash: "hash-other",
          embeddingDimensions: 2,
          embeddingUpdatedAt: 1774500000000,
          createdAt: 1774500000000,
        },
      ]);

      const results = await storage.searchMessagesSemantically({
        userId: "user-1",
        queryEmbedding: [1, 0],
        embeddingModel: "model-a",
        limit: 5,
        threshold: 0.5,
      });

      expect(results.map((result) => result.id)).toEqual(["near"]);
      expect(results[0]).toMatchObject({
        type: "memory",
        content: "Project feedback was positive.",
        metadata: {
          userId: "user-1",
          platform: "slack",
          botId: "bot-1",
          timestamp: 1774500003000,
          embeddingModel: "model-a",
        },
      });
      expect(results[0]?.similarity).toBeGreaterThan(0.99);
    } finally {
      await storage.close();
    }
  });

  it("removes vec0 rows when raw messages are deleted with direct SQL", async () => {
    const dbPath = join(
      tmpdir(),
      `openloomi-raw-message-trigger-${randomUUID()}.db`,
    );
    const storage = new SQLiteRawMessageManager({ dbPath });
    let directDb: Database.Database | undefined;
    await storage.init();
    try {
      await storage.storeMessage({
        messageId: "direct-delete",
        platform: "slack",
        botId: "bot-1",
        userId: "user-1",
        timestamp: 1774500000,
        content: "delete trigger test",
        embedding: [1, 0, 0],
        embeddingModel: "model-a",
        embeddingDimensions: 3,
        createdAt: 1774500000000,
      });

      directDb = new Database(dbPath);
      sqliteVec.load(directDb);
      expect(
        (
          directDb
            .prepare("SELECT COUNT(*) AS count FROM raw_messages_vec_d3")
            .get() as { count: number }
        ).count,
      ).toBe(1);

      directDb
        .prepare("DELETE FROM raw_messages WHERE message_id = ?")
        .run("direct-delete");

      expect(
        (
          directDb
            .prepare("SELECT COUNT(*) AS count FROM raw_messages_vec_d3")
            .get() as { count: number }
        ).count,
      ).toBe(0);
    } finally {
      if (directDb?.open) {
        directDb.close();
      }
      await storage.close();
      rmSync(dbPath, { force: true });
    }
  });
});

describe("sqlite raw message owner isolation", () => {
  it("rejects cross-owner overwrite while preserving same-owner idempotency", async () => {
    const storage = new SQLiteRawMessageManager(":memory:");
    await storage.init();
    try {
      const original: RawMessage = {
        messageId: "owner-guard",
        platform: "slack",
        botId: "bot-a",
        userId: "user-a",
        timestamp: 1774500000,
        content: "owner-a original",
        createdAt: 1774500000,
      };
      const originalId = await storage.storeMessage(original);

      await expect(
        storage.storeMessage({
          ...original,
          botId: "bot-b",
          userId: "user-b",
          content: "owner-b overwrite attempt",
        }),
      ).rejects.toThrow("raw_message_scope_conflict");
      await expect(
        storage.getMessageById(original.messageId),
      ).resolves.toMatchObject({
        id: originalId,
        userId: "user-a",
        botId: "bot-a",
        content: "owner-a original",
      });

      await expect(
        storage.storeMessage({
          ...original,
          content: "owner-a idempotent update",
        }),
      ).resolves.toBe(originalId);
      await expect(
        storage.getMessageById(original.messageId),
      ).resolves.toMatchObject({
        id: originalId,
        userId: "user-a",
        content: "owner-a idempotent update",
      });
    } finally {
      await storage.close();
    }
  });

  it("rolls back the whole batch when one message belongs to another owner", async () => {
    const storage = new SQLiteRawMessageManager(":memory:");
    await storage.init();
    try {
      await storage.storeMessage({
        messageId: "foreign-owner-row",
        platform: "slack",
        botId: "bot-b",
        userId: "user-b",
        timestamp: 1774500000,
        content: "foreign original",
        createdAt: 1774500000,
      });

      await expect(
        storage.storeMessages([
          {
            messageId: "new-row-before-conflict",
            platform: "slack",
            botId: "bot-a",
            userId: "user-a",
            timestamp: 1774500001,
            content: "must roll back",
            createdAt: 1774500001,
          },
          {
            messageId: "foreign-owner-row",
            platform: "slack",
            botId: "bot-a",
            userId: "user-a",
            timestamp: 1774500002,
            content: "overwrite attempt",
            createdAt: 1774500002,
          },
        ]),
      ).rejects.toThrow("raw_message_scope_conflict");

      await expect(
        storage.getMessageById("new-row-before-conflict"),
      ).resolves.toBeNull();
      await expect(
        storage.getMessageById("foreign-owner-row"),
      ).resolves.toMatchObject({
        userId: "user-b",
        botId: "bot-b",
        content: "foreign original",
      });
    } finally {
      await storage.close();
    }
  });
});

describe("sqlite chat evidence replay", () => {
  it("preserves storage-managed state inside the replay transaction", async () => {
    const storage = new SQLiteRawMessageManager({
      dbPath: ":memory:",
      enableVectorSearch: false,
    });
    await storage.init();
    const messageId = "openloomi-chat:user-a:chat-1:message-1:language";
    try {
      await storage.storeMessages([
        {
          messageId,
          platform: "openloomi-chat",
          botId: "bot-1",
          userId: "user-a",
          channel: "chat-1",
          person: "user-a",
          timestamp: 1774500000,
          content: "I prefer Chinese responses.",
          embedding: [0.25, 0.75],
          embeddingModel: "test-embedding",
          embeddingContentHash: "content-hash",
          embeddingDimensions: 2,
          embeddingUpdatedAt: 1774500001000,
          metadata: {
            source: "chat-save-messages",
            sourceChatId: "chat-1",
            sourceMessageId: "message-1",
          },
          createdAt: 1774500000,
          memoryStage: "long",
          accessCount: 7,
          lastAccessAt: 1774500002000,
          importanceScore: 0.95,
          archivedAt: 1774500003000,
          isPinned: true,
          summaryRefId: "summary-ref",
        },
      ]);
      await storage.deprecateMessages([messageId], {
        userId: "user-a",
        deprecatedAt: 1774500004000,
        reason: "summarized_into:summary-1",
        supersededBySummaryId: "summary-1",
      });

      await storage.storeMessages([
        {
          messageId,
          platform: "openloomi-chat",
          botId: "bot-1",
          userId: "user-a",
          channel: "chat-1",
          person: "user-a",
          timestamp: 1774509999,
          content: "I prefer Chinese responses.",
          metadata: {
            source: "chat-save-messages",
            sourceChatId: "chat-1",
            sourceMessageId: "message-1",
          },
          createdAt: 1774509999,
          memoryStage: "short",
          importanceScore: 0.8,
        },
      ]);

      await expect(storage.getMessageById(messageId)).resolves.toMatchObject({
        timestamp: 1774500000,
        createdAt: 1774500000,
        embedding: [0.25, 0.75],
        embeddingModel: "test-embedding",
        embeddingContentHash: "content-hash",
        embeddingDimensions: 2,
        embeddingUpdatedAt: 1774500001000,
        memoryStage: "long",
        accessCount: 7,
        lastAccessAt: 1774500002000,
        importanceScore: 0.95,
        archivedAt: 1774500003000,
        isPinned: true,
        summaryRefId: "summary-ref",
        deprecatedAt: 1774500004000,
        deprecationReason: "summarized_into:summary-1",
        supersededBySummaryId: "summary-1",
      });
    } finally {
      await storage.close();
    }
  });
});

describe("sqlite summary ownership and publication", () => {
  it("queries persisted summaries by exact owner-scoped IDs", async () => {
    const storage = new SQLiteRawMessageManager(":memory:");
    await storage.init();
    try {
      await storage.upsertSummaries([
        summary("target-summary", "user-a", {
          endTimestamp: 1774400000000,
        }),
        summary("newest-decoy", "user-a", {
          endTimestamp: 1774600000000,
        }),
        summary("foreign-summary", "user-b"),
      ]);

      await expect(
        storage.querySummaries({
          userId: "user-a",
          summaryIds: ["target-summary"],
          pageSize: 1,
        }),
      ).resolves.toEqual([
        expect.objectContaining({
          summaryId: "target-summary",
          userId: "user-a",
        }),
      ]);
      await expect(
        storage.querySummaries({
          userId: "user-b",
          summaryIds: ["target-summary"],
          pageSize: 1,
        }),
      ).resolves.toEqual([]);
    } finally {
      await storage.close();
    }
  });

  it("rolls back the batch when a summary ID belongs to another owner", async () => {
    const storage = new SQLiteRawMessageManager(":memory:");
    await storage.init();
    try {
      await storage.upsertSummaries([summary("shared-summary", "user-b")]);

      await expect(
        storage.upsertSummaries([
          summary("new-summary", "user-a"),
          summary("shared-summary", "user-a", {
            summaryText: "attempted owner transfer",
          }),
        ]),
      ).rejects.toThrow(MEMORY_SUMMARY_OWNER_SCOPE_CONFLICT);

      await expect(
        storage.querySummaries({ userId: "user-a", pageSize: 10 }),
      ).resolves.toEqual([]);
      await expect(
        storage.querySummaries({ userId: "user-b", pageSize: 10 }),
      ).resolves.toEqual([
        expect.objectContaining({
          summaryId: "shared-summary",
          userId: "user-b",
          summaryText: "published summary",
        }),
      ]);
    } finally {
      await storage.close();
    }
  });

  it("does not downgrade a published summary to pending on retry", async () => {
    const storage = new SQLiteRawMessageManager(":memory:");
    await storage.init();
    try {
      await storage.upsertSummaries([summary("stable-summary", "user-a")]);
      await storage.upsertSummaries([
        summary("stable-summary", "user-a", {
          summaryText: "stale pending summary",
          dimensions: { __openloomiMemoryPublication: "pending" },
          updatedAt: 1774500001000,
        }),
      ]);

      await expect(
        storage.querySummaries({ userId: "user-a", pageSize: 10 }),
      ).resolves.toEqual([
        expect.objectContaining({
          summaryId: "stable-summary",
          summaryText: "published summary",
          dimensions: undefined,
        }),
      ]);
    } finally {
      await storage.close();
    }
  });
  it("rejects a stale published revision without replacing the winner", async () => {
    const storage = new SQLiteRawMessageManager(":memory:");
    await storage.init();
    try {
      await storage.upsertSummaries([
        summary("stable-summary", "user-a", {
          summaryText: "published revision b",
          dimensions: {
            __openloomiMemoryPublicationRevision: "revision-b",
          },
        }),
      ]);

      await expect(
        storage.upsertSummaries([
          summary("stable-summary", "user-a", {
            summaryText: "stale revision a",
            dimensions: {
              __openloomiMemoryPublicationRevision: "revision-a",
            },
          }),
        ]),
      ).rejects.toThrow(MEMORY_SUMMARY_WRITE_CONFLICT);

      await expect(
        storage.querySummaries({ userId: "user-a", pageSize: 10 }),
      ).resolves.toEqual([
        expect.objectContaining({
          summaryId: "stable-summary",
          summaryText: "published revision b",
          dimensions: {
            __openloomiMemoryPublicationRevision: "revision-b",
          },
        }),
      ]);
    } finally {
      await storage.close();
    }
  });

  it("replaces a summary only when its expected revision matches", async () => {
    const storage = new SQLiteRawMessageManager(":memory:");
    await storage.init();
    try {
      await storage.upsertSummaries([
        summary("stable-summary", "user-a", {
          dimensions: {
            __openloomiMemoryPublicationRevision: "revision-a",
          },
        }),
      ]);
      await storage.upsertSummaries([
        summary("stable-summary", "user-a", {
          summaryText: "published revision b",
          dimensions: {
            __openloomiMemoryPublicationRevision: "revision-b",
            __openloomiMemoryPublicationExpectedRevision: "revision-a",
          },
        }),
      ]);
      await expect(
        storage.upsertSummaries([
          summary("stable-summary", "user-a", {
            summaryText: "stale revision c",
            dimensions: {
              __openloomiMemoryPublicationRevision: "revision-c",
              __openloomiMemoryPublicationExpectedRevision: "revision-a",
            },
          }),
        ]),
      ).rejects.toThrow(MEMORY_SUMMARY_WRITE_CONFLICT);

      await expect(
        storage.querySummaries({ userId: "user-a", pageSize: 10 }),
      ).resolves.toEqual([
        expect.objectContaining({
          summaryText: "published revision b",
          dimensions: {
            __openloomiMemoryPublicationRevision: "revision-b",
          },
        }),
      ]);
    } finally {
      await storage.close();
    }
  });
});

describe("sqlite raw message semantic deprecation", () => {
  it("expands vector candidates after deprecated raw records are filtered", async () => {
    const storage = new SQLiteRawMessageManager({
      dbPath: ":memory:",
      vectorDimensions: 2,
    });
    await storage.init();
    try {
      const deprecated = Array.from({ length: 10 }, (_, index) => ({
        messageId: `deprecated-nearest-${index}`,
        platform: "slack",
        botId: "bot-1",
        userId: "user-1",
        timestamp: 1774501000 + index,
        content: `deprecated nearest ${index}`,
        embedding: [1, 0],
        embeddingModel: "model-a",
        embeddingDimensions: 2,
        createdAt: 1774501000000 + index,
      }));
      await storage.storeMessages([
        ...deprecated,
        {
          messageId: "active-after-deprecated-neighbors",
          platform: "slack",
          botId: "bot-1",
          userId: "user-1",
          timestamp: 1774502000,
          content: "active semantic result",
          embedding: [0.99, 0.01],
          embeddingModel: "model-a",
          embeddingDimensions: 2,
          createdAt: 1774502000000,
        },
      ]);
      await storage.deprecateMessages(
        deprecated.map((message) => message.messageId),
        {
          userId: "user-1",
          deprecatedAt: 1774503000000,
          reason: "covered by a summary",
        },
      );

      const results = await storage.searchMessagesSemantically({
        userId: "user-1",
        queryEmbedding: [1, 0],
        embeddingModel: "model-a",
        limit: 1,
        scanLimit: 10,
        threshold: -1,
      });

      expect(results.map((result) => result.id)).toEqual([
        "active-after-deprecated-neighbors",
      ]);
    } finally {
      await storage.close();
    }
  });
});
