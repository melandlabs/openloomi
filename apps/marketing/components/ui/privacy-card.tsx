"use client";

import React from "react";
import Image from "next/image";

/**
 * Privacy card component props interface
 */
interface PrivacyCardProps {
  /**
   * Card title
   */
  title: string;
  /**
   * Card description (optional)
   */
  description?: string;
  /**
   * Card image path (optional)
   */
  image?: string;
  /**
   * Card link (optional)
   */
  link?: string;
}

/**
 * Privacy card component
 * Displays privacy and security info, supports optional image
 */
export const PrivacyCard = ({
  title,
  description,
  image,
  link,
}: PrivacyCardProps) => {
  const cardContent = (
    <div
      className="bg-background-card px-6 pb-6 pt-6 flex flex-col items-start justify-start text-left border border-border-primary transition-all h-full"
      style={{ borderRadius: "var(--radius-card-large)" }}
    >
      <div className="flex-1">
        <h3 className="text-2xl font-medium mb-2 text-foreground-secondary">
          {title}
        </h3>
        {description && (
          <p className="text-foreground-muted text-left">{description}</p>
        )}
      </div>
      {image && (
        <div className="mt-6 w-full">
          <Image
            src={image}
            alt={title}
            width={800}
            height={600}
            className="w-full h-auto rounded-lg object-cover"
          />
        </div>
      )}
    </div>
  );

  if (link) {
    return (
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
      >
        {cardContent}
      </a>
    );
  }

  return cardContent;
};
