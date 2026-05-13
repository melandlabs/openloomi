"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { isTauri } from "@/lib/tauri";
import { getAuthToken } from "@/lib/auth/token-manager";
import { AI_PROXY_BASE_URL } from "@/lib/env/constants";
import { toast } from "@/components/toast";
import {
  NovelInstructionEditor,
  type NovelInstructionEditorRef,
} from "@/components/novel-instruction-editor";
import "@/i18n";
import { TwoPaneSidebarLayout } from "@/components/layout/two-panel-sidebar-layout";
import { DatePicker } from "@openloomi/ui";
import { TimePicker } from "@openloomi/ui";
import { MultiCombobox } from "@openloomi/ui";
import { Button, Input, Label } from "@openloomi/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { Spinner } from "@/components/spinner";
import { MODELS, type ModelType } from "@/components/agent/model-selector";

type CronPreset = "daily" | "weekly" | "monthly" | "custom";
type CronScheduleSelectValue =
  | "daily"
  | "weekly"
  | "monthly"
  | "cron"
  | "interval-hours"
  | "interval-minutes"
  | "once";

interface EditFormState {
  name: string;
  description: string;
  scheduleType: "cron" | "interval-hours" | "interval-minutes" | "once";
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

/**
 * Unified check for Tauri/desktop availability.
 * - Supports forcing it on in the browser via URL query `forceTauri=1|true|yes`.
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
 * Extracts the date part (YYYY-MM-DD) from a "YYYY-MM-DDTHH:mm" string.
 */
function getDatePartFromDateTime(value: string): string {
  if (!value) return "";
  const [datePart] = value.split("T");
  return datePart ?? "";
}

/**
 * Extracts the time part (HH:mm) from a "YYYY-MM-DDTHH:mm" string, falling back to 00:00 if missing.
 */
function getTimePartFromDateTime(value: string): string {
  if (!value) return "";
  const timeCandidate = value.split("T")[1] ?? "";
  const matched = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeCandidate.slice(0, 5));
  return matched ? `${matched[1]}:${matched[2]}` : "00:00";
}

/**
 * Resolves user's current timezone (browser IANA name, e.g., Asia/Shanghai); falls back to UTC if unavailable.
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

/**
 * Sorts an array of numeric strings in ascending order by numeric value.
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
 * Generates cron expression for the given preset (5 parts: minute hour day month weekday).
 */
function generateCronExpressionFromPreset(
  preset: Exclude<CronPreset, "custom">,
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

  // monthly
  const monthDays =
    cronMonthDays.length > 0 ? cronMonthDays : getDefaultCronMonthDays();
  return `${minute} ${hour} ${sortNumericStrings(monthDays).join(",")} * *`;
}

/**
 * Scheduled task creation page: reuses the layout and form style of the task detail page.
 */
export default function ScheduledJobCreatePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const tauriEnvEnabled = mounted && isTauriEnvEnabled();

  const [isInstructionExpanded, setIsInstructionExpanded] = useState(false);
  const [creating, setCreating] = useState(false);

  const [form, setForm] = useState<EditFormState>({
    name: "",
    description: "",
    scheduleType: "interval-minutes",
    cronExpression: "0 * * * *",
    cronPreset: "custom",
    cronTime: "00:00",
    cronWeekdays: getDefaultCronWeekdays(),
    cronMonthDays: getDefaultCronMonthDays(),
    intervalMinutes: 60,
    intervalHours: 1,
    scheduledAt: "",
    selectedModel: "default",
    enabled: true,
  });

  const [onceTimeDraft, setOnceTimeDraft] = useState<string>("00:00");
  const inlineEditorRef = useRef<NovelInstructionEditorRef>(null);

  /**
   * Instruction/description empty state default text (consistent with the task detail page).
   */
  const descriptionPlaceholder = useMemo(
    () =>
      t(
        "agent.panels.scheduledJobsPanel.descriptionPlaceholder",
        "Search yesterday's AI industry news, compile it into a brief, and send it to my Gmail inbox.",
      ),
    [t],
  );

  useEffect(() => {
    if (!mounted) return;
    if (form.scheduleType !== "once") return;
    setOnceTimeDraft(getTimePartFromDateTime(form.scheduledAt) || "00:00");
  }, [form.scheduleType, form.scheduledAt, mounted]);

  /**
   * Returns to the task list (does not preserve query).
   */
  const handleBackToList = useCallback(() => {
    router.push("/scheduled-jobs");
  }, [router]);

  /**
   * Toggles the instruction input expand/collapse state.
   */
  const handleToggleInstructionExpanded = useCallback(() => {
    setIsInstructionExpanded((prev) => !prev);
  }, []);

  /**
   * Opens the "Add tracking event" picker inside the main input editor.
   */
  const handleOpenInlineEventPicker = useCallback(() => {
    inlineEditorRef.current?.openEventPicker();
  }, []);

  /**
   * Opens the "Select skill" picker inside the main input editor.
   */
  const handleOpenInlineSkillPicker = useCallback(() => {
    inlineEditorRef.current?.openSkillPicker();
  }, []);

  const canCreate = useMemo(() => {
    return Boolean(form.name.trim() && form.description.trim());
  }, [form.description, form.name]);

  /**
   * Handles creation: submits the form and navigates to the new task detail page.
   */
  const handleCreate = useCallback(async () => {
    if (creating) return;
    if (!canCreate) return;

    // For one-time tasks, scheduledAt must be parseable as a valid time
    if (form.scheduleType === "once") {
      const scheduledDate = form.scheduledAt
        ? new Date(form.scheduledAt)
        : null;
      if (!scheduledDate || Number.isNaN(scheduledDate.getTime())) {
        toast({
          type: "error",
          description: `${t("agent.panels.scheduledJobsPanel.scheduleDate", "Schedule Date")}: invalid`,
        });
        return;
      }
    }

    setCreating(true);

    try {
      const userTz = getResolvedUserTimezone();

      const computedCronExpression =
        form.scheduleType === "cron" && form.cronPreset !== "custom"
          ? generateCronExpressionFromPreset(
              form.cronPreset,
              form.cronTime,
              form.cronWeekdays,
              form.cronMonthDays,
            )
          : form.cronExpression;

      const schedule =
        form.scheduleType === "cron"
          ? {
              type: "cron" as const,
              expression: computedCronExpression,
              timezone: userTz,
            }
          : form.scheduleType === "interval-hours"
            ? { type: "interval-hours" as const, hours: form.intervalHours }
            : form.scheduleType === "interval-minutes"
              ? {
                  type: "interval-minutes" as const,
                  minutes: form.intervalMinutes,
                }
              : { type: "once" as const, at: new Date(form.scheduledAt) };

      const cloudAuthToken = getAuthToken() || undefined;
      const modelConfig =
        isTauriEnvEnabled() && cloudAuthToken
          ? {
              baseUrl: AI_PROXY_BASE_URL,
              apiKey: cloudAuthToken,
              ...(form.selectedModel !== "default"
                ? { model: form.selectedModel }
                : {}),
            }
          : undefined;

      const response = await fetch("/api/scheduled-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description || null,
          schedule,
          job: {
            type: "custom" as const,
            handler: "",
          },
          modelConfig,
          enabled: form.enabled,
          timezone: userTz,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData?.error || `Failed to create: ${response.statusText}`,
        );
      }

      const data = await response.json();
      const createdJob = data?.job;
      const createdJobId: string | undefined = createdJob?.id;

      if (!createdJobId) {
        throw new Error("Missing created job id in response");
      }

      const currentQuery = searchParams.toString();
      const querySuffix = currentQuery ? `?${currentQuery}` : "";

      toast({
        type: "success",
        description: t(
          "agent.panels.scheduledJobsPanel.detail.saveSuccess",
          "Task saved",
        ),
      });

      router.push(
        `/scheduled-jobs/${encodeURIComponent(createdJobId)}${querySuffix}`,
      );
    } catch (error) {
      toast({
        type: "error",
        description:
          t("agent.panels.scheduledJobsPanel.detail.saveError", "Save failed") +
          (error instanceof Error ? `: ${error.message}` : ""),
      });
    } finally {
      setCreating(false);
    }
  }, [canCreate, creating, form, searchParams, t, toast, router]);

  if (!mounted) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-muted-foreground">
        <p className="text-sm">{t("common.loading", "Loading...")}</p>
      </div>
    );
  }

  if (!tauriEnvEnabled) {
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

  const scheduleSelectValue: CronScheduleSelectValue =
    form.scheduleType === "cron"
      ? form.cronPreset === "daily" ||
        form.cronPreset === "weekly" ||
        form.cronPreset === "monthly"
        ? form.cronPreset
        : "cron"
      : (form.scheduleType as CronScheduleSelectValue);

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
              {t("agent.panels.scheduledJobsPanel.newTask", "New Task")}
            </h1>
          </div>

          <div className="flex items-center gap-[8px]">
            <Button
              variant="outline"
              size="sm"
              onClick={handleBackToList}
              disabled={creating}
              className="h-8"
            >
              {t("common.cancel", "Cancel")}
            </Button>

            <Button
              variant="default"
              size="sm"
              onClick={handleCreate}
              disabled={!canCreate || creating}
              className="h-8 gap-0"
            >
              {creating ? (
                <>
                  <Spinner size={12} />
                  <span className="ml-2">
                    {t("common.creating", "Creating")}
                  </span>
                </>
              ) : (
                <>
                  <RemixIcon name="add" className="mr-2 size-4" />
                  {t("common.create", "Create")}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      <TwoPaneSidebarLayout
        isSidebarOpen={false}
        breakpoint="lg"
        sidebarClassName="lg:min-w-[420px] lg:max-w-[420px]"
      >
        <div className="flex-1 min-h-0 overflow-auto p-0">
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
                    setForm((prev) => ({ ...prev, name: event.target.value }))
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
                        onClick={handleOpenInlineEventPicker}
                      >
                        <span className="font-mono leading-none">@</span>
                        {t("chat.addEvent", "Add tracking event")}
                      </Button>
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
                          isInstructionExpanded ? "arrow_up_s" : "arrow_down_s"
                        }
                        size="size-4"
                      />
                    </Button>
                  </div>
                  <NovelInstructionEditor
                    ref={inlineEditorRef}
                    id="new-job-inline-description-editor"
                    value={form.description}
                    onChange={(next) =>
                      setForm((prev) => ({ ...prev, description: next }))
                    }
                    placeholder={descriptionPlaceholder}
                    showSkillEventButtons={false}
                    className="flex-1 min-h-0 border-0 rounded-none bg-transparent"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-[8px]">
                <Label htmlFor="job-model">
                  {t("agent.panels.scheduledJobsPanel.model", "Model")}
                </Label>
                <Select
                  value={form.selectedModel}
                  onValueChange={(value: ModelType) => {
                    setForm((prev) => ({ ...prev, selectedModel: value }));
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
                      value={scheduleSelectValue}
                      onValueChange={(value: CronScheduleSelectValue) => {
                        setForm((prev) => {
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
                              cronMonthDays: [],
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
                            cronWeekdays: [],
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
                            "agent.panels.scheduledJobsPanel.oneTime",
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

                  {form.scheduleType === "cron" &&
                    form.cronPreset === "daily" && (
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

                  {form.scheduleType === "cron" &&
                    form.cronPreset === "weekly" && (
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

                  {form.scheduleType === "cron" &&
                    form.cronPreset === "monthly" && (
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
                              return { value: String(day), label: String(day) };
                            })}
                            value={form.cronMonthDays}
                            onChange={(nextMonthDays) => {
                              setForm((prev) => {
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
                              "Select dates",
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

                  {form.scheduleType === "cron" &&
                    form.cronPreset === "custom" && (
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
                            setForm((prev) => ({
                              ...prev,
                              cronExpression: event.target.value,
                              cronPreset: "custom",
                            }));
                          }}
                          placeholder={t(
                            "agent.panels.scheduledJobsPanel.cronExpression",
                            "Cron Expression",
                          )}
                        />
                      </div>
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
                        onChange={(event) => {
                          const next =
                            Number.parseInt(event.target.value, 10) || 1;
                          setForm((prev) => ({
                            ...prev,
                            intervalHours: next,
                          }));
                        }}
                        placeholder={t(
                          "agent.panels.scheduledJobsPanel.intervalHours",
                          "Hours",
                        )}
                      />
                    </div>
                  )}

                  {form.scheduleType === "interval-minutes" && (
                    <div className="w-[220px] shrink-0 space-y-1">
                      <Label className="sr-only" htmlFor="job-interval-minutes">
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
                        onChange={(event) => {
                          const next =
                            Number.parseInt(event.target.value, 10) || 1;
                          setForm((prev) => ({
                            ...prev,
                            intervalMinutes: next,
                          }));
                        }}
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
                          onChange={(dateValue) => {
                            setForm((prev) => ({
                              ...prev,
                              scheduledAt: dateValue
                                ? `${dateValue}T${onceTimeDraft || "00:00"}`
                                : "",
                            }));
                          }}
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
                          onChange={(timeValue) => {
                            const nextTime = timeValue || "00:00";
                            setOnceTimeDraft(nextTime);
                            setForm((prev) => {
                              const nextDate = getDatePartFromDateTime(
                                prev.scheduledAt,
                              );
                              if (!nextDate) return prev;
                              return {
                                ...prev,
                                scheduledAt: `${nextDate}T${nextTime}`,
                              };
                            });
                          }}
                          placeholder=""
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </TwoPaneSidebarLayout>
    </div>
  );
}
