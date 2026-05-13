"use client";

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { generateUUID } from "@/lib/utils";
import {
  htmlToPlainText,
  plainTextToHtml,
  extractTargetLanguageContent,
} from "../utils";
import type { Insight } from "@/lib/db/schema";
import type { ReplyOption } from "../reply-options";
import { getAuthToken } from "@/lib/auth/token-manager";

/**
 * AI generated reply cache configuration
 */
const REPLY_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const REPLY_CACHE_KEY_PREFIX = "openloomi_ai_reply_cache_";

/**
 * Cache data structure
 */
interface ReplyCache {
  options: ReplyOption[];
  timestamp: number;
  language: string;
  userLanguage?: string | null;
}

/**
 * Get cached reply
 */
function getCachedReply(insightId: string): ReplyCache | null {
  try {
    const cacheKey = `${REPLY_CACHE_KEY_PREFIX}${insightId}`;
    const cached = localStorage.getItem(cacheKey);
    if (!cached) return null;

    const data = JSON.parse(cached) as ReplyCache;
    const now = Date.now();

    // Check if expired
    if (now - data.timestamp > REPLY_CACHE_TTL_MS) {
      localStorage.removeItem(cacheKey);
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * Set cached reply
 */
function setCachedReply(
  insightId: string,
  options: ReplyOption[],
  language: string,
  userLanguage?: string | null,
): void {
  try {
    const cacheKey = `${REPLY_CACHE_KEY_PREFIX}${insightId}`;
    const data: ReplyCache = {
      options,
      timestamp: Date.now(),
      language,
      userLanguage,
    };
    localStorage.setItem(cacheKey, JSON.stringify(data));
  } catch {
    // Ignore storage errors (e.g., quota exceeded)
  }
}

interface UseReplyAiAssistProps {
  insight: Insight;
  draftContent: string;
  setDraftContent: (content: string) => void;
  setUserLanguageDraft?: (content: string | null) => void;
  setIsExpanded: (expanded: boolean) => void;
  inferredConversationLanguage: string;
  userLanguagePreference: string | null;
  targetLanguage: string;
  setTargetLanguage: (lang: string) => void;
  resolveLanguageLabel: (code: string) => string;
  setHasManualLanguageSelection: (value: boolean) => void;
  lastOriginalDraft: string | null;
  setLastOriginalDraft: (draft: string | null) => void;
  activeTranslation: {
    language: string;
    label: string;
    detectedLanguage?: string | null;
  } | null;
  setActiveTranslation: (translation: any) => void;
  setIsTranslating: (translating: boolean) => void;
  // Failure counter ref, used to track the number of auto-generation failures
  autoGenerateFailureCountRef?: React.MutableRefObject<number>;
  hasAutoGenerateFailedRef?: React.MutableRefObject<boolean>;
  maxRetries?: number;
}

/**
 * Hook for AI assist functionality
 * Handles generation, polishing, translation, and other features
 */
export function useReplyAiAssist({
  insight,
  draftContent,
  setDraftContent,
  setUserLanguageDraft,
  setIsExpanded,
  inferredConversationLanguage,
  userLanguagePreference,
  targetLanguage,
  setTargetLanguage,
  resolveLanguageLabel,
  setHasManualLanguageSelection,
  lastOriginalDraft,
  setLastOriginalDraft,
  activeTranslation,
  setActiveTranslation,
  setIsTranslating,
  autoGenerateFailureCountRef,
  hasAutoGenerateFailedRef,
  maxRetries = 3,
}: UseReplyAiAssistProps) {
  const { t } = useTranslation();
  const [assistMenuOpen, setAssistMenuOpen] = useState(false);
  // Independent loading states
  const [generateLoading, setGenerateLoading] = useState(false);
  const [polishLoading, setPolishLoading] = useState(false);
  const [pendingTask, setPendingTask] = useState<{
    requestId: string;
    type: "generate" | "polish" | "translate";
    startedAt: number;
    targetLanguage?: string;
    targetLanguageLabel?: string;
    userLanguagePreference?: string | null;
    userLanguageLabel?: string | null;
  } | null>(null);
  const [replyOptions, setReplyOptions] = useState<ReplyOption[]>([]);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [showPolishRequest, setShowPolishRequest] = useState(false);

  /**
   * Apply reply options to the editor (from cache or API response)
   * Only sets the options list; does not auto-fill the input; user clicks badge to fill
   */
  const applyReplyOptions = useCallback(
    (options: ReplyOption[], _userLanguage: string | null | undefined) => {
      setReplyOptions(options);
    },
    [],
  );

  /**
   * Handle "generate based on understanding" feature
   * Supports 15-minute browser-side cache to avoid duplicate generation on refresh or repeated opening
   */
  const handleAssistGenerate = useCallback(async () => {
    // Don't auto-expand when generating AI reply
    // setIsExpanded(true);
    setAssistMenuOpen(false);

    // Close other AI feature cards
    setReplyOptions([]);
    setSelectedOptionId(null);
    setShowPolishRequest(false);
    setActiveTranslation(null);
    setLastOriginalDraft(null);
    if (setUserLanguageDraft) {
      setUserLanguageDraft(null);
    }

    // Check cache
    const cached = getCachedReply(insight.id);
    if (cached && cached.options.length > 0) {
      // Use cached reply
      applyReplyOptions(cached.options, cached.userLanguage);
      return;
    }

    // No cache, start loading
    setGenerateLoading(true);

    try {
      // Get user language preference
      let userLanguage = userLanguagePreference;
      if (!userLanguage) {
        try {
          const response = await fetch("/api/preferences/insight");
          if (response.ok) {
            const data = (await response.json()) as { language?: string };
            userLanguage = data.language || null;
          }
        } catch (error) {}
      }

      const requestLanguage = inferredConversationLanguage || "same as message";

      // Build insight context
      const insightContext = {
        title: insight.title,
        description: insight.description,
        details: insight.details,
        people: insight.people,
      };

      // Call the standalone generate API
      // Get cloud auth token if available
      let cloudAuthToken: string | undefined;
      try {
        cloudAuthToken = getAuthToken() || undefined;
      } catch (error) {
        console.error("[ReplyAI] Failed to read cloud_auth_token:", error);
      }

      const generateResponse = await fetch("/api/ai/generate-reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          insightContext,
          language: requestLanguage,
          userLanguage: userLanguage || undefined,
          cloudAuthToken, // Pass cloud auth token for AI Provider authentication
        }),
      });

      if (!generateResponse.ok) {
        let errorMessage = "Failed to generate reply";
        try {
          const errorJson = JSON.parse(await generateResponse.text());
          errorMessage = errorJson.cause || errorJson.message || errorMessage;
        } catch {
          // Not JSON, use default
        }
        throw new Error(errorMessage);
      }

      const generateData = (await generateResponse.json()) as {
        success: boolean;
        data?: {
          intent?: string;
          options: Array<{
            framework_type: string;
            label: string;
            draft: string;
            userLanguageDraft?: string | null;
            confidence_score?: number | null;
            is_primary: boolean;
          }>;
        };
      };

      if (!generateData.success || !generateData.data?.options) {
        throw new Error("Invalid response format");
      }

      // Convert to ReplyOption format
      const options: ReplyOption[] = generateData.data.options.map((opt) => ({
        id: generateUUID(),
        framework_type: opt.framework_type as any,
        label: opt.label,
        draft: opt.draft,
        userLanguageDraft: opt.userLanguageDraft || undefined,
        confidence_score: opt.confidence_score || 0.5,
        is_primary: opt.is_primary,
      }));

      // Cache the generated reply
      setCachedReply(insight.id, options, requestLanguage, userLanguage);

      // Apply reply options
      applyReplyOptions(options, userLanguage);

      setGenerateLoading(false);
      // Reset failure count on success
      if (autoGenerateFailureCountRef) {
        autoGenerateFailureCountRef.current = 0;
      }
      if (hasAutoGenerateFailedRef) {
        hasAutoGenerateFailedRef.current = false;
      }
    } catch (error) {
      setGenerateLoading(false);
      // Update failure count (only when ref is provided)
      if (autoGenerateFailureCountRef) {
        autoGenerateFailureCountRef.current += 1;
        console.log(
          `[AutoGenerate] Generation failed, failure count: ${autoGenerateFailureCountRef.current}/${maxRetries}`,
        );
      }
      if (hasAutoGenerateFailedRef) {
        hasAutoGenerateFailedRef.current = true;
      }
      // Silent fail for JSON parse errors - no toast
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Log detailed error for debugging (includes API response text)
      console.error(
        `[use-reply-ai-assist] Generation failed: ${errorMessage}`,
        {
          insightId: insight.id,
          errorType:
            error instanceof Error ? error.constructor.name : typeof error,
          fullError: error,
        },
      );
    }
  }, [
    insight.id,
    inferredConversationLanguage,
    userLanguagePreference,
    setUserLanguageDraft,
    t,
    applyReplyOptions,
    autoGenerateFailureCountRef,
    hasAutoGenerateFailedRef,
    maxRetries,
  ]);

  /**
   * Handle polish feature - show input box
   */
  const handleAssistPolish = useCallback(() => {
    const strippedDraft = htmlToPlainText(draftContent);
    if (strippedDraft.length === 0) {
      toast.error(
        t(
          "insight.aiPolishEmpty",
          "Add some text before asking openloomi to polish it.",
        ),
      );
      return;
    }

    setIsExpanded(true);
    setAssistMenuOpen(false);
    // Close other AI feature cards
    setReplyOptions([]);
    setSelectedOptionId(null);
    // Clear translation feature card if present
    if (activeTranslation && activeTranslation.language !== "polish") {
      setActiveTranslation(null);
      setLastOriginalDraft(null);
    }
    // Clear user language hint from the generate reply feature
    if (setUserLanguageDraft) {
      setUserLanguageDraft(null);
    }
    setShowPolishRequest(true);
  }, [
    draftContent,
    activeTranslation,
    t,
    setActiveTranslation,
    setLastOriginalDraft,
    setUserLanguageDraft,
  ]);

  /**
   * Handle confirm polish request - send polish request
   */
  const handleConfirmPolishRequest = useCallback(
    async (requirement: string) => {
      const strippedDraft = htmlToPlainText(draftContent);
      if (strippedDraft.length === 0) {
        toast.error(
          t(
            "insight.aiPolishEmpty",
            "Add some text before asking openloomi to polish it.",
          ),
        );
        return;
      }

      // Do not hide the card; keep it displayed and switch to loading state
      setPolishLoading(true);
      try {
        // Build insight context
        const insightContext = {
          title: insight.title,
          description: insight.description,
          details: insight.details,
          people: insight.people,
        };

        // Call the standalone polish API
        // Get cloud auth token if available
        let cloudAuthToken: string | undefined;
        try {
          cloudAuthToken = getAuthToken() || undefined;
        } catch (error) {
          console.error("[ReplyAI] Failed to read cloud_auth_token:", error);
        }

        const polishResponse = await fetch("/api/ai/polish", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            draft: strippedDraft,
            tone: requirement || undefined,
            language: inferredConversationLanguage || undefined,
            insightContext,
            cloudAuthToken, // Pass cloud auth token for AI Provider authentication
          }),
        });

        if (!polishResponse.ok) {
          const errorText = await polishResponse.text();
          throw new Error(errorText || "Failed to polish draft");
        }

        const polishData = (await polishResponse.json()) as {
          success: boolean;
          data?: {
            polished: string;
          };
        };

        if (!polishData.success || !polishData.data?.polished) {
          throw new Error("Invalid response format");
        }

        const polishedText = polishData.data.polished;

        // Set the polished text in HTML format
        const polishedHtml = plainTextToHtml(polishedText);
        setDraftContent(polishedHtml);
        setLastOriginalDraft(strippedDraft);

        // Hide the polish request card
        setShowPolishRequest(false);
        setPolishLoading(false);

        toast.success(
          t("insight.aiPolishSuccess", "Draft polished successfully"),
        );
      } catch (error) {
        setPolishLoading(false);
        // If an error occurs, keep the card displayed so the user can retry
        toast.error(
          t(
            "insight.aiPolishFailed",
            `Couldn't polish that draft. Try again. ${error instanceof Error ? error.message : ""}`,
          ),
        );
      }
    },
    [
      draftContent,
      insight.id,
      inferredConversationLanguage,
      t,
      setDraftContent,
      setLastOriginalDraft,
    ],
  );

  /**
   * Handle cancel polish request
   */
  const handleCancelPolishRequest = useCallback(() => {
    setShowPolishRequest(false);
  }, []);

  /**
   * Handle translation feature
   */
  const handleTranslate = useCallback(
    async (languageCode?: string) => {
      const sourceDraft = lastOriginalDraft ?? draftContent;
      const strippedDraft = htmlToPlainText(sourceDraft);
      if (strippedDraft.length === 0) {
        toast.error(
          t(
            "insight.translationEmpty",
            "Add content before requesting a translation.",
          ),
        );
        return;
      }

      setIsExpanded(true);
      setIsTranslating(true);
      // Close other AI feature cards
      setReplyOptions([]);
      setSelectedOptionId(null);
      setShowPolishRequest(false);
      // Clear all previous translation/polish results
      setActiveTranslation(null);
      // Clear user language hint from the generate reply feature
      if (setUserLanguageDraft) {
        setUserLanguageDraft(null);
      }
      if (languageCode && languageCode !== targetLanguage) {
        setHasManualLanguageSelection(true);
      }
      // Save original draft for translation comparison
      setLastOriginalDraft(sourceDraft);
      setDraftContent(sourceDraft);

      try {
        const finalLanguage = languageCode ?? targetLanguage;
        if (languageCode && languageCode !== targetLanguage) {
          setTargetLanguage(languageCode);
        }
        const languageLabel = resolveLanguageLabel(finalLanguage);

        // Call the standalone translation API (translation does not need context)
        // Get cloud auth token if available
        let cloudAuthToken: string | undefined;
        try {
          cloudAuthToken = getAuthToken() || undefined;
        } catch (error) {
          console.error("[ReplyAI] Failed to read cloud_auth_token:", error);
        }

        const translateResponse = await fetch("/api/ai/translate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            draft: strippedDraft,
            targetLanguage: finalLanguage,
            cloudAuthToken, // Pass cloud auth token for AI Provider authentication
          }),
        });

        if (!translateResponse.ok) {
          const errorText = await translateResponse.text();
          throw new Error(errorText || "Failed to translate draft");
        }

        const translateData = (await translateResponse.json()) as {
          success: boolean;
          data?: {
            translated: string;
          };
        };

        if (!translateData.success || !translateData.data?.translated) {
          throw new Error("Invalid response format");
        }

        const translatedText = translateData.data.translated;

        // Set translated text in HTML format
        const translatedHtml = plainTextToHtml(translatedText);
        // Note: does not directly replace draftContent; shows translation in the comparison card
        // User confirms before replacing the current text

        // Set translation result for displaying the comparison card (contains translatedContent for confirmation)
        setActiveTranslation({
          language: finalLanguage,
          label: languageLabel,
          translatedContent: translatedHtml,
        });
        setIsTranslating(false);

        toast.success(
          t(
            "insight.translationComplete",
            "Translation complete. Please confirm to apply.",
          ),
        );
      } catch (error) {
        setIsTranslating(false);
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        toast.error(
          t(
            "insight.translationFailed",
            `Couldn't translate that draft. Try again. ${errorMessage}`,
          ),
        );
      }
    },
    [
      draftContent,
      activeTranslation,
      lastOriginalDraft,
      resolveLanguageLabel,
      insight.id,
      t,
      targetLanguage,
      setTargetLanguage,
      setHasManualLanguageSelection,
      setLastOriginalDraft,
      setActiveTranslation,
      setDraftContent,
      setIsTranslating,
    ],
  );

  /**
   * Handle option selection
   */
  const handleOptionSelect = useCallback(
    (option: ReplyOption, currentUserLanguageDraft?: string | null) => {
      const optionIndex = replyOptions.findIndex(
        (opt) =>
          opt.framework_type === option.framework_type &&
          opt.label === option.label &&
          opt.draft === option.draft,
      );
      const optionId =
        optionIndex >= 0
          ? `${option.framework_type}-${optionIndex}`
          : `${option.framework_type}-${Date.now()}`;
      setSelectedOptionId(optionId);
      setDraftContent(plainTextToHtml(option.draft));
      // Also set the reply content in the user's preferred language if present
      if (setUserLanguageDraft) {
        // Check if target language is consistent
        const isLanguageMismatch =
          userLanguagePreference &&
          targetLanguage &&
          userLanguagePreference !== targetLanguage;

        // Prefer option.userLanguageDraft; if not present, try to extract from draft
        let userLangDraft = option.userLanguageDraft
          ? plainTextToHtml(option.userLanguageDraft)
          : null;

        // If userLanguageDraft does not exist and user preferred language differs from target language,
        // try to extract user language content from draft
        if (!userLangDraft && isLanguageMismatch && userLanguagePreference) {
          const extracted = extractTargetLanguageContent(
            option.draft,
            userLanguagePreference,
            targetLanguage,
          );
          if (extracted && extracted !== option.draft) {
            userLangDraft = plainTextToHtml(extracted);
          }
        }

        // If still no userLangDraft but target language is mismatched, keep the previous userLanguageDraft
        // This ensures the tips card remains displayed when switching options
        // Key optimization: whenever target language is mismatched, always keep or use the previous userLanguageDraft
        if (!userLangDraft && isLanguageMismatch) {
          if (currentUserLanguageDraft) {
            // If there is a previous userLanguageDraft, keep it
            userLangDraft = currentUserLanguageDraft;
          } else {
            // If no previous one, try to find the first option with userLanguageDraft among all options
            const optionWithDraft = replyOptions.find(
              (opt) =>
                opt.userLanguageDraft && opt.userLanguageDraft.trim() !== "",
            );
            if (optionWithDraft?.userLanguageDraft) {
              userLangDraft = plainTextToHtml(
                optionWithDraft.userLanguageDraft,
              );
            }
          }
        }
        setUserLanguageDraft(userLangDraft);
      }
    },
    [
      replyOptions,
      setDraftContent,
      setUserLanguageDraft,
      userLanguagePreference,
      targetLanguage,
    ],
  );

  /**
   * Deselect reply option: clear selected state, input content, and user language draft
   */
  const handleOptionDeselect = useCallback(() => {
    setSelectedOptionId(null);
    setDraftContent("");
    if (setUserLanguageDraft) setUserLanguageDraft(null);
  }, [setDraftContent, setUserLanguageDraft]);

  return {
    assistMenuOpen,
    setAssistMenuOpen,
    generateLoading,
    polishLoading,
    pendingTask,
    setPendingTask,
    replyOptions,
    setReplyOptions,
    selectedOptionId,
    setSelectedOptionId,
    handleAssistGenerate,
    handleAssistPolish,
    handleConfirmPolishRequest,
    handleCancelPolishRequest,
    showPolishRequest,
    setShowPolishRequest,
    handleTranslate,
    handleOptionSelect,
    handleOptionDeselect,
  };
}
