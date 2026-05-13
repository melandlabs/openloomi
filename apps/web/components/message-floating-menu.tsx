"use client";

import { useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@openloomi/ui";
import type { ChatMessage } from "@openloomi/shared";
import { MessageForwardPanel } from "./message-forward-panel";

export interface MessageFloatingMenuProps {
  message: ChatMessage;
  className?: string;
}

/**
 * Floating message menu button.
 * Similar to the edit button style, shown on hover, displays the forward panel on click.
 * The forward panel is fixed-positioned, with width aligned to the chatPanel content area (max-w-3xl).
 */
export function MessageFloatingMenu({
  message,
  className,
}: MessageFloatingMenuProps) {
  const { t } = useTranslation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleToggleMenu = useCallback(() => {
    setIsMenuOpen((prev) => !prev);
  }, []);

  const handleCloseMenu = useCallback(() => {
    setIsMenuOpen(false);
  }, []);

  // Prevent clicks inside the panel from bubbling up to the overlay
  const handlePanelClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  // Close on ESC key
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        handleCloseMenu();
      }
    },
    [handleCloseMenu],
  );

  return (
    <div className={`relative ${className || ""}`}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            className="px-2 h-fit rounded-full text-muted-foreground opacity-0 group-hover/message:opacity-100"
            onClick={handleToggleMenu}
          >
            <RemixIcon name="send_plane" size="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("common.forward", "Forward")}</TooltipContent>
      </Tooltip>

      {isMenuOpen && (
        <div
          role="button"
          tabIndex={0}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={handleCloseMenu}
          onKeyDown={handleKeyDown}
        >
          {/* Forward panel */}
          <div
            role="dialog"
            aria-modal="true"
            ref={panelRef}
            className="relative w-full max-w-3xl bg-white rounded-lg shadow-lg p-4"
            onClick={handlePanelClick}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <MessageForwardPanel message={message} onClose={handleCloseMenu} />
          </div>
        </div>
      )}
    </div>
  );
}
