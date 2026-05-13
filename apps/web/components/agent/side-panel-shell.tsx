"use client";

import { cn } from "@/lib/utils";
import { useCallback, useRef, type ReactNode } from "react";
import { useSidePanel } from "./side-panel-context";
import { useIsMobile } from "@openloomi/hooks/use-is-mobile";
import { useTranslation } from "react-i18next";
import "../../i18n";

/** Responsive: sidebar width constraints below md breakpoint (768px, matching Tailwind max-md) */
const SIDE_PANEL_MIN_MOBILE = 280;
const SIDE_PANEL_MAX_MOBILE = 500;
const SIDE_PANEL_DEFAULT_MOBILE = 320;
const SIDE_PANEL_MIN_DESKTOP = 360;
const SIDE_PANEL_MAX_DESKTOP = 600;
const SIDE_PANEL_DEFAULT_DESKTOP = 400;

function clampWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Draggable width resize handle (drags left edge to change sidebar width)
 * Touch target >= 44px (before expands clickable area), compliant with responsive-design accessibility
 */
function ResizableHandle({
  onResize,
  minWidth,
  maxWidth,
  ariaLabel,
}: {
  onResize: (width: number) => void;
  minWidth: number;
  maxWidth: number;
  ariaLabel: string;
}) {
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const onResizeRef = useRef(onResize);
  const minRef = useRef(minWidth);
  const maxRef = useRef(maxWidth);

  onResizeRef.current = onResize;
  minRef.current = minWidth;
  maxRef.current = maxWidth;

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current) return;
    const deltaX = startX.current - e.clientX;
    const raw = startWidth.current + deltaX;
    const w = clampWidth(raw, minRef.current, maxRef.current);
    onResizeRef.current(w);
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseMove]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isDragging.current = true;
      startX.current = e.clientX;
      const panelElement = (e.currentTarget as HTMLElement).parentElement;
      if (panelElement) {
        startWidth.current = panelElement.offsetWidth;
      }
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [handleMouseMove, handleMouseUp],
  );

  return (
    <div
      className={cn(
        "absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-50",
        "hover:bg-primary/50 active:bg-primary/70 transition-colors",
        "before:absolute before:inset-y-0 before:-left-2 before:right-0 before:w-11 before:bg-transparent",
      )}
      onMouseDown={handleMouseDown}
      role="separator"
      aria-label={ariaLabel}
      aria-orientation="vertical"
    >
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-transparent group-hover:bg-primary/30" />
    </div>
  );
}

/**
 * Global sidebar layout shell
 * - Reads current panel state from SidePanelContext
 * - Desktop: main content (flex-1) + sidebar (content-area-card), draggable width, responsive min/max
 * - Sidebar is a temporary panel, closes on page change
 */
export function SidePanelShell({ children }: { children: ReactNode }) {
  const { sidePanel, setSidePanelWidth } = useSidePanel();
  const isMobile = useIsMobile();
  const { t } = useTranslation();

  const hasSidePanel = sidePanel !== null;
  const isFullscreen = sidePanel?.displayMode === "fullscreen";

  const minW = isMobile ? SIDE_PANEL_MIN_MOBILE : SIDE_PANEL_MIN_DESKTOP;
  const maxW = isMobile ? SIDE_PANEL_MAX_MOBILE : SIDE_PANEL_MAX_DESKTOP;
  const defaultW = isMobile
    ? SIDE_PANEL_DEFAULT_MOBILE
    : SIDE_PANEL_DEFAULT_DESKTOP;

  const handleResize = useCallback(
    (width: number) => {
      setSidePanelWidth(clampWidth(width, minW, maxW));
    },
    [setSidePanelWidth, minW, maxW],
  );

  const effectiveWidth =
    sidePanel?.width != null
      ? clampWidth(sidePanel.width, minW, maxW)
      : defaultW;

  return (
    <div className="flex h-full w-full min-h-0 min-w-0 overflow-visible">
      <div
        className={cn(
          "content-area-card relative min-w-0 min-h-0 overflow-hidden flex flex-col",
          isFullscreen ? "hidden" : "flex-1",
        )}
      >
        {children}
      </div>

      {hasSidePanel && sidePanel && (
        <div
          className={cn(
            "content-area-card",
            "flex flex-col flex-shrink-0 overflow-hidden h-full",
            "transition-all duration-200",
            isFullscreen ? "flex-1" : "relative ml-2 sm:ml-2",
          )}
          style={
            isFullscreen
              ? undefined
              : {
                  width: `${effectiveWidth}px`,
                  minWidth: `${minW}px`,
                  maxWidth: `${maxW}px`,
                }
          }
        >
          {!isFullscreen && (
            <ResizableHandle
              onResize={handleResize}
              minWidth={minW}
              maxWidth={maxW}
              ariaLabel={t("common.resizePanelWidth", "Resize panel width")}
            />
          )}
          {sidePanel.content}
        </div>
      )}
    </div>
  );
}
