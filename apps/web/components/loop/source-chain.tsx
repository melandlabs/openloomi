"use client";

/**
 * Loop source chain — a horizontal "signal → context → memory" visualization
 * that the enrich stage produced. Each node carries a RemixIcon, label, and
 * optional sublabel. The connecting arrow visually communicates that the
 * decision was derived from this sequence.
 */

import { RemixIcon } from "@/components/remix-icon";
import { cn } from "@/lib/utils";

export interface SourceChainNode {
  icon: string;
  label: string;
  sublabel?: string;
  tone?: "default" | "muted" | "primary";
}

interface LoopSourceChainProps {
  nodes: SourceChainNode[];
  className?: string;
}

function nodeToneClass(tone: SourceChainNode["tone"]): string {
  switch (tone) {
    case "muted":
      return "bg-muted text-muted-foreground border-border";
    case "primary":
      return "bg-primary/10 text-primary border-primary/30";
    default:
      return "bg-card text-foreground border-border";
  }
}

export function LoopSourceChain({ nodes, className }: LoopSourceChainProps) {
  if (nodes.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        No source context captured.
      </div>
    );
  }

  return (
    <ol
      className={cn("flex flex-wrap items-center gap-1.5 text-xs", className)}
    >
      {nodes.map((n, i) => (
        <li key={`${n.icon}:${n.label}`} className="flex items-center gap-1.5">
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1",
              nodeToneClass(n.tone),
            )}
          >
            <RemixIcon name={n.icon} className="size-3.5 shrink-0" />
            <span className="max-w-[180px] truncate font-medium">
              {n.label}
            </span>
            {n.sublabel && (
              <span className="text-[10px] text-muted-foreground">
                · {n.sublabel}
              </span>
            )}
          </div>
          {i < nodes.length - 1 && (
            <RemixIcon
              name="ri-arrow-right-line"
              className="size-3 text-muted-foreground"
            />
          )}
        </li>
      ))}
    </ol>
  );
}
