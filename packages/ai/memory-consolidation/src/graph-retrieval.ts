import type {
  GraphAwareRetrievalInput,
  GraphAwareRetrievalResult,
  GraphAwareRetriever,
  MemoryGraphAuditTrail,
  MemoryGraphClusterSnapshot,
  MemoryGraphEdge,
  MemoryGraphNode,
  OwnerScope,
} from "./graph-contracts";

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

function scopedNodesById(
  nodes: MemoryGraphNode[],
  ownerScope: OwnerScope,
): Map<string, MemoryGraphNode> {
  return new Map(
    nodes
      .filter((node) => sameOwnerScope(node.ownerScope, ownerScope))
      .map((node) => [node.id, node]),
  );
}

function scopedEdges(
  edges: MemoryGraphEdge[],
  ownerScope: OwnerScope,
): MemoryGraphEdge[] {
  return edges.filter((edge) => sameOwnerScope(edge.ownerScope, ownerScope));
}

function scopedClusters(
  clusters: MemoryGraphClusterSnapshot[],
  ownerScope: OwnerScope,
): MemoryGraphClusterSnapshot[] {
  return clusters.filter((cluster) =>
    sameOwnerScope(cluster.ownerScope, ownerScope),
  );
}

function isSummaryLike(node: MemoryGraphNode | undefined): boolean {
  return node?.type === "summary" || node?.type === "artifact";
}

function isDeprecatedRaw(node: MemoryGraphNode | undefined): boolean {
  return node?.type === "raw" && node.visibility === "deprecated";
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
  return isDeprecatedRaw(node) && !includeDeprecated;
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
  const metadataSources = [...input.nodesById.values()]
    .filter((candidate) => supersededByNodeId(candidate) === input.nodeId)
    .map((candidate) => candidate.id);
  const selfSource = isDeprecatedRaw(node) ? [node.id] : [];
  const sourceNodeIds = uniqueValues([
    ...incomingSupersedeEdges.map((edge) => edge.fromNodeId),
    ...metadataSources,
    ...selfSource,
  ]).filter((sourceNodeId) => input.nodesById.has(sourceNodeId));
  const edgeIds = uniqueValues([
    ...incomingSupersedeEdges.map((edge) => edge.id),
    ...outgoingSupersedeEdges.map((edge) => edge.id),
  ]);
  const reasonCodes = uniqueValues([
    "graph_retrieval_audit_trail",
    ...incomingSupersedeEdges.flatMap((edge) => edge.reasonCodes),
    ...outgoingSupersedeEdges.flatMap((edge) => edge.reasonCodes),
    ...metadataStringArray(node.metadata, "deprecationReasonCodes"),
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
  filteredMissingOrCrossScopeCount: number;
}): string[] {
  return uniqueValues([
    "graph_retrieval_dry_run",
    ...(input.hiddenDeprecatedNodeIds.length > 0
      ? ["default_hides_deprecated_raw"]
      : []),
    ...(input.includeDeprecated ? ["include_deprecated_requested"] : []),
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
  const nodesById = scopedNodesById(input.snapshot.nodes, input.ownerScope);
  const edges = scopedEdges(input.snapshot.edges, input.ownerScope);
  const clusters = scopedClusters(input.snapshot.clusters, input.ownerScope);
  const baselineNodeIds = uniqueExistingBaselineNodeIds(input, nodesById);
  const filteredMissingOrCrossScopeCount =
    uniqueValues(input.baselineNodeIds).length - baselineNodeIds.length;
  const hiddenDeprecatedNodeIds = baselineNodeIds.filter((nodeId) =>
    isDeprecatedRaw(nodesById.get(nodeId)),
  );
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
  const rankedNodeIds = rankNodeIds({
    visibleBaselineNodeIds,
    includeDeprecated,
    representativeNodeIds: representativeExpansion.nodeIds,
    supersedeTargetNodeIds,
    nodesById,
  }).filter(
    (nodeId) =>
      !shouldHideByDefault(nodesById.get(nodeId), includeDeprecated, auditMode),
  );
  const auditNodeIds =
    auditMode || includeDeprecated
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
          edges,
          ownerScope: input.ownerScope,
        })
      : undefined;

  return {
    ownerScope: input.ownerScope,
    rankedNodeIds,
    hiddenDeprecatedNodeIds: includeDeprecated ? [] : hiddenDeprecatedNodeIds,
    expandedClusterIds: representativeExpansion.clusterIds,
    auditTrail,
    reasonCodes: reasonCodesForResult({
      hiddenDeprecatedNodeIds: includeDeprecated ? [] : hiddenDeprecatedNodeIds,
      expandedClusterIds: representativeExpansion.clusterIds,
      auditTrailCount: auditTrail?.length ?? 0,
      includeDeprecated,
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
