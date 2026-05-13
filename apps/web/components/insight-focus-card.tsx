"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RemixIcon } from "@/components/remix-icon";
import { Button } from "@openloomi/ui";
import type { Insight } from "@/lib/db/schema";
import { AgentEmptyState } from "@/components/agent/agent-empty-state";

/**
 * Daily statistics data type for calendar view
 */
export type DailyStats = {
  totalMessages: number;
  urgentCount: number;
  mentionsCount: number;
  importantCount: number;
  actionItemsCount: number;
};

/**
 * Events organized by category
 */
export type CategorizedInsights = {
  immediate: Insight[]; // Needs immediate action
  highPriority: Insight[]; // High priority pending tasks
  importantInfo: Insight[]; // Important information
  followUp: Insight[]; // Follow up
};

/**
 * Daily summary type for calendar view
 */
export type FocusDayInsight = {
  date: string;
  dateString: string;
  stats: DailyStats;
  categorizedInsights: CategorizedInsights;
  mainEvents: Insight[];
  actionItems: Insight[];
  unrepliedMessages: Insight[];
};

/**
 * Focus card component props
 */
export interface InsightFocusCardProps {
  daySummary: FocusDayInsight;
  onSelectInsight: (insight: Insight) => void;
  onDeleteInsight: (insight: Insight) => void;
  onViewHistory?: () => void;
  isHistoryActive?: boolean;
  isToday?: boolean;
  historyDays?: number;
  hideEmptyCategories?: boolean;
  onToggleHideEmptyCategories?: () => void;
}

/**
 * Get icon component for category
 * @param category - Category name
 * @returns Icon component
 */
const getCategoryIcon = (category: string) => {
  switch (category) {
    case "immediate":
      return <RemixIcon name="siren" size="size-4" className="mr-2" />;
    case "highPriority":
      return <RemixIcon name="flashlight" size="size-4" className="mr-2" />;
    case "importantInfo":
      return <RemixIcon name="focus" size="size-4" className="mr-2" />;
    case "followUp":
      return <RemixIcon name="bell" size="size-4" className="mr-2" />;
    default:
      return null;
  }
};

/**
 * Get gradient background style for category
 * @param category - Category name
 * @returns Gradient background className
 */
const getCategoryGradient = (category: string) => {
  switch (category) {
    case "immediate":
      return "bg-gradient-to-br from-red-50/50 via-red-50/30 to-transparent";
    case "highPriority":
      return "bg-gradient-to-br from-orange-50/50 via-orange-50/30 to-transparent";
    case "importantInfo":
      return "bg-gradient-to-br from-blue-50/50 via-blue-50/30 to-transparent";
    case "followUp":
      return "bg-gradient-to-br from-gray-50/50 via-gray-50/30 to-transparent";
    default:
      return "";
  }
};

/**
 * Focus card component
 * Displays daily focus event categories, including immediate handling, important todos, key information, and follow-up items
 *
 * @param props - Component props
 * @returns Focus card component
 */
export function InsightFocusCard({
  daySummary,
  onSelectInsight,
  onDeleteInsight,
  onViewHistory,
  isHistoryActive = false,
  isToday = false,
  historyDays,
  hideEmptyCategories = false,
  onToggleHideEmptyCategories,
}: InsightFocusCardProps) {
  const { t } = useTranslation();

  // Manage collapsed state for each category
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    new Set(),
  );

  /**
   * Toggle collapsed state of category
   * @param category - Category name
   */
  const toggleCategory = (category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  /**
   * Check if category is collapsed
   * @param category - Category name
   * @returns Whether collapsed
   */
  const isCategoryCollapsed = (category: string) => {
    return collapsedCategories.has(category);
  };

  // Determine title display based on whether it's today
  const cardTitle = isToday ? t("insight.focus") : daySummary.date;

  // Get count for each category
  const categoryCounts = {
    immediate: daySummary.categorizedInsights.immediate.length,
    highPriority: daySummary.categorizedInsights.highPriority.length,
    importantInfo: daySummary.categorizedInsights.importantInfo.length,
    followUp: daySummary.categorizedInsights.followUp.length,
  };

  // Check if all categories are empty
  const allCategoriesEmpty =
    categoryCounts.immediate === 0 &&
    categoryCounts.highPriority === 0 &&
    categoryCounts.importantInfo === 0 &&
    categoryCounts.followUp === 0;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden transition-all bg-white min-h-[400px]">
      {/* Date title bar - reduced padding on mobile */}
      <div className="bg-gray-50 px-4 py-2 md:py-3 border-b border-gray-200 flex items-center justify-between">
        <h3 className="font-semibold text-gray-800 text-base flex items-center gap-2">
          {isToday && (
            <RemixIcon name="target" size="size-5" className="text-blue-500" />
          )}
          {cardTitle}
        </h3>
        <div className="flex items-center gap-2">
          {/* Empty category button - only shown on today's card */}
          {isToday && onToggleHideEmptyCategories && (
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleHideEmptyCategories}
              className="h-7 text-xs transition-all border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
              title={
                hideEmptyCategories
                  ? t("insight.showEmptyCategories", "Empty category")
                  : t("insight.hideEmptyCategories", "Empty category")
              }
            >
              {hideEmptyCategories ? (
                <>
                  <RemixIcon
                    name="eye_off"
                    size="size-3.5"
                    className="mr-1.5"
                  />
                  <span className="hidden sm:inline">
                    {t("insight.showEmptyCategories", "Empty category")}
                  </span>
                </>
              ) : (
                <>
                  <RemixIcon name="eye" size="size-3.5" className="mr-1.5" />
                  <span className="hidden sm:inline">
                    {t("insight.hideEmptyCategories", "Empty category")}
                  </span>
                </>
              )}
            </Button>
          )}
          {onViewHistory && (
            <Button
              variant="outline"
              size="sm"
              onClick={onViewHistory}
              className={`h-7 text-xs transition-all ${
                isHistoryActive
                  ? "border-primary text-primary bg-primary/5 hover:bg-primary/10"
                  : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              <RemixIcon name="calendar" size="size-3.5" className="mr-1.5" />
              {t("insight.history", "History")}
            </Button>
          )}
        </div>
      </div>

      {/* Main content area - reduced padding on mobile */}
      <div className="p-3 md:p-4 space-y-3">
        {/* Focus description */}
        {isToday && (
          <div className="mb-3">
            <p className="text-sm italic text-muted-foreground/60">
              {t("insight.taglineConnectedWithHistory", {
                defaultValue:
                  "Highlights using the last {{days}} days of history from every connected channel.",
                days: historyDays,
              })}
            </p>
          </div>
        )}

        {/* Immediate handling */}
        {(!hideEmptyCategories || categoryCounts.immediate > 0) && (
          <div
            className={`rounded-lg border border-gray-200/60 p-3 transition-all ${getCategoryGradient("immediate")}`}
          >
            <button
              type="button"
              onClick={() => toggleCategory("immediate")}
              className="w-full font-medium text-gray-800 mb-2 flex items-center justify-between hover:opacity-80 transition-opacity"
            >
              <div className="flex items-center">
                {getCategoryIcon("immediate")}
                <span>
                  {t("insight.focusCategories.immediate")}
                  <span className="text-muted-foreground font-normal ml-1">
                    ({categoryCounts.immediate})
                  </span>
                </span>
              </div>
              {isCategoryCollapsed("immediate") ? (
                <RemixIcon
                  name="chevron_right"
                  size="size-4"
                  className="text-muted-foreground"
                />
              ) : (
                <RemixIcon
                  name="chevron_down"
                  size="size-4"
                  className="text-muted-foreground"
                />
              )}
            </button>
            {!isCategoryCollapsed("immediate") && (
              <div className="space-y-2 pl-6">
                {daySummary.categorizedInsights.immediate.map((item) => (
                  <div
                    key={`immediate-${item.id}`}
                    className="text-sm text-gray-700 hover:text-gray-900 cursor-pointer"
                    role="button"
                    onClick={() => onSelectInsight(item)}
                  >
                    {item.title}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* High priority todos */}
        {(!hideEmptyCategories || categoryCounts.highPriority > 0) && (
          <div
            className={`rounded-lg border border-gray-200/60 p-3 transition-all ${getCategoryGradient("highPriority")}`}
          >
            <button
              type="button"
              onClick={() => toggleCategory("highPriority")}
              className="w-full font-medium text-gray-800 mb-2 flex items-center justify-between hover:opacity-80 transition-opacity"
            >
              <div className="flex items-center">
                {getCategoryIcon("highPriority")}
                <span>
                  {t("insight.focusCategories.highPriority", "Important tasks")}
                  <span className="text-muted-foreground font-normal ml-1">
                    ({categoryCounts.highPriority})
                  </span>
                </span>
              </div>
              {isCategoryCollapsed("highPriority") ? (
                <RemixIcon
                  name="chevron_right"
                  size="size-4"
                  className="text-muted-foreground"
                />
              ) : (
                <RemixIcon
                  name="chevron_down"
                  size="size-4"
                  className="text-muted-foreground"
                />
              )}
            </button>
            {!isCategoryCollapsed("highPriority") && (
              <div className="space-y-2 pl-6">
                {daySummary.categorizedInsights.highPriority.map((item) => (
                  <div
                    key={`high-priority-${item.id}`}
                    className="text-sm text-gray-700 hover:text-gray-900 cursor-pointer"
                    role="button"
                    onClick={() => onSelectInsight(item)}
                  >
                    {item.title}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Follow-up info */}
        {(!hideEmptyCategories || categoryCounts.importantInfo > 0) && (
          <div
            className={`rounded-lg border border-gray-200/60 p-3 transition-all ${getCategoryGradient("importantInfo")}`}
          >
            <button
              type="button"
              onClick={() => toggleCategory("importantInfo")}
              className="w-full font-medium text-gray-800 mb-2 flex items-center justify-between hover:opacity-80 transition-opacity"
            >
              <div className="flex items-center">
                {getCategoryIcon("importantInfo")}
                <span>
                  {t(
                    "insight.focusCategories.importantInfo",
                    "Key information",
                  )}
                  <span className="text-muted-foreground font-normal ml-1">
                    ({categoryCounts.importantInfo})
                  </span>
                </span>
              </div>
              {isCategoryCollapsed("importantInfo") ? (
                <RemixIcon
                  name="chevron_right"
                  size="size-4"
                  className="text-muted-foreground"
                />
              ) : (
                <RemixIcon
                  name="chevron_down"
                  size="size-4"
                  className="text-muted-foreground"
                />
              )}
            </button>
            {!isCategoryCollapsed("importantInfo") && (
              <div className="space-y-2 pl-6">
                {daySummary.categorizedInsights.importantInfo.map((item) => (
                  <div
                    key={`important-info-${item.id}`}
                    className="text-sm text-gray-700 hover:text-gray-900 cursor-pointer"
                    role="button"
                    onClick={() => onSelectInsight(item)}
                  >
                    {item.title}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Needs follow-up */}
        {(!hideEmptyCategories || categoryCounts.followUp > 0) && (
          <div
            className={`rounded-lg border border-gray-200/60 p-3 transition-all ${getCategoryGradient("followUp")}`}
          >
            <button
              type="button"
              onClick={() => toggleCategory("followUp")}
              className="w-full font-medium text-gray-800 mb-2 flex items-center justify-between hover:opacity-80 transition-opacity"
            >
              <div className="flex items-center">
                {getCategoryIcon("followUp")}
                <span>
                  {t("insight.focusCategories.followUp", "Needs follow-up")}
                  <span className="text-muted-foreground font-normal ml-1">
                    ({categoryCounts.followUp})
                  </span>
                </span>
              </div>
              {isCategoryCollapsed("followUp") ? (
                <RemixIcon
                  name="chevron_right"
                  size="size-4"
                  className="text-muted-foreground"
                />
              ) : (
                <RemixIcon
                  name="chevron_down"
                  size="size-4"
                  className="text-muted-foreground"
                />
              )}
            </button>
            {!isCategoryCollapsed("followUp") && (
              <div className="space-y-2 pl-6">
                {daySummary.categorizedInsights.followUp.map((item) => (
                  <div
                    key={`follow-up-${item.id}`}
                    className="text-sm text-gray-700 hover:text-gray-900 cursor-pointer"
                    role="button"
                    onClick={() => onSelectInsight(item)}
                  >
                    {item.title}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty state message - when all categories are empty and empty categories are not shown */}
        {allCategoriesEmpty && hideEmptyCategories && isToday && (
          <AgentEmptyState
            avatar={
              <RemixIcon
                name="target"
                size="size-12"
                className="text-muted-foreground/40"
              />
            }
            className="py-12 px-4"
          >
            <h4 className="text-base font-medium text-foreground mb-2">
              {t("insight.focusEmptyState.title", "Focus module")}
            </h4>
            <p className="text-sm text-muted-foreground mb-4 max-w-md">
              {t("insight.focusEmptyState.description", {
                defaultValue:
                  "Based on your traceable {{days}} days of history, extract key points from your authorized channels. Authorizing more platforms gives you more comprehensive insights.",
                days: historyDays,
              })}
            </p>
            <p className="text-xs text-muted-foreground/80">
              {t(
                "insight.focusEmptyState.hint",
                "Authorize more platforms for more comprehensive insights",
              )}
            </p>
          </AgentEmptyState>
        )}

        {/* Empty state message - when all categories are empty but empty categories are shown */}
        {allCategoriesEmpty && !hideEmptyCategories && (
          <AgentEmptyState className="py-4">
            <span className="text-sm italic">
              {t("insight.noEvents", "Nothing major happened here.")}
            </span>
          </AgentEmptyState>
        )}
      </div>
    </div>
  );
}
