import { google } from "googleapis";
import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import { decryptToken } from "@openloomi/security/token-encryption";
import { getApplicationBaseUrl } from "@/lib/env";
import {
  getIntegrationAccountByPlatform,
  loadIntegrationCredentials,
  upsertIntegrationAccount,
  createBot,
} from "@/lib/db/queries";
import type { GoogleDocsStoredCredentials } from "@openloomi/integrations/google-docs";

type DocsStatePayload = {
  userId: string;
  ts: number;
  nonce: string;
  returnTo?: string;
};

function buildRedirectUrl(
  baseHref: string,
  status: "success" | "cancelled" | "error",
  message?: string,
) {
  const url = new URL(baseHref);
  url.searchParams.set("googleDocs", status);
  if (message) {
    url.searchParams.set("googleDocsMessage", message);
  }
  return url;
}

function mergeCredentials(
  previous: GoogleDocsStoredCredentials,
  next: {
    access_token?: string | null;
    refresh_token?: string | null;
    scope?: string | null;
    token_type?: string | null;
    expiry_date?: number | null;
  },
): GoogleDocsStoredCredentials {
  return {
    accessToken: next.access_token ?? previous.accessToken ?? null,
    refreshToken: next.refresh_token ?? previous.refreshToken ?? null,
    scope: next.scope ?? previous.scope ?? null,
    tokenType: next.token_type ?? previous.tokenType ?? null,
    expiryDate: next.expiry_date ?? previous.expiryDate ?? null,
  };
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
    const message =
      errorParam === "access_denied"
        ? "Access was denied."
        : "Authorization failed.";
    return NextResponse.redirect(
      buildRedirectUrl(defaultRedirect, "cancelled", message),
    );
  }

  if (!stateParam) {
    return NextResponse.redirect(
      buildRedirectUrl(defaultRedirect, "error", "Missing state parameter."),
    );
  }

  let statePayload: DocsStatePayload | null = null;

  try {
    const decoded = decryptToken(stateParam);
    statePayload = JSON.parse(decoded) as DocsStatePayload;
  } catch (error) {
    console.error("[google-docs] Failed to decode state", error);
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
        "Sign in to connect Google Docs.",
      ),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      buildRedirectUrl(
        redirectTarget,
        "error",
        "Missing authorization code from Google.",
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

  const clientId =
    process.env.GOOGLE_DOCS_CLIENT_ID ??
    process.env.GOOGLE_DRIVE_CLIENT_ID ??
    process.env.GOOGLE_CLIENT_ID;
  const clientSecret =
    process.env.GOOGLE_DOCS_CLIENT_SECRET ??
    process.env.GOOGLE_DRIVE_CLIENT_SECRET ??
    process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      buildRedirectUrl(
        redirectTarget,
        "error",
        "Google Docs integration is not configured.",
      ),
    );
  }

  try {
    const redirectUri =
      process.env.GOOGLE_DOCS_REDIRECT_URI ??
      process.env.GOOGLE_DRIVE_REDIRECT_URI ??
      `${baseUrl}/api/google-docs/callback`;

    const oauth2Client = new google.auth.OAuth2({
      clientId,
      clientSecret,
      redirectUri,
    });

    const tokenResponse = await oauth2Client.getToken({ code });

    const tokens = tokenResponse.tokens;
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({
      version: "v2",
      auth: oauth2Client,
    });

    const userInfo = await oauth2.userinfo.get();

    const existingAccount = await getIntegrationAccountByPlatform({
      userId: session.user.id,
      platform: "google_docs",
    });

    const previousCredentials =
      loadIntegrationCredentials<GoogleDocsStoredCredentials>(
        existingAccount,
      ) ?? {};

    const mergedCredentials = mergeCredentials(previousCredentials, tokens);

    if (!mergedCredentials.refreshToken) {
      return NextResponse.redirect(
        buildRedirectUrl(
          redirectTarget,
          "error",
          "Google did not provide a refresh token. Reconnect with “Allow” selected.",
        ),
      );
    }

    const externalId =
      userInfo.data.id ?? existingAccount?.externalId ?? session.user.id;

    const displayName =
      userInfo.data.name ??
      userInfo.data.email ??
      existingAccount?.displayName ??
      "Google Docs";

    const metadata = {
      email: userInfo.data.email ?? null,
      picture: userInfo.data.picture ?? null,
      displayName,
    };

    const account = await upsertIntegrationAccount({
      userId: session.user.id,
      platform: "google_docs",
      externalId,
      displayName,
      credentials: mergedCredentials,
      metadata,
    });

    const botId = await createBot({
      name: `Google Docs · ${displayName}`,
      description: "Automatically created through Google Docs authorization",
      adapter: "google_docs",
      adapterConfig: {},
      enable: true,
      userId: session.user.id,
      platformAccountId: account.id,
    });

    return NextResponse.redirect(
      buildRedirectUrl(redirectTarget, "success", botId ?? undefined),
    );
  } catch (error) {
    console.error("[google-docs] Callback handling failed", error);
    return NextResponse.redirect(
      buildRedirectUrl(
        redirectTarget,
        "error",
        error instanceof Error
          ? error.message
          : "Google Docs authorization failed.",
      ),
    );
  }
}
