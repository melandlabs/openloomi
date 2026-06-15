import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/queries";
import { bot, insight, insightEmbeddings } from "@/lib/db/schema";
import { normalizeInsight } from "@/lib/db/serialization";
import { buildInsightEmbeddingDocument } from "@/lib/insights/embedding";
import {
  getInsightEmbeddingModelName,
  syncInsightEmbeddingsToChroma,
  syncInsightEmbeddingsToSQLiteVec,
  upsertInsightEmbeddingsForCandidates,
  type InsightEmbeddingCandidate,
  type UpsertInsightEmbeddingsResult,
} from "@/lib/insights/embedding-service";

const DEFAULT_DREAM_LIMIT = 100;

export type InsightEmbeddingDreamReason =
  | "missing"
  | "model_changed"
  | "content_changed";

export interface RunInsightEmbeddingDreamInput {
  userId?: string;
  botId?: string;
  limit?: number;
  scanLimit?: number;
  includeArchived?: boolean;
  dryRun?: boolean;
  authToken?: string;
}

export interface RunInsightEmbeddingDreamResult {
  scanned: number;
  selected: number;
  embedded: number;
  dryRun: boolean;
  reasons: Record<InsightEmbeddingDreamReason, number>;
  chromaSynced?: number;
  sqliteVecSynced?: number;
  upsert?: UpsertInsightEmbeddingsResult;
}

export function resolveInsightEmbeddingDreamReason(input: {
  contentHash: string;
  embeddingModel: string;
  existingContentHash?: string | null;
  existingEmbeddingModel?: string | null;
}): InsightEmbeddingDreamReason | null {
  if (!input.existingContentHash || !input.existingEmbeddingModel) {
    return "missing";
  }
  if (input.existingEmbeddingModel !== input.embeddingModel) {
    return "model_changed";
  }
  if (input.existingContentHash !== input.contentHash) {
    return "content_changed";
  }
  return null;
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1_000, Math.max(1, Math.floor(value ?? fallback)));
}

async function loadInsightDreamRows(input: {
  userId?: string;
  botId?: string;
  includeArchived: boolean;
  scanLimit: number;
}) {
  const whereClauses = [isNull(insight.pendingDeletionAt)];
  if (input.userId) {
    whereClauses.push(eq(bot.userId, input.userId));
  }
  if (input.botId) {
    whereClauses.push(eq(insight.botId, input.botId));
  }
  if (!input.includeArchived) {
    whereClauses.push(eq(insight.isArchived, false));
  }

  return await db
    .select({
      insight,
      userId: bot.userId,
      existingContentHash: insightEmbeddings.contentHash,
      existingEmbeddingModel: insightEmbeddings.embeddingModel,
    })
    .from(insight)
    .innerJoin(bot, eq(insight.botId, bot.id))
    .leftJoin(insightEmbeddings, eq(insightEmbeddings.insightId, insight.id))
    .where(and(...whereClauses))
    .orderBy(desc(insight.updatedAt))
    .limit(input.scanLimit);
}

export async function runInsightEmbeddingDream(
  input: RunInsightEmbeddingDreamInput = {},
): Promise<RunInsightEmbeddingDreamResult> {
  const limit = clampLimit(input.limit, DEFAULT_DREAM_LIMIT);
  const scanLimit = clampLimit(input.scanLimit, Math.max(limit * 5, limit));
  const includeArchived = input.includeArchived ?? true;
  const rows = await loadInsightDreamRows({
    userId: input.userId,
    botId: input.botId,
    includeArchived,
    scanLimit,
  });

  const reasons: Record<InsightEmbeddingDreamReason, number> = {
    missing: 0,
    model_changed: 0,
    content_changed: 0,
  };
  const candidates: InsightEmbeddingCandidate[] = [];
  const embeddingModelsByUserId = new Map<string, string>();

  for (const row of rows) {
    const normalizedInsight = normalizeInsight({ ...(row as any).insight });
    const document = buildInsightEmbeddingDocument(normalizedInsight as any);
    if (document.content.length === 0) {
      continue;
    }

    const userId = (row as any).userId as string | undefined;
    const modelCacheKey = userId ?? "__system__";
    let embeddingModel = embeddingModelsByUserId.get(modelCacheKey);
    if (!embeddingModel) {
      embeddingModel = await getInsightEmbeddingModelName(userId);
      embeddingModelsByUserId.set(modelCacheKey, embeddingModel);
    }

    const reason = resolveInsightEmbeddingDreamReason({
      contentHash: document.contentHash,
      embeddingModel,
      existingContentHash: (row as any).existingContentHash,
      existingEmbeddingModel: (row as any).existingEmbeddingModel,
    });
    if (!reason) {
      continue;
    }

    reasons[reason] += 1;
    candidates.push({
      insightId: normalizedInsight.id,
      botId: normalizedInsight.botId,
      userId,
      payload: normalizedInsight as any,
    });

    if (candidates.length >= limit) {
      break;
    }
  }

  if (input.dryRun) {
    return {
      scanned: rows.length,
      selected: candidates.length,
      embedded: 0,
      dryRun: Boolean(input.dryRun),
      reasons,
    };
  }

  if (candidates.length === 0) {
    const [chromaSync, sqliteVecSync] = await Promise.all([
      syncInsightEmbeddingsToChroma({
        db,
        userId: input.userId,
        botId: input.botId,
        limit: scanLimit,
        includeArchived,
      }),
      syncInsightEmbeddingsToSQLiteVec({
        db,
        userId: input.userId,
        botId: input.botId,
        limit: scanLimit,
        includeArchived,
      }),
    ]);
    return {
      scanned: rows.length,
      selected: candidates.length,
      embedded: 0,
      dryRun: false,
      reasons,
      chromaSynced: chromaSync.synced,
      sqliteVecSynced: sqliteVecSync.synced,
    };
  }

  const upsert = await upsertInsightEmbeddingsForCandidates({
    db,
    candidates,
    options: {
      authToken: input.authToken,
    },
  });
  const [chromaSync, sqliteVecSync] = await Promise.all([
    syncInsightEmbeddingsToChroma({
      db,
      userId: input.userId,
      botId: input.botId,
      limit: scanLimit,
      includeArchived,
    }),
    syncInsightEmbeddingsToSQLiteVec({
      db,
      userId: input.userId,
      botId: input.botId,
      limit: scanLimit,
      includeArchived,
    }),
  ]);

  return {
    scanned: rows.length,
    selected: candidates.length,
    embedded: upsert.embedded,
    dryRun: false,
    reasons,
    chromaSynced: chromaSync.synced,
    sqliteVecSynced: sqliteVecSync.synced,
    upsert,
  };
}
