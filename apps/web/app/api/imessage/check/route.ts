import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { IMessageAdapter } from "@openloomi/integrations/imessage";

/**
 * POST /api/imessage/check
 * Check if iMessage is available
 *
 * Note: This API route runs on the server side, so cannot directly call Tauri API.
 * In Tauri mode, we assume the frontend has already verified the platform environment, here we only return macOS platform check.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // First check the platform
    const isDarwin = process.platform === "darwin";
    if (!isDarwin) {
      return NextResponse.json({
        available: false,
        error: "iMessage is only available on macOS",
      });
    }

    // Validate connection in SDK mode
    const result = await IMessageAdapter.validateConnection();

    if (result.available) {
      return NextResponse.json({
        available: true,
        userInfo: {
          name: session.user.name || "iMessage User",
        },
      });
    }

    return NextResponse.json({
      available: false,
      error: result.error,
    });
  } catch (error) {
    console.error("[iMessage] Check availability failed:", error);

    return NextResponse.json({
      available: false,
      error:
        error instanceof Error
          ? error.message
          : "An error occurred while checking iMessage availability",
    });
  }
}
