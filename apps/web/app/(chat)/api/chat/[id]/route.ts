import { auth } from "@/app/(auth)/auth";
import { getChatById, deleteChatById } from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";

/**
 * Delete specified chat (only owner can delete)
 */
export async function DELETE(
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

  if (chat.userId !== session.user.id) {
    return new AppError("forbidden:chat").toResponse();
  }

  await deleteChatById({ id: chatId });

  return Response.json({ id: chatId });
}
