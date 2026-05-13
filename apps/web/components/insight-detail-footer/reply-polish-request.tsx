"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Textarea } from "@openloomi/ui";
import { Spinner } from "@/components/spinner";
import { RemixIcon } from "@/components/remix-icon";
import { cn } from "@/lib/utils";

/**
 * Props for the polish request input component
 */
export interface ReplyPolishRequestProps {
  /**
   * Callback to confirm the polish requirement (receives the polish requirement text)
   */
  onConfirm: (requirement: string) => void;
  /**
   * Callback to cancel the polish requirement (optional; used for keyboard ESC etc.)
   */
  onCancel?: () => void;
  /**
   * Whether it is currently loading
   */
  isLoading?: boolean;
  /**
   * Custom class name
   */
  className?: string;
}

/**
 * Polish request input component
 * Displayed inside the rich text editor for user to enter polish requirements
 */
export function ReplyPolishRequest({
  onConfirm,
  onCancel,
  isLoading = false,
  className,
}: ReplyPolishRequestProps) {
  const { t } = useTranslation();
  const [requirement, setRequirement] = useState("");

  /**
   * Handle confirm button click
   */
  const handleConfirm = () => {
    if (requirement.trim()) {
      onConfirm(requirement.trim());
    }
  };

  /**
   * Handle keyboard events
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className={cn("relative", className)}>
      {/* Loading state */}
      {isLoading ? (
        <div className="flex min-h-[80px] items-center justify-center rounded-xl border-2 border-primary/20 bg-gradient-to-br from-blue-50/50 to-purple-50/30 py-4">
          <div className="flex flex-col items-center gap-2">
            <Spinner size={20} />
            <p className="text-xs text-muted-foreground">
              {t("insight.aiPolishProcessing", "Polishing...")}
            </p>
          </div>
        </div>
      ) : (
        /* Input container (relative positioning for button placement) */
        <div className="relative">
          <Textarea
            value={requirement}
            onChange={(e) => setRequirement(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t(
              "insight.polishRequest.placeholder",
              "Enter polish requirements, e.g.: make it more professional, expand length...",
            )}
            className={cn(
              "min-h-[80px] resize-none rounded-xl border-2 border-primary/20",
              "bg-gradient-to-br from-blue-50/50 to-purple-50/30",
              "transition-colors",
              // Right padding: button width (28px) + right margin (8px) = 36px; using pr-12 (48px) to ensure enough space
              "pr-12",
            )}
            autoFocus
          />
          {/* Button container (vertically aligned, on the right side of the input) */}
          <div className="absolute right-2 top-2 flex flex-col gap-2">
            {/* Cancel button (icon button, top-right corner) */}
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={t(
                  "insight.polishRequest.cancel",
                  "Cancel polish request",
                )}
              >
                <RemixIcon name="close" size="size-3.5" />
              </button>
            )}
            {/* Confirm button (icon button, below the cancel button) */}
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!requirement.trim()}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full transition-colors",
                requirement.trim()
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground cursor-not-allowed",
              )}
              aria-label={t("common.confirm", "Confirm")}
            >
              <RemixIcon name="send_plane" size="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
