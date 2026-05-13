import { type NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { decryptToken } from "@openloomi/security/token-encryption";
import { getApplicationBaseUrl } from "@/lib/env";
import {
  getIntegrationAccountByPlatform,
  getIntegrationAccountsByUserId,
  loadIntegrationCredentials,
  createBot,
  updateBot,
  db,
  encryptPayload,
} from "@/lib/db/queries";
import { integrationAccounts } from "@/lib/db/schema";
import { ensureRedis, setLoginSession } from "@/lib/session/context";
import { getCloudUrl } from "@/lib/auth/cloud-proxy";
import { isTauriMode } from "@/lib/env/constants";

type XStatePayload = {
  userId: string;
  ts: number;
  nonce: string;
  returnTo?: string;
  codeVerifier?: string;
  loginSessionId?: string;
};

type XTokenResponse = {
  token_type?: string;
  expires_in?: number;
  access_token?: string;
  scope?: string;
  refresh_token?: string;
};

export async function GET(request: NextRequest) {
  console.log("[X Callback] Received callback request");
  const baseUrl = getApplicationBaseUrl();

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const errorParam = searchParams.get("error");

  console.log(
    "[X Callback] code:",
    !!code,
    "state:",
    !!stateParam,
    "error:",
    errorParam,
  );

  // Tauri desktop: forward to cloud
  if (isTauriMode()) {
    try {
      const cloudUrl = getCloudUrl();
      const redirectUrl = `${cloudUrl}/api/x/callback?${searchParams.toString()}`;

      console.log("[X Callback] Forwarding to cloud:", redirectUrl);

      const response = await fetch(redirectUrl);
      const html = await response.text();

      return new NextResponse(html, {
        status: response.status,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (error) {
      console.error("[X Callback] Failed to forward to cloud:", error);
      return new NextResponse(
        `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Authorization Failed</title>
            <style>
              body { font-family: 'Noto Sans SC', 'PingFang SC', 'Helvetica Neue', -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
              .container { text-align: center; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; }
              h1 { color: #e74c3c; margin-bottom: 20px; }
              p { color: #616061; line-height: 1.6; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Authorization Failed</h1>
              <p>Failed to connect to cloud service. Please try again.</p>
            </div>
          </body>
        </html>
      `,
        {
          status: 503,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        },
      );
    }
  }

  // Web side: handle directly
  // Handle error cases
  if (errorParam) {
    console.log("[X Callback] Error from Twitter:", errorParam);
    return new NextResponse(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authorization Failed</title>
          <style>
            body { font-family: 'Noto Sans SC', 'PingFang SC', 'Helvetica Neue', -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
            .container { text-align: center; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; }
            h1 { color: #e74c3c; margin-bottom: 20px; }
            p { color: #616061; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Authorization Failed</h1>
            <p>${errorParam || "An unknown error occurred"}</p>
            <p>You can close this window and try again.</p>
          </div>
        </body>
      </html>
    `,
      {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }

  // Validate required parameters
  if (!code || !stateParam) {
    console.log("[X Callback] Missing required parameters");
    return new NextResponse(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Invalid Callback</title>
          <style>
            body { font-family: 'Noto Sans SC', 'PingFang SC', 'Helvetica Neue', -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
            .container { text-align: center; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; }
            h1 { color: #e74c3c; margin-bottom: 20px; }
            p { color: #616061; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Invalid Callback</h1>
            <p>Missing required parameters. Please try again.</p>
          </div>
        </body>
      </html>
    `,
      {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }

  // Parse state and extract userId
  let statePayload: XStatePayload | null = null;
  try {
    statePayload = JSON.parse(decryptToken(stateParam)) as XStatePayload;
  } catch (error) {
    console.error("[X] Failed to decode state", error);
    return new NextResponse(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Invalid State</title>
          <style>
            body { font-family: 'Noto Sans SC', 'PingFang SC', 'Helvetica Neue', -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
            .container { text-align: center; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; }
            h1 { color: #e74c3c; margin-bottom: 20px; }
            p { color: #616061; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Invalid Authorization State</h1>
            <p>Please try again.</p>
          </div>
        </body>
      </html>
    `,
      {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }

  // Extract userId from state payload (no session required)
  const userId = statePayload?.userId;
  if (!userId) {
    console.log("[X Callback] No userId in state");
    return new NextResponse(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Invalid State</title>
          <style>
            body { font-family: 'Noto Sans SC', 'PingFang SC', 'Helvetica Neue', -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
            .container { text-align: center; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; }
            h1 { color: #e74c3c; margin-bottom: 20px; }
            p { color: #616061; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Invalid Authorization State</h1>
            <p>Missing user information. Please try again.</p>
          </div>
        </body>
      </html>
    `,
      {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }

  // Validate if state has expired
  const maxStateAgeMs = 10 * 60 * 1000;
  if (Date.now() - (statePayload?.ts || 0) > maxStateAgeMs) {
    console.log("[X Callback] State expired");
    return new NextResponse(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authorization Expired</title>
          <style>
            body { font-family: 'Noto Sans SC', 'PingFang SC', 'Helvetica Neue', -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
            .container { text-align: center; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; }
            h1 { color: #e74c3c; margin-bottom: 20px; }
            p { color: #616061; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Authorization Expired</h1>
            <p>Please try again.</p>
          </div>
        </body>
      </html>
    `,
      {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }

  const clientId = process.env.TWITTER_CLIENT_ID;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.log("[X Callback] Twitter credentials not configured");
    return new NextResponse(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Configuration Error</title>
          <style>
            body { font-family: 'Noto Sans SC', 'PingFang SC', 'Helvetica Neue', -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
            .container { text-align: center; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; }
            h1 { color: #e74c3c; margin-bottom: 20px; }
            p { color: #616061; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Configuration Error</h1>
            <p>X integration is not configured.</p>
          </div>
        </body>
      </html>
    `,
      {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }

  console.log(
    "[X Callback] All validations passed, exchanging code for token...",
  );

  try {
    await ensureRedis();

    const redirectUri =
      process.env.TWITTER_REDIRECT_URI ?? `${baseUrl}/api/x/callback`;
    const codeVerifier = statePayload.codeVerifier;

    const tokenParams = new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier ?? "",
    });

    const tokenResponse = await fetch(
      "https://api.twitter.com/2/oauth2/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        },
        body: tokenParams,
      },
    );

    console.log(
      "[X Callback] Token exchange response status:",
      tokenResponse.status,
    );
    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      console.log("[X Callback] Token exchange failed:", text);
      throw new Error(`Token exchange failed: ${text}`);
    }

    const tokenJson = (await tokenResponse.json()) as XTokenResponse;
    console.log(
      "[X Callback] Token received, has access_token:",
      !!tokenJson.access_token,
    );
    console.log("[X Callback] Granted scopes:", tokenJson.scope);
    if (!tokenJson.access_token) {
      throw new Error("X did not return an access token.");
    }

    // Fetch user info
    console.log("[X Callback] Fetching user info from Twitter...");
    const userResp = await fetch("https://api.twitter.com/2/users/me", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    const userJson = (await userResp.json()) as {
      data?: { id?: string; username?: string; name?: string };
    };
    console.log("[X Callback] User info:", userJson);

    const xUserId = userJson.data?.id ?? null;
    const username = userJson.data?.username ?? null;
    const expiresAt = tokenJson.expires_in
      ? Date.now() + tokenJson.expires_in * 1000
      : null;

    // Get previous credentials (if exists)
    const existingAccount = await getIntegrationAccountByPlatform({
      userId,
      platform: "twitter",
    });
    const previousCredentials =
      loadIntegrationCredentials<{
        accessToken?: string | null;
        refreshToken?: string | null;
        expiresAt?: number | null;
        userId?: string | null;
        username?: string | null;
      }>(existingAccount) ?? {};

    console.log(
      `[X Callback] Storing for app userId=${userId}, X userId=${xUserId}, username=${username}`,
    );
    const credentials = {
      accessToken:
        tokenJson.access_token ?? previousCredentials.accessToken ?? null,
      refreshToken:
        tokenJson.refresh_token ?? previousCredentials.refreshToken ?? null,
      expiresAt: expiresAt ?? previousCredentials.expiresAt ?? null,
      userId: xUserId ?? previousCredentials.userId ?? null,
      username: username ?? previousCredentials.username ?? null,
    };

    const externalId = xUserId ?? existingAccount?.externalId ?? userId;
    const displayName =
      username ?? userJson.data?.name ?? existingAccount?.displayName ?? "X";

    const metadata = {
      userId: xUserId,
      username,
    };

    // Generate account ID
    const accountId = existingAccount?.id || randomUUID();

    // Encrypt credentials
    const credentialsEncrypted = encryptPayload(credentials);

    // Store to cloud database
    await db
      .insert(integrationAccounts)
      .values({
        id: accountId,
        userId,
        platform: "twitter",
        externalId,
        displayName,
        credentialsEncrypted,
        metadata: JSON.stringify(metadata),
        status: "active",
        createdAt: existingAccount?.createdAt || new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: integrationAccounts.id,
        set: {
          credentialsEncrypted,
          externalId,
          displayName,
          metadata: JSON.stringify(metadata),
          status: "active",
          updatedAt: new Date(),
        },
      });

    console.log(
      `[X Callback] ✓ Stored account ${accountId} for user ${userId}`,
    );

    // Attach or create bot
    const existingAccounts = await getIntegrationAccountsByUserId({
      userId,
    });
    const associatedBot = existingAccounts.find(
      (item) => item.id === accountId,
    )?.bot;

    if (associatedBot) {
      await updateBot(associatedBot.id, {
        name: associatedBot.name ?? `X · ${displayName}`,
        description:
          associatedBot.description ??
          "Automatically created through X authorization",
        adapter: "twitter",
        adapterConfig: {},
        enable: true,
      });
    } else {
      await createBot({
        name: `X · ${displayName}`,
        description: "Automatically created through X authorization",
        adapter: "twitter",
        adapterConfig: {},
        enable: true,
        userId,
        platformAccountId: accountId,
      });
    }

    // Update login session status to completed (for polling)
    if (statePayload?.loginSessionId) {
      await setLoginSession(statePayload.loginSessionId, {
        provider: "twitter",
        phone: userId,
        status: "completed",
        result: { id: accountId },
        createdAt: Date.now(),
      });
    }

    // Return success page
    return new NextResponse(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authorization Successful</title>
          <style>
            body { font-family: 'Noto Sans SC', 'PingFang SC', 'Helvetica Neue', -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
            .container { text-align: center; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; }
            h1 { color: #1da1f2; margin-bottom: 20px; }
            p { color: #616061; line-height: 1.6; }
            .spinner { border: 3px solid #f3f3f3; border-top: 3px solid #1da1f2; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 20px auto; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Authorization Successful!</h1>
            <p>Your X account has been connected.</p>
            <p>You can close this window and return to the app.</p>
          </div>
        </body>
      </html>
    `,
      {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  } catch (error) {
    // Update login session status to error (for polling)
    if (statePayload?.loginSessionId) {
      await setLoginSession(statePayload.loginSessionId, {
        provider: "twitter",
        phone: userId,
        status: "error",
        error:
          error instanceof Error ? error.message : "X authorization failed.",
        createdAt: Date.now(),
      });
    }

    console.error("[X] Callback handling failed", error);
    return new NextResponse(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authorization Failed</title>
          <style>
            body { font-family: 'Noto Sans SC', 'PingFang SC', 'Helvetica Neue', -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
            .container { text-align: center; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; }
            h1 { color: #e74c3c; margin-bottom: 20px; }
            p { color: #616061; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Authorization Failed</h1>
            <p>Failed to complete the authorization. Please try again.</p>
            <p style="font-size: 12px; color: #999;">Error: ${error instanceof Error ? error.message : "Unknown error"}</p>
          </div>
        </body>
      </html>
    `,
      {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }
}
