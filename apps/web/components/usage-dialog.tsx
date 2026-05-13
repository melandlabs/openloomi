"use client";

import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@openloomi/ui";
import { useDailyUsage } from "@/hooks/use-daily-usage";
import { useBillingLedger } from "@/hooks/use-billing-ledger";
import { cn } from "@/lib/utils";

function ChartLoadingPlaceholder() {
  return (
    <div className="h-[280px] flex items-center justify-center">
      <p className="text-muted-foreground text-sm">Loading...</p>
    </div>
  );
}

const UsageChart = lazy(() =>
  import("@/components/usage-chart").then((m) => ({ default: m.UsageChart })),
);

type DayRange = 7 | 30 | 90;

function StatCard({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div
      className={cn(
        "flex-1 min-w-0 rounded-lg border border-border bg-card px-4 py-3",
      )}
    >
      <p className="text-sm text-foreground mb-0.5">{label}</p>
      <p
        className={cn(
          "text-2xl font-bold font-serif text-foreground",
          valueClassName,
        )}
      >
        {value}
      </p>
    </div>
  );
}

type TabType = "trend" | "ledger";

function BillingLedgerTab() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useBillingLedger({
    limit: 50,
    source: "purchase,subscription",
  });

  if (isLoading) {
    return (
      <div className="h-64 flex items-center justify-center">
        <p className="text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-64 flex items-center justify-center">
        <p className="text-destructive">
          {t("common.error")}: {error.message}
        </p>
      </div>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center">
        <p className="text-muted-foreground">{t("common.noMoreData")}</p>
      </div>
    );
  }

  const chargeItems = data.items.filter(
    (item) => item.source === "purchase" || item.source === "subscription",
  );

  if (chargeItems.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center">
        <p className="text-muted-foreground">{t("common.noMoreData")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-80 overflow-y-auto">
      {chargeItems.map((item) => {
        const date = new Date(item.createdAt);
        const dateStr = date.toLocaleDateString();
        const timeStr = date.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });

        return (
          <div
            key={item.id}
            className="flex items-center justify-between p-3 rounded-lg border border-border bg-card"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">
                {item.description}
              </span>
              <span className="text-xs text-muted-foreground">
                {dateStr} {timeStr}
              </span>
            </div>
            {item.amount !== undefined && (
              <span className="text-sm font-semibold text-foreground">
                {item.currency?.toUpperCase() ?? "USD"} {item.amount.toFixed(2)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface UsageContentCardProps {
  className?: string;
}

/**
 * Shared usage content card that can be rendered inline or inside dialog.
 */
export function UsageContentCard({ className }: UsageContentCardProps) {
  const { t } = useTranslation();
  const [days, setDays] = useState<DayRange>(7);
  const [activeTab, setActiveTab] = useState<TabType>("trend");
  const { data, isLoading, error } = useDailyUsage(days);

  const dayOptions: { label: string; value: DayRange }[] = [
    { label: t("usage.last7Days"), value: 7 },
    { label: t("usage.last30Days"), value: 30 },
    { label: t("usage.last90Days"), value: 90 },
  ];

  return (
    <div
      className={cn("rounded-lg border border-border bg-card p-4", className)}
    >
      <div className="mb-4">
        <h3 className="text-base font-semibold text-foreground">
          {t("usage.pageTitle")}
        </h3>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard
          label={t("usage.totalConsumed")}
          value={data ? data.totalConsumed.toLocaleString() : "—"}
        />
        <StatCard
          label={t("usage.totalRecharged")}
          value={data ? data.totalRecharged.toLocaleString() : "—"}
        />
      </div>

      {/* Tabs */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1 border-b border-border">
            <button
              type="button"
              onClick={() => setActiveTab("trend")}
              className={cn(
                "px-3 py-1.5 text-sm font-medium transition-colors border-b-2 -mb-px",
                activeTab === "trend"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t("usage.usageTrend")}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("ledger")}
              className={cn(
                "px-3 py-1.5 text-sm font-medium transition-colors border-b-2 -mb-px",
                activeTab === "ledger"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t("usage.billingLedger")}
            </button>
          </div>
          {activeTab === "trend" && (
            <div className="flex items-center gap-1">
              {dayOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDays(opt.value)}
                  className={cn(
                    "px-3 py-1 text-sm rounded-md transition-colors",
                    days === opt.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {activeTab === "trend" && (
          <>
            {isLoading && (
              <div className="h-64 flex items-center justify-center">
                <p className="text-muted-foreground">{t("common.loading")}</p>
              </div>
            )}
            {error && (
              <div className="h-64 flex items-center justify-center">
                <p className="text-destructive">
                  {t("common.error")}: {error.message}
                </p>
              </div>
            )}
            {!isLoading && !error && (
              <Suspense fallback={<ChartLoadingPlaceholder />}>
                <UsageChart data={data?.dailyUsage ?? []} />
              </Suspense>
            )}
          </>
        )}

        {activeTab === "ledger" && <BillingLedgerTab />}
      </div>
    </div>
  );
}

interface UsageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UsageDialog({ open, onOpenChange }: UsageDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("usage.pageTitle")}</DialogTitle>
        </DialogHeader>
        <UsageContentCard className="border-0 p-0 rounded-none" />
      </DialogContent>
    </Dialog>
  );
}
