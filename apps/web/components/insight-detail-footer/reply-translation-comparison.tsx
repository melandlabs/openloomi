"use client";

import { useTranslation } from "react-i18next";
import { Card } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { htmlToPlainText } from "./utils";
import { cn } from "@/lib/utils";

/**
 * Props for the translation comparison card component
 */
export interface ReplyTranslationComparisonProps {
  /**
   * Translated content (HTML format)
   */
  translatedContent: string;
  /**
   * Target language label
   */
  targetLanguageLabel: string;
  /**
   * Detected source language
   */
  detectedLanguage?: string | null;
  /**
   * Callback to confirm translation (confirm and keep the translated content)
   */
  onConfirm: () => void;
  /**
   * Callback to undo translation (close and restore original content)
   */
  onUndo: () => void;
  /**
   * Custom class name
   */
  className?: string;
}

/**
 * Translation comparison card component
 * Displays the translated content for user to confirm
 */
export function ReplyTranslationComparison({
  translatedContent,
  targetLanguageLabel,
  detectedLanguage,
  onConfirm,
  onUndo,
  className,
}: ReplyTranslationComparisonProps) {
  const { t } = useTranslation();

  const translatedText = htmlToPlainText(translatedContent);

  return (
    <Card
      className={cn(
        "relative border-2 border-primary/20 bg-gradient-to-br from-blue-50/50 to-purple-50/30 p-4 shadow-sm",
        className,
      )}
    >
      {/* Action buttons */}
      <div className="absolute right-2 top-2 flex items-center gap-1">
        {/* Confirm button */}
        <button
          type="button"
          onClick={onConfirm}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors hover:bg-primary/20 hover:text-primary"
          aria-label={t(
            "insight.translationComparison.confirm",
            "Confirm translation",
          )}
        >
          <RemixIcon name="check" size="size-3.5" />
        </button>
        {/* Undo button */}
        <button
          type="button"
          onClick={onUndo}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-white/80 text-muted-foreground transition-colors hover:bg-white hover:text-foreground"
          aria-label={t(
            "insight.translationComparison.undo",
            "Undo translation",
          )}
        >
          <RemixIcon name="close" size="size-3.5" />
        </button>
      </div>

      {/* Title */}
      <div className="mb-3 pr-16">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            {t("insight.translationComparison.title", "Translation")}
          </h3>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {targetLanguageLabel}
          </span>
        </div>
      </div>

      {/* Translated content */}
      <div className="text-sm leading-relaxed text-foreground">
        <p className="whitespace-pre-wrap break-words">{translatedText}</p>
      </div>
    </Card>
  );
}
