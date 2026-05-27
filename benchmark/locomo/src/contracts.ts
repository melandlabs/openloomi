/**
 * Memory contracts - types for OpenLoomi memory system.
 * Copied from @openloomi/ai/memory/contracts for standalone benchmark use.
 */

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

export interface MemoryPageResult<T> {
  items: T[];
  hasMore: boolean;
  nextOffset?: number;
  totalApprox?: number;
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
  acquireLock(input: { key: string; ttlMs: number; now: number }): Promise<{
    key: string;
    token: string;
    acquiredAt: number;
    expiresAt?: number;
  } | null>;
  releaseLock(handle: {
    key: string;
    token: string;
    acquiredAt: number;
    expiresAt?: number;
  }): Promise<void>;

  listCandidates(input: {
    userId: string;
    tier: MemoryTier;
    olderThan: number;
    limit: number;
  }): Promise<MemoryRecord[]>;

  saveSummaries(summaries: MemorySummary[]): Promise<void>;
  transitionRecords(input: {
    userId: string;
    ids: string[];
    toTier: MemoryTier;
    transitionedAt: number;
    summaryId?: string;
  }): Promise<void>;
  archiveRecordDetails?(input: {
    userId: string;
    ids: string[];
    archivedAt: number;
  }): Promise<void>;

  queryRaw(query: MemorySearchQuery): Promise<MemoryPageResult<MemoryRecord>>;
  querySummaries(
    query: MemorySummarySearchQuery,
  ): Promise<MemoryPageResult<MemorySummary>>;
  markRecordsAccessed?(input: {
    userId: string;
    ids: string[];
    at: number;
  }): Promise<void>;
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

export interface MemoryLockHandle {
  key: string;
  token: string;
  acquiredAt: number;
  expiresAt?: number;
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
