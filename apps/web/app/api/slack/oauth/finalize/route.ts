/**
 * Slack OAuth Finalize endpoint (public API, no authentication required)
 *
 * For Tauri local version:
 * - Extract userId from state
 * - Exchange code → token
 * - Get workspace information
 * - Create integration account in cloud database
 */

import { type NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/queries";
import { integrationAccounts } from "@/lib/db/schema";
import { encryptPayload } from "@/lib/db/queries";
import { withRateLimit, RateLimitPresets } from "@/lib/rate-limit/middleware";
import { auth } from "@/app/(auth)/auth";
import { eq } from "drizzle-orm";

const SLACK_API_BASE = "https://slack.com/api";

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

/**
 * POST /api/slack/oauth/finalize
 */
export async function POST(request: NextRequest) {
  // Rate limiting: OAuth preset (20 requests/minute)
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
  };

  const { code, state } = payload;

  if (!code || !state) {
    return NextResponse.json(
      { error: "Missing required parameters: code or state" },
      { status: 400 },
    );
  }

  try {
    // Get user ID (supports two modes)
    // 1. Tauri local version: Extract userId from state parameter
    // 2. Web version: Get userId from session
    let userId = extractUserId(state);

    if (userId === "local") {
      // Web version: Get from session
      const session = await auth();
      if (!session?.user) {
        return NextResponse.json(
          { error: "Unauthorized", message: "You must be logged in" },
          { status: 401 },
        );
      }
      userId = session.user.id;
      console.log(
        "[Slack OAuth Finalize] Web mode: userId from session:",
        userId,
      );
    } else {
      console.log(
        "[Slack OAuth Finalize] Tauri mode: userId from state:",
        userId,
      );
    }

    // 1. Exchange code → token
    const clientId = process.env.SLACK_CLIENT_ID;
    const clientSecret = process.env.SLACK_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error("Slack OAuth is not configured");
    }

    const redirectUri = `${process.env.CLOUD_API_URL || process.env.NEXT_PUBLIC_APP_URL || "https://app.openloomi.ai"}/slack-authorized`;

    const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = (await tokenResponse.json()) as {
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

    if (!tokenData.ok || !tokenData.authed_user?.access_token) {
      throw new Error(
        tokenData.error || "Failed to exchange authorization code",
      );
    }

    const accessToken = tokenData.authed_user.access_token;
    const botAccessToken = tokenData.bot?.access_token;
    const teamId = tokenData.team?.id;
    const teamName = tokenData.team?.name;

    console.log("[Slack OAuth Finalize] Team:", teamName);

    // 2. Get workspace information (if needed)
    let workspaceName = teamName;
    if (!workspaceName) {
      const teamInfoResponse = await fetch(`${SLACK_API_BASE}/team.info`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      const teamInfoData = await teamInfoResponse.json();
      if (teamInfoData.ok && teamInfoData.team) {
        workspaceName = teamInfoData.team.name;
      }
    }

    // 3. Create or update integration account in cloud database
    const externalId = tokenData.authed_user.id || teamId || randomUUID();

    // Check if account already exists
    const existingAccounts = await db
      .select()
      .from(integrationAccounts)
      .where(eq(integrationAccounts.userId, userId))
      .where(eq(integrationAccounts.platform, "slack"))
      .where(eq(integrationAccounts.externalId, externalId))
      .limit(1);

    const encryptedCredentials = encryptPayload({
      accessToken,
      botAccessToken,
      refreshToken: tokenData.refresh_token || null,
    });

    let accountId: string;

    if (existingAccounts.length > 0) {
      // Update existing account
      accountId = existingAccounts[0].id;
      await db
        .update(integrationAccounts)
        .set({
          displayName: workspaceName || "Slack Workspace",
          credentialsEncrypted: encryptedCredentials,
          metadata: JSON.stringify({
            teamId,
            teamName: workspaceName,
            botId: tokenData.bot?.bot_id,
          }),
          status: "active",
          updatedAt: new Date(),
        })
        .where(eq(integrationAccounts.id, accountId));

      console.log(
        "[Slack OAuth Finalize] ✓ Updated integration account:",
        accountId,
      );
    } else {
      // Create new account
      accountId = randomUUID();

      await db.insert(integrationAccounts).values({
        id: accountId,
        userId,
        platform: "slack",
        externalId,
        displayName: workspaceName || "Slack Workspace",
        credentialsEncrypted: encryptedCredentials,
        metadata: JSON.stringify({
          teamId,
          teamName: workspaceName,
          botId: tokenData.bot?.bot_id,
        }),
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      console.log(
        "[Slack OAuth Finalize] ✓ Created integration account:",
        accountId,
      );
    }

    return NextResponse.json(
      {
        success: true,
        accountId,
        workspaceName,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[Slack OAuth Finalize] Error:", error);
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
