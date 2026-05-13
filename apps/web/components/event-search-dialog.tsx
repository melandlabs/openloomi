"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@openloomi/ui";
import type { Insight } from "@/lib/db/schema";
import type { SearchResultItem } from "@/components/global-search-dialog";
import { useGlobalInsightDrawer } from "@/components/global-insight-drawer";
import { fetcher } from "@/lib/utils";
import useSWR from "swr";
import { EventChannelDropdownContent } from "@/components/shared/event-channel-dropdown-content";

/**
 * Event search dialog component
 * Allows users to search event names and focus events into conversations
 * Uses /api/search API to align with global search logic
 */
export function EventSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { openDrawer } = useGlobalInsightDrawer();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Debounce search query
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchQuery]);

  /**
   * Search API URL
   * - With search term: use /api/search to search all events
   * - Without search term: use /api/insights/events to show recent events
   */
  const searchUrl = useMemo(() => {
    if (!open) return null;

    if (debouncedQuery.trim()) {
      // Use global search API, aligned with global search logic
      return `/api/search?q=${encodeURIComponent(debouncedQuery)}&types=events&limit=50`;
    }
    // Show recent events when no search term
    return "/api/insights/events?limit=20&days=0";
  }, [debouncedQuery, open]);

  /**
   * Fetch search results
   */
  const { data, isLoading, error } = useSWR<{
    events?: SearchResultItem[];
    items?: Insight[];
  }>(searchUrl, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  /**
   * Extract Insight objects from search results
   * - Global search API return format: { events: SearchResultItem[] }, insight is in extra field
   * - Recent events API return format: { items: Insight[] }
   */
  const insights = useMemo(() => {
    if (!data) return [];

    if (data.events) {
      // Result from global search API
      return data.events
        .map((item) => (item.extra as any)?.insight)
        .filter((insight): insight is Insight => !!insight);
    }

    if (data.items) {
      // Result from recent events API
      return data.items;
    }

    return [];
  }, [data]);

  /**
   * Handle event selection
   */
  const handleSelectEvent = (insight: Insight) => {
    // Open insight detail drawer
    openDrawer(insight);
    // Close dialog
    onOpenChange(false);
    setSearchQuery("");
  };

  /**
   * Reset query state when dialog is closed.
   */
  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setDebouncedQuery("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {t("chat.addEvent", "Add event to conversation")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 flex-1 min-h-0">
          {/* Events list */}
          <div className="flex-1 overflow-y-auto min-h-0 border rounded-lg">
            {error ? (
              <div className="flex items-center justify-center py-12 text-sm text-destructive">
                {t(
                  "chat.searchEventError",
                  "Failed to load events, please try again later",
                )}
              </div>
            ) : (
              <EventChannelDropdownContent
                query={searchQuery}
                onQueryChange={setSearchQuery}
                searchPlaceholder={t(
                  "chat.searchEventPlaceholder",
                  "Search event name...",
                )}
                loading={isLoading}
                loadingText={t("common.loading", "Loading")}
                emptyText={
                  searchQuery.trim()
                    ? t("chat.noEventsFound", "No matching events found")
                    : t("chat.noEvents", "No events")
                }
                items={insights.map((insight) => ({
                  id: insight.id,
                  title:
                    insight.title || t("chat.untitledEvent", "Untitled event"),
                  description: insight.description,
                }))}
                onSelect={(item) => {
                  const insight = insights.find(
                    (current) => current.id === item.id,
                  );
                  if (!insight) return;
                  handleSelectEvent(insight);
                }}
              />
            )}
          </div>

          {/* Bottom hint */}
          <div className="text-xs text-muted-foreground">
            {t(
              "chat.addEventHint",
              "After selecting an event, it will be focused in the conversation and AI will respond based on that event context",
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
