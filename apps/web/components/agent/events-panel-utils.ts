/**
 * Events Panel utility functions
 * Contains utility functions for date formatting, data grouping, deduplication, local storage, and time filtering
 */

import type { Insight } from "@/lib/db/schema";

/**
 * Safely write to localStorage, silently skip on quota exceeded to avoid QuotaExceededError causing runtime errors
 */
export function safeLocalStorageSetItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch (e) {
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      if (process.env.NODE_ENV === "development") {
        console.warn(
          "[openloomi] localStorage quota exceeded, skip persisting:",
          key,
        );
      }
    } else {
      throw e;
    }
  }
}

/**
 * Convert time filter value to API days parameter
 * @param timeFilter - Time filter value
 * @returns days parameter value (0 means all time, 1 means today/24h)
 */
export function timeFilterToDays(timeFilter: "all" | "24h" | "today"): number {
  switch (timeFilter) {
    case "all":
      return 0;
    case "24h":
    case "today":
      return 1;
    default:
      return 1;
  }
}
import { coerceDate } from "@openloomi/shared";
import type { FocusDayInsight } from "@/components/insight-focus-card";
import {
  classifyFocusInsight,
  insightIsImport,
  insightIsUrgent,
} from "@/lib/insights/focus-classifier";

/**
 * Check if an Insight has substantial content
 * Used to filter out empty or meaningless Insights
 *
 * @param insight - Insight object
 * @returns true if has substantial content, false if empty
 */
export const insightHasContent = (insight: Insight): boolean => {
  // Check if description has actual content (at least 10 characters)
  const hasDescription = !!(
    insight.description && insight.description.trim().length >= 10
  );

  // Check if there are active tasks
  const hasActiveTasks = [
    insight.myTasks,
    insight.waitingForMe,
    insight.waitingForOthers,
  ].some((tasks) => {
    if (!tasks || tasks.length === 0) return false;
    // Check if there are incomplete tasks
    return tasks.some(
      (task) => task.status === "pending" || task.status === "blocked",
    );
  });

  // Check if there is detailed conversation content
  const hasDetails = !!(insight.details && insight.details.length > 0);

  // Check if there are timeline events
  const hasTimeline = !!(insight.timeline && insight.timeline.length > 0);

  // Check if there are nextActions or followUps
  const hasNextActions = !!(
    (insight.nextActions && insight.nextActions.length > 0) ||
    (insight.followUps && insight.followUps.length > 0)
  );

  // At least one condition must be met to be considered having substantive content
  return (
    hasDescription ||
    hasActiveTasks ||
    hasDetails ||
    hasTimeline ||
    hasNextActions
  );
};

/**
 * Filter out empty Insights
 * Used to remove Insights without substantial content
 *
 * @param insights - Insight array
 * @returns Filtered Insight array
 */
export const filterEmptyInsights = (insights: Insight[]): Insight[] => {
  if (!insights || insights.length === 0) {
    return [];
  }

  return insights.filter(insightHasContent);
};

/**
 * Type definition for date-grouped insights
 */
export type GroupedInsights = {
  date: string;
  dateString: string;
  insights: Insight[];
};

/**
 * Format date for display
 * @param date - Date object
 * @param language - Language code
 * @returns Formatted date string
 */
export const formatDateForDisplay = (date: Date, language: string): string => {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
  };
  if (language.startsWith("zh")) {
    return date.toLocaleDateString("zh-CN", options);
  }

  if (language.startsWith("en")) {
    return date.toLocaleDateString("en-US", options);
  }
  return date.toLocaleDateString(language, options);
};

/**
 * Grouping label for date grouping: Today/Yesterday vs full date
 * @param date - Date object
 * @param dateKey - Date key (YYYY-MM-DD)
 * @param language - Language code
 * @returns Grouping label string
 */
export const formatDateForGroupLabel = (
  date: Date,
  dateKey: string,
  language: string,
): string => {
  const todayKey = getDateKey(new Date());
  if (dateKey === todayKey) {
    return language.startsWith("zh") ? "Today" : "Today";
  }
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = getDateKey(yesterday);
  if (dateKey === yesterdayKey) {
    return language.startsWith("zh") ? "Yesterday" : "Yesterday";
  }
  return formatDateForDisplay(date, language);
};

/**
 * Format time for table display
 * Rules:
 * - Within half a day (12 hours): relative time like "1h ago", "30m ago"
 * - Within a week: relative date like "Today", "Yesterday", "2 days ago"
 * - More than a week: absolute date without year
 *
 * @param date - Date object
 * @param language - Language code
 * @param t - Translation function
 * @returns Formatted time string
 */
export const formatTimeForTable = (
  date: Date,
  language: string,
  t: (key: string, defaultValue?: string) => string,
): string => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  // Within half a day (12 hours): show relative time
  if (diffHours < 12) {
    if (diffHours < 1) {
      // Less than 1 hour, show minutes
      const minutes = Math.floor(diffMs / (1000 * 60));
      if (minutes < 1) {
        return language.startsWith("zh") ? "Just now" : "just now";
      }
      if (language.startsWith("zh")) {
        return `${minutes}${t("common.minAgo", " min ago")}`;
      } else {
        return `${minutes}m ago`;
      }
    } else {
      // 1-12 hours, show hours
      const hours = Math.floor(diffHours);
      if (language.startsWith("zh")) {
        return `${hours}${t("common.hourAgo", " hr ago")}`;
      } else {
        return `${hours}h ago`;
      }
    }
  }

  // Within a week: show relative date
  if (diffDays < 7) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetDate = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    );
    const daysDiff = Math.floor(
      (today.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysDiff === 0) {
      return t("todayTitle", language.startsWith("zh") ? "Today" : "Today");
    }
    if (daysDiff === 1) {
      return t(
        "yesterdayTitle",
        language.startsWith("zh") ? "Yesterday" : "Yesterday",
      );
    }
    // 2-6 days ago
    if (language.startsWith("zh")) {
      return `${daysDiff} days ago`;
    }
    return `${daysDiff} ${t("common.dayAgo", "days ago")}`;
  }

  // Beyond one week: show absolute date, but not year
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
  };

  if (language.startsWith("zh")) {
    return date.toLocaleDateString("zh-CN", {
      month: "long",
      day: "numeric",
    });
  }

  if (language.startsWith("en")) {
    return date.toLocaleDateString("en-US", options);
  }

  return date.toLocaleDateString(language, options);
};

/**
 * Generate normalized date string for grouping
 * @param date - Date object
 * @returns Date string (YYYY-MM-DD)
 */
export const getDateKey = (date: Date): string => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

/**
 * Get insight time
 * @param insight - Insight object
 * @returns Date object
 */
export const getInsightTime = (insight: Insight): Date => {
  if (insight.details && insight.details.length > 0) {
    const time = insight.details[insight.details.length - 1].time;
    if (time) {
      return coerceDate(time);
    }
  }
  return new Date(insight.time);
};

/**
 * Check if insight has tasks due today
 * @param insight - Insight object
 * @param today - Today's date (00:00:00)
 * @returns true if has tasks due today
 */
export const hasTaskDueToday = (insight: Insight, today: Date): boolean => {
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Check tasks in myTasks and waitingForMe
  const taskLists = [insight.myTasks, insight.waitingForMe].filter(
    (tasks): tasks is NonNullable<typeof tasks> =>
      tasks != null && tasks.length > 0,
  );

  for (const tasks of taskLists) {
    for (const task of tasks) {
      // Only check tasks with pending or blocked status
      if (task.status === "completed" || task.status === "delegated") {
        continue;
      }

      // Check deadline
      if (task.deadline) {
        const deadlineDate = new Date(task.deadline);
        if (deadlineDate >= today && deadlineDate < tomorrow) {
          return true;
        }
      }

      // Check followUpAt
      if (task.followUpAt) {
        const followUpDate = new Date(task.followUpAt);
        if (followUpDate >= today && followUpDate < tomorrow) {
          return true;
        }
      }
    }
  }

  return false;
};

/**
 * Check if insight has overdue incomplete tasks
 * @param insight - Insight object
 * @param today - Today's date (00:00:00)
 * @returns true if has overdue incomplete tasks
 */
export const hasOverdueTasks = (insight: Insight, today: Date): boolean => {
  // Check tasks in myTasks and waitingForMe
  const taskLists = [insight.myTasks, insight.waitingForMe].filter(
    (tasks): tasks is NonNullable<typeof tasks> =>
      tasks != null && tasks.length > 0,
  );

  for (const tasks of taskLists) {
    for (const task of tasks) {
      // Only check tasks with pending or blocked status
      if (task.status === "completed" || task.status === "delegated") {
        continue;
      }

      // Check if deadline is overdue
      if (task.deadline) {
        const deadlineDate = new Date(task.deadline);
        if (deadlineDate < today) {
          return true;
        }
      }
    }
  }

  return false;
};

/**
 * Common insight deduplication function
 * @param list - Insight array
 * @param keyField - Field used for deduplication
 * @returns Deduplicated Insight array
 */
export const deduplicateInsights = (
  list: Insight[],
  keyField: keyof Insight = "title",
): Insight[] => {
  if (list && Array.isArray(list)) {
    const uniqueMap = new Map<string, Insight>();
    list.forEach((insight) => {
      const key = (insight[keyField] as string) || `__empty_${keyField}_`;
      uniqueMap.set(key, insight);
    });

    return Array.from(uniqueMap.values());
  }
  return [];
};

/**
 * Group insights by date (for inbox view)
 * @param insights - Insight array
 * @param language - Language code
 * @returns Array grouped by date
 */
export const groupInsightsByDay = (
  insights: Insight[],
  language: string,
): GroupedInsights[] => {
  const groups: Record<string, GroupedInsights> = {};

  insights.forEach((insight) => {
    const date = getInsightTime(insight);
    const dateKey = getDateKey(date);

    if (!groups[dateKey]) {
      groups[dateKey] = {
        date: formatDateForGroupLabel(date, dateKey, language),
        dateString: dateKey,
        insights: [],
      };
    }

    groups[dateKey].insights.push(insight);
  });

  return Object.values(groups).sort((a, b) => {
    return b.dateString.localeCompare(a.dateString);
  });
};

/**
 * Group calendar view insight summary by date with focus classification rules
 * @param insights - Insight array
 * @param language - Language code
 * @param insightHasMyNickname - Function to check if mentioned
 * @param insightGetActions - Function to get action items
 * @returns Calendar view data grouped by date
 */
export const groupCalendarInsightsByDay = (
  insights: Insight[],
  language: string,
  insightHasMyNickname: (insight: Insight) => boolean,
  insightGetActions: (
    insight: Insight,
  ) => Array<{ id?: string; title?: string }>,
): FocusDayInsight[] => {
  const groups: Record<string, FocusDayInsight> = {};

  insights.forEach((insight) => {
    const date = getInsightTime(insight);
    const dateKey = getDateKey(date);
    const dateDisplay = formatDateForGroupLabel(date, dateKey, language);

    if (!groups[dateKey]) {
      groups[dateKey] = {
        date: dateDisplay,
        dateString: dateKey,
        stats: {
          totalMessages: 0,
          urgentCount: 0,
          mentionsCount: 0,
          importantCount: 0,
          actionItemsCount: 0,
        },
        categorizedInsights: {
          immediate: [],
          highPriority: [],
          importantInfo: [],
          followUp: [],
        },
        mainEvents: [],
        actionItems: [],
        unrepliedMessages: [],
      };
    }

    groups[dateKey].stats.totalMessages++;
    if (insightIsUrgent(insight)) {
      groups[dateKey].stats.urgentCount++;
    }
    if (insightHasMyNickname(insight)) {
      groups[dateKey].stats.mentionsCount++;
    }
    if (insightIsImport(insight)) {
      groups[dateKey].stats.importantCount++;
    }
    if (insightGetActions(insight).length > 0) {
      groups[dateKey].stats.actionItemsCount++;
    }

    const category = classifyFocusInsight({
      importance: insight.importance,
      urgency: insight.urgency,
      hasMyNickname: insightHasMyNickname(insight),
      hasActions: insightGetActions(insight).length > 0,
      myTasks: insight.myTasks,
    });

    if (category === "immediate") {
      groups[dateKey].categorizedInsights.immediate.push(insight);
    } else if (category === "high-priority") {
      groups[dateKey].categorizedInsights.highPriority.push(insight);
    } else if (category === "important-info") {
      groups[dateKey].categorizedInsights.importantInfo.push(insight);
    } else if (category === "follow-up") {
      groups[dateKey].categorizedInsights.followUp.push(insight);
    }

    if (
      insightIsImport(insight) ||
      insightIsUrgent(insight) ||
      insightHasMyNickname(insight)
    ) {
      groups[dateKey].mainEvents.push(insight);
    } else if (insightGetActions(insight).length > 0) {
      groups[dateKey].actionItems.push(insight);
    }
  });

  return Object.values(groups).sort((a, b) => {
    return b.dateString.localeCompare(a.dateString);
  });
};
