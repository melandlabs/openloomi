"use client";

import React, { useState } from "react";
import Image from "next/image";
import { RemixIcon } from "@/components/remix-icon";
import { cn } from "@/lib/utils";
import { OrbitingCircles } from "./orbiting-circles";
import { HeroChaosOverlay } from "@/components/hero-chaos-overlay";

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
 * Signal hero card component props interface
 */
interface SignalHeroCardProps {
  /**
   * Section title
   */
  sectionTitle?: string;
  /**
   * Section subtitle
   */
  sectionSubtitle?: string;
  /**
   * Card icon path
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
  /**
   * Signal card list (optional)
   */
  cards?: SignalCard[];
}

/**
 * Optimized platform icon component
 * Uses CSS mask technique to change SVG icon color with error fallback
 */
const OptimizedPlatformIcon: React.FC<{
  src: string;
  fallbackSrc: string;
  alt: string;
}> = ({ src, fallbackSrc, alt }) => {
  const [imgSrc, setImgSrc] = React.useState(src);
  const [hasError, setHasError] = React.useState(false);

  /**
   * Handle image load error, fallback to backup image
   */
  React.useEffect(() => {
    // Use window.Image to avoid conflict with next/image Image component
    const img = new window.Image();
    img.onerror = () => {
      if (imgSrc !== fallbackSrc) {
        setImgSrc(fallbackSrc);
      } else {
        setHasError(true);
      }
    };
    img.src = imgSrc;
  }, [imgSrc, fallbackSrc]);

  if (hasError) {
    return null;
  }

  return (
    <div
      className="relative w-full h-full"
      style={{
        maskImage: `url(${imgSrc})`,
        maskSize: "contain",
        maskRepeat: "no-repeat",
        maskPosition: "center",
        backgroundColor: "var(--color-foreground-primary)",
        WebkitMaskImage: `url(${imgSrc})`,
        WebkitMaskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
      }}
      role="img"
      aria-label={alt}
    />
  );
};

/**
 * Platform icon component
 */
const Icons = {
  Gmail: () => (
    <OptimizedPlatformIcon
      src="/img/Platform/Gmail.png"
      fallbackSrc="/img/Platform/gmail.png"
      alt="Gmail"
    />
  ),
  Discord: () => (
    <OptimizedPlatformIcon
      src="/img/Platform/Discord.png"
      fallbackSrc="/img/Platform/discord.png"
      alt="Discord"
    />
  ),
  Telegram: () => (
    <OptimizedPlatformIcon
      src="/img/Platform/Telegram.png"
      fallbackSrc="/img/Platform/telegram.png"
      alt="Telegram"
    />
  ),
  X: () => (
    <OptimizedPlatformIcon
      src="/img/Platform/X.png"
      fallbackSrc="/img/Platform/x.png"
      alt="X"
    />
  ),
  Slack: () => (
    <OptimizedPlatformIcon
      src="/img/Platform/Slack.png"
      fallbackSrc="/img/Platform/slack.png"
      alt="Slack"
    />
  ),
  WhatsApp: () => (
    <svg
      width="100"
      height="100"
      viewBox="0 0 175.216 175.552"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-full"
    >
      <defs>
        <linearGradient
          id="b"
          x1="85.915"
          x2="86.535"
          y1="32.567"
          y2="137.092"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#57d163" />
          <stop offset="1" stopColor="#23b33a" />
        </linearGradient>
        <filter
          id="a"
          width="1.115"
          height="1.114"
          x="-.057"
          y="-.057"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation="3.531" />
        </filter>
      </defs>
      <path
        d="m54.532 138.45 2.235 1.324c9.387 5.571 20.15 8.518 31.126 8.523h.023c33.707 0 61.139-27.426 61.153-61.135.006-16.335-6.349-31.696-17.895-43.251A60.75 60.75 0 0 0 87.94 25.983c-33.733 0-61.166 27.423-61.178 61.13a60.98 60.98 0 0 0 9.349 32.535l1.455 2.312-6.179 22.558zm-40.811 23.544L24.16 123.88c-6.438-11.154-9.825-23.808-9.821-36.772.017-40.556 33.021-73.55 73.578-73.55 19.681.01 38.154 7.669 52.047 21.572s21.537 32.383 21.53 52.037c-.018 40.553-33.027 73.553-73.578 73.553h-.032c-12.313-.005-24.412-3.094-35.159-8.954zm0 0"
        fill="#b3b3b3"
        filter="url(#a)"
      />
      <path
        d="m12.966 161.238 10.439-38.114a73.42 73.42 0 0 1-9.821-36.772c.017-40.556 33.021-73.55 73.578-73.55 19.681.01 38.154 7.669 52.047 21.572s21.537 32.383 21.53 52.037c-.018 40.553-33.027 73.553-73.578 73.553h-.032c-12.313-.005-24.412-3.094-35.159-8.954z"
        fill="#ffffff"
      />
      <path
        d="M87.184 25.227c-33.733 0-61.166 27.423-61.178 61.13a60.98 60.98 0 0 0 9.349 32.535l1.455 2.312-6.179 22.559 23.146-6.069 2.235 1.324c9.387 5.571 20.15 8.518 31.126 8.524h.023c33.707 0 61.14-27.426 61.153-61.135a60.75 60.75 0 0 0-17.895-43.251 60.75 60.75 0 0 0-43.235-17.929z"
        fill="url(#b)"
      />
      <path
        d="M68.772 55.603c-1.378-3.061-2.828-3.123-4.137-3.176l-3.524-.043c-1.226 0-3.218.46-4.902 2.3s-6.435 6.287-6.435 15.332 6.588 17.785 7.506 19.013 12.718 20.381 31.405 27.75c15.529 6.124 18.689 4.906 22.061 4.6s10.877-4.447 12.408-8.74 1.532-7.971 1.073-8.74-1.685-1.226-3.525-2.146-10.877-5.367-12.562-5.981-2.91-.919-4.137.921-4.746 5.979-5.819 7.206-2.144 1.381-3.984.462-7.76-2.861-14.784-9.124c-5.465-4.873-9.154-10.891-10.228-12.73s-.114-2.835.808-3.751c.825-.824 1.838-2.147 2.759-3.22s1.224-1.84 1.836-3.065.307-2.301-.153-3.22-4.032-10.011-5.666-13.647"
        fill="#ffffff"
        fillRule="evenodd"
      />
    </svg>
  ),
  LinkedIn: () => (
    <OptimizedPlatformIcon
      src="/img/Platform/LinkedIn.png"
      fallbackSrc="/img/Platform/linkedin.png"
      alt="LinkedIn"
    />
  ),
  Notion: () => (
    <svg
      width="100"
      height="100"
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-full"
    >
      <path
        d="M6.017 4.313l55.333 -4.087c6.797 -0.583 8.543 -0.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277 -1.553 6.807 -6.99 7.193L24.467 99.967c-4.08 0.193 -6.023 -0.39 -8.16 -3.113L3.3 79.94c-2.333 -3.113 -3.3 -5.443 -3.3 -8.167V11.113c0 -3.497 1.553 -6.413 6.017 -6.8z"
        fill="#ffffff"
      />
      <path
        d="M61.35 0.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.723 0.967 5.053 3.3 8.167l13.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257 -3.89c5.433 -0.387 6.99 -2.917 6.99 -7.193V20.64c0 -2.21 -0.873 -2.847 -3.443 -4.733L74.167 3.143c-4.273 -3.107 -6.02 -3.5 -12.817 -2.917zM25.92 19.523c-5.247 0.353 -6.437 0.433 -9.417 -1.99L8.927 11.507c-0.77 -0.78 -0.383 -1.753 1.557 -1.947l53.193 -3.887c4.467 -0.39 6.793 1.167 8.54 2.527l9.123 6.61c0.39 0.197 1.36 1.36 0.193 1.36l-54.933 3.307 -0.68 0.047zM19.803 88.3V30.367c0 -2.53 0.777 -3.697 3.103 -3.893L86 22.78c2.14 -0.193 3.107 1.167 3.107 3.693v57.547c0 2.53 -0.39 4.67 -3.883 4.863l-60.377 3.5c-3.493 0.193 -5.043 -0.97 -5.043 -4.083zm59.6 -54.827c0.387 1.75 0 3.5 -1.75 3.7l-2.91 0.577v42.773c-2.527 1.36 -4.853 2.137 -6.797 2.137 -3.107 0 -3.883 -0.973 -6.21 -3.887l-19.03 -29.94v28.967l6.02 1.363s0 3.5 -4.857 3.5l-13.39 0.777c-0.39 -0.78 0 -2.723 1.357 -3.11l3.497 -0.97v-38.3L30.48 40.667c-0.39 -1.75 0.58 -4.277 3.3 -4.473l14.367 -0.967 19.8 30.327v-26.83l-5.047 -0.58c-0.39 -2.143 1.163 -3.7 3.103 -3.89l13.4 -0.78z"
        fill="#000000"
        fillRule="evenodd"
        clipRule="evenodd"
      />
    </svg>
  ),
  OpenAI: () => (
    <svg
      width="100"
      height="100"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-full fill-black dark:fill-white"
    >
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  ),
  GoogleDrive: () => (
    <svg
      width="100"
      height="100"
      viewBox="0 0 87.3 78"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-full"
    >
      <path
        d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z"
        fill="#0066da"
      />
      <path
        d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z"
        fill="#00ac47"
      />
      <path
        d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z"
        fill="#ea4335"
      />
      <path
        d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z"
        fill="#00832d"
      />
      <path
        d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z"
        fill="#2684fc"
      />
      <path
        d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z"
        fill="#ffba00"
      />
    </svg>
  ),
};

/**
 * Tag data interface
 */
interface TagData {
  /**
   * Tag text
   */
  text: string;
  /**
   * Tag icon (SVG component)
   */
  icon: React.ReactNode;
  /**
   * Tag background gradient (opaque, low saturation)
   */
  gradient: string;
  /**
   * Tag text color (corresponds to theme color)
   */
  textColor: string;
  /**
   * Tag number (1-10)
   */
  number: number;
}

/**
 * Tag component - shown on hover
 */
interface TagProps {
  /**
   * Tag data
   */
  tag: TagData;
  /**
   * Tag angle (for positioning)
   */
  angle: number;
  /**
   * Orbit radius
   */
  radius: number;
}

/**
 * Individual Tag component
 * Tag stays horizontal by counter-rotating with container
 * Ensure tag center is on outer orbit (180px radius)
 */
const Tag: React.FC<TagProps> = ({ tag, angle, radius }) => {
  const radian = (angle * Math.PI) / 180;
  // Calculate tag center position on orbit (relative to container center, in px)
  // Container size is radius * 2, container center at (radius, radius)
  const x = Math.cos(radian) * radius;
  const y = Math.sin(radian) * radius;
  // Container center coordinates (px)
  const centerX = radius;
  const centerY = radius;
  // Tag center absolute coordinates (relative to container)
  const tagX = centerX + x;
  const tagY = centerY + y;

  return (
    <div
      className="absolute fade-in-tag"
      style={{
        // Use pixel values to precisely position tag center on orbit point
        // Container center at (radius, radius), tag orbit position is (centerX + x, centerY + y)
        left: `${tagX}px`,
        top: `${tagY}px`,
        // Use translate(-50%, -50%) to align tag center to calculated position
        // So tag center lands exactly on the orbit
        transform: "translate(-50%, -50%)",
        transformOrigin: "center center",
      }}
    >
      {/* Counter-rotate container to keep tag horizontal */}
      <div
        className="orbit-tag-reverse"
        style={{
          transformOrigin: "center center",
          display: "inline-block",
        }}
      >
        <div
          className="px-4 py-2 border border-border-primary rounded-full shadow-md whitespace-nowrap flex items-center gap-2"
          style={{
            background: tag.gradient,
          }}
        >
          {/* Icon */}
          <div
            className="flex-shrink-0 w-4 h-4 flex items-center justify-center"
            style={{ color: tag.textColor }}
          >
            {tag.icon}
          </div>
          {/* Text */}
          <span
            className="text-sm font-medium"
            style={{ color: tag.textColor }}
          >
            {tag.text} {tag.number}
          </span>
        </div>
      </div>
    </div>
  );
};

/**
 * Animated chart component
 * Visualizes signal processing: from noisy platform signals to clear results
 * Uses OrbitingCircles to orbit platform icons around center Logo
 */
const SignalFlowDiagram: React.FC = () => {
  const [isHovered, setIsHovered] = useState(false);

  // Five tag data with text, icon, gradient background, text color, and number
  const tags: TagData[] = [
    {
      text: "Decision",
      icon: <RemixIcon name="magic" size="size-4" />,
      gradient: "linear-gradient(135deg, #f0f4f8 0%, #e2e8f0 100%)", // Blue very low saturation gradient (near gray)
      textColor: "#1e40af", // Blue text
      number: 3,
    },
    {
      text: "Action",
      icon: <RemixIcon name="magic" size="size-4" />,
      gradient: "linear-gradient(135deg, #f0f9f4 0%, #dcfce7 100%)", // Green very low saturation gradient
      textColor: "#166534", // Green text
      number: 7,
    },
    {
      text: "Follow-up",
      icon: <RemixIcon name="magic" size="size-4" />,
      gradient: "linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)", // Purple very low saturation gradient
      textColor: "#6b21a8", // Purple text
      number: 2,
    },
    {
      text: "Risk",
      icon: <RemixIcon name="magic" size="size-4" />,
      gradient: "linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)", // Orange very low saturation gradient
      textColor: "#9a3412", // Orange text
      number: 9,
    },
    {
      text: "Opportunity",
      icon: <RemixIcon name="magic" size="size-4" />,
      gradient: "linear-gradient(135deg, #fefce8 0%, #fef9c3 100%)", // Yellow very low saturation gradient
      textColor: "#854d0e", // Yellow text
      number: 5,
    },
  ];
  // Tag orbit radius matches outer platform icon orbit (180px)
  const tagRadius = 180;

  return (
    <div className="relative flex h-[500px] w-full flex-col items-center justify-center overflow-hidden">
      {/* Outer orbit - 8 platform icons */}
      <OrbitingCircles
        iconSize={40}
        radius={180}
        speed={25}
        showOrbit={true}
        hideOnHover={isHovered}
      >
        <Icons.Gmail />
        <Icons.Discord />
        <Icons.Telegram />
        <Icons.X />
        <Icons.Slack />
        <Icons.WhatsApp />
        <Icons.LinkedIn />
        <Icons.Notion />
      </OrbitingCircles>

      {/* Inner orbit - 4 platform icons, reverse rotation */}
      <OrbitingCircles
        iconSize={30}
        radius={100}
        reverse
        speed={15}
        showOrbit={true}
        hideOnHover={isHovered}
      >
        <Icons.WhatsApp />
        <Icons.Notion />
        <Icons.OpenAI />
        <Icons.GoogleDrive />
      </OrbitingCircles>

      {/* Center Alloomi Logo */}
      <div
        className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 cursor-pointer"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div
          className={cn(
            "flex size-24 items-center justify-center rounded-full border-2 border-border-primary bg-flowlight-animated p-4 shadow-[0_0_30px_-8px_rgba(0,0,0,0.3)] transition-all duration-300",
            isHovered && "logo-glow",
          )}
        >
          <Image
            src="/img/Logo.png"
            alt="Alloomi"
            width={64}
            height={64}
            className="object-contain opacity-80"
          />
        </div>
      </div>

      {/* Five tags - orbit around Logo, shown on hover only */}
      {isHovered && (
        <div
          className="absolute left-1/2 top-1/2 orbit-tag-container"
          style={{
            // Container size must be large enough to fit tags on orbit
            width: `${tagRadius * 2}px`,
            height: `${tagRadius * 2}px`,
            transformOrigin: "center center",
            // Ensure container is block-level for correct child positioning
            display: "block",
          }}
        >
          {tags.map((tag, index) => {
            // Five tags evenly distributed on circle
            const angle = (index * 360) / tags.length;
            return (
              <Tag key={index} tag={tag} angle={angle} radius={tagRadius} />
            );
          })}
        </div>
      )}
    </div>
  );
};

/**
 * Signal hero card component
 * Main card displayed at top of "Work with Signals, Not Messages" section
 * Contains animated chart visualizing signal processing
 * Responsive design for different screen widths
 */
export const SignalHeroCard: React.FC<SignalHeroCardProps> = ({
  sectionTitle,
  sectionSubtitle,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  icon: _icon,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  title: _title,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  description: _description,
  cards = [],
}) => {
  return (
    <div
      className="relative w-full bg-background-card p-6 border border-border-primary transition-colors overflow-hidden"
      style={{ borderRadius: "var(--radius-card-large)" }}
    >
      {/* Grid background - covers entire card */}
      <div
        className={cn(
          "absolute right-0 bottom-0 w-full h-full z-0",
          "[background-size:40px_40px]",
          "[background-image:linear-gradient(to_right,#e4e4e7_1px,transparent_1px),linear-gradient(to_bottom,#e4e4e7_1px,transparent_1px)]",
          "dark:[background-image:linear-gradient(to_right,#262626_1px,transparent_1px),linear-gradient(to_bottom,#262626_1px,transparent_1px)]",
        )}
      />
      {/* Radial gradient mask - fades from center outward */}
      <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center bg-background-card [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black)]"></div>
      {/* Move floating effect to signal card background layer */}
      <HeroChaosOverlay isHidden={false} />

      <div className="relative z-10 flex flex-col gap-6">
        {/* Section title and description */}
        {(sectionTitle || sectionSubtitle) && (
          <div className="w-full px-2">
            {sectionTitle && (
              <h2 className="text-2xl sm:text-3xl md:text-5xl w-full font-serif font-medium text-left mb-4 mt-4">
                {sectionTitle}
              </h2>
            )}
            {sectionSubtitle && (
              <p className="text-left text-foreground-muted text-lg mt-4">
                {sectionSubtitle}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-2 items-center">
          {/* Left: animated chart */}
          <div className="w-full md:w-1/2 flex-shrink-0 flex items-center justify-center">
            <SignalFlowDiagram />
          </div>

          {/* Right: three signal cards, vertical layout */}
          {cards.length > 0 && (
            <div className="w-full md:w-1/2 flex flex-col gap-6 justify-center">
              {cards.map((card, idx) => (
                <div
                  key={idx}
                  className="bg-background-card rounded-card p-4 border border-border-primary transition-colors"
                >
                  <div className="flex gap-4 items-start">
                    {/* Icon container - circular border, left side */}
                    <div
                      className="w-16 h-16 rounded-full border flex items-center justify-center flex-shrink-0"
                      style={{
                        borderColor: "var(--color-border-primary)",
                        borderImage: "none",
                        backgroundColor: "var(--color-background-flowlight)",
                      }}
                    >
                      {/* Icon - using flowlight color */}
                      <div
                        className="w-6 h-6"
                        style={{
                          maskImage: `url(${card.icon})`,
                          maskSize: "contain",
                          maskRepeat: "no-repeat",
                          maskPosition: "center",
                          backgroundColor: "var(--color-flowlight)",
                          WebkitMaskImage: `url(${card.icon})`,
                          WebkitMaskSize: "contain",
                          WebkitMaskRepeat: "no-repeat",
                          WebkitMaskPosition: "center",
                        }}
                      />
                    </div>
                    {/* Title and description, right side */}
                    <div className="flex-1">
                      <h3 className="text-xl font-medium mb-2 text-foreground">
                        {card.title}
                      </h3>
                      <p className="text-foreground-muted text-base leading-6">
                        {card.description}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
