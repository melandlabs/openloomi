/**
 * Hebbian Potentiation Module for Insight Connections
 *
 * Implements Living Connections between insights - connections strengthen when
 * insights are co-accessed together (Hebbian learning: "neurons that fire together,
 * wire together").
 *
 * The insightConnections table tracks:
 * - strength: current connection strength (0.0 to infinity, starts at 0.1)
 * - stability: affects decay rate (higher = slower decay)
 * - coAccessCount: number of times insights were accessed together
 * - lastStrengthenedAt: when the connection was last reinforced
 */

import {
  insightConnections,
  insightViewHistory,
  type InsightConnection,
} from "@/lib/db/schema";
import { db } from "@/lib/db";
import { eq, and, sql, desc, asc } from "drizzle-orm";
import type { DrizzleDB } from "@/lib/db/types";

// ============================================================================
// Configuration
// ============================================================================

export interface HebbianConfig {
  /** Initial strength for new connections */
  initialStrength?: number;
  /** Strength increment on co-access (additive Hebbian) */
  additiveIncrement?: number;
  /** Strength multiplier on co-access (multiplicative Hebbian) */
  multiplicativeMultiplier?: number;
  /** Use multiplicative vs additive Hebbian */
  useMultiplicative?: boolean;
  /** Decay rate constant (days to decay to 1/e ≈ 0.368 of original) */
  decayDaysConstant?: number;
  /** Minimum strength floor (connection never decays below this) */
  strengthFloor?: number;
  /** Maximum strength cap */
  strengthCeiling?: number;
  /** Time window for co-access detection (in milliseconds) */
  coAccessWindowMs?: number;
}

const DEFAULT_CONFIG: Required<HebbianConfig> = {
  initialStrength: 0.1,
  additiveIncrement: 0.15,
  multiplicativeMultiplier: 1.2,
  useMultiplicative: true,
  decayDaysConstant: 30, // ~30 days to decay to 36.8% of original
  strengthFloor: 0.01,
  strengthCeiling: 10.0,
  coAccessWindowMs: 5 * 60 * 1000, // 5 minutes - insights accessed within this window are "co-accessed"
};

// ============================================================================
// Types
// ============================================================================

export interface ConnectionUpdateResult {
  success: boolean;
  connectionId: string;
  previousStrength: number;
  newStrength: number;
  coAccessCount: number;
  error?: string;
}

export interface DecayResult {
  connectionId: string;
  previousStrength: number;
  newStrength: number;
  decayFactor: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Apply Hebbian potentiation: strengthen connection when insights are co-accessed
 *
 * Formula (multiplicative): new_strength = old * multiplier
 * Formula (additive): new_strength = old + increment
 *
 * Also increases stability slightly, making the connection decay more slowly
 * over time (reinforced connections are more durable).
 */
function applyPotentiation(
  currentStrength: number,
  currentStability: number,
  config: Required<HebbianConfig>,
): { newStrength: number; newStability: number } {
  let newStrength: number;

  if (config.useMultiplicative) {
    newStrength = currentStrength * config.multiplicativeMultiplier;
  } else {
    newStrength = currentStrength + config.additiveIncrement;
  }

  // Apply ceiling
  newStrength = Math.min(newStrength, config.strengthCeiling);

  // Stability increases slightly with each potentiation (10% increase)
  // Higher stability = slower future decay = more "living" connection
  const newStability = currentStability * 1.1;

  return { newStrength, newStability };
}

/**
 * Apply Ebbinghaus-style decay to connection strength
 *
 * Formula: new_strength = old * exp(-days/sqrt(stability))
 *
 * This is inspired by the forgetting curve but adapted for connection strength.
 * Connections with higher stability decay more slowly (they're more "living").
 */
function applyDecay(
  currentStrength: number,
  currentStability: number,
  daysSinceLastStrengthened: number,
  config: Required<HebbianConfig>,
): { newStrength: number; decayFactor: number } {
  if (daysSinceLastStrengthened <= 0) {
    return { newStrength: currentStrength, decayFactor: 1.0 };
  }

  // Decay formula: exp(-days / (stability * decayConstant))
  // Higher stability means slower decay
  const effectiveDecayConstant =
    config.decayDaysConstant * Math.sqrt(currentStability);
  const decayFactor = Math.exp(
    -daysSinceLastStrengthened / effectiveDecayConstant,
  );
  const newStrength = Math.max(
    config.strengthFloor,
    currentStrength * decayFactor,
  );

  return { newStrength, decayFactor };
}

/**
 * Normalize insight IDs (always store smaller ID first to ensure consistency)
 */
function normalizeConnectionKey(
  insightIdA: string,
  insightIdB: string,
): [string, string] {
  return insightIdA < insightIdB
    ? [insightIdA, insightIdB]
    : [insightIdB, insightIdA];
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Record that two insights were co-accessed and strengthen their connection
 *
 * This should be called when a user accesses multiple insights within a short
 * time window (default 5 minutes). It will:
 * 1. Find or create the connection between the two insights
 * 2. Apply Hebbian potentiation to increase connection strength
 * 3. Update co-access count and timestamp
 *
 * @param insightIdA - First insight ID
 * @param insightIdB - Second insight ID
 * @param userId - User ID
 * @param db - Database connection (optional)
 * @param config - Hebbian configuration (optional)
 * @returns Result of the connection update
 */
export async function strengthenConnection(
  insightIdA: string,
  insightIdB: string,
  userId: string,
  dbInstance?: DrizzleDB,
  config: HebbianConfig = {},
): Promise<ConnectionUpdateResult> {
  const database = dbInstance ?? db;
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Don't strengthen connection to self
  if (insightIdA === insightIdB) {
    return {
      success: false,
      connectionId: "",
      previousStrength: 0,
      newStrength: 0,
      coAccessCount: 0,
      error: "Cannot create connection to self",
    };
  }

  const [normA, normB] = normalizeConnectionKey(insightIdA, insightIdB);
  const now = new Date();

  try {
    // Check if connection already exists
    const existing = await database
      .select()
      .from(insightConnections)
      .where(
        and(
          eq(insightConnections.insightIdA, normA),
          eq(insightConnections.insightIdB, normB),
          eq(insightConnections.userId, userId),
        ),
      )
      .limit(1);

    let result: InsightConnection;

    if (existing.length === 0) {
      // Create new connection with initial strength
      const insertResult = await database
        .insert(insightConnections)
        .values({
          insightIdA: normA,
          insightIdB: normB,
          userId,
          strength: cfg.initialStrength,
          stability: 1.0,
          coAccessCount: 1,
          lastStrengthenedAt: now,
        })
        .returning();

      result = insertResult[0];

      return {
        success: true,
        connectionId: result.id,
        previousStrength: 0,
        newStrength: cfg.initialStrength,
        coAccessCount: 1,
      };
    } else {
      // Update existing connection
      const current = existing[0];
      const previousStrength = Number(current.strength);

      // Apply Hebbian potentiation
      const { newStrength, newStability } = applyPotentiation(
        previousStrength,
        Number(current.stability),
        cfg,
      );

      await database
        .update(insightConnections)
        .set({
          strength: newStrength,
          stability: newStability,
          coAccessCount: current.coAccessCount + 1,
          lastStrengthenedAt: now,
          updatedAt: now,
        })
        .where(eq(insightConnections.id, current.id));

      return {
        success: true,
        connectionId: current.id,
        previousStrength,
        newStrength,
        coAccessCount: current.coAccessCount + 1,
      };
    }
  } catch (error) {
    console.error("[Hebbian] Failed to strengthen connection:", error);
    return {
      success: false,
      connectionId: "",
      previousStrength: 0,
      newStrength: 0,
      coAccessCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get all connections for an insight, sorted by strength
 *
 * @param insightId - The insight ID
 * @param userId - User ID
 * @param db - Database connection (optional)
 * @param options - Query options
 * @returns Connections sorted by strength (strongest first)
 */
export async function getInsightConnections(
  insightId: string,
  userId: string,
  dbInstance?: DrizzleDB,
  options: {
    limit?: number;
    minStrength?: number;
  } = {},
): Promise<InsightConnection[]> {
  const database = dbInstance ?? db;
  const { limit = 20, minStrength = 0 } = options;

  try {
    // Find connections where this insight is either A or B
    const results = await database
      .select()
      .from(insightConnections)
      .where(
        and(
          sql`(${insightConnections.insightIdA} = ${insightId} OR ${insightConnections.insightIdB} = ${insightId})`,
          eq(insightConnections.userId, userId),
          sql`${insightConnections.strength} >= ${minStrength}`,
        ),
      )
      .orderBy(desc(insightConnections.strength))
      .limit(limit);

    return results;
  } catch (error) {
    console.error("[Hebbian] Failed to getInsightConnections:", error);
    return [];
  }
}

/**
 * Get related insights (insights with strong connections to the given insight)
 *
 * This is useful for "users who viewed X also viewed Y" style recommendations.
 *
 * @param insightId - The insight ID
 * @param userId - User ID
 * @param db - Database connection (optional)
 * @param options - Query options
 * @returns Array of related insight IDs with their connection strengths
 */
export async function getRelatedInsights(
  insightId: string,
  userId: string,
  dbInstance?: DrizzleDB,
  options: {
    limit?: number;
    minStrength?: number;
  } = {},
): Promise<
  Array<{ insightId: string; strength: number; coAccessCount: number }>
> {
  const connections = await getInsightConnections(
    insightId,
    userId,
    dbInstance,
    options,
  );

  return connections.map((conn) => {
    // Return the OTHER insight's ID
    const relatedId =
      conn.insightIdA === insightId ? conn.insightIdB : conn.insightIdA;
    return {
      insightId: relatedId,
      strength: Number(conn.strength),
      coAccessCount: conn.coAccessCount,
    };
  });
}

/**
 * Apply decay to all connections for a user
 *
 * This should be called periodically (e.g., daily) to decay connection strengths
 * over time, implementing the "living" aspect of connections.
 *
 * @param userId - User ID
 * @param db - Database connection (optional)
 * @param config - Hebbian configuration (optional)
 * @returns Array of decay results
 */
export async function decayUserConnections(
  userId: string,
  dbInstance?: DrizzleDB,
  config: HebbianConfig = {},
): Promise<DecayResult[]> {
  const database = dbInstance ?? db;
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const now = new Date();

  try {
    // Get all connections for user that need decay
    const connections = await database
      .select()
      .from(insightConnections)
      .where(eq(insightConnections.userId, userId));

    const results: DecayResult[] = [];

    for (const conn of connections) {
      const lastStrengthened = conn.lastStrengthenedAt;
      if (!lastStrengthened) continue;

      const daysSince =
        (now.getTime() - lastStrengthened.getTime()) / (24 * 60 * 60 * 1000);

      // Skip if recently strengthened (no decay needed)
      if (daysSince < 0.5) continue; // Less than 12 hours

      const currentStrength = Number(conn.strength);

      // Skip if already at floor
      if (currentStrength <= cfg.strengthFloor) continue;

      const { newStrength, decayFactor } = applyDecay(
        currentStrength,
        Number(conn.stability),
        daysSince,
        cfg,
      );

      // Only update if strength actually changed meaningfully
      if (Math.abs(newStrength - currentStrength) > 0.0001) {
        await database
          .update(insightConnections)
          .set({
            strength: newStrength,
            updatedAt: now,
          })
          .where(eq(insightConnections.id, conn.id));

        results.push({
          connectionId: conn.id,
          previousStrength: currentStrength,
          newStrength,
          decayFactor,
        });
      }
    }

    return results;
  } catch (error) {
    console.error("[Hebbian] Failed to decayUserConnections:", error);
    return [];
  }
}

/**
 * Detect co-accessed insights from view history and strengthen their connections
 *
 * This analyzes recent view history to find pairs of insights that were
 * accessed within the co-access window (default 5 minutes) and strengthens
 * their connections.
 *
 * This should be called periodically or after a batch of views.
 *
 * @param userId - User ID
 * @param db - Database connection (optional)
 * @param config - Hebbian configuration (optional)
 * @returns Number of connections strengthened
 */
export async function processCoAccessFromViewHistory(
  userId: string,
  dbInstance?: DrizzleDB,
  config: HebbianConfig = {},
): Promise<number> {
  const database = dbInstance ?? db;
  const cfg = { ...DEFAULT_CONFIG, ...config };

  try {
    // Get recent views within the co-access window
    const recentViews = await database
      .select({
        insightId: insightViewHistory.insightId,
        viewedAt: insightViewHistory.viewedAt,
      })
      .from(insightViewHistory)
      .where(
        and(
          eq(insightViewHistory.userId, userId),
          // Only views from the last co-access window
          sql`${insightViewHistory.viewedAt} >= ${new Date(Date.now() - cfg.coAccessWindowMs * 2)}`,
        ),
      )
      .orderBy(asc(insightViewHistory.viewedAt));

    if (recentViews.length < 2) {
      return 0;
    }

    // Find pairs of insights accessed within the window
    const pairsToStrengthen = new Set<string>();
    const windowMs = cfg.coAccessWindowMs;

    for (let i = 0; i < recentViews.length; i++) {
      for (let j = i + 1; j < recentViews.length; j++) {
        const timeDiff =
          recentViews[j].viewedAt.getTime() - recentViews[i].viewedAt.getTime();
        if (timeDiff <= windowMs) {
          // This pair was co-accessed
          const [normA, normB] = normalizeConnectionKey(
            recentViews[i].insightId,
            recentViews[j].insightId,
          );
          pairsToStrengthen.add(`${normA}:${normB}`);
        } else {
          // Views are sorted by time, so further j will only be further in time
          break;
        }
      }
    }

    // Strengthen each pair
    let strengthened = 0;
    for (const pair of pairsToStrengthen) {
      const [insightIdA, insightIdB] = pair.split(":");
      const result = await strengthenConnection(
        insightIdA,
        insightIdB,
        userId,
        database,
        cfg,
      );
      if (result.success) {
        strengthened++;
      }
    }

    return strengthened;
  } catch (error) {
    console.error("[Hebbian] Failed to processCoAccessFromViewHistory:", error);
    return 0;
  }
}

/**
 * Remove weak connections below a threshold
 *
 * @param userId - User ID
 * @param minStrength - Minimum strength to keep
 * @param db - Database connection (optional)
 * @returns Number of connections removed
 */
export async function pruneWeakConnections(
  userId: string,
  minStrength = 0.01,
  dbInstance?: DrizzleDB,
): Promise<number> {
  const database = dbInstance ?? db;

  try {
    const result = await database
      .delete(insightConnections)
      .where(
        and(
          eq(insightConnections.userId, userId),
          sql`${insightConnections.strength} < ${minStrength}`,
        ),
      );

    return result.rowCount ?? 0;
  } catch (error) {
    console.error("[Hebbian] Failed to pruneWeakConnections:", error);
    return 0;
  }
}

/**
 * Get connection statistics for a user
 *
 * @param userId - User ID
 * @param db - Database connection (optional)
 * @returns Statistics about the user's insight connections
 */
export async function getConnectionStats(
  userId: string,
  dbInstance?: DrizzleDB,
): Promise<{
  totalConnections: number;
  avgStrength: number;
  strongConnections: number; // strength > 0.5
  weakConnections: number; // strength < 0.1
  recentlyStrengthened: number; // last 24 hours
}> {
  const database = dbInstance ?? db;
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  try {
    const connections = await database
      .select()
      .from(insightConnections)
      .where(eq(insightConnections.userId, userId));

    if (connections.length === 0) {
      return {
        totalConnections: 0,
        avgStrength: 0,
        strongConnections: 0,
        weakConnections: 0,
        recentlyStrengthened: 0,
      };
    }

    let totalStrength = 0;
    let strongCount = 0;
    let weakCount = 0;
    let recentCount = 0;

    for (const conn of connections) {
      const strength = Number(conn.strength);
      totalStrength += strength;

      if (strength > 0.5) strongCount++;
      if (strength < 0.1) weakCount++;
      if (conn.lastStrengthenedAt && conn.lastStrengthenedAt >= oneDayAgo) {
        recentCount++;
      }
    }

    return {
      totalConnections: connections.length,
      avgStrength: totalStrength / connections.length,
      strongConnections: strongCount,
      weakConnections: weakCount,
      recentlyStrengthened: recentCount,
    };
  } catch (error) {
    console.error("[Hebbian] Failed to getConnectionStats:", error);
    return {
      totalConnections: 0,
      avgStrength: 0,
      strongConnections: 0,
      weakConnections: 0,
      recentlyStrengthened: 0,
    };
  }
}
