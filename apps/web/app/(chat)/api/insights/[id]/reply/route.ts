import { auth } from "@/app/(auth)/auth";
import { db } from "@/lib/db";
import { insight } from "@/lib/db/schema";
import { getInsightByIdForUser } from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";
import type { DetailData, TimelineData } from "@/lib/ai/subagents/insights";
import { z } from "zod";
import { eq } from "drizzle-orm";

const UpdateReplySchema = z.object({
  detail: z.object({
    time: z.number().optional().nullable(),
    person: z.string().optional(),
    platform: z.string().optional().nullable(),
    channel: z.string().optional(),
    content: z.string().optional(),
  }),
  timeline: z.object({
    time: z.number().optional().nullable(),
    emoji: z.string().optional(),
    summary: z.string().optional(),
    label: z.string().optional(),
  }),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:insight").toResponse();
  }

  try {
    const { id } = await params;

    if (!id) {
      return new AppError(
        "bad_request:insight",
        "Insight ID is required",
      ).toResponse();
    }

    const body = await request.json();

    // Validate request body
    const validationResult = UpdateReplySchema.safeParse(body);
    if (!validationResult.success) {
      return new AppError(
        "bad_request:insight",
        "Invalid request body",
      ).toResponse();
    }

    const { detail, timeline } = validationResult.data;

    // Get current insight data
    const result = await getInsightByIdForUser({
      userId: session.user.id,
      insightId: id,
    });

    if (!result) {
      return new AppError(
        "bad_request:insight",
        "Insight not found",
      ).toResponse();
    }

    const { insight: currentInsight } = result;

    // Add new detail and timeline to existing arrays
    // In SQLite mode, details/timeline may be JSON strings, need to handle
    let existingDetails: DetailData[] = [];
    let existingTimeline: TimelineData[] = [];

    try {
      if (typeof currentInsight.details === "string") {
        existingDetails = JSON.parse(currentInsight.details);
      } else if (Array.isArray(currentInsight.details)) {
        existingDetails = currentInsight.details as DetailData[];
      }
    } catch {
      existingDetails = [];
    }

    try {
      if (typeof currentInsight.timeline === "string") {
        existingTimeline = JSON.parse(currentInsight.timeline);
      } else if (Array.isArray(currentInsight.timeline)) {
        existingTimeline = currentInsight.timeline as TimelineData[];
      }
    } catch {
      existingTimeline = [];
    }

    const updatedDetails = [...existingDetails, detail];
    const updatedTimeline = [...existingTimeline, timeline];

    // Get timestamp of new detail for updating insight.time field
    // This ensures new sent messages appear at the front of message source
    // SQLite's time field is in timestamp mode, needs Date object
    const rawTime = detail?.time;
    let newDetailTime: Date;
    if (rawTime && typeof rawTime === "object" && "getTime" in rawTime) {
      newDetailTime = rawTime as Date;
    } else if (typeof rawTime === "string") {
      newDetailTime = new Date(rawTime);
    } else if (typeof rawTime === "number") {
      newDetailTime = new Date(rawTime);
    } else {
      newDetailTime = new Date();
    }

    // Update database - update time field and other fields simultaneously
    // In SQLite mode, details/timeline need to be stored as JSON strings
    await db
      .update(insight)
      .set({
        details: JSON.stringify(updatedDetails),
        timeline: JSON.stringify(updatedTimeline),
        time: newDetailTime, // Update insight's main timestamp
        updatedAt: new Date(),
      })
      .where(eq(insight.id, id));

    console.log("[Insights] Reply added to insight:", {
      insightId: id,
      detail,
      timeline,
      totalDetails: updatedDetails.length,
      totalTimeline: updatedTimeline.length,
    });

    return Response.json(
      {
        message: "Reply added to insight successfully",
        detail,
        timeline,
        updatedDetails,
        updatedTimeline,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[Insights] Update reply failed:", error);

    if (error instanceof AppError) {
      return error.toResponse();
    }

    return new AppError("bad_request:database", String(error)).toResponse();
  }
}
