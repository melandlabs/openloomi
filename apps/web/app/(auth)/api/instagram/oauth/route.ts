import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import { encryptToken } from "@openloomi/security/token-encryption";
import { getApplicationBaseUrl } from "@/lib/env";

const INSTAGRAM_SCOPES = [
  "public_profile",
  "pages_show_list",
  "pages_messaging",
  "instagram_basic",
  "instagram_manage_messages",
];

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = process.env.INSTAGRAM_APP_ID ?? process.env.FB_APP_ID;
  const clientSecret =
    process.env.INSTAGRAM_APP_SECRET ?? process.env.FB_APP_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        error:
          "Instagram integration is not configured. Set INSTAGRAM_APP_ID/SECRET.",
      },
      { status: 500 },
    );
  }

  const baseUrl = getApplicationBaseUrl();
  const redirectUri =
    process.env.INSTAGRAM_REDIRECT_URI ?? `${baseUrl}/api/instagram/callback`;

  const state = encryptToken(
    JSON.stringify({
      userId: session.user.id,
      nonce: randomUUID(),
      ts: Date.now(),
      returnTo: `${baseUrl}/?page=profile`,
    }),
  );

  const authUrl = new URL("https://www.facebook.com/v20.0/dialog/oauth");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", INSTAGRAM_SCOPES.join(","));
  authUrl.searchParams.set("state", state);

  return NextResponse.redirect(authUrl.toString(), { status: 302 });
}
