import { auth } from "@/app/(auth)/auth";
import { refreshActiveBotInsight } from "@/lib/insights";
import { isTauriMode } from "@/lib/env/constants";
import {
  getInsightByIdForUser,
  getStoredInsightsByBotIdAndGroups,
  db,
  normalizeInsight,
} from "@/lib/db/queries";
import { insight } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { AppError } from "@openloomi/shared/errors";

/**
 * Refresh a single Insight
 * Only refresh the group that the Insight belongs to, not all groups of the entire bot
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:insight").toResponse();
  }

  const { id } = await params;

  // Parse request body to get cloudAuthToken
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    // Ignore JSON parsing errors, continue processing
  }

  try {
    const record = await getInsightByIdForUser({
      userId: session.user.id,
      insightId: id,
    });

    if (!record) {
      return new AppError(
        "not_found:insight",
        "Insight not found",
      ).toResponse();
    }

    const { insight: insightRecord, bot } = record;

    // Get groups that the insight belongs to
    const groups = insightRecord.groups ?? [];
    if (groups.length === 0) {
      // For insights without groups, refresh the entire bot
      await refreshActiveBotInsight(bot.id, {
        user: {
          id: session.user.id,
          type: session.user.type,
          slackToken: session.user.slackToken,
          name: session.user.name,
          email: session.user.email,
          token: body.cloudAuthToken, // Pass cloud auth token for AI Provider authentication
        },
        byGroup: false, // Refresh entire bot
      });

      // Get refreshed insights, find the corresponding latest insight
      const refreshedInsights = await db
        .select()
        .from(insight)
        .where(eq(insight.botId, bot.id))
        .orderBy(desc(insight.time));

      // Deserialize JSON fields (SQLite mode)
      const normalizedInsights = isTauriMode()
        ? refreshedInsights.map((i: any) => normalizeInsight(i))
        : refreshedInsights;

      const updatedInsight = normalizedInsights.find(
        (i: any) => i.dedupeKey === insightRecord.dedupeKey,
      );
      // If no matching new insight is found (dedupeKey may have changed), return the original insight
      // Because refresh itself has already been executed successfully
      const resultInsight = updatedInsight ?? insightRecord;

      return Response.json(
        {
          insight: resultInsight,
        },
        { status: 200 },
      );
    }

    // Use refreshActiveBotInsight's byGroup feature to refresh only specific groups
    await refreshActiveBotInsight(bot.id, {
      user: {
        id: session.user.id,
        type: session.user.type,
        slackToken: session.user.slackToken,
        name: session.user.name,
        email: session.user.email,
        token: body.cloudAuthToken, // Pass cloud auth token for AI Provider authentication
      },
      byGroup: true,
      groupConcurrency: 1, // Only process one group
      groups, // Pass groups parameter to limit refreshing to these groups only
    });

    // Get refreshed insights, find the corresponding group insight
    const { insights: refreshedInsights } =
      await getStoredInsightsByBotIdAndGroups({
        id: bot.id,
        groups,
        days: 1, // Only get the last 1 day
      });

    // Find matching insight (may have multiple, take the first one)
    // If no new insight is found (dedupeKey may have changed), return the original insight
    const updatedInsight = refreshedInsights?.[0];
    const resultInsight = updatedInsight ?? insightRecord;

    return Response.json(
      {
        insight: resultInsight,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return error.toResponse();
    }
    console.error("[Insight Refresh] Unexpected failure:", error);
    return new AppError(
      "bad_request:insight",
      "Failed to process refresh request.",
    ).toResponse();
  }
}
