import { describe, expect, it } from "vitest";
import {
  buildMemoryDeprecationEntries,
  buildMemoryRelationPipeline,
  type MemorySummaryCandidate,
} from "../../../../packages/ai/memory-consolidation/src/pipeline";
import { buildMemoryDeprecationEntry } from "../../../../packages/ai/memory-consolidation/src/plan";
import {
  deprecateMemoryRecords,
  filterDeprecatedRecords,
  type DeprecatablePlanEntry,
} from "../../../../packages/ai/src/memory";
import type {
  MemoryDeprecateRecordsInput,
  MemoryRecord,
  MemorySummary,
  MemoryStorageAdapter,
} from "../../../../packages/ai/src/memory/contracts";

function makeRecord(
  id: string,
  overrides: Partial<MemoryRecord> = {},
): MemoryRecord {
  return {
    id,
    userId: "u1",
    timestamp: 1700000000000,
    tier: "short",
    text: `record-${id}`,
    ...overrides,
  };
}

class InMemoryMemoryStorageAdapter implements MemoryStorageAdapter {
  records: MemoryRecord[] = [];
  summaries: MemorySummary[] = [];
  deprecateCalls: MemoryDeprecateRecordsInput[] = [];

  async acquireLock() {
    return null;
  }
  async releaseLock() {}
  async listCandidates() {
    return [];
  }
  async saveSummaries(summaries: MemorySummary[]) {
    this.summaries.push(...summaries);
  }
  async transitionRecords() {}
  async queryRaw() {
    return { items: [...this.records], hasMore: false };
  }
  async querySummaries() {
    return { items: [...this.summaries], hasMore: false };
  }
  async deprecateRecords(input: MemoryDeprecateRecordsInput): Promise<number> {
    this.deprecateCalls.push(input);
    let affected = 0;
    for (const record of this.records) {
      if (
        record.userId === input.userId &&
        input.ids.includes(record.id) &&
        record.deprecatedAt === undefined
      ) {
        record.deprecatedAt = input.deprecatedAt;
        record.deprecationReason = input.reason;
        record.supersededBySummaryId = input.supersededBySummaryId;
        affected += 1;
      }
    }
    return affected;
  }
}

describe("buildMemoryDeprecationEntry", () => {
  it("marks the action as deprecate and threads the summary id", () => {
    const entry = buildMemoryDeprecationEntry({
      clusterKey: "c1",
      competitionKey: "c1",
      recordIds: ["r1", "r2"],
      winningClusterKey: "c1",
      supersededBySummaryId: "s-1",
    });
    expect(entry.action).toBe("deprecate");
    expect(entry.supersededBySummaryId).toBe("s-1");
    expect(entry.deprecationReason).toBe("superseded_by_summary:s-1");
    expect(entry.reasonCodes).toContain("superseded_by_summary");
    expect(entry.recordIds).toEqual(["r1", "r2"]);
  });

  it("honors a custom reason override", () => {
    const entry = buildMemoryDeprecationEntry({
      clusterKey: "c1",
      competitionKey: "c1",
      recordIds: ["r1"],
      winningClusterKey: "c1",
      supersededBySummaryId: "s-1",
      reason: "manual_cleanup",
    });
    expect(entry.deprecationReason).toBe("manual_cleanup");
  });
});

describe("buildMemoryDeprecationEntries", () => {
  it("emits one deprecation entry per persisted summary", () => {
    const summaryCandidates: MemorySummaryCandidate[] = [
      {
        clusterKey: "c1",
        competitionKey: "ck1",
        recordIds: ["r1", "r2"],
        evidenceCount: 2,
        score: 0.9,
        priority: 1,
        reasonCodes: ["strong_repeated_evidence"],
        sourceAction: "preserve",
      },
      {
        clusterKey: "c2",
        competitionKey: "ck2",
        recordIds: ["r3"],
        evidenceCount: 1,
        score: 0.7,
        priority: 0.7,
        reasonCodes: ["wins_competition"],
        sourceAction: "preserve",
      },
    ];
    const result = buildMemoryDeprecationEntries({
      persistedSummaryIds: ["s1", "s2"],
      summaryCandidates,
    });
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]?.action).toBe("deprecate");
    expect(result.entries[0]?.supersededBySummaryId).toBe("s1");
    expect(result.bySummary.s1).toEqual(["r1", "r2"]);
    expect(result.bySummary.s2).toEqual(["r3"]);
  });

  it("skips candidates whose record list is empty", () => {
    const result = buildMemoryDeprecationEntries({
      persistedSummaryIds: ["s1"],
      summaryCandidates: [
        {
          clusterKey: "c1",
          competitionKey: "ck1",
          recordIds: [],
          evidenceCount: 0,
          score: 0.9,
          priority: 0,
          reasonCodes: [],
          sourceAction: "preserve",
        },
      ],
    });
    expect(result.entries).toHaveLength(0);
    expect(result.bySummary).toEqual({});
  });

  it("aligns on the shorter of the two input lists", () => {
    const result = buildMemoryDeprecationEntries({
      persistedSummaryIds: ["s1"],
      summaryCandidates: [
        {
          clusterKey: "c1",
          competitionKey: "ck1",
          recordIds: ["r1"],
          evidenceCount: 1,
          score: 0.9,
          priority: 1,
          reasonCodes: [],
          sourceAction: "preserve",
        },
        {
          clusterKey: "c2",
          competitionKey: "ck2",
          recordIds: ["r2"],
          evidenceCount: 1,
          score: 0.8,
          priority: 0.8,
          reasonCodes: [],
          sourceAction: "preserve",
        },
      ],
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.supersededBySummaryId).toBe("s1");
  });
});

describe("deprecateMemoryRecords", () => {
  it("persists deprecation entries through the adapter and counts affected rows", async () => {
    const adapter = new InMemoryMemoryStorageAdapter();
    adapter.records = [makeRecord("r1"), makeRecord("r2"), makeRecord("r3")];
    const entries = [
      buildMemoryDeprecationEntry({
        clusterKey: "c1",
        competitionKey: "c1",
        recordIds: ["r1", "r2"],
        winningClusterKey: "c1",
        supersededBySummaryId: "s1",
      }),
    ];
    const result = await deprecateMemoryRecords({
      userId: "u1",
      entries,
      store: adapter,
      now: 1700000001000,
    });
    expect(result.status).toBe("persisted");
    expect(result.plannedCount).toBe(2);
    expect(result.persistedCount).toBe(2);
    expect(result.perEntry[0]?.affectedRows).toBe(2);
    expect(adapter.deprecateCalls).toHaveLength(1);
    expect(adapter.records[0]?.deprecatedAt).toBe(1700000001000);
    expect(adapter.records[0]?.supersededBySummaryId).toBe("s1");
  });

  it("is idempotent — re-deprecating returns 0 affected rows", async () => {
    const adapter = new InMemoryMemoryStorageAdapter();
    adapter.records = [makeRecord("r1", { deprecatedAt: 1 })];
    const entries = [
      buildMemoryDeprecationEntry({
        clusterKey: "c1",
        competitionKey: "c1",
        recordIds: ["r1"],
        winningClusterKey: "c1",
        supersededBySummaryId: "s1",
      }),
    ];
    const result = await deprecateMemoryRecords({
      userId: "u1",
      entries,
      store: adapter,
    });
    expect(result.persistedCount).toBe(0);
    expect(result.reasonCodes).toContain("persisted");
    expect(result.reasonCodes).toContain("adapter_returned_zero");
  });

  it("short-circuits when enabled is false", async () => {
    const adapter = new InMemoryMemoryStorageAdapter();
    adapter.records = [makeRecord("r1")];
    const result = await deprecateMemoryRecords({
      userId: "u1",
      entries: [
        buildMemoryDeprecationEntry({
          clusterKey: "c1",
          competitionKey: "c1",
          recordIds: ["r1"],
          winningClusterKey: "c1",
          supersededBySummaryId: "s1",
        }),
      ],
      store: adapter,
      enabled: false,
    });
    expect(result.status).toBe("disabled");
    expect(adapter.deprecateCalls).toHaveLength(0);
    expect(adapter.records[0]?.deprecatedAt).toBeUndefined();
  });

  it("dry-run reports planned counts without calling the adapter", async () => {
    const adapter = new InMemoryMemoryStorageAdapter();
    adapter.records = [makeRecord("r1"), makeRecord("r2")];
    const result = await deprecateMemoryRecords({
      userId: "u1",
      entries: [
        buildMemoryDeprecationEntry({
          clusterKey: "c1",
          competitionKey: "c1",
          recordIds: ["r1", "r2"],
          winningClusterKey: "c1",
          supersededBySummaryId: "s1",
        }),
      ],
      store: adapter,
      dryRun: true,
    });
    expect(result.status).toBe("dry-run");
    expect(result.plannedCount).toBe(2);
    expect(result.persistedCount).toBe(0);
    expect(adapter.deprecateCalls).toHaveLength(0);
    expect(adapter.records[0]?.deprecatedAt).toBeUndefined();
  });

  it("ignores non-deprecate entries by default", async () => {
    const adapter = new InMemoryMemoryStorageAdapter();
    adapter.records = [makeRecord("r1")];
    const result = await deprecateMemoryRecords({
      userId: "u1",
      entries: [
        {
          clusterKey: "c1",
          competitionKey: "c1",
          action: "preserve",
          score: 0.9,
          evidenceCount: 3,
          recordIds: ["r1"],
          rankInCompetition: 1,
          winningClusterKey: "c1",
          competingClusterKeys: [],
          scoreMargin: 0.1,
          reasonCodes: ["strong_repeated_evidence"],
          explanation: "ok",
        } as unknown as DeprecatablePlanEntry,
      ],
      store: adapter,
    });
    expect(result.plannedCount).toBe(0);
    expect(adapter.deprecateCalls).toHaveLength(0);
  });

  it("degrades to no-op when the adapter has no deprecateRecords method", async () => {
    const adapter: MemoryStorageAdapter = {
      acquireLock: async () => null,
      releaseLock: async () => {},
      listCandidates: async () => [],
      saveSummaries: async () => {},
      transitionRecords: async () => {},
      queryRaw: async () => ({ items: [], hasMore: false }),
      querySummaries: async () => ({ items: [], hasMore: false }),
    };
    const result = await deprecateMemoryRecords({
      userId: "u1",
      entries: [
        buildMemoryDeprecationEntry({
          clusterKey: "c1",
          competitionKey: "c1",
          recordIds: ["r1"],
          winningClusterKey: "c1",
          supersededBySummaryId: "s1",
        }),
      ],
      store: adapter,
    });
    expect(result.status).toBe("no-op");
    expect(result.reasonCodes).toContain("adapter_missing_deprecate_records");
  });

  it("deprecation does not delete the underlying record (soft hide only)", async () => {
    const adapter = new InMemoryMemoryStorageAdapter();
    adapter.records = [makeRecord("r1", { text: "important fact" })];
    await deprecateMemoryRecords({
      userId: "u1",
      entries: [
        buildMemoryDeprecationEntry({
          clusterKey: "c1",
          competitionKey: "c1",
          recordIds: ["r1"],
          winningClusterKey: "c1",
          supersededBySummaryId: "s1",
        }),
      ],
      store: adapter,
    });
    expect(adapter.records).toHaveLength(1);
    expect(adapter.records[0]?.text).toBe("important fact");
    expect(adapter.records[0]?.deprecatedAt).toBeDefined();
  });

  it("connects persisted summaries to soft-deprecated raw records and audit retrieval", async () => {
    const adapter = new InMemoryMemoryStorageAdapter();
    adapter.records = [
      makeRecord("r1", { text: "prefers morning planning" }),
      makeRecord("r2", { text: "prefers calendar review on Mondays" }),
      makeRecord("r3", { text: "unrelated active raw record" }),
    ];
    const summary: MemorySummary = {
      summaryId: "summary-morning-planning",
      userId: "u1",
      summaryTier: "L1",
      sourceTier: "short",
      startTimestamp: 1700000000000,
      endTimestamp: 1700000002000,
      messageCount: 2,
      sourceRecordIds: ["r1", "r2"],
      keyPoints: ["User prefers morning planning and Monday calendar review."],
      keywords: ["planning", "calendar"],
      summaryText: "User prefers morning planning and Monday calendar review.",
      qualityScore: 0.91,
      createdAt: 1700000003000,
      updatedAt: 1700000003000,
    };
    const summaryCandidates: MemorySummaryCandidate[] = [
      {
        clusterKey: "planning-preferences",
        competitionKey: "planning-preferences",
        recordIds: summary.sourceRecordIds,
        evidenceCount: summary.sourceRecordIds.length,
        score: 0.91,
        priority: 0.91,
        reasonCodes: ["strong_repeated_evidence"],
        sourceAction: "preserve",
      },
    ];

    await adapter.saveSummaries([summary]);
    const deprecationPlan = buildMemoryDeprecationEntries({
      persistedSummaryIds: [summary.summaryId],
      summaryCandidates,
    });
    const result = await deprecateMemoryRecords({
      userId: "u1",
      entries: deprecationPlan.entries,
      store: adapter,
      now: 1700000004000,
    });

    expect(result.persistedCount).toBe(2);
    expect(deprecationPlan.bySummary[summary.summaryId]).toEqual(["r1", "r2"]);

    const defaultRawRetrieval = filterDeprecatedRecords(
      (await adapter.queryRaw()).items,
    );
    expect(defaultRawRetrieval.records.map((record) => record.id)).toEqual([
      "r3",
    ]);
    expect(defaultRawRetrieval.hiddenDeprecatedCount).toBe(2);

    const auditRawRetrieval = filterDeprecatedRecords(
      (await adapter.queryRaw()).items,
      { includeDeprecated: true },
    );
    expect(auditRawRetrieval.records.map((record) => record.id)).toEqual([
      "r1",
      "r2",
      "r3",
    ]);
    expect(
      auditRawRetrieval.records
        .filter((record) => record.supersededBySummaryId === summary.summaryId)
        .map((record) => ({
          id: record.id,
          deprecatedAt: record.deprecatedAt,
          deprecationReason: record.deprecationReason,
        })),
    ).toEqual([
      {
        id: "r1",
        deprecatedAt: 1700000004000,
        deprecationReason: `summarized_into:${summary.summaryId}`,
      },
      {
        id: "r2",
        deprecatedAt: 1700000004000,
        deprecationReason: `summarized_into:${summary.summaryId}`,
      },
    ]);

    const summaryRetrieval = await adapter.querySummaries();
    expect(summaryRetrieval.items).toEqual([summary]);
    expect(summaryRetrieval.items[0]?.sourceRecordIds).toEqual(["r1", "r2"]);

    const repeatResult = await deprecateMemoryRecords({
      userId: "u1",
      entries: deprecationPlan.entries,
      store: adapter,
      now: 1700000005000,
    });
    expect(repeatResult.persistedCount).toBe(0);
    expect(
      adapter.records.filter((record) => record.deprecatedAt !== undefined),
    ).toHaveLength(2);
  });
});

describe("filterDeprecatedRecords", () => {
  it("hides deprecated records by default", () => {
    const records = [
      makeRecord("r1"),
      makeRecord("r2", { deprecatedAt: 1234 }),
      makeRecord("r3"),
    ];
    const out = filterDeprecatedRecords(records);
    expect(out.records.map((r) => r.id)).toEqual(["r1", "r3"]);
    expect(out.hiddenDeprecatedCount).toBe(1);
  });

  it("includes deprecated records when includeDeprecated is true", () => {
    const records = [
      makeRecord("r1"),
      makeRecord("r2", { deprecatedAt: 1234 }),
    ];
    const out = filterDeprecatedRecords(records, { includeDeprecated: true });
    expect(out.records).toHaveLength(2);
    expect(out.hiddenDeprecatedCount).toBe(0);
  });

  it("does not mutate the input array", () => {
    const records = [
      makeRecord("r1"),
      makeRecord("r2", { deprecatedAt: 1234 }),
    ];
    const snapshot = [...records];
    filterDeprecatedRecords(records);
    expect(records).toEqual(snapshot);
  });
});

describe("buildMemoryRelationPipeline → buildMemoryDeprecationEntries integration", () => {
  it("produces deprecation entries that align with summary candidates", () => {
    const records = [
      makeRecord("r1"),
      makeRecord("r2"),
      makeRecord("r3"),
      makeRecord("r4"),
    ];
    const pipeline = buildMemoryRelationPipeline({
      records,
      now: 1700000000000,
    });
    // Synthesize persisted summary ids aligned with the summary candidates.
    const persistedSummaryIds = pipeline.summaryCandidates.map(
      (_candidate, index) => `synthetic-summary-${index}`,
    );
    const result = buildMemoryDeprecationEntries({
      persistedSummaryIds,
      summaryCandidates: pipeline.summaryCandidates,
    });
    // The pipeline may produce zero summary candidates when no cluster meets
    // the preserve threshold — that's fine; we just verify the alignment.
    expect(result.entries.length).toBe(persistedSummaryIds.length);
    for (let i = 0; i < result.entries.length; i += 1) {
      expect(result.entries[i]?.supersededBySummaryId).toBe(
        persistedSummaryIds[i],
      );
      expect(result.entries[i]?.action).toBe("deprecate");
    }
  });
});
