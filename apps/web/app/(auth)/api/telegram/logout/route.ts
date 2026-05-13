import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { deleteTgBotBySessionAndUserId } from "@/lib/db/queries";
import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";

export async function POST(request: NextRequest) {
  try {
    const authSession = await auth();
    if (!authSession?.user) {
      return new AppError("unauthorized:bot").toResponse();
    }
    const body = await request.json().catch(() => ({}));
    const { session } = body;
    await deleteTgBotBySessionAndUserId({
      session,
      userId: authSession.user.id,
    });
    return NextResponse.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("Logout process failed:", error);
    return NextResponse.json(
      { error: "An error occurred during logout" },
      { status: 500 },
    );
  }
}
