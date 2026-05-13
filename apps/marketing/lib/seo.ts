export const siteMetadata = {
  name: "OpenLoomi",
  title: "OpenLoomi | Your Proactive AI Workspace",
  description:
    "Open-source, local-first AI workspace with memory, context, and execution built in.",
  siteUrl: "https://openloomi.ai",
  marketingUrl: "https://openloomi.ai",
  appUrl: "https://app.openloomi.ai",
  contactEmail: "support@melandlabs.ai",
  keywords: [
    "OpenLoomi",
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
