import { auth } from "@/app/(auth)/auth";
import { extractCloudAuthToken } from "@/lib/ai/request-context";
import { searchInsightsSemantically } from "@/lib/insights/search";
import { AppError } from "@openloomi/shared/errors";
import type { NextRequest } from "next/server";

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:insight").toResponse();
  }

  try {
    const body = await request.json();
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) {
      return new AppError(
        "bad_request:api",
        "Query is required and must be a non-empty string.",
      ).toResponse();
    }

    const limit =
      typeof body.limit === "number" ? body.limit : Number(body.limit ?? 10);
    const threshold =
      typeof body.threshold === "number"
        ? body.threshold
        : Number(body.threshold ?? 0.7);

    const results = await searchInsightsSemantically({
      userId: session.user.id,
      query,
      limit,
      threshold,
      botIds: parseStringArray(body.botIds),
      includeArchived: body.includeArchived === true,
      authToken: extractCloudAuthToken(request),
    });

    return Response.json(
      {
        query,
        results,
        count: results.length,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[InsightsSearch] Search failed:", error);
    const message = error instanceof Error ? error.message : String(error);
    return new AppError(
      message.includes("Embedding provider")
        ? "bad_request:api"
        : "bad_request:database",
      message,
    ).toResponse();
  }
}
