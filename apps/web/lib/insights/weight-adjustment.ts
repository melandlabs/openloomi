/**
 * Insight Weight Adjustment Module
 *
 * This module handles all weight-related operations for insights, including:
 * - Favorite/unfavorite weight boosts
 * - Long-term view decay
 * - View tracking and weight recovery
 * - Weight configuration management
 */

import {
  insightWeights,
  insightWeightHistory,
  insightViewHistory,
  insightWeightConfig,
  type InsightWeight,
  type InsertInsightWeight,
  type InsertInsightWeightHistory,
  type InsertInsightViewHistory,
} from "@/lib/db/schema";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import type { DrizzleDB } from "@/lib/db/types";

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface WeightConfig {
  multiplier?: number;
  duration_days?: number;
  duration_hours?: number;
  enabled?: boolean;
  threshold_days?: number[];
  rates?: number[];
  floor_multiplier?: number;
}

export interface WeightAdjustmentResult {
  success: boolean;
  newWeight: number;
  previousWeight: number;
  multiplier: number;
  error?: string;
}

// ============================================================================
// Configuration Management
// ============================================================================

/**
 * Get weight configuration from database
 * Falls back to user-specific config, then global config (user_id = NULL)
 */
export async function getWeightConfig(
  configKey: string,
  userId: string,
  db: DrizzleDB,
): Promise<WeightConfig> {
  const configs = await db
    .select({
      configValue: insightWeightConfig.configValue,
    })
    .from(insightWeightConfig)
    .where(eq(insightWeightConfig.configKey, configKey))
    .orderBy(sql`"user_id" IS NULL DESC`) // Global configs first, then user-specific
    .limit(1);

  if (configs.length === 0) {
    // Return default configs if not found in database
    return getDefaultConfig(configKey);
  }

  return parseStoredConfig(configs[0].configValue);
}

/**
 * Get default configuration values
 */
function getDefaultConfig(configKey: string): WeightConfig {
  const defaults: Record<string, WeightConfig> = {
    favorite_boost: {
      multiplier: 1.5,
      duration_days: 7,
    },
    decay_config: {
      enabled: true,
      threshold_days: [7, 14, 30],
      rates: [0.95, 0.85, 0.7],
      floor_multiplier: 0.3,
    },
    view_boost: {
      multiplier: 1.1,
      duration_hours: 24,
    },
  };

  return defaults[configKey] || {};
}

function isSqliteSchemaMode(): boolean {
  return process.env.TAURI_MODE === "true" || process.env.IS_TAURI === "true";
}

function parseStoredConfig(value: unknown): WeightConfig {
  if (!value) return {};
  if (typeof value !== "string") return value as WeightConfig;

  try {
    return JSON.parse(value) as WeightConfig;
  } catch {
    return {};
  }
}

function serializeJsonForStorage(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | string | null {
  if (!value) return null;
  return isSqliteSchemaMode() ? JSON.stringify(value) : value;
}

function getRollingAccessCutoffs(now: Date) {
  return {
    sevenDaysAgo: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    thirtyDaysAgo: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
  };
}

function readCount(row: { value: unknown } | undefined): number {
  return Number(row?.value ?? 0);
}

async function getInsightAccessCounts(
  insightId: string,
  userId: string,
  now: Date,
  db: DrizzleDB,
) {
  const { sevenDaysAgo, thirtyDaysAgo } = getRollingAccessCutoffs(now);

  const [totalRows, sevenDayRows, thirtyDayRows] = await Promise.all([
    db
      .select({ value: count() })
      .from(insightViewHistory)
      .where(
        and(
          eq(insightViewHistory.insightId, insightId),
          eq(insightViewHistory.userId, userId),
        ),
      ),
    db
      .select({ value: count() })
      .from(insightViewHistory)
      .where(
        and(
          eq(insightViewHistory.insightId, insightId),
          eq(insightViewHistory.userId, userId),
          gte(insightViewHistory.viewedAt, sevenDaysAgo),
        ),
      ),
    db
      .select({ value: count() })
      .from(insightViewHistory)
      .where(
        and(
          eq(insightViewHistory.insightId, insightId),
          eq(insightViewHistory.userId, userId),
          gte(insightViewHistory.viewedAt, thirtyDaysAgo),
        ),
      ),
  ]);

  return {
    total: readCount(totalRows[0]),
    sevenDays: readCount(sevenDayRows[0]),
    thirtyDays: readCount(thirtyDayRows[0]),
  };
}

async function getLastInsightAccessedAt(
  insightId: string,
  userId: string,
  db: DrizzleDB,
) {
  const rows = await db
    .select({ viewedAt: insightViewHistory.viewedAt })
    .from(insightViewHistory)
    .where(
      and(
        eq(insightViewHistory.insightId, insightId),
        eq(insightViewHistory.userId, userId),
      ),
    )
    .orderBy(desc(insightViewHistory.viewedAt))
    .limit(1);

  return rows[0]?.viewedAt ?? null;
}

export async function refreshInsightAccessSummary(
  insightId: string,
  userId: string,
  now: Date,
  db: DrizzleDB,
): Promise<void> {
  const accessCounts = await getInsightAccessCounts(insightId, userId, now, db);
  const lastAccessedAt = await getLastInsightAccessedAt(insightId, userId, db);

  await db
    .update(insightWeights)
    .set({
      accessCountTotal: accessCounts.total,
      accessCount7d: accessCounts.sevenDays,
      accessCount30d: accessCounts.thirtyDays,
      lastAccessedAt,
      updatedAt: now,
    })
    .where(
      and(
        eq(insightWeights.insightId, insightId),
        eq(insightWeights.userId, userId),
      ),
    );
}

// ============================================================================
// Weight Adjustment Functions
// ============================================================================

/**
 * Apply favorite weight boost to an insight
 *
 * When user favorites an insight, boost its weight by the configured multiplier
 * (default: 1.5x) for the configured duration (default: 7 days)
 */
export async function applyFavoriteBoost(
  insightId: string,
  userId: string,
  favorited: boolean,
  db: DrizzleDB,
): Promise<WeightAdjustmentResult> {
  const config = await getWeightConfig("favorite_boost", userId, db);
  const { multiplier = 1.5 } = config;

  try {
    // Get or create insight weight record
    let weightRecord = await db
      .select()
      .from(insightWeights)
      .where(
        and(
          eq(insightWeights.insightId, insightId),
          eq(insightWeights.userId, userId),
        ),
      )
      .limit(1);

    const now = new Date();
    let currentWeight = 1.0;

    if (weightRecord.length === 0) {
      // Create new weight record
      const newWeight: InsertInsightWeight = {
        insightId,
        userId,
        customWeightMultiplier: favorited ? multiplier : 1.0,
        lastWeightAdjustmentReason: favorited
          ? `favorite_boost_${config.duration_days || 7}d`
          : "unfavorite_reset",
        updatedAt: now,
      };
      const result = await db
        .insert(insightWeights)
        .values(newWeight)
        .returning();
      weightRecord = result;
      currentWeight = favorited ? multiplier : 1.0;
    } else {
      // Update existing weight record
      const existing = weightRecord[0];
      currentWeight = existing.customWeightMultiplier;
      const newMultiplier = favorited
        ? Math.min(5.0, currentWeight * multiplier)
        : 1.0; // Reset to default when unfavoriting

      await db
        .update(insightWeights)
        .set({
          customWeightMultiplier: newMultiplier,
          lastWeightAdjustmentReason: favorited
            ? `favorite_boost_${config.duration_days || 7}d`
            : "unfavorite_reset",
          updatedAt: now,
        })
        .where(eq(insightWeights.id, existing.id));

      currentWeight = newMultiplier;
    }

    // Record weight adjustment history
    const history: InsertInsightWeightHistory = {
      insightId,
      userId,
      adjustmentType: favorited ? "favorite" : ("unfavorite" as const),
      weightBefore:
        weightRecord.length > 0 ? weightRecord[0].currentEventRank : 0,
      weightAfter:
        weightRecord.length > 0
          ? weightRecord[0].currentEventRank * currentWeight
          : 0,
      weightDelta: 0, // Will be calculated based on actual EventRank
      customMultiplierBefore:
        weightRecord.length > 0 ? weightRecord[0].customWeightMultiplier : 1.0,
      customMultiplierAfter: currentWeight,
      reason: favorited
        ? `User favorited, boosting weight by ${multiplier}x for ${config.duration_days || 7} days`
        : "User unfavorited, resetting weight to default",
      context: {
        source: "api",
        multiplier,
        durationDays: config.duration_days || 7,
      },
    };

    await db.insert(insightWeightHistory).values(history);

    return {
      success: true,
      newWeight: currentWeight,
      previousWeight:
        weightRecord.length > 0 ? weightRecord[0].customWeightMultiplier : 1.0,
      multiplier: currentWeight,
    };
  } catch (error) {
    console.error("[WeightAdjustment] Failed to apply favorite boost:", error);
    return {
      success: false,
      newWeight: 1.0,
      previousWeight: 1.0,
      multiplier: 1.0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Apply weight decay to insights not viewed for a long time
 *
 * Progressive decay:
 * - 7-14 days: × 0.95
 * - 14-30 days: × 0.85
 * - 30+ days: × 0.7
 * - Minimum floor: × 0.3 (important insights won't disappear)
 */
export async function applyDecay(
  insightId: string,
  userId: string,
  db: DrizzleDB,
): Promise<WeightAdjustmentResult> {
  const config = await getWeightConfig("decay_config", userId, db);

  if (!config.enabled) {
    return {
      success: true,
      newWeight: 1.0,
      previousWeight: 1.0,
      multiplier: 1.0,
    };
  }

  try {
    const weightRecord = await db
      .select()
      .from(insightWeights)
      .where(
        and(
          eq(insightWeights.insightId, insightId),
          eq(insightWeights.userId, userId),
        ),
      )
      .limit(1);

    if (weightRecord.length === 0) {
      return {
        success: false,
        newWeight: 1.0,
        previousWeight: 1.0,
        multiplier: 1.0,
        error: "Weight record not found",
      };
    }

    const existing = weightRecord[0];
    const lastViewed = existing.lastViewedAt || existing.createdAt;
    const daysSinceView =
      (Date.now() - lastViewed.getTime()) / (24 * 60 * 60 * 1000);

    const thresholdDays = config.threshold_days || [7, 14, 30];
    const rates = config.rates || [0.95, 0.85, 0.7];
    const floorMultiplier = config.floor_multiplier || 0.3;

    // Determine decay rate based on days since last view
    let decayRate = 1.0;
    let threshold = 0;

    for (let i = 0; i < thresholdDays.length; i++) {
      if (daysSinceView >= thresholdDays[i]) {
        decayRate = rates[i];
        threshold = thresholdDays[i];
      }
    }

    if (decayRate >= 1.0) {
      // No decay needed
      return {
        success: true,
        newWeight: existing.customWeightMultiplier,
        previousWeight: existing.customWeightMultiplier,
        multiplier: existing.customWeightMultiplier,
      };
    }

    // Apply decay with floor limit
    const currentMultiplier = existing.customWeightMultiplier;
    const newMultiplier = Math.max(
      floorMultiplier,
      currentMultiplier * decayRate,
    );

    await db
      .update(insightWeights)
      .set({
        customWeightMultiplier: newMultiplier,
        lastWeightAdjustmentReason: `decay_${threshold}d`,
        updatedAt: new Date(),
      })
      .where(eq(insightWeights.id, existing.id));

    // Record weight adjustment history
    const history: InsertInsightWeightHistory = {
      insightId,
      userId,
      adjustmentType: "decay",
      weightBefore: existing.currentEventRank,
      weightAfter: existing.currentEventRank * newMultiplier,
      weightDelta: existing.currentEventRank * (newMultiplier - 1),
      customMultiplierBefore: currentMultiplier,
      customMultiplierAfter: newMultiplier,
      reason: `No views for ${Math.floor(daysSinceView)} days, applying ${decayRate}x decay`,
      context: {
        source: "cron",
        daysSinceView: Math.floor(daysSinceView),
        decayRate,
        threshold,
        floorMultiplier,
      },
    };

    await db.insert(insightWeightHistory).values(history);

    return {
      success: true,
      newWeight: newMultiplier,
      previousWeight: currentMultiplier,
      multiplier: newMultiplier,
    };
  } catch (error) {
    console.error("[WeightAdjustment] Failed to apply decay:", error);
    return {
      success: false,
      newWeight: 1.0,
      previousWeight: 1.0,
      multiplier: 1.0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Record an insight view and optionally boost weight
 *
 * Tracks user views and can apply a mild weight boost (default: 1.1x)
 * for insights that haven't been viewed in over 24 hours.
 */
export async function recordInsightView(
  insightId: string,
  userId: string,
  viewSource: "list" | "detail" | "search" | "favorite",
  viewContext?: Record<string, unknown> | null,
  db?: DrizzleDB,
): Promise<void> {
  if (!db) {
    console.warn(
      "[WeightAdjustment] No database connection provided, skipping view tracking",
    );
    return;
  }

  try {
    const now = new Date();

    // Get or create insight weight record
    const weightRecord = await db
      .select()
      .from(insightWeights)
      .where(
        and(
          eq(insightWeights.insightId, insightId),
          eq(insightWeights.userId, userId),
        ),
      )
      .limit(1);

    const config = await getWeightConfig("view_boost", userId, db);
    const { multiplier = 1.1, duration_hours = 24 } = config;

    if (weightRecord.length === 0) {
      // Create new weight record
      const newWeight: InsertInsightWeight = {
        id: crypto.randomUUID(),
        insightId,
        userId,
        customWeightMultiplier: 1.0,
        lastViewedAt: now,
        lastRankCalculatedAt: now,
        currentEventRank: 0,
        accessCountTotal: 0,
        accessCount7d: 0,
        accessCount30d: 0,
        lastAccessedAt: now,
        lastWeightAdjustmentReason: "view_recorded",
        createdAt: now,
        updatedAt: now,
      } as InsertInsightWeight;
      await db.insert(insightWeights).values(newWeight);
    } else {
      // Update existing weight record
      const existing = weightRecord[0];
      const lastViewed = existing.lastViewedAt || existing.createdAt;
      const hoursSinceView =
        (now.getTime() - lastViewed.getTime()) / (60 * 60 * 1000);
      const daysSinceView = hoursSinceView / 24;

      // Apply mild weight boost if not viewed for > 1 day
      if (daysSinceView > 1) {
        const currentMultiplier = existing.customWeightMultiplier || 1.0;
        const newMultiplier = Math.min(5.0, currentMultiplier * multiplier);

        await db
          .update(insightWeights)
          .set({
            customWeightMultiplier: newMultiplier,
            lastViewedAt: now,
            lastWeightAdjustmentReason: "view_boost",
            updatedAt: now,
          })
          .where(eq(insightWeights.id, existing.id));

        // Record weight adjustment history
        const history: InsertInsightWeightHistory = {
          id: crypto.randomUUID(),
          insightId,
          userId,
          adjustmentType: "view",
          weightBefore: existing.currentEventRank,
          weightAfter: existing.currentEventRank * newMultiplier,
          weightDelta: existing.currentEventRank * (newMultiplier - 1),
          customMultiplierBefore: currentMultiplier,
          customMultiplierAfter: newMultiplier,
          reason: `Viewed after ${Math.floor(daysSinceView)} days, applying ${multiplier}x boost`,
          context: serializeJsonForStorage({
            source: "api",
            viewSource,
            daysSinceView: Math.floor(daysSinceView),
            durationHours: duration_hours,
          }) as any,
          createdAt: now,
        } as InsertInsightWeightHistory;

        await db.insert(insightWeightHistory).values(history);
      } else {
        // Just update lastViewedAt without weight change
        await db
          .update(insightWeights)
          .set({
            lastViewedAt: now,
            updatedAt: now,
          })
          .where(eq(insightWeights.id, existing.id));
      }
    }

    // Record view history (try to insert, ignore duplicate constraint violations)
    try {
      const viewRecord: InsertInsightViewHistory = {
        id: crypto.randomUUID(),
        insightId,
        userId,
        viewSource,
        viewContext: serializeJsonForStorage(viewContext) as any,
        viewedAt: now,
      } as InsertInsightViewHistory;
      await db.insert(insightViewHistory).values(viewRecord);
    } catch (error: any) {
      // Ignore unique constraint violations (duplicate view records)
      if (
        !error?.message?.includes("unique") &&
        !error?.code?.includes("23505")
      ) {
        throw error;
      }
    }

    await refreshInsightAccessSummary(insightId, userId, now, db);
  } catch (error) {
    console.error("[WeightAdjustment] Failed to record insight view:", error);
    throw error;
  }
}

/**
 * Manually adjust weight for an insight
 *
 * Allows users to set a custom weight multiplier (0.1 - 5.0)
 */
export async function manuallyAdjustWeight(
  insightId: string,
  userId: string,
  customMultiplier: number,
  reason: string,
  db: DrizzleDB,
): Promise<WeightAdjustmentResult> {
  // Validate multiplier range
  if (customMultiplier < 0.1 || customMultiplier > 5.0) {
    return {
      success: false,
      newWeight: 1.0,
      previousWeight: 1.0,
      multiplier: 1.0,
      error: "Multiplier must be between 0.1 and 5.0",
    };
  }

  try {
    // Get or create insight weight record
    const weightRecord = await db
      .select()
      .from(insightWeights)
      .where(
        and(
          eq(insightWeights.insightId, insightId),
          eq(insightWeights.userId, userId),
        ),
      )
      .limit(1);

    const now = new Date();
    let previousMultiplier = 1.0;

    if (weightRecord.length === 0) {
      // Create new weight record
      const newWeight: InsertInsightWeight = {
        insightId,
        userId,
        customWeightMultiplier: customMultiplier,
        lastWeightAdjustmentReason: "manual_adjustment",
        updatedAt: now,
      };
      const result = await db
        .insert(insightWeights)
        .values(newWeight)
        .returning();
      previousMultiplier = 1.0;
    } else {
      // Update existing weight record
      const existing = weightRecord[0];
      previousMultiplier = existing.customWeightMultiplier;

      await db
        .update(insightWeights)
        .set({
          customWeightMultiplier: customMultiplier,
          lastWeightAdjustmentReason: "manual_adjustment",
          updatedAt: now,
        })
        .where(eq(insightWeights.id, existing.id));
    }

    // Record weight adjustment history
    const history: InsertInsightWeightHistory = {
      insightId,
      userId,
      adjustmentType: "manual",
      weightBefore:
        weightRecord.length > 0 ? weightRecord[0].currentEventRank : 0,
      weightAfter:
        weightRecord.length > 0
          ? weightRecord[0].currentEventRank * customMultiplier
          : 0,
      weightDelta: 0,
      customMultiplierBefore: previousMultiplier,
      customMultiplierAfter: customMultiplier,
      reason: reason || "User manually adjusted weight",
      context: {
        source: "api",
        previousMultiplier,
        newMultiplier: customMultiplier,
      },
    };

    await db.insert(insightWeightHistory).values(history);

    return {
      success: true,
      newWeight: customMultiplier,
      previousWeight: previousMultiplier,
      multiplier: customMultiplier,
    };
  } catch (error) {
    console.error(
      "[WeightAdjustment] Failed to manually adjust weight:",
      error,
    );
    return {
      success: false,
      newWeight: 1.0,
      previousWeight: 1.0,
      multiplier: 1.0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get weight adjustment history for an insight
 */
export async function getWeightHistory(
  insightId: string,
  userId: string,
  db: DrizzleDB,
  limit = 50,
): Promise<any[]> {
  try {
    const history = await db
      .select()
      .from(insightWeightHistory)
      .where(
        and(
          eq(insightWeightHistory.insightId, insightId),
          eq(insightWeightHistory.userId, userId),
        ),
      )
      .orderBy(sql`${insightWeightHistory.createdAt} DESC`)
      .limit(limit);

    return history;
  } catch (error) {
    console.error("[WeightAdjustment] Failed to get weight history:", error);
    return [];
  }
}

/**
 * Get current weight for an insight
 */
export async function getInsightWeight(
  insightId: string,
  userId: string,
  db: DrizzleDB,
): Promise<InsightWeight | null> {
  try {
    const weightRecord = await db
      .select()
      .from(insightWeights)
      .where(
        and(
          eq(insightWeights.insightId, insightId),
          eq(insightWeights.userId, userId),
        ),
      )
      .limit(1);

    return weightRecord.length > 0 ? weightRecord[0] : null;
  } catch (error) {
    console.error("[WeightAdjustment] Failed to get insight weight:", error);
    return null;
  }
}

/**
 * Load weight multipliers for multiple insights
 * Returns a Map<insightId, customWeightMultiplier> for use in EventRank calculation
 *
 * @param insightIds - Array of insight IDs to load weights for
 * @param userId - User ID
 * @param db - Database connection
 * @returns Map of insightId -> weightMultiplier (default 1.0 if not found)
 */
export async function loadWeightMultipliers(
  insightIds: string[],
  userId: string,
  db: DrizzleDB,
): Promise<Map<string, number>> {
  try {
    if (insightIds.length === 0) {
      return new Map();
    }

    const weights = await db
      .select({
        insightId: insightWeights.insightId,
        multiplier: insightWeights.customWeightMultiplier,
      })
      .from(insightWeights)
      .where(eq(insightWeights.userId, userId));

    const weightMap = new Map<string, number>();

    // Build map: insightId -> multiplier
    weights.forEach((w: any) => {
      weightMap.set(w.insightId, w.multiplier);
    });

    // Fill in missing IDs with default 1.0
    insightIds.forEach((id) => {
      if (!weightMap.has(id)) {
        weightMap.set(id, 1.0);
      }
    });

    return weightMap;
  } catch (error) {
    console.error(
      "[WeightAdjustment] Failed to load weight multipliers:",
      error,
    );
    // Return default map with all multipliers set to 1.0
    const defaultMap = new Map<string, number>();
    insightIds.forEach((id) => defaultMap.set(id, 1.0));
    return defaultMap;
  }
}
