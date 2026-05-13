"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type SpinnerProps = {
  size?: number;
  label?: string;
  className?: string;
};

export function Spinner({
  size = 28,
  label = "openloomi is getting things ready",
  className,
}: SpinnerProps) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("inline-flex items-center justify-center", className)}
    >
      <Image
        src="/images/logo_web.png"
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        className={cn(
          "pointer-events-none select-none",
          !prefersReducedMotion && "motion-safe:animate-spin",
        )}
        style={prefersReducedMotion ? undefined : { animationDuration: "1.8s" }}
      />
      <span className="sr-only">{label}</span>
    </div>
  );
}
