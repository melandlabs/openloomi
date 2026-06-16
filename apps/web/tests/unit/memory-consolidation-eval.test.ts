import { describe, expect, it } from "vitest";
import {
  analyzeMemoryEvidenceClusters,
  buildMemoryEvidenceClusters,
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
});
