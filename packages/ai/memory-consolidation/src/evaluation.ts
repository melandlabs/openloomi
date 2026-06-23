export type MemoryConsolidationEvalMetricTag =
  | "noise"
  | "temporary-override"
  | "adaptation"
  | "project-state"
  | "conflict"
  | "stale";

export interface MemoryConsolidationEvalScenarioResult {
  scenarioId: string;
  metricTags?: MemoryConsolidationEvalMetricTag[];
  expectedPreservedClusterKey?: string;
  preservedClusterKeys: string[];
  contestedClusterKeys?: string[];
  expectedContestedClusterKeys?: string[];
  decayedClusterKeys?: string[];
  expectedDecayedClusterKeys?: string[];
  noiseClusterKeys?: string[];
  temporaryClusterKeys?: string[];
}

export interface MemoryConsolidationEvalMetrics {
  scenarioCount: number;
  expectedCandidateAccuracy: number;
  noisePromotionRate: number;
  temporaryOverrideLeakageRate: number;
  adaptationAccuracy: number;
  projectStateAccuracy: number;
  contestedClusterCoverage: number;
  decayPrecisionProxy: number;
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function hasTag(
  result: MemoryConsolidationEvalScenarioResult,
  tag: MemoryConsolidationEvalMetricTag,
): boolean {
  return result.metricTags?.includes(tag) ?? false;
}

function containsAny(
  actual: string[],
  expected: string[] | undefined,
): boolean {
  return (expected ?? []).some((key) => actual.includes(key));
}

function containsAll(actual: string[], expected: string[] | undefined): number {
  if (!expected || expected.length === 0) {
    return 0;
  }

  return expected.every((key) => actual.includes(key)) ? 1 : 0;
}

function expectedPreserved(
  result: MemoryConsolidationEvalScenarioResult,
): number {
  return result.expectedPreservedClusterKey &&
    result.preservedClusterKeys.includes(result.expectedPreservedClusterKey)
    ? 1
    : 0;
}

function promotionRate(
  results: MemoryConsolidationEvalScenarioResult[],
  keySelector: (
    result: MemoryConsolidationEvalScenarioResult,
  ) => string[] | undefined,
): number {
  return mean(
    results.map((result) =>
      containsAny(result.preservedClusterKeys, keySelector(result)) ? 1 : 0,
    ),
  );
}

function decayPrecision(result: MemoryConsolidationEvalScenarioResult): number {
  const decayed = result.decayedClusterKeys ?? [];
  const expected = result.expectedDecayedClusterKeys ?? [];

  if (decayed.length === 0) {
    return expected.length === 0 ? 1 : 0;
  }

  const expectedSet = new Set(expected);
  return decayed.filter((key) => expectedSet.has(key)).length / decayed.length;
}

export function calculateMemoryConsolidationEvalMetrics(
  results: MemoryConsolidationEvalScenarioResult[],
): MemoryConsolidationEvalMetrics {
  const expectedCandidateResults = results.filter(
    (result) => result.expectedPreservedClusterKey !== undefined,
  );
  const noiseResults = results.filter((result) => hasTag(result, "noise"));
  const temporaryOverrideResults = results.filter((result) =>
    hasTag(result, "temporary-override"),
  );
  const adaptationResults = results.filter((result) =>
    hasTag(result, "adaptation"),
  );
  const projectStateResults = results.filter((result) =>
    hasTag(result, "project-state"),
  );
  const contestedResults = results.filter(
    (result) => (result.expectedContestedClusterKeys?.length ?? 0) > 0,
  );
  const decayResults = results.filter(
    (result) =>
      (result.decayedClusterKeys?.length ?? 0) > 0 ||
      (result.expectedDecayedClusterKeys?.length ?? 0) > 0,
  );

  return {
    scenarioCount: results.length,
    expectedCandidateAccuracy: mean(
      expectedCandidateResults.map(expectedPreserved),
    ),
    noisePromotionRate: promotionRate(
      noiseResults,
      (result) => result.noiseClusterKeys,
    ),
    temporaryOverrideLeakageRate: promotionRate(
      temporaryOverrideResults,
      (result) => result.temporaryClusterKeys,
    ),
    adaptationAccuracy: mean(adaptationResults.map(expectedPreserved)),
    projectStateAccuracy: mean(projectStateResults.map(expectedPreserved)),
    contestedClusterCoverage: mean(
      contestedResults.map((result) =>
        containsAll(
          result.contestedClusterKeys ?? [],
          result.expectedContestedClusterKeys,
        ),
      ),
    ),
    decayPrecisionProxy: mean(decayResults.map(decayPrecision)),
  };
}
