export const siteMetadata = {
  name: "Alloomi",
  title: "Alloomi | Your Proactive AI Workspace",
  description:
    "Your proactive AI workspace. Always one step ahead. Absolute sovereignty. Total security.",
  siteUrl: "https://alloomi.ai",
  marketingUrl: "https://alloomi.ai",
  appUrl: "https://app.alloomi.ai",
  contactEmail: "support@melandlabs.ai",
  keywords: [
    "Alloomi AI",
    "proactive AI workspace",
    "AI agent",
    "privacy-first AI",
    "local AI",
    "AI sovereignty",
    "secure AI",
    "AI productivity",
    "personal AI assistant",
    "AI workspace",
  ],
  languages: [
    { iso: "en", label: "English" },
    { iso: "zh-Hans", label: "Chinese (Simplified)" },
  ],
};

export const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: siteMetadata.name,
  url: siteMetadata.marketingUrl,
  logo: `${siteMetadata.siteUrl}/images/logo_web.png`,
  contactPoint: [
    {
      "@type": "ContactPoint",
      email: siteMetadata.contactEmail,
      contactType: "customer support",
      availableLanguage: siteMetadata.languages.map(
        (language) => language.label,
      ),
    },
  ],
  areaServed: "Worldwide",
  sameAs: [siteMetadata.marketingUrl, siteMetadata.appUrl],
  description: siteMetadata.description,
};

export const webSiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: siteMetadata.name,
  url: siteMetadata.marketingUrl,
  inLanguage: "en-US",
  description: siteMetadata.description,
  potentialAction: {
    "@type": "SearchAction",
    target: `${siteMetadata.marketingUrl}/?q={search_term_string}`,
    "query-input": "required name=search_term_string",
  },
  publisher: {
    "@type": "Organization",
    name: siteMetadata.name,
    url: siteMetadata.marketingUrl,
  },
};

export const softwareApplicationJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: siteMetadata.name,
  applicationCategory: "ProductivityApplication",
  operatingSystem: "macOS, Windows, Linux",
  url: siteMetadata.marketingUrl,
  image: `${siteMetadata.siteUrl}/images/home/intelligence-hero.png`,
  description: siteMetadata.description,
  featureList: [
    "Local-First Architecture",
    "TEE Encryption",
    "Zero-Training Guarantee",
    "Immutable Audit Logs",
    "Proactive AI",
  ],
  availableLanguage: siteMetadata.languages.map((language) => language.label),
  areaServed: "Worldwide",
  provider: {
    "@type": "Organization",
    name: siteMetadata.name,
    url: siteMetadata.marketingUrl,
  },
};
