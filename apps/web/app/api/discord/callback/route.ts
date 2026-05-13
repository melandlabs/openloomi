/**
 * Discord OAuth callback handler (server-side)
 *
 * Responsibilities:
 * 1. Receive OAuth callback from Discord (GET request)
 * 2. Validate state parameter
 * 3. Exchange code for token
 * 4. Store to cloud database
 * 5. Return HTML success page
 *
 * Cloud hybrid mode:
 * - Web: direct handling
 * - Tauri desktop: forward to cloud
 *
 * Note: This handler is for Tauri mode cloud proxy flow
 */

import { type NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/queries";
import { integrationAccounts } from "@/lib/db/schema";
import {
  getOAuthState,
  deleteOAuthState,
} from "@/lib/integrations/state-manager";
import { encryptPayload } from "@/lib/db/queries";
import { getCloudUrl } from "@/lib/auth/cloud-proxy";
import { isTauriMode } from "@/lib/env/constants";

/**
 * Exchange Discord OAuth code
 */
async function exchangeDiscordCode(code: string, redirectUri: string) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Discord OAuth is not configured");
  }

  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error(
      `Discord OAuth failed: ${data.error_description || data.error}`,
    );
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresIn: data.expires_in || null,
    scope: data.scope || null,
  };
}

/**
 * Generate user ID (extract from state or use default value)
 */
function extractUserId(state: string): string {
  // state format: {userId}:{uuid}
  const parts = state.split(":");
  if (parts.length >= 2) {
    return parts[0];
  }
  // fallback: use UUID
  return "system";
}

/**
 * GET /api/discord/callback
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const guildId = searchParams.get("guild_id");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  // Tauri desktop: forward to cloud
  if (isTauriMode()) {
    try {
      const cloudUrl = getCloudUrl();
      const redirectUrl = `${cloudUrl}/api/discord/callback?${searchParams.toString()}`;

      console.log("[DiscordCallback] Forwarding to cloud:", redirectUrl);

      // Forward request to cloud
      const response = await fetch(redirectUrl);
      const html = await response.text();

      return new NextResponse(html, {
        status: response.status,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (error) {
      console.error("[DiscordCallback] Failed to forward to cloud:", error);
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

  // Web: direct handling
  // Handle error cases
  if (error) {
    console.error("[DiscordCallback] OAuth error:", error, errorDescription);
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
            <p>${errorDescription || error || "An unknown error occurred"}</p>
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
  if (!code || !state) {
    console.error("[DiscordCallback] Missing required parameters");
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

  try {
    // 1. Extract user ID from state
    const userId = extractUserId(state);

    // 2. Validate state (if exists)
    const stateData = await getOAuthState(userId, state);
    let redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || "https://app.openloomi.ai"}/discord-authorized`;

    if (stateData) {
      redirectUri = stateData.redirectUri || redirectUri;
    }

    // 3. Exchange code for token
    const tokens = await exchangeDiscordCode(code, redirectUri);

    // 4. Generate account ID
    const accountId = randomUUID();

    // 5. Encrypt credentials
    const credentialsEncrypted = encryptPayload({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });

    // 6. Store to cloud database
    await db
      .insert(integrationAccounts)
      .values({
        id: accountId,
        userId,
        platform: "discord",
        externalId: guildId || "",
        displayName: guildId ? `Discord Server ${guildId}` : "Discord Server",
        credentialsEncrypted,
        metadata: JSON.stringify({
          guildId,
          syncedAt: new Date().toISOString(),
        }),
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: integrationAccounts.id,
        set: {
          credentialsEncrypted,
          status: "active",
          updatedAt: new Date(),
        },
      });

    console.log(
      `[DiscordCallback] ✓ Stored account ${accountId} for user ${userId}`,
    );

    // 7. Delete state
    if (stateData) {
      await deleteOAuthState(userId, state);
    }

    // 8. Return success page
    return new NextResponse(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authorization Successful</title>
          <style>
            body { font-family: 'Noto Sans SC', 'PingFang SC', 'Helvetica Neue', -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
            .container { text-align: center; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; }
            h1 { color: #5865F2; margin-bottom: 20px; }
            p { color: #616061; line-height: 1.6; }
            .spinner { border: 3px solid #f3f3f3; border-top: 3px solid #5865F2; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 20px auto; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Authorization Successful!</h1>
            <p>Your Discord server has been connected.</p>
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
    console.error("[DiscordCallback] Failed to store account:", error);

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
