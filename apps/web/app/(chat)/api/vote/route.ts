import { auth } from "@/app/(auth)/auth";
import { getChatById, getVotesByChatId, voteMessage } from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");

  if (!chatId) {
    console.error("[Vote] Parameter chatId is required.");
    return new AppError(
      "bad_request:api",
      "Parameter chatId is required.",
    ).toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new AppError("unauthorized:vote").toResponse();
  }

  const chat = await getChatById({ id: chatId });

  if (!chat) {
    return new AppError("not_found:chat").toResponse();
  }

  if (chat.userId !== session.user.id) {
    return new AppError("forbidden:vote").toResponse();
  }

  const votes = await getVotesByChatId({ id: chatId });

  return Response.json(votes, { status: 200 });
}

export async function PATCH(request: Request) {
  const {
    chatId,
    messageId,
    type,
  }: { chatId: string; messageId: string; type: "up" | "down" } =
    await request.json();

  if (!chatId || !messageId || !type) {
    console.error(
      "[Vote] Parameters chatId, messageId, and type are required.",
    );
    return new AppError(
      "bad_request:api",
      "Parameters chatId, messageId, and type are required.",
    ).toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new AppError("unauthorized:vote").toResponse();
  }

  const chat = await getChatById({ id: chatId });

  if (!chat) {
    return new AppError("not_found:vote").toResponse();
  }

  if (chat.userId !== session.user.id) {
    return new AppError("forbidden:vote").toResponse();
  }

  await voteMessage({
    chatId,
    messageId,
    type: type,
  });

  return new Response("Message voted", { status: 200 });
}
