import type {
  GraphAwareRetrievalResult,
  GraphAwareRetriever,
  MemoryGraphSnapshot,
  OwnerScope,
} from "@openloomi/memory-consolidation/graph-contracts";
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
  hitToNodeId?: (hit: MemorySearchHit) => string | undefined;
  queryText?: (query: MemoryQueryGraphRetrievalQuery) => string;
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

function sameOwnerScope(left: OwnerScope, right: OwnerScope): boolean {
  return (
    left.userId === right.userId &&
    (left.workspaceId ?? "") === (right.workspaceId ?? "") &&
    (left.tenantId ?? "") === (right.tenantId ?? "")
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

function graphOrderedHits(input: {
  baselineHits: MemorySearchHit[];
  hitNodePairs: Array<{ hit: MemorySearchHit; nodeId: string; index: number }>;
  result: MemorySearchGraphRetrievalResult;
  snapshot: MemoryGraphSnapshot;
  ownerScope: OwnerScope;
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
  const hiddenNodeIds = new Set(
    input.result.hiddenDeprecatedNodeIds.filter((nodeId) =>
      coveredNodeIds.has(nodeId),
    ),
  );
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

  if (!options.retriever) {
    return graphNoOp({
      baselineHits: input.baselineHits,
      pageSize: input.pageSize,
      reasonCodes: ["graph_retrieval_missing_retriever"],
    });
  }
  if (!options.snapshotProvider) {
    return graphNoOp({
      baselineHits: input.baselineHits,
      pageSize: input.pageSize,
      reasonCodes: ["graph_retrieval_missing_snapshot_provider"],
    });
  }

  try {
    const ownerScope = resolveOwnerScope(input.query, options);
    const hitToNodeId = options.hitToNodeId ?? defaultHitToNodeId;
    const hitNodePairs = input.baselineHits
      .map((hit, index) => ({
        hit,
        index,
        nodeId: hitToNodeId(hit),
      }))
      .filter(
        (
          pair,
        ): pair is { hit: MemorySearchHit; nodeId: string; index: number } =>
          typeof pair.nodeId === "string" && pair.nodeId.length > 0,
      );
    const baselineNodeIds = hitNodePairs.map((pair) => pair.nodeId);

    if (baselineNodeIds.length === 0) {
      return graphNoOp({
        baselineHits: input.baselineHits,
        pageSize: input.pageSize,
        reasonCodes: ["graph_retrieval_no_baseline_node_ids"],
      });
    }

    const snapshot = await options.snapshotProvider({
      ownerScope,
      query: input.query,
      baselineHits: input.baselineHits,
      baselineNodeIds,
    });

    if (!snapshot) {
      return graphNoOp({
        baselineHits: input.baselineHits,
        pageSize: input.pageSize,
        reasonCodes: ["graph_retrieval_snapshot_unavailable"],
      });
    }

    const graphResult = await options.retriever.compare({
      ownerScope,
      query: (options.queryText ?? defaultGraphQueryText)(input.query),
      baselineNodeIds,
      snapshot,
      visibilityMode: input.query.includeDeprecated ? "audit" : "default",
      includeDeprecated: input.query.includeDeprecated,
      metadata: {
        source: "memory_query_api",
        pageSize: input.pageSize,
      },
    });

    if (!sameOwnerScope(graphResult.ownerScope, ownerScope)) {
      return graphNoOp({
        baselineHits: input.baselineHits,
        pageSize: input.pageSize,
        reasonCodes: ["graph_retrieval_owner_scope_mismatch"],
      });
    }

    const result = toMemorySearchGraphRetrievalResult(graphResult);

    return {
      items: graphOrderedHits({
        baselineHits: input.baselineHits,
        hitNodePairs,
        result,
        snapshot,
        ownerScope,
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
      items: input.baselineHits.slice(0, input.pageSize),
      diagnostic: {
        status: "failed",
        reasonCodes: ["graph_retrieval_failed"],
        error: errorInfo(error),
      },
    };
  }
}
