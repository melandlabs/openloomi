"use client";

import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { RemixIcon } from "@/components/remix-icon";
import type { Insight } from "@/lib/db/schema";
import type { InsightTaskItem } from "@/lib/ai/subagents/insights";
import { Button } from "@openloomi/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@openloomi/ui";
import { cn } from "@/lib/utils";
import { InsightDetailActions } from "./insight-detail-actions";

type TaskBucketKey = "myTasks" | "waitingForMe" | "waitingForOthers";
/** Filter value: bucket type + all + unreplied (only used for displaying count) */
type TaskFilterValue = TaskBucketKey | "all" | "isUnreplied";

interface InsightDetailActionsCardProps {
  insight: Insight;
  todoBuckets: Array<{
    key: string;
    tasks: Array<{
      key: string;
      storageKey: string;
      task: InsightTaskItem;
      link: string | null;
    }>;
  }>;
  completedTasks: Record<string, boolean>;
  loadingTasks: Record<string, boolean>;
  toggleTaskCompletion: (
    storageKey: string,
    bucketKey: TaskBucketKey,
    isCompleted: boolean,
  ) => Promise<void>;
  openSchedulingLink: (link: string | null) => void;
  onTaskCreated?: () => void | Promise<void>;
  /** Auto-open task detail dialog when opened (for action items panel) */
  initialOpenTaskStorageKey?: string;
  initialOpenTaskBucket?: TaskBucketKey;
  /** Open task in edit mode (true=open edit dialog, false=open detail view) */
  initialTaskEditMode?: boolean;
  onInitialTaskOpened?: () => void;
  onTaskDetailClose?: () => void;
}

/**
 * Action items card component
 * Displays action item filtering, creation, and list functionality
 */
export function InsightDetailActionsCard({
  insight,
  todoBuckets,
  completedTasks,
  loadingTasks,
  toggleTaskCompletion,
  openSchedulingLink,
  onTaskCreated,
  initialOpenTaskStorageKey,
  initialOpenTaskBucket,
  initialTaskEditMode,
  onInitialTaskOpened,
  onTaskDetailClose,
}: InsightDetailActionsCardProps) {
  const { t } = useTranslation();
  const [taskFilter, setTaskFilter] = useState<TaskFilterValue>("all");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const buckets = todoBuckets ?? [];
  const hasAnyTasksInitial = buckets.some((b) => b.tasks.length > 0);
  const [isActionsExpanded, setIsActionsExpanded] =
    useState(hasAnyTasksInitial);

  // Calculate filtered task list (preserve bucket info)
  const filteredTodoBuckets = useMemo(() => {
    if (taskFilter === "all") {
      // Return all buckets, keep original structure
      return buckets;
    }
    if (taskFilter === "isUnreplied") {
      // Unreplied case, return empty array (since unreplied is not a task type)
      return [];
    }
    // Filter by type, return matching bucket
    return buckets.filter((bucket) => bucket.key === taskFilter);
  }, [buckets, taskFilter]);

  // Calculate display count
  const displayCount = useMemo(() => {
    if (taskFilter === "isUnreplied") {
      return insight.isUnreplied ? 1 : 0;
    }
    return filteredTodoBuckets.reduce(
      (sum, bucket) => sum + bucket.tasks.length,
      0,
    );
  }, [filteredTodoBuckets, taskFilter, insight.isUnreplied]);

  /** Whether there are any action items (used to collapse card and disable expand when no action items) */
  const hasAnyTasks = useMemo(
    () => buckets.some((b) => b.tasks.length > 0),
    [buckets],
  );

  // When no action items, keep collapsed, and do not show "No action items" or extra add button (create already in title row)
  useEffect(() => {
    if (!hasAnyTasks) setIsActionsExpanded(false);
  }, [hasAnyTasks]);

  return (
    <div
      className={cn(
        "mt-4 bg-white rounded-lg border border-border",
        isActionsExpanded ? "p-4" : "px-4 py-3",
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between",
          isActionsExpanded && "mb-4",
        )}
      >
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            {t("insightDetail.tabActions", "Action items")}
          </h3>
          <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-semibold bg-gray-200 text-gray-700">
            {displayCount}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Filter button - same size as source info */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-7 w-7">
                <RemixIcon name="filter" size="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => setTaskFilter("all")}
                className={taskFilter === "all" ? "bg-muted" : ""}
              >
                {t("common.all", "All")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setTaskFilter("myTasks")}
                className={taskFilter === "myTasks" ? "bg-muted" : ""}
              >
                {t("agent.panels.todo.tabs.myCommitments", "My commitments")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setTaskFilter("waitingForMe")}
                className={taskFilter === "waitingForMe" ? "bg-muted" : ""}
              >
                {t("agent.panels.todo.tabs.waitingForMe", "Waiting for me")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setTaskFilter("waitingForOthers")}
                className={taskFilter === "waitingForOthers" ? "bg-muted" : ""}
              >
                {t(
                  "agent.panels.todo.tabs.othersCommitments",
                  "Others' commitments",
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Create button - same size as source info */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsCreateDialogOpen(true)}
            className="h-7 px-2 text-xs"
          >
            <RemixIcon name="add" size="size-4" className="mr-1.5" />
            {t("common.create", "Create")}
          </Button>
          {/* Collapse/expand button - disabled when no action items, stays collapsed */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!hasAnyTasks}
            onClick={() => setIsActionsExpanded(!isActionsExpanded)}
            aria-label={
              isActionsExpanded
                ? t("insightDetail.collapseActions", "Collapse action items")
                : t("insightDetail.expandActions", "Expand action items")
            }
            suppressHydrationWarning
          >
            {isActionsExpanded ? (
              <RemixIcon name="chevron_up" size="size-4" />
            ) : (
              <RemixIcon name="chevron_down" size="size-4" />
            )}
          </Button>
        </div>
      </div>
      {/* Keep InsightDetailActions mounted when collapsed so the "Create" button in the title row can open the dialog (dialog portals to body) */}
      <div
        className={isActionsExpanded ? undefined : "hidden"}
        aria-hidden={!isActionsExpanded}
      >
        <InsightDetailActions
          insight={insight}
          todoBuckets={filteredTodoBuckets}
          completedTasks={completedTasks}
          loadingTasks={loadingTasks}
          toggleTaskCompletion={toggleTaskCompletion}
          openSchedulingLink={openSchedulingLink}
          onTaskCreated={onTaskCreated}
          externalCreateDialogOpen={isCreateDialogOpen}
          onExternalCreateDialogChange={setIsCreateDialogOpen}
          initialOpenTaskStorageKey={initialOpenTaskStorageKey}
          initialOpenTaskBucket={initialOpenTaskBucket}
          initialTaskEditMode={initialTaskEditMode}
          onInitialTaskOpened={onInitialTaskOpened}
          onTaskDetailClose={onTaskDetailClose}
        />
      </div>
    </div>
  );
}
