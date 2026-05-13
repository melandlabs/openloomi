"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { detectLanguageFromText } from "../utils";
import type { Insight } from "@/lib/db/schema";
import type { ChatMessage } from "@openloomi/shared";

interface UseReplyLanguageProps {
  insight: Insight;
  contextMessages?: ChatMessage[];
}

/**
 * Reply language related Hook
 * Handles language detection, translation target language settings, etc.
 */
export function useReplyLanguage({
  insight,
  contextMessages,
}: UseReplyLanguageProps) {
  const { t } = useTranslation();
  const [targetLanguage, setTargetLanguage] = useState<string>("en");
  const [hasManualLanguageSelection, setHasManualLanguageSelection] =
    useState(false);
  const [userLanguagePreference, setUserLanguagePreference] = useState<
    string | null
  >(null);

  /**
   * Infer conversation language
   */
  const inferredConversationLanguage = useMemo(() => {
    const details = Array.isArray(insight.details) ? insight.details : null;
    const detailContent =
      details?.find(
        (detail) =>
          typeof detail?.content === "string" &&
          detail.content.trim().length > 0,
      )?.content ?? "";
    const textCandidates: string[] = [];
    if (detailContent) {
      textCandidates.push(detailContent);
    }
    if (contextMessages) {
      for (const message of contextMessages) {
        const textParts =
          message.parts?.flatMap((part) => {
            if (part.type === "text") {
              return (part as { text?: string }).text ?? "";
            }
            return [];
          }) ?? [];
        for (const partText of textParts) {
          if (partText && partText.trim().length > 0) {
            textCandidates.push(partText);
            break;
          }
        }
        if (textCandidates.length > 0) {
          break;
        }
      }
    }
    for (const candidate of textCandidates) {
      const code = detectLanguageFromText(candidate);
      if (code) return code;
    }
    return "en";
  }, [contextMessages, insight.details]);

  /**
   * Get language preference from user personalization settings
   */
  useEffect(() => {
    const fetchUserLanguagePreference = async () => {
      try {
        const response = await fetch("/api/preferences/insight");
        if (response.ok) {
          const data = (await response.json()) as { language?: string };
          setUserLanguagePreference(data.language || null);
        }
      } catch (error) {
        console.error("Failed to fetch user language preference", error);
      }
    };
    void fetchUserLanguagePreference();
  }, []);

  /**
   * Automatically set target language
   */
  useEffect(() => {
    if (
      !hasManualLanguageSelection &&
      targetLanguage !== inferredConversationLanguage
    ) {
      setTargetLanguage(inferredConversationLanguage);
    }
  }, [
    hasManualLanguageSelection,
    inferredConversationLanguage,
    targetLanguage,
  ]);

  /**
   * Language options
   */
  const languageOptions = useMemo(
    () => [
      { code: "en", label: t("insight.language.english", "English") },
      { code: "zh", label: t("insight.language.chinese", "Chinese") },
      { code: "ja", label: t("insight.language.japanese", "Japanese") },
      { code: "ko", label: t("insight.language.korean", "Korean") },
      { code: "fr", label: t("insight.language.french", "French") },
      { code: "de", label: t("insight.language.german", "German") },
      { code: "es", label: t("insight.language.spanish", "Spanish") },
      { code: "pt", label: t("insight.language.portuguese", "Portuguese") },
      { code: "it", label: t("insight.language.italian", "Italian") },
    ],
    [t],
  );

  /**
   * Parse language label
   */
  const resolveLanguageLabel = useCallback(
    (code: string) =>
      languageOptions.find((option) => option.code === code)?.label ?? code,
    [languageOptions],
  );

  return {
    targetLanguage,
    setTargetLanguage,
    inferredConversationLanguage,
    hasManualLanguageSelection,
    setHasManualLanguageSelection,
    userLanguagePreference,
    setUserLanguagePreference,
    languageOptions,
    resolveLanguageLabel,
  };
}
