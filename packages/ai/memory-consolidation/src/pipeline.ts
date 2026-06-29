import type { MemoryEvidenceRecord } from "./evidence-cluster";
import {
  buildMemoryConsolidationPlan,
  type BuildMemoryConsolidationPlanInput,
  type MemoryConsolidationPlan,
  type MemoryConsolidationPlanEntry,
} from "./plan";
import {
  assignMemoryRelationGraph,
  type AssignMemoryRelationGraphInput,
  type MemoryRelationEdge,
  type MemoryRelationGraphAssignment,
  type MemoryRelationKind,
} from "./relation-graph";

type PrimitiveValue = string | number | boolean;

export type MemoryRelationCandidateReasonCode =
  | "shared_candidate_key"
  | "shared_dimension"
  | "shared_metadata"
  | "caller_provided_candidate"
  | (string & {});

export interface MemoryRelationCandidate {
  id: string;
  fromRecordId: string;
  toRecordId: string;
  candidateKeys: string[];
  score: number;
  reasonCodes: MemoryRelationCandidateReasonCode[];
  metadata?: Record<string, unknown>;
}

export interface BuildMemoryRelationCandidatesInput {
  records: MemoryEvidenceRecord[];
  getCandidateKeys?(
    record: MemoryEvidenceRecord,
  ): Iterable<string | undefined | false | null>;
  maxRecordsPerKey?: number;
  maxCandidatesPerRecord?: number;
  scoreNorm?: number;
}

export type MemoryRelationDiscoveryReasonCode =
  | MemoryRelationCandidateReasonCode
  | "duplicate_candidate"
  | "missing_record"
  | "self_relation_candidate"
  | (string & {});

export interface CallerProvidedMemoryRelationCandidate {
  fromRecordId: string;
  toRecordId: string;
  candidateKeys?: string[];
  score?: number;
  reasonCodes?: MemoryRelationCandidateReasonCode[];
  metadata?: Record<string, unknown>;
}

export interface BuildCallerProvidedMemoryRelationCandidateDiscoveryReportInput {
  records: MemoryEvidenceRecord[];
  candidates: CallerProvidedMemoryRelationCandidate[];
  metadata?: Record<string, unknown>;
}

export interface SkippedMemoryRelationCandidateDiscoveryEntry {
  fromRecordId?: string;
  toRecordId?: string;
  reasonCodes: MemoryRelationDiscoveryReasonCode[];
  metadata?: Record<string, unknown>;
}

export interface MemoryRelationCandidateDiscoveryReport {
  candidates: MemoryRelationCandidate[];
  skippedCandidates: SkippedMemoryRelationCandidateDiscoveryEntry[];
  reasonCodes: MemoryRelationDiscoveryReasonCode[];
  metadata?: Record<string, unknown>;
}

export type MemoryRelationJudgmentKind = MemoryRelationKind | "uncertain";

export type MemoryRelationJudgmentReasonCode =
  | "same_relation_value"
  | "different_relation_value"
  | "candidate_related"
  | "uncertain_candidate";

export interface MemoryRelationJudgmentDecision {
  relation: MemoryRelationJudgmentKind;
  weight?: number;
  reasonCodes?: MemoryRelationJudgmentReasonCode[];
}

export interface MemoryRelationJudgment {
  candidate: MemoryRelationCandidate;
  relation: MemoryRelationJudgmentKind;
  weight: number;
  reasonCodes: MemoryRelationJudgmentReasonCode[];
  edge?: MemoryRelationEdge;
}

export interface MemoryRelationJudgmentThresholds {
  supportWeight: number;
  competeWeight: number;
  relatedWeight: number;
  relatedScore: number;
}

export interface JudgeMemoryRelationCandidatesInput {
  candidates: MemoryRelationCandidate[];
  records: MemoryEvidenceRecord[];
  now: number;
  getRelationGroup?(record: MemoryEvidenceRecord): string | undefined;
  getRelationValue?(record: MemoryEvidenceRecord): string | undefined;
  judgeCandidate?(
    candidate: MemoryRelationCandidate,
    context: {
      fromRecord: MemoryEvidenceRecord;
      toRecord: MemoryEvidenceRecord;
      defaultDecision: MemoryRelationJudgmentDecision;
      now: number;
    },
  ): MemoryRelationJudgmentDecision | undefined;
  thresholds?: Partial<MemoryRelationJudgmentThresholds>;
}

export interface MemoryRelationJudgmentResult {
  judgments: MemoryRelationJudgment[];
  relations: MemoryRelationEdge[];
}

export type MemoryRelationJudgeProviderReasonCode =
  | "provider_invoked"
  | "provider_error"
  | "missing_record"
  | "default_decision_used"
  | MemoryRelationJudgmentReasonCode
  | MemoryRelationCandidateReasonCode
  | (string & {});

export interface MemoryRelationJudgeProviderInput {
  candidate: MemoryRelationCandidate;
  fromRecord: MemoryEvidenceRecord;
  toRecord: MemoryEvidenceRecord;
  defaultDecision: MemoryRelationJudgmentDecision;
  now: number;
  metadata?: Record<string, unknown>;
}

export type MemoryRelationJudgeProviderInvoke = (
  input: MemoryRelationJudgeProviderInput,
) =>
  | Promise<MemoryRelationJudgmentDecision | undefined>
  | MemoryRelationJudgmentDecision
  | undefined;

export interface InvokeMemoryRelationJudgeProviderInput {
  candidate: MemoryRelationCandidate;
  records: MemoryEvidenceRecord[];
  now: number;
  invoke: MemoryRelationJudgeProviderInvoke;
  getRelationGroup?: JudgeMemoryRelationCandidatesInput["getRelationGroup"];
  getRelationValue?: JudgeMemoryRelationCandidatesInput["getRelationValue"];
  thresholds?: Partial<MemoryRelationJudgmentThresholds>;
  metadata?: Record<string, unknown>;
}

export interface MemoryRelationJudgeProviderResult {
  status: "judged" | "skipped" | "failed";
  candidateId: string;
  fromRecordId: string;
  toRecordId: string;
  input?: MemoryRelationJudgeProviderInput;
  decision?: MemoryRelationJudgmentDecision;
  judgment?: MemoryRelationJudgment;
  error?: {
    name: string;
    message: string;
  };
  reasonCodes: MemoryRelationJudgeProviderReasonCode[];
  metadata?: Record<string, unknown>;
}

export type MemoryWeakRelationObservationReasonCode =
  | "weak_related_relation"
  | "uncertain_relation_candidate"
  | MemoryRelationJudgmentReasonCode
  | MemoryRelationCandidateReasonCode
  | (string & {});

export interface MemoryWeakRelationObservation {
  candidateId: string;
  fromRecordId: string;
  toRecordId: string;
  relation: Extract<MemoryRelationJudgmentKind, "related" | "uncertain">;
  status: "observed";
  score: number;
  weight: number;
  candidateKeys: string[];
  edgeId?: string;
  promotesToCluster: false;
  mutatesGraph: false;
  reasonCodes: MemoryWeakRelationObservationReasonCode[];
  metadata?: Record<string, unknown>;
}

export interface BuildMemoryWeakRelationObservationReportInput {
  judgments: MemoryRelationJudgment[];
  metadata?: Record<string, unknown>;
}

export interface MemoryWeakRelationObservationReport {
  summary: {
    judgmentCount: number;
    observationCount: number;
    relatedCount: number;
    uncertainCount: number;
    excludedStrongRelationCount: number;
    promotesToCluster: false;
    mutatesGraph: false;
  };
  observations: MemoryWeakRelationObservation[];
  reasonCodes: MemoryWeakRelationObservationReasonCode[];
  metadata?: Record<string, unknown>;
}

export interface MemorySummaryCandidate {
  clusterKey: string;
  competitionKey: string;
  recordIds: string[];
  evidenceCount: number;
  score: number;
  priority: number;
  reasonCodes: MemoryConsolidationPlanEntry["reasonCodes"];
  sourceAction: "preserve";
}

export interface BuildMemorySummaryCandidatesInput {
  plan: MemoryConsolidationPlan;
  maxCandidates?: number;
}

export interface BuildMemoryRelationPipelineInput extends Omit<
  BuildMemoryRelationCandidatesInput,
  "records" | "maxRecordsPerKey" | "maxCandidatesPerRecord" | "scoreNorm"
> {
  records: MemoryEvidenceRecord[];
  now: number;
  candidate?: Omit<
    BuildMemoryRelationCandidatesInput,
    "records" | "getCandidateKeys"
  >;
  judgment?: Omit<
    JudgeMemoryRelationCandidatesInput,
    "candidates" | "records" | "now"
  >;
  graph?: Omit<AssignMemoryRelationGraphInput, "records" | "relations" | "now">;
  plan?: Omit<
    BuildMemoryConsolidationPlanInput,
    "records" | "now" | "getClusterKey" | "getCompetitionKey"
  >;
  summary?: Omit<BuildMemorySummaryCandidatesInput, "plan">;
}

export interface MemoryRelationPipeline {
  candidates: MemoryRelationCandidate[];
  judgments: MemoryRelationJudgment[];
  relations: MemoryRelationEdge[];
  assignment: MemoryRelationGraphAssignment;
  plan: MemoryConsolidationPlan;
  summaryCandidates: MemorySummaryCandidate[];
}

const DEFAULT_MAX_RECORDS_PER_KEY = 50;
const DEFAULT_MAX_CANDIDATES_PER_RECORD = 6;
const DEFAULT_SCORE_NORM = 2;

const DEFAULT_JUDGMENT_THRESHOLDS: MemoryRelationJudgmentThresholds = {
  supportWeight: 0.78,
  competeWeight: 0.74,
  relatedWeight: 0.45,
  relatedScore: 0.5,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isPrimitive(value: unknown): value is PrimitiveValue {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function stablePairId(left: string, right: string): string {
  const [fromRecordId, toRecordId] = [left, right].sort();
  return `${encodeURIComponent(fromRecordId)}|${encodeURIComponent(toRecordId)}`;
}

function stableRecordPair(
  left: string,
  right: string,
): {
  fromRecordId: string;
  toRecordId: string;
} {
  return left <= right
    ? { fromRecordId: left, toRecordId: right }
    : { fromRecordId: right, toRecordId: left };
}

function candidateId(fromRecordId: string, toRecordId: string): string {
  return `candidate:${stablePairId(fromRecordId, toRecordId)}`;
}

function edgeId(
  relation: MemoryRelationKind,
  fromRecordId: string,
  toRecordId: string,
): string {
  return `${relation}:${stablePairId(fromRecordId, toRecordId)}`;
}

function primitiveRecordKeys(
  prefix: "dimension" | "metadata",
  values: Record<string, unknown> | undefined,
): string[] {
  if (!values) {
    return [];
  }

  return Object.entries(values)
    .filter((entry): entry is [string, PrimitiveValue] => isPrimitive(entry[1]))
    .map(
      ([key, value]) =>
        `${prefix}:${encodeURIComponent(key)}:${encodeURIComponent(String(value))}`,
    );
}

function defaultCandidateKeys(record: MemoryEvidenceRecord): string[] {
  return [
    ...primitiveRecordKeys("dimension", record.dimensions),
    ...primitiveRecordKeys("metadata", record.metadata),
  ];
}

function resolveCandidateKeys(
  record: MemoryEvidenceRecord,
  getCandidateKeys:
    | BuildMemoryRelationCandidatesInput["getCandidateKeys"]
    | undefined,
): string[] {
  const keys = getCandidateKeys
    ? [...getCandidateKeys(record)].filter((key): key is string => Boolean(key))
    : defaultCandidateKeys(record);

  return [...new Set(keys)].sort();
}

function candidateReasonCodes(
  keys: string[],
): MemoryRelationCandidateReasonCode[] {
  const reasonCodes = new Set<MemoryRelationCandidateReasonCode>();

  for (const key of keys) {
    reasonCodes.add("shared_candidate_key");
    if (key.startsWith("dimension:")) {
      reasonCodes.add("shared_dimension");
    }
    if (key.startsWith("metadata:")) {
      reasonCodes.add("shared_metadata");
    }
  }

  return [...reasonCodes];
}

function sortCandidates(
  candidates: MemoryRelationCandidate[],
): MemoryRelationCandidate[] {
  return [...candidates].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (b.candidateKeys.length !== a.candidateKeys.length) {
      return b.candidateKeys.length - a.candidateKeys.length;
    }
    return a.id.localeCompare(b.id);
  });
}

export function buildMemoryRelationCandidates(
  input: BuildMemoryRelationCandidatesInput,
): MemoryRelationCandidate[] {
  const maxRecordsPerKey = Math.max(
    2,
    input.maxRecordsPerKey ?? DEFAULT_MAX_RECORDS_PER_KEY,
  );
  const maxCandidatesPerRecord = Math.max(
    1,
    input.maxCandidatesPerRecord ?? DEFAULT_MAX_CANDIDATES_PER_RECORD,
  );
  const scoreNorm = Math.max(1, input.scoreNorm ?? DEFAULT_SCORE_NORM);
  const recordsByKey = new Map<string, MemoryEvidenceRecord[]>();
  const candidateKeysByPair = new Map<string, Set<string>>();

  for (const record of input.records) {
    const keys = resolveCandidateKeys(record, input.getCandidateKeys);

    for (const key of keys) {
      const existing = recordsByKey.get(key) ?? [];
      existing.push(record);
      recordsByKey.set(key, existing);
    }
  }

  for (const [key, records] of recordsByKey.entries()) {
    const bucket = [...records]
      .sort((a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id))
      .slice(0, maxRecordsPerKey);

    for (let leftIndex = 0; leftIndex < bucket.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < bucket.length;
        rightIndex += 1
      ) {
        const left = bucket[leftIndex]!;
        const right = bucket[rightIndex]!;
        const pairId = stablePairId(left.id, right.id);
        const existing = candidateKeysByPair.get(pairId) ?? new Set<string>();
        existing.add(key);
        candidateKeysByPair.set(pairId, existing);
      }
    }
  }

  const candidates = [...candidateKeysByPair.entries()].map(
    ([pairId, keySet]) => {
      const [encodedFrom, encodedTo] = pairId.split("|");
      const fromRecordId = decodeURIComponent(encodedFrom ?? "");
      const toRecordId = decodeURIComponent(encodedTo ?? "");
      const candidateKeys = [...keySet].sort();

      return {
        id: candidateId(fromRecordId, toRecordId),
        fromRecordId,
        toRecordId,
        candidateKeys,
        score: clamp01(candidateKeys.length / scoreNorm),
        reasonCodes: candidateReasonCodes(candidateKeys),
      };
    },
  );
  const selected: MemoryRelationCandidate[] = [];
  const selectedCountByRecordId = new Map<string, number>();

  for (const candidate of sortCandidates(candidates)) {
    const fromCount = selectedCountByRecordId.get(candidate.fromRecordId) ?? 0;
    const toCount = selectedCountByRecordId.get(candidate.toRecordId) ?? 0;

    if (
      fromCount >= maxCandidatesPerRecord ||
      toCount >= maxCandidatesPerRecord
    ) {
      continue;
    }

    selected.push(candidate);
    selectedCountByRecordId.set(candidate.fromRecordId, fromCount + 1);
    selectedCountByRecordId.set(candidate.toRecordId, toCount + 1);
  }

  return sortCandidates(selected);
}

export function buildCallerProvidedMemoryRelationCandidateDiscoveryReport(
  input: BuildCallerProvidedMemoryRelationCandidateDiscoveryReportInput,
): MemoryRelationCandidateDiscoveryReport {
  const recordsById = new Set(input.records.map((record) => record.id));
  const candidates: MemoryRelationCandidate[] = [];
  const skippedCandidates: SkippedMemoryRelationCandidateDiscoveryEntry[] = [];
  const seenPairIds = new Set<string>();
  const reasonCodes = new Set<MemoryRelationDiscoveryReasonCode>();

  for (const candidate of input.candidates) {
    const pairReasonCodes = new Set<MemoryRelationDiscoveryReasonCode>();

    if (
      !recordsById.has(candidate.fromRecordId) ||
      !recordsById.has(candidate.toRecordId)
    ) {
      pairReasonCodes.add("missing_record");
    }

    if (candidate.fromRecordId === candidate.toRecordId) {
      pairReasonCodes.add("self_relation_candidate");
    }

    const pairId = stablePairId(candidate.fromRecordId, candidate.toRecordId);
    if (seenPairIds.has(pairId)) {
      pairReasonCodes.add("duplicate_candidate");
    }

    if (pairReasonCodes.size > 0) {
      for (const reasonCode of pairReasonCodes) {
        reasonCodes.add(reasonCode);
      }
      skippedCandidates.push({
        fromRecordId: candidate.fromRecordId,
        toRecordId: candidate.toRecordId,
        reasonCodes: [...pairReasonCodes],
        metadata: candidate.metadata,
      });
      continue;
    }

    seenPairIds.add(pairId);
    reasonCodes.add("caller_provided_candidate");
    for (const reasonCode of candidate.reasonCodes ?? []) {
      reasonCodes.add(reasonCode);
    }

    const pair = stableRecordPair(candidate.fromRecordId, candidate.toRecordId);
    const candidateKeys = [...new Set(candidate.candidateKeys ?? [])].sort();
    const candidateReasonCodes: MemoryRelationCandidateReasonCode[] = [
      "caller_provided_candidate",
      ...(candidate.reasonCodes ?? []),
    ];

    candidates.push({
      id: candidateId(pair.fromRecordId, pair.toRecordId),
      fromRecordId: pair.fromRecordId,
      toRecordId: pair.toRecordId,
      candidateKeys,
      score: clamp01(candidate.score ?? 1),
      reasonCodes: [...new Set(candidateReasonCodes)],
      metadata: candidate.metadata,
    });
  }

  return {
    candidates: sortCandidates(candidates),
    skippedCandidates,
    reasonCodes: [...reasonCodes],
    metadata: input.metadata,
  };
}

function resolveJudgmentThresholds(
  thresholds: Partial<MemoryRelationJudgmentThresholds> | undefined,
): MemoryRelationJudgmentThresholds {
  return {
    supportWeight:
      thresholds?.supportWeight ?? DEFAULT_JUDGMENT_THRESHOLDS.supportWeight,
    competeWeight:
      thresholds?.competeWeight ?? DEFAULT_JUDGMENT_THRESHOLDS.competeWeight,
    relatedWeight:
      thresholds?.relatedWeight ?? DEFAULT_JUDGMENT_THRESHOLDS.relatedWeight,
    relatedScore:
      thresholds?.relatedScore ?? DEFAULT_JUDGMENT_THRESHOLDS.relatedScore,
  };
}

function defaultRelationGroup(
  record: MemoryEvidenceRecord,
): string | undefined {
  const value =
    record.metadata?.relationGroup ?? record.dimensions?.relationGroup;
  return isPrimitive(value) ? String(value) : undefined;
}

function defaultRelationValue(
  record: MemoryEvidenceRecord,
): string | undefined {
  const value =
    record.metadata?.relationValue ?? record.dimensions?.relationValue;
  return isPrimitive(value) ? String(value) : undefined;
}

function defaultJudgmentDecision(
  candidate: MemoryRelationCandidate,
  fromRecord: MemoryEvidenceRecord,
  toRecord: MemoryEvidenceRecord,
  thresholds: MemoryRelationJudgmentThresholds,
  getRelationGroup: JudgeMemoryRelationCandidatesInput["getRelationGroup"],
  getRelationValue: JudgeMemoryRelationCandidatesInput["getRelationValue"],
): MemoryRelationJudgmentDecision {
  const fromGroup =
    getRelationGroup?.(fromRecord) ?? defaultRelationGroup(fromRecord);
  const toGroup =
    getRelationGroup?.(toRecord) ?? defaultRelationGroup(toRecord);
  const fromValue =
    getRelationValue?.(fromRecord) ?? defaultRelationValue(fromRecord);
  const toValue =
    getRelationValue?.(toRecord) ?? defaultRelationValue(toRecord);

  if (fromGroup && fromGroup === toGroup && fromValue && toValue) {
    if (fromValue === toValue) {
      return {
        relation: "support",
        weight: thresholds.supportWeight,
        reasonCodes: ["same_relation_value"],
      };
    }

    return {
      relation: "compete",
      weight: thresholds.competeWeight,
      reasonCodes: ["different_relation_value"],
    };
  }

  if (candidate.score >= thresholds.relatedScore) {
    return {
      relation: "related",
      weight: thresholds.relatedWeight,
      reasonCodes: ["candidate_related"],
    };
  }

  return {
    relation: "uncertain",
    weight: 0,
    reasonCodes: ["uncertain_candidate"],
  };
}

function latestActivationAt(
  left: MemoryEvidenceRecord,
  right: MemoryEvidenceRecord,
): number | undefined {
  const timestamps = [left.lastAccessAt, right.lastAccessAt].filter(
    (value): value is number => value !== undefined,
  );

  if (timestamps.length === 0) {
    return undefined;
  }

  return Math.max(...timestamps);
}

function defaultWeightForRelation(
  relation: MemoryRelationJudgmentKind,
  thresholds: MemoryRelationJudgmentThresholds,
): number {
  if (relation === "support") {
    return thresholds.supportWeight;
  }
  if (relation === "compete") {
    return thresholds.competeWeight;
  }
  if (relation === "related") {
    return thresholds.relatedWeight;
  }
  return 0;
}

export function judgeMemoryRelationCandidates(
  input: JudgeMemoryRelationCandidatesInput,
): MemoryRelationJudgmentResult {
  const thresholds = resolveJudgmentThresholds(input.thresholds);
  const recordsById = new Map(
    input.records.map((record) => [record.id, record]),
  );
  const judgments: MemoryRelationJudgment[] = [];

  for (const candidate of input.candidates) {
    const fromRecord = recordsById.get(candidate.fromRecordId);
    const toRecord = recordsById.get(candidate.toRecordId);

    if (!fromRecord || !toRecord) {
      continue;
    }

    const defaultDecision = defaultJudgmentDecision(
      candidate,
      fromRecord,
      toRecord,
      thresholds,
      input.getRelationGroup,
      input.getRelationValue,
    );
    const decision =
      input.judgeCandidate?.(candidate, {
        fromRecord,
        toRecord,
        defaultDecision,
        now: input.now,
      }) ?? defaultDecision;
    const weight = clamp01(
      decision.weight ??
        (decision.relation === defaultDecision.relation
          ? defaultDecision.weight
          : undefined) ??
        defaultWeightForRelation(decision.relation, thresholds),
    );
    const reasonCodes =
      decision.reasonCodes ?? defaultDecision.reasonCodes ?? [];
    const edge =
      decision.relation === "uncertain"
        ? undefined
        : {
            id: edgeId(
              decision.relation,
              candidate.fromRecordId,
              candidate.toRecordId,
            ),
            fromRecordId: candidate.fromRecordId,
            toRecordId: candidate.toRecordId,
            relation: decision.relation,
            weight,
            evidenceCount: candidate.candidateKeys.length,
            activationCount:
              (fromRecord.accessCount ?? 0) + (toRecord.accessCount ?? 0),
            lastActivatedAt: latestActivationAt(fromRecord, toRecord),
          };

    judgments.push({
      candidate,
      relation: decision.relation,
      weight,
      reasonCodes,
      edge,
    });
  }

  return {
    judgments,
    relations: judgments.flatMap((judgment) =>
      judgment.edge ? [judgment.edge] : [],
    ),
  };
}

function errorInfo(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    name: "Error",
    message: String(error),
  };
}

export async function invokeMemoryRelationJudgeProvider(
  input: InvokeMemoryRelationJudgeProviderInput,
): Promise<MemoryRelationJudgeProviderResult> {
  const recordsById = new Map(
    input.records.map((record) => [record.id, record]),
  );
  const fromRecord = recordsById.get(input.candidate.fromRecordId);
  const toRecord = recordsById.get(input.candidate.toRecordId);

  if (!fromRecord || !toRecord) {
    return {
      status: "skipped",
      candidateId: input.candidate.id,
      fromRecordId: input.candidate.fromRecordId,
      toRecordId: input.candidate.toRecordId,
      reasonCodes: ["missing_record"],
      metadata: input.metadata,
    };
  }

  const thresholds = resolveJudgmentThresholds(input.thresholds);
  const defaultDecision = defaultJudgmentDecision(
    input.candidate,
    fromRecord,
    toRecord,
    thresholds,
    input.getRelationGroup,
    input.getRelationValue,
  );
  const providerInput: MemoryRelationJudgeProviderInput = {
    candidate: input.candidate,
    fromRecord,
    toRecord,
    defaultDecision,
    now: input.now,
    metadata: input.metadata,
  };

  try {
    const providerDecision = await input.invoke(providerInput);
    const decision = providerDecision ?? defaultDecision;
    const judgmentResult = judgeMemoryRelationCandidates({
      candidates: [input.candidate],
      records: input.records,
      now: input.now,
      getRelationGroup: input.getRelationGroup,
      getRelationValue: input.getRelationValue,
      thresholds: input.thresholds,
      judgeCandidate: () => decision,
    });
    const reasonCodes = new Set<MemoryRelationJudgeProviderReasonCode>();
    reasonCodes.add("provider_invoked");
    if (!providerDecision) {
      reasonCodes.add("default_decision_used");
    }
    for (const reasonCode of decision.reasonCodes ?? []) {
      reasonCodes.add(reasonCode);
    }
    for (const reasonCode of input.candidate.reasonCodes) {
      reasonCodes.add(reasonCode);
    }

    return {
      status: "judged",
      candidateId: input.candidate.id,
      fromRecordId: input.candidate.fromRecordId,
      toRecordId: input.candidate.toRecordId,
      input: providerInput,
      decision,
      judgment: judgmentResult.judgments[0],
      reasonCodes: [...reasonCodes],
      metadata: input.metadata,
    };
  } catch (error) {
    return {
      status: "failed",
      candidateId: input.candidate.id,
      fromRecordId: input.candidate.fromRecordId,
      toRecordId: input.candidate.toRecordId,
      input: providerInput,
      error: errorInfo(error),
      reasonCodes: ["provider_error"],
      metadata: input.metadata,
    };
  }
}

function weakRelationReasonCode(
  relation: Extract<MemoryRelationJudgmentKind, "related" | "uncertain">,
): MemoryWeakRelationObservationReasonCode {
  return relation === "related"
    ? "weak_related_relation"
    : "uncertain_relation_candidate";
}

export function buildMemoryWeakRelationObservationReport(
  input: BuildMemoryWeakRelationObservationReportInput,
): MemoryWeakRelationObservationReport {
  const observations: MemoryWeakRelationObservation[] = [];
  const reasonCodes = new Set<MemoryWeakRelationObservationReasonCode>();
  let excludedStrongRelationCount = 0;

  for (const judgment of input.judgments) {
    if (judgment.relation !== "related" && judgment.relation !== "uncertain") {
      excludedStrongRelationCount += 1;
      continue;
    }

    const observationReasonCodes: MemoryWeakRelationObservationReasonCode[] = [
      weakRelationReasonCode(judgment.relation),
      ...judgment.reasonCodes,
      ...judgment.candidate.reasonCodes,
    ];
    for (const reasonCode of observationReasonCodes) {
      reasonCodes.add(reasonCode);
    }

    observations.push({
      candidateId: judgment.candidate.id,
      fromRecordId: judgment.candidate.fromRecordId,
      toRecordId: judgment.candidate.toRecordId,
      relation: judgment.relation,
      status: "observed",
      score: judgment.candidate.score,
      weight: judgment.weight,
      candidateKeys: [...judgment.candidate.candidateKeys],
      edgeId: judgment.edge?.id,
      promotesToCluster: false,
      mutatesGraph: false,
      reasonCodes: [...new Set(observationReasonCodes)],
      metadata: judgment.candidate.metadata,
    });
  }

  observations.sort((a, b) => {
    if (b.weight !== a.weight) {
      return b.weight - a.weight;
    }
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.candidateId.localeCompare(b.candidateId);
  });

  return {
    summary: {
      judgmentCount: input.judgments.length,
      observationCount: observations.length,
      relatedCount: observations.filter(
        (observation) => observation.relation === "related",
      ).length,
      uncertainCount: observations.filter(
        (observation) => observation.relation === "uncertain",
      ).length,
      excludedStrongRelationCount,
      promotesToCluster: false,
      mutatesGraph: false,
    },
    observations,
    reasonCodes: [...reasonCodes],
    metadata: input.metadata,
  };
}

export function buildMemorySummaryCandidates(
  input: BuildMemorySummaryCandidatesInput,
): MemorySummaryCandidate[] {
  const maxCandidates = Math.max(1, input.maxCandidates ?? 10);

  return input.plan.actions.preserve
    .map((entry) => ({
      clusterKey: entry.clusterKey,
      competitionKey: entry.competitionKey,
      recordIds: entry.recordIds,
      evidenceCount: entry.evidenceCount,
      score: entry.score,
      priority: entry.score * Math.log1p(entry.evidenceCount),
      reasonCodes: entry.reasonCodes,
      sourceAction: "preserve" as const,
    }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, maxCandidates);
}

export function buildMemoryRelationPipeline(
  input: BuildMemoryRelationPipelineInput,
): MemoryRelationPipeline {
  const candidates = buildMemoryRelationCandidates({
    ...input.candidate,
    records: input.records,
    getCandidateKeys: input.getCandidateKeys,
  });
  const judgmentResult = judgeMemoryRelationCandidates({
    ...input.judgment,
    candidates,
    records: input.records,
    now: input.now,
  });
  const assignment = assignMemoryRelationGraph({
    ...input.graph,
    records: input.records,
    relations: judgmentResult.relations,
    now: input.now,
  });
  const plan = buildMemoryConsolidationPlan({
    ...input.plan,
    records: input.records,
    now: input.now,
    getClusterKey: assignment.getClusterKey,
    getCompetitionKey: assignment.getCompetitionKey,
  });
  const summaryCandidates = buildMemorySummaryCandidates({
    ...input.summary,
    plan,
  });

  return {
    candidates,
    judgments: judgmentResult.judgments,
    relations: judgmentResult.relations,
    assignment,
    plan,
    summaryCandidates,
  };
}
