/**
 * Cancel ongoing WeChat QR code session (called when popup is closed)
 */
import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import {
  deleteWeixinQrSession,
  getWeixinQrSession,
} from "@openloomi/integrations/weixin/qr-login";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const loginId = typeof body.loginId === "string" ? body.loginId.trim() : "";
    if (!loginId) {
      return NextResponse.json({ ok: true });
    }
    const s = getWeixinQrSession(loginId, session.user.id);
    if (s) {
      deleteWeixinQrSession(loginId);
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
