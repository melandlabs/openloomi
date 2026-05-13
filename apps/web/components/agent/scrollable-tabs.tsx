"use client";

import { useRef, useEffect, useState, type ReactNode } from "react";
import { Button } from "@openloomi/ui";
import { cn } from "@/lib/utils";

interface ScrollableTabsProps {
  /**
   * Tab button content
   */
  children: ReactNode;
  /**
   * Custom className
   */
  className?: string;
}

interface TabButtonProps {
  /**
   * Whether active
   */
  active?: boolean;
  /**
   * Click callback
   */
  onClick?: () => void;
  /**
   * Button content
   */
  children: ReactNode;
  /**
   * Custom className
   */
  className?: string;
  /**
   * Whether to suppress hydration warning
   */
  suppressHydrationWarning?: boolean;
}

interface TabBadgeProps {
  /**
   * Whether in active tab
   */
  active?: boolean;
  /**
   * Badge content
   */
  children: ReactNode;
  /**
   * Custom className
   */
  className?: string;
}

/**
 * Scrollable Tabs container component
 * When there are too many tabs, supports horizontal scrolling without squeezing the right button area
 * - Uses overflow-x-auto for horizontal scrolling
 * - Supports mouse wheel horizontal scrolling (via wheel event listener)
 * - Shows custom-styled scrollbar, supports drag
 * - Uses flex-1 min-w-0 to ensure shrinkable, won't squeeze right-side buttons
 */
export function ScrollableTabs({ children, className }: ScrollableTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  /**
   * Handle mouse wheel event, supports horizontal scrolling
   */
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const handleWheel = (e: WheelEvent) => {
      // Check for horizontal scroll (deltaX is not 0)
      // Or vertical scroll with Shift key (converted to horizontal scroll)
      const hasHorizontalScroll =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey;

      if (hasHorizontalScroll) {
        // Prevent default vertical scroll behavior
        e.preventDefault();

        // Calculate scroll distance
        const scrollAmount = e.shiftKey ? e.deltaY : e.deltaX;

        // Perform horizontal scroll
        element.scrollBy({
          left: scrollAmount,
          behavior: "auto", // Use auto instead of smooth for a more natural scroll experience
        });
      }
    };

    element.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      element.removeEventListener("wheel", handleWheel);
    };
  }, []);

  return (
    <div
      ref={scrollRef}
      role="region"
      aria-label="Scrollable tabs"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        "flex items-center gap-1",
        "min-w-0 flex-1",
        // Support horizontal scroll (including mouse wheel and drag)
        "overflow-x-auto",
        // Ensure scrollable
        "scroll-smooth",
        // Hide scrollbar by default, show on hover (WebKit browsers)
        "[&::-webkit-scrollbar]:h-0",
        "[&::-webkit-scrollbar-track]:bg-transparent",
        "[&::-webkit-scrollbar-thumb]:bg-transparent",
        "[&::-webkit-scrollbar-thumb]:rounded-full",
        "[&::-webkit-scrollbar-thumb]:transition-all",
        isHovered && "[&::-webkit-scrollbar]:h-1.5",
        isHovered && "[&::-webkit-scrollbar-thumb]:bg-border",
        isHovered &&
          "[&::-webkit-scrollbar-thumb]:hover:bg-muted-foreground/40",
        // Firefox scrollbar style: hidden by default, show on hover
        !isHovered && "[scrollbar-width:none]",
        isHovered && "[scrollbar-width:thin]",
        isHovered && "[scrollbar-color:theme(colors.border)_transparent]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Tab button component
 * Unifies tab button styling to ensure consistency across all usage scenarios
 * - Height: h-9
 * - Padding: px-4
 * - Font: text-sm font-medium
 * - Prevent shrink: shrink-0
 * - Selected state: uses theme color (primary) background, text uses primary-foreground
 */
export function TabButton({
  active = false,
  onClick,
  children,
  className,
  suppressHydrationWarning,
}: TabButtonProps) {
  return (
    <Button
      variant="ghost"
      size="default"
      className={cn(
        "h-9 px-3 text-sm font-medium shrink-0",
        // Selected state: theme color background and text
        active
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
        className,
      )}
      onClick={onClick}
      suppressHydrationWarning={suppressHydrationWarning}
    >
      {children}
    </Button>
  );
}

/**
 * Tab badge component
 * Unifies tab badge styling, automatically adjusts color based on whether in active tab
 * - Selected state: white text, semi-transparent white background
 * - Unselected state: theme color text, theme color semi-transparent background
 */
export function TabBadge({
  active = false,
  children,
  className,
}: TabBadgeProps) {
  return (
    <span
      className={cn(
        "ml-1 rounded-full px-1.5 py-0.5 text-xs font-medium",
        active
          ? "bg-primary-foreground/20 text-primary-foreground"
          : "bg-primary/10 text-primary",
        className,
      )}
    >
      {children}
    </span>
  );
}
