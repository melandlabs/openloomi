import { google } from "googleapis";
import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import { decryptToken } from "@openloomi/security/token-encryption";
import { getApplicationBaseUrl } from "@/lib/env";
import {
  getIntegrationAccountByPlatform,
  loadIntegrationCredentials,
  upsertIntegrationAccount,
} from "@/lib/db/queries";
import type { GmailStoredCredentials } from "@/lib/integrations/gmail";

type GmailStatePayload = {
  userId: string;
  ts: number;
  nonce: string;
  returnTo?: string;
  redirectUri?: string;
};

function buildRedirectUrl(
  baseHref: string,
  status: "success" | "cancelled" | "error",
  message?: string,
) {
  const url = new URL(baseHref);
  url.searchParams.set("gmail", status);
  if (message) {
    url.searchParams.set("gmailMessage", message);
  }
  return url;
}

function mergeCredentials(
  previous: GmailStoredCredentials,
  next: {
    access_token?: string | null;
    refresh_token?: string | null;
    scope?: string | null;
    token_type?: string | null;
    expiry_date?: number | null;
  },
): GmailStoredCredentials {
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

  let statePayload: GmailStatePayload | null = null;

  try {
    const decoded = decryptToken(stateParam);
    statePayload = JSON.parse(decoded) as GmailStatePayload;
  } catch (error) {
    console.error("[gmail] Failed to decode state", error);
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
      buildRedirectUrl(redirectTarget, "error", "Sign in to connect Gmail."),
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

  const clientId = process.env.GMAIL_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret =
    process.env.GMAIL_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      buildRedirectUrl(
        redirectTarget,
        "error",
        "Gmail integration is not configured.",
      ),
    );
  }

  // Use the redirectUri from state to ensure it matches exactly what was used during initiation
  const redirectUri =
    statePayload?.redirectUri ??
    process.env.GMAIL_REDIRECT_URI ??
    `${baseUrl}/api/gmail/callback`;

  try {
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
      platform: "gmail",
    });

    const previousCredentials =
      loadIntegrationCredentials<GmailStoredCredentials>(existingAccount) ?? {};

    const mergedCredentials = mergeCredentials(previousCredentials, tokens);

    if (!mergedCredentials.refreshToken) {
      return NextResponse.redirect(
        buildRedirectUrl(
          redirectTarget,
          "error",
          'Gmail did not provide a refresh token. Reconnect with "Allow" selected.',
        ),
      );
    }

    const externalId =
      userInfo.data.id ?? existingAccount?.externalId ?? session.user.id;

    const displayName =
      userInfo.data.name ??
      userInfo.data.email ??
      existingAccount?.displayName ??
      "Gmail";

    const metadata = {
      email: userInfo.data.email ?? null,
      picture: userInfo.data.picture ?? null,
      displayName,
    };

    await upsertIntegrationAccount({
      userId: session.user.id,
      platform: "gmail",
      externalId,
      displayName,
      credentials: mergedCredentials,
      metadata,
    });

    return NextResponse.redirect(buildRedirectUrl(redirectTarget, "success"));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Provide specific, actionable error messages
    let userMessage: string;
    if (
      errorMessage.includes("redirect_uri_mismatch") ||
      errorMessage.includes("Error 400")
    ) {
      userMessage =
        "Redirect URI mismatch. Ensure GMAIL_REDIRECT_URI matches your Google Cloud Console configuration.";
      console.error(
        "[gmail] Redirect URI mismatch - callback URL does not match Google Cloud Console",
        {
          expected: redirectUri,
          error: errorMessage,
        },
      );
    } else if (
      errorMessage.includes("ENOTFOUND") ||
      errorMessage.includes("ECONNREFUSED") ||
      errorMessage.includes("getaddrinfo")
    ) {
      userMessage =
        "Network error: Unable to reach Google servers. Check your network or DNS configuration.";
      console.error("[gmail] Network error reaching Google APIs", {
        error: errorMessage,
      });
    } else if (
      errorMessage.includes("invalid_grant") ||
      errorMessage.includes("Code already used")
    ) {
      userMessage =
        "Authorization code expired or invalid. Please try connecting again.";
    } else {
      userMessage = `Gmail authorization failed: ${errorMessage}`;
      console.error("[gmail] Callback handling failed", {
        error: errorMessage,
        redirectUri,
      });
    }

    return NextResponse.redirect(
      buildRedirectUrl(redirectTarget, "error", userMessage),
    );
  }
}
