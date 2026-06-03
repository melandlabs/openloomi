import { buildMemoryRecordEmbeddingDocument } from "@openloomi/ai/memory";
import {
  rawMessageToMemoryRecord,
  type RawMessage,
} from "@openloomi/indexeddb";
import { ChromaVectorStore } from "@openloomi/rag";
import type { DocumentChunk } from "@openloomi/rag/vector-service";

const DEFAULT_RAW_MESSAGES_COLLECTION = "openloomi_raw_messages";
const DEFAULT_INSIGHTS_COLLECTION = "openloomi_insights";
const RAW_VECTOR_BACKEND_ENV_KEYS = [
  "RAW_MESSAGE_VECTOR_STORE_BACKEND",
  "MEMORY_VECTOR_STORE_BACKEND",
  "VECTOR_STORE_BACKEND",
] as const;
const INSIGHT_VECTOR_BACKEND_ENV_KEYS = [
  "INSIGHT_VECTOR_STORE_BACKEND",
  "MEMORY_VECTOR_STORE_BACKEND",
  "VECTOR_STORE_BACKEND",
] as const;

export interface ChromaInsightVectorInput {
  insightId: string;
  userId: string;
  botId: string;
  content: string;
  contentHash: string;
  embedding: number[];
  embeddingModel: string;
  embeddingDimensions: number;
  title?: unknown;
  description?: unknown;
  taskLabel?: unknown;
  importance?: unknown;
  urgency?: unknown;
  platform?: unknown;
  account?: unknown;
  time?: unknown;
  archived?: unknown;
}

export interface ChromaInsightSearchResult {
  id: string;
  content: string;
  similarity: number;
  metadata: {
    botId: string;
    title: string;
    description: string;
    taskLabel: string;
    importance: string;
    urgency: string;
    platform: string | null;
    account: string | null;
    time: Date | null;
    embeddingModel: string;
    embeddingDimensions: number;
    contentHash: string;
  };
}

function getBackend(keys: readonly string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim().toLowerCase();
    if (value) {
      return value;
    }
  }
  return "";
}

export function isRawMessageChromaEnabled(): boolean {
  return getBackend(RAW_VECTOR_BACKEND_ENV_KEYS) === "chroma";
}

export function isInsightChromaEnabled(): boolean {
  return getBackend(INSIGHT_VECTOR_BACKEND_ENV_KEYS) === "chroma";
}

function getRawMessagesCollectionName(): string {
  return (
    process.env.CHROMA_RAW_MESSAGES_COLLECTION ||
    process.env.CHROMA_MEMORY_COLLECTION ||
    DEFAULT_RAW_MESSAGES_COLLECTION
  );
}

function getInsightsCollectionName(): string {
  return process.env.CHROMA_INSIGHTS_COLLECTION || DEFAULT_INSIGHTS_COLLECTION;
}

function getChromaStore(collectionName: string): ChromaVectorStore {
  return new ChromaVectorStore({
    url: process.env.CHROMA_URL,
    collectionName,
  });
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

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function toBooleanValue(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function toDateValue(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function rawMessageToChunk(message: RawMessage): DocumentChunk | null {
  if (!message.embedding || message.embedding.length === 0) {
    return null;
  }

  const record = rawMessageToMemoryRecord(message);
  const document = buildMemoryRecordEmbeddingDocument(record);
  if (!document.content) {
    return null;
  }

  return {
    id: message.messageId,
    documentId: message.messageId,
    content: document.content,
    embedding: message.embedding,
    metadata: {
      sourceType: "raw_message",
      userId: message.userId,
      platform: message.platform,
      botId: message.botId,
      channel: message.channel,
      person: message.person,
      timestamp: normalizeTimestampToMs(message.timestamp),
      memoryStage: message.memoryStage,
      embeddingModel: message.embeddingModel,
      embeddingDimensions: message.embeddingDimensions,
      contentHash: message.embeddingContentHash,
      archived: Boolean(message.archivedAt),
      role:
        typeof message.metadata?.role === "string"
          ? message.metadata.role
          : undefined,
    },
  };
}

export async function upsertRawMessagesToChroma(
  messages: RawMessage[],
): Promise<number> {
  if (!isRawMessageChromaEnabled() || messages.length === 0) {
    return 0;
  }

  const chunks = messages
    .map(rawMessageToChunk)
    .filter((chunk): chunk is DocumentChunk => chunk !== null);
  if (chunks.length === 0) {
    return 0;
  }

  const store = getChromaStore(getRawMessagesCollectionName());
  await store.addChunks(chunks);
  return chunks.length;
}

export async function searchRawMessagesWithChroma(input: {
  userId: string;
  queryEmbedding: number[];
  limit: number;
  threshold: number;
  botId?: string;
}): Promise<
  Array<{
    id: string;
    content: string;
    similarity: number;
    metadata: Record<string, unknown>;
  }>
> {
  if (!isRawMessageChromaEnabled() || input.queryEmbedding.length === 0) {
    return [];
  }

  const store = getChromaStore(getRawMessagesCollectionName());
  const results = await store.similaritySearch(
    input.queryEmbedding,
    Math.max(input.limit * 5, input.limit),
    input.userId,
  );

  return results
    .filter((result) => {
      const metadata = result.metadata ?? {};
      if (toBooleanValue(metadata.archived)) {
        return false;
      }
      if (input.botId && metadata.botId !== input.botId) {
        return false;
      }
      return result.score >= input.threshold;
    })
    .map((result) => ({
      id: result.id,
      content: result.content,
      similarity: result.score,
      metadata: result.metadata ?? {},
    }))
    .slice(0, input.limit);
}

export async function upsertInsightsToChroma(
  insights: ChromaInsightVectorInput[],
): Promise<number> {
  if (!isInsightChromaEnabled() || insights.length === 0) {
    return 0;
  }

  const chunks = insights
    .filter(
      (item) =>
        item.content.trim().length > 0 &&
        Array.isArray(item.embedding) &&
        item.embedding.length > 0,
    )
    .map<DocumentChunk>((item) => ({
      id: item.insightId,
      documentId: item.insightId,
      content: item.content,
      embedding: item.embedding,
      metadata: {
        sourceType: "insight",
        insightId: item.insightId,
        userId: item.userId,
        botId: item.botId,
        title: toStringValue(item.title),
        description: toStringValue(item.description),
        taskLabel: toStringValue(item.taskLabel),
        importance: toStringValue(item.importance),
        urgency: toStringValue(item.urgency),
        platform: toNullableString(item.platform),
        account: toNullableString(item.account),
        time: toDateValue(item.time)?.toISOString(),
        embeddingModel: item.embeddingModel,
        embeddingDimensions: item.embeddingDimensions,
        contentHash: item.contentHash,
        archived: toBooleanValue(item.archived),
      },
    }));

  if (chunks.length === 0) {
    return 0;
  }

  const store = getChromaStore(getInsightsCollectionName());
  await store.addChunks(chunks);
  return chunks.length;
}

export async function searchInsightsWithChroma(input: {
  userId: string;
  queryEmbedding: number[];
  limit: number;
  threshold: number;
  botIds?: string[];
  includeArchived?: boolean;
}): Promise<ChromaInsightSearchResult[]> {
  if (!isInsightChromaEnabled() || input.queryEmbedding.length === 0) {
    return [];
  }

  const botIdSet =
    input.botIds && input.botIds.length > 0 ? new Set(input.botIds) : null;
  const store = getChromaStore(getInsightsCollectionName());
  const results = await store.similaritySearch(
    input.queryEmbedding,
    Math.max(input.limit * 5, input.limit),
    input.userId,
  );

  return results
    .filter((result) => {
      const metadata = result.metadata ?? {};
      if (!input.includeArchived && toBooleanValue(metadata.archived)) {
        return false;
      }
      if (botIdSet && !botIdSet.has(String(metadata.botId ?? ""))) {
        return false;
      }
      return result.score >= input.threshold;
    })
    .map((result) => {
      const metadata = result.metadata ?? {};
      return {
        id: result.id,
        content: result.content,
        similarity: result.score,
        metadata: {
          botId: toStringValue(metadata.botId),
          title: toStringValue(metadata.title),
          description: toStringValue(metadata.description),
          taskLabel: toStringValue(metadata.taskLabel),
          importance: toStringValue(metadata.importance),
          urgency: toStringValue(metadata.urgency),
          platform: toNullableString(metadata.platform),
          account: toNullableString(metadata.account),
          time: toDateValue(metadata.time),
          embeddingModel: toStringValue(metadata.embeddingModel),
          embeddingDimensions: Number(metadata.embeddingDimensions ?? 0),
          contentHash: toStringValue(metadata.contentHash),
        },
      };
    })
    .slice(0, input.limit);
}
