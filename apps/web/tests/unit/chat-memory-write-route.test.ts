import {
  type MemorySummaryRecord,
  type RawMessage,
  type RawMessageQuery,
  createRawMessageMemoryGraphStore,
  memoryGraphLedgerMessageId,
  mergeStoredChatMemoryEvidence,
} from "@openloomi/indexeddb";
import type { OwnerScope } from "@openloomi/memory-consolidation";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  authMock,
  botExistsMock,
  clearAIUserContextMock,
  ensureUserDefaultBotMock,
  generateTitleFromUserMessageMock,
  getChatByIdMock,
  getMessageByIdMock,
  getRawMessageManagerMock,
  getRawMessageStorageBackendMock,
  isRawMessageStorageAvailableMock,
  isTauriModeMock,
  saveChatMock,
  saveMessagesMock,
  setAIUserContextFromRequestMock,
  syncChatToFilesystemMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  botExistsMock: vi.fn(),
  clearAIUserContextMock: vi.fn(),
  ensureUserDefaultBotMock: vi.fn(),
  generateTitleFromUserMessageMock: vi.fn(),
  getChatByIdMock: vi.fn(),
  getMessageByIdMock: vi.fn(),
  getRawMessageManagerMock: vi.fn(),
  getRawMessageStorageBackendMock: vi.fn(),
  isRawMessageStorageAvailableMock: vi.fn(),
  isTauriModeMock: vi.fn(),
  saveChatMock: vi.fn(),
  saveMessagesMock: vi.fn(),
  setAIUserContextFromRequestMock: vi.fn(),
  syncChatToFilesystemMock: vi.fn(),
}));

vi.mock("@/app/(auth)/auth", () => ({ auth: authMock }));
vi.mock("@/app/(chat)/actions", () => ({
  generateTitleFromUserMessage: generateTitleFromUserMessageMock,
}));
vi.mock("@/lib/ai", () => ({
  clearAIUserContext: clearAIUserContextMock,
}));
vi.mock("@/lib/ai/memory/chat-sync", () => ({
  syncChatToFilesystem: syncChatToFilesystemMock,
}));
vi.mock("@/lib/ai/request-context", () => ({
  setAIUserContextFromRequest: setAIUserContextFromRequestMock,
}));
vi.mock("@/lib/db/queries", () => ({
  CHAT_OWNER_SCOPE_CONFLICT: "chat_owner_scope_conflict",
  MESSAGE_ID_SCOPE_CONFLICT: "message_id_scope_conflict",
  botExists: botExistsMock,
  ensureUserDefaultBot: ensureUserDefaultBotMock,
  getChatById: getChatByIdMock,
  getMessageById: getMessageByIdMock,
  saveChat: saveChatMock,
  saveMessages: saveMessagesMock,
}));
vi.mock("@/lib/env", () => ({ isTauriMode: isTauriModeMock }));
vi.mock("@/lib/memory/chroma-memory-index", () => ({
  upsertRawMessagesToChroma: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/memory/raw-message-store", () => ({
  getRawMessageManager: getRawMessageManagerMock,
  getRawMessageStorageBackend: getRawMessageStorageBackendMock,
  isRawMessageStorageAvailable: isRawMessageStorageAvailableMock,
}));

import { POST as saveChatMessages } from "@/app/(chat)/api/chat/save-messages/route";
import { POST as rawMemoryRoute } from "@/app/api/memory/raw-messages/route";

const NOW = 1_700_000_000_000;
const USER_ID = "cohort-user";
const CHAT_ID = "chat-1";
const BOT_ID = "00000000-0000-4000-8000-000000000001";
const OWNER = { userId: USER_ID } satisfies OwnerScope;

interface PersistedChatMessageRow {
  id: string;
  chatId: string;
  role: string;
  parts: unknown[];
  attachments: unknown[];
  createdAt: Date;
  metadata: unknown;
}

let persistedChatMessages = new Map<string, PersistedChatMessageRow>();

function rawEvidenceId(
  messageId: string,
  relationGroup: "language" | "response-style",
  input: { userId?: string; chatId?: string } = {},
): string {
  return `openloomi-chat:${encodeURIComponent(input.userId ?? USER_ID)}:${encodeURIComponent(input.chatId ?? CHAT_ID)}:${messageId}:${relationGroup}`;
}

class ChatMemoryTestManager {
  readonly messages = new Map<string, RawMessage>();
  readonly summaries = new Map<string, MemorySummaryRecord>();
  nextId = 1;
  ledgerWriteCount = 0;
  failQueryReads = 0;
  failDeprecationWrites = 0;
  deprecateMessages?: (
    messageIds: string[],
    input?: {
      userId?: string;
      deprecatedAt?: number;
      reason?: string;
      supersededBySummaryId?: string;
    },
  ) => Promise<number>;

  constructor(input: { supportsDeprecation?: boolean } = {}) {
    if (input.supportsDeprecation !== false) {
      this.deprecateMessages = async (messageIds, options = {}) => {
        if (this.failDeprecationWrites > 0) {
          this.failDeprecationWrites -= 1;
          throw new Error("deprecation write failed");
        }
        let changed = 0;
        for (const messageId of messageIds) {
          const message = this.messages.get(messageId);
          if (
            !message ||
            message.deprecatedAt !== undefined ||
            (options.userId && message.userId !== options.userId)
          ) {
            continue;
          }
          this.messages.set(messageId, {
            ...message,
            deprecatedAt: options.deprecatedAt ?? Date.now(),
            deprecationReason: options.reason,
            supersededBySummaryId: options.supersededBySummaryId,
          });
          changed += 1;
        }
        return changed;
      };
    }
  }

  async storeMessage(message: RawMessage): Promise<number> {
    if (message.messageId.startsWith("__openloomi_memory_graph__")) {
      this.ledgerWriteCount += 1;
    }
    const existing = this.messages.get(message.messageId);
    const id = existing?.id ?? this.nextId++;
    const messageToStore = existing
      ? mergeStoredChatMemoryEvidence(existing, message)
      : message;
    this.messages.set(message.messageId, {
      ...messageToStore,
      id,
      deprecatedAt: existing?.deprecatedAt ?? message.deprecatedAt,
      deprecationReason:
        existing?.deprecationReason ?? message.deprecationReason,
      supersededBySummaryId:
        existing?.supersededBySummaryId ?? message.supersededBySummaryId,
    });
    return id;
  }

  async storeMessages(messages: RawMessage[]): Promise<number[]> {
    return Promise.all(messages.map((message) => this.storeMessage(message)));
  }

  async compareAndSwapGraphLedger(
    message: RawMessage,
    input: { expectedVersion: string; metadataKey: string },
  ): Promise<boolean> {
    const current = this.messages.get(message.messageId);
    const ledger = current?.metadata?.[input.metadataKey] as
      | { snapshot?: { version?: unknown } }
      | undefined;
    const currentVersion =
      typeof ledger?.snapshot?.version === "string"
        ? ledger.snapshot.version
        : "0";
    if (currentVersion !== input.expectedVersion) return false;
    await this.storeMessage(message);
    return true;
  }

  async getMessageById(messageId: string): Promise<RawMessage | null> {
    return this.messages.get(messageId) ?? null;
  }

  async queryMessages(query: RawMessageQuery): Promise<RawMessage[]> {
    if (this.failQueryReads > 0) {
      this.failQueryReads -= 1;
      throw new Error("query failed");
    }
    let messages = [...this.messages.values()];
    if (query.userId) {
      messages = messages.filter((message) => message.userId === query.userId);
    }
    if (!query.includeArchived) {
      messages = messages.filter((message) => message.archivedAt === undefined);
    }
    if (!query.includeDeprecated) {
      messages = messages.filter(
        (message) => message.deprecatedAt === undefined,
      );
    }
    if (query.memoryStages) {
      messages = messages.filter(
        (message) =>
          message.memoryStage !== undefined &&
          query.memoryStages?.includes(message.memoryStage),
      );
    }
    messages.sort((left, right) =>
      query.reverse === false
        ? left.timestamp - right.timestamp
        : right.timestamp - left.timestamp,
    );
    const offset = query.offset ?? 0;
    const limit = query.limit ?? query.pageSize ?? messages.length;
    return messages.slice(offset, offset + limit);
  }

  async upsertSummaries(summaries: MemorySummaryRecord[]): Promise<void> {
    for (const summary of summaries) {
      const existing = this.summaries.get(summary.summaryId);
      this.summaries.set(summary.summaryId, {
        ...summary,
        createdAt: existing?.createdAt ?? summary.createdAt,
      });
    }
  }

  async querySummaries(input: {
    userId?: string;
    pageSize?: number;
  }): Promise<MemorySummaryRecord[]> {
    return [...this.summaries.values()]
      .filter((summary) => !input.userId || summary.userId === input.userId)
      .slice(0, input.pageSize);
  }

  async markMessagesAccessed(): Promise<number> {
    return 0;
  }

  async hardDeleteArchived(): Promise<number> {
    return 0;
  }
}

interface MemoryWriteDiagnostics {
  status: "no-op" | "baseline" | "applied" | "partial-failure";
  evidenceCount: number;
  storedCount: number;
  graphPolicy: { enabled: boolean; reasonCodes: string[] };
  graphEvolution?: {
    status: string;
    reasonCodes: string[];
    consideredCandidateIds?: string[];
  };
  graphLifecycle?: {
    status: string;
    createdSummaries: number;
    deprecatedRecords: number;
    reasonCodes: string[];
    candidateResults?: Array<{
      status: string;
      error?: {
        name: string;
        message: string;
      };
    }>;
  };
  retryable: boolean;
  reasonCodes: string[];
}

let manager: ChatMemoryTestManager | Record<string, unknown>;

function chatMessage(
  id: string,
  text: string,
  input: {
    role?: "user" | "assistant";
    metadata?: Record<string, unknown>;
  } = {},
) {
  return {
    id,
    role: input.role ?? "user",
    parts: [{ type: "text", text }],
    createdAt: new Date(Date.now()).toISOString(),
    metadata: input.metadata,
  };
}

async function postChat(
  messages: Array<ReturnType<typeof chatMessage>>,
  body: Record<string, unknown> = {},
) {
  const response = await saveChatMessages(
    new Request("http://localhost/api/chat/save-messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: CHAT_ID,
        messages,
        skipSync: true,
        ...body,
      }),
    }),
  );
  return {
    response,
    body: (await response.json()) as Record<string, unknown>,
  };
}

function memoryWrite(body: Record<string, unknown>): MemoryWriteDiagnostics {
  expect(body).toHaveProperty("memoryWrite");
  return body.memoryWrite as MemoryWriteDiagnostics;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function rawEvidence(current = manager): RawMessage[] {
  if (!(current instanceof ChatMemoryTestManager)) return [];
  return [...current.messages.values()].filter(
    (message) => message.platform === "openloomi-chat",
  );
}

async function snapshot(current = manager, ownerScope: OwnerScope = OWNER) {
  if (!(current instanceof ChatMemoryTestManager)) {
    throw new Error("expected graph-capable test manager");
  }
  return createRawMessageMemoryGraphStore({
    storage: current,
    ownerScope,
    now: () => Date.now(),
  }).readSnapshot({ ownerScope, includeAuditOnly: true });
}

async function writeStableChinesePreference() {
  const diagnostics: MemoryWriteDiagnostics[] = [];
  const texts = [
    "I prefer Chinese for all replies.",
    "Going forward, please always respond in Chinese.",
    "Remember that I like Chinese responses.",
  ];
  for (const [index, text] of texts.entries()) {
    vi.setSystemTime(NOW + index * 1000);
    const result = await postChat([
      chatMessage(`preference-${index + 1}`, text),
    ]);
    expect(result.response.status).toBe(200);
    diagnostics.push(memoryWrite(result.body));
  }
  return diagnostics;
}

describe("chat save memory write runtime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubEnv("OPENLOOMI_MEMORY_GRAPH_WRITE_ENABLED", "true");
    vi.stubEnv("OPENLOOMI_MEMORY_GRAPH_WRITE_COHORT_USER_IDS", USER_ID);
    vi.stubEnv("OPENLOOMI_MEMORY_GRAPH_WRITE_KILL_SWITCH", "false");

    manager = new ChatMemoryTestManager();
    persistedChatMessages = new Map();
    authMock.mockReset().mockResolvedValue({
      user: {
        id: USER_ID,
        email: "cohort@example.com",
        name: "Cohort User",
        type: "regular",
      },
    });
    botExistsMock.mockReset().mockResolvedValue(true);
    ensureUserDefaultBotMock.mockReset().mockResolvedValue(BOT_ID);
    getChatByIdMock.mockReset().mockResolvedValue({
      id: CHAT_ID,
      userId: USER_ID,
      title: "Memory chat",
      createdAt: new Date(NOW),
    });
    getMessageByIdMock.mockReset().mockImplementation(async ({ id }) => {
      const row = persistedChatMessages.get(id);
      return row
        ? [
            {
              ...row,
              parts: [...row.parts],
              attachments: [...row.attachments],
            },
          ]
        : [];
    });
    getRawMessageManagerMock
      .mockReset()
      .mockImplementation(async () => manager);
    getRawMessageStorageBackendMock.mockReset().mockReturnValue("memory");
    isRawMessageStorageAvailableMock.mockReset().mockReturnValue(true);
    isTauriModeMock.mockReset().mockReturnValue(false);
    saveChatMock.mockReset().mockResolvedValue(undefined);
    saveMessagesMock
      .mockReset()
      .mockImplementation(
        async ({ messages }: { messages: PersistedChatMessageRow[] }) => {
          for (const row of messages) {
            const existing = persistedChatMessages.get(row.id);
            if (existing && existing.chatId !== row.chatId) continue;
            persistedChatMessages.set(
              row.id,
              existing
                ? {
                    ...existing,
                    parts: [...row.parts],
                    attachments: [...row.attachments],
                    metadata: row.metadata,
                  }
                : {
                    ...row,
                    parts: [...row.parts],
                    attachments: [...row.attachments],
                  },
            );
          }
        },
      );
    setAIUserContextFromRequestMock.mockReset().mockResolvedValue(undefined);
    clearAIUserContextMock.mockReset();
    generateTitleFromUserMessageMock
      .mockReset()
      .mockResolvedValue("Generated title");
    syncChatToFilesystemMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("clears AI context for malformed chat save requests", async () => {
    const missingChatId = await postChat(
      [chatMessage("missing-chat", "I prefer Chinese responses.")],
      { chatId: null },
    );

    expect(missingChatId.response.status).toBe(400);
    expect(missingChatId.body).toEqual({ error: "chatId is required" });
    expect(clearAIUserContextMock).toHaveBeenCalledOnce();
    expect(saveMessagesMock).not.toHaveBeenCalled();

    clearAIUserContextMock.mockClear();
    const invalidMessages = await postChat([], {
      messages: "not-an-array",
    });

    expect(invalidMessages.response.status).toBe(400);
    expect(invalidMessages.body).toEqual({ error: "messages is required" });
    expect(clearAIUserContextMock).toHaveBeenCalledOnce();
    expect(saveMessagesMock).not.toHaveBeenCalled();
  });

  it("writes route evidence through reinforcement into a lifecycle summary", async () => {
    const diagnostics = await writeStableChinesePreference();
    const current = manager as ChatMemoryTestManager;
    const storedSummary = [...current.summaries.values()][0];
    const evidence = rawEvidence(current);
    const graph = await snapshot(current);

    expect(diagnostics.at(-1)).toEqual(
      expect.objectContaining({
        status: "applied",
        evidenceCount: 1,
        storedCount: 1,
        retryable: false,
        graphPolicy: expect.objectContaining({ enabled: true }),
        graphLifecycle: expect.objectContaining({
          status: "applied",
          createdSummaries: 1,
          deprecatedRecords: 3,
        }),
      }),
    );
    expect(storedSummary).toEqual(
      expect.objectContaining({
        sourceRecordIds: [
          rawEvidenceId("preference-1", "language"),
          rawEvidenceId("preference-2", "language"),
          rawEvidenceId("preference-3", "language"),
        ],
        messageCount: 3,
      }),
    );
    expect(evidence).toHaveLength(3);
    expect(ensureUserDefaultBotMock).toHaveBeenCalledTimes(3);
    expect(ensureUserDefaultBotMock).toHaveBeenLastCalledWith(USER_ID);
    expect(evidence.every((message) => message.botId === BOT_ID)).toBe(true);
    expect(current.messages.get(memoryGraphLedgerMessageId(OWNER))?.botId).toBe(
      BOT_ID,
    );
    expect(
      evidence.every(
        (message) =>
          message.deprecatedAt !== undefined &&
          message.supersededBySummaryId === storedSummary?.summaryId &&
          message.deprecationReason?.startsWith("summarized_into:"),
      ),
    ).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "support")).toBe(true);
    expect(graph.clusters).toEqual([
      expect.objectContaining({
        lifecycleStatus: "stable",
        representativeNodeId: storedSummary?.summaryId,
        supportScore: expect.any(Number),
      }),
    ]);
  });

  it("replays one chat message without duplicate reinforcement or summaries", async () => {
    await writeStableChinesePreference();
    const current = manager as ChatMemoryTestManager;
    const before = await snapshot(current);
    const ledgerWrites = current.ledgerWriteCount;
    const summaryIds = [...current.summaries.keys()];
    const supportWeight = before.edges.find(
      (edge) => edge.kind === "support",
    )?.weight;
    const replayEvidenceId = rawEvidenceId("preference-3", "language");
    const evidenceTimestamp = current.messages.get(replayEvidenceId)?.timestamp;
    const evidenceCreatedAt = current.messages.get(replayEvidenceId)?.createdAt;
    const persistedCreatedAt =
      persistedChatMessages.get("preference-3")?.createdAt;
    const existingEvidence = current.messages.get(replayEvidenceId);
    if (!existingEvidence) throw new Error("expected persisted raw evidence");
    const preservedState = {
      embedding: [0.25, 0.75],
      embeddingModel: "test-embedding",
      embeddingContentHash: "content-hash",
      embeddingDimensions: 2,
      embeddingUpdatedAt: NOW + 2500,
      memoryStage: "long" as const,
      accessCount: 7,
      lastAccessAt: NOW + 2600,
      importanceScore: 0.95,
      archivedAt: NOW + 2700,
      isPinned: true,
      summaryRefId: "summary-ref",
    };
    current.messages.set(replayEvidenceId, {
      ...existingEvidence,
      ...preservedState,
    });

    vi.setSystemTime(NOW + 4000);
    const replay = await postChat([
      chatMessage("preference-3", "Remember that I like Chinese responses."),
    ]);
    const after = await snapshot(current);

    expect(replay.response.status).toBe(200);
    expect(memoryWrite(replay.body).graphEvolution?.status).toBe("no-op");
    expect(after.nodes.filter((node) => node.type === "raw")).toHaveLength(3);
    expect(after.edges.find((edge) => edge.kind === "support")?.weight).toBe(
      supportWeight,
    );
    expect([...current.summaries.keys()]).toEqual(summaryIds);
    expect(current.ledgerWriteCount).toBe(ledgerWrites);
    expect(current.messages.get(replayEvidenceId)?.timestamp).toBe(
      evidenceTimestamp,
    );
    expect(current.messages.get(replayEvidenceId)?.createdAt).toBe(
      evidenceCreatedAt,
    );
    expect(persistedChatMessages.get("preference-3")?.createdAt).toEqual(
      persistedCreatedAt,
    );
    expect(current.messages.get(replayEvidenceId)).toMatchObject(
      preservedState,
    );
    expect(
      rawEvidence(current).every((item) => item.deprecatedAt !== undefined),
    ).toBe(true);
  });

  it("rejects an in-place revision of persisted memory evidence", async () => {
    await writeStableChinesePreference();
    const current = manager as ChatMemoryTestManager;
    const evidenceId = rawEvidenceId("preference-3", "language");
    const beforeRaw = current.messages.get(evidenceId);
    const beforePersisted = persistedChatMessages.get("preference-3");
    const beforeGraph = await snapshot(current);
    const beforeSummaries = [...current.summaries.values()];
    const beforeLedgerWrites = current.ledgerWriteCount;
    const beforeSaveCalls = saveMessagesMock.mock.calls.length;

    clearAIUserContextMock.mockClear();
    vi.setSystemTime(NOW + 5000);
    const result = await postChat([
      chatMessage("preference-3", "I prefer English for all replies."),
    ]);

    expect(beforeRaw?.deprecatedAt).toBeDefined();
    expect(result.response.status).toBe(409);
    expect(result.body).toEqual({
      error: "Message memory evidence cannot be revised in place",
      code: "chat_memory_evidence_revision_conflict",
      messageId: "preference-3",
    });
    expect(saveMessagesMock).toHaveBeenCalledTimes(beforeSaveCalls);
    expect(persistedChatMessages.get("preference-3")).toEqual(beforePersisted);
    expect(current.messages.get(evidenceId)).toEqual(beforeRaw);
    expect([...current.summaries.values()]).toEqual(beforeSummaries);
    expect(await snapshot(current)).toEqual(beforeGraph);
    expect(current.ledgerWriteCount).toBe(beforeLedgerWrites);
    expect(clearAIUserContextMock).toHaveBeenCalledOnce();
  });

  it("rejects a revision after the persisted chat marker row was deleted", async () => {
    await writeStableChinesePreference();
    const current = manager as ChatMemoryTestManager;
    const evidenceId = rawEvidenceId("preference-3", "language");
    const beforeRaw = current.messages.get(evidenceId);
    const beforeSummaries = [...current.summaries.values()];
    const beforeGraph = await snapshot(current);
    const beforeSaveCalls = saveMessagesMock.mock.calls.length;

    persistedChatMessages.delete("preference-3");
    const result = await postChat([
      chatMessage("preference-3", "Remember that I prefer concise responses."),
    ]);

    expect(result.response.status).toBe(409);
    expect(result.body).toEqual({
      error: "Message memory evidence cannot be revised in place",
      code: "chat_memory_evidence_revision_conflict",
      messageId: "preference-3",
    });
    expect(saveMessagesMock).toHaveBeenCalledTimes(beforeSaveCalls);
    expect(persistedChatMessages.has("preference-3")).toBe(false);
    expect(current.messages.get(evidenceId)).toEqual(beforeRaw);
    expect([...current.summaries.values()]).toEqual(beforeSummaries);
    expect(await snapshot(current)).toEqual(beforeGraph);
  });

  it("rejects a deleted-row revision that no longer yields memory evidence", async () => {
    await writeStableChinesePreference();
    const current = manager as ChatMemoryTestManager;
    const evidenceId = rawEvidenceId("preference-3", "language");
    const beforeRaw = current.messages.get(evidenceId);
    const beforeSaveCalls = saveMessagesMock.mock.calls.length;

    persistedChatMessages.delete("preference-3");
    const result = await postChat([
      chatMessage("preference-3", "Please do not use Chinese."),
    ]);

    expect(result.response.status).toBe(409);
    expect(result.body).toEqual({
      error: "Message memory evidence cannot be revised in place",
      code: "chat_memory_evidence_revision_conflict",
      messageId: "preference-3",
    });
    expect(saveMessagesMock).toHaveBeenCalledTimes(beforeSaveCalls);
    expect(persistedChatMessages.has("preference-3")).toBe(false);
    expect(current.messages.get(evidenceId)).toEqual(beforeRaw);
  });

  it("fails closed when a legacy memory revision check is unavailable", async () => {
    const initial = await postChat([
      chatMessage("revision-check-outage", "I prefer Chinese responses."),
    ]);
    expect(initial.response.status).toBe(200);
    const current = manager as ChatMemoryTestManager;
    const evidenceId = rawEvidenceId("revision-check-outage", "language");
    const beforeRaw = current.messages.get(evidenceId);
    const beforeSaveCalls = saveMessagesMock.mock.calls.length;
    const persisted = persistedChatMessages.get("revision-check-outage");
    if (!persisted || typeof persisted.metadata !== "object") {
      throw new Error("expected persisted evidence marker");
    }
    const metadata = { ...(persisted.metadata as Record<string, unknown>) };
    metadata.__openloomiMemoryEvidence = undefined;
    persistedChatMessages.set("revision-check-outage", {
      ...persisted,
      metadata,
    });

    isRawMessageStorageAvailableMock.mockReturnValue(false);
    clearAIUserContextMock.mockClear();
    const result = await postChat([
      chatMessage("revision-check-outage", "I prefer English responses."),
    ]);

    expect(result.response.status).toBe(503);
    expect(result.body).toEqual({
      error: "Message memory evidence revision check is unavailable",
      code: "chat_memory_evidence_revision_check_unavailable",
      messageId: "revision-check-outage",
    });
    expect(saveMessagesMock).toHaveBeenCalledTimes(beforeSaveCalls);
    expect(current.messages.get(evidenceId)).toEqual(beforeRaw);
    expect(clearAIUserContextMock).toHaveBeenCalledOnce();
  });

  it("blocks a concurrent revision after the chat evidence marker commits", async () => {
    const enteredMemoryWrite = deferred();
    const releaseMemoryWrite = deferred();
    const current = manager as ChatMemoryTestManager;
    getRawMessageManagerMock
      .mockImplementationOnce(async () => current)
      .mockImplementationOnce(async () => {
        enteredMemoryWrite.resolve();
        await releaseMemoryWrite.promise;
        return current;
      })
      .mockImplementation(async () => current);

    const firstWrite = postChat([
      chatMessage("pending-evidence", "I prefer Chinese responses."),
    ]);
    await enteredMemoryWrite.promise;
    const persistedBeforeRaw = persistedChatMessages.get("pending-evidence");
    expect(persistedBeforeRaw?.metadata).toEqual(
      expect.objectContaining({
        __openloomiMemoryEvidence: expect.objectContaining({
          schemaVersion: 1,
          messageId: "pending-evidence",
          sourceIdentityIds: [rawEvidenceId("pending-evidence", "language")],
        }),
      }),
    );
    expect(
      current.messages.has(rawEvidenceId("pending-evidence", "language")),
    ).toBe(false);
    const saveCallsAfterMarker = saveMessagesMock.mock.calls.length;

    const revision = await postChat([
      chatMessage("pending-evidence", "I prefer English responses."),
    ]);
    expect(revision.response.status).toBe(409);
    expect(revision.body).toEqual({
      error: "Message memory evidence cannot be revised in place",
      code: "chat_memory_evidence_revision_conflict",
      messageId: "pending-evidence",
    });
    expect(saveMessagesMock).toHaveBeenCalledTimes(saveCallsAfterMarker);

    releaseMemoryWrite.resolve();
    const completed = await firstWrite;
    expect(completed.response.status).toBe(200);
    expect(
      current.messages.get(rawEvidenceId("pending-evidence", "language")),
    ).toEqual(
      expect.objectContaining({ content: "I prefer Chinese responses." }),
    );
    expect(persistedChatMessages.get("pending-evidence")?.parts).toEqual([
      { type: "text", text: "I prefer Chinese responses." },
    ]);
  });

  it("blocks legacy revisions even when raw provenance was tampered", async () => {
    const initial = await postChat([
      chatMessage("tampered-provenance", "I prefer Chinese responses."),
    ]);
    expect(initial.response.status).toBe(200);
    const current = manager as ChatMemoryTestManager;
    const evidenceId = rawEvidenceId("tampered-provenance", "language");
    const evidence = current.messages.get(evidenceId);
    if (!evidence) throw new Error("expected persisted raw evidence");
    current.messages.set(evidenceId, {
      ...evidence,
      platform: "forged",
      channel: "forged-chat",
    });
    const persisted = persistedChatMessages.get("tampered-provenance");
    if (!persisted || typeof persisted.metadata !== "object") {
      throw new Error("expected persisted evidence marker");
    }
    const metadata = { ...(persisted.metadata as Record<string, unknown>) };
    metadata.__openloomiMemoryEvidence = undefined;
    persistedChatMessages.set("tampered-provenance", {
      ...persisted,
      metadata,
    });

    const revision = await postChat([
      chatMessage("tampered-provenance", "I prefer English responses."),
    ]);
    expect(revision.response.status).toBe(409);
    expect(revision.body).toMatchObject({
      code: "chat_memory_evidence_revision_conflict",
      messageId: "tampered-provenance",
    });
  });

  it("keeps a temporary English instruction outside the stable global preference", async () => {
    await writeStableChinesePreference();
    const current = manager as ChatMemoryTestManager;
    const summaryId = [...current.summaries.keys()][0];

    vi.setSystemTime(NOW + 4000);
    const temporary = await postChat([
      chatMessage(
        "temporary-english",
        "For this task, please reply in English.",
      ),
    ]);
    const graph = await snapshot(current);
    const temporaryId = rawEvidenceId("temporary-english", "language");
    const taskCluster = graph.clusters.find((cluster) =>
      cluster.nodeIds.includes(temporaryId),
    );
    const stableCluster = graph.clusters.find(
      (cluster) => cluster.representativeNodeId === summaryId,
    );

    expect(temporary.response.status).toBe(200);
    expect(memoryWrite(temporary.body).status).toBe("applied");
    expect(current.messages.get(temporaryId)?.metadata).toEqual(
      expect.objectContaining({
        relationValue: "en",
        memoryApplicability: { scope: "task", key: CHAT_ID },
      }),
    );
    expect(taskCluster?.lifecycleStatus).toBe("forming");
    expect(stableCluster).toEqual(
      expect.objectContaining({
        lifecycleStatus: "stable",
        representativeNodeId: summaryId,
      }),
    );
  });

  it("keeps date-limited language instructions contextual", async () => {
    const current = manager as ChatMemoryTestManager;
    const result = await postChat([
      chatMessage("today-english", "For today, always reply in English."),
      chatMessage(
        "temporary-japanese",
        "\u6682\u65f6\u8bf7\u7528\u65e5\u6587\u56de\u7b54\u3002",
      ),
    ]);

    expect(result.response.status).toBe(200);
    expect(memoryWrite(result.body)).toEqual(
      expect.objectContaining({
        status: "applied",
        evidenceCount: 2,
        storedCount: 2,
      }),
    );
    for (const [messageId, relationValue] of [
      ["today-english", "en"],
      ["temporary-japanese", "ja"],
    ] as const) {
      expect(
        current.messages.get(rawEvidenceId(messageId, "language"))?.metadata,
      ).toEqual(
        expect.objectContaining({
          relationValue,
          memoryApplicability: { scope: "conversation", key: CHAT_ID },
        }),
      );
    }
  });

  it("keeps named project, workspace, and domain instructions contextual", async () => {
    const current = manager as ChatMemoryTestManager;
    const scopedMessages = [
      chatMessage(
        "project-english",
        "For this project, always reply in English.",
      ),
      chatMessage(
        "working-project-english",
        "When working on this project, I prefer English responses.",
      ),
      chatMessage(
        "named-project-english",
        "For Project Atlas, always reply in English.",
      ),
      chatMessage(
        "named-workspace-english",
        "In workspace Loomi Labs, always reply in English.",
      ),
      chatMessage(
        "named-domain-english",
        "Within domain Finance, always reply in English.",
      ),
      chatMessage(
        "working-named-project-english",
        "When working on OpenLoomi, I prefer English responses.",
      ),
    ];
    const result = await postChat(scopedMessages);

    expect(result.response.status).toBe(200);
    expect(memoryWrite(result.body)).toEqual(
      expect.objectContaining({
        status: "applied",
        evidenceCount: scopedMessages.length,
        storedCount: scopedMessages.length,
      }),
    );
    for (const messageId of scopedMessages.map((message) => message.id)) {
      expect(
        current.messages.get(rawEvidenceId(messageId, "language"))?.metadata,
      ).toEqual(
        expect.objectContaining({
          relationValue: "en",
          memoryApplicability: { scope: "conversation", key: CHAT_ID },
        }),
      );
    }
  });

  it("does not write negated language preferences", async () => {
    const result = await postChat([
      chatMessage(
        "negative-english",
        "I prefer not to receive answers in English.",
      ),
      chatMessage(
        "negative-chinese",
        "\u4e0d\u8981\u7528\u82f1\u6587\u56de\u7b54\u3002",
      ),
      chatMessage("avoid-english", "Always avoid English responses."),
      chatMessage("non-english", "I prefer non-English responses."),
      chatMessage(
        "avoid-english-chinese",
        "\u8bf7\u907f\u514d\u82f1\u6587\u56de\u590d\u3002",
      ),
    ]);

    expect(result.response.status).toBe(200);
    expect(memoryWrite(result.body)).toEqual(
      expect.objectContaining({
        status: "no-op",
        evidenceCount: 0,
        storedCount: 0,
      }),
    );
    expect(ensureUserDefaultBotMock).not.toHaveBeenCalled();
    expect(rawEvidence()).toEqual([]);
  });

  it("resolves the bot only after evidence and raw storage are available", async () => {
    const incidental = await postChat([
      chatMessage("no-evidence", "I like Japanese food."),
    ]);
    expect(memoryWrite(incidental.body).status).toBe("no-op");
    expect(ensureUserDefaultBotMock).not.toHaveBeenCalled();

    isRawMessageStorageAvailableMock.mockReturnValue(false);
    const adapterMissing = await postChat([
      chatMessage("adapter-missing-bot", "I prefer Chinese responses."),
    ]);
    expect(memoryWrite(adapterMissing.body).reasonCodes).toContain(
      "chat_memory_raw_adapter_missing",
    );
    expect(ensureUserDefaultBotMock).not.toHaveBeenCalled();

    isRawMessageStorageAvailableMock.mockReturnValue(true);
    ensureUserDefaultBotMock.mockRejectedValueOnce(
      new Error("default bot unavailable"),
    );
    const botFailure = await postChat([
      chatMessage("bot-resolution-failure", "I prefer concise responses."),
    ]);
    expect(botFailure.response.status).toBe(200);
    expect(memoryWrite(botFailure.body)).toEqual(
      expect.objectContaining({
        status: "partial-failure",
        storedCount: 0,
        retryable: true,
        reasonCodes: expect.arrayContaining([
          "chat_memory_bot_resolution_failed",
        ]),
      }),
    );
    expect(ensureUserDefaultBotMock).toHaveBeenCalledOnce();
    expect(rawEvidence()).toEqual([]);
  });

  it("keeps baseline raw writes during kill-switch fallback", async () => {
    const current = manager as ChatMemoryTestManager;
    await postChat([
      chatMessage("enabled-preference", "I prefer Chinese responses."),
    ]);
    const ledgerWrites = current.ledgerWriteCount;
    const graphBefore = await snapshot(current);
    vi.stubEnv("OPENLOOMI_MEMORY_GRAPH_WRITE_KILL_SWITCH", "true");

    const killed = await postChat([
      chatMessage("killed-preference", "I prefer concise responses."),
    ]);
    const diagnostics = memoryWrite(killed.body);
    const graphAfter = await snapshot(current);

    expect(killed.response.status).toBe(200);
    expect(diagnostics).toEqual(
      expect.objectContaining({
        status: "baseline",
        storedCount: 1,
        graphPolicy: {
          enabled: false,
          reasonCodes: ["memory_graph_write_kill_switch"],
        },
      }),
    );
    expect(diagnostics.graphLifecycle).toBeUndefined();
    expect(
      current.messages.has(
        rawEvidenceId("killed-preference", "response-style"),
      ),
    ).toBe(true);
    const killedRaw = current.messages.get(
      rawEvidenceId("killed-preference", "response-style"),
    );
    expect(killedRaw?.metadata).not.toHaveProperty("relationGroup");
    expect(killedRaw?.metadata).not.toHaveProperty("relationValue");
    expect(killedRaw?.metadata).not.toHaveProperty("memoryRelation");
    expect(killedRaw?.metadata).not.toHaveProperty("memoryTopicKeys");
    expect(killedRaw?.metadata).not.toHaveProperty("topicKeys");
    expect(killedRaw?.metadata).not.toHaveProperty("memoryApplicability");
    expect(killedRaw?.metadata).not.toHaveProperty("sourceIdentity");
    expect(current.ledgerWriteCount).toBe(ledgerWrites);
    expect(graphAfter.version).toBe(graphBefore.version);
  });

  it("ignores forged identity and graph metadata and skips assistant evidence", async () => {
    const current = manager as ChatMemoryTestManager;
    await current.storeMessage({
      messageId: "other-user-candidate",
      platform: "test",
      botId: "bot",
      userId: "other-user",
      timestamp: Math.floor(NOW / 1000),
      content: "I prefer Chinese responses.",
      attachments: [],
      metadata: {
        relationGroup: "language",
        relationValue: "zh",
        sourceIdentity: "other-user-candidate",
        memoryApplicability: { scope: "global" },
      },
      createdAt: Math.floor(NOW / 1000),
      memoryStage: "short",
    });
    const forged = {
      userId: "forged-user",
      workspaceId: "forged-workspace",
      tenantId: "forged-tenant",
      relationGroup: "language",
      relationValue: "en",
      memoryApplicability: { scope: "global", key: "forged" },
    };
    const result = await postChat(
      [
        chatMessage("trusted-user", "I prefer Chinese responses.", {
          metadata: forged,
        }),
        chatMessage("assistant", "I prefer English responses.", {
          role: "assistant",
          metadata: forged,
        }),
      ],
      {
        userId: "forged-user",
        graphEvolution: {
          enabled: true,
          workspaceId: "forged-workspace",
          tenantId: "forged-tenant",
        },
      },
    );
    const evidence = rawEvidence(current);
    const graph = await snapshot(current);

    expect(result.response.status).toBe(200);
    const diagnostics = memoryWrite(result.body);
    expect(diagnostics.evidenceCount).toBe(1);
    expect(diagnostics.graphEvolution?.consideredCandidateIds).not.toContain(
      "other-user-candidate",
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toEqual(
      expect.objectContaining({
        userId: USER_ID,
        messageId: rawEvidenceId("trusted-user", "language"),
        metadata: expect.objectContaining({
          relationGroup: "language",
          relationValue: "zh",
          memoryApplicability: { scope: "global" },
        }),
      }),
    );
    expect(evidence[0]?.metadata).not.toHaveProperty("workspaceId");
    expect(evidence[0]?.metadata).not.toHaveProperty("tenantId");
    expect(
      graph.nodes.every((node) => node.ownerScope.userId === USER_ID),
    ).toBe(true);
    expect(graph.nodes.map((node) => node.id)).not.toContain(
      "other-user-candidate",
    );
    expect(
      current.messages.has(
        memoryGraphLedgerMessageId({ userId: "other-user" }),
      ),
    ).toBe(false);
    const saved = saveMessagesMock.mock.calls[0]?.[0] as {
      messages: unknown[];
    };
    expect(saved.messages).toHaveLength(2);
  });

  it("does not persist incidental language mentions as memory evidence", async () => {
    const result = await postChat([
      chatMessage("japanese-food", "I like Japanese food."),
      chatMessage(
        "english-project-title",
        "Remember the English project title.",
      ),
    ]);
    const diagnostics = memoryWrite(result.body);
    const current = manager as ChatMemoryTestManager;

    expect(result.response.status).toBe(200);
    expect(diagnostics).toEqual(
      expect.objectContaining({
        status: "no-op",
        evidenceCount: 0,
        storedCount: 0,
      }),
    );
    expect(rawEvidence(current)).toEqual([]);
    expect(current.ledgerWriteCount).toBe(0);
    expect(current.messages.size).toBe(0);
    expect(saveMessagesMock).toHaveBeenCalledOnce();
    const saved = saveMessagesMock.mock.calls[0]?.[0] as {
      messages: unknown[];
    };
    expect(saved.messages).toHaveLength(2);
  });

  it("preflights message IDs before creating a new chat", async () => {
    const originalRow: PersistedChatMessageRow = {
      id: "shared-client-id",
      chatId: "other-chat",
      role: "user",
      parts: [{ type: "text", text: "Original content" }],
      attachments: [],
      createdAt: new Date(NOW - 1000),
      metadata: null,
    };
    persistedChatMessages.set(originalRow.id, originalRow);
    getChatByIdMock.mockResolvedValue(null);
    const result = await postChat([
      chatMessage("shared-client-id", "I prefer Chinese responses."),
    ]);
    expect(result.response.status).toBe(409);
    expect(result.body).toEqual({
      error: "Message ID already belongs to another chat",
    });
    expect(saveChatMock).not.toHaveBeenCalled();
    expect(saveMessagesMock).not.toHaveBeenCalled();
    expect(ensureUserDefaultBotMock).not.toHaveBeenCalled();
    expect(clearAIUserContextMock).toHaveBeenCalledOnce();
    expect(persistedChatMessages.get(originalRow.id)).toEqual(originalRow);
    expect(rawEvidence()).toEqual([]);
  });
  it("rejects a new-chat owner race before saving messages", async () => {
    getChatByIdMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: CHAT_ID,
      userId: "other-user",
      title: "Raced chat",
      createdAt: new Date(NOW),
    });

    const result = await postChat([
      chatMessage("new-chat-owner-race", "I prefer Chinese responses."),
    ]);

    expect(result.response.status).toBe(409);
    expect(result.body).toEqual({
      error: "Chat ID already belongs to another user",
      code: "chat_owner_scope_conflict",
    });
    expect(saveChatMock).toHaveBeenCalledOnce();
    expect(saveMessagesMock).not.toHaveBeenCalled();
    expect(generateTitleFromUserMessageMock).not.toHaveBeenCalled();
    expect(ensureUserDefaultBotMock).not.toHaveBeenCalled();
    expect(clearAIUserContextMock).toHaveBeenCalledOnce();
    expect(rawEvidence()).toEqual([]);
  });

  it("rejects a post-save message ownership race", async () => {
    const racedCreatedAt = new Date(NOW - 1000);
    saveMessagesMock.mockImplementationOnce(
      async ({ messages }: { messages: PersistedChatMessageRow[] }) => {
        const [row] = messages;
        if (!row) return;
        persistedChatMessages.set(row.id, {
          ...row,
          chatId: "other-chat",
          role: "assistant",
          parts: [{ type: "text", text: "Competing content" }],
          createdAt: racedCreatedAt,
        });
      },
    );

    const result = await postChat([
      chatMessage("persisted-chat-mismatch", "I prefer Chinese responses."),
    ]);
    const current = manager as ChatMemoryTestManager;

    expect(result.response.status).toBe(409);
    expect(result.body).toEqual({
      error: "Message ID already belongs to another chat",
    });
    expect(saveMessagesMock).toHaveBeenCalledOnce();
    expect(getMessageByIdMock).toHaveBeenCalledTimes(2);
    expect(persistedChatMessages.get("persisted-chat-mismatch")).toEqual(
      expect.objectContaining({
        chatId: "other-chat",
        role: "assistant",
        parts: [{ type: "text", text: "Competing content" }],
        createdAt: racedCreatedAt,
      }),
    );
    expect(clearAIUserContextMock).toHaveBeenCalledOnce();
    expect(ensureUserDefaultBotMock).not.toHaveBeenCalled();
    expect(rawEvidence(current)).toEqual([]);
    expect(current.ledgerWriteCount).toBe(0);
  });
  it("rejects a post-save chat ownership race before memory mutation", async () => {
    getChatByIdMock
      .mockResolvedValueOnce({
        id: CHAT_ID,
        userId: USER_ID,
        title: "Owned chat",
        createdAt: new Date(NOW),
      })
      .mockResolvedValueOnce({
        id: CHAT_ID,
        userId: "other-user",
        title: "Raced chat",
        createdAt: new Date(NOW),
      });

    const result = await postChat([
      chatMessage("post-save-chat-owner-race", "I prefer Chinese responses."),
    ]);

    expect(result.response.status).toBe(409);
    expect(result.body).toEqual({
      error: "Chat ID already belongs to another user",
      code: "chat_owner_scope_conflict",
    });
    expect(saveMessagesMock).toHaveBeenCalledOnce();
    expect(ensureUserDefaultBotMock).not.toHaveBeenCalled();
    expect(rawEvidence()).toEqual([]);
    expect(clearAIUserContextMock).toHaveBeenCalledOnce();
  });

  it("maps a transactional message scope conflict to 409", async () => {
    saveMessagesMock.mockRejectedValueOnce(
      new Error("message_id_scope_conflict"),
    );

    const result = await postChat([
      chatMessage("transaction-scope-conflict", "I prefer Chinese responses."),
    ]);

    expect(result.response.status).toBe(409);
    expect(result.body).toEqual({
      error: "Message ID already belongs to another chat",
      code: "message_id_scope_conflict",
    });
    expect(saveMessagesMock).toHaveBeenCalledOnce();
    expect(ensureUserDefaultBotMock).not.toHaveBeenCalled();
    expect(clearAIUserContextMock).toHaveBeenCalledOnce();
    expect(rawEvidence()).toEqual([]);
  });

  it("returns diagnosable fallback and converges after a one-time graph failure", async () => {
    const baselineStored: RawMessage[] = [];
    manager = {
      storeMessages: vi.fn(async (messages: RawMessage[]) => {
        baselineStored.push(...messages);
        return messages.map((_, index) => index + 1);
      }),
    };
    const missingCapability = await postChat([
      chatMessage("adapter-missing", "I prefer Chinese responses."),
    ]);
    expect(missingCapability.response.status).toBe(200);
    expect(memoryWrite(missingCapability.body)).toEqual(
      expect.objectContaining({
        status: "baseline",
        storedCount: 1,
        reasonCodes: expect.arrayContaining([
          "chat_memory_graph_adapter_missing",
        ]),
      }),
    );
    expect(baselineStored).toHaveLength(1);

    const retryManager = new ChatMemoryTestManager();
    retryManager.failQueryReads = 1;
    manager = retryManager;
    const first = await postChat([
      chatMessage("query-retry", "I prefer Chinese responses."),
    ]);
    expect(first.response.status).toBe(200);
    expect(memoryWrite(first.body)).toEqual(
      expect.objectContaining({
        status: "partial-failure",
        storedCount: 1,
        retryable: true,
        reasonCodes: expect.arrayContaining([
          "chat_memory_graph_write_failed_after_raw_persisted",
        ]),
      }),
    );
    expect(rawEvidence(retryManager)).toHaveLength(1);

    vi.setSystemTime(NOW + 1000);
    const retry = await postChat([
      chatMessage("query-retry", "I prefer Chinese responses."),
    ]);
    expect(retry.response.status).toBe(200);
    expect(memoryWrite(retry.body).retryable).toBe(false);
    expect((await snapshot(retryManager)).nodes).toHaveLength(1);
    expect(rawEvidence(retryManager)).toHaveLength(1);
  });

  it("surfaces missing and transient deprecation without losing chat saves", async () => {
    const missingAdapter = new ChatMemoryTestManager({
      supportsDeprecation: false,
    });
    manager = missingAdapter;
    const missingDiagnostics = await writeStableChinesePreference();

    expect(missingDiagnostics.at(-1)).toEqual(
      expect.objectContaining({
        status: "partial-failure",
        retryable: true,
        reasonCodes: expect.arrayContaining([
          "adapter_missing_deprecate_records",
        ]),
      }),
    );
    expect(missingAdapter.summaries.size).toBe(1);
    expect(
      rawEvidence(missingAdapter).every((item) => !item.deprecatedAt),
    ).toBe(true);

    const transient = new ChatMemoryTestManager();
    transient.failDeprecationWrites = 1;
    manager = transient;
    const failedDiagnostics = await writeStableChinesePreference();
    expect(failedDiagnostics.at(-1)).toEqual(
      expect.objectContaining({
        status: "partial-failure",
        retryable: true,
        reasonCodes: expect.arrayContaining([
          "memory_graph_consolidation_candidate_failed",
        ]),
      }),
    );
    expect(transient.summaries.size).toBe(1);
    expect(failedDiagnostics.at(-1)?.graphLifecycle?.candidateResults).toEqual([
      expect.objectContaining({
        status: "failed",
        error: expect.objectContaining({
          message: "deprecation write failed",
        }),
      }),
    ]);

    vi.setSystemTime(NOW + 4000);
    const retry = await postChat([
      chatMessage("preference-3", "Remember that I like Chinese responses."),
    ]);
    expect(retry.response.status).toBe(200);
    expect(memoryWrite(retry.body)).toEqual(
      expect.objectContaining({ status: "applied", retryable: false }),
    );
    expect(transient.summaries.size).toBe(1);
    expect(
      rawEvidence(transient).every((item) => item.deprecatedAt !== undefined),
    ).toBe(true);
    expect(saveMessagesMock).toHaveBeenCalled();
  });

  it("rejects an existing chat owned by another user before any write", async () => {
    getChatByIdMock.mockResolvedValue({
      id: CHAT_ID,
      userId: "other-user",
      title: "Other user's chat",
      createdAt: new Date(NOW),
    });

    const result = await postChat([
      chatMessage("owner-mismatch", "I prefer Chinese responses."),
    ]);

    expect(result.response.status).toBe(403);
    expect(saveMessagesMock).not.toHaveBeenCalled();
    expect(saveChatMock).not.toHaveBeenCalled();
    expect(rawEvidence()).toEqual([]);
    expect((manager as ChatMemoryTestManager).ledgerWriteCount).toBe(0);
  });

  it("forces the untrusted raw store action to remain baseline-only", async () => {
    const current = manager as ChatMemoryTestManager;
    const response = await rawMemoryRoute(
      new NextRequest("http://localhost/api/memory/raw-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "store",
          messages: [
            {
              messageId: "raw-policy-bypass",
              platform: "test",
              botId: "bot",
              channel: "trusted-channel",
              userId: "forged-user",
              timestamp: Math.floor(NOW / 1000),
              content: "I prefer Chinese responses.",
              metadata: {
                relationGroup: "language",
                relationValue: "zh",
                sourceIdentity: "raw-policy-bypass",
                memoryRelation: { group: "language", value: "zh" },
                memoryTopicKeys: ["language"],
                topicKeys: ["language"],
                memoryApplicability: {
                  scope: "global",
                  key: "forged-channel",
                  workspaceId: "forged-workspace",
                },
              },
            },
          ],
          graphEvolution: {
            enabled: true,
            workspaceId: "forged-workspace",
            tenantId: "forged-tenant",
          },
        }),
      }),
    );
    const body = (await response.json()) as {
      stored: number;
      graphEvolution?: { status: string };
    };

    expect(response.status).toBe(200);
    expect(body.stored).toBe(1);
    expect(body.graphEvolution?.status).toBe("disabled");
    const persisted = current.messages.get("raw-policy-bypass");
    expect(persisted?.userId).toBe(USER_ID);
    expect(persisted?.metadata).not.toHaveProperty("relationGroup");
    expect(persisted?.metadata).not.toHaveProperty("relationValue");
    expect(persisted?.metadata).not.toHaveProperty("sourceIdentity");
    expect(persisted?.metadata).not.toHaveProperty("memoryRelation");
    expect(persisted?.metadata).not.toHaveProperty("memoryTopicKeys");
    expect(persisted?.metadata).not.toHaveProperty("topicKeys");
    expect(persisted?.metadata?.memoryOwnerScope).toEqual(
      expect.objectContaining({ userId: USER_ID }),
    );
    expect(persisted?.metadata?.memoryApplicability).toEqual({
      scope: "channel",
      key: "test:trusted-channel",
    });
    expect(persisted?.metadata?.memoryApplicability).not.toHaveProperty(
      "workspaceId",
    );
    expect(current.ledgerWriteCount).toBe(0);
    expect(
      [...current.messages.keys()].some((id) =>
        id.startsWith("__openloomi_memory_graph__"),
      ),
    ).toBe(false);
  });

  it("forces the untrusted forgetting action to skip graph lifecycle", async () => {
    const current = manager as ChatMemoryTestManager;
    const ledgerWrites = current.ledgerWriteCount;
    const response = await rawMemoryRoute(
      new NextRequest("http://localhost/api/memory/raw-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "forgettingCycle",
          options: {
            dryRun: true,
            graphLifecycle: {
              enabled: true,
              dryRun: false,
              workspaceId: "forged-workspace",
              tenantId: "forged-tenant",
            },
          },
        }),
      }),
    );
    const body = (await response.json()) as {
      result?: {
        status: string;
        dryRun: boolean;
        graphLifecycle?: { status: string };
      };
    };

    expect(response.status).toBe(200);
    expect(body.result?.status).toBe("success");
    expect(body.result?.dryRun).toBe(true);
    expect(body.result?.graphLifecycle).toBeUndefined();
    expect(current.ledgerWriteCount).toBe(ledgerWrites);
    expect(
      [...current.messages.keys()].some((id) =>
        id.startsWith("__openloomi_memory_graph__"),
      ),
    ).toBe(false);
  });
});
