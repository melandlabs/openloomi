"use client";

import React, { useRef, useState, useEffect } from "react";
import { RemixIcon } from "@/components/remix-icon";
import Link from "next/link";
import Image from "next/image";
import { Footer } from "@/components/footer";
import { LandingFooterCtaSection } from "@/components/landing-footer-cta-section";
import { Navbar } from "@/components/navbar";
import { UseCaseCard } from "@/components/use-case-card";
import TestimonialSection from "@/components/ui/testimonial-section";
import {
  HowItWorksSection,
  ThenItActsSection,
  CapabilitiesSection,
} from "@/components/problem-narrative-sections";
import { SectionEyebrow } from "@/components/section-eyebrow";
import { useTranslation } from "react-i18next";

const data = {
  downloadLinks: {
    macOS: {
      arm64:
        "https://github.com/melandlabs/release/releases/download/v0.4.2/Alloomi_0.4.2_macOS_aarch64.dmg",
      amd64:
        "https://github.com/melandlabs/release/releases/download/v0.4.2/Alloomi_0.4.2_macOS_amd64.dmg",
    },
    linux: {
      amd64:
        "https://github.com/melandlabs/release/releases/download/v0.4.2/Alloomi_0.4.2_linux_amd64.deb",
      arm64:
        "https://github.com/melandlabs/release/releases/download/v0.4.2/Alloomi_0.4.2_linux_aarch64.deb",
    },
    windows: {
      amd64:
        "https://github.com/melandlabs/release/releases/download/v0.4.2/Alloomi_0.4.2_windows_amd64.exe",
      arm64: null,
    },
    github: "https://github.com/melandlabs/release/releases",
  },
  hero: {
    title: "You focus on what matters. Alloomi closes the loop.",
    subtitle:
      "Your proactive AI workspace. <br/>Nothing falls through the cracks.",
    cta: { primary: "Start Free Trial" },
  },
  features: [
    {
      title: "Proactive Awareness — Before You Ask",
      description:
        "Alloomi continuously monitors signals across platforms—Slack, Email, Calendar, Documents—alerting you to important events proactively. Anomaly detection 10 minutes early, critical opportunities never missed.",
      videoUrl: "/img/alloomi/alloomi-event.gif",
    },
    {
      title: "95% Noise Filtering — Focus on What Matters",
      description:
        "Hundreds of daily messages refined into one focused panel. Alloomi tells you what you should act on—not drowning you in information overload.",
      videoUrl: "/img/alloomi/alloomi-filter.gif",
    },
    {
      title: "Long-Term Memory — Context Across Connectors",
      description:
        "Alloomi builds persistent knowledge graphs of people, projects, and decisions. Six months later, it still remembers your commitments and context. No more repeating yourself, no more context loss.",
      videoUrl: "/img/alloomi/alloomi-connectors.gif",
    },
    {
      title: "Autonomous Execution — Complete the Loop",
      description:
        "Not just telling you what to do—Alloomi does it. Drafts replies, schedules meetings, generates reports, tracks and validates results end-to-end.",
      videoUrl: "/img/alloomi/alloomi-actions.gif",
    },
    {
      title: "200+ Skills — Rich Execution Capabilities",
      description:
        "From code generation to PDF creation, data analysis to browser automation—Alloomi's Skills ecosystem covers every work scenario and keeps expanding.",
      videoUrl: "/img/alloomi/alloomi-skills.gif",
    },
  ],
  support: {
    title: "How People Use Alloomi",
    items: [
      {
        title: "Never Miss a Critical Signal",
        description:
          "For leaders navigating cross-departmental complexity. Alloomi acts as your executive twin—tracking milestones across the organization and turning scattered signals into a unified strategic path.",
        role: "For Global Managers",
        image: "/img/People/Global Leaders.png",
      },
      {
        title: "Team Memory That Never Decays",
        description:
          "For researchers, analysts, and product teams. Transform discussions scattered across Slack, Jira, and documents into structured knowledge. Auto-generate weekly reports, eliminate context rot.",
        role: "For Engineers & Product Teams",
        image: "/img/People/Knowledge Teams.png",
      },
      {
        title: "One Person Does the Work of Many",
        description:
          "For founders and sales professionals. Alloomi learns your communication style, automatically maintains hundreds of client relationships, generates personalized proposals—never burns out.",
        role: "For Founders & Sales",
        image: "/img/People/Creators Sales.png",
      },
    ],
  },
  sovereignty: {
    title: "Your Data, Your Sovereignty",
    subtitle:
      "Alloomi puts privacy and control first—you never need to trade data sovereignty for intelligence.",
    items: [
      {
        title: "Local-First Architecture",
        description:
          "Your raw messages and files stay on your device. Alloomi accesses only what's needed—no unnecessary uploads.",
        image: "/img/Privacy/Property 1=Local-First.png",
        icon: "database-2",
      },
      {
        title: "End-to-End Encryption",
        description:
          "All authorized data encrypted with AES-256, processed in hardware-isolated trusted execution environments.",
        image: "/img/Privacy/Property 1=E2E.png",
        icon: "lock",
      },
      {
        title: "Zero Training Commitment",
        description:
          "Your data will never be used to train public AI models—now or ever. Legally guaranteed.",
        image: "/img/Privacy/Property 1=Zero-Training.png",
        icon: "brain-4",
      },
      {
        title: "SOC 2 Compliance",
        description:
          "All critical operations logged in tamper-proof audit logs. SOC 2 compliance certification in progress.",
        image: "/img/Privacy/Property 1=Logs.png",
        icon: "shield-check",
      },
    ],
  },
  signals: {
    title: "Strategy and Execution. In Sync.",
    subtitle:
      "Alloomi turns scattered information into a proactive digital twin—aligning your world so you can move forward, not just react.",
    heroCard: {
      icon: "/img/Icon/graph.svg",
      title: "Transform Your Communication Workflow",
      description:
        "Alloomi reimagines how you interact with information. Instead of drowning in messages, you work with meaningful signals that drive decisions and actions. Our intelligent system filters, connects, and prioritizes what truly matters.",
    },
    cards: [
      {
        icon: "/img/Icon/graph.svg",
        title: "Unified Clarity",
        description:
          "Connect your entire digital world into a single, uncompromised context.",
      },
      {
        icon: "/img/Icon/cognition.svg",
        title: "Total Recall",
        description:
          "Master every detail across people and projects. Preserving history, never resetting it.",
      },
      {
        icon: "/img/Icon/suggestion.svg",
        title: "Active Momentum",
        description:
          "Move beyond suggestions. Alloomi orchestrates the tools you need to turn intent into action.",
      },
    ],
  },
  platforms: [],
};

const hubspotEnabled = process.env.NEXT_PUBLIC_HUBSPOT_ENABLED === "true";
const googleDocsEnabled =
  process.env.NEXT_PUBLIC_GOOGLE_DOCS_ENABLED === "true";
const outlookCalendarEnabled =
  process.env.NEXT_PUBLIC_OUTLOOK_CALENDAR_ENABLED === "true";

data.platforms = [
  { name: "Slack", logoPath: "/img/apps/slack.png", completed: true },
  { name: "Telegram", logoPath: "/img/apps/telegram.png", completed: true },
  { name: "Discord", logoPath: "/img/apps/discord.png", completed: true },
  { name: "WhatsApp", logoPath: "/img/apps/whatsapp.png", completed: true },
  { name: "Gmail", logoPath: "/img/apps/gmail.png", completed: true },
  { name: "Outlook", logoPath: "/img/apps/outlook.png", completed: true },
  { name: "iMessage", logoPath: "/img/apps/iMessage.png", completed: true },
  { name: "Lark/Feishu", logoPath: "/img/apps/feishu.png", completed: true },
  { name: "QQ", logoPath: "/img/apps/qq.png", completed: true },
  { name: "X", logoPath: "/img/apps/twitter.png", completed: true },
  {
    name: "Google Docs",
    logoPath: "/img/apps/google_docs.png",
    completed: googleDocsEnabled,
  },
  {
    name: "HubSpot",
    logoPath: "/img/apps/hubspot.png",
    completed: hubspotEnabled,
  },
  {
    name: "Outlook Calendar",
    logoPath: "/img/apps/outlook_calendar.png",
    completed: outlookCalendarEnabled,
  },
  {
    name: "Google Drive",
    logoPath: "/img/apps/google_drive.png",
    completed: false,
  },
  { name: "GitHub", logoPath: "/img/apps/github.png", completed: false },
  {
    name: "Google Calendar",
    logoPath: "/img/apps/google_calendar.png",
    completed: false,
  },
  { name: "LinkedIn", logoPath: "/img/apps/linkedin.png", completed: false },
  {
    name: "Instagram",
    logoPath: "/img/apps/Instagram.png",
    completed: false,
  },
  {
    name: "Facebook Messenger",
    logoPath: "/img/apps/facebook_messenger.png",
    completed: false,
  },
  {
    name: "Microsoft Teams",
    logoPath: "/img/apps/teams.png",
    completed: false,
  },
  { name: "Notion", logoPath: "/img/apps/notion.png", completed: false },
  { name: "Asana", logoPath: "/img/apps/asana.png", completed: false },
  { name: "Jira", logoPath: "/img/apps/jira.png", completed: false },
  { name: "Linear", logoPath: "/img/apps/linear.png", completed: false },
];

const supportSectionWrapper =
  "w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 pb-3 sm:pb-20 md:pb-20 mb-0";

// Support Section ("How People Use Alloomi") is hidden per requirements
const showSupportSection = false;
const sectionHeading =
  "text-2xl sm:text-3xl md:text-5xl w-full font-serif font-semibold tracking-tight text-foreground text-left mb-4";
const sovereigntySectionHeading =
  "text-2xl sm:text-3xl md:text-5xl w-full font-serif font-semibold tracking-tight text-foreground text-center mb-0";
const sovereigntyCardClassName =
  "w-full rounded-none bg-background-secondary/30 overflow-hidden px-0 flex flex-col gap-2 mb-0 border-t border-border";

const SovereigntyCard = ({ item }) => {
  return (
    <div className={sovereigntyCardClassName}>
      {/* Matches screenshot: left side has icon + title, right side displays description */}
      <div className="w-full px-0 pt-6 pb-12 flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex items-start gap-3">
          {/* Each item uses a different RemixIcon for semantic meaning. */}
          <RemixIcon
            name={item.icon}
            size="size-5"
            className="mt-1 flex-shrink-0 text-foreground-muted"
          />
          <span className="text-[18px] font-serif font-semibold text-foreground">
            {item.title}
          </span>
        </div>
        <p className="text-foreground-muted text-base leading-relaxed max-w-[540px]">
          {item.description}
        </p>
      </div>
    </div>
  );
};

const detectPlatform = () => {
  if (typeof window === "undefined") {
    return "unknown";
  }
  const userAgent = window.navigator.userAgent.toLowerCase();
  if (
    userAgent.includes("iphone") ||
    userAgent.includes("ipad") ||
    userAgent.includes("ipod") ||
    userAgent.includes("android")
  ) {
    return "mobile";
  }
  if (userAgent.includes("mac")) {
    return "macOS";
  }
  if (userAgent.includes("linux")) {
    return "linux";
  }
  if (userAgent.includes("win")) {
    return "windows";
  }
  return "unknown";
};

/**
 * MarketingPage: Main module layout for the homepage marketing landing page (Hero / Problem / How it works, etc.).
 */
const MarketingPage = () => {
  const { t } = useTranslation();
  const [platform, setPlatform] = useState("unknown");
  const supportRef = useRef(null);

  // Detect platform after hydration to avoid server/client mismatch
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlatform(detectPlatform());
  }, []);

  const navLinks = [
    { name: t("nav.home"), href: "/" },
    { name: t("nav.docs"), href: "/docs" },
    { name: t("nav.blogs"), href: "/blogs" },
  ];

  // Safe array translation getter (returns empty array if not ready)
  const getArr = (key) => {
    const val = t(key, { returnObjects: true });
    return Array.isArray(val) ? val : [];
  };

  const problemCardsLocalized = [
    { text: t("problem.cards.0"), image: "/img/pic/problem/problem_01.png" },
    { text: t("problem.cards.1"), image: "/img/pic/problem/problem_02.png" },
    { text: t("problem.cards.2"), image: "/img/pic/problem/problem_03.png" },
  ];

  return (
    <div className="relative bg-background text-foreground min-h-screen flex flex-col">
      {/* Navbar */}
      <Navbar
        links={navLinks}
        showAuthButtons={false}
        topOffset="0"
        backgroundVariant="background"
        transparent={false}
      />
      <div className="flex-1">
        {/* Hero Section */}
        <section className="relative sm:pb-32 text-foreground min-h-[80vh] flex flex-col items-start justify-start pt-28 sm:pt-32">
          <div className="max-w-360 mx-auto px-4 sm:px-20 lg:px-16 w-full relative z-10 mt-12">
            <div className="w-full text-left space-y-8 flex flex-col justify-start items-start gap-0 px-0">
              <h1 className="text-4xl sm:text-[64px] font-semibold font-serif tracking-tight leading-tight text-foreground mb-6 text-left">
                <span className="text-primary">{t("hero.title")}</span>
              </h1>
              <p className="text-xl text-foreground-secondary w-full text-left">
                {t("hero.subtitle")}
              </p>
              {/* Download buttons hidden */}
              {/* <div className="flex flex-col sm:flex-row justify-center gap-4">
                {platform === "mobile" && (
                  <div className="w-full sm:w-auto bg-background-card border border-border-primary rounded-lg px-6 py-4 text-sm text-foreground-secondary flex flex-col gap-1">
                    <div className="flex items-center gap-2 font-medium text-foreground">
                      <RemixIcon name="computer" size="size-5" />
                      {t("hero.installOnDesktop")}
                    </div>
                    <span>{t("hero.installDesktopDesc")}</span>
                  </div>
                )}
                {platform === "macOS" && (
                  <>
                    {data.downloadLinks.macOS.arm64 && (
                      <a
                        href={data.downloadLinks.macOS.arm64}
                        className="bg-primary-gradient text-primary-foreground px-8 py-4 rounded-lg shadow-sm font-medium transition-all transform flex items-center gap-2 relative z-20 hover:brightness-95 min-w-[220px] justify-center"
                        aria-label={`Download Alloomi for ${t("hero.macosAppleSilicon")}`}
                      >
                        <RemixIcon name="download" size="size-5" />
                        {t("hero.macosAppleSilicon")}
                      </a>
                    )}
                    {data.downloadLinks.macOS.amd64 && (
                      <a
                        href={data.downloadLinks.macOS.amd64}
                        className="bg-primary-gradient text-primary-foreground px-8 py-4 rounded-lg shadow-sm font-medium transition-all transform flex items-center gap-2 relative z-20 hover:brightness-95 min-w-[220px] justify-center"
                        aria-label={`Download Alloomi for ${t("hero.macosIntel")}`}
                      >
                        <RemixIcon name="download" size="size-5" />
                        {t("hero.macosIntel")}
                      </a>
                    )}
                  </>
                )}
                {platform === "linux" && (
                  <>
                    {data.downloadLinks.linux.amd64 && (
                      <a
                        href={data.downloadLinks.linux.amd64}
                        className="bg-primary-gradient text-primary-foreground px-8 py-4 rounded-lg shadow-sm font-medium transition-all transform flex items-center gap-2 relative z-20 hover:brightness-95 min-w-[220px] justify-center"
                        aria-label={`Download Alloomi for ${t("hero.linuxX86_64")}`}
                      >
                        <RemixIcon name="download" size="size-5" />
                        {t("hero.linuxX86_64")}
                      </a>
                    )}
                    {data.downloadLinks.linux.arm64 && (
                      <a
                        href={data.downloadLinks.linux.arm64}
                        className="bg-primary-gradient text-primary-foreground px-8 py-4 rounded-lg shadow-sm font-medium transition-all transform flex items-center gap-2 relative z-20 hover:brightness-95 min-w-[220px] justify-center"
                        aria-label={`Download Alloomi for ${t("hero.linuxARM64")}`}
                      >
                        <RemixIcon name="download" size="size-5" />
                        {t("hero.linuxARM64")}
                      </a>
                    )}
                  </>
                )}
                {platform === "windows" && (
                  <a
                    href={data.downloadLinks.windows.amd64}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-primary-gradient text-primary-foreground px-8 py-4 rounded-lg shadow-sm font-medium transition-all transform flex items-center gap-2 relative z-20 hover:brightness-95"
                    aria-label={t("hero.downloadForWindows")}
                  >
                    <RemixIcon name="download" size="size-5" />
                    {t("hero.downloadForWindows")}
                  </a>
                )}
                {platform === "unknown" && (
                  <a
                    href={data.downloadLinks.github}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-primary-gradient text-primary-foreground px-8 py-4 rounded-lg shadow-sm font-medium transition-all transform flex items-center gap-2 relative z-20 hover:brightness-95"
                    aria-label={t("hero.downloadAlloomi")}
                  >
                    <RemixIcon name="download" size="size-5" />
                    {t("hero.downloadAlloomi")}
                  </a>
                )}
              </div> */}
              <div className="w-full mt-8">
                <Image
                  src="/img/pic/Main.png"
                  alt="Alloomi main workspace preview"
                  className="w-full h-auto rounded-3xl"
                  width={1440}
                  height={900}
                  loading="eager"
                />
              </div>
            </div>
          </div>
        </section>

        {/* The Problem Section */}
        <section className="w-full mx-0 py-20 sm:py-32 bg-primary-50">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-20 lg:px-16">
            <SectionEyebrow variant="pill" className="mb-6">
              {t("problem.eyebrow")}
            </SectionEyebrow>
            <div
              className="flex flex-col items-start"
              style={{ gap: "12px", flexWrap: "nowrap" }}
            >
              {/* Left: heading + subtitle */}
              <div className="min-w-0">
                <h2 className="text-[42px] sm:text-[48px] leading-[1.04] font-serif font-semibold tracking-tight text-foreground">
                  {t("problem.heading")}
                  <br />
                  {t("problem.headingAccent")}
                </h2>
                <p className="mt-6 text-base leading-relaxed text-foreground-muted">
                  {t("problem.subtitle")}
                </p>
              </div>
              {/* Right: problem cards */}
              <div className="flex min-w-0 flex-col gap-4 w-full">
                <div className="mt-[36px] flex flex-col md:flex-row w-full gap-6">
                  {problemCardsLocalized.map((item) => (
                    <div
                      key={item.text}
                      className="flex flex-1 min-h-[320px] flex-col bg-card border border-border rounded-[24px] p-0 overflow-hidden"
                    >
                      <div className="relative mb-0 w-full aspect-[4/3] overflow-hidden rounded-none border-0">
                        <Image
                          src={item.image}
                          alt={item.text}
                          fill
                          sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 100vw"
                          className="object-cover"
                        />
                      </div>
                      <p className="mt-auto px-6 py-6 text-base font-medium font-serif text-foreground">
                        {item.text}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="px-2 text-center text-sm leading-relaxed text-muted-foreground">
                  {t("problem.footer")}
                </p>
              </div>
            </div>
          </div>
        </section>

        <HowItWorksSection platforms={data.platforms} />
        <ThenItActsSection />
        <CapabilitiesSection />

        {/* Work with Signals Section - hidden per latest requirement */}

        {/* Support Section */}
        {showSupportSection && (
          <section ref={supportRef} className={supportSectionWrapper}>
            <div className="w-full flex flex-col gap-6">
              <div className="px-0">
                <h2 className={`${sectionHeading} mb-0`}>
                  {t("support.title")}
                </h2>
              </div>
              <div className="flex flex-col gap-4">
                {getArr("support.items").map((item, idx) => (
                  <UseCaseCard
                    key={idx}
                    title={item.title}
                    description={item.description}
                    role={item.role}
                    image={data.support.items[idx]?.image}
                    link={data.support.items[idx]?.link}
                  />
                ))}
              </div>
            </div>
          </section>
        )}

        {/* What People Trust Alloomi With Section */}
        <TestimonialSection />

        {/* Sovereignty Section */}
        <section className="w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-20 pt-3 sm:pt-20 md:pt-32 pb-32 sm:pb-32 md:pb-32 mb-0">
          <div className="w-full">
            <div className="mb-12 px-0 flex flex-col gap-6 justify-start items-center">
              <SectionEyebrow variant="pill">
                {t("sovereignty.eyebrow")}
              </SectionEyebrow>
              <h2 className={sovereigntySectionHeading}>
                {t("sovereignty.title")}
              </h2>
              <p className="text-center text-foreground-muted text-lg">
                {t("sovereignty.subtitle")}
              </p>
              <Link
                href="https://app.alloomi.ai/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center bg-transparent border border-border-primary text-foreground px-8 py-4 rounded-lg font-medium transition-all transform relative z-20 hover:bg-background-secondary"
                aria-label={t("sovereignty.readPrivacyPolicy")}
              >
                {t("sovereignty.readPrivacyPolicy")}
              </Link>
            </div>
            <div className="w-full flex flex-col lg:flex-row lg:items-start gap-8 lg:gap-8">
              <div className="w-full flex-1 min-w-0">
                <div className="flex flex-col gap-0 ml-10 mr-10">
                  {getArr("sovereignty.items").map((item, idx) => (
                    <SovereigntyCard key={idx} item={item} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Landing CTA Section (moved out of Footer) */}
        <LandingFooterCtaSection />

        {/* Footer */}
        <div>
          <Footer variant="landing" />
        </div>
      </div>
    </div>
  );
};

export default MarketingPage;
