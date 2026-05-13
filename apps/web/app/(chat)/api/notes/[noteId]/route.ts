import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import { db } from "@/lib/db/queries";
import { insightNotes } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * GET /api/notes/[noteId]
 * Get single note details
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ noteId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:note").toResponse();
  }

  try {
    const { noteId } = await params;

    if (!noteId) {
      return new AppError(
        "bad_request:note",
        "Note ID is required",
      ).toResponse();
    }

    // db is imported from @/lib/db/queries with lazy initialization

    // Get note (ensure it's current user's note)    const result = await db
    const result = await db
      .select({
        id: insightNotes.id,
        insightId: insightNotes.insightId,
        content: insightNotes.content,
        source: insightNotes.source,
        sourceMessageId: insightNotes.sourceMessageId,
        createdAt: insightNotes.createdAt,
        updatedAt: insightNotes.updatedAt,
      })
      .from(insightNotes)
      .where(
        and(
          eq(insightNotes.id, noteId),
          eq(insightNotes.userId, session.user.id),
        ),
      )
      .limit(1);

    if (result.length === 0) {
      return new AppError("not_found:note", "Note not found").toResponse();
    }

    return Response.json({ note: result[0] }, { status: 200 });
  } catch (error) {
    console.error("[Note API] Failed to get note:", error);
    return new AppError(
      "bad_request:database",
      `Failed to get note. ${error instanceof Error ? error.message : String(error)}`,
    ).toResponse();
  }
}

/**
 * PUT /api/notes/[noteId]
 * Update note content
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ noteId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:note").toResponse();
  }

  try {
    const { noteId } = await params;

    if (!noteId) {
      return new AppError(
        "bad_request:note",
        "Note ID is required",
      ).toResponse();
    }

    const body = await request.json();
    const { content } = body as { content?: string };

    if (!content || content.trim().length === 0) {
      return new AppError(
        "bad_request:note",
        "Note content is required",
      ).toResponse();
    }

    // db is imported from @/lib/db/queries with lazy initialization

    // Verify note exists and belongs to current user
    const existingNote = await db
      .select({ userId: insightNotes.userId })
      .from(insightNotes)
      .where(eq(insightNotes.id, noteId))
      .limit(1);

    if (existingNote.length === 0) {
      return new AppError("not_found:note", "Note not found").toResponse();
    }

    if (existingNote[0].userId !== session.user.id) {
      return new AppError("forbidden:note", "Access denied").toResponse();
    }

    // Update note
    const now = new Date();
    const result = await db
      .update(insightNotes)
      .set({
        content: content.trim(),
        updatedAt: now,
      })
      .where(eq(insightNotes.id, noteId))
      .returning({ id: insightNotes.id });

    if (result.length === 0) {
      throw new Error("Failed to update note");
    }

    // Get updated note
    const updatedNotes = await db
      .select()
      .from(insightNotes)
      .where(eq(insightNotes.id, noteId))
      .limit(1);

    const updatedNote = updatedNotes[0];

    return Response.json({ note: updatedNote }, { status: 200 });
  } catch (error) {
    console.error("[Note API] Failed to update note:", error);
    return new AppError(
      "bad_request:database",
      `Failed to update note. ${error instanceof Error ? error.message : String(error)}`,
    ).toResponse();
  }
}

/**
 * DELETE /api/notes/[noteId]
 * Delete note
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ noteId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:note").toResponse();
  }

  try {
    const { noteId } = await params;

    if (!noteId) {
      return new AppError(
        "bad_request:note",
        "Note ID is required",
      ).toResponse();
    }

    // db is imported from @/lib/db/queries with lazy initialization

    // Verify note exists and belongs to current user
    const existingNote = await db
      .select({ userId: insightNotes.userId })
      .from(insightNotes)
      .where(eq(insightNotes.id, noteId))
      .limit(1);

    if (existingNote.length === 0) {
      return new AppError("not_found:note", "Note not found").toResponse();
    }

    if (existingNote[0].userId !== session.user.id) {
      return new AppError("forbidden:note", "Access denied").toResponse();
    }

    // Delete note
    await db.delete(insightNotes).where(eq(insightNotes.id, noteId));

    return Response.json(
      { message: "Note deleted successfully" },
      { status: 200 },
    );
  } catch (error) {
    console.error("[Note API] Failed to delete note:", error);
    return new AppError(
      "bad_request:database",
      `Failed to delete note. ${error instanceof Error ? error.message : String(error)}`,
    ).toResponse();
  }
}
