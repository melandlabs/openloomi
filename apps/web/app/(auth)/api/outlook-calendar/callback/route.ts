import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import { decryptToken } from "@openloomi/security/token-encryption";
import { getApplicationBaseUrl } from "@/lib/env";
import {
  createBot,
  getIntegrationAccountByPlatform,
  loadIntegrationCredentials,
  upsertIntegrationAccount,
} from "@/lib/db/queries";

const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const ME_ENDPOINT = "https://graph.microsoft.com/v1.0/me";

type StatePayload = {
  userId: string;
  ts: number;
  nonce: string;
  returnTo?: string;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string | null;
  expires_in?: number | null;
  scope?: string | null;
  token_type?: string | null;
  id_token?: string | null;
  error?: string | null;
};

type MeResponse = {
  displayName?: string | null;
  mail?: string | null;
  userPrincipalName?: string | null;
  id?: string | null;
};

function buildRedirectUrl(
  baseHref: string,
  status: "success" | "cancelled" | "error",
  message?: string,
) {
  const url = new URL(baseHref);
  url.searchParams.set("outlookCalendar", status);
  if (message) {
    url.searchParams.set("outlookCalendarMessage", message);
  }
  return url;
}

function buildCredentialsUpdate(
  previous: Record<string, unknown>,
  next: TokenResponse,
): Record<string, unknown> {
  return {
    accessToken: next.access_token ?? (previous as any).accessToken ?? null,
    refreshToken: next.refresh_token ?? (previous as any).refreshToken ?? null,
    scope: next.scope ?? (previous as any).scope ?? null,
    tokenType: next.token_type ?? (previous as any).tokenType ?? null,
    expiresAt: next.expires_in
      ? Date.now() + next.expires_in * 1000
      : ((previous as any).expiresAt ?? null),
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

  let statePayload: StatePayload | null = null;

  try {
    const decoded = decryptToken(stateParam);
    statePayload = JSON.parse(decoded) as StatePayload;
  } catch (error) {
    console.error("[outlook-calendar] Failed to decode state", error);
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
        "Sign in to connect Outlook Calendar.",
      ),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      buildRedirectUrl(
        redirectTarget,
        "error",
        "Missing authorization code from Microsoft.",
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

  const clientId = process.env.OUTLOOK_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.OUTLOOK_CALENDAR_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      buildRedirectUrl(
        redirectTarget,
        "error",
        "Outlook Calendar integration is not configured.",
      ),
    );
  }

  try {
    const redirectUri =
      process.env.OUTLOOK_CALENDAR_REDIRECT_URI ??
      `${baseUrl}/api/outlook-calendar/callback`;

    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });

    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const tokens = (await tokenResponse
      .json()
      .catch(() => ({}))) as TokenResponse;

    if (!tokenResponse.ok || !tokens.access_token) {
      return NextResponse.redirect(
        buildRedirectUrl(
          redirectTarget,
          "error",
          tokens?.error ?? "Outlook Calendar authorization failed.",
        ),
      );
    }

    const meResponse = await fetch(ME_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
    });
    const me = (await meResponse.json().catch(() => ({}))) as MeResponse;

    const existingAccount = await getIntegrationAccountByPlatform({
      userId: session.user.id,
      platform: "outlook_calendar",
    });
    const previousCredentials =
      loadIntegrationCredentials<Record<string, unknown>>(existingAccount) ??
      {};

    const mergedCredentials = buildCredentialsUpdate(
      previousCredentials,
      tokens,
    );

    if (!mergedCredentials.refreshToken) {
      return NextResponse.redirect(
        buildRedirectUrl(
          redirectTarget,
          "error",
          "Outlook did not provide a refresh token. Reconnect with “Allow” selected.",
        ),
      );
    }

    const externalId = me.id ?? existingAccount?.externalId ?? session.user.id;
    const displayName =
      me.displayName ??
      me.mail ??
      me.userPrincipalName ??
      existingAccount?.displayName ??
      "Outlook Calendar";

    const metadata = {
      email: me.mail ?? me.userPrincipalName ?? null,
      displayName,
      userPrincipalName: me.userPrincipalName ?? null,
    };

    const account = await upsertIntegrationAccount({
      userId: session.user.id,
      platform: "outlook_calendar",
      externalId,
      displayName,
      credentials: mergedCredentials,
      metadata,
    });

    const botId = await createBot({
      name: `Outlook Calendar · ${displayName}`,
      description:
        "Automatically created through Outlook Calendar authorization",
      adapter: "outlook_calendar",
      adapterConfig: {},
      enable: true,
      userId: session.user.id,
      platformAccountId: account.id,
    });

    return NextResponse.redirect(
      buildRedirectUrl(redirectTarget, "success", botId ?? undefined),
    );
  } catch (error) {
    console.error("[outlook-calendar] Callback handling failed", error);
    return NextResponse.redirect(
      buildRedirectUrl(
        redirectTarget,
        "error",
        error instanceof Error
          ? error.message
          : "Outlook Calendar authorization failed.",
      ),
    );
  }
}
