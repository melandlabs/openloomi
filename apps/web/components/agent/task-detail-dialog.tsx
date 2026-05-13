"use client";

import { InsightBadge } from "@/components/insight-badge";
import { toast } from "@/components/toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@openloomi/ui";
import { Button, Combobox, Input, Label, Textarea } from "@openloomi/ui";
import { DatePicker } from "@openloomi/ui";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@openloomi/ui";
import { TimePicker } from "@openloomi/ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@openloomi/ui";
import { useInsightOptimisticUpdates } from "@/components/insight-optimistic-context";
import { useTaskOperations } from "@/hooks/use-task-operations";
import type { InsightTaskItem } from "@/lib/ai/subagents/insights";
import type { Insight } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import { RemixIcon } from "@/components/remix-icon";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type TaskBucketKey = "myTasks" | "waitingForMe" | "waitingForOthers";

interface TaskEntry {
  key: string;
  storageKey: string;
  task: InsightTaskItem;
  link: string | null;
  bucketKey: TaskBucketKey;
}

interface TaskDetailDialogProps {
  insightId: string;
  /** Associated insight object (optional, for showing related event) */
  insight?: Insight;
  /** Currently open task entry */
  detailTaskEntry: TaskEntry | null;
  /** Task list (for finding actual position of tasks) */
  todoBuckets?: Array<{
    key: TaskBucketKey;
    tasks: TaskEntry[];
  }>;
  /** Close dialog callback */
  onClose: () => void;
  /** Toggle task completion status callback */
  toggleTaskCompletion: (
    storageKey: string,
    bucketKey: TaskBucketKey,
    isCompleted: boolean,
  ) => Promise<void>;
  /** Owner suggestion list */
  ownerSuggestions: string[];
  /** Current username */
  currentUserName?: string;
  /** Callback after task is updated */
  onTaskUpdated?: () => void;
  /** Callback after task is deleted */
  onTaskDeleted?: () => void;
  /** Priority selection callback */
  onPrioritySelect?: (
    storageKey: string,
    bucketKey: TaskBucketKey,
    priority: "high" | "medium" | "low" | null,
  ) => Promise<void>;
  /** Type selection callback */
  onTypeSelect?: (
    storageKey: string,
    bucketKey: TaskBucketKey,
    newBucket: TaskBucketKey,
  ) => Promise<void>;
  /** Field update callback */
  onFieldUpdate?: (
    storageKey: string,
    bucketKey: TaskBucketKey,
    field: "owner" | "requester" | "deadline" | "context",
    value: string | null,
  ) => Promise<void>;
  /** Open related insight callback */
  onOpenRelatedInsight?: (insight: Insight) => void;
}

/**
 * Standalone task detail dialog component
 * Reusable in multiple places (InsightDetailActions, AgentTodoPanel, etc.)
 */
export function TaskDetailDialog({
  insightId,
  insight,
  detailTaskEntry,
  todoBuckets,
  onClose,
  toggleTaskCompletion,
  ownerSuggestions,
  currentUserName,
  onTaskUpdated,
  onTaskDeleted,
  onPrioritySelect,
  onTypeSelect,
  onFieldUpdate,
  onOpenRelatedInsight,
}: TaskDetailDialogProps) {
  const { t, i18n } = useTranslation();
  const { removeTask, loadingMap } = useTaskOperations();

  // Global optimistic update management
  const {
    getTitle,
    updateTitle,
    getPriority,
    getFields,
    getBucket,
    getTaskUpdates,
    isTaskCompleted,
    optimisticUpdates,
  } = useInsightOptimisticUpdates();

  // Editing state
  const [editingTitleInline, setEditingTitleInline] = useState<{
    storageKey: string;
    bucketKey: TaskBucketKey;
    value: string;
  } | null>(null);
  const [detailContextValue, setDetailContextValue] = useState("");
  const [detailOwnerInputValue, setDetailOwnerInputValue] = useState("");
  const [detailRequesterInputValue, setDetailRequesterInputValue] =
    useState("");
  const [detailDeadlineValue, setDetailDeadlineValue] = useState("");
  const detailDeadlineValueRef = useRef("");

  const [isSavingContext, setIsSavingContext] = useState(false);
  const [isSavingInlineTitle, setIsSavingInlineTitle] = useState(false);
  const [isPatchingDetailField, setIsPatchingDetailField] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Priority and type selector state
  const [priorityPicker, setPriorityPicker] = useState<{
    storageKey: string;
    bucketKey: TaskBucketKey;
  } | null>(null);
  const [typePicker, setTypePicker] = useState<{
    storageKey: string;
    bucketKey: TaskBucketKey;
  } | null>(null);

  const detailTitleInputRef = useRef<HTMLInputElement>(null);
  const dialogPickerWrapperRef = useRef<HTMLDivElement>(null);

  // When detailTaskEntry changes or optimistic update changes, recalculate optimisticTask
  // Use useMemo to ensure recalculation when context updates
  const optimisticTask = useMemo(() => {
    if (!detailTaskEntry) return null;
    return getFields(detailTaskEntry.storageKey, detailTaskEntry.task);
  }, [
    detailTaskEntry?.storageKey,
    getFields,
    detailTaskEntry?.task,
    optimisticUpdates.completedTasks,
  ]);

  // When optimisticTask changes, initialize editing state
  useEffect(() => {
    if (!detailTaskEntry || !optimisticTask) return;

    // Initialize editing values (using optimistic update values)
    setDetailContextValue(optimisticTask.context?.toString() || "");
    setDetailOwnerInputValue(optimisticTask.owner || "");
    setDetailRequesterInputValue(optimisticTask.requester || "");
    setDetailDeadlineValue(
      optimisticTask.deadline
        ? optimisticTask.deadline.slice(0, 16)
        : optimisticTask.followUpAt
          ? optimisticTask.followUpAt.slice(0, 16)
          : "",
    );
    detailDeadlineValueRef.current = detailDeadlineValue;

    // Reset editing state
    setEditingTitleInline(null);
  }, [optimisticTask]);

  /** Focus the input field with a delay when entering detail title editing */
  useEffect(() => {
    if (
      !detailTaskEntry ||
      !editingTitleInline ||
      editingTitleInline.storageKey !== detailTaskEntry.storageKey
    )
      return;
    const timeout = setTimeout(() => {
      detailTitleInputRef.current?.focus();
    }, 0);
    return () => clearTimeout(timeout);
  }, [detailTaskEntry?.storageKey, editingTitleInline?.storageKey]);

  // Save task description
  const saveTaskContext = async (
    storageKey: string,
    bucketKey: TaskBucketKey,
    newContext: string,
    originalContext: string,
  ) => {
    const trimmed = newContext.trim();
    if (trimmed === originalContext.trim()) {
      setDetailContextValue(trimmed);
      return;
    }

    setIsSavingContext(true);
    try {
      if (onFieldUpdate) {
        await onFieldUpdate(storageKey, bucketKey, "context", trimmed || null);
      }
      setDetailContextValue(trimmed);
      toast({
        type: "success",
        description: t(
          "insightDetail.updateTask.success",
          "Action item updated",
        ),
      });
      await onTaskUpdated?.();
    } catch (e) {
      toast({
        type: "error",
        description:
          e instanceof Error ? e.message : "Failed to update context",
      });
    } finally {
      setIsSavingContext(false);
    }
  };

  // Start inline title editing
  const startInlineTitleEdit = (
    storageKey: string,
    bucketKey: TaskBucketKey,
    currentTitle: string,
  ) => {
    setEditingTitleInline({ storageKey, bucketKey, value: currentTitle });
  };

  // Cancel inline title editing
  const cancelInlineTitleEdit = () => {
    setEditingTitleInline(null);
  };

  // Save inline title
  const saveInlineTitle = async (
    storageKey: string,
    bucketKey: TaskBucketKey,
    newTitle: string,
    originalTitle: string,
  ) => {
    const trimmed = newTitle.trim();
    if (!trimmed) {
      toast({
        type: "error",
        description: t(
          "insightDetail.createTask.titleRequired",
          "Please enter a task title",
        ),
      });
      return;
    }
    if (trimmed === originalTitle.trim()) {
      setEditingTitleInline(null);
      return;
    }

    setEditingTitleInline(null);

    setIsSavingInlineTitle(true);

    try {
      // Use global optimistic update
      await updateTitle(storageKey, trimmed, async () => {
        toast({
          type: "success",
          description: t(
            "insightDetail.updateTask.success",
            "Action item updated",
          ),
        });
        await onTaskUpdated?.();
      });
    } catch (e) {
      toast({
        type: "error",
        description: e instanceof Error ? e.message : "Failed to update title",
      });
    } finally {
      setIsSavingInlineTitle(false);
    }
  };

  // Patch update field
  const patchDetailField = async (
    field: "owner" | "requester" | "deadline",
    value: string | null,
  ) => {
    if (!detailTaskEntry) return;

    setIsPatchingDetailField(true);
    try {
      if (onFieldUpdate) {
        await onFieldUpdate(
          detailTaskEntry.storageKey,
          displayBucket,
          field,
          value,
        );
      }
      toast({
        type: "success",
        description: t(
          "insightDetail.updateTask.success",
          "Action item updated",
        ),
      });
      await onTaskUpdated?.();
    } catch (e) {
      toast({
        type: "error",
        description: e instanceof Error ? e.message : "Failed to update field",
      });
    } finally {
      setIsPatchingDetailField(false);
    }
  };

  // Priority selection
  const handlePrioritySelect = async (
    storageKey: string,
    bucketKey: TaskBucketKey,
    priority: "high" | "medium" | "low" | null,
  ) => {
    setPriorityPicker(null);
    if (onPrioritySelect) {
      await onPrioritySelect(storageKey, bucketKey, priority);
    }
  };

  // Type selection
  const handleTypeSelect = async (
    storageKey: string,
    bucketKey: TaskBucketKey,
    newBucket: TaskBucketKey,
  ) => {
    setTypePicker(null);
    if (onTypeSelect) {
      await onTypeSelect(storageKey, bucketKey, newBucket);
    }
  };

  // Delete task (actually performs the delete operation)
  const performDeleteTask = async () => {
    if (!detailTaskEntry) return;

    // Close Dialog first to avoid reopening
    onClose();
    setShowDeleteConfirm(false);

    try {
      // Use getBucket to get optimistic bucket value (may have already been moved)
      const optimisticBucketKey = getBucket(
        detailTaskEntry.storageKey,
        detailTaskEntry.bucketKey,
      );

      await removeTask(
        insightId,
        detailTaskEntry.storageKey,
        optimisticBucketKey,
      );
      await onTaskDeleted?.();
    } catch (e) {
      // Error is already handled by the hook
    }
  };

  // Show delete confirmation dialog
  const handleDeleteClick = () => {
    // Close Dialog first to avoid conflict with AlertDialog
    setShowDeleteConfirm(true);
  };

  // Check if currently deleting this task
  const isDeletingTask = detailTaskEntry
    ? Boolean(loadingMap[detailTaskEntry.storageKey])
    : false;

  if (!detailTaskEntry) return null;

  // optimisticTask cannot be null because detailTaskEntry exists
  // But TypeScript doesn't know this, so we need to check
  if (!optimisticTask) return null;

  // Save the original task object (for comparing values before and after editing)
  const originalTask = detailTaskEntry.task;

  // Get optimistic bucket (optimisticTask is already computed in useMemo)
  const displayBucket = getBucket(
    detailTaskEntry.storageKey,
    detailTaskEntry.bucketKey,
  );

  // Use optimistic title
  const displayTitle = getTitle(
    detailTaskEntry.storageKey,
    optimisticTask.title || "",
  );
  // Use optimistic priority
  const effectivePriority = getPriority(
    detailTaskEntry.storageKey,
    optimisticTask.priority ?? null,
  );
  // Use optimistic deadline and completion status (already included in optimisticTask)
  const isCompleted = optimisticTask.status === "completed";

  const priorityLabel = effectivePriority || null;
  const typeLabel =
    displayBucket === "myTasks"
      ? t("agent.panels.todo.tabs.myCommitments", "My commitments")
      : displayBucket === "waitingForMe"
        ? t("agent.panels.todo.tabs.waitingForMe", "Waiting for me")
        : t("agent.panels.todo.tabs.othersCommitments", "Others' commitments");

  const isDetailPriorityPickerOpen =
    priorityPicker?.storageKey === detailTaskEntry.storageKey &&
    priorityPicker?.bucketKey === displayBucket;
  const isDetailTypePickerOpen =
    typePicker?.storageKey === detailTaskEntry.storageKey &&
    typePicker?.bucketKey === displayBucket;

  const isEditingTitle =
    editingTitleInline?.storageKey === detailTaskEntry.storageKey;
  // Use optimistic completion status (for display styling)
  const detailIsCompleted = isCompleted;

  return (
    <>
      {/* Delete confirmation dialog - rendered independently outside the Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("insightDetail.deleteTask.title", "Delete action item")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "insightDetail.deleteTask.confirm",
                "Are you sure you want to delete this action item?",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingTask}>
              {t("common.cancel", "Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={performDeleteTask}
              disabled={isDeletingTask}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingTask
                ? t("common.deleting", "Deleting...")
                : t("common.delete", "Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!detailTaskEntry && !showDeleteConfirm}
        onOpenChange={(open) => !open && onClose()}
        modal={false}
      >
        <DialogContent
          className="sm:max-w-md max-h-[90vh] overflow-y-auto p-4"
          hideCloseButton
        >
          {/* Header */}
          <DialogHeader className="flex flex-row items-center justify-end gap-1 px-4 pt-2 pb-2 text-left">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={handleDeleteClick}
                  disabled={isDeletingTask}
                  aria-label={t("common.delete", "Delete")}
                >
                  <RemixIcon name="delete_bin" size="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {isDeletingTask
                    ? t("common.deleting", "Deleting...")
                    : t("common.delete", "Delete")}
                </p>
              </TooltipContent>
            </Tooltip>
            <DialogClose className="ring-offset-background focus:ring-ring hover:bg-accent hover:text-accent-foreground rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none inline-flex h-8 w-8 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
              <RemixIcon name="close" size="size-4" />
              <span className="sr-only">{t("common.close", "Close")}</span>
            </DialogClose>
          </DialogHeader>

          <DialogTitle className="sr-only">
            {t("insightDetail.taskDetail.title", "Action item details")}
          </DialogTitle>

          {/* Content */}
          <div className="space-y-4 px-2 pb-2">
            {/* Title */}
            <div className="flex-1 min-w-0">
              {isEditingTitle ? (
                <Input
                  ref={detailTitleInputRef}
                  className="text-lg font-semibold h-auto py-1.5"
                  value={editingTitleInline.value}
                  onChange={(e) =>
                    setEditingTitleInline((prev) =>
                      prev ? { ...prev, value: e.target.value } : null,
                    )
                  }
                  onBlur={() =>
                    saveInlineTitle(
                      editingTitleInline.storageKey,
                      editingTitleInline.bucketKey,
                      editingTitleInline.value,
                      displayTitle,
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    }
                    if (e.key === "Escape") {
                      cancelInlineTitleEdit();
                    }
                  }}
                  autoFocus
                  disabled={isSavingInlineTitle}
                />
              ) : (
                <button
                  type="button"
                  className={cn(
                    "text-lg font-semibold leading-tight text-foreground text-left w-full rounded-md hover:bg-muted/50 p-0 transition-colors",
                    detailIsCompleted && "line-through text-muted-foreground",
                  )}
                  onClick={() =>
                    startInlineTitleEdit(
                      detailTaskEntry.storageKey,
                      displayBucket,
                      displayTitle ||
                        t("insightDetail.todoUntitled", "Untitled task"),
                    )
                  }
                >
                  {displayTitle ||
                    t("insightDetail.todoUntitled", "Untitled task")}
                </button>
              )}
            </div>

            {/* Description */}
            <Textarea
              className="min-h-[120px] max-h-[280px] text-sm text-foreground/90 resize-y overflow-y-auto"
              placeholder={t(
                "insightDetail.createTask.contextPlaceholder",
                "(Optional) Enter task details...",
              )}
              value={detailContextValue}
              onChange={(e) => setDetailContextValue(e.target.value)}
              onBlur={() => {
                const original = originalTask.context ?? "";
                if (detailContextValue.trim() !== original.trim()) {
                  saveTaskContext(
                    detailTaskEntry.storageKey,
                    displayBucket,
                    detailContextValue,
                    original,
                  );
                }
              }}
              disabled={isSavingContext}
            />

            {/* Form: Priority and Type */}
            <div className="space-y-3 pt-2">
              <div
                ref={
                  detailTaskEntry &&
                  (isDetailPriorityPickerOpen || isDetailTypePickerOpen)
                    ? dialogPickerWrapperRef
                    : undefined
                }
                className="space-y-3"
              >
                {/* Priority */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    {t("insightDetail.todoPriorityLabel", "Priority")}
                  </Label>
                  <div className="relative flex items-center gap-2">
                    {priorityLabel ? (
                      <div
                        role="button"
                        tabIndex={0}
                        className="flex items-center gap-1 cursor-pointer [&_span]:cursor-pointer shrink-0"
                        onClick={(e) => {
                          setTypePicker(null);
                          setPriorityPicker((prev) =>
                            prev &&
                            prev.storageKey === detailTaskEntry.storageKey &&
                            prev.bucketKey === displayBucket
                              ? null
                              : {
                                  storageKey: detailTaskEntry.storageKey,
                                  bucketKey: displayBucket,
                                },
                          );
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setTypePicker(null);
                            setPriorityPicker((prev) =>
                              prev &&
                              prev.storageKey === detailTaskEntry.storageKey &&
                              prev.bucketKey === displayBucket
                                ? null
                                : {
                                    storageKey: detailTaskEntry.storageKey,
                                    bucketKey: displayBucket,
                                  },
                            );
                          }
                        }}
                      >
                        <InsightBadge
                          type="priority"
                          priority={
                            effectivePriority === "high" ||
                            effectivePriority === "medium" ||
                            effectivePriority === "low"
                              ? effectivePriority
                              : undefined
                          }
                          label={priorityLabel}
                          iconSize="size-3"
                        />
                        <RemixIcon
                          name="chevron_down"
                          size="size-3.5"
                          className="text-muted-foreground shrink-0"
                        />
                      </div>
                    ) : (
                      <div
                        role="button"
                        tabIndex={0}
                        className="flex items-center gap-1 text-xs text-muted-foreground border border-dashed rounded-full min-h-5 px-2 py-0.5 hover:bg-muted/50 cursor-pointer"
                        onClick={() => {
                          setPriorityPicker({
                            storageKey: detailTaskEntry.storageKey,
                            bucketKey: displayBucket,
                          });
                        }}
                      >
                        <span>
                          {t("insightDetail.todoSetPriority", "Set priority")}
                        </span>
                        <RemixIcon
                          name="chevron_down"
                          size="size-3.5"
                          className="text-muted-foreground shrink-0"
                        />
                      </div>
                    )}
                    {isDetailPriorityPickerOpen && (
                      <div className="absolute left-0 top-full z-[100] mt-1 rounded-md border bg-popover shadow-md py-1 px-1 min-w-[7rem] flex flex-col gap-0.5">
                        {(["high", "medium", "low"] as const).map((p) => (
                          <button
                            key={p}
                            type="button"
                            className="w-full text-left rounded-md hover:bg-muted/80 transition-colors flex items-center"
                            onClick={() =>
                              handlePrioritySelect(
                                detailTaskEntry.storageKey,
                                displayBucket,
                                p,
                              )
                            }
                          >
                            <InsightBadge
                              type="priority"
                              priority={p}
                              label={p}
                              iconSize="size-3"
                              className="w-full justify-center"
                            />
                          </button>
                        ))}
                        <button
                          type="button"
                          className="w-full px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/80 rounded-md transition-colors"
                          onClick={() =>
                            handlePrioritySelect(
                              detailTaskEntry.storageKey,
                              displayBucket,
                              null,
                            )
                          }
                        >
                          {t("common.clear", "Clear")}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Type */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    {t("insightDetail.createTask.bucketLabel", "Type")}
                  </Label>
                  <div className="relative flex items-center gap-2">
                    <div
                      role="button"
                      tabIndex={0}
                      className="flex items-center gap-1 cursor-pointer [&_span]:cursor-pointer shrink-0"
                      onClick={() => {
                        setPriorityPicker(null);
                        setTypePicker((prev) =>
                          prev &&
                          prev.storageKey === detailTaskEntry.storageKey &&
                          prev.bucketKey === displayBucket
                            ? null
                            : {
                                storageKey: detailTaskEntry.storageKey,
                                bucketKey: displayBucket,
                              },
                        );
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setPriorityPicker(null);
                          setTypePicker((prev) =>
                            prev &&
                            prev.storageKey === detailTaskEntry.storageKey &&
                            prev.bucketKey === displayBucket
                              ? null
                              : {
                                  storageKey: detailTaskEntry.storageKey,
                                  bucketKey: displayBucket,
                                },
                          );
                        }
                      }}
                    >
                      <InsightBadge
                        type="taskBucket"
                        label={typeLabel}
                        iconSize="size-3"
                      />
                      <RemixIcon
                        name="chevron_down"
                        size="size-3.5"
                        className="text-muted-foreground shrink-0"
                      />
                    </div>
                    {isDetailTypePickerOpen && (
                      <div className="absolute left-0 top-full z-[100] mt-1 rounded-md border bg-popover shadow-md py-1 px-1 min-w-[8rem] flex flex-col gap-0.5">
                        <button
                          key="detail-myTasks"
                          type="button"
                          className="w-full text-left rounded-md hover:bg-muted/80 transition-colors flex items-center"
                          onClick={() =>
                            handleTypeSelect(
                              detailTaskEntry.storageKey,
                              displayBucket,
                              "myTasks",
                            )
                          }
                        >
                          <InsightBadge
                            type="taskBucket"
                            label={t(
                              "agent.panels.todo.tabs.myCommitments",
                              "My commitments",
                            )}
                            iconSize="size-3"
                            className="w-full justify-center"
                          />
                        </button>
                        <button
                          key="detail-waitingForMe"
                          type="button"
                          className="w-full text-left rounded-md hover:bg-muted/80 transition-colors flex items-center"
                          onClick={() =>
                            handleTypeSelect(
                              detailTaskEntry.storageKey,
                              displayBucket,
                              "waitingForMe",
                            )
                          }
                        >
                          <InsightBadge
                            type="taskBucket"
                            label={t(
                              "agent.panels.todo.tabs.waitingForMe",
                              "Waiting for me",
                            )}
                            iconSize="size-3"
                            className="w-full justify-center"
                          />
                        </button>
                        <button
                          key="detail-waitingForOthers"
                          type="button"
                          className="w-full text-left rounded-md hover:bg-muted/80 transition-colors flex items-center"
                          onClick={() =>
                            handleTypeSelect(
                              detailTaskEntry.storageKey,
                              displayBucket,
                              "waitingForOthers",
                            )
                          }
                        >
                          <InsightBadge
                            type="taskBucket"
                            label={t(
                              "agent.panels.todo.tabs.othersCommitments",
                              "Others' commitments",
                            )}
                            iconSize="size-3"
                            className="w-full justify-center"
                          />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Owner */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  {t("insightDetail.createTask.ownerLabel", "Assignee")}
                </Label>
                <Combobox
                  options={[
                    { value: "", label: t("common.none", "None") },
                    ...ownerSuggestions.map((name) => ({
                      value: name,
                      label:
                        name === currentUserName
                          ? `${name} (${t("insightDetail.createTask.you", "You")})`
                          : name,
                    })),
                  ]}
                  value={detailOwnerInputValue}
                  onChange={(value) => {
                    setDetailOwnerInputValue(value);
                    const original = originalTask.owner ?? "";
                    if (value.trim() !== original.trim()) {
                      patchDetailField("owner", value || null);
                    }
                  }}
                  placeholder={t(
                    "insightDetail.createTask.ownerPlaceholder",
                    "Select or enter an assignee...",
                  )}
                  searchPlaceholder={t(
                    "insightDetail.createTask.ownerSearchPlaceholder",
                    "Search for assignee...",
                  )}
                  emptyText={t(
                    "insightDetail.createTask.noOwnerFound",
                    "No matching assignee found",
                  )}
                  allowCustom
                  disabled={isPatchingDetailField}
                />
              </div>

              {/* Initiator */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  {t("insightDetail.todoRequesterLabel", "Requester")}
                </Label>
                <Combobox
                  options={[
                    { value: "", label: t("common.none", "None") },
                    ...ownerSuggestions.map((name) => ({
                      value: name,
                      label:
                        name === currentUserName
                          ? `${name} (${t("insightDetail.createTask.you", "You")})`
                          : name,
                    })),
                  ]}
                  value={detailRequesterInputValue}
                  onChange={(value) => {
                    setDetailRequesterInputValue(value);
                    const original = originalTask.requester ?? "";
                    if (value.trim() !== original.trim()) {
                      patchDetailField("requester", value || null);
                    }
                  }}
                  placeholder={t(
                    "insightDetail.todoRequesterPlaceholder",
                    "Select or enter a requester...",
                  )}
                  searchPlaceholder={t(
                    "insightDetail.createTask.requesterSearchPlaceholder",
                    "Search for requester...",
                  )}
                  emptyText={t(
                    "insightDetail.createTask.noRequesterFound",
                    "No matching requester found",
                  )}
                  allowCustom
                  disabled={isPatchingDetailField}
                />
              </div>

              {/* Due date */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  {t("insightDetail.createTask.deadlineLabel", "Due date")}
                </Label>
                <div className="flex gap-2">
                  <DatePicker
                    value={
                      detailDeadlineValue
                        ? detailDeadlineValue.slice(0, 10)
                        : ""
                    }
                    onChange={(v) => {
                      const next = v
                        ? `${v}T${detailDeadlineValue.slice(11, 16) || "00:00"}`
                        : "";
                      setDetailDeadlineValue(next);
                      detailDeadlineValueRef.current = next;
                    }}
                    onOpenChange={(open) => {
                      if (!open)
                        patchDetailField(
                          "deadline",
                          (detailDeadlineValueRef.current ?? "").trim() || null,
                        );
                    }}
                    placeholder={t(
                      "insightDetail.createTask.datePlaceholder",
                      "Select date",
                    )}
                    clearLabel={t("common.clear", "Clear")}
                    todayLabel={t("common.today", "Today")}
                    localeZh={i18n.language.startsWith("zh")}
                    disabled={isPatchingDetailField}
                    triggerClassName="h-8"
                  />
                  <TimePicker
                    value={
                      detailDeadlineValue && detailDeadlineValue.length >= 16
                        ? detailDeadlineValue.slice(11, 16)
                        : ""
                    }
                    onChange={(v) => {
                      const next =
                        detailDeadlineValue && detailDeadlineValue.length >= 10
                          ? `${detailDeadlineValue.slice(0, 10)}T${v || "00:00"}`
                          : "";
                      setDetailDeadlineValue(next);
                      detailDeadlineValueRef.current = next;
                    }}
                    onOpenChange={(open) => {
                      if (!open)
                        patchDetailField(
                          "deadline",
                          (detailDeadlineValueRef.current ?? "").trim() || null,
                        );
                    }}
                    placeholder={t(
                      "insightDetail.createTask.timePlaceholder",
                      "Select time",
                    )}
                    disabled={isPatchingDetailField}
                    triggerClassName="h-8"
                  />
                </div>
              </div>

              {/* Related event: card style, click opens the event in current panel */}
              {insight && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    {t(
                      "insightDetail.taskDetail.relatedEvent",
                      "Linked events",
                    )}
                  </Label>
                  <button
                    type="button"
                    className={cn(
                      "w-full rounded-xl border border-border/60 bg-white/80 p-3 text-left shadow-sm transition-all",
                      "hover:border-primary/40 hover:shadow-md hover:bg-white",
                    )}
                    onClick={() => {
                      // Open Drawer first, then close Dialog
                      onOpenRelatedInsight?.(insight);
                      onClose();
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground line-clamp-2">
                          {insight.title ||
                            t("insightDetail.noTitle", "Untitled")}
                        </p>
                        {insight.description && (
                          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2 whitespace-pre-line">
                            {insight.description}
                          </p>
                        )}
                      </div>
                      <RemixIcon
                        name="chevron_right"
                        size="size-4"
                        className="shrink-0 text-muted-foreground"
                      />
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
