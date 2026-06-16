const DEFAULT_RECENCY_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;

const IMPORTANCE_KEYWORDS = [
  "deadline",
  "todo",
  "urgent",
  "risk",
  "decision",
  "blocker",
  "meeting",
  "action item",
  "milestone",
  "bug",
  "incident",
  "follow up",
];

export type MemoryEvidenceTier = "short" | "mid" | "long";

export interface MemoryEvidenceRecord {
  id: string;
  userId: string;
  timestamp: number;
  text?: string;
  mediaRefs?: string[];
  tier: MemoryEvidenceTier;
  accessCount?: number;
  lastAccessAt?: number;
  importanceScore?: number;
  isPinned?: boolean;
  archivedAt?: number;
  dimensions?: Record<string, string | number | boolean | undefined>;
  metadata?: Record<string, unknown>;
}

export interface MemoryEvidenceRecordScorer {
  score(
    record: MemoryEvidenceRecord,
    context: {
      now: number;
    },
  ): number;
}

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
  records: MemoryEvidenceRecord[];
  now: number;
  getClusterKey(record: MemoryEvidenceRecord): string | undefined;
  scorer?: MemoryEvidenceRecordScorer;
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

function inferImportanceFromText(text: string | undefined): number {
  if (!text || text.trim().length === 0) {
    return 0;
  }

  const lower = text.toLowerCase();
  const hits = IMPORTANCE_KEYWORDS.filter((keyword) =>
    lower.includes(keyword),
  ).length;
  return clamp01(hits / 4);
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

export class DefaultMemoryEvidenceRecordScorer implements MemoryEvidenceRecordScorer {
  score(record: MemoryEvidenceRecord, context: { now: number }): number {
    const ageMs = Math.max(0, context.now - record.timestamp);
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const recencyScore = clamp01(1 - ageMs / (6 * thirtyDaysMs));
    const accessCount = record.accessCount ?? 0;
    const accessScore = clamp01(Math.log1p(accessCount) / Math.log(10));
    const providedImportance = record.importanceScore ?? 0;
    const inferredImportance = inferImportanceFromText(record.text);
    const importanceScore = clamp01(
      Math.max(providedImportance, inferredImportance),
    );
    const mediaScore =
      record.mediaRefs && record.mediaRefs.length > 0 ? 0.7 : 0.25;
    const pinnedBoost = record.isPinned ? 0.3 : 0;

    return clamp01(
      0.35 * recencyScore +
        0.3 * accessScore +
        0.25 * importanceScore +
        0.1 * mediaScore +
        pinnedBoost,
    );
  }
}

export function buildMemoryEvidenceClusters(
  input: BuildMemoryEvidenceClustersInput,
): MemoryEvidenceCluster[] {
  const scorer = input.scorer ?? new DefaultMemoryEvidenceRecordScorer();
  const evidenceNorm = Math.max(1, input.evidenceNorm ?? 4);
  const recencyWindowMs = Math.max(
    1,
    input.recencyWindowMs ?? DEFAULT_RECENCY_WINDOW_MS,
  );
  const weights = resolveWeights(input.weights);
  const grouped = new Map<string, MemoryEvidenceRecord[]>();

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
  const scorer = input.scorer ?? new DefaultMemoryEvidenceRecordScorer();
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
