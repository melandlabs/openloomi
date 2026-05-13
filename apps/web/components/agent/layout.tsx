"use client";

import { useIsMobile } from "@openloomi/hooks/use-is-mobile";
import { cn } from "@/lib/utils";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { MobileHeader } from "./mobile-header";
import { AgentSectionHeader } from "./section-header";
import "../../i18n";

interface AgentLayoutProps {
  children: ReactNode;
  rightToolbar?: ReactNode;
  activeTools?: string[];
  centerTitle?: string;
  rightTitle?: string;
  hideCenterHeader?: boolean;
  centerHeaderActions?: ReactNode;
  /** Overlay floating above center card content area (absolute positioning, doesn't scroll with content) */
  centerOverlay?: ReactNode;
  mobileActivePanel?:
    | "insight"
    | "brief"
    | "chat"
    | "todo"
    | "favorite"
    | "people"
    | "assets"
    | "messages"
    | "files"; // Mobile currently active panel
  mobileHeaderTitle?: string; // Mobile header title
}

/**
 * Agent page layout component
 * - Workspace area is a colored card with large rounded corners
 * - Mobile supports standalone page mode (fullscreen single panel)
 * - Right temporary sidebar managed by global SidePanelShell (not handled in this component)
 */
export function AgentLayout({
  children,
  rightToolbar,
  activeTools = [],
  centerTitle = "Workspace",
  hideCenterHeader = false,
  centerHeaderActions,
  centerOverlay,
  mobileActivePanel,
  mobileHeaderTitle,
}: AgentLayoutProps) {
  const isMobile = useIsMobile();
  const searchParams = useSearchParams();
  const page = searchParams?.get("page");

  // Determine whether to show mobile menu bar (only on mobile and insight/brief page)
  const showMobileToolbar = isMobile && !page;
  // Mobile standalone mode: only show currently active panel, fullscreen width
  const isMobileStandaloneMode = isMobile && mobileActivePanel !== undefined;
  const needMobileHeader = isMobileStandaloneMode && mobileHeaderTitle;

  const rootClasses = cn(
    "flex w-full flex-col min-h-0",
    "safe-area-inset-bottom safe-area-inset-top",
    isMobileStandaloneMode
      ? "flex-1 h-full py-0 px-0"
      : cn(
          showMobileToolbar
            ? "flex-1 py-2 pt-2 pb-0 px-2 sm:py-4 sm:px-0 h-full"
            : cn(
                "flex-1 h-full min-h-0",
                // No inner padding on desktop without right toolbar (Focus/Insight), consistent with SidebarInset, avoids center card appearing smaller than right sidebar
                isMobile
                  ? "pt-3 sm:pt-3 pb-0 sm:pb-0 px-2 sm:pl-0 sm:pr-0"
                  : "",
              ),
        ),
  );
  // Only add inner padding when right toolbar exists; Focus/Insight desktop has no toolbar, no need to repeat SidebarInset's p-2 sm:p-3, avoids center card appearing smaller than right sidebar
  const rowClasses = cn(
    "flex-1 min-w-0 min-h-0 flex h-full overflow-hidden",
    isMobileStandaloneMode ? "gap-0" : "gap-2 sm:gap-3",
  );
  /** Without MobileHeader only one root node (consistent with other pages) */
  const singleRoot = !needMobileHeader;

  const rowContent = (
    <>
      {/* Main content workspace: flex-1 takes full available width, visually consistent with right sidebar at same level */}
      <div
        className={cn(
          "flex flex-col min-h-0",
          isMobileStandaloneMode
            ? "w-full h-full border-0 rounded-none bg-background"
            : cn(
                "h-full flex-1 min-w-[400px] max-md:min-w-[280px]",
                "transition-all duration-300 ease-out",
                "overflow-visible",
                centerOverlay ? "relative" : "",
              ),
        )}
      >
        {/* Desktop non-standalone mode shows center header */}
        {!isMobileStandaloneMode && !hideCenterHeader && (
          <AgentSectionHeader title={centerTitle}>
            {centerHeaderActions}
          </AgentSectionHeader>
        )}
        {isMobileStandaloneMode ? (
          children
        ) : (
          <div className="flex-1 min-h-0 overflow-auto">{children}</div>
        )}
        {/* Overlay: absolute positioning, doesn't scroll with content (desktop only) */}
        {!isMobileStandaloneMode && centerOverlay}
      </div>
    </>
  );

  return (
    <div className={singleRoot ? cn(rootClasses, rowClasses) : rootClasses}>
      {needMobileHeader && mobileHeaderTitle && (
        <MobileHeader title={mobileHeaderTitle} />
      )}
      {singleRoot ? rowContent : <div className={rowClasses}>{rowContent}</div>}
    </div>
  );
}
