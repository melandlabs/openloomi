import { auth } from "@/app/(auth)/auth";
import { getInsightUsageAnalytics } from "@/lib/insights/analytics";
import { AppError } from "@alloomi/shared/errors";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

function parseLimit(value: string | null) {
  if (!value) return DEFAULT_LIMIT;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.min(parsed, MAX_LIMIT);
}

function parseBoolean(value: string | null) {
  return value === "true" || value === "1";
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:insight").toResponse();
  }

  const { searchParams } = request.nextUrl;
  const limit = parseLimit(searchParams.get("limit"));
  const includeArchived = parseBoolean(searchParams.get("includeArchived"));

  try {
    const analytics = await getInsightUsageAnalytics({
      userId: session.user.id,
      limit,
      includeArchived,
    });

    return Response.json(analytics, { status: 200 });
  } catch (error) {
    console.error("[InsightAnalytics] Failed to load analytics:", error);
    return new AppError("bad_request:database", String(error)).toResponse();
  }
}
