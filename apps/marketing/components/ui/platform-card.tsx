"use client";

import React from "react";
import Image from "next/image";

interface PlatformCardProps {
  /**
   * Platform name
   */
  name: string;
  /**
   * Platform logo path (SVG or PNG)
   */
  logoPath: string;
  /**
   * Whether integration is complete
   */
  completed?: boolean;
}

/**
 * Platform card component
 * Displays platform logo and name, supports "Soon" tag
 */
export const PlatformCard: React.FC<PlatformCardProps> = ({
  name,
  logoPath,
  completed = true,
}) => {
  return (
    <div
      className="relative inline-flex items-center gap-2.5 border border-border-primary rounded-full pl-3 pr-3 py-2 transition-all hover:bg-background-secondary hover:border-border-secondary flex-shrink-0 bg-background"
      style={{
        opacity: completed ? 1 : 0.6,
      }}
    >
      <div className="relative w-5 h-5 flex items-center justify-center">
        <Image
          src={logoPath}
          alt={`${name} logo`}
          className="w-5 h-5 object-contain"
          width={20}
          height={20}
        />
      </div>
      <span className="text-sm text-foreground text-left font-normal whitespace-nowrap">
        {name}
      </span>

      {/* Soon Tag - shown only when completed=false, placed on right */}
      {!completed && (
        <div className="text-[10px] leading-none font-normal px-1.5 py-1 rounded-full bg-[var(--color-background-flowlight)] text-[var(--color-flowlight)]">
          Soon
        </div>
      )}
    </div>
  );
};
