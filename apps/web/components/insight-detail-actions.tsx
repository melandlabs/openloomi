"use client";

import {
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
  lazy,
  Suspense,
} from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "next-auth/react";
import { RemixIcon } from "@/components/remix-icon";
import { format } from "date-fns";
import { enGB, zhCN } from "date-fns/locale";
import type { Insight } from "@/lib/db/schema";
import type { InsightTaskItem } from "@/lib/ai/subagents/insights";
import { Button, Input, Label, Textarea } from "@openloomi/ui";
import { generateUUID } from "@/lib/utils";
import { InsightBadge } from "@/components/insight-badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@openloomi/ui";
import { DatePicker } from "@openloomi/ui";
import { TimePicker } from "@openloomi/ui";
import { useChatContextOptional } from "@/components/chat-context";
import { useRouter } from "next/navigation";
import { useOnClickOutside } from "@openloomi/hooks/use-on-click-outside";
import { useTaskOperations } from "@/hooks/use-task-operations";
import { useInsightOptimisticUpdates } from "@/components/insight-optimistic-context";
import { toast } from "./toast";
import { InsightTaskCard } from "@/components/insight-task-card";

// bundle-dynamic-imports: Dynamic import TaskDetailDialog to reduce initial JS bundle size
const TaskDetailDialogLazy = lazy(() =>
  import("@/components/agent/task-detail-dialog").then((mod) => ({
    default: mod.TaskDetailDialog,
  })),
);

type TaskBucketKey = "myTasks" | "waitingForMe" | "waitingForOthers";

// Props interface for create task dialog
interface CreateTaskDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isCreating: boolean;
  newTaskTitle: string;
  setNewTaskTitle: (title: string) => void;
  newTaskContext: string;
  setNewTaskContext: (context: string) => void;
  newTaskDeadline: string;
  setNewTaskDeadline: (deadline: string) => void;
  ownerInputValue: string;
  setOwnerInputValue: (value: string) => void;
  newTaskOwner: string;
  setNewTaskOwner: (owner: string) => void;
  showOwnerSuggestions: boolean;
  setShowOwnerSuggestions: (show: boolean) => void;
  filteredOwnerSuggestions: string[];
  selectedBucket: TaskBucketKey;
  setSelectedBucket: (bucket: TaskBucketKey) => void;
  newTaskPriority: "high" | "medium" | "low" | null;
  setNewTaskPriority: (v: "high" | "medium" | "low" | null) => void;
  createNewTask: () => void;
}

// Create task dialog component
function CreateTaskDialog({
  isOpen,
  onOpenChange,
  isCreating,
  newTaskTitle,
  setNewTaskTitle,
  newTaskContext,
  setNewTaskContext,
  newTaskDeadline,
  setNewTaskDeadline,
  ownerInputValue,
  setOwnerInputValue,
  newTaskOwner,
  setNewTaskOwner,
  showOwnerSuggestions,
  setShowOwnerSuggestions,
  filteredOwnerSuggestions,
  selectedBucket,
  setSelectedBucket,
  newTaskPriority,
  setNewTaskPriority,
  createNewTask,
}: CreateTaskDialogProps) {
  const { t, i18n } = useTranslation();
  const { data: session } = useSession();
  const [createPriorityOpen, setCreatePriorityOpen] = useState(false);
  const [createTypeOpen, setCreateTypeOpen] = useState(false);
  const createPickerRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(createPickerRef, () => {
    setCreatePriorityOpen(false);
    setCreateTypeOpen(false);
  });

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange} modal={false}>
      <DialogContent className="sm:max-w-md gap-0 p-0">
        <div className="flex flex-col border-b border-border">
          <DialogHeader className="flex flex-row items-center gap-1 px-4 pt-2 pb-2 text-left">
            <DialogTitle className="text-base font-semibold">
              {t("insightDetail.createTask.title", "Add New Action")}
            </DialogTitle>
          </DialogHeader>
        </div>
        <div className="space-y-3 px-4 pb-4">
          <div className="space-y-1.5">
            <Label
              htmlFor="task-title"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("insightDetail.createTask.titleLabel", "Title")} *
            </Label>
            <Input
              id="task-title"
              className="h-8 text-sm"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              placeholder={t(
                "insightDetail.createTask.titlePlaceholder",
                "Enter task title...",
              )}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  createNewTask();
                }
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor="task-context"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("insightDetail.createTask.contextLabel", "Description")}
            </Label>
            <Textarea
              id="task-context"
              className="min-h-[120px] max-h-[280px] text-sm resize-y overflow-y-auto"
              value={newTaskContext}
              onChange={(e) => setNewTaskContext(e.target.value)}
              placeholder={t(
                "insightDetail.createTask.contextPlaceholder",
                "(Optional) Enter task details...",
              )}
              rows={3}
            />
          </div>
          {/* Priority and type: badge selection consistent with detail dialog, placed above owner */}
          <div ref={createPickerRef} className="space-y-3">
            {/* Priority */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                {t("insightDetail.todoPriorityLabel", "Priority")}
              </Label>
              <div className="relative flex items-center gap-2">
                {newTaskPriority ? (
                  <div
                    role="button"
                    tabIndex={0}
                    className="flex items-center gap-1 cursor-pointer [&_span]:cursor-pointer shrink-0"
                    onClick={() => {
                      setCreateTypeOpen(false);
                      setCreatePriorityOpen((prev) => !prev);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setCreateTypeOpen(false);
                        setCreatePriorityOpen((prev) => !prev);
                      }
                    }}
                  >
                    <InsightBadge
                      type="priority"
                      priority={newTaskPriority}
                      label={newTaskPriority}
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
                      setCreateTypeOpen(false);
                      setCreatePriorityOpen(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setCreateTypeOpen(false);
                        setCreatePriorityOpen(true);
                      }
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
                {createPriorityOpen && (
                  <div className="absolute left-0 top-full z-[100] mt-1 rounded-md border bg-popover shadow-md py-1 px-1 min-w-[7rem] flex flex-col gap-0.5">
                    {(["high", "medium", "low"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        className="w-full text-left rounded-md hover:bg-muted/80 transition-colors flex items-center"
                        onClick={() => {
                          setNewTaskPriority(p);
                          setCreatePriorityOpen(false);
                        }}
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
                      onClick={() => {
                        setNewTaskPriority(null);
                        setCreatePriorityOpen(false);
                      }}
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
                {t("insightDetail.createTask.typeLabel", "Type")}
              </Label>
              <div className="relative flex items-center gap-2">
                <div
                  role="button"
                  tabIndex={0}
                  className="flex items-center gap-1 cursor-pointer [&_span]:cursor-pointer shrink-0"
                  onClick={() => {
                    setCreatePriorityOpen(false);
                    setCreateTypeOpen((prev) => !prev);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setCreatePriorityOpen(false);
                      setCreateTypeOpen((prev) => !prev);
                    }
                  }}
                >
                  <InsightBadge
                    type="taskBucket"
                    label={
                      selectedBucket === "myTasks"
                        ? t(
                            "agent.panels.todo.tabs.myCommitments",
                            "My commitments",
                          )
                        : selectedBucket === "waitingForMe"
                          ? t(
                              "agent.panels.todo.tabs.waitingForMe",
                              "Waiting for me",
                            )
                          : t(
                              "agent.panels.todo.tabs.othersCommitments",
                              "Others' commitments",
                            )
                    }
                    iconSize="size-3"
                  />
                  <RemixIcon
                    name="chevron_down"
                    size="size-3.5"
                    className="text-muted-foreground shrink-0"
                  />
                </div>
                {createTypeOpen && (
                  <div className="absolute left-0 top-full z-[100] mt-1 rounded-md border bg-popover shadow-md py-1 px-1 min-w-[8rem] flex flex-col gap-0.5">
                    <button
                      key="myTasks"
                      type="button"
                      className="w-full text-left rounded-md hover:bg-muted/80 transition-colors flex items-center"
                      onClick={() => {
                        setSelectedBucket("myTasks");
                        setCreateTypeOpen(false);
                      }}
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
                      key="waitingForMe"
                      type="button"
                      className="w-full text-left rounded-md hover:bg-muted/80 transition-colors flex items-center"
                      onClick={() => {
                        setSelectedBucket("waitingForMe");
                        setCreateTypeOpen(false);
                      }}
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
                      key="waitingForOthers"
                      type="button"
                      className="w-full text-left rounded-md hover:bg-muted/80 transition-colors flex items-center"
                      onClick={() => {
                        setSelectedBucket("waitingForOthers");
                        setCreateTypeOpen(false);
                      }}
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
          <div className="space-y-1.5">
            <Label
              htmlFor="task-owner"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("insightDetail.createTask.ownerLabel", "Assignee")}
            </Label>
            <div className="relative">
              <Input
                id="task-owner"
                type="text"
                className="h-8 text-sm"
                value={ownerInputValue}
                onChange={(e) => {
                  const value = e.target.value;
                  setOwnerInputValue(value);
                  setNewTaskOwner(value);
                  setShowOwnerSuggestions(true);
                }}
                onFocus={() => setShowOwnerSuggestions(true)}
                onBlur={() => {
                  // Delay close to allow clicking suggestion items
                  setTimeout(() => setShowOwnerSuggestions(false), 200);
                }}
                placeholder={t(
                  "insightDetail.createTask.ownerPlaceholder",
                  "(Optional) Enter or select an assignee...",
                )}
              />
              {ownerInputValue && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setOwnerInputValue("");
                    setNewTaskOwner("");
                  }}
                >
                  <RemixIcon name="close" size="size-3" />
                </button>
              )}
              {/* Suggestion list */}
              {showOwnerSuggestions &&
                (ownerInputValue || filteredOwnerSuggestions.length > 0) && (
                  <div className="absolute z-10 w-full mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
                    {filteredOwnerSuggestions.length > 0 ? (
                      filteredOwnerSuggestions.map((name) => (
                        <div
                          key={name}
                          role="option"
                          className="px-3 py-2 text-sm cursor-pointer hover:bg-muted transition-colors"
                          onMouseDown={(e) => {
                            e.preventDefault(); // Prevent onBlur from triggering first
                            setOwnerInputValue(name);
                            setNewTaskOwner(name);
                            setShowOwnerSuggestions(false);
                          }}
                        >
                          {name === session?.user?.name
                            ? `${name} (${t("insightDetail.createTask.you", "You")})`
                            : name}
                        </div>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-sm text-muted-foreground text-center">
                        {t("common.noResults", "No results")}
                      </div>
                    )}
                  </div>
                )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor="task-deadline"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("insightDetail.createTask.deadlineLabel", "Due date")}
            </Label>
            <div className="flex gap-2">
              <DatePicker
                id="task-deadline-date"
                value={newTaskDeadline ? newTaskDeadline.slice(0, 10) : ""}
                onChange={(v) =>
                  setNewTaskDeadline(
                    v ? `${v}T${newTaskDeadline.slice(11, 16) || "00:00"}` : "",
                  )
                }
                placeholder={t(
                  "insightDetail.createTask.datePlaceholder",
                  "Select date",
                )}
                clearLabel={t("common.clear", "Clear")}
                todayLabel={t("common.today", "Today")}
                localeZh={i18n.language.startsWith("zh")}
                triggerClassName="h-8"
              />
              <TimePicker
                id="task-deadline-time"
                triggerClassName="h-8"
                value={
                  newTaskDeadline && newTaskDeadline.length >= 16
                    ? newTaskDeadline.slice(11, 16)
                    : ""
                }
                onChange={(v) =>
                  setNewTaskDeadline(
                    newTaskDeadline && newTaskDeadline.length >= 10
                      ? `${newTaskDeadline.slice(0, 10)}T${v || "00:00"}`
                      : "",
                  )
                }
                placeholder={t(
                  "insightDetail.createTask.timePlaceholder",
                  "Select time",
                )}
              />
            </div>
          </div>
        </div>
        <DialogFooter className="px-4 pb-4 pt-4 border-t border-border">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isCreating}
          >
            {t("common.cancel", "Cancel")}
          </Button>
          <Button
            type="button"
            onClick={createNewTask}
            disabled={isCreating || !newTaskTitle.trim()}
          >
            {isCreating
              ? t("common.loading", "Creating...")
              : t("common.create", "Create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface InsightDetailActionsProps {
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
  externalCreateDialogOpen?: boolean;
  onExternalCreateDialogChange?: (open: boolean) => void;
  /** Auto-open task detail dialog when drawer opens (for action items panel card click) */
  initialOpenTaskStorageKey?: string;
  initialOpenTaskBucket?: TaskBucketKey;
  initialTaskEditMode?: boolean;
  onInitialTaskOpened?: () => void;
  /** Task detail dialog close callback (panel closes drawer when only showing dialog) */
  onTaskDetailClose?: () => void;
  /** Callback when clicking related event card (opens event in current panel, shows full Insight if opened from todo panel) */
  onOpenRelatedInsight?: (insight: Insight) => void;
}

export function InsightDetailActions({
  insight,
  todoBuckets,
  completedTasks,
  loadingTasks,
  toggleTaskCompletion,
  openSchedulingLink,
  onTaskCreated,
  externalCreateDialogOpen,
  onExternalCreateDialogChange,
  initialOpenTaskStorageKey,
  initialOpenTaskBucket,
  initialTaskEditMode,
  onInitialTaskOpened,
  onTaskDetailClose,
  onOpenRelatedInsight,
}: InsightDetailActionsProps) {
  const { t, i18n } = useTranslation();
  const localeForDeadlines = i18n.language.startsWith("zh") ? zhCN : enGB;

  // Use task operations hook
  const {
    updateTaskTitle,
    updateTaskPrioritySimple,
    moveTask,
    patchTaskField,
    createTask,
    toggleTaskCompletion: toggleTaskCompletionOp,
    loadingMap,
  } = useTaskOperations();

  // Calculate isCreating state from loadingMap
  const isCreating = Object.keys(loadingMap).some((key) =>
    key.startsWith("create-"),
  );

  // Create task dialog state
  const [internalCreateDialogOpen, setInternalCreateDialogOpen] =
    useState(false);
  const isCreateDialogOpen =
    externalCreateDialogOpen !== undefined
      ? externalCreateDialogOpen
      : internalCreateDialogOpen;
  const setIsCreateDialogOpen = (open: boolean) => {
    if (onExternalCreateDialogChange) {
      onExternalCreateDialogChange(open);
    } else {
      setInternalCreateDialogOpen(open);
    }
  };

  // rerender-lazy-state-init: Use function to initialize state, avoid creating new objects on each render
  const [newTaskTitle, setNewTaskTitle] = useState(() => "");
  const [newTaskContext, setNewTaskContext] = useState(() => "");
  const [newTaskDeadline, setNewTaskDeadline] = useState(() => "");
  const [newTaskOwner, setNewTaskOwner] = useState(() => "__none__");
  const [selectedBucket, setSelectedBucket] = useState<TaskBucketKey>(
    () => "myTasks",
  );
  const [newTaskPriority, setNewTaskPriority] = useState<
    "high" | "medium" | "low" | null
  >(() => null);
  // Owner search state
  const [ownerInputValue, setOwnerInputValue] = useState("");
  const [showOwnerSuggestions, setShowOwnerSuggestions] = useState(false);

  // Inline title edit state
  const [editingTitleInline, setEditingTitleInline] = useState<{
    storageKey: string;
    bucketKey: TaskBucketKey;
    value: string;
  } | null>(null);

  // Global optimistic update management
  const {
    updateTitle: updateTitleOptimistic,
    updatePriority: updatePriorityOptimistic,
    updateBucket: updateBucketOptimistic,
    toggleTaskCompletion: toggleCompletionOptimistic,
    getTitle,
    getPriority,
    getDeadline,
    getBucket,
    getTaskUpdates,
    isTaskCompleted,
    isTaskDeleted,
    getTempTasks,
  } = useInsightOptimisticUpdates();

  // Create wrapper function to use global Context's toggleTaskCompletion
  const handleToggleTaskCompletion = useCallback(
    async (
      storageKey: string,
      bucketKey: TaskBucketKey,
      isCompleted: boolean,
    ) => {
      // isCompleted is current state, need to invert to get target state
      const targetCompleted = !isCompleted;

      // Use global optimistic update
      await toggleCompletionOptimistic(
        storageKey,
        targetCompleted,
        async () => {
          // Call original toggleTaskCompletion
          await toggleTaskCompletionOp(
            insight.id,
            storageKey,
            bucketKey,
            targetCompleted,
          );
        },
      );
    },
    [toggleCompletionOptimistic, toggleTaskCompletionOp, insight.id],
  );

  /** Title input ref inside detail dialog, used to force focus after entering edit mode (bypass Radix focus trap) */
  const detailTitleInputRef = useRef<HTMLInputElement>(null);

  // Action item detail dialog: currently selected task entry
  const [detailTaskEntry, setDetailTaskEntry] = useState<{
    key: string;
    storageKey: string;
    task: InsightTaskItem;
    link: string | null;
    bucketKey: TaskBucketKey;
  } | null>(null);

  /** When entering detail title edit, delay focus to input (executes after Radix Dialog focus management) */
  useEffect(() => {
    if (
      !detailTaskEntry ||
      !editingTitleInline ||
      editingTitleInline.storageKey !== detailTaskEntry.storageKey
    )
      return;
    const t = setTimeout(() => {
      detailTitleInputRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [detailTaskEntry?.storageKey, editingTitleInline?.storageKey]);

  /** When todoBuckets updates, sync update task data in detailTaskEntry */
  useEffect(() => {
    if (!detailTaskEntry) return;

    // Detail dialog data is updated in these ways:
    // 1. Read from todoBuckets when dialog opens
    // 2. Update via optimistic update and success callback when editing
    // Do not auto-update task object here to avoid overwriting user's edits

    // Only check if storageKey needs update (handles cases where storageKey changes after optimistic update)
    const foundTask = todoBuckets
      .flatMap((bucket) =>
        bucket.tasks.map((t) => ({
          ...t,
          bucketKey: bucket.key as TaskBucketKey,
        })),
      )
      .find(
        (t) =>
          t.task.title === detailTaskEntry.task.title &&
          t.storageKey !== detailTaskEntry.storageKey,
      );

    if (foundTask) {
      // Found task with same title but different storageKey, update storageKey and bucketKey
      setDetailTaskEntry((prev) =>
        prev
          ? {
              ...prev,
              storageKey: foundTask.storageKey,
              bucketKey: foundTask.bucketKey,
            }
          : null,
      );
    }
  }, [todoBuckets]);

  // Get chat context
  const {
    sendMessage,
    toggleFocusedInsight,
    focusedInsights,
    activeChatId: currentChatId,
    switchChatId,
  } = useChatContextOptional() ?? {
    toggleFocusedInsight: () => {},
    focusedInsights: [],
    activeChatId: null,
    switchChatId: () => {},
  };
  const { data: session } = useSession();
  const router = useRouter();

  /**
   * Create new task
   */
  const createNewTask = async () => {
    const owner = newTaskOwner === "__none__" ? undefined : newTaskOwner;
    const result = await createTask(insight.id, selectedBucket, {
      title: newTaskTitle,
      context: newTaskContext,
      deadline: newTaskDeadline,
      owner,
      priority: newTaskPriority,
    });

    if (result) {
      // Close dialog and reset form
      setIsCreateDialogOpen(false);
      setNewTaskTitle("");
      setNewTaskContext("");
      setNewTaskDeadline("");
      setNewTaskOwner("__none__");
      setOwnerInputValue("");
      setShowOwnerSuggestions(false);
      setSelectedBucket("myTasks");
      setNewTaskPriority(null);

      // Refresh task list
      if (onTaskCreated) {
        await onTaskCreated();
      }
    }
  };

  /**
   * Execute single task - open conversation and use task as context
   * Consistent with footer send message behavior: execute directly in current conversation, do not change URL
   * rerender-defer-reads: Read state inside callback, reduce unnecessary dependencies
   */
  const executeTask = useCallback(
    async (task: InsightTaskItem) => {
      // Read chat context inside callback to avoid depending on external state
      const {
        focusedInsights: currentFocusedInsights,
        toggleFocusedInsight: currentToggleFocused,
        sendMessage: currentSendMessage,
        chatId: currentChatIdContext,
        switchChatId: currentSwitchChatId,
      } = {
        focusedInsights,
        toggleFocusedInsight,
        sendMessage,
        chatId: currentChatId,
        switchChatId,
      };

      const taskTitle =
        task.title ||
        task.context ||
        t("insightDetail.todoUntitled", "Untitled task");
      const taskDescription = task.context || "";

      // Check if current insight is already in focus list
      const isFocused = currentFocusedInsights.some((i) => i.id === insight.id);

      // If not in focus, set as focus first
      if (!isFocused) {
        currentToggleFocused(insight);
      }

      const message = `Help me execute the task：

${taskTitle}
${taskDescription ? `\nDetail：${taskDescription}` : ""}

Please execute this task directly.
Once the task is completed, please mark the task status as "completed".`;

      // Ensure current insight is included in focused insights
      // If current insight is not yet in focusedInsights, add it
      const isCurrentInsightFocused = currentFocusedInsights.some(
        (i) => i.id === insight.id,
      );
      const effectiveFocusedInsights = isCurrentInsightFocused
        ? currentFocusedInsights
        : [...currentFocusedInsights, insight];

      // Use current chatId, or generate a new one if not available
      const targetChatId = currentChatIdContext ?? generateUUID();

      // Switch to that chatId
      if (targetChatId !== currentChatIdContext) {
        currentSwitchChatId?.(targetChatId);
      }

      // First send message (will sync to state), then navigate
      // This avoids AI not responding because message was not yet added to state after page navigation
      try {
        await currentSendMessage?.({
          role: "user",
          parts: [
            {
              type: "text",
              text: message,
            },
          ],
          metadata: {
            currentInsightId: insight.id,
            // Use referencedContextInsightIds instead of currentInsightId
            // This way the logic in API's prepareSendMessagesRequest can correctly identify the main event
            referencedContextInsightIds: effectiveFocusedInsights
              .filter((i) => i.id !== insight.id)
              .map((i) => i.id),
            // Fields needed in Native Agent mode
            // Native agent reads these fields from metadata to get focused insights
            focusedInsightIds: effectiveFocusedInsights.map((i) => i.id),
            focusedInsights: effectiveFocusedInsights.map((i) => ({
              id: i.id,
              title: i.title,
              description: i.description,
              details: i.details,
              groups: i.groups,
              platform: i.platform,
            })),
          },
        });
      } catch (err) {
        console.error("[InsightDetailActions] Failed to send message:", err);
      }

      // Navigate to chat page (message already added to state)
      router.push(`/?page=chat&chatId=${encodeURIComponent(targetChatId)}`);
    },
    [
      insight,
      t,
      focusedInsights,
      toggleFocusedInsight,
      sendMessage,
      currentChatId,
      switchChatId,
      router,
    ],
  );

  // Build contact list (for owner selection)
  const ownerSuggestions = useMemo(() => {
    const suggestions: string[] = [];

    // Add current user
    if (session?.user?.name) {
      suggestions.push(session.user.name);
    }

    // Add contacts from insight.people
    insight.people
      ?.filter(
        (p) =>
          p &&
          !p.startsWith("anonymous user") &&
          !p.startsWith("unknown") &&
          p !== session?.user?.name,
      )
      .forEach((person) => {
        if (!suggestions.includes(person)) {
          suggestions.push(person);
        }
      });

    // Add contacts from insight.stakeholders
    insight.stakeholders
      ?.filter((s) => s?.name && s.name !== session?.user?.name)
      .forEach((stakeholder) => {
        if (stakeholder.name && !suggestions.includes(stakeholder.name)) {
          suggestions.push(stakeholder.name);
        }
      });

    return suggestions;
  }, [insight.people, insight.stakeholders, session?.user?.name]);

  // Filter contacts by input
  const filteredOwnerSuggestions = useMemo(() => {
    if (!ownerInputValue) {
      return ownerSuggestions;
    }
    const query = ownerInputValue.toLowerCase();
    return ownerSuggestions.filter((name) =>
      name.toLowerCase().includes(query),
    );
  }, [ownerSuggestions, ownerInputValue]);

  /**
   * Start inline title edit
   */
  const startInlineTitleEdit = (
    storageKey: string,
    bucketKey: TaskBucketKey,
    currentTitle: string,
  ) => {
    setEditingTitleInline({
      storageKey,
      bucketKey,
      value: currentTitle,
    });
  };

  /**
   * Cancel inline title edit
   */
  const cancelInlineTitleEdit = () => {
    setEditingTitleInline(null);
  };

  /**
   * Save inline edited title
   */
  const saveInlineTitle = async (
    storageKey: string,
    bucketKey: TaskBucketKey,
    newTitle: string,
    originalTitle: string,
  ) => {
    const nextTitle = newTitle.trim();
    if (!nextTitle) {
      toast({
        type: "error",
        description: t(
          "insightDetail.createTask.titleRequired",
          "Please enter a task title",
        ),
      });
      return;
    }

    // If no change, exit edit directly
    if (nextTitle === originalTitle.trim()) {
      setEditingTitleInline(null);
      return;
    }

    setEditingTitleInline(null);

    // Optimistic update: immediately display new title
    await updateTitleOptimistic(storageKey, nextTitle, async () => {
      await updateTaskTitle(
        insight.id,
        storageKey,
        bucketKey,
        nextTitle,
        originalTitle,
      );

      // Trigger refresh, fetch latest data from server
      if (onTaskCreated) {
        await onTaskCreated();

        // If this task is open in the detail dialog, update its title
        if (detailTaskEntry?.storageKey === storageKey) {
          setDetailTaskEntry((prev) =>
            prev ? { ...prev, task: { ...prev.task, title: nextTitle } } : null,
          );
        }
      }
    });
  };

  /**
   * Open action item detail dialog
   */
  const openDetailDialog = (entry: {
    key: string;
    storageKey: string;
    task: InsightTaskItem;
    link: string | null;
    bucketKey: TaskBucketKey;
  }) => {
    setDetailTaskEntry(entry);
  };

  /** Auto-open task detail dialog if initialOpenTask is provided when drawer opens */
  useEffect(() => {
    if (
      !initialOpenTaskStorageKey ||
      !initialOpenTaskBucket ||
      !todoBuckets?.length ||
      !onInitialTaskOpened
    )
      return;
    const bucket = todoBuckets.find((b) => b.key === initialOpenTaskBucket);
    const item = bucket?.tasks.find(
      (t) => t.storageKey === initialOpenTaskStorageKey,
    );
    if (!bucket || !item) return;
    const entry = {
      key: item.key,
      storageKey: item.storageKey,
      task: item.task,
      link: item.link,
      bucketKey: bucket.key as TaskBucketKey,
    };
    setDetailTaskEntry(entry);
    onInitialTaskOpened();
  }, [
    todoBuckets,
    initialOpenTaskStorageKey,
    initialOpenTaskBucket,
    onInitialTaskOpened,
  ]);

  /**
   * Get corresponding color style based on task status
   * Keep consistent with styles in InsightTaskCard
   */
  const getStatusColor = (status: string | undefined | null): string => {
    switch (status) {
      case "completed":
        return "bg-emerald-100 text-emerald-700";
      case "blocked":
        return "bg-rose-100 text-rose-700";
      case "delegated":
        return "bg-amber-50 text-amber-600";
      case "pending":
      default:
        return "bg-amber-50 text-amber-600";
    }
  };

  // Check if there are any tasks (including existing tasks and temporary tasks)
  const hasAnyTasks =
    todoBuckets.length > 0 || getTempTasks(insight.id).length > 0;

  // When no action items, do not show "No action items" or extra add button (create already in title row), only keep dialog to support creation from title
  if (!hasAnyTasks) {
    return (
      <>
        <CreateTaskDialog
          isOpen={isCreateDialogOpen}
          onOpenChange={setIsCreateDialogOpen}
          isCreating={isCreating}
          newTaskTitle={newTaskTitle}
          setNewTaskTitle={setNewTaskTitle}
          newTaskContext={newTaskContext}
          setNewTaskContext={setNewTaskContext}
          newTaskDeadline={newTaskDeadline}
          setNewTaskDeadline={setNewTaskDeadline}
          ownerInputValue={ownerInputValue}
          setOwnerInputValue={setOwnerInputValue}
          newTaskOwner={newTaskOwner}
          setNewTaskOwner={setNewTaskOwner}
          showOwnerSuggestions={showOwnerSuggestions}
          setShowOwnerSuggestions={setShowOwnerSuggestions}
          filteredOwnerSuggestions={filteredOwnerSuggestions}
          selectedBucket={selectedBucket}
          setSelectedBucket={setSelectedBucket}
          newTaskPriority={newTaskPriority}
          setNewTaskPriority={setNewTaskPriority}
          createNewTask={createNewTask}
        />
      </>
    );
  }

  return (
    <div className="space-y-3">
      {/* Create task dialog */}
      <CreateTaskDialog
        isOpen={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        isCreating={isCreating}
        newTaskTitle={newTaskTitle}
        setNewTaskTitle={setNewTaskTitle}
        newTaskContext={newTaskContext}
        setNewTaskContext={setNewTaskContext}
        newTaskDeadline={newTaskDeadline}
        setNewTaskDeadline={setNewTaskDeadline}
        ownerInputValue={ownerInputValue}
        setOwnerInputValue={setOwnerInputValue}
        newTaskOwner={newTaskOwner}
        setNewTaskOwner={setNewTaskOwner}
        showOwnerSuggestions={showOwnerSuggestions}
        setShowOwnerSuggestions={setShowOwnerSuggestions}
        filteredOwnerSuggestions={filteredOwnerSuggestions}
        selectedBucket={selectedBucket}
        setSelectedBucket={setSelectedBucket}
        newTaskPriority={newTaskPriority}
        setNewTaskPriority={setNewTaskPriority}
        createNewTask={createNewTask}
      />

      {/* Action item detail dialog */}
      {detailTaskEntry && (
        <Suspense fallback={null}>
          <TaskDetailDialogLazy
            insightId={insight.id}
            insight={insight}
            detailTaskEntry={detailTaskEntry}
            todoBuckets={todoBuckets.map((b) => ({
              key: b.key as TaskBucketKey,
              tasks: b.tasks.map((t) => ({
                ...t,
                bucketKey: b.key as TaskBucketKey,
              })),
            }))}
            onClose={() => {
              setDetailTaskEntry(null);
              onTaskDetailClose?.();
            }}
            toggleTaskCompletion={toggleTaskCompletion}
            ownerSuggestions={ownerSuggestions}
            currentUserName={session?.user?.name ?? undefined}
            onTaskUpdated={async () => {
              if (onTaskCreated) await onTaskCreated();
            }}
            onTaskDeleted={async () => {
              if (onTaskCreated) await onTaskCreated();
            }}
            onPrioritySelect={async (storageKey, bucketKey, priority) => {
              await updatePriorityOptimistic(storageKey, priority, async () => {
                await updateTaskPrioritySimple(
                  insight.id,
                  storageKey,
                  bucketKey,
                  priority,
                );
                if (onTaskCreated) await onTaskCreated();
              });
            }}
            onTypeSelect={async (storageKey, bucketKey, newBucket) => {
              await updateBucketOptimistic(storageKey, newBucket, async () => {
                await moveTask(insight.id, storageKey, bucketKey, newBucket);
                if (onTaskCreated) await onTaskCreated();
              });
            }}
            onFieldUpdate={async (storageKey, bucketKey, field, value) => {
              await patchTaskField(
                insight.id,
                storageKey,
                bucketKey,
                field,
                value,
              );
              if (onTaskCreated) await onTaskCreated();
            }}
            onOpenRelatedInsight={onOpenRelatedInsight}
          />
        </Suspense>
      )}

      <div className="space-y-1.5">
        {(() => {
          // Merge all tasks, flatten (remove group aggregation)
          const allTasks: Array<{
            key: string;
            storageKey: string;
            task: InsightTaskItem;
            link: string | null;
            bucketKey: TaskBucketKey;
          }> = [];

          // Collect all tasks, apply optimistic updates
          todoBuckets.forEach((bucket) => {
            bucket.tasks.forEach((entry) => {
              // Filter out deleted tasks
              if (!isTaskDeleted(entry.storageKey)) {
                allTasks.push({
                  ...entry,
                  bucketKey:
                    (entry as any).bucket || (bucket.key as TaskBucketKey),
                });
              }
            });
          });

          // Add temporary tasks (optimistically created but not yet saved to database)
          const tempTasks = getTempTasks(insight.id);
          tempTasks.forEach((tempTask) => {
            allTasks.push({
              key: `${tempTask.task.storageKey || tempTask.insightId}`,
              storageKey: tempTask.task.storageKey,
              task: tempTask.task,
              link: null,
              bucketKey: tempTask.bucketKey,
            });
          });

          return allTasks.map((entry, entryIndex) => {
            const storageKey = entry.storageKey;

            // Use getTaskUpdates to uniformly get task object and bucket optimistic updates
            const { task: optimisticTask, bucketKey: displayBucketKey } =
              getTaskUpdates(storageKey, entry.task, entry.bucketKey);

            // Use optimistic update completion status
            const isCompleted = optimisticTask.status === "completed";

            // Use optimistic update deadline
            const deadlineValue = optimisticTask.deadline;
            let deadlineLabel: string | null = null;
            if (deadlineValue) {
              const parsed = new Date(deadlineValue);
              if (!Number.isNaN(parsed.getTime())) {
                deadlineLabel = format(parsed, "PPpp", {
                  locale: localeForDeadlines,
                });
              }
            }

            let followUpLabel: string | null = null;
            let followUpOverdue = false;
            if (optimisticTask.followUpAt) {
              const parsed = new Date(optimisticTask.followUpAt);
              if (!Number.isNaN(parsed.getTime())) {
                followUpLabel = format(parsed, "PPpp", {
                  locale: localeForDeadlines,
                });
                followUpOverdue = parsed.getTime() < Date.now() && !isCompleted;
              }
            }

            const lastFollowUpLabel = optimisticTask.lastFollowUpAt
              ? format(new Date(optimisticTask.lastFollowUpAt), "PPpp", {
                  locale: localeForDeadlines,
                })
              : null;

            // Apply optimistic update: priority
            const effectivePriority = getPriority(
              storageKey,
              optimisticTask.priority || null,
            );
            const priorityLabel = effectivePriority || null;
            const typeLabel =
              displayBucketKey === "myTasks"
                ? t("agent.panels.todo.tabs.myCommitments", "My commitments")
                : displayBucketKey === "waitingForMe"
                  ? t("agent.panels.todo.tabs.waitingForMe", "Waiting for me")
                  : t(
                      "agent.panels.todo.tabs.othersCommitments",
                      "Others' commitments",
                    );

            const rawDeadlineLabel = optimisticTask.rawDeadline
              ? t("insightDetail.todoRawDeadline", {
                  deadline: optimisticTask.rawDeadline,
                  defaultValue: `Original deadline: ${optimisticTask.rawDeadline}`,
                })
              : null;

            const confidenceLabel =
              typeof optimisticTask.confidence === "number"
                ? t("insightDetail.todoConfidence", {
                    confidence: Math.round(optimisticTask.confidence * 100),
                    defaultValue: `Confidence: ${Math.round(optimisticTask.confidence * 100)}%`,
                  })
                : null;

            const responderName =
              optimisticTask.responder ??
              (entry.bucketKey === "waitingForOthers" &&
              optimisticTask.owner &&
              optimisticTask.owner !== "__none__"
                ? optimisticTask.owner
                : null);

            const responderLabel = responderName
              ? t("insightDetail.todoResponder", {
                  responder: responderName,
                  defaultValue: `Waiting on: ${responderName}`,
                })
              : null;

            const derivedStatus = isCompleted ? "completed" : "pending";

            const statusKeyMap: Record<
              string,
              { key: string; fallback: string }
            > = {
              completed: {
                key: "insightDetail.todoCompleted",
                fallback: "Completed",
              },
              pending: {
                key: "insightDetail.todoPending",
                fallback: "Pending",
              },
              blocked: {
                key: "insightDetail.todoBlocked",
                fallback: "Blocked",
              },
              delegated: {
                key: "insightDetail.todoDelegated",
                fallback: "Delegated",
              },
            };

            const statusMeta =
              statusKeyMap[derivedStatus] ?? statusKeyMap.pending;
            const statusBadge = t(statusMeta.key, statusMeta.fallback);

            const followUpText = followUpLabel
              ? t("insightDetail.todoFollowUp", {
                  deadline: followUpLabel,
                  defaultValue: `Check-in by: ${followUpLabel}`,
                })
              : null;

            const lastFollowUpText = lastFollowUpLabel
              ? t("insightDetail.todoLastFollowUp", {
                  time: lastFollowUpLabel,
                  defaultValue: `Last check-in: ${lastFollowUpLabel}`,
                })
              : null;

            const canToggleStatus =
              !optimisticTask.status ||
              optimisticTask.status === "pending" ||
              optimisticTask.status === "completed";

            const statusColor = getStatusColor(derivedStatus);
            // Apply optimistic update: title
            const taskTitle = getTitle(
              storageKey,
              optimisticTask.title ||
                optimisticTask.context ||
                t("insightDetail.todoUntitled", "Untitled task"),
            );
            const displayDeadline = deadlineLabel || rawDeadlineLabel || null;

            const isEditingThisTitle =
              editingTitleInline?.storageKey === storageKey;

            return (
              <InsightTaskCard
                key={`${entry.key}-${entryIndex}-${isCompleted}`}
                cardKey={`${entry.key}-${entryIndex}`}
                title={taskTitle}
                isCompleted={isCompleted}
                canToggleStatus={canToggleStatus}
                isLoadingCheckbox={!!loadingTasks[storageKey]}
                onToggleComplete={() =>
                  handleToggleTaskCompletion(
                    storageKey,
                    displayBucketKey,
                    isCompleted,
                  )
                }
                priorityLabel={priorityLabel}
                effectivePriority={
                  effectivePriority as "high" | "medium" | "low" | null
                }
                typeLabel={typeLabel ?? ""}
                deadlineLabel={displayDeadline || "-"}
                onCardClick={() => openDetailDialog(entry)}
                disableCardClick={isEditingThisTitle}
                statusBadge={
                  derivedStatus !== "pending" ? statusBadge : undefined
                }
                statusColor={
                  derivedStatus !== "pending" ? statusColor : undefined
                }
                detailActions={{
                  isEditingTitle: editingTitleInline?.storageKey === storageKey,
                  editValue: editingTitleInline?.value ?? taskTitle,
                  onEditChange: (value) =>
                    setEditingTitleInline((prev) =>
                      prev && prev.storageKey === storageKey
                        ? { ...prev, value }
                        : prev,
                    ),
                  onEditSave: () =>
                    saveInlineTitle(
                      storageKey,
                      entry.bucketKey,
                      editingTitleInline?.value || taskTitle,
                      taskTitle,
                    ),
                  onEditBlur: () =>
                    saveInlineTitle(
                      storageKey,
                      entry.bucketKey,
                      editingTitleInline?.value || taskTitle,
                      taskTitle,
                    ),
                  onEditKeyDown: (e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      cancelInlineTitleEdit();
                    }
                  },
                  onStartEdit: () =>
                    startInlineTitleEdit(
                      storageKey,
                      entry.bucketKey,
                      taskTitle,
                    ),
                  isSavingTitle: Boolean(loadingMap[storageKey]),
                  showExecuteButton: status === "ready",
                  onExecute: () => executeTask(entry.task),
                  executeDisabled: status !== "ready",
                }}
              >
                {(responderLabel ||
                  confidenceLabel ||
                  followUpText ||
                  lastFollowUpText) && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground/80">
                    {responderLabel && <span>{responderLabel}</span>}
                    {confidenceLabel && <span>{confidenceLabel}</span>}
                    {followUpText && (
                      <span
                        className={
                          followUpOverdue
                            ? "text-rose-600 font-semibold"
                            : undefined
                        }
                      >
                        {followUpText}
                      </span>
                    )}
                    {lastFollowUpText && <span>{lastFollowUpText}</span>}
                  </div>
                )}
                {optimisticTask.followUpNote && (
                  <p className="text-xs text-muted-foreground/80 italic">
                    {t("insightDetail.todoFollowUpNote", {
                      note: optimisticTask.followUpNote,
                      defaultValue: `Note: ${optimisticTask.followUpNote}`,
                    })}
                  </p>
                )}
              </InsightTaskCard>
            );
          });
        })()}
      </div>
    </div>
  );
}
