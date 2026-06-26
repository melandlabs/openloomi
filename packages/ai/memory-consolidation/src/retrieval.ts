import type { MemorySemanticDraftSuggestedType } from "./semantic-draft";

export type MemorySemanticRetrievalCandidateStatus =
  | "eligible"
  | "suppressed"
  | "fallback";

export type MemorySemanticRetrievalResultKind =
  | "source-trace"
  | "semantic-draft";

export type MemorySemanticRetrievalDraftStatus =
  | "active"
  | "contested"
  | "deprecated"
  | "unknown"
  | (string & {});

export type MemorySemanticRetrievalReasonCode =
  | "semantic_draft_candidate"
  | "semantic_retrieval_comparison"
  | "semantic_retrieval_disabled"
  | "semantic_retrieval_enabled"
  | "semantic_retrieval_log_only"
  | "source_trace_fallback"
  | "low_confidence"
  | "contested_memory"
  | "max_candidates"
  | "query_relevance"
  | (string & {});

export type MemorySemanticRetrievalConfigStatus = "disabled" | "enabled";

export interface MemorySemanticRetrievalConfigInput {
  enabled?: boolean;
  minConfidence?: number;
  allowContested?: boolean;
  maxCandidates?: number;
  reasonCodes?: MemorySemanticRetrievalReasonCode[];
  metadata?: Record<string, unknown>;
}

export interface MemorySemanticRetrievalConfig {
  enabled: boolean;
  status: MemorySemanticRetrievalConfigStatus;
  minConfidence: number;
  allowContested: boolean;
  maxCandidates?: number;
  reasonCodes: MemorySemanticRetrievalReasonCode[];
  metadata?: Record<string, unknown>;
}

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

export interface MemorySemanticRetrievalSourceResult {
  recordId: string;
  content?: string;
  score?: number;
  reasonCodes?: MemorySemanticRetrievalReasonCode[];
  metadata?: Record<string, unknown>;
}

export interface MemorySemanticRetrievalMergedResult {
  resultId: string;
  kind: MemorySemanticRetrievalResultKind;
  status: MemorySemanticRetrievalCandidateStatus;
  sourceRecordIds: string[];
  reasonCodes: MemorySemanticRetrievalReasonCode[];
  recordId?: string;
  draftId?: string;
  type?: MemorySemanticDraftSuggestedType;
  content?: string;
  score?: number;
  confidence?: number;
  queryRelevance?: number;
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

export interface MemorySemanticRetrievalMergedResultSet {
  query: string;
  enabled: boolean;
  results: MemorySemanticRetrievalMergedResult[];
  sourceResults: MemorySemanticRetrievalMergedResult[];
  semanticResults: MemorySemanticRetrievalMergedResult[];
  suppressedDrafts: MemorySemanticRetrievalCandidate[];
  reasonCodes: MemorySemanticRetrievalReasonCode[];
  metadata?: Record<string, unknown>;
}

export interface MemorySemanticRetrievalEvalExpectations {
  selectedDraftIds?: string[];
  suppressedDraftIds?: string[];
  fallbackRecordIds?: string[];
}

export interface MemorySemanticRetrievalEvalScenarioReport {
  scenarioId: string;
  query: string;
  enabled: boolean;
  selectedDraftIds: string[];
  suppressedDraftIds: string[];
  fallbackRecordIds: string[];
  missingSelectedDraftIds: string[];
  missingSuppressedDraftIds: string[];
  missingFallbackRecordIds: string[];
  selectedPassed: boolean;
  suppressedPassed: boolean;
  fallbackPassed: boolean;
  passed: boolean;
  reasonCodes: MemorySemanticRetrievalReasonCode[];
  metadata?: Record<string, unknown>;
}

export interface MemorySemanticRetrievalComparisonDraft {
  draftId: string;
  sourceRecordIds: string[];
  reasonCodes: MemorySemanticRetrievalReasonCode[];
}

export interface MemorySemanticRetrievalComparisonReportSummary {
  query: string;
  baselineResultCount: number;
  candidateResultCount: number;
  addedSemanticDraftCount: number;
  retainedFallbackRecordCount: number;
  suppressedDraftCount: number;
}

export interface MemorySemanticRetrievalComparisonReport {
  summary: MemorySemanticRetrievalComparisonReportSummary;
  query: string;
  baselineEnabled: boolean;
  candidateEnabled: boolean;
  baselineResultIds: string[];
  candidateResultIds: string[];
  retainedFallbackRecordIds: string[];
  addedSemanticDrafts: MemorySemanticRetrievalComparisonDraft[];
  suppressedDrafts: MemorySemanticRetrievalComparisonDraft[];
  reasonCodes: MemorySemanticRetrievalReasonCode[];
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

export interface BuildMemorySemanticRetrievalMergedResultsInput {
  plan: MemorySemanticRetrievalPlanningResult;
  config?: MemorySemanticRetrievalConfigInput;
  sourceResults?: MemorySemanticRetrievalSourceResult[];
  metadata?: Record<string, unknown>;
}

export interface BuildMemorySemanticRetrievalEvalScenarioReportInput {
  scenarioId: string;
  merged: MemorySemanticRetrievalMergedResultSet;
  expectations?: MemorySemanticRetrievalEvalExpectations;
  metadata?: Record<string, unknown>;
}

export interface BuildMemorySemanticRetrievalComparisonReportInput {
  baseline: MemorySemanticRetrievalMergedResultSet;
  candidate: MemorySemanticRetrievalMergedResultSet;
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

function resolveOptionalMaxCandidates(
  value: number | undefined,
): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Math.floor(value));
}

function uniqueReasonCodes(
  reasonCodes: MemorySemanticRetrievalReasonCode[],
): MemorySemanticRetrievalReasonCode[] {
  return [...new Set(reasonCodes)];
}

function missingIds(
  actual: string[],
  expected: string[] | undefined,
): string[] {
  const actualSet = new Set(actual);

  return (expected ?? []).filter((id) => !actualSet.has(id));
}

function resultRecordIds(
  results: MemorySemanticRetrievalMergedResult[],
): string[] {
  return results.flatMap((result) =>
    result.recordId ? [result.recordId] : result.sourceRecordIds,
  );
}

export function resolveMemorySemanticRetrievalConfig(
  input: MemorySemanticRetrievalConfigInput = {},
): MemorySemanticRetrievalConfig {
  const enabled = input.enabled === true;

  return {
    enabled,
    status: enabled ? "enabled" : "disabled",
    minConfidence: clamp01(input.minConfidence),
    allowContested: input.allowContested === true,
    maxCandidates: resolveOptionalMaxCandidates(input.maxCandidates),
    reasonCodes: [
      ...(input.reasonCodes ?? []),
      enabled ? "semantic_retrieval_enabled" : "semantic_retrieval_disabled",
    ],
    metadata: input.metadata ? { ...input.metadata } : undefined,
  };
}

function toSourceMergedResult(
  source: MemorySemanticRetrievalSourceResult,
  config: MemorySemanticRetrievalConfig,
): MemorySemanticRetrievalMergedResult {
  return {
    resultId: source.recordId,
    kind: "source-trace",
    recordId: source.recordId,
    status: "fallback",
    sourceRecordIds: [source.recordId],
    content: source.content,
    score: source.score,
    reasonCodes: uniqueReasonCodes([
      "source_trace_fallback",
      ...config.reasonCodes,
      ...(source.reasonCodes ?? []),
    ]),
    metadata: source.metadata ? { ...source.metadata } : undefined,
  };
}

function toSemanticMergedResult(
  candidate: MemorySemanticRetrievalCandidate,
  config: MemorySemanticRetrievalConfig,
): MemorySemanticRetrievalMergedResult {
  return {
    resultId: candidate.draftId,
    kind: "semantic-draft",
    draftId: candidate.draftId,
    type: candidate.type,
    content: candidate.content,
    status: candidate.status,
    sourceRecordIds: [...candidate.sourceRecordIds],
    confidence: candidate.confidence,
    queryRelevance: candidate.queryRelevance,
    reasonCodes: uniqueReasonCodes([
      ...candidate.reasonCodes,
      ...config.reasonCodes,
    ]),
    metadata: candidate.metadata ? { ...candidate.metadata } : undefined,
  };
}

function suppressSemanticCandidateForConfig(
  candidate: MemorySemanticRetrievalCandidate,
  config: MemorySemanticRetrievalConfig,
): MemorySemanticRetrievalCandidate {
  return {
    ...candidate,
    sourceRecordIds: [...candidate.sourceRecordIds],
    status: "suppressed",
    reasonCodes: uniqueReasonCodes([
      ...candidate.reasonCodes,
      ...config.reasonCodes,
    ]),
    metadata: candidate.metadata ? { ...candidate.metadata } : undefined,
  };
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

export function buildMemorySemanticRetrievalMergedResults(
  input: BuildMemorySemanticRetrievalMergedResultsInput,
): MemorySemanticRetrievalMergedResultSet {
  const config = resolveMemorySemanticRetrievalConfig(input.config);
  const sourceResults = (
    input.sourceResults ??
    input.plan.fallbackRecordIds.map((recordId) => ({ recordId }))
  ).map((source) => toSourceMergedResult(source, config));
  const semanticCandidates = config.enabled
    ? input.plan.candidates.filter(
        (candidate) => candidate.status === "eligible",
      )
    : [];
  const semanticResults = semanticCandidates.map((candidate) =>
    toSemanticMergedResult(candidate, config),
  );
  const suppressedDrafts = config.enabled
    ? input.plan.candidates
        .filter((candidate) => candidate.status !== "eligible")
        .map((candidate) => ({
          ...candidate,
          sourceRecordIds: [...candidate.sourceRecordIds],
          reasonCodes: uniqueReasonCodes([
            ...candidate.reasonCodes,
            ...config.reasonCodes,
          ]),
          metadata: candidate.metadata ? { ...candidate.metadata } : undefined,
        }))
    : input.plan.candidates.map((candidate) =>
        suppressSemanticCandidateForConfig(candidate, config),
      );
  const results = [...sourceResults, ...semanticResults];

  return {
    query: input.plan.query,
    enabled: config.enabled,
    results,
    sourceResults,
    semanticResults,
    suppressedDrafts,
    reasonCodes: uniqueReasonCodes([
      ...config.reasonCodes,
      ...results.flatMap((result) => result.reasonCodes),
      ...suppressedDrafts.flatMap((candidate) => candidate.reasonCodes),
    ]),
    metadata: input.metadata ?? input.plan.metadata ?? config.metadata,
  };
}

export function buildMemorySemanticRetrievalEvalScenarioReport(
  input: BuildMemorySemanticRetrievalEvalScenarioReportInput,
): MemorySemanticRetrievalEvalScenarioReport {
  const selectedDraftIds = input.merged.semanticResults.flatMap((result) =>
    result.draftId ? [result.draftId] : [],
  );
  const suppressedDraftIds = input.merged.suppressedDrafts.map(
    (candidate) => candidate.draftId,
  );
  const fallbackRecordIds = input.merged.sourceResults.flatMap((result) =>
    result.recordId ? [result.recordId] : result.sourceRecordIds,
  );
  const missingSelectedDraftIds = missingIds(
    selectedDraftIds,
    input.expectations?.selectedDraftIds,
  );
  const missingSuppressedDraftIds = missingIds(
    suppressedDraftIds,
    input.expectations?.suppressedDraftIds,
  );
  const missingFallbackRecordIds = missingIds(
    fallbackRecordIds,
    input.expectations?.fallbackRecordIds,
  );
  const selectedPassed = missingSelectedDraftIds.length === 0;
  const suppressedPassed = missingSuppressedDraftIds.length === 0;
  const fallbackPassed = missingFallbackRecordIds.length === 0;

  return {
    scenarioId: input.scenarioId,
    query: input.merged.query,
    enabled: input.merged.enabled,
    selectedDraftIds,
    suppressedDraftIds,
    fallbackRecordIds,
    missingSelectedDraftIds,
    missingSuppressedDraftIds,
    missingFallbackRecordIds,
    selectedPassed,
    suppressedPassed,
    fallbackPassed,
    passed: selectedPassed && suppressedPassed && fallbackPassed,
    reasonCodes: [...input.merged.reasonCodes],
    metadata: input.metadata ?? input.merged.metadata,
  };
}

export function buildMemorySemanticRetrievalComparisonReport(
  input: BuildMemorySemanticRetrievalComparisonReportInput,
): MemorySemanticRetrievalComparisonReport {
  const baselineResultIds = input.baseline.results.map(
    (result) => result.resultId,
  );
  const candidateResultIds = input.candidate.results.map(
    (result) => result.resultId,
  );
  const baselineFallbackRecordIds = new Set(
    resultRecordIds(input.baseline.sourceResults),
  );
  const retainedFallbackRecordIds = resultRecordIds(
    input.candidate.sourceResults,
  ).filter((recordId) => baselineFallbackRecordIds.has(recordId));
  const baselineSemanticDraftIds = new Set(
    input.baseline.semanticResults.flatMap((result) =>
      result.draftId ? [result.draftId] : [],
    ),
  );
  const addedSemanticDrafts = input.candidate.semanticResults
    .filter(
      (result) =>
        result.draftId && !baselineSemanticDraftIds.has(result.draftId),
    )
    .map((result) => ({
      draftId: result.draftId as string,
      sourceRecordIds: [...result.sourceRecordIds],
      reasonCodes: [...result.reasonCodes],
    }));
  const suppressedDrafts = input.candidate.suppressedDrafts.map(
    (candidate) => ({
      draftId: candidate.draftId,
      sourceRecordIds: [...candidate.sourceRecordIds],
      reasonCodes: [...candidate.reasonCodes],
    }),
  );
  const reasonCodes = uniqueReasonCodes([
    "semantic_retrieval_comparison",
    "semantic_retrieval_log_only",
    ...input.baseline.reasonCodes,
    ...input.candidate.reasonCodes,
  ]);

  return {
    summary: {
      query: input.candidate.query,
      baselineResultCount: input.baseline.results.length,
      candidateResultCount: input.candidate.results.length,
      addedSemanticDraftCount: addedSemanticDrafts.length,
      retainedFallbackRecordCount: retainedFallbackRecordIds.length,
      suppressedDraftCount: suppressedDrafts.length,
    },
    query: input.candidate.query,
    baselineEnabled: input.baseline.enabled,
    candidateEnabled: input.candidate.enabled,
    baselineResultIds,
    candidateResultIds,
    retainedFallbackRecordIds,
    addedSemanticDrafts,
    suppressedDrafts,
    reasonCodes,
    metadata:
      input.metadata ?? input.candidate.metadata ?? input.baseline.metadata,
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
