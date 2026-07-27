import type { MemorySummaryRecord, RawMessage } from "@openloomi/indexeddb";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authMock,
  botExistsMock,
  getRawMessageManagerMock,
  getRawMessageStorageBackendMock,
  isRawMessageStorageAvailableMock,
  upsertRawMessagesToChromaMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  botExistsMock: vi.fn(),
  getRawMessageManagerMock: vi.fn(),
  getRawMessageStorageBackendMock: vi.fn(),
  isRawMessageStorageAvailableMock: vi.fn(),
  upsertRawMessagesToChromaMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/(auth)/auth", () => ({ auth: authMock }));
vi.mock("@/lib/db/queries", () => ({ botExists: botExistsMock }));
vi.mock("@/lib/memory/chroma-memory-index", () => ({
  upsertRawMessagesToChroma: upsertRawMessagesToChromaMock,
}));
vi.mock("@/lib/memory/raw-message-store", () => ({
  getRawMessageManager: getRawMessageManagerMock,
  getRawMessageStorageBackend: getRawMessageStorageBackendMock,
  isRawMessageStorageAvailable: isRawMessageStorageAvailableMock,
}));

import { POST as postMemoryRawMessages } from "@/app/api/memory/raw-messages/route";
import { POST as postRawMessages } from "@/app/api/messages/raw/route";

const USER_A = "00000000-0000-0000-0000-000000000001";
const USER_B = "00000000-0000-0000-0000-000000000002";
const BOT_A = "00000000-0000-0000-0000-000000000011";
const BOT_B = "00000000-0000-0000-0000-000000000022";

class UnsafeRouteRawMessageManager {
  readonly messages = new Map<string, RawMessage>();
  nextId = 1;

  readonly storeMessages = vi.fn(async (messages: RawMessage[]) =>
    messages.map((message) => {
      const id = this.messages.get(message.messageId)?.id ?? this.nextId++;
      this.messages.set(message.messageId, { ...message, id });
      return id;
    }),
  );

  readonly getMessageById = vi.fn(
    async (messageId: string) => this.messages.get(messageId) ?? null,
  );

  readonly upsertSummaries = vi.fn(
    async (_summaries: MemorySummaryRecord[]) => undefined,
  );
}

let manager: UnsafeRouteRawMessageManager;

function inputMessage(
  messageId: string,
  botId: string,
  content = `content:${messageId}`,
) {
  return {
    messageId,
    platform: "test",
    botId,
    channel: "owner-isolation",
    timestamp: 1_700_000_000,
    content,
  };
}

function storedMessage(
  messageId: string,
  userId: string,
  botId: string,
  content: string,
): RawMessage {
  return {
    id: 100,
    ...inputMessage(messageId, botId, content),
    userId,
    createdAt: 1_700_000_000,
  };
}

function messagesRawRequest(messages: unknown[]) {
  return postRawMessages(
    new NextRequest("http://localhost/api/messages/raw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, graphEvolution: { enabled: true } }),
    }),
  );
}

function memoryRawStoreRequest(messages: unknown[]) {
  return postMemoryRawMessages(
    new NextRequest("http://localhost/api/memory/raw-messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "store",
        messages,
        graphEvolution: { enabled: true },
      }),
    }),
  );
}

function memorySummaryUpsertRequest(summaries: unknown[]) {
  return postMemoryRawMessages(
    new NextRequest("http://localhost/api/memory/raw-messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "upsertSummaries", summaries }),
    }),
  );
}

describe("authenticated raw message route owner isolation", () => {
  beforeEach(() => {
    manager = new UnsafeRouteRawMessageManager();
    authMock.mockReset().mockResolvedValue({ user: { id: USER_A } });
    botExistsMock.mockReset().mockImplementation(async ({ id, userId }) => {
      const owner = id === BOT_A ? USER_A : id === BOT_B ? USER_B : undefined;
      return owner === userId ? { id, userId: owner } : undefined;
    });
    getRawMessageManagerMock
      .mockReset()
      .mockImplementation(async () => manager);
    getRawMessageStorageBackendMock.mockReset().mockReturnValue("postgres");
    isRawMessageStorageAvailableMock.mockReset().mockReturnValue(true);
    upsertRawMessagesToChromaMock.mockReset().mockResolvedValue(undefined);
  });

  it("protects /api/messages/raw before the whole batch is stored", async () => {
    const forbiddenBot = await messagesRawRequest([
      inputMessage("forbidden-bot", BOT_B),
    ]);
    expect(forbiddenBot.status).toBe(403);
    expect(manager.storeMessages).not.toHaveBeenCalled();
    expect(botExistsMock).toHaveBeenCalledWith({ id: BOT_B, userId: USER_A });

    manager.messages.set(
      "foreign-id",
      storedMessage("foreign-id", USER_B, BOT_B, "foreign-original"),
    );
    manager.storeMessages.mockClear();
    const conflict = await messagesRawRequest([
      inputMessage("new-in-rejected-batch", BOT_A),
      inputMessage("foreign-id", BOT_A, "attempted-overwrite"),
    ]);
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      success: false,
      reason: "raw_message_scope_conflict",
    });
    expect(manager.storeMessages).not.toHaveBeenCalled();
    expect(manager.messages.has("new-in-rejected-batch")).toBe(false);
    expect(manager.messages.get("foreign-id")).toMatchObject({
      userId: USER_B,
      botId: BOT_B,
      content: "foreign-original",
    });

    manager.messages.set(
      "same-owner",
      storedMessage("same-owner", USER_A, BOT_A, "before"),
    );
    const accepted = await messagesRawRequest([
      inputMessage("same-owner", BOT_A, "after"),
    ]);
    const acceptedBody = await accepted.json();
    expect(accepted.status).toBe(200);
    expect(acceptedBody.graphEvolution?.status).toBe("disabled");
    expect(acceptedBody.graphPolicy?.enabled).toBe(false);
    expect(manager.messages.get("same-owner")).toMatchObject({
      userId: USER_A,
      content: "after",
    });
  });

  it("protects /api/memory/raw-messages before store and Chroma writes", async () => {
    const forbiddenBot = await memoryRawStoreRequest([
      inputMessage("forbidden-bot", BOT_B),
    ]);
    expect(forbiddenBot.status).toBe(403);
    expect(manager.storeMessages).not.toHaveBeenCalled();
    expect(upsertRawMessagesToChromaMock).not.toHaveBeenCalled();

    manager.messages.set(
      "foreign-id",
      storedMessage("foreign-id", USER_B, BOT_B, "foreign-original"),
    );
    manager.storeMessages.mockClear();
    const conflict = await memoryRawStoreRequest([
      inputMessage("new-in-rejected-batch", BOT_A),
      inputMessage("foreign-id", BOT_A, "attempted-overwrite"),
    ]);
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      success: false,
      reason: "raw_message_scope_conflict",
    });
    expect(manager.storeMessages).not.toHaveBeenCalled();
    expect(upsertRawMessagesToChromaMock).not.toHaveBeenCalled();
    expect(manager.messages.has("new-in-rejected-batch")).toBe(false);
    expect(manager.messages.get("foreign-id")).toMatchObject({
      userId: USER_B,
      botId: BOT_B,
      content: "foreign-original",
    });

    manager.messages.set(
      "same-owner",
      storedMessage("same-owner", USER_A, BOT_A, "before"),
    );
    const accepted = await memoryRawStoreRequest([
      inputMessage("same-owner", BOT_A, "after"),
    ]);
    const acceptedBody = await accepted.json();
    expect(accepted.status).toBe(200);
    expect(acceptedBody.graphEvolution?.status).toBe("disabled");
    expect(acceptedBody.graphPolicy?.enabled).toBe(false);
    expect(upsertRawMessagesToChromaMock).toHaveBeenCalledOnce();
    expect(manager.messages.get("same-owner")).toMatchObject({
      userId: USER_A,
      content: "after",
    });
  });

  it("rejects reserved graph summary IDs on the untrusted summary action", async () => {
    const response = await memorySummaryUpsertRequest([
      {
        summaryId: "memory-graph-summary:user-a:cluster-a",
        summaryText: "attempted overwrite",
      },
    ]);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      success: false,
      reason: "memory_summary_reserved_id",
    });
    expect(manager.upsertSummaries).not.toHaveBeenCalled();
  });

  it("returns an observable conflict when summary ownership is rejected", async () => {
    manager.upsertSummaries.mockRejectedValueOnce(
      new Error("memory_summary_owner_scope_conflict"),
    );

    const response = await memorySummaryUpsertRequest([
      { summaryId: "foreign-summary", summaryText: "attempted transfer" },
    ]);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      success: false,
      reason: "memory_summary_owner_scope_conflict",
    });
    expect(manager.upsertSummaries).toHaveBeenCalledWith([
      expect.objectContaining({ summaryId: "foreign-summary", userId: USER_A }),
    ]);
  });

  it("rejects the reserved chat evidence namespace on both raw endpoints", async () => {
    for (const request of [messagesRawRequest, memoryRawStoreRequest]) {
      const existingId = "openloomi-chat:user-a:chat-a:message-a:language";
      manager.messages.set(
        existingId,
        storedMessage(existingId, USER_A, BOT_A, "protected evidence"),
      );
      manager.storeMessages.mockClear();
      upsertRawMessagesToChromaMock.mockClear();

      const overwrite = await request([
        inputMessage(existingId, BOT_A, "attempted overwrite"),
      ]);
      expect(overwrite.status).toBe(409);
      await expect(overwrite.json()).resolves.toEqual({
        success: false,
        reason: "raw_message_reserved_id",
      });
      expect(manager.storeMessages).not.toHaveBeenCalled();
      expect(upsertRawMessagesToChromaMock).not.toHaveBeenCalled();
      expect(manager.messages.get(existingId)?.content).toBe(
        "protected evidence",
      );

      const newId = "openloomi-chat:user-a:chat-a:new-message:language";
      const create = await request([inputMessage(newId, BOT_A)]);
      expect(create.status).toBe(409);
      await expect(create.json()).resolves.toMatchObject({
        reason: "raw_message_reserved_id",
      });
      expect(manager.messages.has(newId)).toBe(false);
    }
  });
});
