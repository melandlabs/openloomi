/**
 * Slack OAuth Exchange endpoint (public API, no authentication required)
 *
 * Used for local version integration OAuth:
 * - No user login required
 * - Exchange code → token
 * - Store to cloud database (userId=local)
 * - Extract user ID from state
 */

import { type NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/queries";
import { integrationAccounts } from "@/lib/db/schema";
import { encryptPayload } from "@/lib/db/queries";

/**
 * Extract user ID from state
 */
function extractUserId(state: string): string {
  const parts = state.split(":");
  if (parts.length >= 2) {
    return parts[0];
  }
  return "system";
}

/**
 * POST /api/integrations/slack/oauth/exchange
 */
export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => ({}))) as {
    code?: string;
    state?: string;
  };

  const { code, state } = payload;

  if (!code || !state) {
    return NextResponse.json(
      { error: "Missing required parameters: code or state" },
      { status: 400 },
    );
  }

  // Extract user ID from state
  const userId = extractUserId(state);

  console.log("[Slack OAuth Exchange] userId:", userId);

  // Check configuration
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Slack OAuth is not configured" },
      { status: 500 },
    );
  }

  // Exchange code → token
  const redirectUri = `${process.env.CLOUD_API_URL || process.env.NEXT_PUBLIC_APP_URL || "https://app.openloomi.ai"}/slack-authorized`;

  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const data = (await response.json()) as {
    ok?: boolean;
    access_token?: string;
    authed_user?: {
      access_token?: string;
      id?: string;
    };
    team?: {
      id?: string;
      name?: string;
    };
    bot?: {
      access_token?: string;
      bot_id?: string;
    };
    refresh_token?: string;
    error?: string;
  };

  if (!data.ok) {
    console.error("[Slack OAuth Exchange] Error:", data.error);
    return NextResponse.json(
      { error: data.error || "Failed to exchange authorization code" },
      { status: 400 },
    );
  }

  // Store to cloud database (userId=local)
  const accountId = randomUUID();
  const accessToken = data.authed_user?.access_token || data.access_token;
  const botAccessToken = data.bot?.access_token;

  const credentialsEncrypted = encryptPayload({
    accessToken,
    botAccessToken,
    refreshToken: data.refresh_token || null,
  });

  await db
    .insert(integrationAccounts)
    .values({
      id: accountId,
      userId,
      platform: "slack",
      externalId: data.team?.id || "",
      displayName: data.team?.name || "Slack Workspace",
      credentialsEncrypted,
      metadata: JSON.stringify({
        teamId: data.team?.id,
        teamName: data.team?.name,
        botId: data.bot?.bot_id,
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
    `[Slack OAuth Exchange] ✓ Stored account ${accountId} for user ${userId}`,
  );

  // Return token information
  return NextResponse.json({
    accessToken,
    teamId: data.team?.id,
    teamName: data.team?.name,
    userId: userId,
  });
}
