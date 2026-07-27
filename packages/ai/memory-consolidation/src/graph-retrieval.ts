import type {
  GraphAwareRetrievalInput,
  GraphAwareRetrievalResult,
  GraphAwareRetriever,
  MemoryApplicabilityContext,
  MemoryGraphAuditTrail,
  MemoryGraphClusterSnapshot,
  MemoryGraphEdge,
  MemoryGraphNode,
  OwnerScope,
} from "./graph-contracts";
import {
  applicabilityEquivalent,
  buildMemoryGraphCompetitionComponents,
} from "./graph-evolution";

export interface BuildGraphAwareRetrievalDryRunInput extends GraphAwareRetrievalInput {
  maxExpandedRepresentatives?: number;
}

function ownerScopeKey(scope: OwnerScope): string {
  return `${scope.tenantId ?? ""}|${scope.workspaceId ?? ""}|${scope.userId}`;
}

function sameOwnerScope(left: OwnerScope, right: OwnerScope): boolean {
  return ownerScopeKey(left) === ownerScopeKey(right);
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function applicabilityIsActive(
  applicability: MemoryApplicabilityContext | undefined,
  now: number,
): boolean {
  if (applicability?.validFrom !== undefined && now < applicability.validFrom) {
    return false;
  }
  if (
    applicability?.validUntil !== undefined &&
    now > applicability.validUntil
  ) {
    return false;
  }
  return true;
}

/**
 * Retrieval is directional: global candidates are always eligible, while a
 * narrower candidate requires an exact trusted request scope/key match.
 */
export function applicabilityMatchesTrustedContexts(
  candidate: MemoryApplicabilityContext | undefined,
  trustedContexts: MemoryApplicabilityContext[] | undefined,
  now: number,
): boolean {
  if (!applicabilityIsActive(candidate, now)) return false;
  if (!candidate || candidate.scope === "global") return true;

  return (trustedContexts ?? []).some(
    (current) =>
      applicabilityIsActive(current, now) &&
      current.scope !== "global" &&
      current.scope === candidate.scope &&
      current.key === candidate.key,
  );
}

function scopedNodesById(
  nodes: MemoryGraphNode[],
  ownerScope: OwnerScope,
  applicabilityContexts: MemoryApplicabilityContext[] | undefined,
  now: number,
): Map<string, MemoryGraphNode> {
  return new Map(
    nodes
      .filter(
        (node) =>
          sameOwnerScope(node.ownerScope, ownerScope) &&
          applicabilityMatchesTrustedContexts(
            node.applicability,
            applicabilityContexts,
            now,
          ),
      )
      .map((node) => [node.id, node]),
  );
}

function scopedEdges(
  edges: MemoryGraphEdge[],
  ownerScope: OwnerScope,
  includeHistorical = false,
  applicabilityContexts?: MemoryApplicabilityContext[],
  now = Date.now(),
): MemoryGraphEdge[] {
  return edges.filter(
    (edge) =>
      sameOwnerScope(edge.ownerScope, ownerScope) &&
      applicabilityMatchesTrustedContexts(
        edge.applicability,
        applicabilityContexts,
        now,
      ) &&
      (includeHistorical ||
        (edge.weight > 0 &&
          edge.metadata?.inactive !== true &&
          edge.metadata?.rolledBack !== true)),
  );
}

function scopedClusters(
  clusters: MemoryGraphClusterSnapshot[],
  ownerScope: OwnerScope,
  applicabilityContexts: MemoryApplicabilityContext[] | undefined,
  now: number,
): MemoryGraphClusterSnapshot[] {
  return clusters.filter(
    (cluster) =>
      sameOwnerScope(cluster.ownerScope, ownerScope) &&
      applicabilityMatchesTrustedContexts(
        cluster.applicability,
        applicabilityContexts,
        now,
      ),
  );
}

function isSummaryLike(node: MemoryGraphNode | undefined): boolean {
  return node?.type === "summary" || node?.type === "artifact";
}

function isDeprecatedRaw(node: MemoryGraphNode | undefined): boolean {
  return (
    node?.type === "raw" &&
    (node.visibility === "deprecated" || node.visibility === "audit-only")
  );
}

function isAuditOnly(node: MemoryGraphNode | undefined): boolean {
  return node?.visibility === "audit-only";
}

function shouldHideByDefault(
  node: MemoryGraphNode | undefined,
  includeDeprecated: boolean,
  auditMode: boolean,
): boolean {
  if (node === undefined) {
    return true;
  }
  if (isAuditOnly(node) && !auditMode) {
    return true;
  }
  return node.visibility === "deprecated" && !includeDeprecated;
}

function uniqueExistingBaselineNodeIds(
  input: GraphAwareRetrievalInput,
  nodesById: Map<string, MemoryGraphNode>,
): string[] {
  return uniqueValues(input.baselineNodeIds).filter((nodeId) =>
    nodesById.has(nodeId),
  );
}

function clusterTouchesBaseline(
  cluster: MemoryGraphClusterSnapshot,
  baselineNodeIds: Set<string>,
): boolean {
  return cluster.nodeIds.some((nodeId) => baselineNodeIds.has(nodeId));
}

function strongestSupersedeTarget(
  nodeId: string,
  edges: MemoryGraphEdge[],
  nodesById: Map<string, MemoryGraphNode>,
): string | undefined {
  return edges
    .filter((edge) => edge.kind === "supersede" && edge.fromNodeId === nodeId)
    .filter((edge) => isSummaryLike(nodesById.get(edge.toNodeId)))
    .sort((left, right) => right.weight - left.weight)[0]?.toNodeId;
}

function representativeForCluster(
  cluster: MemoryGraphClusterSnapshot,
  edges: MemoryGraphEdge[],
  nodesById: Map<string, MemoryGraphNode>,
): string | undefined {
  if (isSummaryLike(nodesById.get(cluster.representativeNodeId ?? ""))) {
    return cluster.representativeNodeId;
  }

  return cluster.nodeIds
    .map((nodeId) => strongestSupersedeTarget(nodeId, edges, nodesById))
    .find((nodeId): nodeId is string => nodeId !== undefined);
}

function addUnique(target: string[], values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

function expandedRepresentatives(input: {
  baselineNodeIds: string[];
  clusters: MemoryGraphClusterSnapshot[];
  edges: MemoryGraphEdge[];
  nodesById: Map<string, MemoryGraphNode>;
  maxExpandedRepresentatives?: number;
}): { nodeIds: string[]; clusterIds: string[] } {
  const baselineNodeIds = new Set(input.baselineNodeIds);
  const nodeIds: string[] = [];
  const clusterIds: string[] = [];

  for (const cluster of input.clusters) {
    if (!clusterTouchesBaseline(cluster, baselineNodeIds)) {
      continue;
    }

    const representativeNodeId = representativeForCluster(
      cluster,
      input.edges,
      input.nodesById,
    );
    if (representativeNodeId === undefined) {
      continue;
    }

    addUnique(nodeIds, [representativeNodeId]);
    addUnique(clusterIds, [cluster.clusterId]);
  }

  return {
    nodeIds: nodeIds.slice(
      0,
      Math.max(1, input.maxExpandedRepresentatives ?? nodeIds.length),
    ),
    clusterIds,
  };
}

function sameApplicability(
  left: MemoryGraphClusterSnapshot,
  right: MemoryGraphClusterSnapshot,
): boolean {
  return applicabilityEquivalent(left.applicability, right.applicability);
}

function conflictAlternatives(input: {
  ownerScope: OwnerScope;
  baselineNodeIds: string[];
  clusters: MemoryGraphClusterSnapshot[];
  edges: MemoryGraphEdge[];
  nodesById: Map<string, MemoryGraphNode>;
}): { nodeIds: string[]; clusterIds: string[] } {
  const baseline = new Set(input.baselineNodeIds);
  const touched = input.clusters.filter((cluster) =>
    clusterTouchesBaseline(cluster, baseline),
  );
  const componentByClusterId = new Map(
    buildMemoryGraphCompetitionComponents({
      ownerScope: input.ownerScope,
      clusters: input.clusters,
      edges: input.edges,
    }).flatMap((component) =>
      component.clusters.map(
        (cluster) => [cluster.clusterId, component] as const,
      ),
    ),
  );
  const nodeIds: string[] = [];
  const clusterIds: string[] = [];
  for (const sourceCluster of touched) {
    const component = componentByClusterId.get(sourceCluster.clusterId);
    if (!component) continue;
    const candidates = component.clusters.filter(
      (candidate) =>
        candidate.clusterId !== sourceCluster.clusterId &&
        sameApplicability(candidate, sourceCluster),
    );
    for (const candidate of candidates) {
      const representative = representativeForCluster(
        candidate,
        input.edges,
        input.nodesById,
      );
      const alternative =
        representative ??
        candidate.nodeIds.find((nodeId) => input.nodesById.has(nodeId));
      if (alternative) addUnique(nodeIds, [alternative]);
      addUnique(clusterIds, [candidate.clusterId]);
    }
  }
  return { nodeIds, clusterIds };
}

function supersedeTargetsForHiddenNodes(
  hiddenNodeIds: string[],
  edges: MemoryGraphEdge[],
  nodesById: Map<string, MemoryGraphNode>,
): string[] {
  return uniqueValues(
    hiddenNodeIds
      .map((nodeId) => strongestSupersedeTarget(nodeId, edges, nodesById))
      .filter((nodeId): nodeId is string => nodeId !== undefined),
  );
}

function rankNodeIds(input: {
  visibleBaselineNodeIds: string[];
  includeDeprecated: boolean;
  representativeNodeIds: string[];
  supersedeTargetNodeIds: string[];
  nodesById: Map<string, MemoryGraphNode>;
}): string[] {
  const ranked: string[] = [];
  const summaryBaselineIds = input.visibleBaselineNodeIds.filter((nodeId) =>
    isSummaryLike(input.nodesById.get(nodeId)),
  );
  const rawBaselineIds = input.visibleBaselineNodeIds.filter(
    (nodeId) => !isSummaryLike(input.nodesById.get(nodeId)),
  );

  addUnique(ranked, input.representativeNodeIds);
  addUnique(ranked, input.supersedeTargetNodeIds);
  addUnique(ranked, summaryBaselineIds);
  addUnique(ranked, rawBaselineIds);

  return ranked;
}

function metadataStringArray(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string[] {
  const value = metadata?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function supersededByNodeId(node: MemoryGraphNode): string | undefined {
  return metadataString(node.metadata, "supersededByNodeId");
}

function auditTrailForNode(input: {
  nodeId: string;
  nodesById: Map<string, MemoryGraphNode>;
  edges: MemoryGraphEdge[];
  ownerScope: OwnerScope;
}): MemoryGraphAuditTrail | undefined {
  const node = input.nodesById.get(input.nodeId);
  if (node === undefined) {
    return undefined;
  }

  const incomingSupersedeEdges = input.edges.filter(
    (edge) => edge.kind === "supersede" && edge.toNodeId === input.nodeId,
  );
  const outgoingSupersedeEdges = input.edges.filter(
    (edge) => edge.kind === "supersede" && edge.fromNodeId === input.nodeId,
  );
  const competitionEdges = input.edges.filter(
    (edge) =>
      edge.kind === "compete" &&
      (edge.fromNodeId === input.nodeId || edge.toNodeId === input.nodeId),
  );
  const metadataSources = [...input.nodesById.values()]
    .filter((candidate) => supersededByNodeId(candidate) === input.nodeId)
    .map((candidate) => candidate.id);
  const selfSource = isDeprecatedRaw(node) ? [node.id] : [];
  const sourceNodeIds = uniqueValues([
    ...incomingSupersedeEdges.map((edge) => edge.fromNodeId),
    ...competitionEdges.flatMap((edge) => [
      edge.fromNodeId === input.nodeId ? edge.toNodeId : edge.fromNodeId,
      ...edge.evidenceNodeIds,
    ]),
    ...metadataSources,
    ...selfSource,
  ]).filter(
    (sourceNodeId) => input.nodesById.get(sourceNodeId)?.type === "raw",
  );
  const edgeIds = uniqueValues([
    ...incomingSupersedeEdges.map((edge) => edge.id),
    ...outgoingSupersedeEdges.map((edge) => edge.id),
    ...competitionEdges.map((edge) => edge.id),
  ]);
  const reasonCodes = uniqueValues([
    "graph_retrieval_audit_trail",
    ...incomingSupersedeEdges.flatMap((edge) => edge.reasonCodes),
    ...outgoingSupersedeEdges.flatMap((edge) => edge.reasonCodes),
    ...competitionEdges.flatMap((edge) => edge.reasonCodes),
    ...metadataStringArray(node.metadata, "deprecationReasonCodes"),
    ...(competitionEdges.length > 0
      ? ["competing_alternative_provenance"]
      : []),
    ...(isDeprecatedRaw(node) ? ["deprecated_raw_included"] : []),
  ]);

  if (sourceNodeIds.length === 0 && edgeIds.length === 0) {
    return undefined;
  }

  return {
    ownerScope: input.ownerScope,
    nodeId: input.nodeId,
    sourceNodeIds,
    edgeIds,
    operationIds: [],
    reasonCodes,
    metadata: {
      generatedBy: "graph_retrieval_dry_run",
    },
  };
}

function buildAuditTrails(input: {
  auditNodeIds: string[];
  nodesById: Map<string, MemoryGraphNode>;
  edges: MemoryGraphEdge[];
  ownerScope: OwnerScope;
}): MemoryGraphAuditTrail[] {
  return input.auditNodeIds
    .map((nodeId) =>
      auditTrailForNode({
        nodeId,
        nodesById: input.nodesById,
        edges: input.edges,
        ownerScope: input.ownerScope,
      }),
    )
    .filter((trail): trail is MemoryGraphAuditTrail => trail !== undefined);
}

function reasonCodesForResult(input: {
  hiddenDeprecatedNodeIds: string[];
  expandedClusterIds: string[];
  auditTrailCount: number;
  includeDeprecated: boolean;
  conflictAlternativesExposed: boolean;
  filteredMissingOrCrossScopeCount: number;
}): string[] {
  return uniqueValues([
    "graph_retrieval_dry_run",
    ...(input.hiddenDeprecatedNodeIds.length > 0
      ? ["default_hides_deprecated_raw"]
      : []),
    ...(input.includeDeprecated ? ["include_deprecated_requested"] : []),
    ...(input.conflictAlternativesExposed
      ? ["competing_alternatives_exposed"]
      : []),
    ...(input.expandedClusterIds.length > 0
      ? ["cluster_representative_prioritized"]
      : []),
    ...(input.auditTrailCount > 0 ? ["audit_trail_available"] : []),
    ...(input.filteredMissingOrCrossScopeCount > 0
      ? ["missing_or_cross_scope_nodes_filtered"]
      : []),
  ]);
}

export function buildGraphAwareRetrievalDryRun(
  input: BuildGraphAwareRetrievalDryRunInput,
): GraphAwareRetrievalResult {
  const includeDeprecated = input.includeDeprecated === true;
  const auditMode = input.visibilityMode === "audit";
  const conflictMode = input.visibilityMode === "conflict";
  const applicabilityNow = input.snapshot.capturedAt ?? Date.now();
  const nodesById = scopedNodesById(
    input.snapshot.nodes,
    input.ownerScope,
    input.applicabilityContexts,
    applicabilityNow,
  );
  const edges = scopedEdges(
    input.snapshot.edges,
    input.ownerScope,
    false,
    input.applicabilityContexts,
    applicabilityNow,
  ).filter(
    (edge) => nodesById.has(edge.fromNodeId) && nodesById.has(edge.toNodeId),
  );
  const historicalEdges = scopedEdges(
    input.snapshot.edges,
    input.ownerScope,
    true,
    input.applicabilityContexts,
    applicabilityNow,
  ).filter(
    (edge) => nodesById.has(edge.fromNodeId) && nodesById.has(edge.toNodeId),
  );
  const clusters = scopedClusters(
    input.snapshot.clusters,
    input.ownerScope,
    input.applicabilityContexts,
    applicabilityNow,
  )
    .map((cluster) => ({
      ...cluster,
      nodeIds: cluster.nodeIds.filter((nodeId) => nodesById.has(nodeId)),
      representativeNodeId:
        cluster.representativeNodeId &&
        nodesById.has(cluster.representativeNodeId)
          ? cluster.representativeNodeId
          : undefined,
    }))
    .filter((cluster) => cluster.nodeIds.length > 0);
  const baselineNodeIds = uniqueExistingBaselineNodeIds(input, nodesById);
  const filteredMissingOrCrossScopeCount =
    uniqueValues(input.baselineNodeIds).length - baselineNodeIds.length;
  const hiddenDeprecatedNodeIds = baselineNodeIds.filter((nodeId) => {
    const node = nodesById.get(nodeId);
    return (
      isDeprecatedRaw(node) &&
      shouldHideByDefault(node, includeDeprecated, auditMode)
    );
  });
  const visibleBaselineNodeIds = baselineNodeIds.filter(
    (nodeId) =>
      !shouldHideByDefault(nodesById.get(nodeId), includeDeprecated, auditMode),
  );
  const representativeExpansion = expandedRepresentatives({
    baselineNodeIds,
    clusters,
    edges,
    nodesById,
    maxExpandedRepresentatives: input.maxExpandedRepresentatives,
  });
  const supersedeTargetNodeIds = supersedeTargetsForHiddenNodes(
    hiddenDeprecatedNodeIds,
    edges,
    nodesById,
  );
  const conflictExpansion = conflictMode
    ? conflictAlternatives({
        ownerScope: input.ownerScope,
        baselineNodeIds,
        clusters,
        edges,
        nodesById,
      })
    : { nodeIds: [], clusterIds: [] };
  const allowedConflictNodeIds = new Set(conflictExpansion.nodeIds);
  const rankedNodeIds = rankNodeIds({
    visibleBaselineNodeIds,
    includeDeprecated,
    representativeNodeIds: uniqueValues([
      ...representativeExpansion.nodeIds,
      ...conflictExpansion.nodeIds,
    ]),
    supersedeTargetNodeIds,
    nodesById,
  }).filter(
    (nodeId) =>
      allowedConflictNodeIds.has(nodeId) ||
      !shouldHideByDefault(nodesById.get(nodeId), includeDeprecated, auditMode),
  );
  const auditNodeIds =
    auditMode || conflictMode || includeDeprecated
      ? uniqueValues([
          ...rankedNodeIds,
          ...hiddenDeprecatedNodeIds,
          ...supersedeTargetNodeIds,
        ])
      : [];
  const auditTrail =
    auditNodeIds.length > 0
      ? buildAuditTrails({
          auditNodeIds,
          nodesById,
          edges: historicalEdges,
          ownerScope: input.ownerScope,
        })
      : undefined;

  return {
    ownerScope: input.ownerScope,
    rankedNodeIds,
    hiddenDeprecatedNodeIds: includeDeprecated ? [] : hiddenDeprecatedNodeIds,
    expandedClusterIds: uniqueValues([
      ...representativeExpansion.clusterIds,
      ...conflictExpansion.clusterIds,
    ]),
    auditTrail,
    reasonCodes: reasonCodesForResult({
      hiddenDeprecatedNodeIds: includeDeprecated ? [] : hiddenDeprecatedNodeIds,
      expandedClusterIds: uniqueValues([
        ...representativeExpansion.clusterIds,
        ...conflictExpansion.clusterIds,
      ]),
      auditTrailCount: auditTrail?.length ?? 0,
      includeDeprecated,
      conflictAlternativesExposed: conflictExpansion.nodeIds.length > 0,
      filteredMissingOrCrossScopeCount,
    }),
    metadata: {
      ...(input.metadata ?? {}),
      baselineNodeCount: input.baselineNodeIds.length,
      rankedNodeCount: rankedNodeIds.length,
      query: input.query,
      visibilityMode: input.visibilityMode,
    },
  };
}

export function createGraphAwareRetrievalDryRunRetriever(
  options: Omit<
    BuildGraphAwareRetrievalDryRunInput,
    | "ownerScope"
    | "query"
    | "baselineNodeIds"
    | "snapshot"
    | "visibilityMode"
    | "includeDeprecated"
    | "metadata"
  > = {},
): GraphAwareRetriever {
  return {
    async compare(input) {
      return buildGraphAwareRetrievalDryRun({
        ...options,
        ...input,
      });
    },
  };
}
