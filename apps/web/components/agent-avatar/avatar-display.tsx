"use client";

import React, { useRef, useEffect, useState, useId, useCallback } from "react";
import type { AvatarConfiguration, SvgPath } from "./types";
import { EYES, EYEBROWS, NOSES, MOUTHS } from "./constants";
import { getAvatarShapePreset } from "./shape-presets";
import { getPresetGradientHex } from "./preset-gradient-hex";
import {
  AvatarShapePathInHundred,
  getAvatarShapePathScale,
} from "./shape-path-utils";

/**
 * Avatar display component props interface
 */
interface AvatarDisplayProps {
  /** Avatar configuration */
  config: AvatarConfiguration;
  /** Additional CSS class name */
  className?: string;
  /** Download function reference callback */
  onDownloadRef?: (fn: () => void) => void;
  /** Whether to enable interaction effects (legacy flag, maps to blink + gaze defaults) */
  enableInteractions?: boolean;
  /** Whether blinking animation is enabled */
  enableBlinking?: boolean;
  /** Whether gaze tracking interaction is enabled */
  enableGazeTracking?: boolean;
  /** Class name for avatar background SVG scale wrapper */
  backgroundScaleClassName?: string;
  /** Class name for avatar facial-features SVG scale wrapper */
  featureScaleClassName?: string;
}

/** Canvas scale: 100 SVG user units span the 1024 export */
const EXPORT_SCALE = 10.24;

/**
 * Sync React state with prefers-reduced-motion for SVG SMIL toggling.
 */
function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduce(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return reduce;
}

/**
 * Agent Avatar display component
 * Shows an interactive AI assistant avatar with blinking and gaze tracking effects;
 * the background gradient is constrained within the optional shape clip.
 */
export function AvatarDisplay({
  config,
  className,
  onDownloadRef,
  enableInteractions = true,
  enableBlinking,
  enableGazeTracking,
  backgroundScaleClassName,
  featureScaleClassName,
}: AvatarDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lookAtRef = useRef({ x: 0, y: 0 });
  const [lookAt, setLookAt] = useState({ x: 0, y: 0 });
  const [isBlinking, setIsBlinking] = useState(false);
  const rafRef = useRef<number | null>(null);
  const pendingLookRef = useRef({ x: 0, y: 0 });
  // useId is stable across SSR/client in React 18+
  const svgClipId = useId();
  const reduceMotion = usePrefersReducedMotion();

  const isCustomImageMode = Boolean(config.customTextureUrl);
  const gradientId = `${svgClipId}-lg`;
  const shape = getAvatarShapePreset(
    isCustomImageMode ? "circle" : config.shapeId,
  );
  const [c1, c2, c3] = getPresetGradientHex(config.colorPresetId);

  const blinkingEnabled = isCustomImageMode
    ? false
    : (enableBlinking ?? enableInteractions);
  const gazeTrackingEnabled = isCustomImageMode
    ? false
    : (enableGazeTracking ?? enableInteractions);

  /**
   * Get asset by ID
   */
  const getAsset = (list: SvgPath[], id: string) =>
    list.find((item) => item.id === id) || list[0];

  const eyes = getAsset(EYES, config.eyesId);
  const eyebrows = getAsset(EYEBROWS, config.eyebrowsId);
  const nose = getAsset(NOSES, config.noseId);
  const mouth = getAsset(MOUTHS, config.mouthId);

  /**
   * Blinking logic
   */
  useEffect(() => {
    if (!blinkingEnabled) return;

    let timeoutId: ReturnType<typeof setTimeout>;

    const triggerBlink = () => {
      setIsBlinking(true);
      setTimeout(() => {
        setIsBlinking(false);
        const nextBlink = Math.random() * 5000 + 3000;
        timeoutId = setTimeout(triggerBlink, nextBlink);
      }, 150);
    };

    const startDelay = Math.random() * 5000 + 3000;
    timeoutId = setTimeout(triggerBlink, startDelay);

    return () => clearTimeout(timeoutId);
  }, [blinkingEnabled]);

  /**
   * Gaze tracking: mousemove is merged into requestAnimationFrame,
   * small movements do not trigger setState
   */
  useEffect(() => {
    if (!gazeTrackingEnabled) return;

    const flushLookAt = () => {
      rafRef.current = null;
      const { x: tx, y: ty } = pendingLookRef.current;
      lookAtRef.current = { x: tx, y: ty };
      setLookAt((prev) => {
        if (Math.abs(prev.x - tx) < 0.35 && Math.abs(prev.y - ty) < 0.35) {
          return prev;
        }
        return { x: tx, y: ty };
      });
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const dx = e.clientX - centerX;
      const dy = e.clientY - centerY;

      const dampening = 0.03;
      const maxOffset = 12;

      let moveX = dx * dampening;
      let moveY = dy * dampening;

      moveX = Math.max(Math.min(moveX, maxOffset), -maxOffset);
      moveY = Math.max(Math.min(moveY, maxOffset), -maxOffset);

      pendingLookRef.current = { x: moveX, y: moveY };
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(flushLookAt);
      }
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [gazeTrackingEnabled]);

  /**
   * When gaze tracking is disabled, reset facial feature offsets
   * to avoid them staying at an offset position after hover ends.
   */
  useEffect(() => {
    if (gazeTrackingEnabled) return;
    pendingLookRef.current = { x: 0, y: 0 };
    lookAtRef.current = { x: 0, y: 0 };
    setLookAt({ x: 0, y: 0 });
  }, [gazeTrackingEnabled]);

  /**
   * Download avatar as PNG image (draw gradient and facial features within shape clip)
   */
  const handleDownload = useCallback(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { x: lx, y: ly } = lookAtRef.current;

    ctx.fillStyle = "#F8FAFC";
    ctx.fillRect(0, 0, 1024, 1024);

    const shapePreset = getAvatarShapePreset(
      isCustomImageMode ? "circle" : config.shapeId,
    );
    const [g1, g2, g3] = getPresetGradientHex(config.colorPresetId);
    const pathScale = getAvatarShapePathScale(shapePreset);

    ctx.save();
    ctx.scale(EXPORT_SCALE, EXPORT_SCALE);

    if (pathScale !== 1) {
      ctx.scale(pathScale, pathScale);
    }
    ctx.clip(new Path2D(shapePreset.path));
    if (pathScale !== 1) {
      ctx.scale(1 / pathScale, 1 / pathScale);
    }

    if (config.customTextureUrl) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = config.customTextureUrl;
      try {
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("texture load failed"));
        });
        ctx.drawImage(img, 0, 0, 100, 100);
      } catch {
        const lg = ctx.createLinearGradient(0, 0, 100, 100);
        lg.addColorStop(0, g1);
        lg.addColorStop(0.5, g2);
        lg.addColorStop(1, g3);
        ctx.fillStyle = lg;
        ctx.fillRect(0, 0, 100, 100);
      }
    } else {
      const lg = ctx.createLinearGradient(0, 0, 100, 100);
      lg.addColorStop(0, g1);
      lg.addColorStop(0.5, g2);
      lg.addColorStop(1, g3);
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, 100, 100);
    }

    ctx.restore();

    if (config.showBorder) {
      ctx.save();
      ctx.scale(EXPORT_SCALE, EXPORT_SCALE);
      if (pathScale !== 1) {
        ctx.scale(pathScale, pathScale);
      }
      ctx.strokeStyle = "#E2E8F0";
      ctx.lineWidth = 1.2;
      ctx.stroke(new Path2D(shapePreset.path));
      ctx.restore();
    }

    ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
    ctx.lineWidth = 1.37;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(255, 255, 255, 0.45)";
    ctx.shadowBlur = 6;

    const NOSE_FACTOR = 1.4;
    const EYES_FACTOR = 1.0;
    const MOUTH_FACTOR = 0.6;

    /**
     * Draw facial features
     */
    const drawFeature = (pathData: string, factor: number) => {
      ctx.save();
      const offsetX = lx * 2 * factor;
      const offsetY = ly * 2 * factor;

      ctx.translate(offsetX, offsetY);
      ctx.scale(EXPORT_SCALE, EXPORT_SCALE);

      const p = new Path2D(pathData);
      ctx.stroke(p);
      ctx.restore();
    };

    if (!isCustomImageMode) {
      drawFeature(eyebrows.path, EYES_FACTOR);
      drawFeature(eyes.path, EYES_FACTOR);
      drawFeature(nose.path, NOSE_FACTOR);
      drawFeature(mouth.path, MOUTH_FACTOR);
    }

    const link = document.createElement("a");
    link.download = "openloomi-avatar.png";
    link.href = canvas.toDataURL();
    link.click();
  }, [
    config,
    eyebrows.path,
    eyes.path,
    nose.path,
    mouth.path,
    isCustomImageMode,
  ]);

  useEffect(() => {
    if (onDownloadRef) {
      onDownloadRef(handleDownload);
    }
  }, [onDownloadRef, handleDownload]);

  return (
    <div
      ref={containerRef}
      className={`relative flex items-center justify-center select-none ${className || "size-[120px]"}`}
    >
      {/* Background within shape: SVG clip + light gradient / texture */}
      <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"
          className={
            backgroundScaleClassName ?? "h-[75%] w-[75%] overflow-visible"
          }
          aria-hidden
        >
          <defs>
            <clipPath
              id={svgClipId}
              clipPathUnits="userSpaceOnUse"
              suppressHydrationWarning
            >
              <AvatarShapePathInHundred shape={shape} />
            </clipPath>
            <linearGradient
              id={gradientId}
              gradientUnits="userSpaceOnUse"
              suppressHydrationWarning
              x1="0"
              y1="0"
              x2="100"
              y2="100"
            >
              <stop offset="0%" stopColor={c1} />
              <stop offset="50%" stopColor={c2} />
              <stop offset="100%" stopColor={c3} />
              {!reduceMotion && (
                <animateTransform
                  attributeName="gradientTransform"
                  type="rotate"
                  from="0 50 50"
                  to="360 50 50"
                  dur="24s"
                  repeatCount="indefinite"
                />
              )}
            </linearGradient>
          </defs>
          <g clipPath={`url(#${svgClipId})`} suppressHydrationWarning>
            {config.customTextureUrl ? (
              <image
                href={config.customTextureUrl}
                x="0"
                y="0"
                width="100"
                height="100"
                preserveAspectRatio="xMidYMid slice"
              />
            ) : (
              <>
                <rect width="100" height="100" fill={`url(#${gradientId})`} />
                {!reduceMotion && (
                  <rect width="100" height="100" fill={c2} opacity={0.22}>
                    <animate
                      attributeName="opacity"
                      values="0.12;0.28;0.12"
                      dur="5s"
                      repeatCount="indefinite"
                    />
                  </rect>
                )}
              </>
            )}
          </g>
          {config.showBorder && (
            <AvatarShapePathInHundred
              shape={shape}
              fill="none"
              stroke="rgba(255,255,255,0.55)"
              strokeWidth="2.5"
              className="drop-shadow-[0_2px_8px_rgba(31,38,135,0.12)]"
            />
          )}
        </svg>
      </div>

      {!isCustomImageMode && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <svg
            viewBox="0 0 100 100"
            className={
              featureScaleClassName ??
              "h-[60%] w-[60%] [filter:drop-shadow(0_0_4px_rgba(255,255,255,0.55))]"
            }
          >
            <g
              stroke="rgba(255, 255, 255, 0.65)"
              fill="none"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <g
                style={{
                  transform: `translate(${lookAt.x * 0.6}px, ${lookAt.y * 0.6}px)`,
                  transition: "transform 0.15s ease-out",
                }}
              >
                <path
                  d={mouth.path}
                  className="transition-all duration-300 ease-out"
                />
              </g>

              <g
                style={{
                  transform: `translate(${lookAt.x * 1.0}px, ${lookAt.y * 1.0}px)`,
                  transition: "transform 0.15s ease-out",
                }}
              >
                <path
                  d={eyebrows.path}
                  className="transition-all duration-300 ease-out"
                />

                <g
                  style={{
                    transformOrigin: "50px 50px",
                    transform: isBlinking ? "scaleY(0.1)" : "scaleY(1)",
                    transition: "transform 0.1s ease-in-out",
                  }}
                >
                  <path
                    d={eyes.path}
                    className="transition-all duration-300 ease-out"
                  />
                </g>
              </g>

              <g
                style={{
                  transform: `translate(${lookAt.x * 1.4}px, ${lookAt.y * 1.4}px)`,
                  transition: "transform 0.15s ease-out",
                }}
              >
                <path
                  d={nose.path}
                  className="transition-all duration-300 ease-out"
                />
              </g>
            </g>
          </svg>
        </div>
      )}
    </div>
  );
}
