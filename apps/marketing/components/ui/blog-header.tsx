"use client";

import { useTranslation } from "react-i18next";

export function BlogHeader() {
  const { t } = useTranslation();
  return (
    <>
      <h1 className="text-3xl font-bold text-center mb-2 text-foreground">
        {t("blogsPage.title")}
      </h1>
      <p className="text-foreground-muted text-center mb-8">
        {t("blogsPage.description")}
      </p>
    </>
  );
}
