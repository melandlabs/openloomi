/**
 * IndexedDB Manager for storing raw messages from various platforms
 * This allows AI tools to query original message content during insight generation
 */

const DB_NAME = "openloomi_messages_db";
const DB_VERSION = 3; // Incremented to add memory stage fields and summaries store
const STORE_NAME = "raw_messages";
const SUMMARY_STORE_NAME = "memory_summaries";

export type MemoryStage = "short" | "mid" | "long";
export type MemorySummaryTier = "L1" | "L2" | "L3";

export interface RawMessage {
  id?: number; // Auto-increment key
  messageId: string; // Unique message ID from platform
  platform: string; // slack, discord, telegram, etc.
  botId: string; // Bot ID
  userId: string; // User ID
  channel?: string; // Channel or chat name
  person?: string; // Sender name
  timestamp: number; // Unix timestamp
  content: string; // Message content
  attachments?: Array<{
    name: string;
    url: string;
    contentType?: string;
    sizeBytes?: number;
  }>;
  metadata?: Record<string, any>; // Additional platform-specific data
  createdAt: number; // When stored in IndexedDB
  memoryStage?: MemoryStage;
  accessCount?: number;
  lastAccessAt?: number;
  importanceScore?: number;
  archivedAt?: number;
  isPinned?: boolean;
  summaryRefId?: string;
}

export type GroupByType = "none" | "day" | "week" | "month";

export interface RawMessageQuery {
  userId?: string; // User ID to filter messages
  platform?: string;
  botId?: string;
  channel?: string;
  person?: string;
  startTime?: number;
  endTime?: number;
  keywords?: string[];
  limit?: number; // Deprecated: Use offset + pageSize instead
  offset?: number; // Number of messages to skip for pagination
  pageSize?: number; // Number of messages per page
  groupBy?: GroupByType; // Group results by time period
  reverse?: boolean; // Return results in reverse order (newest first)
  includeSummaryFallback?: boolean;
  minRawResultsWithoutFallback?: number;
  memoryStages?: MemoryStage[];
  includeArchived?: boolean;
}

export interface MemorySummaryRecord {
  summaryId: string;
  userId: string;
  summaryTier: MemorySummaryTier;
  sourceTier: MemoryStage;
  startTimestamp: number;
  endTimestamp: number;
  messageCount: number;
  sourceRecordIds: string[];
  keyPoints: string[];
  keywords: string[];
  keywordsText?: string;
  summaryText: string;
  dimensions?: Record<string, string | number | boolean | undefined>;
  qualityScore?: number;
  createdAt: number;
  updatedAt: number;
}

export interface MemorySummaryQuery {
  userId: string;
  keywords?: string[];
  startTime?: number;
  endTime?: number;
  reverse?: boolean;
  summaryTiers?: MemorySummaryTier[];
  pageSize?: number;
  limit?: number;
  offset?: number;
  dimensions?: Record<string, string | number | boolean | undefined>;
}

class IndexedDBManager {
  private db: IDBDatabase | null = null;

  /**
   * Check if the database connection is still open
   * Returns true if the connection is open and usable
   */
  private isConnectionOpen(): boolean {
    return this.db !== null;
  }

  /**
   * Ensure database connection is open, reinitialize if closed
   */
  private async ensureConnection(): Promise<void> {
    if (!this.isConnectionOpen()) {
      await this.init();
    }
  }

  /**
   * Execute a database operation with automatic retry on connection failure
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries = 1,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error: any) {
      // Check if error is related to closed database connection
      if (
        maxRetries > 0 &&
        (error.name === "InvalidStateError" ||
          error.message?.includes("closing") ||
          error.message?.includes("closed"))
      ) {
        // Close existing connection and reinitialize
        if (this.db) {
          try {
            this.db.close();
          } catch (e) {
            // Ignore close errors
          }
          this.db = null;
        }
        await this.init();
        // Retry with one less retry attempt
        return this.withRetry(operation, maxRetries - 1);
      }
      throw error;
    }
  }

  /**
   * Initialize the IndexedDB database
   */
  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        // Handle version mismatch (e.g., user has version 2 but code expects version 1)
        if (request.error?.name === "VersionError") {
          console.warn(
            `[IndexedDB] Database version mismatch. Deleting and recreating database...`,
          );
          const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
          deleteRequest.onsuccess = () => {
            console.log("[IndexedDB] Deleted old database. Reopening...");
            const reopenRequest = indexedDB.open(DB_NAME, DB_VERSION);
            reopenRequest.onerror = () =>
              reject(
                new Error(
                  `Failed to recreate IndexedDB: ${reopenRequest.error}`,
                ),
              );
            reopenRequest.onsuccess = () => {
              this.db = reopenRequest.result;
              resolve();
            };
            reopenRequest.onupgradeneeded = (event) => {
              const db = (event.target as IDBOpenDBRequest).result;
              const transaction = (event.target as IDBOpenDBRequest)
                .transaction;
              this.createObjectStore(db, transaction);
            };
          };
          deleteRequest.onerror = () => reject(deleteRequest.error);
        } else {
          reject(new Error(`Failed to open IndexedDB: ${request.error}`));
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = (event.target as IDBOpenDBRequest).transaction;
        this.createObjectStore(db, transaction);
      };
    });
  }

  /**
   * Create the object store and indexes
   */
  private createObjectStore(
    db: IDBDatabase,
    transaction?: IDBTransaction | null,
  ): void {
    const tx = transaction || (db as any).transaction;
    if (!tx) {
      console.error("[IndexedDB] No transaction available for upgrade");
      return;
    }

    const ensureIndex = (
      objectStore: IDBObjectStore,
      name: string,
      keyPath: string | string[],
      unique: boolean,
      options?: IDBIndexParameters,
    ) => {
      try {
        if (!objectStore.indexNames.contains(name)) {
          objectStore.createIndex(name, keyPath as any, {
            unique,
            ...(options ?? {}),
          });
          console.log(`[IndexedDB] Created missing index: ${name}`);
        }
      } catch (error: any) {
        console.warn(`[IndexedDB] Warning with index ${name}:`, error);
      }
    };

    let rawStore: IDBObjectStore;
    if (db.objectStoreNames.contains(STORE_NAME)) {
      rawStore = tx.objectStore(STORE_NAME);
    } else {
      rawStore = db.createObjectStore(STORE_NAME, {
        keyPath: "id",
        autoIncrement: true,
      });
    }

    ensureIndex(rawStore, "messageId", "messageId", true);
    ensureIndex(rawStore, "platform", "platform", false);
    ensureIndex(rawStore, "botId", "botId", false);
    ensureIndex(rawStore, "userId", "userId", false);
    ensureIndex(rawStore, "channel", "channel", false);
    ensureIndex(rawStore, "person", "person", false);
    ensureIndex(rawStore, "timestamp", "timestamp", false);
    ensureIndex(rawStore, "createdAt", "createdAt", false);
    ensureIndex(rawStore, "memoryStage", "memoryStage", false);
    ensureIndex(rawStore, "archivedAt", "archivedAt", false);
    ensureIndex(rawStore, "isPinned", "isPinned", false);
    ensureIndex(rawStore, "summaryRefId", "summaryRefId", false);
    // Compound indexes used by memory lifecycle:
    // - userId+memoryStage for stage-specific candidate scans
    // - userId+timestamp for bounded time window queries
    ensureIndex(
      rawStore,
      "userId_memoryStage",
      ["userId", "memoryStage"],
      false,
    );
    ensureIndex(rawStore, "userId_timestamp", ["userId", "timestamp"], false);

    let summaryStore: IDBObjectStore;
    if (db.objectStoreNames.contains(SUMMARY_STORE_NAME)) {
      summaryStore = tx.objectStore(SUMMARY_STORE_NAME);
    } else {
      summaryStore = db.createObjectStore(SUMMARY_STORE_NAME, {
        keyPath: "summaryId",
      });
    }

    ensureIndex(summaryStore, "summaryId", "summaryId", true);
    ensureIndex(summaryStore, "userId", "userId", false);
    ensureIndex(summaryStore, "summaryTier", "summaryTier", false);
    ensureIndex(
      summaryStore,
      "userId_summaryTier",
      ["userId", "summaryTier"],
      false,
    );
    ensureIndex(
      summaryStore,
      "userId_endTimestamp",
      ["userId", "endTimestamp"],
      false,
    );
    // Keep a simple text index for keyword contains filtering (inverted index can be added later).
    ensureIndex(summaryStore, "keywords", "keywordsText", false);
    ensureIndex(summaryStore, "keywordsText", "keywordsText", false);

    console.log("[IndexedDB] Database initialized successfully");
  }

  /**
   * Store a single raw message
   */
  async storeMessage(message: RawMessage): Promise<number> {
    return this.withRetry(async () => {
      await this.ensureConnection();

      return new Promise((resolve, reject) => {
        if (!this.db) {
          reject(new Error("Database not initialized"));
          return;
        }
        const transaction = this.db.transaction([STORE_NAME], "readwrite");
        const objectStore = transaction.objectStore(STORE_NAME);

        // Check if message already exists
        const index = objectStore.index("messageId");
        const getRequest = index.get(message.messageId);

        getRequest.onsuccess = () => {
          const normalizedMessage: RawMessage = {
            ...message,
            memoryStage: message.memoryStage ?? "short",
            accessCount: message.accessCount ?? 0,
            lastAccessAt: message.lastAccessAt,
            importanceScore: message.importanceScore ?? 0,
            archivedAt: message.archivedAt,
            isPinned: message.isPinned ?? false,
            summaryRefId: message.summaryRefId,
          };

          if (getRequest.result) {
            // Update existing message
            const updateRequest = objectStore.put({
              ...getRequest.result,
              ...normalizedMessage,
            });
            updateRequest.onsuccess = () =>
              resolve(updateRequest.result as number);
            updateRequest.onerror = () => reject(updateRequest.error);
          } else {
            // Add new message
            normalizedMessage.createdAt = Date.now();
            const addRequest = objectStore.add(normalizedMessage);
            addRequest.onsuccess = () => resolve(addRequest.result as number);
            addRequest.onerror = () => reject(addRequest.error);
          }
        };

        getRequest.onerror = () => reject(getRequest.error);
      });
    });
  }

  /**
   * Store multiple raw messages in bulk
   */
  async storeMessages(messages: RawMessage[]): Promise<number[]> {
    await this.ensureConnection();

    const results: number[] = [];

    for (const message of messages) {
      try {
        const id = await this.storeMessage(message);
        results.push(id);
      } catch (error) {
        console.error("[IndexedDB] Failed to store message:", error);
      }
    }

    return results;
  }

  /**
   * Query raw messages with filters
   */
  async queryMessages(query: RawMessageQuery): Promise<RawMessage[]> {
    return this.withRetry(async () => {
      await this.ensureConnection();

      return new Promise((resolve, reject) => {
        if (!this.db) {
          reject(new Error("Database not initialized"));
          return;
        }
        const transaction = this.db.transaction([STORE_NAME], "readonly");
        const objectStore = transaction.objectStore(STORE_NAME);

        const results: RawMessage[] = [];
        const offset = query.offset ?? 0;
        const pageSize = query.pageSize ?? query.limit ?? 50;
        const includeArchived = query.includeArchived ?? false;
        let matchedCount = 0;

        // Determine if we need fuzzy matching (channel/person with "includes")
        const needsFuzzyMatch = !!(
          query.channel ||
          query.person ||
          query.keywords
        );

        // Smart index selection:
        // - Priority 1: Always use userId index if available (most important for user isolation)
        // - Priority 2: Use botId index when NOT doing fuzzy matching
        // - Priority 3: Use platform index when NOT doing fuzzy matching
        // - Fallback: Full table scan for fuzzy matching (channel/person/keywords)
        let request: IDBRequest;
        const reverse = query.reverse ?? false;

        if (
          query.userId &&
          query.memoryStages &&
          query.memoryStages.length === 1 &&
          query.startTime === undefined &&
          query.endTime === undefined &&
          objectStore.indexNames.contains("userId_memoryStage")
        ) {
          // Fast path: exact user + single stage candidate scans.
          const index = objectStore.index("userId_memoryStage");
          request = index.openCursor(
            IDBKeyRange.only([query.userId, query.memoryStages[0]]),
            reverse ? "prev" : "next",
          );
        } else if (
          query.userId &&
          objectStore.indexNames.contains("userId_timestamp")
        ) {
          // Default path for user-scoped queries with time windows.
          const index = objectStore.index("userId_timestamp");
          const lower = [
            query.userId,
            query.startTime ?? Number.MIN_SAFE_INTEGER,
          ];
          const upper = [
            query.userId,
            query.endTime ?? Number.MAX_SAFE_INTEGER,
          ];
          const range = IDBKeyRange.bound(
            lower,
            upper,
            false,
            query.endTime !== undefined,
          );
          request = index.openCursor(range, reverse ? "prev" : "next");
        } else if (query.userId) {
          const index = objectStore.index("userId");
          request = index.openCursor(
            IDBKeyRange.only(query.userId),
            reverse ? "prev" : "next",
          );
        } else if (!needsFuzzyMatch && query.botId) {
          // Use botId index only when NOT doing fuzzy matching on channel/person
          const index = objectStore.index("botId");
          request = index.openCursor(
            IDBKeyRange.only(query.botId),
            reverse ? "prev" : "next",
          );
        } else if (query.platform && !needsFuzzyMatch) {
          // Use platform index only when NOT doing fuzzy matching
          const index = objectStore.index("platform");
          request = index.openCursor(
            IDBKeyRange.only(query.platform),
            reverse ? "prev" : "next",
          );
        } else {
          // Full table scan for fuzzy matching (channel/person/keywords)
          request = objectStore.openCursor(null, reverse ? "prev" : "next");
        }

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result;

          if (cursor) {
            const message = cursor.value as RawMessage;

            // Apply filters
            // CRITICAL: Always check userId first for security/isolation
            if (query.userId && message.userId !== query.userId) {
              cursor.continue();
              return;
            }

            if (query.platform && message.platform !== query.platform) {
              cursor.continue();
              return;
            }

            if (query.botId && message.botId !== query.botId) {
              cursor.continue();
              return;
            }

            if (query.channel) {
              if (
                !message.channel ||
                !message.channel
                  .toLowerCase()
                  .includes(query.channel.toLowerCase())
              ) {
                cursor.continue();
                return;
              }
            }

            if (query.person) {
              if (
                !message.person ||
                !message.person
                  .toLowerCase()
                  .includes(query.person.toLowerCase())
              ) {
                cursor.continue();
                return;
              }
            }

            if (
              query.startTime !== undefined &&
              message.timestamp &&
              message.timestamp < query.startTime
            ) {
              cursor.continue();
              return;
            }

            if (
              query.endTime !== undefined &&
              message.timestamp &&
              message.timestamp >= query.endTime
            ) {
              cursor.continue();
              return;
            }

            if (query.keywords && query.keywords.length > 0) {
              // Search across ALL fields: content, channel, person (full-text search)
              const matches = query.keywords.some((keyword) => {
                const lowerKeyword = keyword.toLowerCase();
                return (
                  message.content?.toLowerCase().includes(lowerKeyword) ||
                  message.channel?.toLowerCase().includes(lowerKeyword) ||
                  message.person?.toLowerCase().includes(lowerKeyword)
                );
              });
              if (!matches) {
                cursor.continue();
                return;
              }
            }

            const messageStage = message.memoryStage ?? "short";
            if (
              query.memoryStages &&
              query.memoryStages.length > 0 &&
              !query.memoryStages.includes(messageStage)
            ) {
              cursor.continue();
              return;
            }

            if (!includeArchived && message.archivedAt !== undefined) {
              cursor.continue();
              return;
            }

            if (matchedCount < offset) {
              matchedCount++;
              cursor.continue();
              return;
            }

            results.push(message);
            matchedCount++;

            if (results.length >= pageSize) {
              resolve(results);
              return;
            }

            cursor.continue();
          } else {
            resolve(results);
          }
        };

        request.onerror = () => {
          console.error("[IndexedDB] Query error:", request.error);
          reject(request.error);
        };
      });
    });
  }

  private normalizeSummaryRecord(
    summary: MemorySummaryRecord,
  ): MemorySummaryRecord {
    const keywords = summary.keywords ?? [];
    return {
      ...summary,
      keywords,
      keywordsText:
        summary.keywordsText ??
        keywords.map((keyword) => keyword.trim()).join(" "),
      keyPoints: summary.keyPoints ?? [],
      sourceRecordIds: summary.sourceRecordIds ?? [],
      createdAt: summary.createdAt ?? Date.now(),
      updatedAt: summary.updatedAt ?? Date.now(),
    };
  }

  async upsertSummaries(summaries: MemorySummaryRecord[]): Promise<void> {
    return this.withRetry(async () => {
      await this.ensureConnection();

      return new Promise((resolve, reject) => {
        if (!this.db) {
          reject(new Error("Database not initialized"));
          return;
        }

        if (summaries.length === 0) {
          resolve();
          return;
        }

        const transaction = this.db.transaction(
          [SUMMARY_STORE_NAME],
          "readwrite",
        );
        const objectStore = transaction.objectStore(SUMMARY_STORE_NAME);

        for (const summary of summaries) {
          objectStore.put(this.normalizeSummaryRecord(summary));
        }

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    });
  }

  async querySummaries(
    query: MemorySummaryQuery,
  ): Promise<MemorySummaryRecord[]> {
    return this.withRetry(async () => {
      await this.ensureConnection();

      return new Promise((resolve, reject) => {
        if (!this.db) {
          reject(new Error("Database not initialized"));
          return;
        }

        const transaction = this.db.transaction(
          [SUMMARY_STORE_NAME],
          "readonly",
        );
        const objectStore = transaction.objectStore(SUMMARY_STORE_NAME);
        const pageSize = query.pageSize ?? query.limit ?? 50;
        const offset = query.offset ?? 0;
        const reverse = query.reverse ?? true;
        const results: MemorySummaryRecord[] = [];
        let matchedCount = 0;

        let request: IDBRequest;
        if (objectStore.indexNames.contains("userId_endTimestamp")) {
          const index = objectStore.index("userId_endTimestamp");
          const lower = [
            query.userId,
            query.startTime ?? Number.MIN_SAFE_INTEGER,
          ];
          const upper = [
            query.userId,
            query.endTime ?? Number.MAX_SAFE_INTEGER,
          ];
          const range = IDBKeyRange.bound(
            lower,
            upper,
            false,
            query.endTime !== undefined,
          );
          request = index.openCursor(range, reverse ? "prev" : "next");
        } else {
          const index = objectStore.index("userId");
          request = index.openCursor(
            IDBKeyRange.only(query.userId),
            reverse ? "prev" : "next",
          );
        }

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result;
          if (!cursor) {
            resolve(results);
            return;
          }

          const summary = this.normalizeSummaryRecord(
            cursor.value as MemorySummaryRecord,
          );

          if (summary.userId !== query.userId) {
            cursor.continue();
            return;
          }

          if (
            query.summaryTiers &&
            query.summaryTiers.length > 0 &&
            !query.summaryTiers.includes(summary.summaryTier)
          ) {
            cursor.continue();
            return;
          }

          if (
            query.startTime !== undefined &&
            summary.endTimestamp < query.startTime
          ) {
            cursor.continue();
            return;
          }

          if (
            query.endTime !== undefined &&
            summary.startTimestamp >= query.endTime
          ) {
            cursor.continue();
            return;
          }

          if (query.keywords && query.keywords.length > 0) {
            const text = (summary.keywordsText ?? "").toLowerCase();
            const summaryText = (summary.summaryText ?? "").toLowerCase();
            const matches = query.keywords.some((keyword) => {
              const lowerKeyword = keyword.toLowerCase();
              return (
                text.includes(lowerKeyword) ||
                summaryText.includes(lowerKeyword)
              );
            });
            if (!matches) {
              cursor.continue();
              return;
            }
          }

          if (query.dimensions) {
            const summaryDimensions = summary.dimensions ?? {};
            const matchesDimensions = Object.entries(query.dimensions).every(
              ([key, value]) => {
                if (value === undefined) {
                  return true;
                }
                return summaryDimensions[key] === value;
              },
            );
            if (!matchesDimensions) {
              cursor.continue();
              return;
            }
          }

          if (matchedCount < offset) {
            matchedCount++;
            cursor.continue();
            return;
          }

          results.push(summary);
          matchedCount++;

          if (results.length >= pageSize) {
            resolve(results);
            return;
          }

          cursor.continue();
        };

        request.onerror = () => reject(request.error);
      });
    });
  }

  private async updateMessagesByMessageIds(
    messageIds: string[],
    updater: (message: RawMessage) => RawMessage,
    userId?: string,
  ): Promise<number> {
    return this.withRetry(async () => {
      await this.ensureConnection();

      return new Promise((resolve, reject) => {
        if (!this.db) {
          reject(new Error("Database not initialized"));
          return;
        }

        const ids = [...new Set(messageIds.filter(Boolean))];
        if (ids.length === 0) {
          resolve(0);
          return;
        }

        const transaction = this.db.transaction([STORE_NAME], "readwrite");
        const objectStore = transaction.objectStore(STORE_NAME);
        const index = objectStore.index("messageId");
        let updatedCount = 0;

        // Issue all reads first; each hit is updated in the same write transaction.
        for (const messageId of ids) {
          const getRequest = index.get(messageId);
          getRequest.onsuccess = () => {
            const existing = getRequest.result as RawMessage | undefined;
            if (!existing) {
              return;
            }
            if (userId && existing.userId !== userId) {
              return;
            }
            objectStore.put(updater(existing));
            updatedCount += 1;
          };
          getRequest.onerror = () => reject(getRequest.error);
        }

        transaction.oncomplete = () => resolve(updatedCount);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    });
  }

  async markMessagesAccessed(
    messageIds: string[],
    at = Date.now(),
    userId?: string,
  ): Promise<number> {
    return this.updateMessagesByMessageIds(
      messageIds,
      (message) => ({
        ...message,
        accessCount: (message.accessCount ?? 0) + 1,
        lastAccessAt: at,
      }),
      userId,
    );
  }

  async promoteMessagesToStage(
    messageIds: string[],
    stage: MemoryStage,
    options?: {
      userId?: string;
      summaryRefId?: string;
      promotedAt?: number;
    },
  ): Promise<number> {
    const promotedAt = options?.promotedAt ?? Date.now();
    return this.updateMessagesByMessageIds(
      messageIds,
      (message) => ({
        ...message,
        memoryStage: stage,
        summaryRefId: options?.summaryRefId ?? message.summaryRefId,
        metadata: {
          ...(message.metadata ?? {}),
          memoryPromotedAt: promotedAt,
        },
      }),
      options?.userId,
    );
  }

  async archiveMessages(
    messageIds: string[],
    archivedAt = Date.now(),
    userId?: string,
  ): Promise<number> {
    return this.updateMessagesByMessageIds(
      messageIds,
      (message) => ({
        ...message,
        archivedAt,
      }),
      userId,
    );
  }

  async hardDeleteArchived(
    olderThan: number,
    userId?: string,
  ): Promise<number> {
    return this.withRetry(async () => {
      await this.ensureConnection();

      return new Promise((resolve, reject) => {
        if (!this.db) {
          reject(new Error("Database not initialized"));
          return;
        }

        const transaction = this.db.transaction([STORE_NAME], "readwrite");
        const objectStore = transaction.objectStore(STORE_NAME);
        // Use archivedAt index to avoid full-store scans during cleanup.
        const index = objectStore.index("archivedAt");
        const range = IDBKeyRange.upperBound(olderThan, true);
        const request = index.openCursor(range);
        let deleted = 0;

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result;
          if (!cursor) {
            resolve(deleted);
            return;
          }

          const message = cursor.value as RawMessage;
          const shouldDelete =
            message.archivedAt !== undefined &&
            (!userId || message.userId === userId);

          if (shouldDelete) {
            cursor.delete();
            deleted++;
          }

          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      });
    });
  }

  /**
   * Get a message by its platform-specific ID
   */
  async getMessageById(messageId: string): Promise<RawMessage | null> {
    return this.withRetry(async () => {
      await this.ensureConnection();

      return new Promise((resolve, reject) => {
        if (!this.db) {
          reject(new Error("Database not initialized"));
          return;
        }
        const transaction = this.db.transaction([STORE_NAME], "readonly");
        const index = transaction.objectStore(STORE_NAME).index("messageId");
        const request = index.get(messageId);

        request.onsuccess = () => {
          resolve(request.result || null);
        };

        request.onerror = () => reject(request.error);
      });
    });
  }

  /**
   * Delete messages older than specified timestamp
   */
  async deleteOldMessages(olderThan: number, userId?: string): Promise<number> {
    return this.withRetry(async () => {
      await this.ensureConnection();

      return new Promise((resolve, reject) => {
        if (!this.db) {
          reject(new Error("Database not initialized"));
          return;
        }
        const transaction = this.db.transaction([STORE_NAME], "readwrite");
        const objectStore = transaction.objectStore(STORE_NAME);

        // Filter by userId first if provided, then by createdAt
        if (userId) {
          const userIndex = objectStore.index("userId");
          const userRange = IDBKeyRange.only(userId);
          const userRequest = userIndex.openCursor(userRange);

          let count = 0;
          userRequest.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest).result;
            if (cursor) {
              const msg = cursor.value as RawMessage;
              if (msg.createdAt < olderThan) {
                cursor.delete();
                count++;
              }
              cursor.continue();
            } else {
              resolve(count);
            }
          };
          userRequest.onerror = () => reject(userRequest.error);
        } else {
          const index = objectStore.index("createdAt");
          const range = IDBKeyRange.upperBound(olderThan);
          const request = index.openCursor(range);

          let count = 0;
          request.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest).result;
            if (cursor) {
              cursor.delete();
              count++;
              cursor.continue();
            } else {
              resolve(count);
            }
          };

          request.onerror = () => reject(request.error);
        }
      });
    });
  }

  /**
   * Clear all messages (useful for testing or logout)
   */
  async clearAll(): Promise<void> {
    return this.withRetry(async () => {
      await this.ensureConnection();

      return new Promise((resolve, reject) => {
        if (!this.db) {
          reject(new Error("Database not initialized"));
          return;
        }
        const transaction = this.db.transaction(
          [STORE_NAME, SUMMARY_STORE_NAME],
          "readwrite",
        );
        const rawRequest = transaction.objectStore(STORE_NAME).clear();
        const summaryRequest = transaction
          .objectStore(SUMMARY_STORE_NAME)
          .clear();

        let completed = 0;
        const complete = () => {
          completed++;
          if (completed >= 2) {
            resolve();
          }
        };

        rawRequest.onsuccess = complete;
        summaryRequest.onsuccess = complete;
        rawRequest.onerror = () => reject(rawRequest.error);
        summaryRequest.onerror = () => reject(summaryRequest.error);
      });
    });
  }

  /**
   * Query messages with grouping by time period (day, week, month)
   * Returns grouped messages with formatted date keys for user's local timezone
   */
  async queryMessagesGrouped(
    query: RawMessageQuery,
  ): Promise<Record<string, RawMessage[]>> {
    // Query all matching messages first (with higher limit for grouping)
    const groupQuery = {
      ...query,
      limit: query.limit ? query.limit * 10 : 1000,
    };
    const messages = await this.queryMessages(groupQuery);

    if (messages.length === 0 || query.groupBy === "none" || !query.groupBy) {
      return { all: messages };
    }

    const grouped: Record<string, RawMessage[]> = {};
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Helper to get local date string from timestamp
    const getLocalDateKey = (
      timestamp: number,
      groupBy: GroupByType,
    ): string => {
      const date = new Date(timestamp * 1000);

      if (groupBy === "day") {
        // Group by local day with friendly labels
        const dateOnly = new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
        );
        if (dateOnly.getTime() === today.getTime()) {
          return "Today";
        } else if (dateOnly.getTime() === yesterday.getTime()) {
          return "Yesterday";
        } else {
          // Format: YYYY-MM-DD
          return date.toISOString().split("T")[0];
        }
      } else if (groupBy === "week") {
        // Get the Monday of the week
        const dayOfWeek = date.getDay();
        const monday = new Date(date);
        monday.setDate(date.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        return `Week of ${monday.toISOString().split("T")[0]}`;
      } else if (groupBy === "month") {
        // Format: YYYY-MM (e.g., 2024-01)
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        return `${year}-${month}`;
      }

      return date.toISOString().split("T")[0];
    };

    // Group messages by time period
    for (const message of messages) {
      const key = getLocalDateKey(message.timestamp, query.groupBy);
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(message);
    }

    // Sort groups by date (most recent first)
    const sortedGroups: Record<string, RawMessage[]> = {};
    const sortedKeys = Object.keys(grouped).sort((a, b) => {
      // Handle special keys first
      if (a === "Today") return -1;
      if (b === "Today") return 1;
      if (a === "Yesterday") return -1;
      if (b === "Yesterday") return 1;
      return b.localeCompare(a); // Reverse chronological order
    });

    for (const key of sortedKeys) {
      sortedGroups[key] = grouped[key];
    }

    return sortedGroups;
  }

  /**
   * Get statistics about stored messages
   */
  async getStats(): Promise<{
    totalMessages: number;
    messagesByPlatform: Record<string, number>;
    messagesByBot: Record<string, number>;
    oldestMessage?: number;
    newestMessage?: number;
  }> {
    return this.withRetry(async () => {
      await this.ensureConnection();

      return new Promise((resolve, reject) => {
        if (!this.db) {
          reject(new Error("Database not initialized"));
          return;
        }
        const transaction = this.db.transaction([STORE_NAME], "readonly");
        const objectStore = transaction.objectStore(STORE_NAME);
        const request = objectStore.openCursor();

        const stats = {
          totalMessages: 0,
          messagesByPlatform: {} as Record<string, number>,
          messagesByBot: {} as Record<string, number>,
          oldestMessage: undefined as number | undefined,
          newestMessage: undefined as number | undefined,
        };

        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor) {
            const message = cursor.value as RawMessage;
            stats.totalMessages++;

            // Count by platform
            stats.messagesByPlatform[message.platform] =
              (stats.messagesByPlatform[message.platform] || 0) + 1;

            // Count by bot
            stats.messagesByBot[message.botId] =
              (stats.messagesByBot[message.botId] || 0) + 1;

            // Track timestamps
            if (
              !stats.oldestMessage ||
              message.timestamp < stats.oldestMessage
            ) {
              stats.oldestMessage = message.timestamp;
            }
            if (
              !stats.newestMessage ||
              message.timestamp > stats.newestMessage
            ) {
              stats.newestMessage = message.timestamp;
            }

            cursor.continue();
          } else {
            resolve(stats);
          }
        };

        request.onerror = () => reject(request.error);
      });
    });
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Singleton instance
let managerInstance: IndexedDBManager | null = null;

export function getIndexedDBManager(): IndexedDBManager {
  if (!managerInstance) {
    managerInstance = new IndexedDBManager();
  }
  return managerInstance;
}

export { IndexedDBManager };
