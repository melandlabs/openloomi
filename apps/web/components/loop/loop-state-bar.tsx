"use client";

/**
 * Loop state bar — top toolbar shown above the decision feed. Surfaces the
 * three things the user cares about at a glance:
 *
 *  - Loop enabled toggle (mirrors the preferences PUT)
 *  - Connector pills (Gmail / Calendar / GitHub / Slack / Linear) — green
 *    when the integrationAccounts probe sees at least one account, gray
 *    otherwise. Click refreshes the cache.
 *  - "Tick now" button — POSTs /api/loop/tick with the active user so the
 *    dashboard updates without waiting for the cron.
 *  - Last-tick stamp from /api/loop/state.
 *
 * The component owns its own loading state but delegates the data fetch to
 * the parent via the `onTick` callback so the parent can re-pull decisions.
 */

import { useEffect, useState, useTransition } from "react";
import { useTranslation } from "react-i18next";

import { Badge, Button, Switch } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { Spinner } from "@/components/spinner";
import { toast } from "@/components/toast";

import { cn } from "@/lib/utils";

export interface LoopStateBarConnector {
  id: string;
  label: string;
  connected: boolean;
  accountCount: number;
  /**
   * Provenance flag. `true` = row came from a real agent probe; `false`
   * (or absent for compat) = row is the FALLBACK sentinel from a fresh
   * install. The pill row uses this to render a neutral "Pending
   * probe" pill instead of a misleading grey "offline" pill.
   */
  probed?: boolean;
}

export interface LoopStateBarData {
  enabled: boolean;
  lastTickAt?: string;
  connectors: LoopStateBarConnector[];
  counts: { pending: number; done: number; dismissed: number };
}

interface LoopStateBarProps {
  initial: LoopStateBarData;
  onTick?: () => void;
  className?: string;
}

export function LoopStateBar({
  initial,
  onTick,
  className,
}: LoopStateBarProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<LoopStateBarData>(initial);
  const [pending, startTransition] = useTransition();
  const [tickPending, setTickPending] = useState(false);

  // Sync from parent when initial changes (e.g. after parent re-fetches).
  useEffect(() => {
    setData(initial);
  }, [initial]);

  const toggleEnabled = (next: boolean) => {
    setData((d) => ({ ...d, enabled: next }));
    startTransition(async () => {
      try {
        const res = await fetch("/api/loop/preferences", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: next }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        toast({
          type: "success",
          description: next
            ? t("loop.enabled", "Loop is on")
            : t("loop.disabled", "Loop is paused"),
        });
      } catch (e) {
        setData((d) => ({ ...d, enabled: !next }));
        toast({
          type: "error",
          description: t("loop.toggleFailed", "Failed to update: {{msg}}", {
            msg: e instanceof Error ? e.message : "unknown",
          }),
        });
      }
    });
  };

  const runTick = async () => {
    setTickPending(true);
    try {
      const res = await fetch("/api/loop/tick", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      toast({
        type: "success",
        description: t("loop.tickDone", "Tick done · surfaced {{n}}", {
          n: data?.surfaced ?? 0,
        }),
      });
      onTick?.();
    } catch (e) {
      toast({
        type: "error",
        description: t("loop.tickFailed", "Tick failed: {{msg}}", {
          msg: e instanceof Error ? e.message : "unknown",
        }),
      });
    } finally {
      setTickPending(false);
    }
  };

  const refreshConnectors = async () => {
    try {
      const res = await fetch("/api/loop/connectors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { items: LoopStateBarConnector[] };
      setData((d) => ({ ...d, connectors: json.items }));
      toast({
        type: "success",
        description: t("loop.connectorsRefreshed", "Connectors refreshed"),
      });
    } catch (e) {
      toast({
        type: "error",
        description: t("loop.refreshFailed", "Refresh failed: {{msg}}", {
          msg: e instanceof Error ? e.message : "unknown",
        }),
      });
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Switch
            checked={data.enabled}
            onCheckedChange={toggleEnabled}
            disabled={pending}
            aria-label={t("loop.enable", "Enable Loop")}
          />
          <span className="text-sm font-medium">
            {data.enabled
              ? t("loop.label.on", "Loop is on")
              : t("loop.label.off", "Loop is paused")}
          </span>
        </div>

        <div className="ml-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant="outline" className="gap-1">
            <RemixIcon name="ri-time-line" className="size-3" />
            {data.counts.pending} pending
          </Badge>
          <Badge variant="outline" className="gap-1">
            <RemixIcon name="ri-check-line" className="size-3" />
            {data.counts.done}
          </Badge>
          <Badge variant="outline" className="gap-1">
            <RemixIcon name="ri-eye-off-line" className="size-3" />
            {data.counts.dismissed}
          </Badge>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {data.lastTickAt && (
            <span className="text-xs text-muted-foreground">
              {t("loop.lastTick", "Last tick {{ts}}", {
                ts: new Date(data.lastTickAt).toLocaleTimeString(),
              })}
            </span>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={runTick}
            disabled={tickPending || !data.enabled}
            className="gap-1.5"
          >
            {tickPending ? (
              <Spinner size={14} label="" className="!size-3.5" />
            ) : (
              <RemixIcon name="ri-refresh-line" className="size-3.5" />
            )}
            {t("loop.tickNow", "Tick now")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("loop.connectors", "Connectors")}
        </span>
        {data.connectors.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            {t("loop.connectorsLoading", "Loading…")}
          </span>
        ) : (
          data.connectors.map((c) => {
            // Three-way pill: probed + connected (green), probed +
            // disconnected (grey), or unprobed sentinel (dashed
            // neutral). The third branch is the one this component
            // historically hid — cold-cache opens rendered the
            // disconnected branch, which lied about reality.
            const isUnknown = c.probed !== true;
            return (
              <span
                key={c.id}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                  isUnknown
                    ? "border-dashed border-border bg-muted/40 text-muted-foreground"
                    : c.connected
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                      : "border-border bg-muted text-muted-foreground",
                )}
                title={
                  isUnknown
                    ? "No probe yet — first tick / refresh will resolve this"
                    : undefined
                }
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    isUnknown
                      ? "bg-muted-foreground/40"
                      : c.connected
                        ? "bg-emerald-500"
                        : "bg-muted-foreground/40",
                  )}
                />
                {c.label}
                {isUnknown ? (
                  <span className="ml-0.5 text-[10px] italic">
                    Pending probe
                  </span>
                ) : c.connected && c.accountCount > 1 ? (
                  <span className="ml-0.5 text-[10px]">×{c.accountCount}</span>
                ) : null}
              </span>
            );
          })
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={refreshConnectors}
          className="ml-auto"
        >
          <RemixIcon name="ri-refresh-line" className="mr-1 size-3" />
          {t("loop.refresh", "Refresh")}
        </Button>
      </div>
    </div>
  );
}
