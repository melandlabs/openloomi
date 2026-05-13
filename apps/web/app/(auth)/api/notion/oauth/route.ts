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

  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        error:
          "Notion integration is not configured. Set NOTION_CLIENT_ID/NOTION_CLIENT_SECRET.",
      },
      { status: 500 },
    );
  }

  const baseUrl = getApplicationBaseUrl();
  const redirectUri =
    process.env.NOTION_REDIRECT_URI ?? `${baseUrl}/api/notion/callback`;

  const { searchParams } = new URL(request.url);
  const returnTo = searchParams.get("returnTo") ?? `${baseUrl}/?page=profile`;

  const state = encryptToken(
    JSON.stringify({
      userId: session.user.id,
      ts: Date.now(),
      returnTo,
    }),
  );

  const scope = process.env.NOTION_OAUTH_SCOPES;

  const notionAuth = new URL("https://api.notion.com/v1/oauth/authorize");
  notionAuth.searchParams.set("client_id", clientId);
  notionAuth.searchParams.set("response_type", "code");
  notionAuth.searchParams.set("owner", "user");
  notionAuth.searchParams.set("redirect_uri", redirectUri);
  if (scope) {
    notionAuth.searchParams.set("scope", scope);
  }
  notionAuth.searchParams.set("state", state);

  return NextResponse.redirect(notionAuth.toString(), { status: 302 });
}
