/**
 * Insight Maintenance Scheduler
 * Handles weekly insight maintenance scheduling for desktop environment
 */

import {
  getUserInsightSettings,
  updateUserInsightSettings,
} from "../db/queries";
import {
  runDailyInsightAnalyticsMaintenance,
  runWeeklyInsightMaintenance,
} from "@/lib/insights/maintenance";

const DAILY_ANALYTICS_INTERVAL = 24 * 60 * 60 * 1000;
const WEEKLY_MAINTENANCE_INTERVAL = 7 * 24 * 60 * 60 * 1000;

// Desktop caches the last successful maintenance run in memory, but also mirrors it to insight settings so restarts keep the same weekly window.
let lastInsightMaintenanceRunAt: Date | null = null;
let lastInsightAnalyticsMaintenanceRunAt: Date | null = null;

export function getLastInsightMaintenanceRunAt(): Date | null {
  return lastInsightMaintenanceRunAt;
}

export function getLastInsightAnalyticsMaintenanceRunAt(): Date | null {
  return lastInsightAnalyticsMaintenanceRunAt;
}

export function setLastInsightMaintenanceRunAt(date: Date | null) {
  lastInsightMaintenanceRunAt = date;
}

export function setLastInsightAnalyticsMaintenanceRunAt(date: Date | null) {
  lastInsightAnalyticsMaintenanceRunAt = date;
}

async function loadPersistedInsightMaintenanceRunAt(userId: string) {
  const settings = await getUserInsightSettings(userId);
  return settings?.lastInsightMaintenanceRunAt ?? null;
}

async function persistInsightMaintenanceRunAt(userId: string, runAt: Date) {
  await updateUserInsightSettings(userId, {
    lastInsightMaintenanceRunAt: runAt,
  });
}

// Keep rolling insight analytics fresh in desktop mode even when no new view event is recorded.
export async function runDailyInsightAnalyticsMaintenanceIfDue(
  schedulerUserId: string | undefined,
) {
  if (!schedulerUserId) {
    return;
  }

  const now = new Date();
  if (
    lastInsightAnalyticsMaintenanceRunAt &&
    now.getTime() - lastInsightAnalyticsMaintenanceRunAt.getTime() <
      DAILY_ANALYTICS_INTERVAL
  ) {
    return;
  }

  console.log("[LocalScheduler] Running daily insight analytics maintenance");
  await runDailyInsightAnalyticsMaintenance({
    userId: schedulerUserId,
    now,
  });
  lastInsightAnalyticsMaintenanceRunAt = now;
}

// Run insight maintenance on the same minute loop as scheduled jobs, but only once per persisted weekly window per user.
export async function runInsightMaintenanceIfDue(
  schedulerUserId: string | undefined,
) {
  if (!schedulerUserId) {
    return;
  }

  if (!lastInsightMaintenanceRunAt) {
    lastInsightMaintenanceRunAt =
      await loadPersistedInsightMaintenanceRunAt(schedulerUserId);
  }

  const now = new Date();
  if (
    lastInsightMaintenanceRunAt &&
    now.getTime() - lastInsightMaintenanceRunAt.getTime() <
      WEEKLY_MAINTENANCE_INTERVAL
  ) {
    return;
  }

  console.log("[LocalScheduler] Running weekly insight maintenance");
  await runWeeklyInsightMaintenance({
    platform: "desktop",
    userId: schedulerUserId,
  });
  await persistInsightMaintenanceRunAt(schedulerUserId, now);
  lastInsightMaintenanceRunAt = now;
}
