import { useSWRConfig } from "swr";
import { useCopyToClipboard } from "usehooks-ts";
import { useMemo, useState, useEffect } from "react";

import type { Vote } from "@/lib/db/schema";
import { format } from "date-fns";
import { zhCN, enUS } from "date-fns/locale";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { memo } from "react";
import equal from "fast-deep-equal";
import { toast } from "sonner";
import type { ChatMessage } from "@openloomi/shared";
import { useTranslation } from "react-i18next";
import { useInsightPagination } from "@/hooks/use-insight-data";
import IntegrationIcon from "./integration-icon";
import { RemixIcon } from "@/components/remix-icon";
import { MessageForwardPanel } from "./message-forward-panel";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

/**
 * Extract cited Insight IDs from message text
 */
function extractCitationIds(message: ChatMessage): string[] {
  const textFromParts = message.parts
    ?.filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

  if (!textFromParts) return [];

  const citationRegex = /\^\[([^\]]+)\]\^/g;
  const ids: string[] = [];
  let match: RegExpExecArray | null = citationRegex.exec(textFromParts);

  while (match !== null) {
    const insightId = match[1].toString();
    if (insightId && !ids.includes(insightId)) {
      ids.push(insightId);
    }
    match = citationRegex.exec(textFromParts);
  }

  return ids;
}

/**
 * Platform icon group component
 * Displays the collection of cited Insight source platforms
 */
export function PlatformAvatarGroup({
  platforms,
}: {
  platforms: Array<{ platform: string; label: string }>;
}) {
  if (platforms.length === 0) return null;

  // Limit displayed platforms to max 5
  const displayPlatforms = platforms.slice(0, 5);
  const remainingCount = platforms.length - displayPlatforms.length;

  return (
    <div className="flex items-center -space-x-1">
      {displayPlatforms.map((item, index) => (
        <Tooltip key={`${item.platform}-${index}`}>
          <TooltipTrigger asChild>
            <div
              className="relative flex items-center justify-center rounded-full border border-white bg-white shadow-sm size-4 overflow-hidden"
              style={{
                zIndex: displayPlatforms.length - index,
              }}
            >
              <IntegrationIcon platform={item.platform} />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">{item.label}</p>
          </TooltipContent>
        </Tooltip>
      ))}
      {remainingCount > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="relative flex items-center justify-center rounded-full border border-white bg-white shadow-sm size-4 overflow-hidden text-[9px] font-medium text-muted-foreground"
              style={{
                zIndex: 0,
              }}
            >
              +{remainingCount}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">
              {platforms
                .slice(5)
                .map((p) => p.label)
                .join(", ")}
            </p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

export function PureMessageActions({
  chatId,
  message,
  vote,
  isLoading,
  onSourcesClick,
}: {
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  onSourcesClick?: () => void;
}) {
  const { mutate } = useSWRConfig();
  const [_, copyToClipboard] = useCopyToClipboard();
  const [isForwardMenuOpen, setIsForwardMenuOpen] = useState(false);
  const [isVoting, setIsVoting] = useState(false);
  // Locally maintained vote state
  const [localVote, setLocalVote] = useState<Vote | undefined>(vote);

  // Sync external vote to local state
  useEffect(() => {
    setLocalVote(vote);
  }, [vote]);

  const { t, i18n } = useTranslation();
  const { insightData } = useInsightPagination();

  // Extract message timestamp for inline display
  const messageTimestamp = useMemo(() => {
    const msgAny = message as {
      createdAt?: string | number | Date;
      timestamp?: string | number | Date;
      metadata?: { createdAt?: string | number | Date };
    };
    const raw =
      msgAny.createdAt ?? msgAny.timestamp ?? msgAny.metadata?.createdAt;
    if (raw != null && !Number.isNaN(new Date(raw).getTime())) {
      return new Date(raw);
    }
    return new Date();
  }, [message]);

  // Format message time for inline display
  const formattedMessageTime = useMemo(() => {
    const locale = i18n.language.startsWith("zh") ? zhCN : enUS;
    return format(messageTimestamp, "MMM d, h:mm a", { locale });
  }, [messageTimestamp, i18n.language]);

  /**
   * Extract cited Insight platform info from message
   *
   * Get insights data from tool-result in message.parts
   * These are the insights actually used when AI generates responses
   */
  const citedPlatforms = useMemo(() => {
    const citationIds = extractCitationIds(message);
    if (citationIds.length === 0) return [];

    // Find chatInsights tool result from message.parts
    const chatInsightsPart = message.parts?.find(
      (part) =>
        (part as any).type === "tool-result" &&
        (part as any).toolName === "chatInsights",
    );

    let insights: any[] = [];

    if (chatInsightsPart && (chatInsightsPart as any).result) {
      try {
        const result =
          typeof (chatInsightsPart as any).result === "string"
            ? JSON.parse((chatInsightsPart as any).result)
            : (chatInsightsPart as any).result;
        insights = result?.data?.insights || [];
      } catch (e) {
        console.error(
          "[MessageActions] Failed to parse chatInsights result:",
          e,
        );
      }
    }

    // If no insights in message parts, try current insightData (fallback)
    if (insights.length === 0 && insightData?.items) {
      insights = insightData.items;
    }

    if (insights.length === 0) return [];

    const platformMap = new Map<string, { platform: string; label: string }>();

    for (const insightId of citationIds) {
      const insight = insights.find((i: any) => i.id === insightId);

      if (insight?.platform) {
        const platform = insight.platform.toLowerCase();
        // Normalize platform name
        const normalizedPlatform = platform === "tg" ? "telegram" : platform;
        const label = insight.platform;

        if (!platformMap.has(normalizedPlatform)) {
          platformMap.set(normalizedPlatform, {
            platform: normalizedPlatform,
            label,
          });
        }
      }
    }

    return Array.from(platformMap.values());
  }, [message, insightData.items]);

  /**
   * Check if message has actual content
   * Avoid "message not rendering" issue: empty messages should not show Vote button
   */
  const hasActualContent = (() => {
    if (!message.parts || message.parts.length === 0) return false;

    return message.parts.some((part) => {
      const partType = (part as any).type as string;

      // Text content: check for non-empty text
      if (partType === "text" || partType === "reasoning") {
        const textValue = (part as any).text;
        return typeof textValue === "string" && textValue.trim().length > 0;
      }

      // Other types (files, tool calls, etc.) are considered no content
      if (partType === "file") return false;
      if (partType.startsWith("tool-")) return false;
      if (partType.startsWith("data-")) return false;

      return false;
    });
  })();

  if (isLoading) return <div className="h-7 w-full" />;
  if (message.role === "user") return <div className="h-7 w-full" />;
  if (message.metadata?.disableAction) return <div className="h-7 w-full" />;
  // Only show action buttons when there is actual content
  if (!hasActualContent) return <div className="h-7 w-full" />;

  return (
    <div className="relative flex flex-row gap-2 opacity-0 group-hover/message:opacity-100 transition-opacity">
      <Dialog open={isForwardMenuOpen} onOpenChange={setIsForwardMenuOpen}>
        {/* Forward button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-muted-foreground"
              onClick={() => setIsForwardMenuOpen(true)}
            >
              <RemixIcon name="send_plane" size="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("common.forward", "Forward")}</TooltipContent>
        </Tooltip>

        {/* Forward dialog */}
        <DialogContent className="max-w-3xl p-4" hideCloseButton>
          <DialogTitle className="sr-only">
            {t("message.forward.title", "Forward Message")}
          </DialogTitle>
          <MessageForwardPanel
            message={message}
            onClose={() => setIsForwardMenuOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-muted-foreground"
            onClick={async () => {
              const textFromParts = message.parts
                ?.filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("\n")
                .trim();

              if (!textFromParts) {
                toast.error("There's no text to copy!");
                return;
              }

              await copyToClipboard(textFromParts);
              toast.success("Copied to clipboard!");
            }}
          >
            <RemixIcon name="copy" size="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("common.copy")}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            data-testid="message-upvote"
            variant="ghost"
            size="sm"
            className={`h-7 px-2 text-muted-foreground !pointer-events-auto transition-colors ${
              localVote?.isUpvoted
                ? "text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                : ""
            }`}
            disabled={localVote?.isUpvoted || isVoting}
            onClick={() => {
              if (isVoting) return;
              setIsVoting(true);
              // Immediately update local state
              setLocalVote({ chatId, messageId: message.id, isUpvoted: true });

              mutate<Array<Vote>>(
                `/api/vote?chatId=${chatId}`,
                (currentVotes) => {
                  if (!currentVotes) return [];
                  return [
                    ...currentVotes.filter((v) => v.messageId !== message.id),
                    { chatId, messageId: message.id, isUpvoted: true },
                  ];
                },
                { revalidate: false },
              );

              const upvote = fetch("/api/vote", {
                method: "PATCH",
                body: JSON.stringify({
                  chatId,
                  messageId: message.id,
                  type: "up",
                }),
              });

              toast.promise(upvote, {
                loading: "Upvoting Response...",
                success: () => {
                  setIsVoting(false);
                  return "Upvoted Response!";
                },
                error: () => {
                  setIsVoting(false);
                  setLocalVote(vote); // Restore original state
                  return "Failed to upvote response.";
                },
              });
            }}
          >
            <RemixIcon
              name="thumb_up"
              size="size-4"
              filled={!!localVote?.isUpvoted}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("common.upvoteResponse")}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            data-testid="message-downvote"
            variant="ghost"
            size="sm"
            className={`h-7 px-2 text-muted-foreground !pointer-events-auto transition-colors ${
              localVote && !localVote.isUpvoted
                ? "text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:hover:bg-orange-950/30"
                : ""
            }`}
            disabled={(localVote && !localVote.isUpvoted) || isVoting}
            onClick={() => {
              if (isVoting) return;
              setIsVoting(true);
              // Immediately update local state
              setLocalVote({ chatId, messageId: message.id, isUpvoted: false });

              mutate<Array<Vote>>(
                `/api/vote?chatId=${chatId}`,
                (currentVotes) => {
                  if (!currentVotes) return [];
                  return [
                    ...currentVotes.filter((v) => v.messageId !== message.id),
                    { chatId, messageId: message.id, isUpvoted: false },
                  ];
                },
                { revalidate: false },
              );

              const downvote = fetch("/api/vote", {
                method: "PATCH",
                body: JSON.stringify({
                  chatId,
                  messageId: message.id,
                  type: "down",
                }),
              });

              toast.promise(downvote, {
                loading: "Downvoting Response...",
                success: () => {
                  setIsVoting(false);
                  return "Downvoted Response!";
                },
                error: () => {
                  setIsVoting(false);
                  setLocalVote(vote); // Restore original state
                  return "Failed to downvote response.";
                },
              });
            }}
          >
            <RemixIcon
              name="thumb_down"
              size="size-4"
              filled={localVote !== undefined && !localVote.isUpvoted}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("common.downvoteResponse")}</TooltipContent>
      </Tooltip>

      {/* Source display badge */}
      {citedPlatforms.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="py-1 px-2 h-fit text-muted-foreground"
              variant="outline"
              onClick={onSourcesClick}
            >
              <PlatformAvatarGroup platforms={citedPlatforms} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("common.sources")}</TooltipContent>
        </Tooltip>
      )}
      {/* Time display on the right side for assistant messages */}
      <span className="flex items-center text-xs text-muted-foreground/60 ml-1">
        {formattedMessageTime}
      </span>
    </div>
  );
}

export const MessageActions = memo(
  PureMessageActions,
  (prevProps, nextProps) => {
    if (!equal(prevProps.vote, nextProps.vote)) return false;
    if (prevProps.isLoading !== nextProps.isLoading) return false;
    if (!equal(prevProps.message, nextProps.message)) return false;
    if (prevProps.onSourcesClick !== nextProps.onSourcesClick) return false;

    return true;
  },
);
