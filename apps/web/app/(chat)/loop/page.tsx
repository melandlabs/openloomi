"use client";

/**
 * Loop dashboard — main entry point for the Loop in the web UI. Polls
 * /api/loop/state every 10 s so the counts / connectors stay current while
 * the user is on the page. Tabs split the decision feed into pending / done
 * / dismissed. Each card is interactive (Dry Run / Edit / Run / Dismiss)
 * with optimistic refresh via re-fetching the list after the action.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge, Tabs, TabsList, TabsTrigger, TabsContent } from "@openloomi/ui";
import { PageSectionHeader } from "@openloomi/ui";

import { RemixIcon } from "@/components/remix-icon";
import { Spinner } from "@/components/spinner";

import {
  DecisionCard,
  type LoopDecisionCardData,
} from "@/components/loop/decision-card";
import { LoopEmptyState } from "@/components/loop/loop-empty-state";
import {
  LoopStateBar,
  type LoopStateBarData,
} from "@/components/loop/loop-state-bar";

import { cn } from "@/lib/utils";

type StatusFilter = "pending" | "done" | "dismissed";

const POLL_INTERVAL_MS = 10_000;

export default function LoopPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<LoopStateBarData | null>(null);
  const [decisions, setDecisions] = useState<LoopDecisionCardData[]>([]);
  const [activeStatus, setActiveStatus] = useState<StatusFilter>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(0);

  const reload = useCallback(async () => {
    const id = ++inflight.current;
    try {
      const [stateRes, listRes] = await Promise.all([
        fetch("/api/loop/state", { cache: "no-store" }),
        fetch("/api/loop/decisions", { cache: "no-store" }),
      ]);
      if (id !== inflight.current) return;
      if (!stateRes.ok) throw new Error(`state ${stateRes.status}`);
      if (!listRes.ok) throw new Error(`decisions ${listRes.status}`);
      const stateJson = (await stateRes.json()) as {
        enabled: boolean;
        lastTickAt?: string;
        counts: { pending: number; done: number; dismissed: number };
        connectors: LoopStateBarData["connectors"];
      };
      const listJson = (await listRes.json()) as {
        items: LoopDecisionCardData[];
      };
      setState({
        enabled: stateJson.enabled,
        lastTickAt: stateJson.lastTickAt,
        counts: stateJson.counts,
        connectors: stateJson.connectors,
      });
      setDecisions(listJson.items);
      setError(null);
    } catch (e) {
      if (id !== inflight.current) return;
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      if (id === inflight.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const handle = setInterval(reload, POLL_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [reload]);

  const filtered = useMemo(
    () => decisions.filter((d) => d.status === activeStatus),
    [decisions, activeStatus],
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageSectionHeader title={t("loop.title", "Loop")} />

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {state && <LoopStateBar initial={state} onTick={() => void reload()} />}

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <RemixIcon name="ri-error-warning-line" className="size-4" />
            {t("loop.loadError", "Couldn't load: {{msg}}", { msg: error })}
          </div>
        )}

        <Tabs
          value={activeStatus}
          onValueChange={(v) => setActiveStatus(v as StatusFilter)}
          className="flex flex-1 flex-col"
        >
          <div className="flex items-center gap-3">
            <TabsList>
              <TabsTrigger value="pending" className="gap-1.5">
                <RemixIcon name="ri-time-line" className="size-3.5" />
                {t("loop.tab.pending", "Pending")}
                {state && (
                  <Badge variant="secondary" className="ml-1">
                    {state.counts.pending}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="done" className="gap-1.5">
                <RemixIcon name="ri-check-double-line" className="size-3.5" />
                {t("loop.tab.done", "Done")}
                {state && (
                  <Badge variant="secondary" className="ml-1">
                    {state.counts.done}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="dismissed" className="gap-1.5">
                <RemixIcon name="ri-eye-off-line" className="size-3.5" />
                {t("loop.tab.dismissed", "Dismissed")}
                {state && (
                  <Badge variant="secondary" className="ml-1">
                    {state.counts.dismissed}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value={activeStatus} className="mt-4 flex-1">
            {loading && decisions.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Spinner size={28} label={t("loop.loading", "Loading Loop…")} />
              </div>
            ) : filtered.length === 0 ? (
              <LoopEmptyState
                icon={
                  activeStatus === "pending"
                    ? "ri-checkbox-circle-line"
                    : activeStatus === "done"
                      ? "ri-check-double-line"
                      : "ri-eye-off-line"
                }
                title={t("loop.empty.title", "Nothing here yet")}
                description={
                  activeStatus === "pending"
                    ? t(
                        "loop.empty.pendingDesc",
                        "Loop hasn't surfaced anything that needs your call. Hit Tick now to pull fresh signals.",
                      )
                    : activeStatus === "done"
                      ? t(
                          "loop.empty.doneDesc",
                          "Approved decisions show up here once the agent finishes.",
                        )
                      : t(
                          "loop.empty.dismissedDesc",
                          "Dismissed decisions live here so you can revisit them later.",
                        )
                }
              />
            ) : (
              <div
                className={cn(
                  "grid gap-4",
                  "grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3",
                )}
              >
                {filtered.map((d) => (
                  <DecisionCard
                    key={d.id}
                    decision={d}
                    onChange={() => void reload()}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
