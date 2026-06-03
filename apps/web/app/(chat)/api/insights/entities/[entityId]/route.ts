import { auth } from "@/app/(auth)/auth";
import { entities, insightEntities, insight } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { AppError } from "@openloomi/shared/errors";
import type { NextRequest } from "next/server";
import type { Insight } from "@/lib/db/schema";

// GET /api/insights/entities/[entityId] - Get single entity
// GET /api/insights/entities/[entityId]/insights - Get insights linked to this entity
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:insight").toResponse();
  }

  const { entityId } = await params;
  const { searchParams } = request.nextUrl;
  const userId = session.user.id;

  const getInsights = searchParams.get("insights") === "true";

  try {
    // Get the entity
    const [entity] = await db
      .select()
      .from(entities)
      .where(and(eq(entities.id, entityId), eq(entities.userId, userId)))
      .limit(1);

    if (!entity) {
      return Response.json({ error: "Entity not found" }, { status: 404 });
    }

    if (getInsights) {
      // Get insights linked to this entity
      const linkedInsights = await db
        .select({
          insightId: insightEntities.insightId,
          role: insightEntities.role,
          confidence: insightEntities.confidence,
          textSpan: insightEntities.textSpan,
          linkedAt: insightEntities.createdAt,
        })
        .from(insightEntities)
        .where(eq(insightEntities.entityId, entityId))
        .orderBy(desc(insightEntities.createdAt));

      // Fetch full insight data for each linked insight
      const insightIds = linkedInsights.map(
        (li: { insightId: string }) => li.insightId,
      );

      let insightsData: Insight[] = [];
      if (insightIds.length > 0) {
        insightsData = await db
          .select()
          .from(insight)
          .where(inArray(insight.id, insightIds));
      }

      // Merge the data
      const insightsWithRole = linkedInsights
        .map(
          (li: {
            insightId: string;
            role: string;
            confidence: number;
            textSpan: string | null;
            linkedAt: Date;
          }) => {
            const fullInsight = insightsData.find(
              (i: Insight) => i.id === li.insightId,
            );
            return {
              ...li,
              insight: fullInsight,
            };
          },
        )
        .filter(
          (li: { insight: Insight | undefined }) => li.insight !== undefined,
        );

      return Response.json({
        entity,
        insights: insightsWithRole,
        totalInsights: insightsWithRole.length,
      });
    }

    return Response.json({ entity });
  } catch (error) {
    console.error("[Insights/Entities] Get failed:", error);
    return new AppError("bad_request:database", String(error)).toResponse();
  }
}
