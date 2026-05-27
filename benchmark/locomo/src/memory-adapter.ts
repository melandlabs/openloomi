/**
 * In-memory implementation of MemoryStorageAdapter for benchmark.
 * This implements the same interface as the production storage adapters.
 */

import type {
  MemoryStorageAdapter,
  MemoryRecord,
  MemorySummary,
  MemorySearchQuery,
  MemorySummarySearchQuery,
  MemoryPageResult,
  MemoryLockHandle,
  MemoryListCandidatesInput,
  MemoryTransitionRecordsInput,
  MemoryArchiveRecordDetailsInput,
  MemoryMarkAccessedInput,
} from "./contracts.js";

/**
 * Simple in-memory storage adapter for benchmarking.
 * Implements the MemoryStorageAdapter interface.
 */
export class InMemoryStorageAdapter implements MemoryStorageAdapter {
  private records: Map<string, MemoryRecord> = new Map();
  private summaries: Map<string, MemorySummary> = new Map();
  private locks: Map<string, { token: string; expiresAt: number }> = new Map();

  async acquireLock(input: {
    key: string;
    ttlMs: number;
    now: number;
  }): Promise<MemoryLockHandle | null> {
    const existing = this.locks.get(input.key);
    if (existing && existing.expiresAt > input.now) {
      return null; // Lock is held
    }

    const handle: MemoryLockHandle = {
      key: input.key,
      token: `lock_${input.now}_${Math.random()}`,
      acquiredAt: input.now,
      expiresAt: input.now + input.ttlMs,
    };

    this.locks.set(input.key, {
      token: handle.token,
      expiresAt: handle.expiresAt!,
    });

    return handle;
  }

  async releaseLock(handle: MemoryLockHandle): Promise<void> {
    const existing = this.locks.get(handle.key);
    if (existing && existing.token === handle.token) {
      this.locks.delete(handle.key);
    }
  }

  async listCandidates(
    input: MemoryListCandidatesInput,
  ): Promise<MemoryRecord[]> {
    const cutoff = input.olderThan;
    return Array.from(this.records.values())
      .filter(
        (r) =>
          r.userId === input.userId &&
          r.tier === input.tier &&
          r.timestamp < cutoff,
      )
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, input.limit);
  }

  async saveSummaries(summaries: MemorySummary[]): Promise<void> {
    for (const summary of summaries) {
      this.summaries.set(summary.summaryId, summary);
    }
  }

  async transitionRecords(input: MemoryTransitionRecordsInput): Promise<void> {
    for (const id of input.ids) {
      const record = this.records.get(id);
      if (record) {
        record.tier = input.toTier;
      }
    }
  }

  async archiveRecordDetails(
    input: MemoryArchiveRecordDetailsInput,
  ): Promise<void> {
    for (const id of input.ids) {
      const record = this.records.get(id);
      if (record) {
        record.archivedAt = input.archivedAt;
      }
    }
  }

  async queryRaw(
    query: MemorySearchQuery,
  ): Promise<MemoryPageResult<MemoryRecord>> {
    let items = Array.from(this.records.values()).filter(
      (r) => r.userId === query.userId && !r.archivedAt,
    );

    if (query.startTime !== undefined) {
      items = items.filter((r) => r.timestamp >= query.startTime!);
    }
    if (query.endTime !== undefined) {
      items = items.filter((r) => r.timestamp <= query.endTime!);
    }
    if (query.tiers && query.tiers.length > 0) {
      items = items.filter((r) => query.tiers!.includes(r.tier));
    }

    items.sort((a, b) =>
      query.reverse ? b.timestamp - a.timestamp : a.timestamp - b.timestamp,
    );

    const offset = query.offset ?? 0;
    const pageSize = query.pageSize ?? query.limit ?? 50;
    const start = offset;
    const end = start + pageSize;

    return {
      items: items.slice(start, end),
      hasMore: end < items.length,
      nextOffset: end < items.length ? end : undefined,
      totalApprox: items.length,
    };
  }

  async querySummaries(
    query: MemorySummarySearchQuery,
  ): Promise<MemoryPageResult<MemorySummary>> {
    let items = Array.from(this.summaries.values()).filter(
      (s) => s.userId === query.userId,
    );

    if (query.startTime !== undefined) {
      items = items.filter((s) => s.endTimestamp >= query.startTime!);
    }
    if (query.endTime !== undefined) {
      items = items.filter((s) => s.startTimestamp <= query.endTime!);
    }
    if (query.summaryTiers && query.summaryTiers.length > 0) {
      items = items.filter((s) => query.summaryTiers!.includes(s.summaryTier));
    }

    items.sort((a, b) =>
      query.reverse
        ? b.endTimestamp - a.endTimestamp
        : a.endTimestamp - b.endTimestamp,
    );

    const offset = query.offset ?? 0;
    const pageSize = query.pageSize ?? query.limit ?? 50;
    const start = offset;
    const end = start + pageSize;

    return {
      items: items.slice(start, end),
      hasMore: end < items.length,
      nextOffset: end < items.length ? end : undefined,
      totalApprox: items.length,
    };
  }

  async markRecordsAccessed(input: MemoryMarkAccessedInput): Promise<void> {
    const now = Date.now();
    for (const id of input.ids) {
      const record = this.records.get(id);
      if (record) {
        record.lastAccessAt = input.at;
        record.accessCount = (record.accessCount ?? 0) + 1;
      }
    }
  }

  // Helper methods for benchmark

  addRecord(record: MemoryRecord): void {
    this.records.set(record.id, { ...record });
  }

  getRecord(id: string): MemoryRecord | undefined {
    return this.records.get(id);
  }

  clear(): void {
    this.records.clear();
    this.summaries.clear();
    this.locks.clear();
  }

  get recordCount(): number {
    return this.records.size;
  }
}
