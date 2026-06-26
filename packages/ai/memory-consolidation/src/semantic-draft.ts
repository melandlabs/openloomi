import type {
  MemoryConsolidationDiagnosticsReport,
  MemoryConsolidationPreservedClusterReport,
} from "./adapter";
import type { MemoryEvidenceRecord } from "./evidence-cluster";
import type { MemoryConsolidationReasonCode } from "./plan";

export type MemorySemanticDraftSuggestedType =
  | "preference"
  | "project_state"
  | "decision"
  | "constraint"
  | "unknown"
  | (string & {});

export interface MemorySemanticDraftCandidate {
  draftId: string;
  sourceClusterKey: string;
  competitionKey: string;
  sourceRecordIds: string[];
  suggestedType: MemorySemanticDraftSuggestedType;
  confidence: number;
  evidenceCount: number;
  score: number;
  reasonCodes: MemoryConsolidationReasonCode[];
  needsSummary: true;
  summaryPriority?: number;
}

export interface SemanticMemoryDraft {
  type: MemorySemanticDraftSuggestedType;
  content: string;
  sourceRecordIds: string[];
  confidence: number;
  metadata?: Record<string, unknown>;
}

export interface SemanticMemoryDraftSummarizerContext {
  now?: number;
  metadata?: Record<string, unknown>;
}

export interface SemanticMemoryDraftSummarizer {
  summarizeDraft(
    candidate: MemorySemanticDraftCandidate,
    records: MemoryEvidenceRecord[],
    context?: SemanticMemoryDraftSummarizerContext,
  ): Promise<SemanticMemoryDraft>;
}

export interface BuildSemanticMemoryDraftCandidatesInput {
  report: MemoryConsolidationDiagnosticsReport;
  records?: MemoryEvidenceRecord[];
  maxCandidates?: number;
  getSuggestedType?(context: {
    cluster: MemoryConsolidationPreservedClusterReport;
    records: MemoryEvidenceRecord[];
  }): MemorySemanticDraftSuggestedType | undefined;
}

export interface SummarizeSemanticMemoryDraftCandidateInput {
  candidate: MemorySemanticDraftCandidate;
  records: MemoryEvidenceRecord[];
  summarizer: SemanticMemoryDraftSummarizer;
  context?: SemanticMemoryDraftSummarizerContext;
}

export type SemanticMemoryDraftReadinessReasonCode =
  | "invalid_confidence"
  | "low_confidence"
  | "missing_provenance"
  | "missing_source_records"
  | "missing_source_text"
  | (string & {});

export interface AnalyzeSemanticMemoryDraftReadinessInput {
  candidate: MemorySemanticDraftCandidate;
  records: MemoryEvidenceRecord[];
  minConfidence?: number;
}

export interface SemanticMemoryDraftReadinessDiagnostics {
  draftId: string;
  ready: boolean;
  confidence: number;
  minConfidence: number;
  sourceRecordIds: string[];
  availableSourceRecordIds: string[];
  missingSourceRecordIds: string[];
  recordsMissingTextIds: string[];
  reasonCodes: SemanticMemoryDraftReadinessReasonCode[];
}

export interface SemanticMemoryDraftSummarizerRequestDiagnostics {
  draftId: string;
  sourceClusterKey: string;
  competitionKey: string;
  suggestedType: MemorySemanticDraftSuggestedType;
  confidence: number;
  sourceRecordIds: string[];
  availableSourceRecordIds: string[];
  missingSourceRecordIds: string[];
  recordsMissingTextIds: string[];
  ready: boolean;
  reasonCodes: SemanticMemoryDraftReadinessReasonCode[];
}

export type SemanticMemoryDraftSummarizerResponseReasonCode =
  | "missing_output_content"
  | "output_source_record_mismatch"
  | "output_type_mismatch"
  | "invalid_output_confidence"
  | (string & {});

export interface SemanticMemoryDraftSummarizerResponseDiagnostics {
  draftId: string;
  outputType: MemorySemanticDraftSuggestedType;
  outputConfidence: number;
  outputSourceRecordIds: string[];
  preservesType: boolean;
  preservesSourceRecordIds: boolean;
  hasContent: boolean;
  reasonCodes: SemanticMemoryDraftSummarizerResponseReasonCode[];
}

export interface SemanticMemoryDraftSummarizerDiagnostics {
  request: SemanticMemoryDraftSummarizerRequestDiagnostics;
  response?: SemanticMemoryDraftSummarizerResponseDiagnostics;
}

export interface SemanticMemoryDraftSummarizerSourceRecordInput {
  recordId: string;
  text: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface SemanticMemoryDraftSummarizerCandidateInput {
  draftId: string;
  sourceClusterKey: string;
  competitionKey: string;
  suggestedType: MemorySemanticDraftSuggestedType;
  confidence: number;
  sourceRecordIds: string[];
  reasonCodes: MemoryConsolidationReasonCode[];
  needsSummary: true;
  summaryPriority?: number;
}

export interface SemanticMemoryDraftSummarizerInputContract {
  candidate: SemanticMemoryDraftSummarizerCandidateInput;
  request: SemanticMemoryDraftSummarizerRequestDiagnostics;
  sourceRecords: SemanticMemoryDraftSummarizerSourceRecordInput[];
  context?: SemanticMemoryDraftSummarizerContext;
}

export interface SemanticMemoryDraftSummarizerProviderInvoke {
  (
    input: SemanticMemoryDraftSummarizerInputContract,
  ): Promise<SemanticMemoryDraft>;
}

export type SemanticMemoryDraftSummarizerProviderAdapterStatus =
  | "summarized"
  | "skipped"
  | "failed";

export type SemanticMemoryDraftSummarizerProviderAdapterReasonCode =
  | "request_not_ready"
  | "provider_error"
  | SemanticMemoryDraftReadinessReasonCode
  | SemanticMemoryDraftSummarizerResponseReasonCode
  | (string & {});

export interface SemanticMemoryDraftSummarizerProviderAdapterError {
  name?: string;
  message: string;
}

export interface SemanticMemoryDraftSummarizerProviderAdapterResult {
  status: SemanticMemoryDraftSummarizerProviderAdapterStatus;
  input: SemanticMemoryDraftSummarizerInputContract;
  diagnostics: SemanticMemoryDraftSummarizerDiagnostics;
  draft?: SemanticMemoryDraft;
  error?: SemanticMemoryDraftSummarizerProviderAdapterError;
  reasonCodes: SemanticMemoryDraftSummarizerProviderAdapterReasonCode[];
}

export interface BuildSemanticMemoryDraftSummarizerDiagnosticsInput {
  candidate: MemorySemanticDraftCandidate;
  records: MemoryEvidenceRecord[];
  minConfidence?: number;
  draft?: SemanticMemoryDraft;
}

export interface BuildSemanticMemoryDraftSummarizerInputContractInput {
  candidate: MemorySemanticDraftCandidate;
  records: MemoryEvidenceRecord[];
  context?: SemanticMemoryDraftSummarizerContext;
  minConfidence?: number;
}

export interface InvokeSemanticMemoryDraftSummarizerProviderInput extends BuildSemanticMemoryDraftSummarizerInputContractInput {
  invoke: SemanticMemoryDraftSummarizerProviderInvoke;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function primitiveString(value: unknown): string | undefined {
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

function relationValue(
  record: MemoryEvidenceRecord,
  key: "relationGroup" | "memoryType" | "type",
): string | undefined {
  return primitiveString(record.metadata?.[key] ?? record.dimensions?.[key]);
}

function explicitSuggestedType(
  records: MemoryEvidenceRecord[],
): MemorySemanticDraftSuggestedType | undefined {
  for (const record of records) {
    const suggestedType =
      relationValue(record, "memoryType") ??
      primitiveString(record.metadata?.type);

    if (suggestedType) {
      return suggestedType;
    }
  }

  return undefined;
}

function inferSuggestedTypeFromText(
  value: string | undefined,
): MemorySemanticDraftSuggestedType | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.toLowerCase();

  if (
    normalized.includes("preference") ||
    normalized.includes("language") ||
    normalized.includes("style") ||
    normalized.includes("tone") ||
    normalized.includes("format")
  ) {
    return "preference";
  }

  if (
    normalized.includes("project-state") ||
    normalized.includes("project_state") ||
    normalized.includes("project status") ||
    normalized.includes("state") ||
    normalized.includes("status") ||
    normalized.includes("progress")
  ) {
    return "project_state";
  }

  if (
    normalized.includes("decision") ||
    normalized.includes("decided") ||
    normalized.includes("choice")
  ) {
    return "decision";
  }

  if (
    normalized.includes("constraint") ||
    normalized.includes("requirement") ||
    normalized.includes("rule") ||
    normalized.includes("policy") ||
    normalized.includes("limit")
  ) {
    return "constraint";
  }

  return undefined;
}

function inferSuggestedType(
  cluster: MemoryConsolidationPreservedClusterReport,
  records: MemoryEvidenceRecord[],
): MemorySemanticDraftSuggestedType {
  const explicit = explicitSuggestedType(records);
  if (explicit) {
    return explicit;
  }

  for (const record of records) {
    const fromRelationGroup = inferSuggestedTypeFromText(
      relationValue(record, "relationGroup"),
    );

    if (fromRelationGroup) {
      return fromRelationGroup;
    }
  }

  return (
    inferSuggestedTypeFromText(cluster.clusterKey) ??
    inferSuggestedTypeFromText(cluster.competitionKey) ??
    "unknown"
  );
}

function draftId(clusterKey: string): string {
  return `semantic-draft:${encodeURIComponent(clusterKey)}`;
}

function resolveMaxCandidates(value: number | undefined): number {
  if (value === undefined) {
    return Number.POSITIVE_INFINITY;
  }

  if (!Number.isFinite(value)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, Math.floor(value));
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();

  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function copyContext(
  context: SemanticMemoryDraftSummarizerContext | undefined,
): SemanticMemoryDraftSummarizerContext | undefined {
  if (!context) {
    return undefined;
  }

  return {
    now: context.now,
    metadata: context.metadata ? { ...context.metadata } : undefined,
  };
}

function toProviderAdapterError(
  error: unknown,
): SemanticMemoryDraftSummarizerProviderAdapterError {
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

function buildSummarizerResponseDiagnostics(
  candidate: MemorySemanticDraftCandidate,
  draft: SemanticMemoryDraft,
): SemanticMemoryDraftSummarizerResponseDiagnostics {
  const hasContent = draft.content.trim().length > 0;
  const preservesType = draft.type === candidate.suggestedType;
  const preservesSourceRecordIds = sameStringSet(
    draft.sourceRecordIds,
    candidate.sourceRecordIds,
  );
  const reasonCodes: SemanticMemoryDraftSummarizerResponseReasonCode[] = [];

  if (!hasContent) {
    reasonCodes.push("missing_output_content");
  }

  if (!preservesSourceRecordIds) {
    reasonCodes.push("output_source_record_mismatch");
  }

  if (!preservesType) {
    reasonCodes.push("output_type_mismatch");
  }

  if (!Number.isFinite(draft.confidence)) {
    reasonCodes.push("invalid_output_confidence");
  }

  return {
    draftId: candidate.draftId,
    outputType: draft.type,
    outputConfidence: draft.confidence,
    outputSourceRecordIds: [...draft.sourceRecordIds],
    preservesType,
    preservesSourceRecordIds,
    hasContent,
    reasonCodes,
  };
}

export function buildSemanticMemoryDraftCandidates(
  input: BuildSemanticMemoryDraftCandidatesInput,
): MemorySemanticDraftCandidate[] {
  const recordsById = new Map(
    (input.records ?? []).map((record) => [record.id, record]),
  );
  const maxCandidates = resolveMaxCandidates(input.maxCandidates);

  return input.report.preservedClusters
    .map((cluster) => {
      const records = cluster.recordIds.flatMap((recordId) => {
        const record = recordsById.get(recordId);
        return record ? [record] : [];
      });
      const suggestedType =
        input.getSuggestedType?.({ cluster, records }) ??
        inferSuggestedType(cluster, records);

      return {
        draftId: draftId(cluster.clusterKey),
        sourceClusterKey: cluster.clusterKey,
        competitionKey: cluster.competitionKey,
        sourceRecordIds: [...cluster.recordIds],
        suggestedType,
        confidence: clamp01(cluster.score),
        evidenceCount: cluster.evidenceCount,
        score: cluster.score,
        reasonCodes: [...cluster.reasonCodes],
        needsSummary: true as const,
        summaryPriority: cluster.summaryPriority,
      };
    })
    .sort((a, b) => {
      const priorityDelta = (b.summaryPriority ?? 0) - (a.summaryPriority ?? 0);
      return (
        priorityDelta ||
        b.score - a.score ||
        a.sourceClusterKey.localeCompare(b.sourceClusterKey)
      );
    })
    .slice(0, maxCandidates);
}

export async function summarizeSemanticMemoryDraftCandidate(
  input: SummarizeSemanticMemoryDraftCandidateInput,
): Promise<SemanticMemoryDraft> {
  const recordsById = new Map(
    input.records.map((record) => [record.id, record]),
  );
  const sourceRecords = input.candidate.sourceRecordIds.flatMap((recordId) => {
    const record = recordsById.get(recordId);
    return record ? [record] : [];
  });

  return input.summarizer.summarizeDraft(
    input.candidate,
    sourceRecords,
    input.context,
  );
}

export function analyzeSemanticMemoryDraftReadiness(
  input: AnalyzeSemanticMemoryDraftReadinessInput,
): SemanticMemoryDraftReadinessDiagnostics {
  const recordsById = new Map(
    input.records.map((record) => [record.id, record]),
  );
  const minConfidence = clamp01(input.minConfidence ?? 0);
  const sourceRecordIds = [...input.candidate.sourceRecordIds];
  const availableSourceRecordIds: string[] = [];
  const missingSourceRecordIds: string[] = [];
  const recordsMissingTextIds: string[] = [];
  const reasonCodes: SemanticMemoryDraftReadinessReasonCode[] = [];

  for (const recordId of sourceRecordIds) {
    const record = recordsById.get(recordId);

    if (!record) {
      missingSourceRecordIds.push(recordId);
      continue;
    }

    availableSourceRecordIds.push(recordId);

    if (!record.text?.trim()) {
      recordsMissingTextIds.push(recordId);
    }
  }

  if (!Number.isFinite(input.candidate.confidence)) {
    reasonCodes.push("invalid_confidence");
  } else if (input.candidate.confidence < minConfidence) {
    reasonCodes.push("low_confidence");
  }

  if (
    !input.candidate.sourceClusterKey ||
    !input.candidate.competitionKey ||
    input.candidate.reasonCodes.length === 0
  ) {
    reasonCodes.push("missing_provenance");
  }

  if (missingSourceRecordIds.length > 0 || sourceRecordIds.length === 0) {
    reasonCodes.push("missing_source_records");
  }

  if (recordsMissingTextIds.length > 0) {
    reasonCodes.push("missing_source_text");
  }

  return {
    draftId: input.candidate.draftId,
    ready: reasonCodes.length === 0,
    confidence: input.candidate.confidence,
    minConfidence,
    sourceRecordIds,
    availableSourceRecordIds,
    missingSourceRecordIds,
    recordsMissingTextIds,
    reasonCodes,
  };
}

export function buildSemanticMemoryDraftSummarizerDiagnostics(
  input: BuildSemanticMemoryDraftSummarizerDiagnosticsInput,
): SemanticMemoryDraftSummarizerDiagnostics {
  const readiness = analyzeSemanticMemoryDraftReadiness({
    candidate: input.candidate,
    records: input.records,
    minConfidence: input.minConfidence,
  });
  const request: SemanticMemoryDraftSummarizerRequestDiagnostics = {
    draftId: input.candidate.draftId,
    sourceClusterKey: input.candidate.sourceClusterKey,
    competitionKey: input.candidate.competitionKey,
    suggestedType: input.candidate.suggestedType,
    confidence: input.candidate.confidence,
    sourceRecordIds: [...readiness.sourceRecordIds],
    availableSourceRecordIds: [...readiness.availableSourceRecordIds],
    missingSourceRecordIds: [...readiness.missingSourceRecordIds],
    recordsMissingTextIds: [...readiness.recordsMissingTextIds],
    ready: readiness.ready,
    reasonCodes: [...readiness.reasonCodes],
  };

  return {
    request,
    response: input.draft
      ? buildSummarizerResponseDiagnostics(input.candidate, input.draft)
      : undefined,
  };
}

export function buildSemanticMemoryDraftSummarizerInputContract(
  input: BuildSemanticMemoryDraftSummarizerInputContractInput,
): SemanticMemoryDraftSummarizerInputContract {
  const recordsById = new Map(
    input.records.map((record) => [record.id, record]),
  );
  const diagnostics = buildSemanticMemoryDraftSummarizerDiagnostics({
    candidate: input.candidate,
    records: input.records,
    minConfidence: input.minConfidence,
  });
  const sourceRecords =
    diagnostics.request.sourceRecordIds.flatMap<SemanticMemoryDraftSummarizerSourceRecordInput>(
      (recordId) => {
        const record = recordsById.get(recordId);

        if (!record) {
          return [];
        }

        return [
          {
            recordId,
            text: record.text ?? "",
            timestamp: record.timestamp,
            metadata: record.metadata ? { ...record.metadata } : undefined,
          },
        ];
      },
    );

  return {
    candidate: {
      draftId: input.candidate.draftId,
      sourceClusterKey: input.candidate.sourceClusterKey,
      competitionKey: input.candidate.competitionKey,
      suggestedType: input.candidate.suggestedType,
      confidence: input.candidate.confidence,
      sourceRecordIds: [...input.candidate.sourceRecordIds],
      reasonCodes: [...input.candidate.reasonCodes],
      needsSummary: true,
      summaryPriority: input.candidate.summaryPriority,
    },
    request: diagnostics.request,
    sourceRecords,
    context: copyContext(input.context),
  };
}

export async function invokeSemanticMemoryDraftSummarizerProvider(
  input: InvokeSemanticMemoryDraftSummarizerProviderInput,
): Promise<SemanticMemoryDraftSummarizerProviderAdapterResult> {
  const inputContract = buildSemanticMemoryDraftSummarizerInputContract(input);

  if (!inputContract.request.ready) {
    return {
      status: "skipped",
      input: inputContract,
      diagnostics: {
        request: inputContract.request,
      },
      reasonCodes: ["request_not_ready", ...inputContract.request.reasonCodes],
    };
  }

  try {
    const draft = await input.invoke(inputContract);
    const diagnostics = buildSemanticMemoryDraftSummarizerDiagnostics({
      candidate: input.candidate,
      records: input.records,
      minConfidence: input.minConfidence,
      draft,
    });

    return {
      status: "summarized",
      input: inputContract,
      diagnostics,
      draft,
      reasonCodes: [...(diagnostics.response?.reasonCodes ?? [])],
    };
  } catch (error) {
    return {
      status: "failed",
      input: inputContract,
      diagnostics: {
        request: inputContract.request,
      },
      error: toProviderAdapterError(error),
      reasonCodes: ["provider_error"],
    };
  }
}
