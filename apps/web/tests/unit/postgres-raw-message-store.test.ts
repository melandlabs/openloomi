import { PostgresRawMessageManager } from "@/lib/memory/postgres-raw-message-store";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/env/constants", () => ({
  isTauriMode: () => false,
}));

vi.mock("@/lib/db/adapters", () => ({
  getDb: vi.fn(() => ({})),
  initDb: vi.fn(),
  isDbInitialized: vi.fn(() => true),
}));

const userId = "00000000-0000-0000-0000-000000000001";
const botId = "00000000-0000-0000-0000-000000000002";

function createRawMessageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    messageId: "msg-1",
    platform: "slack",
    botId,
    userId,
    channel: "general",
    person: "alice",
    timestamp: 1774500000,
    content: "Project launch planning update",
    attachments: [
      {
        name: "brief.txt",
        url: "https://example.test/brief.txt",
        contentType: "text/plain",
      },
    ],
    embedding: "[0.5,0.25]",
    embeddingModel: "text-embedding-3-small",
    embeddingContentHash: "hash-1",
    embeddingDimensions: 2,
    embeddingUpdatedAt: 1774500000000,
    metadata: { source: "postgres-test" },
    createdAt: 1774500000,
    memoryStage: "short",
    accessCount: 0,
    lastAccessAt: null,
    importanceScore: 0,
    archivedAt: null,
    isPinned: false,
    summaryRefId: null,
    ...overrides,
  };
}

function createInsertDb(returningRows: Array<{ id: number }>) {
  const insertChain = {
    values: vi.fn(() => insertChain),
    onConflictDoUpdate: vi.fn(() => insertChain),
    returning: vi.fn(async () => returningRows),
  };
  const db = {
    insert: vi.fn(() => insertChain),
  };
  return { db, insertChain };
}

function createSelectDb(rows: unknown[], terminal: "limit" | "offset") {
  const selectChain = {
    from: vi.fn(() => selectChain),
    where: vi.fn(() => selectChain),
    orderBy: vi.fn(() => selectChain),
    limit: vi.fn(() => (terminal === "limit" ? rows : selectChain)),
    offset: vi.fn(async () => rows),
  };
  const db = {
    select: vi.fn(() => selectChain),
  };
  return { db, selectChain };
}

describe("postgres raw message storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts raw messages using pgvector-compatible embedding text", async () => {
    const { db, insertChain } = createInsertDb([{ id: 42 }]);
    const storage = new PostgresRawMessageManager(db as never);

    const ids = await storage.storeMessages([
      {
        messageId: "msg-1",
        platform: "slack",
        botId,
        userId,
        timestamp: 1774500000,
        content: "Project launch planning update",
        embedding: [1, 0.25],
        embeddingModel: "text-embedding-3-small",
        embeddingContentHash: "hash-1",
        createdAt: 1774500000,
      },
    ]);

    expect(ids).toEqual([42]);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(insertChain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
    expect(insertChain.values).toHaveBeenCalledWith([
      expect.objectContaining({
        messageId: "msg-1",
        userId,
        botId,
        embedding: "[1,0.25]",
        embeddingDimensions: 2,
        memoryStage: "short",
        accessCount: 0,
        importanceScore: 0,
        isPinned: false,
      }),
    ]);
  });

  it("maps postgres rows back to the shared raw message contract", async () => {
    const { db, selectChain } = createSelectDb(
      [createRawMessageRow()],
      "offset",
    );
    const storage = new PostgresRawMessageManager(db as never);

    const messages = await storage.queryMessages({
      userId,
      keywords: ["launch"],
      reverse: true,
      pageSize: 5,
      offset: 2,
    });

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(selectChain.limit).toHaveBeenCalledWith(5);
    expect(selectChain.offset).toHaveBeenCalledWith(2);
    expect(messages).toEqual([
      expect.objectContaining({
        messageId: "msg-1",
        userId,
        botId,
        content: "Project launch planning update",
        embedding: [0.5, 0.25],
        metadata: { source: "postgres-test" },
        memoryStage: "short",
        isPinned: false,
      }),
    ]);
  });

  it("maps pgvector semantic search rows to memory search results", async () => {
    const row = createRawMessageRow({
      messageId: "semantic-1",
      embedding: "[1,0]",
      embeddingModel: "text-embedding-3-small",
      timestamp: 1774500003,
    });
    const { db, selectChain } = createSelectDb(
      [{ row, similarity: "0.91" }],
      "limit",
    );
    const storage = new PostgresRawMessageManager(db as never);

    const results = await storage.searchMessagesSemantically({
      userId,
      queryEmbedding: [1, 0],
      embeddingModel: "text-embedding-3-small",
      limit: 3,
      threshold: 0.7,
    });

    expect(db.select).toHaveBeenCalledWith(
      expect.objectContaining({
        row: expect.anything(),
        similarity: expect.anything(),
      }),
    );
    expect(selectChain.limit).toHaveBeenCalledWith(3);
    expect(results).toEqual([
      expect.objectContaining({
        type: "memory",
        id: "semantic-1",
        content: "Project launch planning update",
        similarity: 0.91,
        metadata: expect.objectContaining({
          userId,
          botId,
          timestamp: 1774500003000,
          embeddingModel: "text-embedding-3-small",
        }),
        message: expect.objectContaining({
          messageId: "semantic-1",
          embedding: [1, 0],
        }),
      }),
    ]);
  });
});
