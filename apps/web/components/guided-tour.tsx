"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { RemixIcon } from "@/components/remix-icon";

import { Button } from "@openloomi/ui";

type Placement = "top" | "bottom" | "left" | "right";

export type TourStep = {
  id: string;
  selector?: string;
  title: string;
  description: string;
  placement?: Placement;
  padding?: number;
  onEnter?: () => void;
  autoScroll?: boolean;
};

type UpdateOptions = {
  scroll?: boolean;
};

interface GuidedTourProps {
  open: boolean;
  steps: TourStep[];
  onClose: () => void;
  onFinish?: () => void;
  onSkip?: () => void;
  onStepChange?: (step: TourStep, index: number) => void;
  labels: {
    next: string;
    back: string;
    skip: string;
    finish: string;
    close: string;
  };
}

const getFallbackRect = (): DOMRect => {
  const width = typeof window !== "undefined" ? window.innerWidth : 960;
  const height = typeof window !== "undefined" ? window.innerHeight : 640;
  const rectWidth = 240;
  const rectHeight = 160;
  const left = width / 2 - rectWidth / 2;
  const top = height / 2 - rectHeight / 2;
  return {
    x: left,
    y: top,
    width: rectWidth,
    height: rectHeight,
    top,
    left,
    right: left + rectWidth,
    bottom: top + rectHeight,
    toJSON: () => ({}),
  };
};

export function GuidedTour({
  open,
  steps,
  onClose,
  onFinish,
  onSkip,
  onStepChange,
  labels,
}: GuidedTourProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [isReady, setIsReady] = useState(false);
  const observerRef = useRef<ResizeObserver | null>(null);
  const rafRef = useRef<number | undefined>(undefined);

  const currentStep = steps[currentIndex];

  const updateRect = useCallback(
    (step: TourStep, options: UpdateOptions = {}) => {
      if (!open) return;

      if (!step.selector) {
        setTargetRect(null);
        return;
      }

      const element = document.querySelector(step.selector) as
        | HTMLElement
        | SVGElement
        | null;

      if (!element) {
        setTargetRect(null);
        return;
      }

      const rect = element.getBoundingClientRect();
      if (options.scroll) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      setTargetRect(rect);
    },
    [open],
  );

  useEffect(() => {
    if (!open) return;
    setCurrentIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const step = steps[currentIndex];
    step?.onEnter?.();
    onStepChange?.(step, currentIndex);
  }, [currentIndex, open, onStepChange, steps]);

  useLayoutEffect(() => {
    if (!open) return;
    setIsReady(false);
    const step = steps[currentIndex];
    const run = () => {
      updateRect(step, { scroll: step?.autoScroll !== false });
      setIsReady(true);
    };
    rafRef.current = window.requestAnimationFrame(run);

    const handleResize = () => updateRect(step);
    const handleScroll = () => updateRect(step);

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);

    if (step.selector) {
      const target = document.querySelector(step.selector);
      if (target && "ResizeObserver" in window) {
        observerRef.current = new ResizeObserver(() => updateRect(step));
        observerRef.current.observe(target);
      }
    }

    return () => {
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
      }
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [currentIndex, open, steps, updateRect]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const handleTourUpdate = () => {
      if (!currentStep) return;
      updateRect(currentStep, { scroll: false });
    };
    window.addEventListener("openloomi:guided-tour:update", handleTourUpdate);
    return () => {
      window.removeEventListener(
        "openloomi:guided-tour:update",
        handleTourUpdate,
      );
    };
  }, [currentStep, open, updateRect]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const handleClose = useCallback(
    (isSkip = false) => {
      if (isSkip) {
        onSkip?.();
      }
      onClose();
    },
    [onClose, onSkip],
  );

  const handleNext = useCallback(() => {
    if (currentIndex === steps.length - 1) {
      onFinish?.();
      onClose();
      return;
    }
    setCurrentIndex((index) => Math.min(index + 1, steps.length - 1));
  }, [currentIndex, steps.length, onFinish, onClose]);

  const handleBack = useCallback(() => {
    setCurrentIndex((index) => Math.max(index - 1, 0));
  }, []);

  const spotlightStyle = useMemo(() => {
    const rect = targetRect ?? getFallbackRect();
    const padding = currentStep?.padding ?? 16;
    const top = Math.max(rect.top - padding, 8);
    const left = Math.max(rect.left - padding, 8);

    const windowWidth =
      typeof window !== "undefined"
        ? window.innerWidth
        : Number.POSITIVE_INFINITY;
    const windowHeight =
      typeof window !== "undefined"
        ? window.innerHeight
        : Number.POSITIVE_INFINITY;

    const width = Math.min(rect.width + padding * 2, windowWidth - left - 8);
    const height = Math.min(rect.height + padding * 2, windowHeight - top - 8);

    return {
      top,
      left,
      width,
      height,
      borderRadius: Math.min(20, Math.max(12, Math.min(width, height) / 6)),
    };
  }, [currentStep?.padding, targetRect]);

  const tooltipStyle = useMemo(() => {
    const rect = spotlightStyle;
    const placement = currentStep?.placement ?? "bottom";
    const margin = 20;

    const windowWidth =
      typeof window !== "undefined"
        ? window.innerWidth
        : Number.POSITIVE_INFINITY;
    const windowHeight =
      typeof window !== "undefined"
        ? window.innerHeight
        : Number.POSITIVE_INFINITY;

    const cardWidth = Math.min(360, windowWidth - 32);
    let top = rect.top + rect.height + margin;
    let left = rect.left;

    if (placement === "top") {
      top = rect.top - margin;
    } else if (placement === "left") {
      top = rect.top + rect.height / 2;
      left = rect.left - margin;
    } else if (placement === "right") {
      top = rect.top + rect.height / 2;
      left = rect.left + rect.width + margin;
    }

    if (placement === "bottom" || placement === "top") {
      left = rect.left + rect.width / 2 - cardWidth / 2;
      left = Math.min(Math.max(16, left), windowWidth - cardWidth - 16);
      if (placement === "top") {
        top = Math.max(16, top - 220);
      } else {
        top = Math.min(top, windowHeight - 220);
      }
    } else {
      const vertical = rect.top + rect.height / 2;
      top = Math.min(Math.max(16, vertical - 110), windowHeight - 220);
      if (placement === "left") {
        left = Math.max(16, left - cardWidth);
      } else {
        left = Math.min(left, windowWidth - cardWidth - 16);
      }
    }

    return {
      top,
      left,
      width: cardWidth,
    };
  }, [currentStep?.placement, spotlightStyle]);

  const overlayRects = useMemo(() => {
    if (!isReady) return [];
    const { top, left, width, height } = spotlightStyle as {
      top: number;
      left: number;
      width: number;
      height: number;
    };
    const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 0;
    const viewportHeight =
      typeof window !== "undefined" ? window.innerHeight : 0;

    return [
      {
        id: "top",
        top: 0,
        left: 0,
        width: viewportWidth,
        height: Math.max(0, top),
      },
      {
        id: "left",
        top,
        left: 0,
        width: Math.max(0, left),
        height,
      },
      {
        id: "right",
        top,
        left: left + width,
        width: Math.max(0, viewportWidth - (left + width)),
        height,
      },
      {
        id: "bottom",
        top: top + height,
        left: 0,
        width: viewportWidth,
        height: Math.max(0, viewportHeight - (top + height)),
      },
    ];
  }, [isReady, spotlightStyle]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  const isLastStep = currentIndex === steps.length - 1;

  const tourOverlay = (
    <div className="fixed inset-0 z-[120]">
      {overlayRects.map((rect) =>
        rect.width > 0 && rect.height > 0 ? (
          <div
            key={rect.id}
            className="pointer-events-none fixed bg-slate-950/45 backdrop-blur-md transition-opacity duration-200"
            style={{
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
            }}
          />
        ) : null,
      )}
      {isReady && (
        <div
          className="pointer-events-none fixed border border-white/70 shadow-[0_0_0_9999px_rgba(15,23,42,0.6)] transition-all duration-200"
          style={spotlightStyle}
        />
      )}

      <div
        className="absolute z-[1] max-w-[90vw] rounded-3xl border border-white/40 bg-gradient-to-br from-white via-slate-50 to-sky-50/95 p-6 shadow-[0_28px_90px_-40px_rgba(32,56,121,0.45)] transition-all duration-200"
        style={tooltipStyle}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
              {currentIndex + 1} / {steps.length}
            </p>
            <h2 className="mt-2 text-lg font-semibold text-slate-900">
              {currentStep?.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">
              {currentStep?.description}
            </p>
          </div>
          <button
            test-dataid="btn-close-tour"
            type="button"
            onClick={() => handleClose(true)}
            className="inline-flex size-8 items-center justify-center rounded-full border border-slate-200 text-slate-400 transition hover:border-slate-300 hover:text-slate-600"
            aria-label={labels.close}
          >
            <RemixIcon name="close" size="size-4" />
          </button>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          {currentIndex > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-full border border-slate-200 px-4 text-slate-600 hover:bg-slate-100"
              onClick={handleBack}
            >
              {labels.back}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-full px-4 text-slate-500 hover:bg-slate-100"
            onClick={() => handleClose(true)}
          >
            {labels.skip}
          </Button>
          <Button
            type="button"
            variant="brand"
            size="sm"
            className="rounded-full px-5 shadow-sm"
            onClick={handleNext}
          >
            {isLastStep ? labels.finish : labels.next}
          </Button>
        </div>
      </div>
    </div>
  );

  return createPortal(tourOverlay, document.body);
}
