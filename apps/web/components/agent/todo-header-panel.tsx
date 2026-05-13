"use client";

import { RemixIcon } from "@/components/remix-icon";
import { useTranslation } from "react-i18next";
import "../../i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openloomi/ui";
import { ScrollableTabs, TabBadge, TabButton } from "./scrollable-tabs";
import { AgentSectionHeader } from "./section-header";
import type { TaskFilterTab } from "./todo-types";

type TabItem = { value: TaskFilterTab; i18nKey: string; fallback: string };

const tabItems: TabItem[] = [
  { value: "all", i18nKey: "agent.panels.todo.tabs.all", fallback: "All" },
  {
    value: "waitingForMe",
    i18nKey: "agent.panels.todo.tabs.waitingForMe",
    fallback: "Pending",
  },
  {
    value: "isUnreplied",
    i18nKey: "agent.panels.todo.tabs.unreplied",
    fallback: "Awaiting reply",
  },
  {
    value: "myTasks",
    i18nKey: "agent.panels.todo.tabs.myCommitments",
    fallback: "My commitments",
  },
  {
    value: "waitingForOthers",
    i18nKey: "agent.panels.todo.tabs.othersCommitments",
    fallback: "Others' commitments",
  },
];

interface TodoHeaderPanelProps {
  /**
   * Currently selected tab
   */
  activeTab: TaskFilterTab;
  /**
   * Tab change callback
   */
  onTabChange: (tab: TaskFilterTab) => void;
  /**
   * Whether to show completed items
   */
  showCompleted: boolean;
  /**
   * Callback to toggle showing completed items
   */
  onToggleShowCompleted: (show: boolean) => void;
  /**
   * Task count for each tab
   */
  taskCounts?: Partial<Record<TaskFilterTab, number>>;
  /**
   * Whether to disable operations
   */
  disabled?: boolean;
  /**
   * Close button (passed as children, on the same row as tabs)
   */
  children?: React.ReactNode;
}

/**
 * Header component for the tasks panel
 * Contains tabs, completed/pending selector and mark-all-complete button, style consistent with events-panel.tsx
 *
 * Layout structure:
 * - First row: tabs and close button (children)
 * - Second row: completed/pending selector and mark-all-complete button (footer)
 */
export function TodoHeaderPanel({
  activeTab,
  onTabChange,
  showCompleted,
  onToggleShowCompleted,
  taskCounts = {},
  disabled = false,
  children,
}: TodoHeaderPanelProps) {
  const { t } = useTranslation();

  // Calculate display text for status selector
  const statusValue = showCompleted ? "completed" : "pending";

  // Handle status toggle - directly use external callback
  const handleValueChange = (value: string) => {
    if (onToggleShowCompleted) {
      onToggleShowCompleted(value === "completed");
    }
  };

  return (
    <AgentSectionHeader
      title={
        <ScrollableTabs>
          {tabItems.map((tab) => {
            const count = taskCounts[tab.value];
            return (
              <TabButton
                key={tab.value}
                active={activeTab === tab.value}
                onClick={() => onTabChange(tab.value)}
              >
                <span className="flex items-center gap-1.5">
                  <span>{t(tab.i18nKey, tab.fallback)}</span>
                  {count !== undefined && (
                    <TabBadge active={activeTab === tab.value}>
                      {count}
                    </TabBadge>
                  )}
                </span>
              </TabButton>
            );
          })}
        </ScrollableTabs>
      }
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {/* Completed / pending selector */}
          <Select
            value={statusValue}
            onValueChange={handleValueChange}
            disabled={disabled}
          >
            <SelectTrigger
              className="h-8 w-[120px] text-xs"
              disabled={disabled}
            >
              <div className="flex items-center gap-1.5">
                {showCompleted ? (
                  <RemixIcon name="checkbox_circle" size="size-3.5" filled />
                ) : (
                  <RemixIcon name="checkbox_blank" size="size-3.5" />
                )}
                <SelectValue>
                  {showCompleted
                    ? t("agent.panels.todo.completedGroup", "Completed")
                    : t("agent.panels.todo.pendingGroup", "Pending")}
                </SelectValue>
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">
                <div className="flex items-center gap-1.5">
                  <RemixIcon name="checkbox_blank" size="size-3.5" />
                  {t("agent.panels.todo.pendingGroup", "Pending")}
                </div>
              </SelectItem>
              <SelectItem value="completed">
                <div className="flex items-center gap-1.5">
                  <RemixIcon name="checkbox_circle" size="size-3.5" filled />
                  {t("agent.panels.todo.completedGroup", "Completed")}
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      }
    >
      {/* Close button and other right-side action buttons, on the same row as tabs */}
      {children}
    </AgentSectionHeader>
  );
}
