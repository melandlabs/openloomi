import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import { encryptToken } from "@openloomi/security/token-encryption";
import { getApplicationBaseUrl } from "@/lib/env";

const LINKEDIN_SCOPES = [
  "openid",
  "profile",
  "email",
  "r_liteprofile",
  "r_emailaddress",
  "w_member_social",
  "message.read",
  "message.write",
  "offline_access",
];

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        error:
          "LinkedIn integration is not configured. Set LINKEDIN_CLIENT_ID/SECRET.",
      },
      { status: 500 },
    );
  }

  const baseUrl = getApplicationBaseUrl();
  const redirectUri =
    process.env.LINKEDIN_REDIRECT_URI ?? `${baseUrl}/api/linkedin/callback`;

  const state = encryptToken(
    JSON.stringify({
      userId: session.user.id,
      nonce: randomUUID(),
      ts: Date.now(),
      returnTo: `${baseUrl}/?page=profile`,
    }),
  );

  const authUrl = new URL("https://www.linkedin.com/oauth/v2/authorization");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", LINKEDIN_SCOPES.join(" "));
  authUrl.searchParams.set("state", state);

  return NextResponse.redirect(authUrl.toString(), { status: 302 });
}
