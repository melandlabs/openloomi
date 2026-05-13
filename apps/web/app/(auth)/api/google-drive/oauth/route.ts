import { randomUUID } from "node:crypto";
import { google } from "googleapis";
import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import { encryptToken } from "@openloomi/security/token-encryption";
import { getApplicationBaseUrl } from "@/lib/env";
import { GOOGLE_DRIVE_SCOPES } from "@/lib/files/google-drive";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Web version: keep original logic
  const clientId =
    process.env.GOOGLE_DRIVE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret =
    process.env.GOOGLE_DRIVE_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        error:
          "Google Drive integration is not configured. Contact the openloomi team to enable it.",
      },
      { status: 500 },
    );
  }

  const baseUrl = getApplicationBaseUrl();
  const redirectUri =
    process.env.GOOGLE_DRIVE_REDIRECT_URI ??
    `${baseUrl}/api/google-drive/callback`;

  const oauth2Client = new google.auth.OAuth2({
    clientId,
    clientSecret,
    redirectUri,
  });

  const state = encryptToken(
    JSON.stringify({
      userId: session.user.id,
      nonce: randomUUID(),
      ts: Date.now(),
      returnTo: `${baseUrl}/?page=profile`,
    }),
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [...GOOGLE_DRIVE_SCOPES],
    prompt: "consent",
    state,
    include_granted_scopes: true,
  });

  return NextResponse.redirect(authUrl, { status: 302 });
}
