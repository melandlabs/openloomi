import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mockIsTauriMode: vi.fn(() => false),
  mockGenerateUUID: vi.fn(() => "summary-message-id"),
  mockDbInsert: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockSqlitePrepare: vi.fn(),
  mockSqliteTransaction: vi.fn(),
}));

vi.mock("@/lib/env/constants", () => ({
  isTauriMode: mocks.mockIsTauriMode,
}));

vi.mock("@/lib/utils", () => ({
  generateUUID: mocks.mockGenerateUUID,
}));

vi.mock("@/lib/db/adapters", () => {
  const fakeDb = {
    $client: {
      prepare: (...args: unknown[]) => mocks.mockSqlitePrepare(...args),
      transaction: (...args: unknown[]) => mocks.mockSqliteTransaction(...args),
    },
    insert: (...args: unknown[]) => mocks.mockDbInsert(...args),
    transaction: (...args: unknown[]) => mocks.mockDbTransaction(...args),
  };
  return {
    initDb: vi.fn(() => fakeDb),
    getDb: vi.fn(() => fakeDb),
  };
});

vi.mock("@/lib/db/schema", () => {
  const placeholder = new Proxy(
    {},
    {
      get(_target, key) {
        if (key === "chat") {
          return {
            id: "schema:chat.id",
            userId: "schema:chat.userId",
          };
        }
        return `schema:${String(key)}`;
      },
      has() {
        return true;
      },
      getOwnPropertyDescriptor(_target, key) {
        return {
          configurable: true,
          enumerable: true,
          value: `schema:${String(key)}`,
          writable: false,
        };
      },
    },
  );
  return placeholder;
});

vi.mock("@openloomi/shared/errors", () => ({
  AppError: class AppError extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
      this.name = "AppError";
    }
  },
}));

vi.mock("@openloomi/security/token-encryption", () => ({
  encryptToken: vi.fn((value: string) => value),
  decryptToken: vi.fn((value: string) => value),
}));

vi.mock("@/lib/insights/filter-schema", () => ({
  MAX_CUSTOM_INSIGHT_FILTERS: 50,
}));

vi.mock("@/lib/insights/transform", () => ({
  generateInsightId: vi.fn(() => "insight-id"),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ kind: "and", args })),
  asc: vi.fn((...args: unknown[]) => ({ kind: "asc", args })),
  count: vi.fn((...args: unknown[]) => ({ kind: "count", args })),
  desc: vi.fn((...args: unknown[]) => ({ kind: "desc", args })),
  eq: vi.fn((...args: unknown[]) => ({ kind: "eq", args })),
  gt: vi.fn((...args: unknown[]) => ({ kind: "gt", args })),
  gte: vi.fn((...args: unknown[]) => ({ kind: "gte", args })),
  ilike: vi.fn((...args: unknown[]) => ({ kind: "ilike", args })),
  inArray: vi.fn((...args: unknown[]) => ({ kind: "inArray", args })),
  isNull: vi.fn((...args: unknown[]) => ({ kind: "isNull", args })),
  lt: vi.fn((...args: unknown[]) => ({ kind: "lt", args })),
  max: vi.fn((...args: unknown[]) => ({ kind: "max", args })),
  ne: vi.fn((...args: unknown[]) => ({ kind: "ne", args })),
  or: vi.fn((...args: unknown[]) => ({ kind: "or", args })),
  sql: vi.fn((...args: unknown[]) => ({ kind: "sql", args })),
  like: vi.fn((...args: unknown[]) => ({ kind: "like", args })),
}));

import {
  CHAT_OWNER_SCOPE_CONFLICT,
  DB_INSERT_CHUNK_SIZE,
  MESSAGE_ID_SCOPE_CONFLICT,
  replaceMessagesWithCompactionSummary,
  saveChat,
  saveMessages,
} from "@/lib/db/queries";

describe("replaceMessagesWithCompactionSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockIsTauriMode.mockReturnValue(false);
    mocks.mockGenerateUUID.mockReturnValue("summary-message-id");
  });

  it("returns null immediately when messageIds is empty", async () => {
    const result = await replaceMessagesWithCompactionSummary({
      chatId: "chat-1",
      messageIds: [],
      summary: "summary",
      createdAt: new Date("2026-04-08T00:00:00.000Z"),
      compactedMessageCount: 0,
      compactedRangeStart: "2026-04-01",
      compactedRangeEnd: "2026-04-08",
      level: "soft",
    });

    expect(result).toBeNull();
    expect(mocks.mockDbTransaction).not.toHaveBeenCalled();
  });

  it("inserts summary and deletes related vote/message rows in one transaction", async () => {
    const returning = vi.fn().mockResolvedValue([
      {
        id: "summary-message-id",
        chatId: "chat-1",
      },
    ]);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });

    const where = vi.fn().mockResolvedValue(undefined);
    const deleteMock = vi.fn().mockReturnValue({ where });

    const tx = {
      insert,
      delete: deleteMock,
    };

    mocks.mockDbTransaction.mockImplementation(
      async (callback: (transaction: typeof tx) => unknown) => {
        return callback(tx);
      },
    );

    const result = await replaceMessagesWithCompactionSummary({
      chatId: "chat-1",
      messageIds: ["m1", "m2"],
      summary: "compacted text",
      createdAt: new Date("2026-04-08T00:00:00.000Z"),
      compactedMessageCount: 2,
      compactedRangeStart: "2026-04-01",
      compactedRangeEnd: "2026-04-08",
      level: "hard",
    });

    expect(mocks.mockDbTransaction).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "summary-message-id",
        chatId: "chat-1",
        role: "assistant",
        parts: [{ type: "text", text: "compacted text" }],
        attachments: [],
        metadata: expect.objectContaining({
          type: "compaction_summary",
          level: "hard",
          compactedMessageCount: 2,
          compactedRangeStart: "2026-04-01",
          compactedRangeEnd: "2026-04-08",
          sourceMessageIds: ["m1", "m2"],
        }),
      }),
    );
    expect(deleteMock).toHaveBeenCalledTimes(2);
    expect(where).toHaveBeenCalledTimes(2);
    expect(result).toEqual(
      expect.objectContaining({
        id: "summary-message-id",
        chatId: "chat-1",
      }),
    );
  });
});

describe("chat message owner isolation queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockIsTauriMode.mockReturnValue(false);
  });

  it("guards chat conflict updates by the persisted owner", async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue([]);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    mocks.mockDbInsert.mockReturnValue({ values });

    await saveChat({ id: "chat-1", userId: "owner-1", title: "Owned" });

    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        setWhere: {
          kind: "eq",
          args: ["schema:chat.userId", "owner-1"],
        },
      }),
    );
  });

  it("persists every message chunk inside one transaction", async () => {
    const insert = vi.fn().mockImplementation(() => ({
      values: (chunk: Array<{ id: string }>) => ({
        onConflictDoUpdate: () => ({
          returning: async () => chunk.map(({ id }) => ({ id })),
        }),
      }),
    }));
    mocks.mockDbTransaction.mockImplementation(
      async (callback: (tx: { insert: typeof insert }) => unknown) =>
        callback({ insert }),
    );
    const messages = Array.from(
      { length: DB_INSERT_CHUNK_SIZE + 1 },
      (_, index) => ({
        id: `message-${index}`,
        chatId: "chat-1",
        role: "user" as const,
        parts: [],
        attachments: [],
        createdAt: new Date(index),
        metadata: null,
      }),
    );

    await saveMessages({ messages });

    expect(mocks.mockDbTransaction).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("throws a scope conflict from inside the transaction", async () => {
    let transactionRejected = false;
    const insert = vi.fn().mockReturnValue({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: async () => [{ id: "message-1" }],
        }),
      }),
    });
    mocks.mockDbTransaction.mockImplementation(
      async (callback: (tx: { insert: typeof insert }) => unknown) => {
        try {
          return await callback({ insert });
        } catch (error) {
          transactionRejected = true;
          throw error;
        }
      },
    );

    await expect(
      saveMessages({
        messages: [
          {
            id: "message-1",
            chatId: "chat-1",
            role: "user",
            parts: [],
            attachments: [],
            createdAt: new Date(1),
            metadata: null,
          },
          {
            id: "message-2",
            chatId: "chat-1",
            role: "user",
            parts: [],
            attachments: [],
            createdAt: new Date(2),
            metadata: null,
          },
        ],
      }),
    ).rejects.toThrow(MESSAGE_ID_SCOPE_CONFLICT);
    expect(transactionRejected).toBe(true);
  });
  it("rejects a postgres chat owner race inside the message transaction", async () => {
    const forUpdate = vi
      .fn()
      .mockResolvedValue([{ id: "chat-1", userId: "other-owner" }]);
    const where = vi.fn().mockReturnValue({ for: forUpdate });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const insert = vi.fn();
    mocks.mockDbTransaction.mockImplementation(
      async (
        callback: (tx: {
          select: typeof select;
          insert: typeof insert;
        }) => unknown,
      ) => callback({ select, insert }),
    );

    await expect(
      saveMessages({
        messages: [
          {
            id: "owner-race-message",
            chatId: "chat-1",
            role: "user",
            parts: [],
            attachments: [],
            createdAt: new Date(1),
            metadata: null,
          },
        ],
        expectedUserId: "owner-1",
      }),
    ).rejects.toThrow(CHAT_OWNER_SCOPE_CONFLICT);
    expect(forUpdate).toHaveBeenCalledWith("update");
    expect(insert).not.toHaveBeenCalled();
  });

  it("rolls back the full Tauri batch when a later upsert conflicts", async () => {
    mocks.mockIsTauriMode.mockReturnValue(true);
    const getOwner = vi.fn().mockReturnValue({ userId: "owner-1" });
    const getMessageState = vi.fn().mockReturnValue(undefined);
    const runUpsert = vi
      .fn()
      .mockReturnValueOnce({ changes: 1 })
      .mockReturnValueOnce({ changes: 0 });
    mocks.mockSqlitePrepare
      .mockReturnValueOnce({ get: getOwner, run: vi.fn() })
      .mockReturnValueOnce({ get: getMessageState, run: vi.fn() })
      .mockReturnValueOnce({ get: vi.fn(), run: runUpsert });

    let transactionRejected = false;
    mocks.mockSqliteTransaction.mockImplementation(
      (callback: () => unknown) => ({
        immediate: () => {
          try {
            return callback();
          } catch (error) {
            transactionRejected = true;
            throw error;
          }
        },
      }),
    );

    await expect(
      saveMessages({
        messages: [
          {
            id: "tauri-message-1",
            chatId: "chat-1",
            role: "user",
            parts: [],
            attachments: [],
            createdAt: new Date(1),
            metadata: null,
          },
          {
            id: "tauri-message-2",
            chatId: "chat-1",
            role: "user",
            parts: [],
            attachments: [],
            createdAt: new Date(2),
            metadata: null,
          },
        ],
        expectedMessages: [],
        expectedUserId: "owner-1",
      }),
    ).rejects.toThrow(MESSAGE_ID_SCOPE_CONFLICT);

    expect(mocks.mockSqliteTransaction).toHaveBeenCalledOnce();
    expect(getOwner).toHaveBeenCalledWith("chat-1");
    expect(getMessageState).toHaveBeenCalledTimes(2);
    expect(runUpsert).toHaveBeenCalledTimes(2);
    expect(transactionRejected).toBe(true);
    expect(mocks.mockDbTransaction).not.toHaveBeenCalled();
  });
});
