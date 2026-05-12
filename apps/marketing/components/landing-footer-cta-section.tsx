"use client";

import { useTranslation } from "react-i18next";

/**
 * Landing page CTA section for the open-source project.
 */
export function LandingFooterCtaSection() {
  const { t } = useTranslation();

  return (
    <section className="w-full max-w-360 mx-auto px-4 sm:px-6 lg:px-0 pt-0 pb-0 mt-0 mb-32 lg:w-[calc(100%-240px)]">
      <div
        className="w-full mx-auto rounded-3xl border border-border-primary bg-primary-50 backdrop-blur-sm px-6 sm:px-12 py-10 sm:py-[48px] flex flex-col items-center text-center"
        style={{ width: "100%" }}
      >
        <div className="mb-3 inline-flex items-center justify-center rounded-full bg-flowlight border border-border-primary px-4 py-1">
          <span className="text-sm font-medium text-foreground-secondary">
            {t("cta.badge")}
          </span>
        </div>
        <h2 className="text-[42px] sm:text-[48px] leading-tight w-full font-bold font-serif mb-6">
          {t("cta.heading")}
        </h2>
        <p className="text-center text-[18px] text-foreground-muted max-w-155 mb-8">
          {t("cta.description")}
        </p>
        <div className="flex flex-col sm:flex-row justify-center gap-4">
          <a
            href="https://github.com/melandlabs/openloomi"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-primary-gradient text-primary-foreground px-8 py-4 rounded-lg shadow-sm font-medium transition-all transform flex items-center gap-2 relative z-20 hover:brightness-95 min-w-[180px] justify-center"
          >
            {t("cta.openSourceCta")}
          </a>
        </div>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {t("cta.subtext")}
        </p>
      </div>
    </section>
  );
}
