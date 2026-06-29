import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import { getUserInsightSettings } from "@/lib/db/queries";
import { NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";

const meetingMemorySchema = z.object({
  audioPath: z.string(),
  title: z.string().optional().default(""),
  description: z.string().optional().default(""),
  transcript: z.string().optional().default(""),
  summary: z.string().optional().default(""),
  keyPoints: z.array(z.string()).optional().default([]),
  actionItems: z.array(z.string()).optional().default([]),
  participants: z.array(z.string()).optional().default([]),
  meetingStartTime: z.string().optional().optional(),
  meetingEndTime: z.string().optional().optional(),
  durationSeconds: z.number().optional().default(0),
});

/**
 * POST /api/chronicle/meeting-memories
 * Save a meeting memory to insights
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:api").toResponse();
  }

  try {
    const body = await request.json();
    const {
      audioPath,
      title,
      description,
      transcript,
      summary,
      keyPoints,
      actionItems,
      participants,
      meetingStartTime,
      meetingEndTime,
      durationSeconds,
    } = meetingMemorySchema.parse(body);

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
    const generatedTitle = generateMeetingTitle(
      title,
      description,
      meetingStartTime,
    );

    const memoryInsight = await createMeetingMemoryInsight({
      id: insightId,
      botId,
      userId,
      title: generatedTitle,
      description: buildMeetingDescription(
        description,
        summary,
        keyPoints,
        actionItems,
        transcript,
      ),
      audioPath,
      meetingStartTime: meetingStartTime
        ? new Date(meetingStartTime)
        : new Date(),
      meetingEndTime: meetingEndTime ? new Date(meetingEndTime) : new Date(),
      durationSeconds,
      transcript,
      summary,
      keyPoints,
      actionItems,
      participants,
    });

    return NextResponse.json({
      success: true,
      memoryId: insightId,
      insightId: memoryInsight.id,
      title: generatedTitle,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error(
        "[Chronicle Meeting] Invalid memory payload:",
        error.issues,
      );
      return new AppError(
        "bad_request:api",
        "Invalid memory payload",
      ).toResponse();
    }

    console.error("[Chronicle Meeting] Failed to save meeting memory:", error);
    return new AppError(
      "bad_request:api",
      "Failed to save meeting memory",
    ).toResponse();
  }
}

/**
 * GET /api/chronicle/meeting-memories
 * Query meeting memories
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

    const memories = await queryMeetingMemories({
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
    console.error(
      "[Chronicle Meeting] Failed to query meeting memories:",
      error,
    );
    return new AppError(
      "bad_request:api",
      "Failed to query meeting memories",
    ).toResponse();
  }
}

// ============== Helper Functions ==============

async function getUserPrimaryBotId(userId: string): Promise<string | null> {
  try {
    const { db } = await import("@/lib/db");
    const { eq } = await import("drizzle-orm");
    const { bot } = await import("@/lib/db/schema");

    const bots = await db
      .select({ id: bot.id })
      .from(bot)
      .where(eq(bot.userId, userId))
      .limit(1);

    return bots[0]?.id || null;
  } catch (error) {
    console.error("[Chronicle Meeting] Failed to get primary bot:", error);
    return null;
  }
}

interface MeetingMemoryInsightParams {
  id: string;
  botId: string;
  userId: string;
  title: string;
  description: string;
  audioPath: string;
  meetingStartTime: Date;
  meetingEndTime: Date;
  durationSeconds: number;
  transcript: string;
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  participants: string[];
}

async function createMeetingMemoryInsight(
  params: MeetingMemoryInsightParams,
): Promise<{ id: string }> {
  const { db } = await import("@/lib/db");
  const { insight } = await import("@/lib/db/schema");

  const detailsJson = JSON.stringify([
    {
      kind: "chronicle_meeting",
      audioPath: params.audioPath,
      transcript: params.transcript,
      summary: params.summary,
      keyPoints: params.keyPoints,
      actionItems: params.actionItems,
      participants: params.participants,
      meetingStartTime: params.meetingStartTime.toISOString(),
      meetingEndTime: params.meetingEndTime.toISOString(),
      durationSeconds: params.durationSeconds,
    },
  ]);

  await db.insert(insight).values({
    id: params.id,
    botId: params.botId,
    taskLabel: "chronicle_meeting",
    title: params.title,
    description: params.description,
    importance: "medium",
    urgency: "low",
    time: params.meetingStartTime,
    details: detailsJson,
    groups: "[]",
    people: JSON.stringify(params.participants),
    categories: JSON.stringify(["chronicle", "meeting"]),
    learning: JSON.stringify({
      audioPath: params.audioPath,
      transcript: params.transcript,
      summary: params.summary,
      keyPoints: params.keyPoints,
      actionItems: params.actionItems,
      participants: params.participants,
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

interface QueryMeetingMemoriesParams {
  userId: string;
  query?: string | null;
  limit: number;
  offset: number;
}

interface MeetingMemoryRecord {
  id: string;
  title: string;
  description: string;
  audioPath: string | null;
  meetingStartTime: string;
  transcript: string;
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  participants: string[];
}

interface InsightRow {
  id: string;
  title: string;
  description: string;
  time: Date | null;
  learning: string | null;
  people: string | null;
}

async function queryMeetingMemories(
  params: QueryMeetingMemoriesParams,
): Promise<MeetingMemoryRecord[]> {
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
      people: insight.people,
    })
    .from(insight)
    .orderBy(desc(insight.createdAt))
    .limit(params.limit)
    .offset(params.offset)) as InsightRow[];

  const memories: MeetingMemoryRecord[] = results
    .filter((r) => r.learning?.includes("audioPath"))
    .map((r) => {
      let extra: {
        audioPath?: string;
        transcript?: string;
        summary?: string;
        keyPoints?: string[];
        actionItems?: string[];
        participants?: string[];
      } = {};

      try {
        if (r.learning) {
          extra = JSON.parse(r.learning);
        }
      } catch {
        // ignore malformed json
      }

      let participants: string[] = [];
      try {
        if (r.people) {
          participants = JSON.parse(r.people);
        }
      } catch {
        // ignore
      }

      return {
        id: r.id,
        title: r.title,
        description: r.description,
        audioPath: extra.audioPath || null,
        meetingStartTime: r.time?.toISOString() || new Date().toISOString(),
        transcript: extra.transcript || "",
        summary: extra.summary || "",
        keyPoints: extra.keyPoints || [],
        actionItems: extra.actionItems || [],
        participants: extra.participants || participants,
      };
    });

  if (params.query) {
    const lowerQuery = params.query.toLowerCase();
    return memories.filter(
      (m) =>
        m.title.toLowerCase().includes(lowerQuery) ||
        m.description.toLowerCase().includes(lowerQuery) ||
        m.transcript.toLowerCase().includes(lowerQuery) ||
        m.summary.toLowerCase().includes(lowerQuery) ||
        m.keyPoints.some((k) => k.toLowerCase().includes(lowerQuery)),
    );
  }

  return memories;
}

function generateMeetingTitle(
  title?: string,
  description?: string,
  meetingStartTime?: string,
): string {
  if (title?.trim()) {
    return title.trim();
  }

  if (description?.trim()) {
    const firstLine = description.split("\n")[0].trim();
    if (firstLine.length <= 60) {
      return `Meeting: ${firstLine}`;
    }
    return `Meeting: ${firstLine.slice(0, 57)}...`;
  }

  const date = meetingStartTime
    ? new Date(meetingStartTime).toLocaleDateString()
    : new Date().toLocaleDateString();
  return `Meeting on ${date}`;
}

function buildMeetingDescription(
  description: string,
  summary: string,
  keyPoints: string[],
  actionItems: string[],
  transcript: string,
): string {
  const lines: string[] = ["**Meeting Summary**", ""];

  if (description.trim()) {
    lines.push(description);
    lines.push("");
  }

  if (summary.trim()) {
    lines.push(`**Summary:** ${summary}`);
    lines.push("");
  }

  if (keyPoints.length > 0) {
    lines.push("**Key Points:**");
    for (const point of keyPoints) {
      lines.push(`- ${point}`);
    }
    lines.push("");
  }

  if (actionItems.length > 0) {
    lines.push("**Action Items:**");
    for (const item of actionItems) {
      lines.push(`- [ ] ${item}`);
    }
    lines.push("");
  }

  if (transcript.trim().length > 0) {
    lines.push("**Transcript:**");
    lines.push("```text");
    lines.push(transcript.slice(0, 10000)); // Limit transcript in description
    if (transcript.length > 10000) {
      lines.push("... (truncated)");
    }
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}
