"use client";

/**
 * Memory / insight / project / person chips — small visual atoms used on the
 * Loop detail sidebar to surface the bits of context the enrich stage
 * attached to a decision.
 *
 * Falls back gracefully when nothing is set. Each chip type gets a stable
 * icon so the sidebar reads at a glance.
 */

import { useTranslation } from "react-i18next";

import { RemixIcon } from "@/components/remix-icon";

interface MemoryChipsProps {
  memoryRefs?: string[];
  insightRefs?: string[];
  projectRef?: string | null;
  person?: string | null;
  className?: string;
}

function Chip({
  icon,
  label,
  tone,
}: {
  icon: string;
  label: string;
  tone?: "default" | "muted" | "primary";
}) {
  const toneClass =
    tone === "primary"
      ? "border-primary/30 bg-primary/5 text-primary"
      : tone === "muted"
        ? "border-border bg-muted text-muted-foreground"
        : "border-border bg-card text-foreground";
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${toneClass}`}
    >
      <RemixIcon name={icon} className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

export function MemoryChips({
  memoryRefs,
  insightRefs,
  projectRef,
  person,
  className,
}: MemoryChipsProps) {
  const { t } = useTranslation();

  const mem = (memoryRefs ?? []).filter(Boolean);
  const insights = (insightRefs ?? []).filter(Boolean);
  const hasAny =
    mem.length > 0 || insights.length > 0 || !!projectRef || !!person;

  if (!hasAny) {
    return (
      <div className={`text-xs text-muted-foreground ${className ?? ""}`}>
        {t("loop.detail.noContextChips", "No linked memory or contacts.")}
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap gap-1.5 ${className ?? ""}`}>
      {person && <Chip icon="ri-user-line" label={person} tone="primary" />}
      {projectRef && (
        <Chip icon="ri-folder-line" label={projectRef} tone="muted" />
      )}
      {mem.map((m) => (
        <Chip key={m} icon="ri-brain-line" label={m} tone="muted" />
      ))}
      {insights.map((m) => (
        <Chip key={m} icon="ri-sparkling-2-line" label={m} tone="muted" />
      ))}
    </div>
  );
}
