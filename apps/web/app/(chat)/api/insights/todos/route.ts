import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import {
  computeInsightPayload,
  ensureUserInsightSettings,
} from "@/lib/insights/service";
import type { NextRequest } from "next/server";
import type { Insight } from "@/lib/db/schema";

/**
 * Independent Todo Items API
 * Used for independent data query in todo items panel, returns insights containing tasks
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
  // Support specifying history days via query parameter, null uses default value
  const daysParam = searchParams.get("days");
  const customDays = daysParam ? Number.parseInt(daysParam) : null;

  if (startingAfter && endingBefore) {
    console.error(
      "[Todos] Only one of starting_after or ending_before can be provided.",
    );
    return new AppError(
      "bad_request:api",
      "Only one of starting_after or ending_before can be provided.",
    ).toResponse();
  }

  try {
    const userId = session.user.id;

    await ensureUserInsightSettings(userId);

    // Use default history days for user type, or custom value
    const historyDays = customDays !== null ? customDays : 1;

    const data = await computeInsightPayload(userId, {
      historyDays,
      limit,
      startingAfter,
      endingBefore,
    });

    // Filter insights containing tasks
    // Task sources: myTasks, waitingForMe, waitingForOthers, isUnreplied
    const todoItems = data.items.filter((insight: Insight) => {
      const hasMyTasks =
        Array.isArray(insight.myTasks) && insight.myTasks.length > 0;
      const hasWaitingForMe =
        Array.isArray(insight.waitingForMe) && insight.waitingForMe.length > 0;
      const hasWaitingForOthers =
        Array.isArray(insight.waitingForOthers) &&
        insight.waitingForOthers.length > 0;
      const hasUnreplied = insight.isUnreplied === true;

      return (
        hasMyTasks || hasWaitingForMe || hasWaitingForOthers || hasUnreplied
      );
    });

    return Response.json(
      {
        items: todoItems,
        hasMore: data.hasMore,
        percent: data.percent,
        sessions: data.sessions,
      },
      {
        status: 200,
      },
    );
  } catch (error) {
    console.error("[Todos] Get list failed:", error);
    return new AppError("bad_request:database", String(error)).toResponse();
  }
}
