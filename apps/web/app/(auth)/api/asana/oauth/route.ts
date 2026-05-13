import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import { encryptToken } from "@openloomi/security/token-encryption";
import { getApplicationBaseUrl } from "@/lib/env";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = process.env.ASANA_CLIENT_ID;
  const clientSecret = process.env.ASANA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        error:
          "Asana integration is not configured. Set ASANA_CLIENT_ID/ASANA_CLIENT_SECRET.",
      },
      { status: 500 },
    );
  }

  const baseUrl = getApplicationBaseUrl();
  const redirectUri =
    process.env.ASANA_REDIRECT_URI ?? `${baseUrl}/api/asana/callback`;

  const { searchParams } = new URL(request.url);
  const returnTo = searchParams.get("returnTo") ?? `${baseUrl}/?page=profile`;

  const stateTimestamp = Date.now();
  const state = encryptToken(
    JSON.stringify({
      userId: session.user.id,
      ts: stateTimestamp,
      returnTo,
    }),
  );

  // Asana OAuth scopes for task and project management
  const scope = process.env.ASANA_OAUTH_SCOPES ?? "default";

  const asanaAuth = new URL("https://app.asana.com/-/oauth_authorize");
  asanaAuth.searchParams.set("client_id", clientId);
  asanaAuth.searchParams.set("redirect_uri", redirectUri);
  asanaAuth.searchParams.set("response_type", "code");
  asanaAuth.searchParams.set("scope", scope);
  asanaAuth.searchParams.set("state", state);

  return NextResponse.redirect(asanaAuth.toString(), { status: 302 });
}
