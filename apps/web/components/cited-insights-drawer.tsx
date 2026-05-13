"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@openloomi/ui";
import { ScrollArea } from "@openloomi/ui";
import { InsightCard } from "@/components/insight-card";
import type { Insight } from "@/lib/db/schema";
import { useTranslation } from "react-i18next";

/**
 * Cited Insights drawer component
 * Displays all Insight event cards cited in messages
 */
export function CitedInsightsDrawer({
  insights,
  isOpen,
  onClose,
  onSelectInsight,
}: {
  insights: Insight[];
  isOpen: boolean;
  onClose: () => void;
  onSelectInsight?: (insight: Insight) => void;
}) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent
        side="right"
        className="w-full sm:w-[540px] p-0 flex flex-col"
      >
        <SheetHeader className="px-6 py-4 bg-card shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-lg font-semibold">
              {t("common.sources", "Sources")}
            </SheetTitle>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1 px-6 py-4">
          <div className="space-y-0">
            {insights.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                {t("common.noSources", "No cited sources")}
              </div>
            ) : (
              insights.map((insight) => (
                <div key={insight.id} className="rounded-2xl">
                  <InsightCard
                    {...insight}
                    isSelected={false}
                    onSelect={(selectedInsight) => {
                      onSelectInsight?.(selectedInsight);
                      onClose();
                    }}
                  />
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
