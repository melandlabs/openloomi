"use client";

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./en";
import { zhHans } from "./zh-Hans";

// Language code mapping
const languageMap: Record<string, string> = {
  en: "en",
  "en-US": "en",
  "en-GB": "en",
  "en-AU": "en",
  "en-CA": "en",
  zh: "zh-Hans",
  "zh-CN": "zh-Hans",
  "zh-Hans": "zh-Hans",
  "zh-Hant": "zh-Hans",
  "zh-TW": "zh-Hans",
  "zh-HK": "zh-Hans",
  "zh-SG": "zh-Hans",
};

const convertLanguage = (lng: string): string => {
  if (languageMap[lng]) {
    return languageMap[lng];
  }
  const langCode = lng.split("-")[0];
  return languageMap[langCode] || "en";
};

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    "zh-Hans": { translation: zhHans },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
  returnObjects: true,
});

export const detectAndSetLanguage = () => {
  const savedLanguage = localStorage.getItem("marketing_language");
  if (savedLanguage && languageMap[savedLanguage]) {
    i18n.changeLanguage(languageMap[savedLanguage]);
    return;
  }
  const browserLang = navigator.language;
  const detectedLanguage = convertLanguage(browserLang);
  localStorage.setItem("marketing_language", detectedLanguage);
  i18n.changeLanguage(detectedLanguage);
};

export const saveLanguage = (languageCode: string) => {
  if (typeof window !== "undefined") {
    localStorage.setItem("marketing_language", languageCode);
    i18n.changeLanguage(languageCode);
  }
};

export default i18n;
