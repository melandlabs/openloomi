export const siteMetadata = {
  name: "openloomi",
  headline: "Scale Your Influence. Clone Your Execution.",
  title:
    "openloomi | Privacy-first AI agent that reads, thinks, and acts locally for you",
  description:
    "openloomi is the privacy-first AI agent that reads, thinks, and acts for you—locally. It connects Telegram, Slack, Gmail, Discord, WhatsApp, and more, recalls long-context, executes intents, and never trains on your data thanks to TEE encryption and a Zero-Training Guarantee.",
  siteUrl: "https://openloomi.ai",
  marketingUrl: "https://openloomi.ai",
  appUrl: "https://app.openloomi.ai",
  contactEmail: "support@melandlabs.ai",
  keywords: [
    "privacy-first AI agent",
    "local-first AI",
    "TEE encryption AI",
    "digital twin",
    "Slack AI automation",
    "Telegram AI automation",
    "Gmail AI assistant",
    "Discord AI summarization",
    "WhatsApp AI replies",
    "AI intent execution",
    "AI CRM enrichment",
    "long-memory AI",
    "Zero-Training Guarantee",
    "openloomi AI",
  ],
  languages: [
    { iso: "en", label: "English" },
    { iso: "zh-Hans", label: "Chinese (Simplified)" },
  ],
  supportedChannels: [
    "Slack",
    "Telegram",
    "Gmail",
    "Discord",
    "WhatsApp",
    "Microsoft Teams",
    "SMS",
  ],
  featureHighlights: [
    "Local-First Architecture with TEE encryption and a Zero-Training Guarantee keeps data sovereign.",
    "Universal context across Telegram, WhatsApp, Slack, Discord, and Email with long-memory recall.",
    "Intent Execution: detects meetings, links, summaries, and drafts replies with approvals before sending.",
    "Immutable audit logs (Merkle-tree) and SOC2-ready controls for compliance-critical teams.",
  ],
  values: {
    privacy:
      "End-to-end encryption, TEE isolation, explicit opt-in actions, and transparent data handling policies",
    productivity:
      "AI-generated summaries, triaged alerts, and reply drafts remove manual triage across fast-moving workstreams",
    coverage:
      "Global availability with English and Simplified Chinese experiences",
    personalization:
      "Purpose-built to act on your behalf with configurable tone, escalation rules, and approval workflows",
  },
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
  ],
  availableLanguage: siteMetadata.languages.map((language) => language.label),
  areaServed: "Worldwide",
  offers: [
    {
      "@type": "Offer",
      name: "Basic",
      price: "15.00",
      priceCurrency: "USD",
      description: "For Creators, includes Persona Training.",
    },
    {
      "@type": "Offer",
      name: "Pro",
      price: "39.00",
      priceCurrency: "USD",
      description:
        "For Super Individuals, includes Cross-Platform Execution & Priority Support.",
    },
  ],
  provider: {
    "@type": "Organization",
    name: siteMetadata.name,
    url: siteMetadata.marketingUrl,
  },
};
