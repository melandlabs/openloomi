import { auth } from "@/app/(auth)/auth";
import { getUserContacts } from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:bot").toResponse();
  }

  try {
    const contacts = await getUserContacts(session.user.id);

    return Response.json(
      {
        success: true,
        count: contacts.length,
        contacts,
      },
      { status: 200 },
    );
  } catch (error) {
    return new AppError(
      "bad_request:bot",
      `${error instanceof Error ? error.message : String(error)}`,
    ).toResponse();
  }
}
