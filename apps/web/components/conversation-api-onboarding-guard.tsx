"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";

import { getAuthToken } from "@/lib/auth/token-manager";
import {
  AI_SETTINGS_CHANGED_EVENT,
  type ConversationApiSettingsResponse,
  hasUsableConversationApiConfiguration,
} from "@/lib/ai/conversation-api-configuration";
import { isTauri } from "@/lib/tauri";
import { fetchWithAuth } from "@/lib/utils";

export type ConversationApiConfigurationState =
  | "checking"
  | "available"
  | "missing";

const ConversationApiConfigurationContext =
  createContext<ConversationApiConfigurationState>("available");

export function useConversationApiConfiguration() {
  return useContext(ConversationApiConfigurationContext);
}

export function ConversationApiOnboardingGuard({
  children,
}: {
  children: ReactNode;
}) {
  const { status } = useSession();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const page = searchParams.get("page");
  const isGuardedRoute =
    (pathname === "/" && (page === null || page === "chat")) ||
    pathname === "/workspace";
  const [configurationState, setConfigurationState] =
    useState<ConversationApiConfigurationState>("checking");
  const [settingsRevision, setSettingsRevision] = useState(0);
  const contextValue = useMemo(() => configurationState, [configurationState]);

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
  }, [isGuardedRoute, settingsRevision, status]);

  return (
    <ConversationApiConfigurationContext.Provider value={contextValue}>
      {children}
    </ConversationApiConfigurationContext.Provider>
  );
}
