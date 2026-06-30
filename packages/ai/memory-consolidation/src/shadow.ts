import {
  buildMemoryConsolidationDiagnosticsReport,
  buildMemoryRelationPipelineDiagnostics,
  type BuildMemoryRelationPipelineDiagnosticsInput,
  type MemoryConsolidationDiagnosticsReport,
  type MemoryConsolidationSourceRecord,
  type MemoryRelationPipelineDiagnostics,
} from "./adapter";
import {
  buildSemanticMemoryDraftPersistencePreparationReport,
  type SemanticMemoryDraftPersistencePreparationReport,
} from "./persistence";
import {
  buildSemanticMemoryDraftCandidates,
  invokeSemanticMemoryDraftSummarizerProviderBatch,
  type BuildSemanticMemoryDraftCandidatesInput,
  type MemorySemanticDraftCandidate,
  type SemanticMemoryDraftSummarizerContext,
  type SemanticMemoryDraftSummarizerProviderBatchReport,
  type SemanticMemoryDraftSummarizerProviderInvoke,
} from "./semantic-draft";

export type MemoryConsolidationShadowReasonCode =
  | "shadow_report_only"
  | "provider_not_configured"
  | "provider_batch_attached"
  | "persistence_preparation_attached"
  | "shadow_disabled"
  | "shadow_dry_run_required"
  | "shadow_run_failed"
  | "shadow_log_disabled"
  | "shadow_log_success"
  | "shadow_log_failed"
  | (string & {});

export interface BuildMemoryConsolidationShadowReportInput<
  TRecord = MemoryConsolidationSourceRecord,
> extends BuildMemoryRelationPipelineDiagnosticsInput<TRecord> {
  semanticDraftCandidates?: Omit<
    BuildSemanticMemoryDraftCandidatesInput,
    "report" | "records"
  >;
  summarizerProvider?: SemanticMemoryDraftSummarizerProviderInvoke;
  summarizerContext?: SemanticMemoryDraftSummarizerContext;
  minConfidence?: number;
  metadata?: Record<string, unknown>;
}

export interface MemoryConsolidationShadowReportSummary {
  sourceRecordCount: number;
  adaptedRecordCount: number;
  skippedRecordCount: number;
  semanticDraftCandidateCount: number;
  providerResultCount: number;
  summarizedCount: number;
  failedProviderCount: number;
  persistenceItemCount: number;
  skippedPersistenceResultCount: number;
}

export interface MemoryConsolidationShadowReport {
  summary: MemoryConsolidationShadowReportSummary;
  diagnostics: MemoryRelationPipelineDiagnostics;
  report: MemoryConsolidationDiagnosticsReport;
  semanticDraftCandidates: MemorySemanticDraftCandidate[];
  providerBatchReport?: SemanticMemoryDraftSummarizerProviderBatchReport;
  persistencePreparationReport?: SemanticMemoryDraftPersistencePreparationReport;
  reasonCodes: MemoryConsolidationShadowReasonCode[];
  metadata?: Record<string, unknown>;
  mutatesRuntime: false;
  mutatesStorage: false;
  mutatesRetrieval: false;
}

export interface RunMemoryConsolidationShadowDiagnosticsInput<
  TRecord = MemoryConsolidationSourceRecord,
> extends Omit<
  BuildMemoryConsolidationShadowReportInput<TRecord>,
  "records" | "now"
> {
  enabled?: boolean;
  dryRun?: boolean;
  now?: number;
  limit?: number;
  loadRecords(input: {
    now: number;
    limit?: number;
  }): Promise<TRecord[]> | TRecord[];
  logReport?(report: MemoryConsolidationShadowReport): Promise<void> | void;
}

export interface MemoryConsolidationShadowLogResult {
  status: "disabled" | "logged" | "failed";
  error?: {
    name?: string;
    message: string;
  };
}

export interface MemoryConsolidationShadowDiagnosticsRunResult {
  status: "disabled" | "success" | "unsupported" | "failed";
  dryRun: boolean;
  startedAt: number;
  finishedAt: number;
  scannedRecordCount: number;
  report?: MemoryConsolidationShadowReport;
  log: MemoryConsolidationShadowLogResult;
  error?: {
    name?: string;
    message: string;
  };
  reasonCodes: MemoryConsolidationShadowReasonCode[];
  mutatesRuntime: false;
  mutatesStorage: false;
  mutatesRetrieval: false;
}

function adapterError(error: unknown): { name?: string; message: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    message: String(error),
  };
}

export async function buildMemoryConsolidationShadowReport<TRecord>(
  input: BuildMemoryConsolidationShadowReportInput<TRecord>,
): Promise<MemoryConsolidationShadowReport> {
  const diagnostics = buildMemoryRelationPipelineDiagnostics(input);
  const report = buildMemoryConsolidationDiagnosticsReport(diagnostics);
  const semanticDraftCandidates = buildSemanticMemoryDraftCandidates({
    ...input.semanticDraftCandidates,
    report,
    records: diagnostics.records,
  });
  const reasonCodes = new Set<MemoryConsolidationShadowReasonCode>([
    "shadow_report_only",
  ]);
  let providerBatchReport:
    | SemanticMemoryDraftSummarizerProviderBatchReport
    | undefined;
  let persistencePreparationReport:
    | SemanticMemoryDraftPersistencePreparationReport
    | undefined;

  if (input.summarizerProvider) {
    providerBatchReport =
      await invokeSemanticMemoryDraftSummarizerProviderBatch({
        candidates: semanticDraftCandidates,
        records: diagnostics.records,
        context: input.summarizerContext,
        minConfidence: input.minConfidence,
        invoke: input.summarizerProvider,
      });
    reasonCodes.add("provider_batch_attached");
    for (const reasonCode of providerBatchReport.reasonCodes) {
      reasonCodes.add(reasonCode);
    }

    persistencePreparationReport =
      buildSemanticMemoryDraftPersistencePreparationReport({
        providerBatchReport,
      });
    reasonCodes.add("persistence_preparation_attached");
    for (const reasonCode of persistencePreparationReport.reasonCodes) {
      reasonCodes.add(reasonCode);
    }
  } else {
    reasonCodes.add("provider_not_configured");
  }

  return {
    summary: {
      sourceRecordCount: input.records.length,
      adaptedRecordCount: diagnostics.records.length,
      skippedRecordCount: diagnostics.skippedRecords.length,
      semanticDraftCandidateCount: semanticDraftCandidates.length,
      providerResultCount: providerBatchReport?.results.length ?? 0,
      summarizedCount: providerBatchReport?.summary.summarizedCount ?? 0,
      failedProviderCount: providerBatchReport?.summary.failedCount ?? 0,
      persistenceItemCount:
        persistencePreparationReport?.summary.persistenceItemCount ?? 0,
      skippedPersistenceResultCount:
        persistencePreparationReport?.summary.skippedResultCount ?? 0,
    },
    diagnostics,
    report,
    semanticDraftCandidates,
    providerBatchReport,
    persistencePreparationReport,
    reasonCodes: [...reasonCodes],
    metadata: input.metadata ? { ...input.metadata } : undefined,
    mutatesRuntime: false,
    mutatesStorage: false,
    mutatesRetrieval: false,
  };
}

export async function runMemoryConsolidationShadowDiagnostics<TRecord>(
  input: RunMemoryConsolidationShadowDiagnosticsInput<TRecord>,
): Promise<MemoryConsolidationShadowDiagnosticsRunResult> {
  const startedAt = Date.now();
  const now = input.now ?? startedAt;
  const base = {
    mutatesRuntime: false as const,
    mutatesStorage: false as const,
    mutatesRetrieval: false as const,
  };

  if (input.enabled !== true) {
    return {
      status: "disabled",
      dryRun: input.dryRun !== false,
      startedAt,
      finishedAt: Date.now(),
      scannedRecordCount: 0,
      log: { status: "disabled" },
      reasonCodes: ["shadow_disabled"],
      ...base,
    };
  }

  if (input.dryRun !== true) {
    return {
      status: "unsupported",
      dryRun: false,
      startedAt,
      finishedAt: Date.now(),
      scannedRecordCount: 0,
      log: { status: "disabled" },
      reasonCodes: ["shadow_dry_run_required"],
      ...base,
    };
  }

  let records: TRecord[];
  let report: MemoryConsolidationShadowReport;

  try {
    records = await input.loadRecords({ now, limit: input.limit });
    report = await buildMemoryConsolidationShadowReport({
      ...input,
      records,
      now,
    });
  } catch (error) {
    return {
      status: "failed",
      dryRun: true,
      startedAt,
      finishedAt: Date.now(),
      scannedRecordCount: 0,
      log: { status: "disabled" },
      error: adapterError(error),
      reasonCodes: ["shadow_run_failed"],
      ...base,
    };
  }

  const reasonCodes = new Set<MemoryConsolidationShadowReasonCode>([
    ...report.reasonCodes,
  ]);
  let log: MemoryConsolidationShadowLogResult = { status: "disabled" };

  if (input.logReport) {
    try {
      await input.logReport(report);
      log = { status: "logged" };
      reasonCodes.add("shadow_log_success");
    } catch (error) {
      log = {
        status: "failed",
        error: adapterError(error),
      };
      reasonCodes.add("shadow_log_failed");
    }
  } else {
    reasonCodes.add("shadow_log_disabled");
  }

  return {
    status: "success",
    dryRun: true,
    startedAt,
    finishedAt: Date.now(),
    scannedRecordCount: records.length,
    report,
    log,
    reasonCodes: [...reasonCodes],
    ...base,
  };
}
