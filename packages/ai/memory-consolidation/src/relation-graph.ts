import type {
  MemoryEvidenceCluster,
  MemoryEvidenceRecord,
} from "./evidence-cluster";

export type MemoryRelationKind = "support" | "compete" | "related";

export interface MemoryTraceNode {
  id: string;
  recordId: string;
  timestamp: number;
  activationCount?: number;
  lastActivatedAt?: number;
}

export interface MemoryRelationEdge {
  id?: string;
  fromRecordId: string;
  toRecordId: string;
  relation: MemoryRelationKind;
  weight: number;
  evidenceCount?: number;
  activationCount?: number;
  lastActivatedAt?: number;
}

export interface MemoryRelationGraphThresholds {
  supportThreshold: number;
  competeThreshold: number;
  stableSupportScore: number;
  relationDecayHalfLifeMs: number;
  evidenceBoost: number;
  activationBoost: number;
}

export type MemoryGraphClusterStatus = "tentative" | "stable" | "contested";
export type MemoryGraphClusterLifecycleStatus =
  | MemoryGraphClusterStatus
  | "consolidated";

export interface MemoryRelationGraphEdgeSignal {
  id: string;
  fromRecordId: string;
  toRecordId: string;
  relation: MemoryRelationKind;
  weight: number;
  effectiveWeight: number;
  evidenceCount: number;
  activationCount: number;
  lastActivatedAt?: number;
}

export interface MemoryRelationGraphCluster {
  clusterId: string;
  recordIds: string[];
  supportEdgeIds: string[];
  relatedEdgeIds: string[];
  status: MemoryGraphClusterStatus;
  supportScore: number;
  latestTimestamp: number;
}

export interface MemoryRelationCompetitionGroup {
  competitionKey: string;
  clusterIds: string[];
  competeEdgeIds: string[];
}

export interface AssignMemoryRelationGraphInput {
  records: MemoryEvidenceRecord[];
  nodes?: MemoryTraceNode[];
  relations: MemoryRelationEdge[];
  now: number;
  thresholds?: Partial<MemoryRelationGraphThresholds>;
}

export interface MemoryRelationGraphAssignment {
  nodes: MemoryTraceNode[];
  edges: MemoryRelationGraphEdgeSignal[];
  clusters: MemoryRelationGraphCluster[];
  competitionGroups: MemoryRelationCompetitionGroup[];
  recordClusterKeys: Record<string, string>;
  clusterCompetitionKeys: Record<string, string>;
  getClusterKey(record: MemoryEvidenceRecord): string | undefined;
  getCompetitionKey(cluster: Pick<MemoryEvidenceCluster, "key">): string;
}

export interface MemoryRelationGraphLifecycleEntry {
  clusterId: string;
  status: MemoryGraphClusterLifecycleStatus;
  graphStatus: MemoryGraphClusterStatus;
  consolidated: boolean;
}

export interface DeriveMemoryRelationGraphLifecycleInput {
  assignment: Pick<MemoryRelationGraphAssignment, "clusters">;
  consolidatedClusterKeys: Iterable<string>;
}

const DEFAULT_THRESHOLDS: MemoryRelationGraphThresholds = {
  supportThreshold: 0.7,
  competeThreshold: 0.7,
  stableSupportScore: 0.7,
  relationDecayHalfLifeMs: 90 * 24 * 60 * 60 * 1000,
  evidenceBoost: 0.04,
  activationBoost: 0.02,
};

function resolveThresholds(
  thresholds: Partial<MemoryRelationGraphThresholds> | undefined,
): MemoryRelationGraphThresholds {
  return {
    supportThreshold:
      thresholds?.supportThreshold ?? DEFAULT_THRESHOLDS.supportThreshold,
    competeThreshold:
      thresholds?.competeThreshold ?? DEFAULT_THRESHOLDS.competeThreshold,
    stableSupportScore:
      thresholds?.stableSupportScore ?? DEFAULT_THRESHOLDS.stableSupportScore,
    relationDecayHalfLifeMs:
      thresholds?.relationDecayHalfLifeMs ??
      DEFAULT_THRESHOLDS.relationDecayHalfLifeMs,
    evidenceBoost:
      thresholds?.evidenceBoost ?? DEFAULT_THRESHOLDS.evidenceBoost,
    activationBoost:
      thresholds?.activationBoost ?? DEFAULT_THRESHOLDS.activationBoost,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function relationId(edge: MemoryRelationEdge): string {
  return edge.id ?? `${edge.fromRecordId}:${edge.relation}:${edge.toRecordId}`;
}

function nodeFromRecord(record: MemoryEvidenceRecord): MemoryTraceNode {
  return {
    id: record.id,
    recordId: record.id,
    timestamp: record.timestamp,
    activationCount: record.accessCount,
    lastActivatedAt: record.lastAccessAt,
  };
}

function resolveNodes(
  records: MemoryEvidenceRecord[],
  nodes: MemoryTraceNode[] | undefined,
): MemoryTraceNode[] {
  const nodesByRecordId = new Map(
    (nodes ?? []).map((node) => [node.recordId, node]),
  );

  return records.map(
    (record) => nodesByRecordId.get(record.id) ?? nodeFromRecord(record),
  );
}

function decayWeight(
  weight: number,
  lastActivatedAt: number | undefined,
  now: number,
  halfLifeMs: number,
): number {
  if (lastActivatedAt === undefined) {
    return weight;
  }

  const ageMs = Math.max(0, now - lastActivatedAt);
  return weight * 0.5 ** (ageMs / Math.max(1, halfLifeMs));
}

function effectiveWeight(
  edge: MemoryRelationEdge,
  now: number,
  thresholds: MemoryRelationGraphThresholds,
): number {
  const evidenceCount = edge.evidenceCount ?? 0;
  const activationCount = edge.activationCount ?? 0;
  const decayedWeight = decayWeight(
    edge.weight,
    edge.lastActivatedAt,
    now,
    thresholds.relationDecayHalfLifeMs,
  );

  return clamp01(
    decayedWeight +
      evidenceCount * thresholds.evidenceBoost +
      activationCount * thresholds.activationBoost,
  );
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

class DisjointSet {
  private readonly parent = new Map<string, string>();

  constructor(ids: string[]) {
    for (const id of ids) {
      this.parent.set(id, id);
    }
  }

  find(id: string): string {
    const parent = this.parent.get(id);
    if (!parent || parent === id) {
      return id;
    }

    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);

    if (leftRoot !== rightRoot) {
      this.parent.set(rightRoot, leftRoot);
    }
  }
}

function encodeKeyPart(value: string): string {
  return encodeURIComponent(value);
}

function stableKeyParts(ids: string[]): string[] {
  return [...ids].sort().map(encodeKeyPart);
}

function clusterId(recordIds: string[]): string {
  return `graph:${stableKeyParts(recordIds).join("|")}`;
}

function competitionKey(clusterIds: string[]): string {
  return clusterIds.length === 1
    ? (clusterIds[0] ?? "competition:empty")
    : `competition:${stableKeyParts(clusterIds).join("|")}`;
}

function groupByRoot(
  ids: string[],
  disjointSet: DisjointSet,
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();

  for (const id of ids) {
    const root = disjointSet.find(id);
    const existing = grouped.get(root) ?? [];
    existing.push(id);
    grouped.set(root, existing);
  }

  return grouped;
}

export function assignMemoryRelationGraph(
  input: AssignMemoryRelationGraphInput,
): MemoryRelationGraphAssignment {
  const thresholds = resolveThresholds(input.thresholds);
  const recordsById = new Map(
    input.records.map((record) => [record.id, record]),
  );
  const nodes = resolveNodes(input.records, input.nodes);
  const nodesByRecordId = new Map(nodes.map((node) => [node.recordId, node]));
  const recordIds = nodes.map((node) => node.recordId);
  const edgeSignals = input.relations.map((edge) => ({
    id: relationId(edge),
    fromRecordId: edge.fromRecordId,
    toRecordId: edge.toRecordId,
    relation: edge.relation,
    weight: clamp01(edge.weight),
    effectiveWeight: effectiveWeight(edge, input.now, thresholds),
    evidenceCount: edge.evidenceCount ?? 0,
    activationCount: edge.activationCount ?? 0,
    lastActivatedAt: edge.lastActivatedAt,
  }));

  const recordDisjointSet = new DisjointSet(recordIds);
  const strongSupportEdges = edgeSignals.filter(
    (edge) =>
      edge.relation === "support" &&
      edge.effectiveWeight >= thresholds.supportThreshold &&
      recordsById.has(edge.fromRecordId) &&
      recordsById.has(edge.toRecordId),
  );

  for (const edge of strongSupportEdges) {
    recordDisjointSet.union(edge.fromRecordId, edge.toRecordId);
  }

  const groupedRecords = groupByRoot(recordIds, recordDisjointSet);
  const clusters = [...groupedRecords.values()].map((recordIdsInCluster) => {
    const recordIdSet = new Set(recordIdsInCluster);
    const supportEdges = strongSupportEdges.filter(
      (edge) =>
        recordIdSet.has(edge.fromRecordId) && recordIdSet.has(edge.toRecordId),
    );
    const relatedEdges = edgeSignals.filter(
      (edge) =>
        edge.relation === "related" &&
        recordsById.has(edge.fromRecordId) &&
        recordsById.has(edge.toRecordId) &&
        (recordIdSet.has(edge.fromRecordId) ||
          recordIdSet.has(edge.toRecordId)),
    );
    const supportScore = mean(supportEdges.map((edge) => edge.effectiveWeight));
    const latestTimestamp = Math.max(
      ...recordIdsInCluster.map(
        (recordId) =>
          nodesByRecordId.get(recordId)?.timestamp ??
          recordsById.get(recordId)!.timestamp,
      ),
    );
    const status: MemoryGraphClusterStatus =
      recordIdsInCluster.length > 1 &&
      supportScore >= thresholds.stableSupportScore
        ? "stable"
        : "tentative";

    return {
      clusterId: clusterId(recordIdsInCluster),
      recordIds: recordIdsInCluster,
      supportEdgeIds: supportEdges.map((edge) => edge.id),
      relatedEdgeIds: relatedEdges.map((edge) => edge.id),
      status,
      supportScore,
      latestTimestamp,
    };
  });

  const clusterByRecordId = new Map<string, string>();
  for (const cluster of clusters) {
    for (const recordId of cluster.recordIds) {
      clusterByRecordId.set(recordId, cluster.clusterId);
    }
  }

  const clusterIds = clusters.map((cluster) => cluster.clusterId);
  const clusterDisjointSet = new DisjointSet(clusterIds);
  const strongCompeteEdges = edgeSignals.filter(
    (edge) =>
      edge.relation === "compete" &&
      edge.effectiveWeight >= thresholds.competeThreshold &&
      clusterByRecordId.has(edge.fromRecordId) &&
      clusterByRecordId.has(edge.toRecordId) &&
      clusterByRecordId.get(edge.fromRecordId) !==
        clusterByRecordId.get(edge.toRecordId),
  );

  for (const edge of strongCompeteEdges) {
    clusterDisjointSet.union(
      clusterByRecordId.get(edge.fromRecordId)!,
      clusterByRecordId.get(edge.toRecordId)!,
    );
  }

  const groupedClusters = groupByRoot(clusterIds, clusterDisjointSet);
  const competitionGroups = [...groupedClusters.values()].map(
    (clusterIdsInGroup) => {
      const clusterIdSet = new Set(clusterIdsInGroup);
      const competeEdges = strongCompeteEdges.filter((edge) => {
        const fromClusterId = clusterByRecordId.get(edge.fromRecordId);
        const toClusterId = clusterByRecordId.get(edge.toRecordId);
        return (
          fromClusterId !== undefined &&
          toClusterId !== undefined &&
          clusterIdSet.has(fromClusterId) &&
          clusterIdSet.has(toClusterId)
        );
      });

      return {
        competitionKey: competitionKey(clusterIdsInGroup),
        clusterIds: clusterIdsInGroup,
        competeEdgeIds: competeEdges.map((edge) => edge.id),
      };
    },
  );

  const clusterCompetitionKeys = Object.fromEntries(
    competitionGroups.flatMap((group) =>
      group.clusterIds.map((clusterId) => [clusterId, group.competitionKey]),
    ),
  );
  const recordClusterKeys = Object.fromEntries(clusterByRecordId.entries());
  const contestedClusterIds = new Set(
    competitionGroups
      .filter((group) => group.clusterIds.length > 1)
      .flatMap((group) => group.clusterIds),
  );
  const clustersWithCompetitionStatus = clusters.map((cluster) => ({
    ...cluster,
    status: contestedClusterIds.has(cluster.clusterId)
      ? ("contested" as const)
      : cluster.status,
  }));

  return {
    nodes,
    edges: edgeSignals,
    clusters: clustersWithCompetitionStatus,
    competitionGroups,
    recordClusterKeys,
    clusterCompetitionKeys,
    getClusterKey(record) {
      return recordClusterKeys[record.id];
    },
    getCompetitionKey(cluster) {
      return clusterCompetitionKeys[cluster.key] ?? cluster.key;
    },
  };
}

export function deriveMemoryRelationGraphLifecycle(
  input: DeriveMemoryRelationGraphLifecycleInput,
): MemoryRelationGraphLifecycleEntry[] {
  const consolidatedClusterKeys = new Set(input.consolidatedClusterKeys);

  return input.assignment.clusters.map((cluster) => {
    const consolidated = consolidatedClusterKeys.has(cluster.clusterId);

    return {
      clusterId: cluster.clusterId,
      status: consolidated ? "consolidated" : cluster.status,
      graphStatus: cluster.status,
      consolidated,
    };
  });
}
