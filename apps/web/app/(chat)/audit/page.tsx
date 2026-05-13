"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { cn, fetcher } from "@/lib/utils";
import { PageSectionHeader } from "@openloomi/ui";
import { Badge, Button, Input } from "@openloomi/ui";
import { ScrollArea } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";

interface AuditEntry {
  timestamp: string;
  type: "file_read" | "command_exec";
  detail: string;
  extra?: { args?: string[] };
}

interface AuditResponse {
  entries: AuditEntry[];
  total: number;
}

type FilterType = "all" | "file_read" | "command_exec";

const PAGE_SIZE = 50;

export default function AuditPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<FilterType>("all");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [page, setPage] = useState(1);

  const apiUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String((page - 1) * PAGE_SIZE));
    if (filter !== "all") params.set("type", filter);
    return `/api/audit/logs?${params.toString()}`;
  }, [filter, page]);

  const { data, mutate, isLoading } = useSWR<AuditResponse>(apiUrl, fetcher, {
    refreshInterval: autoRefresh ? 5000 : 0,
    revalidateOnFocus: false,
  });

  const handleClear = useCallback(async () => {
    if (!confirm(t("audit.clearConfirm"))) return;
    await fetch("/api/audit/logs", { method: "DELETE" });
    mutate();
  }, [mutate, t]);

  const handleRefresh = useCallback(() => {
    mutate();
  }, [mutate]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (
        e.key === "r" &&
        !e.metaKey &&
        !e.ctrlKey &&
        document.activeElement?.tagName !== "INPUT"
      ) {
        handleRefresh();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleRefresh]);

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [filter]);

  const fileReadCount = useMemo(
    () =>
      filter === "command_exec"
        ? "-"
        : entries.filter((e) => e.type === "file_read").length,
    [entries, filter],
  );
  const commandExecCount = useMemo(
    () =>
      filter === "file_read"
        ? "-"
        : entries.filter((e) => e.type === "command_exec").length,
    [entries, filter],
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full overflow-hidden">
      <PageSectionHeader title={t("audit.title")}>
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={cn(
              "gap-1.5 text-xs shrink-0",
              autoRefresh && "bg-accent-subtle text-accent-foreground",
            )}
          >
            <RemixIcon
              name="timer"
              size="size-3.5"
              className={cn(autoRefresh && "animate-spin")}
            />
            <span className="hidden sm:inline">
              {autoRefresh ? t("audit.autoRefreshing") : t("audit.autoRefresh")}
            </span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            className="gap-1.5 text-xs shrink-0"
          >
            <RemixIcon name="refresh" size="size-3.5" />
            <span className="hidden sm:inline">{t("audit.refresh")}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClear}
            className="gap-1.5 text-xs text-destructive hover:text-destructive shrink-0"
          >
            <RemixIcon name="delete_bin" size="size-3.5" />
            <span className="hidden sm:inline">{t("audit.clear")}</span>
          </Button>
        </div>
      </PageSectionHeader>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 border-b border-border/60 px-6 py-3 shrink-0">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          <RemixIcon
            name="filter"
            size="size-4"
            className="text-muted-foreground shrink-0"
          />
          <span className="mr-1 text-sm text-muted-foreground whitespace-nowrap hidden sm:inline">
            {t("audit.filter")}
          </span>
          {(
            [
              { key: "all", label: t("audit.filterAll") },
              { key: "file_read", label: t("audit.filterFileRead") },
              { key: "command_exec", label: t("audit.filterCommandExec") },
            ] as const
          ).map(({ key, label }) => (
            <Button
              key={key}
              variant={filter === key ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(key)}
              className="text-xs shrink-0 px-2 sm:px-3"
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2 sm:gap-3 text-xs text-muted-foreground sm:ml-auto">
          <span className="flex items-center gap-1">
            <RemixIcon name="file_text" size="size-3.5" />
            <span className="hidden sm:inline">
              {t("audit.fileReadLabel")}:{" "}
            </span>
            <span>{fileReadCount}</span>
          </span>
          <span className="flex items-center gap-1">
            <RemixIcon name="terminal-box" size="size-3.5" />
            <span className="hidden sm:inline">
              {t("audit.commandExecLabel")}:{" "}
            </span>
            <span>{commandExecCount}</span>
          </span>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {isLoading && entries.length === 0 ? (
          <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
            {t("audit.loading")}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-muted-foreground">
            <RemixIcon name="file_text" size="size-10" className="opacity-30" />
            <p className="text-sm">{t("audit.empty")}</p>
            <p className="text-xs">{t("audit.emptyHint")}</p>
          </div>
        ) : (
          <div className="divide-y">
            {entries.map((entry, idx) => (
              <AuditRow key={`${entry.timestamp}-${idx}`} entry={entry} />
            ))}
          </div>
        )}
      </ScrollArea>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 border-t border-border/60 px-4 sm:px-6 py-3 shrink-0 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(1)}
            className="text-xs px-2"
            title={t("audit.firstPage")}
          >
            <RemixIcon name="skip_left" size="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="text-xs px-2"
            title={t("audit.prevPage")}
          >
            <RemixIcon name="arrow_left_s" size="size-4" />
          </Button>

          <span className="text-sm text-muted-foreground mx-1">
            {t("audit.pageInfo", { page, totalPages })}
          </span>

          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="text-xs px-2"
            title={t("audit.nextPage")}
          >
            <RemixIcon name="arrow_right_s" size="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage(totalPages)}
            className="text-xs px-2"
            title={t("audit.lastPage")}
          >
            <RemixIcon name="skip_right" size="size-4" />
          </Button>

          <PageJumper
            totalPages={totalPages}
            onJump={setPage}
            label={t("audit.goToPage")}
          />
        </div>
      )}
    </div>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const { t } = useTranslation();
  const isFile = entry.type === "file_read";
  const time = new Date(entry.timestamp);
  const timeStr = time.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const argsStr = entry.extra?.args?.length
    ? ` ${entry.extra.args.join(" ")}`
    : "";

  return (
    <div className="group flex items-start gap-3 px-6 py-3 hover:bg-surface-hover transition-colors">
      <div
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md",
          isFile
            ? "bg-primary/10 text-primary"
            : "bg-accent-subtle text-accent-brand",
        )}
      >
        {isFile ? (
          <RemixIcon name="file_text" size="size-4" />
        ) : (
          <RemixIcon name="terminal-box" size="size-4" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] font-normal",
              isFile
                ? "border-primary/30 text-primary"
                : "border-accent-brand/30 text-accent-brand",
            )}
          >
            {isFile ? t("audit.fileReadLabel") : t("audit.commandExecLabel")}
          </Badge>
          <span className="text-xs text-muted-foreground">{timeStr}</span>
        </div>
        <p className="mt-1 break-all font-mono text-sm leading-relaxed text-foreground/90">
          {entry.detail}
          {argsStr && <span className="text-muted-foreground">{argsStr}</span>}
        </p>
      </div>
    </div>
  );
}

function PageJumper({
  totalPages,
  onJump,
  label,
}: {
  totalPages: number;
  onJump: (page: number) => void;
  label: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    const val = Number(inputRef.current?.value);
    if (!val || val < 1 || val > totalPages) return;
    onJump(val);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="flex items-center gap-1.5 ml-2">
      <Input
        ref={inputRef}
        type="number"
        min={1}
        max={totalPages}
        placeholder="#"
        className="h-8 w-14 text-xs text-center px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
        }}
      />
      <Button
        variant="outline"
        size="sm"
        onClick={handleSubmit}
        className="text-xs px-2"
      >
        {label}
      </Button>
    </div>
  );
}
