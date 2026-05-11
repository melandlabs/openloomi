/**
 * Integration accounts API
 *
 * GET /api/integrations/accounts
 *
 * Local environment: Fetch accounts from cloud and sync to local database
 * Cloud environment: Return account list from cloud database
 */

import type { NextRequest } from "next/server";
import { isTauriMode } from "@/lib/env/constants";
import { authenticateCloudRequest } from "@/lib/auth/cloud-auth";
import { withRateLimit, RateLimitPresets } from "@/lib/rate-limit/middleware";
import { db, createBot, weixinBotHasValidContextToken } from "@/lib/db/queries";
import { integrationAccounts, bot } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

const DEBUG = process.env.NODE_ENV === "development";

export async function GET(request: NextRequest) {
  // Tauri mode: Forward directly to cloud, let cloud verify Bearer token
  if (isTauriMode()) {
    return handleLocalMode(request);
  }

  // Rate limiting: OAuth preset (20 requests/minute)
  const rateLimitResult = await withRateLimit(request, RateLimitPresets.oauth);

  if (!rateLimitResult.success) {
    return new Response(
      JSON.stringify({
        error: "Too many requests",
        message: "Please try again later",
      }),
      {
        status: 429,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Cloud mode: Requires local authentication check
  const user = await authenticateCloudRequest(request);

  if (!user) {
    return new Response(
      JSON.stringify({
        error: "Unauthorized",
        message: "You must be logged in",
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Cloud environment: Return account list from cloud database directly
  return handleCloudMode(user);
}

/**
 * Ensure Bot exists for integration account (create automatically if not exists)
 */
async function ensureBotForAccount(
  cloudAccount: {
    id: string;
    platform: string;
    externalId: string;
    displayName: string;
    metadata: Record<string, unknown> | null;
  },
  localUserId: string,
) {
  // Check if Bot already associated with this integration account
  const existingBot = await db
    .select({ id: bot.id })
    .from(bot)
    .where(eq(bot.platformAccountId, cloudAccount.id))
    .limit(1);

  if (existingBot.length > 0) {
    console.log(
      `[Integrations Accounts] Bot already exists for ${cloudAccount.platform} account ${cloudAccount.id}`,
    );
    return;
  }

  // Check if Bot already exists for same platform (match by adapter name)
  // Map platform name to adapter name
  const platformToAdapter: Record<string, string> = {
    slack: "slack",
    telegram: "telegram",
    discord: "discord",
    whatsapp: "whatsapp",
    rss: "rss",
    manual: "manual",
    twitter: "twitter",
  };

  const adapter = platformToAdapter[cloudAccount.platform];
  if (!adapter) {
    console.log(
      `[Integrations Accounts] Unknown platform ${cloudAccount.platform}, skipping bot creation`,
    );
    return;
  }

  // Create new Bot
  const botName = `${cloudAccount.displayName} (${cloudAccount.platform})`;
  const botDescription = `Bot for ${cloudAccount.platform} account: ${cloudAccount.displayName}`;

  try {
    const botId = await createBot({
      name: botName,
      userId: localUserId,
      description: botDescription,
      adapter: adapter,
      adapterConfig: {},
      enable: true, // Default enabled
      platformAccountId: cloudAccount.id,
    });
    console.log(
      `[Integrations Accounts] ✓ Created bot ${botId} for ${cloudAccount.platform} account ${cloudAccount.id}`,
    );
  } catch (error) {
    console.error(
      `[Integrations Accounts] Failed to create bot for ${cloudAccount.platform} account:`,
      error,
    );
  }
}

/**
 * Local mode handling: Fetch accounts from cloud and sync to local
 */
async function handleLocalMode(request: NextRequest) {
  try {
    const cloudUrl = getCloudUrl();
    const url = new URL(`${cloudUrl}/api/integrations/accounts`, request.url);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: request.headers.get("Authorization") || "",
      },
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: "Failed to fetch accounts" }));
      console.error("[Integrations Accounts] Cloud API error:", error);
      return new Response(JSON.stringify(error), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const cloudAccounts = data.accounts || [];

    if (DEBUG) {
      console.log(
        "[Integrations Accounts] Cloud accounts:",
        cloudAccounts.length,
        [
          ...new Set(
            cloudAccounts.map((a: { platform: string }) => a.platform),
          ),
        ],
      );
    }

    if (cloudAccounts.length === 0) {
      // If no accounts, return empty list directly
      return new Response(JSON.stringify({ accounts: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get current logged-in user ID (from session)
    const { auth } = await import("@/app/(auth)/auth");
    const session = await auth();

    if (!session?.user) {
      console.error("[Integrations Accounts] No logged-in user found");
      return new Response(JSON.stringify({ error: "No logged-in user" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const localUserId = session.user.id;

    // Extract user ID from cloud accounts (remove cloud_ prefix)
    const cloudUserId = cloudAccounts[0].userId;
    const cloudUserIdStripped = cloudUserId.startsWith("cloud_")
      ? cloudUserId.substring(6) // Remove "cloud_" prefix
      : cloudUserId;

    // Also remove prefix from local user ID for comparison
    const localUserIdStripped = localUserId.startsWith("cloud_")
      ? localUserId.substring(6)
      : localUserId;

    // Verify cloud account and local logged-in user match
    if (cloudUserIdStripped !== localUserIdStripped) {
      console.error(
        "[Integrations Accounts] User ID mismatch! Cloud account belongs to different user.",
      );
      return new Response(
        JSON.stringify({
          error: "Account belongs to a different user",
          details: `Cloud account user ID: ${cloudUserIdStripped}, Local user ID: ${localUserIdStripped}`,
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    // Sync new accounts to local database
    let syncedCount = 0;
    for (const cloudAccount of cloudAccounts) {
      // Check by ID first
      const existingById = await db
        .select()
        .from(integrationAccounts)
        .where(eq(integrationAccounts.id, cloudAccount.id))
        .limit(1);

      if (existingById.length > 0) {
        continue; // Already synced by ID
      }

      // Also check by unique constraint (userId, platform, externalId)
      const existingByKey = await db
        .select()
        .from(integrationAccounts)
        .where(
          and(
            eq(integrationAccounts.userId, localUserId),
            eq(integrationAccounts.platform, cloudAccount.platform),
            eq(integrationAccounts.externalId, cloudAccount.externalId),
          ),
        )
        .limit(1);

      if (existingByKey.length > 0) {
        console.log(
          `[Integrations Accounts] Account already exists (${cloudAccount.platform}/${cloudAccount.externalId}), skipping`,
        );
        continue;
      }

      console.log(
        `[Integrations Accounts] Syncing new ${cloudAccount.platform} account: ${cloudAccount.id}`,
      );

      // Use account information returned by cloud directly (includes credentials)
      await db
        .insert(integrationAccounts)
        .values({
          id: cloudAccount.id,
          userId: localUserId,
          platform: cloudAccount.platform,
          externalId: cloudAccount.externalId,
          displayName: cloudAccount.displayName,
          credentialsEncrypted: cloudAccount.credentialsEncrypted,
          metadata: cloudAccount.metadata
            ? typeof cloudAccount.metadata === "string"
              ? cloudAccount.metadata
              : JSON.stringify(cloudAccount.metadata)
            : null,
          status: cloudAccount.status,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoNothing({
          target: integrationAccounts.id,
        });

      console.log(
        `[Integrations Accounts] ✓ Synced ${cloudAccount.platform} account`,
      );
      syncedCount++;

      // Automatically create Bot for newly synced integration (if not exists)
      await ensureBotForAccount(cloudAccount, localUserId);
    }

    // Return account list from local database (with bot ID via JOIN)
    const localAccounts = await db
      .select({
        id: integrationAccounts.id,
        platform: integrationAccounts.platform,
        externalId: integrationAccounts.externalId,
        displayName: integrationAccounts.displayName,
        status: integrationAccounts.status,
        metadata: integrationAccounts.metadata,
        createdAt: integrationAccounts.createdAt,
        updatedAt: integrationAccounts.updatedAt,
        botId: bot.id,
      })
      .from(integrationAccounts)
      .leftJoin(bot, eq(bot.platformAccountId, integrationAccounts.id))
      .where(eq(integrationAccounts.userId, localUserId));

    // Enhance accounts with hasValidContextToken for WeChat
    const enhancedAccounts = await Promise.all(
      localAccounts.map(
        async (acc: {
          id: string;
          platform: string;
          externalId: string;
          displayName: string;
          status: string;
          metadata: string | null;
          createdAt: Date;
          updatedAt: Date;
          botId: string | null;
        }) => {
          const account: {
            id: string;
            platform: string;
            externalId: string;
            displayName: string;
            status: string;
            metadata: Record<string, unknown> | null;
            createdAt: Date;
            updatedAt: Date;
            botId: string | null;
            hasValidContextToken?: boolean;
          } = {
            ...acc,
            metadata: acc.metadata
              ? typeof acc.metadata === "string"
                ? JSON.parse(acc.metadata)
                : acc.metadata
              : null,
          };

          // For WeChat, check if bot has valid context token
          if (account.platform === "weixin") {
            const hasValidContextToken = await checkWeixinContextToken(
              localUserId,
              acc.id,
            );
            account.hasValidContextToken = hasValidContextToken;
          }

          return account;
        },
      ),
    );

    if (DEBUG) {
      console.log(
        "[Integrations Accounts] Returning local accounts:",
        enhancedAccounts.length,
        [
          ...new Set(
            enhancedAccounts.map((a: { platform: string }) => a.platform),
          ),
        ],
        syncedCount > 0 ? `(synced ${syncedCount} new)` : "",
      );
    }

    return new Response(
      JSON.stringify({
        accounts: enhancedAccounts,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("[Integrations Accounts] Failed to fetch and sync:", error);
    return new Response(JSON.stringify({ error: "Failed to fetch accounts" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * Check if WeChat account has valid context token
 */
async function checkWeixinContextToken(
  userId: string,
  platformAccountId: string,
): Promise<boolean> {
  try {
    // Find the bot associated with this platform account
    const botRecord = await db
      .select({ id: bot.id })
      .from(bot)
      .where(eq(bot.platformAccountId, platformAccountId))
      .limit(1);

    if (botRecord.length === 0) {
      return false;
    }

    const botId = botRecord[0].id;
    const hasValidToken = await weixinBotHasValidContextToken(userId, botId);
    return hasValidToken;
  } catch (error) {
    console.error(
      "[Integrations Accounts] Failed to check WeChat context token:",
      error,
    );
    return false;
  }
}

/**
 * Cloud mode handling: Return account list from cloud database directly
 */
async function handleCloudMode(user: { id: string }) {
  try {
    // Strip cloud_ prefix if present (authenticateCloudRequest may return prefixed userId)
    const userId = user.id.startsWith("cloud_")
      ? user.id.substring(6)
      : user.id;

    const accounts = await db
      .select({
        id: integrationAccounts.id,
        userId: integrationAccounts.userId,
        platform: integrationAccounts.platform,
        externalId: integrationAccounts.externalId,
        displayName: integrationAccounts.displayName,
        status: integrationAccounts.status,
        metadata: integrationAccounts.metadata,
        credentialsEncrypted: integrationAccounts.credentialsEncrypted,
        createdAt: integrationAccounts.createdAt,
        updatedAt: integrationAccounts.updatedAt,
      })
      .from(integrationAccounts)
      .where(eq(integrationAccounts.userId, userId));

    // Enhance accounts with hasValidContextToken for WeChat
    const enhancedAccounts = await Promise.all(
      accounts.map(
        async (acc: {
          id: string;
          userId: string;
          platform: string;
          externalId: string;
          displayName: string;
          status: string;
          metadata: string | null;
          credentialsEncrypted: string;
          createdAt: Date;
          updatedAt: Date;
        }) => {
          const account = {
            ...acc,
            metadata: acc.metadata
              ? typeof acc.metadata === "string"
                ? JSON.parse(acc.metadata)
                : acc.metadata
              : null,
          };

          // For WeChat, check if bot has valid context token
          if (account.platform === "weixin") {
            const hasValidContextToken = await checkWeixinContextToken(
              userId,
              acc.id,
            );
            (account as any).hasValidContextToken = hasValidContextToken;
          }

          return account;
        },
      ),
    );

    return new Response(
      JSON.stringify({
        accounts: enhancedAccounts,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("[Integrations Accounts] Failed to fetch accounts:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch integration accounts" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

function getCloudUrl(): string {
  return (
    process.env.CLOUD_API_URL ||
    process.env.NEXT_PUBLIC_CLOUD_API_URL ||
    "https://app.alloomi.ai"
  );
}
