/**
 * Insight Maintenance Scheduler
 * Handles weekly insight maintenance scheduling for desktop environment
 */

import {
  getUserInsightSettings,
  updateUserInsightSettings,
} from "../db/queries";
import { runWeeklyInsightMaintenance } from "@/lib/insights/maintenance";
import { runInsightEmbeddingDream } from "@/lib/insights/dream";

const INSIGHT_EMBEDDING_DREAM_INTERVAL = 24 * 60 * 60 * 1000;
const WEEKLY_MAINTENANCE_INTERVAL = 7 * 24 * 60 * 60 * 1000;

// Desktop caches the last successful maintenance run in memory, but also mirrors it to insight settings so restarts keep the same weekly window.
let lastInsightMaintenanceRunAt: Date | null = null;
let lastInsightEmbeddingDreamRunAt: Date | null = null;

export function getLastInsightMaintenanceRunAt(): Date | null {
  return lastInsightMaintenanceRunAt;
}

export function getLastInsightEmbeddingDreamRunAt(): Date | null {
  return lastInsightEmbeddingDreamRunAt;
}

export function setLastInsightMaintenanceRunAt(date: Date | null) {
  lastInsightMaintenanceRunAt = date;
}

export function setLastInsightEmbeddingDreamRunAt(date: Date | null) {
  lastInsightEmbeddingDreamRunAt = date;
}

async function loadPersistedInsightMaintenanceRunAt(userId: string) {
  const settings = await getUserInsightSettings(userId);
  return settings?.lastInsightMaintenanceRunAt ?? null;
}

async function loadPersistedInsightEmbeddingDreamRunAt(userId: string) {
  const settings = await getUserInsightSettings(userId);
  return settings?.lastInsightEmbeddingDreamRunAt ?? null;
}

async function persistInsightMaintenanceRunAt(userId: string, runAt: Date) {
  await updateUserInsightSettings(userId, {
    lastInsightMaintenanceRunAt: runAt,
  });
}

async function persistInsightEmbeddingDreamRunAt(userId: string, runAt: Date) {
  await updateUserInsightSettings(userId, {
    lastInsightEmbeddingDreamRunAt: runAt,
  });
}

// Dream keeps insight embeddings complete over time without blocking normal insight writes.
export async function runInsightEmbeddingDreamIfDue(
  schedulerUserId: string | undefined,
  authToken?: string,
) {
  if (!schedulerUserId) {
    return;
  }

  if (!lastInsightEmbeddingDreamRunAt) {
    lastInsightEmbeddingDreamRunAt =
      await loadPersistedInsightEmbeddingDreamRunAt(schedulerUserId);
  }

  const now = new Date();
  if (
    lastInsightEmbeddingDreamRunAt &&
    now.getTime() - lastInsightEmbeddingDreamRunAt.getTime() <
      INSIGHT_EMBEDDING_DREAM_INTERVAL
  ) {
    return;
  }

  console.log("[LocalScheduler] Running insight embedding dream");
  const result = await runInsightEmbeddingDream({
    userId: schedulerUserId,
    limit: 100,
    authToken,
  });
  if (result.upsert?.failed || result.upsert?.skippedNoProvider) {
    return;
  }
  await persistInsightEmbeddingDreamRunAt(schedulerUserId, now);
  lastInsightEmbeddingDreamRunAt = now;
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
