import { auth } from "@/app/(auth)/auth";
import type { NextRequest } from "next/server";
import { getChatsByUserId } from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";
import type { ChatHistoryResponse } from "@/lib/ai/chat/api";

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = request.nextUrl;

  const limit: number = Number.parseInt(searchParams.get("limit") || "20");
  const startingAfter: string | null = searchParams.get("starting_after");
  const endingBefore: string | null = searchParams.get("ending_before");

  if (startingAfter && endingBefore) {
    console.error(
      "[History] Only one of starting_after or ending_before can be provided.",
    );
    return new AppError(
      "bad_request:api",
      "Only one of starting_after or ending_before can be provided.",
    ).toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new AppError("unauthorized:chat").toResponse();
  }

  const chats: ChatHistoryResponse = await getChatsByUserId({
    id: session.user.id,
    limit,
    startingAfter,
    endingBefore,
  });

  return Response.json(chats);
}
