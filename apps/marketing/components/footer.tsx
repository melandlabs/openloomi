"use client";

import { useState, useEffect } from "react";

import Link from "next/link";
import Image from "next/image";
import { RemixIcon } from "@/components/remix-icon";
import { useTranslation } from "react-i18next";

/**
 * Footer component props
 */
interface FooterProps {
  /**
   * Footer variant: 'landing' for landing page, 'default' for others
   * Defaults to 'default'
   */
  variant?: "landing" | "default";
  /**
   * Background color variant: 'background', 'surfaceBlue', or 'backgroundCard'
   * Defaults to 'backgroundCard' (variant='default') or 'surfaceBlue' (variant='landing')
   * @deprecated Use variant prop instead
   */
  backgroundVariant?: "background" | "surfaceBlue" | "backgroundCard";
  /**
   * Show background image (landing page only)
   * Defaults to false
   * @deprecated Use variant prop instead
   */
  showBackgroundImage?: boolean;
  /**
   * Transparent background (for parent with background image)
   * Defaults to false
   * @deprecated Use variant prop instead
   */
  transparent?: boolean;
}

/**
 * Footer component
 * Supports two variants: landing (landing page) and default (other pages)
 * @param variant - Footer variant: 'landing' or 'default'
 * @param backgroundVariant - Background variant (deprecated, use variant)
 * @param showBackgroundImage - Show background image (deprecated, use variant)
 * @param transparent - Transparent background (deprecated, use variant)
 */
export function Footer({
  variant,
  backgroundVariant,
  showBackgroundImage,
  transparent,
}: FooterProps = {}) {
  const { t } = useTranslation();

  const isLanding =
    variant === "landing" ||
    (variant === undefined && (showBackgroundImage || transparent));

  const bgVariant =
    backgroundVariant || (isLanding ? "surfaceBlue" : "backgroundCard");

  const finalTransparent =
    variant !== undefined ? isLanding : (transparent ?? false);
  const finalShowBackgroundImage =
    variant !== undefined ? false : (showBackgroundImage ?? false);
  const useUnifiedStyle = true;
  const appDomain = "https://app.alloomi.ai";

  const [showWechatQR, setShowWechatQR] = useState(false);

  const downloadLinks = {
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
      arm64: null,
    },
    github: "https://github.com/melandlabs/release/releases",
  };

  const detectPlatform = () => {
    if (typeof window === "undefined") {
      return "unknown";
    }
    const userAgent = window.navigator.userAgent.toLowerCase();
    if (
      userAgent.includes("iphone") ||
      userAgent.includes("ipad") ||
      userAgent.includes("ipod") ||
      userAgent.includes("android")
    ) {
      return "mobile";
    }
    if (userAgent.includes("mac")) {
      return "macOS";
    }
    if (userAgent.includes("linux")) {
      return "linux";
    }
    if (userAgent.includes("win")) {
      return "windows";
    }
    return "unknown";
  };

  const [platform, setPlatform] = useState("unknown");
  /**
   * Detect platform after client mount; use queueMicrotask to avoid sync setState in effect (eslint react-hooks/set-state-in-effect).
   */
  useEffect(() => {
    queueMicrotask(() => {
      setPlatform(detectPlatform());
    });
  }, []);

  const footerColumns = [
    {
      title: t("footer.resources"),
      items: [
        { name: t("footer.docs"), href: "/docs" },
        { name: t("footer.blogs"), href: "/blogs" },
        { name: t("footer.changelog"), href: "/docs/changelog" },
        { name: t("footer.support"), href: `${appDomain}/support` },
      ],
    },
    {
      title: t("footer.legal"),
      items: [
        { name: t("footer.privacyPolicy"), href: `${appDomain}/privacy` },
        { name: t("footer.termsOfService"), href: `${appDomain}/terms` },
      ],
    },
    {
      title: t("footer.connect"),
      items: [
        {
          name: "X",
          href: "https://x.com/AlloomiAI",
          icon: <RemixIcon name="twitter-x" variant="line" size="size-4" />,
        },
        {
          name: "LinkedIn",
          href: "https://www.linkedin.com/company/alloomiai",
          icon: <RemixIcon name="linkedin-box" variant="line" size="size-4" />,
        },
        {
          name: "YouTube",
          href: "https://www.youtube.com/@Melandlabs",
          icon: <RemixIcon name="youtube" variant="line" size="size-4" />,
        },
        {
          name: "Discord",
          href: "https://discord.gg/xkJaJyWcsv",
          icon: <RemixIcon name="discord" variant="line" size="size-4" />,
        },
        {
          name: "GitHub",
          href: "https://github.com/melandlabs/alloomi",
          icon: <RemixIcon name="github" variant="line" size="size-4" />,
        },
        {
          name: "Rednote",
          href: "https://xhslink.com/m/B3ZtFPMMke",
          icon: <RemixIcon name="book-3" variant="line" size="size-4" />,
        },
        {
          name: "Wechat",
          href: "/wechat.jpg",
          icon: <RemixIcon name="wechat" variant="line" size="size-4" />,
        },
      ],
    },
  ];

  /**
   * Get background color class based on backgroundVariant
   * If transparent is true, don't apply background color
   */
  const bgClass = finalTransparent
    ? ""
    : bgVariant === "surfaceBlue"
      ? "bg-surfaceBlue"
      : bgVariant === "backgroundCard"
        ? "bg-background-card"
        : "bg-background-card";

  /**
   * Get background image style (only when showBackgroundImage is true)
   */
  const backgroundImageStyle = finalShowBackgroundImage
    ? {
        backgroundImage: "url(/img/Background/Flow.jpg)",
        backgroundSize: "cover",
        backgroundPosition: "left center",
        backgroundRepeat: "no-repeat",
      }
    : {};

  /**
   * Check whether to show top divider
   * Landing variant hides border, Default shows border
   */
  const showBorderTop = !useUnifiedStyle && !isLanding;

  // Landing variant uses different vertical spacing to match the preview.
  // Move: <md shows Logo.svg only; Desktop: shows Logo-full-dark.
  return (
    <>
      <footer
        className={`${
          isLanding ? "pt-16" : "pt-12"
        } pb-0 ${useUnifiedStyle ? "bg-primary-950" : isLanding ? "bg-primary-950" : bgClass} ${showBorderTop ? "border-t border-border-primary" : ""} relative`}
        style={finalShowBackgroundImage ? backgroundImageStyle : {}}
      >
        {/* Black gradient mask from bottom - shown in landing variant only, enhances text readability */}
        {isLanding && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "linear-gradient(to top, rgba(0, 0, 0, 0.8) 0%, rgba(0, 0, 0, 0.4) 30%, transparent 100%)",
              zIndex: 0,
            }}
          />
        )}
        <div
          className="max-w-360 mx-auto px-4 sm:px-6 lg:px-10"
          style={{ position: "relative", zIndex: 1 }}
        >
          <div className="flex flex-col lg:flex-row justify-between items-start gap-8 mb-8">
            {/* Logo column - left aligned */}
            <div className="shrink-0 flex flex-col">
              <div>
                <Link href="/" className="flex items-center gap-2 mb-3">
                  <Image
                    src="/img/Logo-full-dark.svg"
                    alt="Alloomi"
                    className="hidden md:block h-7 w-auto object-contain"
                    width={266}
                    height={28}
                    priority
                  />
                  <Image
                    src="/img/logo.svg"
                    alt="Alloomi"
                    className="block md:hidden h-7 w-auto object-contain"
                    width={28}
                    height={28}
                    priority
                  />
                </Link>
                <p
                  className={`${
                    isLanding ? "text-[18px]" : "text-xl"
                  } max-w-xs ${isLanding ? "pt-0" : "pt-1"} ${
                    useUnifiedStyle
                      ? isLanding
                        ? "text-foreground-primary-80"
                        : "text-foreground-primary"
                      : isLanding
                        ? "text-foreground-primary"
                        : "text-foreground-secondary"
                  }`}
                >
                  {t("footer.tagline")}
                </p>
                <p className="text-sm text-foreground-muted mt-4">
                  {t("footer.copyright")}
                </p>
                {/* Download buttons hidden */}
                {/* <div className="flex flex-col sm:flex-row gap-3 mt-6">
                  {platform === "mobile" && (
                    <div className="w-full sm:w-auto bg-background-card border border-border-primary rounded-lg px-5 py-3 text-sm text-foreground-secondary flex flex-col gap-1">
                      <div className="flex items-center gap-2 font-medium text-foreground">
                        <RemixIcon name="computer" size="size-4" />
                        {t("hero.installOnDesktop")}
                      </div>
                      <span>{t("hero.installDesktopDesc")}</span>
                    </div>
                  )}
                  {platform === "macOS" && (
                    <>
                      {downloadLinks.macOS.arm64 && (
                        <a
                          href={downloadLinks.macOS.arm64}
                          className="bg-primary-gradient text-primary-foreground px-6 py-3 rounded-lg shadow-sm font-medium transition-all transform flex items-center gap-2 hover:brightness-95"
                          aria-label={t("hero.macosAppleSilicon")}
                        >
                          <RemixIcon name="download" size="size-4" />
                          {t("hero.macosAppleSilicon")}
                        </a>
                      )}
                      {downloadLinks.macOS.amd64 && (
                        <a
                          href={downloadLinks.macOS.amd64}
                          className="bg-primary-gradient text-primary-foreground px-6 py-3 rounded-lg shadow-sm font-medium transition-all transform flex items-center gap-2 hover:brightness-95"
                          aria-label={t("hero.macosIntel")}
                        >
                          <RemixIcon name="download" size="size-4" />
                          {t("hero.macosIntel")}
                        </a>
                      )}
                    </>
                  )}
                  {platform === "linux" && (
                    <>
                      {downloadLinks.linux.amd64 && (
                        <a
                          href={downloadLinks.linux.amd64}
                          className="bg-primary-gradient text-primary-foreground px-6 py-3 rounded-lg shadow-sm font-medium transition-all transform flex items-center gap-2 hover:brightness-95"
                          aria-label={t("hero.linuxX86_64")}
                        >
                          <RemixIcon name="download" size="size-4" />
                          {t("hero.linuxX86_64")}
                        </a>
                      )}
                      {downloadLinks.linux.arm64 && (
                        <a
                          href={downloadLinks.linux.arm64}
                          className="bg-primary-gradient text-primary-foreground px-6 py-3 rounded-lg shadow-sm font-medium transition-all transform flex items-center gap-2 hover:brightness-95"
                          aria-label={t("hero.linuxARM64")}
                        >
                          <RemixIcon name="download" size="size-4" />
                          {t("hero.linuxARM64")}
                        </a>
                      )}
                    </>
                  )}
                  {platform === "windows" && (
                    <a
                      href={downloadLinks.windows.amd64}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-primary-gradient text-primary-foreground px-6 py-3 rounded-lg shadow-sm font-medium transition-all transform flex items-center gap-2 hover:brightness-95"
                      aria-label={t("hero.downloadForWindows")}
                    >
                      <RemixIcon name="download" size="size-4" />
                      {t("hero.downloadForWindows")}
                    </a>
                  )}
                  {platform === "unknown" && (
                    <a
                      href={downloadLinks.github}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-primary-gradient text-primary-foreground px-6 py-3 rounded-lg shadow-sm font-medium transition-all transform flex items-center gap-2 hover:brightness-95"
                      aria-label={t("hero.downloadAlloomi")}
                    >
                      <RemixIcon name="download" size="size-4" />
                      {t("hero.downloadAlloomi")}
                    </a>
                  )}
                </div> */}
              </div>
            </div>
            {/* Resources, Legal, Connect columns - right aligned */}
            <div className="grid grid-cols-1 sm:grid-cols-3 w-full lg:w-auto gap-6 sm:gap-6">
              {footerColumns.map((column, idx) => (
                <div key={idx} className="min-w-0 pr-0 sm:pr-8">
                  <h3
                    className={`text-sm font-semibold ${useUnifiedStyle ? "text-foreground-primary" : isLanding ? "text-foreground-primary" : "text-foreground"} mb-4`}
                  >
                    {column.title}
                  </h3>
                  <ul className="space-y-3">
                    {column.items.map((item, itemIdx) => {
                      const isExternal = item.href.startsWith("http");
                      const isWechat = item.name === "Wechat";
                      /**
                       * Link style class names
                       * Landing variant: 80% opacity foreground-primary
                       * Default variant: default foreground-muted
                       */
                      const linkClasses =
                        useUnifiedStyle || isLanding
                          ? "text-sm text-foreground-primary-80 hover:text-foreground-primary transition-colors flex items-center gap-2"
                          : "text-sm text-foreground-muted hover:text-foreground transition-colors flex items-center gap-2";
                      const hasIcon = "icon" in item && item.icon;
                      return (
                        <li
                          key={itemIdx}
                          className={isWechat ? "group relative" : ""}
                        >
                          {isExternal ? (
                            <a
                              href={item.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={linkClasses}
                            >
                              {hasIcon && item.icon}
                              <span>{item.name}</span>
                            </a>
                          ) : isWechat ? (
                            <>
                              <div
                                className={`${linkClasses} cursor-pointer`}
                                onClick={() => setShowWechatQR(!showWechatQR)}
                              >
                                {hasIcon && item.icon}
                                <span>{item.name}</span>
                              </div>
                              {/* WeChat QR code - tap to toggle on mobile, hover on desktop */}
                              <div
                                className={`absolute bottom-full left-0 mb-3 z-50 ${
                                  showWechatQR ? "block" : "hidden"
                                } group-hover:block`}
                              >
                                <div
                                  className="bg-white p-3 rounded-lg shadow-xl border border-gray-200 relative"
                                  style={{ width: "200px", height: "200px" }}
                                >
                                  <Image
                                    src="/wechat.jpg"
                                    alt="Wechat QR Code"
                                    fill
                                    sizes="200px"
                                    className="object-contain"
                                  />
                                </div>
                              </div>
                            </>
                          ) : (
                            <Link href={item.href} className={linkClasses}>
                              {hasIcon && item.icon}
                              <span>{item.name}</span>
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          <div className="pt-0 overflow-hidden">
            <div className="flex justify-center items-center w-full px-4">
              <h2
                className="font-bold leading-none text-[100px] sm:text-[100px] md:text-[160px] lg:text-[200px] tracking-[2px] sm:tracking-[4px] md:tracking-[6px] lg:tracking-[8px] whitespace-nowrap"
                style={{
                  backgroundImage:
                    "linear-gradient(180deg, rgba(99, 116, 139, 0.4) 0%, rgba(99, 116, 139, 0) 100%)",
                  backgroundClip: "text",
                  WebkitBackgroundClip: "text",
                  color: "transparent",
                }}
              >
                MELAND
              </h2>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
