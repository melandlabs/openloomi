"use client";

import { useTranslation } from "react-i18next";
import { Card } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { cn } from "@/lib/utils";

/**
 * Reply option type
 */
export interface ReplyOption {
  framework_type: "ACT" | "ASK" | "ALTER";
  label: string;
  draft: string;
  confidence_score: number;
  is_primary: boolean;
  userLanguageDraft?: string; // Reply content in the user's preferred language (display only, not sent)
}

/**
 * Props for the reply options card component
 */
export interface ReplyOptionsProps {
  options: ReplyOption[];
  onSelect: (option: ReplyOption) => void;
  selectedOptionId?: string | null;
}

/**
 * Reply options card component
 * Displays three reply options (ACT, ASK, ALTER); user can select one
 */
export function ReplyOptions({
  options,
  onSelect,
  selectedOptionId,
}: ReplyOptionsProps) {
  const { t } = useTranslation();

  if (!options || options.length === 0) {
    return null;
  }

  const getFrameworkLabel = (type: string) => {
    switch (type) {
      case "ACT":
        return t("insight.replyOptions.act", "Act");
      case "ASK":
        return t("insight.replyOptions.ask", "Ask");
      case "ALTER":
        return t("insight.replyOptions.alter", "Alter");
      default:
        return type;
    }
  };

  /**
   * Get color style for the framework type (gradient background)
   */
  const getFrameworkColor = (type: string) => {
    switch (type) {
      case "ACT":
        return "border-green-300/30 bg-gradient-to-br from-green-50/60 to-green-50/30";
      case "ASK":
        return "border-blue-300/30 bg-gradient-to-br from-blue-50/60 to-blue-50/30";
      case "ALTER":
        return "border-orange-300/30 bg-gradient-to-br from-orange-50/60 to-orange-50/30";
      default:
        return "border-border/30 bg-muted/30";
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
        {t("insight.replyOptions.title", "Choose a reply option")}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {options.map((option, index) => {
          const optionId = `${option.framework_type}-${index}`;
          const isSelected = selectedOptionId === optionId;
          const isPrimary = option.is_primary;

          return (
            <Card
              key={optionId}
              className={cn(
                "relative cursor-pointer transition-all w-full overflow-hidden",
                getFrameworkColor(option.framework_type),
                isPrimary && "border border-primary/50",
              )}
              onClick={() => onSelect(option)}
            >
              {/* Selected checkmark is in the top-right corner */}
              {isSelected && (
                <div className="absolute right-2 top-2">
                  <RemixIcon
                    name="check"
                    size="size-4"
                    className="text-primary"
                  />
                </div>
              )}
              <div className="p-3">
                <div className="mb-2 flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/70 shrink-0">
                    {getFrameworkLabel(option.framework_type)}
                  </span>
                  {isPrimary && (
                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary shrink-0">
                      {t("insight.replyOptions.recommended", "Recommended")}
                    </span>
                  )}
                </div>
                <div className="text-sm font-medium text-foreground break-words min-w-0">
                  {option.label}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
