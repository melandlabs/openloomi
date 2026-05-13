/**
 * GET /api/mention/tasks - List action items, for @ reference selection (default 5 items)
 */

import { auth } from "@/app/(auth)/auth";
import { listTasksFromInsights } from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";
import type { NextRequest } from "next/server";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 50;

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:insight").toResponse();
  }
  const raw = request.nextUrl.searchParams.get("limit");
  const limit = Math.min(
    Math.max(
      Number.parseInt(raw || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT,
      1,
    ),
    MAX_LIMIT,
  );
  try {
    const tasks = await listTasksFromInsights(session.user.id, limit);
    return Response.json({ tasks }, { status: 200 });
  } catch (error) {
    console.error("[Mention Tasks] GET failed:", error);
    return new AppError(
      "bad_request:api",
      error instanceof Error ? error.message : String(error),
    ).toResponse();
  }
}
