/**
 * Scheduled Jobs Management Component
 * Provides UI for managing cron jobs
 * Can be used as a standalone page or as a right panel
 */

"use client";

import {
  useCallback,
  useState,
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
  useId,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { toast } from "./toast";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { SkillEventInput } from "./skill-event-input";
import { Switch } from "./ui/switch";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { AgentSectionHeader } from "./agent/section-header";
import { RemixIcon } from "@/components/remix-icon";
import { cn } from "@/lib/utils";
import "../i18n";
import { getAuthToken } from "@/lib/auth/token-manager";
import { DEFAULT_AI_MODEL, AI_PROXY_BASE_URL } from "@/lib/env/constants";

/** AI avatar style class name for scheduled jobs empty state */
const SCHEDULED_JOBS_EMPTY_AVATAR_CLASS = "size-48";

/**
 * Determines whether the "Desktop Environment Agent Mode" should be enabled (for browser-side debugging).
 * Supports forcing it on in browser via URL query `forceTauri=1|true|yes`.
 */
function isTauriEnvEnabled(): boolean {
  if (typeof window !== "undefined") {
    const forceTauri = new URLSearchParams(window.location.search)
      .get("forceTauri")
      ?.toLowerCase();
    if (forceTauri === "1" || forceTauri === "true" || forceTauri === "yes") {
      return true;
    }

    return !!(window as any).__TAURI__;
  }

  return process.env.NEXT_PUBLIC_FORCE_WEB_AGENT_DEBUG === "true";
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

/** Panel ref exposed methods, for independent page to open "New Task" dialog in header */
export interface ScheduledJobsPanelRef {
  openCreateDialog: () => void;
}

/**
 * Scheduled jobs list filter status.
 * - `all`: all jobs
 * - `not_executed`: unexecuted/pending jobs (includes pending/running and one-time jobs not in terminal state)
 * - `executed`: executed jobs (one-time jobs with lastStatus in terminal state)
 */
export type ScheduledJobsStatusFilter = "all" | "not_executed" | "executed";

interface ScheduledJobsPanelProps {
  onClose?: () => void;
  className?: string;
  /** When true as independent page, page uses PageSectionHeader to provide title, this component doesn't render AgentSectionHeader */
  hideHeader?: boolean;
  statusFilter?: ScheduledJobsStatusFilter;
  /**
   * Job search term (matches both name and description).
   * When empty string, does not affect current status filter logic.
   */
  searchQuery?: string;
}

interface ScheduledJob {
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
  jobType: string;
  enabled: boolean;
  timezone: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
  runCount: number;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
}

interface CreateJobData {
  name: string;
  description: string;
  scheduleType:
    | "cron"
    | "interval"
    | "interval-hours"
    | "interval-minutes"
    | "once";
  cronExpression: string;
  intervalMinutes: number;
  intervalHours: number;
  scheduledAt: string;
  enabled: boolean;
  timezone: string;
}

export const ScheduledJobsPanel = forwardRef<
  ScheduledJobsPanelRef,
  ScheduledJobsPanelProps
>(function ScheduledJobsPanel(
  {
    onClose,
    className,
    hideHeader = false,
    statusFilter = "all",
    searchQuery = "",
  },
  ref,
) {
  const { t } = useTranslation();
  const router = useRouter();

  useImperativeHandle(ref, () => ({
    /**
     * Navigate to the "New Task" page (replaces the original create dialog)
     */
    openCreateDialog: () => {
      const query =
        typeof window !== "undefined" && window.location.search
          ? window.location.search
          : "";
      router.push(`/scheduled-jobs/new${query}`);
    },
  }));

  // Check if running in Tauri environment
  const [isTauri, setIsTauri] = useState(false);

  // All hooks must be declared before any early returns
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<ScheduledJob | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [executingJobIds, setExecutingJobIds] = useState<Set<string>>(
    new Set(),
  );
  const jobsRef = useRef<ScheduledJob[]>([]); // Track jobs for refresh logic
  const deleteDialogDescId = useId();

  // Split jobs into active and executed based on scheduleType and lastStatus
  // One-time jobs stay in active while running or pending; move to executed only after terminal status
  const executedJobs = jobs.filter(
    (job) =>
      job.scheduleType === "once" &&
      job.lastStatus !== null &&
      job.lastStatus !== "running",
  );
  const activeJobs = jobs.filter(
    (job) => !executedJobs.some((e) => e.id === job.id),
  );

  const executedJobIdSet = new Set(executedJobs.map((job) => job.id));

  /**
   * Return the task list to render based on external filter state.
   * To minimize UI changes, `all` defaults to concatenating active tasks first, then executed tasks.
   */
  const filteredJobs =
    statusFilter === "executed"
      ? executedJobs
      : statusFilter === "not_executed"
        ? activeJobs
        : [...activeJobs, ...executedJobs];

  /**
   * Check if current task matches search query (name/description).
   */
  function jobMatchesSearch(job: ScheduledJob, query: string): boolean {
    return (
      job.name.toLowerCase().includes(query) ||
      (job.description ?? "").toLowerCase().includes(query)
    );
  }

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const displayedJobs =
    normalizedSearchQuery.length > 0
      ? filteredJobs.filter((job) =>
          jobMatchesSearch(job, normalizedSearchQuery),
        )
      : filteredJobs;
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // Track current timer
  const isMountedRef = useRef(true); // Track if component is mounted
  const [formData, setFormData] = useState<CreateJobData>({
    name: "",
    description: "",
    scheduleType: "interval-minutes",
    cronExpression: "0 * * * *",
    intervalMinutes: 60,
    intervalHours: 1,
    scheduledAt: "",
    enabled: true,
    timezone: "UTC",
  });

  const fetchJobs = async () => {
    // Note: Removed isMounted check to ensure fetch always runs

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 10000); // 10s timeout

      const response = await fetch("/api/scheduled-jobs?includeDisabled=true", {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(
          "Failed to fetch jobs:",
          response.status,
          response.statusText,
        );
        setLoading(false);
        return;
      }

      const data = await response.json();
      const fetchedJobs = data.jobs || [];
      setJobs(fetchedJobs);
      jobsRef.current = fetchedJobs; // Update ref for refresh logic
    } catch (error) {
      console.error("Failed to fetch jobs:", error);
    } finally {
      // Always set loading to false when done (whether success or error)
      // If component is unmounted, React will ignore this state update
      setLoading(false);
    }
  };

  useEffect(() => {
    // Only show in Tauri/desktop environment (or forced mode)
    setIsTauri(isTauriEnvEnabled());
  }, []);

  useEffect(() => {
    // Initial fetch
    fetchJobs();

    // Auto-refresh to show latest status
    // Refresh more frequently when jobs are running
    const scheduleNextRefresh = () => {
      // Skip if component is unmounted
      if (!isMountedRef.current) return;

      // Check if any job is running using the ref to get latest state
      const hasRunningJob = jobsRef.current.some(
        (job) => job.lastStatus === "running",
      );
      const interval = hasRunningJob ? 5000 : 30000; // 5s if running, 30s otherwise

      refreshTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          fetchJobs();
          scheduleNextRefresh();
        }
      }, interval);
    };

    // Handle page visibility - pause refresh when page is hidden
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Page is hidden, clear the timer
        if (refreshTimerRef.current) {
          clearTimeout(refreshTimerRef.current);
          refreshTimerRef.current = null;
        }
      } else {
        // Page is visible again, resume refresh
        if (!refreshTimerRef.current) {
          fetchJobs();
          scheduleNextRefresh();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    scheduleNextRefresh();

    return () => {
      // Mark component as unmounted to prevent state updates
      isMountedRef.current = false;
      // Clean up timer on unmount
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      // Remove visibility change listener
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const handleEditJob = async () => {
    if (!editingJob) return;

    try {
      const schedule =
        formData.scheduleType === "cron"
          ? {
              type: "cron" as const,
              expression: formData.cronExpression,
              timezone: formData.timezone,
            }
          : formData.scheduleType === "interval-hours"
            ? { type: "interval-hours" as const, hours: formData.intervalHours }
            : formData.scheduleType === "interval-minutes"
              ? {
                  type: "interval-minutes" as const,
                  minutes: formData.intervalMinutes,
                }
              : { type: "once" as const, at: new Date(formData.scheduledAt) };

      const response = await fetch(`/api/scheduled-jobs/${editingJob.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description || null,
          schedule,
          enabled: formData.enabled,
          timezone: formData.timezone,
        }),
      });

      if (response.ok) {
        await fetchJobs();
        setEditDialogOpen(false);
        setEditingJob(null);
        resetForm();
      }
    } catch (error) {
      console.error("Failed to update job:", error);
    }
  };

  const openEditDialog = (job: ScheduledJob) => {
    setEditingJob(job);
    setFormData({
      name: job.name,
      description: job.description || "",
      scheduleType:
        job.scheduleType === "interval-hours" ||
        job.scheduleType === "interval-minutes" ||
        job.scheduleType === "interval" ||
        job.scheduleType === "cron" ||
        job.scheduleType === "once"
          ? job.scheduleType
          : "interval-minutes",
      cronExpression: job.cronExpression || "0 * * * *",
      intervalMinutes: job.intervalMinutes || 60,
      intervalHours: job.intervalMinutes
        ? Math.floor(job.intervalMinutes / 60)
        : 1,
      scheduledAt: dateTimeInputFromValue(job.scheduledAt),
      enabled: job.enabled,
      timezone: job.timezone,
    });
    setEditDialogOpen(true);
  };

  const handleDeleteJob = async (jobId: string) => {
    setDeletingJobId(jobId);
  };

  const confirmDeleteJob = async () => {
    if (!deletingJobId) return;

    try {
      await fetch(`/api/scheduled-jobs/${deletingJobId}`, { method: "DELETE" });
      await fetchJobs();
      setDeletingJobId(null);
    } catch (error) {
      console.error("Failed to delete job:", error);
      setDeletingJobId(null);
    }
  };

  const handleToggleJob = async (jobId: string, enabled: boolean) => {
    try {
      await fetch(
        `/api/scheduled-jobs/${jobId}?action=${enabled ? "enable" : "disable"}`,
        {
          method: "POST",
        },
      );
      await fetchJobs();
    } catch (error) {
      console.error("Failed to toggle job:", error);
    }
  };

  const handleExecuteJob = async (jobId: string) => {
    // Add to executing set to show loading state
    setExecutingJobIds((prev) => new Set(prev).add(jobId));

    try {
      // Build modelConfig - use cloud auth token if in Tauri mode
      const cloudAuthToken =
        typeof window !== "undefined" ? getAuthToken() || undefined : undefined;
      const modelConfig =
        isTauri && cloudAuthToken
          ? {
              baseUrl: AI_PROXY_BASE_URL,
              apiKey: cloudAuthToken,
              model: DEFAULT_AI_MODEL,
            }
          : undefined;

      // Send request with modelConfig in body
      const response = await fetch(
        `/api/scheduled-jobs/${jobId}?action=execute`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modelConfig }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Failed to execute job:", response.statusText, errorData);
        toast({
          type: "error",
          description: t(
            "agent.panels.scheduledJobsPanel.executeError",
            "Execution failed: {{error}}",
            { error: errorData.error || response.statusText },
          ),
        });
        // Remove from executing set on error
        setExecutingJobIds((prev) => {
          const next = new Set(prev);
          next.delete(jobId);
          return next;
        });
        return;
      }

      // After task execution request succeeds, stay on current page

      const data = await response.json();
      console.log("Job executed response:", data);

      // Successfully started execution - show toast
      toast({
        type: "info",
        description: t(
          "agent.panels.scheduledJobsPanel.executing",
          "Task started, check chat window for progress",
        ),
      });

      // Wait a bit before polling to ensure backend has updated status
      setTimeout(async () => {
        let previousStatus: string | null = null;
        let pollCount = 0;
        const maxPolls = 150; // 5 minutes / 2 seconds

        const pollInterval = setInterval(async () => {
          pollCount++;
          await fetchJobs();

          // Get latest job data using functional state update
          setJobs((currentJobs) => {
            const job = currentJobs.find((j) => j.id === jobId);

            if (!job) return currentJobs;

            console.log("Polling job status:", {
              jobId,
              lastStatus: job.lastStatus,
              previousStatus,
              pollCount,
            });

            // Check if execution is complete (no longer running)
            const isComplete =
              job.lastStatus &&
              job.lastStatus !== "running" &&
              previousStatus === "running";

            if (isComplete) {
              clearInterval(pollInterval);

              // Remove from executing set
              setExecutingJobIds((prev) => {
                const next = new Set(prev);
                next.delete(jobId);
                return next;
              });

              if (job.lastStatus === "error") {
                toast({
                  type: "error",
                  description: t(
                    "agent.panels.scheduledJobsPanel.executeError",
                    "Execution failed",
                  ),
                });
              } else if (job.lastStatus === "success") {
                toast({
                  type: "success",
                  description: t(
                    "agent.panels.scheduledJobsPanel.executeSuccess",
                    "Task executed successfully",
                  ),
                });
              }
            } else if (pollCount >= maxPolls) {
              // Timeout - remove from executing set
              clearInterval(pollInterval);
              setExecutingJobIds((prev) => {
                const next = new Set(prev);
                next.delete(jobId);
                return next;
              });
            }

            previousStatus = job.lastStatus;
            return currentJobs;
          });
        }, 2000); // Poll every 2 seconds
      }, 2000); // Initial delay of 2 seconds
    } catch (error) {
      console.error("Failed to execute job:", error);
      toast({
        type: "error",
        description: t(
          "agent.panels.scheduledJobsPanel.executeError",
          "Execution failed: {{error}}",
          { error: error instanceof Error ? error.message : "Unknown error" },
        ),
      });
      // Remove from executing set on error
      setExecutingJobIds((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      scheduleType: "interval-minutes",
      cronExpression: "0 * * * *",
      intervalMinutes: 60,
      intervalHours: 1,
      scheduledAt: "",
      enabled: true,
      timezone: "UTC",
    });
  };

  const formatSchedule = (job: ScheduledJob) => {
    if (job.scheduleType === "cron") {
      return t(
        "agent.panels.scheduledJobsPanel.jobExecutions.cronExpressionFormat",
        {
          defaultValue: "Cron: {{expression}}",
          expression: job.cronExpression || "",
        },
      );
    }
    if (job.scheduleType === "interval-hours") {
      const hours = job.intervalMinutes ? job.intervalMinutes / 60 : 1;
      return t("agent.panels.scheduledJobsPanel.everyHours", {
        defaultValue: "Every {{hours}} hours",
        hours: hours,
      });
    }
    if (job.scheduleType === "interval-minutes") {
      return t("agent.panels.scheduledJobsPanel.everyMinutes", {
        defaultValue: "Every {{minutes}} min",
        minutes: job.intervalMinutes || 0,
      });
    }
    if (job.scheduleType === "interval") {
      // Legacy support
      return t("agent.panels.scheduledJobsPanel.everyMinutes", {
        defaultValue: "Every {{minutes}} min",
        minutes: job.intervalMinutes || 0,
      });
    }
    if (job.scheduleType === "once") {
      const scheduledAt = job.scheduledAt;
      if (!scheduledAt) {
        return t("agent.panels.scheduledJobsPanel.onceNotScheduled", {
          defaultValue: "Once (not scheduled)",
        });
      }
      return t("agent.panels.scheduledJobsPanel.onceAt", {
        defaultValue: "Once at {{time}}",
        time: formatDateShort(scheduledAt, job.timezone),
      });
    }
    return "Unknown";
  };

  // Format date: YYYY-MM-DD HH:mm, **anchored to the supplied IANA tz**.
  // We can't use `date.getHours()` because it returns the host browser's
  // local time — and on dev boxes / containers the host is usually UTC,
  // which mis-reads Asia/Shanghai-anchored crons as off-by-8h. We use
  // `Intl.DateTimeFormat({ timeZone })` with the runtime's default
  // locale (omit `locale` arg) so we don't trip over locale availability
  // quirks in Tauri webviews, and re-pad every part defensively so the
  // output is always exactly `YYYY-MM-DD HH:mm`.
  const formatDateShort = (dateStr: string, timezone: string) => {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return dateStr;
    const tz = timezone && timezone.length > 0 ? timezone : undefined;
    const pad = (n: number) => String(n).padStart(2, "0");
    try {
      const parts = new Intl.DateTimeFormat(undefined, {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        hourCycle: "h23",
      }).formatToParts(date);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
      // Re-pad every field so `YYYY-MM-DD HH:mm` is invariant across
      // locales (some render `year: "numeric"` as `26` instead of `2026`).
      const y = pad(
        Number.parseInt(get("year"), 10) || date.getUTCFullYear(),
      ).slice(0, 4);
      const m = pad(
        Number.parseInt(get("month"), 10) || date.getUTCMonth() + 1,
      );
      const d = pad(Number.parseInt(get("day"), 10) || date.getUTCDate());
      const h = pad(Number.parseInt(get("hour"), 10) || 0);
      const mi = pad(Number.parseInt(get("minute"), 10) || 0);
      return `${y}-${m}-${d} ${h}:${mi}`;
    } catch {
      // Invalid tz string or Intl unsupported — fall back to the legacy
      // browser-local display so we don't show `NaN-NaN-NaN`.
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
  };

  const getStatusBadge = (status: string | null) => {
    if (!status) return <Badge variant="secondary">Pending</Badge>;
    if (status === "success") return <Badge variant="default">Success</Badge>;
    if (status === "error") return <Badge variant="destructive">Error</Badge>;
    if (status === "running") return <Badge variant="outline">Running</Badge>;
    return <Badge variant="secondary">{status}</Badge>;
  };

  /**
   * Open the details page for a specific task (scheduled-jobs/[id]).
   * Note: Preserve current URL query (e.g., forceTauri) to ensure consistent back/environment-switch behavior.
   */
  const openJobDetails = useCallback(
    /**
     * Open task details.
     */
    (jobId: string) => {
      const query =
        typeof window !== "undefined" && window.location.search
          ? window.location.search
          : "";
      router.push(`/scheduled-jobs/${encodeURIComponent(jobId)}${query}`);
    },
    [router],
  );

  // Don't render if not in Tauri environment
  if (!isTauri) {
    return null;
  }

  /**
   * Render "pending/executing" task cards.
   */
  const renderActiveJobCard = (job: ScheduledJob) => {
    return (
      <Card
        key={job.id}
        className="overflow-hidden cursor-pointer"
        role="button"
        tabIndex={0}
        onClick={() => openJobDetails(job.id)}
        onKeyDown={(e) => {
          // Only trigger on keyboard interaction, avoid affecting child elements like input fields
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openJobDetails(job.id);
          }
        }}
      >
        <CardHeader className="pb-2">
          {/* Use grid so:
              - Title width sticks to content
              - Badge container fills remaining width but badge itself renders at start,
                making it visually attached to the title end
              - Buttons stay on the far right */}
          <div className="grid grid-cols-[minmax(0,auto)_1fr_auto] items-center gap-3">
            <div className="min-w-0 space-y-1">
              <CardTitle
                className="text-base font-medium leading-tight truncate font-serif"
                title={job.name}
              >
                {job.name}
              </CardTitle>
            </div>

            <div className="flex items-center gap-2">
              {job.enabled ? (
                <Badge variant="default" className="whitespace-nowrap">
                  {t("agent.panels.scheduledJobsPanel.enabled", "Enabled")}
                </Badge>
              ) : (
                <Badge variant="secondary" className="whitespace-nowrap">
                  {t("agent.panels.scheduledJobsPanel.disabled", "Disabled")}
                </Badge>
              )}
            </div>

            <div className="flex gap-1 shrink-0">
              {/* Pause/Start first (left), then Execute (right) */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleJob(job.id, !job.enabled);
                    }}
                  >
                    {job.enabled ? (
                      <RemixIcon name="pause_circle" className="size-4" />
                    ) : (
                      <RemixIcon name="play_circle" className="size-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    {t(
                      job.enabled
                        ? "agent.panels.scheduledJobsPanel.disable"
                        : "agent.panels.scheduledJobsPanel.enable",
                      job.enabled
                        ? "Pause scheduled task"
                        : "Start scheduled task",
                    )}
                  </p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExecuteJob(job.id);
                    }}
                    disabled={
                      executingJobIds.has(job.id) ||
                      job.lastStatus === "running"
                    }
                  >
                    {executingJobIds.has(job.id) ||
                    job.lastStatus === "running" ? (
                      <RemixIcon
                        name="loader_2"
                        className="size-4 animate-spin"
                      />
                    ) : (
                      <RemixIcon name="play" className="size-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    {t(
                      "agent.panels.scheduledJobsPanel.executeNow",
                      "Execute this task now",
                    )}
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground text-xs shrink-0">
                {t("agent.panels.scheduledJobsPanel.lastRun", "Last Run:")}
              </span>
              <span className="text-xs shrink-0">
                {job.lastRunAt
                  ? formatDateShort(job.lastRunAt, job.timezone)
                  : t("common.never", "Never")}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground text-xs shrink-0">
                {t("agent.panels.scheduledJobsPanel.nextRun", "Next Run:")}
              </span>
              <span className="text-xs shrink-0">
                {job.nextRunAt
                  ? formatDateShort(job.nextRunAt, job.timezone)
                  : t(
                      "agent.panels.scheduledJobsPanel.notScheduled",
                      "Not scheduled",
                    )}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  /**
   * Render "executed" task cards.
   */
  const renderExecutedJobCard = (job: ScheduledJob) => {
    return (
      <Card
        key={job.id}
        className="overflow-hidden cursor-pointer"
        role="button"
        tabIndex={0}
        onClick={() => openJobDetails(job.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openJobDetails(job.id);
          }
        }}
      >
        <CardHeader className="pb-2">
          <div className="grid grid-cols-[minmax(0,auto)_1fr_auto] items-center gap-3">
            <div className="min-w-0 space-y-1">
              <CardTitle
                className="text-base font-medium leading-tight truncate font-serif"
                title={job.name}
              >
                {job.name}
              </CardTitle>
            </div>

            <div className="flex items-center gap-2">
              {job.lastStatus === "success" ? (
                <Badge variant="default" className="whitespace-nowrap">
                  {t("agent.panels.scheduledJobsPanel.completed", "Completed")}
                </Badge>
              ) : job.lastStatus === "error" ? (
                <Badge variant="destructive" className="whitespace-nowrap">
                  {t("agent.panels.scheduledJobsPanel.error", "Error")}
                </Badge>
              ) : (
                <Badge variant="secondary" className="whitespace-nowrap">
                  {job.lastStatus || "Unknown"}
                </Badge>
              )}
            </div>

            <div />
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground text-xs shrink-0">
                {t("agent.panels.scheduledJobsPanel.lastRun", "Last Run:")}
              </span>
              <span className="text-xs shrink-0">
                {job.lastRunAt
                  ? formatDateShort(job.lastRunAt, job.timezone)
                  : t("common.never", "Never")}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  /** Edit task dialog */
  const editJobDialog = (
    <Dialog
      open={editDialogOpen}
      onOpenChange={(open) => {
        setEditDialogOpen(open);
        if (!open) {
          setEditingJob(null);
          resetForm();
        }
      }}
    >
      <DialogContent
        aria-label={t(
          "agent.panels.scheduledJobsPanel.editJobTitle",
          "Edit Scheduled Job",
        )}
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>
            {t(
              "agent.panels.scheduledJobsPanel.editJobTitle",
              "Edit Scheduled Job",
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">
              {t("agent.panels.scheduledJobsPanel.jobName", "Job Name")} *
            </Label>
            <Input
              id="edit-name"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              placeholder={t(
                "agent.panels.scheduledJobsPanel.jobNamePlaceholder",
                "My scheduled task",
              )}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-description">
              {t("agent.panels.scheduledJobsPanel.description", "Description")}{" "}
              *
            </Label>
            <SkillEventInput
              id="edit-description"
              value={formData.description}
              onChange={(value) =>
                setFormData({ ...formData, description: value })
              }
              placeholder={t(
                "agent.panels.scheduledJobsPanel.descriptionPlaceholder",
                "What does this job do?",
              )}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-scheduleType">
              {t(
                "agent.panels.scheduledJobsPanel.scheduleType",
                "Schedule Type",
              )}{" "}
              *
            </Label>
            <Select
              value={formData.scheduleType}
              onValueChange={(
                value:
                  | "cron"
                  | "interval"
                  | "interval-hours"
                  | "interval-minutes"
                  | "once",
              ) => setFormData({ ...formData, scheduleType: value })}
            >
              <SelectTrigger id="edit-scheduleType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
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
                  {t("agent.panels.scheduledJobsPanel.oneTime", "One-time")}
                </SelectItem>
                <SelectItem value="cron">
                  {t(
                    "agent.panels.scheduledJobsPanel.cronExpression",
                    "Cron Expression",
                  )}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {formData.scheduleType === "interval-hours" && (
            <div className="space-y-2">
              <Label htmlFor="edit-intervalHours">
                {t("agent.panels.scheduledJobsPanel.intervalHours", "Hours")}
              </Label>
              <Input
                id="edit-intervalHours"
                type="number"
                min={1}
                value={formData.intervalHours}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    intervalHours: Number.parseInt(e.target.value, 10) || 1,
                  })
                }
              />
            </div>
          )}

          {formData.scheduleType === "interval-minutes" && (
            <div className="space-y-2">
              <Label htmlFor="edit-intervalMinutes">
                {t(
                  "agent.panels.scheduledJobsPanel.intervalMinutes",
                  "Interval (minutes)",
                )}{" "}
                *
              </Label>
              <Input
                id="edit-intervalMinutes"
                type="number"
                min={1}
                value={formData.intervalMinutes}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    intervalMinutes: Number.parseInt(e.target.value) || 60,
                  })
                }
              />
            </div>
          )}

          {formData.scheduleType === "cron" && (
            <div className="space-y-2">
              <Label htmlFor="edit-cronExpression">
                {t(
                  "agent.panels.scheduledJobsPanel.cronExpression",
                  "Cron Expression",
                )}{" "}
                *
              </Label>
              <Input
                id="edit-cronExpression"
                value={formData.cronExpression}
                onChange={(e) =>
                  setFormData({ ...formData, cronExpression: e.target.value })
                }
                placeholder="0 * * * *"
              />
              <p className="text-xs text-muted-foreground">
                {t(
                  "agent.panels.scheduledJobsPanel.cronHelp",
                  "Format: minute hour day month weekday",
                )}
              </p>
            </div>
          )}

          {formData.scheduleType === "once" && (
            <div className="space-y-2">
              <Label htmlFor="edit-scheduledAt">
                {t(
                  "agent.panels.scheduledJobsPanel.scheduledAt",
                  "Scheduled Time",
                )}{" "}
                *
              </Label>
              <Input
                id="edit-scheduledAt"
                type="datetime-local"
                value={formData.scheduledAt}
                onChange={(e) =>
                  setFormData({ ...formData, scheduledAt: e.target.value })
                }
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="edit-timezone">
              {t("agent.panels.scheduledJobsPanel.timezone", "Timezone")}
            </Label>
            <Select
              value={formData.timezone}
              onValueChange={(value) =>
                setFormData({ ...formData, timezone: value })
              }
            >
              <SelectTrigger id="edit-timezone" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="UTC">UTC</SelectItem>
                <SelectItem value="America/New_York">
                  America/New_York
                </SelectItem>
                <SelectItem value="America/Los_Angeles">
                  America/Los_Angeles
                </SelectItem>
                <SelectItem value="Europe/London">Europe/London</SelectItem>
                <SelectItem value="Europe/Paris">Europe/Paris</SelectItem>
                <SelectItem value="Asia/Tokyo">Asia/Tokyo</SelectItem>
                <SelectItem value="Asia/Shanghai">Asia/Shanghai</SelectItem>
                <SelectItem value="Asia/Singapore">Asia/Singapore</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="edit-enabled">
              {t("agent.panels.scheduledJobsPanel.enabled", "Enabled")}
            </Label>
            <Switch
              id="edit-enabled"
              checked={formData.enabled}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, enabled: checked })
              }
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setEditDialogOpen(false);
              setEditingJob(null);
              resetForm();
            }}
          >
            {t("common.cancel", "Cancel")}
          </Button>
          <Button
            onClick={handleEditJob}
            disabled={!formData.name || !formData.description}
          >
            {t("agent.panels.scheduledJobsPanel.saveChanges", "Save Changes")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  /** Header right side action area: create button + close button */
  const headerActions = (
    <>
      {!hideHeader && (
        <Button
          size="sm"
          onClick={() => {
            const query =
              typeof window !== "undefined" && window.location.search
                ? window.location.search
                : "";
            router.push(`/scheduled-jobs/new${query}`);
          }}
        >
          <RemixIcon name="add" className="mr-2 size-4" />
          {t("agent.panels.scheduledJobsPanel.newTask", "New Task")}
        </Button>
      )}
      {onClose && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={onClose}
          aria-label={t("common.close", "Close")}
        >
          <RemixIcon name="sidebar_fold" className="size-4" />
        </Button>
      )}
    </>
  );

  if (loading) {
    return (
      <div className={cn("flex flex-col h-full", className)}>
        {!hideHeader && (
          <AgentSectionHeader
            title={
              <div className="flex items-center gap-2">
                <span>
                  {t("agent.panels.scheduledJobsPanel.title", "Scheduled Jobs")}
                </span>
              </div>
            }
          >
            {onClose && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={onClose}
                aria-label={t("common.close", "Close")}
              >
                <RemixIcon name="sidebar_fold" size="size-4" />
              </Button>
            )}
          </AgentSectionHeader>
        )}
        {!hideHeader && (
          <AgentSectionHeader
            title={t("agent.panels.scheduledJobsPanel.title", "Scheduled Jobs")}
          >
            {onClose && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={onClose}
                aria-label={t("common.close", "Close")}
              >
                <RemixIcon name="sidebar_fold" className="size-4" />
              </Button>
            )}
          </AgentSectionHeader>
        )}
        <div className="flex-1 flex items-center justify-center p-4 text-muted-foreground">
          {t("agent.panels.scheduledJobsPanel.loading", "Loading jobs...")}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {!hideHeader && (
        <AgentSectionHeader
          title={
            <div className="flex items-center gap-2">
              <span>
                {t("agent.panels.scheduledJobsPanel.title", "Scheduled Jobs")}
              </span>
              <Badge variant="secondary">
                {activeJobs.length + executedJobs.length}
              </Badge>
            </div>
          }
        >
          <div className="flex items-center gap-2">{headerActions}</div>
        </AgentSectionHeader>
      )}
      {editJobDialog}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-0 py-0">
        {displayedJobs.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            {statusFilter === "executed"
              ? t(
                  "agent.panels.scheduledJobsPanel.noExecutedJobs",
                  "No executed jobs yet",
                )
              : t(
                  "agent.panels.scheduledJobsPanel.noJobs",
                  "No scheduled jobs yet",
                )}
          </div>
        ) : (
          <div className="space-y-3">
            {displayedJobs.map((job) =>
              executedJobIdSet.has(job.id)
                ? renderExecutedJobCard(job)
                : renderActiveJobCard(job),
            )}
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <Dialog
        open={!!deletingJobId}
        onOpenChange={(open) => !open && setDeletingJobId(null)}
      >
        <DialogContent aria-describedby={deleteDialogDescId}>
          <DialogHeader>
            <DialogTitle>
              {t(
                "agent.panels.scheduledJobsPanel.deleteConfirmTitle",
                "Delete Job",
              )}
            </DialogTitle>
          </DialogHeader>
          <p id={deleteDialogDescId} className="text-sm text-muted-foreground">
            {t(
              "agent.panels.scheduledJobsPanel.deleteConfirmMessage",
              "Are you sure you want to delete this job?",
            )}
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeletingJobId(null)}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmDeleteJob}>
              {t("common.delete", "Delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
});
