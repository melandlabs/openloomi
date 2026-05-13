"use client";

import { Button } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";

export interface MobileHeaderProps {
  /**
   * Page title
   */
  title: string;
  /**
   * Menu button click callback (optional, defaults to dispatching open sidebar event)
   */
  onMenuClick?: () => void;
}

/**
 * Mobile page top header component
 * Contains menu button and page title
 */
export function MobileHeader({ title, onMenuClick }: MobileHeaderProps) {
  /**
   * Handle menu button click
   */
  const handleMenuClick = () => {
    if (onMenuClick) {
      onMenuClick();
    } else {
      // Default behavior: dispatch open sidebar event
      const event = new CustomEvent("openloomi:open-sidebar");
      window.dispatchEvent(event);
    }
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 bg-card px-4 safe-area-inset-top z-40">
      {/* Menu button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={handleMenuClick}
        className="h-9 w-9 shrink-0"
        aria-label="Open menu"
      >
        <RemixIcon name="menu" size="size-5" />
      </Button>

      {/* Page title */}
      <h1 className="flex-1 truncate text-base font-semibold">{title}</h1>
    </header>
  );
}
