import React from "react";
import { cn } from "@/lib/utils";

/**
 * plain: Narrative section subtitle (muted, wide letter-spacing).
 * pill: Emphasized capsule label (primary color background + rounded border), used for "01 - The Problem".
 */
const sectionEyebrowVariants = {
  plain: "text-[11px] tracking-[0.12em] uppercase text-foreground-muted mb-4",
  pill: "inline-flex w-fit whitespace-nowrap items-center rounded-full border border-border-primary/50 bg-primary-100 px-3 py-1 text-[11px] tracking-[1px] uppercase text-primary mb-0",
};

/**
 * Marketing page section eyebrow (section number / label), unified plain and pill visual styles.
 *
 * @param {object} props
 * @param {"plain" | "pill"} [props.variant="plain"]
 * @param {string} [props.className] Additional class name
 * @param {React.ReactNode} props.children
 * @param {React.ComponentPropsWithoutRef<"p">} [props.rest]
 */
export function SectionEyebrow({
  variant = "plain",
  className,
  children,
  ...rest
}) {
  return (
    <p className={cn(sectionEyebrowVariants[variant], className)} {...rest}>
      {children}
    </p>
  );
}
