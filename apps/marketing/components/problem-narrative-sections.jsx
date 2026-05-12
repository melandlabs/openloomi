"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { RemixIcon } from "@/components/remix-icon";
import { SectionEyebrow } from "@/components/section-eyebrow";
import { PlatformCard } from "@/components/ui/platform-card";
import { useTranslation } from "react-i18next";

/** 02 block: left side 2×2 data cards + right side narrative (Remix: question-answer / mail-send / calendar-event / file-list-3) */
const howItWorksStatsStatic = [
  { icon: "question-answer", value: "847" },
  { icon: "mail-send", value: "1,203" },
  { icon: "calendar-event", value: "142h" },
  { icon: "file-list-3", value: "2.4k" },
];

/** 03 block: right side task steps */
const thenItActsStepsStatic = [
  { num: "01", icon: "mail-send" },
  { num: "02", icon: "calendar-event" },
  { num: "03", icon: "file-list-3" },
  { num: "04", icon: "route" },
  { num: "05", icon: "checkbox-circle" },
];

/** Capabilities: six-grid copy */
const capabilitiesItemsStatic = [
  {
    title: "Cross-channel memory",
    icon: "archive-stack",
    backgroundImage: "/img/pic/function/Cross.png",
  },
  {
    title: "Priority intelligence",
    icon: "radar",
    backgroundImage: "/img/pic/function/Priority.png",
  },
  {
    title: "Proactive action",
    icon: "flashlight",
    backgroundImage: "/img/pic/function/action.png",
  },
  {
    title: "200+ professional skills",
    icon: "apps-2",
    backgroundImage: "/img/pic/function/Skills.png",
  },
  {
    title: "You approve, it executes",
    icon: "checkbox-circle",
    backgroundImage: "/img/pic/function/Executes.png",
  },
  {
    title: "Continuous follow-through",
    icon: "route",
    backgroundImage: "/img/pic/function/Follow.png",
  },
];

const sectionShell = "w-full mx-0 px-4 sm:px-20 lg:px-20 py-20 sm:py-32";
const sectionInner = "w-full max-w-[1440px] mx-auto";

/**
 * Stat card icon: defaults to line variant, switches to fill on hover when parent has `group` (two icons stacked with opacity).
 */
function HowItWorksStatIcon({ name }) {
  const iconLayer =
    "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-foreground transition-opacity duration-200";
  return (
    <div className="relative flex size-9 shrink-0 items-center justify-center rounded-lg border border-transparent">
      <RemixIcon
        name={name}
        size="size-4"
        className={`${iconLayer} group-hover:opacity-0`}
        variant="line"
      />
      <RemixIcon
        name={name}
        size="size-4"
        className={`${iconLayer} opacity-0 group-hover:opacity-100`}
        variant="fill"
      />
    </div>
  );
}

/**
 * 03 — Then it acts: step card (unified style component, centralizing icon size rules)
 *
 * Corresponds to the `div.group ...` structure: renders step card content and icon sizes within.
 */
function ThenItActsStepCard({
  row,
  isApproved,
  stepCircleRef,
  onApprove,
  approveLabel,
}) {
  // All step card icons are fixed at 36x36 (enforced on <i>: ensures width/height take effect).
  const stepIconStyle = { width: "36px", height: "36px" };
  // Not approved: black line icon; Approved: blue filled icon.
  const stepIconVariant = isApproved ? "fill" : "line";
  const stepIconClassName = isApproved ? "text-primary" : "text-foreground";

  return (
    <li className="flex min-w-0 items-center gap-8">
      <span
        // Step number uses full rounded corners, matching the 999px radius in the design preview
        ref={stepCircleRef}
        className={`relative z-[1] flex h-10 w-10 shrink-0 items-center justify-center rounded-[999px] border text-sm font-semibold ${
          isApproved
            ? "border-border-primary/60 bg-accent-50 text-primary"
            : "border-border bg-background-secondary text-foreground-muted"
        }`}
        aria-label={`Step ${row.num}`}
      >
        {isApproved ? "✓" : row.num}
      </span>

      <div className="group flex min-w-0 flex-1 items-center justify-between gap-4 rounded-2xl border border-border bg-card px-4 py-4 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="inline-flex rounded-full border border-border p-1">
            <RemixIcon
              name={row.icon}
              size="size-9"
              variant={stepIconVariant}
              className={stepIconClassName}
              style={stepIconStyle}
            />
          </div>
          <span className="min-w-0 flex-1 text-base font-medium font-serif text-foreground">
            {row.text}
          </span>
        </div>

        {!isApproved && (
          <button
            type="button"
            onClick={onApprove}
            className="shrink-0 rounded-lg border border-border-primary/30 bg-background-secondary px-3 py-2 text-sm font-medium text-foreground-muted transition-all pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-accent-50"
            aria-label={`Approve ${row.text}`}
          >
            <span className="inline-flex items-center gap-2">
              {approveLabel}
            </span>
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * 02 — How it works: stat cards and "understanding work" narrative (standalone section).
 *
 * @param platforms Data for the platform marquee (automatically duplicated twice for seamless scrolling).
 */
export function HowItWorksSection({ platforms = [] } = {}) {
  const { t } = useTranslation();
  const platformLoop = [...platforms, ...platforms];

  const stats = [
    { ...howItWorksStatsStatic[0], label: t("howItWorks.stats.messages") },
    { ...howItWorksStatsStatic[1], label: t("howItWorks.stats.emails") },
    { ...howItWorksStatsStatic[2], label: t("howItWorks.stats.meetings") },
    { ...howItWorksStatsStatic[3], label: t("howItWorks.stats.docs") },
  ];

  return (
    <section className={sectionShell} aria-labelledby="how-it-works-heading">
      <div className={sectionInner}>
        <div
          className="grid grid-cols-1 lg:grid-cols-2 lg:items-center"
          style={{ rowGap: "80px", columnGap: "80px" }}
        >
          <div className="min-w-0 order-2 lg:order-1">
            <div className="rounded-[24px] overflow-hidden border border-border bg-border">
              <div className="grid grid-cols-2 gap-px">
                {stats.map((cell) => (
                  <div
                    key={cell.label}
                    className="group flex flex-col items-start justify-center gap-1 bg-card px-8 py-8 transition-colors duration-200 hover:bg-primary-50"
                  >
                    <div className="mb-3 inline-flex rounded-full border border-border p-1">
                      <HowItWorksStatIcon name={cell.icon} />
                    </div>
                    <span className="mt-0 text-3xl sm:text-4xl font-semibold font-serif text-foreground tabular-nums">
                      {cell.value}
                    </span>
                    <span className="text-[11px] tracking-wider uppercase text-foreground-muted">
                      {cell.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-3 text-center text-sm text-muted-foreground">
              {t("howItWorks.statsAvg")}
            </p>
          </div>
          <div className="min-w-0 order-1 lg:order-2">
            <SectionEyebrow variant="pill" className="mb-6">
              {t("howItWorks.eyebrow")}
            </SectionEyebrow>
            <h2
              id="how-it-works-heading"
              className="text-[32px] sm:text-[48px] leading-[1.1] font-serif font-semibold tracking-tight text-foreground"
            >
              {t("howItWorks.heading")}
              <br />
              <span className="text-primary">
                {t("howItWorks.headingAccent")}
              </span>
            </h2>
            <p className="mt-6 text-base leading-relaxed text-foreground-muted">
              {t("howItWorks.description")}
            </p>
            <blockquote className="mt-6 border-l-[3px] border-primary pl-5 font-serif text-base italic text-foreground-muted">
              {t("howItWorks.quote")}
            </blockquote>
          </div>
        </div>

        {platforms.length > 0 && (
          <div className="mt-16 border-t border-border pt-12">
            <div className="flex items-center justify-center pb-6 text-center">
              <a
                href="https://alloomi.ai/docs/alloomi/connectors"
                className="text-sm text-muted-foreground uppercase hover:text-foreground transition-colors underline decoration-current underline-offset-4"
              >
                {t("howItWorks.platformMarquee")}
              </a>
            </div>

            <div className="platform-marquee-row">
              <div className="platform-track platform-track-bottom">
                {platformLoop.map((platform, index) => (
                  <PlatformCard
                    key={`${platform.name}-${index}`}
                    name={platform.name}
                    logoPath={platform.logoPath}
                    completed={platform.completed}
                  />
                ))}
              </div>
            </div>

            <style jsx>{`
              .platform-marquee-row {
                width: 100%;
                overflow: hidden;
              }

              .platform-track {
                display: flex;
                gap: 0.75rem;
                width: max-content;
                will-change: transform;
              }

              .platform-track-bottom {
                animation: platform-scroll-left 72s linear infinite;
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
            `}</style>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * 03 — Then it acts: left-side conclusion + right-side step card list (standalone section).
 * Step number uses 999px border-radius (pill shape).
 */
export function ThenItActsSection() {
  const { t } = useTranslation();
  const [approvedSteps, setApprovedSteps] = useState(() =>
    thenItActsStepsStatic.map(() => false),
  );
  const olRef = useRef(null);
  const stepCircleRefs = useRef([]);
  const [connectorSegments, setConnectorSegments] = useState([]);

  function handleApprove(stepIndex) {
    // After clicking approve, mark the corresponding step as complete; won't trigger again once done
    setApprovedSteps((prev) =>
      prev.map((approved, idx) => (idx === stepIndex ? true : approved)),
    );
  }

  useLayoutEffect(() => {
    // Calculate the position of the connector segment overlay between step i (completed) and step i+1 (next), centered on both step circles.
    if (!olRef.current) return;

    const olEl = olRef.current;
    const olRect = olEl.getBoundingClientRect();

    const segments = [];
    for (let idx = 0; idx < thenItActsStepsStatic.length - 1; idx++) {
      if (!approvedSteps[idx]) continue;
      const a = stepCircleRefs.current[idx];
      const b = stepCircleRefs.current[idx + 1];
      if (!a || !b) continue;

      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();

      const aCenterY = aRect.top - olRect.top + aRect.height / 2;
      const bCenterY = bRect.top - olRect.top + bRect.height / 2;

      const top = Math.min(aCenterY, bCenterY);
      const height = Math.max(0, Math.abs(bCenterY - aCenterY));

      if (height > 0) segments.push({ top, height });
    }

    // Update render data based on DOM measurement results; this triggers the lint rule but doesn't affect interaction correctness.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConnectorSegments(segments);
  }, [approvedSteps]);

  const steps = thenItActsStepsStatic.map((s, i) => ({
    ...s,
    text: t(`thenItActs.steps.${i}`),
  }));

  return (
    <section
      className={`${sectionShell} bg-primary-50`}
      aria-labelledby="then-it-acts-heading"
    >
      <div className={sectionInner}>
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-20 lg:items-start">
          <div className="min-w-0">
            <SectionEyebrow variant="pill" className="mb-6">
              {t("thenItActs.eyebrow")}
            </SectionEyebrow>
            <h2
              id="then-it-acts-heading"
              className="text-[32px] sm:text-[48px] leading-[1.1] font-serif font-semibold tracking-tight text-foreground"
            >
              {t("thenItActs.heading")}
              <br />
              <span className="text-primary">
                {t("thenItActs.headingAccent")}
              </span>
            </h2>
            <p className="mt-6 text-base leading-relaxed text-foreground-muted">
              {t("thenItActs.description")}
            </p>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <ol ref={olRef} className="relative flex min-w-0 flex-col gap-3">
              <div
                className="absolute left-5 top-5 bottom-5 w-px -translate-x-1/2 bg-border"
                aria-hidden
              />
              {connectorSegments.map((seg, idx) => (
                <div
                  key={`${seg.top}-${seg.height}-${idx}`}
                  className="absolute left-5 w-px -translate-x-1/2 bg-border-primary/60"
                  style={{ top: seg.top, height: seg.height }}
                  aria-hidden
                />
              ))}
              {steps.map((row, idx) => {
                const isApproved = approvedSteps[idx];
                return (
                  <ThenItActsStepCard
                    key={row.num}
                    row={row}
                    isApproved={isApproved}
                    stepCircleRef={(el) => {
                      stepCircleRefs.current[idx] = el;
                    }}
                    onApprove={() => handleApprove(idx)}
                    approveLabel={t("thenItActs.approve")}
                  />
                );
              })}
            </ol>
            <p className="mt-3 text-center text-sm text-muted-foreground">
              {t("thenItActs.footer")}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Capabilities: heading area + Tab-switched capability content (standalone section).
 */
export function CapabilitiesSection() {
  const { t } = useTranslation();
  const getArr = (key) => {
    const val = t(key, { returnObjects: true });
    return Array.isArray(val) ? val : [];
  };
  const [activeCapabilityIndex, setActiveCapabilityIndex] = useState(0);
  const [visibleCapabilityCount, setVisibleCapabilityCount] = useState(
    capabilitiesItemsStatic.length,
  );
  const [isOverflowMenuOpen, setIsOverflowMenuOpen] = useState(false);
  const [overflowMenuFloatingStyle, setOverflowMenuFloatingStyle] =
    useState(null);

  const tablistRef = useRef(null);

  // Used to measure the width of all tabs under current styles (rendered off-screen).
  const capabilityButtonMeasureRefs = useRef([]);
  const ellipsisMeasureButtonRef = useRef(null);

  // Overflow menu control (used to close the menu).
  const overflowButtonRef = useRef(null);
  const overflowMenuRef = useRef(null);

  /**
   * Calculate the fixed floating style for the dropdown menu based on button position and viewport space.
   * Strategy: prefer bottom placement, flip to top when space is insufficient; limit max-height to avoid viewport clipping.
   * @returns {React.CSSProperties | null} Menu style object
   */
  const resolveOverflowMenuFloatingStyle = () => {
    const buttonEl = overflowButtonRef.current;
    const menuEl = overflowMenuRef.current;
    if (!buttonEl) return null;

    const buttonRect = buttonEl.getBoundingClientRect();
    const menuHeight = menuEl?.offsetHeight ?? 150;
    const menuWidth = Math.max(menuEl?.offsetWidth ?? 260, 260);
    const spacing = 8;
    const viewportPadding = 12;

    const availableTop = buttonRect.top - viewportPadding;
    const availableBottom =
      window.innerHeight - buttonRect.bottom - viewportPadding;

    const canShowBottom = availableBottom >= menuHeight + spacing;
    const canShowTop = availableTop >= menuHeight + spacing;

    // Prefer bottom placement, only flip to top when bottom clearly doesn't have enough space.
    const placement = canShowBottom
      ? "bottom"
      : canShowTop
        ? "top"
        : availableBottom >= availableTop
          ? "bottom"
          : "top";

    const maxHeight =
      placement === "bottom"
        ? Math.max(120, availableBottom - spacing)
        : Math.max(120, availableTop - spacing);

    const unclampedTop =
      placement === "bottom"
        ? buttonRect.bottom + spacing
        : buttonRect.top - spacing - Math.min(menuHeight, maxHeight);

    const top = Math.max(
      viewportPadding,
      Math.min(
        unclampedTop,
        window.innerHeight - viewportPadding - Math.min(menuHeight, maxHeight),
      ),
    );

    const unclampedLeft = buttonRect.right - menuWidth;
    const left = Math.max(
      viewportPadding,
      Math.min(unclampedLeft, window.innerWidth - viewportPadding - menuWidth),
    );

    return {
      position: "fixed",
      top,
      left,
      minWidth: Math.max(260, buttonRect.width),
      maxHeight,
      overflowY: "auto",
      zIndex: 80,
    };
  };

  /**
   * Switch the currently displayed capability item.
   * @param {number} tabIndex Index of the tab
   */
  const handleCapabilityTabChange = (tabIndex) => {
    setActiveCapabilityIndex(tabIndex);
    setIsOverflowMenuOpen(false);
  };

  const activeItem =
    capabilitiesItemsStatic[activeCapabilityIndex] ??
    capabilitiesItemsStatic[0];

  const visibleCapabilities = capabilitiesItemsStatic.slice(
    0,
    visibleCapabilityCount,
  );
  const overflowCapabilities = capabilitiesItemsStatic.slice(
    visibleCapabilityCount,
  );

  const showOverflowMenu = overflowCapabilities.length > 0;
  const isActiveInOverflow = activeCapabilityIndex >= visibleCapabilityCount;

  /**
   * Calculate how many tabs can be displayed in the current width (remaining go into `...` dropdown).
   * Depends on: actual tab width measurements + container available width.
   */
  useLayoutEffect(() => {
    /**
     * Refresh `visibleCapabilityCount` based on measurement results.
     */
    function computeVisibleCount() {
      const tablistEl = tablistRef.current;
      const ellipsisMeasureEl = ellipsisMeasureButtonRef.current;
      if (!tablistEl || !ellipsisMeasureEl) return;

      const measureButtons = capabilitiesItemsStatic.map((_, idx) => {
        return capabilityButtonMeasureRefs.current[idx];
      });
      if (measureButtons.some((el) => !el)) return;

      const tablistStyles = window.getComputedStyle(tablistEl);
      const paddingLeft = parseFloat(tablistStyles.paddingLeft || "0") || 0;
      const paddingRight = parseFloat(tablistStyles.paddingRight || "0") || 0;
      const gapValue =
        parseFloat(tablistStyles.gap || tablistStyles.columnGap || "0") || 0;

      // clientWidth includes padding, so subtract left and right padding to get available content width.
      const availableContentWidth =
        tablistEl.clientWidth - paddingLeft - paddingRight;

      const widths = measureButtons.map((el) => el.offsetWidth);
      const n = capabilitiesItemsStatic.length;
      const ellipsisWidth = ellipsisMeasureEl.offsetWidth;

      const totalNoEllipsis =
        widths.reduce((sum, w) => sum + w, 0) + gapValue * (n - 1);

      // If all tabs can fit, no ellipsis needed.
      if (totalNoEllipsis <= availableContentWidth) {
        setVisibleCapabilityCount(n);
        return;
      }

      // Otherwise: find the maximum number of visible tabs while reserving space for `...`.
      // - With visibleCount = k, there are (k-1) gaps between buttons
      // - There's also 1 gap between ellipsis and the last button (when k > 0)
      let best = 0;
      let sumWidths = 0;

      for (let k = 0; k <= n; k++) {
        if (k > 0) sumWidths += widths[k - 1];

        const widthButtons = k === 0 ? 0 : sumWidths + gapValue * (k - 1);
        const widthWithEllipsis =
          widthButtons + (k > 0 ? gapValue : 0) + ellipsisWidth;

        if (widthWithEllipsis <= availableContentWidth + 0.5) {
          best = k;
        } else {
          break;
        }
      }

      setVisibleCapabilityCount(best);
    }

    const tablistEl = tablistRef.current;
    if (!tablistEl || typeof ResizeObserver === "undefined") return;

    let rafId = 0;
    const schedule = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(computeVisibleCount);
    };

    schedule();

    const ro = new ResizeObserver(() => schedule());
    ro.observe(tablistEl);

    return () => {
      ro.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  useEffect(() => {
    /**
     * Close the `...` dropdown when clicking outside the tab area.
     */
    if (!isOverflowMenuOpen) return;

    const onPointerDown = (e) => {
      const target = e.target;
      const inMenu = overflowMenuRef.current?.contains(target);
      const inButton = overflowButtonRef.current?.contains(target);
      if (inMenu || inButton) return;
      setIsOverflowMenuOpen(false);
    };

    const onKeyDown = (e) => {
      if (e.key === "Escape") setIsOverflowMenuOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, {
        capture: true,
      });
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOverflowMenuOpen]);

  useLayoutEffect(() => {
    /**
     * Calculate fixed positioning when menu opens, and sync updates on scroll/resize to avoid viewport edge clipping.
     */
    if (!isOverflowMenuOpen) return;

    const updateFloatingStyle = () => {
      setOverflowMenuFloatingStyle(resolveOverflowMenuFloatingStyle());
    };

    updateFloatingStyle();
    const rafId = requestAnimationFrame(updateFloatingStyle);
    window.addEventListener("resize", updateFloatingStyle);
    window.addEventListener("scroll", updateFloatingStyle, true);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", updateFloatingStyle);
      window.removeEventListener("scroll", updateFloatingStyle, true);
    };
  }, [isOverflowMenuOpen]);

  return (
    <section className={sectionShell} aria-labelledby="capabilities-heading">
      <div className={sectionInner}>
        <div className="grid grid-cols-1 gap-6 lg:gap-6 mb-10 sm:mb-12">
          <div className="flex flex-col justify-start items-center gap-6">
            {/* Use pill variant to get consistent badge styling with other sections */}
            <SectionEyebrow variant="pill">
              {t("capabilities.eyebrow")}
            </SectionEyebrow>
            <h2
              id="capabilities-heading"
              className="text-[28px] sm:text-[36px] md:text-[48px] leading-[1.12] font-serif font-semibold tracking-tight text-foreground"
            >
              {t("capabilities.heading")}
            </h2>
          </div>
          <p className="text-base leading-relaxed text-center text-foreground-muted lg:pb-1">
            {t("capabilities.description")}
          </p>
        </div>
        <div className="w-full flex flex-col gap-6">
          <div className="relative px-2 mb-0">
            {/* Visible tabs (no wrap, no scroll). When width is insufficient, show `...` and put remaining tabs in the dropdown menu. */}
            <div
              ref={tablistRef}
              className="flex flex-nowrap max-w-full items-center gap-1 rounded-2xl border border-border-primary/60 bg-primary-50 p-1 overflow-x-hidden overflow-y-visible"
              role="tablist"
              aria-label="Capabilities tabs"
            >
              {visibleCapabilities.map((item, idxVisible) => {
                const idx = idxVisible;
                const isActive = idx === activeCapabilityIndex;
                const capabilityItem = getArr("capabilities.items")[idx];
                return (
                  <button
                    key={item.title}
                    type="button"
                    role="tab"
                    id={`capability-tab-${idx}`}
                    aria-selected={isActive}
                    aria-controls={`capability-panel-${idx}`}
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => handleCapabilityTabChange(idx)}
                    className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm transition-all ${
                      isActive
                        ? "font-medium bg-white text-primary shadow-[0_1px_2px_rgba(16,24,40,0.12)]"
                        : "font-normal bg-transparent text-foreground-muted hover:text-foreground"
                    }`}
                    aria-label={`Show capability: ${capabilityItem?.title}`}
                  >
                    <RemixIcon
                      name={item.icon}
                      size="size-4"
                      variant={isActive ? "fill" : "line"}
                    />
                    <span className="whitespace-nowrap">
                      {capabilityItem?.title}
                    </span>
                  </button>
                );
              })}

              {showOverflowMenu && (
                <div className="flex-none ml-auto z-10">
                  <button
                    ref={overflowButtonRef}
                    type="button"
                    aria-label="More capabilities"
                    aria-haspopup="menu"
                    aria-expanded={isOverflowMenuOpen}
                    onClick={() => setIsOverflowMenuOpen((v) => !v)}
                    className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm transition-all border ${
                      isActiveInOverflow
                        ? "font-medium border-primary bg-white text-primary"
                        : "font-normal border-border-primary/60 bg-white text-foreground-muted hover:text-foreground hover:bg-white"
                    }`}
                  >
                    <i className="ri-more-line" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>

            {showOverflowMenu && isOverflowMenuOpen && (
              <div style={overflowMenuFloatingStyle ?? undefined}>
                <div
                  ref={overflowMenuRef}
                  role="menu"
                  aria-label="More capabilities menu"
                  className="w-max min-w-[260px] rounded-xl border border-border bg-white shadow-[0_10px_30px_rgba(0,0,0,0.12)] p-1"
                >
                  {overflowCapabilities.map((item, idxOffset) => {
                    const idx = visibleCapabilityCount + idxOffset;
                    const isActive = idx === activeCapabilityIndex;
                    const capabilityItem = getArr("capabilities.items")[idx];
                    return (
                      <button
                        key={item.title}
                        type="button"
                        role="menuitem"
                        onClick={() => handleCapabilityTabChange(idx)}
                        className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                          isActive
                            ? "font-medium bg-white text-primary"
                            : "font-normal text-foreground-muted hover:text-foreground hover:bg-white"
                        }`}
                        aria-label={`Show capability: ${capabilityItem?.title}`}
                      >
                        <RemixIcon
                          name={item.icon}
                          size="size-4"
                          variant={isActive ? "fill" : "line"}
                        />
                        <span className="whitespace-nowrap">
                          {capabilityItem?.title}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Off-screen measurement container: not interactive, only used to calculate total tab width. */}
            <div
              aria-hidden="true"
              className="absolute left-[-9999px] top-0 flex items-center gap-1 pointer-events-none select-none"
            >
              {capabilitiesItemsStatic.map((item, idx) => (
                <button
                  key={`measure-${item.title}`}
                  ref={(el) => {
                    capabilityButtonMeasureRefs.current[idx] = el;
                  }}
                  type="button"
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-normal transition-all bg-transparent text-foreground-muted"
                >
                  <RemixIcon name={item.icon} size="size-4" variant="line" />
                  <span className="whitespace-nowrap">
                    {getArr("capabilities.items")[idx]?.title}
                  </span>
                </button>
              ))}
              <button
                ref={ellipsisMeasureButtonRef}
                type="button"
                className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-normal transition-all border border-border-primary/60 bg-white text-foreground-muted"
              >
                <i className="ri-more-line" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div
            id={`capability-panel-${activeCapabilityIndex}`}
            role="tabpanel"
            aria-labelledby={`capability-tab-${activeCapabilityIndex}`}
            className="rounded-[24px] overflow-hidden border border-border bg-border aspect-video"
          >
            <div
              className="relative h-full bg-card bg-cover bg-center bg-no-repeat px-6 py-8 sm:py-10 flex items-end"
              style={{ backgroundImage: `url(${activeItem.backgroundImage})` }}
            >
              <div className="hidden md:block absolute right-4 top-4 z-[1] w-[280px] max-w-[calc(100%-2rem)] rounded-2xl border border-border/70 bg-card/88 p-6 shadow-md backdrop-blur-sm sm:right-6 sm:top-6 sm:p-5">
                <div
                  className="mb-4 inline-flex rounded-full border border-border p-1"
                  aria-hidden
                >
                  <div className="relative flex size-9 shrink-0 items-center justify-center rounded-lg border border-transparent">
                    <RemixIcon
                      name={activeItem.icon}
                      size="size-4"
                      variant="line"
                      className="text-foreground"
                    />
                  </div>
                </div>
                <h3 className="text-lg font-semibold font-serif text-foreground mb-2">
                  {getArr("capabilities.items")[activeCapabilityIndex]?.title}
                </h3>
                <p className="text-sm leading-relaxed text-foreground-muted">
                  {
                    getArr("capabilities.items")[activeCapabilityIndex]
                      ?.description
                  }
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
