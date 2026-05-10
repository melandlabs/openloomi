import { auth } from "@/app/(auth)/auth";
import {
  getInsightUsageAnalytics,
  type InsightAnalyticsInsight,
} from "@/lib/insights/analytics";
import { AppError } from "@alloomi/shared/errors";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

function parseBoolean(value: string | null) {
  return value === "true" || value === "1";
}

function csvEscape(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function formatCsvDate(value: Date | string | number | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function buildAnalyticsCsv(insights: InsightAnalyticsInsight[]) {
  const headers = [
    "id",
    "title",
    "description",
    "platform",
    "account",
    "task_label",
    "importance",
    "urgency",
    "access_count_total",
    "access_count_7d",
    "access_count_30d",
    "last_accessed_at",
    "trend",
    "recent_7d_access_count",
    "previous_7d_access_count",
    "value_score",
    "recommendation",
    "recommendation_reason",
    "is_favorited",
    "is_archived",
    "created_at",
    "updated_at",
  ];

  const rows = insights.map((item) => [
    item.id,
    item.title,
    item.description,
    item.platform ?? "",
    item.account ?? "",
    item.taskLabel,
    item.importance,
    item.urgency,
    item.accessCountTotal,
    item.accessCount7d,
    item.accessCount30d,
    formatCsvDate(item.lastAccessedAt),
    item.trend,
    item.recent7dAccessCount,
    item.previous7dAccessCount,
    item.valueScore,
    item.recommendation.action,
    item.recommendation.reason,
    item.isFavorited,
    item.isArchived,
    formatCsvDate(item.createdAt),
    formatCsvDate(item.updatedAt),
  ]);

  return [headers, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\r\n");
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:insight").toResponse();
  }

  const includeArchived = parseBoolean(
    request.nextUrl.searchParams.get("includeArchived"),
  );

  try {
    const analytics = await getInsightUsageAnalytics({
      userId: session.user.id,
      includeArchived,
    });
    const csv = buildAnalyticsCsv(analytics.insights);
    const exportDate = new Date().toISOString().slice(0, 10);

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="insight-analytics-${exportDate}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[InsightAnalytics] Failed to export analytics CSV:", error);
    return new AppError("bad_request:database", String(error)).toResponse();
  }
}
