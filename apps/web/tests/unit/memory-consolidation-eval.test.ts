import { describe, expect, it } from "vitest";
import {
  analyzeMemoryEvidenceClusters,
  assignMemoryRelationGraph,
  buildMemoryConsolidationPlan,
  buildMemoryEvidenceClusters,
  deriveMemoryRelationGraphLifecycle,
} from "@openloomi/memory-consolidation";
import {
  DefaultMemoryRecordScorer,
  type MemoryRecord,
} from "../../../../packages/ai/src/memory";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 120 * DAY_MS;

type EvalTrace = {
  id: string;
  topic: string;
  text: string;
  day: number;
  accessCount?: number;
  importanceScore?: number;
};

type EvalScenario = {
  id: string;
  description: string;
  expectedLongTermTopic: string;
  metricTags: Array<"noise" | "temporary-override" | "adaptation">;
  traces: EvalTrace[];
};

type ClusterScore = {
  topic: string;
  score: number;
  evidenceCount: number;
  traceIds: string[];
};

type ScenarioEvaluation = {
  scenarioId: string;
  expectedLongTermTopic: string;
  metricTags: EvalScenario["metricTags"];
  singleTraceTopTopic: string | undefined;
  clusterTopTopic: string | undefined;
  clusterScores: ClusterScore[];
};

type ConsolidationEvalMetrics = {
  scenarioCount: number;
  singleTraceExpectedTopicAccuracy: number;
  clusterExpectedTopicAccuracy: number;
  singleTraceNoiseTopRankRate: number;
  clusterNoiseTopRankRate: number;
  clusterTemporaryOverrideLeakageRate: number;
  clusterAdaptationAccuracy: number;
};

function trace(
  id: string,
  topic: string,
  text: string,
  day: number,
  options: Pick<EvalTrace, "accessCount" | "importanceScore"> = {},
): EvalTrace {
  return { id, topic, text, day, ...options };
}

function traceSeries(
  prefix: string,
  topic: string,
  text: string,
  days: number[],
  accessCounts: number[],
): EvalTrace[] {
  return days.map((day, index) =>
    trace(`${prefix}-${index + 1}`, topic, text, day, {
      accessCount: accessCounts[index] ?? 1,
    }),
  );
}

const scenarios: EvalScenario[] = [
  {
    id: "one-shot-noise",
    description:
      "Repeated quiet preference traces should compete with a single noisy but highly activated trace.",
    expectedLongTermTopic: "answer-language:zh",
    metricTags: ["noise"],
    traces: [
      ...traceSeries(
        "zh",
        "answer-language:zh",
        "Prefer Chinese explanations for technical repo work.",
        [3, 5, 7, 9],
        [1, 1, 1, 1],
      ),
      trace(
        "noise-urgent",
        "one-shot:noise",
        "urgent todo blocker deadline random scratch note",
        119,
        { accessCount: 8, importanceScore: 0.9 },
      ),
    ],
  },
  {
    id: "temporary-override",
    description:
      "A recent one-off instruction should be separable from a long-term preference.",
    expectedLongTermTopic: "answer-language:zh",
    metricTags: ["temporary-override"],
    traces: [
      ...traceSeries(
        "pref-zh",
        "answer-language:zh",
        "Use Chinese by default for project explanations.",
        [55, 64, 73, 82],
        [1, 2, 1, 1],
      ),
      trace(
        "override-en",
        "answer-language:en",
        "For this one reply, use English.",
        119,
        { accessCount: 5, importanceScore: 0.6 },
      ),
    ],
  },
  {
    id: "preference-adaptation",
    description:
      "Repeated recent evidence should be able to beat older stable evidence when a preference changes.",
    expectedLongTermTopic: "answer-language:en",
    metricTags: ["adaptation"],
    traces: [
      ...traceSeries(
        "old-zh",
        "answer-language:zh",
        "Use Chinese for repo work.",
        [5, 8, 12],
        [2, 1, 1],
      ),
      ...traceSeries(
        "new-en",
        "answer-language:en",
        "Use English-first responses for this workspace.",
        [90, 101, 112, 119],
        [1, 1, 2, 2],
      ),
    ],
  },
];

function traceToRecord(trace: EvalTrace): MemoryRecord {
  return {
    id: trace.id,
    userId: "eval-user",
    timestamp: trace.day * DAY_MS,
    text: trace.text,
    tier: "short",
    accessCount: trace.accessCount,
    importanceScore: trace.importanceScore,
    metadata: {
      topic: trace.topic,
    },
  };
}

function rankSingleTraces(scenario: EvalScenario): EvalTrace[] {
  const scorer = new DefaultMemoryRecordScorer();
  return [...scenario.traces].sort(
    (a, b) =>
      scorer.score(traceToRecord(b), { now: NOW }) -
      scorer.score(traceToRecord(a), { now: NOW }),
  );
}

function scoreClusters(scenario: EvalScenario): ClusterScore[] {
  return buildMemoryEvidenceClusters({
    records: scenario.traces.map(traceToRecord),
    now: NOW,
    getClusterKey: (record) => String(record.metadata?.topic ?? ""),
  }).map((cluster) => ({
    topic: cluster.key,
    score: cluster.score,
    evidenceCount: cluster.evidenceCount,
    traceIds: cluster.recordIds,
  }));
}

function evaluateScenario(scenario: EvalScenario): ScenarioEvaluation {
  const singleTraceTop = rankSingleTraces(scenario)[0];
  const clusterScores = scoreClusters(scenario);
  const clusterTop = clusterScores[0];

  return {
    scenarioId: scenario.id,
    expectedLongTermTopic: scenario.expectedLongTermTopic,
    metricTags: scenario.metricTags,
    singleTraceTopTopic: singleTraceTop?.topic,
    clusterTopTopic: clusterTop?.topic,
    clusterScores,
  };
}

function hasTag(
  result: ScenarioEvaluation,
  tag: EvalScenario["metricTags"][number],
): boolean {
  return result.metricTags.includes(tag);
}

function mean(values: boolean[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.filter(Boolean).length / values.length;
}

function isNoiseTopic(topic: string | undefined): boolean {
  return topic?.startsWith("one-shot:") ?? false;
}

function calculateConsolidationMetrics(
  results: ScenarioEvaluation[],
): ConsolidationEvalMetrics {
  const noiseResults = results.filter((result) => hasTag(result, "noise"));
  const temporaryOverrideResults = results.filter((result) =>
    hasTag(result, "temporary-override"),
  );
  const adaptationResults = results.filter((result) =>
    hasTag(result, "adaptation"),
  );

  return {
    scenarioCount: results.length,
    singleTraceExpectedTopicAccuracy: mean(
      results.map(
        (result) => result.singleTraceTopTopic === result.expectedLongTermTopic,
      ),
    ),
    clusterExpectedTopicAccuracy: mean(
      results.map(
        (result) => result.clusterTopTopic === result.expectedLongTermTopic,
      ),
    ),
    singleTraceNoiseTopRankRate: mean(
      noiseResults.map((result) => isNoiseTopic(result.singleTraceTopTopic)),
    ),
    clusterNoiseTopRankRate: mean(
      noiseResults.map((result) => isNoiseTopic(result.clusterTopTopic)),
    ),
    clusterTemporaryOverrideLeakageRate: mean(
      temporaryOverrideResults.map(
        (result) => result.clusterTopTopic !== result.expectedLongTermTopic,
      ),
    ),
    clusterAdaptationAccuracy: mean(
      adaptationResults.map(
        (result) => result.clusterTopTopic === result.expectedLongTermTopic,
      ),
    ),
  };
}

function analyzeScenario(scenario: EvalScenario) {
  return analyzeMemoryEvidenceClusters({
    records: scenario.traces.map(traceToRecord),
    now: NOW,
    getClusterKey: (record) => String(record.metadata?.topic ?? ""),
    highClusterScoreThreshold: 0.6,
  });
}

function getCompetitionKey(clusterKey: string): string {
  if (clusterKey.startsWith("answer-language:")) {
    return "answer-language";
  }
  return clusterKey;
}

function planScenario(scenario: EvalScenario) {
  return buildMemoryConsolidationPlan({
    records: scenario.traces.map(traceToRecord),
    now: NOW,
    getClusterKey: (record) => String(record.metadata?.topic ?? ""),
    getCompetitionKey: (cluster) => getCompetitionKey(cluster.key),
  });
}

function findPlanEntry(
  plan: ReturnType<typeof planScenario>,
  clusterKey: string,
) {
  const entry = plan.entries.find((item) => item.clusterKey === clusterKey);
  if (!entry) {
    throw new Error(`Missing consolidation plan entry for ${clusterKey}`);
  }
  return entry;
}

function buildRelationGraphFixture() {
  const records = [
    trace("zh-a", "graph-input", "Use Chinese for repo work.", 20, {
      accessCount: 1,
    }),
    trace("zh-b", "graph-input", "Prefer Chinese technical explanations.", 30, {
      accessCount: 1,
    }),
    trace(
      "zh-c",
      "graph-input",
      "Code explanations are easier in Chinese.",
      40,
      {
        accessCount: 1,
      },
    ),
    trace(
      "en-a",
      "graph-input",
      "Use English-first answers for this workspace.",
      100,
      {
        accessCount: 2,
      },
    ),
    trace(
      "en-b",
      "graph-input",
      "Default to English for technical discussions.",
      110,
      {
        accessCount: 2,
      },
    ),
    trace(
      "en-c",
      "graph-input",
      "English is now preferred for repo work.",
      118,
      {
        accessCount: 2,
      },
    ),
    trace(
      "en-d",
      "graph-input",
      "Please keep future technical answers in English.",
      119,
      {
        accessCount: 2,
      },
    ),
    trace("temp-en", "graph-input", "For this one reply, use English.", 119),
    trace("noise", "graph-input", "random scratch note", 119),
  ].map(traceToRecord);

  const assignment = assignMemoryRelationGraph({
    records,
    nodes: records.map((record) => ({
      id: `trace:${record.id}`,
      recordId: record.id,
      timestamp: record.timestamp,
      activationCount: record.accessCount,
      lastActivatedAt: record.lastAccessAt,
    })),
    now: NOW,
    thresholds: {
      relationDecayHalfLifeMs: 30 * DAY_MS,
    },
    relations: [
      {
        fromRecordId: "zh-a",
        toRecordId: "zh-b",
        relation: "support",
        weight: 0.62,
        evidenceCount: 2,
        activationCount: 1,
        lastActivatedAt: NOW,
      },
      {
        fromRecordId: "zh-b",
        toRecordId: "zh-c",
        relation: "support",
        weight: 0.78,
      },
      {
        fromRecordId: "en-a",
        toRecordId: "en-b",
        relation: "support",
        weight: 0.78,
      },
      {
        fromRecordId: "en-b",
        toRecordId: "en-c",
        relation: "support",
        weight: 0.8,
      },
      {
        fromRecordId: "en-c",
        toRecordId: "en-d",
        relation: "support",
        weight: 0.82,
      },
      {
        fromRecordId: "temp-en",
        toRecordId: "en-a",
        relation: "support",
        weight: 0.95,
        lastActivatedAt: 10 * DAY_MS,
      },
      {
        fromRecordId: "zh-a",
        toRecordId: "en-a",
        relation: "compete",
        weight: 0.82,
      },
      {
        fromRecordId: "zh-c",
        toRecordId: "en-d",
        relation: "compete",
        weight: 0.74,
      },
      {
        fromRecordId: "temp-en",
        toRecordId: "en-a",
        relation: "related",
        weight: 0.9,
      },
      {
        fromRecordId: "temp-en",
        toRecordId: "missing-record",
        relation: "related",
        weight: 0.9,
      },
    ],
  });
  const plan = buildMemoryConsolidationPlan({
    records,
    now: NOW,
    getClusterKey: assignment.getClusterKey,
    getCompetitionKey: assignment.getCompetitionKey,
    thresholds: {
      preserveScore: 0.5,
      preserveEvidence: 3,
      competitionMargin: 0.05,
    },
  });
  const lifecycle = deriveMemoryRelationGraphLifecycle({
    assignment,
    consolidatedClusterKeys: plan.actions.preserve.map(
      (entry) => entry.clusterKey,
    ),
  });

  return {
    records,
    assignment,
    plan,
    lifecycle,
    zhClusterKey: assignment.recordClusterKeys["zh-a"],
    enClusterKey: assignment.recordClusterKeys["en-a"],
    tempClusterKey: assignment.recordClusterKeys["temp-en"],
    noiseClusterKey: assignment.recordClusterKeys.noise,
  };
}

function findGraphCluster(
  assignment: ReturnType<typeof buildRelationGraphFixture>["assignment"],
  clusterId: string,
) {
  const cluster = assignment.clusters.find(
    (item) => item.clusterId === clusterId,
  );
  if (!cluster) {
    throw new Error(`Missing graph cluster ${clusterId}`);
  }
  return cluster;
}

describe("memory consolidation evaluation scenarios", () => {
  it("keeps expected long-term outcomes backed by repeated evidence", () => {
    for (const scenario of scenarios) {
      const expectedEvidence = scenario.traces.filter(
        (trace) => trace.topic === scenario.expectedLongTermTopic,
      );

      expect(expectedEvidence.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("captures measurable differences between trace and cluster ranking", () => {
    const results = scenarios.map(evaluateScenario);

    expect(results).toEqual([
      expect.objectContaining({
        scenarioId: "one-shot-noise",
        singleTraceTopTopic: "one-shot:noise",
        clusterTopTopic: "answer-language:zh",
      }),
      expect.objectContaining({
        scenarioId: "temporary-override",
        singleTraceTopTopic: "answer-language:en",
        clusterTopTopic: "answer-language:zh",
      }),
      expect.objectContaining({
        scenarioId: "preference-adaptation",
        clusterTopTopic: "answer-language:en",
      }),
    ]);
  });

  it("reports consolidation metrics for the scenario suite", () => {
    const results = scenarios.map(evaluateScenario);
    const metrics = calculateConsolidationMetrics(results);

    expect(metrics).toEqual({
      scenarioCount: 3,
      singleTraceExpectedTopicAccuracy: 1 / 3,
      clusterExpectedTopicAccuracy: 1,
      singleTraceNoiseTopRankRate: 1,
      clusterNoiseTopRankRate: 0,
      clusterTemporaryOverrideLeakageRate: 0,
      clusterAdaptationAccuracy: 1,
    });
  });

  it("surfaces low-record-score traces that belong to high-evidence clusters", () => {
    const scenario = scenarios.find(
      (item) => item.id === "one-shot-noise",
    ) as EvalScenario;
    const analysis = analyzeScenario(scenario);
    const flaggedRecordIds = analysis.recordSignals
      .filter((signal) => signal.lowRecordScoreHighClusterScore)
      .map((signal) => signal.recordId);

    expect(flaggedRecordIds).toEqual(["zh-1", "zh-2", "zh-3", "zh-4"]);
    expect(flaggedRecordIds).not.toContain("noise-urgent");
    expect(analysis.clusters[0]?.key).toBe("answer-language:zh");
  });

  it("builds an explainable consolidation plan from cluster competition", () => {
    const noisePlan = planScenario(
      scenarios.find((item) => item.id === "one-shot-noise") as EvalScenario,
    );
    const overridePlan = planScenario(
      scenarios.find(
        (item) => item.id === "temporary-override",
      ) as EvalScenario,
    );
    const adaptationPlan = planScenario(
      scenarios.find(
        (item) => item.id === "preference-adaptation",
      ) as EvalScenario,
    );

    expect(findPlanEntry(noisePlan, "answer-language:zh")).toEqual(
      expect.objectContaining({
        action: "preserve",
        winningClusterKey: "answer-language:zh",
        reasonCodes: ["strong_repeated_evidence"],
      }),
    );
    expect(findPlanEntry(noisePlan, "one-shot:noise")).toEqual(
      expect.objectContaining({
        action: "decay",
        reasonCodes: ["isolated_low_confidence"],
      }),
    );
    expect(findPlanEntry(overridePlan, "answer-language:en")).toEqual(
      expect.objectContaining({
        action: "decay",
        winningClusterKey: "answer-language:zh",
        reasonCodes: ["outscored_by_competitor", "isolated_low_confidence"],
      }),
    );
    expect(findPlanEntry(adaptationPlan, "answer-language:en")).toEqual(
      expect.objectContaining({
        action: "preserve",
        winningClusterKey: "answer-language:en",
        reasonCodes: ["strong_repeated_evidence", "wins_competition"],
      }),
    );
    expect(findPlanEntry(adaptationPlan, "answer-language:zh").action).not.toBe(
      "preserve",
    );
  });

  it("forms graph clusters from reinforced support edges", () => {
    const { assignment, zhClusterKey, enClusterKey } =
      buildRelationGraphFixture();
    const zhCluster = findGraphCluster(assignment, zhClusterKey);
    const enCluster = findGraphCluster(assignment, enClusterKey);

    expect(assignment.nodes.map((node) => node.id)).toContain("trace:zh-a");
    expect(assignment.recordClusterKeys["zh-b"]).toBe(zhClusterKey);
    expect(assignment.recordClusterKeys["zh-c"]).toBe(zhClusterKey);
    expect(assignment.recordClusterKeys["en-b"]).toBe(enClusterKey);
    expect(assignment.recordClusterKeys["en-c"]).toBe(enClusterKey);
    expect(assignment.recordClusterKeys["en-d"]).toBe(enClusterKey);
    expect(zhCluster.supportEdgeIds).toEqual([
      "zh-a:support:zh-b",
      "zh-b:support:zh-c",
    ]);
    expect(enCluster.supportEdgeIds).toEqual([
      "en-a:support:en-b",
      "en-b:support:en-c",
      "en-c:support:en-d",
    ]);
  });

  it("generates stable graph keys without delimiter collisions", () => {
    const relationRecords = ["a+b", "c", "a", "b+c"].map((id) =>
      trace(id, "graph-input", id, 119),
    );
    const leftAssignment = assignMemoryRelationGraph({
      records: [relationRecords[0], relationRecords[1]].map(traceToRecord),
      now: NOW,
      relations: [
        {
          fromRecordId: "a+b",
          toRecordId: "c",
          relation: "support",
          weight: 0.9,
        },
      ],
    });
    const reversedLeftAssignment = assignMemoryRelationGraph({
      records: [relationRecords[1], relationRecords[0]].map(traceToRecord),
      now: NOW,
      relations: [
        {
          fromRecordId: "c",
          toRecordId: "a+b",
          relation: "support",
          weight: 0.9,
        },
      ],
    });
    const rightAssignment = assignMemoryRelationGraph({
      records: [relationRecords[2], relationRecords[3]].map(traceToRecord),
      now: NOW,
      relations: [
        {
          fromRecordId: "a",
          toRecordId: "b+c",
          relation: "support",
          weight: 0.9,
        },
      ],
    });

    expect(leftAssignment.recordClusterKeys["a+b"]).toBe(
      reversedLeftAssignment.recordClusterKeys["a+b"],
    );
    expect(leftAssignment.recordClusterKeys["a+b"]).not.toBe(
      rightAssignment.recordClusterKeys.a,
    );

    const competitionRecords = ["left+a", "left-b", "right+a", "right-b"].map(
      (id) => trace(id, "graph-input", id, 119),
    );
    const relations = [
      {
        fromRecordId: "left+a",
        toRecordId: "left-b",
        relation: "support" as const,
        weight: 0.9,
      },
      {
        fromRecordId: "right+a",
        toRecordId: "right-b",
        relation: "support" as const,
        weight: 0.9,
      },
      {
        fromRecordId: "left+a",
        toRecordId: "right+a",
        relation: "compete" as const,
        weight: 0.9,
      },
    ];
    const competitionAssignment = assignMemoryRelationGraph({
      records: competitionRecords.map(traceToRecord),
      now: NOW,
      relations,
    });
    const reversedCompetitionAssignment = assignMemoryRelationGraph({
      records: [...competitionRecords].reverse().map(traceToRecord),
      now: NOW,
      relations,
    });

    expect(
      competitionAssignment.getCompetitionKey({
        key: competitionAssignment.recordClusterKeys["left+a"],
      }),
    ).toBe(
      reversedCompetitionAssignment.getCompetitionKey({
        key: reversedCompetitionAssignment.recordClusterKeys["left+a"],
      }),
    );
  });

  it("keeps weak related traces separate from stable support clusters", () => {
    const { assignment, enClusterKey, tempClusterKey } =
      buildRelationGraphFixture();
    const enCluster = findGraphCluster(assignment, enClusterKey);
    const tempCluster = findGraphCluster(assignment, tempClusterKey);

    expect(tempClusterKey).not.toBe(enClusterKey);
    expect(
      assignment.edges.find((edge) => edge.id === "temp-en:support:en-a")
        ?.effectiveWeight,
    ).toBeLessThan(0.7);
    expect(tempCluster.status).toBe("tentative");
    expect(tempCluster.relatedEdgeIds).toEqual(["temp-en:related:en-a"]);
    expect(enCluster.relatedEdgeIds).toEqual(["temp-en:related:en-a"]);
  });

  it("lets recent repeated evidence compete with and replace an older stable cluster", () => {
    const { assignment, plan, lifecycle, zhClusterKey, enClusterKey } =
      buildRelationGraphFixture();
    const enLifecycle = lifecycle.find(
      (entry) => entry.clusterId === enClusterKey,
    );
    const zhLifecycle = lifecycle.find(
      (entry) => entry.clusterId === zhClusterKey,
    );

    expect(assignment.getCompetitionKey({ key: zhClusterKey })).toBe(
      assignment.getCompetitionKey({ key: enClusterKey }),
    );
    expect(findGraphCluster(assignment, zhClusterKey).status).toBe("contested");
    expect(findGraphCluster(assignment, enClusterKey).status).toBe("contested");
    expect(findPlanEntry(plan, enClusterKey)).toEqual(
      expect.objectContaining({
        action: "preserve",
        competitionKey: assignment.getCompetitionKey({ key: enClusterKey }),
        reasonCodes: ["strong_repeated_evidence", "wins_competition"],
      }),
    );
    expect(findPlanEntry(plan, zhClusterKey).action).not.toBe("preserve");
    expect(enLifecycle).toEqual(
      expect.objectContaining({
        graphStatus: "contested",
        status: "consolidated",
        consolidated: true,
      }),
    );
    expect(zhLifecycle).toEqual(
      expect.objectContaining({
        graphStatus: "contested",
        status: "contested",
        consolidated: false,
      }),
    );
  });

  it("keeps isolated noise as a tentative micro-cluster that decays in the plan", () => {
    const { assignment, plan, noiseClusterKey } = buildRelationGraphFixture();
    const noiseCluster = findGraphCluster(assignment, noiseClusterKey);

    expect(noiseCluster.recordIds).toEqual(["noise"]);
    expect(noiseCluster.supportEdgeIds).toEqual([]);
    expect(noiseCluster.status).toBe("tentative");
    expect(findPlanEntry(plan, noiseClusterKey)).toEqual(
      expect.objectContaining({
        action: "decay",
        reasonCodes: ["isolated_low_confidence"],
      }),
    );
  });
});
