"use client";

import type React from "react";
import Image from "next/image";
import { PlatformCard } from "./platform-card";
import { RemixIcon } from "@/components/remix-icon";

interface Platform {
  /**
   * Platform name
   */
  name: string;
  /**
   * Platform logo path
   */
  logoPath: string;
  /**
   * Whether integration is complete
   */
  completed?: boolean;
}

interface PlatformsSectionProps {
  /**
   * Platform list
   */
  platforms: Platform[];
}

/**
 * Platform support section component
 * Displays supported platform list with horizontal scroll
 */
export const PlatformsSection: React.FC<PlatformsSectionProps> = ({
  platforms,
}) => {
  /**
   * Split platforms by index into two rows for independent scroll control
   */
  const firstRowPlatforms = platforms.filter((_, index) => index % 2 === 0);
  const secondRowPlatforms = platforms.filter((_, index) => index % 2 !== 0);

  /**
   * Duplicate row data for seamless loop scroll
   */
  const firstRowLoop = [...firstRowPlatforms, ...firstRowPlatforms];
  const secondRowLoop = [...secondRowPlatforms, ...secondRowPlatforms];

  return (
    <div className="w-full overflow-hidden">
      {/* Platform card list with right preview */}
      <div className="w-full flex flex-col lg:flex-row items-start">
        <div className="flex flex-col gap-1 flex-1 min-w-0 overflow-hidden p-6 pr-0">
          {/* Title: Supported Platforms */}
          <a
            href="https://alloomi.ai/docs/alloomi/connectors"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-base font-normal text-foreground mb-2 px-0 text-left hover:opacity-80 transition-opacity"
            aria-label="Open connectors documentation"
          >
            <span className="font-serif font-semibold">
              Supported Platforms
            </span>
            <RemixIcon
              name="arrow-right-s-line"
              variant="none"
              size="size-4"
              className="inline-flex"
              aria-hidden="true"
            />
          </a>

          <div className="platform-marquee-row mb-1">
            <div className="platform-track platform-track-top">
              {firstRowLoop.map((platform, index) => (
                <PlatformCard
                  key={`top-${platform.name}-${index}`}
                  name={platform.name}
                  logoPath={platform.logoPath}
                  completed={platform.completed}
                />
              ))}
            </div>
          </div>
          <div className="platform-marquee-row">
            <div className="platform-track platform-track-bottom">
              {secondRowLoop.map((platform, index) => (
                <PlatformCard
                  key={`bottom-${platform.name}-${index}`}
                  name={platform.name}
                  logoPath={platform.logoPath}
                  completed={platform.completed}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="w-full lg:w-fit lg:min-w-[360px] shrink-0">
          <Image
            src="/img/pic/IM.png"
            alt="Alloomi integrated messaging preview"
            width={1024}
            height={640}
            className="w-full lg:w-[360px] h-auto object-cover"
            priority={false}
          />
        </div>
      </div>

      <style jsx>{`
        .platform-marquee-row {
          width: 100%;
          overflow: hidden;
        }

        .platform-track {
          display: flex;
          gap: 0.25rem;
          width: max-content;
          will-change: transform;
        }

        .platform-track-top {
          animation: platform-scroll-left 36s linear infinite;
        }

        .platform-track-bottom {
          animation: platform-scroll-right 44s linear infinite;
        }

        .platform-marquee-row:hover .platform-track {
          animation-play-state: paused;
        }

        @keyframes platform-scroll-left {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(-50%);
          }
        }

        @keyframes platform-scroll-right {
          from {
            transform: translateX(-50%);
          }
          to {
            transform: translateX(0);
          }
        }
      `}</style>
    </div>
  );
};
