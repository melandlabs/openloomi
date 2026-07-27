import type {
  GraphAwareRetrievalResult,
  GraphAwareRetriever,
  MemoryApplicabilityContext,
  MemoryGraphSnapshot,
  OwnerScope,
} from "@openloomi/memory-consolidation/graph-contracts";
import {
  applicabilityEquivalent,
  sameOwnerScope,
} from "../../memory-consolidation/src/graph-evolution";
import { applicabilityMatchesTrustedContexts } from "../../memory-consolidation/src/graph-retrieval";
import type {
  MemorySearchGraphRetrievalDiagnostic,
  MemorySearchGraphRetrievalResult,
  MemorySearchHit,
  MemorySearchQuery,
} from "./contracts";

export interface MemoryQueryGraphRetrievalQuery extends MemorySearchQuery {
  minRawResultsWithoutFallback?: number;
}

export interface MemoryQueryGraphRetrievalSnapshotInput {
  ownerScope: OwnerScope;
  query: MemoryQueryGraphRetrievalQuery;
  baselineHits: MemorySearchHit[];
  baselineNodeIds: string[];
}

export interface MemoryQueryGraphRetrievalOptions {
  /**
   * Defaults to false. Graph-aware retrieval changes ranking only when the
   * caller opts in and provides the required graph capabilities.
   */
  enabled?: boolean;
  retriever?: GraphAwareRetriever;
  snapshotProvider?: (
    input: MemoryQueryGraphRetrievalSnapshotInput,
  ) =>
    | Promise<MemoryGraphSnapshot | undefined>
    | MemoryGraphSnapshot
    | undefined;
  ownerScope?:
    | OwnerScope
    | ((query: MemoryQueryGraphRetrievalQuery) => OwnerScope);
  /**
   * Trusted server-derived request scopes. Missing or empty is global-only.
   */
  applicabilityContexts?: MemoryApplicabilityContext[];
  hitToNodeId?: (hit: MemorySearchHit) => string | undefined;
  queryText?: (query: MemoryQueryGraphRetrievalQuery) => string;
  /**
   * Resolves graph-selected nodes absent from baseline semantic/keyword
   * retrieval. Incomplete materialization fails closed to the baseline.
   */
  materializeNodeIds?: (input: {
    ownerScope: OwnerScope;
    query: MemoryQueryGraphRetrievalQuery;
    snapshot: MemoryGraphSnapshot;
    nodeIds: string[];
    applicabilityContexts: MemoryApplicabilityContext[];
  }) => Promise<MemorySearchHit[] | undefined> | MemorySearchHit[] | undefined;
}

function defaultHitToNodeId(hit: MemorySearchHit): string {
  if (hit.sourceType === "summary") {
    return hit.summary.summaryId;
  }

  const metadata = hit.record.metadata;
  const metadataGraphNodeId =
    metadata?.graphNodeId ?? metadata?.memoryGraphNodeId;
  return typeof metadataGraphNodeId === "string"
    ? metadataGraphNodeId
    : hit.record.id;
}

function resolveOwnerScope(
  query: MemoryQueryGraphRetrievalQuery,
  options: MemoryQueryGraphRetrievalOptions,
): OwnerScope {
  if (typeof options.ownerScope === "function") {
    return options.ownerScope(query);
  }
  return options.ownerScope ?? { userId: query.userId };
}

function defaultGraphQueryText(query: MemoryQueryGraphRetrievalQuery): string {
  return query.keywords?.join(" ") ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function storedApplicability(
  hit: MemorySearchHit,
): MemoryApplicabilityContext | undefined {
  if (hit.sourceType === "summary") return undefined;
  const stored = hit.record.metadata?.memoryApplicability;
  if (isRecord(stored) && typeof stored.scope === "string") {
    const allowedScopes = new Set([
      "global",
      "task",
      "conversation",
      "channel",
      "project",
      "custom",
    ]);
    if (allowedScopes.has(stored.scope)) {
      return {
        scope: stored.scope as MemoryApplicabilityContext["scope"],
        key: optionalString(stored.key),
        validFrom:
          typeof stored.validFrom === "number" ? stored.validFrom : undefined,
        validUntil:
          typeof stored.validUntil === "number" ? stored.validUntil : undefined,
      };
    }
  }

  const channel = optionalString(hit.record.dimensions?.channel);
  const platform = optionalString(hit.record.dimensions?.platform);
  return channel
    ? { scope: "channel", key: `${platform ?? ""}:${channel}` }
    : { scope: "global" };
}

function applicabilityFilteredHitNodePairs(input: {
  pairs: Array<{ hit: MemorySearchHit; nodeId: string; index: number }>;
  snapshot?: MemoryGraphSnapshot;
  trustedContexts: MemoryApplicabilityContext[];
}): Array<{ hit: MemorySearchHit; nodeId: string; index: number }> {
  const nodesById = new Map(
    input.snapshot?.nodes.map((node) => [node.id, node]) ?? [],
  );
  const now = input.snapshot?.capturedAt ?? Date.now();
  return input.pairs.filter((pair) => {
    const node = nodesById.get(pair.nodeId);
    if (node) {
      return applicabilityMatchesTrustedContexts(
        node.applicability,
        input.trustedContexts,
        now,
      );
    }
    if (pair.hit.sourceType === "summary") {
      // Summary persistence has no applicability field; without a graph node,
      // its scope cannot be proven and must fail closed.
      return false;
    }
    return applicabilityMatchesTrustedContexts(
      storedApplicability(pair.hit),
      input.trustedContexts,
      now,
    );
  });
}

function queryMatchesOwnerScope(
  query: MemoryQueryGraphRetrievalQuery,
  ownerScope: OwnerScope,
): boolean {
  if (query.userId !== ownerScope.userId) return false;
  const workspaceId = optionalString(query.dimensions?.workspaceId);
  const tenantId = optionalString(query.dimensions?.tenantId);
  return (
    (workspaceId === undefined || workspaceId === ownerScope.workspaceId) &&
    (tenantId === undefined || tenantId === ownerScope.tenantId)
  );
}

function hitOwnerScope(hit: MemorySearchHit): OwnerScope {
  const dimensions =
    hit.sourceType === "raw" ? hit.record.dimensions : hit.summary.dimensions;
  const storedScope =
    hit.sourceType === "raw"
      ? hit.record.metadata?.memoryOwnerScope
      : undefined;
  const scopedMetadata = isRecord(storedScope) ? storedScope : undefined;
  return {
    userId: hit.sourceType === "raw" ? hit.record.userId : hit.summary.userId,
    workspaceId:
      optionalString(scopedMetadata?.workspaceId) ??
      optionalString(dimensions?.workspaceId),
    tenantId:
      optionalString(scopedMetadata?.tenantId) ??
      optionalString(dimensions?.tenantId),
  };
}

function persistedHitMatchesSnapshot(input: {
  hit: MemorySearchHit;
  node: MemoryGraphSnapshot["nodes"][number];
  ownerScope: OwnerScope;
}): boolean {
  if (
    !sameOwnerScope(input.node.ownerScope, input.ownerScope) ||
    !sameOwnerScope(hitOwnerScope(input.hit), input.node.ownerScope)
  ) {
    return false;
  }
  if (input.node.type !== "raw") {
    if (input.hit.sourceType !== "summary") return false;
    const graphRevision = input.node.metadata?.publicationRevision;
    if (typeof graphRevision !== "string" || graphRevision.length === 0) {
      return true;
    }
    return (
      input.hit.summary.dimensions?.__openloomiMemoryPublicationRevision ===
      graphRevision
    );
  }
  if (input.hit.sourceType !== "raw") return false;
  if (
    !applicabilityEquivalent(
      storedApplicability(input.hit),
      input.node.applicability,
    )
  ) {
    return false;
  }

  const graphDeprecated = input.node.visibility !== "default";
  const persistedDeprecated = input.hit.record.deprecatedAt !== undefined;
  return graphDeprecated === persistedDeprecated;
}

function materializedHitMatchesSnapshot(input: {
  hit: MemorySearchHit;
  node: MemoryGraphSnapshot["nodes"][number];
  query: MemoryQueryGraphRetrievalQuery;
  ownerScope: OwnerScope;
}): boolean {
  if (!persistedHitMatchesSnapshot(input)) return false;
  if (input.hit.sourceType !== "raw") return true;
  if (input.hit.record.deprecatedAt === undefined) return true;
  return (
    input.query.includeDeprecated === true ||
    (input.query.conflictSensitive === true &&
      input.node.visibility === "audit-only")
  );
}
function graphCoveredBaselineNodeIds(input: {
  snapshot: MemoryGraphSnapshot;
  ownerScope: OwnerScope;
  baselineNodeIds: string[];
}): Set<string> {
  const baseline = new Set(input.baselineNodeIds);
  const covered = new Set<string>();
  for (const node of input.snapshot.nodes) {
    if (!baseline.has(node.id)) continue;
    if (!sameOwnerScope(node.ownerScope, input.ownerScope)) continue;
    covered.add(node.id);
  }
  return covered;
}

function shouldHideGraphVisibility(
  visibility: MemoryGraphSnapshot["nodes"][number]["visibility"],
  includeDeprecated: boolean,
): boolean {
  if (includeDeprecated) return false;
  return visibility === "deprecated" || visibility === "audit-only";
}

function graphOrderedHits(input: {
  baselineHits: MemorySearchHit[];
  hitNodePairs: Array<{ hit: MemorySearchHit; nodeId: string; index: number }>;
  result: MemorySearchGraphRetrievalResult;
  snapshot: MemoryGraphSnapshot;
  ownerScope: OwnerScope;
  includeDeprecated: boolean;
  pageSize: number;
}): MemorySearchHit[] {
  const coveredNodeIds = graphCoveredBaselineNodeIds({
    snapshot: input.snapshot,
    ownerScope: input.ownerScope,
    baselineNodeIds: input.hitNodePairs.map((pair) => pair.nodeId),
  });
  const rankedNodeIds = new Set(
    input.result.rankedNodeIds.filter((nodeId) => coveredNodeIds.has(nodeId)),
  );
  const hiddenNodeIds = new Set([
    ...input.result.hiddenDeprecatedNodeIds.filter((nodeId) =>
      coveredNodeIds.has(nodeId),
    ),
    ...input.snapshot.nodes
      .filter(
        (node) =>
          coveredNodeIds.has(node.id) &&
          shouldHideGraphVisibility(node.visibility, input.includeDeprecated),
      )
      .map((node) => node.id),
  ]);
  const pairedIndexes = new Set(input.hitNodePairs.map((pair) => pair.index));
  const usedIndexes = new Set<number>();
  const ordered: MemorySearchHit[] = [];

  for (const nodeId of input.result.rankedNodeIds) {
    if (!rankedNodeIds.has(nodeId)) continue;
    for (const pair of input.hitNodePairs) {
      if (pair.nodeId !== nodeId || usedIndexes.has(pair.index)) continue;
      ordered.push(pair.hit);
      usedIndexes.add(pair.index);
    }
  }

  for (const pair of input.hitNodePairs) {
    if (usedIndexes.has(pair.index)) continue;
    if (hiddenNodeIds.has(pair.nodeId)) continue;
    ordered.push(pair.hit);
    usedIndexes.add(pair.index);
  }

  for (let index = 0; index < input.baselineHits.length; index += 1) {
    if (usedIndexes.has(index)) continue;
    if (pairedIndexes.has(index)) continue;
    ordered.push(input.baselineHits[index]);
  }

  return ordered.slice(0, input.pageSize);
}

function graphNoOp(input: {
  baselineHits: MemorySearchHit[];
  pageSize: number;
  reasonCodes: string[];
}): {
  items: MemorySearchHit[];
  diagnostic: MemorySearchGraphRetrievalDiagnostic;
} {
  return {
    items: input.baselineHits.slice(0, input.pageSize),
    diagnostic: {
      status: "no-op",
      reasonCodes: input.reasonCodes,
    },
  };
}

function errorInfo(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }
  return {
    name: "Error",
    message: String(error),
  };
}

function toMemorySearchGraphRetrievalResult(
  result: GraphAwareRetrievalResult,
): MemorySearchGraphRetrievalResult {
  return {
    ownerScope: { ...result.ownerScope },
    rankedNodeIds: [...result.rankedNodeIds],
    hiddenDeprecatedNodeIds: [...result.hiddenDeprecatedNodeIds],
    expandedClusterIds: [...result.expandedClusterIds],
    auditTrail: result.auditTrail?.map((trail) => ({
      ownerScope: { ...trail.ownerScope },
      nodeId: trail.nodeId,
      sourceNodeIds: [...trail.sourceNodeIds],
      edgeIds: [...trail.edgeIds],
      operationIds: [...trail.operationIds],
      reasonCodes: [...trail.reasonCodes],
      metadata: trail.metadata ? { ...trail.metadata } : undefined,
    })),
    reasonCodes: [...result.reasonCodes],
    metadata: result.metadata ? { ...result.metadata } : undefined,
  };
}

export async function applyGraphAwareRetrieval(input: {
  options: MemoryQueryGraphRetrievalOptions | undefined;
  query: MemoryQueryGraphRetrievalQuery;
  baselineHits: MemorySearchHit[];
  pageSize: number;
}): Promise<
  | {
      items: MemorySearchHit[];
      diagnostic: MemorySearchGraphRetrievalDiagnostic;
    }
  | undefined
> {
  const options = input.options;
  if (options?.enabled !== true) {
    return undefined;
  }

  const trustedContexts = options.applicabilityContexts ?? [];
  const ownerScope = resolveOwnerScope(input.query, options);
  const hitToNodeId = options.hitToNodeId ?? defaultHitToNodeId;
  const allHitNodePairs = input.baselineHits
    .map((hit, index) => ({
      hit,
      index,
      nodeId: hitToNodeId(hit),
    }))
    .filter(
      (pair): pair is { hit: MemorySearchHit; nodeId: string; index: number } =>
        typeof pair.nodeId === "string" && pair.nodeId.length > 0,
    );
  const preliminaryPairs = applicabilityFilteredHitNodePairs({
    pairs: allHitNodePairs,
    trustedContexts,
  }).filter((pair) => sameOwnerScope(hitOwnerScope(pair.hit), ownerScope));
  const preliminaryBaselineHits = preliminaryPairs.map((pair) => pair.hit);
  let safeBaselineHits = preliminaryBaselineHits;

  if (!queryMatchesOwnerScope(input.query, ownerScope)) {
    return graphNoOp({
      baselineHits: preliminaryBaselineHits,
      pageSize: input.pageSize,
      reasonCodes: ["graph_retrieval_query_owner_scope_mismatch"],
    });
  }

  if (!options.retriever) {
    return graphNoOp({
      baselineHits: preliminaryBaselineHits,
      pageSize: input.pageSize,
      reasonCodes: ["graph_retrieval_missing_retriever"],
    });
  }
  if (!options.snapshotProvider) {
    return graphNoOp({
      baselineHits: preliminaryBaselineHits,
      pageSize: input.pageSize,
      reasonCodes: ["graph_retrieval_missing_snapshot_provider"],
    });
  }

  try {
    const allBaselineNodeIds = allHitNodePairs.map((pair) => pair.nodeId);

    if (allBaselineNodeIds.length === 0) {
      return graphNoOp({
        baselineHits: preliminaryBaselineHits,
        pageSize: input.pageSize,
        reasonCodes: ["graph_retrieval_no_baseline_node_ids"],
      });
    }

    const snapshot = await options.snapshotProvider({
      ownerScope,
      query: input.query,
      baselineHits: input.baselineHits,
      baselineNodeIds: allBaselineNodeIds,
    });

    if (!snapshot) {
      return graphNoOp({
        baselineHits: preliminaryBaselineHits,
        pageSize: input.pageSize,
        reasonCodes: [
          "graph_retrieval_snapshot_unavailable",
          "graph_retrieval_global_only_without_snapshot",
        ],
      });
    }
    if (!sameOwnerScope(snapshot.ownerScope, ownerScope)) {
      return graphNoOp({
        baselineHits: preliminaryBaselineHits,
        pageSize: input.pageSize,
        reasonCodes: ["graph_retrieval_snapshot_owner_scope_mismatch"],
      });
    }
    const hitNodePairs = applicabilityFilteredHitNodePairs({
      pairs: allHitNodePairs,
      snapshot,
      trustedContexts,
    });
    const scopedBaselineHits = hitNodePairs.map((pair) => pair.hit);
    const baselineNodeIds = hitNodePairs.map((pair) => pair.nodeId);
    if (baselineNodeIds.length === 0) {
      return graphNoOp({
        baselineHits: scopedBaselineHits,
        pageSize: input.pageSize,
        reasonCodes: ["graph_retrieval_no_applicable_baseline_node_ids"],
      });
    }
    const snapshotNodesById = new Map(
      snapshot.nodes.map((node) => [node.id, node]),
    );
    const consistentBaselinePairs = hitNodePairs.filter((pair) => {
      const node = snapshotNodesById.get(pair.nodeId);
      if (!sameOwnerScope(hitOwnerScope(pair.hit), ownerScope)) return false;
      if (!node) return pair.hit.sourceType === "raw";
      if (!sameOwnerScope(node.ownerScope, ownerScope)) return false;
      return persistedHitMatchesSnapshot({
        hit: pair.hit,
        node,
        ownerScope,
      });
    });
    const safeBaselinePairs = consistentBaselinePairs.filter((pair) => {
      const node = snapshotNodesById.get(pair.nodeId);
      if (!node) return true;
      return (
        input.query.includeDeprecated === true || node.visibility === "default"
      );
    });
    safeBaselineHits = safeBaselinePairs.map((pair) => pair.hit);
    const baselineSnapshotMismatch =
      consistentBaselinePairs.length !== hitNodePairs.length;
    if (baselineSnapshotMismatch) {
      return graphNoOp({
        baselineHits: safeBaselineHits,
        pageSize: input.pageSize,
        reasonCodes: ["graph_retrieval_baseline_snapshot_mismatch"],
      });
    }

    const visibilityMode = input.query.conflictSensitive
      ? "conflict"
      : input.query.includeDeprecated
        ? "audit"
        : "default";
    const graphResult = await options.retriever.compare({
      ownerScope,
      query: (options.queryText ?? defaultGraphQueryText)(input.query),
      baselineNodeIds,
      snapshot,
      applicabilityContexts: trustedContexts,
      visibilityMode,
      includeDeprecated: input.query.includeDeprecated,
      metadata: {
        source: "memory_query_api",
        pageSize: input.pageSize,
      },
    });

    if (!sameOwnerScope(graphResult.ownerScope, ownerScope)) {
      return graphNoOp({
        baselineHits: safeBaselineHits,
        pageSize: input.pageSize,
        reasonCodes: ["graph_retrieval_owner_scope_mismatch"],
      });
    }

    const result = toMemorySearchGraphRetrievalResult(graphResult);
    const applicabilityNow = snapshot.capturedAt ?? Date.now();
    const graphNodeMatchesApplicability = (nodeId: string): boolean => {
      const node = snapshotNodesById.get(nodeId);
      return (
        node !== undefined &&
        sameOwnerScope(node.ownerScope, ownerScope) &&
        applicabilityMatchesTrustedContexts(
          node.applicability,
          trustedContexts,
          applicabilityNow,
        )
      );
    };
    if (
      result.auditTrail?.some(
        (trail) =>
          !sameOwnerScope(trail.ownerScope, ownerScope) ||
          !graphNodeMatchesApplicability(trail.nodeId) ||
          trail.sourceNodeIds.some(
            (nodeId) => !graphNodeMatchesApplicability(nodeId),
          ),
      )
    ) {
      return graphNoOp({
        baselineHits: safeBaselineHits,
        pageSize: input.pageSize,
        reasonCodes: ["graph_retrieval_provenance_owner_scope_mismatch"],
      });
    }

    const provenanceNodeIds = new Set(
      result.auditTrail?.map((trail) => trail.nodeId) ?? [],
    );
    const conflictAlternativeNodeIds = new Set(
      result.auditTrail
        ?.filter((trail) =>
          trail.reasonCodes.includes("competing_alternative_provenance"),
        )
        .map((trail) => trail.nodeId) ?? [],
    );
    result.rankedNodeIds = result.rankedNodeIds.filter((nodeId) => {
      const node = snapshotNodesById.get(nodeId);
      if (!node || !graphNodeMatchesApplicability(nodeId)) return false;
      const visibility = node.visibility;
      return (
        input.query.includeDeprecated === true ||
        visibility === "default" ||
        (visibilityMode === "conflict" &&
          conflictAlternativeNodeIds.has(nodeId))
      );
    });
    const conflictExpandedNodeIds =
      visibilityMode === "conflict"
        ? result.rankedNodeIds.filter(
            (nodeId) => !baselineNodeIds.includes(nodeId),
          )
        : [];
    const requiresProvenance =
      visibilityMode === "audit" ||
      (visibilityMode === "conflict" &&
        (result.reasonCodes.includes("competing_alternatives_exposed") ||
          conflictAlternativeNodeIds.size > 0 ||
          conflictExpandedNodeIds.length > 0));
    if (
      requiresProvenance &&
      ((result.auditTrail?.length ?? 0) === 0 ||
        conflictExpandedNodeIds.some(
          (nodeId) => !provenanceNodeIds.has(nodeId),
        ))
    ) {
      return graphNoOp({
        baselineHits: safeBaselineHits,
        pageSize: input.pageSize,
        reasonCodes: ["graph_retrieval_provenance_unavailable"],
      });
    }
    const requiredNodeIds = uniqueNodeIds([
      ...result.rankedNodeIds,
      ...(input.query.includeDeprecated === true
        ? auditSourceNodeIds(result)
        : []),
    ]);
    if (
      requiredNodeIds.some((nodeId) => !graphNodeMatchesApplicability(nodeId))
    ) {
      return graphNoOp({
        baselineHits: safeBaselineHits,
        pageSize: input.pageSize,
        reasonCodes: ["graph_retrieval_applicability_scope_mismatch"],
      });
    }
    const materializedNodeIds = new Set(
      hitNodePairs.map((pair) => pair.nodeId),
    );
    const missingNodeIds = requiredNodeIds.filter(
      (nodeId) => !materializedNodeIds.has(nodeId),
    );
    let materializedHits: MemorySearchHit[] = [];
    if (missingNodeIds.length > 0) {
      if (!options.materializeNodeIds) {
        return graphNoOp({
          baselineHits: safeBaselineHits,
          pageSize: input.pageSize,
          reasonCodes: ["graph_retrieval_unmaterialized_graph_nodes"],
        });
      }
      const resolved = await options.materializeNodeIds({
        ownerScope,
        query: input.query,
        snapshot,
        nodeIds: missingNodeIds,
        applicabilityContexts: trustedContexts,
      });
      if (!resolved) {
        return graphNoOp({
          baselineHits: safeBaselineHits,
          pageSize: input.pageSize,
          reasonCodes: ["graph_retrieval_materialization_unavailable"],
        });
      }
      materializedHits = resolved;

      for (const hit of materializedHits) {
        const nodeId = hitToNodeId(hit);
        const node = nodeId ? snapshotNodesById.get(nodeId) : undefined;
        if (
          !nodeId ||
          !missingNodeIds.includes(nodeId) ||
          !node ||
          !sameOwnerScope(node.ownerScope, ownerScope) ||
          !graphNodeMatchesApplicability(nodeId) ||
          !materializedHitMatchesSnapshot({
            hit,
            node,
            query: input.query,
            ownerScope,
          })
        ) {
          return graphNoOp({
            baselineHits: safeBaselineHits,
            pageSize: input.pageSize,
            reasonCodes: ["graph_retrieval_materialization_invalid"],
          });
        }
        materializedNodeIds.add(nodeId);
      }
    }
    if (requiredNodeIds.some((nodeId) => !materializedNodeIds.has(nodeId))) {
      return graphNoOp({
        baselineHits: safeBaselineHits,
        pageSize: input.pageSize,
        reasonCodes: ["graph_retrieval_unmaterialized_graph_nodes"],
      });
    }
    const materializedPairs = materializedHits.map((hit, index) => ({
      hit,
      index: input.baselineHits.length + index,
      nodeId: hitToNodeId(hit),
    }));
    const combinedHitNodePairs = [...hitNodePairs, ...materializedPairs].filter(
      (pair): pair is { hit: MemorySearchHit; nodeId: string; index: number } =>
        typeof pair.nodeId === "string" && pair.nodeId.length > 0,
    );
    result.rankedNodeIds = requiredNodeIds;

    return {
      items: graphOrderedHits({
        baselineHits: safeBaselineHits,
        hitNodePairs: combinedHitNodePairs,
        result,
        snapshot,
        ownerScope,
        includeDeprecated: input.query.includeDeprecated === true,
        pageSize: input.pageSize,
      }),
      diagnostic: {
        status: "applied",
        reasonCodes: result.reasonCodes,
        result,
      },
    };
  } catch (error) {
    return {
      items: safeBaselineHits.slice(0, input.pageSize),
      diagnostic: {
        status: "failed",
        reasonCodes: ["graph_retrieval_failed"],
        error: errorInfo(error),
      },
    };
  }
}
function uniqueNodeIds(values: string[]): string[] {
  return [...new Set(values)];
}

function auditSourceNodeIds(
  result: MemorySearchGraphRetrievalResult,
): string[] {
  return uniqueNodeIds(
    result.auditTrail?.flatMap((trail) => trail.sourceNodeIds) ?? [],
  );
}
