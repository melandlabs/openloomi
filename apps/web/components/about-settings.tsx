"use client";

import {
  type ButtonHTMLAttributes,
  memo,
  useEffect,
  useMemo,
  useState,
} from "react";
import Image from "next/image";
import { Badge, Button, Separator } from "@openloomi/ui";
import { useTranslation } from "react-i18next";
import { RemixIcon } from "@/components/remix-icon";
import ContactUs from "@/components/contact-us";
import { getAppInfo, isTauri, openUrl } from "@/lib/tauri";

interface TauriAppInfo {
  name?: string;
  version?: string;
  description?: string;
}

type AboutSettingsButtonVariant = "plain" | "social";

interface AboutSettingsButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: AboutSettingsButtonVariant;
}

/**
 * Social links use PNG assets under `public/images/apps` (same filenames as integrations).
 * Keep URLs aligned with marketing footer connect links where applicable.
 */
const SOCIAL_LINKS = [
  {
    name: "X",
    href: "https://x.com/openloomiAI",
    iconSrc: "/images/apps/twitter.png",
  },
  {
    name: "LinkedIn",
    href: "https://www.linkedin.com/company/openloomiai",
    iconSrc: "/images/apps/linkedin.png",
  },
  {
    name: "YouTube",
    href: "https://www.youtube.com/@Melandlabs",
    iconSrc: "/images/apps/youtube.png",
  },
  {
    name: "Discord",
    href: "https://discord.gg/xkJaJyWcsv",
    iconSrc: "/images/apps/discord.png",
  },
  {
    name: "Rednote",
    href: "https://xhslink.com/m/B3ZtFPMMke",
    iconSrc: "/images/apps/rednote.png",
  },
  {
    name: "Wechat",
    href: "/wechat.jpg",
    iconSrc: "/images/apps/WeChat.png",
    isWechat: true,
  },
] as const;

/**
 * Render a reusable button style for all native buttons in About settings.
 * Variants centralize visual differences to keep style maintenance in one place.
 */
const AboutSettingsButton = memo(function AboutSettingsButton({
  variant = "plain",
  className = "",
  ...props
}: AboutSettingsButtonProps) {
  const baseClassName =
    "flex w-full items-center rounded-md text-left text-foreground text-sm font-normal";
  const variantClassName: Record<AboutSettingsButtonVariant, string> = {
    plain: "px-0 py-0",
    social:
      "gap-2 rounded-xl bg-gray-100 px-4 py-3 text-left text-foreground transition-colors hover:bg-gray-200",
  };

  return (
    <button
      {...props}
      className={`${baseClassName} ${variantClassName[variant]} ${className}`.trim()}
    />
  );
});

/**
 * Render About page content for settings context.
 * This page contains app version, update check, and support/legal links.
 */
export function AboutSettings() {
  const { t } = useTranslation();
  const [appVersion, setAppVersion] = useState("Web");
  const [showWechatQR, setShowWechatQR] = useState(false);
  const isTauriEnv = useMemo(() => isTauri(), []);
  const websiteLink = "https://openloomi.ai";

  /**
   * Load app version on mount.
   * In Tauri, read version from native command. In Web, keep "Web" fallback.
   */
  useEffect(() => {
    const loadVersion = async () => {
      if (!isTauriEnv) {
        setAppVersion("Web");
        return;
      }
      const info = (await getAppInfo()) as TauriAppInfo | null;
      setAppVersion(info?.version ?? "Unknown");
    };
    loadVersion();
  }, [isTauriEnv]);

  /**
   * Trigger update check action.
   * In Tauri, emit manual update event for existing update workflow.
   * In Web, open release page as fallback.
   */
  const handleCheckForUpdates = () => {
    if (isTauriEnv) {
      window.dispatchEvent(new CustomEvent("manual-update-check"));
      return;
    }

    openUrl("https://github.com/melandlabs/release/releases");
  };

  return (
    <div className="w-full flex flex-col gap-8">
      {/* Only the top product info section keeps a card; the remaining sections have no card containers */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <section>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <img
                src="/images/logo.svg"
                alt="openloomi Logo"
                className="size-16 object-contain shrink-0"
              />
              <div className="flex flex-col items-start gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold text-foreground">
                    openloomi
                  </p>
                  {/* Match app-sidebar logo row Alpha badge */}
                  <Badge
                    variant="outline"
                    className="border border-accent-700 bg-[linear-gradient(90deg,#FDF6EF_0%,#F1F5F9_100%)] text-accent-brand text-[10px] font-bold uppercase tracking-[0.12em] px-2 py-0.5 rounded-lg"
                  >
                    Alpha
                  </Badge>
                </div>
                <p className="text-sm font-normal text-muted-foreground">
                  v{appVersion}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => openUrl("https://openloomi.ai/docs/changelog")}
                className="shrink-0 text-sm font-normal"
              >
                <RemixIcon
                  name="file_list_3"
                  size="size-4"
                  className="mr-2 text-muted-foreground"
                />
                {t("about.changelog", "Changelog")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleCheckForUpdates}
                className="shrink-0 text-sm font-normal"
              >
                <RemixIcon
                  name="refresh"
                  size="size-4"
                  className="mr-2 text-muted-foreground"
                />
                {t("nav.checkForUpdates", "Check for updates")}
              </Button>
            </div>
          </div>
        </section>
      </div>

      <section className="flex flex-col gap-3">
        <p className="px-0 pb-0 text-base font-semibold text-foreground-secondary">
          {t("common.contactUs", "Contact Us")}
        </p>
        <AboutSettingsButton type="button" onClick={() => openUrl(websiteLink)}>
          <span>{t("about.officialWebsite", "Official Website")}</span>
          <RemixIcon
            name="external_link"
            size="size-4"
            className="ml-2 shrink-0 text-muted-foreground"
          />
        </AboutSettingsButton>
        <ContactUs
          placement="sidebar"
          triggerAction="feedback"
          customTrigger={
            <AboutSettingsButton type="button">
              <span>{t("feedback.sendFeedback", "Send Feedback")}</span>
              <RemixIcon
                name="feedback"
                size="size-4"
                className="ml-2 shrink-0 text-muted-foreground"
              />
            </AboutSettingsButton>
          }
        />
        <ContactUs
          placement="sidebar"
          triggerAction="email"
          customTrigger={
            <AboutSettingsButton type="button">
              <span>{t("common.mailToUs", "Email Us")}</span>
              <RemixIcon
                name="inbox_text"
                size="size-4"
                className="ml-2 shrink-0 text-muted-foreground"
              />
            </AboutSettingsButton>
          }
        />
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <p className="px-0 text-base font-semibold text-foreground-secondary">
          {t("about.communityAndInfo", "Follow Us")}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 relative">
          {SOCIAL_LINKS.map((item) => {
            const isWechat = "isWechat" in item && item.isWechat;
            return (
              <div key={item.name} className={isWechat ? "relative group" : ""}>
                <AboutSettingsButton
                  type="button"
                  variant="social"
                  onClick={() =>
                    isWechat
                      ? setShowWechatQR(!showWechatQR)
                      : openUrl(item.href)
                  }
                >
                  <Image
                    src={item.iconSrc}
                    alt=""
                    width={20}
                    height={20}
                    className="size-5 shrink-0 object-contain"
                  />
                  <span className="truncate">{item.name}</span>
                </AboutSettingsButton>
                {isWechat && (
                  <div
                    className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-3 z-50 ${
                      showWechatQR ? "block" : "hidden"
                    } group-hover:block`}
                  >
                    <div
                      className="bg-white p-3 rounded-lg shadow-xl border border-gray-200 relative"
                      style={{ width: "160px", height: "160px" }}
                    >
                      <Image
                        src="/images/wechat.jpg"
                        alt="Wechat QR Code"
                        fill
                        sizes="160px"
                        className="object-contain"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-2">
        <p className="px-0 pb-1 text-base font-semibold text-foreground-secondary">
          {t("about.legalNotice", "Legal Notice")}
        </p>
        <div className="flex flex-col gap-3">
          <AboutSettingsButton
            type="button"
            onClick={() => openUrl("https://app.openloomi.ai/privacy")}
          >
            <span>{t("common.privacy", "Privacy Policy")}</span>
            <RemixIcon
              name="external_link"
              size="size-4"
              className="ml-2 shrink-0 text-muted-foreground"
            />
          </AboutSettingsButton>

          <AboutSettingsButton
            type="button"
            onClick={() => openUrl("https://app.openloomi.ai/terms")}
          >
            <span>{t("common.terms", "Terms of Service")}</span>
            <RemixIcon
              name="external_link"
              size="size-4"
              className="ml-2 shrink-0 text-muted-foreground"
            />
          </AboutSettingsButton>
        </div>
      </section>
    </div>
  );
}
