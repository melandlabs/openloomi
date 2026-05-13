import { TodoHeaderPanel } from "@/components/agent/todo-header-panel";
import { AgentTodoPanel } from "@/components/agent/todo-panel";
import { Button } from "@openloomi/ui";
import { cn } from "@/lib/utils";
import { RemixIcon } from "@/components/remix-icon";
import { memo } from "react";

interface MobileTodoPanelWrapperProps {
  todoActiveTab: any;
  setTodoActiveTab: any;
  showCompleted: boolean;
  setShowCompleted: any;
  setTodoHeaderProps: any;
  todoHeaderProps: { taskCounts: Partial<Record<any, number>> };
  handleCloseToAssets: () => void;
  isMobile: boolean;
  t: any;
  onOpenRelatedInsight?: (insight: any) => void;
}

export const MobileTodoPanelWrapper = memo<MobileTodoPanelWrapperProps>(
  ({
    todoActiveTab,
    setTodoActiveTab,
    showCompleted,
    setShowCompleted,
    setTodoHeaderProps,
    todoHeaderProps,
    handleCloseToAssets,
    isMobile,
    t,
    onOpenRelatedInsight,
  }) => {
    return (
      <div className="flex h-full flex-col">
        <TodoHeaderPanel
          activeTab={todoActiveTab}
          onTabChange={setTodoActiveTab}
          showCompleted={showCompleted}
          onToggleShowCompleted={setShowCompleted}
          taskCounts={todoHeaderProps.taskCounts}
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCloseToAssets}
            className="h-8 w-8 shrink-0"
            aria-label={t("common.close", "Close")}
          >
            <RemixIcon name="close" size="size-4" />
          </Button>
        </TodoHeaderPanel>
        <div
          className={cn(
            "flex-1 min-h-0 overflow-auto",
            // Mobile adds bottom spacing (todo panel needs less spacing)
            isMobile && "pb-[80px]",
          )}
        >
          <AgentTodoPanel
            showCompleted={showCompleted}
            activeTab={todoActiveTab}
            onHeaderPropsChange={setTodoHeaderProps}
            onOpenRelatedInsight={onOpenRelatedInsight}
          />
        </div>
      </div>
    );
  },
  (prevProps, nextProps) => {
    // Custom comparison function, only re-renders when key props change
    return (
      prevProps.todoActiveTab === nextProps.todoActiveTab &&
      prevProps.showCompleted === nextProps.showCompleted &&
      prevProps.todoHeaderProps.taskCounts ===
        nextProps.todoHeaderProps.taskCounts
    );
  },
);

MobileTodoPanelWrapper.displayName = "MobileTodoPanelWrapper";
