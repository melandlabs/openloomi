import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import { computeInsightPayload } from "@/lib/insights/service";
import type { NextRequest } from "next/server";

/**
 * Independent Favorites Insights API
 * Used for independent data query in favorites panel, not associated with main interface insights
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:insight").toResponse();
  }

  const { searchParams } = request.nextUrl;

  const limit: number = Number.parseInt(searchParams.get("limit") || "50");
  const startingAfter: string | null = searchParams.get("starting_after");
  const endingBefore: string | null = searchParams.get("ending_before");
  // Favorites data returns data for all time ranges by default
  const daysParam = searchParams.get("days");
  const customDays = daysParam ? Number.parseInt(daysParam) : null;

  if (startingAfter && endingBefore) {
    console.error(
      "[Favorites] Only one of starting_after or ending_before can be provided.",
    );
    return new AppError(
      "bad_request:api",
      "Only one of starting_after or ending_before can be provided.",
    ).toResponse();
  }

  try {
    const userId = session.user.id;

    // Favorites data queries all time by default (0 means no limit)
    const historyDays = customDays !== null ? customDays : 0; // Favorites data has no time range limit

    const data = await computeInsightPayload(userId, {
      historyDays,
      limit,
      startingAfter,
      endingBefore,
    });

    // Only return favorited insights
    const favoritedItems = data.items.filter(
      (insight) => insight.isFavorited === true,
    );

    return Response.json(
      {
        items: favoritedItems,
        hasMore: data.hasMore,
        percent: data.percent,
        sessions: data.sessions,
      },
      {
        status: 200,
      },
    );
  } catch (error) {
    console.error("[Favorites] Get list failed:", error);
    return new AppError("bad_request:database", String(error)).toResponse();
  }
}
