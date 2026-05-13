/**
 * Library · All Notes API: Return notes added by current user in all events (insights)
 * Used for Library page My notes Tab
 * POST: Create note under "Common" insight (belongs to public)
 */

import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { db } from "@/lib/db/queries";
import { insight, insightNotes, bot } from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { AppError } from "@openloomi/shared/errors";
import { getBotsByUserId, createBot } from "@/lib/db/queries";
import type { InsertInsightNote } from "@/lib/db/schema";

export type LibraryNoteItem = {
  id: string;
  content: string;
  source: "manual" | "ai_conversation";
  createdAt: string;
  updatedAt: string;
  insightId: string;
  insightTitle: string;
};

export type LibraryNotesResponse = {
  notes: LibraryNoteItem[];
};

/**
 * GET /api/library/notes
 * Return all insight notes accessible to current user (sorted by creation time in descending order)
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:note").toResponse();
  }

  try {
    // db is imported from @/lib/db/queries with lazy initialization

    const rows = await db
      .select({
        id: insightNotes.id,
        content: insightNotes.content,
        source: insightNotes.source,
        createdAt: insightNotes.createdAt,
        updatedAt: insightNotes.updatedAt,
        insightId: insightNotes.insightId,
        insightTitle: insight.title,
      })
      .from(insightNotes)
      .innerJoin(insight, eq(insightNotes.insightId, insight.id))
      .innerJoin(bot, eq(insight.botId, bot.id))
      .where(eq(bot.userId, session.user.id))
      .orderBy(desc(insightNotes.createdAt));

    type NoteRow = (typeof rows)[number];
    const notes: LibraryNoteItem[] = rows.map((r: NoteRow) => ({
      id: String(r.id),
      content: r.content,
      source: (r.source as "manual" | "ai_conversation") ?? "manual",
      createdAt:
        r.createdAt instanceof Date
          ? r.createdAt.toISOString()
          : String(r.createdAt),
      updatedAt:
        r.updatedAt instanceof Date
          ? r.updatedAt.toISOString()
          : String(r.updatedAt),
      insightId: String(r.insightId),
      insightTitle: r.insightTitle ?? "",
    }));

    return NextResponse.json({ notes } satisfies LibraryNotesResponse);
  } catch (error) {
    console.error("[Library notes API] Failed to get notes:", error);
    return new AppError(
      "bad_request:database",
      `Failed to get notes. ${error instanceof Error ? error.message : String(error)}`,
    ).toResponse();
  }
}

const COMMON_INSIGHT_DEDUPE_KEY = "library-common";

/**
 * Get or create "Common" insight, return its id
 */
async function getOrCreateCommonInsight(userId: string): Promise<string> {
  let botId: string;
  const { bots } = await getBotsByUserId({
    id: userId,
    limit: 1,
    startingAfter: null,
    endingBefore: null,
    onlyEnable: false,
  });
  if (bots.length === 0) {
    botId = await createBot({
      userId,
      name: "My Bot",
      description: "Default bot for manual insights",
      adapter: "manual",
      adapterConfig: {},
      enable: true,
    });
  } else {
    botId = bots[0].id;
  }

  const existing = await db
    .select({ id: insight.id })
    .from(insight)
    .where(
      and(
        eq(insight.botId, botId),
        eq(insight.dedupeKey, COMMON_INSIGHT_DEDUPE_KEY),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return String(existing[0].id);
  }

  const now = new Date();
  const [inserted] = await db
    .insert(insight)
    .values({
      botId,
      dedupeKey: COMMON_INSIGHT_DEDUPE_KEY,
      taskLabel: "insight",
      title: "Common",
      description: "Common notes",
      importance: "medium",
      urgency: "medium",
      time: now,
      actionRequired: false,
      clarifyNeeded: false,
    })
    .returning({ id: insight.id });

  if (!inserted?.id) throw new Error("Failed to create common insight");
  return String(inserted.id);
}

/**
 * POST /api/library/notes
 * Create a note under "Common" insight (belongs to public)
 * Body: { content: string }
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:note").toResponse();
  }

  try {
    const body = await request.json();
    const { content } = body as { content?: string };
    if (
      !content ||
      typeof content !== "string" ||
      content.trim().length === 0
    ) {
      return new AppError(
        "bad_request:note",
        "Note content is required",
      ).toResponse();
    }

    const insightId = await getOrCreateCommonInsight(session.user.id);
    // db is imported from @/lib/db/queries with lazy initialization
    const now = new Date();
    const newNote: InsertInsightNote = {
      insightId,
      userId: session.user.id,
      content: content.trim(),
      source: "manual",
      createdAt: now,
      updatedAt: now,
    };

    const [created] = await db.insert(insightNotes).values(newNote).returning({
      id: insightNotes.id,
      content: insightNotes.content,
      source: insightNotes.source,
      createdAt: insightNotes.createdAt,
      updatedAt: insightNotes.updatedAt,
      insightId: insightNotes.insightId,
    });

    if (!created) {
      throw new Error("Failed to create note");
    }

    return NextResponse.json(
      {
        note: {
          id: String(created.id),
          content: created.content,
          source: created.source ?? "manual",
          createdAt:
            created.createdAt instanceof Date
              ? created.createdAt.toISOString()
              : String(created.createdAt),
          updatedAt:
            created.updatedAt instanceof Date
              ? created.updatedAt.toISOString()
              : String(created.updatedAt),
          insightId: String(created.insightId),
          insightTitle: "Common",
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[Library notes API] POST failed:", error);
    return new AppError(
      "bad_request:database",
      `Failed to create note. ${error instanceof Error ? error.message : String(error)}`,
    ).toResponse();
  }
}
