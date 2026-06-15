import { describe, expect, it } from "vitest";
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
  traces: EvalTrace[];
};

type ClusterScore = {
  topic: string;
  score: number;
  evidenceCount: number;
  traceIds: string[];
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function traceToRecord(trace: EvalTrace): MemoryRecord {
  return {
    id: trace.id,
    userId: "eval-user",
    timestamp: trace.day * DAY_MS,
    text: trace.text,
    tier: "short",
    accessCount: trace.accessCount,
    importanceScore: trace.importanceScore,
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
  const scorer = new DefaultMemoryRecordScorer();
  const clusters = new Map<string, EvalTrace[]>();

  for (const trace of scenario.traces) {
    const existing = clusters.get(trace.topic) ?? [];
    existing.push(trace);
    clusters.set(trace.topic, existing);
  }

  return [...clusters.entries()]
    .map(([topic, traces]) => {
      const evidenceScore = clamp01(traces.length / 4);
      const traceScores = traces.map((trace) =>
        scorer.score(traceToRecord(trace), { now: NOW }),
      );
      const meanTraceScore =
        traceScores.reduce((sum, score) => sum + score, 0) / traceScores.length;
      const accessCount = traces.reduce(
        (sum, trace) => sum + (trace.accessCount ?? 0),
        0,
      );
      const activationScore = clamp01(Math.log1p(accessCount) / Math.log(10));
      const latestDay = Math.max(...traces.map((trace) => trace.day));
      const recencyScore = clamp01(
        1 - (NOW - latestDay * DAY_MS) / (180 * DAY_MS),
      );

      return {
        topic,
        evidenceCount: traces.length,
        traceIds: traces.map((trace) => trace.id),
        score:
          0.45 * evidenceScore +
          0.2 * meanTraceScore +
          0.15 * activationScore +
          0.1 * recencyScore,
      };
    })
    .sort((a, b) => b.score - a.score);
}

function evaluateScenario(scenario: EvalScenario) {
  const singleTraceTop = rankSingleTraces(scenario)[0];
  const clusterScores = scoreClusters(scenario);
  const clusterTop = clusterScores[0];

  return {
    scenarioId: scenario.id,
    expectedLongTermTopic: scenario.expectedLongTermTopic,
    singleTraceTopTopic: singleTraceTop?.topic,
    clusterTopTopic: clusterTop?.topic,
    clusterScores,
  };
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

  it("scores the expected topic highest for every scenario", () => {
    for (const scenario of scenarios) {
      const result = evaluateScenario(scenario);

      expect(result.clusterTopTopic).toBe(scenario.expectedLongTermTopic);
    }
  });
});
