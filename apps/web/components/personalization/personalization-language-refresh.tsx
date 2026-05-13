"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openloomi/ui";
import { LanguageSettingsMenu } from "@/components/language-settings-menu";

/**
 * Props for the language and refresh interval selector component
 */
interface PersonalizationLanguageRefreshProps {
  /** Current language setting */
  language: string;
  /** Language change callback */
  onLanguageChange: (language: string) => void;
  /** Current interface language */
  currentLang: string;
  /** Interface language change callback */
  onUiLanguageChange: (language: string) => void;
}

/**
 * Language and refresh interval selector component
 * Provides options for setting language and refresh frequency
 */
export function PersonalizationLanguageRefresh({
  language,
  onLanguageChange,
  currentLang,
  onUiLanguageChange,
}: PersonalizationLanguageRefreshProps) {
  const { t } = useTranslation();

  /**
   * Language options list
   */
  const languageOptions = useMemo(
    () => [
      { value: "auto", label: t("insightPreferences.language.auto") },
      { value: "en-US", label: t("insightPreferences.language.en") },
      { value: "zh-Hans", label: t("insightPreferences.language.zh") },
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Language selection row, aligned with account settings layout */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {t("insightPreferences.languageLabel")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("insightPreferences.languageDescription")}
          </p>
        </div>
        <Select
          value={language === "" ? "auto" : language}
          onValueChange={(value) =>
            onLanguageChange(value === "auto" ? "" : value)
          }
        >
          <SelectTrigger className="h-9 w-full sm:w-[220px] shrink-0 self-start sm:self-center rounded-md px-3 text-sm font-medium border border-border/80 bg-surface hover:bg-surface-hover hover:text-foreground/90 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&>span]:w-fit [&>span]:flex-none">
            <SelectValue
              placeholder={t("insightPreferences.languagePlaceholder")}
            />
          </SelectTrigger>
          <SelectContent className="z-[1010]">
            {languageOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {t("insightPreferences.uiLanguageLabel")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "insightPreferences.uiLanguageDescription",
              "Switch the interface language.",
            )}
          </p>
        </div>
        <LanguageSettingsMenu
          variant="personalization"
          currentLang={currentLang}
          onLanguageChange={onUiLanguageChange}
        />
      </div>
    </div>
  );
}
