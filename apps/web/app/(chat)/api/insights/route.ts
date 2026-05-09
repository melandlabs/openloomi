import { auth } from "@/app/(auth)/auth";
import { db } from "@/lib/db";
import {
  insightWeights,
  insightBriefCategories,
  insight,
} from "@/lib/db/schema";
import {
  listInsightFilters,
  updateUserInsightSettings,
  normalizeInsight,
  insertInsightRecords,
  getBotsByUserId,
  createBot,
} from "@/lib/db/queries";
import { AppError } from "@alloomi/shared/errors";
import {
  computeInsightPayload,
  deriveActivityTier,
  ensureUserInsightSettings,
} from "@/lib/insights/service";
import { filterInsights } from "@/lib/insights/filter-utils";
import { getUserCategoryOverrides } from "@/lib/insights/brief-category-override";
import type { NextRequest } from "next/server";
import { eq, inArray, and } from "drizzle-orm";

const MS_IN_MINUTE = 60 * 1000;
const ACTIVITY_UPDATE_COOLDOWN_MS = 5 * MS_IN_MINUTE;

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:insight").toResponse();
  }

  const { searchParams } = request.nextUrl;

  const limit: number = Number.parseInt(searchParams.get("limit") || "50");
  const startingAfter: string | null = searchParams.get("starting_after");
  const endingBefore: string | null = searchParams.get("ending_before");
  // Support specifying history days via query parameter, 0 means unlimited (return all data)
  const daysParam = searchParams.get("days");
  const customDays = daysParam ? Number.parseInt(daysParam) : null;
  // Whether to include other data required by Brief Panel (weights, categories, etc.)
  const includeBriefData = searchParams.get("includeBriefData") === "true";

  if (startingAfter && endingBefore) {
    console.error(
      "[History] Only one of starting_after or ending_before can be provided.",
    );
    return new AppError(
      "bad_request:api",
      "Only one of starting_after or ending_before can be provided.",
    ).toResponse();
  }

  try {
    const userId = session.user.id;
    let settings = await ensureUserInsightSettings(userId);
    // If days parameter is specified, use custom value; otherwise use default value for user type
    const historyDays = customDays !== null ? customDays : 1;
    const nowRef = new Date();
    const now = nowRef;
    const derivedTier = deriveActivityTier(now, settings.lastActiveAt);
    const lastActiveMs = settings.lastActiveAt?.getTime() ?? 0;
    const cooldownElapsed =
      !settings.lastActiveAt ||
      now.getTime() - lastActiveMs >= ACTIVITY_UPDATE_COOLDOWN_MS;

    if (cooldownElapsed) {
      // Only update if user exists in database (settings have a valid id)
      // If settings are defaults for non-existent user, skip the update
      try {
        await updateUserInsightSettings(userId, {
          lastActiveAt: now,
          activityTier: derivedTier,
        });
        settings = {
          ...settings,
          lastActiveAt: now,
          activityTier: derivedTier,
        };
      } catch (error: any) {
        // If foreign key constraint fails, user doesn't exist - just update the in-memory settings
        if (
          error?.code === "SQLITE_CONSTRAINT_FOREIGNKEY" ||
          (typeof error?.message === "string" &&
            error.message.includes("FOREIGN KEY")) ||
          (typeof error?.cause === "string" &&
            error.cause.includes("FOREIGN KEY"))
        ) {
          console.warn(
            `User ${userId} not found in database, using in-memory settings`,
          );
          settings = {
            ...settings,
            lastActiveAt: now,
            activityTier: derivedTier,
          };
        } else {
          throw error;
        }
      }
    }

    const data = await computeInsightPayload(userId, {
      historyDays,
      limit,
      startingAfter,
      endingBefore,
    });

    const filters = await listInsightFilters({
      userId: session.user.id,
    });
    let filteredItems = data.items;
    for (const filter of filters) {
      filteredItems = filterInsights(filteredItems, filter.definition);
    }

    // Recalculate hasMore after filtering: should return false if no data after filtering
    const hasMore = !!(filteredItems.length > 0 && data.hasMore);

    // If request includes Brief Panel data, return together
    let briefData: {
      weights: Record<string, number>;
      lastViewedAt: Record<string, string>;
      overrides: Record<string, string>;
      unpinnedIds: string[];
      pinnedInsights: any[];
    } | null = null;

    if (includeBriefData) {
      const insightIds = filteredItems.map((item) => item.id);

      // Fetch weights and category data in parallel
      const [weightsResult, overridesResult, allBriefCategories] =
        await Promise.all([
          // Get weights data
          db
            .select({
              insightId: insightWeights.insightId,
              multiplier: insightWeights.customWeightMultiplier,
              lastViewedAt: insightWeights.lastViewedAt,
            })
            .from(insightWeights)
            .where(
              and(
                eq(insightWeights.userId, userId),
                inArray(insightWeights.insightId, insightIds),
              ),
            ),
          // Use existing getUserCategoryOverrides function to get category overrides
          getUserCategoryOverrides(userId, filteredItems),
          // Get all pinned insights (not limited by time)
          db
            .select()
            .from(insightBriefCategories)
            .where(eq(insightBriefCategories.userId, userId)),
        ]);

      // Build weights Map
      const weights: Record<string, number> = {};
      const lastViewedAt: Record<string, string> = {};
      weightsResult.forEach((w: any) => {
        weights[w.insightId] = w.multiplier ?? 1.0;
        if (w.lastViewedAt) {
          lastViewedAt[w.insightId] = w.lastViewedAt.toISOString();
        }
      });
      // Fill default weights
      insightIds.forEach((id) => {
        if (!(id in weights)) {
          weights[id] = 1.0;
        }
      });

      // Use result returned by getUserCategoryOverrides
      const overrides = Object.fromEntries(overridesResult.overrides);
      const unpinnedIds = Array.from(overridesResult.unpinnedIds);

      // Get pinned insights in current page
      const currentPinnedInsightIds = insightIds.filter(
        (id) =>
          overridesResult.overrides.has(id) &&
          !overridesResult.unpinnedIds.has(id),
      );

      // Get all pinned insights (not limited by time)
      const allPinnedInsightIds = allBriefCategories
        .filter((bc: any) => bc.source !== "unpinned")
        .map((bc: any) => bc.insightId);

      // Merge all pinned insight IDs that need to be fetched
      const allPinnedIdsSet = new Set([
        ...currentPinnedInsightIds,
        ...allPinnedInsightIds,
      ]);
      const allPinnedIds = Array.from(allPinnedIdsSet);

      let pinnedInsights: any[] = [];
      if (allPinnedIds.length > 0) {
        const pinnedItems = await db
          .select()
          .from(insight)
          .where(inArray(insight.id, allPinnedIds));

        // Build category map
        const categoryMap = new Map<string, string>();
        allBriefCategories.forEach((bc: any) => {
          if (bc.source !== "unpinned") {
            categoryMap.set(bc.insightId, bc.category);
          }
        });

        pinnedInsights = pinnedItems.map((insightItem: any) => {
          // First normalize data (deserialize JSON fields)
          const normalized = normalizeInsight(insightItem);
          const category = categoryMap.get(normalized.id) || "monitor";
          return {
            ...normalized,
            briefCategory: category,
          };
        });
      }

      briefData = {
        weights,
        lastViewedAt,
        overrides,
        unpinnedIds,
        pinnedInsights,
      };
    }

    const response: any = {
      items: filteredItems,
      hasMore,
      percent: data.percent,
      sessions: data.sessions,
      rawMessagesIncluded: false,
    };

    // If request includes Brief data, add to response
    if (briefData) {
      response.briefData = briefData;
    }

    return Response.json(response, {
      status: 200,
    });
  } catch (error) {
    console.error("[Insights] Get list failed:", error);
    return new AppError("bad_request:database", String(error)).toResponse();
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:insight").toResponse();
  }

  try {
    const body = await request.json();
    const {
      title,
      description,
      importance,
      urgency,
      platform,
      groups,
      categories,
      people,
      details,
      timeline,
      myTasks,
    } = body;

    // Validate required fields
    if (!title || typeof title !== "string") {
      return Response.json({ error: "title is required" }, { status: 400 });
    }
    if (!description || typeof description !== "string") {
      return Response.json(
        { error: "description is required" },
        { status: 400 },
      );
    }

    // Get or create manual bot
    const bots = await getBotsByUserId({
      id: session.user.id,
      limit: null,
      startingAfter: null,
      endingBefore: null,
      onlyEnable: false,
    });

    const manualBot = bots.bots.find((bot) => bot.adapter === "manual");

    let botId: string;
    if (manualBot) {
      botId = manualBot.id;
    } else {
      botId = await createBot({
        name: "My Bot",
        userId: session.user.id,
        description: "Default bot for manual insights",
        adapter: "manual",
        adapterConfig: {},
        enable: true,
      });
    }

    // Normalize importance and urgency
    const normalizedImportance =
      importance === "Important"
        ? "Important"
        : importance === "Not Important"
          ? "Not Important"
          : "General";
    const normalizedUrgency =
      urgency === "As soon as possible"
        ? "ASAP"
        : urgency === "Within 24 hours"
          ? "24h"
          : urgency === "Not urgent"
            ? "Not urgent"
            : "General";

    // Normalize tasks
    const normalizedTasks = myTasks?.map((t: any) => ({
      text: typeof t === "string" ? t : t.text,
      completed: typeof t === "object" ? (t.completed ?? false) : false,
      deadline: typeof t === "object" && t.deadline ? t.deadline : undefined,
      owner: typeof t === "object" && t.owner ? t.owner : undefined,
    }));

    // Create the insight payload
    const payload = {
      dedupeKey: null,
      taskLabel: normalizedTasks?.length > 0 ? "task" : "insight",
      title,
      description,
      importance: normalizedImportance,
      urgency: normalizedUrgency,
      platform: platform || "manual",
      account: null,
      groups: groups || [],
      categories: categories || [],
      people: people || [],
      time: new Date(),
      details: details
        ? details.map((d: any) => ({
            ...d,
            time: d.time ?? Date.now(),
          }))
        : null,
      timeline: timeline
        ? timeline.map((t: any) => ({ ...t, time: Date.now() }))
        : null,
      insights: null,
      trendDirection: null,
      trendConfidence: null,
      sentiment: null,
      sentimentConfidence: null,
      intent: null,
      trend: null,
      issueStatus: null,
      communityTrend: null,
      duplicateFlag: null,
      impactLevel: null,
      resolutionHint: null,
      topKeywords: [],
      topEntities: [],
      topVoices: null,
      sources: null,
      sourceConcentration: null,
      buyerSignals: [],
      stakeholders: null,
      contractStatus: null,
      signalType: null,
      confidence: null,
      scope: null,
      myTasks: normalizedTasks || null,
      waitingForMe: null,
      waitingForOthers: null,
      clarifyNeeded: null,
      learning: null,
      priority: null,
      experimentIdeas: null,
      executiveSummary: null,
      actionRequired: null,
      actionRequiredDetails: null,
      isUnreplied: null,
      followUps: null,
      nextActions: null,
    };

    const insightIds = await insertInsightRecords([{ ...payload, botId }]);

    return Response.json(
      { id: insightIds[0], message: "Insight created successfully" },
      { status: 201 },
    );
  } catch (error) {
    console.error("[Insights] Create failed:", error);
    return new AppError("bad_request:database", String(error)).toResponse();
  }
}
