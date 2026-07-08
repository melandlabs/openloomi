export type MemoryTier = "short" | "mid" | "long";

export type MemorySummaryTier = "L1" | "L2" | "L3";

export type MemoryDimensionValue = string | number | boolean;

export type MemoryDimensions = Record<string, MemoryDimensionValue | undefined>;

export interface MemoryRecord {
  id: string;
  userId: string;
  /**
   * Unix timestamp in milliseconds.
   */
  timestamp: number;
  text?: string;
  mediaRefs?: string[];
  embedding?: number[];
  embeddingModel?: string;
  embeddingContentHash?: string;
  embeddingDimensions?: number;
  embeddingUpdatedAt?: number;
  tier: MemoryTier;
  accessCount?: number;
  lastAccessAt?: number;
  importanceScore?: number;
  isPinned?: boolean;
  archivedAt?: number;
  dimensions?: MemoryDimensions;
  metadata?: Record<string, unknown>;
  /**
   * Unix timestamp (ms) at which this record was deprecated (soft-hidden
   * because it has been superseded by a higher-tier summary). When set, the
   * record is excluded from default retrieval.
   */
  deprecatedAt?: number;
  /**
   * Short tag describing why this record was deprecated, e.g.
   * `summarized_into:<summaryId>`.
   */
  deprecationReason?: string;
  /**
   * When deprecated, the id of the memory summary that superseded this
   * record. Lets retrieval follow the chain when callers opt in.
   */
  supersededBySummaryId?: string;
}

export interface MemorySummary {
  summaryId: string;
  userId: string;
  summaryTier: MemorySummaryTier;
  /**
   * Source tier before transition. Example: short -> mid creates L1 summary.
   */
  sourceTier: MemoryTier;
  startTimestamp: number;
  endTimestamp: number;
  messageCount: number;
  sourceRecordIds: string[];
  keyPoints: string[];
  keywords: string[];
  summaryText: string;
  dimensions?: MemoryDimensions;
  qualityScore?: number;
  createdAt: number;
  updatedAt: number;
}

export interface MemorySummaryDraft {
  summaryText: string;
  keyPoints: string[];
  keywords: string[];
  qualityScore?: number;
}

export interface MemoryLockHandle {
  key: string;
  token: string;
  acquiredAt: number;
  expiresAt?: number;
}

export interface MemoryPageResult<T> {
  items: T[];
  hasMore: boolean;
  nextOffset?: number;
  totalApprox?: number;
}

export interface MemoryListCandidatesInput {
  userId: string;
  tier: MemoryTier;
  olderThan: number;
  limit: number;
}

export interface MemoryTransitionRecordsInput {
  userId: string;
  ids: string[];
  toTier: MemoryTier;
  transitionedAt: number;
  summaryId?: string;
}

export interface MemoryArchiveRecordDetailsInput {
  userId: string;
  ids: string[];
  archivedAt: number;
}

export interface MemoryMarkAccessedInput {
  userId: string;
  ids: string[];
  at: number;
}

/**
 * Input for soft-deprecating memory records. The records stay in storage but
 * are hidden from default retrieval; `supersededBySummaryId` lets callers
 * follow the chain when `includeDeprecated` is true.
 */
export interface MemoryDeprecateRecordsInput {
  userId: string;
  ids: string[];
  deprecatedAt: number;
  /**
   * Short tag, e.g. "summarized_into:<summaryId>". Stored verbatim and used
   * by operators when scanning the table.
   */
  reason?: string;
  /**
   * Optional id of the summary that superseded these records. Required when
   * deprecation is the result of a successful summarize operation; callers
   * that deprecate for other reasons (manual cleanup, etc.) may omit it.
   */
  supersededBySummaryId?: string;
}

export interface MemorySearchQuery {
  userId: string;
  keywords?: string[];
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
  pageSize?: number;
  reverse?: boolean;
  tiers?: MemoryTier[];
  dimensions?: MemoryDimensions;
  /**
   * When false (default), records with `deprecatedAt` set are excluded.
   * Set true to include deprecated records (useful for audits / chain
   * traversal back to the canonical summary).
   */
  includeDeprecated?: boolean;
}

export interface MemorySummarySearchQuery {
  userId: string;
  keywords?: string[];
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
  pageSize?: number;
  reverse?: boolean;
  summaryTiers?: MemorySummaryTier[];
  dimensions?: MemoryDimensions;
}

export interface MemorySemanticRecallQuery {
  userId: string;
  queryEmbedding: number[];
  limit?: number;
  threshold?: number;
  tiers?: MemoryTier[];
  dimensions?: MemoryDimensions;
  startTime?: number;
  endTime?: number;
  includeDeprecated?: boolean;
}

export interface MemorySemanticRecallHit {
  record: MemoryRecord;
  similarity: number;
}

export interface MemoryStorageAdapter {
  acquireLock(input: {
    key: string;
    ttlMs: number;
    now: number;
  }): Promise<MemoryLockHandle | null>;
  releaseLock(handle: MemoryLockHandle): Promise<void>;

  listCandidates(input: MemoryListCandidatesInput): Promise<MemoryRecord[]>;
  saveSummaries(summaries: MemorySummary[]): Promise<void>;
  transitionRecords(input: MemoryTransitionRecordsInput): Promise<void>;
  archiveRecordDetails?(input: MemoryArchiveRecordDetailsInput): Promise<void>;

  queryRaw(query: MemorySearchQuery): Promise<MemoryPageResult<MemoryRecord>>;
  querySummaries(
    query: MemorySummarySearchQuery,
  ): Promise<MemoryPageResult<MemorySummary>>;
  semanticRecallRaw?(
    query: MemorySemanticRecallQuery,
  ): Promise<MemorySemanticRecallHit[]>;
  markRecordsAccessed?(input: MemoryMarkAccessedInput): Promise<void>;
  /**
   * Soft-deprecate records: write `deprecatedAt` (+ optional reason /
   * supersededBySummaryId) without deleting the rows. Returns the number of
   * rows that transitioned from non-deprecated to deprecated (idempotent —
   * re-deprecating an already-deprecated record does not bump the count).
   *
   * Optional on the adapter so older implementations remain source-compatible.
   */
  deprecateRecords?(input: MemoryDeprecateRecordsInput): Promise<number>;
}

export interface ScoredMemoryRecord extends MemoryRecord {
  ageMs: number;
  valueScore: number;
}

export interface MemoryGroup {
  groupId: string;
  userId: string;
  sourceTier: MemoryTier;
  targetTier: MemoryTier;
  summaryTier: MemorySummaryTier;
  records: ScoredMemoryRecord[];
  startTimestamp: number;
  endTimestamp: number;
  dimensions?: MemoryDimensions;
}

export interface MemoryRecordScorer {
  score(
    record: MemoryRecord,
    context: {
      now: number;
    },
  ): number;
}

export interface MemorySummarizer {
  summarizeGroup(
    group: MemoryGroup,
    context: {
      now: number;
    },
  ): Promise<MemorySummaryDraft>;
}

export interface MemoryForgettingRunInput {
  userId: string;
  now?: number;
  dryRun?: boolean;
  /**
   * Soft-deprecate raw source records after their summary is saved.
   * Defaults to true. Dry runs still skip all writes.
   */
  deprecateSourceRecords?: boolean;
}

export interface MemoryForgettingRunResult {
  status: "success" | "skipped_locked";
  dryRun: boolean;
  userId: string;
  startedAt: number;
  finishedAt: number;
  scannedRecords: number;
  eligibleRecords: number;
  createdSummaries: number;
  transitionedRecords: number;
  archivedDetailRecords: number;
  deprecationStatus?: "disabled" | "dry-run" | "failed" | "no-op" | "persisted";
  deprecationPlannedRecords?: number;
  deprecatedRecords?: number;
  deprecationReasonCodes?: string[];
}

export type MemorySearchHit =
  | {
      sourceType: "raw";
      timestamp: number;
      record: MemoryRecord;
    }
  | {
      sourceType: "summary";
      timestamp: number;
      summary: MemorySummary;
    };

export interface MemorySemanticRecallResult {
  items: Array<
    MemorySemanticRecallHit & {
      sourceType: "raw";
      timestamp: number;
    }
  >;
  rawCount: number;
}

export interface MemorySearchWithFallbackResult {
  items: MemorySearchHit[];
  rawCount: number;
  summaryCount: number;
  hasMore: boolean;
}
