"use client";

import ReactMarkdown from "react-markdown";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@openloomi/ui";
import { Button, Textarea } from "@openloomi/ui";
import { ScrollArea } from "@openloomi/ui";
import { useTranslation } from "react-i18next";
import { SOUL_PRESETS, SOUL_PRESET_CUSTOM_ID } from "@openloomi/shared/soul";
import { RemixIcon } from "@/components/remix-icon";
import { cn } from "@/lib/utils";

const SOUL_PROMPT_MAX_LENGTH = 5000;

/** Shared props for Soul prompt panel (read-only/edit content + close) */
export interface SoulPromptPanelContentProps {
  /** Currently displayed card id (preset id or "custom") */
  sheetSelectedId: string;
  /** Full prompt text of preset card, null when not a preset */
  presetPrompt: string | null;
  /** Text content of custom card (editable only when sheetSelectedId === "custom") */
  customPrompt: string;
  /** Callback when user edits custom prompt */
  onCustomPromptChange: (value: string) => void;
  /** Close panel */
  onClose: () => void;
  /** Optional. Called when clicking "Save" in custom mode (whether to close after save is decided by parent component) */
  onSave?: () => void;
  /** Optional. Called when clicking "Cancel" in custom mode (e.g., restore to saved content) */
  onCancel?: () => void;
}

export interface SoulPromptSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Currently displayed card id in Sheet (preset id or "custom") */
  sheetSelectedId: string;
  /** Full prompt text of preset card, null when not a preset */
  presetPrompt: string | null;
  /** Text content of custom card (editable only when sheetSelectedId === "custom") */
  customPrompt: string;
  /** Callback when user edits custom prompt, parent component can sync aiSoulPrompt here */
  onCustomPromptChange: (value: string) => void;
  /** Optional. When specified, Sheet renders inside that container (e.g., inside personalization dialog), otherwise page-level drawer */
  sheetContainerRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * Soul prompt inline panel (extra column)
 * Displayed as a right-side column in the layout, no overlay, no slide-in animation
 */
export function SoulPromptPanel({
  sheetSelectedId,
  presetPrompt,
  customPrompt,
  onCustomPromptChange,
  onClose,
  onSave,
  onCancel,
}: SoulPromptPanelContentProps) {
  const { t } = useTranslation();
  const isCustom = sheetSelectedId === SOUL_PRESET_CUSTOM_ID;
  const preset = SOUL_PRESETS.find((p) => p.id === sheetSelectedId);
  const title = isCustom
    ? t("common.soulPreset.custom")
    : preset
      ? t(preset.titleKey)
      : t("common.descriptionPromptSheetTitle");

  return (
    <div className="flex h-full min-h-0 w-full flex-col rounded-none border-0 bg-card shrink-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 shrink-0">
        <h3 className="font-serif text-sm font-semibold truncate">{title}</h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={t("common.close", "Close")}
        >
          <RemixIcon name="close" size="size-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 flex flex-col pt-0 pb-3 px-4">
        {isCustom ? (
          <div className="flex flex-col gap-2 flex-1 min-h-0">
            <div className="flex-1 min-h-0 overflow-y-auto">
              <Textarea
                id="soul-prompt-panel-custom"
                value={customPrompt}
                onChange={(e) => onCustomPromptChange(e.target.value)}
                placeholder={t(
                  "common.aiSoulPromptPlaceholder",
                  "e.g., You are a clear-minded, direct, and efficient assistant. Keep answers concise, prioritize actionable suggestions over analysis.",
                )}
                className="text-sm w-full h-full focus-visible:ring-0 focus-visible:ring-offset-0 resize-none border-0 bg-transparent p-0 shadow-none"
                maxLength={SOUL_PROMPT_MAX_LENGTH}
              />
            </div>
            <div className="flex items-center justify-between gap-2 shrink-0">
              <span className="text-xs text-muted-foreground">
                {customPrompt.length}/{SOUL_PROMPT_MAX_LENGTH}
              </span>
              {customPrompt.length > 0 &&
              (onSave != null || onCancel != null) ? (
                <div className="flex items-center gap-2 ml-auto">
                  {onCancel != null && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={onCancel}
                    >
                      {t("common.cancel", "Cancel")}
                    </Button>
                  )}
                  {onSave != null && (
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={onSave}
                    >
                      {t("common.save", "Save")}
                    </Button>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="text-sm text-foreground pr-2 prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown
                components={{
                  h2: ({ children }) => (
                    <h2 className="text-base font-semibold mt-4 mb-2 first:mt-0 text-foreground">
                      {children}
                    </h2>
                  ),
                  p: ({ children }) => (
                    <p className="mb-2 leading-relaxed text-foreground last:mb-0">
                      {children}
                    </p>
                  ),
                  ul: ({ children }) => (
                    <ul className="list-disc list-outside ml-4 mb-2 space-y-0.5 text-foreground">
                      {children}
                    </ul>
                  ),
                  li: ({ children }) => (
                    <li className="leading-relaxed">{children}</li>
                  ),
                  strong: ({ children }) => (
                    <strong className="font-semibold text-foreground">
                      {children}
                    </strong>
                  ),
                }}
              >
                {presetPrompt ?? ""}
              </ReactMarkdown>
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

/**
 * Soul prompt sidebar (drawer)
 * Displays the prompt of the currently selected card: presets are read-only, custom is editable Textarea
 */
export function SoulPromptSheet({
  open,
  onOpenChange,
  sheetSelectedId,
  presetPrompt,
  customPrompt,
  onCustomPromptChange,
  sheetContainerRef,
}: SoulPromptSheetProps) {
  const { t } = useTranslation();

  const isCustom = sheetSelectedId === SOUL_PRESET_CUSTOM_ID;
  const preset = SOUL_PRESETS.find((p) => p.id === sheetSelectedId);
  const title = isCustom
    ? t("common.soulPreset.custom")
    : preset
      ? t(preset.titleKey)
      : t("common.descriptionPromptSheetTitle");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        container={sheetContainerRef?.current ?? undefined}
        className={cn("w-full sm:max-w-[540px] p-0 flex flex-col")}
      >
        <SheetHeader className="px-6 py-4 bg-card shrink-0 border-b border-border">
          <SheetTitle className="text-lg font-semibold">{title}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 min-h-0 flex flex-col px-6 py-4">
          {isCustom ? (
            <div className="space-y-2 flex flex-col min-h-0">
              <Textarea
                id="soul-prompt-sheet-custom"
                value={customPrompt}
                onChange={(e) => onCustomPromptChange(e.target.value)}
                placeholder={t(
                  "common.aiSoulPromptPlaceholder",
                  "e.g., You are a clear-minded, direct, and efficient assistant. Keep answers concise, prioritize actionable suggestions over analysis.",
                )}
                className="min-h-[200px] resize-y text-sm flex-1 focus-visible:ring-0 focus-visible:ring-offset-0"
                maxLength={SOUL_PROMPT_MAX_LENGTH}
              />
              <div className="flex items-center justify-end text-xs text-muted-foreground shrink-0">
                <span>
                  {customPrompt.length}/{SOUL_PROMPT_MAX_LENGTH}
                </span>
              </div>
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="text-sm text-foreground pr-4 prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown
                  components={{
                    h2: ({ children }) => (
                      <h2 className="text-base font-semibold mt-4 mb-2 first:mt-0 text-foreground">
                        {children}
                      </h2>
                    ),
                    p: ({ children }) => (
                      <p className="mb-2 leading-relaxed text-foreground last:mb-0">
                        {children}
                      </p>
                    ),
                    ul: ({ children }) => (
                      <ul className="list-disc list-outside ml-4 mb-2 space-y-0.5 text-foreground">
                        {children}
                      </ul>
                    ),
                    li: ({ children }) => (
                      <li className="leading-relaxed">{children}</li>
                    ),
                    strong: ({ children }) => (
                      <strong className="font-semibold text-foreground">
                        {children}
                      </strong>
                    ),
                  }}
                >
                  {presetPrompt ?? ""}
                </ReactMarkdown>
              </div>
            </ScrollArea>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
