"use client";

import { type ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTranslation } from "react-i18next";
import { Button } from "@openloomi/ui";

import { RemixIcon } from "@/components/remix-icon";
import { getAuthToken } from "@/lib/auth/token-manager";
import {
  AI_SETTINGS_CHANGED_EVENT,
  type ConversationApiSettingsResponse,
  hasUsableConversationApiConfiguration,
  MISSING_API_KEY_REASON,
} from "@/lib/ai/conversation-api-configuration";
import { isTauri } from "@/lib/tauri";
import { fetchWithAuth } from "@/lib/utils";

export function ConversationApiOnboardingGuard({
  children,
}: {
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { status } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const page = searchParams.get("page");
  const isGuardedRoute =
    (pathname === "/" && (page === null || page === "chat")) ||
    pathname === "/workspace";
  const [configurationState, setConfigurationState] = useState<
    "checking" | "available" | "missing"
  >("checking");
  const [settingsRevision, setSettingsRevision] = useState(0);

  useEffect(() => {
    const handleSettingsChanged = () => {
      setConfigurationState("checking");
      setSettingsRevision((current) => current + 1);
    };

    window.addEventListener(AI_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
    return () => {
      window.removeEventListener(
        AI_SETTINGS_CHANGED_EVENT,
        handleSettingsChanged,
      );
    };
  }, []);

  useEffect(() => {
    if (status === "loading") {
      return;
    }

    if (status !== "authenticated") {
      setConfigurationState("available");
      return;
    }

    if (!isGuardedRoute) {
      return;
    }

    if (isTauri() && getAuthToken()) {
      setConfigurationState("available");
      return;
    }

    const abortController = new AbortController();

    async function checkConfiguration() {
      setConfigurationState("checking");
      try {
        const response = await fetchWithAuth("/api/preferences/ai", {
          cache: "no-store",
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error("Failed to load AI API settings");
        }

        const settings =
          (await response.json()) as ConversationApiSettingsResponse;
        if (hasUsableConversationApiConfiguration(settings)) {
          setConfigurationState("available");
          return;
        }

        setConfigurationState("missing");
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        console.error(
          "[API Onboarding] Failed to check conversation API settings",
          error,
        );
        // Fail open when the settings check itself is unavailable.
        setConfigurationState("available");
      }
    }

    void checkConfiguration();
    return () => abortController.abort();
  }, [isGuardedRoute, router, settingsRevision, status]);

  return (
    <>
      {children}
      {isGuardedRoute &&
        configurationState === "missing" &&
        status === "authenticated" && (
          <div className="fixed left-1/2 top-4 z-[1000] flex w-[min(92vw,680px)] -translate-x-1/2 items-start gap-3 rounded-xl border border-primary/25 bg-background/95 p-4 shadow-lg backdrop-blur">
            <RemixIcon
              name="info"
              size="size-5"
              className="mt-0.5 shrink-0 text-primary"
            />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground">
                {t(
                  "settings.aiSettingsMissingBannerTitle",
                  "No conversation API key configured",
                )}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t(
                  "settings.aiSettingsMissingBannerDescription",
                  "Configure an Anthropic-compatible provider before starting a conversation.",
                )}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              className="shrink-0"
              onClick={() =>
                router.push(
                  `/?page=ai-api-settings&reason=${MISSING_API_KEY_REASON}`,
                )
              }
            >
              {t("settings.aiSettingsConfigureButton", "Configure")}
            </Button>
          </div>
        )}
    </>
  );
}
