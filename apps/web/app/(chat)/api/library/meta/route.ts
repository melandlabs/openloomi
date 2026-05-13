/**
 * Library metadata API: Return conversation titles and associated events by chatIds (for library page grouping and conversation name display)
 */

import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import {
  getChatById,
  getChatInsightIds,
  getInsightByIdForUser,
} from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";

export type LibraryMetaChat = {
  title: string;
  insights: Array<{ id: string; title: string }>;
};

export type LibraryMetaResponse = {
  chats: Record<string, LibraryMetaChat>;
};

/**
 * GET /api/library/meta?chatIds=id1,id2,...
 * Return title and associated insights (id + title) for each chatId
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:chat").toResponse();
  }

  const { searchParams } = new URL(req.url);
  const chatIdsParam = searchParams.get("chatIds");
  if (!chatIdsParam) {
    return NextResponse.json({ error: "chatIds is required" }, { status: 400 });
  }
  const chatIds = chatIdsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (chatIds.length === 0) {
    return NextResponse.json({ chats: {} } satisfies LibraryMetaResponse);
  }
  // Avoid too many requests at once
  const limited = chatIds.slice(0, 100);

  const chats: Record<string, LibraryMetaChat> = {};

  for (const chatId of limited) {
    const chat = await getChatById({ id: chatId });
    if (!chat) {
      chats[chatId] = { title: "", insights: [] };
      continue;
    }
    if (chat.userId !== session.user.id) {
      continue; // Do not return others' conversations
    }
    const title = chat.title ?? "";
    const insightIds = await getChatInsightIds({ chatId });
    const insights: Array<{ id: string; title: string }> = [];
    for (const insightId of insightIds) {
      const result = await getInsightByIdForUser({
        userId: session.user.id,
        insightId,
      });
      if (result?.insight?.title) {
        insights.push({ id: insightId, title: result.insight.title });
      }
    }
    chats[chatId] = { title, insights };
  }

  return NextResponse.json({ chats } satisfies LibraryMetaResponse);
}
