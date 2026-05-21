import { NextResponse } from "next/server";

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

export const runtime = "nodejs";

function buildHtmlPage(
  title: string,
  heading: string,
  message: string,
  headingColor = "#e74c3c",
) {
  return `
<!DOCTYPE html>
<html>
  <head>
    <title>${title}</title>
    <style>
      body { font-family: 'Noto Sans SC', 'PingFang SC', 'Helvetica Neue', -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
      .container { text-align: center; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; }
      h1 { color: ${headingColor}; margin-bottom: 20px; }
      p { color: #616061; line-height: 1.6; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>${heading}</h1>
      <p>${message}</p>
    </div>
  </body>
</html>
`.trim();
}

export async function GET(request: Request) {
  console.log("[linkedin] Callback received");

  const baseUrl = getApplicationBaseUrl();
  const defaultRedirect = `${baseUrl}/?page=profile`;

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    console.log("[linkedin] Callback cancelled:", errorParam);
    const message =
      errorParam === "user_cancelled_login"
        ? "Access was cancelled."
        : "Authorization failed.";
    return new NextResponse(
      buildHtmlPage(
        "Authorization Cancelled",
        "Authorization Cancelled",
        message,
        "#f59e0b",
      ),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  if (!stateParam) {
    console.log("[linkedin] Missing state parameter");
    return new NextResponse(
      buildHtmlPage(
        "Invalid Callback",
        "Invalid Callback",
        "Missing authorization state. Please try again.",
      ),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  let statePayload: LinkedInStatePayload | null = null;

  try {
    const decoded = decryptToken(stateParam);
    statePayload = JSON.parse(decoded) as LinkedInStatePayload;
  } catch (error) {
    console.error("[linkedin] Failed to decode state", error);
    return new NextResponse(
      buildHtmlPage(
        "Invalid State",
        "Invalid Authorization State",
        "Please try again.",
      ),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const redirectTarget = statePayload?.returnTo?.startsWith("http")
    ? statePayload.returnTo
    : defaultRedirect;

  if (!code) {
    console.log("[linkedin] Missing authorization code");
    return new NextResponse(
      buildHtmlPage(
        "Invalid Callback",
        "Invalid Callback",
        "Missing authorization code from LinkedIn.",
      ),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const maxStateAgeMs = 10 * 60 * 1000;
  if (
    !statePayload ||
    !statePayload.userId ||
    Date.now() - statePayload.ts > maxStateAgeMs
  ) {
    console.log("[linkedin] State expired or invalid");
    return new NextResponse(
      buildHtmlPage(
        "Authorization Expired",
        "Authorization Expired",
        "Please try again.",
      ),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.log("[linkedin] LinkedIn credentials not configured");
    return new NextResponse(
      buildHtmlPage(
        "Configuration Error",
        "Configuration Error",
        "LinkedIn integration is not configured.",
      ),
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  console.log(
    "[linkedin] All validations passed, exchanging code for token...",
  );

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
      userId: statePayload.userId,
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
      userInfo.sub ?? existingAccount?.externalId ?? statePayload.userId;

    const displayName =
      userInfo.name ?? existingAccount?.displayName ?? "LinkedIn";

    const metadata = {
      email: userInfo.email ?? null,
      name: userInfo.name ?? null,
      picture: userInfo.picture ?? null,
    };

    const account = await upsertIntegrationAccount({
      userId: statePayload.userId,
      platform: "linkedin",
      externalId,
      displayName,
      credentials,
      metadata,
      status: "active",
    });

    const existingAccounts = await getIntegrationAccountsByUserId({
      userId: statePayload.userId,
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
        userId: statePayload.userId,
        platformAccountId: account.id,
      });
    }

    console.log(
      "[linkedin] Successfully stored account for user:",
      statePayload.userId,
    );

    return new NextResponse(
      buildHtmlPage(
        "Authorization Successful",
        "Authorization Successful!",
        "Your LinkedIn account has been connected.",
        "#10b981",
      ),
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  } catch (error) {
    console.error("[linkedin] Callback handling failed", error);
    const message =
      error instanceof AppError
        ? error.message
        : "Failed to complete the authorization. Please try again.";
    return new NextResponse(
      buildHtmlPage("Authorization Failed", "Authorization Failed", message),
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}
