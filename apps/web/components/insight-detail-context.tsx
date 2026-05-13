"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RemixIcon } from "@/components/remix-icon";
import { format } from "date-fns";
import { enUS } from "date-fns/locale";
import type { Insight } from "@/lib/db/schema";
import { Button, Input } from "@openloomi/ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@openloomi/ui";
import { coerceDate } from "@openloomi/shared";
import { InsightCardBadgesRow } from "@/components/insight-card/insight-card-badges-row";
import { TimelineEventCard } from "./timeline-event-card";

interface InsightDetailContextProps {
  insight: Insight;
  timeline?: Array<{
    id?: string;
    summary?: string;
    time?: number | null;
    lastUpdatedAt?: number;
    changeCount?: number;
    version?: number;
    urgency?: "urgent" | "warning" | "normal";
    tags?: string[];
    label?: string;
    action?: string;
  }>;
  onShowIterationHistory?: () => void;
  /** Whether AI interpretation can be triggered; if onUnderstand is provided, show one-click execution icon button in description card header */
  canUnderstand?: boolean;
  isUnderstanding?: boolean;
  onUnderstand?: (insight: Insight) => void;
  /** Called when the user clicks on a timeline action */
  onTimelineActionClick?: (action: string) => void;
}

/**
 * Insight detail context panel, includes description card, strategy cards, and (optional) update history timeline.
 * This component combines the display of `insight` and `timeline`, and triggers AI interpretation when needed.
 */
export function InsightDetailContext({
  insight,
  timeline,
  onShowIterationHistory,
  canUnderstand,
  isUnderstanding,
  onUnderstand,
  onTimelineActionClick,
}: InsightDetailContextProps) {
  const { t } = useTranslation();
  const [expandedCard, setExpandedCard] = useState<
    "opportunity" | "risk" | "relationship" | null
  >(null);
  const [updateSearchQuery, setUpdateSearchQuery] = useState("");
  const [hoveredTimelineIndex, setHoveredTimelineIndex] = useState<
    number | null
  >(null);
  const [expandedTimelineIndex, setExpandedTimelineIndex] = useState<
    number | null
  >(null);

  /** Normalized category list: consistent with insight card, used for badge row */
  const categoriesList = useMemo((): string[] => {
    const raw = insight.categories;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw || "[]");
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }, [insight.categories]);

  /**
   * Get the most recent event update time
   * Prefer using the latest time from details, otherwise use insight.updatedAt
   */
  const getLastUpdateTime = (): Date | null => {
    // Parse details if it's a string (SQLite mode stores as JSON string)
    const details =
      typeof insight.details === "string"
        ? JSON.parse(insight.details || "[]")
        : insight.details || [];

    if (details && details.length > 0) {
      // Find the latest time from details
      const times = details
        .map((detail: any) => detail.time)
        .filter((time: any): time is number => time != null)
        .sort((a: number, b: number) => b - a);
      if (times.length > 0) {
        return coerceDate(times[0]);
      }
    }
    // Fallback: use insight.updatedAt
    return insight.updatedAt ? new Date(insight.updatedAt) : null;
  };

  const lastUpdateTime = getLastUpdateTime();

  /**
   * Filter update history list based on search box keyword, only matches update title (`summary`).
   * Filter logic does not change the original “newest first” display order.
   */
  const visibleTimeline = useMemo(() => {
    if (!timeline) return [];

    const query = updateSearchQuery.trim().toLowerCase();
    const reversed = [...timeline].reverse(); // Keep “newest on top”

    if (!query) return reversed;

    return reversed.filter((item) => {
      const summary = (item.summary ?? "").toLowerCase();
      return summary.includes(query);
    });
  }, [timeline, updateSearchQuery]);

  return (
    <>
      {/* Description */}
      <div
        className="rounded-lg mt-0 mb-0 p-4 bg-[var(--primary-50)] border border-border"
        style={{
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <div className="flex items-start justify-start mb-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <h3 className="text-base font-semibold font-serif text-foreground w-full">
              Latest
            </h3>
            {lastUpdateTime && (
              <span className="ml-auto text-xs text-muted-foreground shrink-0">
                {format(lastUpdateTime, "MM/dd HH:mm", { locale: enUS })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {/* AI Insight icon button (one-click execution), left of timeline/update history button */}
            {canUnderstand && onUnderstand && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="magic-secondary"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => onUnderstand(insight)}
                    disabled={isUnderstanding}
                    aria-label={t(
                      "insightDetail.aiInsightsAction",
                      "AI Insights",
                    )}
                  >
                    {isUnderstanding ? (
                      <span className="inline-flex size-4 items-center justify-center">
                        <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                      </span>
                    ) : (
                      <RemixIcon name="bard" size="size-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t(
                    "insightDetail.understandHint",
                    "Use credits to generate a deeper understanding.",
                  )}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        <div
          className="mt-0 whitespace-pre-line text-sm text-[var(--color-foreground-muted)] leading-[26px]"
          style={{
            wordBreak: "break-word",
          }}
        >
          {insight.description || ""}
        </div>
        {/* Badge row consistent with card: channel, importance, urgency, category */}
        <div className="flex flex-wrap gap-1 mt-2">
          <InsightCardBadgesRow
            platform={insight.platform ?? null}
            groups={insight.groups ?? null}
            details={insight.details ?? null}
            categories={categoriesList}
            importance={insight.importance ?? null}
            urgency={insight.urgency ?? null}
          />
        </div>
      </div>

      {/* Opportunity, Risk, Relationship - three independent cards in horizontal layout */}
      {(insight.strategic?.opportunity ||
        insight.strategic?.risk ||
        insight.strategic?.relationship) && (
        <div className="mt-4">
          {expandedCard ? (
            // Expanded state: only show the clicked card
            <div className="w-full">
              {expandedCard === "opportunity" &&
                insight.strategic?.opportunity && (
                  <div className="rounded-lg p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 relative">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <h4 className="text-sm font-semibold text-amber-600 dark:text-amber-500">
                          {t("insightDetail.opportunities", "Opportunities")}
                        </h4>
                        <RemixIcon
                          name="info"
                          size="size-3"
                          className="text-amber-600 dark:text-amber-500"
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-amber-600 dark:text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-900/30"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedCard(null);
                        }}
                        aria-label={t("insightDetail.close", "Close")}
                      >
                        <RemixIcon name="close" size="size-4" />
                      </Button>
                    </div>
                    <div className="text-xs text-amber-900 dark:text-amber-100 leading-relaxed">
                      <p>{insight.strategic.opportunity}</p>
                    </div>
                  </div>
                )}
              {expandedCard === "risk" && insight.strategic?.risk && (
                <div className="rounded-lg p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 relative">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <h4 className="text-sm font-semibold text-red-600 dark:text-red-500">
                        {t("insightDetail.risk", "Risk")}
                      </h4>
                      <RemixIcon
                        name="alert_triangle"
                        size="size-3"
                        className="text-red-600 dark:text-red-500"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-red-600 dark:text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedCard(null);
                      }}
                      aria-label={t("insightDetail.close", "Close")}
                    >
                      <RemixIcon name="close" size="size-4" />
                    </Button>
                  </div>
                  <div className="text-xs text-red-900 dark:text-red-100 leading-relaxed">
                    <p>{insight.strategic.risk}</p>
                  </div>
                </div>
              )}
              {expandedCard === "relationship" &&
                insight.strategic?.relationship && (
                  <div className="rounded-lg p-4 bg-gray-50 dark:bg-gray-950/20 border border-gray-200 dark:border-gray-800 relative">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <h4 className="text-sm font-semibold text-gray-600 dark:text-gray-500">
                          {t("insightDetail.relationship", "Relationship")}
                        </h4>
                        <RemixIcon
                          name="workflow"
                          size="size-3"
                          className="text-gray-600 dark:text-gray-500"
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-gray-600 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-blue-900/30"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedCard(null);
                        }}
                        aria-label={t("insightDetail.close", "Close")}
                      >
                        <RemixIcon name="close" size="size-4" />
                      </Button>
                    </div>
                    <div className="text-xs text-gray-900 dark:text-blue-100 leading-relaxed">
                      <p>{insight.strategic.relationship}</p>
                    </div>
                  </div>
                )}
            </div>
          ) : (
            // Normal state: show three cards
            <div className="flex flex-col sm:flex-row gap-3">
              {/* Opportunity card */}
              {insight.strategic?.opportunity && (
                <div
                  className="flex-1 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-950/30 transition-colors flex flex-col"
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedCard("opportunity")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedCard("opportunity");
                    }
                  }}
                  style={{ maxHeight: "160px" }}
                >
                  <div className="flex items-center gap-1.5 mb-2 px-4 pt-4 flex-shrink-0">
                    <h4 className="text-sm font-semibold text-amber-600 dark:text-amber-500">
                      {t("insightDetail.opportunities", "Opportunities")}
                    </h4>
                    <RemixIcon
                      name="info"
                      size="size-3"
                      className="text-amber-600 dark:text-amber-500"
                    />
                  </div>
                  <div className="px-4 pb-4 flex-1 min-h-0 flex flex-col">
                    <div
                      className="text-xs text-amber-900 dark:text-amber-100 leading-relaxed overflow-hidden flex-1 min-h-0"
                      style={{
                        display: "-webkit-box",
                        WebkitLineClamp: 6,
                        WebkitBoxOrient: "vertical",
                        textOverflow: "ellipsis",
                      }}
                    >
                      <p className="m-0">{insight.strategic.opportunity}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Risk card */}
              {insight.strategic?.risk && (
                <div
                  className="flex-1 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 cursor-pointer hover:bg-red-100 dark:hover:bg-red-950/30 transition-colors flex flex-col"
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedCard("risk")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedCard("risk");
                    }
                  }}
                  style={{ maxHeight: "160px" }}
                >
                  <div className="flex items-center gap-1.5 mb-2 px-4 pt-4 flex-shrink-0">
                    <h4 className="text-sm font-semibold text-red-600 dark:text-red-500">
                      {t("insightDetail.risk", "Risk")}
                    </h4>
                    <RemixIcon
                      name="alert_triangle"
                      size="size-3"
                      className="text-red-600 dark:text-red-500"
                    />
                  </div>
                  <div className="px-4 pb-4 flex-1 min-h-0 flex flex-col">
                    <div
                      className="text-xs text-red-900 dark:text-red-100 leading-relaxed overflow-hidden flex-1 min-h-0"
                      style={{
                        display: "-webkit-box",
                        WebkitLineClamp: 6,
                        WebkitBoxOrient: "vertical",
                        textOverflow: "ellipsis",
                      }}
                    >
                      <p className="m-0">{insight.strategic.risk}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Relationship card */}
              {insight.strategic?.relationship && (
                <div
                  className="flex-1 rounded-lg bg-gray-50 dark:bg-gray-950/20 border border-gray-200 dark:border-gray-800 cursor-pointer hover:bg-gray-100 dark:hover:bg-blue-950/30 transition-colors flex flex-col"
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedCard("relationship")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedCard("relationship");
                    }
                  }}
                  style={{ maxHeight: "160px" }}
                >
                  <div className="flex items-center gap-1.5 mb-2 px-4 pt-4 flex-shrink-0">
                    <h4 className="text-sm font-semibold text-gray-600 dark:text-gray-500">
                      {t("insightDetail.relationship", "Relationship")}
                    </h4>
                    <RemixIcon
                      name="workflow"
                      size="size-3"
                      className="text-gray-600 dark:text-gray-500"
                    />
                  </div>
                  <div className="px-4 pb-4 flex-1 min-h-0 flex flex-col">
                    <div
                      className="text-xs text-gray-900 dark:text-blue-100 leading-relaxed overflow-hidden flex-1 min-h-0"
                      style={{
                        display: "-webkit-box",
                        WebkitLineClamp: 6,
                        WebkitBoxOrient: "vertical",
                        textOverflow: "ellipsis",
                      }}
                    >
                      <p className="m-0">{insight.strategic.relationship}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Update history card */}
      {timeline && timeline.length > 0 && (
        <div className="mt-0 bg-white rounded-none p-0">
          <div className="py-4 flex items-center justify-end mb-0">
            <div className="relative w-56 ml-auto">
              <RemixIcon
                name="search"
                size="size-4"
                className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="text"
                value={updateSearchQuery}
                placeholder={t(
                  "insightDetail.searchUpdatePlaceholder",
                  "Search update history",
                )}
                onChange={(e) => setUpdateSearchQuery(e.target.value)}
                className="h-7 text-sm pl-7 pr-8"
                onKeyDown={(e) => {
                  if (e.key === "Escape") setUpdateSearchQuery("");
                }}
              />
              {updateSearchQuery && (
                <button
                  type="button"
                  onClick={() => setUpdateSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                  aria-label={t("common.clear", "Clear")}
                >
                  <RemixIcon name="close" size="size-4" />
                </button>
              )}
            </div>
          </div>
          <div className="space-y-3 pl-3 pr-6">
            {visibleTimeline.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t(
                  "insightDetail.noUpdateMatch",
                  "No matching update records found",
                )}
              </div>
            ) : (
              visibleTimeline.map((item, index) => {
                const isLast = index === visibleTimeline.length - 1;
                const isActive = hoveredTimelineIndex === index;
                return (
                  <div
                    key={`timeline-${item.id || item.time}-${index}`}
                    role="listitem"
                    className="grid grid-cols-[20px_minmax(0,1fr)] gap-3 items-start"
                    onMouseEnter={() => setHoveredTimelineIndex(index)}
                    onMouseLeave={() => setHoveredTimelineIndex(null)}
                  >
                    <div className="relative flex h-full min-h-[96px] items-start justify-center">
                      {!isLast && (
                        <span className="absolute left-1/2 top-3 bottom-[-12px] z-0 w-px -translate-x-1/2 bg-border" />
                      )}
                      <span
                        className={`relative z-10 mt-1 block size-2.5 rounded-full border transition-all ${
                          isActive
                            ? "border-primary bg-primary ring-4 ring-primary/10"
                            : "border-border bg-background"
                        }`}
                      />
                    </div>
                    <TimelineEventCard
                      event={{
                        ...item,
                        lastUpdatedAt:
                          item.lastUpdatedAt ?? item.time ?? undefined,
                      }}
                      locale={t("common.locale", "en") === "zh" ? "zh" : "en"}
                      isHovered={isActive}
                      isSelected={expandedTimelineIndex === index}
                      isExpanded={expandedTimelineIndex === index}
                      onToggleExpand={() =>
                        setExpandedTimelineIndex((prev) =>
                          prev === index ? null : index,
                        )
                      }
                      onActionClick={onTimelineActionClick}
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </>
  );
}
