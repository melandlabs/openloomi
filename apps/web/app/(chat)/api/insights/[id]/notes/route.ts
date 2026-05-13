import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import { db } from "@/lib/db/queries";
import { insight, insightNotes } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import type { InsertInsightNote } from "@/lib/db/schema";

/**
 * GET /api/insights/[id]/notes
 * Get all notes for specified insight
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:note").toResponse();
  }

  try {
    const { id: insightId } = await params;

    if (!insightId) {
      return new AppError(
        "bad_request:note",
        "Insight ID is required",
      ).toResponse();
    }

    // db is imported from @/lib/db/queries with lazy initialization

    // Verify insight exists and belongs to user's bot
    const insightResult = await db
      .select({ botId: insight.botId })
      .from(insight)
      .where(eq(insight.id, insightId))
      .limit(1);

    if (insightResult.length === 0) {
      return new AppError(
        "not_found:insight",
        "Insight not found",
      ).toResponse();
    }

    // Get all notes for this insight (sorted by creation time in descending order)
    const notes = await db
      .select({
        id: insightNotes.id,
        content: insightNotes.content,
        source: insightNotes.source,
        sourceMessageId: insightNotes.sourceMessageId,
        createdAt: insightNotes.createdAt,
        updatedAt: insightNotes.updatedAt,
      })
      .from(insightNotes)
      .where(eq(insightNotes.insightId, insightId))
      .orderBy(desc(insightNotes.createdAt));

    return Response.json({ notes }, { status: 200 });
  } catch (error) {
    console.error("[Notes API] Failed to get notes:", error);
    return new AppError(
      "bad_request:database",
      `Failed to get notes. ${error instanceof Error ? error.message : String(error)}`,
    ).toResponse();
  }
}

/**
 * POST /api/insights/[id]/notes
 * Create new note for specified insight
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:note").toResponse();
  }

  try {
    const { id: insightId } = await params;

    if (!insightId) {
      return new AppError(
        "bad_request:note",
        "Insight ID is required",
      ).toResponse();
    }

    const body = await request.json();
    const {
      content,
      source = "manual",
      sourceMessageId,
    } = body as {
      content?: string;
      source?: "manual" | "ai_conversation";
      sourceMessageId?: string;
    };

    if (!content || content.trim().length === 0) {
      return new AppError(
        "bad_request:note",
        "Note content is required",
      ).toResponse();
    }

    // db is imported from @/lib/db/queries with lazy initialization

    // Verify insight exists and belongs to user's bot
    const insightResult = await db
      .select({ botId: insight.botId })
      .from(insight)
      .where(eq(insight.id, insightId))
      .limit(1);

    if (insightResult.length === 0) {
      return new AppError(
        "not_found:insight",
        "Insight not found",
      ).toResponse();
    }

    // Create new note
    const now = new Date();
    const newNote: InsertInsightNote = {
      insightId,
      userId: session.user.id,
      content: content.trim(),
      source,
      sourceMessageId,
      createdAt: now,
      updatedAt: now,
    };

    const result = await db
      .insert(insightNotes)
      .values(newNote)
      .returning({ id: insightNotes.id });

    const createdNoteId = result[0]?.id;

    if (!createdNoteId) {
      throw new Error("Failed to create note");
    }

    // Get created note
    const createdNotes = await db
      .select()
      .from(insightNotes)
      .where(eq(insightNotes.id, createdNoteId))
      .limit(1);

    const createdNote = createdNotes[0];

    return Response.json({ note: createdNote }, { status: 201 });
  } catch (error) {
    console.error("[Notes API] Failed to create note:", error);
    return new AppError(
      "bad_request:database",
      `Failed to create note. ${error instanceof Error ? error.message : String(error)}`,
    ).toResponse();
  }
}
