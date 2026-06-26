import type {
  SemanticMemoryArtifactRollbackMetadata,
  SemanticMemoryArtifactStatus,
} from "./persistence";

export type SemanticMemoryRevisionStatus =
  | "active"
  | "deprecated"
  | "conflicted";

export type SemanticMemoryRevisionReasonCode =
  | "active_memory"
  | "deprecated_memory"
  | "conflicted_memory"
  | "supersedes_memory"
  | "deprecated_by_memory"
  | "recency_competition_observation"
  | "recent_repeated_evidence"
  | "older_competing_memory"
  | "unknown_artifact_status"
  | (string & {});

export type SemanticMemoryRevisionRelationType = "supersedes" | "deprecated-by";

export type SemanticMemoryRevisionCompetitionRole = "leading" | "competing";

export interface SemanticMemoryRevisionStatusInput {
  artifactId: string;
  artifactStatus?: SemanticMemoryArtifactStatus;
  sourceRecordIds: string[];
  confidence: number;
  reasonCodes?: SemanticMemoryRevisionReasonCode[];
  rollback?: SemanticMemoryArtifactRollbackMetadata;
  metadata?: Record<string, unknown>;
}

export interface SemanticMemoryRevisionStatusSignal {
  artifactId: string;
  artifactStatus?: SemanticMemoryArtifactStatus;
  revisionStatus: SemanticMemoryRevisionStatus;
  sourceRecordIds: string[];
  confidence: number;
  reasonCodes: SemanticMemoryRevisionReasonCode[];
  rollback?: SemanticMemoryArtifactRollbackMetadata;
  metadata?: Record<string, unknown>;
}

export interface SemanticMemoryRevisionRelationInput {
  oldMemory: SemanticMemoryRevisionStatusSignal;
  newMemory: SemanticMemoryRevisionStatusSignal;
  reasonCodes?: SemanticMemoryRevisionReasonCode[];
  rollback?: SemanticMemoryArtifactRollbackMetadata;
  metadata?: Record<string, unknown>;
}

export interface SemanticMemoryRevisionRelation {
  type: SemanticMemoryRevisionRelationType;
  sourceArtifactId: string;
  targetArtifactId: string;
  sourceRecordIds: string[];
  confidence: number;
  reasonCodes: SemanticMemoryRevisionReasonCode[];
  rollback?: SemanticMemoryArtifactRollbackMetadata;
  metadata?: Record<string, unknown>;
}

export interface SemanticMemoryRevisionRelationPlan {
  oldArtifactId: string;
  newArtifactId: string;
  relations: SemanticMemoryRevisionRelation[];
  reasonCodes: SemanticMemoryRevisionReasonCode[];
  rollback?: SemanticMemoryArtifactRollbackMetadata;
  metadata?: Record<string, unknown>;
}

export interface SemanticMemoryRevisionCompetitionCandidate {
  memory: SemanticMemoryRevisionStatusSignal;
  evidenceTimestamps: number[];
  reasonCodes?: SemanticMemoryRevisionReasonCode[];
  metadata?: Record<string, unknown>;
}

export interface SemanticMemoryRevisionCompetitionDiagnostic {
  artifactId: string;
  revisionStatus: SemanticMemoryRevisionStatus;
  role: SemanticMemoryRevisionCompetitionRole;
  sourceRecordIds: string[];
  confidence: number;
  evidenceCount: number;
  recentEvidenceCount: number;
  latestEvidenceTimestamp?: number;
  recencyScore: number;
  score: number;
  reasonCodes: SemanticMemoryRevisionReasonCode[];
  metadata?: Record<string, unknown>;
}

export interface SemanticMemoryRevisionCompetitionDiagnosticsSummary {
  competitionKey: string;
  now: number;
  candidateCount: number;
  leadingArtifactId?: string;
  recentWindowMs: number;
  minRecentEvidence: number;
}

export interface SemanticMemoryRevisionCompetitionDiagnostics {
  summary: SemanticMemoryRevisionCompetitionDiagnosticsSummary;
  diagnostics: SemanticMemoryRevisionCompetitionDiagnostic[];
  reasonCodes: SemanticMemoryRevisionReasonCode[];
  metadata?: Record<string, unknown>;
}

export interface SemanticMemoryRevisionExplanationMemory {
  artifactId: string;
  artifactStatus?: SemanticMemoryArtifactStatus;
  revisionStatus: SemanticMemoryRevisionStatus;
  sourceRecordIds: string[];
  confidence: number;
  reasonCodes: SemanticMemoryRevisionReasonCode[];
  rollback?: SemanticMemoryArtifactRollbackMetadata;
  metadata?: Record<string, unknown>;
}

export interface SemanticMemoryRevisionExplanationSummary {
  memoryCount: number;
  relationCount: number;
  competitionDiagnosticCount: number;
  activeCount: number;
  deprecatedCount: number;
  conflictedCount: number;
  leadingArtifactId?: string;
}

export interface SemanticMemoryRevisionExplanationReport {
  summary: SemanticMemoryRevisionExplanationSummary;
  memories: SemanticMemoryRevisionExplanationMemory[];
  relations: SemanticMemoryRevisionRelation[];
  competitionDiagnostics: SemanticMemoryRevisionCompetitionDiagnostic[];
  reasonCodes: SemanticMemoryRevisionReasonCode[];
  metadata?: Record<string, unknown>;
}

export interface BuildSemanticMemoryRevisionCompetitionDiagnosticsInput {
  competitionKey: string;
  now: number;
  candidates: SemanticMemoryRevisionCompetitionCandidate[];
  recentWindowMs?: number;
  minRecentEvidence?: number;
  metadata?: Record<string, unknown>;
}

export interface BuildSemanticMemoryRevisionExplanationReportInput {
  memories: SemanticMemoryRevisionStatusSignal[];
  relationPlan?: SemanticMemoryRevisionRelationPlan;
  competitionDiagnostics?: SemanticMemoryRevisionCompetitionDiagnostics;
  metadata?: Record<string, unknown>;
}

const DEFAULT_RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

function resolveRevisionStatus(
  status: SemanticMemoryArtifactStatus | undefined,
): SemanticMemoryRevisionStatus {
  if (status === "deprecated") {
    return "deprecated";
  }

  if (status === "conflicted") {
    return "conflicted";
  }

  return "active";
}

function revisionStatusReasonCode(
  revisionStatus: SemanticMemoryRevisionStatus,
  artifactStatus: SemanticMemoryArtifactStatus | undefined,
): SemanticMemoryRevisionReasonCode {
  if (
    artifactStatus &&
    !["draft", "consolidated", "deprecated", "conflicted"].includes(
      artifactStatus,
    )
  ) {
    return "unknown_artifact_status";
  }

  if (revisionStatus === "deprecated") {
    return "deprecated_memory";
  }

  if (revisionStatus === "conflicted") {
    return "conflicted_memory";
  }

  return "active_memory";
}

function copyRollback(
  rollback: SemanticMemoryArtifactRollbackMetadata | undefined,
): SemanticMemoryArtifactRollbackMetadata | undefined {
  return rollback
    ? {
        ...rollback,
        metadata: rollback.metadata ? { ...rollback.metadata } : undefined,
      }
    : undefined;
}

function relationConfidence(
  oldMemory: SemanticMemoryRevisionStatusSignal,
  newMemory: SemanticMemoryRevisionStatusSignal,
): number {
  return clamp01(Math.min(oldMemory.confidence, newMemory.confidence));
}

function relationSourceRecordIds(
  oldMemory: SemanticMemoryRevisionStatusSignal,
  newMemory: SemanticMemoryRevisionStatusSignal,
): string[] {
  return [
    ...new Set([...oldMemory.sourceRecordIds, ...newMemory.sourceRecordIds]),
  ];
}

function uniqueReasonCodes(
  reasonCodes: SemanticMemoryRevisionReasonCode[],
): SemanticMemoryRevisionReasonCode[] {
  return [...new Set(reasonCodes)];
}

function latestTimestamp(timestamps: number[]): number | undefined {
  const validTimestamps = timestamps.filter(Number.isFinite);

  if (validTimestamps.length === 0) {
    return undefined;
  }

  return Math.max(...validTimestamps);
}

function recentEvidenceCount(
  timestamps: number[],
  now: number,
  recentWindowMs: number,
): number {
  return timestamps.filter(
    (timestamp) =>
      Number.isFinite(timestamp) &&
      timestamp <= now &&
      now - timestamp <= recentWindowMs,
  ).length;
}

function recencyScore(
  latestEvidenceTimestamp: number | undefined,
  now: number,
  recentWindowMs: number,
): number {
  if (latestEvidenceTimestamp === undefined || latestEvidenceTimestamp > now) {
    return 0;
  }

  return clamp01(1 - (now - latestEvidenceTimestamp) / recentWindowMs);
}

function competitionScore(input: {
  confidence: number;
  recentEvidenceCount: number;
  recencyScore: number;
}): number {
  return clamp01(
    0.5 * input.confidence +
      0.35 * clamp01(input.recentEvidenceCount / 3) +
      0.15 * input.recencyScore,
  );
}

export function buildSemanticMemoryRevisionStatusSignal(
  input: SemanticMemoryRevisionStatusInput,
): SemanticMemoryRevisionStatusSignal {
  const revisionStatus = resolveRevisionStatus(input.artifactStatus);

  return {
    artifactId: input.artifactId,
    artifactStatus: input.artifactStatus,
    revisionStatus,
    sourceRecordIds: [...input.sourceRecordIds],
    confidence: clamp01(input.confidence),
    reasonCodes: [
      revisionStatusReasonCode(revisionStatus, input.artifactStatus),
      ...(input.reasonCodes ?? []),
    ],
    rollback: copyRollback(input.rollback),
    metadata: input.metadata ? { ...input.metadata } : undefined,
  };
}

export function buildSemanticMemoryRevisionExplanationReport(
  input: BuildSemanticMemoryRevisionExplanationReportInput,
): SemanticMemoryRevisionExplanationReport {
  const memories = input.memories.map((memory) => ({
    artifactId: memory.artifactId,
    artifactStatus: memory.artifactStatus,
    revisionStatus: memory.revisionStatus,
    sourceRecordIds: [...memory.sourceRecordIds],
    confidence: memory.confidence,
    reasonCodes: [...memory.reasonCodes],
    rollback: copyRollback(memory.rollback),
    metadata: memory.metadata ? { ...memory.metadata } : undefined,
  }));
  const relations =
    input.relationPlan?.relations.map((relation) => ({
      ...relation,
      sourceRecordIds: [...relation.sourceRecordIds],
      reasonCodes: [...relation.reasonCodes],
      rollback: copyRollback(relation.rollback),
      metadata: relation.metadata ? { ...relation.metadata } : undefined,
    })) ?? [];
  const competitionDiagnostics =
    input.competitionDiagnostics?.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      sourceRecordIds: [...diagnostic.sourceRecordIds],
      reasonCodes: [...diagnostic.reasonCodes],
      metadata: diagnostic.metadata ? { ...diagnostic.metadata } : undefined,
    })) ?? [];
  const leadingArtifactId =
    input.competitionDiagnostics?.summary.leadingArtifactId;

  return {
    summary: {
      memoryCount: memories.length,
      relationCount: relations.length,
      competitionDiagnosticCount: competitionDiagnostics.length,
      activeCount: memories.filter(
        (memory) => memory.revisionStatus === "active",
      ).length,
      deprecatedCount: memories.filter(
        (memory) => memory.revisionStatus === "deprecated",
      ).length,
      conflictedCount: memories.filter(
        (memory) => memory.revisionStatus === "conflicted",
      ).length,
      leadingArtifactId,
    },
    memories,
    relations,
    competitionDiagnostics,
    reasonCodes: uniqueReasonCodes([
      ...memories.flatMap((memory) => memory.reasonCodes),
      ...(input.relationPlan?.reasonCodes ?? []),
      ...(input.competitionDiagnostics?.reasonCodes ?? []),
    ]),
    metadata:
      input.metadata ??
      input.competitionDiagnostics?.metadata ??
      input.relationPlan?.metadata,
  };
}

export function buildSemanticMemoryRevisionRelationPlan(
  input: SemanticMemoryRevisionRelationInput,
): SemanticMemoryRevisionRelationPlan {
  const sourceRecordIds = relationSourceRecordIds(
    input.oldMemory,
    input.newMemory,
  );
  const confidence = relationConfidence(input.oldMemory, input.newMemory);
  const rollback = copyRollback(input.rollback);
  const metadata = input.metadata ? { ...input.metadata } : undefined;
  const relationReasonCodes = [
    ...(input.reasonCodes ?? []),
  ] as SemanticMemoryRevisionReasonCode[];
  const relations: SemanticMemoryRevisionRelation[] = [
    {
      type: "supersedes",
      sourceArtifactId: input.newMemory.artifactId,
      targetArtifactId: input.oldMemory.artifactId,
      sourceRecordIds: [...sourceRecordIds],
      confidence,
      reasonCodes: ["supersedes_memory", ...relationReasonCodes],
      rollback,
      metadata,
    },
    {
      type: "deprecated-by",
      sourceArtifactId: input.oldMemory.artifactId,
      targetArtifactId: input.newMemory.artifactId,
      sourceRecordIds: [...sourceRecordIds],
      confidence,
      reasonCodes: ["deprecated_by_memory", ...relationReasonCodes],
      rollback: copyRollback(input.rollback),
      metadata: input.metadata ? { ...input.metadata } : undefined,
    },
  ];

  return {
    oldArtifactId: input.oldMemory.artifactId,
    newArtifactId: input.newMemory.artifactId,
    relations,
    reasonCodes: [
      "supersedes_memory",
      "deprecated_by_memory",
      ...relationReasonCodes,
    ],
    rollback: copyRollback(input.rollback),
    metadata: input.metadata ? { ...input.metadata } : undefined,
  };
}

export function buildSemanticMemoryRevisionCompetitionDiagnostics(
  input: BuildSemanticMemoryRevisionCompetitionDiagnosticsInput,
): SemanticMemoryRevisionCompetitionDiagnostics {
  const recentWindowMs = Math.max(
    1,
    input.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS,
  );
  const minRecentEvidence = Math.max(
    1,
    Math.floor(input.minRecentEvidence ?? 2),
  );
  const scoredDiagnostics = input.candidates
    .map((candidate) => {
      const latest = latestTimestamp(candidate.evidenceTimestamps);
      const recentCount = recentEvidenceCount(
        candidate.evidenceTimestamps,
        input.now,
        recentWindowMs,
      );
      const recency = recencyScore(latest, input.now, recentWindowMs);
      const score = competitionScore({
        confidence: candidate.memory.confidence,
        recentEvidenceCount: recentCount,
        recencyScore: recency,
      });

      return {
        artifactId: candidate.memory.artifactId,
        revisionStatus: candidate.memory.revisionStatus,
        role: "competing" as const,
        sourceRecordIds: [...candidate.memory.sourceRecordIds],
        confidence: candidate.memory.confidence,
        evidenceCount: candidate.evidenceTimestamps.length,
        recentEvidenceCount: recentCount,
        latestEvidenceTimestamp: latest,
        recencyScore: recency,
        score,
        reasonCodes: [
          "recency_competition_observation",
          ...(recentCount >= minRecentEvidence
            ? (["recent_repeated_evidence"] as const)
            : (["older_competing_memory"] as const)),
          ...candidate.memory.reasonCodes,
          ...(candidate.reasonCodes ?? []),
        ],
        metadata: candidate.metadata ? { ...candidate.metadata } : undefined,
      };
    })
    .sort((a, b) => {
      return (
        b.score - a.score ||
        b.recentEvidenceCount - a.recentEvidenceCount ||
        a.artifactId.localeCompare(b.artifactId)
      );
    });
  const leadingArtifactId = scoredDiagnostics[0]?.artifactId;
  const diagnostics = scoredDiagnostics.map((diagnostic) => ({
    ...diagnostic,
    role:
      diagnostic.artifactId === leadingArtifactId
        ? ("leading" as const)
        : ("competing" as const),
    reasonCodes:
      diagnostic.artifactId === leadingArtifactId
        ? diagnostic.reasonCodes
        : [
            ...new Set([
              ...diagnostic.reasonCodes,
              "older_competing_memory" as const,
            ]),
          ],
  }));

  return {
    summary: {
      competitionKey: input.competitionKey,
      now: input.now,
      candidateCount: input.candidates.length,
      leadingArtifactId,
      recentWindowMs,
      minRecentEvidence,
    },
    diagnostics,
    reasonCodes: [
      ...new Set(diagnostics.flatMap((diagnostic) => diagnostic.reasonCodes)),
    ],
    metadata: input.metadata ? { ...input.metadata } : undefined,
  };
}
