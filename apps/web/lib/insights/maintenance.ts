import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/queries";
import { bot, insight, insightWeights } from "@/lib/db/schema";
import {
  deleteExpiredPendingDeletionInsights,
  runInsightCompaction,
  type RunInsightCompactionInput,
  type RunInsightCompactionResult,
} from "@/lib/insights/compaction";
import {
  getInsightCompactionPlatform,
  type InsightCompactionPlatform,
} from "@/lib/insights/compaction-profile";
import { refreshInsightAccessSummary } from "@/lib/insights/weight-adjustment";

export type WeeklyInsightMaintenanceInput = {
  platform?: InsightCompactionPlatform;
  userId?: string;
  botId?: string;
  olderThanDays?: number;
};

export type WeeklyInsightMaintenanceUserResult = {
  userId: string;
  compaction: RunInsightCompactionResult;
  deletedInsightIds: string[];
};

export type WeeklyInsightMaintenanceResult = {
  platform: InsightCompactionPlatform;
  processedUserCount: number;
  users: WeeklyInsightMaintenanceUserResult[];
};

export type DailyInsightAnalyticsMaintenanceInput = {
  userId?: string;
  botId?: string;
  now?: Date;
};

export type DailyInsightAnalyticsMaintenanceResult = {
  processedWeightCount: number;
  processedUserCount: number;
  users: string[];
};

// Weekly maintenance runs per user so compaction and cleanup stay scoped to one owner's insights at a time.
async function loadMaintenanceUserIds(input: WeeklyInsightMaintenanceInput) {
  if (input.userId) {
    return [input.userId];
  }

  const query = db
    .select({ userId: bot.userId })
    .from(bot)
    .groupBy(bot.userId)
    .orderBy(asc(bot.userId));

  const rows = input.botId
    ? await query.where(eq(bot.id, input.botId))
    : await query;

  return rows.map((row: { userId: string }) => row.userId);
}

export async function runWeeklyInsightMaintenance(
  input: WeeklyInsightMaintenanceInput = {},
): Promise<WeeklyInsightMaintenanceResult> {
  const platform = getInsightCompactionPlatform(input.platform);
  const userIds = await loadMaintenanceUserIds(input);
  const results: WeeklyInsightMaintenanceUserResult[] = [];

  for (const userId of userIds) {
    const compactionInput: RunInsightCompactionInput = {
      userId,
      botId: input.botId,
      olderThanDays: input.olderThanDays,
      triggerType: "scheduled",
      platform,
    };

    const compaction = await runInsightCompaction(compactionInput);
    // Cleanup runs after compaction so newly pending insights always get a full retention window.
    const deletedInsightIds = await deleteExpiredPendingDeletionInsights({
      userId,
      botId: input.botId,
      platform,
    });

    results.push({
      userId,
      compaction,
      deletedInsightIds,
    });
  }

  return {
    platform,
    processedUserCount: results.length,
    users: results,
  };
}

async function loadInsightWeightsForAnalyticsMaintenance(
  input: DailyInsightAnalyticsMaintenanceInput,
) {
  const query = db
    .select({
      insightId: insightWeights.insightId,
      userId: insightWeights.userId,
    })
    .from(insightWeights)
    .innerJoin(insight, eq(insightWeights.insightId, insight.id))
    .innerJoin(bot, eq(insight.botId, bot.id));

  if (input.userId && input.botId) {
    return query.where(
      and(
        eq(insightWeights.userId, input.userId),
        eq(insight.botId, input.botId),
      ),
    );
  }

  if (input.userId) {
    return query.where(eq(insightWeights.userId, input.userId));
  }

  if (input.botId) {
    return query.where(eq(insight.botId, input.botId));
  }

  return query;
}

export async function runDailyInsightAnalyticsMaintenance(
  input: DailyInsightAnalyticsMaintenanceInput = {},
): Promise<DailyInsightAnalyticsMaintenanceResult> {
  const now = input.now ?? new Date();
  const rows = await loadInsightWeightsForAnalyticsMaintenance(input);
  const userIds = new Set<string>();

  for (const row of rows) {
    if (!row.insightId || !row.userId) continue;

    userIds.add(row.userId);
    await refreshInsightAccessSummary(row.insightId, row.userId, now, db);
  }

  return {
    processedWeightCount: rows.length,
    processedUserCount: userIds.size,
    users: Array.from(userIds).sort(),
  };
}
