"use client";

import type { Insight } from "@/lib/db/schema";
import { useBriefPanelState } from "@/hooks/use-brief-panel-state";
import { useInsightActions } from "@/hooks/use-insight-actions";
import { useInsightPagination } from "@/hooks/use-insight-data";
import { useBatchInsightActions } from "@/hooks/use-batch-insight-actions";
import { useIsMobile } from "@openloomi/hooks/use-is-mobile";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import "../../i18n";
import InsightDetailDrawer from "@/components/insight-detail-drawer";
import { Spinner } from "@/components/spinner";
import { Button } from "@openloomi/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { BriefCategoryBlock } from "./brief-category-block";
import { BatchActionBar } from "./batch-action-bar";
import { BriefPanelStats } from "./brief-panel-stats";
import { InsightEmptyState } from "./insight-empty-state";
import { AgentSectionHeader } from "./section-header";
import { PanelSkeleton } from "./panel-skeleton";

const BRIEF_CATEGORIES = [
  { key: "urgent" as const, insightsKey: "urgent" as const },
  { key: "important" as const, insightsKey: "important" as const },
  { key: "monitor" as const, insightsKey: "monitor" as const },
] as const;

export interface AgentBriefPanelProps {
  hideHeader?: boolean;
  embedInCard?: boolean;
  externalSelectedInsight?: Insight | null;
  onExternalInsightClose?: () => void;
  /** When true, excludes manual platform insights from the list */
  excludeManualInsights?: boolean;
}

/**
 * Agent workspace brief panel component
 * Displays today's focused events, categorized by EventRank; desktop embeds detail cards, mobile uses global drawer
 */
export function AgentBriefPanel({
  hideHeader = false,
  embedInCard = false,
  externalSelectedInsight = null,
  onExternalInsightClose,
  excludeManualInsights = false,
}: AgentBriefPanelProps = {}) {
  const { t } = useTranslation();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  /** Connect Account (tool failures) → Connectors page + add platform */
  useEffect(() => {
    const handler = (e: Event) => {
      const platform = (e as CustomEvent).detail?.platform as
        | string
        | undefined;
      const url = platform
        ? `/connectors?addPlatform=true&platform=${encodeURIComponent(platform)}`
        : "/connectors?addPlatform=true";
      router.push(url);
    };
    window.addEventListener("openloomi:request-integration", handler);
    return () =>
      window.removeEventListener("openloomi:request-integration", handler);
  }, [router]);

  const state = useBriefPanelState({
    externalSelectedInsight,
    excludeManualInsights,
  });

  // Use useInsightPagination to determine whether to show skeleton screen
  // If data has already loaded (pages has data and not validating), don't show skeleton
  // This differentiates: refresh needs skeleton, tab switch with cached data doesn't
  const insightPagination = useInsightPagination();
  const isDataLoaded =
    insightPagination.pages && insightPagination.pages.length > 0;
  const isInitialDataLoading =
    !isDataLoaded && (state.isValidating || state.isWeightsLoading);

  const {
    handleFavoriteInsight,
    handleArchiveInsight,
    handleUnderstandInsight,
    understandingInsightId,
  } = useInsightActions(
    state.mutateInsightList,
    state.selectedInsight,
    state.setSelectedInsight,
    () => {},
  );

  // Handle unpinning (includes optimistic update)
  const handleUnpinInsight = useCallback(
    async (insight: Insight) => {
      // 1. Optimistic update: add to local unpin list
      state.addExplicitlyUnpinnedId(insight.id);

      // 2. Call API
      try {
        const response = await fetch(`/api/insights/${insight.id}/pin`, {
          method: "DELETE",
        });
        if (!response.ok) {
          // On failure, refresh the list
          state.triggerListRefresh();
        }
      } catch (error) {
        state.triggerListRefresh();
      }
    },
    [state.addExplicitlyUnpinnedId, state.triggerListRefresh],
  );

  // Batch operations hook
  const {
    selectedIds,
    isSelectionMode,
    toggleSelection,
    toggleSelectionMode,
    clearSelection,
    selectAll,
    processingIds,
    archiveSelected,
    favoriteSelected,
    batchDelete,
    unpinSelected,
  } = useBatchInsightActions(state.mutateInsightList);

  // Handle batch delete (with confirmation)
  const handleBatchDelete = () => {
    if (selectedIds.size > 0) {
      setIsDeleteDialogOpen(true);
    }
  };

  const confirmBatchDelete = async () => {
    setIsDeleteDialogOpen(false);
    await batchDelete(Array.from(selectedIds));
  };

  // Calculate total count of all currently displayed insights
  const totalInsightsCount = Object.values(state.categorizedInsights).reduce(
    (sum, insights) => sum + insights.length,
    0,
  );
  const isAllSelected =
    selectedIds.size > 0 && selectedIds.size === totalInsightsCount;
  const isProcessing = processingIds.size > 0;

  const showEmbeddedInsight = !isMobile && !!state.effectiveSelectedInsight;

  return (
    <>
      <div
        className={cn(
          showEmbeddedInsight
            ? "flex h-full flex-row overflow-hidden gap-2 sm:gap-3 relative"
            : "flex h-full flex-col overflow-hidden",
          !showEmbeddedInsight &&
            (embedInCard
              ? ""
              : isMobile
                ? "bg-background"
                : "bg-card/90 backdrop-blur-md rounded-2xl"),
        )}
      >
        <div
          className={cn(
            "flex h-full flex-col overflow-hidden min-h-0",
            showEmbeddedInsight && "flex-1 min-w-[280px]",
          )}
        >
          {!hideHeader && (
            <AgentSectionHeader
              title={state.briefHeaderTitle}
              footer={
                state.messageStats ? (
                  <BriefPanelStats messageStats={state.messageStats} />
                ) : undefined
              }
            />
          )}

          <div
            className={cn(
              "flex-1 min-h-0 w-full overflow-y-auto no-scrollbar px-0 pt-0",
              !isMobile && "pb-6",
              isMobile &&
                "max-md:[&::-webkit-scrollbar]:hidden max-md:[scrollbar-width:none] pb-[80px]",
            )}
          >
            <div className={cn("px-0 flex flex-col min-h-full h-full mt-2")}>
              {/* Batch action bar - shown above the list */}
              {selectedIds.size > 0 && (
                <BatchActionBar
                  selectedCount={selectedIds.size}
                  isAllSelected={isAllSelected}
                  isProcessing={isProcessing}
                  onCancel={() => {
                    clearSelection();
                  }}
                  onToggleSelectAll={() => {
                    if (isAllSelected) {
                      clearSelection();
                    } else {
                      const allIds: string[] = [];
                      for (const insights of Object.values(
                        state.categorizedInsights,
                      )) {
                        for (const insight of insights) {
                          allIds.push(insight.id);
                        }
                      }
                      selectAll(allIds);
                    }
                  }}
                  onArchive={archiveSelected}
                  onDelete={handleBatchDelete}
                  onUnpin={unpinSelected}
                />
              )}

              <div className="relative">
                {/* Optimization: show skeleton on initial load to avoid blank waiting */}
                {isInitialDataLoading ? (
                  <PanelSkeleton />
                ) : !state.hasAnyInsights &&
                  !state.isValidating &&
                  !state.isWeightsLoading ? (
                  <InsightEmptyState
                    avatarConfig={state.avatarConfig}
                    assistantName={state.assistantName}
                    accountsCount={state.accountsCount}
                    showTips={false}
                    tabId="brief"
                  />
                ) : !state.hasAnyInsights &&
                  (state.isValidating || state.isWeightsLoading) ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground" />
                ) : (
                  <>
                    <div
                      className={cn(
                        "flex flex-col gap-0",
                        isMobile &&
                          "no-scrollbar max-md:[&::-webkit-scrollbar]:hidden max-md:[scrollbar-width:none]",
                      )}
                    >
                      {BRIEF_CATEGORIES.map(({ key, insightsKey }, index) => {
                        const insights = state.categorizedInsights[insightsKey];
                        const firstIndex = BRIEF_CATEGORIES.findIndex(
                          (c) =>
                            state.categorizedInsights[c.insightsKey].length > 0,
                        );
                        /** During drag, the first category is the first (even empty ones are shown); when not dragging, the first category with events is first */
                        const isFirstCategory = state.draggedInsightId
                          ? index === 0
                          : index === firstIndex;

                        return (
                          <BriefCategoryBlock
                            key={key}
                            category={key}
                            insights={insights}
                            isFirstCategory={isFirstCategory}
                            isExpanded={state.expandedCategories.has(key)}
                            onToggleExpand={() => state.toggleCategory(key)}
                            effectiveSelectedInsight={
                              state.effectiveSelectedInsight
                            }
                            strikethroughInsights={state.strikethroughInsights}
                            draggedInsightId={state.draggedInsightId}
                            showEmptyDropZones={state.showEmptyDropZones}
                            dragOverCategory={state.dragOverCategory}
                            onSelectInsight={state.handleSelectInsight}
                            isSelectionMode={isSelectionMode}
                            selectedIds={selectedIds}
                            onToggleSelect={toggleSelection}
                            onDragStart={state.handleDragStart}
                            onDragEnd={state.handleDragEnd}
                            onDragEnter={(e) => state.handleDragEnter(e, key)}
                            onDragOver={state.handleDragOver}
                            onDragLeave={(e) => state.handleDragLeave(e, key)}
                            onDrop={(e) => state.handleDrop(e, key)}
                            onUnpin={handleUnpinInsight}
                            onMute={handleArchiveInsight}
                          />
                        );
                      })}
                    </div>

                    <motion.div
                      viewport={{ once: true, amount: 0.1, margin: "100px" }}
                      onViewportEnter={() => {
                        if (!state.hasReachedEnd) state.incrementSize();
                      }}
                      className="h-1 w-full"
                    />

                    {state.isValidating && !state.hasReachedEnd && (
                      <div className="flex flex-row items-center p-2 text-muted-foreground justify-center">
                        <Spinner size={20} />
                        <div>{t("common.loading")}</div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {showEmbeddedInsight && state.effectiveSelectedInsight && (
          <div className="shrink-0 h-full min-h-0 max-lg:absolute max-lg:inset-0 max-lg:z-[40]">
            <InsightDetailDrawer
              insight={state.effectiveSelectedInsight}
              isOpen={true}
              onClose={() => {
                if (externalSelectedInsight && onExternalInsightClose) {
                  onExternalInsightClose();
                } else {
                  state.handleCloseDrawer();
                }
              }}
              onUnderstand={handleUnderstandInsight}
              understandingInsightId={understandingInsightId}
              onArchive={handleArchiveInsight}
              onFavorite={handleFavoriteInsight}
              embedInLayout={true}
              isInBriefContext={true}
              briefListInsightIds={state.briefListInsightIds}
              onUnpinnedFromBrief={state.addExplicitlyUnpinnedId}
              autoOpenChat={true}
            />
          </div>
        )}
      </div>

      {isMobile && (
        <InsightDetailDrawer
          insight={state.selectedInsight}
          isOpen={state.isDrawerOpen}
          onClose={state.handleCloseDrawer}
          onUnderstand={handleUnderstandInsight}
          understandingInsightId={understandingInsightId}
          onArchive={handleArchiveInsight}
          onFavorite={handleFavoriteInsight}
          isInBriefContext={true}
          briefListInsightIds={state.briefListInsightIds}
          onUnpinnedFromBrief={state.addExplicitlyUnpinnedId}
        />
      )}

      {/* Batch delete confirmation dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[300px]">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center">
              <RemixIcon name="delete_bin" size="size-5" className="mr-2" />
              {t("insight.confirmDeleteTitle", "Confirm delete")}
            </DialogTitle>
          </DialogHeader>
          <p>
            {t("insight.confirmBatchDeleteMessage", {
              count: selectedIds.size,
              defaultValue: `Are you sure you want to delete the selected ${selectedIds.size} items? This action cannot be undone.`,
            })}
          </p>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setIsDeleteDialogOpen(false)}
              disabled={isProcessing}
            >
              {t("common.cancel", "Cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmBatchDelete}
              disabled={isProcessing}
            >
              {t("common.delete", "Delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
