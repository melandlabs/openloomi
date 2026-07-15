import type { MemoryEvidenceRecord } from "./evidence-cluster";
import type {
  MemoryApplicabilityContext,
  MemoryGraphClusterSnapshot,
  MemoryGraphEdge,
  MemoryGraphNode,
  MemoryGraphOperation,
  MemoryGraphSnapshot,
  MemoryGraphStore,
  MemoryGraphUpdatePlan,
  MemoryGraphUpdateResult,
  OwnerScope,
} from "./graph-contracts";
import {
  buildMemoryRelationCandidates,
  judgeMemoryRelationCandidates,
} from "./pipeline";

export interface MemoryGraphEvolutionEvidence {
  id: string;
  ownerScope: OwnerScope;
  timestamp: number;
  text?: string;
  relationGroup?: string;
  relationValue?: string;
  topicKeys?: string[];
  applicability?: MemoryApplicabilityContext;
  sourceIdentity?: string;
  accessCount?: number;
  importanceScore?: number;
  metadata?: Record<string, unknown>;
}

export interface BuildMemoryGraphEvolutionPlanInput {
  ownerScope: OwnerScope;
  newEvidence: MemoryGraphEvolutionEvidence[];
  candidateEvidence: MemoryGraphEvolutionEvidence[];
  snapshot: MemoryGraphSnapshot;
  now: number;
  persistence: { mode: "dry-run" | "write"; enabled: boolean };
}

export type MemoryGraphEvolutionRunStatus =
  | "disabled"
  | "planned"
  | "applied"
  | "no-op"
  | "conflict"
  | "failed";

export interface MemoryGraphEvolutionRunResult {
  status: MemoryGraphEvolutionRunStatus;
  ownerScope: OwnerScope;
  plan?: MemoryGraphUpdatePlan;
  persistenceResult?: MemoryGraphUpdateResult;
  consideredCandidateIds: string[];
  reasonCodes: string[];
  error?: { name: string; message: string };
}

export interface RunMemoryGraphEvolutionInput {
  ownerScope: OwnerScope;
  newEvidence: MemoryGraphEvolutionEvidence[];
  candidateEvidence: MemoryGraphEvolutionEvidence[];
  store: MemoryGraphStore;
  enabled?: boolean;
  dryRun?: boolean;
  now?: number;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function stablePart(value: string): string {
  return encodeURIComponent(value).replaceAll("%", "_");
}

export function ownerScopeKey(scope: OwnerScope): string {
  return [scope.tenantId ?? "", scope.workspaceId ?? "", scope.userId]
    .map(stablePart)
    .join(":");
}

export function sameOwnerScope(left: OwnerScope, right: OwnerScope): boolean {
  return ownerScopeKey(left) === ownerScopeKey(right);
}

function applicabilityKey(
  applicability: MemoryApplicabilityContext | undefined,
): string {
  if (!applicability || applicability.scope === "global") return "global";
  return `${applicability.scope}:${applicability.key ?? ""}`;
}

function applicabilityActive(
  applicability: MemoryApplicabilityContext | undefined,
  now: number,
): boolean {
  if (!applicability) return true;
  if (applicability.validFrom !== undefined && now < applicability.validFrom) {
    return false;
  }
  if (
    applicability.validUntil !== undefined &&
    now > applicability.validUntil
  ) {
    return false;
  }
  return true;
}

export function applicabilityOverlaps(
  left: MemoryApplicabilityContext | undefined,
  right: MemoryApplicabilityContext | undefined,
  now: number,
): boolean {
  if (!applicabilityActive(left, now) || !applicabilityActive(right, now)) {
    return false;
  }
  const leftKey = applicabilityKey(left);
  const rightKey = applicabilityKey(right);
  return leftKey === "global" || rightKey === "global" || leftKey === rightKey;
}

export function applicabilityEquivalent(
  left: MemoryApplicabilityContext | undefined,
  right: MemoryApplicabilityContext | undefined,
): boolean {
  return (
    applicabilityKey(left) === applicabilityKey(right) &&
    left?.validFrom === right?.validFrom &&
    left?.validUntil === right?.validUntil
  );
}

export interface MemoryGraphCompetitionComponent {
  componentKey: string;
  clusters: MemoryGraphClusterSnapshot[];
}

export function buildMemoryGraphCompetitionComponents(input: {
  ownerScope: OwnerScope;
  clusters: MemoryGraphClusterSnapshot[];
  edges: MemoryGraphEdge[];
}): MemoryGraphCompetitionComponent[] {
  const clustersById = new Map(
    input.clusters.map((cluster) => [cluster.clusterId, cluster]),
  );
  const clusterIdByNodeId = new Map<string, string>();
  for (const cluster of input.clusters) {
    for (const nodeId of cluster.nodeIds) {
      clusterIdByNodeId.set(nodeId, cluster.clusterId);
    }
  }
  const adjacency = new Map<string, Set<string>>();
  for (const edge of input.edges) {
    if (
      edge.kind !== "compete" ||
      edge.weight <= 0 ||
      edge.metadata?.inactive === true ||
      edge.metadata?.rolledBack === true ||
      !sameOwnerScope(edge.ownerScope, input.ownerScope)
    ) {
      continue;
    }
    const leftId = clusterIdByNodeId.get(edge.fromNodeId);
    const rightId = clusterIdByNodeId.get(edge.toNodeId);
    if (!leftId || !rightId || leftId === rightId) continue;
    const left = clustersById.get(leftId);
    const right = clustersById.get(rightId);
    if (
      !left ||
      !right ||
      !applicabilityEquivalent(left.applicability, right.applicability)
    ) {
      continue;
    }
    const leftPeers = adjacency.get(leftId) ?? new Set<string>();
    leftPeers.add(rightId);
    adjacency.set(leftId, leftPeers);
    const rightPeers = adjacency.get(rightId) ?? new Set<string>();
    rightPeers.add(leftId);
    adjacency.set(rightId, rightPeers);
  }

  const components: MemoryGraphCompetitionComponent[] = [];
  const visited = new Set<string>();
  for (const clusterId of adjacency.keys()) {
    if (visited.has(clusterId)) continue;
    const queue = [clusterId];
    const componentIds: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) continue;
      visited.add(current);
      componentIds.push(current);
      for (const peer of adjacency.get(current) ?? []) {
        if (!visited.has(peer)) queue.push(peer);
      }
    }
    const clusters = componentIds
      .map((id) => clustersById.get(id))
      .filter((cluster): cluster is MemoryGraphClusterSnapshot =>
        Boolean(cluster),
      );
    if (clusters.length < 2) continue;
    components.push({
      componentKey: `competition-component:${componentIds
        .sort()
        .map(stablePart)
        .join(":")}`,
      clusters,
    });
  }
  return components;
}

function evidenceToRecord(
  evidence: MemoryGraphEvolutionEvidence,
): MemoryEvidenceRecord {
  return {
    id: evidence.id,
    userId: evidence.ownerScope.userId,
    timestamp: evidence.timestamp,
    text: evidence.text,
    tier: "short",
    accessCount: evidence.accessCount,
    importanceScore: evidence.importanceScore,
    metadata: {
      ...evidence.metadata,
      relationGroup: evidence.relationGroup,
      relationValue: evidence.relationValue,
      topicKeys: evidence.topicKeys,
    },
  };
}

function candidateKeys(record: MemoryEvidenceRecord): string[] {
  const relationGroup = record.metadata?.relationGroup;
  const topicKeys = Array.isArray(record.metadata?.topicKeys)
    ? record.metadata.topicKeys.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  return unique([
    ...(typeof relationGroup === "string" ? [`relation:${relationGroup}`] : []),
    ...topicKeys.map((key) => `topic:${key}`),
  ]);
}

function graphNode(evidence: MemoryGraphEvolutionEvidence): MemoryGraphNode {
  return {
    id: evidence.id,
    ownerScope: evidence.ownerScope,
    type: "raw",
    sourceId: evidence.sourceIdentity ?? evidence.id,
    createdAt: evidence.timestamp,
    visibility: "default",
    applicability: evidence.applicability,
    metadata: {
      ...evidence.metadata,
      relationGroup: evidence.relationGroup,
      relationValue: evidence.relationValue,
      topicKeys: evidence.topicKeys,
      sourceIdentity: evidence.sourceIdentity ?? evidence.id,
    },
  };
}

function edgeId(kind: string, left: string, right: string): string {
  return `edge:${kind}:${[left, right].sort().map(stablePart).join(":")}`;
}

function singletonCluster(
  node: MemoryGraphNode,
  now: number,
): MemoryGraphClusterSnapshot {
  return {
    clusterId: `cluster:${stablePart(node.id)}`,
    ownerScope: node.ownerScope,
    nodeIds: [node.id],
    lifecycleStatus: "forming",
    supportScore: 0,
    updatedAt: now,
    reasonCodes: ["new_evidence_cluster"],
    applicability: node.applicability,
  };
}

function cloneCluster(
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

function operationId(planId: string, kind: string, id: string): string {
  return `${planId}:${kind}:${stablePart(id)}`;
}

function buildPlanId(ownerScope: OwnerScope, evidenceIds: string[]): string {
  return `evolution:${ownerScopeKey(ownerScope)}:${evidenceIds
    .sort()
    .map(stablePart)
    .join("+")}`;
}

function errorInfo(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "Error", message: String(error) };
}

export function buildMemoryGraphEvolutionPlan(
  input: BuildMemoryGraphEvolutionPlanInput,
): MemoryGraphUpdatePlan {
  const existingNodeIds = new Set(input.snapshot.nodes.map((node) => node.id));
  const existingSourceIdentities = new Set(
    input.snapshot.nodes.map((node) => node.sourceId ?? node.id),
  );
  const candidateBySourceIdentity = new Map<
    string,
    MemoryGraphEvolutionEvidence
  >();
  for (const evidence of input.candidateEvidence) {
    if (!sameOwnerScope(evidence.ownerScope, input.ownerScope)) continue;
    const sourceIdentity = evidence.sourceIdentity ?? evidence.id;
    if (!candidateBySourceIdentity.has(sourceIdentity)) {
      candidateBySourceIdentity.set(sourceIdentity, evidence);
    }
  }
  const batchSourceIdentities = new Set<string>();
  const effectiveNewEvidence: MemoryGraphEvolutionEvidence[] = [];
  for (const evidence of input.newEvidence) {
    const sourceIdentity = evidence.sourceIdentity ?? evidence.id;
    if (!sameOwnerScope(evidence.ownerScope, input.ownerScope)) continue;
    if (existingSourceIdentities.has(sourceIdentity)) continue;
    if (batchSourceIdentities.has(sourceIdentity)) continue;
    batchSourceIdentities.add(sourceIdentity);
    const existingCandidate = candidateBySourceIdentity.get(sourceIdentity);
    const selectedEvidence = existingCandidate ?? evidence;
    if (existingNodeIds.has(selectedEvidence.id)) continue;
    effectiveNewEvidence.push(selectedEvidence);
  }
  const allEvidenceById = new Map<string, MemoryGraphEvolutionEvidence>();
  for (const evidence of input.candidateEvidence) {
    if (sameOwnerScope(evidence.ownerScope, input.ownerScope)) {
      allEvidenceById.set(evidence.id, evidence);
    }
  }
  for (const evidence of effectiveNewEvidence) {
    allEvidenceById.set(evidence.id, evidence);
  }

  const planId = buildPlanId(
    input.ownerScope,
    input.newEvidence.map((evidence) => evidence.sourceIdentity ?? evidence.id),
  );
  const newIds = new Set(effectiveNewEvidence.map((evidence) => evidence.id));
  const records = [...allEvidenceById.values()].map(evidenceToRecord);
  const candidates = buildMemoryRelationCandidates({
    records,
    getCandidateKeys: candidateKeys,
  }).filter(
    (candidate) =>
      newIds.has(candidate.fromRecordId) || newIds.has(candidate.toRecordId),
  );
  const evidenceById = allEvidenceById;
  const judgments = judgeMemoryRelationCandidates({
    records,
    candidates,
    now: input.now,
    judgeCandidate(candidate, context) {
      const left = evidenceById.get(candidate.fromRecordId);
      const right = evidenceById.get(candidate.toRecordId);
      if (!left || !right) {
        return {
          relation: "uncertain",
          weight: 0,
          reasonCodes: ["uncertain_candidate"],
        };
      }
      if (
        !applicabilityOverlaps(
          left.applicability,
          right.applicability,
          input.now,
        )
      ) {
        return {
          relation: "uncertain",
          weight: 0,
          reasonCodes: ["uncertain_candidate"],
        };
      }
      if (
        context.defaultDecision.relation === "support" &&
        !applicabilityEquivalent(left.applicability, right.applicability)
      ) {
        return {
          relation: "related",
          weight: 0.45,
          reasonCodes: ["candidate_related"],
        };
      }
      return context.defaultDecision;
    },
  }).judgments.filter((judgment) => judgment.relation !== "uncertain");

  const relevantEvidenceIds = new Set(
    effectiveNewEvidence.map((item) => item.id),
  );
  for (const judgment of judgments) {
    relevantEvidenceIds.add(judgment.candidate.fromRecordId);
    relevantEvidenceIds.add(judgment.candidate.toRecordId);
  }
  const candidateNodes = [...relevantEvidenceIds]
    .filter((id) => !existingNodeIds.has(id))
    .flatMap((id) => {
      const evidence = evidenceById.get(id);
      return evidence ? [graphNode(evidence)] : [];
    });
  const nodesById = new Map(
    input.snapshot.nodes.map((node) => [node.id, node]),
  );
  for (const node of candidateNodes) nodesById.set(node.id, node);

  const operations: MemoryGraphOperation[] = candidateNodes.map((node) => ({
    operationId: operationId(planId, "create-node", node.id),
    ownerScope: input.ownerScope,
    kind: "create-node",
    nodeIds: [node.id],
    reasonCodes: ["new_evidence_node"],
  }));
  const existingEdges = new Map(
    input.snapshot.edges.map((edge) => [edge.id, edge]),
  );
  const candidateEdges: MemoryGraphEdge[] = [];

  for (const judgment of judgments) {
    const kind = judgment.relation as "support" | "compete" | "related";
    const id = edgeId(
      kind,
      judgment.candidate.fromRecordId,
      judgment.candidate.toRecordId,
    );
    const previous = existingEdges.get(id);
    const evidenceNodeIds = unique([
      ...(previous?.evidenceNodeIds ?? []),
      ...[
        judgment.candidate.fromRecordId,
        judgment.candidate.toRecordId,
      ].filter((nodeId) => newIds.has(nodeId)),
    ]);
    const left = evidenceById.get(judgment.candidate.fromRecordId);
    const right = evidenceById.get(judgment.candidate.toRecordId);
    if (!left || !right) continue;
    const edge: MemoryGraphEdge = {
      id,
      ownerScope: input.ownerScope,
      fromNodeId: judgment.candidate.fromRecordId,
      toNodeId: judgment.candidate.toRecordId,
      kind,
      weight: previous
        ? Math.min(1, previous.weight + judgment.weight * 0.25)
        : judgment.weight,
      confidence: judgment.candidate.score,
      evidenceNodeIds,
      reasonCodes: unique([
        ...(previous?.reasonCodes ?? []),
        ...judgment.reasonCodes,
      ]),
      createdAt: previous?.createdAt ?? input.now,
      updatedAt: input.now,
      applicability: applicabilityEquivalent(
        left.applicability,
        right.applicability,
      )
        ? (left.applicability ?? right.applicability)
        : undefined,
      metadata: {
        candidateKeys: judgment.candidate.candidateKeys,
      },
    };
    candidateEdges.push(edge);
    operations.push({
      operationId: operationId(
        planId,
        previous ? "reinforce-edge" : "create-edge",
        id,
      ),
      ownerScope: input.ownerScope,
      kind: previous ? "reinforce-edge" : "create-edge",
      nodeIds: [edge.fromNodeId, edge.toNodeId],
      edgeIds: [id],
      reasonCodes: edge.reasonCodes,
    });
  }

  const clusters = new Map(
    input.snapshot.clusters.map((cluster) => [
      cluster.clusterId,
      cloneCluster(cluster),
    ]),
  );
  const clusterByNode = new Map<string, string>();
  for (const cluster of clusters.values()) {
    for (const nodeId of cluster.nodeIds)
      clusterByNode.set(nodeId, cluster.clusterId);
  }
  const touchedClusterIds = new Set<string>();
  for (const node of candidateNodes) {
    if (!clusterByNode.has(node.id)) {
      const cluster = singletonCluster(node, input.now);
      clusters.set(cluster.clusterId, cluster);
      clusterByNode.set(node.id, cluster.clusterId);
      touchedClusterIds.add(cluster.clusterId);
    }
  }

  for (const edge of candidateEdges.filter((item) => item.kind === "support")) {
    const leftClusterId = clusterByNode.get(edge.fromNodeId);
    const rightClusterId = clusterByNode.get(edge.toNodeId);
    if (!leftClusterId || !rightClusterId || leftClusterId === rightClusterId) {
      if (leftClusterId) touchedClusterIds.add(leftClusterId);
      continue;
    }
    const leftCluster = clusters.get(leftClusterId);
    const rightCluster = clusters.get(rightClusterId);
    if (!leftCluster || !rightCluster) continue;
    if (
      !applicabilityEquivalent(
        leftCluster.applicability,
        rightCluster.applicability,
      )
    ) {
      continue;
    }
    const target = input.snapshot.clusters.some(
      (cluster) => cluster.clusterId === rightClusterId,
    )
      ? rightCluster
      : leftCluster;
    const source =
      target.clusterId === leftClusterId ? rightCluster : leftCluster;
    target.nodeIds = unique([...target.nodeIds, ...source.nodeIds]);
    target.updatedAt = input.now;
    target.reasonCodes = unique([
      ...target.reasonCodes,
      "support_cluster_join",
    ]);
    for (const nodeId of source.nodeIds)
      clusterByNode.set(nodeId, target.clusterId);
    clusters.delete(source.clusterId);
    touchedClusterIds.delete(source.clusterId);
    touchedClusterIds.add(target.clusterId);
  }

  for (const edge of candidateEdges.filter((item) => item.kind === "compete")) {
    const leftClusterId = clusterByNode.get(edge.fromNodeId);
    const rightClusterId = clusterByNode.get(edge.toNodeId);
    if (!leftClusterId || !rightClusterId || leftClusterId === rightClusterId)
      continue;
    const competitionKey = `competition:${[leftClusterId, rightClusterId]
      .sort()
      .map(stablePart)
      .join(":")}`;
    for (const clusterId of [leftClusterId, rightClusterId]) {
      const cluster = clusters.get(clusterId);
      if (!cluster) continue;
      cluster.competitionKey = competitionKey;
      cluster.updatedAt = input.now;
      cluster.reasonCodes = unique([
        ...cluster.reasonCodes,
        "competition_preserved_before_supersession",
      ]);
      touchedClusterIds.add(clusterId);
    }
  }

  const allEdges = [...input.snapshot.edges, ...candidateEdges].reduce(
    (map, edge) => map.set(edge.id, edge),
    new Map<string, MemoryGraphEdge>(),
  );
  for (const clusterId of touchedClusterIds) {
    const cluster = clusters.get(clusterId);
    if (!cluster) continue;
    const nodeIds = new Set(cluster.nodeIds);
    const supportEdges = [...allEdges.values()].filter(
      (edge) =>
        edge.kind === "support" &&
        nodeIds.has(edge.fromNodeId) &&
        nodeIds.has(edge.toNodeId),
    );
    cluster.supportScore = supportEdges.length
      ? supportEdges.reduce((sum, edge) => sum + edge.weight, 0) /
        supportEdges.length
      : (cluster.supportScore ?? 0);
  }

  const candidateClusters = [...touchedClusterIds]
    .map((clusterId) => clusters.get(clusterId))
    .filter((cluster): cluster is MemoryGraphClusterSnapshot =>
      Boolean(cluster),
    );
  for (const cluster of candidateClusters) {
    operations.push({
      operationId: operationId(planId, "upsert-cluster", cluster.clusterId),
      ownerScope: input.ownerScope,
      kind: "upsert-cluster",
      nodeIds: [...cluster.nodeIds],
      clusterId: cluster.clusterId,
      reasonCodes: cluster.reasonCodes,
    });
  }

  return {
    planId,
    ownerScope: input.ownerScope,
    candidateNodes,
    candidateEdges,
    candidateClusters,
    operations,
    expectedVersion: input.snapshot.version ?? "0",
    persistence: input.persistence,
    reasonCodes: unique([
      "incremental_graph_evolution",
      ...(candidateEdges.some((edge) => edge.kind === "support")
        ? ["support_evidence_applied"]
        : []),
      ...(candidateEdges.some((edge) => edge.kind === "compete")
        ? ["competition_preserved_before_supersession"]
        : []),
      ...(operations.length === 0 ? ["no_new_graph_operations"] : []),
    ]),
    metadata: {
      consideredCandidateIds: unique(
        judgments.flatMap((judgment) => [
          judgment.candidate.fromRecordId,
          judgment.candidate.toRecordId,
        ]),
      ),
      newEvidenceIds: input.newEvidence.map((evidence) => evidence.id),
    },
  };
}

export async function runMemoryGraphEvolution(
  input: RunMemoryGraphEvolutionInput,
): Promise<MemoryGraphEvolutionRunResult> {
  if (input.enabled !== true) {
    return {
      status: "disabled",
      ownerScope: input.ownerScope,
      consideredCandidateIds: [],
      reasonCodes: ["memory_graph_evolution_disabled"],
    };
  }

  try {
    const now = input.now ?? Date.now();
    const snapshot = await input.store.readSnapshot({
      ownerScope: input.ownerScope,
      includeAuditOnly: true,
    });
    const plan = buildMemoryGraphEvolutionPlan({
      ownerScope: input.ownerScope,
      newEvidence: input.newEvidence,
      candidateEvidence: input.candidateEvidence,
      snapshot,
      now,
      persistence: {
        mode: input.dryRun ? "dry-run" : "write",
        enabled: !input.dryRun,
      },
    });
    const consideredCandidateIds = Array.isArray(
      plan.metadata?.consideredCandidateIds,
    )
      ? plan.metadata.consideredCandidateIds.filter(
          (value): value is string => typeof value === "string",
        )
      : [];

    if (input.dryRun) {
      return {
        status: "planned",
        ownerScope: input.ownerScope,
        plan,
        consideredCandidateIds,
        reasonCodes: unique([...plan.reasonCodes, "memory_graph_dry_run"]),
      };
    }

    const persistenceResult = await input.store.persistPlan(plan);
    const status: MemoryGraphEvolutionRunStatus = persistenceResult.conflict
      ? "conflict"
      : persistenceResult.mutatesGraph
        ? "applied"
        : "no-op";
    return {
      status,
      ownerScope: input.ownerScope,
      plan,
      persistenceResult,
      consideredCandidateIds,
      reasonCodes: unique([
        ...plan.reasonCodes,
        ...persistenceResult.diagnostics,
      ]),
    };
  } catch (error) {
    return {
      status: "failed",
      ownerScope: input.ownerScope,
      consideredCandidateIds: [],
      reasonCodes: ["memory_graph_evolution_failed"],
      error: errorInfo(error),
    };
  }
}
