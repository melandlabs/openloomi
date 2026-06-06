import { isTauriMode, TAURI_DB_PATH } from "@/lib/env";
import type { VectorSearchResult } from "@openloomi/rag/vector-service";

export interface SQLiteInsightVectorInput {
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

export interface SQLiteInsightSearchInput {
  userId: string;
  queryEmbedding: number[];
  limit: number;
  threshold: number;
  botIds?: string[];
  includeArchived?: boolean;
}

function getMemoryVectorStoreBackend(): "chroma" | "sqlite-vec" {
  const backend = (
    process.env.INSIGHT_VECTOR_STORE_BACKEND ||
    process.env.MEMORY_VECTOR_STORE_BACKEND ||
    process.env.VECTOR_STORE_BACKEND ||
    "sqlite-vec"
  ).toLowerCase();
  return backend === "chroma" ? "chroma" : "sqlite-vec";
}

export function isInsightSQLiteVecEnabled(): boolean {
  return isTauriMode() && getMemoryVectorStoreBackend() === "sqlite-vec";
}

async function getInsightSQLiteVecStore() {
  const { getSQLiteVecStore } = await import("@openloomi/rag/sqlite-vec-store");
  return await getSQLiteVecStore(TAURI_DB_PATH, undefined, {
    collectionName:
      process.env.SQLITE_VEC_INSIGHTS_COLLECTION || "openloomi_insights",
  });
}

export async function upsertInsightsToSQLiteVec(
  insights: SQLiteInsightVectorInput[],
): Promise<number> {
  if (!isInsightSQLiteVecEnabled() || insights.length === 0) {
    return 0;
  }

  const store = await getInsightSQLiteVecStore();
  await store.addChunks(
    insights.map((item) => ({
      id: item.insightId,
      documentId: item.insightId,
      content: item.content,
      embedding: item.embedding,
      metadata: {
        userId: item.userId,
        botId: item.botId,
        contentHash: item.contentHash,
        embeddingModel: item.embeddingModel,
        embeddingDimensions: item.embeddingDimensions,
        title: toStringValue(item.title),
        description: toStringValue(item.description),
        taskLabel: toStringValue(item.taskLabel),
        importance: toStringValue(item.importance),
        urgency: toStringValue(item.urgency),
        platform: toNullableString(item.platform),
        account: toNullableString(item.account),
        time: normalizeTime(item.time),
        archived: toBooleanValue(item.archived),
      },
    })),
  );
  return insights.length;
}

export async function searchInsightsWithSQLiteVec(
  input: SQLiteInsightSearchInput,
): Promise<VectorSearchResult[]> {
  const store = await getInsightSQLiteVecStore();
  // Bot/archive filters are applied after ANN retrieval because the shared
  // backend contract currently exposes only common memory filters.
  const overfetchLimit = Math.max(input.limit * 8, input.limit);
  const results = await store.similaritySearchWithOptions(
    input.queryEmbedding,
    {
      limit: overfetchLimit,
      filter: { userId: input.userId },
    },
  );

  return results
    .filter((result) => result.score >= input.threshold)
    .filter((result) => {
      const metadata = result.metadata ?? {};
      if (
        input.botIds?.length &&
        !input.botIds.includes(String(metadata.botId ?? ""))
      ) {
        return false;
      }
      return input.includeArchived || metadata.archived !== true;
    })
    .slice(0, input.limit);
}

function normalizeTime(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toBooleanValue(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}
