import { Noto_Sans_SC, Noto_Serif_SC } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { I18nProvider } from "@/components/i18n-provider";
import { TooltipProvider } from "@openloomi/ui";

import "./globals.css";
import "remixicon/fonts/remixicon.css";
import { Suspense } from "react";
import { SonnerToaster } from "@/components/sonner-toaster";
import { MotionConfigProvider } from "@/components/motion-config-provider";
import { GeddleScript } from "@/components/geddle-script";
import { AppProviders } from "@/components/app-providers";
import { ScheduledJobsInit } from "@/components/scheduled-jobs-init";

const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});
const notoSerifSC = Noto_Serif_SC({
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
});

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${notoSansSC.className} ${notoSerifSC.className}`}
      // `next-themes` injects an extra classname to the body element to avoid
      // visual flicker before hydration. Hence the `suppressHydrationWarning`
      // prop is necessary to avoid the React hydration mismatch warning.
      // https://github.com/pacocoursey/next-themes?tab=readme-ov-file#with-app
      suppressHydrationWarning
    >
      <head>
        <Suspense fallback={null}>
          <GeddleScript />
        </Suspense>
      </head>
      <body className="antialiased" suppressHydrationWarning>
        {/* Only initialize ScheduledJobs in Tauri environment */}
        <ScheduledJobsInit />
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <MotionConfigProvider>
            <I18nProvider>
              <TooltipProvider>
                <SonnerToaster />
                <AppProviders>{children}</AppProviders>
              </TooltipProvider>
            </I18nProvider>
          </MotionConfigProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
