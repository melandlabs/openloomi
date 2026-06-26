import {
  adaptMemoryRecordsForConsolidation,
  buildMemoryConsolidationDiagnosticsReport,
  buildMemoryRelationPipelineDiagnostics,
  type AdaptMemoryRecordsForConsolidationResult,
  type BuildMemoryRelationPipelineDiagnosticsInput,
  type MemoryConsolidationContestedClusterReport,
  type MemoryConsolidationDecayedRecordReport,
  type MemoryConsolidationDiagnosticsReport,
  type MemoryConsolidationPreservedClusterReport,
  type MemoryConsolidationRecordSelectors,
  type MemoryConsolidationSkippedRecord,
  type MemoryConsolidationSourceRecord,
  type MemoryRelationPipelineDiagnostics,
} from "./adapter";
import type { MemoryEvidenceTier } from "./evidence-cluster";
import {
  buildSemanticMemoryDraftCandidates,
  type BuildSemanticMemoryDraftCandidatesInput,
  type MemorySemanticDraftCandidate,
} from "./semantic-draft";

const DEFAULT_DIAGNOSTICS_LIMIT = 500;

type RuntimeDimensionValue = string | number | boolean;

export interface MemoryConsolidationRuntimeMemoryRecord {
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
  dimensions?: Record<string, RuntimeDimensionValue | undefined>;
  metadata?: Record<string, unknown>;
}

export interface MemoryConsolidationRuntimeRelationKeys {
  relationGroup?: string;
  relationValue?: string;
  relationScope?: string;
}

export interface BuildMemoryConsolidationRuntimeRecordSelectorsInput {
  relationKeys?: MemoryConsolidationRuntimeRelationKeys;
}

export interface AdaptRuntimeMemoryRecordsForConsolidationInput<
  TRecord extends MemoryConsolidationRuntimeMemoryRecord =
    MemoryConsolidationRuntimeMemoryRecord,
> {
  records: TRecord[];
  defaultUserId?: string;
  defaultTier?: MemoryEvidenceTier;
  relationKeys?: MemoryConsolidationRuntimeRelationKeys;
}

export interface MemoryConsolidationDiagnosticsRecordReader<
  TRecord = MemoryConsolidationSourceRecord,
> {
  listCandidateRecords(input: {
    userId: string;
    now: number;
    limit: number;
  }): Promise<TRecord[]>;
}

export interface RunMemoryConsolidationDiagnosticsInput<
  TRecord = MemoryConsolidationSourceRecord,
> extends Omit<
  BuildMemoryRelationPipelineDiagnosticsInput<TRecord>,
  "records" | "now"
> {
  userId: string;
  now?: number;
  dryRun?: boolean;
  limit?: number;
  reader: MemoryConsolidationDiagnosticsRecordReader<TRecord>;
  semanticDraftCandidates?: Omit<
    BuildSemanticMemoryDraftCandidatesInput,
    "report" | "records"
  >;
}

export interface MemoryConsolidationDiagnosticsRunResult {
  status: "success";
  dryRun: true;
  userId: string;
  startedAt: number;
  finishedAt: number;
  scannedRecords: number;
  diagnostics: MemoryRelationPipelineDiagnostics;
  report: MemoryConsolidationDiagnosticsReport;
  semanticDraftCandidates: MemorySemanticDraftCandidate[];
}

export interface MemoryConsolidationDiagnosticsRunReportSummary {
  status: MemoryConsolidationDiagnosticsRunResult["status"];
  dryRun: true;
  userId: string;
  startedAt: number;
  finishedAt: number;
  scannedRecordCount: number;
  adaptedRecordCount: number;
  skippedRecordCount: number;
  preservedClusterCount: number;
  contestedClusterCount: number;
  suppressedRecordCount: number;
  semanticDraftCandidateCount: number;
}

export interface MemoryConsolidationDiagnosticsRunReportPreservedCluster extends MemoryConsolidationPreservedClusterReport {
  semanticDraftCandidateIds: string[];
}

export interface MemoryConsolidationDiagnosticsRunReport {
  summary: MemoryConsolidationDiagnosticsRunReportSummary;
  skippedRecords: MemoryConsolidationSkippedRecord[];
  preservedClusters: MemoryConsolidationDiagnosticsRunReportPreservedCluster[];
  contestedClusters: MemoryConsolidationContestedClusterReport[];
  suppressedRecords: MemoryConsolidationDecayedRecordReport[];
  semanticDraftCandidateIds: string[];
}

export interface MemoryConsolidationDiagnosticsLogSink {
  logDiagnosticsRun(
    report: MemoryConsolidationDiagnosticsRunReport,
  ): Promise<void> | void;
}

export interface LogMemoryConsolidationDiagnosticsRunInput {
  result: MemoryConsolidationDiagnosticsRunResult;
  enabled?: boolean;
  sink?: MemoryConsolidationDiagnosticsLogSink;
}

export type MemoryConsolidationDiagnosticsLogStatus = "disabled" | "logged";

export type MemoryConsolidationDiagnosticsLogReasonCode =
  | "log_disabled"
  | "log_sink_missing"
  | "log_only";

export interface LogMemoryConsolidationDiagnosticsRunResult {
  status: MemoryConsolidationDiagnosticsLogStatus;
  report: MemoryConsolidationDiagnosticsRunReport;
  reasonCodes: MemoryConsolidationDiagnosticsLogReasonCode[];
}

function runtimePrimitiveString(value: unknown): string | undefined {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    return undefined;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : undefined;
}

function runtimeRelationValue(
  record: MemoryConsolidationRuntimeMemoryRecord,
  key: string,
): string | undefined {
  return runtimePrimitiveString(
    record.metadata?.[key] ?? record.dimensions?.[key],
  );
}

export function buildMemoryConsolidationRuntimeRecordSelectors<
  TRecord extends MemoryConsolidationRuntimeMemoryRecord =
    MemoryConsolidationRuntimeMemoryRecord,
>(
  input: BuildMemoryConsolidationRuntimeRecordSelectorsInput = {},
): MemoryConsolidationRecordSelectors<TRecord> {
  const relationGroupKey = input.relationKeys?.relationGroup ?? "relationGroup";
  const relationValueKey = input.relationKeys?.relationValue ?? "relationValue";
  const relationScopeKey = input.relationKeys?.relationScope ?? "relationScope";

  return {
    getId: (record) => record.id,
    getUserId: (record) => record.userId,
    getTimestamp: (record) => record.timestamp,
    getText: (record) => record.text,
    getMediaRefs: (record) => record.mediaRefs,
    getTier: (record) => record.tier,
    getAccessCount: (record) => record.accessCount,
    getLastAccessAt: (record) => record.lastAccessAt,
    getImportanceScore: (record) => record.importanceScore,
    getIsPinned: (record) => record.isPinned,
    getArchivedAt: (record) => record.archivedAt,
    getDimensions: (record) => record.dimensions,
    getMetadata: (record) => record.metadata,
    getRelationGroup: (record) =>
      runtimeRelationValue(record, relationGroupKey),
    getRelationValue: (record) =>
      runtimeRelationValue(record, relationValueKey),
    getRelationScope: (record) =>
      runtimeRelationValue(record, relationScopeKey),
  };
}

export function adaptRuntimeMemoryRecordsForConsolidation<
  TRecord extends MemoryConsolidationRuntimeMemoryRecord,
>(
  input: AdaptRuntimeMemoryRecordsForConsolidationInput<TRecord>,
): AdaptMemoryRecordsForConsolidationResult {
  return adaptMemoryRecordsForConsolidation({
    records: input.records,
    defaultUserId: input.defaultUserId,
    defaultTier: input.defaultTier,
    selectors: buildMemoryConsolidationRuntimeRecordSelectors<TRecord>({
      relationKeys: input.relationKeys,
    }),
  });
}

export function buildMemoryConsolidationDiagnosticsRunReport(
  result: MemoryConsolidationDiagnosticsRunResult,
): MemoryConsolidationDiagnosticsRunReport {
  const draftIdsByClusterKey = new Map<string, string[]>();

  for (const candidate of result.semanticDraftCandidates) {
    const ids = draftIdsByClusterKey.get(candidate.sourceClusterKey) ?? [];
    ids.push(candidate.draftId);
    draftIdsByClusterKey.set(candidate.sourceClusterKey, ids);
  }

  return {
    summary: {
      status: result.status,
      dryRun: true,
      userId: result.userId,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      scannedRecordCount: result.scannedRecords,
      adaptedRecordCount: result.report.summary.adaptedRecordCount,
      skippedRecordCount: result.report.summary.skippedRecordCount,
      preservedClusterCount: result.report.preservedClusters.length,
      contestedClusterCount: result.report.contestedClusters.length,
      suppressedRecordCount: result.report.decayedRecords.length,
      semanticDraftCandidateCount: result.semanticDraftCandidates.length,
    },
    skippedRecords: result.report.skippedRecords.map((record) => ({
      sourceIndex: record.sourceIndex,
      reasonCodes: [...record.reasonCodes],
    })),
    preservedClusters: result.report.preservedClusters.map((cluster) => ({
      ...cluster,
      recordIds: [...cluster.recordIds],
      reasonCodes: [...cluster.reasonCodes],
      semanticDraftCandidateIds: [
        ...(draftIdsByClusterKey.get(cluster.clusterKey) ?? []),
      ],
    })),
    contestedClusters: result.report.contestedClusters.map((cluster) => ({
      ...cluster,
      recordIds: [...cluster.recordIds],
      competingClusterKeys: [...cluster.competingClusterKeys],
      reasonCodes: [...cluster.reasonCodes],
    })),
    suppressedRecords: result.report.decayedRecords.map((record) => ({
      recordId: record.recordId,
      sourceIndex: record.sourceIndex,
      clusterKey: record.clusterKey,
      reasonCodes: [...record.reasonCodes],
    })),
    semanticDraftCandidateIds: result.semanticDraftCandidates.map(
      (candidate) => candidate.draftId,
    ),
  };
}

export async function logMemoryConsolidationDiagnosticsRun(
  input: LogMemoryConsolidationDiagnosticsRunInput,
): Promise<LogMemoryConsolidationDiagnosticsRunResult> {
  const report = buildMemoryConsolidationDiagnosticsRunReport(input.result);

  if (input.enabled !== true) {
    return {
      status: "disabled",
      report,
      reasonCodes: ["log_disabled"],
    };
  }

  if (!input.sink) {
    return {
      status: "disabled",
      report,
      reasonCodes: ["log_sink_missing"],
    };
  }

  await input.sink.logDiagnosticsRun(report);

  return {
    status: "logged",
    report,
    reasonCodes: ["log_only"],
  };
}

function resolveLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_DIAGNOSTICS_LIMIT;
  }

  return Math.max(0, Math.floor(limit));
}

export async function runMemoryConsolidationDiagnostics<TRecord>(
  input: RunMemoryConsolidationDiagnosticsInput<TRecord>,
): Promise<MemoryConsolidationDiagnosticsRunResult> {
  if (input.dryRun === false) {
    throw new Error("Memory consolidation diagnostics only supports dryRun.");
  }

  const startedAt = Date.now();
  const now = input.now ?? startedAt;
  const records = await input.reader.listCandidateRecords({
    userId: input.userId,
    now,
    limit: resolveLimit(input.limit),
  });
  const diagnostics = buildMemoryRelationPipelineDiagnostics({
    ...input,
    records,
    now,
  });
  const report = buildMemoryConsolidationDiagnosticsReport(diagnostics);
  const semanticDraftCandidates = buildSemanticMemoryDraftCandidates({
    ...input.semanticDraftCandidates,
    report,
    records: diagnostics.records,
  });

  return {
    status: "success",
    dryRun: true,
    userId: input.userId,
    startedAt,
    finishedAt: Date.now(),
    scannedRecords: records.length,
    diagnostics,
    report,
    semanticDraftCandidates,
  };
}
