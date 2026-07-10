"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RemixIcon } from "@/components/remix-icon";
import { cn } from "@/lib/utils";
import "../i18n";

interface PermissionRequest {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseID: string;
  decisionReason?: string;
  blockedPath?: string;
}

interface PermissionDialogProps {
  request: PermissionRequest;
  onDecision: (decision: {
    behavior: "allow" | "deny";
    updatedInput?: Record<string, unknown>;
  }) => void | Promise<void>;
  onClose?: () => void;
}

export function PermissionDialog({
  request,
  onDecision,
  onClose,
}: PermissionDialogProps) {
  const { t } = useTranslation();
  const [showDetails, setShowDetails] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittedDecision, setSubmittedDecision] = useState<
    "allow" | "deny" | null
  >(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submitDecision = async (behavior: "allow" | "deny") => {
    if (submitting || submittedDecision) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onDecision({ behavior });
      setSubmittedDecision(behavior);
      onClose?.();
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : t("agent.permission.submitError"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const formatToolInput = () => {
    try {
      return JSON.stringify(request.toolInput, null, 2);
    } catch {
      return String(request.toolInput);
    }
  };

  const getToolDisplayName = (toolName: string) => {
    // Use i18n tool names if available
    const toolNames = t("messages.toolNames", {
      returnObjects: true,
    }) as Record<string, string>;
    return toolNames[toolName] || toolName;
  };

  const getRiskLevel = () => {
    // High-risk tools that can modify system or execute commands
    const dangerousTools = ["Bash", "Write", "Edit"];
    if (dangerousTools.includes(request.toolName)) {
      return { level: "high", color: "text-red-600", bg: "bg-red-50" };
    }
    if (request.blockedPath) {
      return { level: "medium", color: "text-amber-600", bg: "bg-amber-50" };
    }
    return { level: "low", color: "text-blue-600", bg: "bg-blue-50" };
  };

  const risk = getRiskLevel();

  if (submittedDecision) {
    return (
      <div className="rounded-xl border border-border bg-card/50 p-3 text-sm text-muted-foreground">
        {t(
          submittedDecision === "allow"
            ? "agent.permission.allowed"
            : "agent.permission.denied",
        )}
      </div>
    );
  }

  return (
    <div className="border-primary/30 bg-accent/30 space-y-4 rounded-xl border p-4">
      <div className="flex items-start gap-3">
        <div className={cn("rounded-full p-2", risk.bg)}>
          <RemixIcon
            name="error_warning"
            size="size-5"
            className={risk.color}
          />
        </div>
        <div className="flex-1">
          <h3 className="text-foreground font-semibold">
            {t("agent.permission.title")}
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("agent.permission.description")}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card/50 px-3 py-2 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-muted-foreground text-xs">
              {t("agent.permission.tool")}{" "}
            </span>
            <span className="bg-primary/10 text-primary shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ml-2">
              {getToolDisplayName(request.toolName)}
            </span>
          </div>
          <span
            className={cn(
              "rounded px-2 py-0.5 text-xs font-medium",
              risk.bg,
              risk.color,
            )}
          >
            {t(`agent.permission.risk.${risk.level}`)}
          </span>
        </div>

        {request.decisionReason && (
          <div className="flex items-start gap-2 text-sm">
            <RemixIcon
              name="info"
              size="size-4"
              className="text-muted-foreground mt-0.5 shrink-0"
            />
            <span className="text-muted-foreground">
              {request.decisionReason}
            </span>
          </div>
        )}

        {request.blockedPath && (
          <div className="text-muted-foreground text-xs">
            {t("agent.permission.blockedPath")}:{" "}
            <code className="bg-background rounded px-1 py-0.5">
              {request.blockedPath}
            </code>
          </div>
        )}

        <details
          open={showDetails}
          onToggle={(e) =>
            setShowDetails((e.target as HTMLDetailsElement).open)
          }
          className="group"
        >
          <summary className="flex items-center gap-1.5 text-muted-foreground cursor-pointer text-xs hover:text-foreground transition-colors select-none">
            <span>
              {showDetails
                ? t("agent.permission.hideDetails")
                : t("agent.permission.showDetails")}
            </span>
            <span className="shrink-0 text-muted-foreground group-hover:text-foreground transition-colors">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={cn(
                  "transition-transform",
                  !showDetails && "-rotate-90",
                )}
                aria-hidden
              >
                <title>{t("agent.permission.showDetails")}</title>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </summary>
          <div className="mt-2">
            <pre className="bg-background text-foreground rounded-md border border-border/70 p-3 text-[11px] overflow-x-auto max-h-48 overflow-y-auto">
              {formatToolInput()}
            </pre>
          </div>
        </details>
      </div>

      <div className="flex justify-end gap-2">
        {submitError && (
          <p className="mr-auto self-center text-xs text-destructive">
            {submitError}
          </p>
        )}
        <button
          type="button"
          disabled={submitting}
          onClick={() => void submitDecision("deny")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            "bg-destructive/10 text-destructive hover:bg-destructive/20",
          )}
        >
          <RemixIcon name="close" size="size-4" />
          {t("agent.permission.deny")}
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => void submitDecision("allow")}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            "bg-primary text-primary-foreground hover:bg-primary/90",
          )}
        >
          <RemixIcon name="check" size="size-4" />
          {t("agent.permission.allow")}
        </button>
      </div>
    </div>
  );
}
