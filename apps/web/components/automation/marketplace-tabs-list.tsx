"use client";

import { TabsList, TabsTrigger } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { useTranslation } from "react-i18next";

interface MarketplaceTabsListProps {
  value: string;
  onValueChange: (value: string) => void;
}

/**
 * Top tabs on the marketplace page (Character | Skills), consistent with the library page style:
 * rounded borders, bg-surface-muted/50, button-style tabs.
 */
export function MarketplaceTabsList({
  value,
  onValueChange,
}: MarketplaceTabsListProps) {
  const { t } = useTranslation();

  return (
    <TabsList className="flex gap-1 rounded-lg border border-border/60 p-1 bg-surface-muted/50 overflow-x-auto no-scrollbar h-auto">
      <TabsTrigger
        value="character"
        className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 rounded-md text-sm font-medium transition-colors shrink-0 data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm text-muted-foreground hover:text-foreground hover:bg-surface-hover"
      >
        <RemixIcon
          name="robot_3"
          size="size-4"
          filled={value === "character"}
        />
        <span className="hidden xs:inline">{t("nav.mates", "Mates")}</span>
      </TabsTrigger>
      <TabsTrigger
        value="skills"
        className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 rounded-md text-sm font-medium transition-colors shrink-0 data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm text-muted-foreground hover:text-foreground hover:bg-surface-hover"
      >
        <RemixIcon name="apps_2_ai" size="size-4" filled={value === "skills"} />
        <span className="hidden xs:inline">{t("nav.skills", "Skills")}</span>
      </TabsTrigger>
    </TabsList>
  );
}
