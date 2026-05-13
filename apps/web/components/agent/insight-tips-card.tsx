"use client";

import { useCallback, useMemo, useState } from "react";
import { RemixIcon } from "@/components/remix-icon";
import { useTranslation } from "react-i18next";
import "../../i18n";
import { Button } from "@openloomi/ui";

/**
 * Tips data interface
 */
interface Tip {
  id: string;
  title: string;
  content: string;
}

/**
 * Insight Tips card component
 * Shows random tips in empty state, helping users understand openloomi's features and value
 */
export function InsightTipsCard() {
  const { t } = useTranslation();

  /**
   * Get all tips data
   */
  const allTips: Tip[] = useMemo(
    () => [
      {
        id: "platform-integration",
        title: t(
          "insight.tabs.tips.platformIntegration.title",
          "Did you know?",
        ),
        content: t(
          "insight.tabs.tips.platformIntegration.content",
          "Most people switch between multiple platforms throughout the day\nopenloomi brings them together in one manageable view",
        ),
      },
      {
        id: "privacy",
        title: t("insight.tabs.tips.privacy.title", "About Privacy"),
        content: t(
          "insight.tabs.tips.privacy.content",
          "openloomi only keeps structured insights\nOriginal messages are not stored long-term after processing",
        ),
      },
      {
        id: "focus",
        title: t("insight.tabs.tips.focus.title", "About Focus"),
        content: t(
          "insight.tabs.tips.focus.content",
          "Focus shows what matters most right now\nLess noise, not more information",
        ),
      },
      {
        id: "grouping",
        title: t("insight.tabs.tips.grouping.title", "About Grouping"),
        content: t(
          "insight.tabs.tips.grouping.content",
          "You can categorize events by your own rules\nImportant info doesn't have to compete for attention",
        ),
      },
      {
        id: "focus-tips",
        title: t("insight.tabs.tips.focusTips.title", "Focus Tips"),
        content: t(
          "insight.tabs.tips.focusTips.content",
          "Card view is great for understanding context\nTable view is great for clearing your to-do list",
        ),
      },
      {
        id: "favorite",
        title: t("insight.tabs.tips.favorite.title", "Favorites"),
        content: t(
          "insight.tabs.tips.favorite.content",
          "Favorited insights are saved separately\nSo you can quickly return to key points when needed",
        ),
      },
      {
        id: "people",
        title: t("insight.tabs.tips.people.title", "People"),
        content: t(
          "insight.tabs.tips.people.content",
          "openloomi organizes related conversations and commitments under each person\nImportant relationships don't rely on memory",
        ),
      },
      {
        id: "cross-language",
        title: t(
          "insight.tabs.tips.crossLanguage.title",
          "Cross-language Communication",
        ),
        content: t(
          "insight.tabs.tips.crossLanguage.content",
          "openloomi can help you understand and translate before replying\nReducing unnecessary back-and-forth",
        ),
      },
      {
        id: "action-suggestions",
        title: t(
          "insight.tabs.tips.actionSuggestions.title",
          "Action Suggestions",
        ),
        content: t(
          "insight.tabs.tips.actionSuggestions.content",
          "openloomi generates next-step suggestions for Insight events\nWhether to act is always up to you",
        ),
      },
    ],
    [t],
  );

  /**
   * Randomly select initial tip index
   */
  const [currentIndex, setCurrentIndex] = useState(() =>
    Math.floor(Math.random() * allTips.length),
  );

  /**
   * Currently displayed tip
   */
  const currentTip = useMemo(
    () => allTips[currentIndex],
    [allTips, currentIndex],
  );

  /**
   * Randomly switch to a new tip
   */
  const handleRandom = useCallback(() => {
    let newIndex: number;
    do {
      newIndex = Math.floor(Math.random() * allTips.length);
    } while (newIndex === currentIndex && allTips.length > 1);
    setCurrentIndex(newIndex);
  }, [allTips.length, currentIndex]);

  return (
    <div className="mt-2 flex flex-col items-center">
      <div className="relative w-[360px] rounded-2xl border border-border/60 bg-card/50 p-6 shadow-sm backdrop-blur-sm">
        {/* Title and random button */}
        <div className="mb-2 flex items-start justify-between gap-4">
          <div className="flex-1 text-sm font-semibold text-foreground">
            {currentTip.title}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRandom}
            className="h-3 w-3 shrink-0"
            aria-label={t("insight.tabs.tips.random", "Switch tip randomly")}
          >
            <RemixIcon name="shuffle" size="size-3" />
          </Button>
        </div>

        {/* Content */}
        <div className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
          {currentTip.content}
        </div>
      </div>
    </div>
  );
}
