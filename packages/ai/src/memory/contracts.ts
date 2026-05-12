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
  markRecordsAccessed?(input: MemoryMarkAccessedInput): Promise<void>;
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

export interface MemorySearchWithFallbackResult {
  items: MemorySearchHit[];
  rawCount: number;
  summaryCount: number;
  hasMore: boolean;
}
