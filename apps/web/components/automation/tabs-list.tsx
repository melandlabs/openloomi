"use client";

import { TabsList, TabsTrigger } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { useTranslation } from "react-i18next";

interface AutomationTabsListProps {
  value: string;
  onValueChange: (value: string) => void;
}

/**
 * Top tabs on the agent page (Automation | Skills), consistent with the library page style:
 * rounded borders, bg-surface-muted/50, button-style tabs.
 * The "New Task" button is placed by the page on the second row, not inside this component.
 */
export function AutomationTabsList({
  value,
  onValueChange,
}: AutomationTabsListProps) {
  const { t } = useTranslation();

  return (
    <TabsList className="flex gap-1 rounded-lg border border-border/60 p-1 bg-surface-muted/50 overflow-x-auto no-scrollbar h-auto">
      <TabsTrigger
        value="automation"
        className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 rounded-md text-sm font-medium transition-colors shrink-0 data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm text-muted-foreground hover:text-foreground hover:bg-surface-hover"
      >
        <RemixIcon name="clock" size="size-4" filled={value === "automation"} />
        <span className="hidden xs:inline">
          {t("nav.automation", "Automation")}
        </span>
      </TabsTrigger>
    </TabsList>
  );
}
