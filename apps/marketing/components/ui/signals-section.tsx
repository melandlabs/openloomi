"use client";

import React from "react";
import { SignalHeroCard } from "./signal-hero-card";

/**
 * Signal card data interface
 */
interface SignalCard {
  /**
   * Card icon path
   */
  icon: string;
  /**
   * Card title
   */
  title: string;
  /**
   * Card description
   */
  description: string;
}

/**
 * Hero card data interface
 */
interface HeroCard {
  /**
   * Card icon path (optional)
   */
  icon?: string;
  /**
   * Card title
   */
  title: string;
  /**
   * Card description
   */
  description: string;
}

/**
 * Signal module component props interface
 */
interface SignalsSectionProps {
  /**
   * Module title
   */
  title: string;
  /**
   * Module subtitle
   */
  subtitle: string;
  /**
   * Top hero card (optional)
   */
  heroCard?: HeroCard;
  /**
   * Signal card list
   */
  cards: SignalCard[];
}

/**
 * Signal module component
 * Displays "Work with Signals, Not Messages" section with title, subtitle, hero card, and signal cards
 */
export const SignalsSection: React.FC<SignalsSectionProps> = ({
  title,
  subtitle,
  heroCard,
  cards,
}) => {
  /**
   * Section wrapper style class
   */
  const sectionWrapper =
    "w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 pt-3 sm:pt-20 md:pt-0 pb-3 sm:pb-16 md:pb-16 mb-0";

  return (
    <section className={sectionWrapper}>
      <div className="w-full">
        {/* Hero card with title, description, animated chart, and signal cards */}
        {heroCard && (
          <SignalHeroCard
            sectionTitle={title}
            sectionSubtitle={subtitle}
            icon={heroCard.icon}
            title={heroCard.title}
            description={heroCard.description}
            cards={cards}
          />
        )}
      </div>
    </section>
  );
};
