import {
  buildMemoryConsolidationDiagnosticsReport,
  buildMemoryRelationPipelineDiagnostics,
  type BuildMemoryRelationPipelineDiagnosticsInput,
  type MemoryConsolidationDiagnosticsReport,
  type MemoryConsolidationSourceRecord,
  type MemoryRelationPipelineDiagnostics,
} from "./adapter";
import {
  buildSemanticMemoryDraftCandidates,
  type BuildSemanticMemoryDraftCandidatesInput,
  type MemorySemanticDraftCandidate,
} from "./semantic-draft";

const DEFAULT_DIAGNOSTICS_LIMIT = 500;

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
