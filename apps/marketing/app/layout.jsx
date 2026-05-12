import "./globals.css";
import "../styles/animations.css";
import { Suspense } from "react";
import Script from "next/script";
import { PosthogProvider } from "@/components/posthog-provider";
import { GoogleAnalytics } from "@/components/google-analytics";
import { I18nProvider } from "@/components/i18n-provider";
import {
  organizationJsonLd,
  siteMetadata,
  softwareApplicationJsonLd,
  webSiteJsonLd,
} from "@/lib/seo";

export const metadata = {
  metadataBase: new URL("https://alloomi.ai"),
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
        alt: "Alloomi — Your proactive AI workspace. Always one step ahead.",
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
  icons: {
    icon: {
      url: "/img/logo.svg",
      type: "image/svg+xml",
    },
    apple: {
      url: "/img/logo.svg",
      type: "image/svg+xml",
    },
  },
};

// Theme script to avoid hydration mismatch
const themeScript = `
  (function() {
    try {
      var theme = localStorage.getItem('theme');
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.add('light');
      }
    } catch (e) {}
  })()
`;

// Language script to avoid hydration mismatch
const languageScript = `
  (function() {
    try {
      var lang = localStorage.getItem('marketing_language');
      if (lang === 'zh-Hans') {
        document.documentElement.lang = 'zh-Hans';
      } else {
        document.documentElement.lang = 'en';
      }
    } catch (e) {}
  })()
`;

/**
 * Marketing app root layout, injects theme script and global Provider.
 */
export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: languageScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&family=Noto+Serif+SC:wght@400;600&display=swap"
          rel="stylesheet"
        />
        <Script
          id="alloomi-website-jsonld"
          type="application/ld+json"
          strategy="beforeInteractive"
        >
          {JSON.stringify(webSiteJsonLd)}
        </Script>
        <Script
          id="alloomi-organization-jsonld"
          type="application/ld+json"
          strategy="beforeInteractive"
        >
          {JSON.stringify(organizationJsonLd)}
        </Script>
        <Script
          id="alloomi-software-jsonld"
          type="application/ld+json"
          strategy="beforeInteractive"
        >
          {JSON.stringify(softwareApplicationJsonLd)}
        </Script>
      </head>
      <body className="font-sans">
        <Suspense fallback={null}>
          <GoogleAnalytics />
        </Suspense>
        <PosthogProvider>
          <I18nProvider>{children}</I18nProvider>
        </PosthogProvider>
      </body>
    </html>
  );
}
