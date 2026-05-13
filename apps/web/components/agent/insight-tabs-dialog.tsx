"use client";

import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import "../../i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@openloomi/ui";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Badge, Button, Switch } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import {
  useInsightTabs,
  type InsightTab,
  type InsightTabPayload,
} from "@/hooks/use-insight-tabs";
import { toast } from "@/components/toast";
import { cn } from "@/lib/utils";
import { InsightTabEditDialog } from "./insight-tab-edit-dialog";
import type { Insight } from "@/lib/db/schema";

/**
 * Props for Tab management dialog
 */
export interface InsightTabsDialogProps {
  /**
   * Whether dialog is open
   */
  isOpen: boolean;
  /**
   * Dialog open/close state change callback
   */
  onOpenChange: (open: boolean) => void;
  /**
   * Insights data (for extracting filter options)
   */
  insights?: Insight[];
}

/**
 * Insight Tabs management dialog component
 * Used to create, edit, delete and manage multiple tabs, each tab can use independent filter rules
 */
export function InsightTabsDialog({
  isOpen,
  onOpenChange,
  insights = [],
}: InsightTabsDialogProps) {
  const { t } = useTranslation();
  const {
    tabs,
    isLoaded,
    createTab,
    updateTab,
    deleteTab,
    toggleTabEnabled,
    reorderTabs,
  } = useInsightTabs();

  // Edit/create dialog state
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingTab, setEditingTab] = useState<InsightTab | null>(null);
  const [mainDialogOpen, setMainDialogOpen] = useState(isOpen);

  // Drag state
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);

  // VIP auto-generate state
  const [isGeneratingVIP, setIsGeneratingVIP] = useState(false);

  /**
   * Check if VIP group's filter is empty
   */
  const isVIPFilterEmpty = useCallback(() => {
    const vipTab = tabs.find((tab) => tab.id === "preset:important-people");
    if (!vipTab) return false;

    // Check if filter conditions are empty or if people values are empty
    const filter = vipTab.filter;
    if (!filter) return true;

    // Check if it's InsightFilterDefinition type
    if ("conditions" in filter && filter.conditions) {
      const peopleCondition = filter.conditions.find(
        (c) => c.kind === "people",
      );
      // Check if has values property (excluding time_window and other types)
      if (peopleCondition && "values" in peopleCondition) {
        return !peopleCondition.values || peopleCondition.values.length === 0;
      }
      return true;
    }

    return true;
  }, [tabs]);

  /**
   * Delete tab
   */
  const handleDeleteTab = useCallback(
    (tabId: string) => {
      try {
        deleteTab(tabId);
        toast({
          type: "success",
          description: t(
            "insight.tabs.deleteSuccess",
            "Tab deleted successfully",
          ),
        });
      } catch (error) {
        console.error("Failed to delete tab:", error);
        toast({
          type: "error",
          description: t(
            "insight.tabs.deleteError",
            "Failed to delete, please retry",
          ),
        });
      }
    },
    [deleteTab, t],
  );

  /**
   * Start creating new group
   */
  const handleStartCreate = useCallback(() => {
    setEditingTab(null);
    setMainDialogOpen(false);
    setIsEditDialogOpen(true);
  }, []);

  /**
   * Start editing tab
   */
  const handleStartEdit = useCallback((tab: InsightTab) => {
    setEditingTab(tab);
    setMainDialogOpen(false);
    setIsEditDialogOpen(true);
  }, []);

  /**
   * Handle edit dialog close
   */
  const handleEditDialogClose = useCallback((open: boolean) => {
    setIsEditDialogOpen(open);
    if (!open) {
      // After edit dialog closes, reopen main dialog
      setEditingTab(null);
      setMainDialogOpen(true);
    }
  }, []);

  /**
   * Handle create tab
   */
  const handleCreateTab = useCallback(
    (payload: InsightTabPayload) => {
      createTab(payload);
    },
    [createTab],
  );

  /**
   * Handle update tab
   */
  const handleUpdateTab = useCallback(
    (tabId: string, payload: Partial<InsightTabPayload>) => {
      updateTab(tabId, payload);
    },
    [updateTab],
  );

  /**
   * Add from template
   */
  const handleAddFromTemplate = useCallback(() => {
    // TODO: Implement add-from-template feature
    toast({
      type: "success",
      description: t(
        "insight.tabs.templateComingSoon",
        "Template feature coming soon",
      ),
    });
  }, [t]);

  /**
   * Sync main dialog state
   */
  useEffect(() => {
    setMainDialogOpen(isOpen);
  }, [isOpen]);

  /**
   * Handle drag start
   */
  const handleDragStart = useCallback((e: React.DragEvent, tabId: string) => {
    // System tabs cannot be dragged
    if (tabId.startsWith("system:")) {
      e.preventDefault();
      return;
    }
    setDraggedTabId(tabId);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  /**
   * Handle drag end
   */
  const handleDragEnd = useCallback(() => {
    setDraggedTabId(null);
    setDragOverTabId(null);
  }, []);

  /**
   * Handle drag over
   */
  const handleDragOver = useCallback(
    (e: React.DragEvent, tabId: string) => {
      // System tabs cannot be drop targets
      if (
        tabId.startsWith("system:") ||
        !draggedTabId ||
        draggedTabId === tabId
      ) {
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverTabId(tabId);
    },
    [draggedTabId],
  );

  /**
   * Handle drag leave
   */
  const handleDragLeave = useCallback(() => {
    setDragOverTabId(null);
  }, []);

  /**
   * Handle drop
   */
  const handleDrop = useCallback(
    (e: React.DragEvent, targetTabId: string) => {
      e.preventDefault();
      if (
        !draggedTabId ||
        draggedTabId === targetTabId ||
        targetTabId.startsWith("system:")
      ) {
        setDraggedTabId(null);
        setDragOverTabId(null);
        return;
      }

      // Get all sortable tabs (preset + custom, excluding system)
      const sortableTabs = tabs.filter(
        (tab) => tab.type === "preset" || tab.type === "custom",
      );
      const systemTabs = tabs.filter((tab) => tab.type === "system");

      // Find dragged tab and target position
      const draggedIndex = sortableTabs.findIndex(
        (tab) => tab.id === draggedTabId,
      );
      const targetIndex = sortableTabs.findIndex(
        (tab) => tab.id === targetTabId,
      );

      if (draggedIndex === -1 || targetIndex === -1) {
        setDraggedTabId(null);
        setDragOverTabId(null);
        return;
      }

      // Reorder
      const newSortableTabs = [...sortableTabs];
      const [removed] = newSortableTabs.splice(draggedIndex, 1);
      newSortableTabs.splice(targetIndex, 0, removed);

      // Merge system tabs and reordered tabs
      const allTabIds = [
        ...systemTabs.map((tab) => tab.id),
        ...newSortableTabs.map((tab) => tab.id),
      ];

      reorderTabs(allTabIds);
      setDraggedTabId(null);
      setDragOverTabId(null);
    },
    [draggedTabId, tabs, reorderTabs],
  );

  /**
   * Reset state when dialog closes
   */
  useEffect(() => {
    if (!isOpen) {
      setDraggedTabId(null);
      setDragOverTabId(null);
      setEditingTab(null);
      setIsEditDialogOpen(false);
      setMainDialogOpen(false);
    }
  }, [isOpen]);

  return (
    <>
      <Dialog
        open={mainDialogOpen}
        onOpenChange={(open) => {
          setMainDialogOpen(open);
          if (!open) {
            onOpenChange(false);
          }
        }}
      >
        <DialogContent
          className="sm:max-w-[600px] max-h-[85vh] flex flex-col overflow-hidden p-0"
          hideCloseButton
        >
          {/* Fixed Header */}
          <DialogHeader className="shrink-0 p-6 border-b">
            <div className="flex items-center justify-between">
              <DialogTitle className="flex-1">
                {t("insight.tabs.title", "Group management")}
              </DialogTitle>
              <div className="flex items-center gap-2">
                {/* Create button */}
                <Button
                  type="button"
                  variant="default"
                  onClick={handleStartCreate}
                  className="h-8 gap-2"
                >
                  <RemixIcon name="add" size="size-4" />
                  {t("common.create", "Create")}
                </Button>
                {/* Close button */}
                <DialogPrimitive.Close asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                  >
                    <RemixIcon name="close" size="size-4" />
                    <span className="sr-only">
                      {t("common.close", "Close")}
                    </span>
                  </Button>
                </DialogPrimitive.Close>
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="space-y-4 px-6 pb-6">
              {/* Tab list */}
              {!isLoaded ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {t("common.loading", "Loading...")}
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Preset and custom Tabs (draggable reorder), focus preset not shown */}
                  <div className="space-y-2">
                    {tabs
                      .filter(
                        (tab) =>
                          (tab.type === "preset" || tab.type === "custom") &&
                          tab.id !== "preset:focus",
                      )
                      .map((tab) => {
                        const isDragging = draggedTabId === tab.id;
                        const isDragOver = dragOverTabId === tab.id;
                        const isDraggable = tab.type !== "system";

                        const isVIPTab = tab.id === "preset:important-people";
                        const vipFilterEmpty = isVIPTab && isVIPFilterEmpty();

                        return (
                          // biome-ignore lint/nursery/noStaticElementInteractions:
                          <div
                            key={tab.id}
                            draggable={isDraggable}
                            onDragStart={(e) => handleDragStart(e, tab.id)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(e) => handleDragOver(e, tab.id)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, tab.id)}
                            className={cn(
                              "flex items-center gap-2 rounded-lg border border-border bg-background p-3 transition-all",
                              isDragging && "opacity-50",
                              isDragOver && "border-primary bg-primary/5",
                              isDraggable && "cursor-move",
                            )}
                          >
                            <RemixIcon
                              name="grip_vertical"
                              size="size-4"
                              className={cn(
                                "shrink-0 text-muted-foreground",
                                isDraggable &&
                                  "cursor-grab active:cursor-grabbing",
                              )}
                            />
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{tab.name}</span>
                                {tab.type === "preset" && (
                                  <Badge
                                    variant="secondary"
                                    className="text-xs px-1.5 py-0.5 h-5"
                                  >
                                    {t(
                                      "insight.tabs.preset.templateTag",
                                      "Template",
                                    )}
                                  </Badge>
                                )}
                                {vipFilterEmpty && (
                                  <Badge
                                    variant="outline"
                                    className="text-xs px-1.5 py-0.5 h-5 text-orange-500 border-orange-500"
                                  >
                                    {t(
                                      "insight.tabs.preset.notConfigured",
                                      "Not configured",
                                    )}
                                  </Badge>
                                )}
                              </div>
                              {tab.description && (
                                <div className="text-xs text-muted-foreground mt-1">
                                  {tab.description}
                                </div>
                              )}
                              {vipFilterEmpty && (
                                <div className="text-xs text-orange-500 mt-1">
                                  {t(
                                    "insight.tabs.preset.vipNotConfiguredHint",
                                    "Click the button on the right to automatically analyze and set VIP rules",
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              {/* Edit/view tab button */}
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => handleStartEdit(tab)}
                                className="h-8 w-8"
                                disabled={
                                  tab.type === "preset" && !tab.modifiable
                                }
                                aria-label={
                                  tab.type === "preset" && !tab.modifiable
                                    ? t("insight.tabs.view", "View")
                                    : t("common.edit", "Edit")
                                }
                                title={
                                  tab.type === "preset" && !tab.modifiable
                                    ? t(
                                        "insight.tabs.preset.viewOnly",
                                        "Preset group (read-only)",
                                      )
                                    : tab.type === "preset" && tab.modifiable
                                      ? t(
                                          "insight.tabs.preset.canModify",
                                          "Preset group (partial rules editable)",
                                        )
                                      : t("common.edit", "Edit")
                                }
                              >
                                <RemixIcon
                                  name="edit"
                                  size="size-4"
                                  className={cn(
                                    tab.type === "preset" &&
                                      !tab.modifiable &&
                                      "opacity-50",
                                  )}
                                />
                              </Button>
                              {/* Display Switch */}
                              <Switch
                                checked={tab.enabled}
                                onCheckedChange={(checked) => {
                                  // Ensure state updates immediately
                                  toggleTabEnabled(tab.id);
                                }}
                                aria-label={t(
                                  "insight.tabs.toggleEnabled",
                                  "Toggle enabled status",
                                )}
                              />
                            </div>
                          </div>
                        );
                      })}
                  </div>

                  {/* System Tabs */}
                  <div className="space-y-2">
                    {tabs
                      .filter((tab) => tab.type === "system")
                      .map((tab) => (
                        <div
                          key={tab.id}
                          className="flex items-center gap-2 rounded-lg border border-border bg-background p-3"
                        >
                          <RemixIcon
                            name="grip_vertical"
                            size="size-4"
                            className="shrink-0 text-muted-foreground opacity-50"
                          />
                          <div className="flex-1">
                            <div className="font-medium">{tab.name}</div>
                            {tab.description && (
                              <div className="text-xs text-muted-foreground mt-1">
                                {tab.description}
                              </div>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {/* Edit tab button */}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled
                              className="h-8 w-8"
                              aria-label={t("common.edit")}
                              title={t("common.edit")}
                            >
                              <RemixIcon
                                name="edit"
                                size="size-4"
                                className="opacity-50"
                              />
                            </Button>
                            {/* Display Switch */}
                            <Switch
                              checked={tab.enabled}
                              disabled
                              aria-label={t(
                                "insight.tabs.toggleEnabled",
                                "Toggle enabled status",
                              )}
                            />
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create/edit group dialog */}
      <InsightTabEditDialog
        isOpen={isEditDialogOpen}
        onOpenChange={handleEditDialogClose}
        editingTab={editingTab}
        onCreate={handleCreateTab}
        onUpdate={handleUpdateTab}
        onDelete={handleDeleteTab}
        existingTabs={tabs}
        insights={insights}
      />
    </>
  );
}
