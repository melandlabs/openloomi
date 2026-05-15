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
  metadata?: Record<string, any>;
  createdAt: number;
  memoryStage?: MemoryStage;
  accessCount?: number;
  lastAccessAt?: number;
  importanceScore?: number;
  archivedAt?: number;
  isPinned?: boolean;
  summaryRefId?: string;
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

export interface MemorySummaryQuery {
  userId: string;
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
