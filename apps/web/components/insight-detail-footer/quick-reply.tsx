"use client";

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@openloomi/ui";
import { useEnterSendWithIme } from "@openloomi/hooks/use-enter-send-ime";
import { Spinner } from "@/components/spinner";
import { RemixIcon } from "@/components/remix-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@openloomi/ui";
import { ReplyRecipients } from "./reply-recipients";
import type { UserContact } from "./types";
import type { ReplyOption } from "./reply-options";
import { cn } from "@/lib/utils";

interface QuickReplyProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onExpand: () => void;
  canSend: boolean;
  isSending: boolean;
  isUploading: boolean;
  sendSuccess: boolean;
  sendError: string | null;
  recipients?: string[];
  getRecipientLabel?: (recipient: string) => string;
  onRemoveRecipient?: (recipient: string) => void;
  /**
   * Whether a reply is being generated (AI generation in progress)
   */
  isGenerating?: boolean;
  // Props required by the ReplyRecipients component
  onAddRecipient?: (recipient: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  contactsListRef?: React.RefObject<HTMLDivElement | null>;
  showContactsList?: boolean;
  setShowContactsList?: (show: boolean) => void;
  setActiveRecipientField?: (field: "to" | "cc" | "bcc" | null) => void;
  contacts?: UserContact[];
  filteredContacts?: UserContact[];
  isLoadingContacts?: boolean;
  searchQuery?: string;
  setSearchQuery?: (query: string) => void;
  /**
   * List of reply options (for quick selection)
   */
  replyOptions?: ReplyOption[];
  /**
   * ID of the currently selected reply option
   */
  selectedOptionId?: string | null;
  /**
   * Callback when a reply option is selected
   */
  onSelectReplyOption?: (option: ReplyOption) => void;
  /**
   * Callback when deselecting a reply option (called when clicking an already-selected badge; clears input and deselects)
   */
  onDeselectReplyOption?: () => void;
  /**
   * Whether to show the "Reply to xxx" recipient input at the top (can be hidden in single-channel mode)
   */
  showRecipientRow?: boolean;
}

/**
 * Quick reply component (collapsed state)
 * Shows a simplified input, send button, and expand button
 * Uses the ReplyRecipients component to display recipients
 */
export function QuickReply({
  value,
  onChange,
  onSend,
  onExpand,
  canSend,
  isSending,
  isUploading,
  sendSuccess,
  sendError,
  recipients = [],
  getRecipientLabel,
  onRemoveRecipient,
  isGenerating = false,
  onAddRecipient,
  inputRef,
  contactsListRef,
  showContactsList = false,
  setShowContactsList,
  setActiveRecipientField,
  contacts = [],
  filteredContacts = [],
  isLoadingContacts = false,
  searchQuery = "",
  setSearchQuery,
  replyOptions = [],
  selectedOptionId,
  onSelectReplyOption,
  onDeselectReplyOption,
  showRecipientRow = true,
}: QuickReplyProps) {
  const { t } = useTranslation();
  /** Index of the currently hovered badge; shows checkmark only on hover */
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  /**
   * Get badge border/background style for the framework type (used for the three badges above the input)
   */
  const getFrameworkBadgeClass = (type: string) => {
    switch (type) {
      case "ACT":
        return "border-green-300/50 bg-green-50/70 text-green-700";
      case "ASK":
        return "border-blue-300/50 bg-blue-50/70 text-blue-700";
      case "ALTER":
        return "border-orange-300/50 bg-orange-50/70 text-orange-700";
      default:
        return "border-border/50 bg-muted/30 text-muted-foreground";
    }
  };

  /**
   * Handle click on reply option badge: if selected, fill in content; if already selected, deselect and clear input
   * On deselect, only calls onDeselectReplyOption to avoid duplicate updates with onChange("") that could cause infinite loops
   */
  const handleSelectOption = useCallback(
    (option: ReplyOption, index: number) => {
      const optionId = `${option.framework_type}-${index}`;
      const isAlreadySelected = selectedOptionId === optionId;
      if (isAlreadySelected) {
        onDeselectReplyOption?.();
        return;
      }
      const content = option.userLanguageDraft || option.draft;
      onChange(content);
      onSelectReplyOption?.(option);
    },
    [selectedOptionId, onDeselectReplyOption, onChange, onSelectReplyOption],
  );

  const {
    handleCompositionStart: enterSendCompositionStart,
    handleCompositionEnd: enterSendCompositionEnd,
    getEnterKeyDownHandler: getEnterSendKeyDown,
  } = useEnterSendWithIme();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    getEnterSendKeyDown(() => {
      if (canSend && !isSending) onSend();
    })(e);
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      {/* Use ReplyRecipients component to display recipients (hidden in single-channel mode) */}
      {showRecipientRow &&
        (onAddRecipient &&
        inputRef &&
        contactsListRef &&
        setShowContactsList &&
        setActiveRecipientField &&
        setSearchQuery &&
        getRecipientLabel ? (
          <ReplyRecipients
            label={t("common.recipient")}
            recipients={recipients}
            onAdd={onAddRecipient}
            onRemove={onRemoveRecipient || (() => {})}
            placeholder={t(
              "common.selectRecipientMulti",
              "Select recipients (multiple allowed)",
            )}
            inputRef={inputRef}
            contactsListRef={contactsListRef}
            showContactsList={showContactsList}
            setShowContactsList={setShowContactsList}
            setActiveRecipientField={setActiveRecipientField}
            fieldType="to"
            contacts={contacts}
            filteredContacts={filteredContacts}
            isLoadingContacts={isLoadingContacts}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            getRecipientLabel={getRecipientLabel}
            hideLabel={true}
            showReplyLabel={true}
          />
        ) : (
          // Fallback: if full props are not provided, use a simple label display
          recipients.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {recipients.map((recipient) => (
                <span
                  key={recipient}
                  className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs text-primary shrink-0"
                >
                  {getRecipientLabel ? getRecipientLabel(recipient) : recipient}
                  {onRemoveRecipient && (
                    <button
                      type="button"
                      className="text-primary/60 transition hover:text-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveRecipient(recipient);
                      }}
                      aria-label={t(
                        "common.removeRecipient",
                        "Remove recipient",
                      )}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
          )
        ))}
      {/* Reply suggestions: a row above the input (generating badge + three recommended badges); hover on badge to view reply content */}
      {(isGenerating ||
        (replyOptions.length > 0 &&
          (onSelectReplyOption || onDeselectReplyOption))) && (
        <div className="flex items-center gap-1.5 flex-nowrap overflow-x-auto">
          {isGenerating && (
            <div className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary shrink-0">
              <Spinner size={12} />
              {t("insight.generatingReply", "Generating reply...")}
            </div>
          )}
          {replyOptions.map((option, index) => {
            const optionId = `${option.framework_type}-${index}`;
            const isSelected = selectedOptionId === optionId;
            const showCheck = isSelected || hoveredIndex === index;
            const replyContent =
              option.userLanguageDraft?.trim() || option.draft?.trim() || "";
            return (
              <Tooltip key={optionId} delayDuration={200}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => handleSelectOption(option, index)}
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shrink-0",
                      getFrameworkBadgeClass(option.framework_type),
                    )}
                  >
                    <span>{option.label}</span>
                    {showCheck && (
                      <RemixIcon
                        name="check"
                        size="size-3"
                        className="text-primary shrink-0"
                      />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  align="start"
                  className="max-w-sm max-h-48 overflow-y-auto whitespace-pre-wrap text-left"
                >
                  {replyContent ||
                    t("insight.noReplyContent", "No content yet")}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      )}
      <div className="flex items-center gap-2">
        <div className="flex-1 rounded-2xl border border-border/40 bg-white/95 px-3 py-2 shadow-sm transition hover:border-primary/40 hover:bg-white flex items-center gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onCompositionStart={enterSendCompositionStart}
            onCompositionEnd={enterSendCompositionEnd}
            onKeyDown={handleKeyDown}
            placeholder={t("insight.replyQuickInputPlaceholder", "Enter reply")}
            className="flex-1 min-w-[120px] border-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            disabled={isSending || isUploading}
          />
          <button
            type="button"
            onClick={onExpand}
            className="flex items-center justify-center shrink-0 h-6 w-6 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-accent"
            aria-label={t("insight.expandReply", "Expand reply")}
          >
            <RemixIcon name="maximize_2" size="size-3.5" />
          </button>
          <div className="h-4 w-px bg-border/60 shrink-0" />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onSend}
            disabled={!canSend || isSending}
            className="h-6 w-6 shrink-0 text-primary hover:text-primary hover:bg-primary/10"
            aria-label={t("common.send", "Send")}
          >
            {isSending ? (
              <Spinner size={14} />
            ) : (
              <RemixIcon
                name="send_plane"
                size="size-4"
                className="text-primary"
              />
            )}
          </Button>
        </div>
        {sendSuccess && (
          <div className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 shrink-0">
            <RemixIcon name="check" size="size-3.5" />
            {t("insight.replySentBadge", "Sent")}
          </div>
        )}
        {sendError && (
          <div className="flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-600 shrink-0">
            <RemixIcon name="error_warning" size="size-3.5" />
            {sendError}
          </div>
        )}
      </div>
    </div>
  );
}
