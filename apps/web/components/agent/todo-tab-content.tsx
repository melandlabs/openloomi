"use client";

import { Button } from "@openloomi/ui";
import { Spinner } from "@/components/spinner";
import { RemixIcon } from "@/components/remix-icon";
import type { InsightTaskStatus } from "@/lib/db/schema";
import type { AggregatedTask, TaskFilterTab, TaskType } from "./todo-types";
import { TodoTaskList } from "./todo-task-list";

type TodoTabContentProps = {
  tab: TaskFilterTab;
  activeTab: TaskFilterTab;
  tasks: AggregatedTask[];
  showCompleted: boolean;
  isLoading: boolean;
  error: unknown;
  loadingMap: Record<string, boolean>;
  statusLabels: Record<InsightTaskStatus, string>;
  typeLabels: Record<TaskType, string>;
  pendingTitle: string;
  completedTitle: string;
  noDeadlineLabel: string;
  refreshLabel: string;
  loadFailedLabel: string;
  emptyLabel: string;
  emptyPendingLabel: string;
  hiddenCompletedHint: string;
  onRetry: () => void;
  onMarkComplete: (task: AggregatedTask) => void;
  /** Opens Insight detail drawer and task detail modal when card is clicked */
  onOpenTask: (task: AggregatedTask) => void;
  /** Refreshes list after task title is saved */
  onTaskCreated?: () => void | Promise<void>;
};

export function TodoTabContent({
  tab,
  activeTab,
  tasks,
  showCompleted,
  isLoading,
  error,
  loadingMap,
  statusLabels,
  typeLabels,
  pendingTitle,
  completedTitle,
  noDeadlineLabel,
  refreshLabel,
  loadFailedLabel,
  emptyLabel,
  emptyPendingLabel,
  hiddenCompletedHint,
  onRetry,
  onMarkComplete,
  onOpenTask,
  onTaskCreated,
}: TodoTabContentProps) {
  // Only render the currently active tab
  if (tab !== activeTab) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="flex-1 min-h-0 overflow-auto p-4">
        <div className="flex h-full items-center justify-center">
          <Spinner />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 min-h-0 overflow-auto p-4">
        <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <RemixIcon name="inbox" size="size-6" />
          <span>{loadFailedLabel}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={onRetry}
            className="gap-2"
          >
            <RemixIcon name="refresh" size="size-4" />
            {refreshLabel}
          </Button>
        </div>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex-1 min-h-0 overflow-auto p-4">
        <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <RemixIcon name="inbox" size="size-6" />
          <span>{showCompleted ? emptyLabel : emptyPendingLabel}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4">
      <TodoTaskList
        tasks={tasks}
        showCompleted={showCompleted}
        statusLabels={statusLabels}
        typeLabels={typeLabels}
        loadingMap={loadingMap}
        pendingTitle={pendingTitle}
        completedTitle={completedTitle}
        onMarkComplete={onMarkComplete}
        onOpenTask={onOpenTask}
        onTaskCreated={onTaskCreated}
      />
      {!showCompleted && tasks.some((task) => task.status === "completed") && (
        <div className="pt-3 text-xs text-muted-foreground">
          {hiddenCompletedHint}
        </div>
      )}
    </div>
  );
}
