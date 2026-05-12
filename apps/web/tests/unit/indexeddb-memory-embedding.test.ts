import { describe, expect, it, vi } from "vitest";
import type {
  RawMessage,
  RawMessageEmbeddingUpdate,
  RawMessageQuery,
} from "../../../../packages/indexeddb/src/manager";
import {
  cosineSimilarity,
  resolveRawMessageEmbeddingDreamReason,
  runRawMessageEmbeddingDream,
  searchRawMessagesSemantically,
} from "../../../../packages/indexeddb/src/embedding";

class InMemoryEmbeddingManager {
  messages: RawMessage[] = [];
  updates: RawMessageEmbeddingUpdate[] = [];

  async queryMessages(query: RawMessageQuery): Promise<RawMessage[]> {
    let items = this.messages.filter((message) => {
      if (query.userId && message.userId !== query.userId) {
        return false;
      }
      if (!query.includeArchived && message.archivedAt !== undefined) {
        return false;
      }
      if (query.platform && message.platform !== query.platform) {
        return false;
      }
      if (query.botId && message.botId !== query.botId) {
        return false;
      }
      if (query.channel && !message.channel?.includes(query.channel)) {
        return false;
      }
      if (query.person && !message.person?.includes(query.person)) {
        return false;
      }
      if (
        query.startTime !== undefined &&
        message.timestamp < query.startTime
      ) {
        return false;
      }
      if (query.endTime !== undefined && message.timestamp >= query.endTime) {
        return false;
      }
      return true;
    });

    items = items.sort((a, b) => a.timestamp - b.timestamp);
    if (query.reverse) {
      items.reverse();
    }

    return items.slice(0, query.pageSize ?? query.limit ?? 50);
  }

  async updateMessageEmbeddings(
    updates: RawMessageEmbeddingUpdate[],
    userId?: string,
  ): Promise<number> {
    let updated = 0;
    this.updates.push(...updates);

    for (const update of updates) {
      const message = this.messages.find(
        (item) =>
          item.messageId === update.messageId &&
          (!userId || item.userId === userId),
      );
      if (!message) {
        continue;
      }
      message.embedding = update.embedding;
      message.embeddingModel = update.embeddingModel;
      message.embeddingContentHash = update.embeddingContentHash;
      message.embeddingDimensions = update.embeddingDimensions;
      message.embeddingUpdatedAt = update.embeddingUpdatedAt;
      updated += 1;
    }

    return updated;
  }
}

function createRawMessage(overrides: Partial<RawMessage> = {}): RawMessage {
  return {
    messageId: "msg-1",
    platform: "slack",
    botId: "bot-1",
    userId: "user-1",
    channel: "product",
    person: "alice",
    timestamp: 1774500000,
    content: "User liked the latest project feedback.",
    createdAt: 1774500000,
    ...overrides,
  };
}

describe("indexeddb memory embedding dream", () => {
  it("resolves missing, model-changed, and content-changed reasons", () => {
    expect(
      resolveRawMessageEmbeddingDreamReason({
        expectedEmbeddingModel: "model-a",
        expectedContentHash: "hash-a",
      }),
    ).toBe("missing");

    expect(
      resolveRawMessageEmbeddingDreamReason({
        embedding: [1],
        embeddingModel: "model-b",
        embeddingContentHash: "hash-a",
        expectedEmbeddingModel: "model-a",
        expectedContentHash: "hash-a",
      }),
    ).toBe("model_changed");

    expect(
      resolveRawMessageEmbeddingDreamReason({
        embedding: [1],
        embeddingModel: "model-a",
        embeddingContentHash: "hash-b",
        expectedEmbeddingModel: "model-a",
        expectedContentHash: "hash-a",
      }),
    ).toBe("content_changed");
  });

  it("embeds selected messages and persists vectors", async () => {
    const manager = new InMemoryEmbeddingManager();
    manager.messages = [
      createRawMessage({ messageId: "msg-1", timestamp: 1774500001 }),
      createRawMessage({
        messageId: "msg-2",
        timestamp: 1774500002,
        content: "Second memory",
      }),
    ];
    const embedDocuments = vi.fn(async (documents: string[]) =>
      documents.map((_, index) => [index + 1, index + 2]),
    );

    const result = await runRawMessageEmbeddingDream(manager, {
      userId: "user-1",
      embeddingModel: "text-embedding-3-small",
      embedDocuments,
      limit: 1,
      now: 1774500000000,
    });

    expect(result.scanned).toBe(2);
    expect(result.selected).toBe(1);
    expect(result.embedded).toBe(1);
    expect(result.reasons.missing).toBe(1);
    expect(embedDocuments).toHaveBeenCalledTimes(1);
    expect(manager.updates).toHaveLength(1);
    expect(manager.updates[0]).toMatchObject({
      messageId: "msg-2",
      embedding: [1, 2],
      embeddingModel: "text-embedding-3-small",
      embeddingDimensions: 2,
      embeddingUpdatedAt: 1774500000000,
    });
    expect(
      manager.messages.find((item) => item.messageId === "msg-2"),
    ).toMatchObject({
      embedding: [1, 2],
      embeddingModel: "text-embedding-3-small",
      embeddingDimensions: 2,
      embeddingUpdatedAt: 1774500000000,
    });
  });

  it("supports dry run without embedding or writes", async () => {
    const manager = new InMemoryEmbeddingManager();
    manager.messages = [createRawMessage()];
    const embedDocuments = vi.fn(async () => [[1, 2, 3]]);

    const result = await runRawMessageEmbeddingDream(manager, {
      userId: "user-1",
      embeddingModel: "text-embedding-3-small",
      embedDocuments,
      dryRun: true,
    });

    expect(result.selected).toBe(1);
    expect(result.embedded).toBe(0);
    expect(result.dryRun).toBe(true);
    expect(embedDocuments).not.toHaveBeenCalled();
    expect(manager.updates).toHaveLength(0);
  });
});

describe("indexeddb memory semantic search", () => {
  it("calculates cosine similarity for equal-dimensional vectors", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(Number.isNaN(cosineSimilarity([1], [1, 2]))).toBe(true);
  });

  it("returns embedded raw messages ordered by semantic similarity", async () => {
    const manager = new InMemoryEmbeddingManager();
    manager.messages = [
      createRawMessage({
        messageId: "near",
        timestamp: 1774500003,
        content: "Project feedback was positive.",
        embedding: [1, 0],
        embeddingModel: "text-embedding-3-small",
      }),
      createRawMessage({
        messageId: "far",
        timestamp: 1774500002,
        content: "Lunch menu discussion.",
        embedding: [0, 1],
        embeddingModel: "text-embedding-3-small",
      }),
      createRawMessage({
        messageId: "missing",
        timestamp: 1774500001,
        content: "No embedding yet.",
      }),
    ];
    const embedQuery = vi.fn(async () => [1, 0]);

    const results = await searchRawMessagesSemantically(manager, {
      userId: "user-1",
      query: "project feedback",
      embeddingModel: "text-embedding-3-small",
      embedQuery,
      threshold: 0.5,
      limit: 5,
    });

    expect(embedQuery).toHaveBeenCalledWith("project feedback");
    expect(results.map((result) => result.id)).toEqual(["near"]);
    expect(results[0]).toMatchObject({
      type: "memory",
      content: "Project feedback was positive.",
      metadata: {
        userId: "user-1",
        platform: "slack",
        botId: "bot-1",
        timestamp: 1774500003000,
        embeddingModel: "text-embedding-3-small",
      },
    });
    expect(results[0]?.similarity).toBe(1);
  });

  it("respects filters, threshold, and embedding model", async () => {
    const manager = new InMemoryEmbeddingManager();
    manager.messages = [
      createRawMessage({
        messageId: "target",
        botId: "bot-2",
        channel: "support",
        embedding: [0.9, 0.1],
        embeddingModel: "model-a",
      }),
      createRawMessage({
        messageId: "wrong-model",
        botId: "bot-2",
        channel: "support",
        embedding: [1, 0],
        embeddingModel: "model-b",
      }),
      createRawMessage({
        messageId: "wrong-bot",
        botId: "bot-1",
        channel: "support",
        embedding: [1, 0],
        embeddingModel: "model-a",
      }),
    ];

    const results = await searchRawMessagesSemantically(manager, {
      userId: "user-1",
      query: "support memory",
      embedQuery: async () => [1, 0],
      embeddingModel: "model-a",
      botId: "bot-2",
      channel: "support",
      threshold: 0.9,
    });

    expect(results.map((result) => result.id)).toEqual(["target"]);
  });
});
