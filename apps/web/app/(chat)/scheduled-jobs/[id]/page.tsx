"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { isTauri } from "@/lib/tauri";
import { filterToolCallText } from "@/lib/utils";
import { useSidePanel } from "@/components/agent/side-panel-context";
import { useChatContext } from "@/components/chat-context";
import { AgentChatPanel } from "@/components/agent/chat-panel";
import { FilePreviewOverlay } from "@/components/file-preview-overlay";
import { Badge, Button, Input, Label } from "@openloomi/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openloomi/ui";
import { DatePicker } from "@openloomi/ui";
import { TimePicker } from "@openloomi/ui";
import { MultiCombobox } from "@openloomi/ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { Spinner } from "@/components/spinner";
import { toast } from "@/components/toast";
import {
  NovelInstructionEditor,
  type NovelInstructionEditorRef,
} from "@/components/novel-instruction-editor";
import { MarkdownWithCitations } from "@/components/markdown-with-citations";
import "@/i18n";
import { TwoPaneSidebarLayout } from "@/components/layout/two-panel-sidebar-layout";
import { MODELS, type ModelType } from "@/components/agent/model-selector";

interface ScheduledJobDetail {
  id: string;
  name: string;
  description: string | null;
  scheduleType:
    | "cron"
    | "interval"
    | "interval-hours"
    | "interval-minutes"
    | "once";
  cronExpression: string | null;
  intervalMinutes: number | null;
  intervalHours: number;
  scheduledAt: string | null;
  enabled: boolean;
  timezone: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
  runCount: number;
  failureCount: number;
  jobConfig?: {
    type?: string;
    handler?: string;
    modelConfig?: {
      apiKey?: string;
      baseUrl?: string;
      model?: string;
    };
  };
}

type CronPreset = "daily" | "weekly" | "monthly" | "custom";
type CronScheduleSelectValue =
  | "daily"
  | "weekly"
  | "monthly"
  | "cron"
  | "interval-hours"
  | "interval-minutes"
  | "interval"
  | "once";

interface EditFormState {
  name: string;
  description: string;
  scheduleType:
    | "cron"
    | "interval-hours"
    | "interval-minutes"
    | "interval"
    | "once";
  cronExpression: string;
  cronPreset: CronPreset;
  cronTime: string;
  cronWeekdays: string[];
  cronMonthDays: string[];
  intervalMinutes: number;
  intervalHours: number;
  scheduledAt: string;
  selectedModel: ModelType;
  enabled: boolean;
}

interface JobExecutionRecord {
  id: string;
  status: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  triggeredBy: string;
  output: string | null;
  error: string | null;
  result: {
    chatId?: string;
    message?: string;
  } | null;
}

/**
 * Unified check for Tauri/desktop availability.
 */
function isTauriEnvEnabled(): boolean {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const forceTauri = params.get("forceTauri")?.toLowerCase();
    if (forceTauri === "1" || forceTauri === "true" || forceTauri === "yes") {
      return true;
    }
  }

  return isTauri() || process.env.NEXT_PUBLIC_FORCE_WEB_AGENT_DEBUG === "true";
}

/**
 * Format milliseconds to a short readable duration (e.g., 850ms, 2.3s, 1m 5s).
 */
function formatMsDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "—";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    const s = ms / 1000;
    return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
  }
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

/**
 * Get processing duration display for a single execution record (prefer durationMs, fallback to start-end time difference).
 */
function getExecutionDurationDisplay(execution: JobExecutionRecord): string {
  if (
    execution.durationMs != null &&
    Number.isFinite(execution.durationMs) &&
    execution.durationMs >= 0
  ) {
    return formatMsDuration(execution.durationMs);
  }
  if (execution.completedAt && execution.startedAt) {
    const ms =
      new Date(execution.completedAt).getTime() -
      new Date(execution.startedAt).getTime();
    if (Number.isFinite(ms) && ms >= 0) {
      return formatMsDuration(ms);
    }
  }
  if (execution.status === "running") {
    return "—";
  }
  return "—";
}

/**
 * Resolve user's current timezone (browser IANA name, e.g., Asia/Shanghai); fallback to UTC if unavailable.
 */
function getResolvedUserTimezone(): string {
  if (
    typeof Intl === "undefined" ||
    typeof Intl.DateTimeFormat !== "function"
  ) {
    return "UTC";
  }
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.length > 0 ? tz : "UTC";
  } catch {
    return "UTC";
  }
}

function dateTimeInputFromValue(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Convert server-side job object to editable form state.
 */
function mapJobToForm(job: ScheduledJobDetail): EditFormState {
  const parsedCron = parseCronExpressionToPreset(
    job.cronExpression ?? "0 * * * *",
  );
  const cronPreset: CronPreset = parsedCron?.cronPreset ?? "custom";
  const rawModelId = job.jobConfig?.modelConfig?.model;
  const selectedModel: ModelType =
    rawModelId && rawModelId in MODELS ? (rawModelId as ModelType) : "default";
  return {
    name: job.name,
    description: job.description ?? "",
    scheduleType:
      job.scheduleType === "interval-hours" ||
      job.scheduleType === "interval-minutes" ||
      job.scheduleType === "interval" ||
      job.scheduleType === "cron" ||
      job.scheduleType === "once"
        ? job.scheduleType
        : "interval-minutes",
    cronExpression: job.cronExpression ?? "0 * * * *",
    cronPreset,
    cronTime: parsedCron?.cronTime ?? "00:00",
    cronWeekdays: parsedCron?.cronWeekdays ?? [],
    cronMonthDays: parsedCron?.cronMonthDays ?? [],
    intervalMinutes: job.intervalMinutes ?? 60,
    intervalHours: job.intervalMinutes
      ? Math.floor(job.intervalMinutes / 60)
      : 1,
    scheduledAt: dateTimeInputFromValue(job.scheduledAt),
    selectedModel,
    enabled: job.enabled,
  };
}

/**
 * Write form state back to job detail object, used for local sync of "saved" edits.
 */
function mapFormToJob(
  job: ScheduledJobDetail,
  form: EditFormState,
): ScheduledJobDetail {
  const computedCronExpression =
    form.scheduleType === "cron" && form.cronPreset !== "custom"
      ? generateCronExpressionFromPreset(
          form.cronPreset,
          form.cronTime,
          form.cronWeekdays,
          form.cronMonthDays,
        )
      : form.cronExpression;

  const existingJobConfig = job.jobConfig ?? { type: "custom", handler: "" };
  const existingModelConfig = existingJobConfig.modelConfig;

  // selectedModel === "default" means: keep auth/baseUrl but omit model field (system default model).
  const nextModelConfig =
    form.selectedModel === "default"
      ? existingModelConfig
        ? (() => {
            const { model: _existingModel, ...rest } = existingModelConfig;
            return rest;
          })()
        : undefined
      : {
          ...(existingModelConfig ?? {}),
          model: form.selectedModel,
        };

  return {
    ...job,
    name: form.name,
    description: form.description || null,
    scheduleType: form.scheduleType,
    cronExpression:
      form.scheduleType === "cron"
        ? computedCronExpression
        : job.cronExpression,
    intervalMinutes:
      form.scheduleType === "interval-hours" ||
      form.scheduleType === "interval-minutes"
        ? form.intervalMinutes
        : job.intervalMinutes,
    scheduledAt:
      form.scheduleType === "once" && form.scheduledAt
        ? new Date(form.scheduledAt).toISOString()
        : job.scheduledAt,
    enabled: form.enabled,
    jobConfig: {
      ...existingJobConfig,
      ...(existingJobConfig ? { modelConfig: nextModelConfig } : null),
    },
  };
}

/**
 * Extract date part (YYYY-MM-DD) from datetime-local string in the form.
 */
function getDatePartFromDateTime(value: string): string {
  if (!value) return "";
  const [datePart] = value.split("T");
  return datePart ?? "";
}

/**
 * Extract time part (HH:mm) from datetime-local string in the form, fallback to 00:00 if missing.
 */
function getTimePartFromDateTime(value: string): string {
  if (!value) return "";
  const timeCandidate = value.split("T")[1] ?? "";
  const matched = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeCandidate.slice(0, 5));
  return matched ? `${matched[1]}:${matched[2]}` : "00:00";
}

/**
 * Parse cron expression like "m h day month weekday" and attempt to map to daily/weekly/monthly presets.
 * Only supports simple forms we generate (fixed minute/hour, day/month/dow as "*" or pure number lists).
 * Returns null if parsing fails (handled by custom preset).
 */
function parseCronExpressionToPreset(expression: string): {
  cronPreset: CronPreset;
  cronTime: string;
  cronWeekdays: string[];
  cronMonthDays: string[];
} | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minuteRaw, hourRaw, dayOfMonthRaw, monthRaw, dayOfWeekRaw] = parts;
  if (!/^\d+$/.test(minuteRaw) || !/^\d+$/.test(hourRaw)) return null;

  const minute = Number.parseInt(minuteRaw, 10);
  const hour = Number.parseInt(hourRaw, 10);
  if (!Number.isFinite(minute) || !Number.isFinite(hour)) return null;
  if (minute < 0 || minute > 59) return null;
  if (hour < 0 || hour > 23) return null;

  const cronTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  // Daily: minute hour * * *
  if (dayOfMonthRaw === "*" && monthRaw === "*" && dayOfWeekRaw === "*") {
    return {
      cronPreset: "daily",
      cronTime,
      cronWeekdays: [],
      cronMonthDays: [],
    };
  }

  // Weekly: minute hour * * 0,1,2...
  if (dayOfMonthRaw === "*" && monthRaw === "*" && dayOfWeekRaw !== "*") {
    const cronWeekdays = parseCommaSeparatedNumberField(dayOfWeekRaw, {
      min: 0,
      max: 7,
      normalize: (n) => (n === 7 ? 0 : n),
    });
    if (!cronWeekdays) return null;
    return { cronPreset: "weekly", cronTime, cronWeekdays, cronMonthDays: [] };
  }

  // Monthly: minute hour 1,2,15... * *
  if (monthRaw === "*" && dayOfWeekRaw === "*" && dayOfMonthRaw !== "*") {
    const cronMonthDays = parseCommaSeparatedNumberField(dayOfMonthRaw, {
      min: 1,
      max: 31,
    });
    if (!cronMonthDays) return null;
    return { cronPreset: "monthly", cronTime, cronWeekdays: [], cronMonthDays };
  }

  return null;
}

/**
 * Generate cron expression for the given preset (5 parts: minute hour day month weekday).
 * - daily:   mm HH * * *
 * - weekly:  mm HH * * dow(number list)
 * - monthly: mm HH dom(number list) * *
 */
function generateCronExpressionFromPreset(
  preset: CronPreset,
  cronTime: string,
  cronWeekdays: string[],
  cronMonthDays: string[],
): string {
  const matched = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(cronTime || "");
  const hour = matched ? Number.parseInt(matched[1], 10) : 0;
  const minute = matched ? Number.parseInt(matched[2], 10) : 0;

  if (preset === "daily") {
    return `${minute} ${hour} * * *`;
  }

  if (preset === "weekly") {
    const weekdays =
      cronWeekdays.length > 0 ? cronWeekdays : getDefaultCronWeekdays();
    return `${minute} ${hour} * * ${sortNumericStrings(weekdays).join(",")}`;
  }

  if (preset === "monthly") {
    const monthDays =
      cronMonthDays.length > 0 ? cronMonthDays : getDefaultCronMonthDays();
    return `${minute} ${hour} ${sortNumericStrings(monthDays).join(",")} * *`;
  }

  // custom: not generated here
  return `${minute} ${hour} * * *`;
}

/**
 * Parse cron numeric list field like "1,2,5"; only supports comma-separated numbers (no ranges like 1-5).
 * @returns null if unparsable
 */
function parseCommaSeparatedNumberField(
  field: string,
  opts: { min: number; max: number; normalize?: (n: number) => number },
): string[] | null {
  if (field === "*") return null;
  const trimmed = field.trim();
  if (!/^\d+(,\d+)*$/.test(trimmed)) return null;

  const nums = trimmed
    .split(",")
    .map((x) => Number.parseInt(x, 10))
    .filter((n) => Number.isFinite(n));

  if (nums.length === 0) return null;

  const normalized = nums.map((n) => (opts.normalize ? opts.normalize(n) : n));
  if (!normalized.every((n) => n >= opts.min && n <= opts.max)) return null;

  return sortNumericStrings(normalized.map((n) => String(n)));
}

/**
 * Sort array of number strings in ascending order by numeric value.
 */
function sortNumericStrings(values: string[]): string[] {
  return [...values].sort(
    (a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10),
  );
}

/**
 * Default select "current weekday" (cron weekday uses 0=Sunday, 1=Monday...).
 */
function getDefaultCronWeekdays(): string[] {
  const d = new Date();
  return [String(d.getDay())];
}

/**
 * Default select "today's date" (1-31).
 */
function getDefaultCronMonthDays(): string[] {
  const d = new Date();
  const day = d.getDate();
  const clamped = Math.max(1, Math.min(31, day));
  return [String(clamped)];
}

/**
 * Scheduled job detail page: view and edit a single job.
 */
export default function ScheduledJobDetailPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { openSidePanel, closeSidePanel } = useSidePanel();
  const {
    switchChatId,
    previewFile,
    openFilePreviewPanel,
    closeFilePreviewPanel,
  } = useChatContext();
  const params = useParams<{ id: string }>();
  const jobId = params?.id;
  const [executionPreview, setExecutionPreview] =
    useState<JobExecutionRecord | null>(null);
  const [isInstructionExpanded, setIsInstructionExpanded] = useState(false);
  const [isTaskExpanded, setIsTaskExpanded] = useState(false);
  const [onceTimeDraft, setOnceTimeDraft] = useState<string>("00:00");
  /**
   * Return to job list, preserving current query params (e.g., forceTauri).
   */
  const handleBackToList = useCallback(() => {
    const currentQuery = searchParams.toString();
    const targetUrl = currentQuery
      ? `/scheduled-jobs?${currentQuery}`
      : "/scheduled-jobs";
    router.push(targetUrl);
  }, [router, searchParams]);

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [job, setJob] = useState<ScheduledJobDetail | null>(null);
  const [form, setForm] = useState<EditFormState | null>(null);
  const [executions, setExecutions] = useState<JobExecutionRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingExecutions, setLoadingExecutions] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inlineEditorRef = useRef<NovelInstructionEditorRef>(null);

  /**
   * "One-time" time draft: allow user to select time first then date, avoiding the appearance of "no response on click".
   */
  useEffect(() => {
    if (!form) return;
    if (form.scheduleType !== "once") return;
    const next = getTimePartFromDateTime(form.scheduledAt) || "00:00";
    setOnceTimeDraft(next);
  }, [form?.scheduleType, form?.scheduledAt]);

  /**
   * When switching to new execution result, collapse "Task" card by default (show only title).
   */
  useEffect(() => {
    setIsTaskExpanded(false);
  }, [executionPreview?.id]);

  /**
   * Click "Task" card title area to expand/collapse card content.
   */
  const handleToggleTaskCard = useCallback(() => {
    setIsTaskExpanded((prev) => !prev);
  }, []);

  /**
   * Fetch execution history for current job and parse result field.
   * @param offset - number of existing executions to skip (for pagination)
   * @param append - if true, append to existing executions; if false, replace
   */
  const fetchExecutions = useCallback(
    async (offset = 0, append = false) => {
      if (!jobId) return;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoadingExecutions(true);
      }
      try {
        const response = await fetch(
          `/api/scheduled-jobs/${jobId}/executions?limit=10&offset=${offset}`,
        );
        if (!response.ok) {
          throw new Error("Failed to fetch executions");
        }
        const data = await response.json();
        const parsedExecutions: JobExecutionRecord[] = (
          data.executions || []
        ).map((execution: any) => {
          let parsedResult: JobExecutionRecord["result"] = null;
          try {
            parsedResult = execution.result
              ? JSON.parse(execution.result)
              : null;
          } catch {
            parsedResult = null;
          }
          return {
            id: execution.id,
            status: execution.status ?? null,
            startedAt: execution.startedAt,
            completedAt: execution.completedAt ?? null,
            durationMs: execution.durationMs ?? null,
            triggeredBy: execution.triggeredBy ?? "unknown",
            output: execution.output ?? null,
            error: execution.error ?? null,
            result: parsedResult,
          };
        });
        if (append) {
          setExecutions((prev) => [...prev, ...parsedExecutions]);
        } else {
          setExecutions(parsedExecutions);
        }
        setTotal(data.total ?? 0);
        setHasMore(data.hasMore ?? false);
      } catch {
        toast({
          type: "error",
          description: t(
            "agent.panels.scheduledJobsPanel.detail.historyLoadError",
            "Failed to load execution history",
          ),
        });
      } finally {
        setLoadingExecutions(false);
        setLoadingMore(false);
      }
    },
    [jobId, t],
  );

  /**
   * Load more executions (called by IntersectionObserver).
   */
  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    fetchExecutions(executions.length, true);
  }, [hasMore, loadingMore, fetchExecutions, executions.length]);

  /**
   * Infinite scroll: trigger loadMore when user scrolls near the bottom of the executions list.
   */
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      if (scrollHeight - scrollTop - clientHeight < 100) {
        loadMore();
      }
    };

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, [loadMore]);

  /**
   * Map execution status to badge label and style.
   */
  const getExecutionStatusBadgeVisual = useCallback(
    (status: string | null) => {
      if (status === "success") {
        return {
          label: t("agent.panels.scheduledJobsPanel.statusSuccess", "Success"),
          className: "bg-blue-100 text-blue-700 hover:bg-blue-100",
        };
      }
      if (status === "error") {
        return {
          label: t("agent.panels.scheduledJobsPanel.statusError", "Failed"),
          className: "bg-red-100 text-red-700 hover:bg-red-100",
        };
      }
      if (status === "running") {
        return {
          label: t("agent.panels.scheduledJobsPanel.statusRunning", "Running"),
          className: "bg-amber-100 text-amber-700 hover:bg-amber-100",
        };
      }
      return {
        label: t("agent.panels.scheduledJobsPanel.statusPending", "Pending"),
        className: "bg-muted text-muted-foreground hover:bg-muted",
      };
    },
    [t],
  );

  /**
   * Map trigger source to icon and tooltip label.
   */
  const getExecutionTriggerVisual = useCallback(
    (triggeredBy: string | null) => {
      if (triggeredBy === "scheduler") {
        return {
          icon: "timer" as const,
          label: t(
            "agent.panels.scheduledJobsPanel.triggeredByScheduler",
            "Scheduled trigger",
          ),
        };
      }
      if (triggeredBy === "manual") {
        return {
          icon: "mouse_pointer" as const,
          label: t(
            "agent.panels.scheduledJobsPanel.triggeredByManual",
            "Manual trigger",
          ),
        };
      }
      return {
        icon: "calendar" as const,
        label: t(
          "agent.panels.scheduledJobsPanel.triggeredByUnknown",
          "Unknown trigger",
        ),
      };
    },
    [t],
  );

  /**
   * Open specified chat in right sidebar and navigate to that chat.
   */
  const openExecutionChatInSidePanel = useCallback(
    (chatId: string) => {
      setExecutionPreview(null);
      switchChatId(chatId, true);
      openSidePanel({
        id: `scheduled-job-execution-chat-${chatId}`,
        width: 400,
        content: (
          <div className="h-full flex flex-col bg-card">
            <div className="flex items-center justify-end gap-1 px-2 py-2 bg-white/70 shrink-0">
              <Button
                size="icon"
                variant="ghost"
                onClick={closeSidePanel}
                className="h-8 w-8 shrink-0"
                aria-label={t("common.close", "Close")}
              >
                <RemixIcon name="close" className="size-3" />
              </Button>
            </div>
            <div className="flex-1 min-h-0 flex flex-col">
              <AgentChatPanel chatId={chatId} />
            </div>
          </div>
        ),
      });
    },
    [closeSidePanel, openSidePanel, switchChatId, t],
  );

  /**
   * Preview execution result/output directly in page right sidebar (TwoPaneSidebarLayout) without opening chat panel.
   */
  const openExecutionResultPreviewInSidePanel = useCallback(
    (execution: JobExecutionRecord) => {
      // Close the global right panel to prevent the global SidePanelShell from covering/replacing the page-level TwoPaneSidebarLayout.
      closeSidePanel();
      setExecutionPreview(execution);
    },
    [closeSidePanel],
  );

  /**
   * Fetch details and initialize form.
   */
  const fetchJob = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/scheduled-jobs/${jobId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch job");
      }
      const data = await response.json();
      const nextJob = data.job as ScheduledJobDetail;
      setJob(nextJob);
      setForm(mapJobToForm(nextJob));
    } catch (error) {
      toast({
        type: "error",
        description: t(
          "agent.panels.scheduledJobsPanel.detail.loadError",
          "Failed to load task details",
        ),
      });
    } finally {
      setLoading(false);
    }
  }, [jobId, t]);

  /**
   * Manual refresh: fetch both job and executions with loading indicator.
   */
  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    await Promise.all([fetchJob(), fetchExecutions()]);
    setRefreshing(false);
  }, [refreshing, fetchJob, fetchExecutions]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isTauriEnvEnabled()) {
      return;
    }
    fetchJob();
    fetchExecutions();
  }, [fetchExecutions, fetchJob, mounted]);

  const isDirty = useMemo(() => {
    if (!job || !form) return false;
    return JSON.stringify(mapJobToForm(job)) !== JSON.stringify(form);
  }, [job, form]);

  /**
   * Execution history summary: total count from API and failed count from locally loaded data.
   */
  const executionHistorySummary = useMemo(() => {
    const failed = executions.reduce(
      (acc, execution) => acc + (execution.status === "error" ? 1 : 0),
      0,
    );
    return { total, failed };
  }, [total, executions]);

  /**
   * Toggles the instruction input expand/collapse state.
   */
  const handleToggleInstructionExpanded = useCallback(() => {
    setIsInstructionExpanded((prev) => !prev);
  }, []);

  /**
   * Close right sidebar "title/description" editor.
   */
  const handleCloseDetailsEditor = useCallback(() => {
    setExecutionPreview(null);
  }, []);

  /**
   * Opens the "Select skill" picker inside the main input editor.
   */
  const handleOpenInlineSkillPicker = useCallback(() => {
    inlineEditorRef.current?.openSkillPicker();
  }, []);

  /**
   * Save current edit content to backend.
   */
  const patchJob = useCallback(
    /**
     * Save form content (optionally override partial fields) to backend.
     * Used for: normal save, instant save when clicking "enable/pause" icon.
     */
    async (overrides?: Partial<EditFormState>) => {
      if (!job || !form || saving) return;
      setSaving(true);

      const effectiveForm = overrides ? { ...form, ...overrides } : form;

      try {
        const userTz = getResolvedUserTimezone();
        const existingJobConfig = job.jobConfig ?? {
          type: "custom",
          handler: "",
        };
        const existingModelConfig = existingJobConfig.modelConfig;

        // selectedModel === "default": omit model field, but keep apiKey/baseUrl for Tauri/local API.
        const nextModelConfig =
          effectiveForm.selectedModel === "default"
            ? existingModelConfig
              ? (() => {
                  const { model: _existingModel, ...rest } =
                    existingModelConfig;
                  return rest;
                })()
              : undefined
            : {
                ...(existingModelConfig ?? {}),
                model: effectiveForm.selectedModel,
              };

        // Validate scheduledAt for "once" type
        if (effectiveForm.scheduleType === "once") {
          const scheduledDate = effectiveForm.scheduledAt
            ? new Date(effectiveForm.scheduledAt)
            : null;
          if (!scheduledDate || Number.isNaN(scheduledDate.getTime())) {
            throw new Error(
              t(
                "agent.panels.scheduledJobsPanel.invalidScheduleDate",
                "Invalid schedule date",
              ),
            );
          }
        }

        const schedule =
          effectiveForm.scheduleType === "cron"
            ? {
                type: "cron",
                expression:
                  effectiveForm.cronPreset !== "custom"
                    ? generateCronExpressionFromPreset(
                        effectiveForm.cronPreset,
                        effectiveForm.cronTime,
                        effectiveForm.cronWeekdays,
                        effectiveForm.cronMonthDays,
                      )
                    : effectiveForm.cronExpression,
                timezone: userTz,
              }
            : effectiveForm.scheduleType === "interval-hours"
              ? { type: "interval-hours", hours: effectiveForm.intervalHours }
              : effectiveForm.scheduleType === "interval-minutes"
                ? {
                    type: "interval-minutes",
                    minutes: effectiveForm.intervalMinutes,
                  }
                : {
                    type: "once",
                    at: effectiveForm.scheduledAt
                      ? new Date(effectiveForm.scheduledAt)
                      : undefined,
                  };

        const response = await fetch(`/api/scheduled-jobs/${job.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: effectiveForm.name,
            description: effectiveForm.description || null,
            schedule,
            enabled: effectiveForm.enabled,
            timezone: userTz,
            job: {
              type: existingJobConfig.type ?? "custom",
              handler: existingJobConfig.handler ?? "",
              modelConfig: nextModelConfig,
            },
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to save");
        }
        const nextJob = mapFormToJob(job, effectiveForm);
        setJob(nextJob);
        setForm(mapJobToForm(nextJob));
      } catch {
        toast({
          type: "error",
          description: t(
            "agent.panels.scheduledJobsPanel.detail.saveError",
            "Save failed",
          ),
        });
      } finally {
        setSaving(false);
      }
    },
    [form, job, saving, t],
  );

  /**
   * Save current edit content to backend.
   */
  const handleSave = useCallback(async () => {
    await patchJob();
  }, [patchJob]);

  /**
   * Enable/pause current job: toggle enabled and save to backend immediately.
   */
  const handleToggleEnabled = useCallback(async () => {
    if (!form) return;
    await patchJob({ enabled: !form.enabled });
  }, [form, patchJob]);

  /**
   * Auto-save after field changes, avoiding manual save button click.
   */
  useEffect(() => {
    if (!isDirty || saving) return;
    const timer = window.setTimeout(() => {
      void handleSave();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [handleSave, isDirty, saving]);

  /**
   * Manually execute current job.
   */
  const handleExecute = useCallback(async () => {
    if (!job) return;
    if (executing) return;
    setExecuting(true);
    try {
      const response = await fetch(
        `/api/scheduled-jobs/${job.id}?action=execute`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to execute");
      }

      toast({
        type: "success",
        description: t(
          "agent.panels.scheduledJobsPanel.executing",
          "Starting task execution...",
        ),
      });
      await fetchJob();
      await fetchExecutions();
    } catch {
      toast({
        type: "error",
        description: t(
          "agent.panels.scheduledJobsPanel.executeError",
          "Execution failed: {{error}}",
          {
            error: "unknown",
          },
        ),
      });
    } finally {
      setExecuting(false);
    }
  }, [fetchExecutions, fetchJob, job, t]);

  /**
   * Delete current job and return to job list page.
   */
  const handleDelete = useCallback(async () => {
    if (!job) return;
    try {
      const response = await fetch(`/api/scheduled-jobs/${job.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Failed to delete");
      }
      toast({
        type: "success",
        description: t(
          "agent.panels.scheduledJobsPanel.deleteSuccess",
          "Task deleted",
        ),
      });
      handleBackToList();
    } catch {
      toast({
        type: "error",
        description: t(
          "agent.panels.scheduledJobsPanel.deleteError",
          "Delete failed",
        ),
      });
    }
  }, [handleBackToList, job, t]);

  if (!mounted) {
    return null;
  }

  if (!isTauriEnvEnabled()) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-muted-foreground">
        <p className="text-sm">
          {t(
            "agent.panels.scheduledJobsPanel.tauriOnly",
            "Scheduled jobs are only available in the openloomi desktop app.",
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 min-h-0 flex-col">
      <div className="shrink-0 p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-3">
          <div className="flex min-w-0 items-center gap-0">
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={handleBackToList}
              aria-label={t(
                "agent.panels.scheduledJobsPanel.detail.back",
                "Back",
              )}
            >
              <RemixIcon name="arrow_left_s" className="size-4" />
            </Button>
            <h1 className="truncate text-sm font-medium text-foreground">
              {t(
                "agent.panels.scheduledJobsPanel.detail.title",
                "Task details",
              )}
            </h1>
          </div>
          <div className="flex items-center gap-[8px]">
            {saving ? (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Spinner size={12} />
                <span>
                  {t(
                    "agent.panels.scheduledJobsPanel.detail.autoSaving",
                    "Auto-saving...",
                  )}
                </span>
              </div>
            ) : isDirty ? (
              <span className="text-xs text-muted-foreground">
                {t(
                  "agent.panels.scheduledJobsPanel.detail.pendingAutoSave",
                  "Changes will auto-save",
                )}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                {t(
                  "agent.panels.scheduledJobsPanel.detail.autoSaved",
                  "Auto-saved",
                )}
              </span>
            )}
            {/* Place main action "Execute Now" at rightmost of action bar, highlight with primary button style */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleToggleEnabled}
                  disabled={!form || executing || saving}
                  className="h-8 w-8"
                  aria-label={
                    form?.enabled
                      ? t("agent.panels.scheduledJobsPanel.disable", "Pause")
                      : t("agent.panels.scheduledJobsPanel.enable", "Enable")
                  }
                >
                  <RemixIcon
                    name={form?.enabled ? "pause_circle" : "play_circle"}
                    className="size-4"
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {form?.enabled
                  ? t("agent.panels.scheduledJobsPanel.disable", "Pause")
                  : t("agent.panels.scheduledJobsPanel.enable", "Enable")}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleDelete}
                  aria-label={t(
                    "agent.panels.scheduledJobsPanel.delete",
                    "Delete task",
                  )}
                  className="h-8 w-8"
                >
                  <RemixIcon name="delete_bin" className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t("agent.panels.scheduledJobsPanel.delete", "Delete task")}
              </TooltipContent>
            </Tooltip>
            <Button
              variant="default"
              size="sm"
              onClick={handleExecute}
              disabled={executing}
              className="h-8 gap-0"
            >
              <RemixIcon name="play" className="mr-2 size-4" />
              {t("agent.panels.scheduledJobsPanel.executeNow", "Execute")}
            </Button>
          </div>
        </div>
      </div>

      <TwoPaneSidebarLayout
        isSidebarOpen={executionPreview !== null}
        breakpoint="lg"
        sidebarClassName="lg:min-w-[420px] lg:max-w-[420px]"
        sidebar={
          executionPreview ? (
            <div className="h-full flex flex-col">
              <div className="flex items-center justify-between gap-2 px-4 py-3 shrink-0">
                <div className="min-w-0 flex items-center gap-2">
                  <span className="text-sm font-semibold font-serif truncate">
                    {t(
                      "agent.panels.scheduledJobsPanel.executionHistory",
                      "Execution history",
                    )}
                  </span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {executionPreview.result?.chatId && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => {
                        const chatId = executionPreview.result?.chatId;
                        if (!chatId) return;
                        // Only open chat sidebar when chatId exists, avoid non-null assertion.
                        openExecutionChatInSidePanel(chatId);
                        setExecutionPreview(null);
                      }}
                    >
                      <RemixIcon
                        name="arrow_right_up"
                        className="mr-1 size-3"
                      />
                      {t(
                        "agent.panels.scheduledJobsPanel.viewChat",
                        "View chat",
                      )}
                    </Button>
                  )}

                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleCloseDetailsEditor}
                    aria-label={t("common.close", "Close")}
                    className="h-8 w-8"
                  >
                    <RemixIcon name="close" className="size-3" />
                  </Button>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pt-0 px-4 pb-4 space-y-3">
                {executionPreview.error && (
                  <div className="rounded-md bg-destructive/10 p-3">
                    <div className="text-sm text-destructive font-medium mb-1">
                      {t("common.error", "Error")}:
                    </div>
                    <div className="text-sm text-destructive break-words">
                      {executionPreview.error}
                    </div>
                  </div>
                )}

                {executionPreview.result?.message && (
                  <div className="rounded-lg border border-border/60 bg-background min-w-0 overflow-x-hidden">
                    <button
                      type="button"
                      onClick={handleToggleTaskCard}
                      aria-expanded={isTaskExpanded}
                      className="group flex items-center justify-between w-full text-left px-3 py-2"
                    >
                      <span className="text-sm font-medium text-foreground min-w-0 truncate">
                        {t(
                          "agent.panels.scheduledJobsPanel.task",
                          "Task instruction",
                        )}
                      </span>
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
                        className={`transition-transform duration-200 shrink-0 text-muted-foreground ${
                          isTaskExpanded ? "rotate-0" : "-rotate-90"
                        }`}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>

                    {isTaskExpanded && (
                      <div className="px-3 pb-3 min-w-0 overflow-x-hidden break-words">
                        <div className="text-sm text-muted-foreground break-words">
                          <MarkdownWithCitations
                            insights={[]}
                            onPreviewFile={openFilePreviewPanel}
                          >
                            {executionPreview.result.message}
                          </MarkdownWithCitations>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {executionPreview.output && (
                  <div className="mt-0 rounded-none p-3 pl-2 w-full min-w-0 overflow-x-hidden text-sm">
                    <MarkdownWithCitations
                      insights={[]}
                      onPreviewFile={openFilePreviewPanel}
                    >
                      {filterToolCallText(executionPreview.output)}
                    </MarkdownWithCitations>
                  </div>
                )}

                {!executionPreview.error &&
                  !executionPreview.output &&
                  !executionPreview.result?.message && (
                    <div className="text-sm text-muted-foreground">
                      {t(
                        "agent.panels.scheduledJobsPanel.noHistory",
                        "No execution history",
                      )}
                    </div>
                  )}
              </div>
            </div>
          ) : null
        }
      >
        <div
          ref={scrollContainerRef}
          className="flex-1 min-h-0 overflow-auto p-0"
        >
          {loading || !job || !form ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Spinner size={20} />
              <span className="ml-2">{t("common.loading", "Loading...")}</span>
            </div>
          ) : (
            <div className="flex flex-col gap-[24px] px-8 py-6">
              <div className="flex flex-col gap-[24px]">
                <div className="flex flex-col gap-[8px]">
                  <Label htmlFor="job-name">
                    {t("agent.panels.scheduledJobsPanel.jobName", "Name")}
                  </Label>
                  <Input
                    id="job-name"
                    value={form.name}
                    onChange={(event) =>
                      setForm((prev) =>
                        prev ? { ...prev, name: event.target.value } : prev,
                      )
                    }
                  />
                </div>

                <div className="flex flex-col gap-[8px]">
                  <Label>
                    {t(
                      "agent.panels.scheduledJobsPanel.instruction",
                      "Instruction",
                    )}
                  </Label>
                  <div
                    className={`flex flex-col overflow-hidden rounded-md border border-border bg-background ${
                      isInstructionExpanded ? "h-[960px]" : "h-[160px]"
                    }`}
                  >
                    <div className="shrink-0 flex items-center justify-between gap-2 border-b border-border px-2 py-2">
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={handleOpenInlineSkillPicker}
                        >
                          <RemixIcon name="apps_2_ai" size="size-3.5" />
                          {t("chat.addSkill", "Select skill")}
                        </Button>
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={handleToggleInstructionExpanded}
                        aria-label={t(
                          isInstructionExpanded
                            ? "agent.panels.scheduledJobsPanel.toggleInstructionExpanded.collapse"
                            : "agent.panels.scheduledJobsPanel.toggleInstructionExpanded.expand",
                        )}
                      >
                        <RemixIcon
                          name={
                            isInstructionExpanded
                              ? "arrow_up_s"
                              : "arrow_down_s"
                          }
                          size="size-4"
                        />
                      </Button>
                    </div>
                    <NovelInstructionEditor
                      ref={inlineEditorRef}
                      id="job-inline-description-editor"
                      value={form.description}
                      onChange={(next) =>
                        setForm((prev) =>
                          prev ? { ...prev, description: next } : prev,
                        )
                      }
                      placeholder={t(
                        "agent.panels.scheduledJobsPanel.descriptionPlaceholder",
                        "Search yesterday's AI industry news, compile it into a brief, and send it to my Gmail inbox.",
                      )}
                      showSkillEventButtons={false}
                      className="flex-1 min-h-0 border-0 rounded-none bg-transparent"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-[8px]">
                  <Label htmlFor="job-model">
                    {t(
                      "agent.panels.scheduledJobsPanel.model",
                      "Model selection",
                    )}
                  </Label>
                  <Select
                    value={form.selectedModel}
                    onValueChange={(value: ModelType) => {
                      setForm((prev) =>
                        prev ? { ...prev, selectedModel: value } : prev,
                      );
                    }}
                  >
                    <SelectTrigger id="job-model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(MODELS).map(([id, model]) => (
                        <SelectItem key={id} value={id}>
                          {id === "default"
                            ? t(
                                "agent.panels.scheduledJobsPanel.modelDefault",
                                "Default",
                              )
                            : model.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-[8px]">
                  <Label>
                    {t("agent.panels.scheduledJobsPanel.plan", "Plan")}
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    <div className="w-[220px] shrink-0 space-y-1">
                      <Label className="sr-only" htmlFor="job-schedule-type">
                        {t(
                          "agent.panels.scheduledJobsPanel.scheduleType",
                          "Schedule Type",
                        )}
                      </Label>
                      <Select
                        value={
                          (form.scheduleType === "cron"
                            ? form.cronPreset === "daily" ||
                              form.cronPreset === "weekly" ||
                              form.cronPreset === "monthly"
                              ? form.cronPreset
                              : "cron"
                            : form.scheduleType) as CronScheduleSelectValue
                        }
                        onValueChange={(value: CronScheduleSelectValue) => {
                          setForm((prev) => {
                            if (!prev) return prev;
                            const nextCronTime = prev.cronTime || "00:00";

                            if (value === "interval-hours") {
                              return {
                                ...prev,
                                scheduleType: "interval-hours",
                                intervalHours: 1,
                                intervalMinutes: 0,
                              };
                            }

                            if (value === "interval-minutes") {
                              return {
                                ...prev,
                                scheduleType: "interval-minutes",
                                intervalHours: 0,
                                intervalMinutes: 60,
                              };
                            }

                            if (value === "once") {
                              return { ...prev, scheduleType: "once" };
                            }

                            if (value === "cron") {
                              const defaultCronExpression = "0 * * * *";
                              return {
                                ...prev,
                                scheduleType: "cron",
                                cronPreset: "custom",
                                cronExpression: defaultCronExpression,
                                cronWeekdays: [],
                                cronMonthDays: [],
                              };
                            }

                            if (value === "daily") {
                              const nextExpression =
                                generateCronExpressionFromPreset(
                                  "daily",
                                  nextCronTime,
                                  [],
                                  [],
                                );
                              return {
                                ...prev,
                                scheduleType: "cron",
                                cronPreset: "daily",
                                cronTime: nextCronTime,
                                cronWeekdays: [],
                                cronMonthDays: [],
                                cronExpression: nextExpression,
                              };
                            }

                            if (value === "weekly") {
                              const effectiveWeekdays =
                                prev.cronWeekdays.length > 0
                                  ? prev.cronWeekdays
                                  : getDefaultCronWeekdays();
                              const nextExpression =
                                generateCronExpressionFromPreset(
                                  "weekly",
                                  nextCronTime,
                                  effectiveWeekdays,
                                  [],
                                );
                              return {
                                ...prev,
                                scheduleType: "cron",
                                cronPreset: "weekly",
                                cronTime: nextCronTime,
                                cronWeekdays: effectiveWeekdays,
                                cronExpression: nextExpression,
                              };
                            }

                            // monthly
                            const effectiveMonthDays =
                              prev.cronMonthDays.length > 0
                                ? prev.cronMonthDays
                                : getDefaultCronMonthDays();
                            const nextExpression =
                              generateCronExpressionFromPreset(
                                "monthly",
                                nextCronTime,
                                [],
                                effectiveMonthDays,
                              );
                            return {
                              ...prev,
                              scheduleType: "cron",
                              cronPreset: "monthly",
                              cronTime: nextCronTime,
                              cronMonthDays: effectiveMonthDays,
                              cronExpression: nextExpression,
                            };
                          });
                        }}
                      >
                        <SelectTrigger id="job-schedule-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="daily">
                            {t(
                              "agent.panels.scheduledJobsPanel.cronPresetDaily",
                              "Daily",
                            )}
                          </SelectItem>
                          <SelectItem value="weekly">
                            {t(
                              "agent.panels.scheduledJobsPanel.cronPresetWeekly",
                              "Weekly",
                            )}
                          </SelectItem>
                          <SelectItem value="monthly">
                            {t(
                              "agent.panels.scheduledJobsPanel.cronPresetMonthly",
                              "Monthly",
                            )}
                          </SelectItem>
                          <SelectItem value="interval-hours">
                            {t(
                              "agent.panels.scheduledJobsPanel.intervalHoursOption",
                              "Interval (hours)",
                            )}
                          </SelectItem>
                          <SelectItem value="interval-minutes">
                            {t(
                              "agent.panels.scheduledJobsPanel.intervalMinutes",
                              "Interval (minutes)",
                            )}
                          </SelectItem>
                          <SelectItem value="once">
                            {t(
                              "agent.panels.scheduledJobsPanel.noRepeat",
                              "No repeat",
                            )}
                          </SelectItem>
                          <SelectItem value="cron">
                            {t(
                              "agent.panels.scheduledJobsPanel.cronPresetCustom",
                              "Custom Cron",
                            )}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {form.scheduleType === "cron" && (
                      <>
                        {form.cronPreset === "daily" && (
                          <div className="w-[220px] shrink-0 space-y-1">
                            <Label
                              className="sr-only"
                              htmlFor="job-cron-daily-time"
                            >
                              {t(
                                "agent.panels.scheduledJobsPanel.scheduleTime",
                                "Schedule Time",
                              )}
                            </Label>
                            <TimePicker
                              id="job-cron-daily-time"
                              value={form.cronTime}
                              onChange={(timeValue) => {
                                setForm((prev) => {
                                  if (!prev) return prev;
                                  const cronTime = timeValue || "00:00";
                                  return {
                                    ...prev,
                                    cronTime,
                                    cronExpression:
                                      generateCronExpressionFromPreset(
                                        "daily",
                                        cronTime,
                                        [],
                                        [],
                                      ),
                                  };
                                });
                              }}
                              placeholder=""
                            />
                          </div>
                        )}

                        {form.cronPreset === "weekly" && (
                          <>
                            <div className="w-[220px] shrink-0 space-y-1">
                              <Label
                                className="sr-only"
                                htmlFor="job-cron-weekdays"
                              >
                                {t(
                                  "agent.panels.scheduledJobsPanel.cronWeekdays",
                                  "Weekdays",
                                )}
                              </Label>
                              <MultiCombobox
                                options={[
                                  {
                                    value: "0",
                                    label: t(
                                      "agent.panels.scheduledJobsPanel.weekday.sun",
                                      "Sunday",
                                    ),
                                  },
                                  {
                                    value: "1",
                                    label: t(
                                      "agent.panels.scheduledJobsPanel.weekday.mon",
                                      "Monday",
                                    ),
                                  },
                                  {
                                    value: "2",
                                    label: t(
                                      "agent.panels.scheduledJobsPanel.weekday.tue",
                                      "Tuesday",
                                    ),
                                  },
                                  {
                                    value: "3",
                                    label: t(
                                      "agent.panels.scheduledJobsPanel.weekday.wed",
                                      "Wednesday",
                                    ),
                                  },
                                  {
                                    value: "4",
                                    label: t(
                                      "agent.panels.scheduledJobsPanel.weekday.thu",
                                      "Thursday",
                                    ),
                                  },
                                  {
                                    value: "5",
                                    label: t(
                                      "agent.panels.scheduledJobsPanel.weekday.fri",
                                      "Friday",
                                    ),
                                  },
                                  {
                                    value: "6",
                                    label: t(
                                      "agent.panels.scheduledJobsPanel.weekday.sat",
                                      "Saturday",
                                    ),
                                  },
                                ]}
                                value={form.cronWeekdays}
                                onChange={(nextWeekdays) => {
                                  setForm((prev) => {
                                    if (!prev) return prev;
                                    const effectiveWeekdays =
                                      nextWeekdays.length > 0
                                        ? nextWeekdays
                                        : getDefaultCronWeekdays();
                                    return {
                                      ...prev,
                                      cronWeekdays: effectiveWeekdays,
                                      cronExpression:
                                        generateCronExpressionFromPreset(
                                          "weekly",
                                          prev.cronTime || "00:00",
                                          effectiveWeekdays,
                                          [],
                                        ),
                                    };
                                  });
                                }}
                                placeholder={t(
                                  "agent.panels.scheduledJobsPanel.cronWeekdaysPlaceholder",
                                  "Select weekdays",
                                )}
                                allowCustom={false}
                                max={7}
                                maxVisible={3}
                              />
                            </div>

                            <div className="w-[220px] shrink-0 space-y-1">
                              <Label
                                className="sr-only"
                                htmlFor="job-cron-weekly-time"
                              >
                                {t(
                                  "agent.panels.scheduledJobsPanel.scheduleTime",
                                  "Schedule Time",
                                )}
                              </Label>
                              <TimePicker
                                id="job-cron-weekly-time"
                                value={form.cronTime}
                                onChange={(timeValue) => {
                                  setForm((prev) => {
                                    if (!prev) return prev;
                                    const cronTime = timeValue || "00:00";
                                    const effectiveWeekdays =
                                      prev.cronWeekdays.length > 0
                                        ? prev.cronWeekdays
                                        : getDefaultCronWeekdays();
                                    return {
                                      ...prev,
                                      cronTime,
                                      cronWeekdays: effectiveWeekdays,
                                      cronExpression:
                                        generateCronExpressionFromPreset(
                                          "weekly",
                                          cronTime,
                                          effectiveWeekdays,
                                          [],
                                        ),
                                    };
                                  });
                                }}
                                placeholder=""
                              />
                            </div>
                          </>
                        )}

                        {form.cronPreset === "monthly" && (
                          <>
                            <div className="w-[220px] shrink-0 space-y-1">
                              <Label
                                className="sr-only"
                                htmlFor="job-cron-monthdays"
                              >
                                {t(
                                  "agent.panels.scheduledJobsPanel.cronMonthDays",
                                  "Dates",
                                )}
                              </Label>
                              <MultiCombobox
                                options={Array.from({ length: 31 }, (_, i) => {
                                  const day = i + 1;
                                  return {
                                    value: String(day),
                                    label: String(day),
                                  };
                                })}
                                value={form.cronMonthDays}
                                onChange={(nextMonthDays) => {
                                  setForm((prev) => {
                                    if (!prev) return prev;
                                    const effectiveMonthDays =
                                      nextMonthDays.length > 0
                                        ? nextMonthDays
                                        : getDefaultCronMonthDays();
                                    return {
                                      ...prev,
                                      cronMonthDays: effectiveMonthDays,
                                      cronExpression:
                                        generateCronExpressionFromPreset(
                                          "monthly",
                                          prev.cronTime || "00:00",
                                          [],
                                          effectiveMonthDays,
                                        ),
                                    };
                                  });
                                }}
                                placeholder={t(
                                  "agent.panels.scheduledJobsPanel.cronMonthDaysPlaceholder",
                                  "Select date",
                                )}
                                allowCustom={false}
                                max={31}
                                maxVisible={3}
                              />
                            </div>

                            <div className="w-[220px] shrink-0 space-y-1">
                              <Label
                                className="sr-only"
                                htmlFor="job-cron-monthly-time"
                              >
                                {t(
                                  "agent.panels.scheduledJobsPanel.scheduleTime",
                                  "Schedule Time",
                                )}
                              </Label>
                              <TimePicker
                                id="job-cron-monthly-time"
                                value={form.cronTime}
                                onChange={(timeValue) => {
                                  setForm((prev) => {
                                    if (!prev) return prev;
                                    const cronTime = timeValue || "00:00";
                                    const effectiveMonthDays =
                                      prev.cronMonthDays.length > 0
                                        ? prev.cronMonthDays
                                        : getDefaultCronMonthDays();
                                    return {
                                      ...prev,
                                      cronTime,
                                      cronMonthDays: effectiveMonthDays,
                                      cronExpression:
                                        generateCronExpressionFromPreset(
                                          "monthly",
                                          cronTime,
                                          [],
                                          effectiveMonthDays,
                                        ),
                                    };
                                  });
                                }}
                                placeholder=""
                              />
                            </div>
                          </>
                        )}

                        {form.cronPreset === "custom" && (
                          <div className="w-[220px] shrink-0 space-y-1">
                            <Label className="sr-only" htmlFor="job-cron">
                              {t(
                                "agent.panels.scheduledJobsPanel.cronExpression",
                                "Cron Expression",
                              )}
                            </Label>
                            <Input
                              id="job-cron"
                              value={form.cronExpression}
                              onChange={(event) => {
                                setForm((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        cronExpression: event.target.value,
                                        cronPreset: "custom",
                                      }
                                    : prev,
                                );
                              }}
                              placeholder={t(
                                "agent.panels.scheduledJobsPanel.cronExpression",
                                "Cron Expression",
                              )}
                            />
                          </div>
                        )}
                      </>
                    )}
                    {form.scheduleType === "interval-hours" && (
                      <div className="w-[220px] shrink-0 space-y-1">
                        <Label className="sr-only" htmlFor="job-interval-hours">
                          {t(
                            "agent.panels.scheduledJobsPanel.intervalHours",
                            "Hours",
                          )}
                        </Label>
                        <Input
                          id="job-interval-hours"
                          type="number"
                          min={1}
                          value={form.intervalHours}
                          onChange={(event) =>
                            setForm((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    intervalHours:
                                      Number.parseInt(event.target.value, 10) ||
                                      1,
                                  }
                                : prev,
                            )
                          }
                          placeholder={t(
                            "agent.panels.scheduledJobsPanel.intervalHours",
                            "Hours",
                          )}
                        />
                      </div>
                    )}
                    {form.scheduleType === "interval-minutes" && (
                      <div className="w-[220px] shrink-0 space-y-1">
                        <Label
                          className="sr-only"
                          htmlFor="job-interval-minutes"
                        >
                          {t(
                            "agent.panels.scheduledJobsPanel.intervalMinutes",
                            "Minutes",
                          )}
                        </Label>
                        <Input
                          id="job-interval-minutes"
                          type="number"
                          min={1}
                          value={form.intervalMinutes}
                          onChange={(event) =>
                            setForm((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    intervalMinutes:
                                      Number.parseInt(event.target.value, 10) ||
                                      1,
                                  }
                                : prev,
                            )
                          }
                          placeholder={t(
                            "agent.panels.scheduledJobsPanel.intervalMinutes",
                            "Minutes",
                          )}
                        />
                      </div>
                    )}
                    {form.scheduleType === "once" && (
                      <>
                        <div className="w-[220px] shrink-0 space-y-1">
                          <Label className="sr-only" htmlFor="job-once-date">
                            {t(
                              "agent.panels.scheduledJobsPanel.scheduleDate",
                              "Schedule Date",
                            )}
                          </Label>
                          <DatePicker
                            id="job-once-date"
                            value={getDatePartFromDateTime(form.scheduledAt)}
                            onChange={(dateValue) =>
                              setForm((prev) => {
                                if (!prev) return prev;
                                return {
                                  ...prev,
                                  scheduledAt: dateValue
                                    ? `${dateValue}T${onceTimeDraft || "00:00"}`
                                    : "",
                                };
                              })
                            }
                            placeholder={t(
                              "agent.panels.scheduledJobsPanel.scheduleDate",
                              "Schedule Date",
                            )}
                            clearLabel={t("common.clear", "Clear")}
                            todayLabel={t("common.today", "Today")}
                          />
                        </div>
                        <div className="w-[220px] shrink-0 space-y-1">
                          <Label className="sr-only" htmlFor="job-once-time">
                            {t(
                              "agent.panels.scheduledJobsPanel.scheduleTime",
                              "Schedule Time",
                            )}
                          </Label>
                          <TimePicker
                            id="job-once-time"
                            value={onceTimeDraft}
                            onChange={(timeValue) =>
                              setForm((prev) => {
                                setOnceTimeDraft(timeValue || "00:00");
                                if (!prev) return prev;
                                const nextDate = getDatePartFromDateTime(
                                  prev.scheduledAt,
                                );
                                if (!nextDate) {
                                  return prev;
                                }
                                return {
                                  ...prev,
                                  scheduledAt: `${nextDate}T${timeValue || "00:00"}`,
                                };
                              })
                            }
                            placeholder=""
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                      {t(
                        "agent.panels.scheduledJobsPanel.executionHistory",
                        "Execution history",
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {!loadingExecutions && (
                        <div className="text-sm font-normal leading-none text-muted-foreground whitespace-nowrap">
                          {t("agent.panels.scheduledJobsPanel.runCount", {
                            defaultValue: "{{count}} total, {{failed}} failed",
                            count: executionHistorySummary.total,
                            failed: executionHistorySummary.failed,
                          })}
                        </div>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={handleRefresh}
                            disabled={refreshing}
                            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                            aria-label={t(
                              "agent.panels.scheduledJobsPanel.refresh",
                              "Refresh",
                            )}
                          >
                            {refreshing ? (
                              <Spinner size={14} />
                            ) : (
                              <RemixIcon name="refresh" size="size-4" />
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <span>
                            {refreshing
                              ? t(
                                  "agent.panels.scheduledJobsPanel.refreshing",
                                  "Refreshing...",
                                )
                              : t(
                                  "agent.panels.scheduledJobsPanel.refresh",
                                  "Refresh",
                                )}
                          </span>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </div>
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                  {loadingExecutions ? (
                    <div className="flex items-center justify-center py-8 text-muted-foreground">
                      <Spinner size={18} />
                      <span className="ml-2">
                        {t("common.loading", "Loading...")}
                      </span>
                    </div>
                  ) : executions.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">
                      {t(
                        "agent.panels.scheduledJobsPanel.noHistory",
                        "No execution history",
                      )}
                    </div>
                  ) : (
                    <>
                      {executions.map((execution) => {
                        const statusBadgeVisual = getExecutionStatusBadgeVisual(
                          execution.status,
                        );
                        const triggerVisual = getExecutionTriggerVisual(
                          execution.triggeredBy,
                        );
                        const durationText =
                          getExecutionDurationDisplay(execution);
                        const hasPreview =
                          !!execution.error ||
                          !!execution.output ||
                          !!execution.result?.message ||
                          !!execution.result?.chatId;
                        return (
                          <button
                            key={execution.id}
                            type="button"
                            className="flex w-full items-center justify-between gap-3 border-b border-border px-4 py-4 text-left transition-colors hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-70 last:border-b-0"
                            onClick={() => {
                              if (!hasPreview) return;
                              openExecutionResultPreviewInSidePanel(execution);
                            }}
                            disabled={!hasPreview}
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-2 text-foreground">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex shrink-0">
                                    <RemixIcon
                                      name={triggerVisual.icon}
                                      className="size-5 shrink-0 text-foreground"
                                    />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <span>{triggerVisual.label}</span>
                                </TooltipContent>
                              </Tooltip>
                              <span className="truncate text-base font-normal leading-none tracking-tight">
                                {new Date(execution.startedAt).toLocaleString()}
                              </span>
                              <Badge className={statusBadgeVisual.className}>
                                {statusBadgeVisual.label}
                              </Badge>
                            </div>
                            <span
                              className="shrink-0 text-sm tabular-nums text-muted-foreground"
                              title={t(
                                "agent.panels.scheduledJobsPanel.processingDuration",
                                "Processing time",
                              )}
                            >
                              {durationText}
                            </span>
                          </button>
                        );
                      })}
                      {loadingMore && (
                        <div className="flex items-center justify-center py-4 text-muted-foreground">
                          <Spinner size={16} />
                          <span className="ml-2 text-sm">
                            {t("common.loading", "Loading...")}
                          </span>
                        </div>
                      )}
                      {!hasMore && executions.length > 0 && (
                        <div className="py-3 text-center text-sm text-muted-foreground">
                          {t(
                            "agent.panels.scheduledJobsPanel.noMoreHistory",
                            "No more",
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </TwoPaneSidebarLayout>

      {/* File preview overlay */}
      {previewFile && (
        <FilePreviewOverlay
          file={previewFile}
          onClose={closeFilePreviewPanel}
        />
      )}
    </div>
  );
}
