"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useState,
  useRef,
} from "react";
import useSWR from "swr";
import { useTranslation } from "react-i18next";
import { fetcher } from "@/lib/utils";
import { detectAndSetLanguage, saveLanguage } from "@/i18n";
import { toast } from "@/components/toast";
import { RemixIcon } from "@/components/remix-icon";
import { PersonalizationLanguageRefresh } from "./personalization-language-refresh";

type InsightPreferencesResponse = {
  focusPeople: string[];
  focusTopics: string[];
  language: string;
  refreshIntervalMinutes: number;
  lastUpdated: string;
  aiSoulPrompt?: string | null;
  roles?: {
    manual: string[];
  };
};

type InsightPreferencesPayload = {
  focusPeople: string[];
  focusTopics: string[];
  language: string;
  refreshIntervalMinutes: number;
  roleKeys: string[];
  aiSoulPrompt?: string;
};

/**
 * Hook to get user basic preferences (exported for dialog sidebar to display lastUpdated, etc.)
 */
export function useBasicPreferences() {
  const { data, isLoading, mutate, error } = useSWR<InsightPreferencesResponse>(
    "/api/preferences/insight",
    fetcher,
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateOnMount: true,
      dedupingInterval: 5000,
    },
  );

  if (error) {
    console.error("[Basic Preferences] Fetch failed", error);
  }

  return { data, isLoading, mutate };
}

/**
 * Basic settings component props
 */
interface PersonalizationBasicSettingsProps {
  /** Whether to display */
  open: boolean;
}

/**
 * Methods exposed by the basic settings component
 */
export interface PersonalizationBasicSettingsRef {
  /** Save settings */
  save: () => Promise<void>;
  /** Whether currently saving */
  isSaving: boolean;
}

/**
 * Basic settings component
 * Provides basic settings such as language and refresh frequency
 */
export const PersonalizationBasicSettings = forwardRef<
  PersonalizationBasicSettingsRef,
  PersonalizationBasicSettingsProps
>(({ open: _open }, ref) => {
  const { t, i18n } = useTranslation();
  const {
    data: basicData,
    isLoading: isBasicLoading,
    mutate: basicMutate,
  } = useBasicPreferences();

  const [language, setLanguage] = useState("");
  const [refreshInterval, setRefreshInterval] = useState(30);
  const [aiSoulPrompt, setAiSoulPrompt] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);
  const lastSynced = useRef<{
    language: string;
    refreshInterval: number;
    aiSoulPrompt: string;
  } | null>(null);

  useEffect(() => {
    if (basicData) {
      const prompt = basicData.aiSoulPrompt ?? "";
      setLanguage(basicData.language ?? "");
      setRefreshInterval(basicData.refreshIntervalMinutes ?? 30);
      setAiSoulPrompt(prompt);
      setHasHydrated(true);
      lastSynced.current = {
        language: basicData.language ?? "",
        refreshInterval: basicData.refreshIntervalMinutes ?? 30,
        aiSoulPrompt: prompt,
      };
    }
  }, [basicData]);

  const persistBasicPreferences = useCallback(
    async (
      nextLanguage: string,
      nextRefreshInterval: number,
      nextAiSoulPrompt: string,
    ) => {
      if (!hasHydrated) {
        return;
      }
      setIsSaving(true);

      try {
        const currentData = (await fetch("/api/preferences/insight").then((r) =>
          r.json(),
        )) as InsightPreferencesResponse;
        const payload: InsightPreferencesPayload = {
          focusPeople: currentData?.focusPeople ?? [],
          focusTopics: currentData?.focusTopics ?? [],
          language: nextLanguage,
          refreshIntervalMinutes: nextRefreshInterval,
          roleKeys: currentData?.roles?.manual ?? [],
          aiSoulPrompt: nextAiSoulPrompt || undefined,
        };

        const response = await fetch("/api/preferences/insight", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const next = (await response.json()) as InsightPreferencesResponse;
        lastSynced.current = {
          language: next.language ?? nextLanguage,
          refreshInterval: next.refreshIntervalMinutes ?? nextRefreshInterval,
          aiSoulPrompt: next.aiSoulPrompt ?? nextAiSoulPrompt,
        };
        await basicMutate(next, { revalidate: false });
      } catch (error) {
        console.error("[Basic Preferences] Update failed", error);
        toast({
          type: "error",
          description: t("insightPreferences.toast.failure"),
        });
      } finally {
        setIsSaving(false);
      }
    },
    [hasHydrated, t],
  );

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }
    if (
      lastSynced.current &&
      lastSynced.current.language === language &&
      lastSynced.current.refreshInterval === refreshInterval &&
      lastSynced.current.aiSoulPrompt === aiSoulPrompt
    ) {
      return;
    }
    void persistBasicPreferences(language, refreshInterval, aiSoulPrompt);
  }, [language, refreshInterval, aiSoulPrompt, hasHydrated]);

  /**
   * Save basic settings (external fallback)
   */
  const handleSubmit = useCallback(async () => {
    await persistBasicPreferences(language, refreshInterval, aiSoulPrompt);
  }, [language, persistBasicPreferences, refreshInterval, aiSoulPrompt]);

  /**
   * Expose save method to parent component
   */
  useImperativeHandle(ref, () => ({
    save: handleSubmit,
    isSaving,
  }));

  if (isBasicLoading || !hasHydrated) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <RemixIcon
          name="loader_2"
          size="size-4"
          className="mr-2 animate-spin"
        />
        {t("insightPreferences.loading")}
      </div>
    );
  }

  const leftColumn = (
    <div className="space-y-6 min-w-0 p-0">
      {/* Language and refresh frequency */}
      <PersonalizationLanguageRefresh
        language={language}
        onLanguageChange={(code) => {
          setLanguage(code);
        }}
        currentLang={i18n.language}
        onUiLanguageChange={(code) => {
          saveLanguage(code);
          if (code === "system") {
            detectAndSetLanguage();
            return;
          }
          i18n.changeLanguage(code);
        }}
      />
    </div>
  );

  /** Render only language and refresh settings; hide openloomi Soul configuration block. */
  return <div className="flex-1 min-h-0 overflow-y-auto">{leftColumn}</div>;
});

PersonalizationBasicSettings.displayName = "PersonalizationBasicSettings";
