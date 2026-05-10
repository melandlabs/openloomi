"use client";

import { Button } from "@alloomi/ui";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { RemixIcon } from "@/components/remix-icon";
import { Spinner } from "@/components/spinner";
import { cn, fetcher } from "@/lib/utils";

type AccessTrend = "rising" | "falling" | "stable";
type OrganizationAction = "keep" | "archive" | "delete";

type AnalyticsInsight = {
  id: string;
  title: string;
  description: string;
  platform: string | null;
  account: string | null;
  accessCountTotal: number;
  accessCount7d: number;
  accessCount30d: number;
  lastAccessedAt: string | null;
  trend: AccessTrend;
  recent7dAccessCount: number;
  previous7dAccessCount: number;
  valueScore: number;
  recommendation: {
    action: OrganizationAction;
    reason: string;
  };
};

type AnalyticsRelationship = {
  insightId: string;
  insightTitle: string;
  relatedInsightId: string;
  relatedInsightTitle: string;
  sharedConversationCount: number;
  combinedAccessCount30d: number;
  combinedValueScore: number;
};

type InsightUsageAnalyticsResponse = {
  generatedAt: string;
  summary: {
    totalInsights: number;
    activeInsights: number;
    dormantInsights: number;
    totalAccesses30d: number;
    averageValueScore: number;
    risingInsights: number;
    fallingInsights: number;
    stableInsights: number;
  };
  topInsights: AnalyticsInsight[];
  bottomInsights: AnalyticsInsight[];
  relationships: AnalyticsRelationship[];
  insights: AnalyticsInsight[];
};

const ACTION_STYLES: Record<OrganizationAction, string> = {
  keep: "border-emerald-200 bg-emerald-50 text-emerald-700",
  archive: "border-amber-200 bg-amber-50 text-amber-700",
  delete: "border-rose-200 bg-rose-50 text-rose-700",
};

const TREND_STYLES: Record<AccessTrend, string> = {
  rising: "border-emerald-200 bg-emerald-50 text-emerald-700",
  falling: "border-rose-200 bg-rose-50 text-rose-700",
  stable: "border-sky-200 bg-sky-50 text-sky-700",
};

function formatDate(value: string | null, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

function actionLabel(
  action: OrganizationAction,
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (action === "archive") {
    return t("insight.analytics.action.archive", "Archive");
  }
  if (action === "delete") {
    return t("insight.analytics.action.delete", "Delete");
  }
  return t("insight.analytics.action.keep", "Keep");
}

function trendLabel(
  trend: AccessTrend,
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (trend === "rising") {
    return t("insight.analytics.trend.rising", "Rising");
  }
  if (trend === "falling") {
    return t("insight.analytics.trend.falling", "Falling");
  }
  return t("insight.analytics.trend.stable", "Stable");
}

function trendIcon(trend: AccessTrend) {
  if (trend === "rising") return "arrow_up";
  if (trend === "falling") return "arrow_down";
  return "chart_gantt";
}

function recommendationReasonLabel(
  reason: string,
  t: ReturnType<typeof useTranslation>["t"],
) {
  const reasonKeyByText: Record<string, string> = {
    "Favorited insights are treated as intentionally retained.":
      "insight.analytics.reason.favorited",
    "No recent usage and low value score for more than 90 days.":
      "insight.analytics.reason.deleteDormant",
    "Dormant for at least 30 days with low recent value.":
      "insight.analytics.reason.archiveDormant",
    "Usage is falling and value score is below the active threshold.":
      "insight.analytics.reason.archiveFalling",
    "Usage, freshness, or relevance still supports keeping it active.":
      "insight.analytics.reason.keepActive",
  };
  const key = reasonKeyByText[reason];
  return key ? t(key, reason) : reason;
}

function InsightMetricCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-muted-foreground">
        <span className="truncate text-xs font-medium">{label}</span>
        <RemixIcon name={icon} size="size-4" />
      </div>
      <div className="text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </div>
    </div>
  );
}

function InsightAnalyticsRow({
  item,
  rank,
  mode,
}: {
  item: AnalyticsInsight;
  rank: number;
  mode: "top" | "bottom";
}) {
  const { t } = useTranslation();
  const fallback =
    mode === "bottom"
      ? t("insight.analytics.neverAccessed", "Never")
      : t("insight.analytics.noAccess", "No access");

  return (
    <div className="grid min-h-[76px] grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-background px-3 py-3">
      <div className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
        {rank}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-foreground">
          {item.title || t("insight.analytics.untitled", "Untitled insight")}
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {t("insight.analytics.accesses30dShort", "{{count}} / 30d", {
              count: item.accessCount30d,
            })}
          </span>
          <span className="tabular-nums">
            {t("insight.analytics.totalAccessesShort", "{{count}} total", {
              count: item.accessCountTotal,
            })}
          </span>
          <span>{formatDate(item.lastAccessedAt, fallback)}</span>
        </div>
      </div>
      <div className="flex min-w-[86px] flex-col items-end gap-2">
        <span
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-semibold capitalize",
            TREND_STYLES[item.trend],
          )}
        >
          <RemixIcon name={trendIcon(item.trend)} size="size-3.5" />
          {trendLabel(item.trend, t)}
        </span>
        <span className="text-xs font-semibold tabular-nums text-foreground">
          {item.valueScore}
        </span>
      </div>
    </div>
  );
}

function InsightRelationshipRow({ item }: { item: AnalyticsRelationship }) {
  const { t } = useTranslation();

  return (
    <div className="rounded-lg border border-border bg-background px-3 py-3">
      <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
        <span className="truncate">{item.insightTitle}</span>
        <RemixIcon
          name="link"
          size="size-4"
          className="shrink-0 text-muted-foreground"
        />
        <span className="truncate">{item.relatedInsightTitle}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {t("insight.analytics.conversationCount", "{{count}} conversations", {
            count: item.sharedConversationCount,
          })}
        </span>
        <span className="tabular-nums">
          {t("insight.analytics.accessCount30d", "{{count}} accesses / 30d", {
            count: item.combinedAccessCount30d,
          })}
        </span>
        <span className="tabular-nums">
          {t("insight.analytics.scoreValue", "score {{score}}", {
            score: item.combinedValueScore,
          })}
        </span>
      </div>
    </div>
  );
}

function InsightRecommendationRow({ item }: { item: AnalyticsInsight }) {
  const { t } = useTranslation();

  return (
    <div className="rounded-lg border border-border bg-background px-3 py-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0 truncate text-sm font-semibold text-foreground">
          {item.title || t("insight.analytics.untitled", "Untitled insight")}
        </div>
        <span
          className={cn(
            "inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-[11px] font-semibold",
            ACTION_STYLES[item.recommendation.action],
          )}
        >
          {actionLabel(item.recommendation.action, t)}
        </span>
      </div>
      <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">
        {recommendationReasonLabel(item.recommendation.reason, t)}
      </div>
    </div>
  );
}

export function InsightAnalyticsPanel() {
  const { t } = useTranslation();
  const { data, error, isLoading, mutate } =
    useSWR<InsightUsageAnalyticsResponse>(
      "/api/insights/analytics?limit=10",
      fetcher,
    );

  const organizationCandidates = useMemo(() => {
    return (data?.insights ?? [])
      .filter((item) => item.recommendation.action !== "keep")
      .sort(
        (left, right) =>
          left.valueScore - right.valueScore ||
          left.accessCount30d - right.accessCount30d,
      )
      .slice(0, 6);
  }, [data?.insights]);

  if (isLoading) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center text-muted-foreground">
        <Spinner size={20} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 text-center">
        <div className="text-sm font-semibold text-foreground">
          {t("insight.analytics.loadFailed", "Analytics failed to load")}
        </div>
        <Button variant="outline" size="sm" onClick={() => mutate()}>
          <RemixIcon name="refresh" size="size-4" />
          {t("common.refresh", "Refresh")}
        </Button>
      </div>
    );
  }

  const generatedAt = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(data.generatedAt));

  return (
    <div className="w-full space-y-4 pb-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-lg font-semibold text-foreground">
            {t("insight.analytics.title", "Usage Analytics")}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {t("insight.analytics.generatedAt", "Updated {{time}}", {
              time: generatedAt,
            })}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0"
          onClick={() => {
            window.location.href = "/api/insights/analytics/export";
          }}
        >
          <RemixIcon name="download" size="size-4" />
          {t("common.export", "Export")}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InsightMetricCard
          label={t("insight.analytics.totalInsights", "Total insights")}
          value={data.summary.totalInsights}
          icon="layers"
        />
        <InsightMetricCard
          label={t("insight.analytics.activeInsights", "Active / 30d")}
          value={data.summary.activeInsights}
          icon="eye"
        />
        <InsightMetricCard
          label={t("insight.analytics.dormantInsights", "Dormant")}
          value={data.summary.dormantInsights}
          icon="bell_off"
        />
        <InsightMetricCard
          label={t("insight.analytics.averageScore", "Average score")}
          value={data.summary.averageValueScore}
          icon="chart_gantt"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">
              {t("insight.analytics.topInsights", "Top insights")}
            </h3>
            <span className="text-xs text-muted-foreground">
              {data.summary.totalAccesses30d} / 30d
            </span>
          </div>
          <div className="space-y-2">
            {data.topInsights.length > 0 ? (
              data.topInsights.map((item, index) => (
                <InsightAnalyticsRow
                  key={item.id}
                  item={item}
                  rank={index + 1}
                  mode="top"
                />
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                {t("insight.analytics.noUsageData", "No usage data yet")}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">
              {t("insight.analytics.bottomInsights", "Dormant insights")}
            </h3>
            <span className="text-xs text-muted-foreground">
              {data.summary.dormantInsights}
            </span>
          </div>
          <div className="space-y-2">
            {data.bottomInsights.length > 0 ? (
              data.bottomInsights.map((item, index) => (
                <InsightAnalyticsRow
                  key={item.id}
                  item={item}
                  rank={index + 1}
                  mode="bottom"
                />
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                {t("insight.analytics.noDormantData", "No dormant insights")}
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-lg border border-border bg-background p-4">
          <h3 className="text-sm font-semibold text-foreground">
            {t("insight.analytics.trends", "Trend analysis")}
          </h3>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              {
                label: t("insight.analytics.trend.rising", "Rising"),
                value: data.summary.risingInsights,
                trend: "rising" as const,
              },
              {
                label: t("insight.analytics.trend.stable", "Stable"),
                value: data.summary.stableInsights,
                trend: "stable" as const,
              },
              {
                label: t("insight.analytics.trend.falling", "Falling"),
                value: data.summary.fallingInsights,
                trend: "falling" as const,
              },
            ].map((item) => (
              <div
                key={item.trend}
                className={cn(
                  "rounded-lg border px-3 py-3",
                  TREND_STYLES[item.trend],
                )}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <RemixIcon name={trendIcon(item.trend)} size="size-4" />
                  {item.label}
                </div>
                <div className="mt-2 text-2xl font-semibold tabular-nums">
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">
            {t("insight.analytics.relationships", "Relationship analysis")}
          </h3>
          <div className="space-y-2">
            {data.relationships.length > 0 ? (
              data.relationships.map((item) => (
                <InsightRelationshipRow
                  key={`${item.insightId}:${item.relatedInsightId}`}
                  item={item}
                />
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                {t(
                  "insight.analytics.noRelationships",
                  "No repeated relationships yet",
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">
          {t(
            "insight.analytics.organizationRecommendations",
            "Organization recommendations",
          )}
        </h3>
        <div className="grid gap-2 xl:grid-cols-2">
          {organizationCandidates.length > 0 ? (
            organizationCandidates.map((item) => (
              <InsightRecommendationRow key={item.id} item={item} />
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground xl:col-span-2">
              {t("insight.analytics.noRecommendations", "No cleanup needed")}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
