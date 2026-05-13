"use client";

import { useMemo, memo } from "react";
import { useTranslation } from "react-i18next";
import { RemixIcon } from "@/components/remix-icon";
import { useChatContext } from "./chat-context";
import { useGlobalInsightDrawer } from "@/components/global-insight-drawer";
import { InsightBadge } from "./insight-badge";
import { Button } from "@openloomi/ui";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@openloomi/ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@openloomi/ui";
import { cn } from "@/lib/utils";

interface FocusedInsightCardProps {
  floating?: boolean;
}

const rowBase =
  "flex items-center gap-3 py-3 px-4 shadow-none transition-colors min-h-[44px]";

/**
 * Focused event accordion: single event shows only name; multiple events show collapsed "N linked tracking events" with expand to list event names.
 * In floating mode, it floats below the header without occupying scroll area height (provided by FocusedInsightFloatingBar).
 */
export const FocusedInsightCard = memo(function FocusedInsightCard({
  floating = false,
}: FocusedInsightCardProps) {
  const { t } = useTranslation();
  const { focusedInsights, removeFocusedInsight } = useChatContext();
  const { openDrawer } = useGlobalInsightDrawer();

  if (focusedInsights.length === 0) {
    return null;
  }

  const hasMultipleInsights = focusedInsights.length > 1;
  /** Right side of accordion header: deduplicate by platform, show only one badge per platform */
  const uniquePlatformsForHeader = useMemo(() => {
    const seen = new Set<string>();
    return focusedInsights
      .filter((i) => i.groups && i.groups.length > 0)
      .map((i) => i.platform || i.details?.[0]?.platform)
      .filter((p): p is string => {
        if (!p || seen.has(p)) return false;
        seen.add(p);
        return true;
      });
  }, [focusedInsights]);
  const cardClassName = cn(
    rowBase,
    "bg-card rounded-2xl border border-border shadow-sm",
    floating && "backdrop-blur-md",
  );
  const itemClassName = cn(
    rowBase,
    "bg-white rounded-none border-0",
    floating && "backdrop-blur-md",
  );

  // Single event: no accordion, only shows event name + close
  if (!hasMultipleInsights) {
    const insight = focusedInsights[0];
    return (
      <div
        className={cn("mx-auto w-full max-w-3xl", floating ? "mb-0" : "mb-3")}
      >
        <div className={cn(cardClassName, "bg-white", "gap-1")}>
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <button
              type="button"
              onClick={() => openDrawer(insight)}
              className="text-sm font-normal text-primary-700 line-clamp-2 min-w-0 text-left hover:underline cursor-pointer bg-transparent border-0 p-0"
              title={insight.title}
            >
              {insight.title}
            </button>
            {insight.groups && insight.groups.length > 0 && (
              <InsightBadge
                type="channel"
                platform={
                  insight.platform ||
                  insight.details?.[0]?.platform ||
                  undefined
                }
                iconSize="size-3"
                iconOnly
                className="shrink-0 !p-0.5 !min-h-0 aspect-square !size-5 rounded-full"
              />
            )}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                onClick={() => removeFocusedInsight(insight.id)}
                aria-label={t("insight.removeFocus", "Remove this focus")}
              >
                <RemixIcon name="close" size="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t("insight.removeFocusHint", "Remove this focus topic")}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    );
  }

  // Multiple events: accordion, collapsed by default, title shows "N linked tracking events", expanded shows event names below
  return (
    <div className={cn("mx-auto w-full max-w-3xl", floating ? "mb-0" : "mb-3")}>
      <div
        className={cn(
          "overflow-hidden rounded-2xl border border-border bg-white shadow-sm",
          floating && "backdrop-blur-md",
        )}
      >
        <Accordion type="single" collapsible defaultValue="" className="w-full">
          <AccordionItem value="list" className="border-b-0">
            <AccordionTrigger
              className={cn(
                cardClassName,
                "rounded-none bg-primary-50 border-0 shadow-none backdrop-blur-none flex-row gap-1 hover:no-underline [&[data-state=closed]>*:last-child]:-rotate-90 [&[data-state=open]>*:last-child]:rotate-0",
              )}
            >
              <div className="flex flex-1 items-center gap-2 min-w-0">
                <span className="text-sm font-medium text-primary-700 shrink-0 text-left">
                  {t(
                    "insight.linkedTrackings",
                    "{{count}} tracking events linked",
                    {
                      count: focusedInsights.length,
                    },
                  )}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  {uniquePlatformsForHeader.map((platform) => (
                    <InsightBadge
                      key={platform}
                      type="channel"
                      platform={platform}
                      iconSize="size-3"
                      iconOnly
                      className="shrink-0 rounded-full !p-0.5 !min-h-0 aspect-square !size-5"
                    />
                  ))}
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-0 pb-0">
              <div className="space-y-0">
                {focusedInsights.map((insight) => (
                  <div
                    key={insight.id}
                    className={cn(itemClassName, "gap-1 pr-3")}
                  >
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <button
                        type="button"
                        onClick={() => openDrawer(insight)}
                        className="text-sm font-normal text-primary-700 line-clamp-2 min-w-0 text-left hover:underline cursor-pointer bg-transparent border-0 p-0"
                        title={insight.title}
                      >
                        {insight.title}
                      </button>
                      {insight.groups && insight.groups.length > 0 && (
                        <InsightBadge
                          type="channel"
                          platform={
                            insight.platform ||
                            insight.details?.[0]?.platform ||
                            undefined
                          }
                          iconSize="size-3"
                          iconOnly
                          className="shrink-0 !p-0.5 !min-h-0 aspect-square !size-5 rounded-full"
                        />
                      )}
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                          onClick={() => removeFocusedInsight(insight.id)}
                          aria-label={t(
                            "insight.removeFocus",
                            "Remove this focus",
                          )}
                        >
                          <RemixIcon name="close" size="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          {t(
                            "insight.removeFocusHint",
                            "Remove this focus topic",
                          )}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  );
});
