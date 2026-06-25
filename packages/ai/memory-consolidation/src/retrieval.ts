import type { MemorySemanticDraftSuggestedType } from "./semantic-draft";

export type MemorySemanticRetrievalCandidateStatus =
  | "eligible"
  | "suppressed"
  | "fallback";

export type MemorySemanticRetrievalDraftStatus =
  | "active"
  | "contested"
  | "deprecated"
  | "unknown"
  | (string & {});

export type MemorySemanticRetrievalReasonCode =
  | "semantic_draft_candidate"
  | "source_trace_fallback"
  | "low_confidence"
  | "contested_memory"
  | "max_candidates"
  | "query_relevance"
  | (string & {});

export interface MemorySemanticRetrievalDraft {
  draftId: string;
  type: MemorySemanticDraftSuggestedType;
  content: string;
  sourceRecordIds: string[];
  confidence: number;
  status?: MemorySemanticRetrievalDraftStatus;
  metadata?: Record<string, unknown>;
}

export interface MemorySemanticRetrievalCandidate {
  draftId: string;
  type: MemorySemanticDraftSuggestedType;
  content: string;
  sourceRecordIds: string[];
  confidence: number;
  queryRelevance: number;
  draftStatus: MemorySemanticRetrievalDraftStatus;
  status: MemorySemanticRetrievalCandidateStatus;
  reasonCodes: MemorySemanticRetrievalReasonCode[];
  metadata?: Record<string, unknown>;
}

export interface MemorySemanticRetrievalRelevanceContext {
  query: string;
  draft: MemorySemanticRetrievalDraft;
  now?: number;
  metadata?: Record<string, unknown>;
}

export interface MemorySemanticRetrievalPlanningInput {
  query: string;
  drafts: MemorySemanticRetrievalDraft[];
  existingRecordIds?: string[];
  now?: number;
  metadata?: Record<string, unknown>;
  minConfidence?: number;
  allowContested?: boolean;
  maxCandidates?: number;
  getDraftRelevance?(
    context: MemorySemanticRetrievalRelevanceContext,
  ): number | undefined;
}

export interface MemorySemanticRetrievalPlanningResult {
  query: string;
  candidates: MemorySemanticRetrievalCandidate[];
  fallbackRecordIds: string[];
  metadata?: Record<string, unknown>;
}

export interface MemorySemanticRetrievalDryRunReportSummary {
  query: string;
  existingRecordCount: number;
  draftCandidateCount: number;
  addedDraftCount: number;
  suppressedDraftCount: number;
  fallbackRecordCount: number;
}

export interface MemorySemanticRetrievalDryRunReport {
  summary: MemorySemanticRetrievalDryRunReportSummary;
  query: string;
  existingRecordIds: string[];
  draftCandidateIds: string[];
  addedDrafts: MemorySemanticRetrievalCandidate[];
  suppressedDrafts: MemorySemanticRetrievalCandidate[];
  fallbackRecordIds: string[];
  reasonCodes: MemorySemanticRetrievalReasonCode[];
  metadata?: Record<string, unknown>;
}

export interface BuildMemorySemanticRetrievalDryRunReportInput {
  plan: MemorySemanticRetrievalPlanningResult;
  existingRecordIds?: string[];
  metadata?: Record<string, unknown>;
}

function clamp01(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

function retrievalReasonCodes(
  queryRelevance: number,
): MemorySemanticRetrievalReasonCode[] {
  return queryRelevance > 0
    ? ["semantic_draft_candidate", "query_relevance"]
    : ["semantic_draft_candidate"];
}

function resolveMaxCandidates(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, Math.floor(value));
}

function toRetrievalCandidate(
  input: MemorySemanticRetrievalPlanningInput,
  draft: MemorySemanticRetrievalDraft,
): MemorySemanticRetrievalCandidate {
  const queryRelevance = clamp01(
    input.getDraftRelevance?.({
      query: input.query,
      draft,
      now: input.now,
      metadata: input.metadata,
    }),
  );

  return {
    draftId: draft.draftId,
    type: draft.type,
    content: draft.content,
    sourceRecordIds: [...draft.sourceRecordIds],
    confidence: clamp01(draft.confidence),
    queryRelevance,
    draftStatus: draft.status ?? "active",
    status: "eligible",
    reasonCodes: retrievalReasonCodes(queryRelevance),
    metadata: draft.metadata ? { ...draft.metadata } : undefined,
  };
}

function applyRetrievalFilters(
  candidates: MemorySemanticRetrievalCandidate[],
  input: MemorySemanticRetrievalPlanningInput,
): MemorySemanticRetrievalCandidate[] {
  const minConfidence = clamp01(input.minConfidence);
  const maxCandidates = resolveMaxCandidates(input.maxCandidates);
  let eligibleCount = 0;

  return candidates.map((candidate) => {
    const reasonCodes = [...candidate.reasonCodes];
    let suppressed = false;

    if (candidate.confidence < minConfidence) {
      reasonCodes.push("low_confidence");
      suppressed = true;
    }

    if (
      input.allowContested !== true &&
      candidate.draftStatus === "contested"
    ) {
      reasonCodes.push("contested_memory");
      suppressed = true;
    }

    if (!suppressed) {
      if (eligibleCount >= maxCandidates) {
        reasonCodes.push("max_candidates");
        suppressed = true;
      } else {
        eligibleCount += 1;
      }
    }

    return {
      ...candidate,
      status: suppressed ? "suppressed" : "eligible",
      reasonCodes,
    };
  });
}

export function buildMemorySemanticRetrievalPlan(
  input: MemorySemanticRetrievalPlanningInput,
): MemorySemanticRetrievalPlanningResult {
  const candidates = input.drafts
    .map((draft) => toRetrievalCandidate(input, draft))
    .sort((a, b) => {
      return (
        b.queryRelevance - a.queryRelevance ||
        b.confidence - a.confidence ||
        a.draftId.localeCompare(b.draftId)
      );
    });

  return {
    query: input.query,
    candidates: applyRetrievalFilters(candidates, input),
    fallbackRecordIds: [...(input.existingRecordIds ?? [])],
    metadata: input.metadata ? { ...input.metadata } : undefined,
  };
}

export function buildMemorySemanticRetrievalDryRunReport(
  input: BuildMemorySemanticRetrievalDryRunReportInput,
): MemorySemanticRetrievalDryRunReport {
  const existingRecordIds = [
    ...(input.existingRecordIds ?? input.plan.fallbackRecordIds),
  ];
  const addedDrafts = input.plan.candidates.filter(
    (candidate) => candidate.status === "eligible",
  );
  const suppressedDrafts = input.plan.candidates.filter(
    (candidate) => candidate.status === "suppressed",
  );
  const reasonCodes = [
    ...new Set([
      ...input.plan.candidates.flatMap((candidate) => candidate.reasonCodes),
      ...(input.plan.fallbackRecordIds.length > 0
        ? (["source_trace_fallback"] as const)
        : []),
    ]),
  ];
  const metadata = input.metadata ?? input.plan.metadata;

  return {
    summary: {
      query: input.plan.query,
      existingRecordCount: existingRecordIds.length,
      draftCandidateCount: input.plan.candidates.length,
      addedDraftCount: addedDrafts.length,
      suppressedDraftCount: suppressedDrafts.length,
      fallbackRecordCount: input.plan.fallbackRecordIds.length,
    },
    query: input.plan.query,
    existingRecordIds,
    draftCandidateIds: input.plan.candidates.map(
      (candidate) => candidate.draftId,
    ),
    addedDrafts,
    suppressedDrafts,
    fallbackRecordIds: [...input.plan.fallbackRecordIds],
    reasonCodes,
    metadata: metadata ? { ...metadata } : undefined,
  };
}
