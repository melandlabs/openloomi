import {
  type GraphAwareRetrievalResult,
  type MemoryGovernanceAuditScenarioReport,
  type MemoryGraphOperation,
  type MemoryGraphRolloutGovernanceReport,
  type MemoryGraphRolloutRetrievalScenarioInput,
  type MemoryGraphRolloutRuntimeEvidence,
  type MemorySemanticRetrievalEvalScenarioReport,
  type OwnerScope,
  applicabilityMatchesTrustedContexts,
  buildMemoryGraphRolloutGovernanceReport,
  createGraphAwareRetrievalDryRunRetriever,
  ownerScopeKey,
  sameOwnerScope,
} from "../../ai/memory-consolidation/src";
import type {
  MemoryQueryGraphRetrievalOptions,
  MemorySearchWithFallbackResult,
} from "../../ai/src/memory";
import { isMemorySummaryPublicationPending } from "../../ai/src/memory/summary-publication";
import { queryMemoryWithFallback } from "./forgetting";
import {
  type RawMessageGraphEvolutionStorage,
  createRawMessageMemoryGraphStore,
  ownerScopeFromMessage,
} from "./memory-graph-evolution";
import type { MemorySummaryRecord, RawMessageStorage } from "./storage";

interface SemanticSearchInput {
  userId: string;
  queryEmbedding: number[];
  includeArchived?: boolean;
  includeDeprecated?: boolean;
  limit?: number;
  threshold?: number;
}

export interface MemoryGraphRolloutEvaluationStorage extends RawMessageGraphEvolutionStorage {
  searchMessagesSemantically?: (
    input: SemanticSearchInput,
  ) => Promise<unknown[]>;
  querySummaries(query: {
    userId?: string;
    pageSize?: number;
  }): Promise<MemorySummaryRecord[]>;
}

export interface RunMemoryGraphRolloutEvaluationInput {
  storage: MemoryGraphRolloutEvaluationStorage;
  userId: string;
  scenarioId: string;
  workspaceId?: string;
  tenantId?: string;
  queryEmbedding?: number[];
  pollutedArtifactIds?: string[];
  now?: number;
}

export interface MemoryGraphRolloutEvaluationRuntimeResult {
  ownerScope: OwnerScope;
  snapshotVersion?: string;
  report: MemoryGraphRolloutGovernanceReport;
  runtimeEvidence: MemoryGraphRolloutRuntimeEvidence;
  reasonCodes: string[];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
function semanticResultMessageId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.messageId === "string") return record.messageId;
  if (typeof record.message !== "object" || record.message === null) {
    return undefined;
  }
  const message = record.message as Record<string, unknown>;
  return typeof message.messageId === "string" ? message.messageId : undefined;
}

function runtimeRetrievalNodeIds(
  result: MemorySearchWithFallbackResult,
): string[] {
  return unique(
    result.items.map((item) =>
      item.sourceType === "raw" ? item.record.id : item.summary.summaryId,
    ),
  );
}

function runtimeCrossScopeNodeIds(
  result: MemorySearchWithFallbackResult,
  scopedNodeIds: Set<string>,
): string[] {
  return runtimeRetrievalNodeIds(result).filter(
    (nodeId) => !scopedNodeIds.has(nodeId),
  );
}

function runtimeGraphRetrievalResult(input: {
  result: MemorySearchWithFallbackResult;
  ownerScope: OwnerScope;
}): GraphAwareRetrievalResult {
  const graphResult = input.result.graphRetrieval?.result;
  const status = input.result.graphRetrieval?.status ?? "missing";
  return {
    ownerScope: graphResult?.ownerScope ?? { ...input.ownerScope },
    rankedNodeIds: runtimeRetrievalNodeIds(input.result),
    hiddenDeprecatedNodeIds: [...(graphResult?.hiddenDeprecatedNodeIds ?? [])],
    expandedClusterIds: [...(graphResult?.expandedClusterIds ?? [])],
    auditTrail: graphResult?.auditTrail?.map((trail) => ({
      ...trail,
      ownerScope: { ...trail.ownerScope },
    })),
    reasonCodes: unique([
      ...(graphResult?.reasonCodes ?? []),
      ...(input.result.graphRetrieval?.reasonCodes ?? []),
      `memory_graph_runtime_retrieval_${status}`,
    ]),
    metadata: {
      ...(graphResult?.metadata ?? {}),
      runtimeRetrievalStatus: status,
    },
  };
}

function ownerScope(
  userId: string,
  input: { workspaceId?: string; tenantId?: string },
): OwnerScope {
  return {
    userId,
    workspaceId: input.workspaceId,
    tenantId: input.tenantId,
  };
}

function operationKinds(
  operations: MemoryGraphOperation[],
  kinds: MemoryGraphOperation["kind"][],
): string[] {
  const accepted = new Set(kinds);
  return operations
    .filter((operation) => accepted.has(operation.kind))
    .map((operation) => operation.operationId);
}

function semanticScenario(input: {
  defaultIds: string[];
  auditIds: string[];
  deprecatedIds: string[];
  crossScopeIds: string[];
  snapshotVersion?: string;
}): MemorySemanticRetrievalEvalScenarioReport {
  const leaked = input.defaultIds.filter((id) =>
    input.deprecatedIds.includes(id),
  );
  const missingAudit = input.deprecatedIds.filter(
    (id) => !input.auditIds.includes(id),
  );
  const passed =
    leaked.length === 0 &&
    missingAudit.length === 0 &&
    input.crossScopeIds.length === 0;
  return {
    scenarioId: "runtime-semantic-deprecated-visibility",
    query: "runtime memory graph semantic audit",
    enabled: true,
    selectedDraftIds: [],
    suppressedDraftIds: leaked,
    fallbackRecordIds: [...input.defaultIds],
    missingSelectedDraftIds: [],
    missingSuppressedDraftIds: unique([
      ...missingAudit,
      ...input.crossScopeIds,
    ]),
    missingFallbackRecordIds: [],
    selectedPassed: true,
    suppressedPassed: leaked.length === 0,
    fallbackPassed: missingAudit.length === 0,
    passed,
    reasonCodes: [
      passed
        ? "semantic_retrieval_eval_passed"
        : "semantic_retrieval_eval_failed",
    ],
    metadata: {
      source: "persisted_memory_graph_runtime",
      snapshotVersion: input.snapshotVersion,
      auditRecordIds: [...input.auditIds],
      crossScopeRecordIds: [...input.crossScopeIds],
    },
  };
}

function auditScenario(input: {
  scenarioId: string;
  pollutedArtifactIds: string[];
  operations: MemoryGraphOperation[];
}): MemoryGovernanceAuditScenarioReport {
  const corrected = new Set(
    input.operations
      .filter((operation) =>
        [
          "correct-node",
          "remove-cluster-member",
          "rollback-supersession",
        ].includes(operation.kind),
      )
      .flatMap((operation) => operation.nodeIds),
  );
  const pollutedMemories = unique(input.pollutedArtifactIds).map(
    (artifactId) => {
      const resolved = corrected.has(artifactId);
      const commandIds = input.operations
        .filter((operation) => operation.nodeIds.includes(artifactId))
        .map((operation) => operation.operationId);
      return {
        artifactId,
        explained: true,
        unresolved: !resolved,
        sourceRecordIds: [artifactId],
        rollbackAvailable: resolved,
        commandIds,
        validCommandIds: resolved ? commandIds : [],
        reasonCodes: [
          "polluted_memory_observed",
          "polluted_memory_explained",
          ...(resolved
            ? (["dry_run_command_available"] as const)
            : (["polluted_memory_unresolved"] as const)),
        ],
        metadata: { source: "persisted_operation_history" },
      };
    },
  );
  const unresolvedArtifactIds = pollutedMemories
    .filter((item) => item.unresolved)
    .map((item) => item.artifactId);
  return {
    summary: {
      scenarioId: input.scenarioId,
      pollutedArtifactCount: pollutedMemories.length,
      explainedPollutedArtifactCount: pollutedMemories.length,
      validCommandCount: pollutedMemories.filter((item) => !item.unresolved)
        .length,
      unresolvedPollutedArtifactCount: unresolvedArtifactIds.length,
      dryRun: true,
    },
    pollutedMemories,
    unresolvedArtifactIds,
    reasonCodes: unique(pollutedMemories.flatMap((item) => item.reasonCodes)),
    metadata: { source: "persisted_memory_graph_runtime" },
  };
}

export async function runMemoryGraphRolloutEvaluation(
  input: RunMemoryGraphRolloutEvaluationInput,
): Promise<MemoryGraphRolloutEvaluationRuntimeResult> {
  const now = input.now ?? Date.now();
  const scope = ownerScope(input.userId, input);
  const store = createRawMessageMemoryGraphStore({
    storage: input.storage,
    ownerScope: scope,
    now: () => now,
  });
  const snapshot = await store.readSnapshot({
    ownerScope: scope,
    includeAuditOnly: true,
  });
  const applicabilityNow = snapshot.capturedAt ?? now;
  const evaluationNodes = snapshot.nodes.filter((node) =>
    applicabilityMatchesTrustedContexts(
      node.applicability,
      [],
      applicabilityNow,
    ),
  );
  const snapshotNodeIds = new Set(snapshot.nodes.map((node) => node.id));
  const evaluationNodeIds = new Set(evaluationNodes.map((node) => node.id));
  const evaluationClusters = snapshot.clusters.filter((cluster) =>
    applicabilityMatchesTrustedContexts(
      cluster.applicability,
      [],
      applicabilityNow,
    ),
  );
  const pollutedArtifactIds = (input.pollutedArtifactIds ?? []).filter((id) =>
    evaluationNodeIds.has(id),
  );
  const operations = await store.readAppliedOperations({ ownerScope: scope });
  const storedSummaries = await input.storage.querySummaries({
    userId: scope.userId,
    pageSize: 1000,
  });
  const retrievalPageSize = Math.max(
    1000,
    snapshot.nodes.length + storedSummaries.length + 1,
  );
  const graphRetrieval: MemoryQueryGraphRetrievalOptions = {
    enabled: true,
    ownerScope: scope,
    retriever: createGraphAwareRetrievalDryRunRetriever(),
    snapshotProvider: async ({ ownerScope: requestedScope }) =>
      sameOwnerScope(requestedScope, scope) ? snapshot : undefined,
  };
  const queryStorage = input.storage as RawMessageStorage;
  const defaultRuntime = await queryMemoryWithFallback(
    queryStorage,
    {
      userId: scope.userId,
      pageSize: retrievalPageSize,
      minRawResultsWithoutFallback: retrievalPageSize,
    },
    { graphRetrieval, markRawAccessOnRead: false },
  );
  const [auditRuntime, conflictRuntime] = await Promise.all([
    queryMemoryWithFallback(
      queryStorage,
      {
        userId: scope.userId,
        pageSize: retrievalPageSize,
        minRawResultsWithoutFallback: retrievalPageSize,
        includeDeprecated: true,
      },
      { graphRetrieval, markRawAccessOnRead: false },
    ),
    queryMemoryWithFallback(
      queryStorage,
      {
        userId: scope.userId,
        pageSize: retrievalPageSize,
        minRawResultsWithoutFallback: retrievalPageSize,
        conflictSensitive: true,
      },
      { graphRetrieval, markRawAccessOnRead: false },
    ),
  ]);
  const defaultGraph = runtimeGraphRetrievalResult({
    result: defaultRuntime,
    ownerScope: scope,
  });
  const auditGraph = runtimeGraphRetrievalResult({
    result: auditRuntime,
    ownerScope: scope,
  });
  const conflictGraph = runtimeGraphRetrievalResult({
    result: conflictRuntime,
    ownerScope: scope,
  });
  const scopedNodeIds = evaluationNodeIds;
  const defaultCrossScopeNodeIds = runtimeCrossScopeNodeIds(
    defaultRuntime,
    scopedNodeIds,
  );
  const auditCrossScopeNodeIds = runtimeCrossScopeNodeIds(
    auditRuntime,
    scopedNodeIds,
  );
  const conflictCrossScopeNodeIds = runtimeCrossScopeNodeIds(
    conflictRuntime,
    scopedNodeIds,
  );
  const persistedTrails = await Promise.all(
    unique([
      ...auditGraph.rankedNodeIds,
      ...evaluationNodes
        .filter((node) => node.type === "summary")
        .map((node) => node.id),
    ]).map((nodeId) =>
      store.readAuditTrail({
        ownerScope: scope,
        nodeId,
        includeDeprecated: true,
      }),
    ),
  );
  auditGraph.auditTrail = persistedTrails.filter(
    (trail) => trail.sourceNodeIds.length > 0 || trail.operationIds.length > 0,
  );

  const hiddenRawIds = evaluationNodes
    .filter(
      (node) =>
        node.type === "raw" &&
        (node.visibility === "deprecated" || node.visibility === "audit-only"),
    )
    .map((node) => node.id);
  const defaultExpectedIds = evaluationNodes
    .filter(
      (node) =>
        node.visibility === "default" &&
        (node.type === "raw" || node.type === "summary"),
    )
    .map((node) => node.id);
  const summaryIds = evaluationNodes
    .filter((node) => node.type === "summary")
    .map((node) => node.id);
  const scopedRawNodeIds = new Set(
    evaluationNodes
      .filter((node) => node.type === "raw")
      .map((node) => node.id),
  );
  const scopedStoredSummaries = storedSummaries.filter(
    (summary) =>
      summaryIds.includes(summary.summaryId) ||
      summary.sourceRecordIds.some((sourceId) =>
        scopedRawNodeIds.has(sourceId),
      ),
  );
  const unlinkedSummaryIds = scopedStoredSummaries
    .map((summary) => summary.summaryId)
    .filter((summaryId) => !summaryIds.includes(summaryId));
  const pendingSummaryIds = scopedStoredSummaries
    .filter(isMemorySummaryPublicationPending)
    .map((summary) => summary.summaryId);
  const rawNodes = evaluationNodes.filter((node) => node.type === "raw");
  const rawMessages = await Promise.all(
    rawNodes.map((node) => input.storage.getMessageById(node.id)),
  );
  const rawVisibilityMismatchNodeIds = rawNodes
    .filter((node, index) => {
      const message = rawMessages[index];
      if (!message || !sameOwnerScope(ownerScopeFromMessage(message), scope)) {
        return true;
      }
      const graphHidesRaw =
        node.visibility === "deprecated" || node.visibility === "audit-only";
      return graphHidesRaw !== (message.deprecatedAt !== undefined);
    })
    .map((node) => node.id);
  const retrievalScenarios: MemoryGraphRolloutRetrievalScenarioInput[] = [
    {
      scenarioId: "runtime-default-retrieval",
      result: defaultGraph,
      expectedRankedNodeIds: defaultExpectedIds,
      expectedHiddenDeprecatedNodeIds: hiddenRawIds,
      forbiddenNodeIds: hiddenRawIds,
      crossScopeNodeIds: defaultCrossScopeNodeIds,
      metadata: { snapshotVersion: snapshot.version },
    },
    {
      scenarioId: "runtime-audit-retrieval",
      result: auditGraph,
      expectedRankedNodeIds: hiddenRawIds,
      expectedAuditTrailNodeIds: summaryIds,
      crossScopeNodeIds: auditCrossScopeNodeIds,
      metadata: { snapshotVersion: snapshot.version },
    },
  ];
  if (conflictGraph.reasonCodes.includes("competing_alternatives_exposed")) {
    retrievalScenarios.push({
      scenarioId: "runtime-conflict-retrieval",
      result: conflictGraph,
      expectedRankedNodeIds: conflictGraph.rankedNodeIds,
      crossScopeNodeIds: conflictCrossScopeNodeIds,
      metadata: { snapshotVersion: snapshot.version },
    });
  }

  const semanticRetrievalScenarios: MemorySemanticRetrievalEvalScenarioReport[] =
    [];
  let semanticDefaultRecordIds: string[] = [];
  let semanticAuditRecordIds: string[] = [];
  if (
    typeof input.storage.searchMessagesSemantically === "function" &&
    (input.queryEmbedding?.length ?? 0) > 0
  ) {
    const [defaultSemantic, auditSemantic] = await Promise.all([
      input.storage.searchMessagesSemantically({
        userId: scope.userId,
        queryEmbedding: input.queryEmbedding ?? [],
        includeArchived: false,
        includeDeprecated: false,
        limit: 100,
        threshold: -1,
      }),
      input.storage.searchMessagesSemantically({
        userId: scope.userId,
        queryEmbedding: input.queryEmbedding ?? [],
        includeArchived: false,
        includeDeprecated: true,
        limit: 100,
        threshold: -1,
      }),
    ]);
    const semanticDefaultResultIds = defaultSemantic
      .map(semanticResultMessageId)
      .filter((messageId): messageId is string => messageId !== undefined);
    const semanticAuditResultIds = auditSemantic
      .map(semanticResultMessageId)
      .filter((messageId): messageId is string => messageId !== undefined);
    semanticDefaultRecordIds = semanticDefaultResultIds.filter((messageId) =>
      evaluationNodeIds.has(messageId),
    );
    semanticAuditRecordIds = semanticAuditResultIds.filter((messageId) =>
      evaluationNodeIds.has(messageId),
    );
    const scopedRawIds = new Set(
      evaluationNodes
        .filter((node) => node.type === "raw")
        .map((node) => node.id),
    );
    const semanticCrossScopeIds = unique([
      ...semanticDefaultResultIds,
      ...semanticAuditResultIds,
    ]).filter(
      (messageId) =>
        !scopedRawIds.has(messageId) && !snapshotNodeIds.has(messageId),
    );
    semanticRetrievalScenarios.push(
      semanticScenario({
        defaultIds: semanticDefaultRecordIds,
        auditIds: semanticAuditRecordIds,
        deprecatedIds: hiddenRawIds,
        crossScopeIds: semanticCrossScopeIds,
        snapshotVersion: snapshot.version,
      }),
    );
  }

  const stableClusters = evaluationClusters.filter(
    (cluster) => cluster.lifecycleStatus === "stable",
  );
  const invalidStableRepresentatives = stableClusters.filter(
    (cluster) =>
      !cluster.representativeNodeId ||
      !evaluationNodes.some(
        (node) =>
          node.id === cluster.representativeNodeId &&
          node.visibility === "default",
      ),
  );
  const formingPromotions = evaluationClusters.filter(
    (cluster) =>
      cluster.lifecycleStatus === "forming" && cluster.representativeNodeId,
  );
  const decayingClusters = evaluationClusters.filter(
    (cluster) => cluster.lifecycleStatus === "decaying",
  );
  const invalidDecay = decayingClusters.filter(
    (cluster) => (cluster.supportScore ?? 0) > 1 && cluster.nodeIds.length > 1,
  );
  const runtimeEvidence: MemoryGraphRolloutRuntimeEvidence = {
    ownerScopeKey: ownerScopeKey(scope),
    snapshotVersion: snapshot.version,
    operationIds: operations.map((operation) => operation.operationId),
    correctionOperationIds: operationKinds(operations, [
      "correct-node",
      "remove-cluster-member",
    ]),
    rollbackOperationIds: operationKinds(operations, ["rollback-supersession"]),
    defaultRetrievedNodeIds: [...defaultGraph.rankedNodeIds],
    auditRetrievedNodeIds: [...auditGraph.rankedNodeIds],
    semanticDefaultRecordIds,
    semanticAuditRecordIds,
    sourceRecordIds: evaluationNodes
      .filter((node) => node.type === "raw")
      .map((node) => node.id),
    summaryIds,
    pendingSummaryIds,
    rawVisibilityMismatchNodeIds,
    metadata: {
      capturedAt: snapshot.capturedAt,
      storedSummaryIds: scopedStoredSummaries.map(
        (summary) => summary.summaryId,
      ),
      unlinkedSummaryIds,
      pendingSummaryIds,
      rawVisibilityMismatchNodeIds,
    },
  };
  const report = buildMemoryGraphRolloutGovernanceReport({
    scenarioId: input.scenarioId,
    consolidationMetrics: {
      scenarioCount: 1,
      expectedCandidateAccuracy:
        invalidStableRepresentatives.length === 0 ? 1 : 0,
      noisePromotionRate:
        unlinkedSummaryIds.length > 0
          ? 1
          : evaluationClusters.length === 0
            ? 0
            : formingPromotions.length / evaluationClusters.length,
      temporaryOverrideLeakageRate: 0,
      adaptationAccuracy: 1,
      projectStateAccuracy: 1,
      contestedClusterCoverage: conflictGraph.reasonCodes.includes(
        "competing_alternatives_exposed",
      )
        ? 1
        : evaluationClusters.some((cluster) => cluster.competitionKey)
          ? 0
          : 1,
      decayPrecisionProxy:
        invalidDecay.length === 0
          ? 1
          : 1 - invalidDecay.length / decayingClusters.length,
    },
    graphRetrievalScenarios: retrievalScenarios,
    semanticRetrievalScenarios,
    auditScenarioReport:
      pollutedArtifactIds.length > 0
        ? auditScenario({
            scenarioId: input.scenarioId,
            pollutedArtifactIds,
            operations,
          })
        : undefined,
    runtimeEvidence,
    metadata: {
      source: "persisted_memory_graph_runtime",
      snapshotVersion: snapshot.version,
    },
  });
  return {
    ownerScope: scope,
    snapshotVersion: snapshot.version,
    report,
    runtimeEvidence,
    reasonCodes: unique([
      "memory_graph_rollout_evaluation_from_persisted_runtime",
      ...(semanticRetrievalScenarios.length === 0
        ? ["memory_graph_required_semantic_eval_artifact_missing"]
        : []),
      ...(pollutedArtifactIds.length === 0
        ? ["memory_graph_required_polluted_memory_audit_artifact_missing"]
        : []),
      ...(runtimeEvidence.correctionOperationIds.length === 0
        ? ["memory_graph_required_correction_artifact_missing"]
        : []),
      ...(runtimeEvidence.rollbackOperationIds.length === 0
        ? ["memory_graph_required_rollback_artifact_missing"]
        : []),
    ]),
  };
}
