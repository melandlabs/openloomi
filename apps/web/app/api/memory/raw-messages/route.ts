import { auth } from "@/app/(auth)/auth";
import {
  getSQLiteRawMessageManager,
  isSQLiteRawMessageStorageAvailable,
} from "@/lib/memory/sqlite-raw-message-store";
import { AppError } from "@openloomi/shared/errors";
import {
  queryMemoryWithFallback,
  runMemoryForgettingCycle,
} from "@openloomi/indexeddb/forgetting";
import type {
  MemorySummaryRecord,
  RawMessage,
  RawMessageQuery,
} from "@openloomi/indexeddb";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

function normalizeTimestampToMs(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }
  if ((value as number) < 1e11) {
    return Math.floor((value as number) * 1000);
  }
  return Math.floor(value as number);
}

function toRawSourceItem(message: RawMessage): RawMessage & {
  sourceType: "raw";
} {
  return {
    ...message,
    sourceType: "raw",
  };
}

function toSummarySourceItem(
  summary: MemorySummaryRecord,
): MemorySummaryRecord & {
  sourceType: "summary";
} {
  return {
    ...summary,
    sourceType: "summary",
  };
}

function scopedQuery(query: RawMessageQuery | undefined, userId: string) {
  return {
    ...(query ?? {}),
    userId,
  };
}

async function queryRawMessagesWithFallback(
  query: RawMessageQuery,
  userId: string,
) {
  const manager = await getSQLiteRawMessageManager();
  const pageSize = query.pageSize ?? query.limit ?? 50;
  const minRaw =
    query.minRawResultsWithoutFallback ?? query.pageSize ?? query.limit ?? 50;

  const result = await queryMemoryWithFallback(manager as any, {
    userId,
    keywords: query.keywords,
    startTime: normalizeTimestampToMs(query.startTime),
    endTime: normalizeTimestampToMs(query.endTime),
    limit: pageSize,
    pageSize,
    offset: query.offset,
    reverse: query.reverse ?? true,
    tiers: query.memoryStages,
    dimensions: {
      platform: query.platform,
      channel: query.channel,
      person: query.person,
      botId: query.botId,
    },
    minRawResultsWithoutFallback: minRaw,
  });

  return result.items
    .map((item) => {
      if (item.sourceType === "summary") {
        return toSummarySourceItem({
          summaryId: item.summary.summaryId,
          userId: item.summary.userId,
          summaryTier: item.summary.summaryTier,
          sourceTier: item.summary.sourceTier,
          startTimestamp: item.summary.startTimestamp,
          endTimestamp: item.summary.endTimestamp,
          messageCount: item.summary.messageCount,
          sourceRecordIds: item.summary.sourceRecordIds,
          keyPoints: item.summary.keyPoints,
          keywords: item.summary.keywords,
          keywordsText: item.summary.keywords.join(" "),
          summaryText: item.summary.summaryText,
          dimensions: item.summary.dimensions,
          qualityScore: item.summary.qualityScore,
          createdAt: item.summary.createdAt,
          updatedAt: item.summary.updatedAt,
        });
      }

      const rawMaybe = (
        item.record.metadata as Record<string, unknown> | undefined
      )?.__rawMessage;
      if (rawMaybe && typeof rawMaybe === "object") {
        return toRawSourceItem(rawMaybe as RawMessage);
      }

      return toRawSourceItem({
        messageId: item.record.id,
        platform:
          typeof item.record.dimensions?.platform === "string"
            ? String(item.record.dimensions.platform)
            : "unknown",
        botId:
          typeof item.record.dimensions?.botId === "string"
            ? String(item.record.dimensions.botId)
            : "unknown",
        userId: item.record.userId,
        channel:
          typeof item.record.dimensions?.channel === "string"
            ? String(item.record.dimensions.channel)
            : undefined,
        person:
          typeof item.record.dimensions?.person === "string"
            ? String(item.record.dimensions.person)
            : undefined,
        timestamp: Math.floor(item.record.timestamp / 1000),
        content: item.record.text ?? "",
        attachments: [],
        embedding: item.record.embedding,
        embeddingModel: item.record.embeddingModel,
        embeddingContentHash: item.record.embeddingContentHash,
        embeddingDimensions: item.record.embeddingDimensions,
        embeddingUpdatedAt: item.record.embeddingUpdatedAt,
        metadata:
          (item.record.metadata as Record<string, any> | undefined) ??
          undefined,
        createdAt: item.record.timestamp,
        memoryStage: item.record.tier,
        accessCount: item.record.accessCount,
        lastAccessAt: item.record.lastAccessAt,
        importanceScore: item.record.importanceScore,
        archivedAt: item.record.archivedAt,
        isPinned: item.record.isPinned,
      });
    })
    .slice(0, pageSize);
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:api").toResponse();
  }

  if (!isSQLiteRawMessageStorageAvailable()) {
    return Response.json({
      available: false,
      reason: "not_tauri",
    });
  }

  const manager = await getSQLiteRawMessageManager();
  return Response.json({
    available: true,
    stats: await manager.getStats(),
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:api").toResponse();
  }

  if (!isSQLiteRawMessageStorageAvailable()) {
    return Response.json(
      {
        success: false,
        reason: "not_tauri",
        message: "SQLite raw message storage is only available in Tauri mode.",
      },
      { status: 409 },
    );
  }

  try {
    const body = await request.json();
    const action = typeof body.action === "string" ? body.action : "";
    const userId = session.user.id;
    const manager = await getSQLiteRawMessageManager();

    switch (action) {
      case "store": {
        const messages = Array.isArray(body.messages) ? body.messages : [];
        if (messages.length === 0) {
          return new AppError(
            "bad_request:api",
            "messages array is required and must not be empty",
          ).toResponse();
        }

        const now = Math.floor(Date.now() / 1000);
        const normalized = messages.map((message: Partial<RawMessage>) => ({
          ...message,
          userId,
          createdAt: message.createdAt ?? now,
        })) as RawMessage[];
        const ids = await manager.storeMessages(normalized);
        return Response.json({
          success: true,
          stored: ids.length,
          errors: 0,
        });
      }

      case "query": {
        const query = scopedQuery(body.query, userId);
        if (query.includeSummaryFallback) {
          return Response.json({
            success: true,
            items: await queryRawMessagesWithFallback(query, userId),
          });
        }

        const messages = await manager.queryMessages(query);
        return Response.json({
          success: true,
          items: messages.map(toRawSourceItem),
        });
      }

      case "queryGrouped": {
        const grouped = await manager.queryMessagesGrouped(
          scopedQuery(body.query, userId),
        );
        return Response.json({ success: true, grouped });
      }

      case "stats": {
        return Response.json({
          success: true,
          stats: await manager.getStats(),
        });
      }

      case "clearOld": {
        const olderThan = Number(body.olderThan);
        if (!Number.isFinite(olderThan)) {
          return new AppError(
            "bad_request:api",
            "olderThan must be a finite timestamp",
          ).toResponse();
        }
        const deleted = await manager.deleteOldMessages(olderThan, userId);
        return Response.json({ success: true, deleted });
      }

      case "updateEmbeddings": {
        const updates = Array.isArray(body.updates) ? body.updates : [];
        const updated = await manager.updateMessageEmbeddings(updates, userId);
        return Response.json({ success: true, updated });
      }

      case "semanticSearch": {
        const queryEmbedding = Array.isArray(body.queryEmbedding)
          ? body.queryEmbedding
          : [];
        if (queryEmbedding.length === 0) {
          return Response.json({ success: true, items: [] });
        }

        const items =
          typeof (manager as any).searchMessagesSemantically === "function"
            ? await (manager as any).searchMessagesSemantically({
                ...(body.options ?? {}),
                userId,
                queryEmbedding,
              })
            : [];
        return Response.json({ success: true, items });
      }

      case "upsertSummaries": {
        const summaries = Array.isArray(body.summaries) ? body.summaries : [];
        await manager.upsertSummaries(
          summaries.map((summary: Partial<MemorySummaryRecord>) => ({
            ...summary,
            userId,
          })) as MemorySummaryRecord[],
        );
        return Response.json({ success: true, stored: summaries.length });
      }

      case "forgettingCycle": {
        const result = await runMemoryForgettingCycle(manager as any, userId, {
          dryRun: body.options?.dryRun === true,
          hardDeleteArchivedOlderThan:
            typeof body.options?.hardDeleteArchivedOlderThan === "number"
              ? body.options.hardDeleteArchivedOlderThan
              : undefined,
        });
        return Response.json({ success: true, result });
      }

      default:
        return new AppError(
          "bad_request:api",
          `Unsupported raw message action: ${action || "(missing)"}`,
        ).toResponse();
    }
  } catch (error) {
    console.error("[SQLite Raw Messages API] Error:", error);
    return new AppError(
      "bad_request:database",
      error instanceof Error ? error.message : String(error),
    ).toResponse();
  }
}
