/**
 * Memory record retrieval helpers.
 *
 * `MemorySearchQuery.includeDeprecated` is plumbed through the storage
 * adapter at the SQL layer (the partial index `WHERE deprecated_at IS NULL`
 * keeps the hot path cheap). For callers that already have a `MemoryRecord[]`
 * in hand — typically the result of an embedding-store lookup or a
 * cross-tenant join — this module provides an in-process filter that
 * honours the same `includeDeprecated` semantics.
 *
 * Default behaviour: deprecated records are hidden. Callers must opt in
 * via `{ includeDeprecated: true }` to keep them (audit / chain-traversal
 * back to the canonical summary).
 */

import type { MemoryRecord } from "./contracts";

export interface MemoryRecordRetrievalOptions {
  /**
   * When false (default), records whose `deprecatedAt` is set are excluded.
   * Set true to keep deprecated records in the result.
   */
  includeDeprecated?: boolean;
}

export interface MemoryRecordRetrievalResult {
  records: MemoryRecord[];
  /**
   * Number of records that were hidden because they were deprecated and
   * `includeDeprecated` was false (or unset). Useful for observability:
   * a non-zero count combined with `includeDeprecated: true` should match.
   */
  hiddenDeprecatedCount: number;
}

/**
 * Filter a list of memory records by deprecation status.
 *
 * `includeDeprecated` defaults to `false` so the hot retrieval path stays
 * safe: deprecated records are hidden unless the caller opts in. The result
 * is a new array; the input is not mutated.
 */
export function filterDeprecatedRecords(
  records: MemoryRecord[],
  options: MemoryRecordRetrievalOptions = {},
): MemoryRecordRetrievalResult {
  const includeDeprecated = options.includeDeprecated === true;

  if (includeDeprecated) {
    return {
      records: [...records],
      hiddenDeprecatedCount: 0,
    };
  }

  const out: MemoryRecord[] = [];
  let hiddenDeprecatedCount = 0;
  for (const record of records) {
    if (record.deprecatedAt !== undefined && record.deprecatedAt !== null) {
      hiddenDeprecatedCount += 1;
      continue;
    }
    out.push(record);
  }

  return { records: out, hiddenDeprecatedCount };
}
