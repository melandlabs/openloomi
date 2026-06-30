import type {
  MemorySemanticDraftCandidate,
  SemanticMemoryDraft,
  SemanticMemoryDraftSummarizerProviderAdapterReasonCode,
  SemanticMemoryDraftSummarizerProviderAdapterResult,
  SemanticMemoryDraftSummarizerProviderBatchReport,
} from "./semantic-draft";

export interface SemanticMemoryDraftPersistenceItem {
  candidate: MemorySemanticDraftCandidate;
  draft: SemanticMemoryDraft;
}

export type SemanticMemoryDraftPersistencePreparationReasonCode =
  | "provider_result_ready"
  | "provider_result_skipped"
  | "provider_result_failed"
  | "provider_result_has_response_issues"
  | SemanticMemoryDraftSummarizerProviderAdapterReasonCode
  | (string & {});

export interface SemanticMemoryDraftPersistenceSkippedProviderResult {
  draftId: string;
  status: SemanticMemoryDraftSummarizerProviderAdapterResult["status"];
  reasonCodes: SemanticMemoryDraftPersistencePreparationReasonCode[];
}

export interface SemanticMemoryDraftPersistencePreparationSummary {
  resultCount: number;
  persistenceItemCount: number;
  skippedResultCount: number;
  responseIssueCount: number;
}

export interface SemanticMemoryDraftPersistencePreparationReport {
  summary: SemanticMemoryDraftPersistencePreparationSummary;
  items: SemanticMemoryDraftPersistenceItem[];
  skippedResults: SemanticMemoryDraftPersistenceSkippedProviderResult[];
  reasonCodes: SemanticMemoryDraftPersistencePreparationReasonCode[];
}

export interface BuildSemanticMemoryDraftPersistencePreparationReportInput {
  providerBatchReport: SemanticMemoryDraftSummarizerProviderBatchReport;
}

export interface PersistedSemanticMemoryDraft {
  draftId: string;
  type: SemanticMemoryDraft["type"];
  content: string;
  sourceRecordIds: string[];
  confidence: number;
  metadata?: Record<string, unknown>;
  sourceClusterKey: string;
  competitionKey: string;
  evidenceCount: number;
  score: number;
  reasonCodes: MemorySemanticDraftCandidate["reasonCodes"];
  createdAt: number;
}

export type SemanticMemoryArtifactStatus =
  | "draft"
  | "consolidated"
  | "deprecated"
  | "conflicted"
  | (string & {});

export interface SemanticMemoryArtifactRollbackMetadata {
  sourceArtifactId?: string;
  operationId?: string;
  createdBy?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface SemanticMemoryArtifactStorageRecord {
  artifactId: string;
  userId: string;
  type: SemanticMemoryDraft["type"];
  content: string;
  status: SemanticMemoryArtifactStatus;
  confidence: number;
  sourceRecordIds: string[];
  sourceClusterKey: string;
  competitionKey: string;
  reasonCodes: MemorySemanticDraftCandidate["reasonCodes"];
  createdAt: number;
  updatedAt: number;
  rollback: SemanticMemoryArtifactRollbackMetadata;
  metadata?: Record<string, unknown>;
}

export interface SemanticMemoryArtifactStorageAdapterSaveInput {
  userId: string;
  artifacts: SemanticMemoryArtifactStorageRecord[];
  now: number;
  dryRun: boolean;
}

export interface SemanticMemoryArtifactStorageAdapterSaveResult {
  artifactIds: string[];
  dryRun: boolean;
}

export interface SemanticMemoryArtifactStorageAdapter {
  saveArtifacts(
    input: SemanticMemoryArtifactStorageAdapterSaveInput,
  ): Promise<SemanticMemoryArtifactStorageAdapterSaveResult>;
}

export type SerializedSemanticMemoryArtifactStorageRecordSchemaVersion = 1;

export interface SerializedSemanticMemoryArtifactStorageRecord {
  schemaVersion: SerializedSemanticMemoryArtifactStorageRecordSchemaVersion;
  artifact: SemanticMemoryArtifactStorageRecord;
}

export type SemanticMemoryArtifactDeserializationReasonCode =
  | "invalid_payload"
  | "unsupported_schema_version"
  | "missing_artifact_id"
  | "missing_user_id"
  | "missing_type"
  | "missing_content"
  | "missing_status"
  | "invalid_confidence"
  | "missing_source_record_ids"
  | "missing_source_cluster_key"
  | "missing_competition_key"
  | "missing_timestamps"
  | "missing_rollback_metadata"
  | (string & {});

export interface DeserializeSemanticMemoryArtifactStorageRecordResult {
  valid: boolean;
  artifact?: SemanticMemoryArtifactStorageRecord;
  reasonCodes: SemanticMemoryArtifactDeserializationReasonCode[];
}

export type SemanticMemoryArtifactStorageDryRunReportStatus =
  | "disabled"
  | "dry-run"
  | "write-ready";

export type SemanticMemoryArtifactStorageDryRunReportReasonCode =
  | "artifact_storage_candidate"
  | "persistence_disabled"
  | "dry_run"
  | "write_ready"
  | (string & {});

export interface SemanticMemoryArtifactStorageDryRunReportSummary {
  userId: string;
  status: SemanticMemoryArtifactStorageDryRunReportStatus;
  dryRun: boolean;
  artifactCount: number;
  wouldWriteCount: number;
  actualWriteCount: 0;
  skippedWriteCount: number;
}

export interface SemanticMemoryArtifactStorageDryRunReportArtifact {
  artifactId: string;
  status: SemanticMemoryArtifactStatus;
  sourceRecordIds: string[];
  sourceClusterKey: string;
  competitionKey: string;
  rollbackOperationId?: string;
  rollbackSourceArtifactId?: string;
  reasonCodes: SemanticMemoryArtifactStorageDryRunReportReasonCode[];
}

export interface SemanticMemoryArtifactStorageDryRunReport {
  summary: SemanticMemoryArtifactStorageDryRunReportSummary;
  artifacts: SemanticMemoryArtifactStorageDryRunReportArtifact[];
  serializedArtifacts: SerializedSemanticMemoryArtifactStorageRecord[];
  reasonCodes: SemanticMemoryArtifactStorageDryRunReportReasonCode[];
}

export interface BuildSemanticMemoryArtifactStorageDryRunReportInput {
  userId: string;
  artifacts: SemanticMemoryArtifactStorageRecord[];
  enabled?: boolean;
  dryRun?: boolean;
}

export interface SemanticMemoryDraftStoreSaveInput {
  userId: string;
  drafts: PersistedSemanticMemoryDraft[];
  now: number;
  dryRun: false;
}

export interface SemanticMemoryDraftStore {
  saveDrafts(input: SemanticMemoryDraftStoreSaveInput): Promise<void>;
}

export interface PersistSemanticMemoryDraftsInput {
  userId: string;
  items: SemanticMemoryDraftPersistenceItem[];
  store?: SemanticMemoryDraftStore;
  now?: number;
  enabled?: boolean;
  dryRun?: boolean;
}

export interface PersistSemanticMemoryDraftsResult {
  status: "disabled" | "dry-run" | "persisted";
  userId: string;
  dryRun: boolean;
  plannedDrafts: PersistedSemanticMemoryDraft[];
  persistedCount: number;
  skippedReason?: "persistence_disabled" | "dry_run";
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function copyRecord(
  record: SemanticMemoryArtifactStorageRecord,
): SemanticMemoryArtifactStorageRecord {
  return {
    ...record,
    confidence: clamp01(record.confidence),
    sourceRecordIds: [...record.sourceRecordIds],
    reasonCodes: [...record.reasonCodes],
    rollback: {
      ...record.rollback,
      metadata: record.rollback.metadata
        ? { ...record.rollback.metadata }
        : undefined,
    },
    metadata: record.metadata ? { ...record.metadata } : undefined,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function buildPersistedDraft(
  item: SemanticMemoryDraftPersistenceItem,
  createdAt: number,
): PersistedSemanticMemoryDraft {
  return {
    draftId: item.candidate.draftId,
    type: item.draft.type,
    content: item.draft.content,
    sourceRecordIds: [...item.candidate.sourceRecordIds],
    confidence: clamp01(item.draft.confidence),
    metadata: item.draft.metadata ? { ...item.draft.metadata } : undefined,
    sourceClusterKey: item.candidate.sourceClusterKey,
    competitionKey: item.candidate.competitionKey,
    evidenceCount: item.candidate.evidenceCount,
    score: item.candidate.score,
    reasonCodes: [...item.candidate.reasonCodes],
    createdAt,
  };
}

function candidateDraftId(
  result: SemanticMemoryDraftSummarizerProviderAdapterResult,
): string {
  return result.candidate.draftId;
}

function skippedProviderReasonCodes(
  result: SemanticMemoryDraftSummarizerProviderAdapterResult,
): SemanticMemoryDraftPersistencePreparationReasonCode[] {
  if (result.status === "skipped") {
    return ["provider_result_skipped", ...result.reasonCodes];
  }

  if (result.status === "failed") {
    return ["provider_result_failed", ...result.reasonCodes];
  }

  return ["provider_result_has_response_issues", ...result.reasonCodes];
}

export function buildSemanticMemoryDraftPersistencePreparationReport(
  input: BuildSemanticMemoryDraftPersistencePreparationReportInput,
): SemanticMemoryDraftPersistencePreparationReport {
  const items: SemanticMemoryDraftPersistenceItem[] = [];
  const skippedResults: SemanticMemoryDraftPersistenceSkippedProviderResult[] =
    [];
  const reasonCodes =
    new Set<SemanticMemoryDraftPersistencePreparationReasonCode>();
  let responseIssueCount = 0;

  for (const result of input.providerBatchReport.results) {
    const hasResponseIssues = result.reasonCodes.length > 0;

    if (result.status === "summarized" && hasResponseIssues) {
      responseIssueCount += 1;
    }

    if (result.status === "summarized" && result.draft && !hasResponseIssues) {
      items.push({
        candidate: result.candidate,
        draft: result.draft,
      });
      reasonCodes.add("provider_result_ready");
      continue;
    }

    const skippedReasonCodes = skippedProviderReasonCodes(result);
    for (const reasonCode of skippedReasonCodes) {
      reasonCodes.add(reasonCode);
    }
    skippedResults.push({
      draftId: candidateDraftId(result),
      status: result.status,
      reasonCodes: skippedReasonCodes,
    });
  }

  return {
    summary: {
      resultCount: input.providerBatchReport.results.length,
      persistenceItemCount: items.length,
      skippedResultCount: skippedResults.length,
      responseIssueCount,
    },
    items,
    skippedResults,
    reasonCodes: [...reasonCodes],
  };
}

function storageDryRunStatus(input: {
  enabled?: boolean;
  dryRun?: boolean;
}): SemanticMemoryArtifactStorageDryRunReportStatus {
  if (input.enabled !== true) {
    return "disabled";
  }

  return input.dryRun === false ? "write-ready" : "dry-run";
}

function storageDryRunReasonCode(
  status: SemanticMemoryArtifactStorageDryRunReportStatus,
): SemanticMemoryArtifactStorageDryRunReportReasonCode {
  if (status === "disabled") {
    return "persistence_disabled";
  }

  return status === "dry-run" ? "dry_run" : "write_ready";
}

export function serializeSemanticMemoryArtifactStorageRecord(
  artifact: SemanticMemoryArtifactStorageRecord,
): SerializedSemanticMemoryArtifactStorageRecord {
  return {
    schemaVersion: 1,
    artifact: copyRecord(artifact),
  };
}

export function deserializeSemanticMemoryArtifactStorageRecord(
  value: unknown,
): DeserializeSemanticMemoryArtifactStorageRecordResult {
  if (!isObject(value)) {
    return {
      valid: false,
      reasonCodes: ["invalid_payload"],
    };
  }

  if (value.schemaVersion !== 1) {
    return {
      valid: false,
      reasonCodes: ["unsupported_schema_version"],
    };
  }

  if (!isObject(value.artifact)) {
    return {
      valid: false,
      reasonCodes: ["invalid_payload"],
    };
  }

  const artifact =
    value.artifact as unknown as SemanticMemoryArtifactStorageRecord;
  const reasonCodes: SemanticMemoryArtifactDeserializationReasonCode[] = [];

  if (!hasText(artifact.artifactId)) {
    reasonCodes.push("missing_artifact_id");
  }

  if (!hasText(artifact.userId)) {
    reasonCodes.push("missing_user_id");
  }

  if (!hasText(artifact.type)) {
    reasonCodes.push("missing_type");
  }

  if (!hasText(artifact.content)) {
    reasonCodes.push("missing_content");
  }

  if (!hasText(artifact.status)) {
    reasonCodes.push("missing_status");
  }

  if (!Number.isFinite(artifact.confidence)) {
    reasonCodes.push("invalid_confidence");
  }

  if (
    !Array.isArray(artifact.sourceRecordIds) ||
    artifact.sourceRecordIds.length === 0 ||
    !artifact.sourceRecordIds.every(hasText)
  ) {
    reasonCodes.push("missing_source_record_ids");
  }

  if (!hasText(artifact.sourceClusterKey)) {
    reasonCodes.push("missing_source_cluster_key");
  }

  if (!hasText(artifact.competitionKey)) {
    reasonCodes.push("missing_competition_key");
  }

  if (
    !Number.isFinite(artifact.createdAt) ||
    !Number.isFinite(artifact.updatedAt)
  ) {
    reasonCodes.push("missing_timestamps");
  }

  if (!isObject(artifact.rollback)) {
    reasonCodes.push("missing_rollback_metadata");
  }

  if (!Array.isArray(artifact.reasonCodes)) {
    reasonCodes.push("invalid_payload");
  }

  if (reasonCodes.length > 0) {
    return {
      valid: false,
      reasonCodes,
    };
  }

  return {
    valid: true,
    artifact: copyRecord(artifact),
    reasonCodes: [],
  };
}

export function buildSemanticMemoryArtifactStorageDryRunReport(
  input: BuildSemanticMemoryArtifactStorageDryRunReportInput,
): SemanticMemoryArtifactStorageDryRunReport {
  const status = storageDryRunStatus(input);
  const runReason = storageDryRunReasonCode(status);
  const wouldWriteCount = input.artifacts.length;
  const skippedWriteCount = status === "write-ready" ? 0 : wouldWriteCount;

  return {
    summary: {
      userId: input.userId,
      status,
      dryRun: status !== "write-ready",
      artifactCount: input.artifacts.length,
      wouldWriteCount,
      actualWriteCount: 0,
      skippedWriteCount,
    },
    artifacts: input.artifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      status: artifact.status,
      sourceRecordIds: [...artifact.sourceRecordIds],
      sourceClusterKey: artifact.sourceClusterKey,
      competitionKey: artifact.competitionKey,
      rollbackOperationId: artifact.rollback.operationId,
      rollbackSourceArtifactId: artifact.rollback.sourceArtifactId,
      reasonCodes: ["artifact_storage_candidate", runReason],
    })),
    serializedArtifacts: input.artifacts.map((artifact) =>
      serializeSemanticMemoryArtifactStorageRecord(artifact),
    ),
    reasonCodes: ["artifact_storage_candidate", runReason],
  };
}

export async function persistSemanticMemoryDrafts(
  input: PersistSemanticMemoryDraftsInput,
): Promise<PersistSemanticMemoryDraftsResult> {
  const now = input.now ?? Date.now();
  const plannedDrafts = input.items.map((item) =>
    buildPersistedDraft(item, now),
  );

  if (input.enabled !== true) {
    return {
      status: "disabled",
      userId: input.userId,
      dryRun: input.dryRun !== false,
      plannedDrafts,
      persistedCount: 0,
      skippedReason: "persistence_disabled",
    };
  }

  if (input.dryRun !== false) {
    return {
      status: "dry-run",
      userId: input.userId,
      dryRun: true,
      plannedDrafts,
      persistedCount: 0,
      skippedReason: "dry_run",
    };
  }

  if (!input.store) {
    throw new Error("Semantic draft persistence requires a store.");
  }

  await input.store.saveDrafts({
    userId: input.userId,
    drafts: plannedDrafts,
    now,
    dryRun: false,
  });

  return {
    status: "persisted",
    userId: input.userId,
    dryRun: false,
    plannedDrafts,
    persistedCount: plannedDrafts.length,
  };
}
