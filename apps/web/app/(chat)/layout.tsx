import { cookies } from "next/headers";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@openloomi/ui";
import { auth } from "../(auth)/auth";
import Script from "next/script";
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

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, cookieStore] = await Promise.all([auth(), cookies()]);
  const userCookieConfirm = cookieStore.get("user-cookie:confirm")?.value;

  return (
    <>
      <Script
        src="https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.js"
        strategy="afterInteractive"
      />
      {/** AppSidebar needs session email info and quota usage */}
      <SessionProvider session={session}>
        <SessionAuthChecker />
        <SidebarProvider defaultOpen={true}>
          <AppSidebar />
          <SidebarInset className="relative z-10 md:h-svh md:max-h-svh md:overflow-hidden md:m-0 p-2 pl-0 sm:p-3 sm:pl-0">
            <Suspense fallback={null}>
              {/* SidePanelShell renders main content + temporary sidebar (flex-row) */}
              <SidePanelProvider>
                <ChatContextProvider>
                  <GlobalInsightDrawerProvider>
                    <SidePanelShell>{children}</SidePanelShell>
                  </GlobalInsightDrawerProvider>
                </ChatContextProvider>
              </SidePanelProvider>
            </Suspense>
          </SidebarInset>
        </SidebarProvider>
      </SessionProvider>
      {!isTauriMode() && (
        <CookieConfirm userCookieConfirm={userCookieConfirm} />
      )}
    </>
  );
}
