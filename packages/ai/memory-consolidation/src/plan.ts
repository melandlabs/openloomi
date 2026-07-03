import {
  buildMemoryEvidenceClusters,
  type BuildMemoryEvidenceClustersInput,
  type MemoryEvidenceCluster,
} from "./evidence-cluster";

export type MemoryConsolidationAction =
  | "preserve"
  | "observe"
  | "decay"
  | "deprecate";

export type MemoryConsolidationReasonCode =
  | "strong_repeated_evidence"
  | "wins_competition"
  | "outscored_by_competitor"
  | "ambiguous_competition"
  | "isolated_low_confidence"
  | "insufficient_signal"
  | "superseded_by_summary";

export interface MemoryConsolidationPlanThresholds {
  preserveScore: number;
  preserveEvidence: number;
  decayScore: number;
  decayEvidence: number;
  competitionMargin: number;
}

export interface BuildMemoryConsolidationPlanInput extends BuildMemoryEvidenceClustersInput {
  getCompetitionKey?(cluster: MemoryEvidenceCluster): string | undefined;
  thresholds?: Partial<MemoryConsolidationPlanThresholds>;
}

export interface MemoryConsolidationPlanEntry {
  clusterKey: string;
  competitionKey: string;
  action: MemoryConsolidationAction;
  score: number;
  evidenceCount: number;
  recordIds: string[];
  rankInCompetition: number;
  winningClusterKey: string;
  competingClusterKeys: string[];
  scoreMargin: number;
  reasonCodes: MemoryConsolidationReasonCode[];
  explanation: string;
  /**
   * When `action === "deprecate"`, the id of the memory summary that
   * supersedes these records. Callers should write this through
   * `MemoryStorageAdapter.deprecateRecords` so the soft-hide chain stays
   * consistent.
   */
  supersededBySummaryId?: string;
  /**
   * Optional short tag forwarded as `deprecationReason` (defaults to
   * `"superseded_by_summary:<id>"` when `supersededBySummaryId` is set).
   */
  deprecationReason?: string;
}

export interface MemoryConsolidationPlan {
  clusters: MemoryEvidenceCluster[];
  entries: MemoryConsolidationPlanEntry[];
  actions: Record<MemoryConsolidationAction, MemoryConsolidationPlanEntry[]>;
}

const DEFAULT_THRESHOLDS: MemoryConsolidationPlanThresholds = {
  preserveScore: 0.6,
  preserveEvidence: 3,
  decayScore: 0.55,
  decayEvidence: 1,
  competitionMargin: 0.12,
};

function resolveThresholds(
  thresholds: Partial<MemoryConsolidationPlanThresholds> | undefined,
): MemoryConsolidationPlanThresholds {
  return {
    preserveScore:
      thresholds?.preserveScore ?? DEFAULT_THRESHOLDS.preserveScore,
    preserveEvidence:
      thresholds?.preserveEvidence ?? DEFAULT_THRESHOLDS.preserveEvidence,
    decayScore: thresholds?.decayScore ?? DEFAULT_THRESHOLDS.decayScore,
    decayEvidence:
      thresholds?.decayEvidence ?? DEFAULT_THRESHOLDS.decayEvidence,
    competitionMargin:
      thresholds?.competitionMargin ?? DEFAULT_THRESHOLDS.competitionMargin,
  };
}

function groupByCompetition(
  clusters: MemoryEvidenceCluster[],
  getCompetitionKey:
    | ((cluster: MemoryEvidenceCluster) => string | undefined)
    | undefined,
): Map<string, MemoryEvidenceCluster[]> {
  const grouped = new Map<string, MemoryEvidenceCluster[]>();

  for (const cluster of clusters) {
    const competitionKey = getCompetitionKey?.(cluster) ?? cluster.key;
    const existing = grouped.get(competitionKey) ?? [];
    existing.push(cluster);
    grouped.set(competitionKey, existing);
  }

  return grouped;
}

function getBestOtherCluster(
  cluster: MemoryEvidenceCluster,
  ranked: MemoryEvidenceCluster[],
): MemoryEvidenceCluster | undefined {
  return ranked.find((candidate) => candidate.key !== cluster.key);
}

function explain(
  action: MemoryConsolidationAction,
  reasonCodes: MemoryConsolidationReasonCode[],
): string {
  if (action === "preserve" && reasonCodes.includes("wins_competition")) {
    return "Repeated evidence is strong enough and wins its competition group.";
  }
  if (action === "preserve") {
    return "Repeated evidence is strong enough to preserve as a consolidation candidate.";
  }
  if (reasonCodes.includes("outscored_by_competitor")) {
    return action === "decay"
      ? "Weak competing evidence is outscored by a stronger repeated cluster."
      : "The cluster is outscored by a stronger competitor, but still has enough evidence to observe.";
  }
  if (reasonCodes.includes("ambiguous_competition")) {
    return "Cluster competition is too close for a consolidation decision.";
  }
  if (reasonCodes.includes("isolated_low_confidence")) {
    return "Single or weak evidence has not been reactivated enough for consolidation.";
  }
  return "The cluster does not meet preserve or decay thresholds yet.";
}

function decideCluster(
  cluster: MemoryEvidenceCluster,
  ranked: MemoryEvidenceCluster[],
  thresholds: MemoryConsolidationPlanThresholds,
): Pick<
  MemoryConsolidationPlanEntry,
  "action" | "scoreMargin" | "reasonCodes" | "winningClusterKey"
> {
  const winner = ranked[0] ?? cluster;
  const bestOther = getBestOtherCluster(cluster, ranked);
  const isWinner = winner.key === cluster.key;
  const scoreMargin = bestOther
    ? cluster.score - bestOther.score
    : cluster.score;
  const isRepeated = cluster.evidenceCount >= thresholds.preserveEvidence;
  const isStrong = cluster.score >= thresholds.preserveScore;
  const hasClearMargin =
    !bestOther || scoreMargin >= thresholds.competitionMargin;
  const isWeakIsolated =
    cluster.evidenceCount <= thresholds.decayEvidence &&
    cluster.score <= thresholds.decayScore;
  const isClearlyOutscored =
    bestOther !== undefined &&
    !isWinner &&
    scoreMargin <= -thresholds.competitionMargin;

  if (isWinner && isRepeated && isStrong && hasClearMargin) {
    return {
      action: "preserve",
      scoreMargin,
      winningClusterKey: winner.key,
      reasonCodes: bestOther
        ? ["strong_repeated_evidence", "wins_competition"]
        : ["strong_repeated_evidence"],
    };
  }

  if (isClearlyOutscored && cluster.evidenceCount <= thresholds.decayEvidence) {
    return {
      action: "decay",
      scoreMargin,
      winningClusterKey: winner.key,
      reasonCodes: ["outscored_by_competitor", "isolated_low_confidence"],
    };
  }

  if (isWeakIsolated) {
    return {
      action: "decay",
      scoreMargin,
      winningClusterKey: winner.key,
      reasonCodes: ["isolated_low_confidence"],
    };
  }

  if (
    bestOther !== undefined &&
    Math.abs(scoreMargin) < thresholds.competitionMargin
  ) {
    return {
      action: "observe",
      scoreMargin,
      winningClusterKey: winner.key,
      reasonCodes: ["ambiguous_competition"],
    };
  }

  if (isClearlyOutscored) {
    return {
      action: "observe",
      scoreMargin,
      winningClusterKey: winner.key,
      reasonCodes: ["outscored_by_competitor"],
    };
  }

  return {
    action: "observe",
    scoreMargin,
    winningClusterKey: winner.key,
    reasonCodes: ["insufficient_signal"],
  };
}

export function buildMemoryConsolidationPlan(
  input: BuildMemoryConsolidationPlanInput,
): MemoryConsolidationPlan {
  const clusters = buildMemoryEvidenceClusters(input);
  const thresholds = resolveThresholds(input.thresholds);
  const grouped = groupByCompetition(clusters, input.getCompetitionKey);
  const entries: MemoryConsolidationPlanEntry[] = [];

  for (const [competitionKey, competitionClusters] of grouped.entries()) {
    const ranked = [...competitionClusters].sort((a, b) => b.score - a.score);

    for (const [index, cluster] of ranked.entries()) {
      const decision = decideCluster(cluster, ranked, thresholds);
      const competingClusterKeys = ranked
        .filter((candidate) => candidate.key !== cluster.key)
        .map((candidate) => candidate.key);

      entries.push({
        clusterKey: cluster.key,
        competitionKey,
        action: decision.action,
        score: cluster.score,
        evidenceCount: cluster.evidenceCount,
        recordIds: cluster.recordIds,
        rankInCompetition: index + 1,
        winningClusterKey: decision.winningClusterKey,
        competingClusterKeys,
        scoreMargin: decision.scoreMargin,
        reasonCodes: decision.reasonCodes,
        explanation: explain(decision.action, decision.reasonCodes),
      });
    }
  }

  return {
    clusters,
    entries,
    actions: {
      preserve: entries.filter((entry) => entry.action === "preserve"),
      observe: entries.filter((entry) => entry.action === "observe"),
      decay: entries.filter((entry) => entry.action === "decay"),
      deprecate: entries.filter((entry) => entry.action === "deprecate"),
    },
  };
}

/**
 * Build a "deprecate" plan entry for the records that fed into a successful
 * summarize operation. The new summary supersedes those records; callers
 * persist the entry via `MemoryStorageAdapter.deprecateRecords` so the
 * soft-hide chain stays consistent.
 */
export function buildMemoryDeprecationEntry(input: {
  clusterKey: string;
  competitionKey: string;
  recordIds: string[];
  winningClusterKey: string;
  competingClusterKeys?: string[];
  score?: number;
  evidenceCount?: number;
  scoreMargin?: number;
  supersededBySummaryId: string;
  reason?: string;
  rankInCompetition?: number;
}): MemoryConsolidationPlanEntry {
  const reason =
    input.reason ?? `superseded_by_summary:${input.supersededBySummaryId}`;
  return {
    clusterKey: input.clusterKey,
    competitionKey: input.competitionKey,
    action: "deprecate",
    score: input.score ?? 1,
    evidenceCount: input.evidenceCount ?? input.recordIds.length,
    recordIds: [...input.recordIds],
    rankInCompetition: input.rankInCompetition ?? 0,
    winningClusterKey: input.winningClusterKey,
    competingClusterKeys: [...(input.competingClusterKeys ?? [])],
    scoreMargin: input.scoreMargin ?? 0,
    reasonCodes: ["superseded_by_summary"],
    explanation: `Records are superseded by summary ${input.supersededBySummaryId}.`,
    supersededBySummaryId: input.supersededBySummaryId,
    deprecationReason: reason,
  };
}
