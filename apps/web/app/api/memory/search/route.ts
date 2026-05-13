import { auth } from "@/app/(auth)/auth";
import { extractCloudAuthToken } from "@/lib/ai/request-context";
import {
  clampUnifiedMemorySearchLimit,
  clampUnifiedMemorySearchThreshold,
  normalizeUnifiedMemorySearchSources,
  searchUnifiedMemory,
} from "@/lib/memory/unified-search";
import { AppError } from "@alloomi/shared";
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
    return new AppError("unauthorized:api").toResponse();
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

    const result = await searchUnifiedMemory({
      userId: session.user.id,
      query,
      sources: normalizeUnifiedMemorySearchSources(body.sources),
      limit: clampUnifiedMemorySearchLimit(body.limit),
      threshold: clampUnifiedMemorySearchThreshold(body.threshold),
      botIds: parseStringArray(body.botIds),
      documentIds: parseStringArray(body.documentIds),
      includeArchivedInsights: body.includeArchivedInsights === true,
      authToken: extractCloudAuthToken(request),
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    console.error("[MemorySearch] Unified search failed:", error);
    const message = error instanceof Error ? error.message : String(error);
    return new AppError(
      message.includes("Embedding provider")
        ? "bad_request:api"
        : "bad_request:database",
      message,
    ).toResponse();
  }
}
