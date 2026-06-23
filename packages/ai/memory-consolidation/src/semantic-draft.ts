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
