/**
 * Discord OAuth Finalize endpoint (public API, no authentication required)
 *
 * For Tauri local version:
 * - Extract userId from state
 * - Exchange code for token
 * - Get server list
 * - Select first server (or user's selected server)
 * - Create integration account in cloud database
 */

import { type NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/queries";
import { integrationAccounts } from "@/lib/db/schema";
import { encryptPayload } from "@/lib/db/queries";
import { withRateLimit, RateLimitPresets } from "@/lib/rate-limit/middleware";
import { auth } from "@/app/(auth)/auth";
import { eq, and } from "drizzle-orm";

const DISCORD_API_BASE = "https://discord.com/api/v10";

/**
 * Extract user ID from state
 */
function extractUserId(state: string): string {
  const parts = state.split(":");
  if (parts.length >= 2) {
    return parts[0];
  }
  return "local";
}

type DiscordGuild = {
  id: string;
  name: string;
  owner: boolean;
  permissions: string;
  features: string[];
  icon: string | null;
};

/**
 * POST /api/discord/oauth/finalize
 */
export async function POST(request: NextRequest) {
  // Rate limit: OAuth preset (20 requests/minute)
  const rateLimitResult = await withRateLimit(request, RateLimitPresets.oauth);

  if (!rateLimitResult.success) {
    return NextResponse.json(
      {
        error: "Too many requests",
        message: "Please try again later",
      },
      {
        status: 429,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const payload = (await request.json().catch(() => ({}))) as {
    code?: string;
    state?: string;
    guildId?: string;
  };

  const { code, state, guildId } = payload;

  if (!code || !state) {
    return NextResponse.json(
      { error: "Missing required parameters: code or state" },
      { status: 400 },
    );
  }

  try {
    // Get user ID (supports two modes)
    let userId = extractUserId(state);

    if (userId === "local") {
      // Web version: get from session
      const session = await auth();
      if (!session?.user) {
        return NextResponse.json(
          { error: "Unauthorized", message: "You must be logged in" },
          { status: 401 },
        );
      }
      userId = session.user.id;
      console.log(
        "[Discord OAuth Finalize] Web mode: userId from session:",
        userId,
      );
    } else {
      console.log(
        "[Discord OAuth Finalize] Tauri mode: userId from state:",
        userId,
      );
    }

    // 1. Exchange code for token
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error("Discord OAuth is not configured");
    }

    const redirectUri = `${process.env.CLOUD_API_URL || process.env.NEXT_PUBLIC_APP_URL || "https://app.openloomi.ai"}/discord-authorized`;

    const tokenResponse = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      refresh_token?: string;
      scope?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenData.access_token) {
      console.error("[Discord OAuth Finalize] Token exchange failed:", {
        status: tokenResponse.status,
        body: tokenData,
        redirectUri,
      });
      throw new Error(
        tokenData.error ||
          tokenData.error_description ||
          "Failed to exchange authorization code",
      );
    }

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;

    console.log("[Discord OAuth Finalize] Token exchange success", {
      userId,
      redirectUri,
    });

    // 2. Get user's server list
    const guildsResponse = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!guildsResponse.ok) {
      throw new Error("Failed to fetch Discord guilds");
    }

    const guildsRaw = (await guildsResponse.json()) as DiscordGuild[];
    // Convert snowflake IDs to strings to prevent precision loss
    // Discord snowflake IDs are 64-bit integers that exceed JS safe integer range
    const guilds: DiscordGuild[] = guildsRaw.map((g) => ({
      ...g,
      id: String(g.id),
    }));

    if (!guilds || guilds.length === 0) {
      throw new Error("No Discord servers found");
    }

    // 3. Select server (prefer user's selection, otherwise first one)
    const selectedGuildId = guildId || guilds[0].id;
    const selectedGuild =
      guilds.find((g) => g.id === selectedGuildId) || guilds[0];
    const guildName = selectedGuild.name;

    console.log(
      "[Discord OAuth Finalize] Guild:",
      guildName,
      "ID:",
      selectedGuild.id,
    );

    // 4. Create or update integration account in cloud database
    // Check if account already exists
    console.log(
      "[Discord OAuth Finalize] SELECT with externalId:",
      selectedGuild.id,
      "type:",
      typeof selectedGuild.id,
    );
    const existingAccounts = await db
      .select()
      .from(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.platform, "discord"),
          eq(integrationAccounts.externalId, selectedGuild.id),
        ),
      )
      .limit(1);

    console.log(
      "[Discord OAuth Finalize] SELECT result:",
      existingAccounts.length,
      "accounts, userId:",
      userId,
      "externalId:",
      selectedGuild.id,
      existingAccounts.length > 0
        ? `found: userId=${existingAccounts[0].userId} id=${existingAccounts[0].id}`
        : "NOT FOUND - will INSERT",
    );

    const encryptedCredentials = encryptPayload({
      accessToken,
      refreshToken,
    });

    let accountId: string;

    if (existingAccounts.length > 0) {
      // Update existing account
      accountId = existingAccounts[0].id;
      await db
        .update(integrationAccounts)
        .set({
          displayName: guildName,
          credentialsEncrypted: encryptedCredentials,
          metadata: JSON.stringify({
            guildId: selectedGuild.id,
            guildName: selectedGuild.name,
            icon: selectedGuild.icon,
            owner: selectedGuild.owner,
          }),
          status: "active",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(integrationAccounts.userId, userId),
            eq(integrationAccounts.platform, "discord"),
            eq(integrationAccounts.externalId, selectedGuild.id),
          ),
        );

      console.log(
        "[Discord OAuth Finalize] ✓ Updated integration account:",
        accountId,
      );
    } else {
      // Create new account
      accountId = randomUUID();

      console.log("[Discord OAuth Finalize] INSERTING new account:", {
        accountId,
        userId,
        platform: "discord",
        externalId: selectedGuild.id,
        guildName,
      });

      try {
        await db.insert(integrationAccounts).values({
          id: accountId,
          userId,
          platform: "discord",
          externalId: selectedGuild.id,
          displayName: guildName,
          credentialsEncrypted: encryptedCredentials,
          metadata: JSON.stringify({
            guildId: selectedGuild.id,
            guildName: selectedGuild.name,
            icon: selectedGuild.icon,
            owner: selectedGuild.owner,
          }),
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        console.log(
          "[Discord OAuth Finalize] ✓ Created integration account:",
          accountId,
        );
      } catch (insertErr) {
        console.error(
          "[Discord OAuth Finalize] INSERT failed:",
          insertErr,
          "values:",
          { accountId, userId, externalId: selectedGuild.id },
        );
        throw insertErr;
      }
    }

    return NextResponse.json(
      {
        success: true,
        accountId,
        guildId: selectedGuild.id,
        guildName,
        guilds,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[Discord OAuth Finalize] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to complete authorization",
      },
      { status: 500 },
    );
  }
}
