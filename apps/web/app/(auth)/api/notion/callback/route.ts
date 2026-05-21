import { Buffer } from "node:buffer";

import { NextResponse } from "next/server";

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
import { isTauriMode } from "@/lib/env/constants";
import { getCloudUrl } from "@/lib/auth/cloud-proxy";

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

export async function GET(request: Request) {
  console.log("[notion] Callback received");
  const baseUrl = getApplicationBaseUrl();

  // Tauri desktop: forward to cloud
  if (isTauriMode()) {
    try {
      const cloudUrl = getCloudUrl();
      const url = new URL(request.url);
      const redirectUrl = `${cloudUrl}/api/notion/callback?${url.searchParams.toString()}`;

      console.log(
        "[notion] Tauri mode detected, forwarding to cloud:",
        redirectUrl,
      );

      const response = await fetch(redirectUrl);
      const html = await response.text();

      return new NextResponse(html, {
        status: response.status,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (error) {
      console.error("[notion] Failed to forward to cloud:", error);
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

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    console.log("[notion] Callback cancelled:", errorParam);
    return new NextResponse(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authorization Cancelled</title>
          <style>
            body { font-family: 'Noto Sans SC', 'PingFang SC', 'Helvetica Neue', -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
            .container { text-align: center; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; }
            h1 { color: #f59e0b; margin-bottom: 20px; }
            p { color: #616061; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Authorization Cancelled</h1>
            <p>${errorParam || "Authorization was cancelled."}</p>
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

  if (!stateParam) {
    console.log("[notion] Missing state parameter");
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
            p { color: #616061; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Invalid Callback</h1>
            <p>Missing authorization state. Please try again.</p>
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

  let statePayload: {
    userId: string;
    ts: number;
    returnTo?: string;
    nonce?: string;
  } | null = null;
  try {
    statePayload = JSON.parse(decryptToken(stateParam));
  } catch (error) {
    console.error("[notion] Failed to decode state", error);
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
            p { color: #616061; line-height: 1.6; }
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

  if (!code) {
    console.log("[notion] Missing authorization code");
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
            p { color: #616061; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Invalid Callback</h1>
            <p>Missing authorization code from Notion.</p>
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

  const maxStateAgeMs = 10 * 60 * 1000;
  if (
    !statePayload ||
    !statePayload.userId ||
    Date.now() - statePayload.ts > maxStateAgeMs
  ) {
    console.log("[notion] State expired or invalid");
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
            p { color: #616061; line-height: 1.6; }
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

  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.log("[notion] Notion credentials not configured");
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
            p { color: #616061; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Configuration Error</h1>
            <p>Notion integration is not configured.</p>
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

  console.log("[notion] All validations passed, exchanging code for token...");

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
      console.log("[notion] Token exchange failed:", reason);
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
              <p>${reason}</p>
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

    const data = (await tokenResponse.json()) as NotionTokenResponse;
    if (!data.access_token) {
      console.log("[notion] No access token returned");
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
              <p>Notion did not return an access token.</p>
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
      userId: statePayload.userId,
      platform: "notion",
    });

    const metadata = mergeNotionMetadata(existing?.metadata as any, {
      workspaceId: data.workspace_id ?? null,
      workspaceName: data.workspace_name ?? null,
      workspaceIcon: data.workspace_icon ?? null,
    });

    await upsertIntegrationAccount({
      userId: statePayload.userId,
      platform: "notion",
      externalId: data.workspace_id ?? data.bot_id ?? statePayload.userId,
      displayName: data.workspace_name ?? "Notion",
      credentials,
      metadata,
    });

    console.log(
      "[notion] Successfully stored account for user:",
      statePayload.userId,
    );

    return new NextResponse(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authorization Successful</title>
          <style>
            body { font-family: 'Noto Sans SC', 'PingFang SC', 'Helvetica Neue', -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
            .container { text-align: center; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; }
            h1 { color: #10b981; margin-bottom: 20px; }
            p { color: #616061; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Authorization Successful!</h1>
            <p>Your Notion workspace has been connected.</p>
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
    console.error("[notion] Callback handling failed", error);
    const message =
      error instanceof AppError
        ? error.message
        : "Failed to complete the authorization. Please try again.";
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
            .error-detail { font-size: 12px; color: #999; margin-top: 10px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Authorization Failed</h1>
            <p>Failed to complete the authorization. Please try again.</p>
            <p class="error-detail">Error: ${message}</p>
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
