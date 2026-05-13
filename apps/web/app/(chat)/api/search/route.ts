import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import type { NextRequest } from "next/server";
import { searchEvents, searchChats, searchFiles } from "@/lib/db/queries";
import type { SearchResultItem } from "@/components/global-search-dialog";

/**
 * Global search API
 * Support search by type: events, conversation history, files (actions/tasks/People/sources removed)
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:insight").toResponse();
  }

  const { searchParams } = request.nextUrl;
  const query = searchParams.get("q") || "";
  const typesParam = searchParams.get("types");
  const limit = Number.parseInt(searchParams.get("limit") || "20", 10);

  if (!query.trim()) {
    return Response.json({
      events: [],
      chats: [],
      files: [],
    });
  }

  try {
    const userId = session.user.id;
    const types = typesParam
      ? typesParam.split(",").filter((t) => t.trim())
      : ["events", "chats", "files"];

    const results: {
      events: SearchResultItem[];
      chats: SearchResultItem[];
      files: SearchResultItem[];
    } = {
      events: [],
      chats: [],
      files: [],
    };

    // Parallel search all types
    const searchPromises: Promise<void>[] = [];

    if (types.includes("events")) {
      searchPromises.push(
        searchEvents(userId, query, limit).then((events) => {
          results.events = events.map((event) => ({
            id: event.id,
            type: "events" as const,
            title: event.title,
            subtitle: event.description || undefined,
            timestamp: event.time.toISOString(),
            platform: event.platform || undefined,
            extra: { insight: event },
          }));
        }),
      );
    }

    if (types.includes("chats")) {
      searchPromises.push(
        searchChats(userId, query, limit).then((chats) => {
          results.chats = chats.map((chat) => ({
            id: chat.id,
            type: "chats" as const,
            title: chat.title || "Untitled conversation",
            subtitle: chat.latestMessageContent || undefined,
            timestamp: chat.latestMessageTime?.toISOString(),
          }));
        }),
      );
    }

    if (types.includes("files")) {
      searchPromises.push(
        searchFiles(userId, query, limit).then((files) => {
          results.files = files.map((file) => ({
            id: file.id,
            type: "files" as const,
            title: file.name,
            timestamp: file.createdAt.toISOString(),
          }));
        }),
      );
    }

    await Promise.all(searchPromises);

    return Response.json(results);
  } catch (error) {
    console.error("[Search API] Failed to search:", error);
    return new AppError(
      "bad_request:api",
      `Search failed. ${error instanceof Error ? error.message : String(error)}`,
    ).toResponse();
  }
}
