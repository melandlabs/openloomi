"use client";
import { cn } from "@/lib/utils";
import { RemixIcon } from "@/components/remix-icon";
import IntegrationIcon from "@/components/integration-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@openloomi/ui";

/**
 * Citation Badge component
 * Displays a clickable citation marker in messages, showing platform icon or bookmark icon
 */
export function CitationBadge({
  index,
  onClick,
  className,
  platform,
  tooltip,
}: {
  index: number | string;
  onClick?: () => void;
  className?: string;
  platform?: string | null;
  tooltip?: string;
}) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log("[CitationBadge] Clicked, onClick exists:", !!onClick);
    onClick?.();
  };

  const button = (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "inline-flex items-center justify-center rounded-full border ml-1",
        "h-5 w-5 p-0 flex-shrink-0 cursor-pointer",
        "hover:bg-primary/10 hover:border-primary/50 transition-colors",
        "text-foreground text-xs font-semibold",
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        className,
      )}
      aria-label={`View citation source ${index}`}
    >
      {platform ? (
        <IntegrationIcon platform={platform} size="size-3" />
      ) : (
        <RemixIcon
          name="bookmark"
          size="size-3"
          className="pointer-events-none"
        />
      )}
    </button>
  );

  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    );
  }

  return button;
}
