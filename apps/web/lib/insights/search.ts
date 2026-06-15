import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, insight, insightEmbeddings } from "@/lib/db";
import { isTauriMode } from "@/lib/env/constants";
import {
  isInsightChromaEnabled,
  searchInsightsWithChroma,
} from "@/lib/memory/chroma-memory-index";
import {
  isInsightSQLiteVecEnabled,
  searchInsightsWithSQLiteVec,
} from "@/lib/memory/sqlite-vector-index";
import {
  createUserEmbeddingProvider,
  hasUserEmbeddingProviderConfig,
} from "@/lib/ai/user-embedding-settings";

const DEFAULT_LIMIT = 10;
const DEFAULT_THRESHOLD = 0.7;
const DEFAULT_SQLITE_CANDIDATE_LIMIT = 5_000;

export interface InsightSemanticSearchInput {
  userId: string;
  query: string;
  limit?: number;
  threshold?: number;
  botIds?: string[];
  includeArchived?: boolean;
  authToken?: string;
}

export interface InsightSemanticSearchResult {
  type: "insight";
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

type InsightEmbeddingRow = {
  insightId: string;
  botId: string;
  content: string;
  contentHash: string;
  embedding: string;
  embeddingModel: string;
  embeddingDimensions: number;
  title: string;
  description: string;
  taskLabel: string;
  importance: string;
  urgency: string;
  platform: string | null;
  account: string | null;
  time: Date | null;
};

type PgVectorInsightSearchRow = Omit<InsightEmbeddingRow, "embedding"> & {
  similarity: number;
};

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(50, Math.max(1, Math.floor(limit ?? DEFAULT_LIMIT)));
}

function clampThreshold(threshold: number | undefined): number {
  if (!Number.isFinite(threshold)) {
    return DEFAULT_THRESHOLD;
  }
  return Math.min(1, Math.max(-1, threshold ?? DEFAULT_THRESHOLD));
}

async function embedQuery(
  userId: string,
  query: string,
  authToken?: string,
): Promise<number[]> {
  if (!(await hasUserEmbeddingProviderConfig({ userId, authToken }))) {
    throw new Error("Embedding provider API key is not configured");
  }

  const embeddings = await createUserEmbeddingProvider({ userId, authToken });
  return embeddings.embedQuery(query);
}

export function parseStoredEmbedding(value: string): number[] | null {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return null;
    }
    if (
      !parsed.every((item) => typeof item === "number" && Number.isFinite(item))
    ) {
      return null;
    }
    const vector = parsed.map((item) => Number(item));
    return vector.every((item) => Number.isFinite(item)) ? vector : null;
  } catch {
    return null;
  }
}

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) {
    return Number.NaN;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i += 1) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) {
    return Number.NaN;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function toSearchResult(
  row: InsightEmbeddingRow,
  similarity: number,
): InsightSemanticSearchResult {
  return {
    type: "insight",
    id: row.insightId,
    content: row.content,
    similarity,
    metadata: {
      botId: row.botId,
      title: row.title,
      description: row.description,
      taskLabel: row.taskLabel,
      importance: row.importance,
      urgency: row.urgency,
      platform: row.platform,
      account: row.account,
      time: row.time,
      embeddingModel: row.embeddingModel,
      embeddingDimensions: row.embeddingDimensions,
      contentHash: row.contentHash,
    },
  };
}

function buildBaseWhere(input: {
  userId: string;
  botIds?: string[];
  includeArchived?: boolean;
}) {
  const conditions = [eq(insightEmbeddings.userId, input.userId)];
  if (!input.includeArchived) {
    conditions.push(eq(insight.isArchived, false));
  }
  if (input.botIds && input.botIds.length > 0) {
    conditions.push(inArray(insightEmbeddings.botId, input.botIds));
  }
  return and(...conditions);
}

async function searchInsightEmbeddingsWithPgVector(input: {
  userId: string;
  queryEmbedding: number[];
  limit: number;
  threshold: number;
  botIds?: string[];
  includeArchived?: boolean;
}): Promise<InsightSemanticSearchResult[]> {
  const embeddingString = `[${input.queryEmbedding.join(",")}]`;
  const similaritySql = sql<number>`1 - (${insightEmbeddings.embedding}::vector <=> ${embeddingString}::vector)`;
  const distanceSql = sql`${insightEmbeddings.embedding}::vector <=> ${embeddingString}::vector`;

  const rows = await db
    .select({
      insightId: insightEmbeddings.insightId,
      botId: insightEmbeddings.botId,
      content: insightEmbeddings.content,
      contentHash: insightEmbeddings.contentHash,
      embeddingModel: insightEmbeddings.embeddingModel,
      embeddingDimensions: insightEmbeddings.embeddingDimensions,
      title: insight.title,
      description: insight.description,
      taskLabel: insight.taskLabel,
      importance: insight.importance,
      urgency: insight.urgency,
      platform: insight.platform,
      account: insight.account,
      time: insight.time,
      similarity: similaritySql,
    })
    .from(insightEmbeddings)
    .innerJoin(insight, eq(insight.id, insightEmbeddings.insightId))
    .where(
      and(buildBaseWhere(input), sql`${distanceSql} < ${1 - input.threshold}`),
    )
    .orderBy(distanceSql)
    .limit(input.limit);

  return (rows as PgVectorInsightSearchRow[]).map((row) =>
    toSearchResult(
      {
        insightId: row.insightId,
        botId: row.botId,
        content: row.content,
        contentHash: row.contentHash,
        embedding: "",
        embeddingModel: row.embeddingModel,
        embeddingDimensions: row.embeddingDimensions,
        title: row.title,
        description: row.description,
        taskLabel: row.taskLabel,
        importance: row.importance,
        urgency: row.urgency,
        platform: row.platform,
        account: row.account,
        time: row.time,
      },
      Number(row.similarity),
    ),
  );
}

async function searchInsightEmbeddingsWithSqlite(input: {
  userId: string;
  queryEmbedding: number[];
  limit: number;
  threshold: number;
  botIds?: string[];
  includeArchived?: boolean;
}): Promise<InsightSemanticSearchResult[]> {
  const rows = (await db
    .select({
      insightId: insightEmbeddings.insightId,
      botId: insightEmbeddings.botId,
      content: insightEmbeddings.content,
      contentHash: insightEmbeddings.contentHash,
      embedding: insightEmbeddings.embedding,
      embeddingModel: insightEmbeddings.embeddingModel,
      embeddingDimensions: insightEmbeddings.embeddingDimensions,
      title: insight.title,
      description: insight.description,
      taskLabel: insight.taskLabel,
      importance: insight.importance,
      urgency: insight.urgency,
      platform: insight.platform,
      account: insight.account,
      time: insight.time,
    })
    .from(insightEmbeddings)
    .innerJoin(insight, eq(insight.id, insightEmbeddings.insightId))
    .where(buildBaseWhere(input))
    .orderBy(desc(insightEmbeddings.updatedAt))
    .limit(DEFAULT_SQLITE_CANDIDATE_LIMIT)) as InsightEmbeddingRow[];

  return rows
    .map((row) => {
      const vector = parseStoredEmbedding(row.embedding);
      if (!vector) {
        return null;
      }
      const similarity = cosineSimilarity(input.queryEmbedding, vector);
      if (!Number.isFinite(similarity) || similarity < input.threshold) {
        return null;
      }
      return toSearchResult(row, similarity);
    })
    .filter((result): result is InsightSemanticSearchResult => result !== null)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, input.limit);
}

export async function searchInsightsSemantically(
  input: InsightSemanticSearchInput,
): Promise<InsightSemanticSearchResult[]> {
  const query = input.query.trim();
  if (!query) {
    return [];
  }

  const limit = clampLimit(input.limit);
  const threshold = clampThreshold(input.threshold);
  const queryEmbedding = await embedQuery(input.userId, query, input.authToken);

  if (isInsightChromaEnabled()) {
    try {
      const results = await searchInsightsWithChroma({
        userId: input.userId,
        queryEmbedding,
        limit,
        threshold,
        botIds: input.botIds,
        includeArchived: input.includeArchived,
      });

      const mappedResults = results.map((result) => ({
        type: "insight" as const,
        ...result,
      }));
      console.log("[InsightSearch] Semantic search completed", {
        backend: "chroma",
        dimensions: queryEmbedding.length,
        count: mappedResults.length,
      });
      return mappedResults;
    } catch (error) {
      console.warn(
        "[InsightSearch] Chroma insight search failed; falling back to database search:",
        error,
      );
    }
  }

  if (isTauriMode()) {
    if (isInsightSQLiteVecEnabled()) {
      try {
        const results = await searchInsightsWithSQLiteVec({
          userId: input.userId,
          queryEmbedding,
          limit,
          threshold,
          botIds: input.botIds,
          includeArchived: input.includeArchived,
        });
        const mappedResults = results.map((result) => {
          const metadata = result.metadata ?? {};
          return {
            type: "insight" as const,
            id: result.id,
            content: result.content,
            similarity: result.score,
            metadata: {
              botId: String(metadata.botId ?? ""),
              title: String(metadata.title ?? ""),
              description: String(metadata.description ?? ""),
              taskLabel: String(metadata.taskLabel ?? ""),
              importance: String(metadata.importance ?? ""),
              urgency: String(metadata.urgency ?? ""),
              platform:
                typeof metadata.platform === "string"
                  ? metadata.platform
                  : null,
              account:
                typeof metadata.account === "string" ? metadata.account : null,
              time:
                typeof metadata.time === "number"
                  ? new Date(metadata.time)
                  : null,
              embeddingModel: String(metadata.embeddingModel ?? ""),
              embeddingDimensions: Number(
                metadata.embeddingDimensions ?? queryEmbedding.length,
              ),
              contentHash: String(metadata.contentHash ?? ""),
            },
          };
        });
        console.log("[InsightSearch] Semantic search completed", {
          backend: "sqlite-vec",
          dimensions: queryEmbedding.length,
          count: mappedResults.length,
        });
        return mappedResults;
      } catch (error) {
        console.warn(
          "[InsightSearch] sqlite-vec search failed; falling back to stored embeddings:",
          error,
        );
      }
    }

    const results = await searchInsightEmbeddingsWithSqlite({
      userId: input.userId,
      queryEmbedding,
      limit,
      threshold,
      botIds: input.botIds,
      includeArchived: input.includeArchived,
    });
    console.warn(
      "[InsightSearch] Semantic search used stored-embedding fallback",
      {
        backend: "stored-embedding-fallback",
        dimensions: queryEmbedding.length,
        count: results.length,
        sqliteVecEnabled: isInsightSQLiteVecEnabled(),
      },
    );
    return results;
  }

  const results = await searchInsightEmbeddingsWithPgVector({
    userId: input.userId,
    queryEmbedding,
    limit,
    threshold,
    botIds: input.botIds,
    includeArchived: input.includeArchived,
  });
  console.log("[InsightSearch] Semantic search completed", {
    backend: "pgvector",
    dimensions: queryEmbedding.length,
    count: results.length,
  });
  return results;
}
