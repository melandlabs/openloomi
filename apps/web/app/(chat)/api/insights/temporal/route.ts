/**
 * Temporal Query API (Time-Travel)
 *
 * Enables querying insights as-of a specific point in time.
 */

import { auth } from "@/app/(auth)/auth";
import {
  getInsightsAsOf,
  getCurrentInsights,
  getInsightsOverlappingInterval,
} from "@/lib/insights/temporal";
import { AppError } from "@openloomi/shared/errors";
import type { NextRequest } from "next/server";

// GET /api/insights/temporal?asOf=2026-01-01&limit=50
// GET /api/insights/temporal?current=true&limit=50
// GET /api/insights/temporal?start=2026-01-01&end=2026-06-01&limit=50
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:insight").toResponse();
  }

  const { searchParams } = request.nextUrl;
  const userId = session.user.id;

  const limit = Number.parseInt(searchParams.get("limit") || "100");
  const asOfParam = searchParams.get("asOf");
  const current = searchParams.get("current") === "true";
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");

  try {
    let insights: Awaited<ReturnType<typeof getCurrentInsights>>;
    let queryType: string;

    if (current) {
      // Get currently valid insights (no validTo or validTo > now)
      insights = await getCurrentInsights(userId, undefined, { limit });
      queryType = "current";
    } else if (asOfParam) {
      // Time-travel query: get insights valid at a specific point in time
      const asOfDate = new Date(asOfParam);
      if (Number.isNaN(asOfDate.getTime())) {
        return Response.json(
          {
            error:
              "Invalid asOf date format. Use ISO 8601 format (e.g., 2026-01-01)",
          },
          { status: 400 },
        );
      }
      insights = await getInsightsAsOf(userId, asOfDate, undefined, { limit });
      queryType = `asOf:${asOfParam}`;
    } else if (startParam && endParam) {
      // Get insights overlapping a time interval
      const startDate = new Date(startParam);
      const endDate = new Date(endParam);
      if (
        Number.isNaN(startDate.getTime()) ||
        Number.isNaN(endDate.getTime())
      ) {
        return Response.json(
          { error: "Invalid date format. Use ISO 8601 format" },
          { status: 400 },
        );
      }
      insights = await getInsightsOverlappingInterval(
        userId,
        startDate,
        endDate,
        undefined,
        { limit },
      );
      queryType = `interval:${startParam}..${endParam}`;
    } else {
      return Response.json(
        {
          error:
            "Missing query parameter. Use one of: asOf, current, or start+end",
          examples: {
            timeTravel: "/api/insights/temporal?asOf=2026-01-01",
            current: "/api/insights/temporal?current=true",
            interval: "/api/insights/temporal?start=2026-01-01&end=2026-06-01",
          },
        },
        { status: 400 },
      );
    }

    return Response.json({
      queryType,
      total: insights.length,
      insights,
    });
  } catch (error) {
    console.error("[Insights/Temporal] Query failed:", error);
    return new AppError("bad_request:database", String(error)).toResponse();
  }
}
