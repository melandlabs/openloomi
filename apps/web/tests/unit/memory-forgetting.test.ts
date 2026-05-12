import { describe, expect, it } from "vitest";
import {
  createMemoryForgettingEngine,
  createMemoryQueryApi,
  normalizeMemoryRecordForIngest,
  normalizeMemoryRecordsForIngest,
  type MemoryLockHandle,
  type MemoryPageResult,
  type MemoryRecord,
  type MemorySearchQuery,
  type MemoryStorageAdapter,
  type MemorySummary,
  type MemorySummarySearchQuery,
  DEFAULT_MEMORY_FORGETTING_POLICY,
  resolveMemoryForgettingPolicy,
  summaryTierForTransition,
  transitionTargetTier,
  DefaultMemoryRecordScorer,
  RuleBasedMemorySummarizer,
} from "../../../../packages/ai/src/memory";

class InMemoryStorageAdapter implements MemoryStorageAdapter {
  records: MemoryRecord[] = [];
  summaries: MemorySummary[] = [];
  lockAvailable = true;
  acquireCalls = 0;
  releaseCalls = 0;
  saveSummaryCalls = 0;
  transitionCalls = 0;
  archiveCalls = 0;
  markAccessCalls = 0;

  async acquireLock(input: {
    key: string;
    ttlMs: number;
    now: number;
  }): Promise<MemoryLockHandle | null> {
    this.acquireCalls += 1;
    if (!this.lockAvailable) return null;
    return {
      key: input.key,
      token: "lock-token",
      acquiredAt: input.now,
      expiresAt: input.now + input.ttlMs,
    };
  }

  async releaseLock(): Promise<void> {
    this.releaseCalls += 1;
  }

  async listCandidates(input: {
    userId: string;
    tier: "short" | "mid" | "long";
    olderThan: number;
    limit: number;
  }): Promise<MemoryRecord[]> {
    return this.records
      .filter(
        (record) =>
          record.userId === input.userId &&
          record.tier === input.tier &&
          record.timestamp <= input.olderThan,
      )
      .slice(0, input.limit);
  }

  async saveSummaries(summaries: MemorySummary[]): Promise<void> {
    this.saveSummaryCalls += 1;
    this.summaries.push(...summaries);
  }

  async transitionRecords(input: {
    userId: string;
    ids: string[];
    toTier: "short" | "mid" | "long";
    transitionedAt: number;
    summaryId?: string;
  }): Promise<void> {
    this.transitionCalls += 1;
    for (const record of this.records) {
      if (record.userId !== input.userId) continue;
      if (!input.ids.includes(record.id)) continue;
      record.tier = input.toTier;
      record.metadata = {
        ...(record.metadata ?? {}),
        transitionedAt: input.transitionedAt,
        summaryId: input.summaryId,
      };
    }
  }

  async archiveRecordDetails(input: {
    userId: string;
    ids: string[];
    archivedAt: number;
  }): Promise<void> {
    this.archiveCalls += 1;
    for (const record of this.records) {
      if (record.userId !== input.userId) continue;
      if (!input.ids.includes(record.id)) continue;
      record.archivedAt = input.archivedAt;
      record.text = undefined;
    }
  }

  async queryRaw(
    _query: MemorySearchQuery,
  ): Promise<MemoryPageResult<MemoryRecord>> {
    return { items: [], hasMore: false };
  }

  async querySummaries(
    _query: MemorySummarySearchQuery,
  ): Promise<MemoryPageResult<MemorySummary>> {
    return { items: [], hasMore: false };
  }

  async markRecordsAccessed(input: {
    userId: string;
    ids: string[];
    at: number;
  }): Promise<void> {
    this.markAccessCalls += 1;
    for (const record of this.records) {
      if (record.userId !== input.userId) continue;
      if (!input.ids.includes(record.id)) continue;
      record.lastAccessAt = input.at;
      record.accessCount = (record.accessCount ?? 0) + 1;
    }
  }
}

function createRecord(
  input: Partial<MemoryRecord> & { id: string },
): MemoryRecord {
  return {
    id: input.id,
    userId: input.userId ?? "u1",
    timestamp: input.timestamp ?? Date.now(),
    text: input.text,
    mediaRefs: input.mediaRefs,
    embedding: input.embedding,
    embeddingModel: input.embeddingModel,
    embeddingContentHash: input.embeddingContentHash,
    embeddingDimensions: input.embeddingDimensions,
    embeddingUpdatedAt: input.embeddingUpdatedAt,
    tier: input.tier ?? "short",
    accessCount: input.accessCount,
    lastAccessAt: input.lastAccessAt,
    importanceScore: input.importanceScore,
    isPinned: input.isPinned,
    archivedAt: input.archivedAt,
    dimensions: input.dimensions,
    metadata: input.metadata,
  };
}

describe("memory policy", () => {
  it("resolves defaults and partial overrides", () => {
    const policy = resolveMemoryForgettingPolicy({
      shortMaxAgeMs: 123,
      scoreThresholds: { midToLong: 0.4 },
      lock: { ttlMs: 5000 },
    });

    expect(policy.shortMaxAgeMs).toBe(123);
    expect(policy.midMaxAgeMs).toBe(
      DEFAULT_MEMORY_FORGETTING_POLICY.midMaxAgeMs,
    );
    expect(policy.scoreThresholds.shortToMid).toBe(
      DEFAULT_MEMORY_FORGETTING_POLICY.scoreThresholds.shortToMid,
    );
    expect(policy.scoreThresholds.midToLong).toBe(0.4);
    expect(policy.lock.ttlMs).toBe(5000);
  });

  it("maps transition and summary tiers", () => {
    expect(summaryTierForTransition("short")).toBe("L1");
    expect(summaryTierForTransition("mid")).toBe("L2");
    expect(transitionTargetTier("short")).toBe("mid");
    expect(transitionTargetTier("mid")).toBe("long");
  });
});

describe("memory scorer", () => {
  it("prioritizes recently accessed and pinned records", () => {
    const scorer = new DefaultMemoryRecordScorer();
    const now = Date.now();

    const oldCold = createRecord({
      id: "old-cold",
      timestamp: now - 200 * 24 * 60 * 60 * 1000,
      text: "random note",
      accessCount: 0,
      importanceScore: 0,
    });

    const recentHot = createRecord({
      id: "recent-hot",
      timestamp: now - 1 * 24 * 60 * 60 * 1000,
      text: "urgent deadline and action item",
      accessCount: 8,
      importanceScore: 0.9,
      isPinned: true,
    });

    const oldScore = scorer.score(oldCold, { now });
    const recentScore = scorer.score(recentHot, { now });

    expect(oldScore).toBeGreaterThanOrEqual(0);
    expect(oldScore).toBeLessThanOrEqual(1);
    expect(recentScore).toBeGreaterThan(oldScore);
    expect(recentScore).toBeLessThanOrEqual(1);
  });
});

describe("rule-based summarizer", () => {
  it("creates compact highlights and keywords", async () => {
    const summarizer = new RuleBasedMemorySummarizer();
    const now = Date.now();
    const longText = `This is a very long statement ${"x".repeat(220)}`;

    const group = {
      groupId: "g1",
      userId: "u1",
      sourceTier: "short" as const,
      targetTier: "mid" as const,
      summaryTier: "L1" as const,
      startTimestamp: now - 10_000,
      endTimestamp: now,
      dimensions: { platform: "slack" },
      records: [
        {
          ...createRecord({
            id: "r1",
            timestamp: now - 10_000,
            text: longText,
          }),
          ageMs: 10_000,
          valueScore: 0.3,
        },
        {
          ...createRecord({
            id: "r2",
            timestamp: now - 9_000,
            text: "deadline migration plan with rollback path",
          }),
          ageMs: 9_000,
          valueScore: 0.4,
        },
        {
          ...createRecord({
            id: "r3",
            timestamp: now - 8_000,
            text: "deadline migration plan with rollback path",
          }),
          ageMs: 8_000,
          valueScore: 0.4,
        },
      ],
    };

    const summary = await summarizer.summarizeGroup(group);

    expect(summary.summaryText).toContain("Tier transition: short -> mid (L1)");
    expect(summary.keyPoints.length).toBeGreaterThan(0);
    expect(summary.keyPoints[0]?.endsWith("...")).toBe(true);
    expect(summary.keywords.length).toBeGreaterThan(0);
  });
});

describe("memory ingest", () => {
  it("defaults tier to short when tier is omitted", () => {
    const now = Date.now();
    const normalized = normalizeMemoryRecordForIngest({
      id: "ingest-1",
      userId: "u1",
      timestamp: now,
      text: "new message",
    });

    expect(normalized.tier).toBe("short");
  });

  it("preserves embedding metadata during ingest normalization", () => {
    const now = Date.now();
    const normalized = normalizeMemoryRecordForIngest({
      id: "ingest-embedding",
      userId: "u1",
      timestamp: now,
      text: "message with vector",
      embedding: [0.1, 0.2, 0.3],
      embeddingModel: "text-embedding-3-small",
      embeddingContentHash: "memory-record-embedding-text-v1:abc",
      embeddingDimensions: 3,
      embeddingUpdatedAt: now,
    });

    expect(normalized.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(normalized.embeddingModel).toBe("text-embedding-3-small");
    expect(normalized.embeddingContentHash).toBe(
      "memory-record-embedding-text-v1:abc",
    );
    expect(normalized.embeddingDimensions).toBe(3);
    expect(normalized.embeddingUpdatedAt).toBe(now);
  });

  it("normalizes batch records and preserves explicit tiers", () => {
    const now = Date.now();
    const normalized = normalizeMemoryRecordsForIngest([
      {
        id: "ingest-2",
        userId: "u1",
        timestamp: now,
        text: "message a",
      },
      {
        id: "ingest-3",
        userId: "u1",
        timestamp: now,
        text: "message b",
        tier: "mid",
      },
    ]);

    expect(normalized[0]?.tier).toBe("short");
    expect(normalized[1]?.tier).toBe("mid");
  });
});

describe("memory forgetting engine", () => {
  it("returns skipped_locked when lock cannot be acquired", async () => {
    const storage = new InMemoryStorageAdapter();
    storage.lockAvailable = false;
    const engine = createMemoryForgettingEngine({ storage });

    const result = await engine.runCycle({ userId: "u1" });

    expect(result.status).toBe("skipped_locked");
    expect(storage.acquireCalls).toBe(1);
    expect(storage.releaseCalls).toBe(0);
  });

  it("computes transitions in dryRun without persisting writes", async () => {
    const storage = new InMemoryStorageAdapter();
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const shortWindowStart =
      Math.floor(
        (now - DEFAULT_MEMORY_FORGETTING_POLICY.shortMaxAgeMs - 2 * dayMs) /
          DEFAULT_MEMORY_FORGETTING_POLICY.groupWindowMs.short,
      ) * DEFAULT_MEMORY_FORGETTING_POLICY.groupWindowMs.short;
    storage.records = [
      createRecord({
        id: "s1",
        userId: "u1",
        tier: "short",
        timestamp: shortWindowStart + 1_000,
        text: "low value one",
      }),
      createRecord({
        id: "s2",
        userId: "u1",
        tier: "short",
        timestamp: shortWindowStart + 2_000,
        text: "low value two",
      }),
      createRecord({
        id: "s3",
        userId: "u1",
        tier: "short",
        timestamp: shortWindowStart + 3_000,
        text: "low value three",
      }),
    ];

    const engine = createMemoryForgettingEngine({ storage });
    const result = await engine.runCycle({ userId: "u1", now, dryRun: true });

    expect(result.status).toBe("success");
    expect(result.createdSummaries).toBe(1);
    expect(result.transitionedRecords).toBe(3);
    expect(storage.saveSummaryCalls).toBe(0);
    expect(storage.transitionCalls).toBe(0);
    expect(storage.archiveCalls).toBe(0);
    expect(storage.releaseCalls).toBe(1);
  });

  it("persists summary and transitions records when not dryRun", async () => {
    const storage = new InMemoryStorageAdapter();
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const shortWindowStart =
      Math.floor(
        (now - DEFAULT_MEMORY_FORGETTING_POLICY.shortMaxAgeMs - 2 * dayMs) /
          DEFAULT_MEMORY_FORGETTING_POLICY.groupWindowMs.short,
      ) * DEFAULT_MEMORY_FORGETTING_POLICY.groupWindowMs.short;
    const midWindowStart =
      Math.floor(
        (now - DEFAULT_MEMORY_FORGETTING_POLICY.midMaxAgeMs - 14 * dayMs) /
          DEFAULT_MEMORY_FORGETTING_POLICY.groupWindowMs.mid,
      ) * DEFAULT_MEMORY_FORGETTING_POLICY.groupWindowMs.mid;
    storage.records = [
      createRecord({
        id: "s1",
        userId: "u1",
        tier: "short",
        timestamp: shortWindowStart + 1_000,
        text: "old short one",
      }),
      createRecord({
        id: "s2",
        userId: "u1",
        tier: "short",
        timestamp: shortWindowStart + 2_000,
        text: "old short two",
      }),
      createRecord({
        id: "s3",
        userId: "u1",
        tier: "short",
        timestamp: shortWindowStart + 3_000,
        text: "old short three",
      }),
      createRecord({
        id: "m1",
        userId: "u1",
        tier: "mid",
        timestamp: midWindowStart + 1_000,
        text: "old mid one",
      }),
      createRecord({
        id: "m2",
        userId: "u1",
        tier: "mid",
        timestamp: midWindowStart + 2_000,
        text: "old mid two",
      }),
      createRecord({
        id: "m3",
        userId: "u1",
        tier: "mid",
        timestamp: midWindowStart + 3_000,
        text: "old mid three",
      }),
    ];

    const engine = createMemoryForgettingEngine({ storage });
    const result = await engine.runCycle({ userId: "u1", now, dryRun: false });

    expect(result.createdSummaries).toBe(2);
    expect(result.transitionedRecords).toBe(6);
    expect(storage.saveSummaryCalls).toBeGreaterThan(0);
    expect(storage.transitionCalls).toBeGreaterThan(0);
    expect(storage.archiveCalls).toBeGreaterThan(0);

    const shortNowMid = storage.records.filter(
      (record) => record.id.startsWith("s") && record.tier === "mid",
    );
    const midNowLong = storage.records.filter(
      (record) => record.id.startsWith("m") && record.tier === "long",
    );
    expect(shortNowMid.length).toBe(3);
    expect(midNowLong.length).toBe(3);
    expect(midNowLong.every((record) => record.archivedAt !== undefined)).toBe(
      true,
    );
  });
});

describe("memory query api", () => {
  it("does not query summaries when raw results are sufficient", async () => {
    const rawRecords = [
      createRecord({ id: "r1", userId: "u1", timestamp: 2000 }),
      createRecord({ id: "r2", userId: "u1", timestamp: 1000 }),
    ];

    let summaryQueryCount = 0;
    let markAccessCount = 0;

    const storage: MemoryStorageAdapter = {
      acquireLock: async () => null,
      releaseLock: async () => {},
      listCandidates: async () => [],
      saveSummaries: async () => {},
      transitionRecords: async () => {},
      queryRaw: async () => ({ items: rawRecords, hasMore: false }),
      querySummaries: async () => {
        summaryQueryCount += 1;
        return { items: [], hasMore: false };
      },
      markRecordsAccessed: async () => {
        markAccessCount += 1;
      },
    };

    const api = createMemoryQueryApi({ storage });
    const result = await api.queryWithFallback({
      userId: "u1",
      pageSize: 2,
      minRawResultsWithoutFallback: 2,
    });

    expect(result.rawCount).toBe(2);
    expect(result.summaryCount).toBe(0);
    expect(summaryQueryCount).toBe(0);
    expect(markAccessCount).toBe(1);
    expect(result.items[0]?.sourceType).toBe("raw");
  });

  it("queries summaries when raw results are insufficient", async () => {
    const rawRecords = [
      createRecord({ id: "r1", userId: "u1", timestamp: 1000 }),
    ];
    const summaries: MemorySummary[] = [
      {
        summaryId: "s1",
        userId: "u1",
        summaryTier: "L2",
        sourceTier: "mid",
        startTimestamp: 100,
        endTimestamp: 3000,
        messageCount: 4,
        sourceRecordIds: ["a", "b", "c", "d"],
        keyPoints: ["k1"],
        keywords: ["foo"],
        summaryText: "summary text",
        createdAt: 100,
        updatedAt: 100,
      },
    ];

    let summaryQueryCount = 0;
    const storage: MemoryStorageAdapter = {
      acquireLock: async () => null,
      releaseLock: async () => {},
      listCandidates: async () => [],
      saveSummaries: async () => {},
      transitionRecords: async () => {},
      queryRaw: async () => ({ items: rawRecords, hasMore: false }),
      querySummaries: async () => {
        summaryQueryCount += 1;
        return { items: summaries, hasMore: false };
      },
      markRecordsAccessed: async () => {},
    };

    const api = createMemoryQueryApi({ storage });
    const result = await api.queryWithFallback({
      userId: "u1",
      pageSize: 3,
      minRawResultsWithoutFallback: 2,
    });

    expect(summaryQueryCount).toBe(1);
    expect(result.rawCount).toBe(1);
    expect(result.summaryCount).toBe(1);
    expect(result.items.length).toBe(2);
    expect(result.items[0]?.sourceType).toBe("summary");
    expect(result.items[1]?.sourceType).toBe("raw");
  });
});
