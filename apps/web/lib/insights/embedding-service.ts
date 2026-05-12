import { inArray, sql } from "drizzle-orm";
import { bot, insightEmbeddings } from "@/lib/db/schema";
import type { DrizzleDB } from "@/lib/db/types";
import {
  buildInsightEmbeddingDocument,
  type InsightEmbeddingTextInput,
} from "@/lib/insights/embedding";

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

export function hasInsightEmbeddingProviderConfig(authToken?: string): boolean {
  return Boolean(
    authToken ||
      process.env.OPENAI_EMBEDDINGS_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      process.env.LLM_API_KEY,
  );
}

export function getInsightEmbeddingModelName(): string {
  return process.env.LLM_EMBEDDING_MODEL || "text-embedding-3-small";
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

  if (!hasInsightEmbeddingProviderConfig(options.authToken)) {
    console.warn(
      "[InsightEmbedding] Skipping insight embedding generation: no embedding provider API key configured",
    );
    return {
      ...result,
      skippedNoProvider: true,
    };
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

    const modelName = getInsightEmbeddingModelName();
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
          documents.map((document) => document.insightId),
        ),
      );

    const existingByInsightId = new Map<
      string,
      { contentHash: string; embeddingModel: string }
    >(
      existingRows.map((row: any) => [row.insightId, row]),
    );
    const changedDocuments = documents.filter((document) => {
      const existing = existingByInsightId.get(document.insightId);
      return (
        !existing ||
        existing.contentHash !== document.contentHash ||
        existing.embeddingModel !== modelName
      );
    });

    result.changed = changedDocuments.length;
    result.skippedUnchanged = documents.length - changedDocuments.length;

    if (changedDocuments.length === 0) {
      return result;
    }

    const { UniversalEmbeddings } = await import(
      "@alloomi/rag/universal-embeddings"
    );
    const embeddings = new UniversalEmbeddings(options.authToken);
    const embeddingVectors = await embeddings.embedDocuments(
      changedDocuments.map((document) => document.content),
    );

    if (embeddingVectors.length !== changedDocuments.length) {
      throw new Error(
        `Embedding result count mismatch: expected ${changedDocuments.length}, got ${embeddingVectors.length}`,
      );
    }

    const now = new Date();
    const rows = changedDocuments.map((document, index) => {
      const embedding = embeddingVectors[index];
      return {
        insightId: document.insightId,
        userId: document.userId,
        botId: document.botId,
        content: document.content,
        contentHash: document.contentHash,
        embedding: `[${embedding.join(",")}]`,
        embeddingModel: modelName,
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
