/**
 * Initiate WeChat iLink QR code login: Fetch QR code and create server session.
 */
import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import {
  DEFAULT_WEIXIN_QR_BOT_TYPE,
  fetchWeixinBotQrCode,
  startWeixinQrSession,
} from "@openloomi/integrations/weixin/qr-login";

const DEFAULT_BASE = "https://ilinkai.weixin.qq.com";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const baseUrl =
      typeof body.baseUrl === "string" && body.baseUrl.trim()
        ? body.baseUrl.trim()
        : DEFAULT_BASE;
    const routeTag =
      typeof body.routeTag === "string" && body.routeTag.trim()
        ? body.routeTag.trim()
        : undefined;

    const qr = await fetchWeixinBotQrCode({
      apiBaseUrl: baseUrl,
      botType: DEFAULT_WEIXIN_QR_BOT_TYPE,
      routeTag,
    });

    const { loginId, qrContent } = startWeixinQrSession({
      userId: session.user.id,
      apiBaseUrl: baseUrl,
      botType: DEFAULT_WEIXIN_QR_BOT_TYPE,
      routeTag,
      qr,
    });

    return NextResponse.json({ loginId, qrContent });
  } catch (error) {
    console.error("[Weixin QR] start failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to get Weixin login QR code",
      },
      { status: 500 },
    );
  }
}
