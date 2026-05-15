import type {
  MemorySummaryRecord,
  RawMessage,
  RawMessageEmbeddingUpdate,
  RawMessageQuery,
} from "./manager";
import type {
  RunRawMessageEmbeddingDreamInput,
  RawMessageSemanticSearchInput,
} from "./embedding";

export type SQLiteRawMessageQueryResultItem =
  | (RawMessage & { sourceType: "raw" })
  | (MemorySummaryRecord & { sourceType: "summary" });

const SQLITE_RAW_MESSAGES_API = "/api/memory/raw-messages";
const SQLITE_RAW_MESSAGES_MIGRATION_VERSION = 1;
const SQLITE_RAW_MESSAGES_MIGRATION_STALE_MS = 10 * 60 * 1000;

export type RawMessagesSQLiteMigrationStatus =
  | "not_started"
  | "running"
  | "completed"
  | "failed";

export interface RawMessagesSQLiteMigrationState {
  version: number;
  userId: string;
  status: RawMessagesSQLiteMigrationStatus;
  migratedMessages: number;
  migratedSummaries: number;
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
  error?: string;
}

export type RawMessagesSQLiteMigrationResult =
  | {
      status: "completed";
      migratedMessages: number;
      migratedSummaries: number;
      state: RawMessagesSQLiteMigrationState;
    }
  | {
      status: "skipped";
      reason: "not_available" | "already_completed" | "already_running";
      migratedMessages: number;
      migratedSummaries: number;
      state?: RawMessagesSQLiteMigrationState;
    }
  | {
      status: "failed";
      migratedMessages: number;
      migratedSummaries: number;
      error: string;
      state: RawMessagesSQLiteMigrationState;
    };

const migrationPromises = new Map<
  string,
  Promise<RawMessagesSQLiteMigrationResult>
>();

function hasTauriGlobal(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function shouldUseSQLiteRawMessageStorage(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (hasTauriGlobal()) {
    return true;
  }
  return (
    typeof process !== "undefined" &&
    (process.env.TAURI_MODE === "tauri" || process.env.IS_TAURI === "true")
  );
}

export function getRawMessagesSQLiteMigrationStorageKey(
  userId: string,
): string {
  return `openloomi:raw-messages-sqlite-migration:v${SQLITE_RAW_MESSAGES_MIGRATION_VERSION}:${userId}`;
}

function getMigrationStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getRawMessagesSQLiteMigrationState(
  userId: string,
): RawMessagesSQLiteMigrationState | null {
  const storage = getMigrationStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(
      getRawMessagesSQLiteMigrationStorageKey(userId),
    );
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<RawMessagesSQLiteMigrationState>;
    if (
      parsed.version !== SQLITE_RAW_MESSAGES_MIGRATION_VERSION ||
      parsed.userId !== userId ||
      typeof parsed.status !== "string"
    ) {
      return null;
    }

    return {
      version: SQLITE_RAW_MESSAGES_MIGRATION_VERSION,
      userId,
      status: parsed.status as RawMessagesSQLiteMigrationStatus,
      migratedMessages: Number(parsed.migratedMessages ?? 0),
      migratedSummaries: Number(parsed.migratedSummaries ?? 0),
      startedAt:
        typeof parsed.startedAt === "number" ? parsed.startedAt : undefined,
      completedAt:
        typeof parsed.completedAt === "number" ? parsed.completedAt : undefined,
      updatedAt:
        typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
      error: typeof parsed.error === "string" ? parsed.error : undefined,
    };
  } catch {
    return null;
  }
}

function setRawMessagesSQLiteMigrationState(
  state: RawMessagesSQLiteMigrationState,
): void {
  const storage = getMigrationStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      getRawMessagesSQLiteMigrationStorageKey(state.userId),
      JSON.stringify(state),
    );
  } catch {
    // Migration status is an optimization; storage failures should not block use.
  }
}

export function clearRawMessagesSQLiteMigrationState(userId: string): void {
  const storage = getMigrationStorage();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(getRawMessagesSQLiteMigrationStorageKey(userId));
  } catch {
    // Ignore localStorage failures.
  }
}

function isFreshRunningMigration(
  state: RawMessagesSQLiteMigrationState | null,
): boolean {
  return (
    state?.status === "running" &&
    Date.now() - state.updatedAt < SQLITE_RAW_MESSAGES_MIGRATION_STALE_MS
  );
}

async function requestSQLiteRawMessages<T>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(SQLITE_RAW_MESSAGES_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action,
      ...payload,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(
      typeof data?.message === "string"
        ? data.message
        : `SQLite raw message API failed: ${response.status}`,
    );
  }
  return data as T;
}

export async function sqliteStoreRawMessagesFromInsight(
  userId: string,
  messages: Array<{
    messageId: string;
    platform: string;
    botId: string;
    channel?: string;
    person?: string;
    timestamp: number;
    content: string;
    attachments?: Array<{
      name: string;
      url: string;
      contentType?: string;
      sizeBytes?: number;
    }>;
    embedding?: number[];
    embeddingModel?: string;
    embeddingContentHash?: string;
    embeddingDimensions?: number;
    embeddingUpdatedAt?: number;
    metadata?: Record<string, any>;
  }>,
): Promise<{ success: boolean; stored: number; errors: number }> {
  const response = await requestSQLiteRawMessages<{
    success: boolean;
    stored: number;
    errors: number;
  }>("store", {
    messages: messages.map((message) => ({
      ...message,
      userId,
      createdAt: currentUnixSeconds(),
    })),
  });
  return response;
}

export async function sqliteQueryRawMessages(
  query: RawMessageQuery,
): Promise<SQLiteRawMessageQueryResultItem[]> {
  const response = await requestSQLiteRawMessages<{
    success: boolean;
    items: SQLiteRawMessageQueryResultItem[];
  }>("query", { query });
  return response.items ?? [];
}

export async function sqliteQueryRawMessagesGrouped(
  query: RawMessageQuery,
): Promise<Record<string, RawMessage[]>> {
  const response = await requestSQLiteRawMessages<{
    success: boolean;
    grouped: Record<string, RawMessage[]>;
  }>("queryGrouped", { query });
  return response.grouped ?? {};
}

export async function sqliteGetRawMessagesStats(): Promise<{
  totalMessages: number;
  messagesByPlatform: Record<string, number>;
  messagesByBot: Record<string, number>;
  oldestMessage?: number;
  newestMessage?: number;
}> {
  const response = await requestSQLiteRawMessages<{
    success: boolean;
    stats: {
      totalMessages: number;
      messagesByPlatform: Record<string, number>;
      messagesByBot: Record<string, number>;
      oldestMessage?: number;
      newestMessage?: number;
    };
  }>("stats");
  return response.stats;
}

export async function sqliteClearOldRawMessages(
  olderThan: number,
  _userId?: string,
): Promise<{ success: boolean; deleted: number }> {
  return requestSQLiteRawMessages("clearOld", { olderThan });
}

export async function sqliteRunMemoryForgettingCycleForUser(
  _userId: string,
  options?: {
    dryRun?: boolean;
    hardDeleteArchivedOlderThan?: number;
  },
): Promise<{
  success: boolean;
  status?: "success" | "skipped_locked";
  createdSummaries?: number;
  transitionedRecords?: number;
  archivedDetailRecords?: number;
  hardDeletedRecords?: number;
  error?: string;
}> {
  const response = await requestSQLiteRawMessages<{
    success: boolean;
    result: {
      status: "success" | "skipped_locked";
      createdSummaries: number;
      transitionedRecords: number;
      archivedDetailRecords: number;
      hardDeletedRecords: number;
    };
  }>("forgettingCycle", { options });
  return {
    success: true,
    status: response.result.status,
    createdSummaries: response.result.createdSummaries,
    transitionedRecords: response.result.transitionedRecords,
    archivedDetailRecords: response.result.archivedDetailRecords,
    hardDeletedRecords: response.result.hardDeletedRecords,
  };
}

class SQLiteApiRawMessageManager {
  async queryMessages(query: RawMessageQuery): Promise<RawMessage[]> {
    const items = await sqliteQueryRawMessages(query);
    return items.filter(
      (item): item is RawMessage & { sourceType: "raw" } =>
        item.sourceType === "raw",
    );
  }

  async updateMessageEmbeddings(
    updates: RawMessageEmbeddingUpdate[],
    userId?: string,
  ): Promise<number> {
    const response = await requestSQLiteRawMessages<{
      success: boolean;
      updated: number;
    }>("updateEmbeddings", {
      updates,
      userId,
    });
    return response.updated;
  }
}

export async function sqliteRunRawMessageEmbeddingDreamForUser(
  userId: string,
  options: Omit<RunRawMessageEmbeddingDreamInput, "userId">,
) {
  const { runRawMessageEmbeddingDream } = await import("./embedding");
  return runRawMessageEmbeddingDream(new SQLiteApiRawMessageManager(), {
    userId,
    ...options,
  });
}

export async function sqliteSearchRawMessagesSemanticallyForUser(
  userId: string,
  options: Omit<RawMessageSemanticSearchInput, "userId">,
) {
  const query = options.query.trim();
  if (!query) {
    return [];
  }

  const queryEmbedding = await options.embedQuery(query);
  if (queryEmbedding.length === 0) {
    return [];
  }

  const response = await requestSQLiteRawMessages<{
    success: boolean;
    items: unknown[];
  }>("semanticSearch", {
    queryEmbedding,
    options: {
      embeddingModel: options.embeddingModel,
      limit: options.limit,
      scanLimit: options.scanLimit,
      threshold: options.threshold,
      includeArchived: options.includeArchived,
      platform: options.platform,
      botId: options.botId,
      channel: options.channel,
      person: options.person,
      startTime: options.startTime,
      endTime: options.endTime,
    },
  });
  return response.items ?? [];
}

export async function migrateIndexedDBRawMessagesToSQLite(options: {
  userId: string;
  batchSize?: number;
  includeArchived?: boolean;
  includeSummaries?: boolean;
  onProgress?: (progress: {
    migratedMessages: number;
    migratedSummaries: number;
    done: boolean;
  }) => void;
}): Promise<{
  success: boolean;
  migratedMessages: number;
  migratedSummaries: number;
}> {
  if (!shouldUseSQLiteRawMessageStorage()) {
    return {
      success: false,
      migratedMessages: 0,
      migratedSummaries: 0,
    };
  }

  const { getIndexedDBManager } = await import("./manager");
  const manager = getIndexedDBManager();
  await manager.init();

  const batchSize = Math.max(1, Math.min(500, options.batchSize ?? 100));
  let offset = 0;
  let migratedMessages = 0;
  let migratedSummaries = 0;

  while (true) {
    const messages = await manager.queryMessages({
      userId: options.userId,
      includeArchived: options.includeArchived ?? true,
      reverse: false,
      offset,
      pageSize: batchSize,
    });
    if (messages.length === 0) {
      break;
    }

    const response = await requestSQLiteRawMessages<{
      success: boolean;
      stored: number;
    }>("store", { messages });
    migratedMessages += response.stored ?? messages.length;
    offset += messages.length;
    options.onProgress?.({
      migratedMessages,
      migratedSummaries,
      done: false,
    });

    if (messages.length < batchSize) {
      break;
    }
  }

  if (options.includeSummaries !== false) {
    offset = 0;
    while (typeof (manager as any).querySummaries === "function") {
      const summaries = await (manager as any).querySummaries({
        userId: options.userId,
        reverse: false,
        offset,
        pageSize: batchSize,
      });
      if (!Array.isArray(summaries) || summaries.length === 0) {
        break;
      }

      await requestSQLiteRawMessages("upsertSummaries", { summaries });
      migratedSummaries += summaries.length;
      offset += summaries.length;
      options.onProgress?.({
        migratedMessages,
        migratedSummaries,
        done: false,
      });

      if (summaries.length < batchSize) {
        break;
      }
    }
  }

  options.onProgress?.({
    migratedMessages,
    migratedSummaries,
    done: true,
  });

  return {
    success: true,
    migratedMessages,
    migratedSummaries,
  };
}

export async function ensureRawMessagesSQLiteMigration(options: {
  userId: string;
  batchSize?: number;
  includeArchived?: boolean;
  includeSummaries?: boolean;
  onProgress?: (state: RawMessagesSQLiteMigrationState) => void;
}): Promise<RawMessagesSQLiteMigrationResult> {
  if (!shouldUseSQLiteRawMessageStorage()) {
    return {
      status: "skipped",
      reason: "not_available",
      migratedMessages: 0,
      migratedSummaries: 0,
    };
  }

  const existing = getRawMessagesSQLiteMigrationState(options.userId);
  if (existing?.status === "completed") {
    return {
      status: "skipped",
      reason: "already_completed",
      migratedMessages: existing.migratedMessages,
      migratedSummaries: existing.migratedSummaries,
      state: existing,
    };
  }

  const inFlight = migrationPromises.get(options.userId);
  if (inFlight) {
    return inFlight;
  }

  if (isFreshRunningMigration(existing)) {
    return {
      status: "skipped",
      reason: "already_running",
      migratedMessages: existing?.migratedMessages ?? 0,
      migratedSummaries: existing?.migratedSummaries ?? 0,
      state: existing ?? undefined,
    };
  }

  const promise = runRawMessagesSQLiteMigration(options);
  migrationPromises.set(options.userId, promise);

  try {
    return await promise;
  } finally {
    migrationPromises.delete(options.userId);
  }
}

async function runRawMessagesSQLiteMigration(options: {
  userId: string;
  batchSize?: number;
  includeArchived?: boolean;
  includeSummaries?: boolean;
  onProgress?: (state: RawMessagesSQLiteMigrationState) => void;
}): Promise<RawMessagesSQLiteMigrationResult> {
  const now = Date.now();
  let state: RawMessagesSQLiteMigrationState = {
    version: SQLITE_RAW_MESSAGES_MIGRATION_VERSION,
    userId: options.userId,
    status: "running",
    migratedMessages: 0,
    migratedSummaries: 0,
    startedAt: now,
    updatedAt: now,
  };

  const updateState = (patch: Partial<RawMessagesSQLiteMigrationState>) => {
    state = {
      ...state,
      ...patch,
      updatedAt: Date.now(),
    };
    setRawMessagesSQLiteMigrationState(state);
    options.onProgress?.(state);
  };

  updateState({});

  try {
    const result = await migrateIndexedDBRawMessagesToSQLite({
      userId: options.userId,
      batchSize: options.batchSize,
      includeArchived: options.includeArchived,
      includeSummaries: options.includeSummaries,
      onProgress: (progress) => {
        updateState({
          migratedMessages: progress.migratedMessages,
          migratedSummaries: progress.migratedSummaries,
        });
      },
    });

    updateState({
      status: "completed",
      migratedMessages: result.migratedMessages,
      migratedSummaries: result.migratedSummaries,
      completedAt: Date.now(),
      error: undefined,
    });

    return {
      status: "completed",
      migratedMessages: result.migratedMessages,
      migratedSummaries: result.migratedSummaries,
      state,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateState({
      status: "failed",
      error: message,
    });

    return {
      status: "failed",
      migratedMessages: state.migratedMessages,
      migratedSummaries: state.migratedSummaries,
      error: message,
      state,
    };
  }
}
