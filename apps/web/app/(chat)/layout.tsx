import { cookies } from "next/headers";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@openloomi/ui";
import { auth } from "../(auth)/auth";
import CookieConfirm from "@/components/cookie-confirm";
import "../../i18n";
import { SessionProvider } from "next-auth/react";
import { isTauriMode } from "@/lib/env/constants";
import { Suspense } from "react";
import { GlobalInsightDrawerProvider } from "@/components/global-insight-drawer";
import { SidePanelShell } from "@/components/agent/side-panel-shell";
import { SidePanelProvider } from "@/components/agent/side-panel-context";
import { ChatContextProvider } from "@/components/chat-context";
import { SessionAuthChecker } from "@/components/session-auth-checker";
import { ConversationApiOnboardingGuard } from "@/components/conversation-api-onboarding-guard";
import { ScreenMemoryCaptureProvider } from "@/components/chronicle/screen-memory-provider";
import { LoopNavBridge } from "@/components/loop/loop-nav-bridge";
import { LoopConnectorRefreshBridge } from "@/components/loop/loop-connector-refresh-bridge";
import { PetChatBridge } from "@/components/pet/pet-chat-bridge";
import { PetRuntimeBridge } from "@/components/pet/pet-runtime-bridge";
import { ScheduledJobsInit } from "@/components/scheduled-jobs-init";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, cookieStore] = await Promise.all([auth(), cookies()]);
  const userCookieConfirm = cookieStore.get("user-cookie:confirm")?.value;

  return (
    <>
      {/** AppSidebar needs session email info and quota usage */}
      <SessionProvider session={session}>
        <SessionAuthChecker />
        <ConversationApiOnboardingGuard>
          <SidebarProvider defaultOpen={true}>
            <AppSidebar />
            <SidebarInset className="relative z-10 md:h-svh md:max-h-svh md:overflow-hidden md:m-0 p-2 pl-0 sm:p-3 sm:pl-0">
              <Suspense fallback={null}>
                {/* SidePanelShell renders main content + temporary sidebar (flex-row) */}
                <SidePanelProvider>
                  <ChatContextProvider>
                    <GlobalInsightDrawerProvider>
                      <ScreenMemoryCaptureProvider />
                      {/*
                        LoopNavBridge mounts the openloomi:navigate-decision
                        listener at the (chat) layout level so the pet
                        card's "Open brief / Open wrap / Open plan /
                        Edit" buttons can land on /loop/<id> from any
                        (chat) route — not only the home page. See
                        components/loop/loop-nav-bridge.tsx for the why.
                      */}
                      <LoopNavBridge />
                      {/*
                        LoopConnectorRefreshBridge (#411) force-refreshes
                        the Loop connector snapshot whenever a Composio
                        OAuth flow completes anywhere in the app. The
                        CLI fast-path resolves in ~200ms so we can
                        safely re-probe on every event without paying
                        the 60–120s agentic probe cost. See
                        components/loop/loop-connector-refresh-bridge.tsx
                        for the why.
                      */}
                      <LoopConnectorRefreshBridge />
                      {/*
                        PetChatBridge forwards the
                        openloomi:send-chat-message DOM event (fired by
                        the Rust host when the pet card's
                        "Add more connectors" CTA is clicked) into
                        the chat composer via
                        useChatContext().sendMessage(...). See
                        components/pet/pet-chat-bridge.tsx for the why.
                      */}
                      <PetChatBridge />
                      <PetRuntimeBridge />
                      {/* Drive the local scheduler + ensure-loop-jobs off
                          useSession(). Mounted here (inside SessionProvider)
                          so it can see auth state transitions, not just the
                          first 3s window the previous setTimeout-based
                          version raced against. Tauri-only. */}
                      <ScheduledJobsInit />
                      <SidePanelShell>{children}</SidePanelShell>
                    </GlobalInsightDrawerProvider>
                  </ChatContextProvider>
                </SidePanelProvider>
              </Suspense>
            </SidebarInset>
          </SidebarProvider>
        </ConversationApiOnboardingGuard>
      </SessionProvider>
      {!isTauriMode() && (
        <CookieConfirm userCookieConfirm={userCookieConfirm} />
      )}
    </>
  );
}
