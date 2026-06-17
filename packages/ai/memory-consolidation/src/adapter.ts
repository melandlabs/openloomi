import type {
  MemoryEvidenceRecord,
  MemoryEvidenceTier,
} from "./evidence-cluster";
import {
  buildMemoryRelationPipeline,
  type BuildMemoryRelationPipelineInput,
  type MemoryRelationPipeline,
} from "./pipeline";
import type {
  MemoryConsolidationAction,
  MemoryConsolidationReasonCode,
} from "./plan";
import type { MemoryGraphClusterStatus } from "./relation-graph";

type PrimitiveValue = string | number | boolean;

export interface MemoryConsolidationSourceRecord {
  id?: string;
  userId?: string;
  timestamp?: number;
  text?: string;
  mediaRefs?: string[];
  tier?: MemoryEvidenceTier;
  accessCount?: number;
  lastAccessAt?: number;
  importanceScore?: number;
  isPinned?: boolean;
  archivedAt?: number;
  dimensions?: Record<string, PrimitiveValue | undefined>;
  metadata?: Record<string, unknown>;
}

export interface MemoryConsolidationRecordSelectors<
  TRecord = MemoryConsolidationSourceRecord,
> {
  getId?(record: TRecord): string | undefined;
  getUserId?(record: TRecord): string | undefined;
  getTimestamp?(record: TRecord): number | undefined;
  getText?(record: TRecord): string | undefined;
  getMediaRefs?(record: TRecord): string[] | undefined;
  getTier?(record: TRecord): MemoryEvidenceTier | undefined;
  getAccessCount?(record: TRecord): number | undefined;
  getLastAccessAt?(record: TRecord): number | undefined;
  getImportanceScore?(record: TRecord): number | undefined;
  getIsPinned?(record: TRecord): boolean | undefined;
  getArchivedAt?(record: TRecord): number | undefined;
  getDimensions?(
    record: TRecord,
  ): Record<string, PrimitiveValue | undefined> | undefined;
  getMetadata?(record: TRecord): Record<string, unknown> | undefined;
  getRelationGroup?(record: TRecord): string | undefined;
  getRelationValue?(record: TRecord): string | undefined;
  getRelationScope?(record: TRecord): string | undefined;
}

export type MemoryConsolidationAdapterSkipReason =
  | "missing_id"
  | "missing_timestamp";

export interface MemoryConsolidationSkippedRecord {
  sourceIndex: number;
  reasonCodes: MemoryConsolidationAdapterSkipReason[];
}

export interface AdaptMemoryRecordsForConsolidationInput<
  TRecord = MemoryConsolidationSourceRecord,
> {
  records: TRecord[];
  defaultUserId?: string;
  defaultTier?: MemoryEvidenceTier;
  selectors?: MemoryConsolidationRecordSelectors<TRecord>;
}

export interface AdaptMemoryRecordsForConsolidationResult {
  records: MemoryEvidenceRecord[];
  skippedRecords: MemoryConsolidationSkippedRecord[];
  sourceIndexesByRecordId: Record<string, number>;
}

export type MemoryRelationPipelineTemporaryScopeBehavior =
  | "related"
  | "default";

export interface BuildMemoryRelationPipelineDiagnosticsInput<
  TRecord = MemoryConsolidationSourceRecord,
> extends Omit<
  BuildMemoryRelationPipelineInput,
  "records" | "getCandidateKeys"
> {
  records: TRecord[];
  defaultUserId?: string;
  defaultTier?: MemoryEvidenceTier;
  selectors?: MemoryConsolidationRecordSelectors<TRecord>;
  temporaryScopeBehavior?: MemoryRelationPipelineTemporaryScopeBehavior;
  getCandidateKeys?(
    record: MemoryEvidenceRecord,
    context: {
      sourceRecord: TRecord;
      sourceIndex: number;
    },
  ): Iterable<string | undefined | false | null>;
}

export interface MemoryRelationRecordDiagnostic {
  recordId: string;
  sourceIndex: number;
  clusterKey?: string;
  competitionKey?: string;
  graphStatus?: MemoryGraphClusterStatus;
  planAction?: MemoryConsolidationAction;
  planReasonCodes: MemoryConsolidationReasonCode[];
  relationCandidateCount: number;
  supportRelationCount: number;
  competeRelationCount: number;
  relatedRelationCount: number;
  selectedForSummary: boolean;
  summaryPriority?: number;
}

export interface MemoryRelationPipelineDiagnosticSummary {
  sourceRecordCount: number;
  adaptedRecordCount: number;
  skippedRecordCount: number;
  recordsWithCandidateKeys: number;
  recordsWithRelationGroup: number;
  recordsWithRelationValue: number;
  candidateCount: number;
  relationCount: number;
  supportRelationCount: number;
  competeRelationCount: number;
  relatedRelationCount: number;
  clusterCount: number;
  competitionGroupCount: number;
  preserveCount: number;
  observeCount: number;
  decayCount: number;
  summaryCandidateCount: number;
}

export interface MemoryRelationPipelineDiagnostics {
  records: MemoryEvidenceRecord[];
  skippedRecords: MemoryConsolidationSkippedRecord[];
  pipeline: MemoryRelationPipeline;
  recordDiagnostics: MemoryRelationRecordDiagnostic[];
  summary: MemoryRelationPipelineDiagnosticSummary;
}

export interface MemoryConsolidationDiagnosticsReportSummary {
  sourceRecordCount: number;
  adaptedRecordCount: number;
  skippedRecordCount: number;
  candidateCount: number;
  relationCount: number;
  clusterCount: number;
  competitionGroupCount: number;
  preserveCount: number;
  observeCount: number;
  decayCount: number;
  summaryCandidateCount: number;
}

export interface MemoryConsolidationPreservedClusterReport {
  clusterKey: string;
  competitionKey: string;
  recordIds: string[];
  evidenceCount: number;
  score: number;
  reasonCodes: MemoryConsolidationReasonCode[];
  summaryPriority?: number;
}

export interface MemoryConsolidationContestedClusterReport {
  clusterKey: string;
  competitionKey: string;
  recordIds: string[];
  action: MemoryConsolidationAction;
  competingClusterKeys: string[];
  winningClusterKey: string;
  scoreMargin: number;
  reasonCodes: MemoryConsolidationReasonCode[];
}

export interface MemoryConsolidationDecayedRecordReport {
  recordId: string;
  sourceIndex: number;
  clusterKey?: string;
  reasonCodes: MemoryConsolidationReasonCode[];
}

export interface MemoryConsolidationRecordSignalReport {
  recordId: string;
  sourceIndex: number;
  clusterKey?: string;
  graphStatus?: MemoryGraphClusterStatus;
  planAction?: MemoryConsolidationAction;
  relationCandidateCount: number;
  supportRelationCount: number;
  competeRelationCount: number;
  relatedRelationCount: number;
  selectedForSummary: boolean;
}

export interface MemoryConsolidationDiagnosticsReport {
  summary: MemoryConsolidationDiagnosticsReportSummary;
  preservedClusters: MemoryConsolidationPreservedClusterReport[];
  contestedClusters: MemoryConsolidationContestedClusterReport[];
  decayedRecords: MemoryConsolidationDecayedRecordReport[];
  skippedRecords: MemoryConsolidationSkippedRecord[];
  recordSignals: MemoryConsolidationRecordSignalReport[];
}

const DEFAULT_TIER: MemoryEvidenceTier = "short";
const DEFAULT_TEMPORARY_SCOPE_BEHAVIOR: MemoryRelationPipelineTemporaryScopeBehavior =
  "related";

function fallbackRecord(
  record: unknown,
): Partial<MemoryConsolidationSourceRecord> {
  return typeof record === "object" && record !== null
    ? (record as Partial<MemoryConsolidationSourceRecord>)
    : {};
}

function isPrimitive(value: unknown): value is PrimitiveValue {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringArrayOrUndefined(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((item): item is string => typeof item === "string");
}

function tierOrUndefined(value: unknown): MemoryEvidenceTier | undefined {
  return value === "short" || value === "mid" || value === "long"
    ? value
    : undefined;
}

function dimensionsOrUndefined(
  value: unknown,
): Record<string, PrimitiveValue | undefined> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const dimensions: Record<string, PrimitiveValue | undefined> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || isPrimitive(entry)) {
      dimensions[key] = entry;
    }
  }

  return dimensions;
}

function metadataOrUndefined(
  value: unknown,
): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return { ...(value as Record<string, unknown>) };
}

function pickWithFallback<TRecord, TValue>(
  record: TRecord,
  selector: ((record: TRecord) => TValue | undefined) | undefined,
  fallback: TValue | undefined,
): TValue | undefined {
  return selector?.(record) ?? fallback;
}

function relationMetadata(
  metadata: Record<string, unknown> | undefined,
  relationGroup: string | undefined,
  relationValue: string | undefined,
  relationScope: string | undefined,
): Record<string, unknown> | undefined {
  if (!metadata && !relationGroup && !relationValue && !relationScope) {
    return undefined;
  }

  return {
    ...(metadata ?? {}),
    ...(relationGroup ? { relationGroup } : {}),
    ...(relationValue ? { relationValue } : {}),
    ...(relationScope ? { relationScope } : {}),
  };
}

function relationStringFromRecord(
  record: MemoryEvidenceRecord,
  key: "relationGroup" | "relationValue" | "relationScope",
): string | undefined {
  const value = record.metadata?.[key] ?? record.dimensions?.[key];
  return isPrimitive(value) ? String(value) : undefined;
}

function defaultAdapterCandidateKeys(record: MemoryEvidenceRecord): string[] {
  const relationGroup = relationStringFromRecord(record, "relationGroup");

  if (!relationGroup) {
    return [];
  }

  return [`relation-group:${encodeURIComponent(relationGroup)}`];
}

function isTemporaryScope(scope: string | undefined): boolean {
  return scope === "temporary" || scope === "ephemeral";
}

function addCount(
  countsByRecordId: Map<string, number>,
  recordId: string,
  increment = 1,
): void {
  countsByRecordId.set(
    recordId,
    (countsByRecordId.get(recordId) ?? 0) + increment,
  );
}

function countCandidateLinks(
  pipeline: MemoryRelationPipeline,
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const candidate of pipeline.candidates) {
    addCount(counts, candidate.fromRecordId);
    addCount(counts, candidate.toRecordId);
  }

  return counts;
}

function countRelationsByKind(
  pipeline: MemoryRelationPipeline,
  relation: "support" | "compete" | "related",
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const edge of pipeline.relations) {
    if (edge.relation !== relation) {
      continue;
    }

    addCount(counts, edge.fromRecordId);
    addCount(counts, edge.toRecordId);
  }

  return counts;
}

export function adaptMemoryRecordsForConsolidation<TRecord>(
  input: AdaptMemoryRecordsForConsolidationInput<TRecord>,
): AdaptMemoryRecordsForConsolidationResult {
  const records: MemoryEvidenceRecord[] = [];
  const skippedRecords: MemoryConsolidationSkippedRecord[] = [];
  const sourceIndexesByRecordId: Record<string, number> = {};

  input.records.forEach((sourceRecord, sourceIndex) => {
    const fallback = fallbackRecord(sourceRecord);
    const id = pickWithFallback(
      sourceRecord,
      input.selectors?.getId,
      stringOrUndefined(fallback.id),
    );
    const timestamp = pickWithFallback(
      sourceRecord,
      input.selectors?.getTimestamp,
      numberOrUndefined(fallback.timestamp),
    );
    const reasonCodes: MemoryConsolidationAdapterSkipReason[] = [];

    if (!id) {
      reasonCodes.push("missing_id");
    }
    if (timestamp === undefined) {
      reasonCodes.push("missing_timestamp");
    }
    if (!id || timestamp === undefined) {
      skippedRecords.push({ sourceIndex, reasonCodes });
      return;
    }

    const recordId: string = id;
    const recordTimestamp: number = timestamp;
    const relationGroup = pickWithFallback(
      sourceRecord,
      input.selectors?.getRelationGroup,
      undefined,
    );
    const relationValue = pickWithFallback(
      sourceRecord,
      input.selectors?.getRelationValue,
      undefined,
    );
    const relationScope = pickWithFallback(
      sourceRecord,
      input.selectors?.getRelationScope,
      undefined,
    );
    const metadata = relationMetadata(
      pickWithFallback(
        sourceRecord,
        input.selectors?.getMetadata,
        metadataOrUndefined(fallback.metadata),
      ),
      relationGroup,
      relationValue,
      relationScope,
    );

    records.push({
      id: recordId,
      userId:
        pickWithFallback(
          sourceRecord,
          input.selectors?.getUserId,
          stringOrUndefined(fallback.userId),
        ) ??
        input.defaultUserId ??
        "unknown",
      timestamp: recordTimestamp,
      text: pickWithFallback(
        sourceRecord,
        input.selectors?.getText,
        stringOrUndefined(fallback.text),
      ),
      mediaRefs: pickWithFallback(
        sourceRecord,
        input.selectors?.getMediaRefs,
        stringArrayOrUndefined(fallback.mediaRefs),
      ),
      tier:
        pickWithFallback(
          sourceRecord,
          input.selectors?.getTier,
          tierOrUndefined(fallback.tier),
        ) ??
        input.defaultTier ??
        DEFAULT_TIER,
      accessCount: pickWithFallback(
        sourceRecord,
        input.selectors?.getAccessCount,
        numberOrUndefined(fallback.accessCount),
      ),
      lastAccessAt: pickWithFallback(
        sourceRecord,
        input.selectors?.getLastAccessAt,
        numberOrUndefined(fallback.lastAccessAt),
      ),
      importanceScore: pickWithFallback(
        sourceRecord,
        input.selectors?.getImportanceScore,
        numberOrUndefined(fallback.importanceScore),
      ),
      isPinned: pickWithFallback(
        sourceRecord,
        input.selectors?.getIsPinned,
        booleanOrUndefined(fallback.isPinned),
      ),
      archivedAt: pickWithFallback(
        sourceRecord,
        input.selectors?.getArchivedAt,
        numberOrUndefined(fallback.archivedAt),
      ),
      dimensions: pickWithFallback(
        sourceRecord,
        input.selectors?.getDimensions,
        dimensionsOrUndefined(fallback.dimensions),
      ),
      metadata,
    });
    sourceIndexesByRecordId[recordId] = sourceIndex;
  });

  return {
    records,
    skippedRecords,
    sourceIndexesByRecordId,
  };
}

export function buildMemoryRelationPipelineDiagnostics<TRecord>(
  input: BuildMemoryRelationPipelineDiagnosticsInput<TRecord>,
): MemoryRelationPipelineDiagnostics {
  const adapted = adaptMemoryRecordsForConsolidation({
    records: input.records,
    defaultUserId: input.defaultUserId,
    defaultTier: input.defaultTier,
    selectors: input.selectors,
  });
  const sourceRecordById = new Map(
    adapted.records.map((record) => {
      const sourceIndex = adapted.sourceIndexesByRecordId[record.id] ?? -1;
      return [
        record.id,
        {
          sourceRecord: input.records[sourceIndex]!,
          sourceIndex,
        },
      ];
    }),
  );
  const candidateKeysByRecordId = new Map<string, string[]>();
  const temporaryScopeBehavior =
    input.temporaryScopeBehavior ?? DEFAULT_TEMPORARY_SCOPE_BEHAVIOR;
  const pipeline = buildMemoryRelationPipeline({
    ...input,
    records: adapted.records,
    getCandidateKeys(record) {
      const source = sourceRecordById.get(record.id);
      const keys = source
        ? [
            ...(input.getCandidateKeys?.(record, source) ??
              defaultAdapterCandidateKeys(record)),
          ].filter((key): key is string => Boolean(key))
        : defaultAdapterCandidateKeys(record);

      candidateKeysByRecordId.set(record.id, [...new Set(keys)].sort());
      return keys;
    },
    judgment: {
      ...input.judgment,
      judgeCandidate(candidate, context) {
        const callerDecision = input.judgment?.judgeCandidate?.(
          candidate,
          context,
        );

        if (callerDecision) {
          return callerDecision;
        }

        if (temporaryScopeBehavior === "related") {
          const fromScope = relationStringFromRecord(
            context.fromRecord,
            "relationScope",
          );
          const toScope = relationStringFromRecord(
            context.toRecord,
            "relationScope",
          );

          if (isTemporaryScope(fromScope) || isTemporaryScope(toScope)) {
            return {
              relation: "related",
              weight: 0.45,
              reasonCodes: ["candidate_related"],
            };
          }
        }

        return context.defaultDecision;
      },
    },
  });
  const candidateCounts = countCandidateLinks(pipeline);
  const supportCounts = countRelationsByKind(pipeline, "support");
  const competeCounts = countRelationsByKind(pipeline, "compete");
  const relatedCounts = countRelationsByKind(pipeline, "related");
  const clusterByKey = new Map(
    pipeline.assignment.clusters.map((cluster) => [cluster.clusterId, cluster]),
  );
  const planEntryByClusterKey = new Map(
    pipeline.plan.entries.map((entry) => [entry.clusterKey, entry]),
  );
  const summaryCandidateByClusterKey = new Map(
    pipeline.summaryCandidates.map((candidate) => [
      candidate.clusterKey,
      candidate,
    ]),
  );

  const recordDiagnostics = adapted.records.map((record) => {
    const clusterKey = pipeline.assignment.recordClusterKeys[record.id];
    const cluster = clusterKey ? clusterByKey.get(clusterKey) : undefined;
    const planEntry = clusterKey
      ? planEntryByClusterKey.get(clusterKey)
      : undefined;
    const summaryCandidate = clusterKey
      ? summaryCandidateByClusterKey.get(clusterKey)
      : undefined;

    return {
      recordId: record.id,
      sourceIndex: adapted.sourceIndexesByRecordId[record.id] ?? -1,
      clusterKey,
      competitionKey: clusterKey
        ? pipeline.assignment.clusterCompetitionKeys[clusterKey]
        : undefined,
      graphStatus: cluster?.status,
      planAction: planEntry?.action,
      planReasonCodes: planEntry?.reasonCodes ?? [],
      relationCandidateCount: candidateCounts.get(record.id) ?? 0,
      supportRelationCount: supportCounts.get(record.id) ?? 0,
      competeRelationCount: competeCounts.get(record.id) ?? 0,
      relatedRelationCount: relatedCounts.get(record.id) ?? 0,
      selectedForSummary: summaryCandidate !== undefined,
      summaryPriority: summaryCandidate?.priority,
    };
  });

  return {
    records: adapted.records,
    skippedRecords: adapted.skippedRecords,
    pipeline,
    recordDiagnostics,
    summary: {
      sourceRecordCount: input.records.length,
      adaptedRecordCount: adapted.records.length,
      skippedRecordCount: adapted.skippedRecords.length,
      recordsWithCandidateKeys: adapted.records.filter(
        (record) => (candidateKeysByRecordId.get(record.id)?.length ?? 0) > 0,
      ).length,
      recordsWithRelationGroup: adapted.records.filter((record) =>
        Boolean(relationStringFromRecord(record, "relationGroup")),
      ).length,
      recordsWithRelationValue: adapted.records.filter((record) =>
        Boolean(relationStringFromRecord(record, "relationValue")),
      ).length,
      candidateCount: pipeline.candidates.length,
      relationCount: pipeline.relations.length,
      supportRelationCount: pipeline.relations.filter(
        (edge) => edge.relation === "support",
      ).length,
      competeRelationCount: pipeline.relations.filter(
        (edge) => edge.relation === "compete",
      ).length,
      relatedRelationCount: pipeline.relations.filter(
        (edge) => edge.relation === "related",
      ).length,
      clusterCount: pipeline.assignment.clusters.length,
      competitionGroupCount: pipeline.assignment.competitionGroups.length,
      preserveCount: pipeline.plan.actions.preserve.length,
      observeCount: pipeline.plan.actions.observe.length,
      decayCount: pipeline.plan.actions.decay.length,
      summaryCandidateCount: pipeline.summaryCandidates.length,
    },
  };
}

export function buildMemoryConsolidationDiagnosticsReport(
  diagnostics: MemoryRelationPipelineDiagnostics,
): MemoryConsolidationDiagnosticsReport {
  const summaryCandidateByClusterKey = new Map(
    diagnostics.pipeline.summaryCandidates.map((candidate) => [
      candidate.clusterKey,
      candidate,
    ]),
  );
  const graphStatusByClusterKey = new Map(
    diagnostics.pipeline.assignment.clusters.map((cluster) => [
      cluster.clusterId,
      cluster.status,
    ]),
  );

  const preservedClusters = diagnostics.pipeline.plan.actions.preserve
    .map((entry) => ({
      clusterKey: entry.clusterKey,
      competitionKey: entry.competitionKey,
      recordIds: [...entry.recordIds],
      evidenceCount: entry.evidenceCount,
      score: entry.score,
      reasonCodes: [...entry.reasonCodes],
      summaryPriority: summaryCandidateByClusterKey.get(entry.clusterKey)
        ?.priority,
    }))
    .sort((a, b) => {
      const priorityDelta = (b.summaryPriority ?? 0) - (a.summaryPriority ?? 0);
      return priorityDelta || b.score - a.score;
    });
  const contestedClusters = diagnostics.pipeline.plan.entries
    .filter(
      (entry) =>
        entry.competingClusterKeys.length > 0 ||
        graphStatusByClusterKey.get(entry.clusterKey) === "contested",
    )
    .map((entry) => ({
      clusterKey: entry.clusterKey,
      competitionKey: entry.competitionKey,
      recordIds: [...entry.recordIds],
      action: entry.action,
      competingClusterKeys: [...entry.competingClusterKeys],
      winningClusterKey: entry.winningClusterKey,
      scoreMargin: entry.scoreMargin,
      reasonCodes: [...entry.reasonCodes],
    }));
  const decayedRecords = diagnostics.recordDiagnostics
    .filter((signal) => signal.planAction === "decay")
    .map((signal) => ({
      recordId: signal.recordId,
      sourceIndex: signal.sourceIndex,
      clusterKey: signal.clusterKey,
      reasonCodes: [...signal.planReasonCodes],
    }))
    .sort((a, b) => a.sourceIndex - b.sourceIndex);
  const recordSignals = diagnostics.recordDiagnostics
    .map((signal) => ({
      recordId: signal.recordId,
      sourceIndex: signal.sourceIndex,
      clusterKey: signal.clusterKey,
      graphStatus: signal.graphStatus,
      planAction: signal.planAction,
      relationCandidateCount: signal.relationCandidateCount,
      supportRelationCount: signal.supportRelationCount,
      competeRelationCount: signal.competeRelationCount,
      relatedRelationCount: signal.relatedRelationCount,
      selectedForSummary: signal.selectedForSummary,
    }))
    .sort((a, b) => a.sourceIndex - b.sourceIndex);

  return {
    summary: {
      sourceRecordCount: diagnostics.summary.sourceRecordCount,
      adaptedRecordCount: diagnostics.summary.adaptedRecordCount,
      skippedRecordCount: diagnostics.summary.skippedRecordCount,
      candidateCount: diagnostics.summary.candidateCount,
      relationCount: diagnostics.summary.relationCount,
      clusterCount: diagnostics.summary.clusterCount,
      competitionGroupCount: diagnostics.summary.competitionGroupCount,
      preserveCount: diagnostics.summary.preserveCount,
      observeCount: diagnostics.summary.observeCount,
      decayCount: diagnostics.summary.decayCount,
      summaryCandidateCount: diagnostics.summary.summaryCandidateCount,
    },
    preservedClusters,
    contestedClusters,
    decayedRecords,
    skippedRecords: diagnostics.skippedRecords.map((record) => ({
      sourceIndex: record.sourceIndex,
      reasonCodes: [...record.reasonCodes],
    })),
    recordSignals,
  };
}
