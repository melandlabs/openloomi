"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

const DOWNLOAD_LINKS = {
  macOS: {
    arm64:
      "https://github.com/melandlabs/release/releases/download/v0.4.2/Alloomi_0.4.2_macOS_aarch64.dmg",
    amd64:
      "https://github.com/melandlabs/release/releases/download/v0.4.2/Alloomi_0.4.2_macOS_amd64.dmg",
  },
  linux: {
    amd64:
      "https://github.com/melandlabs/release/releases/download/v0.4.2/Alloomi_0.4.2_linux_amd64.deb",
    arm64:
      "https://github.com/melandlabs/release/releases/download/v0.4.2/Alloomi_0.4.2_linux_aarch64.deb",
  },
  windows: {
    amd64:
      "https://github.com/melandlabs/release/releases/download/v0.4.2/Alloomi_0.4.2_windows_amd64.exe",
    arm64:
      "https://github.com/melandlabs/release/releases/download/v0.4.2/Alloomi_0.4.2_windows_amd64.exe",
  },
  github: "https://github.com/melandlabs/release/releases",
};

/**
 * Detects client platform once during initial render.
 */
function getInitialPlatform():
  | "mobile"
  | "macOS"
  | "linux"
  | "windows"
  | "unknown" {
  if (typeof window === "undefined") {
    return "unknown";
  }

  const userAgent = window.navigator.userAgent.toLowerCase();
  const isMobileDevice =
    /mobile|android|iphone|ipad|ipod|webos|blackberry|iemobile|opera mini/i.test(
      userAgent,
    ) || window.navigator.maxTouchPoints > 0;

  if (isMobileDevice) return "mobile";
  if (userAgent.includes("mac")) return "macOS";
  if (userAgent.includes("linux")) return "linux";
  if (userAgent.includes("win")) return "windows";
  return "unknown";
}

/**
 * Landing page CTA section (moved out of `Footer`).
 */
export function LandingFooterCtaSection() {
  const { t } = useTranslation();
  const [platform] = useState<
    "mobile" | "macOS" | "linux" | "windows" | "unknown"
  >(getInitialPlatform);

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
        <p className="text-center text-[18px] text-foreground-muted max-w-155 mb-6">
          {t("cta.description")}
        </p>
        {/* Download buttons hidden */}
        {/* {platform === "mobile" ? (
          <div className="bg-background-secondary border border-border-primary rounded-lg px-6 py-4 text-sm text-foreground-secondary max-w-sm">
            {t("cta.mobileDesc")}
          </div>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              {platform === "macOS" && DOWNLOAD_LINKS.macOS.arm64 && (
                <a
                  href={DOWNLOAD_LINKS.macOS.arm64}
                  className="bg-primary-gradient text-primary-foreground px-8 py-4 rounded-lg shadow-sm font-medium transition-all transform flex items-center gap-2 relative z-20 hover:brightness-95 min-w-[180px] justify-center"
                  aria-label="Download for macOS (Apple Silicon)"
                >
                  {t("hero.downloadForMacAppleSilicon")}
                </a>
              )}
              {platform === "macOS" && DOWNLOAD_LINKS.macOS.amd64 && (
                <a
                  href={DOWNLOAD_LINKS.macOS.amd64}
                  className="bg-primary-gradient text-primary-foreground px-8 py-4 rounded-lg shadow-sm font-medium transition-all transform flex items-center gap-2 relative z-20 hover:brightness-95 min-w-[180px] justify-center"
                  aria-label="Download for macOS (Intel)"
                >
                  {t("hero.downloadForMacIntel")}
                </a>
              )}
              {platform === "linux" && DOWNLOAD_LINKS.linux.amd64 && (
                <a
                  href={DOWNLOAD_LINKS.linux.amd64}
                  className="bg-primary-gradient text-primary-foreground px-8 py-4 rounded-lg shadow-sm font-medium transition-all transform flex items-center gap-2 relative z-20 hover:brightness-95 min-w-[180px] justify-center"
                  aria-label="Download for Linux (x86_64)"
                >
                  {t("hero.downloadForLinuxX86_64")}
                </a>
              )}
              {platform === "linux" && DOWNLOAD_LINKS.linux.arm64 && (
                <a
                  href={DOWNLOAD_LINKS.linux.arm64}
                  className="bg-primary-gradient text-primary-foreground px-8 py-4 rounded-lg shadow-sm font-medium transition-all transform flex items-center gap-2 relative z-20 hover:brightness-95 min-w-[180px] justify-center"
                  aria-label="Download for Linux (ARM64)"
                >
                  {t("hero.downloadForLinuxARM64")}
                </a>
              )}
              {platform === "windows" && DOWNLOAD_LINKS.windows.amd64 && (
                <a
                  href={DOWNLOAD_LINKS.windows.amd64}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-primary-gradient text-primary-foreground px-8 py-4 rounded-lg shadow-sm font-medium transition-all transform flex items-center gap-2 relative z-20 hover:brightness-95 min-w-[180px] justify-center"
                  aria-label="Download for Windows"
                >
                  {t("hero.downloadForWindows")}
                </a>
              )}
              {platform === "unknown" && (
                <a
                  href={DOWNLOAD_LINKS.github}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-primary-gradient text-primary-foreground px-8 py-4 rounded-lg shadow-sm font-medium transition-all transform flex items-center gap-2 relative z-20 hover:brightness-95 min-w-[180px] justify-center"
                  aria-label="Download Alloomi"
                >
                  {t("hero.downloadAlloomi")}
                </a>
              )}
            </div>
            <p className="mt-3 text-center text-sm text-muted-foreground">
              {t("cta.subtext")}
            </p>
          </>
        )} */}
      </div>
    </section>
  );
}
