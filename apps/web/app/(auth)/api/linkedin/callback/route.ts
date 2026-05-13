import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import { decryptToken } from "@openloomi/security/token-encryption";
import { getApplicationBaseUrl } from "@/lib/env";
import {
  getIntegrationAccountByPlatform,
  getIntegrationAccountsByUserId,
  loadIntegrationCredentials,
  upsertIntegrationAccount,
  createBot,
  updateBot,
} from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";

type LinkedInStatePayload = {
  userId: string;
  ts: number;
  nonce: string;
  returnTo?: string;
};

type LinkedInTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
};

type LinkedInUserInfo = {
  sub?: string;
  name?: string;
  email?: string;
  email_verified?: boolean;
  picture?: string;
};

function buildRedirectUrl(
  baseHref: string,
  status: "success" | "cancelled" | "error",
  message?: string,
) {
  const url = new URL(baseHref);
  url.searchParams.set("linkedin", status);
  if (message) {
    url.searchParams.set("linkedinMessage", message);
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
    const message =
      errorParam === "user_cancelled_login"
        ? "Access was cancelled."
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

  let statePayload: LinkedInStatePayload | null = null;

  try {
    const decoded = decryptToken(stateParam);
    statePayload = JSON.parse(decoded) as LinkedInStatePayload;
  } catch (error) {
    console.error("[linkedin] Failed to decode state", error);
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
      buildRedirectUrl(redirectTarget, "error", "Sign in to connect LinkedIn."),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      buildRedirectUrl(
        redirectTarget,
        "error",
        "Missing authorization code from LinkedIn.",
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

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      buildRedirectUrl(
        redirectTarget,
        "error",
        "LinkedIn integration is not configured.",
      ),
    );
  }

  try {
    const redirectUri =
      process.env.LINKEDIN_REDIRECT_URI ?? `${baseUrl}/api/linkedin/callback`;

    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const tokenResponse = await fetch(
      "https://www.linkedin.com/oauth/v2/accessToken",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody,
      },
    );

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      throw new AppError(
        "bad_request:auth",
        `Failed to exchange token: ${text}`,
      );
    }

    const tokenJson = (await tokenResponse.json()) as LinkedInTokenResponse;

    if (!tokenJson.access_token) {
      throw new AppError(
        "bad_request:auth",
        "LinkedIn did not return an access token.",
      );
    }

    const expiresAt = tokenJson.expires_in
      ? Date.now() + tokenJson.expires_in * 1000
      : null;

    const userInfoResponse = await fetch(
      "https://api.linkedin.com/v2/userinfo",
      {
        headers: {
          Authorization: `Bearer ${tokenJson.access_token}`,
        },
      },
    );

    const userInfo = (await userInfoResponse.json()) as LinkedInUserInfo;

    const existingAccount = await getIntegrationAccountByPlatform({
      userId: session.user.id,
      platform: "linkedin",
    });

    const previousCredentials =
      loadIntegrationCredentials<LinkedInTokenResponse>(existingAccount) ?? {};

    const credentials = {
      accessToken: tokenJson.access_token ?? previousCredentials.access_token,
      refreshToken:
        tokenJson.refresh_token ?? previousCredentials.refresh_token ?? null,
      expiresAt,
    };

    const externalId =
      userInfo.sub ?? existingAccount?.externalId ?? session.user.id;

    const displayName =
      userInfo.name ?? existingAccount?.displayName ?? "LinkedIn";

    const metadata = {
      email: userInfo.email ?? null,
      name: userInfo.name ?? null,
      picture: userInfo.picture ?? null,
    };

    const account = await upsertIntegrationAccount({
      userId: session.user.id,
      platform: "linkedin",
      externalId,
      displayName,
      credentials,
      metadata,
      status: "active",
    });

    // Attach or create bot for insights ingestion
    const existingAccounts = await getIntegrationAccountsByUserId({
      userId: session.user.id,
    });
    const associatedBot = existingAccounts.find(
      (item) => item.id === account.id,
    )?.bot;

    if (associatedBot) {
      await updateBot(associatedBot.id, {
        name: associatedBot.name ?? `LinkedIn · ${displayName}`,
        description:
          associatedBot.description ??
          "Automatically created through LinkedIn authorization",
        adapter: "linkedin",
        adapterConfig: {},
        enable: true,
      });
    } else {
      await createBot({
        name: `LinkedIn · ${displayName}`,
        description: "Automatically created through LinkedIn authorization",
        adapter: "linkedin",
        adapterConfig: {},
        enable: true,
        userId: session.user.id,
        platformAccountId: account.id,
      });
    }

    return NextResponse.redirect(buildRedirectUrl(redirectTarget, "success"));
  } catch (error) {
    console.error("[linkedin] Callback handling failed", error);
    return NextResponse.redirect(
      buildRedirectUrl(
        redirectTarget,
        "error",
        error instanceof AppError
          ? error.message
          : "LinkedIn authorization failed.",
      ),
    );
  }
}
