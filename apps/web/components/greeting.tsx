"use client";

import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { UseChatHelpers } from "@ai-sdk/react";
import type { ChatMessage } from "@openloomi/shared";
import { useMemo, useEffect, memo } from "react";
import {
  getAllDefaultSuggestions,
  type SuggestedPrompt,
} from "./suggested-actions";
import { useChatContextOptional } from "./chat-context";

interface GreetingProps {
  chatId: string;
  /** Send message (used for suggestion clicks when onSuggestionClick is not provided) */
  sendMessage?: UseChatHelpers<ChatMessage>["sendMessage"];
  onSuggestionsReady?: (suggestions: SuggestedPrompt[]) => void;
  onSuggestionUsed?: (suggestionId: string) => void;
  /** Optional: Callback when clicking a suggested topic (e.g., pre-fill input on Insight detail page), takes priority over sendMessage */
  onSuggestionClick?: (suggestion: SuggestedPrompt) => void;
  isAgentRunning?: boolean;
}

/**
 * Greeting component, displays welcome message and suggested actions
 * Shows 6 suggested topic cards, responsive grid layout
 * @param chatId - Chat ID
 * @param sendMessage - Function to send message
 */
export const Greeting = memo(function Greeting({
  chatId,
  sendMessage,
  onSuggestionsReady,
  onSuggestionUsed,
  onSuggestionClick,
  isAgentRunning = false,
}: GreetingProps) {
  const { t } = useTranslation();
  const chatContext = useChatContextOptional();
  const focusedInsights = chatContext?.focusedInsights ?? [];

  // Show suggestion cards even when there are focused insights (cards don't disappear after user @mentions an event), only affects onSuggestionsReady call
  const hasFocusedInsights = focusedInsights.length > 0;

  // Show all 6 suggestions
  const allSuggestions = useMemo(() => {
    return getAllDefaultSuggestions(t);
  }, [t]);

  // Notify parent component that suggestions are ready
  useEffect(() => {
    if (
      allSuggestions.length > 0 &&
      onSuggestionsReady &&
      !hasFocusedInsights
    ) {
      onSuggestionsReady(allSuggestions);
    }
  }, [allSuggestions, onSuggestionsReady, hasFocusedInsights]);

  return (
    <div
      key="overview"
      className="max-w-3xl mx-auto mt-6 sm:mt-12 size-full w-full px-0 flex flex-col justify-center gap-4"
    >
      {/* Greeting text */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.5 }}
        className="w-full mb-0"
      >
        <h2 className="text-3xl font-serif font-semibold text-center text-foreground tracking-normal mb-2">
          {t("common.chatSubTitle")}
        </h2>
      </motion.div>
      {/* Always show suggested topic list when no messages (cards don't disappear after user @mentions an event) */}
      {
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          transition={{ delay: 0.7 }}
        >
          <div data-testid="suggested-actions" className="w-full">
            {/* 6 suggestion options - responsive grid layout */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pl-3 pr-3">
              {allSuggestions.map((item) => (
                <SuggestionCard
                  key={item.id}
                  item={item}
                  chatId={chatId}
                  disabled={isAgentRunning}
                  sendMessage={sendMessage}
                  onSuggestionUsed={onSuggestionsReady ? () => {} : undefined}
                  onSuggestionClick={onSuggestionClick}
                  isAgentRunning={isAgentRunning}
                />
              ))}
            </div>
          </div>
        </motion.div>
      }
    </div>
  );
});

/**
 * Single suggested topic card component
 * Uses onSuggestionClick when provided (e.g., pre-fill input on Insight detail page), otherwise uses sendMessage
 */
function SuggestionCard({
  item,
  chatId,
  sendMessage,
  onSuggestionUsed,
  onSuggestionClick,
  disabled,
  isAgentRunning,
}: {
  item: SuggestedPrompt;
  chatId: string;
  sendMessage?: UseChatHelpers<ChatMessage>["sendMessage"];
  onSuggestionUsed?: (suggestionId: string) => void;
  /** Callback on click, takes priority over sendMessage (used for pre-fill input, etc.) */
  onSuggestionClick?: (suggestion: SuggestedPrompt) => void;
  disabled: boolean;
  isAgentRunning?: boolean;
}) {
  // Get activeChatId and sendMessage from ChatContext to ensure using the latest context
  const chatContext = useChatContextOptional();
  const activeChatId = chatContext?.activeChatId;
  // Use sendMessage from context instead of props to ensure using the latest
  const contextSendMessage = chatContext?.sendMessage;
  const { t } = useTranslation();

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (isAgentRunning) return;

    // Check if activeChatId exists, if not means chat hasn't been properly initialized yet
    if (!activeChatId) {
      console.warn(
        "[SuggestionCard] Chat not initialized yet, activeChatId is missing",
      );
      return;
    }

    onSuggestionUsed?.(item.id);

    if (onSuggestionClick) {
      onSuggestionClick(item);
      return;
    }
    // Prefer sendMessage from context (more reliable), fallback to props
    const sendFn = contextSendMessage || sendMessage;
    if (sendFn) {
      try {
        await sendFn({
          role: "user",
          parts: [{ type: "text", text: item.title }],
        });
      } catch (error) {
        console.error("[SuggestionCard] Failed to send message:", error);
      }
    }
  };

  return (
    <button
      type="button"
      className="group relative flex h-full flex-col items-start justify-between gap-0 rounded-xl border border-border/60 bg-white px-4 py-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
      disabled={disabled || !activeChatId}
      onClick={handleClick}
    >
      <h3 className="text-sm font-medium font-serif text-foreground text-left pb-3">
        {item.title}
      </h3>
      <div className="flex size-12 shrink-0 items-center justify-center text-2xl bg-muted/30 rounded-full transition-colors">
        <span>{item.emoji}</span>
      </div>
      {/* Show "Try it" link style hint on hover at bottom right, 16px from right and bottom margins */}
      <span
        className="absolute bottom-4 right-4 text-xs font-medium font-serif text-primary opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none"
        aria-hidden
      >
        {t("common.tryIt")}
      </span>
    </button>
  );
}
