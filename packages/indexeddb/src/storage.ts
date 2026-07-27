/**
 * Storage contract for local raw message persistence.
 *
 * The current browser implementation lives in `manager.ts`, while the desktop
 * SQLite implementation can implement this same shape without leaking storage
 * details into client code.
 */

export type MemoryStage = "short" | "mid" | "long";
export type MemorySummaryTier = "L1" | "L2" | "L3";

export interface RawMessage {
  id?: number;
  messageId: string;
  platform: string;
  botId: string;
  userId: string;
  channel?: string;
  person?: string;
  timestamp: number;
  content: string;
  attachments?: Array<{
    name: string;
    url: string;
    contentType?: string;
    sizeBytes?: number;
  }>;
  embedding?: number[];
  embeddingModel?: string;
  embeddingContentHash?: string;
  embeddingDimensions?: number;
  embeddingUpdatedAt?: number;
  // biome-ignore lint/suspicious/noExplicitAny: Preserve the public raw metadata contract.
  metadata?: Record<string, any>;
  createdAt: number;
  memoryStage?: MemoryStage;
  accessCount?: number;
  lastAccessAt?: number;
  importanceScore?: number;
  archivedAt?: number;
  isPinned?: boolean;
  summaryRefId?: string;
  /**
   * Soft-hide flag: when set, the record has been superseded by a higher-tier
   * summary. Excluded from default retrieval; pass `includeDeprecated: true`
   * in the query to surface it (audit / chain traversal).
   */
  deprecatedAt?: number;
  deprecationReason?: string;
  supersededBySummaryId?: string;
}

export const CHAT_MEMORY_EVIDENCE_ID_PREFIX = "openloomi-chat:";

export function mergeStoredChatMemoryEvidence(
  existing: RawMessage,
  incoming: RawMessage,
): RawMessage {
  if (!incoming.messageId.startsWith(CHAT_MEMORY_EVIDENCE_ID_PREFIX)) {
    return incoming;
  }
  return {
    ...incoming,
    id: existing.id,
    platform: existing.platform,
    botId: existing.botId,
    userId: existing.userId,
    channel: existing.channel,
    person: existing.person,
    timestamp: existing.timestamp,
    content: existing.content,
    attachments: existing.attachments ?? incoming.attachments,
    embedding: existing.embedding ?? incoming.embedding,
    embeddingModel: existing.embeddingModel ?? incoming.embeddingModel,
    embeddingContentHash:
      existing.embeddingContentHash ?? incoming.embeddingContentHash,
    embeddingDimensions:
      existing.embeddingDimensions ?? incoming.embeddingDimensions,
    embeddingUpdatedAt:
      existing.embeddingUpdatedAt ?? incoming.embeddingUpdatedAt,
    metadata: {
      ...(existing.metadata ?? {}),
      ...(incoming.metadata ?? {}),
    },
    createdAt: existing.createdAt,
    memoryStage: existing.memoryStage ?? incoming.memoryStage,
    accessCount: existing.accessCount ?? incoming.accessCount,
    lastAccessAt: existing.lastAccessAt ?? incoming.lastAccessAt,
    importanceScore: existing.importanceScore ?? incoming.importanceScore,
    archivedAt: existing.archivedAt ?? incoming.archivedAt,
    isPinned: existing.isPinned ?? incoming.isPinned,
    summaryRefId: existing.summaryRefId ?? incoming.summaryRefId,
    deprecatedAt: existing.deprecatedAt ?? incoming.deprecatedAt,
    deprecationReason: existing.deprecationReason ?? incoming.deprecationReason,
    supersededBySummaryId:
      existing.supersededBySummaryId ?? incoming.supersededBySummaryId,
  };
}

export type GroupByType = "none" | "day" | "week" | "month";

export interface RawMessageQuery {
  userId?: string;
  platform?: string;
  botId?: string;
  channel?: string;
  person?: string;
  startTime?: number;
  endTime?: number;
  keywords?: string[];
  limit?: number;
  offset?: number;
  pageSize?: number;
  groupBy?: GroupByType;
  reverse?: boolean;
  includeSummaryFallback?: boolean;
  minRawResultsWithoutFallback?: number;
  memoryStages?: MemoryStage[];
  includeArchived?: boolean;
  /**
   * When false (default), records with `deprecatedAt` set are excluded.
   * Set true to include deprecated records (audits / chain traversal).
   */
  includeDeprecated?: boolean;
}

export interface MemorySummaryRecord {
  summaryId: string;
  userId: string;
  summaryTier: MemorySummaryTier;
  sourceTier: MemoryStage;
  startTimestamp: number;
  endTimestamp: number;
  messageCount: number;
  sourceRecordIds: string[];
  keyPoints: string[];
  keywords: string[];
  keywordsText?: string;
  summaryText: string;
  dimensions?: Record<string, string | number | boolean | undefined>;
  qualityScore?: number;
  createdAt: number;
  updatedAt: number;
}

export const MEMORY_SUMMARY_OWNER_SCOPE_CONFLICT =
  "memory_summary_owner_scope_conflict";
export const MEMORY_SUMMARY_WRITE_CONFLICT = "memory_summary_write_conflict";
export const MEMORY_SUMMARY_PUBLICATION_DIMENSION =
  "__openloomiMemoryPublication";
export const MEMORY_SUMMARY_PUBLICATION_REVISION_DIMENSION =
  "__openloomiMemoryPublicationRevision";
export const MEMORY_SUMMARY_PUBLICATION_EXPECTED_REVISION_DIMENSION =
  "__openloomiMemoryPublicationExpectedRevision";

export function isMemorySummaryPublicationPendingRecord(summary: {
  dimensions?: MemorySummaryRecord["dimensions"] | null;
}): boolean {
  return (
    summary.dimensions?.[MEMORY_SUMMARY_PUBLICATION_DIMENSION] === "pending"
  );
}

export function memorySummaryPublicationRevisionRecord(summary: {
  dimensions?: MemorySummaryRecord["dimensions"] | null;
}): string | undefined {
  const revision =
    summary.dimensions?.[MEMORY_SUMMARY_PUBLICATION_REVISION_DIMENSION];
  return typeof revision === "string" && revision.length > 0
    ? revision
    : undefined;
}

function memorySummaryPublicationExpectedRevisionRecord(summary: {
  dimensions?: MemorySummaryRecord["dimensions"] | null;
}): string | undefined {
  const revision =
    summary.dimensions?.[
      MEMORY_SUMMARY_PUBLICATION_EXPECTED_REVISION_DIMENSION
    ];
  return typeof revision === "string" && revision.length > 0
    ? revision
    : undefined;
}

export function withoutMemorySummaryPublicationExpectedRevision<
  T extends { dimensions?: MemorySummaryRecord["dimensions"] | null },
>(summary: T): T {
  const dimensions = { ...(summary.dimensions ?? {}) };
  delete dimensions[MEMORY_SUMMARY_PUBLICATION_EXPECTED_REVISION_DIMENSION];
  return {
    ...summary,
    dimensions: Object.keys(dimensions).length > 0 ? dimensions : undefined,
  };
}

export function hasMemorySummaryPublicationRevisionConflict(
  existing: { dimensions?: MemorySummaryRecord["dimensions"] | null },
  incoming: { dimensions?: MemorySummaryRecord["dimensions"] | null },
): boolean {
  if (isMemorySummaryPublicationPendingRecord(incoming)) return false;
  const existingRevision = memorySummaryPublicationRevisionRecord(existing);
  if (!existingRevision) return false;
  const expectedRevision =
    memorySummaryPublicationExpectedRevisionRecord(incoming);
  if (expectedRevision) return existingRevision !== expectedRevision;
  return memorySummaryPublicationRevisionRecord(incoming) !== existingRevision;
}

export interface MemorySummaryQuery {
  userId: string;
  summaryIds?: string[];
  keywords?: string[];
  startTime?: number;
  endTime?: number;
  reverse?: boolean;
  summaryTiers?: MemorySummaryTier[];
  pageSize?: number;
  limit?: number;
  offset?: number;
  dimensions?: Record<string, string | number | boolean | undefined>;
}

export interface RawMessageEmbeddingUpdate {
  messageId: string;
  embedding: number[];
  embeddingModel: string;
  embeddingContentHash: string;
  embeddingDimensions?: number;
  embeddingUpdatedAt?: number;
}

export interface RawMessageStats {
  totalMessages: number;
  messagesByPlatform: Record<string, number>;
  messagesByBot: Record<string, number>;
  oldestMessage?: number;
  newestMessage?: number;
}

export interface RawMessageStorage {
  storeMessage(message: RawMessage): Promise<number>;
  storeMessages(messages: RawMessage[]): Promise<number[]>;
  queryMessages(query: RawMessageQuery): Promise<RawMessage[]>;
  queryMessagesGrouped(
    query: RawMessageQuery,
  ): Promise<Record<string, RawMessage[]>>;
  getStats(): Promise<RawMessageStats>;
  getMessageById(messageId: string): Promise<RawMessage | null>;
  deleteOldMessages(olderThan: number, userId?: string): Promise<number>;
  clearAll(): Promise<void>;

  /** Reject a published write unless its revision or replacement CAS matches. */
  upsertSummaries(summaries: MemorySummaryRecord[]): Promise<void>;
  querySummaries(query: MemorySummaryQuery): Promise<MemorySummaryRecord[]>;

  markMessagesAccessed(
    messageIds: string[],
    at?: number,
    userId?: string,
  ): Promise<number>;
  promoteMessagesToStage(
    messageIds: string[],
    stage: MemoryStage,
    options?: {
      userId?: string;
      summaryRefId?: string;
      promotedAt?: number;
    },
  ): Promise<number>;
  archiveMessages(
    messageIds: string[],
    archivedAt?: number,
    userId?: string,
  ): Promise<number>;
  /**
   * Soft-deprecate messages: write `deprecatedAt` (+ optional reason /
   * supersededBySummaryId) without deleting the rows. Returns the number of
   * rows that transitioned from non-deprecated to deprecated (idempotent —
   * re-deprecating an already-deprecated message does not bump the count).
   *
   * Optional on implementations that pre-date the deprecation columns.
   */
  deprecateMessages?(
    messageIds: string[],
    input: {
      userId?: string;
      deprecatedAt?: number;
      reason?: string;
      supersededBySummaryId?: string;
    },
  ): Promise<number>;
  /** Restore only records still deprecated by the targeted summary. */
  restoreDeprecatedMessages?(
    messageIds: string[],
    input: {
      userId?: string;
      supersededBySummaryId?: string;
    },
  ): Promise<number>;
  hardDeleteArchived(olderThan: number, userId?: string): Promise<number>;
  updateMessageEmbeddings(
    updates: RawMessageEmbeddingUpdate[],
    userId?: string,
  ): Promise<number>;
}

export interface RawMessageStorageManager extends RawMessageStorage {
  init(): Promise<void>;
  close(): Promise<void>;
}
