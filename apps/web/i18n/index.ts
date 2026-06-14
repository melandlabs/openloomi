"use client";

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import enUS from "./locales/en-US";
import zhHans from "./locales/zh-Hans";
import { getSystemLocale } from "@/lib/tauri";

// Language code mapping: Maps browser language codes to supported language codes
const languageMap: Record<string, string> = {
  en: "en-US",
  "en-US": "en-US",
  "en-GB": "en-US",
  "en-AU": "en-US",
  "en-CA": "en-US",
  zh: "zh-Hans",
  "zh-CN": "zh-Hans",
  "zh-Hans": "zh-Hans",
  "zh-Hant": "zh-Hans", // Traditional Chinese also maps to Simplified Chinese
  "zh-TW": "zh-Hans",
  "zh-HK": "zh-Hans",
  "zh-SG": "zh-Hans",
};
const LS_KEY_LANGUAGE = "langbot_language";
const LS_KEY_LANGUAGE_USER_SELECTED = "langbot_language_user_selected";

// Convert detected language code to supported language code
const convertLanguage = (lng: string): string => {
  // Try exact match first
  if (languageMap[lng]) {
    return languageMap[lng];
  }
  // Then try matching only the language code (e.g., "zh" extracted from "zh-CN")
  const langCode = lng.split("-")[0];
  return languageMap[langCode] || "en-US";
};

// Force default language on init to avoid hydration mismatch
// Language detection will be triggered manually after component mount
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      "en-US": {
        translation: enUS,
      },
      "zh-Hans": {
        translation: zhHans,
      },
    },
    lng: "en-US", // Initial language always English, ensures server and client consistency
    fallbackLng: "en-US",
    debug: process.env.NODE_ENV === "development",
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    react: {
      useSuspense: false, // Disable Suspense to avoid hydration mismatch
    },
    returnObjects: true, // Allow returning objects (used to get array translation values, etc.)
    detection: {
      // Do not auto-detect, switch to manual trigger
      order: [],
      caches: [],
    },
  });

// Manually detect and set language (called after client mount)
export const detectAndSetLanguage = async () => {
  // If user has actively selected a language, prioritize their choice.
  const hasUserSelected =
    localStorage.getItem(LS_KEY_LANGUAGE_USER_SELECTED) === "true";
  const savedLanguage = localStorage.getItem(LS_KEY_LANGUAGE);
  if (hasUserSelected && savedLanguage && languageMap[savedLanguage]) {
    await i18n.changeLanguage(languageMap[savedLanguage]);
    return;
  }

  // Default to the system language. On the desktop app prefer the OS-level
  // locale (the user's real computer language); fall back to the webview's
  // browser language, which is all that is available on web.
  const osLocale = await getSystemLocale();
  const detectedSource = osLocale ?? navigator.language;
  const detectedLanguage = convertLanguage(detectedSource);

  localStorage.setItem(LS_KEY_LANGUAGE, detectedLanguage);
  await i18n.changeLanguage(detectedLanguage);
};

/**
 * Gets the mapped language from the current browser locale.
 */
export const getSystemLanguage = (): string => {
  if (typeof window === "undefined") {
    return "en-US";
  }
  return convertLanguage(navigator.language);
};

/**
 * Persists language choice; passing "system" enables follow-system mode.
 */
export const saveLanguage = (languageCode: string) => {
  if (typeof window !== "undefined") {
    if (languageCode === "system") {
      localStorage.removeItem(LS_KEY_LANGUAGE);
      localStorage.setItem(LS_KEY_LANGUAGE_USER_SELECTED, "false");
      return;
    }
    localStorage.setItem(LS_KEY_LANGUAGE, languageCode);
    localStorage.setItem(LS_KEY_LANGUAGE_USER_SELECTED, "true");
  }
};

export default i18n;
