import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  manager: {
    init: vi.fn(),
    queryMessages: vi.fn(),
    querySummaries: vi.fn(),
  },
}));

vi.mock("../../../../packages/indexeddb/src/manager", () => ({
  getIndexedDBManager: () => mocks.manager,
}));

import {
  clearRawMessagesSQLiteMigrationState,
  ensureRawMessagesSQLiteMigration,
  getRawMessagesSQLiteMigrationState,
  getRawMessagesSQLiteMigrationStorageKey,
} from "../../../../packages/indexeddb/src/sqlite-client";

function createStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    get length() {
      return store.size;
    },
  } as unknown as Storage;
}

describe("raw message SQLite migration", () => {
  let storage: Storage;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storage = createStorage();
    (globalThis as any).window = {
      __TAURI__: {},
      localStorage: storage,
    };

    mocks.manager.init.mockReset();
    mocks.manager.queryMessages.mockReset();
    mocks.manager.querySummaries.mockReset();

    fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? "{}"));
      if (body.action === "store") {
        return new Response(
          JSON.stringify({
            success: true,
            stored: Array.isArray(body.messages) ? body.messages.length : 0,
          }),
        );
      }
      if (body.action === "upsertSummaries") {
        return new Response(
          JSON.stringify({
            success: true,
            stored: Array.isArray(body.summaries) ? body.summaries.length : 0,
          }),
        );
      }
      return new Response(JSON.stringify({ success: true }));
    });
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (globalThis as any).window = undefined;
    (globalThis as any).fetch = undefined;
  });

  it("migrates IndexedDB records in batches and records completion", async () => {
    const messages = [
      {
        messageId: "m1",
        userId: "u1",
        platform: "slack",
        botId: "b1",
        timestamp: 1,
        content: "one",
        createdAt: 1,
      },
      {
        messageId: "m2",
        userId: "u1",
        platform: "slack",
        botId: "b1",
        timestamp: 2,
        content: "two",
        createdAt: 2,
      },
      {
        messageId: "m3",
        userId: "u1",
        platform: "slack",
        botId: "b1",
        timestamp: 3,
        content: "three",
        createdAt: 3,
      },
    ];
    const summaries = [
      {
        summaryId: "s1",
        userId: "u1",
        summaryTier: "L1",
        sourceTier: "short",
        startTimestamp: 1,
        endTimestamp: 3,
        messageCount: 3,
        sourceRecordIds: ["m1", "m2", "m3"],
        keyPoints: ["summary"],
        keywords: ["slack"],
        keywordsText: "slack",
        summaryText: "summary",
        dimensions: { platform: "slack" },
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    mocks.manager.queryMessages.mockImplementation(async (query) => {
      const offset = query.offset ?? 0;
      return messages.slice(offset, offset + query.pageSize);
    });
    mocks.manager.querySummaries.mockImplementation(async (query) => {
      const offset = query.offset ?? 0;
      return summaries.slice(offset, offset + query.pageSize);
    });

    const result = await ensureRawMessagesSQLiteMigration({
      userId: "u1",
      batchSize: 2,
    });

    expect(result.status).toBe("completed");
    expect(result.migratedMessages).toBe(3);
    expect(result.migratedSummaries).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(getRawMessagesSQLiteMigrationState("u1")?.status).toBe("completed");
  });

  it("skips migration when the current version already completed", async () => {
    storage.setItem(
      getRawMessagesSQLiteMigrationStorageKey("u1"),
      JSON.stringify({
        version: 1,
        userId: "u1",
        status: "completed",
        migratedMessages: 12,
        migratedSummaries: 2,
        updatedAt: Date.now(),
        completedAt: Date.now(),
      }),
    );

    const result = await ensureRawMessagesSQLiteMigration({ userId: "u1" });

    expect(result).toMatchObject({
      status: "skipped",
      reason: "already_completed",
      migratedMessages: 12,
      migratedSummaries: 2,
    });
    expect(mocks.manager.init).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    clearRawMessagesSQLiteMigrationState("u1");
    expect(getRawMessagesSQLiteMigrationState("u1")).toBeNull();
  });
});
