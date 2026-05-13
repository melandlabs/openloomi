import { AppError } from "@openloomi/shared/errors";
import { getUser } from "@/lib/db/queries";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const users = await getUser(id);
    const exists = users.length > 0;

    let isNewUser = !exists;

    if (exists) {
      const [user] = users;
      const firstLoginAt = user.firstLoginAt
        ? new Date(user.firstLoginAt)
        : null;
      const lastLoginAt = user.lastLoginAt ? new Date(user.lastLoginAt) : null;

      if (!firstLoginAt || !lastLoginAt) {
        isNewUser = true;
      } else {
        isNewUser = firstLoginAt.getTime() === lastLoginAt.getTime();
      }
    }

    return Response.json({ exists, isNewUser }, { status: 200 });
  } catch (error) {
    return new AppError(
      "bad_request:database",
      "Failed to check user existence",
    ).toResponse();
  }
}
