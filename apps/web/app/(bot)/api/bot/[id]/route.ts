import { auth } from "@/app/(auth)/auth";
import { getBotById } from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:bot").toResponse();
  }

  try {
    const bot = await getBotById({ id });
    if (!bot) {
      return new AppError("not_found:bot").toResponse();
    }
    if (bot.userId !== session.user.id) {
      return new AppError("forbidden:bot").toResponse();
    }
    return Response.json(bot, { status: 200 });
  } catch (error) {
    return new AppError("bad_request:database", String(error)).toResponse();
  }
}
