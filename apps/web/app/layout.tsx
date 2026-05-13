import type { Metadata } from "next";
import { Noto_Sans_SC, Noto_Serif_SC } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { I18nProvider } from "@/components/i18n-provider";
import { TooltipProvider } from "@openloomi/ui";
import {
  organizationJsonLd,
  siteMetadata,
  softwareApplicationJsonLd,
  webSiteJsonLd,
} from "@/lib/marketing/seo";

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

export const metadata: Metadata = {
  metadataBase: new URL(siteMetadata.siteUrl),
  title: {
    default: siteMetadata.title,
    template: `%s | ${siteMetadata.name}`,
  },
  description: siteMetadata.description,
  keywords: siteMetadata.keywords,
  applicationName: siteMetadata.name,
  authors: [{ name: siteMetadata.name }],
  creator: siteMetadata.name,
  publisher: siteMetadata.name,
  category: "productivity",
  alternates: {
    canonical: siteMetadata.siteUrl,
  },
  openGraph: {
    type: "website",
    url: siteMetadata.siteUrl,
    title: siteMetadata.title,
    description: siteMetadata.description,
    siteName: siteMetadata.name,
    locale: "en_US",
    alternateLocale: ["zh_CN"],
    images: [
      {
        url: `${siteMetadata.siteUrl}/images/home/intelligence-hero.png`,
        width: 1024,
        height: 1024,
        alt: "openloomi privacy-first AI agent that reads, thinks, and acts locally across your channels",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteMetadata.title,
    description: siteMetadata.description,
    images: [`${siteMetadata.siteUrl}/images/home/intelligence-hero.png`],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  other: {
    distribution: "global",
    "area-served": "Worldwide",
    "marketing-site": siteMetadata.marketingUrl,
  },
};

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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(webSiteJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationJsonLd),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(softwareApplicationJsonLd),
          }}
        />
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
