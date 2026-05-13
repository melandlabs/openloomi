import { auth } from "@/app/(auth)/auth";
import { getChatById, getMessagesByChatId } from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";
import { convertToUIMessages } from "@/lib/utils";
import type { ChatMessage } from "@openloomi/shared";

/**
 * Get message list for specified chat
 */
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: chatId } = await params;

  if (!chatId) {
    return new AppError("bad_request:api", "Chat id is missing").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new AppError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id: chatId });

  if (!chat) {
    return new AppError("not_found:chat").toResponse();
  }

  if (chat?.userId && chat.userId !== session.user.id) {
    return new AppError("forbidden:chat").toResponse();
  }

  const messages = await getMessagesByChatId({ id: chatId });
  const uiMessages: ChatMessage[] = convertToUIMessages(messages);

  return Response.json({ messages: uiMessages });
}
