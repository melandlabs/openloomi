import "server-only";

import type {
  NativeAgentDefaultMemoryContext,
  NativeAgentMemoryContextDiagnostic,
  NativeAgentMemoryRetrievalMode,
} from "@openloomi/ai/agent/native-runner";
import type {
  MemoryQueryGraphRetrievalOptions,
  MemorySearchHit,
} from "@openloomi/ai/memory";
import {
  type RawMessageGraphEvolutionStorage,
  createRawMessageMemoryGraphStore,
  materializeMemoryGraphNodeIds,
  queryMemoryWithFallback,
} from "@openloomi/indexeddb";
import {
  type MemoryApplicabilityContext,
  createGraphAwareRetrievalDryRunRetriever,
} from "@openloomi/memory-consolidation";

import { resolveMemoryGraphWritePolicy } from "@/lib/memory/memory-graph-write-policy";
import {
  type RawMessageStorageManagerWithSearch,
  getRawMessageManager,
  isRawMessageStorageAvailable,
} from "@/lib/memory/raw-message-store";

const DEFAULT_MEMORY_CONTEXT_PAGE_SIZE = 6;
const MAX_MEMORY_CONTEXT_ITEM_CHARS = 600;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function extractQueryKeywords(query: string): string[] | undefined {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  const keywords = unique(
    [...segmenter.segment(query.normalize("NFKC").toLocaleLowerCase())]
      .filter((segment) => segment.isWordLike)
      .map((segment) => segment.segment.trim())
      .filter((segment) => segment.length >= 2 && segment.length <= 64),
  ).slice(0, 8);

  return keywords.length > 0 ? keywords : undefined;
}

function memoryHitText(hit: MemorySearchHit): string | undefined {
  const text =
    hit.sourceType === "raw" ? hit.record.text : hit.summary.summaryText;
  if (!text) return undefined;

  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length <= MAX_MEMORY_CONTEXT_ITEM_CHARS
    ? compact
    : `${compact.slice(0, MAX_MEMORY_CONTEXT_ITEM_CHARS - 3)}...`;
}

function memoryHitNodeId(hit: MemorySearchHit): string {
  return hit.sourceType === "raw" ? hit.record.id : hit.summary.summaryId;
}

function formatMemoryContext(items: MemorySearchHit[]): {
  content?: string;
  sourceCount: number;
  materializedNodeIds: string[];
} {
  const materialized = items.flatMap((hit) => {
    const text = memoryHitText(hit);
    return text ? [{ nodeId: memoryHitNodeId(hit), text }] : [];
  });

  return {
    content:
      materialized.length > 0
        ? materialized.map(({ text }) => `- ${text}`).join("\n")
        : undefined,
    sourceCount: materialized.length,
    materializedNodeIds: unique(materialized.map(({ nodeId }) => nodeId)),
  };
}

function supportsGraphSnapshot(
  manager: RawMessageStorageManagerWithSearch,
): manager is RawMessageStorageManagerWithSearch &
  RawMessageGraphEvolutionStorage {
  return (
    typeof (manager as Partial<RawMessageGraphEvolutionStorage>)
      .getMessageById === "function"
  );
}

function graphRetrievalOptions(input: {
  manager: RawMessageStorageManagerWithSearch;
  userId: string;
  query: string;
  applicabilityContexts: MemoryApplicabilityContext[];
}): MemoryQueryGraphRetrievalOptions {
  const ownerScope = { userId: input.userId };
  const dryRunRetriever = createGraphAwareRetrievalDryRunRetriever();
  const options: MemoryQueryGraphRetrievalOptions = {
    enabled: true,
    retriever: dryRunRetriever,
    ownerScope,
    applicabilityContexts: input.applicabilityContexts,
    queryText: () => input.query,
  };

  if (!supportsGraphSnapshot(input.manager)) {
    return options;
  }

  const store = createRawMessageMemoryGraphStore({
    storage: input.manager,
    ownerScope,
  });
  options.retriever = {
    async compare(retrievalInput) {
      const result = await dryRunRetriever.compare(retrievalInput);
      const existingTrails = new Map(
        result.auditTrail?.map((trail) => [trail.nodeId, trail]) ?? [],
      );
      const auditNodeIds = unique([
        ...result.rankedNodeIds,
        ...result.hiddenDeprecatedNodeIds,
        ...(result.auditTrail?.flatMap((trail) => [
          trail.nodeId,
          ...trail.sourceNodeIds,
        ]) ?? []),
      ]);
      const persistedTrails = await Promise.all(
        auditNodeIds.map((nodeId) =>
          store.readAuditTrail({
            ownerScope: retrievalInput.ownerScope,
            nodeId,
            includeDeprecated: retrievalInput.includeDeprecated,
          }),
        ),
      );

      return {
        ...result,
        auditTrail: persistedTrails.map((persisted) => {
          const existing = existingTrails.get(persisted.nodeId);
          return {
            ownerScope: { ...persisted.ownerScope },
            nodeId: persisted.nodeId,
            sourceNodeIds: unique([
              ...(existing?.sourceNodeIds ?? []),
              ...persisted.sourceNodeIds,
            ]),
            edgeIds: unique([
              ...(existing?.edgeIds ?? []),
              ...persisted.edgeIds,
            ]),
            operationIds: unique([
              ...(existing?.operationIds ?? []),
              ...persisted.operationIds,
            ]),
            reasonCodes: unique([
              ...(existing?.reasonCodes ?? []),
              ...persisted.reasonCodes,
            ]),
            metadata: { ...existing?.metadata, ...persisted.metadata },
          };
        }),
      };
    },
  };
  options.snapshotProvider = async ({ ownerScope: requestedScope }) => {
    const snapshot = await store.readSnapshot({
      ownerScope: requestedScope,
      includeAuditOnly: true,
    });
    if (
      snapshot.nodes.length === 0 &&
      snapshot.edges.length === 0 &&
      snapshot.clusters.length === 0
    ) {
      return undefined;
    }
    return snapshot;
  };

  if (typeof input.manager.querySummaries === "function") {
    options.materializeNodeIds = ({
      ownerScope: requestedScope,
      snapshot,
      nodeIds,
      applicabilityContexts,
    }) =>
      materializeMemoryGraphNodeIds({
        manager: input.manager,
        ownerScope: requestedScope,
        snapshot,
        nodeIds,
        applicabilityContexts,
      });
  }

  return options;
}

function queryDiagnostic(input: {
  result: Awaited<ReturnType<typeof queryMemoryWithFallback>>;
  sourceCount: number;
  materializedNodeIds: string[];
  mode: NativeAgentMemoryRetrievalMode;
  policyReasonCodes: string[];
}): NativeAgentMemoryContextDiagnostic {
  const graph = input.result.graphRetrieval;
  const graphApplied = graph?.status === "applied";
  const materializedNodeIds = new Set(input.materializedNodeIds);
  const provenance = graphApplied
    ? graph.result?.auditTrail
        ?.filter((trail) => materializedNodeIds.has(trail.nodeId))
        .map((trail) => ({
          nodeId: trail.nodeId,
          sourceNodeIds: [...trail.sourceNodeIds],
          edgeIds: [...trail.edgeIds],
          operationIds: [...trail.operationIds],
          reasonCodes: [...trail.reasonCodes],
        }))
    : undefined;
  return {
    status: graphApplied ? "applied" : "baseline",
    reasonCodes: unique([
      ...input.policyReasonCodes,
      ...(graph?.reasonCodes ?? ["graph_retrieval_diagnostic_missing"]),
    ]),
    sourceCount: input.sourceCount,
    requestedMode: input.mode,
    appliedMode: graphApplied ? input.mode : "baseline",
    ...(graph ? { graphRetrievalStatus: graph.status } : {}),
    ...(graphApplied && input.materializedNodeIds.length > 0
      ? { materializedNodeIds: [...input.materializedNodeIds] }
      : {}),
    ...(provenance && provenance.length > 0 ? { provenance } : {}),
  };
}

function failureDiagnostic(
  reasonCodes: string[],
  mode: NativeAgentMemoryRetrievalMode,
): NativeAgentDefaultMemoryContext {
  return {
    diagnostic: {
      status: "failed",
      reasonCodes: unique(reasonCodes),
      sourceCount: 0,
      requestedMode: mode,
      appliedMode: "baseline",
    },
  };
}

export async function getControlledDefaultMemoryContext(input: {
  userId: string;
  query: string;
  mode?: NativeAgentMemoryRetrievalMode;
  applicabilityContexts?: MemoryApplicabilityContext[];
}): Promise<NativeAgentDefaultMemoryContext> {
  const mode = input.mode ?? "default";
  const policy = resolveMemoryGraphWritePolicy(input.userId);
  if (!policy.enabled) {
    return {
      diagnostic: {
        status: "no-op",
        reasonCodes: unique([
          "native_agent_memory_context_policy_disabled",
          ...policy.reasonCodes,
        ]),
        sourceCount: 0,
        requestedMode: mode,
        appliedMode: "baseline",
      },
    };
  }

  const query = input.query.trim();
  if (!query) {
    return {
      diagnostic: {
        status: "no-op",
        reasonCodes: [
          ...policy.reasonCodes,
          "native_agent_memory_context_empty_query",
        ],
        sourceCount: 0,
        requestedMode: mode,
        appliedMode: "baseline",
      },
    };
  }

  if (!isRawMessageStorageAvailable()) {
    return {
      diagnostic: {
        status: "no-op",
        reasonCodes: [
          ...policy.reasonCodes,
          "native_agent_memory_context_storage_unavailable",
        ],
        sourceCount: 0,
        requestedMode: mode,
        appliedMode: "baseline",
      },
    };
  }

  let manager: RawMessageStorageManagerWithSearch;
  try {
    manager = await getRawMessageManager();
  } catch {
    return failureDiagnostic(
      [...policy.reasonCodes, "native_agent_memory_context_storage_failed"],
      mode,
    );
  }

  try {
    const result = await queryMemoryWithFallback(
      manager,
      {
        userId: input.userId,
        keywords: extractQueryKeywords(query),
        pageSize: DEFAULT_MEMORY_CONTEXT_PAGE_SIZE,
        minRawResultsWithoutFallback: DEFAULT_MEMORY_CONTEXT_PAGE_SIZE,
        reverse: true,
        includeDeprecated: mode === "audit",
        conflictSensitive: mode === "conflict",
      },
      {
        graphRetrieval: graphRetrievalOptions({
          manager,
          userId: input.userId,
          query,
          applicabilityContexts: input.applicabilityContexts ?? [],
        }),
      },
    );
    const formatted = formatMemoryContext(result.items);
    return {
      content: formatted.content,
      diagnostic: queryDiagnostic({
        result,
        sourceCount: formatted.sourceCount,
        materializedNodeIds: formatted.materializedNodeIds,
        mode,
        policyReasonCodes: policy.reasonCodes,
      }),
    };
  } catch {
    return failureDiagnostic(
      [...policy.reasonCodes, "native_agent_memory_context_query_failed"],
      mode,
    );
  }
}
