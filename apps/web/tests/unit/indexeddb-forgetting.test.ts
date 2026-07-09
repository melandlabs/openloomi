import {
  type MemoryGraphSnapshot,
  type OwnerScope,
  createGraphAwareRetrievalDryRunRetriever,
} from "@openloomi/memory-consolidation";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createIndexedDBMemoryStorageAdapter,
  queryMemoryWithFallback,
  runMemoryForgettingCycle,
} from "../../../../packages/indexeddb/src/forgetting";
import type {
  IndexedDBManager,
  MemoryStage,
  MemorySummaryRecord,
  RawMessage,
  RawMessageQuery,
} from "../../../../packages/indexeddb/src/manager";
import { sqliteRunMemoryForgettingCycleForUser } from "../../../../packages/indexeddb/src/sqlite-client";

const DAY_MS = 24 * 60 * 60 * 1000;
const originalFetch = globalThis.fetch;

class InMemoryManager {
  rawMessages: RawMessage[] = [];
  summaries: MemorySummaryRecord[] = [];
  accessedIds: string[] = [];

  async queryMessages(query: RawMessageQuery): Promise<RawMessage[]> {
    let items = [...this.rawMessages];

    if (query.userId) {
      items = items.filter((item) => item.userId === query.userId);
    }
    if (query.platform) {
      items = items.filter((item) => item.platform === query.platform);
    }
    if (query.botId) {
      items = items.filter((item) => item.botId === query.botId);
    }
    if (query.channel) {
      const key = query.channel.toLowerCase();
      items = items.filter((item) => item.channel?.toLowerCase().includes(key));
    }
    if (query.person) {
      const key = query.person.toLowerCase();
      items = items.filter((item) => item.person?.toLowerCase().includes(key));
    }
    if (query.startTime !== undefined) {
      const startTime = query.startTime;
      items = items.filter((item) => item.timestamp >= startTime);
    }
    if (query.endTime !== undefined) {
      const endTime = query.endTime;
      items = items.filter((item) => item.timestamp < endTime);
    }
    if (query.memoryStages?.length) {
      const stages = new Set(query.memoryStages);
      items = items.filter((item) => stages.has(item.memoryStage ?? "short"));
    }
    if (!query.includeArchived) {
      items = items.filter((item) => item.archivedAt === undefined);
    }
    if (!query.includeDeprecated) {
      items = items.filter((item) => item.deprecatedAt === undefined);
    }
    if (query.keywords?.length) {
      const keys = query.keywords.map((item) => item.toLowerCase());
      items = items.filter((item) => {
        const text =
          `${item.content} ${item.channel ?? ""} ${item.person ?? ""}`.toLowerCase();
        return keys.some((key) => text.includes(key));
      });
    }

    const reverse = query.reverse ?? false;
    items.sort((a, b) => a.timestamp - b.timestamp);
    if (reverse) {
      items.reverse();
    }

    const offset = query.offset ?? 0;
    const pageSize = query.pageSize ?? query.limit ?? 50;
    return items.slice(offset, offset + pageSize);
  }

  async upsertSummaries(summaries: MemorySummaryRecord[]): Promise<void> {
    for (const summary of summaries) {
      const index = this.summaries.findIndex(
        (item) => item.summaryId === summary.summaryId,
      );
      if (index >= 0) {
        this.summaries[index] = summary;
      } else {
        this.summaries.push(summary);
      }
    }
  }

  async querySummaries(query: {
    userId: string;
    keywords?: string[];
    startTime?: number;
    endTime?: number;
    reverse?: boolean;
    summaryTiers?: ("L1" | "L2" | "L3")[];
    pageSize?: number;
    limit?: number;
    offset?: number;
  }): Promise<MemorySummaryRecord[]> {
    let items = this.summaries.filter((item) => item.userId === query.userId);

    if (query.summaryTiers?.length) {
      const tiers = new Set(query.summaryTiers);
      items = items.filter((item) => tiers.has(item.summaryTier));
    }
    if (query.startTime !== undefined) {
      const startTime = query.startTime;
      items = items.filter((item) => item.endTimestamp >= startTime);
    }
    if (query.endTime !== undefined) {
      const endTime = query.endTime;
      items = items.filter((item) => item.startTimestamp < endTime);
    }
    if (query.keywords?.length) {
      const keys = query.keywords.map((item) => item.toLowerCase());
      items = items.filter((item) => {
        const text =
          `${item.summaryText} ${(item.keywords ?? []).join(" ")}`.toLowerCase();
        return keys.some((key) => text.includes(key));
      });
    }

    const reverse = query.reverse ?? true;
    items.sort((a, b) => a.endTimestamp - b.endTimestamp);
    if (reverse) {
      items.reverse();
    }

    const offset = query.offset ?? 0;
    const pageSize = query.pageSize ?? query.limit ?? 50;
    return items.slice(offset, offset + pageSize);
  }

  async markMessagesAccessed(
    ids: string[],
    at = Date.now(),
    userId?: string,
  ): Promise<number> {
    let count = 0;
    for (const message of this.rawMessages) {
      if (!ids.includes(message.messageId)) continue;
      if (userId && message.userId !== userId) continue;
      message.accessCount = (message.accessCount ?? 0) + 1;
      message.lastAccessAt = at;
      this.accessedIds.push(message.messageId);
      count++;
    }
    return count;
  }

  async promoteMessagesToStage(
    ids: string[],
    stage: MemoryStage,
    options?: { userId?: string; summaryRefId?: string },
  ): Promise<number> {
    let count = 0;
    for (const message of this.rawMessages) {
      if (!ids.includes(message.messageId)) continue;
      if (options?.userId && message.userId !== options.userId) continue;
      message.memoryStage = stage;
      if (options?.summaryRefId) {
        message.summaryRefId = options.summaryRefId;
      }
      count++;
    }
    return count;
  }

  async archiveMessages(
    ids: string[],
    archivedAt = Date.now(),
    userId?: string,
  ): Promise<number> {
    let count = 0;
    for (const message of this.rawMessages) {
      if (!ids.includes(message.messageId)) continue;
      if (userId && message.userId !== userId) continue;
      message.archivedAt = archivedAt;
      count++;
    }
    return count;
  }

  async hardDeleteArchived(
    olderThan: number,
    userId?: string,
  ): Promise<number> {
    const before = this.rawMessages.length;
    this.rawMessages = this.rawMessages.filter((item) => {
      if (item.archivedAt === undefined) return true;
      if (item.archivedAt >= olderThan) return true;
      if (userId && item.userId !== userId) return true;
      return false;
    });
    return before - this.rawMessages.length;
  }
}

function createRaw(input: {
  messageId: string;
  userId: string;
  stage: MemoryStage;
  timestampSec: number;
  text: string;
  embedding?: number[];
  embeddingModel?: string;
  embeddingContentHash?: string;
  embeddingDimensions?: number;
  embeddingUpdatedAt?: number;
  metadata?: Record<string, unknown>;
  deprecatedAt?: number;
  deprecationReason?: string;
  supersededBySummaryId?: string;
}): RawMessage {
  return {
    messageId: input.messageId,
    platform: "slack",
    botId: "bot-1",
    userId: input.userId,
    channel: "general",
    person: "alice",
    timestamp: input.timestampSec,
    content: input.text,
    embedding: input.embedding,
    embeddingModel: input.embeddingModel,
    embeddingContentHash: input.embeddingContentHash,
    embeddingDimensions: input.embeddingDimensions,
    embeddingUpdatedAt: input.embeddingUpdatedAt,
    createdAt: input.timestampSec,
    memoryStage: input.stage,
    accessCount: 0,
    importanceScore: 0,
    isPinned: false,
    metadata: input.metadata,
    deprecatedAt: input.deprecatedAt,
    deprecationReason: input.deprecationReason,
    supersededBySummaryId: input.supersededBySummaryId,
  };
}

describe("indexeddb forgetting bridge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it("runs forgetting cycle and applies transition/archive/delete", async () => {
    const now = Date.now();
    const manager = new InMemoryManager();

    const shortOldSec = Math.floor((now - 10 * DAY_MS) / 1000);
    const midOldSec = Math.floor((now - 120 * DAY_MS) / 1000);

    manager.rawMessages = [
      createRaw({
        messageId: "s1",
        userId: "u1",
        stage: "short",
        timestampSec: shortOldSec,
        text: "simple note one",
      }),
      createRaw({
        messageId: "s2",
        userId: "u1",
        stage: "short",
        timestampSec: shortOldSec + 10,
        text: "simple note two",
      }),
      createRaw({
        messageId: "s3",
        userId: "u1",
        stage: "short",
        timestampSec: shortOldSec + 20,
        text: "simple note three",
      }),
      createRaw({
        messageId: "m1",
        userId: "u1",
        stage: "mid",
        timestampSec: midOldSec,
        text: "old mid one",
      }),
      createRaw({
        messageId: "m2",
        userId: "u1",
        stage: "mid",
        timestampSec: midOldSec + 10,
        text: "old mid two",
      }),
      createRaw({
        messageId: "m3",
        userId: "u1",
        stage: "mid",
        timestampSec: midOldSec + 20,
        text: "old mid three",
      }),
    ];

    const result = await runMemoryForgettingCycle(
      manager as unknown as IndexedDBManager,
      "u1",
      {
        now,
        dryRun: false,
        hardDeleteArchivedOlderThan: now + 1,
      },
    );

    expect(result.status).toBe("success");
    expect(result.createdSummaries).toBeGreaterThanOrEqual(1);
    expect(result.transitionedRecords).toBe(3);
    expect(result.archivedDetailRecords).toBe(0);
    expect(result.hardDeletedRecords).toBe(0);

    const shortToMid = manager.rawMessages.filter(
      (item) => item.messageId.startsWith("s") && item.memoryStage === "mid",
    );
    expect(shortToMid.length).toBe(3);
    expect(manager.summaries.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps consolidation shadow diagnostics disabled by default", async () => {
    const now = Date.now();
    const manager = new InMemoryManager();

    manager.rawMessages = [
      createRaw({
        messageId: "default-shadow-off",
        userId: "u1",
        stage: "short",
        timestampSec: Math.floor((now - 10 * DAY_MS) / 1000),
        text: "stable preference evidence",
      }),
    ];

    const result = await runMemoryForgettingCycle(
      manager as unknown as IndexedDBManager,
      "u1",
      {
        now,
        dryRun: true,
      },
    );

    expect(result.shadowDiagnostics).toBeUndefined();
    expect(result.dryRun).toBe(true);
  });

  it("attaches opt-in consolidation shadow diagnostics without mutating storage", async () => {
    const now = Date.now();
    const manager = new InMemoryManager();

    manager.rawMessages = [
      createRaw({
        messageId: "lang-zh-1",
        userId: "u1",
        stage: "short",
        timestampSec: Math.floor((now - 10 * DAY_MS) / 1000),
        text: "User prefers Chinese answers by default",
        metadata: {
          relationGroup: "answer-language",
          relationValue: "zh",
          relationScope: "long-term",
        },
      }),
      createRaw({
        messageId: "lang-zh-2",
        userId: "u1",
        stage: "short",
        timestampSec: Math.floor((now - 9 * DAY_MS) / 1000),
        text: "User repeats that Chinese technical discussion is easier",
        metadata: {
          relationGroup: "answer-language",
          relationValue: "zh",
          relationScope: "long-term",
        },
      }),
      createRaw({
        messageId: "lang-zh-3",
        userId: "u1",
        stage: "short",
        timestampSec: Math.floor((now - 8 * DAY_MS) / 1000),
        text: "User wants code explanations in Chinese first",
        metadata: {
          relationGroup: "answer-language",
          relationValue: "zh",
          relationScope: "long-term",
        },
      }),
    ];

    const result = await runMemoryForgettingCycle(
      manager as unknown as IndexedDBManager,
      "u1",
      {
        now,
        dryRun: true,
        shadowDiagnostics: {
          enabled: true,
          dryRun: true,
          limit: 20,
        },
      },
    );

    expect(result.shadowDiagnostics?.status).toBe("success");
    expect(result.shadowDiagnostics?.mutatesRuntime).toBe(false);
    expect(result.shadowDiagnostics?.mutatesStorage).toBe(false);
    expect(result.shadowDiagnostics?.mutatesRetrieval).toBe(false);
    expect(result.shadowDiagnostics?.report?.summary.sourceRecordCount).toBe(3);
    expect(
      result.shadowDiagnostics?.report?.diagnostics.pipeline.candidates.length,
    ).toBeGreaterThan(0);
    expect(
      result.shadowDiagnostics?.report?.diagnostics.pipeline.plan.entries,
    ).toContainEqual(
      expect.objectContaining({
        recordIds: ["lang-zh-1", "lang-zh-2", "lang-zh-3"],
      }),
    );
    expect(manager.rawMessages.map((item) => item.memoryStage)).toEqual([
      "short",
      "short",
      "short",
    ]);
  });

  it("keeps shadow log failures observable without failing forgetting", async () => {
    const now = Date.now();
    const manager = new InMemoryManager();

    manager.rawMessages = [
      createRaw({
        messageId: "log-shadow-1",
        userId: "u1",
        stage: "short",
        timestampSec: Math.floor((now - 10 * DAY_MS) / 1000),
        text: "User prefers concise answers",
        metadata: {
          relationGroup: "answer-style",
          relationValue: "concise",
          relationScope: "stable",
        },
      }),
      createRaw({
        messageId: "log-shadow-2",
        userId: "u1",
        stage: "short",
        timestampSec: Math.floor((now - 9 * DAY_MS) / 1000),
        text: "User repeats that answers should be concise",
        metadata: {
          relationGroup: "answer-style",
          relationValue: "concise",
          relationScope: "stable",
        },
      }),
    ];

    const result = await runMemoryForgettingCycle(
      manager as unknown as IndexedDBManager,
      "u1",
      {
        now,
        dryRun: true,
        shadowDiagnostics: {
          enabled: true,
          dryRun: true,
          logReport: () => {
            throw new Error("shadow sink unavailable");
          },
        },
      },
    );

    expect(result.status).toBe("success");
    expect(result.shadowDiagnostics?.status).toBe("success");
    expect(result.shadowDiagnostics?.log).toEqual({
      status: "failed",
      error: {
        name: "Error",
        message: "shadow sink unavailable",
      },
    });
    expect(result.shadowDiagnostics?.reasonCodes).toEqual(
      expect.arrayContaining(["shadow_log_failed"]),
    );
  });

  it("does not load records when opt-in shadow diagnostics are not dry-run", async () => {
    const now = Date.now();
    const manager = new InMemoryManager();

    manager.rawMessages = [
      createRaw({
        messageId: "unsupported-shadow",
        userId: "u1",
        stage: "short",
        timestampSec: Math.floor((now - 10 * DAY_MS) / 1000),
        text: "record should not be loaded by unsupported shadow diagnostics",
      }),
    ];

    const result = await runMemoryForgettingCycle(
      manager as unknown as IndexedDBManager,
      "u1",
      {
        now,
        dryRun: true,
        shadowDiagnostics: {
          enabled: true,
          dryRun: false,
        },
      },
    );

    expect(result.shadowDiagnostics).toMatchObject({
      status: "unsupported",
      dryRun: false,
      scannedRecordCount: 0,
      reasonCodes: ["shadow_dry_run_required"],
    });
  });

  it("forwards JSON-safe shadow diagnostics through SQLite raw message API", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        return new Response(
          JSON.stringify({
            success: true,
            result: {
              status: "success",
              createdSummaries: 0,
              transitionedRecords: 0,
              archivedDetailRecords: 0,
              hardDeletedRecords: 0,
              shadowDiagnostics: {
                status: "success",
                dryRun: true,
                scannedRecordCount: 0,
                reasonCodes: ["shadow_report_only"],
                mutatesRuntime: false,
                mutatesStorage: false,
                mutatesRetrieval: false,
                log: { status: "disabled" },
                startedAt: 1,
                finishedAt: 2,
              },
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      },
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await sqliteRunMemoryForgettingCycleForUser("u1", {
      dryRun: true,
      shadowDiagnostics: {
        enabled: true,
        dryRun: true,
        limit: 10,
        candidateTier: "short",
        olderThan: 123,
        relationKeys: {
          relationGroup: "relationGroup",
          relationValue: "relationValue",
        },
        minConfidence: 0.7,
        metadata: {
          source: "test",
        },
      },
    });

    const requestBody = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    );

    expect(requestBody).toMatchObject({
      action: "forgettingCycle",
      options: {
        dryRun: true,
        shadowDiagnostics: {
          enabled: true,
          dryRun: true,
          limit: 10,
          candidateTier: "short",
          olderThan: 123,
          relationKeys: {
            relationGroup: "relationGroup",
            relationValue: "relationValue",
          },
          minConfidence: 0.7,
          metadata: {
            source: "test",
          },
        },
      },
    });
    expect(result.shadowDiagnostics).toEqual(
      expect.objectContaining({
        status: "success",
        dryRun: true,
        mutatesStorage: false,
      }),
    );
  });

  it("queries summaries as fallback when raw is insufficient", async () => {
    const now = Date.now();
    const manager = new InMemoryManager();

    manager.rawMessages = [
      createRaw({
        messageId: "r1",
        userId: "u1",
        stage: "short",
        timestampSec: Math.floor((now - DAY_MS) / 1000),
        text: "only one raw hit",
        embedding: [0.2, 0.4, 0.6],
        embeddingModel: "text-embedding-3-small",
        embeddingContentHash: "memory-record-embedding-text-v1:abc",
        embeddingDimensions: 3,
        embeddingUpdatedAt: now - DAY_MS,
      }),
    ];

    manager.summaries = [
      {
        summaryId: "sum-1",
        userId: "u1",
        summaryTier: "L1",
        sourceTier: "short",
        startTimestamp: now - 3 * DAY_MS,
        endTimestamp: now - 2 * DAY_MS,
        messageCount: 5,
        sourceRecordIds: ["a", "b", "c", "d", "e"],
        keyPoints: ["k1"],
        keywords: ["planning"],
        keywordsText: "planning",
        summaryText: "weekly planning summary",
        createdAt: now - 2 * DAY_MS,
        updatedAt: now - 2 * DAY_MS,
      },
    ];

    const result = await queryMemoryWithFallback(
      manager as unknown as IndexedDBManager,
      {
        userId: "u1",
        pageSize: 3,
        minRawResultsWithoutFallback: 2,
      },
    );

    expect(result.rawCount).toBe(1);
    expect(result.summaryCount).toBe(1);
    expect(result.items.length).toBe(2);
    expect(result.items.some((item) => item.sourceType === "summary")).toBe(
      true,
    );
    const rawHit = result.items.find((item) => item.sourceType === "raw");
    expect(rawHit?.sourceType).toBe("raw");
    if (rawHit?.sourceType === "raw") {
      expect(rawHit.record.embedding).toEqual([0.2, 0.4, 0.6]);
      expect(rawHit.record.embeddingModel).toBe("text-embedding-3-small");
      expect(rawHit.record.embeddingContentHash).toBe(
        "memory-record-embedding-text-v1:abc",
      );
      expect(rawHit.record.embeddingDimensions).toBe(3);
      expect(rawHit.record.embeddingUpdatedAt).toBe(now - DAY_MS);
    }
    expect(manager.accessedIds).toContain("r1");
  });

  it("passes graph-aware retrieval options through the fallback query wrapper", async () => {
    const now = Date.now();
    const manager = new InMemoryManager();
    const ownerScope = { userId: "u1" } satisfies OwnerScope;
    const snapshot = {
      ownerScope,
      nodes: [
        {
          id: "r-old",
          ownerScope,
          type: "raw",
          visibility: "deprecated",
          createdAt: now,
        },
        {
          id: "summary-language",
          ownerScope,
          type: "summary",
          visibility: "default",
          createdAt: now,
        },
        {
          id: "r-fresh",
          ownerScope,
          type: "raw",
          visibility: "default",
          createdAt: now,
        },
      ],
      edges: [
        {
          id: "edge:r-old:summary-language",
          ownerScope,
          fromNodeId: "r-old",
          toNodeId: "summary-language",
          kind: "supersede",
          weight: 1,
          evidenceNodeIds: ["r-old"],
          reasonCodes: ["summary_sedimentation"],
          createdAt: now,
        },
      ],
      clusters: [
        {
          clusterId: "cluster:language",
          ownerScope,
          nodeIds: ["r-old", "summary-language"],
          lifecycleStatus: "superseded",
          representativeNodeId: "summary-language",
          supportScore: 0.9,
          updatedAt: now,
          reasonCodes: ["summary_sedimentation"],
        },
      ],
      capturedAt: now,
    } satisfies MemoryGraphSnapshot;

    manager.rawMessages = [
      createRaw({
        messageId: "r-old",
        userId: "u1",
        stage: "short",
        timestampSec: 3000,
        text: "old language preference",
        deprecatedAt: now,
        deprecationReason: "summarized_into:summary-language",
        supersededBySummaryId: "summary-language",
      }),
      createRaw({
        messageId: "r-fresh",
        userId: "u1",
        stage: "short",
        timestampSec: 1000,
        text: "fresh project context",
      }),
    ];
    manager.summaries = [
      {
        summaryId: "summary-language",
        userId: "u1",
        summaryTier: "L1",
        sourceTier: "short",
        startTimestamp: 100_000,
        endTimestamp: 2_000_000,
        messageCount: 1,
        sourceRecordIds: ["r-old"],
        keyPoints: ["prefers concise language"],
        keywords: ["language"],
        keywordsText: "language",
        summaryText: "User prefers concise language.",
        createdAt: 2_000_000,
        updatedAt: 2_000_000,
      },
    ];

    const result = await queryMemoryWithFallback(
      manager as unknown as IndexedDBManager,
      {
        userId: "u1",
        pageSize: 3,
        minRawResultsWithoutFallback: 3,
      },
      {
        graphRetrieval: {
          enabled: true,
          retriever: createGraphAwareRetrievalDryRunRetriever(),
          snapshotProvider: async (input) => {
            expect(input.baselineNodeIds).toEqual([
              "summary-language",
              "r-fresh",
            ]);
            return snapshot;
          },
        },
      },
    );

    expect(result.graphRetrieval?.status).toBe("applied");
    expect(result.graphRetrieval?.result?.hiddenDeprecatedNodeIds).toEqual([]);
    expect(
      result.items.map((item) =>
        item.sourceType === "summary" ? item.summary.summaryId : item.record.id,
      ),
    ).toEqual(["summary-language", "r-fresh"]);
    expect(manager.accessedIds).toEqual(["r-fresh"]);
  });

  it("includes soft-deprecated raw records only for audit queries", async () => {
    const now = Date.now();
    const manager = new InMemoryManager();
    const ownerScope = { userId: "u1" } satisfies OwnerScope;
    const snapshot = {
      ownerScope,
      nodes: [
        {
          id: "r-old",
          ownerScope,
          type: "raw",
          visibility: "deprecated",
          createdAt: now,
        },
        {
          id: "summary-language",
          ownerScope,
          type: "summary",
          visibility: "default",
          createdAt: now,
        },
        {
          id: "r-fresh",
          ownerScope,
          type: "raw",
          visibility: "default",
          createdAt: now,
        },
      ],
      edges: [
        {
          id: "edge:r-old:summary-language",
          ownerScope,
          fromNodeId: "r-old",
          toNodeId: "summary-language",
          kind: "supersede",
          weight: 1,
          evidenceNodeIds: ["r-old"],
          reasonCodes: ["summary_sedimentation"],
          createdAt: now,
        },
      ],
      clusters: [
        {
          clusterId: "cluster:language",
          ownerScope,
          nodeIds: ["r-old", "summary-language"],
          lifecycleStatus: "superseded",
          representativeNodeId: "summary-language",
          supportScore: 0.9,
          updatedAt: now,
          reasonCodes: ["summary_sedimentation"],
        },
      ],
      capturedAt: now,
    } satisfies MemoryGraphSnapshot;

    manager.rawMessages = [
      createRaw({
        messageId: "r-old",
        userId: "u1",
        stage: "short",
        timestampSec: 3000,
        text: "old language preference",
        deprecatedAt: now,
        deprecationReason: "summarized_into:summary-language",
        supersededBySummaryId: "summary-language",
      }),
      createRaw({
        messageId: "r-fresh",
        userId: "u1",
        stage: "short",
        timestampSec: 1000,
        text: "fresh project context",
      }),
    ];
    manager.summaries = [
      {
        summaryId: "summary-language",
        userId: "u1",
        summaryTier: "L1",
        sourceTier: "short",
        startTimestamp: 100_000,
        endTimestamp: 2_000_000,
        messageCount: 1,
        sourceRecordIds: ["r-old"],
        keyPoints: ["prefers concise language"],
        keywords: ["language"],
        keywordsText: "language",
        summaryText: "User prefers concise language.",
        createdAt: 2_000_000,
        updatedAt: 2_000_000,
      },
    ];

    const result = await queryMemoryWithFallback(
      manager as unknown as IndexedDBManager,
      {
        userId: "u1",
        pageSize: 3,
        minRawResultsWithoutFallback: 3,
        includeDeprecated: true,
      },
      {
        graphRetrieval: {
          enabled: true,
          retriever: createGraphAwareRetrievalDryRunRetriever(),
          snapshotProvider: async (input) => {
            expect(input.baselineNodeIds).toEqual([
              "r-old",
              "summary-language",
              "r-fresh",
            ]);
            return snapshot;
          },
        },
      },
    );

    expect(result.graphRetrieval?.status).toBe("applied");
    expect(result.graphRetrieval?.result?.hiddenDeprecatedNodeIds).toEqual([]);
    expect(
      result.items.map((item) =>
        item.sourceType === "summary" ? item.summary.summaryId : item.record.id,
      ),
    ).toEqual(["summary-language", "r-old", "r-fresh"]);
    expect(manager.accessedIds).toEqual(["r-old", "r-fresh"]);
  });

  it("recalls raw memories semantically from stored MemoryRecord embeddings", async () => {
    const now = Date.now();
    const manager = new InMemoryManager();

    manager.rawMessages = [
      createRaw({
        messageId: "semantic-near",
        userId: "u1",
        stage: "short",
        timestampSec: Math.floor((now - DAY_MS) / 1000),
        text: "project alpha contract amount and risk notes",
        embedding: [1, 0],
      }),
      createRaw({
        messageId: "semantic-far",
        userId: "u1",
        stage: "short",
        timestampSec: Math.floor((now - DAY_MS) / 1000) + 1,
        text: "dinner plan",
        embedding: [0, 1],
      }),
      createRaw({
        messageId: "semantic-missing-vector",
        userId: "u1",
        stage: "short",
        timestampSec: Math.floor((now - DAY_MS) / 1000) + 2,
        text: "matching text without an embedding",
      }),
      createRaw({
        messageId: "semantic-deprecated",
        userId: "u1",
        stage: "short",
        timestampSec: Math.floor((now - DAY_MS) / 1000) + 3,
        text: "deprecated project alpha contract amount",
        embedding: [1, 0],
        deprecatedAt: now,
        deprecationReason: "summarized_into:semantic-summary",
        supersededBySummaryId: "semantic-summary",
      }),
    ];

    const storage = createIndexedDBMemoryStorageAdapter(
      manager as unknown as IndexedDBManager,
    );

    const hits = await storage.semanticRecallRaw?.({
      userId: "u1",
      queryEmbedding: [1, 0],
      limit: 2,
      threshold: 0.5,
      tiers: ["short"],
      dimensions: {
        platform: "slack",
        botId: "bot-1",
      },
    });

    expect(hits).toBeDefined();
    expect(hits?.map((hit) => hit.record.id)).toEqual(["semantic-near"]);
    expect(hits?.[0]?.record.embedding).toEqual([1, 0]);
    expect(hits?.[0]?.similarity).toBeCloseTo(1);

    const auditHits = await storage.semanticRecallRaw?.({
      userId: "u1",
      queryEmbedding: [1, 0],
      limit: 3,
      threshold: 0.5,
      tiers: ["short"],
      includeDeprecated: true,
      dimensions: {
        platform: "slack",
        botId: "bot-1",
      },
    });

    expect(auditHits?.map((hit) => hit.record.id)).toEqual(
      expect.arrayContaining(["semantic-near", "semantic-deprecated"]),
    );
  });
});
