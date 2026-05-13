import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import { computeInsightPayload } from "@/lib/insights/service";
import type { NextRequest } from "next/server";

/**
 * Independent Events panel Insights API
 * Used for independent data query in right sidebar action items, not associated with other panels
 *
 * Differences from main /api/insights:
 * 1. Does not automatically apply insight filters (filters handled in component)
 * 2. Specifically designed for events-panel, provides independent data flow
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
  // Support specifying history days via query parameter, 0 means no limit (return all data)
  const daysParam = searchParams.get("days");
  const customDays = daysParam ? Number.parseInt(daysParam) : null;

  if (startingAfter && endingBefore) {
    console.error(
      "[Events] Only one of starting_after or ending_before can be provided.",
    );
    return new AppError(
      "bad_request:api",
      "Only one of starting_after or ending_before can be provided.",
    ).toResponse();
  }

  try {
    const userId = session.user.id;

    // If days parameter is specified, use custom value; otherwise use default value for user type
    const historyDays = customDays !== null ? customDays : 1;

    const data = await computeInsightPayload(userId, {
      historyDays,
      limit,
      startingAfter,
      endingBefore,
    });

    // Note: Do not apply insight filters here
    // Filters should be handled in component based on tab requirements
    return Response.json(
      {
        items: data.items,
        hasMore: data.hasMore,
        percent: data.percent,
        sessions: data.sessions,
      },
      {
        status: 200,
      },
    );
  } catch (error) {
    console.error("[Events] Get list failed:", error);
    return new AppError("bad_request:database", String(error)).toResponse();
  }
}
