import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mockIsTauriMode: vi.fn(() => false),
  mockGenerateUUID: vi.fn(() => "summary-message-id"),
  mockDbTransaction: vi.fn(),
}));

vi.mock("@/lib/env/constants", () => ({
  isTauriMode: mocks.mockIsTauriMode,
}));

vi.mock("@/lib/utils", () => ({
  generateUUID: mocks.mockGenerateUUID,
}));

vi.mock("@/lib/db/adapters", () => {
  const fakeDb = {
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

import { replaceMessagesWithCompactionSummary } from "@/lib/db/queries";

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
      async (callback: (tx: any) => any) => {
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
