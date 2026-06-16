import type { MemoryRecord, MemoryRecordScorer } from "./contracts";
import { DefaultMemoryRecordScorer } from "./scorer";

const DEFAULT_RECENCY_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;

export interface MemoryEvidenceClusterWeights {
  evidence: number;
  recordScore: number;
  activation: number;
  recency: number;
}

export interface MemoryEvidenceCluster {
  key: string;
  recordIds: string[];
  evidenceCount: number;
  meanRecordScore: number;
  activationScore: number;
  recencyScore: number;
  score: number;
}

export interface BuildMemoryEvidenceClustersInput {
  records: MemoryRecord[];
  now: number;
  getClusterKey(record: MemoryRecord): string | undefined;
  scorer?: MemoryRecordScorer;
  evidenceNorm?: number;
  recencyWindowMs?: number;
  weights?: Partial<MemoryEvidenceClusterWeights>;
}

export interface AnalyzeMemoryEvidenceClustersInput extends BuildMemoryEvidenceClustersInput {
  lowRecordScoreThreshold?: number;
  highClusterScoreThreshold?: number;
}

export interface MemoryEvidenceRecordSignal {
  recordId: string;
  clusterKey: string;
  recordScore: number;
  clusterScore: number;
  clusterEvidenceCount: number;
  lowRecordScoreHighClusterScore: boolean;
}

export interface MemoryEvidenceClusterAnalysis {
  clusters: MemoryEvidenceCluster[];
  recordSignals: MemoryEvidenceRecordSignal[];
}

const DEFAULT_WEIGHTS: MemoryEvidenceClusterWeights = {
  evidence: 0.45,
  recordScore: 0.2,
  activation: 0.15,
  recency: 0.1,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function resolveWeights(
  overrides: Partial<MemoryEvidenceClusterWeights> | undefined,
): MemoryEvidenceClusterWeights {
  return {
    evidence: overrides?.evidence ?? DEFAULT_WEIGHTS.evidence,
    recordScore: overrides?.recordScore ?? DEFAULT_WEIGHTS.recordScore,
    activation: overrides?.activation ?? DEFAULT_WEIGHTS.activation,
    recency: overrides?.recency ?? DEFAULT_WEIGHTS.recency,
  };
}

export function buildMemoryEvidenceClusters(
  input: BuildMemoryEvidenceClustersInput,
): MemoryEvidenceCluster[] {
  const scorer = input.scorer ?? new DefaultMemoryRecordScorer();
  const evidenceNorm = Math.max(1, input.evidenceNorm ?? 4);
  const recencyWindowMs = Math.max(
    1,
    input.recencyWindowMs ?? DEFAULT_RECENCY_WINDOW_MS,
  );
  const weights = resolveWeights(input.weights);
  const grouped = new Map<string, MemoryRecord[]>();

  for (const record of input.records) {
    const key = input.getClusterKey(record);
    if (!key) {
      continue;
    }

    const existing = grouped.get(key) ?? [];
    existing.push(record);
    grouped.set(key, existing);
  }

  return [...grouped.entries()]
    .map(([key, records]) => {
      const recordScores = records.map((record) =>
        scorer.score(record, { now: input.now }),
      );
      const accessCount = records.reduce(
        (sum, record) => sum + (record.accessCount ?? 0),
        0,
      );
      const latestTimestamp = Math.max(
        ...records.map((record) => record.timestamp),
      );
      const evidenceScore = clamp01(records.length / evidenceNorm);
      const meanRecordScore = mean(recordScores);
      const activationScore = clamp01(Math.log1p(accessCount) / Math.log(10));
      const recencyScore = clamp01(
        1 - Math.max(0, input.now - latestTimestamp) / recencyWindowMs,
      );

      return {
        key,
        recordIds: records.map((record) => record.id),
        evidenceCount: records.length,
        meanRecordScore,
        activationScore,
        recencyScore,
        score:
          weights.evidence * evidenceScore +
          weights.recordScore * meanRecordScore +
          weights.activation * activationScore +
          weights.recency * recencyScore,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function analyzeMemoryEvidenceClusters(
  input: AnalyzeMemoryEvidenceClustersInput,
): MemoryEvidenceClusterAnalysis {
  const scorer = input.scorer ?? new DefaultMemoryRecordScorer();
  const lowRecordScoreThreshold = input.lowRecordScoreThreshold ?? 0.35;
  const highClusterScoreThreshold = input.highClusterScoreThreshold ?? 0.65;
  const clusters = buildMemoryEvidenceClusters({
    ...input,
    scorer,
  });
  const clusterByKey = new Map(
    clusters.map((cluster) => [cluster.key, cluster]),
  );
  const recordSignals: MemoryEvidenceRecordSignal[] = [];

  for (const record of input.records) {
    const clusterKey = input.getClusterKey(record);
    if (!clusterKey) {
      continue;
    }

    const cluster = clusterByKey.get(clusterKey);
    if (!cluster) {
      continue;
    }

    const recordScore = scorer.score(record, { now: input.now });
    recordSignals.push({
      recordId: record.id,
      clusterKey,
      recordScore,
      clusterScore: cluster.score,
      clusterEvidenceCount: cluster.evidenceCount,
      lowRecordScoreHighClusterScore:
        recordScore <= lowRecordScoreThreshold &&
        cluster.score >= highClusterScoreThreshold,
    });
  }

  return {
    clusters,
    recordSignals,
  };
}
