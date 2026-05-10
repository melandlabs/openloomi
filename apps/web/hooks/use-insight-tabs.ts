"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useTranslation } from "react-i18next";
import "../i18n";
import type {
  InsightFilter,
  InsightFilterDefinition,
} from "@/lib/insights/filter-schema";
import {
  getPresetTabsConfig,
  getPresetTabName,
} from "@/lib/insights/preset-tabs-config";

/**
 * Tab type: system default, preset, user-defined
 */
export type TabType = "system" | "preset" | "custom";
export const SystemOtherTabId = "system:other";

/**
 * Preset grouping rule configuration
 * Defines which rule fields can be modified by users
 */
export interface PresetTabRuleConfig {
  /** Whether condition type can be modified */
  canModifyKind: boolean;
  /** Whether condition value can be modified */
  canModifyValues: boolean;
  /** Specific fields that can be modified (if empty array, all fields cannot be modified) */
  modifiableFields?: string[];
}

/**
 * Tab configuration type
 */
export interface InsightTab {
  id: string;
  name: string;
  filter: InsightFilter;
  type: TabType;
  enabled: boolean; // Whether enabled (only for preset and custom tabs)
  createdAt: number;
  updatedAt: number;

  // Preset grouping specific properties
  /** Preset grouping title (not modifiable) */
  title?: string;
  /** Preset grouping description (not modifiable) */
  description?: string;
  /** Preset grouping rule configuration */
  rules?: PresetTabRuleConfig;
  /** Preset grouping category tag (for template library) */
  tag?: string;
  /** Whether to display by default in grouping page */
  isDefault?: boolean;
  /** Whether modification is allowed (false=completely not modifiable, true=allows modification of specified rules) */
  modifiable?: boolean;
}

/**
 * Tab creation/update payload type
 */
export interface InsightTabPayload {
  name: string;
  filter: InsightFilter;
  description?: string; // Grouping description (optional)
}

/**
 * Hook to manage Insight Tabs
 * Uses localStorage to store user tab configuration
 */
export function useInsightTabs() {
  const { data } = useSession();
  const { t, i18n } = useTranslation();
  const [tabs, setTabs] = useState<InsightTab[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  /**
   * Get storage key
   */
  const storageKey = useMemo(() => {
    const userId = data?.user?.id ?? data?.user?.email ?? "guest";
    return `alloomi:insight:usertabs:${userId}`;
  }, [data?.user?.email, data?.user?.id]);

  /**
   * Migrate old format filter (string) to new format (InsightFilter)
   */
  const migrateFilter = useCallback((filter: unknown): InsightFilter => {
    // If already new format, return directly
    if (filter && typeof filter === "object") {
      return filter as InsightFilter;
    }

    // If old format (string), convert to new format
    if (typeof filter === "string") {
      const filterValue = filter;
      // Create corresponding conditions based on old filter value
      if (filterValue === "focus") {
        return {
          match: "all",
          conditions: [
            {
              kind: "importance",
              values: ["Important"],
            },
            {
              kind: "urgency",
              values: ["As soon as possible", "Within 24 hours"],
            },
          ],
        };
      }
      if (filterValue === "mentions") {
        return {
          match: "any",
          conditions: [
            {
              kind: "people",
              values: [],
              match: "any",
              caseSensitive: false,
            },
          ],
        };
      }
      // Other cases return empty conditions
      return {
        match: "all",
        conditions: [],
      };
    }

    // Default return empty conditions
    return {
      match: "all",
      conditions: [],
    };
  }, []);

  /**
   * Load tabs from localStorage
   */
  useEffect(() => {
    // Only execute when window exists
    if (typeof window === "undefined") return;

    // Add duplicate load prevention flag
    let isMounted = true;

    const loadTabs = () => {
      try {
        const stored = window.localStorage.getItem(storageKey);
        if (stored && isMounted) {
          const parsed = JSON.parse(stored) as Array<
            Partial<InsightTab> & { filter?: unknown }
          >;
          if (Array.isArray(parsed)) {
            const migratedTabs = parsed.map((tab) => {
              if (tab.filter) {
                return {
                  ...tab,
                  filter: migrateFilter(tab.filter),
                } as InsightTab;
              }
              return {
                ...tab,
                filter: {
                  match: "all",
                  conditions: [],
                },
              } as InsightTab;
            });
            setTabs(migratedTabs);
          }
        }
      } catch (error) {
        console.error(
          "[useInsightTabs] Failed to load tabs from localStorage:",
          error,
        );
      } finally {
        if (isMounted) setIsLoaded(true);
      }
    };

    // Initial load
    loadTabs();

    // Listen for changes
    window.addEventListener("storage", loadTabs);
    window.addEventListener("alloomi:tabs-update", loadTabs);

    // Cleanup function
    return () => {
      isMounted = false;
      window.removeEventListener("storage", loadTabs);
      window.removeEventListener("alloomi:tabs-update", loadTabs);
    };
  }, [storageKey, migrateFilter]);

  /**
   * Save tabs to localStorage
   */
  const saveTabs = useCallback(
    (newTabs: InsightTab[]) => {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(newTabs));
        setTabs(newTabs);
        // Dispatch custom event for same-window synchronization
        window.dispatchEvent(new CustomEvent("alloomi:tabs-update"));
      } catch (error) {
        console.error(
          "[useInsightTabs] Failed to save tabs to localStorage:",
          error,
        );
        throw error;
      }
    },
    [storageKey],
  );

  /**
   * Create new tab
   */
  const createTab = useCallback(
    (payload: InsightTabPayload): InsightTab => {
      const newTab: InsightTab = {
        id: `tab-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        name: payload.name,
        filter: payload.filter,
        type: "custom",
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...(payload.description && { description: payload.description }),
      };

      const newTabs = [...tabs, newTab];
      saveTabs(newTabs);

      // Background sync to backend
      if (data?.user?.id) {
        fetch("/api/insight-tabs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: payload.name,
            filter: payload.filter,
            ...(payload.description && { description: payload.description }),
          }),
        })
          .then((res) => res.json())
          .then((result) => {
            if (result.tab) {
              // Update tab with ID returned by backend
              const updatedTab = { ...newTab, id: result.tab.id };
              const updatedTabs = newTabs.map((t) =>
                t.id === newTab.id ? updatedTab : t,
              );
              saveTabs(updatedTabs);
            }
          })
          .catch((error) => {
            console.error("Failed to sync tab to backend:", error);
            // Silent failure, doesn't affect user experience
          });
      }

      return newTab;
    },
    [tabs, saveTabs, data?.user?.id],
  );

  /**
   * Update tab
   */
  const updateTab = useCallback(
    (tabId: string, payload: Partial<InsightTabPayload>): InsightTab | null => {
      // System tabs cannot be updated
      if (tabId.startsWith("system:")) {
        return null;
      }

      const tabIndex = tabs.findIndex((tab) => tab.id === tabId);
      if (tabIndex === -1) {
        // If preset tab, need to create or update its enabled status
        if (tabId.startsWith("preset:")) {
          const defaultFilter: InsightFilterDefinition = {
            match: "all",
            conditions: [],
          };
          const name = getPresetTabName(tabId, i18n.t) ?? "";
          const presetTab: InsightTab = {
            id: tabId,
            name: name,
            filter: payload.filter ?? defaultFilter,
            type: "preset",
            enabled: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          const newTabs = [...tabs, presetTab];
          saveTabs(newTabs);
          return presetTab;
        }
        return null;
      }

      const updatedTab: InsightTab = {
        ...tabs[tabIndex],
        ...(payload.name && { name: payload.name }),
        ...(payload.filter && { filter: payload.filter }),
        ...(payload.description !== undefined && {
          description: payload.description,
        }),
        updatedAt: Date.now(),
      };

      const newTabs = [...tabs];
      newTabs[tabIndex] = updatedTab;
      saveTabs(newTabs);

      // Background sync to backend
      if (data?.user?.id && !tabId.startsWith("preset:")) {
        fetch(`/api/insight-tabs/${tabId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).catch((error) => {
          console.error("Failed to sync tab update to backend:", error);
        });
      }

      return updatedTab;
    },
    [tabs, saveTabs, data?.user?.id],
  );

  /**
   * Delete tab
   */
  const deleteTab = useCallback(
    (tabId: string): boolean => {
      // System and preset tabs cannot be deleted
      if (tabId.startsWith("system:") || tabId.startsWith("preset:")) {
        return false;
      }

      const newTabs = tabs.filter((tab) => tab.id !== tabId);
      if (newTabs.length === tabs.length) {
        return false; // Tab does not exist
      }
      saveTabs(newTabs);

      // Background sync to backend
      if (data?.user?.id) {
        fetch(`/api/insight-tabs/${tabId}`, {
          method: "DELETE",
        }).catch((error) => {
          console.error("Failed to sync tab deletion to backend:", error);
        });
      }

      return true;
    },
    [tabs, saveTabs, data?.user?.id],
  );

  // systemTabs is an empty array, no need to depend on t, use empty dependency array
  const systemTabs = useMemo<InsightTab[]>(() => [], []);

  /**
   * Get preset tabs (cached return value)
   * Use i18n.language as dependency, so only recalculate when language changes
   * Use i18n.t instead of t, because t function is a new reference on every render
   */
  const presetTabs = useMemo<InsightTab[]>(
    () => getPresetTabsConfig(i18n.t),
    [i18n.language],
  );

  const getPresetTabs = useCallback(() => presetTabs, [presetTabs]);

  /**
   * Reorder tabs
   * Only save user-defined tabs, system and preset tab order is controlled by getAllTabs
   */
  const reorderTabs = useCallback(
    (tabIds: string[]): boolean => {
      // Build reorderable tabs map (includes preset and custom, excludes system)
      const storedTabs = tabs.filter((tab) => tab.type !== "system");
      const presetTabMap = new Map(getPresetTabs().map((tab) => [tab.id, tab]));

      const allTabsMap = new Map<string, InsightTab>();
      for (const tab of storedTabs) {
        allTabsMap.set(tab.id, tab);
      }

      // Ensure preset tabs can also participate in sorting (even if not yet stored)
      for (const [id, presetTab] of presetTabMap.entries()) {
        if (!allTabsMap.has(id)) {
          allTabsMap.set(id, presetTab);
        } else {
          const existing = allTabsMap.get(id);
          if (existing) {
            allTabsMap.set(id, { ...presetTab, ...existing });
          }
        }
      }

      const reordered: InsightTab[] = [];
      const seen = new Set<string>();

      for (const tabId of tabIds) {
        if (tabId.startsWith("system:") || seen.has(tabId)) continue;
        const tab = allTabsMap.get(tabId);
        if (tab) {
          reordered.push({ ...tab, updatedAt: Date.now() });
          seen.add(tabId);
        }
      }

      // Append non-system tabs not appearing in tabIds to avoid loss
      for (const tab of allTabsMap.values()) {
        if (tab.type === "system" || seen.has(tab.id)) continue;
        reordered.push(tab);
      }

      saveTabs(reordered);

      // Background sync sort (only sync non-system & non-preset tabs)
      if (data?.user?.id) {
        const persistableTabIds = reordered
          .filter(
            (tab) =>
              !tab.id.startsWith("system:") && !tab.id.startsWith("preset:"),
          )
          .map((tab) => tab.id);

        if (persistableTabIds.length > 0) {
          fetch("/api/insight-tabs/reorder", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tabIds: persistableTabIds }),
          }).catch((error) => {
            console.error("Failed to sync tab reorder to backend:", error);
          });
        }
      }

      return true;
    },
    [tabs, saveTabs, data?.user?.id, getPresetTabs],
  );

  /**
   * Toggle tab enabled status
   */
  const toggleTabEnabled = useCallback(
    (tabId: string): boolean => {
      // System tabs cannot toggle status
      if (tabId.startsWith("system:")) {
        return false;
      }

      const tabIndex = tabs.findIndex((tab) => tab.id === tabId);
      let currentTab: InsightTab | undefined;

      if (tabIndex === -1) {
        // If preset tab and doesn't exist, create it
        if (tabId.startsWith("preset:")) {
          const presetTabs = getPresetTabs();
          currentTab = presetTabs.find((t) => t.id === tabId);
          if (currentTab) {
            const newTab: InsightTab = {
              ...currentTab,
              enabled: true,
            };
            const newTabs = [...tabs, newTab];
            saveTabs(newTabs);
            return true;
          }
        }
        return false;
      }

      currentTab = tabs[tabIndex];
      const updatedTab: InsightTab = {
        ...currentTab,
        enabled: !currentTab.enabled,
        updatedAt: Date.now(),
      };

      const newTabs = [...tabs];
      newTabs[tabIndex] = updatedTab;
      saveTabs(newTabs);
      return true;
    },
    [tabs, saveTabs, getPresetTabs],
  );

  /**
   * Get all tabs (system + preset + user-defined)
   */
  const getAllTabs = useMemo((): InsightTab[] => {
    // Merge user-defined tabs and update preset tabs' enabled status
    const userTabsMap = new Map(tabs.map((tab) => [tab.id, tab]));

    // Update system tabs (allow user to modify focus tab's filter)
    const updatedSystemTabs = systemTabs.map((systemTab) => {
      const userTab = userTabsMap.get(systemTab.id);
      if (userTab) {
        return {
          ...systemTab,
          filter: userTab.filter ?? systemTab.filter,
        };
      }
      return systemTab;
    });

    // Update preset tabs' enabled status (read from user storage)
    const updatedPresetTabs = presetTabs.map((presetTab) => {
      const userTab = userTabsMap.get(presetTab.id);
      if (userTab) {
        return {
          ...presetTab,
          ...userTab,
          name: presetTab.name,
          title: presetTab.title,
          description: presetTab.description,
          rules: presetTab.rules,
        };
      }
      return { ...presetTab, enabled: true };
    });

    // Only return user-defined tabs (non-system and non-preset), and ensure filter format is correct
    const customTabs = tabs
      .filter(
        (tab) =>
          tab.type === "custom" ||
          (!tab.type &&
            !tab.id.startsWith("system:") &&
            !tab.id.startsWith("preset:")),
      )
      .map((tab) => {
        // Ensure filter format is correct
        if (
          !tab.filter ||
          typeof tab.filter !== "object" ||
          !("conditions" in tab.filter)
        ) {
          return {
            ...tab,
            filter: migrateFilter(tab.filter),
          };
        }
        return tab;
      });

    // Merge preset and custom tabs, maintain their order in localStorage
    const presetAndCustomTabs = [...updatedPresetTabs, ...customTabs];

    // If tabs are saved in localStorage, reorder them according to saved order
    if (tabs.length > 0) {
      const savedOrderMap = new Map(
        tabs
          .filter((tab) => tab.type === "preset" || tab.type === "custom")
          .map((tab, index) => [tab.id, index]),
      );

      // Sort according to saved order
      const sortedPresetAndCustom = [...presetAndCustomTabs].sort((a, b) => {
        const aOrder = savedOrderMap.get(a.id) ?? Number.POSITIVE_INFINITY;
        const bOrder = savedOrderMap.get(b.id) ?? Number.POSITIVE_INFINITY;
        return aOrder - bOrder;
      });

      return [...sortedPresetAndCustom, ...updatedSystemTabs];
    }

    return [...presetAndCustomTabs, ...updatedSystemTabs];
  }, [tabs, systemTabs, presetTabs, migrateFilter]);

  return {
    tabs: getAllTabs,
    customTabs: tabs.filter(
      (tab) =>
        tab.type === "custom" ||
        (!tab.type &&
          !tab.id.startsWith("system:") &&
          !tab.id.startsWith("preset:")),
    ),
    isLoaded,
    createTab,
    updateTab,
    deleteTab,
    reorderTabs,
    toggleTabEnabled,
    getPresetTabName: (id: string) => getPresetTabName(id, i18n.t),
  };
}
