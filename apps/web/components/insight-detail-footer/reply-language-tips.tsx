"use client";

import { useTranslation } from "react-i18next";
import { Card } from "@openloomi/ui";
import { htmlToPlainText } from "./utils";
import { cn } from "@/lib/utils";

/**
 * Props for the reply language tips card component
 */
export interface ReplyLanguageTipsProps {
  /**
   * Reply content in the user's preferred language (HTML format)
   */
  userLanguageDraft: string | null;
  /**
   * Currently selected reply option type (used to match styles)
   */
  selectedFrameworkType?: "ACT" | "ASK" | "ALTER" | null;
  /**
   * Custom class name
   */
  className?: string;
}

/**
 * Get color style for the framework type (consistent with reply options card)
 */
const getFrameworkColor = (type?: "ACT" | "ASK" | "ALTER" | null) => {
  switch (type) {
    case "ACT":
      return {
        border: "border-green-300/30",
        background: "bg-gradient-to-br from-green-50/60 to-green-50/30",
        text: "text-gray-900",
        hint: "text-gray-600/80",
      };
    case "ASK":
      return {
        border: "border-blue-300/30",
        background: "bg-gradient-to-br from-blue-50/60 to-blue-50/30",
        text: "text-gray-900",
        hint: "text-gray-600/80",
      };
    case "ALTER":
      return {
        border: "border-orange-300/30",
        background: "bg-gradient-to-br from-orange-50/60 to-orange-50/30",
        text: "text-gray-900",
        hint: "text-gray-600/80",
      };
    default:
      return {
        border: "border-blue-300/30",
        background: "bg-gradient-to-br from-blue-50/60 to-blue-50/30",
        text: "text-gray-900",
        hint: "text-gray-600/80",
      };
  }
};

/**
 * Reply language tips card component
 * Displays reply content in the user's preferred language above the rich text editor for reference
 */
export function ReplyLanguageTips({
  userLanguageDraft,
  selectedFrameworkType,
  className,
}: ReplyLanguageTipsProps) {
  const { t } = useTranslation();

  console.log("[ReplyLanguageTips] Component called:", {
    hasUserLanguageDraft: !!userLanguageDraft,
    userLanguageDraftLength: userLanguageDraft?.length ?? 0,
    userLanguageDraftType: typeof userLanguageDraft,
    userLanguageDraftPreview: userLanguageDraft?.slice(0, 100),
    selectedFrameworkType,
  });

  if (!userLanguageDraft || userLanguageDraft.trim() === "") {
    console.log(
      "[ReplyLanguageTips] No userLanguageDraft or empty, returning null",
    );
    return null;
  }

  const plainText = htmlToPlainText(userLanguageDraft);
  if (!plainText || plainText.trim() === "") {
    console.log(
      "[ReplyLanguageTips] Plain text is empty after conversion, returning null",
    );
    return null;
  }

  const colors = getFrameworkColor(selectedFrameworkType);

  return (
    <Card
      className={cn(
        colors.border,
        colors.background,
        "p-3 shadow-sm mt-2",
        className,
      )}
    >
      <div className="space-y-1">
        <p className={cn("text-xs italic", colors.hint)}>
          {t(
            "insight.userLanguageTips.hint",
            "This content is for reference only. The actual reply sent will use the recipient's language.",
          )}
        </p>
      </div>
    </Card>
  );
}
