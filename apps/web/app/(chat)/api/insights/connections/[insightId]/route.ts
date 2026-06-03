/**
 * Living Connections API
 *
 * Tracks relationships between insights that strengthen when accessed together.
 */

import { auth } from "@/app/(auth)/auth";
import {
  getRelatedInsights,
  getInsightConnections,
  getConnectionStats,
} from "@/lib/insights/hebbian";
import { AppError } from "@openloomi/shared/errors";
import type { NextRequest } from "next/server";

// GET /api/insights/connections/[insightId] - Get related insights via Living Connections
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ insightId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:insight").toResponse();
  }

  const { insightId } = await params;
  const { searchParams } = request.nextUrl;

  const limit = Number.parseInt(searchParams.get("limit") || "20");
  const minStrength = Number.parseFloat(searchParams.get("minStrength") || "0");
  const statsOnly = searchParams.get("stats") === "true";

  try {
    const userId = session.user.id;

    if (statsOnly) {
      // Return connection stats for the user
      const stats = await getConnectionStats(userId);
      return Response.json({
        insightId,
        stats,
      });
    }

    // Get connections for this insight
    const connections = await getInsightConnections(
      insightId,
      userId,
      undefined,
      {
        limit,
        minStrength,
      },
    );

    // Get related insights (the other side of each connection)
    const relatedInsights = await getRelatedInsights(
      insightId,
      userId,
      undefined,
      {
        limit,
        minStrength,
      },
    );

    return Response.json({
      insightId,
      connections,
      relatedInsights,
      total: relatedInsights.length,
    });
  } catch (error) {
    console.error("[Insights/Connections] Get failed:", error);
    return new AppError("bad_request:database", String(error)).toResponse();
  }
}
