import { Buffer } from "node:buffer";

import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import {
  getIntegrationAccountByPlatform,
  upsertIntegrationAccount,
} from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";
import {
  mergeNotionMetadata,
  type NotionStoredCredentials,
} from "@/lib/files/notion";
import { decryptToken } from "@openloomi/security/token-encryption";
import { getApplicationBaseUrl } from "@/lib/env";

type NotionTokenResponse = {
  access_token?: string;
  bot_id?: string;
  duplicated_template_id?: string | null;
  workspace_icon?: string | null;
  workspace_id?: string | null;
  workspace_name?: string | null;
  token_type?: string;
  refresh_token?: string | null;
  expires_in?: number | null;
  owner?: Record<string, unknown> | null;
};

export const runtime = "nodejs";

function buildRedirectUrl(baseHref: string, status: string, message?: string) {
  const url = new URL(baseHref);
  url.searchParams.set("notion", status);
  if (message) {
    url.searchParams.set("notionMessage", message);
  }
  return url;
}

export async function GET(request: Request) {
  const session = await auth();
  const baseUrl = getApplicationBaseUrl();
  const defaultRedirect = `${baseUrl}/?page=profile`;

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return NextResponse.redirect(
      buildRedirectUrl(defaultRedirect, "cancelled", errorParam),
    );
  }

  if (!stateParam) {
    return NextResponse.redirect(
      buildRedirectUrl(
        defaultRedirect,
        "error",
        "Missing authorization state.",
      ),
    );
  }

  let statePayload: { userId: string; ts: number; returnTo?: string } | null =
    null;
  try {
    statePayload = JSON.parse(decryptToken(stateParam));
  } catch (error) {
    console.error("[notion] Failed to decode state", error);
    return NextResponse.redirect(
      buildRedirectUrl(
        defaultRedirect,
        "error",
        "Invalid authorization state.",
      ),
    );
  }

  const redirectTarget = statePayload?.returnTo?.startsWith("http")
    ? statePayload.returnTo
    : defaultRedirect;

  if (!session?.user) {
    return NextResponse.redirect(
      buildRedirectUrl(
        redirectTarget,
        "error",
        "Sign in to connect your Notion workspace.",
      ),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      buildRedirectUrl(
        redirectTarget,
        "error",
        "Missing authorization code from Notion.",
      ),
    );
  }

  const maxStateAgeMs = 10 * 60 * 1000;
  if (
    !statePayload ||
    statePayload.userId !== session.user.id ||
    Date.now() - statePayload.ts > maxStateAgeMs
  ) {
    return NextResponse.redirect(
      buildRedirectUrl(
        redirectTarget,
        "error",
        "Authorization state expired. Try again.",
      ),
    );
  }

  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      buildRedirectUrl(
        redirectTarget,
        "error",
        "Notion integration is not configured. Contact support.",
      ),
    );
  }

  try {
    const redirectUri =
      process.env.NOTION_REDIRECT_URI ?? `${baseUrl}/api/notion/callback`;

    const tokenResponse = await fetch("https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const body = (await tokenResponse.json().catch(() => ({}))) as {
        error?: string;
        error_description?: string;
      };
      const reason =
        body.error_description ?? body.error ?? "OAuth exchange failed.";
      return NextResponse.redirect(
        buildRedirectUrl(redirectTarget, "error", reason),
      );
    }

    const data = (await tokenResponse.json()) as NotionTokenResponse;
    if (!data.access_token) {
      return NextResponse.redirect(
        buildRedirectUrl(
          redirectTarget,
          "error",
          "Notion did not return an access token.",
        ),
      );
    }

    const expiresAt = data.expires_in
      ? Date.now() + data.expires_in * 1000
      : null;

    const credentials: NotionStoredCredentials = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      workspaceId: data.workspace_id ?? null,
      workspaceName: data.workspace_name ?? null,
      botId: data.bot_id ?? null,
      expiresAt,
    };

    const existing = await getIntegrationAccountByPlatform({
      userId: session.user.id,
      platform: "notion",
    });

    const metadata = mergeNotionMetadata(existing?.metadata as any, {
      workspaceId: data.workspace_id ?? null,
      workspaceName: data.workspace_name ?? null,
      workspaceIcon: data.workspace_icon ?? null,
    });

    await upsertIntegrationAccount({
      userId: session.user.id,
      platform: "notion",
      externalId: data.workspace_id ?? data.bot_id ?? session.user.id,
      displayName: data.workspace_name ?? "Notion",
      credentials,
      metadata,
    });

    return NextResponse.redirect(buildRedirectUrl(redirectTarget, "success"));
  } catch (error) {
    console.error("[notion] Callback handling failed", error);
    const message =
      error instanceof AppError
        ? error.message
        : "Notion authorization failed.";
    return NextResponse.redirect(
      buildRedirectUrl(redirectTarget, "error", message),
    );
  }
}
