"use client";

import { RemixIcon } from "@/components/remix-icon";
import { Button } from "@openloomi/ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@openloomi/ui";
import { useIsMobile } from "@openloomi/hooks/use-is-mobile";
import { cn, getHomePath } from "@/lib/utils";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import "../../i18n";

export interface ResponsiveToolbarProps {
  /**
   * Current page type: 'insight' shows "Insight", 'brief' shows "Outlook" (mobile only)
   */
  pageType?: "insight" | "brief";
  /**
   * Mobile currently active panel (for highlighting)
   */
  activePanel?:
    | "insight"
    | "brief"
    | "chat"
    | "favorite"
    | "messages"
    | "files";
  /**
   * Click Insight/Outlook button callback (mobile only)
   */
  onPageTypeClick?: () => void;
  /**
   * Click Chat button callback
   */
  onAskAiClick?: () => void;
  /**
   * Click Favorite button callback
   */
  onFavoriteClick?: () => void;
  /**
   * Click Messages button callback
   */
  onMessagesClick?: () => void;
  /**
   * Unread message count (for showing red dot badge)
   */
  unreadMessagesCount?: number;
}

/**
 * Responsive toolbar component
 * Desktop: shown as right-side vertical toolbar
 * Mobile: shown as bottom horizontal menu bar
 */
export function ResponsiveToolbar({
  pageType = "insight",
  activePanel,
  onPageTypeClick,
  onAskAiClick,
  onFavoriteClick,
}: ResponsiveToolbarProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isPeopleDetailOpen, setIsPeopleDetailOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  /**
   * Detect if Insight detail drawer and person detail are open
   * Checks by listening to data attributes on body
   */
  useEffect(() => {
    if (!isMobile || typeof document === "undefined") return;

    const checkDrawerState = () => {
      const insightOpen = document.body.hasAttribute(
        "data-insight-drawer-open",
      );
      const peopleOpen = document.body.hasAttribute("data-people-detail-open");
      setIsDrawerOpen(insightOpen);
      setIsPeopleDetailOpen(peopleOpen);
    };

    // Initial check
    checkDrawerState();

    // Use MutationObserver to listen for body attribute changes
    const observer = new MutationObserver(checkDrawerState);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-insight-drawer-open", "data-people-detail-open"],
    });

    return () => {
      observer.disconnect();
    };
  }, [isMobile]);

  /**
   * Handle Chat button click
   */
  const handleAskAiClick = () => {
    if (onAskAiClick) {
      onAskAiClick();
      return;
    }
    // Otherwise navigate to root path (on other pages)
    router.push(getHomePath());
    router.refresh();
  };

  // Desktop: vertical toolbar
  // Wait for mount to prevent hydration mismatch
  if (!mounted) {
    return null;
  }

  if (!isMobile) {
    // Build toolbar items (action items and people moved to Library, only Ask AI remains)
    const baseToolbarItems = [
      {
        key: "askAi",
        icon: "chat",
        label: t("agent.toolbar.askAi", "ASK AI"),
      },
    ];

    const toolbarItems = baseToolbarItems;

    const handleButtonClick = (key: string) => {
      if (key === "askAi") {
        handleAskAiClick();
        return;
      }
      if (key === "favorite" && onFavoriteClick) {
        onFavoriteClick();
        return;
      }
    };

    return (
      <div className="flex h-full flex-col items-center gap-2 py-2 pr-4">
        {toolbarItems.map((item, index) => {
          const isActive = false;
          return (
            <div key={item.key} className="flex flex-col items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-12 w-12 rounded-lg transition-all duration-200 hover:bg-accent hover:text-accent-foreground",
                      isActive && "bg-accent text-accent-foreground",
                    )}
                    onClick={() => handleButtonClick(item.key)}
                    aria-label={item.label}
                    aria-pressed={isActive}
                    suppressHydrationWarning
                  >
                    {typeof item.icon === "string" ? (
                      <RemixIcon name={item.icon} size="size-5" />
                    ) : (
                      (() => {
                        const IconComponent = item.icon as React.ComponentType<{
                          className?: string;
                        }>;
                        return <IconComponent className="size-5" />;
                      })()
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left" sideOffset={8} className="z-[9999]">
                  <p>{item.label}</p>
                </TooltipContent>
              </Tooltip>
              {/* Add divider between chat button and other buttons */}
              {index === 0 && (
                <div className="h-px w-8 bg-border" aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Mobile: bottom horizontal menu bar
  // Hide bottom menu when Insight detail drawer or person detail is open
  if (isMobile && (isDrawerOpen || isPeopleDetailOpen)) {
    return null;
  }

  return (
    <nav
      aria-label={t("mobileInsightToolbar.navigation", "Insight navigation")}
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 safe-area-inset-bottom"
    >
      <div className="mx-auto flex max-w-md items-center gap-2 px-3 py-2">
        {/* Insight or Focus button */}
        {onPageTypeClick && (
          <button
            type="button"
            onClick={onPageTypeClick}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 py-2 text-xs transition-colors",
              // If currently active panel is insight or brief, highlight: text and icon turn blue, text bold
              activePanel === "insight" || activePanel === "brief"
                ? "text-primary"
                : "text-muted-foreground",
            )}
            aria-label={
              pageType === "insight"
                ? t("mobileInsightToolbar.insight", "Insights")
                : t("mobileInsightToolbar.focus", "Focus")
            }
          >
            <RemixIcon
              name={
                pageType === "insight" ? "auto_awesome_motion" : "track_changes"
              }
              size="size-6"
              filled={activePanel === "insight" || activePanel === "brief"}
              className={cn(
                (activePanel === "insight" || activePanel === "brief") &&
                  "text-primary",
              )}
            />
            <span
              className={cn(
                (activePanel === "insight" || activePanel === "brief") &&
                  "font-semibold text-primary",
              )}
            >
              {pageType === "insight"
                ? t("mobileInsightToolbar.insight", "Insights")
                : t("mobileInsightToolbar.focus", "Focus")}
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={handleAskAiClick}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-1 py-2 text-xs transition-colors",
            activePanel === "chat" ? "text-primary" : "text-muted-foreground",
          )}
          aria-label={t("mobileInsightToolbar.openloomi", "openloomi")}
        >
          <RemixIcon
            name="chat"
            size="size-6"
            filled={activePanel === "chat"}
            className={cn(activePanel === "chat" && "text-primary")}
          />
          <span
            className={cn(
              activePanel === "chat" && "font-semibold text-primary",
            )}
          >
            {t("mobileInsightToolbar.openloomi", "openloomi")}
          </span>
        </button>
      </div>
    </nav>
  );
}
