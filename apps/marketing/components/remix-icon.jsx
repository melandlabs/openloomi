"use client";

import "remixicon/fonts/remixicon.css";

/**
 * Remix Icon component (simplified for marketing)
 * Maps kebab-case name to Remix class names, e.g. chevron_down -> ri-chevron-down-line
 */
export function RemixIcon({
  name,
  className = "",
  size = "size-5",
  variant = "line",
  style = {},
}) {
  const normalizedName = name.replace(/_/g, "-");
  const remixClass =
    variant === "none"
      ? `ri-${normalizedName}`
      : `ri-${normalizedName}-${variant}`;
  return (
    <i
      className={`${remixClass} ${size} inline-flex items-center justify-center shrink-0 ${className}`}
      style={style}
    />
  );
}
