import { auth } from "@/app/(auth)/auth";
import { entities } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { AppError } from "@openloomi/shared/errors";
import type { NextRequest } from "next/server";

// GET /api/insights/entities?type=person&limit=50
// GET /api/insights/entities/[entityId]
// GET /api/insights/entities/[entityId]/insights - Get insights linked to this entity
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:insight").toResponse();
  }

  const { searchParams } = request.nextUrl;
  const userId = session.user.id;

  const limit = Number.parseInt(searchParams.get("limit") || "50");
  const type = searchParams.get("type"); // "person" | "group" | "concept" | "project" | "company"
  const search = searchParams.get("search"); // Search by name

  try {
    // Build conditions
    const conditions = [eq(entities.userId, userId)];

    if (type) {
      conditions.push(eq(entities.entityType, type));
    }

    if (search) {
      // Case-insensitive search on canonical name
      conditions.push(
        sql`LOWER(${entities.canonicalName}) LIKE LOWER(${`%${search}%`})`,
      );
    }

    const results = await db
      .select()
      .from(entities)
      .where(and(...conditions))
      .orderBy(desc(entities.lastSeenAt))
      .limit(limit);

    return Response.json({
      total: results.length,
      entities: results,
    });
  } catch (error) {
    console.error("[Insights/Entities] List failed:", error);
    return new AppError("bad_request:database", String(error)).toResponse();
  }
}
