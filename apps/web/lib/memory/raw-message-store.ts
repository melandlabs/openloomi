import "server-only";

import type { RawMessageStorageManager } from "@openloomi/indexeddb/storage";
import {
  getPostgresRawMessageManager,
  isPostgresRawMessageStorageAvailable,
} from "@/lib/memory/postgres-raw-message-store";
import {
  getSQLiteRawMessageManager,
  isSQLiteRawMessageStorageAvailable,
} from "@/lib/memory/sqlite-raw-message-store";

export type RawMessageStorageBackend = "sqlite" | "postgres";

export type RawMessageStorageManagerWithSearch = RawMessageStorageManager & {
  searchMessagesSemantically?: (input: {
    userId: string;
    queryEmbedding: number[];
    embeddingModel?: string;
    limit?: number;
    scanLimit?: number;
    threshold?: number;
    includeArchived?: boolean;
    platform?: string;
    botId?: string;
    channel?: string;
    person?: string;
    startTime?: number;
    endTime?: number;
  }) => Promise<unknown[]>;
};

export function getRawMessageStorageBackend(): RawMessageStorageBackend {
  return isSQLiteRawMessageStorageAvailable() ? "sqlite" : "postgres";
}

export function isRawMessageStorageAvailable(): boolean {
  return (
    isSQLiteRawMessageStorageAvailable() ||
    isPostgresRawMessageStorageAvailable()
  );
}

export async function getRawMessageManager(): Promise<RawMessageStorageManagerWithSearch> {
  if (isSQLiteRawMessageStorageAvailable()) {
    return getSQLiteRawMessageManager();
  }
  return getPostgresRawMessageManager();
}
