import { PostgresRawMessageManager } from "@/lib/memory/postgres-raw-message-store";
import {
  MEMORY_SUMMARY_OWNER_SCOPE_CONFLICT,
  MEMORY_SUMMARY_WRITE_CONFLICT,
} from "@openloomi/indexeddb";
import type { MemorySummaryRecord } from "@openloomi/indexeddb/storage";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
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

function createSummary(
  summaryId: string,
  owner = userId,
  overrides: Partial<MemorySummaryRecord> = {},
): MemorySummaryRecord {
  return {
    summaryId,
    userId: owner,
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

function createSummaryDb(input: {
  existingRows?: unknown[];
  returningRows?: unknown[];
  currentRows?: unknown[];
}) {
  const insertChain = {
    values: vi.fn(() => insertChain),
    onConflictDoUpdate: vi.fn(() => insertChain),
    returning: vi.fn(async () => input.returningRows ?? []),
  };
  let selectCalls = 0;
  const select = vi.fn(() => {
    const rows =
      selectCalls++ === 0
        ? (input.existingRows ?? [])
        : (input.currentRows ?? input.existingRows ?? []);
    const chain = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      for: vi.fn(async () => rows),
    };
    return chain;
  });
  const transactionDb = {
    insert: vi.fn(() => insertChain),
    select,
  };
  const transactionState = { committed: false, rolledBack: false };
  const db = {
    transaction: vi.fn(
      async (
        callback: (transaction: typeof transactionDb) => Promise<unknown>,
      ) => {
        try {
          const result = await callback(transactionDb);
          transactionState.committed = true;
          return result;
        } catch (error) {
          transactionState.rolledBack = true;
          throw error;
        }
      },
    ),
  };
  return { db, insertChain, transactionDb, transactionState };
}

function createInsertDb(returningRows: Array<{ id: number }>) {
  const insertChain = {
    values: vi.fn(() => insertChain),
    onConflictDoUpdate: vi.fn(() => insertChain),
    returning: vi.fn(async () => returningRows),
  };
  const transactionDb = {
    insert: vi.fn(() => insertChain),
  };
  const transactionState: {
    committed: boolean;
    rolledBack: boolean;
    callbackError?: unknown;
  } = {
    committed: false,
    rolledBack: false,
  };
  const db = {
    insert: vi.fn(() => insertChain),
    transaction: vi.fn(
      async (
        callback: (transaction: typeof transactionDb) => Promise<unknown>,
      ) => {
        try {
          const result = await callback(transactionDb);
          transactionState.committed = true;
          return result;
        } catch (error) {
          transactionState.rolledBack = true;
          transactionState.callbackError = error;
          throw error;
        }
      },
    ),
  };
  return { db, insertChain, transactionDb, transactionState };
}

function createRawReplayDb(existingRows: unknown[]) {
  const insertChain = {
    values: vi.fn(() => insertChain),
    onConflictDoUpdate: vi.fn(() => insertChain),
    returning: vi.fn(async () => [{ id: 7 }]),
  };
  const selectChain = {
    from: vi.fn(() => selectChain),
    where: vi.fn(() => selectChain),
    for: vi.fn(async () => existingRows),
  };
  const transactionDb = {
    insert: vi.fn(() => insertChain),
    select: vi.fn(() => selectChain),
  };
  const db = {
    transaction: vi.fn(
      async (
        callback: (transaction: typeof transactionDb) => Promise<unknown>,
      ) => callback(transactionDb),
    ),
  };
  return { db, insertChain, selectChain, transactionDb };
}

function createSelectDb(rows: unknown[], terminal: "limit" | "offset") {
  const selectChain = {
    from: vi.fn(() => selectChain),
    where: vi.fn((_condition: SQL) => selectChain),
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
    const { db, insertChain, transactionDb, transactionState } = createInsertDb(
      [{ id: 42 }],
    );
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
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(transactionDb.insert).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
    expect(transactionState).toMatchObject({
      committed: true,
      rolledBack: false,
    });
    expect(insertChain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
    expect(insertChain.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        setWhere: expect.anything(),
      }),
    );
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

  it("locks and preserves storage-managed chat evidence state on replay", async () => {
    const messageId = "openloomi-chat:user-a:chat-1:message-1:language";
    const { db, insertChain, selectChain } = createRawReplayDb([
      createRawMessageRow({
        messageId,
        platform: "openloomi-chat",
        userId: "user-a",
        channel: "chat-1",
        person: "user-a",
        timestamp: 1774500000,
        content: "I prefer Chinese responses.",
        embedding: "[0.25,0.75]",
        embeddingModel: "test-embedding",
        embeddingContentHash: "content-hash",
        embeddingDimensions: 2,
        embeddingUpdatedAt: 1774500001000,
        createdAt: 1774500000,
        memoryStage: "long",
        accessCount: 7,
        lastAccessAt: 1774500002000,
        importanceScore: 0.95,
        archivedAt: 1774500003000,
        isPinned: true,
        summaryRefId: "summary-ref",
      }),
    ]);
    const storage = new PostgresRawMessageManager(db as never);

    await storage.storeMessages([
      {
        messageId,
        platform: "openloomi-chat",
        botId,
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

    expect(selectChain.for).toHaveBeenCalledWith("update");
    expect(insertChain.values).toHaveBeenCalledWith([
      expect.objectContaining({
        messageId,
        timestamp: 1774500000,
        createdAt: 1774500000,
        embedding: "[0.25,0.75]",
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
      }),
    ]);
  });

  it("rejects an owner-scoped upsert when postgres omits a conflicted row", async () => {
    const { db, insertChain, transactionDb, transactionState } = createInsertDb(
      [{ id: 42 }],
    );
    const storage = new PostgresRawMessageManager(db as never);

    await expect(
      storage.storeMessages([
        {
          messageId: "accepted-row",
          platform: "slack",
          botId,
          userId,
          timestamp: 1774500000,
          content: "accepted",
          createdAt: 1774500000,
        },
        {
          messageId: "foreign-owner-conflict",
          platform: "slack",
          botId,
          userId,
          timestamp: 1774500001,
          content: "must not overwrite",
          createdAt: 1774500001,
        },
      ]),
    ).rejects.toThrow("raw_message_scope_conflict");

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(transactionDb.insert).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
    expect(transactionState.committed).toBe(false);
    expect(transactionState.rolledBack).toBe(true);
    expect(transactionState.callbackError).toBeInstanceOf(Error);
    expect((transactionState.callbackError as Error).message).toBe(
      "raw_message_scope_conflict",
    );
    expect(insertChain.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        setWhere: expect.anything(),
      }),
    );
    expect(insertChain.returning).toHaveBeenCalledTimes(1);
  });

  it("queries persisted summaries by exact owner-scoped IDs", async () => {
    const target = createSummary("target-summary");
    const { db, selectChain } = createSelectDb([target], "offset");
    const storage = new PostgresRawMessageManager(db as never);

    await expect(
      storage.querySummaries({
        userId,
        summaryIds: ["target-summary"],
        pageSize: 1,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        summaryId: "target-summary",
        userId,
      }),
    ]);

    const whereCondition = selectChain.where.mock.calls[0]?.[0];
    if (!whereCondition) {
      throw new Error("expected an owner-scoped summary query condition");
    }
    const compiled = new PgDialect().sqlToQuery(whereCondition);
    expect(compiled.sql).toContain("summary_id");
    expect(compiled.sql).toContain("user_id");
    expect(compiled.params).toEqual(
      expect.arrayContaining([userId, "target-summary"]),
    );
  });

  it("applies summary dimensions before postgres pagination", async () => {
    const target = createSummary("target-summary", userId, {
      dimensions: { workspaceId: "workspace-a", tenantId: "tenant-a" },
    });
    const { db, selectChain } = createSelectDb([target], "offset");
    const storage = new PostgresRawMessageManager(db as never);

    await storage.querySummaries({
      userId,
      dimensions: { workspaceId: "workspace-a", tenantId: "tenant-a" },
      pageSize: 1,
      offset: 2,
    });

    const whereCondition = selectChain.where.mock.calls[0]?.[0];
    if (!whereCondition) throw new Error("expected scoped summary conditions");
    const compiled = new PgDialect().sqlToQuery(whereCondition);
    expect(compiled.sql).toContain("dimensions");
    expect(compiled.params).toEqual(
      expect.arrayContaining([
        userId,
        "workspaceId",
        "workspace-a",
        "tenantId",
        "tenant-a",
      ]),
    );
  });

  it("rolls back a summary batch when a concurrent ID belongs to another owner", async () => {
    const foreignUserId = "00000000-0000-0000-0000-000000000099";
    const { db, insertChain, transactionState } = createSummaryDb({
      existingRows: [],
      returningRows: [{ summaryId: "new-summary" }],
      currentRows: [
        { summaryId: "new-summary", userId, dimensions: null },
        {
          summaryId: "shared-summary",
          userId: foreignUserId,
          dimensions: null,
        },
      ],
    });
    const storage = new PostgresRawMessageManager(db as never);

    await expect(
      storage.upsertSummaries([
        createSummary("new-summary"),
        createSummary("shared-summary"),
      ]),
    ).rejects.toThrow(MEMORY_SUMMARY_OWNER_SCOPE_CONFLICT);

    expect(transactionState).toEqual({ committed: false, rolledBack: true });
    expect(insertChain.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.not.objectContaining({ userId: expect.anything() }),
        setWhere: expect.anything(),
      }),
    );
  });

  it("keeps a published postgres summary published on a pending retry", async () => {
    const { db, transactionDb, transactionState } = createSummaryDb({
      existingRows: [{ summaryId: "stable-summary", userId, dimensions: null }],
    });
    const storage = new PostgresRawMessageManager(db as never);

    await storage.upsertSummaries([
      createSummary("stable-summary", userId, {
        dimensions: { __openloomiMemoryPublication: "pending" },
      }),
    ]);

    expect(transactionState).toEqual({ committed: true, rolledBack: false });
    expect(transactionDb.insert).not.toHaveBeenCalled();
  });

  it("rejects a stale postgres summary publication revision", async () => {
    const { db, transactionDb, transactionState } = createSummaryDb({
      existingRows: [
        {
          summaryId: "stable-summary",
          userId,
          dimensions: {
            __openloomiMemoryPublicationRevision: "revision-b",
          },
        },
      ],
    });
    const storage = new PostgresRawMessageManager(db as never);

    await expect(
      storage.upsertSummaries([
        createSummary("stable-summary", userId, {
          summaryText: "stale revision a",
          dimensions: {
            __openloomiMemoryPublicationRevision: "revision-a",
          },
        }),
      ]),
    ).rejects.toThrow(MEMORY_SUMMARY_WRITE_CONFLICT);

    expect(transactionState).toEqual({ committed: false, rolledBack: true });
    expect(transactionDb.insert).not.toHaveBeenCalled();
  });

  it("replaces a postgres summary only from the expected revision", async () => {
    const existingRows = [
      {
        summaryId: "stable-summary",
        userId,
        dimensions: {
          __openloomiMemoryPublicationRevision: "revision-a",
        },
      },
    ];
    const { db, insertChain } = createSummaryDb({
      existingRows,
      returningRows: [{ summaryId: "stable-summary" }],
    });
    const storage = new PostgresRawMessageManager(db as never);

    await storage.upsertSummaries([
      createSummary("stable-summary", userId, {
        summaryText: "published revision b",
        dimensions: {
          __openloomiMemoryPublicationRevision: "revision-b",
          __openloomiMemoryPublicationExpectedRevision: "revision-a",
        },
      }),
    ]);

    expect(insertChain.values).toHaveBeenCalledWith([
      expect.objectContaining({
        dimensions: {
          __openloomiMemoryPublicationRevision: "revision-b",
        },
      }),
    ]);

    const stale = createSummaryDb({ existingRows });
    await expect(
      new PostgresRawMessageManager(stale.db as never).upsertSummaries([
        createSummary("stable-summary", userId, {
          dimensions: {
            __openloomiMemoryPublicationRevision: "revision-c",
            __openloomiMemoryPublicationExpectedRevision: "revision-stale",
          },
        }),
      ]),
    ).rejects.toThrow(MEMORY_SUMMARY_WRITE_CONFLICT);
  });

  it("uses a conditional insert for the initial graph ledger version", async () => {
    const { db, insertChain } = createInsertDb([{ id: 42 }]);
    const manager = new PostgresRawMessageManager(db as never);
    const stored = await manager.compareAndSwapGraphLedger(
      {
        messageId: "__openloomi_memory_graph__:user-1",
        platform: "openloomi-memory-graph",
        botId,
        userId,
        timestamp: 1774500000,
        content: "OpenLoomi internal memory graph ledger",
        metadata: {
          memoryGraphLedger: { snapshot: { version: "1" } },
        },
        createdAt: 1774500000,
      },
      { expectedVersion: "0", metadataKey: "memoryGraphLedger" },
    );

    expect(stored).toBe(true);
    expect(insertChain.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ setWhere: expect.anything() }),
    );
  });

  it("reports a stale durable graph ledger update without overwriting", async () => {
    const { db, updateChain } = createUpdateDb([]);
    const manager = new PostgresRawMessageManager(db as never);
    const stored = await manager.compareAndSwapGraphLedger(
      {
        messageId: "__openloomi_memory_graph__:user-1",
        platform: "openloomi-memory-graph",
        botId,
        userId,
        timestamp: 1774500000,
        content: "OpenLoomi internal memory graph ledger",
        metadata: {
          memoryGraphLedger: { snapshot: { version: "2" } },
        },
        createdAt: 1774500000,
      },
      { expectedVersion: "1", metadataKey: "memoryGraphLedger" },
    );

    expect(stored).toBe(false);
    expect(updateChain.set).toHaveBeenCalledOnce();
    expect(updateChain.where).toHaveBeenCalledOnce();
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

function createUpdateDb(returningRows: Array<{ id: number }>) {
  const updateChain = {
    set: vi.fn(() => updateChain),
    where: vi.fn(() => updateChain),
    returning: vi.fn(async () => returningRows),
  };
  const db = {
    update: vi.fn(() => updateChain),
  };
  return { db, updateChain };
}

describe("postgres raw message deprecation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deprecateMessages runs an UPDATE that filters on deprecated_at IS NULL", async () => {
    const { db, updateChain } = createUpdateDb([{ id: 1 }, { id: 2 }]);
    const manager = new PostgresRawMessageManager(db as never);
    const affected = await manager.deprecateMessages(["msg-1", "msg-2"], {
      userId,
      deprecatedAt: 1700000000000,
      reason: "summarized_into:s-1",
      supersededBySummaryId: "s-1",
    });
    expect(affected).toBe(2);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        deprecatedAt: 1700000000000,
        deprecationReason: "summarized_into:s-1",
        supersededBySummaryId: "s-1",
      }),
    );
  });

  it("deprecateMessages returns 0 for empty ids without hitting the DB", async () => {
    const { db } = createUpdateDb([]);
    const manager = new PostgresRawMessageManager(db as never);
    const affected = await manager.deprecateMessages([], { userId });
    expect(affected).toBe(0);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("deprecateMessages default timestamp defaults to Date.now()", async () => {
    const { db, updateChain } = createUpdateDb([{ id: 1 }]);
    const manager = new PostgresRawMessageManager(db as never);
    await manager.deprecateMessages(["msg-1"], { userId });
    const setArg = (
      updateChain.set as unknown as {
        mock: { calls: Array<[Record<string, unknown>]> };
      }
    ).mock.calls[0]?.[0];
    expect(setArg?.deprecatedAt).toEqual(expect.any(Number));
    expect(setArg?.deprecationReason).toBeNull();
    expect(setArg?.supersededBySummaryId).toBeNull();
  });

  it("restores only records still superseded by the targeted summary", async () => {
    const { db, updateChain } = createUpdateDb([{ id: 1 }, { id: 2 }]);
    const manager = new PostgresRawMessageManager(db as never);
    const affected = await manager.restoreDeprecatedMessages(
      ["msg-1", "msg-2"],
      { userId, supersededBySummaryId: "summary-1" },
    );

    expect(affected).toBe(2);
    expect(updateChain.set).toHaveBeenCalledWith({
      deprecatedAt: null,
      deprecationReason: null,
      supersededBySummaryId: null,
    });
    expect(updateChain.where).toHaveBeenCalledTimes(1);
  });
});
