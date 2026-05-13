"use client";

import { useCallback, useMemo, useState, lazy, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { RemixIcon } from "@/components/remix-icon";
import { Button, Input } from "@openloomi/ui";
import { ScrollArea } from "@openloomi/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openloomi/ui";
import { useTodoData } from "@/components/agent/use-todo-data";
import { TodoTaskList } from "@/components/agent/todo-task-list";
import type { AggregatedTask } from "@/components/agent/todo-types";
import type { Insight } from "@/lib/db/schema";
import { useTaskOperations } from "@/hooks/use-task-operations";
import { useSession } from "next-auth/react";
import "../../i18n";

// bundle-dynamic-imports: Dynamically import TaskDetailDialog to reduce initial JS bundle size
const TaskDetailDialogLazy = lazy(() =>
  import("@/components/agent/task-detail-dialog").then((mod) => ({
    default: mod.TaskDetailDialog,
  })),
);

import type { TaskFilterTab } from "./todo-types";
import type { StatusFilter } from "./todo-types";

type TaskBucketKey = "myTasks" | "waitingForMe" | "waitingForOthers";

export type ActionGroupByMode = "none" | "time" | "event";

/**
 * Get date group label for display by date
 */
function getDateGroupLabel(date: Date, locale: string): string {
  const formatter = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "numeric",
    day: "numeric",
  });
  return formatter.format(date);
}

export interface LibraryActionTabProps {
  searchParams: ReadonlyURLSearchParams;
  groupByNoneLabel: string;
  groupByTimeLabel: string;
  groupByEventLabel: string;
}

/**
 * Library Action Tab: action item list, supports no grouping/group by time/group by event, unified layout with Stuff
 */
export function LibraryActionTab({
  searchParams,
  groupByNoneLabel,
  groupByTimeLabel,
  groupByEventLabel,
}: LibraryActionTabProps) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [groupBy, setGroupBy] = useState<ActionGroupByMode>("none");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [taskTypeFilter, setTaskTypeFilter] = useState<TaskFilterTab>("all");
  const { data: session } = useSession();
  const [detailTaskEntry, setDetailTaskEntry] = useState<{
    key: string;
    storageKey: string;
    task: import("@/lib/ai/subagents/insights").InsightTaskItem;
    link: string | null;
    bucketKey: TaskBucketKey;
    insightId: string;
    insight: Insight;
  } | null>(null);

  const { filteredTasks, isLoading, error, mutateInsightList } = useTodoData({
    t,
    statusFilter,
    statusOverrides: {},
  });

  const {
    toggleTaskCompletion,
    loadingMap,
    patchTaskField,
    updateTaskPrioritySimple,
    moveTask,
  } = useTaskOperations();

  const tasks = filteredTasks[taskTypeFilter] ?? filteredTasks.all ?? [];
  const ownerSuggestions = useMemo(() => {
    const names: string[] = [];
    if (session?.user?.name) names.push(session.user.name);
    const fromInsights = new Set<string>();
    tasks.forEach((t) => {
      t.insight?.people?.forEach((p) => p && fromInsights.add(p));
    });
    fromInsights.forEach((p) => {
      if (p && p !== session?.user?.name && !names.includes(p)) names.push(p);
    });
    return names;
  }, [session?.user?.name, tasks]);
  const filteredBySearch = useMemo(() => {
    if (!searchQuery.trim()) return tasks;
    const q = searchQuery.trim().toLowerCase();
    return tasks.filter(
      (task) =>
        task.taskName.toLowerCase().includes(q) ||
        task.insight?.title?.toLowerCase().includes(q),
    );
  }, [tasks, searchQuery]);

  const grouped = useMemo(() => {
    const sortByDate = (a: AggregatedTask, b: AggregatedTask) => {
      const da = taskDate(a);
      const db = taskDate(b);
      return db.getTime() - da.getTime();
    };

    if (groupBy === "none") {
      return [
        {
          label: t("workspace.groupAll", "All"),
          items: [...filteredBySearch].sort(sortByDate),
        },
      ];
    }

    if (groupBy === "time") {
      const byDay = new Map<string, AggregatedTask[]>();
      filteredBySearch.forEach((task) => {
        const d = taskDate(task);
        const dayKey = d.toISOString().slice(0, 10);
        if (!byDay.has(dayKey)) byDay.set(dayKey, []);
        byDay.get(dayKey)?.push(task);
      });
      return Array.from(byDay.entries())
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([dayKey, list]) => ({
          label: getDateGroupLabel(
            new Date(`${dayKey}T12:00:00`),
            i18n.language,
          ),
          items: [...list].sort(sortByDate),
        }));
    }

    if (groupBy === "event") {
      const byInsight = new Map<string, AggregatedTask[]>();
      filteredBySearch.forEach((task) => {
        const key = task.insight.id;
        const label = task.insight.title?.trim() || key;
        if (!byInsight.has(key)) byInsight.set(key, []);
        byInsight.get(key)?.push(task);
      });
      return Array.from(byInsight.entries()).map(([key, list]) => ({
        label: list[0]?.insight?.title?.trim() || key,
        items: [...list].sort(sortByDate),
      }));
    }

    return [];
  }, [filteredBySearch, groupBy, i18n.language, t]);

  const handleMarkComplete = useCallback(
    (task: AggregatedTask) => {
      if (task.bucket && task.taskId) {
        const isCompleted = task.status === "completed";
        toggleTaskCompletion(
          task.insight.id,
          task.taskId,
          task.bucket,
          !isCompleted,
        );
      }
    },
    [toggleTaskCompletion],
  );

  const handleOpenTask = useCallback((task: AggregatedTask) => {
    if (!task.bucket || !task.taskId) return;
    setDetailTaskEntry({
      key: `${task.taskId}|${Date.now()}`,
      storageKey: task.taskId,
      task: {
        id: task.taskId,
        title: task.taskName,
        context: task.context ?? null,
        deadline: task.deadline || null,
        followUpAt: task.rawDeadline || null,
        status: task.status,
        priority: task.priority,
        owner: task.owner ?? null,
        requester: task.requester ?? null,
      },
      link: null,
      bucketKey: task.bucket,
      insightId: task.insight.id,
      insight: task.insight,
    });
  }, []);

  const handleOpenRelatedInsight = useCallback(
    (insight: Insight | null) => {
      if (insight?.id) {
        router.push(`/?insightDetailId=${encodeURIComponent(insight.id)}`);
      }
    },
    [router],
  );

  const statusLabels = useMemo(
    () => ({
      pending: t("insightDetail.todoPending", "Pending"),
      completed: t("insightDetail.todoCompleted", "Completed"),
      blocked: t("insightDetail.todoBlocked", "Blocked"),
      delegated: t("insightDetail.todoDelegated", "Delegated"),
    }),
    [t],
  );

  const typeLabels = useMemo(
    () => ({
      myTasks: t("agent.panels.todo.tabs.myCommitments", "My commitments"),
      isUnreplied: t("agent.panels.todo.tabs.unreplied", "Unreplied"),
      waitingForOthers: t(
        "agent.panels.todo.tabs.othersCommitments",
        "Others' commitments",
      ),
      waitingForMe: t("agent.panels.todo.tabs.waitingForMe", "Waiting for me"),
    }),
    [t],
  );

  return (
    <div className="flex flex-col h-full flex-1 min-w-0">
      {/* Left: filter/group, right: search */}
      <div className="shrink-0 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-6 py-2">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar flex-1 min-w-0">
          <Select
            value={groupBy}
            onValueChange={(v) => setGroupBy(v as ActionGroupByMode)}
          >
            <SelectTrigger className="h-9 w-auto min-w-[5rem] max-w-full shrink-0">
              <SelectValue placeholder="" />
            </SelectTrigger>
            <SelectContent className="[&>*]:justify-start">
              <SelectItem value="none">
                <RemixIcon
                  name="list"
                  size="size-4"
                  className="shrink-0 text-muted-foreground"
                />
                {groupByNoneLabel}
              </SelectItem>
              <SelectItem value="time">
                <RemixIcon
                  name="timer"
                  size="size-4"
                  className="shrink-0 text-muted-foreground"
                />
                {groupByTimeLabel}
              </SelectItem>
              <SelectItem value="event">
                <RemixIcon
                  name="focus"
                  size="size-4"
                  className="shrink-0 text-muted-foreground"
                />
                {groupByEventLabel}
              </SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={taskTypeFilter}
            onValueChange={(v) => setTaskTypeFilter(v as TaskFilterTab)}
          >
            <SelectTrigger className="h-9 w-auto min-w-[5rem] max-w-full shrink-0">
              <SelectValue placeholder="" />
            </SelectTrigger>
            <SelectContent className="[&>*]:justify-start">
              <SelectItem value="all">
                {t("library.filterTypeAll", "All types")}
              </SelectItem>
              <SelectItem value="myTasks">{typeLabels.myTasks}</SelectItem>
              <SelectItem value="waitingForMe">
                {typeLabels.waitingForMe}
              </SelectItem>
              <SelectItem value="waitingForOthers">
                {typeLabels.waitingForOthers}
              </SelectItem>
              <SelectItem value="isUnreplied">
                {typeLabels.isUnreplied}
              </SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as StatusFilter)}
          >
            <SelectTrigger className="h-9 w-auto min-w-[5rem] max-w-full shrink-0">
              <SelectValue placeholder="" />
            </SelectTrigger>
            <SelectContent className="[&>*]:justify-start">
              <SelectItem value="all">
                <RemixIcon
                  name="checkbox_circle"
                  size="size-4"
                  className="shrink-0 text-muted-foreground"
                />
                {t("library.filterStatusAll", "All")}
              </SelectItem>
              <SelectItem value="pending">
                <RemixIcon
                  name="checkbox_circle"
                  size="size-4"
                  className="shrink-0 text-muted-foreground"
                />
                {statusLabels.pending}
              </SelectItem>
              <SelectItem value="completed">
                <RemixIcon
                  name="checkbox_circle"
                  size="size-4"
                  className="shrink-0 text-muted-foreground"
                />
                {statusLabels.completed}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative w-full sm:w-48 min-w-[120px]">
            <RemixIcon
              name="search"
              size="size-4"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <Input
              placeholder={t("library.searchAction", "Search action items")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9 text-sm bg-muted/50 border border-border/60 rounded-md"
            />
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <RemixIcon
              name="loader_2"
              size="size-8"
              className="animate-spin text-muted-foreground"
            />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground text-sm">
            <p>{t("agent.panels.todo.loadFailed", "Failed to load items")}</p>
          </div>
        ) : grouped.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground text-sm">
            <RemixIcon
              name="fact_check"
              size="size-10"
              className="mb-2 opacity-50"
            />
            <p>{t("agent.panels.todo.empty", "No relevant items")}</p>
          </div>
        ) : (
          <div className="px-6 py-3 space-y-6">
            {grouped.map(({ label, items }) => (
              <div key={label}>
                <h2 className="text-sm font-medium text-muted-foreground mb-2">
                  {label}
                </h2>
                <TodoTaskList
                  tasks={items}
                  showCompleted={statusFilter === "all"}
                  statusLabels={statusLabels}
                  typeLabels={typeLabels}
                  loadingMap={loadingMap}
                  pendingTitle={t("agent.panels.todo.pendingGroup", "Pending")}
                  completedTitle={t(
                    "agent.panels.todo.completedGroup",
                    "Completed",
                  )}
                  onMarkComplete={handleMarkComplete}
                  onOpenTask={handleOpenTask}
                  onTaskCreated={() => void mutateInsightList()}
                  renderCardExtra={(task) =>
                    task.insight?.id ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="mt-1 h-8 w-8 text-primary hover:text-primary/90"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(
                            `/?insightDetailId=${encodeURIComponent(task.insight.id)}`,
                          );
                        }}
                        aria-label={t("library.openEvent", "Open event")}
                      >
                        <RemixIcon name="external_link" size="size-4" />
                      </Button>
                    ) : null
                  }
                />
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {detailTaskEntry && (
        <Suspense fallback={null}>
          <TaskDetailDialogLazy
            insightId={detailTaskEntry.insightId}
            insight={detailTaskEntry.insight}
            detailTaskEntry={{
              key: detailTaskEntry.key,
              storageKey: detailTaskEntry.storageKey,
              task: detailTaskEntry.task,
              link: detailTaskEntry.link,
              bucketKey: detailTaskEntry.bucketKey,
            }}
            onClose={() => setDetailTaskEntry(null)}
            toggleTaskCompletion={async (
              storageKey: string,
              bucketKey: TaskBucketKey,
              isCompleted: boolean,
            ) => {
              if (!detailTaskEntry) return;
              await toggleTaskCompletion(
                detailTaskEntry.insightId,
                storageKey,
                bucketKey,
                isCompleted,
              );
            }}
            ownerSuggestions={ownerSuggestions}
            currentUserName={session?.user?.name ?? undefined}
            onTaskUpdated={mutateInsightList}
            onTaskDeleted={mutateInsightList}
            onPrioritySelect={async (storageKey, bucketKey, priority) => {
              if (!detailTaskEntry) return;
              await updateTaskPrioritySimple(
                detailTaskEntry.insightId,
                storageKey,
                bucketKey,
                priority,
              );
              mutateInsightList();
            }}
            onTypeSelect={async (storageKey, bucketKey, newBucket) => {
              if (!detailTaskEntry) return;
              await moveTask(
                detailTaskEntry.insightId,
                storageKey,
                bucketKey,
                newBucket,
              );
              mutateInsightList();
            }}
            onFieldUpdate={async (storageKey, bucketKey, field, value) => {
              if (!detailTaskEntry) return;
              await patchTaskField(
                detailTaskEntry.insightId,
                storageKey,
                bucketKey,
                field,
                value,
              );
              mutateInsightList();
            }}
            onOpenRelatedInsight={handleOpenRelatedInsight}
          />
        </Suspense>
      )}
    </div>
  );
}

function taskDate(task: AggregatedTask): Date {
  if (task.deadline) {
    const d = new Date(task.deadline);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (task.insight?.time) {
    const d = new Date(Number(task.insight.time));
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(0);
}
