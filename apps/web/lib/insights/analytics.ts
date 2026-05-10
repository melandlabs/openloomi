import { db as defaultDb } from "@/lib/db/queries";
import {
  chat,
  chatInsights,
  bot,
  insight,
  insightViewHistory,
  insightWeights,
} from "@/lib/db/schema";
import type { DrizzleDB } from "@/lib/db/types";
import { and, eq, gte, inArray, isNull } from "drizzle-orm";

export type InsightAccessTrend = "rising" | "falling" | "stable";
export type InsightOrganizationAction = "keep" | "archive" | "delete";

export type InsightAnalyticsInsight = {
  id: string;
  title: string;
  description: string;
  taskLabel: string;
  platform: string | null;
  account: string | null;
  importance: string;
  urgency: string;
  isFavorited: boolean;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
  time: Date;
  accessCountTotal: number;
  accessCount7d: number;
  accessCount30d: number;
  lastAccessedAt: Date | null;
  trend: InsightAccessTrend;
  recent7dAccessCount: number;
  previous7dAccessCount: number;
  valueScore: number;
  recommendation: InsightOrganizationRecommendation;
};

export type InsightOrganizationRecommendation = {
  action: InsightOrganizationAction;
  reason: string;
};

export type InsightAnalyticsSummary = {
  totalInsights: number;
  activeInsights: number;
  dormantInsights: number;
  totalAccesses30d: number;
  averageValueScore: number;
  risingInsights: number;
  fallingInsights: number;
  stableInsights: number;
};

export type InsightRelationship = {
  insightId: string;
  insightTitle: string;
  relatedInsightId: string;
  relatedInsightTitle: string;
  sharedConversationCount: number;
  combinedAccessCount30d: number;
  combinedValueScore: number;
};

export type InsightUsageAnalytics = {
  generatedAt: string;
  summary: InsightAnalyticsSummary;
  topInsights: InsightAnalyticsInsight[];
  bottomInsights: InsightAnalyticsInsight[];
  relationships: InsightRelationship[];
  insights: InsightAnalyticsInsight[];
};

export type GetInsightUsageAnalyticsInput = {
  userId: string;
  limit?: number;
  includeArchived?: boolean;
  now?: Date;
  db?: DrizzleDB;
};

type InsightAnalyticsRow = {
  id: string;
  title: string;
  description: string;
  taskLabel: string;
  platform: string | null;
  account: string | null;
  importance: string;
  urgency: string;
  isFavorited: boolean | null;
  isArchived: boolean | null;
  createdAt: Date;
  updatedAt: Date;
  time: Date;
  accessCountTotal: number | null;
  accessCount7d: number | null;
  accessCount30d: number | null;
  lastAccessedAt: Date | null;
};

type TrendCounts = {
  recent7d: number;
  previous7d: number;
};

type ConversationInsightLink = {
  chatId: string | null;
  insightId: string | null;
};

const DEFAULT_LIMIT = 10;

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function normalizeLabel(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function daysBetween(later: Date, earlier: Date) {
  return Math.max(0, (later.getTime() - earlier.getTime()) / 86_400_000);
}

function coerceDate(value: Date | string | number | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function calculateInsightTrend(
  recent7dAccessCount: number,
  previous7dAccessCount: number,
): InsightAccessTrend {
  if (recent7dAccessCount === 0 && previous7dAccessCount === 0) {
    return "stable";
  }

  if (previous7dAccessCount === 0) {
    return recent7dAccessCount > 0 ? "rising" : "stable";
  }

  const threshold = Math.max(1, Math.ceil(previous7dAccessCount * 0.25));
  if (recent7dAccessCount >= previous7dAccessCount + threshold) {
    return "rising";
  }
  if (previous7dAccessCount >= recent7dAccessCount + threshold) {
    return "falling";
  }
  return "stable";
}

export function calculateInsightValueScore(input: {
  accessCount30d: number;
  maxAccessCount30d: number;
  lastAccessedAt: Date | null;
  createdAt: Date;
  importance: string;
  urgency: string;
  isFavorited: boolean;
  now: Date;
}) {
  const frequencyScore =
    input.maxAccessCount30d > 0
      ? Math.log1p(input.accessCount30d) / Math.log1p(input.maxAccessCount30d)
      : 0;

  const freshnessDate = input.lastAccessedAt ?? input.createdAt;
  const ageDays = daysBetween(input.now, freshnessDate);
  const freshnessScore =
    ageDays <= 1
      ? 1
      : ageDays <= 7
        ? 0.8
        : ageDays <= 30
          ? 0.45
          : ageDays <= 90
            ? 0.2
            : 0.08;

  const importance = normalizeLabel(input.importance);
  const importanceScore = ["critical", "urgent", "high", "important"].includes(
    importance,
  )
    ? 1
    : ["medium", "general", "normal"].includes(importance)
      ? 0.6
      : 0.25;

  const urgency = normalizeLabel(input.urgency);
  const urgencyScore = ["immediate", "urgent", "24h", "high"].includes(urgency)
    ? 1
    : ["medium", "soon"].includes(urgency)
      ? 0.6
      : 0.3;

  const relevanceScore = importanceScore * 0.7 + urgencyScore * 0.3;
  const favoriteScore = input.isFavorited ? 1 : 0;

  return Math.round(
    clamp(
      frequencyScore * 0.45 +
        freshnessScore * 0.25 +
        relevanceScore * 0.2 +
        favoriteScore * 0.1,
    ) * 100,
  );
}

export function recommendInsightOrganization(input: {
  accessCount30d: number;
  lastAccessedAt: Date | null;
  createdAt: Date;
  importance: string;
  isFavorited: boolean;
  trend: InsightAccessTrend;
  valueScore: number;
  now: Date;
}): InsightOrganizationRecommendation {
  if (input.isFavorited) {
    return {
      action: "keep",
      reason: "Favorited insights are treated as intentionally retained.",
    };
  }

  const lastMeaningfulActivity = input.lastAccessedAt ?? input.createdAt;
  const inactiveDays = daysBetween(input.now, lastMeaningfulActivity);
  const importance = normalizeLabel(input.importance);
  const isHighImportance = ["critical", "urgent", "high", "important"].includes(
    importance,
  );

  if (
    input.accessCount30d === 0 &&
    inactiveDays >= 90 &&
    input.valueScore < 35 &&
    !isHighImportance
  ) {
    return {
      action: "delete",
      reason: "No recent usage and low value score for more than 90 days.",
    };
  }

  if (
    input.accessCount30d === 0 &&
    inactiveDays >= 30 &&
    input.valueScore < 55 &&
    !isHighImportance
  ) {
    return {
      action: "archive",
      reason: "Dormant for at least 30 days with low recent value.",
    };
  }

  if (input.trend === "falling" && input.valueScore < 45) {
    return {
      action: "archive",
      reason: "Usage is falling and value score is below the active threshold.",
    };
  }

  return {
    action: "keep",
    reason: "Usage, freshness, or relevance still supports keeping it active.",
  };
}

function compareTopInsights(
  left: InsightAnalyticsInsight,
  right: InsightAnalyticsInsight,
) {
  return (
    right.accessCount30d - left.accessCount30d ||
    right.accessCountTotal - left.accessCountTotal ||
    right.valueScore - left.valueScore ||
    (right.lastAccessedAt?.getTime() ?? 0) -
      (left.lastAccessedAt?.getTime() ?? 0)
  );
}

function compareBottomInsights(
  left: InsightAnalyticsInsight,
  right: InsightAnalyticsInsight,
) {
  const leftLastAccessed = left.lastAccessedAt?.getTime() ?? 0;
  const rightLastAccessed = right.lastAccessedAt?.getTime() ?? 0;

  return (
    left.accessCount30d - right.accessCount30d ||
    left.valueScore - right.valueScore ||
    leftLastAccessed - rightLastAccessed ||
    left.createdAt.getTime() - right.createdAt.getTime()
  );
}

function buildSummary(
  insights: InsightAnalyticsInsight[],
): InsightAnalyticsSummary {
  const totalValueScore = insights.reduce(
    (total, item) => total + item.valueScore,
    0,
  );

  return {
    totalInsights: insights.length,
    activeInsights: insights.filter((item) => item.accessCount30d > 0).length,
    dormantInsights: insights.filter((item) => item.accessCount30d === 0)
      .length,
    totalAccesses30d: insights.reduce(
      (total, item) => total + item.accessCount30d,
      0,
    ),
    averageValueScore:
      insights.length > 0 ? Math.round(totalValueScore / insights.length) : 0,
    risingInsights: insights.filter((item) => item.trend === "rising").length,
    fallingInsights: insights.filter((item) => item.trend === "falling").length,
    stableInsights: insights.filter((item) => item.trend === "stable").length,
  };
}

function buildTrendCountMap(
  views: Array<{ insightId: string | null; viewedAt: Date | string | number }>,
  now: Date,
) {
  const sevenDaysAgo = now.getTime() - 7 * 86_400_000;
  const fourteenDaysAgo = now.getTime() - 14 * 86_400_000;
  const trendCounts = new Map<string, TrendCounts>();

  for (const view of views) {
    if (!view.insightId) continue;

    const viewedAt = coerceDate(view.viewedAt);
    if (!viewedAt) continue;

    const timestamp = viewedAt.getTime();
    if (timestamp < fourteenDaysAgo || timestamp > now.getTime()) continue;

    const current = trendCounts.get(view.insightId) ?? {
      recent7d: 0,
      previous7d: 0,
    };

    if (timestamp >= sevenDaysAgo) {
      current.recent7d += 1;
    } else {
      current.previous7d += 1;
    }

    trendCounts.set(view.insightId, current);
  }

  return trendCounts;
}

function buildRelationshipAnalytics(
  insights: InsightAnalyticsInsight[],
  conversationLinks: ConversationInsightLink[],
  limit: number,
): InsightRelationship[] {
  const insightsById = new Map(insights.map((item) => [item.id, item]));
  const insightIdsByChatId = new Map<string, Set<string>>();

  for (const link of conversationLinks) {
    if (!link.chatId || !link.insightId || !insightsById.has(link.insightId)) {
      continue;
    }

    const insightIds = insightIdsByChatId.get(link.chatId) ?? new Set<string>();
    insightIds.add(link.insightId);
    insightIdsByChatId.set(link.chatId, insightIds);
  }

  const pairCounts = new Map<string, number>();
  for (const insightIds of insightIdsByChatId.values()) {
    const sortedInsightIds = [...insightIds].sort();
    for (let leftIndex = 0; leftIndex < sortedInsightIds.length; leftIndex++) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < sortedInsightIds.length;
        rightIndex++
      ) {
        const pairKey = `${sortedInsightIds[leftIndex]}:${sortedInsightIds[rightIndex]}`;
        pairCounts.set(pairKey, (pairCounts.get(pairKey) ?? 0) + 1);
      }
    }
  }

  return [...pairCounts.entries()]
    .map(([pairKey, sharedConversationCount]) => {
      const [insightId, relatedInsightId] = pairKey.split(":");
      const first = insightsById.get(insightId);
      const second = insightsById.get(relatedInsightId);

      if (!first || !second) return null;

      return {
        insightId,
        insightTitle: first.title,
        relatedInsightId,
        relatedInsightTitle: second.title,
        sharedConversationCount,
        combinedAccessCount30d: first.accessCount30d + second.accessCount30d,
        combinedValueScore: Math.round(
          (first.valueScore + second.valueScore) / 2,
        ),
      };
    })
    .filter((item): item is InsightRelationship => item !== null)
    .sort(
      (left, right) =>
        right.sharedConversationCount - left.sharedConversationCount ||
        right.combinedAccessCount30d - left.combinedAccessCount30d ||
        right.combinedValueScore - left.combinedValueScore,
    )
    .slice(0, limit);
}

export function buildInsightUsageAnalytics(input: {
  rows: InsightAnalyticsRow[];
  views: Array<{ insightId: string | null; viewedAt: Date | string | number }>;
  conversationLinks?: ConversationInsightLink[];
  now: Date;
  limit?: number;
}): InsightUsageAnalytics {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const maxAccessCount30d = Math.max(
    0,
    ...input.rows.map((row) => Number(row.accessCount30d ?? 0)),
  );
  const trendCountMap = buildTrendCountMap(input.views, input.now);

  const insights = input.rows.map((row): InsightAnalyticsInsight => {
    const createdAt = coerceDate(row.createdAt) ?? input.now;
    const updatedAt = coerceDate(row.updatedAt) ?? createdAt;
    const time = coerceDate(row.time) ?? createdAt;
    const lastAccessedAt = coerceDate(row.lastAccessedAt);
    const accessCount30d = Number(row.accessCount30d ?? 0);
    const trendCounts = trendCountMap.get(row.id) ?? {
      recent7d: 0,
      previous7d: 0,
    };
    const trend = calculateInsightTrend(
      trendCounts.recent7d,
      trendCounts.previous7d,
    );
    const valueScore = calculateInsightValueScore({
      accessCount30d,
      maxAccessCount30d,
      lastAccessedAt,
      createdAt,
      importance: row.importance,
      urgency: row.urgency,
      isFavorited: Boolean(row.isFavorited),
      now: input.now,
    });

    const recommendation = recommendInsightOrganization({
      accessCount30d,
      lastAccessedAt,
      createdAt,
      importance: row.importance,
      isFavorited: Boolean(row.isFavorited),
      trend,
      valueScore,
      now: input.now,
    });

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      taskLabel: row.taskLabel,
      platform: row.platform,
      account: row.account,
      importance: row.importance,
      urgency: row.urgency,
      isFavorited: Boolean(row.isFavorited),
      isArchived: Boolean(row.isArchived),
      createdAt,
      updatedAt,
      time,
      accessCountTotal: Number(row.accessCountTotal ?? 0),
      accessCount7d: Number(row.accessCount7d ?? 0),
      accessCount30d,
      lastAccessedAt,
      trend,
      recent7dAccessCount: trendCounts.recent7d,
      previous7dAccessCount: trendCounts.previous7d,
      valueScore,
      recommendation,
    };
  });

  return {
    generatedAt: input.now.toISOString(),
    summary: buildSummary(insights),
    topInsights: [...insights].sort(compareTopInsights).slice(0, limit),
    bottomInsights: [...insights].sort(compareBottomInsights).slice(0, limit),
    relationships: buildRelationshipAnalytics(
      insights,
      input.conversationLinks ?? [],
      limit,
    ),
    insights,
  };
}

export async function getInsightUsageAnalytics(
  input: GetInsightUsageAnalyticsInput,
): Promise<InsightUsageAnalytics> {
  const db = input.db ?? defaultDb;
  const now = input.now ?? new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86_400_000);
  const whereConditions = [eq(bot.userId, input.userId)];

  if (!input.includeArchived) {
    whereConditions.push(eq(insight.isArchived, false));
    whereConditions.push(isNull(insight.pendingDeletionAt));
  }

  const rows = (await db
    .select({
      id: insight.id,
      title: insight.title,
      description: insight.description,
      taskLabel: insight.taskLabel,
      platform: insight.platform,
      account: insight.account,
      importance: insight.importance,
      urgency: insight.urgency,
      isFavorited: insight.isFavorited,
      isArchived: insight.isArchived,
      createdAt: insight.createdAt,
      updatedAt: insight.updatedAt,
      time: insight.time,
      accessCountTotal: insightWeights.accessCountTotal,
      accessCount7d: insightWeights.accessCount7d,
      accessCount30d: insightWeights.accessCount30d,
      lastAccessedAt: insightWeights.lastAccessedAt,
    })
    .from(insight)
    .innerJoin(bot, eq(insight.botId, bot.id))
    .leftJoin(
      insightWeights,
      and(
        eq(insightWeights.insightId, insight.id),
        eq(insightWeights.userId, input.userId),
      ),
    )
    .where(and(...whereConditions))) as InsightAnalyticsRow[];

  const insightIds = rows.map((row) => row.id);
  const views =
    insightIds.length === 0
      ? []
      : ((await db
          .select({
            insightId: insightViewHistory.insightId,
            viewedAt: insightViewHistory.viewedAt,
          })
          .from(insightViewHistory)
          .where(
            and(
              eq(insightViewHistory.userId, input.userId),
              gte(insightViewHistory.viewedAt, fourteenDaysAgo),
              inArray(insightViewHistory.insightId, insightIds),
            ),
          )) as Array<{
          insightId: string | null;
          viewedAt: Date | string | number;
        }>);

  const conversationLinks =
    insightIds.length === 0
      ? []
      : ((await db
          .select({
            chatId: chatInsights.chatId,
            insightId: chatInsights.insightId,
          })
          .from(chatInsights)
          .innerJoin(chat, eq(chatInsights.chatId, chat.id))
          .where(
            and(
              eq(chat.userId, input.userId),
              inArray(chatInsights.insightId, insightIds),
            ),
          )) as ConversationInsightLink[]);

  return buildInsightUsageAnalytics({
    rows,
    views,
    conversationLinks,
    now,
    limit: input.limit,
  });
}
