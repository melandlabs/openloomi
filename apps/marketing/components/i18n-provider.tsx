"use client";

import { useEffect } from "react";
import { detectAndSetLanguage } from "@/i18n";
import "@/i18n";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    detectAndSetLanguage();
  }, []);

  return <>{children}</>;
}
