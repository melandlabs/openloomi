"use client";

/**
 * Loop decision detail route — opened from a card's "View details" / "Edit"
 * buttons. Renders the rich workspace (header + dialogue + action block +
 * sidebar) so the user can resolve a decision without bouncing back to the
 * list.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { Button, PageSectionHeader } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { Spinner } from "@/components/spinner";

import { LoopDetailWorkspace } from "@/components/loop/loop-detail-workspace";
import type { LoopDecisionCardData } from "@/components/loop/decision-card";

export default function LoopDecisionDetailPage() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  const [decision, setDecision] = useState<LoopDecisionCardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      // Prefer /api/loop/card/[id] — it returns the richer card payload
      // (why / dialogue / nextStep / source_chain). Fall back to
      // /api/loop/decision/[id] if the card endpoint rejects (older builds).
      const res = await fetch(`/api/loop/card/${id}`, { cache: "no-store" });
      if (!res.ok) {
        const fallback = await fetch(`/api/loop/decision/${id}`, {
          cache: "no-store",
        });
        if (!fallback.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await fallback.json()) as {
          decision: LoopDecisionCardData;
        };
        setDecision(json.decision);
      } else {
        const json = (await res.json()) as LoopDecisionCardData;
        setDecision(json);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageSectionHeader title={t("loop.detailTitle", "Decision")}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => router.push("/loop")}
          className="gap-1.5"
        >
          <RemixIcon name="ri-arrow-left-line" className="size-3.5" />
          {t("loop.backToList", "Back to loop")}
        </Button>
      </PageSectionHeader>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {loading && !decision && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Spinner size={28} label={t("loop.loading", "Loading Loop…")} />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <RemixIcon name="ri-error-warning-line" className="size-4" />
            {t("loop.loadError", "Couldn't load: {{msg}}", { msg: error })}
          </div>
        )}

        {decision && (
          <LoopDetailWorkspace decision={decision} onRefresh={reload} />
        )}
      </div>
    </div>
  );
}
