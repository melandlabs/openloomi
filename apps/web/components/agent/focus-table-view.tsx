"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Insight } from "@/lib/db/schema";
import { getInsightPlatforms } from "@/lib/insights/focus-classifier";
import { sortInsightsByEventRank } from "@/lib/insights/event-rank";
import { cn } from "@/lib/utils";
import {
  InsightBadge,
  FOCUS_GROUP_LABELS,
  type FocusGroupLevel,
} from "@/components/insight-badge";
import { RemixIcon } from "@/components/remix-icon";
import { formatTimeForTable } from "./events-panel-utils";
import { coerceDate } from "@openloomi/shared";
import { useInsightPagination } from "@/hooks/use-insight-data";
import { useInsightWeights } from "@/hooks/use-insight-weights";
import { Spinner } from "@/components/spinner";
import { motion } from "framer-motion";
import { PlatformAvatarGroup } from "../message-actions";

/**
 * Props for table view
 */
interface FocusTableViewProps {
  insights: Insight[];
  onSelectInsight: (insight: Insight) => void;
  onDeleteInsight?: (insight: Insight) => void;
  onArchiveInsight?: (insight: Insight) => void;
  onFavoriteInsight?: (insight: Insight) => void;
  selectedInsightId?: string | null;
  language: string;
  insightHasMyNickname: (insight: Insight) => boolean;
  showDescription?: boolean;
  showTime?: boolean;
  showActions?: boolean;
  showKeywords?: boolean;
}

/** First three groups use InsightBadge focusGroup (High/Medium/Low), consistent with Brief */
const FOCUS_TABLE_CATEGORY_TO_LEVEL: Partial<
  Record<
    "immediate" | "high-priority" | "important-info" | "follow-up",
    FocusGroupLevel
  >
> = {
  immediate: "high",
  "high-priority": "medium",
  "important-info": "low",
};

/**
 * Get category icon component (only follow-up uses old style)
 */
const getCategoryIcon = (category: string) => {
  if (category === "follow-up") {
    return <RemixIcon name="bell" size="size-4" className="text-gray-600" />;
  }
  return null;
};

/**
 * Get category tag style (only follow-up uses; first three groups use InsightBadge unified style)
 */
const getCategoryTagStyle = (category: string) => {
  if (category === "follow-up") {
    return "bg-gray-100/80 text-gray-700 border-gray-300/60 hover:bg-gray-100";
  }
  return "bg-muted text-foreground border-border hover:bg-muted/80";
};

/**
 * Focus table view component
 * Uses old classification method, displays focus events in table format
 *
 * @param props - Component props
 * @returns Focus table view component
 */
export function FocusTableView({
  insights,
  onSelectInsight,
  selectedInsightId,
  language,
  insightHasMyNickname,
  onFavoriteInsight,
  onArchiveInsight,
  showDescription = false,
  showTime = false,
  showActions = false,
  showKeywords = false,
}: FocusTableViewProps) {
  const { t } = useTranslation();

  /**
   * Manage expand/collapse state for each group
   */
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(["immediate", "high-priority", "important-info", "follow-up"]),
  );

  /**
   * Toggle group expand/collapse state
   */
  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  // Get weights and last viewed time (called at component top level hook)
  const insightIds = useMemo(() => insights.map((i) => i.id), [insights]);
  const {
    weightMultipliers,
    lastViewedAtMap,
    isLoading: isWeightsLoading,
  } = useInsightWeights(insightIds);

  /**
   * Organize insights by category using EventRank algorithm for classification and sorting
   */
  const categorizedInsights = useMemo(() => {
    // Wait for weights data to load before computing categories to avoid showing intermediate results
    if (isWeightsLoading) {
      return {
        immediate: [],
        "high-priority": [],
        "important-info": [],
        "follow-up": [],
      };
    }

    // Use EventRank for classification and sorting
    const { sorted, categories } = sortInsightsByEventRank(insights, {
      weightMultipliers,
      lastViewedAtMap,
    });

    // Map EventRank categories to today's focus category names
    // urgent -> immediate (handle immediately)
    // important -> high-priority (important todo)
    // monitor -> important-info (info to watch)
    // archive -> follow-up (follow up later)
    const categoryMapping: Record<
      string,
      "immediate" | "high-priority" | "important-info" | "follow-up"
    > = {
      urgent: "immediate",
      important: "high-priority",
      monitor: "important-info",
      archive: "follow-up",
    };

    const categoriesMap: {
      immediate: Insight[];
      "high-priority": Insight[];
      "important-info": Insight[];
      "follow-up": Insight[];
    } = {
      immediate: [],
      "high-priority": [],
      "important-info": [],
      "follow-up": [],
    };

    // Group by EventRank classification results
    sorted.forEach((insight) => {
      const category = categories.get(insight.id) || "archive";
      const mappedCategory = categoryMapping[category];
      if (mappedCategory) {
        categoriesMap[mappedCategory].push(insight);
      }
    });

    return categoriesMap;
  }, [insights, weightMultipliers, lastViewedAtMap]);

  /**
   * Get insight time
   */
  const getInsightTime = (insight: Insight): Date => {
    if (insight.details && insight.details.length > 0) {
      const time = insight.details[insight.details.length - 1].time;
      if (time) {
        return coerceDate(time);
      }
    }
    return new Date(insight.time);
  };

  /**
   * Render category table rows
   */
  const renderCategoryRows = (
    category: "immediate" | "high-priority" | "important-info" | "follow-up",
    categoryInsights: Insight[],
    isFirstCategory = false,
  ) => {
    if (categoryInsights.length === 0) {
      return null;
    }

    const isExpanded = expandedCategories.has(category);
    const categoryKey =
      category === "high-priority"
        ? "highPriority"
        : category === "important-info"
          ? "importantInfo"
          : category === "follow-up"
            ? "followUp"
            : category;
    const focusGroupLevel = FOCUS_TABLE_CATEGORY_TO_LEVEL[category];

    return (
      <>
        {/* Category title row - Tag style (first three groups use InsightBadge focusGroup, follow-up uses old style) */}
        <tr>
          <td
            colSpan={1 + (showTime ? 1 : 0) + (showActions ? 1 : 0)}
            className={cn("py-2 px-3", !isFirstCategory && "pt-6")}
          >
            <button
              type="button"
              onClick={() => toggleCategory(category)}
              className={cn(
                "inline-flex items-center gap-1.5 text-xs font-medium transition-all cursor-pointer",
                focusGroupLevel != null
                  ? "py-1.5 pl-0 pr-1"
                  : `px-3 py-1.5 rounded-md border ${getCategoryTagStyle(category)}`,
              )}
            >
              {isExpanded ? (
                <RemixIcon name="chevron_down" size="size-3.5" />
              ) : (
                <RemixIcon name="chevron_right" size="size-3.5" />
              )}
              {focusGroupLevel != null ? (
                <InsightBadge
                  type="focusGroup"
                  focusGroupLevel={focusGroupLevel}
                  label={FOCUS_GROUP_LABELS[focusGroupLevel]}
                  count={categoryInsights.length}
                />
              ) : (
                <>
                  {getCategoryIcon(category)}
                  <span>{t(`insight.focusCategories.${categoryKey}`)}</span>
                  <span className="opacity-70">
                    ({categoryInsights.length})
                  </span>
                </>
              )}
            </button>
          </td>
        </tr>
        {/* Category content rows - show/hide based on expanded state */}
        {isExpanded &&
          categoryInsights.map((insight) => {
            const isSelected = insight.id === selectedInsightId;
            const insightTime = getInsightTime(insight);
            const timeString = formatTimeForTable(
              insightTime,
              language,
              (key: string, defaultValue?: string) =>
                t(key, defaultValue || ""),
            );

            return (
              <tr
                key={insight.id}
                className={cn(
                  "border-b border-border/30 hover:bg-surface-hover/50 transition-colors",
                  isSelected && "bg-primary/5",
                )}
              >
                <td
                  className="py-3 px-3 cursor-pointer"
                  onClick={() => onSelectInsight(insight)}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-sm">{insight.title}</span>
                    <PlatformAvatarGroup
                      platforms={getInsightPlatforms(insight)}
                    />
                  </div>
                  {showKeywords &&
                    insight.topKeywords &&
                    insight.topKeywords.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 mt-1">
                        {insight.topKeywords
                          .slice(0, 3)
                          .map((keyword, index) => (
                            <span
                              key={`keyword-${index}-${keyword}`}
                              className="inline-flex items-center rounded-full bg-surface-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
                            >
                              <RemixIcon
                                name="hashtag"
                                size="size-3"
                                className="mr-0.5"
                              />
                              {keyword}
                            </span>
                          ))}
                        {insight.topKeywords.length > 3 && (
                          <span className="inline-flex items-center rounded-full bg-surface-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                            +{insight.topKeywords.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  {showDescription && insight.description && (
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2 whitespace-pre-line">
                      {insight.description}
                    </div>
                  )}
                </td>
                {showTime && (
                  <td
                    className="py-3 px-3 text-sm text-muted-foreground cursor-pointer w-24 whitespace-nowrap"
                    onClick={() => onSelectInsight(insight)}
                  >
                    {timeString}
                  </td>
                )}
                {showActions && (
                  <td className="py-3 px-3 w-20">
                    <div className="flex items-center gap-2">
                      {/* Favorite button */}
                      {onFavoriteInsight && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onFavoriteInsight(insight);
                          }}
                          className={cn(
                            "p-1.5 rounded-md transition-colors hover:bg-surface-hover",
                            insight.isFavorited
                              ? "text-yellow-600 hover:text-yellow-700"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                          aria-label={
                            insight.isFavorited
                              ? t("insight.unfavorite", "Unfavorite")
                              : t("insight.favorite", "Favorite")
                          }
                        >
                          <RemixIcon
                            name="star"
                            size="size-4"
                            filled={insight.isFavorited}
                            className={cn(
                              insight.isFavorited && "fill-current",
                            )}
                          />
                        </button>
                      )}
                      {/* Mute / Unmute button (bell-off) */}
                      {onArchiveInsight && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onArchiveInsight(insight);
                          }}
                          className={cn(
                            "p-1.5 rounded-md transition-colors hover:bg-surface-hover",
                            insight.isArchived
                              ? "text-primary hover:text-primary/90"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                          aria-label={
                            insight.isArchived
                              ? t("insight.unmute", "Unmute")
                              : t("insight.mute", "Mute")
                          }
                        >
                          <RemixIcon
                            name="bell_off"
                            size="size-4"
                            filled={insight.isArchived}
                            className={cn(insight.isArchived && "fill-current")}
                          />
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
      </>
    );
  };

  const hasAnyInsights = Object.values(categorizedInsights).some(
    (items) => items.length > 0,
  );

  const { incrementSize, hasReachedEnd } = useInsightPagination();

  // Show loading state while weights data loads, avoid category flicker
  if (isWeightsLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <Spinner size={20} />
        <div className="mt-2 text-sm">{t("common.loading")}</div>
      </div>
    );
  }

  if (!hasAnyInsights) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        {t(
          "insight.noDataPlaceholder.line1",
          "When there are new tracked events, {{name}} will keep an eye on them for you.",
          {
            name: "openloomi",
          },
        )}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <tbody>
          {renderCategoryRows("immediate", categorizedInsights.immediate, true)}
          {renderCategoryRows(
            "high-priority",
            categorizedInsights["high-priority"],
            false,
          )}
          {renderCategoryRows(
            "important-info",
            categorizedInsights["important-info"],
            false,
          )}
          {renderCategoryRows(
            "follow-up",
            categorizedInsights["follow-up"],
            false,
          )}
        </tbody>
      </table>

      <motion.div
        onViewportEnter={() => {
          if (!hasReachedEnd) {
            incrementSize();
          }
        }}
        className="h-10 w-full"
      />

      {!hasReachedEnd && (
        <div className="flex flex-row items-center p-2 text-zinc-500 justify-center">
          <Spinner size={20} />
          <div>{t("common.loading")}</div>
        </div>
      )}
    </div>
  );
}
