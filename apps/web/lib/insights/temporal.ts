/**
 * Temporal Query Module for Insights
 *
 * Enables time-travel queries on insights using valid_from/valid_to temporal columns.
 */

import { insight } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { eq, and, lte, gte, sql, desc, type SQL } from "drizzle-orm";
import type { DrizzleDB } from "@/lib/db/types";

/**
 * Helper to combine conditions with AND, handling the case where we have 0-1 conditions
 */
function buildWhereClause(conditions: (SQL | undefined)[]): SQL | undefined {
  const defined = conditions.filter((c): c is SQL => c !== undefined);
  if (defined.length === 0) return undefined;
  if (defined.length === 1) return defined[0];
  // Start with the first defined condition
  let result: SQL = defined[0];
  // AND it with the rest
  for (let i = 1; i < defined.length; i++) {
    const item = defined[i];
    if (item === undefined) continue;
    const combined = and(result, item);
    if (combined !== undefined) {
      result = combined;
    }
  }
  return result;
}

/**
 * Get insights that were valid at a specific point in time (time-travel query)
 *
 * This returns insights where:
 * - validFrom <= timestamp (insight existed at that time)
 * - (validTo IS NULL OR validTo > timestamp) (insight was still valid at that time)
 *
 * @param userId - User ID to query insights for
 * @param timestamp - The point in time to query (Date object)
 * @param db - Database connection (optional, uses default)
 * @param options - Additional query options
 * @returns Insights that were valid at the given timestamp
 */
export async function getInsightsAsOf(
  userId: string,
  timestamp: Date,
  dbInstance?: DrizzleDB,
  options: {
    limit?: number;
    botIds?: string[];
  } = {},
): Promise<(typeof insight.$inferSelect)[]> {
  const database = dbInstance ?? db;
  const { limit = 100, botIds } = options;

  // Time-travel query: find insights valid at the given timestamp
  // An insight is valid at timestamp T if:
  //   validFrom <= T AND (validTo IS NULL OR validTo > T)
  const conditions = [
    // Either no validFrom set (always valid from creation) or validFrom <= timestamp
    sql`(${insight.validFrom} IS NULL OR ${insight.validFrom} <= ${timestamp})`,
    // Either no validTo set (still valid) or validTo > timestamp
    sql`(${insight.validTo} IS NULL OR ${insight.validTo} > ${timestamp})`,
    // Only non-archived insights
    eq(insight.isArchived, false),
  ];

  // Build the where clause
  const whereClause = buildWhereClause(conditions);

  try {
    const results = await database
      .select()
      .from(insight)
      .where(whereClause ?? undefined)
      .orderBy(desc(insight.time))
      .limit(limit);

    return results;
  } catch (error) {
    console.error("[TemporalQueries] Failed to getInsightsAsOf:", error);
    throw error;
  }
}

/**
 * Get the history of an insight over time (all valid intervals)
 *
 * @param insightId - The insight ID to get history for
 * @param db - Database connection (optional, uses default)
 * @returns Array of insight versions with their valid intervals
 */
export async function getInsightTemporalHistory(
  insightId: string,
  dbInstance?: DrizzleDB,
): Promise<(typeof insight.$inferSelect)[]> {
  const database = dbInstance ?? db;

  try {
    const results = await database
      .select()
      .from(insight)
      .where(eq(insight.id, insightId))
      .orderBy(insight.validFrom);

    return results;
  } catch (error) {
    console.error(
      "[TemporalQueries] Failed to getInsightTemporalHistory:",
      error,
    );
    throw error;
  }
}

/**
 * Get insights that were created or modified within a time range
 *
 * @param userId - User ID
 * @param startTime - Start of the time range
 * @param endTime - End of the time range
 * @param db - Database connection (optional)
 * @returns Insights created or modified within the range
 */
export async function getInsightsInTimeRange(
  userId: string,
  startTime: Date,
  endTime: Date,
  dbInstance?: DrizzleDB,
  options: {
    limit?: number;
  } = {},
): Promise<(typeof insight.$inferSelect)[]> {
  const database = dbInstance ?? db;
  const { limit = 100 } = options;

  try {
    const results = await database
      .select()
      .from(insight)
      .where(
        and(
          // Insight was created within the range
          lte(insight.createdAt, endTime),
          gte(insight.createdAt, startTime),
        ),
      )
      .orderBy(desc(insight.createdAt))
      .limit(limit);

    return results;
  } catch (error) {
    console.error("[TemporalQueries] Failed to getInsightsInTimeRange:", error);
    throw error;
  }
}

/**
 * Get insights that overlap with a given time interval
 *
 * An insight overlaps if any part of its valid period intersects with [startTime, endTime]
 *
 * @param userId - User ID
 * @param startTime - Start of the interval
 * @param endTime - End of the interval
 * @param db - Database connection (optional)
 * @returns Insights that overlap with the given interval
 */
export async function getInsightsOverlappingInterval(
  userId: string,
  startTime: Date,
  endTime: Date,
  dbInstance?: DrizzleDB,
  options: {
    limit?: number;
  } = {},
): Promise<(typeof insight.$inferSelect)[]> {
  const database = dbInstance ?? db;
  const { limit = 100 } = options;

  // Overlap condition: insight's valid period overlaps with [startTime, endTime]
  // This means: validFrom <= endTime AND (validTo IS NULL OR validTo >= startTime)
  const conditions = [
    sql`(${insight.validFrom} IS NULL OR ${insight.validFrom} <= ${endTime})`,
    sql`(${insight.validTo} IS NULL OR ${insight.validTo} >= ${startTime})`,
    eq(insight.isArchived, false),
  ];

  const whereClause = buildWhereClause(conditions);

  try {
    const results = await database
      .select()
      .from(insight)
      .where(whereClause ?? undefined)
      .orderBy(desc(insight.time))
      .limit(limit);

    return results;
  } catch (error) {
    console.error(
      "[TemporalQueries] Failed to getInsightsOverlappingInterval:",
      error,
    );
    throw error;
  }
}

/**
 * Set the temporal validity period for an insight
 *
 * This allows updating the valid_from and valid_to timestamps, which is useful
 * for:
 * - Setting when an insight starts being relevant (e.g., future events)
 * - Marking an insight as expired (e.g., project completed, no longer relevant)
 * - Correcting temporal data
 *
 * @param insightId - The insight ID to update
 * @param validFrom - When the insight becomes valid (null = always valid from creation)
 * @param validTo - When the insight expires (null = never expires)
 * @param db - Database connection (optional)
 */
export async function setInsightValidityPeriod(
  insightId: string,
  validFrom: Date | null,
  validTo: Date | null,
  dbInstance?: DrizzleDB,
): Promise<void> {
  const database = dbInstance ?? db;

  // Validate: validTo should be after validFrom if both are set
  if (validFrom && validTo && validTo <= validFrom) {
    throw new Error("validTo must be after validFrom");
  }

  try {
    await database
      .update(insight)
      .set({
        validFrom,
        validTo,
        updatedAt: new Date(),
      })
      .where(eq(insight.id, insightId));
  } catch (error) {
    console.error(
      "[TemporalQueries] Failed to setInsightValidityPeriod:",
      error,
    );
    throw error;
  }
}

/**
 * Expire an insight (set validTo to current time)
 *
 * This marks an insight as no longer current/relevant without archiving it.
 * Archived insights are hidden; expired insights are still visible but marked as historical.
 *
 * @param insightId - The insight ID to expire
 * @param db - Database connection (optional)
 */
export async function expireInsight(
  insightId: string,
  dbInstance?: DrizzleDB,
): Promise<void> {
  return setInsightValidityPeriod(insightId, null, new Date(), dbInstance);
}

/**
 * Mark an insight as valid from a future date
 *
 * Useful for scheduled insights or events that haven't happened yet.
 *
 * @param insightId - The insight ID
 * @param validFrom - The future date when the insight becomes valid
 * @param db - Database connection (optional)
 */
export async function deferInsightValidity(
  insightId: string,
  validFrom: Date,
  dbInstance?: DrizzleDB,
): Promise<void> {
  return setInsightValidityPeriod(insightId, validFrom, null, dbInstance);
}

/**
 * Get "current" insights - those with no validTo (currently relevant)
 *
 * @param userId - User ID
 * @param db - Database connection (optional)
 * @param options - Query options
 * @returns Currently valid insights
 */
export async function getCurrentInsights(
  userId: string,
  dbInstance?: DrizzleDB,
  options: {
    limit?: number;
  } = {},
): Promise<(typeof insight.$inferSelect)[]> {
  const database = dbInstance ?? db;
  const { limit = 100 } = options;

  // Current insights have no validTo set (never expire) or validTo > now
  const now = new Date();
  const conditions = [
    sql`(${insight.validTo} IS NULL OR ${insight.validTo} > ${now})`,
    eq(insight.isArchived, false),
  ];

  const whereClause = buildWhereClause(conditions);

  try {
    const results = await database
      .select()
      .from(insight)
      .where(whereClause ?? undefined)
      .orderBy(desc(insight.time))
      .limit(limit);

    return results;
  } catch (error) {
    console.error("[TemporalQueries] Failed to getCurrentInsights:", error);
    throw error;
  }
}
