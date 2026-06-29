import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import { getUserInsightSettings } from "@/lib/db/queries";
import { NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";

const memoriesSchema = z.object({
  screenshotPath: z.string(),
  description: z.string(),
  keyContent: z.array(z.string()).optional().default([]),
  // Full OCR transcription of the screenshot. May be large (chats, docs,
  // long code panes). We do not cap it here on purpose — the conversational
  // recall layer needs every word the user saw.
  extractedText: z.string().optional().default(""),
  capturedAt: z.string(),
});

/**
 * POST /api/chronicle/memories
 * Save a screen memory to insights
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:api").toResponse();
  }

  try {
    const body = await request.json();
    const {
      screenshotPath,
      description,
      keyContent,
      extractedText,
      capturedAt,
    } = memoriesSchema.parse(body);

    const userId = session.user.id;

    const settings = await getUserInsightSettings(userId);
    if (!settings?.chronicleEnabled) {
      return new AppError(
        "forbidden:api",
        "Chronicle feature is not enabled",
      ).toResponse();
    }

    const botId = await getUserPrimaryBotId(userId);
    if (!botId) {
      return new AppError(
        "not_found:api",
        "No bot found for user",
      ).toResponse();
    }

    const insightId = uuidv4();
    const title = generateTitle(description, keyContent);

    const memoryInsight = await createMemoryInsight({
      id: insightId,
      botId,
      userId,
      title,
      description: buildMemoryDescription(
        description,
        keyContent,
        extractedText,
        screenshotPath,
      ),
      screenshotPath,
      capturedAt: new Date(capturedAt),
      keyContent,
      extractedText,
    });

    return NextResponse.json({
      success: true,
      memoryId: insightId,
      insightId: memoryInsight.id,
      title,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("[Chronicle] Invalid memory payload:", error.issues);
      return new AppError(
        "bad_request:api",
        "Invalid memory payload",
      ).toResponse();
    }

    console.error("[Chronicle] Failed to save memory:", error);
    return new AppError(
      "bad_request:api",
      "Failed to save memory",
    ).toResponse();
  }
}

/**
 * GET /api/chronicle/memories
 * Query screen memories
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:api").toResponse();
  }

  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query");
    const limit = Number.parseInt(searchParams.get("limit") || "10", 10);
    const offset = Number.parseInt(searchParams.get("offset") || "0", 10);

    // Query memories from database
    const memories = await queryMemories({
      userId: session.user.id,
      query,
      limit: Math.min(limit, 50),
      offset,
    });

    return NextResponse.json({
      memories,
      hasMore: memories.length === limit,
    });
  } catch (error) {
    console.error("[Chronicle] Failed to query memories:", error);
    return new AppError(
      "bad_request:api",
      "Failed to query memories",
    ).toResponse();
  }
}

// ============== Helper Functions ==============

async function getUserPrimaryBotId(userId: string): Promise<string | null> {
  try {
    const { db } = await import("@/lib/db");
    const { eq } = await import("drizzle-orm");
    const { bot } = await import("@/lib/db/schema");

    // Prefer any existing bot the user already owns (e.g. one created by
    // an integration callback, RSS, or a previous Chronicle write). This
    // preserves bot ownership history — we don't want to silently swap
    // a user's real Telegram bot for a "default" placeholder.
    const bots = await db
      .select({ id: bot.id })
      .from(bot)
      .where(eq(bot.userId, userId))
      .limit(1);

    if (bots[0]?.id) return bots[0].id;

    // No bots at all — lazily create a "default" placeholder so
    // system-generated rows (Chronicle memories, etc.) can satisfy the
    // botId FK. This is what was previously causing 404 on first capture
    // for users who hadn't set up any integration yet.
    try {
      const { ensureUserDefaultBot } = await import("@/lib/db/queries");
      return await ensureUserDefaultBot(userId);
    } catch (createError) {
      console.error(
        "[Chronicle] Failed to auto-create default bot:",
        createError,
      );
      return null;
    }
  } catch (error) {
    console.error("[Chronicle] Failed to get primary bot:", error);
    return null;
  }
}

interface MemoryInsightParams {
  id: string;
  botId: string;
  userId: string;
  title: string;
  description: string;
  screenshotPath: string;
  capturedAt: Date;
  keyContent: string[];
  extractedText: string;
}

async function createMemoryInsight(
  params: MemoryInsightParams,
): Promise<{ id: string }> {
  const { db } = await import("@/lib/db");
  const { insight } = await import("@/lib/db/schema");

  // We persist the full OCR transcript in both `details` and `learning` so
  // either path (timeline rendering or RAG/conversation recall) can recover
  // the verbatim screen text without re-running the LLM.
  const detailsJson = JSON.stringify([
    {
      kind: "chronicle_screen",
      screenshotPath: params.screenshotPath,
      keyContent: params.keyContent,
      extractedText: params.extractedText,
      capturedAt: params.capturedAt.toISOString(),
    },
  ]);

  await db.insert(insight).values({
    id: params.id,
    botId: params.botId,
    taskLabel: "chronicle_screen",
    title: params.title,
    description: params.description,
    importance: "medium",
    urgency: "low",
    time: params.capturedAt,
    details: detailsJson,
    groups: "[]",
    people: "[]",
    categories: JSON.stringify(["chronicle", "screen-memory"]),
    learning: JSON.stringify({
      screenshotPath: params.screenshotPath,
      keyContent: params.keyContent,
      extractedText: params.extractedText,
      description: params.description,
    }),
    isArchived: false,
    isFavorited: false,
    isUnreplied: false,
    timelineVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return { id: params.id };
}

interface QueryMemoriesParams {
  userId: string;
  query?: string | null;
  limit: number;
  offset: number;
}

interface MemoryRecord {
  id: string;
  title: string;
  description: string;
  screenshotPath: string | null;
  capturedAt: string;
  keyContent: string[];
  extractedText: string;
}

interface InsightRow {
  id: string;
  title: string;
  description: string;
  time: Date | null;
  learning: string | null;
}

async function queryMemories(
  params: QueryMemoriesParams,
): Promise<MemoryRecord[]> {
  const { db } = await import("@/lib/db");
  const { desc } = await import("drizzle-orm");
  const { insight } = await import("@/lib/db/schema");

  const results = (await db
    .select({
      id: insight.id,
      title: insight.title,
      description: insight.description,
      time: insight.time,
      learning: insight.learning,
    })
    .from(insight)
    .orderBy(desc(insight.createdAt))
    .limit(params.limit)
    .offset(params.offset)) as InsightRow[];

  const memories: MemoryRecord[] = results
    .filter((r) => r.learning?.includes("screenshotPath"))
    .map((r) => {
      let extra: {
        screenshotPath?: string;
        keyContent?: string[];
        extractedText?: string;
      } = {};

      try {
        if (r.learning) {
          extra = JSON.parse(r.learning);
        }
      } catch {
        // ignore malformed json
      }

      return {
        id: r.id,
        title: r.title,
        description: r.description,
        screenshotPath: extra.screenshotPath || null,
        capturedAt: r.time?.toISOString() || new Date().toISOString(),
        keyContent: extra.keyContent || [],
        extractedText: extra.extractedText || "",
      };
    });

  if (params.query) {
    const lowerQuery = params.query.toLowerCase();
    return memories.filter(
      (m) =>
        m.title.toLowerCase().includes(lowerQuery) ||
        m.description.toLowerCase().includes(lowerQuery) ||
        m.extractedText.toLowerCase().includes(lowerQuery) ||
        m.keyContent.some((k) => k.toLowerCase().includes(lowerQuery)),
    );
  }

  return memories;
}

function generateTitle(description: string, keyContent: string[]): string {
  // Generate a short, descriptive title from the analysis
  if (keyContent.length > 0) {
    const firstKey = keyContent[0];
    if (firstKey.length <= 50) {
      return `Screen: ${firstKey}`;
    }
    return `Screen: ${firstKey.slice(0, 47)}...`;
  }

  // Fallback: use first 50 chars of description
  const descPart = description.slice(0, 47);
  return `Screen Memory: ${descPart}${description.length > 47 ? "..." : ""}`;
}

function buildMemoryDescription(
  description: string,
  keyContent: string[],
  extractedText: string,
  screenshotPath: string,
): string {
  const lines = [
    "**Screen Capture**",
    "",
    `**Description:** ${description}`,
    "",
  ];

  if (keyContent.length > 0) {
    lines.push("**Key Content:**");
    for (const item of keyContent) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  // Full transcript is what enables natural-language recall later.
  // Wrap in a fenced block so renderers don't try to interpret embedded
  // markdown that came from the user's screen.
  if (extractedText.trim().length > 0) {
    lines.push("**Transcript:**");
    lines.push("```text");
    lines.push(extractedText);
    lines.push("```");
    lines.push("");
  }

  lines.push(`*Captured at ${new Date().toLocaleString()}*`);
  lines.push(`*Screenshot: ${screenshotPath.split("/").pop()}*`);

  return lines.join("\n");
}
