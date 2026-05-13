"use client";

import type { Insight, InsightTaskStatus } from "@/lib/db/schema";
import type { InsightTaskItem } from "@/lib/ai/subagents/insights";
import { coerceDate } from "@openloomi/shared";
import { format } from "date-fns";

export type TaskType =
  | "myTasks"
  | "isUnreplied"
  | "waitingForMe"
  | "waitingForOthers";
export type TaskFilterTab = "all" | TaskType;
export type StatusFilter = "all" | "pending" | "completed";

export type AggregatedTask = {
  id: string;
  taskId: string | null;
  taskName: string;
  taskType: TaskType;
  status: InsightTaskStatus;
  deadline: string | null;
  rawDeadline?: string | null;
  insight: Insight;
  bucket: Exclude<TaskType, "isUnreplied"> | null;
  selectable: boolean;
  /** Consistent with Insight details, used for displaying importance badge */
  priority: "high" | "medium" | "low" | null;
  /** Task owner */
  owner?: string | null;
  /** Task requester */
  requester?: string | null;
  /** Task detail description */
  context?: string | null;
};

export function formatDeadline(
  deadline?: string | null,
  fallback?: string | null,
) {
  if (deadline) {
    const date = coerceDate(deadline);
    if (!Number.isNaN(date.getTime())) {
      return format(date, "yyyy-MM-dd");
    }
  }
  if (fallback) {
    const date = coerceDate(fallback);
    if (!Number.isNaN(date.getTime())) {
      return format(date, "yyyy-MM-dd");
    }
  }
  return null;
}

export function buildStorageKey(
  task: InsightTaskItem,
  insightId: string,
  bucket: Exclude<TaskType, "isUnreplied">,
  index: number,
) {
  const titleKey = (task.title ?? "").toLowerCase().slice(0, 64);
  const contextKey = (task.context ?? "").slice(0, 96);
  const fallback = `${insightId}|${bucket}|${index}|${titleKey}|${contextKey.length}`;
  return task.id ?? fallback;
}
