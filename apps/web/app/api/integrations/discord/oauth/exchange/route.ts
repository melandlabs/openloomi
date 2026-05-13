/**
 * Discord OAuth Exchange endpoint (public API, no authentication required)
 *
 * For local version integration OAuth:
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
 * POST /api/integrations/discord/oauth/exchange
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

  console.log("[Discord OAuth Exchange] userId:", userId);

  // Check configuration
  const clientId =
    process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID ||
    process.env.DISCORD_CLIENT_ID ||
    "";
  const clientSecret = process.env.DISCORD_CLIENT_SECRET || "";

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Discord OAuth is not configured" },
      { status: 500 },
    );
  }

  // Exchange code → token
  const redirectUri = `${process.env.CLOUD_API_URL || process.env.NEXT_PUBLIC_APP_URL || "https://app.openloomi.ai"}/discord-authorized`;

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

  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };

  if (data.error) {
    console.error("[Discord OAuth Exchange] Error:", data.error);
    return NextResponse.json(
      { error: data.error || "Failed to exchange authorization code" },
      { status: 400 },
    );
  }

  // Store to cloud database (userId=local)
  // Token returned by Discord is bot token, need to create account
  const accountId = randomUUID();
  const accessToken = data.access_token;

  const credentialsEncrypted = encryptPayload({
    accessToken,
    refreshToken: data.refresh_token,
  });

  await db
    .insert(integrationAccounts)
    .values({
      id: accountId,
      userId,
      platform: "discord",
      externalId: "discord-bot", // Discord bot has no guild ID
      displayName: "Discord Bot",
      credentialsEncrypted,
      metadata: JSON.stringify({
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
    `[Discord OAuth Exchange] ✓ Stored account ${accountId} for user ${userId}`,
  );

  // Return token information
  return NextResponse.json({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    userId: userId,
  });
}
