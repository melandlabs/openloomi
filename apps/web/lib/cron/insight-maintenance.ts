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
import { getRawMessageManager } from "@/lib/memory/raw-message-store";
import { upsertRawMessagesToChroma } from "@/lib/memory/chroma-memory-index";
import { hasInsightEmbeddingProviderConfig } from "@/lib/insights/embedding-service";
import {
  createUserEmbeddingProvider,
  getUserEmbeddingModelName,
} from "@/lib/ai/user-embedding-settings";
import {
  runRawMessageEmbeddingDream,
  type RawMessage,
} from "@openloomi/indexeddb";

const INSIGHT_EMBEDDING_DREAM_INTERVAL = 24 * 60 * 60 * 1000;
const RAW_MESSAGE_EMBEDDING_DREAM_INTERVAL = 24 * 60 * 60 * 1000;
const WEEKLY_MAINTENANCE_INTERVAL = 7 * 24 * 60 * 60 * 1000;

// Desktop caches the last successful maintenance run in memory, but also mirrors it to insight settings so restarts keep the same weekly window.
let lastInsightMaintenanceRunAt: Date | null = null;
let lastInsightEmbeddingDreamRunAt: Date | null = null;
let lastRawMessageEmbeddingDreamRunAt: Date | null = null;

export function getLastInsightMaintenanceRunAt(): Date | null {
  return lastInsightMaintenanceRunAt;
}

export function getLastInsightEmbeddingDreamRunAt(): Date | null {
  return lastInsightEmbeddingDreamRunAt;
}

export function getLastRawMessageEmbeddingDreamRunAt(): Date | null {
  return lastRawMessageEmbeddingDreamRunAt;
}

export function setLastInsightMaintenanceRunAt(date: Date | null) {
  lastInsightMaintenanceRunAt = date;
}

export function setLastInsightEmbeddingDreamRunAt(date: Date | null) {
  lastInsightEmbeddingDreamRunAt = date;
}

export function setLastRawMessageEmbeddingDreamRunAt(date: Date | null) {
  lastRawMessageEmbeddingDreamRunAt = date;
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

function getEmbeddingDimensions(message: RawMessage): number {
  return message.embeddingDimensions ?? message.embedding?.length ?? 0;
}

function filterRawMessagesForCurrentEmbeddingModel(
  messages: RawMessage[],
  embeddingModel: string,
  targetDimensions?: number,
): RawMessage[] {
  const currentModelMessages = messages.filter((message) => {
    const dimensions = getEmbeddingDimensions(message);
    return (
      Array.isArray(message.embedding) &&
      message.embedding.length > 0 &&
      message.embeddingModel === embeddingModel &&
      dimensions > 0 &&
      dimensions === message.embedding.length
    );
  });

  const firstWithDimensions = currentModelMessages.find(
    (message) => getEmbeddingDimensions(message) > 0,
  );
  const resolvedDimensions =
    targetDimensions ??
    (firstWithDimensions ? getEmbeddingDimensions(firstWithDimensions) : 0);

  if (!resolvedDimensions) {
    return currentModelMessages;
  }

  return currentModelMessages.filter(
    (message) => getEmbeddingDimensions(message) === resolvedDimensions,
  );
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

// Raw message dream keeps original message embeddings complete for semantic memory search.
export async function runRawMessageEmbeddingDreamIfDue(
  schedulerUserId: string | undefined,
  authToken?: string,
) {
  if (!schedulerUserId) {
    return;
  }

  const now = new Date();
  if (
    lastRawMessageEmbeddingDreamRunAt &&
    now.getTime() - lastRawMessageEmbeddingDreamRunAt.getTime() <
      RAW_MESSAGE_EMBEDDING_DREAM_INTERVAL
  ) {
    return;
  }

  if (!(await hasInsightEmbeddingProviderConfig(authToken, schedulerUserId))) {
    console.warn(
      "[LocalScheduler] Skipping raw message embedding dream: no embedding provider API key or cloud auth token configured",
    );
    return;
  }

  console.log("[LocalScheduler] Running raw message embedding dream");
  const manager = await getRawMessageManager();
  const embeddings = await createUserEmbeddingProvider({
    userId: schedulerUserId,
    authToken,
  });
  const embeddingModel = await getUserEmbeddingModelName(schedulerUserId);
  const result = await runRawMessageEmbeddingDream(manager as any, {
    userId: schedulerUserId,
    embeddingModel,
    embedDocuments: (documents) => embeddings.embedDocuments(documents),
    limit: 100,
  });
  const recentMessages = await manager.queryMessages({
    userId: schedulerUserId,
    includeArchived: false,
    pageSize: 200,
    reverse: true,
  });
  const chromaReadyMessages = filterRawMessagesForCurrentEmbeddingModel(
    recentMessages,
    embeddingModel,
    embeddings.getDimensions(),
  );
  const chromaSynced = await upsertRawMessagesToChroma(chromaReadyMessages);

  console.log("[LocalScheduler] Raw message embedding dream completed", {
    scanned: result.scanned,
    selected: result.selected,
    embedded: result.embedded,
    chromaCandidates: recentMessages.length,
    chromaReady: chromaReadyMessages.length,
    chromaSynced,
    reasons: result.reasons,
  });

  lastRawMessageEmbeddingDreamRunAt = now;
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
