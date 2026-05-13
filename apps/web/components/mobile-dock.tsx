"use client";

import { RemixIcon } from "@/components/remix-icon";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export interface MobileDockProps {
  active: "insights" | "assistant";
  onSelectSummaries: () => void;
  onSelectAssistant: () => void;
  onSelectMenu?: () => void;
}

/**
 * Mobile bottom navigation bar component
 * Fixed at the bottom of the page, displayed on all pages
 * @param active - Currently active view
 * @param onSelectSummaries - Callback for selecting the Insights view
 * @param onSelectAssistant - Callback for selecting the Assistant view
 * @param onSelectMenu - Callback for selecting the menu
 */
export function MobileDock({
  active,
  onSelectSummaries,
  onSelectAssistant,
  onSelectMenu,
}: MobileDockProps) {
  const { t } = useTranslation();

  /**
   * Handles menu button click
   */
  const handleMenuClick = () => {
    if (onSelectMenu) {
      onSelectMenu();
    } else {
      // Default behavior: dispatch open sidebar event
      const event = new CustomEvent("openloomi:open-sidebar");
      window.dispatchEvent(event);
    }
  };

  return (
    <nav
      aria-label={t("mobileDock.navigation", "Primary navigation")}
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 safe-area-inset-bottom"
    >
      <div className="mx-auto flex max-w-md items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onSelectSummaries}
          className={cn(
            "flex flex-1 flex-row items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition-colors",
            active === "insights"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted/50",
          )}
          aria-pressed={active === "insights"}
        >
          <RemixIcon name="chart_gantt" size="size-4" className="shrink-0" />
          <span>{t("mobileDock.summaries", "Events")}</span>
        </button>
        <button
          type="button"
          onClick={onSelectAssistant}
          className={cn(
            "flex flex-1 flex-row items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition-colors",
            active === "assistant"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted/50",
          )}
          aria-pressed={active === "assistant"}
        >
          <RemixIcon name="message" size="size-4" className="shrink-0" />
          <span>{t("mobileDock.assistant", "Chats")}</span>
        </button>
        {onSelectMenu !== undefined && (
          <button
            type="button"
            onClick={handleMenuClick}
            className="flex shrink-0 items-center justify-center rounded-lg border border-border/60 bg-transparent p-2 text-muted-foreground transition-colors hover:bg-muted/50"
            aria-label={t("mobileDock.menu", "Menu")}
            title={t("mobileDock.menu", "Menu")}
          >
            <RemixIcon name="menu" size="size-5" className="shrink-0" />
          </button>
        )}
      </div>
    </nav>
  );
}
