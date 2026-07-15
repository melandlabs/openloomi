import type {
  ClusterLifecycleTransition,
  MemoryApplicabilityContext,
  MemoryClusterLifecycleStatus,
  MemoryGraphClusterSnapshot,
  MemoryGraphEdge,
  MemoryGraphNode,
  MemoryGraphOperation,
  MemoryGraphPersistenceMode,
  MemoryGraphSnapshot,
  MemoryGraphUpdatePlan,
  OwnerScope,
} from "./graph-contracts";
import {
  buildMemoryGraphCompetitionComponents,
  ownerScopeKey,
  sameOwnerScope,
} from "./graph-evolution";

export interface MemoryGraphLifecyclePolicyOptions {
  stableMinEvidence?: number;
  stableMinSupportScore?: number;
  decayAfterMs?: number;
  supersessionMinEvidence?: number;
  supersessionStrengthMargin?: number;
}

export interface MemoryGraphLifecycleConsolidationCandidate {
  clusterId: string;
  sourceNodeIds: string[];
  supersededClusterIds: string[];
  competitionKey?: string;
  evidenceCount: number;
  score: number;
  reasonCodes: string[];
}

export interface BuildMemoryGraphLifecyclePlanInput {
  ownerScope: OwnerScope;
  snapshot: MemoryGraphSnapshot;
  now: number;
  persistence: MemoryGraphPersistenceMode;
  policy?: MemoryGraphLifecyclePolicyOptions;
}

export interface BuildMemoryGraphLifecyclePlanResult {
  plan: MemoryGraphUpdatePlan;
  transitions: ClusterLifecycleTransition[];
  consolidationCandidates: MemoryGraphLifecycleConsolidationCandidate[];
  decayingClusterIds: string[];
  reasonCodes: string[];
}

export interface BuildMemoryGraphRepresentativePlanInput {
  ownerScope: OwnerScope;
  snapshot: MemoryGraphSnapshot;
  candidate: MemoryGraphLifecycleConsolidationCandidate;
  summaryId: string;
  now: number;
  persistence: MemoryGraphPersistenceMode;
}

export interface BuildMemoryGraphVisibilityPlanInput {
  ownerScope: OwnerScope;
  snapshot: MemoryGraphSnapshot;
  summaryId: string;
  sourceNodeIds: string[];
  now: number;
  persistence: MemoryGraphPersistenceMode;
}

const DEFAULT_STABLE_MIN_EVIDENCE = 3;
const DEFAULT_STABLE_MIN_SUPPORT_SCORE = 0.6;
const DEFAULT_DECAY_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_SUPERSESSION_MIN_EVIDENCE = 3;
const DEFAULT_SUPERSESSION_STRENGTH_MARGIN = 1;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function stablePart(value: string): string {
  return encodeURIComponent(value);
}

function applicabilityKey(
  value: MemoryApplicabilityContext | undefined,
): string {
  if (!value) return "global";
  return [
    value.scope,
    value.key ?? "",
    value.validFrom ?? "",
    value.validUntil ?? "",
  ]
    .map((part) => stablePart(String(part)))
    .join(":");
}

function sameApplicability(
  left: MemoryApplicabilityContext | undefined,
  right: MemoryApplicabilityContext | undefined,
): boolean {
  return applicabilityKey(left) === applicabilityKey(right);
}

function rawSourceNodeIds(
  cluster: MemoryGraphClusterSnapshot,
  snapshot: MemoryGraphSnapshot,
): string[] {
  const nodesById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  return cluster.nodeIds.filter((nodeId) => {
    const node = nodesById.get(nodeId);
    return node?.type === "raw" && node.visibility !== "audit-only";
  });
}

function strength(
  cluster: MemoryGraphClusterSnapshot,
  sourceNodeIds: string[],
): number {
  return sourceNodeIds.length + (cluster.supportScore ?? 0);
}

function lifecycleOperationId(
  ownerScope: OwnerScope,
  clusterId: string,
  fromStatus: MemoryClusterLifecycleStatus,
  toStatus: MemoryClusterLifecycleStatus,
  expectedVersion: string,
): string {
  return `memory-graph-lifecycle:${ownerScopeKey(ownerScope)}:${stablePart(clusterId)}:${fromStatus}:${toStatus}:${stablePart(expectedVersion)}`;
}

function planId(
  kind: string,
  ownerScope: OwnerScope,
  identity: string,
): string {
  return `memory-graph-${kind}:${ownerScopeKey(ownerScope)}:${stablePart(identity)}`;
}

function edgeId(fromNodeId: string, toNodeId: string): string {
  return `memory-graph-edge:supersede:${stablePart(fromNodeId)}:${stablePart(toNodeId)}`;
}

function operationId(kind: string, identity: string): string {
  return `memory-graph-operation:${kind}:${stablePart(identity)}`;
}

function copyCluster(
  cluster: MemoryGraphClusterSnapshot,
): MemoryGraphClusterSnapshot {
  return {
    ...cluster,
    ownerScope: { ...cluster.ownerScope },
    nodeIds: [...cluster.nodeIds],
    reasonCodes: [...cluster.reasonCodes],
    applicability: cluster.applicability
      ? { ...cluster.applicability }
      : undefined,
    metadata: cluster.metadata ? { ...cluster.metadata } : undefined,
  };
}

function emptyPlan(input: {
  ownerScope: OwnerScope;
  snapshot: MemoryGraphSnapshot;
  persistence: MemoryGraphPersistenceMode;
  kind: string;
  identity: string;
  reasonCodes: string[];
}): MemoryGraphUpdatePlan {
  return {
    planId: planId(input.kind, input.ownerScope, input.identity),
    ownerScope: { ...input.ownerScope },
    candidateNodes: [],
    candidateEdges: [],
    candidateClusters: [],
    operations: [],
    expectedVersion: input.snapshot.version ?? "0",
    persistence: input.persistence,
    reasonCodes: input.reasonCodes,
  };
}

export function buildMemoryGraphLifecyclePlan(
  input: BuildMemoryGraphLifecyclePlanInput,
): BuildMemoryGraphLifecyclePlanResult {
  const stableMinEvidence = Math.max(
    1,
    Math.floor(input.policy?.stableMinEvidence ?? DEFAULT_STABLE_MIN_EVIDENCE),
  );
  const stableMinSupportScore = Math.max(
    0,
    Math.min(
      1,
      input.policy?.stableMinSupportScore ?? DEFAULT_STABLE_MIN_SUPPORT_SCORE,
    ),
  );
  const decayAfterMs = Math.max(
    0,
    input.policy?.decayAfterMs ?? DEFAULT_DECAY_AFTER_MS,
  );
  const supersessionMinEvidence = Math.max(
    1,
    Math.floor(
      input.policy?.supersessionMinEvidence ??
        DEFAULT_SUPERSESSION_MIN_EVIDENCE,
    ),
  );
  const supersessionStrengthMargin = Math.max(
    0,
    input.policy?.supersessionStrengthMargin ??
      DEFAULT_SUPERSESSION_STRENGTH_MARGIN,
  );
  const clusters = input.snapshot.clusters.filter((cluster) =>
    sameOwnerScope(cluster.ownerScope, input.ownerScope),
  );
  const sourcesByCluster = new Map(
    clusters.map((cluster) => [
      cluster.clusterId,
      rawSourceNodeIds(cluster, input.snapshot),
    ]),
  );
  const competitionByClusterId = new Map<
    string,
    {
      key: string;
      winner?: MemoryGraphClusterSnapshot;
      losers: MemoryGraphClusterSnapshot[];
      resolved: boolean;
    }
  >();
  for (const component of buildMemoryGraphCompetitionComponents({
    clusters,
    edges: input.snapshot.edges,
    ownerScope: input.ownerScope,
  })) {
    const group = component.clusters;
    const ranked = [...group].sort((left, right) => {
      const rightSources = sourcesByCluster.get(right.clusterId) ?? [];
      const leftSources = sourcesByCluster.get(left.clusterId) ?? [];
      return strength(right, rightSources) - strength(left, leftSources);
    });
    const winner = ranked[0];
    const runnerUp = ranked[1];
    if (!winner || !runnerUp) continue;
    const winnerSources = sourcesByCluster.get(winner.clusterId) ?? [];
    const runnerUpSources = sourcesByCluster.get(runnerUp.clusterId) ?? [];
    if (
      winnerSources.length < supersessionMinEvidence ||
      (winner.supportScore ?? 0) < stableMinSupportScore ||
      strength(winner, winnerSources) - strength(runnerUp, runnerUpSources) <
        supersessionStrengthMargin
    ) {
      for (const cluster of group) {
        competitionByClusterId.set(cluster.clusterId, {
          key: component.componentKey,
          losers: [],
          resolved: false,
        });
      }
      continue;
    }
    const losers = ranked.filter(
      (cluster) =>
        cluster.clusterId !== winner.clusterId &&
        sameApplicability(cluster.applicability, winner.applicability),
    );
    if (losers.length > 0) {
      for (const cluster of group) {
        competitionByClusterId.set(cluster.clusterId, {
          key: component.componentKey,
          winner,
          losers,
          resolved: true,
        });
      }
    }
  }

  const transitions: ClusterLifecycleTransition[] = [];
  const candidateClusters: MemoryGraphClusterSnapshot[] = [];
  const operations: MemoryGraphOperation[] = [];
  const consolidationCandidates: MemoryGraphLifecycleConsolidationCandidate[] =
    [];
  const decayingClusterIds: string[] = [];

  for (const cluster of clusters) {
    const sourceNodeIds = sourcesByCluster.get(cluster.clusterId) ?? [];
    let targetStatus: MemoryClusterLifecycleStatus = cluster.lifecycleStatus;
    let transitionReason = "cluster_lifecycle_unchanged";
    const competition = competitionByClusterId.get(cluster.clusterId);
    const isWinner = competition?.winner?.clusterId === cluster.clusterId;
    const hasUnresolvedCompetition = competition?.resolved === false;

    if (
      cluster.lifecycleStatus === "superseded" &&
      typeof cluster.metadata?.supersededBySummaryId === "string"
    ) {
      targetStatus = "superseded";
      transitionReason = "supersession_preserved";
    } else if (sourceNodeIds.length === 0) {
      targetStatus = cluster.representativeNodeId
        ? cluster.lifecycleStatus
        : "audit-only";
      transitionReason = "cluster_without_active_sources";
    } else if (isWinner) {
      targetStatus = "stable";
      transitionReason = "sustained_competition_winner";
    } else if (hasUnresolvedCompetition) {
      targetStatus = sourceNodeIds.length >= 2 ? "active" : "forming";
      transitionReason = "competition_preserved_before_supersession";
    } else if (
      sourceNodeIds.length >= stableMinEvidence &&
      (cluster.supportScore ?? 0) >= stableMinSupportScore
    ) {
      targetStatus = "stable";
      transitionReason = "repeated_support_reached_stable";
    } else if (sourceNodeIds.length >= 2) {
      targetStatus = "active";
      transitionReason = "cluster_has_independent_support";
    } else if (input.now - cluster.updatedAt >= decayAfterMs) {
      targetStatus = "decaying";
      transitionReason = "weak_isolated_cluster_stale";
    } else {
      targetStatus = "forming";
      transitionReason = "cluster_still_forming";
    }

    if (targetStatus === "decaying") decayingClusterIds.push(cluster.clusterId);
    if (targetStatus !== cluster.lifecycleStatus) {
      const updated = copyCluster(cluster);
      updated.lifecycleStatus = targetStatus;
      updated.updatedAt = input.now;
      updated.reasonCodes = unique([...updated.reasonCodes, transitionReason]);
      candidateClusters.push(updated);
      const transition: ClusterLifecycleTransition = {
        ownerScope: { ...input.ownerScope },
        clusterId: cluster.clusterId,
        fromStatus: cluster.lifecycleStatus,
        toStatus: targetStatus,
        reasonCodes: [transitionReason],
      };
      transitions.push(transition);
      operations.push({
        operationId: lifecycleOperationId(
          input.ownerScope,
          cluster.clusterId,
          cluster.lifecycleStatus,
          targetStatus,
          input.snapshot.version ?? "0",
        ),
        ownerScope: { ...input.ownerScope },
        kind: "set-cluster-lifecycle",
        nodeIds: [...cluster.nodeIds],
        clusterId: cluster.clusterId,
        fromStatus: cluster.lifecycleStatus,
        toStatus: targetStatus,
        reasonCodes: [transitionReason],
      });
    }

    if (targetStatus === "stable" && sourceNodeIds.length > 0) {
      const supersededClusterIds = isWinner
        ? (competition?.losers.map((loser) => loser.clusterId) ?? [])
        : [];
      consolidationCandidates.push({
        clusterId: cluster.clusterId,
        sourceNodeIds,
        supersededClusterIds,
        competitionKey: competition?.key ?? cluster.competitionKey,
        evidenceCount: sourceNodeIds.length,
        score: cluster.supportScore ?? 0,
        reasonCodes: unique([
          transitionReason,
          ...(supersededClusterIds.length > 0
            ? ["sustained_competition_can_supersede"]
            : []),
        ]),
      });
    }
  }

  const reasonCodes = unique([
    "memory_graph_lifecycle_evaluated",
    ...(transitions.length > 0 ? ["memory_graph_lifecycle_changed"] : []),
    ...(consolidationCandidates.length > 0
      ? ["stable_cluster_ready_for_consolidation"]
      : []),
    ...(decayingClusterIds.length > 0 ? ["weak_cluster_decaying"] : []),
  ]);
  const plan = emptyPlan({
    ownerScope: input.ownerScope,
    snapshot: input.snapshot,
    persistence: input.persistence,
    kind: "lifecycle",
    identity: input.snapshot.version ?? "0",
    reasonCodes,
  });
  plan.candidateClusters = candidateClusters;
  plan.operations = operations;

  return {
    plan,
    transitions,
    consolidationCandidates,
    decayingClusterIds,
    reasonCodes,
  };
}

export function buildMemoryGraphRepresentativePlan(
  input: BuildMemoryGraphRepresentativePlanInput,
): MemoryGraphUpdatePlan {
  const winner = input.snapshot.clusters.find(
    (cluster) =>
      cluster.clusterId === input.candidate.clusterId &&
      sameOwnerScope(cluster.ownerScope, input.ownerScope),
  );
  if (!winner) {
    return emptyPlan({
      ownerScope: input.ownerScope,
      snapshot: input.snapshot,
      persistence: input.persistence,
      kind: "representative",
      identity: input.summaryId,
      reasonCodes: ["memory_graph_cluster_not_found"],
    });
  }
  const supersededClusters = input.candidate.supersededClusterIds
    .map((clusterId) =>
      input.snapshot.clusters.find(
        (cluster) =>
          cluster.clusterId === clusterId &&
          sameOwnerScope(cluster.ownerScope, input.ownerScope) &&
          sameApplicability(cluster.applicability, winner.applicability),
      ),
    )
    .filter((cluster): cluster is MemoryGraphClusterSnapshot =>
      Boolean(cluster),
    );
  const supersededSourceNodeIds = supersededClusters.flatMap((cluster) =>
    rawSourceNodeIds(cluster, input.snapshot),
  );
  const nodesById = new Map(
    input.snapshot.nodes.map((node) => [node.id, node]),
  );
  const supersededRepresentativeNodes = supersededClusters
    .map((cluster) =>
      cluster.representativeNodeId
        ? nodesById.get(cluster.representativeNodeId)
        : undefined,
    )
    .filter(
      (node): node is MemoryGraphNode =>
        Boolean(node) &&
        (node?.type === "summary" || node?.type === "artifact") &&
        node.visibility !== "audit-only",
    )
    .map(
      (node): MemoryGraphNode => ({
        ...node,
        ownerScope: { ...node.ownerScope },
        visibility: "audit-only",
        updatedAt: input.now,
        metadata: {
          ...(node.metadata ?? {}),
          supersededBySummaryId: input.summaryId,
        },
      }),
    );
  const coveredSourceNodeIds = unique([
    ...input.candidate.sourceNodeIds,
    ...supersededSourceNodeIds,
  ]);
  const coveredNodeIds = unique([
    ...coveredSourceNodeIds,
    ...supersededRepresentativeNodes.map((node) => node.id),
  ]);
  const summaryNode: MemoryGraphNode = {
    id: input.summaryId,
    ownerScope: { ...input.ownerScope },
    type: "summary",
    sourceId: input.summaryId,
    createdAt: input.now,
    updatedAt: input.now,
    visibility: "default",
    applicability: winner.applicability
      ? { ...winner.applicability }
      : undefined,
    metadata: {
      clusterId: winner.clusterId,
      sourceNodeIds: [...input.candidate.sourceNodeIds],
      supersededClusterIds: supersededClusters.map(
        (cluster) => cluster.clusterId,
      ),
      supersededRepresentativeNodeIds: supersededRepresentativeNodes.map(
        (node) => node.id,
      ),
    },
  };
  const candidateEdges: MemoryGraphEdge[] = coveredNodeIds.map(
    (sourceNodeId) => ({
      id: edgeId(sourceNodeId, input.summaryId),
      ownerScope: { ...input.ownerScope },
      fromNodeId: sourceNodeId,
      toNodeId: input.summaryId,
      kind: "supersede",
      weight: 1,
      confidence: 1,
      evidenceNodeIds: [sourceNodeId],
      reasonCodes: [
        input.candidate.sourceNodeIds.includes(sourceNodeId)
          ? "stable_cluster_represented"
          : "competing_cluster_superseded",
      ],
      applicability: winner.applicability
        ? { ...winner.applicability }
        : undefined,
      createdAt: input.now,
      updatedAt: input.now,
    }),
  );
  const updatedWinner = copyCluster(winner);
  updatedWinner.nodeIds = unique([...updatedWinner.nodeIds, input.summaryId]);
  updatedWinner.representativeNodeId = input.summaryId;
  updatedWinner.lifecycleStatus = "stable";
  updatedWinner.updatedAt = input.now;
  updatedWinner.reasonCodes = unique([
    ...updatedWinner.reasonCodes,
    "stable_cluster_representative_persisted",
  ]);
  const updatedLosers = supersededClusters.map((cluster) => {
    const updated = copyCluster(cluster);
    updated.lifecycleStatus = "superseded";
    updated.updatedAt = input.now;
    updated.reasonCodes = unique([
      ...updated.reasonCodes,
      "sustained_competition_superseded",
    ]);
    updated.metadata = {
      ...(updated.metadata ?? {}),
      supersededByClusterId: winner.clusterId,
      supersededBySummaryId: input.summaryId,
    };
    return updated;
  });
  const operations: MemoryGraphOperation[] = [
    {
      operationId: operationId("create-summary-node", input.summaryId),
      ownerScope: { ...input.ownerScope },
      kind: "create-node",
      nodeIds: [input.summaryId],
      clusterId: winner.clusterId,
      reasonCodes: ["stable_cluster_representative_persisted"],
    },
    ...candidateEdges.map(
      (edge): MemoryGraphOperation => ({
        operationId: operationId("supersede-edge", edge.id),
        ownerScope: { ...input.ownerScope },
        kind: "create-edge",
        nodeIds: [edge.fromNodeId, edge.toNodeId],
        edgeIds: [edge.id],
        clusterId: winner.clusterId,
        supersededByNodeId: input.summaryId,
        reasonCodes: [...edge.reasonCodes],
      }),
    ),
    ...supersededRepresentativeNodes.map(
      (node): MemoryGraphOperation => ({
        operationId: operationId(
          "supersede-representative",
          `${node.id}:${input.summaryId}`,
        ),
        ownerScope: { ...input.ownerScope },
        kind: "supersede-node",
        nodeIds: [node.id],
        supersededByNodeId: input.summaryId,
        reasonCodes: ["sustained_competition_superseded"],
      }),
    ),
    {
      operationId: operationId("set-representative", input.summaryId),
      ownerScope: { ...input.ownerScope },
      kind: "set-cluster-representative",
      nodeIds: [...updatedWinner.nodeIds],
      clusterId: winner.clusterId,
      supersededByNodeId: input.summaryId,
      reasonCodes: ["stable_cluster_representative_persisted"],
    },
    ...updatedLosers.map(
      (cluster): MemoryGraphOperation => ({
        operationId: operationId(
          "supersede-cluster",
          `${cluster.clusterId}:${input.summaryId}`,
        ),
        ownerScope: { ...input.ownerScope },
        kind: "set-cluster-lifecycle",
        nodeIds: [...cluster.nodeIds],
        clusterId: cluster.clusterId,
        fromStatus: cluster.lifecycleStatus,
        toStatus: "superseded",
        supersededByNodeId: input.summaryId,
        reasonCodes: ["sustained_competition_superseded"],
      }),
    ),
  ];

  return {
    planId: planId("representative", input.ownerScope, input.summaryId),
    ownerScope: { ...input.ownerScope },
    candidateNodes: [summaryNode, ...supersededRepresentativeNodes],
    candidateEdges,
    candidateClusters: [updatedWinner, ...updatedLosers],
    operations,
    expectedVersion: input.snapshot.version ?? "0",
    persistence: input.persistence,
    reasonCodes: unique([
      "stable_cluster_representative_persisted",
      ...(updatedLosers.length > 0 ? ["sustained_competition_superseded"] : []),
    ]),
    metadata: {
      summaryId: input.summaryId,
      sourceNodeIds: [...input.candidate.sourceNodeIds],
      coveredSourceNodeIds,
    },
  };
}

export function buildMemoryGraphVisibilityPlan(
  input: BuildMemoryGraphVisibilityPlanInput,
): MemoryGraphUpdatePlan {
  const sourceIds = new Set(input.sourceNodeIds);
  const candidateNodes = input.snapshot.nodes
    .filter(
      (node) =>
        sourceIds.has(node.id) &&
        node.type === "raw" &&
        node.visibility !== "audit-only" &&
        sameOwnerScope(node.ownerScope, input.ownerScope),
    )
    .map(
      (node): MemoryGraphNode => ({
        ...node,
        ownerScope: { ...node.ownerScope },
        visibility: "audit-only",
        updatedAt: input.now,
        metadata: {
          ...(node.metadata ?? {}),
          supersededBySummaryId: input.summaryId,
        },
      }),
    );
  const operations = candidateNodes.map(
    (node): MemoryGraphOperation => ({
      operationId: operationId(
        "set-audit-only",
        `${node.id}:${input.summaryId}`,
      ),
      ownerScope: { ...input.ownerScope },
      kind: "supersede-node",
      nodeIds: [node.id],
      supersededByNodeId: input.summaryId,
      reasonCodes: ["source_soft_deprecated_after_representative"],
    }),
  );
  return {
    planId: planId("visibility", input.ownerScope, input.summaryId),
    ownerScope: { ...input.ownerScope },
    candidateNodes,
    candidateEdges: [],
    candidateClusters: [],
    operations,
    expectedVersion: input.snapshot.version ?? "0",
    persistence: input.persistence,
    reasonCodes: unique([
      "source_soft_deprecated_after_representative",
      ...(operations.length === 0 ? ["visibility_already_converged"] : []),
    ]),
    metadata: {
      summaryId: input.summaryId,
      sourceNodeIds: [...input.sourceNodeIds],
    },
  };
}
