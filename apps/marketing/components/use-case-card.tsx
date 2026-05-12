"use client";

import React from "react";
import Image from "next/image";

/**
 * Use case card component props interface
 */
interface UseCaseCardProps {
  /**
   * Card title
   */
  title: string;
  /**
   * Card description
   */
  description: string;
  /**
   * Role field (optional)
   */
  role?: string;
  /**
   * Card image path
   */
  image: string;
  /**
   * Card link (optional)
   */
  link?: string;
}

/**
 * Use case card component
 * Displays title, description, role, and image to showcase Alloomi use cases
 */
export const UseCaseCard = ({
  title,
  description,
  role,
  image,
  link,
}: UseCaseCardProps) => {
  const cardContent = (
    <div
      className="bg-background-card px-8 pb-8 pt-8 flex flex-col md:flex-row gap-6 items-stretch justify-start text-left border border-border-primary transition-all h-full"
      style={{ borderRadius: "var(--radius-card-large)" }}
    >
      <div className="flex-1 w-full mb-0 flex flex-col self-stretch">
        <h3 className="text-2xl font-serif font-semibold mb-2 text-foreground-secondary">
          {title}
        </h3>
        <p className="text-foreground-muted text-left">{description}</p>
        {role && (
          <p className="text-base text-flowlight mt-auto mb-0 font-normal text-left">
            {role}
          </p>
        )}
      </div>
      <div className="mt-0 w-full md:w-[320px]">
        <Image
          src={image}
          alt={title}
          width={800}
          height={600}
          className="w-full md:w-[320px] h-auto rounded-2xl object-cover"
        />
      </div>
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
