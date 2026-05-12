"use client";

import React, { useMemo, useRef, memo } from "react";
import { RemixIcon } from "@/components/remix-icon";

/**
 * Hero chaos visual overlay component
 * Displays complex, fragmented, uncontrolled visual elements
 * Disappears when hovering on focus button
 */
interface HeroChaosOverlayProps {
  /**
   * Whether to hide overlay
   */
  isHidden: boolean;
}

/**
 * Hero chaos overlay component (performance-optimized)
 * Optimization points:
 * 1. Use React.memo to prevent unnecessary re-renders
 * 2. All random calculations done in useMemo to avoid re-computation
 * 3. Use transform3d to force GPU acceleration
 * 4. Add CSS containment for rendering performance
 * 5. Reduce inline style object creation
 */
export const HeroChaosOverlay: React.FC<HeroChaosOverlayProps> = memo(
  ({ isHidden }) => {
    const containerRef = useRef<HTMLDivElement>(null);

    /**
     * Use useRef to store RNG, avoid calling impure functions in render
     * Initialize with fixed seed for consistent random sequence per mount (acceptable for visual effects)
     */
    const randomGeneratorRef = useRef<() => number | null>(null);
    if (randomGeneratorRef.current === null) {
      // Use Linear Congruential Generator (LCG) as pseudo-random number generator
      // Use fixed seed to avoid impure functions in render
      // Note: this causes the same random sequence per mount, but acceptable for visual effects
      let seed = 12345; // Fixed seed
      randomGeneratorRef.current = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
    }
    const random = randomGeneratorRef.current;

    /**
     * Generate random position data and content
     * Use useMemo to generate data once on mount, avoid frequent recalculation
     * Includes all animation parameters, avoid calculating in render
     */
    const chaosData = useMemo(() => {
      const generatePosition = () => ({
        top: `${random() * 100}%`,
        left: `${random() * 100}%`,
        rotation: random() * 360,
        delay: random() * 2,
        // Random appear/disappear animation parameters
        appearDelay: random() * 3, // Appears after 0-3s
        duration: 2 + random() * 4, // 2-6s display duration
        cycleDelay: random() * 2, // Cycle delay
      });

      const timezones = [
        "UTC-8",
        "UTC+0",
        "UTC+1",
        "UTC+8",
        "UTC+9",
        "JST",
        "EST",
        "PST",
        "CST",
        "GMT",
        "PDT",
        "EDT",
      ];

      const textFragments = [
        "New message",
        "Unread",
        "Notification",
        "urgent",
        "Important",
        "reply",
        "Reply",
        "@mention",
        "Pending",
        "pending",
        "To-do",
        "action",
        "Message",
        "message",
        "Unread message",
        "unread",
        "Urgent",
        "critical",
        "Needs reply",
        "needs reply",
        "To be processed",
        "inbox",
        "Inbox",
      ];

      // Platform list - expanded to 10
      const platforms = [
        { icon: "telegram-2", name: "Telegram" },
        { icon: "slack", name: "Slack" },
        { icon: "mail", name: "Email" },
        { icon: "discord", name: "Discord" },
        { icon: "whatsapp", name: "WhatsApp" },
        { icon: "github", name: "GitHub" },
        { icon: "twitter-x", name: "Twitter" },
        { icon: "linkedin-box", name: "LinkedIn" },
        { icon: "chat-3", name: "Chat" },
        { icon: "notification-3", name: "Notifications" },
      ];

      const generateTimestamp = () => {
        const hours = String(Math.floor(random() * 24)).padStart(2, "0");
        const minutes = String(Math.floor(random() * 60)).padStart(2, "0");
        const tz = timezones[Math.floor(random() * timezones.length)];
        return `${hours}:${minutes} ${tz}`;
      };

      /**
       * Generate random colors (gray/dark red)
       */
      const getRandomColor = () => {
        const colors = [
          "text-foreground-muted",
          "text-error-dark",
          "text-foreground-muted/60",
          "text-error-dark/70",
        ];
        return colors[Math.floor(random() * colors.length)];
      };

      // Pre-calculate all animation parameters to avoid calculation in render
      const generateTextData = () => {
        const pos = generatePosition();
        const floatDuration = 6 + random() * 6; // 6-12s
        const moveDistance = 50 + random() * 100;
        return {
          ...pos,
          content: textFragments[Math.floor(random() * textFragments.length)],
          color: getRandomColor(),
          floatDuration,
          moveDistance,
        };
      };

      const generateTimestampData = () => {
        const pos = generatePosition();
        const floatDuration = 8 + random() * 6; // 8-14s
        const moveDistance = 50 + random() * 100;
        return {
          ...pos,
          content: generateTimestamp(),
          color: getRandomColor(),
          floatDuration,
          moveDistance,
        };
      };

      return {
        platforms: platforms.map((platform) => ({
          ...generatePosition(),
          icon: platform.icon,
          name: platform.name,
          color: getRandomColor(),
        })),
        texts: Array.from({ length: 30 }, generateTextData),
        timestamps: Array.from({ length: 20 }, generateTimestampData),
        badges: Array.from({ length: 12 }, generatePosition),
        counts: Array.from({ length: 8 }, () => ({
          ...generatePosition(),
          count: Math.floor(random() * 99) + 1,
        })),
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
      <div
        ref={containerRef}
        className={`absolute top-24 bottom-16 left-0 right-0 pointer-events-none overflow-hidden transition-opacity duration-[2000ms] ease-out ${
          isHidden ? "opacity-0" : "opacity-100"
        }`}
        style={{
          contain: "layout style paint",
          transform: "translateZ(0)", // Force GPU acceleration
        }}
      >
        {/* Platform logos - random position/rotation, random appear/disappear */}
        {chaosData.platforms.map((item, idx) => {
          // Pre-calculate style objects to avoid creating new objects per render
          const animationDelay = `${item.appearDelay + item.cycleDelay}s`;
          return (
            <div
              key={`logo-${idx}`}
              className="absolute will-change-transform"
              style={{
                top: item.top,
                left: item.left,
                transform: `translate3d(0, 0, 0) rotate(${item.rotation}deg)`, // Use translate3d to force GPU acceleration
                animationName: "chaosFadeInOut",
                animationDuration: `${item.duration}s`,
                animationTimingFunction: "ease-in-out",
                animationIterationCount: "infinite",
                animationDelay,
              }}
            >
              <RemixIcon
                name={item.icon}
                variant="line"
                size=""
                className={`${item.color} text-xl sm:text-2xl md:text-3xl blur-[2px] opacity-30`}
              />
            </div>
          );
        })}

        {/* Multilingual text fragments - blurred, random appear/disappear, horizontal scroll animation */}
        {chaosData.texts.map((item, idx) => {
          // Use pre-calculated values to avoid recalculation per render
          const animationDelay = `${item.appearDelay + item.cycleDelay}s, ${item.delay}s`;
          const animationDuration = `${item.duration}s, ${item.floatDuration}s`;
          return (
            <div
              key={`text-${idx}`}
              className={`absolute ${item.color} text-xs sm:text-sm font-mono blur-[3px] will-change-transform opacity-30 whitespace-nowrap`}
              style={
                {
                  top: item.top,
                  left: item.left,
                  transform: "translate3d(0, 0, 0)", // Force GPU acceleration
                  animationName: "chaosFadeInOut, chaosFloatHorizontal",
                  animationDuration,
                  animationTimingFunction: "ease-in-out, ease-in-out",
                  animationIterationCount: "infinite, infinite",
                  animationDelay,
                  "--move-distance": `${item.moveDistance}px`,
                } as React.CSSProperties & { "--move-distance": string }
              }
            >
              {item.content}
            </div>
          );
        })}

        {/* Timezone timestamps - horizontal scroll, random appear/disappear */}
        {chaosData.timestamps.map((item, idx) => {
          // Use pre-calculated values to avoid recalculation per render
          const animationDelay = `${item.appearDelay + item.cycleDelay}s, ${item.delay}s`;
          const animationDuration = `${item.duration}s, ${item.floatDuration}s`;
          return (
            <div
              key={`timestamp-${idx}`}
              className={`absolute ${item.color} text-[10px] sm:text-xs font-mono blur-[2px] will-change-transform opacity-25 whitespace-nowrap`}
              style={
                {
                  top: item.top,
                  left: item.left,
                  transform: "translate3d(0, 0, 0)", // Force GPU acceleration
                  animationName: "chaosFadeInOut, chaosFloatHorizontal",
                  animationDuration,
                  animationTimingFunction: "ease-in-out, ease-in-out",
                  animationIterationCount: "infinite, infinite",
                  animationDelay,
                  "--move-distance": `${item.moveDistance}px`,
                } as React.CSSProperties & { "--move-distance": string }
              }
            >
              {item.content}
            </div>
          );
        })}

        {/* Red notification badges - random appear/disappear */}
        {chaosData.badges.map((pos, idx) => {
          // Pre-calculate animation delays to avoid creating new strings per render
          const animationDelay = `${pos.appearDelay + pos.cycleDelay}s, ${pos.delay}s`;
          return (
            <div
              key={`badge-${idx}`}
              className="absolute will-change-transform"
              style={{
                top: pos.top,
                left: pos.left,
                transform: "translate3d(0, 0, 0)", // Force GPU acceleration
                animationName: "chaosFadeInOut, chaosPing",
                animationDuration: `${pos.duration}s, 2s`,
                animationTimingFunction: "ease-in-out, ease-in-out",
                animationIterationCount: "infinite, infinite",
                animationDelay,
              }}
            >
              <div className="w-2 h-2 bg-error-dark rounded-full blur-[1px] opacity-30" />
            </div>
          );
        })}

        {/* Unread count badges - random appear/disappear */}
        {chaosData.counts.map((item, idx) => {
          // Pre-calculate animation delays and display text to avoid recalculation per render
          const animationDelay = `${item.appearDelay + item.cycleDelay}s`;
          const displayCount = item.count > 99 ? "99+" : item.count;
          return (
            <div
              key={`count-${idx}`}
              className="absolute will-change-transform"
              style={{
                top: item.top,
                left: item.left,
                transform: "translate3d(0, 0, 0)", // Force GPU acceleration
                animationName: "chaosFadeInOut",
                animationDuration: `${item.duration}s`,
                animationTimingFunction: "ease-in-out",
                animationIterationCount: "infinite",
                animationDelay,
              }}
            >
              <div className="bg-error-dark text-foreground-primary text-[8px] sm:text-[10px] px-1 rounded-full blur-[1px] opacity-30">
                {displayCount}
              </div>
            </div>
          );
        })}

        {/* Noise effect layer */}
        <div
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
            backgroundSize: "200px 200px",
            transform: "translateZ(0)", // Force GPU acceleration
          }}
        />
      </div>
    );
  },
);

// Set displayName for React DevTools identification
HeroChaosOverlay.displayName = "HeroChaosOverlay";
