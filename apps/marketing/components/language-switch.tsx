"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { saveLanguage } from "@/i18n";

export function LanguageSwitch() {
  const { i18n } = useTranslation();
  const [currentLang, setCurrentLang] = useState("en");
  const [mounted, setMounted] = useState(false);

  /**
   * Show real language after mount to avoid SSR/hydration mismatch;
   * async setState to satisfy react-hooks/set-state-in-effect.
   */
  useEffect(() => {
    queueMicrotask(() => {
      setMounted(true);
      setCurrentLang(i18n.language);
    });
  }, [i18n.language]);

  const toggleLanguage = () => {
    const newLang = currentLang === "en" ? "zh-Hans" : "en";
    saveLanguage(newLang);
    setCurrentLang(newLang);
  };

  if (!mounted) {
    return (
      <div
        style={{
          width: "48px",
          height: "48px",
          borderRadius: "12px",
        }}
      />
    );
  }

  return (
    <button
      onClick={toggleLanguage}
      aria-label="Toggle language"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "48px",
        height: "48px",
        borderRadius: "12px",
        backgroundColor: "var(--color-background-card)",
        border: "1px solid var(--color-border-primary)",
        cursor: "pointer",
        transition: "all 0.15s",
        fontSize: "13px",
        fontWeight: 600,
        color: "var(--color-foreground-muted)",
        boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--color-border-primary)";
        e.currentTarget.style.backgroundColor =
          "var(--color-background-secondary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--color-border-primary)";
        e.currentTarget.style.backgroundColor = "var(--color-background-card)";
      }}
    >
      {currentLang === "zh-Hans" ? "中" : "EN"}
    </button>
  );
}
