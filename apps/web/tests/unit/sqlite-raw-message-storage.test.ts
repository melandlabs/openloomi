import { SQLiteRawMessageManager } from "../../../../packages/sqlite/src/raw-message-manager";
import { createRawMessageStorageConformanceSuite } from "../helpers/raw-message-storage-conformance";
import { afterEach, describe, expect, it, vi } from "vitest";

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
      } as any);

      const stored = await storage.getMessageById("default-created-at");
      const nowSeconds = Math.floor(Date.now() / 1000);
      expect(stored?.createdAt).toBe(nowSeconds);
      expect(await storage.deleteOldMessages(nowSeconds + 1, "user-1")).toBe(1);
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
});
