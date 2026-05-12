import {
  buildMemoryRecordEmbeddingDocument,
  type MemoryRecord,
} from "../../ai/src/memory";
import type {
  IndexedDBManager,
  RawMessage,
  RawMessageEmbeddingUpdate,
} from "./manager";

const DEFAULT_MEMORY_EMBEDDING_DREAM_LIMIT = 100;
const DEFAULT_MEMORY_SEMANTIC_SEARCH_LIMIT = 10;
const DEFAULT_MEMORY_SEMANTIC_SEARCH_THRESHOLD = 0.7;

export type RawMessageEmbeddingDreamReason =
  | "missing"
  | "model_changed"
  | "content_changed";

export interface RunRawMessageEmbeddingDreamInput {
  userId: string;
  embeddingModel: string;
  embedDocuments: (documents: string[]) => Promise<number[][]>;
  limit?: number;
  scanLimit?: number;
  includeArchived?: boolean;
  dryRun?: boolean;
  now?: number;
}

export interface RunRawMessageEmbeddingDreamResult {
  scanned: number;
  selected: number;
  embedded: number;
  dryRun: boolean;
  reasons: Record<RawMessageEmbeddingDreamReason, number>;
}

export interface RawMessageSemanticSearchInput {
  userId: string;
  query: string;
  embeddingModel?: string;
  embedQuery: (query: string) => Promise<number[]>;
  limit?: number;
  scanLimit?: number;
  threshold?: number;
  includeArchived?: boolean;
  platform?: string;
  botId?: string;
  channel?: string;
  person?: string;
  startTime?: number;
  endTime?: number;
}

export interface RawMessageSemanticSearchResult {
  type: "memory";
  id: string;
  content: string;
  similarity: number;
  metadata: {
    userId: string;
    platform: string;
    botId: string;
    channel?: string;
    person?: string;
    timestamp: number;
    memoryStage?: string;
    embeddingModel?: string;
  };
  message: RawMessage;
}

export type RawMessageEmbeddingDreamManager = Pick<
  IndexedDBManager,
  "queryMessages" | "updateMessageEmbeddings"
>;

export type RawMessageSemanticSearchManager = Pick<
  IndexedDBManager,
  "queryMessages"
>;

function clampLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1_000, Math.max(1, Math.floor(value ?? fallback)));
}

function normalizeTimestampToMs(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if ((value as number) < 1e11) {
    return Math.floor((value as number) * 1000);
  }
  return Math.floor(value as number);
}

function clampThreshold(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MEMORY_SEMANTIC_SEARCH_THRESHOLD;
  }
  return Math.min(
    1,
    Math.max(-1, value ?? DEFAULT_MEMORY_SEMANTIC_SEARCH_THRESHOLD),
  );
}

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length === 0 || vecA.length !== vecB.length) {
    return Number.NaN;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i += 1) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) {
    return Number.NaN;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function rawMessageToMemoryRecord(message: RawMessage): MemoryRecord {
  return {
    id: message.messageId,
    userId: message.userId,
    timestamp: normalizeTimestampToMs(message.timestamp),
    text: message.archivedAt ? undefined : message.content,
    mediaRefs: message.attachments?.map((item) => item.url).filter(Boolean),
    embedding: message.embedding,
    embeddingModel: message.embeddingModel,
    embeddingContentHash: message.embeddingContentHash,
    embeddingDimensions: message.embeddingDimensions,
    embeddingUpdatedAt: message.embeddingUpdatedAt,
    tier: message.memoryStage ?? "short",
    accessCount: message.accessCount ?? 0,
    lastAccessAt: message.lastAccessAt,
    importanceScore: message.importanceScore ?? 0,
    isPinned: message.isPinned ?? false,
    archivedAt: message.archivedAt,
    dimensions: {
      platform: message.platform,
      channel: message.channel,
      person: message.person,
      botId: message.botId,
    },
    metadata: message.metadata,
  };
}

export function resolveRawMessageEmbeddingDreamReason(input: {
  embedding?: number[];
  embeddingModel?: string;
  embeddingContentHash?: string;
  expectedEmbeddingModel: string;
  expectedContentHash: string;
}): RawMessageEmbeddingDreamReason | null {
  if (!input.embedding || input.embedding.length === 0) {
    return "missing";
  }
  if (input.embeddingModel !== input.expectedEmbeddingModel) {
    return "model_changed";
  }
  if (input.embeddingContentHash !== input.expectedContentHash) {
    return "content_changed";
  }
  return null;
}

export async function runRawMessageEmbeddingDream(
  manager: RawMessageEmbeddingDreamManager,
  input: RunRawMessageEmbeddingDreamInput,
): Promise<RunRawMessageEmbeddingDreamResult> {
  const limit = clampLimit(input.limit, DEFAULT_MEMORY_EMBEDDING_DREAM_LIMIT);
  const scanLimit = clampLimit(input.scanLimit, Math.max(limit * 5, limit));
  const now = input.now ?? Date.now();

  const messages = await manager.queryMessages({
    userId: input.userId,
    includeArchived: input.includeArchived ?? false,
    pageSize: scanLimit,
    reverse: true,
  });

  const reasons: Record<RawMessageEmbeddingDreamReason, number> = {
    missing: 0,
    model_changed: 0,
    content_changed: 0,
  };
  const selected: Array<{
    message: RawMessage;
    content: string;
    contentHash: string;
  }> = [];

  for (const message of messages) {
    const record = rawMessageToMemoryRecord(message);
    const document = buildMemoryRecordEmbeddingDocument(record);
    if (document.content.length === 0) {
      continue;
    }

    const reason = resolveRawMessageEmbeddingDreamReason({
      embedding: message.embedding,
      embeddingModel: message.embeddingModel,
      embeddingContentHash: message.embeddingContentHash,
      expectedEmbeddingModel: input.embeddingModel,
      expectedContentHash: document.contentHash,
    });
    if (!reason) {
      continue;
    }

    reasons[reason] += 1;
    selected.push({
      message,
      content: document.content,
      contentHash: document.contentHash,
    });

    if (selected.length >= limit) {
      break;
    }
  }

  if (input.dryRun || selected.length === 0) {
    return {
      scanned: messages.length,
      selected: selected.length,
      embedded: 0,
      dryRun: Boolean(input.dryRun),
      reasons,
    };
  }

  const vectors = await input.embedDocuments(
    selected.map((item) => item.content),
  );
  if (vectors.length !== selected.length) {
    throw new Error(
      `Embedding result count mismatch: expected ${selected.length}, got ${vectors.length}`,
    );
  }

  const updates: RawMessageEmbeddingUpdate[] = selected.map((item, index) => {
    const embedding = vectors[index];
    return {
      messageId: item.message.messageId,
      embedding,
      embeddingModel: input.embeddingModel,
      embeddingContentHash: item.contentHash,
      embeddingDimensions: embedding.length,
      embeddingUpdatedAt: now,
    };
  });

  const embedded = await manager.updateMessageEmbeddings(updates, input.userId);

  return {
    scanned: messages.length,
    selected: selected.length,
    embedded,
    dryRun: false,
    reasons,
  };
}

export async function searchRawMessagesSemantically(
  manager: RawMessageSemanticSearchManager,
  input: RawMessageSemanticSearchInput,
): Promise<RawMessageSemanticSearchResult[]> {
  const query = input.query.trim();
  if (!query) {
    return [];
  }

  const limit = clampLimit(input.limit, DEFAULT_MEMORY_SEMANTIC_SEARCH_LIMIT);
  const scanLimit = clampLimit(input.scanLimit, Math.max(limit * 10, limit));
  const threshold = clampThreshold(input.threshold);
  const queryEmbedding = await input.embedQuery(query);
  if (queryEmbedding.length === 0) {
    return [];
  }

  const messages = await manager.queryMessages({
    userId: input.userId,
    includeArchived: input.includeArchived ?? false,
    pageSize: scanLimit,
    reverse: true,
    platform: input.platform,
    botId: input.botId,
    channel: input.channel,
    person: input.person,
    startTime: input.startTime,
    endTime: input.endTime,
  });

  return messages
    .map((message): RawMessageSemanticSearchResult | null => {
      if (!message.embedding || message.embedding.length === 0) {
        return null;
      }
      if (
        input.embeddingModel &&
        message.embeddingModel &&
        message.embeddingModel !== input.embeddingModel
      ) {
        return null;
      }

      const similarity = cosineSimilarity(queryEmbedding, message.embedding);
      if (!Number.isFinite(similarity) || similarity < threshold) {
        return null;
      }

      return {
        type: "memory",
        id: message.messageId,
        content: message.archivedAt ? "" : message.content,
        similarity,
        metadata: {
          userId: message.userId,
          platform: message.platform,
          botId: message.botId,
          channel: message.channel,
          person: message.person,
          timestamp: normalizeTimestampToMs(message.timestamp),
          memoryStage: message.memoryStage,
          embeddingModel: message.embeddingModel,
        },
        message,
      };
    })
    .filter(
      (result): result is RawMessageSemanticSearchResult => result !== null,
    )
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
