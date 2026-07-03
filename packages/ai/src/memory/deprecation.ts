/**
 * Memory record deprecation helpers.
 *
 * Deprecation is a soft-hide: the record stays in storage but `deprecatedAt`
 * is set, and the default retrieval path filters it out. This module owns:
 *
 * - The `DeprecateMemoryRecordsInput` / `Result` contracts.
 * - The `deprecateMemoryRecords` helper that batches a list of plan entries
 *   through `MemoryStorageAdapter.deprecateRecords`.
 *
 * The helper degrades gracefully: if the underlying adapter does not
 * implement `deprecateRecords` (older versions), the call returns a no-op
 * result with `adapter_missing_deprecate_records` rather than throwing — so
 * callers don't have to gate the wiring behind feature flags.
 *
 * Idempotency: re-deprecating an already-deprecated record does not bump the
 * `affectedRows` count. This relies on the storage adapter's UPDATE only
 * matching rows where `deprecated_at IS NULL`.
 */

import type {
  MemoryDeprecateRecordsInput,
  MemoryStorageAdapter,
} from "./contracts";

/**
 * Lightweight shape of a consolidation plan entry that carries the data we
 * need to build a deprecation request. We accept this structural type (rather
 * than `import type { MemoryConsolidationPlanEntry } from .../plan`) so this
 * module stays free of consolidation-specific imports — callers from the
 * consolidation package just pass entries through.
 *
 * Only `action`, `recordIds`, `supersededBySummaryId` and `deprecationReason`
 * are read at runtime. Full plan entries (with `clusterKey`, `score`, etc.)
 * are assignable to this shape via structural typing.
 */
export interface DeprecatablePlanEntry {
  action: "deprecate" | (string & {});
  recordIds: string[];
  supersededBySummaryId?: string;
  deprecationReason?: string;
}

export type DeprecateMemoryRecordsReasonCode =
  | "persistence_disabled"
  | "dry_run"
  | "adapter_missing_deprecate_records"
  | "empty_ids"
  | "persisted"
  | "adapter_returned_zero"
  | (string & {});

export interface DeprecateMemoryRecordsInput {
  userId: string;
  entries: DeprecatablePlanEntry[];
  /** When false, the helper short-circuits without touching the adapter. */
  enabled?: boolean;
  /** When true, the adapter call is skipped but counts are computed. */
  dryRun?: boolean;
  /** Override for the deprecation timestamp; defaults to `Date.now()`. */
  now?: number;
  /**
   * Storage adapter that implements the optional `deprecateRecords` method.
   * When omitted (or when the method is not implemented), the helper
   * degrades gracefully.
   */
  store?: MemoryStorageAdapter;
  /**
   * Only entries whose `action === "deprecate"` are persisted. Defaults to
   * true (defensive). Set false to forward all entries verbatim.
   */
  onlyDeprecate?: boolean;
}

export interface DeprecateMemoryRecordsResult {
  status: "disabled" | "dry-run" | "persisted" | "no-op";
  userId: string;
  dryRun: boolean;
  plannedRecordIds: string[];
  plannedCount: number;
  persistedCount: number;
  reasonCodes: DeprecateMemoryRecordsReasonCode[];
  /**
   * Per-entry outcome. `persistedCount` is the sum of `affectedRows` across
   * entries, so callers can compare plannedCount vs persistedCount to detect
   * idempotent re-runs (already-deprecated ids don't bump the count).
   */
  perEntry: Array<{
    entry: DeprecatablePlanEntry;
    affectedRows: number;
  }>;
}

function isDeprecateEntry(entry: DeprecatablePlanEntry): boolean {
  return entry.action === "deprecate";
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Persist deprecation entries against a `MemoryStorageAdapter`.
 *
 * Behaviour:
 * - `enabled === false`  → no-op with reason "persistence_disabled".
 * - `dryRun === true`    → compute counts without touching the adapter.
 * - `store` missing or `deprecateRecords` not implemented → degrade to no-op
 *   with `adapter_missing_deprecate_records`. Keeps callers safe on storage
 *   adapters that pre-date the deprecation columns.
 *
 * Idempotent: re-deprecating an already-deprecated record is harmless.
 */
export async function deprecateMemoryRecords(
  input: DeprecateMemoryRecordsInput,
): Promise<DeprecateMemoryRecordsResult> {
  const now = input.now ?? Date.now();
  // Opt-in dry run: callers must explicitly pass `dryRun: true` to skip the
  // adapter call. The default is to actually persist so production wiring
  // doesn't silently lose data when an option is forgotten.
  const dryRun = input.dryRun === true;

  const targetEntries =
    input.onlyDeprecate === false
      ? input.entries
      : input.entries.filter(isDeprecateEntry);

  const plannedRecordIds = uniqueIds(
    targetEntries.flatMap((entry) => entry.recordIds),
  );

  const reasonCodes = new Set<DeprecateMemoryRecordsReasonCode>();

  if (input.enabled === false) {
    reasonCodes.add("persistence_disabled");
    return {
      status: "disabled",
      userId: input.userId,
      dryRun,
      plannedRecordIds,
      plannedCount: plannedRecordIds.length,
      persistedCount: 0,
      reasonCodes: [...reasonCodes],
      perEntry: targetEntries.map((entry) => ({ entry, affectedRows: 0 })),
    };
  }

  if (dryRun) {
    reasonCodes.add("dry_run");
    return {
      status: "dry-run",
      userId: input.userId,
      dryRun: true,
      plannedRecordIds,
      plannedCount: plannedRecordIds.length,
      persistedCount: 0,
      reasonCodes: [...reasonCodes],
      perEntry: targetEntries.map((entry) => ({ entry, affectedRows: 0 })),
    };
  }

  if (plannedRecordIds.length === 0) {
    reasonCodes.add("empty_ids");
    return {
      status: "no-op",
      userId: input.userId,
      dryRun: false,
      plannedRecordIds,
      plannedCount: 0,
      persistedCount: 0,
      reasonCodes: [...reasonCodes],
      perEntry: [],
    };
  }

  if (!input.store?.deprecateRecords) {
    reasonCodes.add("adapter_missing_deprecate_records");
    return {
      status: "no-op",
      userId: input.userId,
      dryRun: false,
      plannedRecordIds,
      plannedCount: plannedRecordIds.length,
      persistedCount: 0,
      reasonCodes: [...reasonCodes],
      perEntry: targetEntries.map((entry) => ({ entry, affectedRows: 0 })),
    };
  }

  const perEntry: Array<{
    entry: DeprecatablePlanEntry;
    affectedRows: number;
  }> = [];
  let persistedCount = 0;

  for (const entry of targetEntries) {
    const adapterInput: MemoryDeprecateRecordsInput = {
      userId: input.userId,
      ids: [...entry.recordIds],
      deprecatedAt: now,
      reason: entry.deprecationReason,
      supersededBySummaryId: entry.supersededBySummaryId,
    };
    const affectedRows = await input.store.deprecateRecords(adapterInput);
    perEntry.push({ entry, affectedRows });
    persistedCount += affectedRows;
  }

  reasonCodes.add("persisted");
  if (persistedCount === 0) reasonCodes.add("adapter_returned_zero");

  return {
    status: "persisted",
    userId: input.userId,
    dryRun: false,
    plannedRecordIds,
    plannedCount: plannedRecordIds.length,
    persistedCount,
    reasonCodes: [...reasonCodes],
    perEntry,
  };
}
