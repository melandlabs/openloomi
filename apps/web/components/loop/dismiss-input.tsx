"use client";

/**
 * Dismiss-with-reason input — surfaces a reason textbox next to a primary
 * "Dismiss" button. Used inline in the action footer of the Loop detail
 * workspace. The reason is passed through to the action API as `reason` and
 * stored on `decision.result`.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Input } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { Spinner } from "@/components/spinner";
import { toast } from "@/components/toast";

interface DismissInputProps {
  decisionId: string;
  onDismissed?: () => void;
  className?: string;
}

export function DismissInput({
  decisionId,
  onDismissed,
  className,
}: DismissInputProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    try {
      const res = await fetch(`/api/loop/decision/${decisionId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "dismiss",
          reason: reason.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast({
          type: "error",
          description: t(
            "loop.detail.dismissFailed",
            "Dismiss failed: {{msg}}",
            {
              msg: data?.error ?? res.statusText,
            },
          ),
        });
        return;
      }
      toast({
        type: "success",
        description: t("loop.detail.dismissedToast", "Dismissed"),
      });
      setOpen(false);
      setReason("");
      onDismissed?.();
    } catch (e) {
      toast({
        type: "error",
        description: t("loop.detail.dismissFailed", "Dismiss failed: {{msg}}", {
          msg: e instanceof Error ? e.message : "unknown",
        }),
      });
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        className={className}
      >
        <RemixIcon name="ri-eye-off-line" className="mr-1 size-3.5" />
        {t("loop.detail.dismissButton", "Dismiss")}
      </Button>
    );
  }

  return (
    <div
      className={`flex w-full flex-col gap-2 rounded-md border bg-muted/30 p-3 ${className ?? ""}`}
    >
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <RemixIcon name="ri-eye-off-line" className="size-3.5" />
        {t(
          "loop.detail.dismissReasonLabel",
          "Why dismiss? (optional, helps Loop learn)",
        )}
      </div>
      <Input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t(
          "loop.detail.dismissPlaceholder",
          "e.g. already handled via Slack",
        )}
        disabled={pending}
        className="h-8 text-xs"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
          if (e.key === "Escape") {
            setOpen(false);
            setReason("");
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setReason("");
          }}
          disabled={pending}
        >
          {t("loop.detail.cancel", "Cancel")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={submit}
          disabled={pending}
          className="ml-auto gap-1.5"
        >
          {pending ? (
            <Spinner size={14} label="" className="!size-3.5" />
          ) : (
            <RemixIcon name="ri-check-line" className="size-3.5" />
          )}
          {t("loop.detail.confirmDismiss", "Confirm dismiss")}
        </Button>
      </div>
    </div>
  );
}
