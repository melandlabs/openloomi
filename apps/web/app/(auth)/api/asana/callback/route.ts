import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import { upsertIntegrationAccount } from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";
import { decryptToken } from "@openloomi/security/token-encryption";
import { getApplicationBaseUrl } from "@/lib/env";
import type { IntegrationId } from "@/hooks/use-integrations";

type AsanaTokenResponse = {
  access_token?: string;
  refresh_token?: string | null;
  token_type?: string;
  expires_in?: number | null;
  data?: {
    gid?: string;
    email?: string;
    name?: string;
  } | null;
};

type AsanaUser = {
  gid: string;
  email: string;
  name: string;
};

export const runtime = "nodejs";

function buildRedirectUrl(baseHref: string, status: string, message?: string) {
  const url = new URL(baseHref);
  url.searchParams.set("asana", status);
  if (message) {
    url.searchParams.set("asanaMessage", message);
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
    console.error("[asana] Failed to decode state", error);
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
        "Sign in to connect your Asana account.",
      ),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      buildRedirectUrl(
        redirectTarget,
        "error",
        "Missing authorization code from Asana.",
      ),
    );
  }

  const maxStateAgeMs =
    Number(process.env.ASANA_OAUTH_STATE_TTL_MS) || 15 * 60 * 1000; // 15 minutes default
  const stateAge = Date.now() - (statePayload?.ts ?? 0);

  if (
    !statePayload ||
    statePayload.userId !== session.user.id ||
    stateAge > maxStateAgeMs
  ) {
    console.error("[asana] OAuth state validation failed:", {
      hasStatePayload: !!statePayload,
      stateUserId: statePayload?.userId,
      sessionUserId: session.user.id,
      userIdMatch: statePayload?.userId === session.user.id,
      stateTimestamp: statePayload?.ts,
      currentTimestamp: Date.now(),
      stateAgeMs: stateAge,
      maxAgeMs: maxStateAgeMs,
      isExpired: stateAge > maxStateAgeMs,
    });

    const errorMessage =
      stateAge > maxStateAgeMs
        ? `Authorization session expired (${Math.floor(stateAge / 1000)}s). Please try again.`
        : statePayload?.userId !== session.user.id
          ? "User session changed during authorization. Please try again."
          : "Invalid authorization state. Please try again.";

    return NextResponse.redirect(
      buildRedirectUrl(redirectTarget, "error", errorMessage),
    );
  }

  const clientId = process.env.ASANA_CLIENT_ID;
  const clientSecret = process.env.ASANA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      buildRedirectUrl(
        redirectTarget,
        "error",
        "Asana integration is not configured. Contact support.",
      ),
    );
  }

  try {
    const redirectUri =
      process.env.ASANA_REDIRECT_URI ?? `${baseUrl}/api/asana/callback`;

    // Exchange authorization code for access token
    const tokenResponse = await fetch("https://app.asana.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
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

    const tokenData = (await tokenResponse.json()) as AsanaTokenResponse;
    if (!tokenData.access_token) {
      return NextResponse.redirect(
        buildRedirectUrl(
          redirectTarget,
          "error",
          "Asana did not return an access token.",
        ),
      );
    }

    // Fetch user information
    const userResponse = await fetch("https://app.asana.com/api/1.0/users/me", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/json",
      },
    });

    if (!userResponse.ok) {
      return NextResponse.redirect(
        buildRedirectUrl(
          redirectTarget,
          "error",
          "Failed to fetch Asana user information.",
        ),
      );
    }

    const userDataResponse = (await userResponse.json()) as { data: AsanaUser };
    const userData = userDataResponse.data;

    const credentials = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token ?? null,
      expiresAt: tokenData.expires_in
        ? Date.now() + tokenData.expires_in * 1000
        : null,
      tokenType: tokenData.token_type ?? "bearer",
      data: tokenData.data ?? null,
    };

    const metadata = {
      gid: userData.gid,
      email: userData.email,
      name: userData.name,
    };

    const account = await upsertIntegrationAccount({
      userId: session.user.id,
      platform: "asana" as IntegrationId,
      externalId: userData.gid,
      displayName: userData.name,
      credentials,
      metadata,
    });

    return NextResponse.redirect(buildRedirectUrl(redirectTarget, "success"));
  } catch (error) {
    console.error("[asana] Callback handling failed", error);
    const message =
      error instanceof AppError ? error.message : "Asana authorization failed.";
    return NextResponse.redirect(
      buildRedirectUrl(redirectTarget, "error", message),
    );
  }
}
