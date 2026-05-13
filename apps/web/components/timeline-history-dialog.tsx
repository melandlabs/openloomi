"use client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@openloomi/ui";
import { Spinner } from "@/components/spinner";
import type { InsightTimelineHistory } from "@/lib/db/schema";
import { format } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import { RemixIcon } from "@/components/remix-icon";
import { cn } from "@/lib/utils";

interface TimelineHistoryDialogProps {
  open: boolean;
  onClose: () => void;
  eventId: string;
  eventName: string;
  history: InsightTimelineHistory[];
  isLoading?: boolean;
}

export function TimelineHistoryDialog({
  open,
  onClose,
  eventId,
  eventName,
  history,
  isLoading = false,
}: TimelineHistoryDialogProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.includes("zh") ? "zh" : "en";
  const dateLocale = locale === "zh" ? zhCN : enUS;

  const getChangeTypeLabel = (changeType: string) => {
    return t(`insightDetail.timelineHistory.historyDialog.${changeType}`);
  };

  const getChangeTypeColor = (changeType: string) => {
    return (
      {
        created: "bg-green-100 text-green-700",
        updated: "bg-gray-100 text-gray-700",
        merged: "bg-purple-100 text-purple-700",
      }[changeType] || "bg-gray-100 text-gray-700"
    );
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="truncate flex-1">
              {t("insightDetail.timelineHistory.historyDialog.title")}:{" "}
              {eventName}
            </span>
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center items-center py-12">
            <Spinner size={24} />
            <span className="ml-3 text-muted-foreground">
              {t("insightDetail.timelineHistory.loading")}
            </span>
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <RemixIcon
              name="error_warning"
              size="size-12"
              className="mx-auto mb-4 opacity-50"
            />
            <p>{t("insightDetail.timelineHistory.noHistory")}</p>
          </div>
        ) : (
          <div className="space-y-6 mt-4">
            {history.map((record, index) => {
              // Extract values with explicit typing to avoid TypeScript inference issues
              const changeReason = record.changeReason as string | undefined;
              const changeType = record.changeType as string;
              const version = record.version as number;
              const previousSnapshot = record.previousSnapshot as Record<
                string,
                unknown
              > | null;
              const eventTime = record.eventTime as string | undefined;
              const summary = record.summary as string;
              const label = record.label as string;
              const diffSummary = record.diffSummary as string | undefined;

              return (
                <div key={record.id} className="relative">
                  {/* Version badge and metadata */}
                  <div className="flex items-center gap-2 mb-3">
                    <span className="px-2.5 py-1 bg-primary/10 text-primary rounded text-xs font-semibold">
                      v{version}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {format(new Date(record.createdAt), "PPpp", {
                        locale: dateLocale,
                      })}
                    </span>
                    <span
                      className={cn(
                        "px-2 py-1 rounded text-xs font-medium",
                        getChangeTypeColor(changeType),
                      )}
                    >
                      {getChangeTypeLabel(changeType)}
                    </span>
                  </div>

                  {/* Change reason */}
                  {changeReason && (
                    <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-sm text-amber-900">
                        <span className="font-semibold">
                          {t("insightDetail.timelineHistory.whyChanged")}
                        </span>{" "}
                        {changeReason}
                      </p>
                    </div>
                  )}

                  {/* Diff viewer */}
                  {previousSnapshot && (
                    <TimelineDiffViewer
                      before={previousSnapshot}
                      after={{
                        time: eventTime ? Number(eventTime) : undefined,
                        summary: summary,
                        label: label,
                      }}
                      diffSummary={diffSummary}
                      locale={locale}
                    />
                  )}

                  {/* Divider */}
                  {index < history.length - 1 && (
                    <div className="my-6 border-t border-border" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface TimelineDiffViewerProps {
  before: {
    time?: number | null;
    summary?: string;
    label?: string;
  };
  after: {
    time?: number | null;
    summary?: string;
    label?: string;
  };
  diffSummary?: string | null;
  locale: "en" | "zh";
}

function TimelineDiffViewer({
  before,
  after,
  diffSummary,
  locale,
}: TimelineDiffViewerProps) {
  const { t } = useTranslation();
  const changes = computeChanges(before, after);

  return (
    <div className="space-y-3 bg-gray-50 rounded-lg p-4">
      {/* Diff summary */}
      {diffSummary && (
        <div className="text-sm text-gray-600 italic">
          {t("insightDetail.timelineHistory.changes")} {diffSummary}
        </div>
      )}

      {/* Summary change */}
      {changes.summary && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground font-medium">
            {t("insightDetail.timelineHistory.summary")}
          </div>
          {before.summary && (
            <div className="p-2 bg-red-50 text-red-700 rounded text-sm line-through">
              {before.summary}
            </div>
          )}
          {after.summary && (
            <div className="p-2 bg-green-50 text-green-700 rounded text-sm">
              {after.summary}
            </div>
          )}
        </div>
      )}

      {/* Time change */}
      {changes.time && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground min-w-[60px]">
            {t("insightDetail.timelineHistory.time")}
          </span>
          {before.time && (
            <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs line-through">
              {format(new Date(before.time), "PPpp", {
                locale: locale === "zh" ? zhCN : enUS,
              })}
            </span>
          )}
          <RemixIcon
            name="arrow_right"
            size="size-4"
            className="text-muted-foreground"
          />
          {after.time && (
            <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">
              {format(new Date(after.time), "PPpp", {
                locale: locale === "zh" ? zhCN : enUS,
              })}
            </span>
          )}
        </div>
      )}

      {/* Label change */}
      {changes.label && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground min-w-[60px]">
            {t("insightDetail.timelineHistory.source")}
          </span>
          {before.label && (
            <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs line-through">
              {before.label}
            </span>
          )}
          <RemixIcon
            name="arrow_right"
            size="size-4"
            className="text-muted-foreground"
          />
          {after.label && (
            <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">
              {after.label}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function computeChanges(
  before: { time?: number | null; summary?: string; label?: string },
  after: { time?: number | null; summary?: string; label?: string },
) {
  return {
    summary: before.summary !== after.summary,
    time:
      before.time && after.time && Math.abs(before.time - after.time) > 60000, // More than 1 minute
    label: before.label !== after.label,
  };
}
