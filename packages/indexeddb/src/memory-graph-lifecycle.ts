import {
  type MemoryGraphLifecyclePolicyOptions,
  type MemoryGraphSnapshot,
  type MemorySummaryCandidate,
  type OwnerScope,
  buildMemoryDeprecationEntries,
  buildMemoryGraphLifecyclePlan,
  buildMemoryGraphRepresentativePlan,
  buildMemoryGraphVisibilityPlan,
  ownerScopeKey,
  sameOwnerScope,
} from "../../ai/memory-consolidation/src";
import {
  type MemoryDimensions,
  type MemoryGroup,
  type MemoryRecord,
  type MemoryStorageAdapter,
  type MemorySummary,
  RuleBasedMemorySummarizer,
  type ScoredMemoryRecord,
  deprecateMemoryRecords,
} from "../../ai/src/memory";
import type { RawMessage } from "./manager";
import {
  createRawMessageMemoryGraphStore,
  ownerScopeFromMessage,
} from "./memory-graph-evolution";
import type { RawMessageStorage } from "./storage";

export interface RawMessageGraphLifecycleOptions extends MemoryGraphLifecyclePolicyOptions {
  enabled?: boolean;
  dryRun?: boolean;
  workspaceId?: string;
  tenantId?: string;
}

export type MemoryGraphLifecycleRuntimeStatus =
  | "disabled"
  | "planned"
  | "applied"
  | "no-op"
  | "partial-failure"
  | "conflict"
  | "skipped-locked"
  | "failed";

export interface MemoryGraphLifecycleCandidateRunResult {
  clusterId: string;
  summaryId: string;
  status: "planned" | "persisted" | "deprecation-no-op" | "failed" | "conflict";
  sourceRecordIds: string[];
  supersededClusterIds: string[];
  deprecatedRecords: number;
  reasonCodes: string[];
  error?: { name: string; message: string };
}

export interface MemoryGraphLifecycleRuntimeResult {
  status: MemoryGraphLifecycleRuntimeStatus;
  dryRun: boolean;
  ownerScope: OwnerScope;
  scannedClusters: number;
  transitionedClusters: number;
  stableClusters: number;
  decayingClusters: number;
  createdSummaries: number;
  deprecatedRecords: number;
  candidateResults: MemoryGraphLifecycleCandidateRunResult[];
  reasonCodes: string[];
  error?: { name: string; message: string };
}

export interface RunMemoryGraphLifecycleCycleInput {
  manager: RawMessageStorage;
  storage: MemoryStorageAdapter;
  userId: string;
  options: RawMessageGraphLifecycleOptions;
  now?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function parseRawMessageGraphLifecycleOptions(
  value: unknown,
): RawMessageGraphLifecycleOptions | undefined {
  if (!isRecord(value)) return undefined;
  const options: RawMessageGraphLifecycleOptions = {
    workspaceId: optionalString(value.workspaceId),
    tenantId: optionalString(value.tenantId),
    stableMinEvidence: optionalFiniteNumber(value.stableMinEvidence),
    stableMinSupportScore: optionalFiniteNumber(value.stableMinSupportScore),
    decayAfterMs: optionalFiniteNumber(value.decayAfterMs),
    supersessionMinEvidence: optionalFiniteNumber(
      value.supersessionMinEvidence,
    ),
    supersessionStrengthMargin: optionalFiniteNumber(
      value.supersessionStrengthMargin,
    ),
  };
  if (typeof value.enabled === "boolean") options.enabled = value.enabled;
  if (typeof value.dryRun === "boolean") options.dryRun = value.dryRun;
  return options;
}

function normalizeTimestampToMs(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return (value as number) < 1e11
    ? Math.floor((value as number) * 1000)
    : Math.floor(value as number);
}

function toMemoryRecord(message: RawMessage): MemoryRecord {
  const dimensions: MemoryDimensions = {
    platform: message.platform,
    botId: message.botId,
    channel: message.channel,
    person: message.person,
  };
  return {
    id: message.messageId,
    userId: message.userId,
    timestamp: normalizeTimestampToMs(message.timestamp),
    text: message.content,
    mediaRefs: message.attachments?.map((attachment) => attachment.url),
    tier: message.memoryStage ?? "short",
    accessCount: message.accessCount,
    lastAccessAt: normalizeTimestampToMs(message.lastAccessAt),
    importanceScore: message.importanceScore,
    isPinned: message.isPinned,
    archivedAt: normalizeTimestampToMs(message.archivedAt),
    dimensions,
    metadata: message.metadata,
    deprecatedAt: message.deprecatedAt,
    deprecationReason: message.deprecationReason,
    supersededBySummaryId: message.supersededBySummaryId,
  };
}

function scored(record: MemoryRecord, now: number): ScoredMemoryRecord {
  return {
    ...record,
    ageMs: Math.max(0, now - record.timestamp),
    valueScore: record.importanceScore ?? 1,
  };
}

function stableSummaryId(ownerScope: OwnerScope, clusterId: string): string {
  return `memory-graph-summary:${ownerScopeKey(ownerScope)}:${encodeURIComponent(clusterId)}`;
}

function graphPolicy(
  options: RawMessageGraphLifecycleOptions,
): MemoryGraphLifecyclePolicyOptions {
  return {
    stableMinEvidence: options.stableMinEvidence,
    stableMinSupportScore: options.stableMinSupportScore,
    decayAfterMs: options.decayAfterMs,
    supersessionMinEvidence: options.supersessionMinEvidence,
    supersessionStrengthMargin: options.supersessionStrengthMargin,
  };
}

async function loadScopedMessages(input: {
  manager: RawMessageStorage;
  ownerScope: OwnerScope;
  ids: string[];
}): Promise<RawMessage[]> {
  const messages = await Promise.all(
    input.ids.map((id) => input.manager.getMessageById(id)),
  );
  return messages.filter(
    (message): message is RawMessage =>
      message !== null &&
      sameOwnerScope(ownerScopeFromMessage(message), input.ownerScope),
  );
}

function sourceIdsForClusters(
  snapshot: MemoryGraphSnapshot,
  clusterIds: string[],
): string[][] {
  const nodesById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  return clusterIds.map((clusterId) => {
    const cluster = snapshot.clusters.find(
      (candidate) => candidate.clusterId === clusterId,
    );
    if (!cluster) return [];
    return cluster.nodeIds.filter(
      (nodeId) => nodesById.get(nodeId)?.type === "raw",
    );
  });
}

async function buildSummary(input: {
  ownerScope: OwnerScope;
  clusterId: string;
  messages: RawMessage[];
  now: number;
}): Promise<MemorySummary> {
  const records = input.messages
    .map(toMemoryRecord)
    .map((record) => scored(record, input.now))
    .sort((left, right) => left.timestamp - right.timestamp);
  const first = records[0];
  const last = records.at(-1);
  if (!first || !last)
    throw new Error("Graph lifecycle summary has no source records");
  const group: MemoryGroup = {
    groupId: input.clusterId,
    userId: input.ownerScope.userId,
    sourceTier: first.tier,
    targetTier: "long",
    summaryTier: "L3",
    records,
    startTimestamp: first.timestamp,
    endTimestamp: last.timestamp,
    dimensions: first.dimensions,
  };
  const draft = await new RuleBasedMemorySummarizer().summarizeGroup(group);
  return {
    summaryId: stableSummaryId(input.ownerScope, input.clusterId),
    userId: input.ownerScope.userId,
    summaryTier: "L3",
    sourceTier: first.tier,
    startTimestamp: first.timestamp,
    endTimestamp: last.timestamp,
    messageCount: records.length,
    sourceRecordIds: records.map((record) => record.id),
    keyPoints: draft.keyPoints,
    keywords: draft.keywords,
    summaryText: draft.summaryText,
    dimensions: first.dimensions,
    qualityScore: draft.qualityScore,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function errorInfo(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export async function runMemoryGraphLifecycleCycle(
  input: RunMemoryGraphLifecycleCycleInput,
): Promise<MemoryGraphLifecycleRuntimeResult> {
  const now = input.now ?? Date.now();
  const ownerScope: OwnerScope = {
    userId: input.userId,
    workspaceId: input.options.workspaceId,
    tenantId: input.options.tenantId,
  };
  const dryRun = input.options.dryRun === true;
  const disabledResult: MemoryGraphLifecycleRuntimeResult = {
    status: "disabled",
    dryRun,
    ownerScope,
    scannedClusters: 0,
    transitionedClusters: 0,
    stableClusters: 0,
    decayingClusters: 0,
    createdSummaries: 0,
    deprecatedRecords: 0,
    candidateResults: [],
    reasonCodes: ["memory_graph_lifecycle_disabled"],
  };
  if (input.options.enabled !== true) return disabledResult;

  const lock = await input.storage.acquireLock({
    key: `memory-graph-lifecycle:${ownerScopeKey(ownerScope)}`,
    ttlMs: 5 * 60 * 1000,
    now,
  });
  if (!lock) {
    return {
      ...disabledResult,
      status: "skipped-locked",
      reasonCodes: ["memory_graph_lifecycle_locked"],
    };
  }

  const graphStore = createRawMessageMemoryGraphStore({
    storage: input.manager,
    ownerScope,
    now: () => now,
  });
  const candidateResults: MemoryGraphLifecycleCandidateRunResult[] = [];
  const reasonCodes = new Set<string>();
  let createdSummaries = 0;
  let deprecatedRecords = 0;
  let transitionedClusters = 0;
  let stableClusters = 0;
  let decayingClusters = 0;
  let scannedClusters = 0;
  let partialFailure = false;

  try {
    let snapshot = await graphStore.readSnapshot({
      ownerScope,
      includeAuditOnly: true,
    });
    scannedClusters = snapshot.clusters.length;
    const lifecycle = buildMemoryGraphLifecyclePlan({
      ownerScope,
      snapshot,
      now,
      persistence: {
        mode: dryRun ? "dry-run" : "write",
        enabled: !dryRun,
      },
      policy: graphPolicy(input.options),
    });
    for (const reasonCode of lifecycle.reasonCodes) {
      reasonCodes.add(reasonCode);
    }
    transitionedClusters = lifecycle.transitions.length;
    stableClusters = lifecycle.consolidationCandidates.length;
    decayingClusters = lifecycle.decayingClusterIds.length;

    if (dryRun) {
      return {
        status: "planned",
        dryRun: true,
        ownerScope,
        scannedClusters,
        transitionedClusters,
        stableClusters,
        decayingClusters,
        createdSummaries: 0,
        deprecatedRecords: 0,
        candidateResults: lifecycle.consolidationCandidates.map(
          (candidate) => ({
            clusterId: candidate.clusterId,
            summaryId: stableSummaryId(ownerScope, candidate.clusterId),
            status: "planned",
            sourceRecordIds: [...candidate.sourceNodeIds],
            supersededClusterIds: [...candidate.supersededClusterIds],
            deprecatedRecords: 0,
            reasonCodes: [
              ...candidate.reasonCodes,
              "memory_graph_lifecycle_dry_run",
            ],
          }),
        ),
        reasonCodes: unique([...reasonCodes, "memory_graph_lifecycle_dry_run"]),
      };
    }

    const lifecyclePersistence = await graphStore.persistPlan(lifecycle.plan);
    for (const reasonCode of lifecyclePersistence.diagnostics) {
      reasonCodes.add(reasonCode);
    }
    if (lifecyclePersistence.conflict) {
      return {
        status: "conflict",
        dryRun: false,
        ownerScope,
        scannedClusters,
        transitionedClusters: 0,
        stableClusters,
        decayingClusters,
        createdSummaries: 0,
        deprecatedRecords: 0,
        candidateResults: [],
        reasonCodes: unique([...reasonCodes, "memory_graph_version_conflict"]),
      };
    }
    snapshot = await graphStore.readSnapshot({
      ownerScope,
      includeAuditOnly: true,
    });

    for (const candidate of lifecycle.consolidationCandidates) {
      const summaryId = stableSummaryId(ownerScope, candidate.clusterId);
      const sourceMessages = await loadScopedMessages({
        manager: input.manager,
        ownerScope,
        ids: candidate.sourceNodeIds,
      });
      if (sourceMessages.length !== candidate.sourceNodeIds.length) {
        partialFailure = true;
        candidateResults.push({
          clusterId: candidate.clusterId,
          summaryId,
          status: "failed",
          sourceRecordIds: [...candidate.sourceNodeIds],
          supersededClusterIds: [...candidate.supersededClusterIds],
          deprecatedRecords: 0,
          reasonCodes: [
            "memory_graph_source_records_missing_or_scope_mismatch",
          ],
        });
        reasonCodes.add(
          "memory_graph_source_records_missing_or_scope_mismatch",
        );
        continue;
      }

      try {
        const summary = await buildSummary({
          ownerScope,
          clusterId: candidate.clusterId,
          messages: sourceMessages,
          now,
        });
        await input.storage.saveSummaries([summary]);
        createdSummaries += 1;

        const representativePlan = buildMemoryGraphRepresentativePlan({
          ownerScope,
          snapshot,
          candidate,
          summaryId,
          now,
          persistence: { mode: "write", enabled: true },
        });
        if (representativePlan.operations.length === 0) {
          partialFailure = true;
          candidateResults.push({
            clusterId: candidate.clusterId,
            summaryId,
            status: "failed",
            sourceRecordIds: [...candidate.sourceNodeIds],
            supersededClusterIds: [...candidate.supersededClusterIds],
            deprecatedRecords: 0,
            reasonCodes: ["memory_graph_representative_plan_empty"],
          });
          reasonCodes.add("memory_graph_representative_plan_empty");
          continue;
        }
        const representativePersistence =
          await graphStore.persistPlan(representativePlan);
        for (const reasonCode of representativePersistence.diagnostics) {
          reasonCodes.add(reasonCode);
        }
        if (representativePersistence.conflict) {
          partialFailure = true;
          candidateResults.push({
            clusterId: candidate.clusterId,
            summaryId,
            status: "conflict",
            sourceRecordIds: [...candidate.sourceNodeIds],
            supersededClusterIds: [...candidate.supersededClusterIds],
            deprecatedRecords: 0,
            reasonCodes: ["memory_graph_representative_version_conflict"],
          });
          reasonCodes.add("memory_graph_representative_version_conflict");
          snapshot = await graphStore.readSnapshot({
            ownerScope,
            includeAuditOnly: true,
          });
          continue;
        }

        snapshot = await graphStore.readSnapshot({
          ownerScope,
          includeAuditOnly: true,
        });
        const persistedRepresentative = snapshot.clusters.find(
          (cluster) => cluster.clusterId === candidate.clusterId,
        );
        const representativeReady =
          persistedRepresentative?.representativeNodeId === summaryId &&
          snapshot.nodes.some(
            (node) => node.id === summaryId && node.type === "summary",
          );
        if (!representativeReady) {
          partialFailure = true;
          candidateResults.push({
            clusterId: candidate.clusterId,
            summaryId,
            status: "failed",
            sourceRecordIds: [...candidate.sourceNodeIds],
            supersededClusterIds: [...candidate.supersededClusterIds],
            deprecatedRecords: 0,
            reasonCodes: ["memory_graph_representative_not_persisted"],
          });
          reasonCodes.add("memory_graph_representative_not_persisted");
          continue;
        }
        const supersededSourceGroups = sourceIdsForClusters(
          snapshot,
          candidate.supersededClusterIds,
        );
        const deprecationCandidates: MemorySummaryCandidate[] = [
          {
            clusterKey: candidate.clusterId,
            competitionKey: candidate.competitionKey ?? candidate.clusterId,
            recordIds: [...candidate.sourceNodeIds],
            evidenceCount: candidate.evidenceCount,
            score: candidate.score,
            priority: candidate.score,
            reasonCodes:
              candidate.supersededClusterIds.length > 0
                ? ["wins_competition"]
                : ["strong_repeated_evidence"],
            sourceAction: "preserve",
          },
          ...candidate.supersededClusterIds.map(
            (clusterId, index): MemorySummaryCandidate => ({
              clusterKey: clusterId,
              competitionKey: candidate.competitionKey ?? candidate.clusterId,
              recordIds: supersededSourceGroups[index] ?? [],
              evidenceCount: (supersededSourceGroups[index] ?? []).length,
              score: 0,
              priority: 0,
              reasonCodes: ["outscored_by_competitor"],
              sourceAction: "preserve",
            }),
          ),
        ];
        const [winnerDeprecationCandidate, ...loserDeprecationCandidates] =
          deprecationCandidates;
        const winnerDeprecationPlan = buildMemoryDeprecationEntries({
          persistedSummaryIds: winnerDeprecationCandidate ? [summaryId] : [],
          summaryCandidates: winnerDeprecationCandidate
            ? [winnerDeprecationCandidate]
            : [],
        });
        const loserDeprecationEntries = loserDeprecationCandidates.flatMap(
          (loserCandidate) =>
            buildMemoryDeprecationEntries({
              persistedSummaryIds: [summaryId],
              summaryCandidates: [loserCandidate],
              reasonFor: () => `superseded_by_summary:${summaryId}`,
            }).entries,
        );
        const deprecationEntries = [
          ...winnerDeprecationPlan.entries,
          ...loserDeprecationEntries,
        ];
        const deprecation = await deprecateMemoryRecords({
          userId: ownerScope.userId,
          entries: deprecationEntries,
          store: input.storage,
          now,
        });
        for (const reasonCode of deprecation.reasonCodes) {
          reasonCodes.add(reasonCode);
        }
        deprecatedRecords += deprecation.persistedCount;
        const coveredSourceIds = unique(
          deprecationCandidates.flatMap((item) => item.recordIds),
        );
        if (deprecation.status === "persisted") {
          const visibilityPlan = buildMemoryGraphVisibilityPlan({
            ownerScope,
            snapshot,
            summaryId,
            sourceNodeIds: coveredSourceIds,
            now,
            persistence: { mode: "write", enabled: true },
          });
          const visibilityPersistence =
            await graphStore.persistPlan(visibilityPlan);
          for (const reasonCode of visibilityPersistence.diagnostics) {
            reasonCodes.add(reasonCode);
          }
          if (visibilityPersistence.conflict) {
            partialFailure = true;
            reasonCodes.add("memory_graph_visibility_version_conflict");
          }
        }
        const candidateStatus =
          deprecation.status === "persisted"
            ? "persisted"
            : "deprecation-no-op";
        if (candidateStatus === "deprecation-no-op") partialFailure = true;
        candidateResults.push({
          clusterId: candidate.clusterId,
          summaryId,
          status: candidateStatus,
          sourceRecordIds: [...candidate.sourceNodeIds],
          supersededClusterIds: [...candidate.supersededClusterIds],
          deprecatedRecords: deprecation.persistedCount,
          reasonCodes: unique([
            ...candidate.reasonCodes,
            ...deprecation.reasonCodes,
          ]),
        });
        snapshot = await graphStore.readSnapshot({
          ownerScope,
          includeAuditOnly: true,
        });
      } catch (error) {
        partialFailure = true;
        const details = errorInfo(error);
        candidateResults.push({
          clusterId: candidate.clusterId,
          summaryId,
          status: "failed",
          sourceRecordIds: [...candidate.sourceNodeIds],
          supersededClusterIds: [...candidate.supersededClusterIds],
          deprecatedRecords: 0,
          reasonCodes: ["memory_graph_consolidation_candidate_failed"],
          error: details,
        });
        reasonCodes.add("memory_graph_consolidation_candidate_failed");
        snapshot = await graphStore.readSnapshot({
          ownerScope,
          includeAuditOnly: true,
        });
      }
    }

    const mutatesLifecycle = lifecyclePersistence.mutatesGraph;
    const status: MemoryGraphLifecycleRuntimeStatus = partialFailure
      ? "partial-failure"
      : mutatesLifecycle ||
          candidateResults.some((result) => result.status === "persisted")
        ? "applied"
        : "no-op";
    return {
      status,
      dryRun: false,
      ownerScope,
      scannedClusters,
      transitionedClusters,
      stableClusters,
      decayingClusters,
      createdSummaries,
      deprecatedRecords,
      candidateResults,
      reasonCodes: [...reasonCodes],
    };
  } catch (error) {
    return {
      status: "failed",
      dryRun,
      ownerScope,
      scannedClusters,
      transitionedClusters,
      stableClusters,
      decayingClusters,
      createdSummaries,
      deprecatedRecords,
      candidateResults,
      reasonCodes: unique([...reasonCodes, "memory_graph_lifecycle_failed"]),
      error: errorInfo(error),
    };
  } finally {
    await input.storage.releaseLock(lock);
  }
}
