"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import "../../i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@openloomi/ui";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button, Input, Label } from "@openloomi/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { toast } from "@/components/toast";
import type { InsightFilterCondition } from "@/lib/insights/filter-schema";
import type { InsightTab, InsightTabPayload } from "@/hooks/use-insight-tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@openloomi/ui";
import { useIntegrations } from "@/hooks/use-integrations";
import {
  getSupportedFilterFields,
  getFilterFieldLabel,
  isFieldSupportedByAllPlatforms,
} from "@/lib/insights/platform-filter-config";
import { useInsightFilterOptions } from "@/hooks/use-insight-filter-options";
import {
  normalizeImportanceOption,
  normalizeUrgencyOption,
} from "@/lib/insights/option-normalizers";
import type { Insight } from "@/lib/db/schema";
import {
  insightFilterToTabConditions,
  tabConditionsToLinearTreeFilter,
  type TabFilterCondition,
} from "../insight-filter-dialog";

/**
 * Props for the Tab create/edit dialog
 */
export interface InsightTabEditDialogProps {
  /**
   * Whether the dialog is open
   */
  isOpen: boolean;
  /**
   * Dialog open/close state change callback
   */
  onOpenChange: (open: boolean) => void;
  /**
   * Edit mode: if provided, it's edit mode; otherwise it's create mode
   */
  editingTab?: InsightTab | null;
  /**
   * Create tab callback
   */
  onCreate?: (payload: InsightTabPayload) => void;
  /**
   * Update tab callback
   */
  onUpdate?: (tabId: string, payload: Partial<InsightTabPayload>) => void;
  /**
   * Delete tab callback
   */
  onDelete?: (tabId: string) => void;
  /**
   * All existing tabs (used to check for duplicate names)
   */
  existingTabs?: InsightTab[];
  /**
   * Insights data (used to extract filter options)
   */
  insights?: Insight[];
}

/**
 * Keyword condition editor component
 */
const KeywordConditionEditor = ({
  condition,
  id,
  onUpdate,
  onAddValue,
  onRemoveValue,
  t,
}: {
  condition: InsightFilterCondition;
  id: string;
  onUpdate: (id: string, updates: Partial<InsightFilterCondition>) => void;
  onAddValue: (id: string, value: string) => void;
  onRemoveValue: (id: string, value: string) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) => {
  const [keywordInput, setKeywordInput] = useState("");

  // 1. Cache values to avoid array recreation on every render causing dedup failure
  const currentValues = useMemo(() => {
    return condition.kind === "keyword" ? [...condition.values] : []; // Shallow copy to ensure stable reference
  }, [condition]);

  // 2. Stable add logic, idempotency check added
  const handleAddKeyword = useCallback(() => {
    const trimmed = keywordInput.trim();
    // Double dedup check: check locally cached values and avoid empty values
    if (!trimmed || currentValues.includes(trimmed)) return;

    onAddValue(id, trimmed);
    setKeywordInput("");
  }, [keywordInput, currentValues, id, onAddValue]);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          type="text"
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault(); // Prevent form default submission
              e.stopPropagation(); // Stop event from bubbling to parent
              handleAddKeyword();
            }
          }}
          placeholder={t("insight.filter.keywordPlaceholder", "Enter keywords")}
          className="flex-1"
        />
        <Button
          type="button"
          onClick={handleAddKeyword}
          size="sm"
          // Prevent Enter key from triggering duplicate calls when button has focus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
        >
          <RemixIcon name="add" size="size-4" />
        </Button>
      </div>
    </div>
  );
};

/**
 * Insight Tab create/edit dialog component
 */
export function InsightTabEditDialog({
  isOpen,
  onOpenChange,
  editingTab,
  onCreate,
  onUpdate,
  onDelete,
  existingTabs = [],
  insights = [],
}: InsightTabEditDialogProps) {
  const { t } = useTranslation();
  const { accounts } = useIntegrations();
  const isEditMode = !!editingTab;
  const isCustomTab = !isEditMode || editingTab?.type === "custom"; // Create mode or custom tab
  const isPresetTab = isEditMode && editingTab?.type === "preset";
  const isModifiablePreset = isPresetTab && editingTab?.modifiable === true;
  const canModifyKind =
    isCustomTab ||
    (isModifiablePreset && editingTab?.rules?.canModifyKind === true); // Custom tab or modifiable preset
  const canModifyValues =
    isCustomTab ||
    (isModifiablePreset && editingTab?.rules?.canModifyValues === true); // Custom tab or modifiable preset

  // Get available filter options
  const filterOptions = useInsightFilterOptions(insights);

  // Extract groups from insights and their associated account and platform info
  const groupsWithMetadata = useMemo(() => {
    if (!insights || insights.length === 0) {
      return filterOptions.groups.map((group) => ({
        name: group,
        account: undefined,
        platform: undefined,
      }));
    }

    // Create mapping: group name -> { account, platform }
    const groupMap = new Map<string, { account?: string; platform?: string }>();

    insights.forEach((insight) => {
      if (Array.isArray(insight.groups)) {
        insight.groups.forEach((group) => {
          if (group && typeof group === "string") {
            const existing = groupMap.get(group);
            if (!existing) {
              groupMap.set(group, {
                account: insight.account || undefined,
                platform: insight.platform || undefined,
              });
            }
          }
        });
      }
    });

    // Merge filterOptions.groups (may come from other data sources)
    const allGroups = [
      ...new Set([...filterOptions.groups, ...Array.from(groupMap.keys())]),
    ];

    // Platform name mapping
    const platformLabels: Record<string, string> = {
      slack: "Slack",
      discord: "Discord",
      telegram: "Telegram",
      whatsapp: "WhatsApp",
      gmail: "Gmail",
      teams: "Microsoft Teams",
      google_drive: "Google Drive",
      notion: "Notion",
      rss: "RSS",
    };

    const formatPlatformName = (platform: string | null | undefined) => {
      if (!platform) return undefined;
      return platformLabels[platform.toLowerCase()] || platform;
    };

    // Account name mapping
    const accountMap = new Map<string, string>();
    accounts.forEach((acc) => {
      accountMap.set(acc.externalId, acc.displayName);
      accountMap.set(acc.displayName, acc.displayName);
    });

    return allGroups.map((group) => {
      const metadata = groupMap.get(group);
      const accountName = metadata?.account
        ? accountMap.get(metadata.account) || metadata.account
        : undefined;
      const platformName = formatPlatformName(metadata?.platform);

      return {
        name: group,
        account: accountName,
        platform: platformName,
      };
    });
  }, [insights, filterOptions.groups, accounts]);

  // Get connected platforms
  const connectedPlatforms = useMemo(() => {
    return Array.from(
      new Set(accounts.map((account) => account.platform)),
    ) as Array<
      | "telegram"
      | "whatsapp"
      | "slack"
      | "discord"
      | "gmail"
      | "google_drive"
      | "notion"
      | "github"
    >;
  }, [accounts]);

  // Get supported fields (excluding time window, task labels, and category)
  const supportedFields = useMemo(() => {
    const allFields = getSupportedFilterFields(connectedPlatforms);
    return allFields.filter(
      (field) =>
        field !== "time_window" &&
        field !== "task_label" &&
        field !== "category",
    );
  }, [connectedPlatforms]);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [conditions, setConditions] = useState<Array<TabFilterCondition>>([]);

  /**
   * Initialize form (when dialog opens or the editing tab changes)
   */
  useEffect(() => {
    if (isOpen) {
      if (isEditMode && editingTab) {
        setName(editingTab.name);
        setDescription(editingTab.description || "");

        // Custom tab: load all conditions, normalize importance and urgency values

        const allTabConditions = insightFilterToTabConditions(
          editingTab.filter,
        );

        const allConditions = allTabConditions.map((cond, index) => {
          const normalizedCondition = { ...cond };
          if (cond.kind === "importance" && "values" in cond) {
            const values = cond.values;
            if (Array.isArray(values)) {
              (normalizedCondition as { values: string[] }).values = values.map(
                (val) => {
                  const normalized = normalizeImportanceOption(val);
                  return normalized?.key || val;
                },
              );
            }
          }
          if (cond.kind === "urgency" && "values" in cond) {
            const values = cond.values;
            if (Array.isArray(values)) {
              (normalizedCondition as { values: string[] }).values = values.map(
                (val) => {
                  const normalized = normalizeUrgencyOption(val);
                  return normalized?.key || val;
                },
              );
            }
          }
          return {
            ...normalizedCondition,
            id: `cond-${Date.now()}-${index}`,
          };
        });
        setConditions(allConditions);
      } else {
        setName("");
        setDescription("");
        // Create mode: do not create default conditions, let the user select manually
        setConditions([]);
      }
    }
  }, [isOpen, isEditMode, editingTab, isPresetTab]);

  /**
   * Update condition
   */
  const handleUpdateCondition = useCallback(
    (id: string, updates: Partial<TabFilterCondition>) => {
      setConditions((prev) =>
        prev.map((cond) =>
          cond.id === id
            ? ({ ...cond, ...updates } as TabFilterCondition)
            : cond,
        ),
      );
    },
    [],
  );

  /**
   * Update condition values
   */
  const handleUpdateConditionValues = useCallback(
    (
      id: string,
      updater: (
        current: string[],
      ) => string[] | Promise<string[] | undefined> | undefined,
    ) => {
      setConditions((prev) =>
        prev.map((cond) => {
          if (cond.id === id && "values" in cond) {
            const currentValues = cond.values || [];
            const newValues = updater(currentValues);
            if (Array.isArray(newValues)) {
              return {
                ...cond,
                values: newValues,
              } as TabFilterCondition;
            }
          }
          return cond;
        }),
      );
    },
    [],
  );

  /**
   * Add value to condition
   */
  const handleAddValueToCondition = useCallback(
    (id: string, value: string) => {
      handleUpdateConditionValues(id, (current) => {
        if (!current.includes(value)) {
          return [...current, value];
        }
        return current;
      });
    },
    [handleUpdateConditionValues],
  );

  /**
   * Remove value from condition
   */
  const handleRemoveValueFromCondition = useCallback(
    (id: string, value: string) => {
      handleUpdateConditionValues(id, (current) =>
        current.filter((v) => v !== value),
      );
    },
    [handleUpdateConditionValues],
  );

  /**
   * Add new condition
   */
  const handleAddCondition = useCallback(
    (kind: InsightFilterCondition["kind"]) => {
      let newCondition: InsightFilterCondition;
      switch (kind) {
        case "keyword":
          newCondition = {
            kind: "keyword",
            values: [],
            match: "any",
          };
          break;
        case "has_tasks":
          newCondition = {
            kind: "has_tasks",
            values: ["myTasks", "waitingForMe"],
          };
          break;
        case "people":
          newCondition = {
            kind: "people",
            values: [] as string[],
            match: "any" as const,
            caseSensitive: false,
          };
          break;
        case "groups":
          newCondition = {
            kind: "groups",
            values: [] as string[],
            match: "any" as const,
          };
          break;
        case "account":
          newCondition = {
            kind: "account",
            values: [] as string[],
          };
          break;
        case "urgency":
          newCondition = {
            kind: "urgency",
            values: [],
          };
          break;
        case "category":
          newCondition = {
            kind: "category",
            values: [],
          };
          break;
        case "importance":
          newCondition = {
            kind: "importance",
            values: [],
          };
          break;
        case "mentions_me":
          newCondition = {
            kind: "mentions_me",
            values: [],
          };
          break;
        case "platform":
          newCondition = {
            kind: "platform",
            values: [],
          };
          break;
        case "task_label":
          newCondition = {
            kind: "task_label",
            values: [],
          };
          break;
        case "time_window":
          newCondition = {
            kind: "time_window",
            withinHours: 24,
          };
          break;
      }
      setConditions((prev) => [
        ...prev,
        {
          ...newCondition,
          id: `cond-${Date.now()}-${Math.random()}`,
        } as TabFilterCondition,
      ]);
    },
    [],
  );

  /**
   * Remove condition
   */
  const handleRemoveCondition = useCallback((id: string) => {
    setConditions((prev) => prev.filter((cond) => cond.id !== id));
  }, []);

  /**
   * Get standardized importance options (key + label)
   */
  const getStandardizedImportanceOptions = useMemo(() => {
    const options = [
      { key: "high", labels: ["High", "Important"] },
      { key: "medium", labels: ["Medium", "General"] },
      { key: "low", labels: ["Low", "Not Important"] },
    ];

    // Merge options from data
    const dataOptions = filterOptions.importanceOptions
      .map((value) => {
        const normalized = normalizeImportanceOption(value);
        return normalized
          ? {
              key: normalized.key,
              labels: normalized.priorities || [normalized.label],
            }
          : null;
      })
      .filter(Boolean) as Array<{ key: string; labels: string[] }>;

    // Merge and deduplicate
    const keyMap = new Map<string, string[]>();
    options.forEach((opt) => {
      keyMap.set(opt.key, opt.labels);
    });
    dataOptions.forEach((opt) => {
      const existing = keyMap.get(opt.key);
      if (existing) {
        // Merge labels, preserving priority
        keyMap.set(opt.key, [...new Set([...opt.labels, ...existing])]);
      } else {
        keyMap.set(opt.key, opt.labels);
      }
    });

    return Array.from(keyMap.entries()).map(([key, labels]) => ({
      key,
      label: labels[0], // Use the first label for display
      allLabels: labels,
    }));
  }, [filterOptions.importanceOptions]);

  /**
   * Get standardized urgency options (key + label)
   */
  const getStandardizedUrgencyOptions = useMemo(() => {
    const options = [
      {
        key: "immediate",
        labels: ["Immediate", "As soon as possible"],
      },
      { key: "within_24h", labels: ["Within 24 hours", "Last 24 hours"] },
      { key: "not_urgent", labels: ["Not urgent"] },
    ];

    // Merge options from data
    const dataOptions = filterOptions.urgencyOptions
      .map((value) => {
        const normalized = normalizeUrgencyOption(value);
        return normalized
          ? {
              key: normalized.key,
              labels: normalized.priorities || [normalized.label],
            }
          : null;
      })
      .filter(Boolean) as Array<{ key: string; labels: string[] }>;

    // Merge and deduplicate
    const keyMap = new Map<string, string[]>();
    options.forEach((opt) => {
      keyMap.set(opt.key, opt.labels);
    });
    dataOptions.forEach((opt) => {
      const existing = keyMap.get(opt.key);
      if (existing) {
        // Merge labels, preserving priority
        keyMap.set(opt.key, [...new Set([...opt.labels, ...existing])]);
      } else {
        keyMap.set(opt.key, opt.labels);
      }
    });

    return Array.from(keyMap.entries()).map(([key, labels]) => ({
      key,
      label: labels[0], // Use the first label for display
      allLabels: labels,
    }));
  }, [filterOptions.urgencyOptions]);

  /**
   * Convert standardized key to display label
   */
  const getImportanceLabel = useCallback(
    (key: string) => {
      const option = getStandardizedImportanceOptions.find(
        (opt) => opt.key === key,
      );
      return option?.label || key;
    },
    [getStandardizedImportanceOptions],
  );

  /**
   * Convert standardized key to display label
   */
  const getUrgencyLabel = useCallback(
    (key: string) => {
      const option = getStandardizedUrgencyOptions.find(
        (opt) => opt.key === key,
      );
      return option?.label || key;
    },
    [getStandardizedUrgencyOptions],
  );

  /**
   * Render condition value selector
   */
  const renderConditionValueSelector = (condition: TabFilterCondition) => {
    const { id, kind } = condition;

    switch (kind) {
      case "platform": {
        return (
          <Select
            value=""
            disabled={!canModifyValues}
            onValueChange={(value) => {
              if (value) {
                handleAddValueToCondition(id, value);
              }
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue
                placeholder={t(
                  "insight.filter.selectPlatform",
                  "Select platform",
                )}
              />
            </SelectTrigger>
            <SelectContent>
              {filterOptions.platforms.map((platform) => (
                <SelectItem key={platform} value={platform}>
                  {platform}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }

      case "account": {
        // Platform name mapping
        const platformLabels: Record<string, string> = {
          slack: "Slack",
          discord: "Discord",
          telegram: "Telegram",
          whatsapp: "WhatsApp",
          gmail: "Gmail",
          teams: "Microsoft Teams",
          google_drive: "Google Drive",
          notion: "Notion",
          rss: "RSS",
        };

        // Format platform name
        const formatPlatformName = (platform: string) => {
          return platformLabels[platform.toLowerCase()] || platform;
        };

        // Use all connected accounts, display account name and platform
        const accountOptions =
          accounts.length > 0
            ? accounts.map((acc) => ({
                displayName: acc.displayName,
                platform: formatPlatformName(acc.platform),
              }))
            : filterOptions.accountOptions.map((name) => ({
                displayName: name,
                platform: undefined as string | undefined,
              }));

        return (
          <Select
            value=""
            disabled={!canModifyValues}
            onValueChange={(value) => {
              if (value) {
                handleAddValueToCondition(id, value);
              }
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue
                placeholder={t(
                  "insight.filter.selectAccount",
                  "Select account",
                )}
              />
            </SelectTrigger>
            <SelectContent>
              {accountOptions.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  {t("insight.filter.noAccounts", "No account data")}
                </div>
              ) : (
                accountOptions.map((account) => {
                  const displayText = account.platform
                    ? `${account.displayName} (${account.platform})`
                    : account.displayName;

                  return (
                    <SelectItem
                      key={account.displayName}
                      value={account.displayName}
                    >
                      {displayText}
                    </SelectItem>
                  );
                })
              )}
            </SelectContent>
          </Select>
        );
      }

      case "groups": {
        if (groupsWithMetadata.length === 0) {
          return (
            <p className="text-sm text-muted-foreground">
              {t("insight.filter.noGroups", "No channel/group data")}
            </p>
          );
        }

        return (
          <Select
            value=""
            disabled={!canModifyValues}
            onValueChange={(value) => {
              if (value) {
                handleAddValueToCondition(id, value);
              }
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue
                placeholder={t(
                  "insight.filter.selectGroup",
                  "Select channel/group",
                )}
              />
            </SelectTrigger>
            <SelectContent>
              {groupsWithMetadata.map((group) => {
                const displayText =
                  group.account && group.platform
                    ? `${group.name} (${group.account} - ${group.platform})`
                    : group.account
                      ? `${group.name} (${group.account})`
                      : group.platform
                        ? `${group.name} (${group.platform})`
                        : group.name;

                return (
                  <SelectItem key={group.name} value={group.name}>
                    {displayText}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        );
      }

      case "people": {
        if (filterOptions.people.length === 0) {
          return (
            <p className="text-sm text-muted-foreground">
              {t("insight.filter.noPeople", "No person data")}
            </p>
          );
        }
        return (
          <Select
            value=""
            disabled={!canModifyValues}
            onValueChange={(value) => {
              if (value) {
                handleAddValueToCondition(id, value);
              }
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue
                placeholder={t("insight.filter.selectPerson", "Select person")}
              />
            </SelectTrigger>
            <SelectContent>
              {filterOptions.people.map((person) => (
                <SelectItem key={person} value={person}>
                  {person}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }

      case "importance": {
        return (
          <Select
            value=""
            disabled={!canModifyValues}
            onValueChange={(value) => {
              if (value) {
                // Save standardized key
                handleAddValueToCondition(id, value);
              }
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue
                placeholder={t(
                  "insight.filter.selectImportance",
                  "Select importance",
                )}
              />
            </SelectTrigger>
            <SelectContent>
              {getStandardizedImportanceOptions.map((opt) => (
                <SelectItem key={opt.key} value={opt.key}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }

      case "urgency": {
        return (
          <Select
            value=""
            disabled={!canModifyValues}
            onValueChange={(value) => {
              if (value) {
                // Save standardized key
                handleAddValueToCondition(id, value);
              }
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue
                placeholder={t(
                  "insight.filter.selectUrgency",
                  "Select urgency",
                )}
              />
            </SelectTrigger>
            <SelectContent>
              {getStandardizedUrgencyOptions.map((opt) => (
                <SelectItem key={opt.key} value={opt.key}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }

      case "mentions_me": {
        return (
          <p className="text-sm text-muted-foreground">
            {t(
              "insight.filter.mentionsMeHint",
              "Automatically matches @mentions or direct messages, no extra configuration needed",
            )}
          </p>
        );
      }

      case "has_tasks": {
        const taskBuckets: Array<
          "myTasks" | "waitingForMe" | "waitingForOthers" | "nextActions"
        > = ["myTasks", "waitingForMe", "waitingForOthers", "nextActions"];
        const bucketLabels: Record<string, string> = {
          myTasks: t("insight.filter.myTasks", "My tasks"),
          waitingForMe: t("insight.filter.waitingForMe", "Waiting for me"),
          waitingForOthers: t(
            "insight.filter.waitingForOthers",
            "Waiting for others",
          ),
          nextActions: t("insight.filter.nextActions", "Next actions"),
        };
        const currentBuckets =
          condition.kind === "has_tasks" ? condition.values : [];

        return (
          <div className="space-y-2">
            {taskBuckets.map((bucket) => (
              <label
                key={bucket}
                className="flex items-center gap-2 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={currentBuckets.includes(bucket)}
                  disabled={!canModifyValues}
                  onChange={(e) => {
                    const buckets =
                      condition.kind === "has_tasks" ? condition.values : [];
                    if (e.target.checked) {
                      handleUpdateCondition(id, {
                        kind: "has_tasks",
                        values: [...buckets, bucket],
                      });
                    } else {
                      handleUpdateCondition(id, {
                        kind: "has_tasks",
                        values: buckets.filter((b) => b !== bucket) as Array<
                          | "myTasks"
                          | "waitingForMe"
                          | "waitingForOthers"
                          | "nextActions"
                        >,
                      });
                    }
                  }}
                  className="rounded border-gray-300"
                />
                <span className="text-sm">
                  {bucketLabels[bucket] ?? bucket}
                </span>
              </label>
            ))}
          </div>
        );
      }

      case "keyword": {
        if (!canModifyValues && isPresetTab) {
          return (
            <p className="text-sm text-muted-foreground">
              {t(
                "insight.tabs.preset.keywordNotModifiable",
                "Keywords in this preset group cannot be modified",
              )}
            </p>
          );
        }
        return (
          <KeywordConditionEditor
            condition={condition}
            id={id}
            onUpdate={handleUpdateCondition}
            onAddValue={handleAddValueToCondition}
            onRemoveValue={handleRemoveValueFromCondition}
            t={t}
          />
        );
      }

      default:
        return null;
    }
  };

  /**
   * Handle save
   */
  const handleSave = useCallback(() => {
    if (!name.trim()) {
      toast({
        type: "error",
        description: t("insight.tabs.nameRequired", "Tab name cannot be empty"),
      });
      return;
    }

    // Check for duplicate names (excluding the currently editing tab)
    const nameExists = existingTabs.some(
      (tab) =>
        tab.name.toLowerCase() === name.trim().toLowerCase() &&
        (!isEditMode || tab.id !== editingTab?.id),
    );
    if (nameExists) {
      toast({
        type: "error",
        description: t("insight.tabs.nameExists", "Tab name already exists"),
      });
      return;
    }

    // Verify conditions have values
    if (conditions.length === 0) {
      toast({
        type: "error",
        description: t(
          "insight.tabs.noConditions",
          "Please add at least one valid filter condition",
        ),
      });
      return;
    }

    // Verify each condition is valid
    const invalidCondition = conditions.find((cond) => {
      if (cond.kind === "mentions_me") {
        return false; // mentions_me doesn't need values
      }
      if (cond.kind === "has_tasks") {
        return !cond.values || cond.values.length === 0;
      }
      return !("values" in cond) || cond.values.length === 0;
    });

    if (invalidCondition) {
      toast({
        type: "error",
        description: t(
          "insight.tabs.invalidCondition",
          "Invalid filter conditions exist, please check",
        ),
      });
      return;
    }

    try {
      // Remove temporary IDs and construct the definition
      const definition = tabConditionsToLinearTreeFilter(conditions);

      if (isEditMode && editingTab && onUpdate) {
        const payload: Partial<InsightTabPayload> = {
          name: name.trim(),
          filter: definition,
        };
        // Custom tab can update description
        if (isCustomTab) {
          payload.description = description.trim() || undefined;
        }
        onUpdate(editingTab.id, payload);
        toast({
          type: "success",
          description: t(
            "insight.tabs.updateSuccess",
            "Tab updated successfully",
          ),
        });
      } else if (!isEditMode && onCreate) {
        const payload: InsightTabPayload = {
          name: name.trim(),
          filter: definition,
        };
        // New tab can set description
        if (description.trim()) {
          payload.description = description.trim();
        }
        onCreate(payload);
        toast({
          type: "success",
          description: t(
            "insight.tabs.createSuccess",
            "Tab created successfully",
          ),
        });
      }
      onOpenChange(false);
    } catch (error) {
      console.error(
        `Failed to ${isEditMode ? "update" : "create"} tab:`,
        error,
      );
      toast({
        type: "error",
        description: t(
          isEditMode ? "insight.tabs.updateError" : "insight.tabs.createError",
          isEditMode
            ? "Update failed, please retry"
            : "Creation failed, please retry",
        ),
      });
    }
  }, [
    name,
    description,
    conditions,
    isEditMode,
    isCustomTab,
    editingTab,
    existingTabs,
    onCreate,
    onUpdate,
    onOpenChange,
    t,
  ]);

  /**
   * Handle cancel
   */
  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  /**
   * Handle delete
   */
  const handleDelete = useCallback(() => {
    if (!isEditMode || !editingTab || !onDelete) {
      return;
    }

    try {
      onDelete(editingTab.id);
      toast({
        type: "success",
        description: t(
          "insight.tabs.deleteSuccess",
          "Tab deleted successfully",
        ),
      });
      onOpenChange(false);
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
  }, [isEditMode, editingTab, onDelete, onOpenChange, t]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[700px] max-h-[90vh] flex flex-col p-0 overflow-hidden"
        hideCloseButton
      >
        {/* Fixed header */}
        <DialogHeader className="shrink-0 p-6 border-b">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex-1">
              {isEditMode
                ? t("insight.tabs.editGroup", "Edit group")
                : t("insight.tabs.createNewGroup", "Create new group")}
            </DialogTitle>
            <div className="flex items-center gap-2">
              {/* Delete button - destructive outline icon button */}
              {isEditMode && isCustomTab && onDelete && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                    >
                      <RemixIcon name="delete_bin" size="size-4" />
                      <span className="sr-only">
                        {t("common.delete", "Delete")}
                      </span>
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t(
                          "insight.tabs.deleteConfirmTitle",
                          "Confirm delete group",
                        )}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("insight.tabs.deleteConfirmDescription", {
                          defaultValue: `Are you sure you want to delete the group "${editingTab?.name}"? This action cannot be undone.`,
                          name: editingTab?.name,
                        })}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>
                        {t("common.cancel", "Cancel")}
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDelete}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {t("common.delete", "Delete")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              {/* Save/create button - primary button with save icon */}
              <Button
                type="button"
                variant="default"
                onClick={handleSave}
                className="h-8 gap-2"
                disabled={
                  !name.trim() ||
                  conditions.length === 0 ||
                  conditions.some((cond) => {
                    if (cond.kind === "mentions_me") return false;
                    if (cond.kind === "has_tasks") {
                      return !cond.values || cond.values.length === 0;
                    }
                    return !("values" in cond) || cond.values.length === 0;
                  })
                }
              >
                <RemixIcon name="save" size="size-4" />
                {isEditMode
                  ? t("common.save", "Save")
                  : t("common.create", "Create")}
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
                  <span className="sr-only">{t("common.close", "Close")}</span>
                </Button>
              </DialogPrimitive.Close>
            </div>
          </div>
        </DialogHeader>

        {/* Scrollable content area */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
          <div className="space-y-4">
            {/* Basic info */}
            <div className="space-y-2">
              <Label htmlFor="tab-name">{t("insight.tabs.name", "Name")}</Label>
              <Input
                id="tab-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSave();
                  } else if (e.key === "Escape") {
                    handleCancel();
                  }
                }}
                placeholder={t(
                  "insight.tabs.namePlaceholder",
                  "Enter Tab name",
                )}
                autoFocus
                disabled={isPresetTab}
              />
            </div>

            {/* Description field - unified display */}
            <div className="space-y-2">
              <Label htmlFor="tab-description">
                {t("insight.tabs.description", "Description")}
              </Label>
              {isPresetTab ? (
                // Preset tab: show disabled input
                <Input
                  id="tab-description"
                  value={editingTab?.description || ""}
                  disabled
                  placeholder={t(
                    "insight.tabs.descriptionPlaceholder",
                    "Enter group description (optional)",
                  )}
                />
              ) : (
                // Custom tab: editable
                <Input
                  id="tab-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t(
                    "insight.tabs.descriptionPlaceholder",
                    "Enter group description (optional)",
                  )}
                />
              )}
            </div>

            {/* Filter conditions */}
            <div className="space-y-2">
              <Label>{t("insight.tabs.rules", "Rules")}</Label>
              <div className="space-y-4">
                {conditions.length === 0 ? (
                  <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {t("insight.filter.condition", "Condition")}
                      </span>
                      <Select
                        value=""
                        disabled={isPresetTab} // Preset tab doesn't allow adding new conditions
                        onValueChange={(
                          value: InsightFilterCondition["kind"],
                        ) => {
                          // Create condition based on selected kind
                          let newCondition: InsightFilterCondition;
                          switch (value) {
                            case "keyword":
                              newCondition = {
                                kind: "keyword",
                                values: [],
                                match: "any",
                              };
                              break;
                            case "has_tasks":
                              newCondition = {
                                kind: "has_tasks",
                                values: ["myTasks", "waitingForMe"],
                              };
                              break;
                            case "people":
                              newCondition = {
                                kind: "people",
                                values: [] as string[],
                                match: "any" as const,
                                caseSensitive: false,
                              };
                              break;
                            case "groups":
                              newCondition = {
                                kind: "groups",
                                values: [] as string[],
                                match: "any" as const,
                              };
                              break;
                            case "account":
                              newCondition = {
                                kind: "account",
                                values: [] as string[],
                              };
                              break;
                            case "urgency":
                              newCondition = {
                                kind: "urgency",
                                values: [],
                              };
                              break;
                            case "category":
                              newCondition = {
                                kind: "category",
                                values: [],
                              };
                              break;
                            case "importance":
                              newCondition = {
                                kind: "importance",
                                values: [],
                              };
                              break;
                            case "mentions_me":
                              newCondition = {
                                kind: "mentions_me",
                                values: [],
                              };
                              break;
                            case "platform":
                              newCondition = {
                                kind: "platform",
                                values: [],
                              };
                              break;
                            case "task_label":
                              newCondition = {
                                kind: "task_label",
                                values: [],
                              };
                              break;
                            case "time_window":
                              newCondition = {
                                kind: "time_window",
                                withinHours: 24,
                              };
                              break;
                          }
                          setConditions([
                            {
                              ...newCondition,
                              id: `cond-${Date.now()}`,
                            } as TabFilterCondition,
                          ]);
                        }}
                      >
                        <SelectTrigger className="w-48">
                          <SelectValue
                            placeholder={t(
                              "insight.filter.selectConditionType",
                              "Select condition type",
                            )}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {supportedFields.map((field) => {
                            const isGroupsField = field === "groups";
                            const groupsSupportedByAll =
                              isFieldSupportedByAllPlatforms(
                                "groups",
                                connectedPlatforms,
                              );
                            return (
                              <SelectItem key={field} value={field}>
                                <span>
                                  {getFilterFieldLabel(
                                    field,
                                    (key: string, defaultValue?: string) =>
                                      t(key, { defaultValue }),
                                  )}
                                  {isGroupsField && !groupsSupportedByAll && (
                                    <span className="ml-1 text-xs text-muted-foreground">
                                      (
                                      {t("insight.filter.partialSupport", {
                                        defaultValue: "Partially supported",
                                      })}
                                      )
                                    </span>
                                  )}
                                </span>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : (
                  // Preset tab shows only the first condition, custom tab shows all conditions
                  conditions.map((condition, index) => {
                    const showDeleteButton =
                      isCustomTab && conditions.length > 1;
                    return (
                      <div
                        key={condition.id}
                        className="border rounded-lg p-4 space-y-3 bg-muted/30"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 flex-1">
                            <span className="text-sm font-medium">
                              {t("insight.filter.condition", "Condition")}{" "}
                              {isCustomTab && conditions.length > 1
                                ? `${index + 1}`
                                : ""}
                            </span>
                            <Select
                              value={condition.kind}
                              disabled={isPresetTab && !canModifyKind} // Preset tab controlled by rules, custom tab is modifiable
                              onValueChange={(
                                value: InsightFilterCondition["kind"],
                              ) => {
                                // Reset condition based on new kind
                                let newCondition: InsightFilterCondition;
                                switch (value) {
                                  case "keyword":
                                    newCondition = {
                                      kind: "keyword",
                                      values: [],
                                      match: "any",
                                    };
                                    break;
                                  case "has_tasks":
                                    newCondition = {
                                      kind: "has_tasks",
                                      values: ["myTasks", "waitingForMe"],
                                    };
                                    break;
                                  case "people":
                                    newCondition = {
                                      kind: "people",
                                      values: [] as string[],
                                      match: "any" as const,
                                      caseSensitive: false,
                                    };
                                    break;
                                  case "groups":
                                    newCondition = {
                                      kind: "groups",
                                      values: [] as string[],
                                      match: "any" as const,
                                    };
                                    break;
                                  case "account":
                                    newCondition = {
                                      kind: "account",
                                      values: [] as string[],
                                    };
                                    break;
                                  case "urgency":
                                    newCondition = {
                                      kind: "urgency",
                                      values: [],
                                    };
                                    break;
                                  case "category":
                                    newCondition = {
                                      kind: "category",
                                      values: [],
                                    };
                                    break;
                                  case "importance":
                                    newCondition = {
                                      kind: "importance",
                                      values: [],
                                    };
                                    break;
                                  case "mentions_me":
                                    newCondition = {
                                      kind: "mentions_me",
                                      values: [],
                                    };
                                    break;
                                  case "platform":
                                    newCondition = {
                                      kind: "platform",
                                      values: [],
                                    };
                                    break;
                                  case "task_label":
                                    newCondition = {
                                      kind: "task_label",
                                      values: [],
                                    };
                                    break;
                                  case "time_window":
                                    newCondition = {
                                      kind: "time_window",
                                      withinHours: 24,
                                    };
                                    break;
                                }
                                handleUpdateCondition(
                                  condition.id,
                                  newCondition,
                                );
                              }}
                            >
                              <SelectTrigger className="w-48">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {supportedFields.map((field) => {
                                  const isGroupsField = field === "groups";
                                  const groupsSupportedByAll =
                                    isFieldSupportedByAllPlatforms(
                                      "groups",
                                      connectedPlatforms,
                                    );
                                  return (
                                    <SelectItem key={field} value={field}>
                                      <span>
                                        {getFilterFieldLabel(
                                          field,
                                          (
                                            key: string,
                                            defaultValue?: string,
                                          ) => t(key, { defaultValue }),
                                        )}
                                        {isGroupsField &&
                                          !groupsSupportedByAll && (
                                            <span className="ml-1 text-xs text-muted-foreground">
                                              (
                                              {t(
                                                "insight.filter.partialSupport",
                                                {
                                                  defaultValue:
                                                    "Partially supported",
                                                },
                                              )}
                                              )
                                            </span>
                                          )}
                                      </span>
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          </div>

                          {index > 0 && (
                            <div className="w-24">
                              <Select
                                value={condition.op}
                                onValueChange={(op) => {
                                  handleUpdateCondition(condition.id, {
                                    ...condition,
                                    op: (op as "and" | "or") ?? "and",
                                  });
                                }}
                              >
                                <SelectTrigger className="h-8 text-sm">
                                  <SelectValue
                                    placeholder={t("insight.filter.and", "AND")}
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="and">
                                    {t("insight.filter.and", "AND")}
                                  </SelectItem>
                                  <SelectItem value="or">
                                    {t("insight.filter.or", "OR")}
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )}

                          {/* Custom group deletable condition button */}
                          {showDeleteButton && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                handleRemoveCondition(condition.id)
                              }
                              className="h-8 w-8"
                              aria-label={t(
                                "insight.filter.removeCondition",
                                "Delete condition",
                              )}
                            >
                              <RemixIcon name="delete_bin" size="size-4" />
                            </Button>
                          )}
                        </div>

                        <div className="space-y-2">
                          {renderConditionValueSelector(condition)}
                          {"values" in condition &&
                            condition.values &&
                            condition.values.length > 0 && (
                              <div className="flex flex-wrap gap-2 mt-2">
                                {[...new Set(condition.values)].map(
                                  (value: string) => {
                                    let displayValue = value;
                                    if (condition.kind === "importance") {
                                      displayValue = getImportanceLabel(value);
                                    } else if (condition.kind === "urgency") {
                                      displayValue = getUrgencyLabel(value);
                                    }
                                    return (
                                      <div
                                        key={value}
                                        className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-sm"
                                      >
                                        <span>{displayValue}</span>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleRemoveValueFromCondition(
                                              condition.id,
                                              value,
                                            )
                                          }
                                          disabled={!canModifyValues}
                                          className="hover:bg-primary/20 rounded-full p-0.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                          aria-label={t(
                                            "common.delete",
                                            "Delete",
                                          )}
                                        >
                                          <RemixIcon
                                            name="close"
                                            size="size-3"
                                          />
                                        </button>
                                      </div>
                                    );
                                  },
                                )}
                              </div>
                            )}
                        </div>

                        {condition.kind === "people" ||
                        condition.kind === "groups" ? (
                          <div className="flex items-center gap-2">
                            <Label className="text-xs">
                              {t("insight.filter.matchMode", "Match mode")}
                            </Label>
                            <Select
                              value={
                                condition.kind === "people" ||
                                condition.kind === "groups"
                                  ? condition.match
                                  : "any"
                              }
                              disabled={!canModifyValues}
                              onValueChange={(value: "any" | "all") => {
                                handleUpdateCondition(condition.id, {
                                  ...condition,
                                  match: value,
                                });
                              }}
                            >
                              <SelectTrigger className="w-32">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="any">
                                  {t("insight.filter.matchAny", "Match any")}
                                </SelectItem>
                                <SelectItem value="all">
                                  {t("insight.filter.matchAll", "Match all")}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}

                {/* Custom group add condition button */}
                {isCustomTab && conditions.length > 0 && (
                  <div className="flex justify-start">
                    <Select
                      value=""
                      onValueChange={(
                        value: InsightFilterCondition["kind"],
                      ) => {
                        if (value) {
                          handleAddCondition(value);
                        }
                      }}
                    >
                      <SelectTrigger className="w-48">
                        <SelectValue
                          placeholder={
                            <div className="flex items-center gap-2">
                              <RemixIcon name="add" size="size-4" />
                              <span>
                                {t(
                                  "insight.filter.addCondition",
                                  "Add condition",
                                )}
                              </span>
                            </div>
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {supportedFields.map((field) => {
                          const isGroupsField = field === "groups";
                          const groupsSupportedByAll =
                            isFieldSupportedByAllPlatforms(
                              "groups",
                              connectedPlatforms,
                            );
                          return (
                            <SelectItem key={field} value={field}>
                              <span>
                                {getFilterFieldLabel(
                                  field,
                                  (key: string, defaultValue?: string) =>
                                    t(key, { defaultValue }),
                                )}
                                {isGroupsField && !groupsSupportedByAll && (
                                  <span className="ml-1 text-xs text-muted-foreground">
                                    (
                                    {t("insight.filter.partialSupport", {
                                      defaultValue: "Partially supported",
                                    })}
                                    )
                                  </span>
                                )}
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
