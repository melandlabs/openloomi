import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { bot, insight, insightEmbeddings } from "@/lib/db/schema";
import type { DrizzleDB } from "@/lib/db/types";
import {
  buildInsightEmbeddingDocument,
  type InsightEmbeddingTextInput,
} from "@/lib/insights/embedding";
import {
  isInsightChromaEnabled,
  type ChromaInsightVectorInput,
  upsertInsightsToChroma,
} from "@/lib/memory/chroma-memory-index";
import {
  isInsightSQLiteVecEnabled,
  upsertInsightsToSQLiteVec,
} from "@/lib/memory/sqlite-vector-index";
import {
  createUserEmbeddingProvider,
  getUserEmbeddingModelName,
  hasUserEmbeddingProviderConfig,
} from "@/lib/ai/user-embedding-settings";

export type InsightEmbeddingCandidate = {
  insightId: string;
  botId: string;
  userId?: string;
  payload: InsightEmbeddingTextInput;
};

export interface UpsertInsightEmbeddingsOptions {
  authToken?: string;
  throwOnError?: boolean;
}

export interface UpsertInsightEmbeddingsResult {
  requested: number;
  prepared: number;
  changed: number;
  embedded: number;
  skippedMissingUser: number;
  skippedEmptyContent: number;
  skippedUnchanged: number;
  skippedNoProvider: boolean;
  failed: boolean;
  error?: string;
}

export interface SyncInsightEmbeddingsToChromaResult {
  scanned: number;
  synced: number;
}

export interface SyncInsightEmbeddingsToSQLiteVecResult {
  scanned: number;
  synced: number;
}

function emptyResult(requested: number): UpsertInsightEmbeddingsResult {
  return {
    requested,
    prepared: 0,
    changed: 0,
    embedded: 0,
    skippedMissingUser: 0,
    skippedEmptyContent: 0,
    skippedUnchanged: 0,
    skippedNoProvider: false,
    failed: false,
  };
}

export function hasInsightEmbeddingProviderConfig(
  authToken?: string,
  userId?: string,
): Promise<boolean> {
  return hasUserEmbeddingProviderConfig({ userId, authToken });
}

export function getInsightEmbeddingModelName(userId?: string): Promise<string> {
  return getUserEmbeddingModelName(userId);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseEmbeddingVector(value: string): number[] | null {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return null;
    }
    const vector = parsed.map((item) => Number(item));
    return vector.every((item) => Number.isFinite(item)) ? vector : null;
  } catch {
    return null;
  }
}

export async function syncInsightEmbeddingsToChroma({
  db,
  userId,
  botId,
  limit = 200,
  includeArchived = false,
}: {
  db: DrizzleDB;
  userId?: string;
  botId?: string;
  limit?: number;
  includeArchived?: boolean;
}): Promise<SyncInsightEmbeddingsToChromaResult> {
  if (!isInsightChromaEnabled()) {
    return { scanned: 0, synced: 0 };
  }

  const whereClauses = [isNull(insight.pendingDeletionAt)];
  if (userId) {
    whereClauses.push(eq(insightEmbeddings.userId, userId));
  }
  if (botId) {
    whereClauses.push(eq(insightEmbeddings.botId, botId));
  }
  if (!includeArchived) {
    whereClauses.push(eq(insight.isArchived, false));
  }

  const rows = await db
    .select({
      insightId: insightEmbeddings.insightId,
      userId: insightEmbeddings.userId,
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
      archived: insight.isArchived,
    })
    .from(insightEmbeddings)
    .innerJoin(insight, eq(insight.id, insightEmbeddings.insightId))
    .where(and(...whereClauses))
    .orderBy(desc(insightEmbeddings.updatedAt))
    .limit(Math.min(1_000, Math.max(1, Math.floor(limit))));

  const synced = await upsertInsightsToChroma(
    rows
      .map((row: any) => ({
        ...row,
        embedding: parseEmbeddingVector(row.embedding),
      }))
      .filter(
        (row: any): row is ChromaInsightVectorInput =>
          Array.isArray(row.embedding) && row.embedding.length > 0,
      ),
  );

  return { scanned: rows.length, synced };
}

export async function syncInsightEmbeddingsToSQLiteVec({
  db,
  userId,
  botId,
  limit = 200,
  includeArchived = false,
}: {
  db: DrizzleDB;
  userId?: string;
  botId?: string;
  limit?: number;
  includeArchived?: boolean;
}): Promise<SyncInsightEmbeddingsToSQLiteVecResult> {
  if (!isInsightSQLiteVecEnabled()) {
    return { scanned: 0, synced: 0 };
  }

  const whereClauses = [isNull(insight.pendingDeletionAt)];
  if (userId) {
    whereClauses.push(eq(insightEmbeddings.userId, userId));
  }
  if (botId) {
    whereClauses.push(eq(insightEmbeddings.botId, botId));
  }
  if (!includeArchived) {
    whereClauses.push(eq(insight.isArchived, false));
  }

  const rows = await db
    .select({
      insightId: insightEmbeddings.insightId,
      userId: insightEmbeddings.userId,
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
      archived: insight.isArchived,
    })
    .from(insightEmbeddings)
    .innerJoin(insight, eq(insight.id, insightEmbeddings.insightId))
    .where(and(...whereClauses))
    .orderBy(desc(insightEmbeddings.updatedAt))
    .limit(Math.min(1_000, Math.max(1, Math.floor(limit))));

  const synced = await upsertInsightsToSQLiteVec(
    rows
      .map((row: any) => ({
        ...row,
        embedding: parseEmbeddingVector(row.embedding),
      }))
      .filter(
        (
          row: any,
        ): row is Parameters<typeof upsertInsightsToSQLiteVec>[0][number] =>
          Array.isArray(row.embedding) && row.embedding.length > 0,
      ),
  );

  return { scanned: rows.length, synced };
}

export async function upsertInsightEmbeddingsForCandidates({
  db,
  candidates,
  options = {},
}: {
  db: DrizzleDB;
  candidates: InsightEmbeddingCandidate[];
  options?: UpsertInsightEmbeddingsOptions;
}): Promise<UpsertInsightEmbeddingsResult> {
  const result = emptyResult(candidates.length);
  if (candidates.length === 0) {
    return result;
  }

  try {
    const candidatesWithoutUser = candidates.filter(
      (candidate) => !candidate.userId,
    );
    let botUserIds = new Map<string, string>();
    if (candidatesWithoutUser.length > 0) {
      const botIds = Array.from(
        new Set(candidatesWithoutUser.map((candidate) => candidate.botId)),
      );
      const botRows = await db
        .select({ id: bot.id, userId: bot.userId })
        .from(bot)
        .where(inArray(bot.id, botIds));
      botUserIds = new Map<string, string>(
        botRows.map((row: any) => [row.id, row.userId]),
      );
    }

    const documents = candidates
      .map((candidate) => {
        const userId = candidate.userId ?? botUserIds.get(candidate.botId);
        if (!userId) {
          result.skippedMissingUser += 1;
          return null;
        }
        const document = buildInsightEmbeddingDocument(candidate.payload);
        if (document.content.length === 0) {
          result.skippedEmptyContent += 1;
          return null;
        }
        return {
          ...candidate,
          userId,
          content: document.content,
          contentHash: document.contentHash,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    result.prepared = documents.length;
    if (documents.length === 0) {
      return result;
    }

    const modelByUserId = new Map<string, string>();
    for (const document of documents) {
      if (!modelByUserId.has(document.userId)) {
        modelByUserId.set(
          document.userId,
          await getInsightEmbeddingModelName(document.userId),
        );
      }
    }
    const documentsWithModel = documents.map((document) => {
      const modelName = modelByUserId.get(document.userId);
      if (!modelName) {
        throw new Error(
          `Unable to resolve embedding model for user ${document.userId}`,
        );
      }
      return { ...document, modelName };
    });

    const existingRows = await db
      .select({
        insightId: insightEmbeddings.insightId,
        contentHash: insightEmbeddings.contentHash,
        embeddingModel: insightEmbeddings.embeddingModel,
      })
      .from(insightEmbeddings)
      .where(
        inArray(
          insightEmbeddings.insightId,
          documentsWithModel.map((document) => document.insightId),
        ),
      );

    const existingByInsightId = new Map<
      string,
      { contentHash: string; embeddingModel: string }
    >(existingRows.map((row: any) => [row.insightId, row]));
    const changedDocuments = documentsWithModel.filter((document) => {
      const existing = existingByInsightId.get(document.insightId);
      return (
        !existing ||
        existing.contentHash !== document.contentHash ||
        existing.embeddingModel !== document.modelName
      );
    });

    result.changed = changedDocuments.length;
    result.skippedUnchanged =
      documentsWithModel.length - changedDocuments.length;

    if (changedDocuments.length === 0) {
      return result;
    }

    const documentsByUserId = new Map<string, typeof changedDocuments>();
    for (const document of changedDocuments) {
      const group = documentsByUserId.get(document.userId) ?? [];
      group.push(document);
      documentsByUserId.set(document.userId, group);
    }

    const embeddedDocuments: Array<{
      document: (typeof changedDocuments)[number];
      embedding: number[];
    }> = [];
    for (const [userId, userDocuments] of documentsByUserId) {
      const hasProvider = await hasInsightEmbeddingProviderConfig(
        options.authToken,
        userId,
      );
      if (!hasProvider) {
        result.skippedNoProvider = true;
        console.warn(
          "[InsightEmbedding] Skipping user without an embedding provider",
          { userId, count: userDocuments.length },
        );
        continue;
      }

      const embeddings = await createUserEmbeddingProvider({
        userId,
        authToken: options.authToken,
      });
      const vectors = await embeddings.embedDocuments(
        userDocuments.map((document) => document.content),
      );
      if (vectors.length !== userDocuments.length) {
        throw new Error(
          `Embedding result count mismatch: expected ${userDocuments.length}, got ${vectors.length}`,
        );
      }
      userDocuments.forEach((document, index) => {
        embeddedDocuments.push({ document, embedding: vectors[index] });
      });
    }

    if (embeddedDocuments.length === 0) {
      return result;
    }

    const now = new Date();
    const rows = embeddedDocuments.map(({ document, embedding }) => {
      return {
        insightId: document.insightId,
        userId: document.userId,
        botId: document.botId,
        content: document.content,
        contentHash: document.contentHash,
        embedding: `[${embedding.join(",")}]`,
        embeddingModel: document.modelName,
        embeddingDimensions: embedding.length,
        createdAt: now,
        updatedAt: now,
      };
    });

    await db
      .insert(insightEmbeddings)
      .values(rows)
      .onConflictDoUpdate({
        target: insightEmbeddings.insightId,
        set: {
          userId: sql`excluded.user_id`,
          botId: sql`excluded.bot_id`,
          content: sql`excluded.content`,
          contentHash: sql`excluded.content_hash`,
          embedding: sql`excluded.embedding`,
          embeddingModel: sql`excluded.embedding_model`,
          embeddingDimensions: sql`excluded.embedding_dimensions`,
          updatedAt: now,
        },
      });

    try {
      await upsertInsightsToChroma(
        embeddedDocuments.map(({ document, embedding }) => {
          return {
            insightId: document.insightId,
            userId: document.userId,
            botId: document.botId,
            content: document.content,
            contentHash: document.contentHash,
            embedding,
            embeddingModel: document.modelName,
            embeddingDimensions: embedding.length,
            title: document.payload.title,
            description: document.payload.description,
            taskLabel: document.payload.taskLabel,
            importance: document.payload.importance,
            urgency: document.payload.urgency,
            platform: document.payload.platform,
            account: document.payload.account,
            time: document.payload.time,
            archived: (document.payload as any).isArchived,
          };
        }),
      );
    } catch (error) {
      console.warn("[InsightEmbedding] Failed to sync Chroma index:", error);
    }

    try {
      await upsertInsightsToSQLiteVec(
        embeddedDocuments.map(({ document, embedding }) => {
          return {
            insightId: document.insightId,
            userId: document.userId,
            botId: document.botId,
            content: document.content,
            contentHash: document.contentHash,
            embedding,
            embeddingModel: document.modelName,
            embeddingDimensions: embedding.length,
            title: document.payload.title,
            description: document.payload.description,
            taskLabel: document.payload.taskLabel,
            importance: document.payload.importance,
            urgency: document.payload.urgency,
            platform: document.payload.platform,
            account: document.payload.account,
            time: document.payload.time,
            archived: (document.payload as any).isArchived,
          };
        }),
      );
    } catch (error) {
      console.warn(
        "[InsightEmbedding] Failed to sync sqlite-vec index:",
        error,
      );
    }

    result.embedded = rows.length;
    return result;
  } catch (error) {
    const message = toErrorMessage(error);
    console.warn(
      "[InsightEmbedding] Failed to generate or persist insight embeddings:",
      error,
    );
    if (options.throwOnError) {
      throw error;
    }
    return {
      ...result,
      failed: true,
      error: message,
    };
  }
}
