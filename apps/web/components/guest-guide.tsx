"use client";

import { Button } from "@openloomi/ui";
import { useCallback, useEffect, useMemo, useState } from "react";

import { RemixIcon } from "@/components/remix-icon";
import { useIntegrations } from "@/hooks/use-integrations";
import { createIntegrationAccount } from "@/lib/integrations/client";
import {
  getDiscordAuthorizationUrl,
  getSlackAuthorizationUrl,
  getTeamsAuthorizationUrl,
} from "@/lib/integrations";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { GoogleAuthForm, type GoogleAuthSubmission } from "./google-auth";
import { getHomePath } from "@/lib/utils";
import { useTelegramTokenForm } from "./platform-integrations";
import { WhatsAppAuthForm, type WhatsAppUserInfo } from "./whatsapp-auth";

export default function GuestGuide({
  setShowGuestGuide,
}: {
  setShowGuestGuide: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { showTelegramTokenForm } = useTelegramTokenForm();
  const { groupedByIntegration, mutate } = useIntegrations();
  const [isGoogleAuthFormOpen, setIsGoogleAuthFormOpen] = useState(false);
  const [isLinkingGmail, setIsLinkingGmail] = useState(false);
  const [isWhatsAppAuthFormOpen, setIsWhatsAppAuthFormOpen] = useState(false);
  const [isLinkingWhatsApp, setIsLinkingWhatsApp] = useState(false);

  const handleGoogleSubmit = useCallback(
    async ({ email, appPassword, name }: GoogleAuthSubmission) => {
      setIsLinkingGmail(true);
      try {
        const account = await createIntegrationAccount({
          platform: "gmail",
          externalId: email,
          displayName: name ?? email,
          credentials: {
            email,
            appPassword,
          },
          metadata: {
            email,
            name: name ?? email,
          },
          bot: {
            name: `Gmail · ${name ?? email}`,
            description: "Automatically created through Gmail authorization",
            adapter: "gmail",
            enable: true,
          },
        });

        await mutate();
        router.refresh();
      } finally {
        setIsLinkingGmail(false);
      }
    },
    [mutate, router],
  );

  const handleGoogleConnect = useCallback(() => {
    setIsGoogleAuthFormOpen(true);
  }, []);

  const handleGoogleModalClose = useCallback(() => {
    setIsGoogleAuthFormOpen(false);
  }, []);

  const handleWhatsAppSuccess = useCallback(
    async (sessionKey: string, user: WhatsAppUserInfo) => {
      setIsLinkingWhatsApp(true);
      try {
        const account = await createIntegrationAccount({
          platform: "whatsapp",
          externalId: user.wid || sessionKey,
          displayName: user.pushName || user.formattedNumber || "WhatsApp",
          credentials: { sessionKey }, // Only store the session key, user info is in metadata
          metadata: {
            wid: user.wid || null,
            pushName: user.pushName ?? null,
            formattedNumber: user.formattedNumber ?? null,
            sessionKey, // Store sessionKey so self-listener can find the socket
          },
          bot: {
            name: `WhatsApp · ${user.pushName || user.formattedNumber || "Account"}`,
            description: "Auto-created via WhatsApp authorization",
            adapter: "whatsapp",
            enable: true,
          },
        });

        // Register the live socket under accountId so self-listener and insight can find it
        try {
          await fetch("/api/whatsapp/register-socket", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: sessionKey,
              accountId: account.id,
            }),
          });
        } catch {
          /* non-fatal — socket may already be closed */
        }

        await mutate();
        router.refresh();
      } finally {
        setIsLinkingWhatsApp(false);
        setIsWhatsAppAuthFormOpen(false);
      }
    },
    [mutate, router],
  );

  // New: Discord connection logic
  const handleDiscordConnect = useCallback(async () => {
    try {
      const authorizationUrl = await getDiscordAuthorizationUrl();
      window.location.href = authorizationUrl;
    } catch (error) {
      console.error("Failed to start Discord OAuth flow", error);
    }
  }, []);

  // New: WhatsApp connection logic
  const handleWhatsAppConnect = useCallback(() => {
    setIsWhatsAppAuthFormOpen(true);
  }, []);

  const slackAccounts = groupedByIntegration.slack;
  const telegramAccounts = groupedByIntegration.telegram;
  const gmailAccounts = groupedByIntegration.gmail;
  const discordAccounts = groupedByIntegration.discord;
  const whatsappAccounts = groupedByIntegration.whatsapp;
  const teamsAccounts = groupedByIntegration.teams;

  const summarizeAccounts = useCallback((accounts: any[]) => {
    if (accounts.length === 0) {
      return null;
    }
    if (accounts.length === 1) {
      return accounts[0].displayName;
    }
    return `${accounts[0].displayName} +${accounts.length - 1}`;
  }, []);
  // New: State management for translations after client hydration completes
  const [translations, setTranslations] = useState({
    welcome: "",
    openloomiIntro1: "",
    openloomiIntro2: "",
    youCanTry: "",
    suggestedAction1st: "",
    suggestedAction2nd: "",
    suggestedAction3rd: "",
    suggestedAction5th: "",
  });

  // Key fix: fetch translations only after client hydration completes to ensure server and client display consistently
  useEffect(() => {
    setTranslations({
      welcome: t("common.welcome"),
      openloomiIntro1: t("common.openloomiIntro1"),
      openloomiIntro2: t("common.openloomiIntro2"),
      youCanTry: t("common.youCanTry"),
      suggestedAction1st: t("suggestedAction1st.title"),
      suggestedAction2nd: t("suggestedAction2nd.title"),
      suggestedAction3rd: t("suggestedAction3rd.title"),
      suggestedAction5th: t("suggestedAction5th.title"),
    });
  }, [t]);

  // Check user auth information
  const handleOpenPlatforms = useCallback(() => {
    router.push("?page=profile");
  }, [router]);
  const handleStartChat = useCallback(() => {
    setShowGuestGuide(false);
    router.push(getHomePath());
  }, [router, setShowGuestGuide]);

  const handleSlackConnect = useCallback(async () => {
    try {
      const authorizationUrl = await getSlackAuthorizationUrl();
      window.location.href = authorizationUrl;
    } catch (error) {
      console.error("Failed to start Slack OAuth flow", error);
    }
  }, []);

  const handleTeamsConnect = useCallback(async () => {
    try {
      const authorizationUrl = await getTeamsAuthorizationUrl();
      window.location.href = authorizationUrl;
    } catch (error) {
      console.error("Failed to start Teams OAuth flow", error);
    }
  }, []);

  const handleTelegramConnect = useCallback(() => {
    showTelegramTokenForm();
  }, [showTelegramTokenForm]);

  const quickAuthItems = useMemo(
    () =>
      [
        {
          id: "slack",
          label: "Slack",
          icon: "layout_grid",
          connected: slackAccounts.length > 0,
          detail: summarizeAccounts(slackAccounts),
          action: () => {
            if (slackAccounts.length > 0) {
              handleOpenPlatforms();
            } else {
              handleSlackConnect();
            }
          },
        },
        {
          id: "teams",
          label: "Microsoft Teams",
          icon: "panel_left",
          connected: teamsAccounts.length > 0,
          detail: summarizeAccounts(teamsAccounts),
          action: () => {
            if (teamsAccounts.length > 0) {
              handleOpenPlatforms();
            } else {
              handleTeamsConnect();
            }
          },
        },
        {
          id: "telegram",
          label: "Telegram",
          icon: "send_plane",
          connected: telegramAccounts.length > 0,
          detail: summarizeAccounts(telegramAccounts),
          action: () => {
            if (telegramAccounts.length > 0) {
              handleOpenPlatforms();
            } else {
              handleTelegramConnect();
            }
          },
        },
        {
          id: "discord",
          label: "Discord",
          icon: "hashtag",
          connected: discordAccounts.length > 0,
          detail: summarizeAccounts(discordAccounts),
          action: () => {
            if (discordAccounts.length > 0) {
              handleOpenPlatforms();
            } else {
              handleDiscordConnect();
            }
          },
        },
        {
          id: "whatsapp",
          label: "WhatsApp",
          icon: "message",
          connected: whatsappAccounts.length > 0,
          detail: summarizeAccounts(whatsappAccounts),
          action: () => {
            if (whatsappAccounts.length > 0) {
              handleOpenPlatforms();
            } else {
              handleWhatsAppConnect();
            }
          },
        },
        {
          id: "gmail",
          label: "Gmail",
          icon: "mail",
          connected: gmailAccounts.length > 0,
          detail: summarizeAccounts(gmailAccounts),
          action: () => {
            if (gmailAccounts.length > 0) {
              handleOpenPlatforms();
            } else {
              handleGoogleConnect();
            }
          },
        },
      ] as const,
    [
      gmailAccounts,
      slackAccounts,
      teamsAccounts,
      telegramAccounts,
      discordAccounts,
      whatsappAccounts,
      handleGoogleConnect,
      handleOpenPlatforms,
      handleSlackConnect,
      handleTeamsConnect,
      handleTelegramConnect,
      handleDiscordConnect,
      handleWhatsAppConnect,
      summarizeAccounts,
    ],
  );

  const hasConnectedPlatform =
    slackAccounts.length > 0 ||
    telegramAccounts.length > 0 ||
    gmailAccounts.length > 0 ||
    discordAccounts.length > 0 ||
    whatsappAccounts.length > 0;

  useEffect(() => {
    setShowGuestGuide(!hasConnectedPlatform);
  }, [hasConnectedPlatform, setShowGuestGuide]);

  // Show placeholder before hydration completes to keep layout stable
  if (translations.welcome === "") {
    return (
      <>
        <div className="flex flex-1 flex-col bg-[#fafafa]">
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden px-4 pb-10 pt-8 sm:px-6 sm:pt-12">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="size-16 sm:size-20 bg-gradient-to-br rounded-full flex items-center justify-center">
                <Image
                  src="/images/logo_web.png"
                  alt="openloomi Logo"
                  width={32}
                  height={32}
                  className="object-contain"
                />
              </div>
              <div className="h-6 w-3/4 rounded-full bg-[#e8e7e3]" />
              <div className="h-16 w-full rounded-2xl bg-[#f2f1ed]" />
              <div className="h-40 w-full rounded-2xl bg-white/70" />
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-1 flex-col bg-[#fafafa]">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-y-auto px-4 pb-10 pt-8 sm:px-6 sm:pt-12">
          <section className="text-center">
            <div className="size-32 sm:size-20 bg-gradient-to-br rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-6">
              <Image
                src="/images/logo_web.png"
                alt="openloomi Logo"
                width={32}
                height={32}
                className="object-contain"
              />
            </div>

            <h1 className="text-xl sm:text-2xl font-bold text-[#37352f] mb-3 sm:mb-4">
              {translations.welcome}
            </h1>

            <p className="text-[#9b9a97] text-sm sm:text-base leading-relaxed mb-6 sm:mb-8">
              {translations.openloomiIntro1}
              <br />
              {translations.openloomiIntro2}
            </p>

            <Button
              size="lg"
              onClick={handleOpenPlatforms}
              data-tour="guest-connect-primary"
              className="bg-gradient-to-r from-[#2383e2] to-[#1976d2] hover:from-[#1976d2] hover:to-[#1565c0] text-white rounded-lg shadow-lg w-full sm:w-auto"
            >
              <RemixIcon name="magic" size="size-5" className="mr-2" />
              <span>{t("common.quickAuthPrimaryCta")}</span>
            </Button>

            <div
              className="mt-6 w-full rounded-2xl border border-[#e5e5e5] bg-white/95 p-4 shadow-sm sm:p-6"
              data-tour="guest-platform-list"
            >
              <div className="flex flex-col gap-1 text-left">
                <span className="text-sm font-semibold text-[#37352f] sm:text-base">
                  {t("common.quickAuthTitle")}
                </span>
                <span className="text-xs text-[#6f6e69]">
                  {t("common.quickAuthSubtitle")}
                </span>
              </div>

              <div className="mt-4 flex flex-col gap-2">
                {quickAuthItems.map((item) => {
                  const isProcessing =
                    ((item.id === "gmail" && isLinkingGmail) ||
                      (item.id === "whatsapp" && isLinkingWhatsApp)) &&
                    !item.connected;

                  const statusLabel = item.connected
                    ? t("common.quickAuthStatusConnected", {
                        name:
                          item.detail ??
                          t("common.quickAuthStatusConnectedFallback"),
                      })
                    : isProcessing
                      ? t("common.processing")
                      : t("common.quickAuthStatusConnect", {
                          platform: item.label,
                        });

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={item.action}
                      disabled={isProcessing}
                      className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
                        item.connected
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 focus-visible:ring-emerald-200"
                          : "border-[#e5e5e5] bg-white text-[#37352f] hover:bg-[#f7f6f3] focus-visible:ring-[#d0d0cd]"
                      }`}
                    >
                      <span
                        className={`flex size-10 items-center justify-center rounded-full border ${
                          item.connected
                            ? "border-emerald-300 bg-white/80 text-emerald-600"
                            : "border-[#e5e5e5] bg-[#f4f4f2] text-[#4b5563]"
                        }`}
                      >
                        {isProcessing ? (
                          <RemixIcon
                            name="loader_2"
                            size="size-4"
                            className="animate-spin"
                          />
                        ) : (
                          <RemixIcon name={item.icon} size="size-4" />
                        )}
                      </span>
                      <span className="flex flex-col items-start">
                        <span className="text-sm font-semibold text-[#37352f]">
                          {item.label}
                        </span>
                        <span className="text-xs text-[#6f6e69]">
                          {statusLabel}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              className="mt-6 text-left rounded-2xl border border-dashed border-[#dad9d4] bg-white/90 p-4 shadow-sm"
              data-tour="guest-next-steps"
            >
              <p className="text-sm font-semibold text-[#37352f]">
                {t("tour.guest.step3.title")}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-[#6f6e69]">
                {t("tour.guest.step3.body")}
              </p>
            </div>

            {hasConnectedPlatform && (
              <div className="mt-6 flex flex-col items-center gap-3">
                <p className="text-sm text-[#6f6e69]">
                  {t("common.readyToChat")}
                </p>
                <Button onClick={handleStartChat} className="w-full sm:w-auto">
                  {t("common.enterChat")}
                </Button>
              </div>
            )}
          </section>
        </div>
      </div>

      <GoogleAuthForm
        isOpen={isGoogleAuthFormOpen}
        onClose={handleGoogleModalClose}
        onSubmit={handleGoogleSubmit}
      />

      <WhatsAppAuthForm
        isOpen={isWhatsAppAuthFormOpen}
        onClose={() => setIsWhatsAppAuthFormOpen(false)}
        onSuccess={handleWhatsAppSuccess}
        existingAccountId={whatsappAccounts[0]?.id}
      />
    </>
  );
}
