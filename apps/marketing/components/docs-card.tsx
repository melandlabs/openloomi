"use client";

import Link from "next/link";
import type { JSX } from "react";
import { RemixIcon } from "@/components/remix-icon";
import "./docs-card.css";

// Doc card data type definition
interface DocItem {
  id: string;
  title: string;
  description: string;
}

// Doc card component
interface DocsCardProps {
  items: DocItem[];
  basePath: string;
}

export const DocsCard = ({ items, basePath }: DocsCardProps): JSX.Element => {
  return (
    <div className="docs-card-grid">
      {items.map((item) => (
        <Link
          key={item.id}
          href={`${basePath}/${item.id}`}
          className="docs-card-link"
        >
          <div className="docs-card">
            {/* Card decorative element */}
            <div className="docs-card-decoration" />

            {/* Card content */}
            <div className="docs-card-content">
              <h3 className="docs-card-title">{item.title}</h3>
              <p className="docs-card-description">{item.description}</p>

              {/* Arrow icon - shown on hover */}
              <div className="docs-card-learn-more">
                <span>Learn more</span>
                <RemixIcon
                  name="arrow-right-line"
                  variant="none"
                  size="size-5"
                  className="docs-card-arrow"
                />
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
};

// Default export pre-configured Alloomi doc card component
export const AlloomiDocsCards = (): JSX.Element => {
  const docsItems: DocItem[] = [
    {
      id: "",
      title: "What is Alloomi?",
      description: "Proactive AI workspace that understands your intent",
    },
    {
      id: "getting-started",
      title: "Getting Started",
      description: "Sign up, connect platforms, and get started",
    },
    {
      id: "connectors",
      title: "Connectors",
      description: "Connect messaging platforms, email, and productivity tools",
    },
    {
      id: "understanding",
      title: "Understanding",
      description: "Smart insights from your communications",
    },
    {
      id: "chat",
      title: "Chat",
      description: "Ask in plain language, get answers from your data",
    },
    {
      id: "messaging-apps",
      title: "Messaging Apps",
      description: "Use Alloomi directly inside Telegram, WhatsApp, and more",
    },
    {
      id: "automation",
      title: "Automation",
      description: "Automate tasks at specified times",
    },
    {
      id: "skills",
      title: "Skills",
      description: "200+ skills that extend your capabilities",
    },
    {
      id: "library",
      title: "Library",
      description: "Upload documents and ask AI questions",
    },
    {
      id: "settings",
      title: "Settings",
      description: "Configure your Alloomi experience",
    },
    {
      id: "upgrade-plan",
      title: "Upgrade Plan",
      description: "Choose the plan that fits your needs",
    },
    {
      id: "privacy-security",
      title: "Privacy & Security",
      description: "How we protect your data and privacy",
    },
    {
      id: "use-cases",
      title: "Use Cases",
      description: "Discover what you can do with Alloomi",
    },
  ];

  return <DocsCard items={docsItems} basePath="/docs/alloomi" />;
};
