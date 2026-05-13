/**
 * Poll WeChat QR code scan status; write to integration + bot after confirmation
 */
import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { advanceWeixinQrPoll } from "@openloomi/integrations/weixin/qr-login";
import { completeWeixinIntegrationAfterQr } from "@/lib/integrations/weixin/complete-weixin-integration";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const loginId = typeof body.loginId === "string" ? body.loginId.trim() : "";
    const displayNameInput =
      typeof body.displayName === "string" ? body.displayName.trim() : "";

    if (!loginId) {
      return NextResponse.json(
        { error: "loginId is required" },
        { status: 400 },
      );
    }

    const step = await advanceWeixinQrPoll(loginId, session.user.id);

    if (step.kind === "error") {
      return NextResponse.json({ error: step.message }, { status: 400 });
    }

    if (step.kind === "wait") {
      return NextResponse.json({ phase: "waiting" });
    }

    if (step.kind === "scaned") {
      return NextResponse.json({ phase: "scanned" });
    }

    if (step.kind === "expired") {
      return NextResponse.json({
        phase: "expired",
        qrContent: step.qrContent,
        message: step.message,
      });
    }

    if (step.kind === "confirmed") {
      const displayName =
        displayNameInput ||
        `Weixin · ${step.ilinkBotId.slice(0, Math.min(24, step.ilinkBotId.length))}`;

      const { accountId, botId } = await completeWeixinIntegrationAfterQr({
        userId: session.user.id,
        // Align with UserType / isFreeUser: Don't use "free" (not in free type list)
        userType: session.user.type ?? "guest",
        ilinkBotId: step.ilinkBotId,
        ilinkToken: step.botToken,
        baseUrl: step.baseUrl,
        routeTag: step.routeTag,
        displayName,
        weixinUserId: step.ilinkUserId,
      });

      return NextResponse.json({
        phase: "done",
        accountId,
        botId,
      });
    }

    return NextResponse.json({ phase: "waiting" });
  } catch (error) {
    console.error("[Weixin QR] poll failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to poll login status",
      },
      { status: 500 },
    );
  }
}
