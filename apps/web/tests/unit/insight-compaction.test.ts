import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Insight } from "@/lib/db/schema";

const {
  clearAIUserContextMock,
  deleteMock,
  mockDb,
  selectMock,
  setAIUserContextMock,
  transactionMock,
  updateMock,
} = vi.hoisted(() => {
  const select = vi.fn();
  const transaction = vi.fn();
  const deleteFn = vi.fn();
  const update = vi.fn();

  return {
    clearAIUserContextMock: vi.fn(),
    deleteMock: deleteFn,
    mockDb: {
      select,
      transaction,
      delete: deleteFn,
      update,
    },
    selectMock: select,
    setAIUserContextMock: vi.fn(),
    transactionMock: transaction,
    updateMock: update,
  };
});

vi.mock("@/lib/env/constants", () => ({
  isTauriMode: () => false,
}));

vi.mock("@/lib/db/queries", () => ({
  db: mockDb,
}));

vi.mock("@/lib/ai", () => ({
  getModelProvider: () => ({ languageModel: () => null }),
  setAIUserContext: setAIUserContextMock,
  clearAIUserContext: clearAIUserContextMock,
}));

let buildInsightCompactionBucketKey: typeof import("@/lib/insights/compaction").buildInsightCompactionBucketKey;
let buildSeedCompactedInsightPayload: typeof import("@/lib/insights/compaction").buildSeedCompactedInsightPayload;
let archiveLegacyPendingDeletionInsights: typeof import("@/lib/insights/compaction").archiveLegacyPendingDeletionInsights;
let groupInsightsForCompaction: typeof import("@/lib/insights/compaction").groupInsightsForCompaction;
let isInsightCompactable: typeof import("@/lib/insights/compaction").isInsightCompactable;
let mergeCompactedInsightPayload: typeof import("@/lib/insights/compaction").mergeCompactedInsightPayload;
let previewInsightCompaction: typeof import("@/lib/insights/compaction").previewInsightCompaction;
let runInsightCompaction: typeof import("@/lib/insights/compaction").runInsightCompaction;

beforeAll(async () => {
  const mod = await import("@/lib/insights/compaction");
  buildInsightCompactionBucketKey = mod.buildInsightCompactionBucketKey;
  buildSeedCompactedInsightPayload = mod.buildSeedCompactedInsightPayload;
  archiveLegacyPendingDeletionInsights =
    mod.archiveLegacyPendingDeletionInsights;
  groupInsightsForCompaction = mod.groupInsightsForCompaction;
  isInsightCompactable = mod.isInsightCompactable;
  mergeCompactedInsightPayload = mod.mergeCompactedInsightPayload;
  previewInsightCompaction = mod.previewInsightCompaction;
  runInsightCompaction = mod.runInsightCompaction;
});

beforeEach(() => {
  selectMock.mockReset();
  transactionMock.mockReset();
  deleteMock.mockReset();
  updateMock.mockReset();
  setAIUserContextMock.mockReset();
  clearAIUserContextMock.mockReset();
});

function makeInsight(overrides: Partial<Insight> = {}): Insight {
  const now = new Date("2026-04-01T10:00:00.000Z");
  return {
    id: overrides.id ?? crypto.randomUUID(),
    botId: overrides.botId ?? "bot-1",
    dedupeKey: overrides.dedupeKey ?? null,
    taskLabel: overrides.taskLabel ?? "summary",
    title: overrides.title ?? "Base insight",
    description: overrides.description ?? "Base description",
    importance: overrides.importance ?? "low",
    urgency: overrides.urgency ?? "low",
    platform: overrides.platform ?? "telegram",
    account: overrides.account ?? "acct",
    groups: overrides.groups ?? ["Group A"],
    people: overrides.people ?? ["Alice"],
    time: overrides.time ?? now,
    details: overrides.details ?? [
      {
        time: now.getTime(),
        person: "Alice",
        channel: "Group A",
        content: "Base message",
      },
    ],
    timeline: overrides.timeline ?? [
      {
        time: now.getTime(),
        title: "Event",
        summary: "Summary",
        type: "message",
      } as any,
    ],
    insights: overrides.insights ?? [
      { category: "topic", value: "alpha", confidence: 0.8 },
    ],
    trendDirection: overrides.trendDirection ?? null,
    trendConfidence: overrides.trendConfidence ?? null,
    sentiment: overrides.sentiment ?? null,
    sentimentConfidence: overrides.sentimentConfidence ?? null,
    intent: overrides.intent ?? null,
    trend: overrides.trend ?? null,
    issueStatus: overrides.issueStatus ?? null,
    communityTrend: overrides.communityTrend ?? null,
    duplicateFlag: overrides.duplicateFlag ?? false,
    impactLevel: overrides.impactLevel ?? null,
    resolutionHint: overrides.resolutionHint ?? null,
    topKeywords: overrides.topKeywords ?? ["alpha"],
    topEntities: overrides.topEntities ?? ["Entity A"],
    topVoices: overrides.topVoices ?? null,
    sources: overrides.sources ?? [
      { platform: "telegram", snippet: "snippet", link: "https://example.com" },
    ],
    sourceConcentration: overrides.sourceConcentration ?? null,
    buyerSignals: overrides.buyerSignals ?? [],
    stakeholders: overrides.stakeholders ?? [{ name: "Alice", role: "owner" }],
    contractStatus: overrides.contractStatus ?? null,
    signalType: overrides.signalType ?? null,
    confidence: overrides.confidence ?? 0.7,
    scope: overrides.scope ?? null,
    nextActions: overrides.nextActions ?? [
      { action: "Follow up", owner: "Alice" },
    ],
    followUps: overrides.followUps ?? [
      { action: "Reply", reason: "keep moving" } as any,
    ],
    actionRequired: overrides.actionRequired ?? false,
    actionRequiredDetails: overrides.actionRequiredDetails ?? null,
    isUnreplied: overrides.isUnreplied ?? false,
    myTasks: overrides.myTasks ?? null,
    waitingForMe: overrides.waitingForMe ?? null,
    waitingForOthers: overrides.waitingForOthers ?? null,
    clarifyNeeded: overrides.clarifyNeeded ?? false,
    categories: overrides.categories ?? ["monitor"],
    learning: overrides.learning ?? "Remember this",
    priority: overrides.priority ?? null,
    experimentIdeas: overrides.experimentIdeas ?? null,
    executiveSummary: overrides.executiveSummary ?? "Executive summary",
    riskFlags: overrides.riskFlags ?? null,
    client: overrides.client ?? "Acme",
    projectName: overrides.projectName ?? "Alpha",
    nextMilestone: overrides.nextMilestone ?? null,
    dueDate: overrides.dueDate ?? null,
    paymentInfo: overrides.paymentInfo ?? null,
    entity: overrides.entity ?? null,
    why: overrides.why ?? "Why it matters",
    historySummary: overrides.historySummary ?? null,
    strategic: overrides.strategic ?? null,
    roleAttribution: overrides.roleAttribution ?? null,
    alerts: overrides.alerts ?? null,
    pendingDeletionAt: overrides.pendingDeletionAt ?? null,
    compactedIntoInsightId: overrides.compactedIntoInsightId ?? null,
    isArchived: overrides.isArchived ?? false,
    isFavorited: overrides.isFavorited ?? false,
    archivedAt: overrides.archivedAt ?? null,
    favoritedAt: overrides.favoritedAt ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function makeSelectBuilder(response: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(response),
      }),
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(response),
          }),
        }),
      }),
    }),
  };
}

describe("insight compaction", () => {
  it("filters out high-signal or already-pending insights", () => {
    expect(isInsightCompactable(makeInsight())).toBe(true);
    expect(isInsightCompactable(makeInsight({ importance: "high" }))).toBe(
      false,
    );
    expect(
      isInsightCompactable(
        makeInsight({
          pendingDeletionAt: new Date("2026-04-02T00:00:00.000Z"),
        }),
      ),
    ).toBe(false);
    expect(
      isInsightCompactable(makeInsight({ signalType: "compaction_digest" })),
    ).toBe(false);
  });

  it("buckets insights by bot + project + month", () => {
    const first = makeInsight({
      id: "i1",
      time: new Date("2026-03-01T00:00:00.000Z"),
    });
    const second = makeInsight({
      id: "i2",
      time: new Date("2026-03-10T00:00:00.000Z"),
    });
    const third = makeInsight({
      id: "i3",
      projectName: "Beta",
      time: new Date("2026-03-15T00:00:00.000Z"),
    });

    expect(buildInsightCompactionBucketKey(first)).toBe(
      "bot:bot-1:project:alpha:2026-03",
    );

    const groups = groupInsightsForCompaction([first, second, third], 2);
    expect(groups).toHaveLength(1);
    expect(groups[0].bucketKey).toBe("bot:bot-1:project:alpha:2026-03");
    expect(groups[0].insights.map((item) => item.id)).toEqual(["i1", "i2"]);
  });

  it("builds a full seed payload for the condensed insight", () => {
    const group = {
      bucketKey: "bot:bot-1:project:alpha:2026-03",
      botId: "bot-1",
      insights: [
        makeInsight({
          id: "i1",
          people: ["Alice"],
          topKeywords: ["alpha", "launch"],
        }),
        makeInsight({
          id: "i2",
          people: ["Bob"],
          topKeywords: ["launch", "retro"],
        }),
      ],
    };

    const seed = buildSeedCompactedInsightPayload(group);
    expect(seed.signalType).toBe("compaction_digest");
    expect(seed.title).toBe("Alpha digest");
    expect(seed.people).toEqual(["Alice", "Bob"]);
    expect(seed.topKeywords).toEqual(["alpha", "launch", "retro"]);
    expect(seed.dedupeKey).toBeTruthy();
  });

  it("merges model output over the seed while preserving missing fields", () => {
    const group = {
      bucketKey: "bot:bot-1:project:alpha:2026-03",
      botId: "bot-1",
      insights: [
        makeInsight({ id: "i1" }),
        makeInsight({ id: "i2", people: ["Bob"] }),
      ],
    };
    const seed = buildSeedCompactedInsightPayload(group);

    const merged = mergeCompactedInsightPayload(seed, {
      title: "Alpha weekly digest",
      description: "A tighter summary",
      executiveSummary: "Executive level summary",
      topKeywords: ["digest", "alpha"],
    });

    expect(merged.title).toBe("Alpha weekly digest");
    expect(merged.description).toBe("A tighter summary");
    expect(merged.executiveSummary).toBe("Executive level summary");
    expect(merged.people).toEqual(seed.people);
    expect(merged.signalType).toBe("compaction_digest");
  });

  it("uses LLM compactability scoring before grouping", async () => {
    const first = makeInsight({
      id: "i1",
      time: new Date("2026-03-01T00:00:00.000Z"),
    });
    const second = makeInsight({
      id: "i2",
      time: new Date("2026-03-05T00:00:00.000Z"),
    });
    const sourceRows = [{ insight: first }, { insight: second }];
    const userRows = [
      { id: "user-1", email: "teammate@example.com", name: "Teammate" },
    ];

    selectMock
      .mockImplementationOnce(() => makeSelectBuilder(sourceRows))
      .mockImplementationOnce(() => makeSelectBuilder(userRows));

    const preview = await previewInsightCompaction({
      userId: "user-1",
      minGroupSize: 1,
      insightIds: ["i1", "i2"],
      scoreCompactabilityWithLLM: async (insightItem) => ({
        score: insightItem.id === "i1" ? 0.82 : 0.22,
        shouldCompact: insightItem.id === "i1",
        reason: null,
      }),
    });

    expect(preview.candidates.map((item) => item.id)).toEqual(["i1"]);
    expect(preview.groups).toHaveLength(1);
    expect(preview.groups[0].insights.map((item) => item.id)).toEqual(["i1"]);
    expect(setAIUserContextMock).toHaveBeenCalledTimes(1);
    expect(clearAIUserContextMock).toHaveBeenCalledTimes(1);
  });

  it("archives older legacy pending-deletion insights", async () => {
    const selectRows = [{ id: "old-1" }, { id: "old-2" }];
    const updateWhereMock = vi.fn().mockResolvedValue(undefined);
    let updateSetValues: Record<string, unknown> | null = null;

    selectMock.mockImplementationOnce(() => ({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(selectRows),
        }),
      }),
    }));
    updateMock.mockReturnValue({
      set: vi.fn((values: Record<string, unknown>) => {
        updateSetValues = values;
        return {
          where: updateWhereMock,
        };
      }),
    });

    const archivedIds = await archiveLegacyPendingDeletionInsights({
      userId: "user-1",
      olderThanDays: 180,
    });

    expect(archivedIds).toEqual(["old-1", "old-2"]);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateSetValues).toMatchObject({
      isArchived: true,
      pendingDeletionAt: null,
    });
    const finalizedUpdate = updateSetValues as unknown as Record<
      string,
      unknown
    >;
    expect(finalizedUpdate.archivedAt).toBeInstanceOf(Date);
    expect(updateWhereMock).toHaveBeenCalledTimes(1);
  });

  it("runs the full compaction flow and archives source insights", async () => {
    const first = makeInsight({
      id: "i1",
      time: new Date("2026-03-01T00:00:00.000Z"),
    });
    const second = makeInsight({
      id: "i2",
      time: new Date("2026-03-12T00:00:00.000Z"),
    });
    const sourceRows = [{ insight: first }, { insight: second }];
    const userRows = [
      { id: "user-1", email: "teammate@example.com", name: "Teammate" },
    ];

    selectMock
      .mockImplementationOnce(() => makeSelectBuilder(sourceRows))
      .mockImplementationOnce(() => makeSelectBuilder(userRows))
      .mockImplementationOnce(() => makeSelectBuilder(userRows));
    const insertCalls: Array<{ values: unknown }> = [];
    let updateSetValues: Record<string, unknown> | null = null;
    let updateWhereArg: unknown = null;

    const tx = {
      insert: vi.fn(() => ({
        values: vi.fn((values: unknown) => {
          insertCalls.push({ values });
          if (insertCalls.length === 1) {
            return {
              returning: vi.fn().mockResolvedValue([{ id: "condensed-1" }]),
            };
          }
          return Promise.resolve();
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn((values: Record<string, unknown>) => {
          updateSetValues = values;
          return {
            where: vi.fn((whereArg: unknown) => {
              updateWhereArg = whereArg;
              return Promise.resolve();
            }),
          };
        }),
      })),
    };

    transactionMock.mockImplementation(async (callback) => await callback(tx));

    const result = await runInsightCompaction({
      userId: "user-1",
      insightIds: ["i1", "i2"],
      generateWithLLM: async (_group, seed) => ({
        title: "Alpha weekly digest",
        description: "Compressed summary",
        executiveSummary: "Condensed executive summary",
        topKeywords: ["alpha", "digest"],
        people: seed.people,
      }),
      scoreCompactabilityWithLLM: async () => ({
        score: 0.9,
        shouldCompact: true,
        reason: null,
      }),
    });

    expect(result).toEqual({
      candidateCount: 2,
      groupCount: 1,
      condensedInsightIds: ["condensed-1"],
      archivedInsightIds: ["i1", "i2"],
      dryRun: false,
    });

    expect(setAIUserContextMock).toHaveBeenCalledWith({
      id: "user-1",
      email: "teammate@example.com",
      name: "Teammate",
      type: "regular",
    });
    expect(clearAIUserContextMock).toHaveBeenCalledTimes(2);

    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0].values).toMatchObject({
      title: "Alpha weekly digest",
      description: "Compressed summary",
      signalType: "compaction_digest",
      pendingDeletionAt: null,
      compactedIntoInsightId: null,
    });

    expect(insertCalls[1].values).toEqual([
      expect.objectContaining({
        userId: "user-1",
        compactedInsightId: "condensed-1",
        sourceInsightId: "i1",
      }),
      expect.objectContaining({
        userId: "user-1",
        compactedInsightId: "condensed-1",
        sourceInsightId: "i2",
      }),
    ]);

    expect(updateSetValues).toMatchObject({
      compactedIntoInsightId: "condensed-1",
      pendingDeletionAt: null,
      isArchived: true,
    });
    expect(updateSetValues).not.toBeNull();
    const finalizedUpdate = updateSetValues as unknown as Record<
      string,
      unknown
    >;
    expect(finalizedUpdate.archivedAt).toBeInstanceOf(Date);
    expect(finalizedUpdate.updatedAt).toBeInstanceOf(Date);
    expect(updateWhereArg).toBeTruthy();
    expect(transactionMock).toHaveBeenCalledTimes(1);
  });
});
