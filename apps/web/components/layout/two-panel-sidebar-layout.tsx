import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface TwoPanelSidebarLayoutProps {
  /** Main content area node */
  children: ReactNode;
  /** Right sidebar content node */
  sidebar?: ReactNode;
  /** Whether to show the right sidebar */
  isSidebarOpen: boolean;
  /** Breakpoint at which sidebar displays side-by-side with main area, defaults to lg (aligned with openloomi Soul) */
  breakpoint?: "md" | "lg";
  /** Extra class name added to the outermost container */
  className?: string;
  /** Extra class name added to the main area container */
  mainClassName?: string;
  /** Extra class name added to the sidebar container */
  sidebarClassName?: string;
}

const BREAKPOINT_CONFIG = {
  md: {
    mainHiddenWhenSidebarOpen: "hidden md:flex",
    sidebarWidth: "md:w-auto md:min-w-[320px] md:max-w-[420px]",
    sidebarBorder: "md:border-l",
  },
  lg: {
    mainHiddenWhenSidebarOpen: "hidden lg:flex",
    sidebarWidth: "lg:w-auto lg:min-w-[320px] lg:max-w-[420px]",
    sidebarBorder: "lg:border-l",
  },
} as const;

/**
 * Generic two-column layout: left main area + right sidebar
 * - Small screens show only sidebar (when open), main area is hidden
 * - At breakpoint, main area and sidebar display side-by-side, main area flex-1, sidebar fixed width
 * - Right sidebar scrolls independently without taking up content width
 */
export function TwoPaneSidebarLayout({
  children,
  sidebar,
  isSidebarOpen,
  breakpoint = "lg",
  className,
  mainClassName,
  sidebarClassName,
}: TwoPanelSidebarLayoutProps) {
  const bp = BREAKPOINT_CONFIG[breakpoint];

  return (
    <div
      className={cn(
        "mx-auto flex h-full min-h-0 w-full max-w-none gap-0",
        className,
      )}
    >
      <div
        className={cn(
          "flex h-full min-h-0 w-full flex-1 flex-row gap-0 min-w-0",
          isSidebarOpen ? bp.mainHiddenWhenSidebarOpen : "",
          mainClassName,
        )}
      >
        {children}
      </div>

      {isSidebarOpen && sidebar && (
        <div
          className={cn(
            // Fixed sidebar width, prevent shrinking, prioritize full display
            "flex h-full min-h-0 w-full flex-col rounded-none border-0 border-border bg-card overflow-y-auto",
            bp.sidebarWidth,
            bp.sidebarBorder,
            sidebarClassName,
          )}
        >
          {sidebar}
        </div>
      )}
    </div>
  );
}
