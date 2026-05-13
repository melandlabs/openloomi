"use client";

import { RemixIcon } from "@/components/remix-icon";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@openloomi/ui";
import "../../i18n";

export interface MobileInsightToolbarProps {
  /**
   * Current page type: 'insight' shows "Insight", 'brief' shows "Outlook"
   */
  pageType: "insight" | "brief";
  /**
   * Callback for clicking Insight/Outlook button
   */
  onPageTypeClick?: () => void;
  /**
   * Callback for clicking Chat button
   */
  onChatClick?: () => void;
  /**
   * Callback for clicking Todo button
   */
  onTodoClick?: () => void;
  /**
   * Callback for clicking Favorite button
   */
  onFavoriteClick?: () => void;
  /**
   * Callback for clicking People button
   */
  onPeopleClick?: () => void;
}

/**
 * Mobile bottom menu bar for Insight box and Brief pages
 * Contains three main buttons: Insight/Outlook, Chat, and More (Todo, Favorite, People)
 */
export function MobileInsightToolbar({
  pageType,
  onPageTypeClick,
  onChatClick,
  onTodoClick,
  onFavoriteClick,
  onPeopleClick,
}: MobileInsightToolbarProps) {
  const { t } = useTranslation();

  /**
   * Handle page type button click
   */
  const handlePageTypeClick = () => {
    if (onPageTypeClick) {
      onPageTypeClick();
    }
  };

  /**
   * Handle Chat button click
   */
  const handleChatClick = () => {
    if (onChatClick) {
      onChatClick();
    }
  };

  return (
    <nav
      aria-label={t("mobileInsightToolbar.navigation", "Insight navigation")}
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 safe-area-inset-bottom"
    >
      <div className="mx-auto flex max-w-md items-center gap-2 px-3 py-2">
        {/* Insight or Outlook button */}
        <button
          type="button"
          onClick={handlePageTypeClick}
          className={cn(
            "flex flex-1 flex-row items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition-colors",
            "bg-primary text-primary-foreground",
          )}
          aria-label={
            pageType === "insight"
              ? t("mobileInsightToolbar.insight", "Insight")
              : t("mobileInsightToolbar.outlook", "Outlook")
          }
        >
          {pageType === "insight" ? (
            <RemixIcon name="chart_gantt" size="size-4" className="shrink-0" />
          ) : (
            <RemixIcon name="file_text" size="size-4" className="shrink-0" />
          )}
          <span>
            {pageType === "insight"
              ? t("mobileInsightToolbar.insight", "Insight")
              : t("mobileInsightToolbar.outlook", "Outlook")}
          </span>
        </button>

        {/* Chat button */}
        <button
          type="button"
          onClick={handleChatClick}
          className={cn(
            "flex flex-1 flex-row items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition-colors",
            "text-muted-foreground hover:bg-muted/50",
          )}
          aria-label={t("mobileInsightToolbar.chat", "Chat")}
        >
          <RemixIcon name="message" size="size-4" className="shrink-0" />
          <span>{t("mobileInsightToolbar.chat", "Chat")}</span>
        </button>

        {/* More dropdown menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex flex-1 flex-row items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition-colors",
                "text-muted-foreground hover:bg-muted/50",
              )}
              aria-label={t("mobileInsightToolbar.more", "More")}
            >
              <RemixIcon
                name="more_vertical"
                size="size-4"
                className="shrink-0"
              />
              <span>{t("mobileInsightToolbar.more", "More")}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="mb-2 w-48">
            <DropdownMenuItem
              onClick={onTodoClick}
              className="flex items-center gap-2"
            >
              <RemixIcon name="clipboard_list" size="size-4" />
              <span>{t("agent.toolbar.todo", "Todo")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onFavoriteClick}
              className="flex items-center gap-2"
            >
              <RemixIcon name="star" size="size-4" />
              <span>{t("agent.toolbar.favorite", "Favorite")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onPeopleClick}
              className="flex items-center gap-2"
            >
              <RemixIcon name="contacts" size="size-4" />
              <span>{t("agent.toolbar.people", "People")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
