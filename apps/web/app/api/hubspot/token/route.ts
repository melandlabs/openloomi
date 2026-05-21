import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import {
  getIntegrationAccountByPlatform,
  upsertIntegrationAccount,
} from "@/lib/db/queries";
import { decryptPayload } from "@/lib/db/serialization";
import { AppError } from "@openloomi/shared/errors";
import { HubspotClient } from "@openloomi/integrations/hubspot";

export const runtime = "nodejs";

type HubspotStoredCredentials = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: number | null;
  tokenType?: string | null;
  scope?: string | null;
  hubId?: number | null;
  hubDomain?: string | null;
  userEmail?: string | null;
  userId?: string | null;
};

/**
 * GET /api/hubspot/token
 * Get the user's HubSpot access token for AI usage.
 * The AI uses this token with the hubspot-automation skill to operate HubSpot.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { success: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  try {
    const account = await getIntegrationAccountByPlatform({
      userId: session.user.id,
      platform: "hubspot",
    });

    if (!account) {
      return NextResponse.json(
        { success: false, error: "not_connected" },
        { status: 404 },
      );
    }

    // Decrypt credentials
    let credentials: HubspotStoredCredentials | null = null;
    try {
      if (account.credentialsEncrypted) {
        credentials = (await decryptPayload(
          account.credentialsEncrypted,
        )) as HubspotStoredCredentials;
      }
    } catch (error) {
      console.error("[hubspot/token] Failed to decrypt credentials:", error);
      return NextResponse.json(
        { success: false, error: "invalid_credentials" },
        { status: 500 },
      );
    }

    if (!credentials?.accessToken) {
      return NextResponse.json(
        { success: false, error: "no_access_token" },
        { status: 401 },
      );
    }

    // Check if token is expired and needs refresh
    if (credentials.expiresAt && Date.now() >= credentials.expiresAt) {
      if (!credentials.refreshToken) {
        return NextResponse.json(
          { success: false, error: "token_expired" },
          { status: 401 },
        );
      }

      // Refresh the token using HubspotClient
      try {
        const client = new HubspotClient({
          credentials: {
            accessToken: credentials.accessToken,
            refreshToken: credentials.refreshToken,
            expiresAt: credentials.expiresAt,
            tokenType: credentials.tokenType,
            scope: credentials.scope,
            hubId: credentials.hubId,
            hubDomain: credentials.hubDomain,
            userEmail: credentials.userEmail,
            userId: credentials.userId,
          },
          userId: session.user.id,
          platformAccountId: account.id,
          onPersistCredentials: async ({ credentials: newCredentials }) => {
            // Persist refreshed credentials
            await upsertIntegrationAccount({
              userId: session.user.id,
              platform: "hubspot",
              externalId:
                credentials?.hubId?.toString() ??
                credentials?.userEmail ??
                session.user.id,
              displayName: `HubSpot (${credentials?.userEmail ?? "Account"})`,
              credentials: newCredentials,
              metadata: {
                hubId: credentials?.hubId,
                hubDomain: credentials?.hubDomain,
                userEmail: credentials?.userEmail,
              },
            });
          },
        });

        // Force refresh by accessing portalId (triggers refresh internally)
        const _portalId = client.portalId;

        // Re-fetch decrypted credentials after refresh
        const updatedAccount = await getIntegrationAccountByPlatform({
          userId: session.user.id,
          platform: "hubspot",
        });

        if (updatedAccount?.credentialsEncrypted) {
          credentials = (await decryptPayload(
            updatedAccount.credentialsEncrypted,
          )) as HubspotStoredCredentials;
        }
      } catch (refreshError) {
        console.error("[hubspot/token] Token refresh failed:", refreshError);
        return NextResponse.json(
          { success: false, error: "token_refresh_failed" },
          { status: 401 },
        );
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        accessToken: credentials?.accessToken,
        hubId: credentials?.hubId ?? null,
        hubDomain: credentials?.hubDomain ?? null,
        userEmail: credentials?.userEmail ?? null,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      if (
        error.type === "forbidden" ||
        error.message.includes("not connected")
      ) {
        return NextResponse.json(
          { success: false, error: "not_connected" },
          { status: 404 },
        );
      }
    }
    console.error("[hubspot/token] Failed to get token:", error);
    return NextResponse.json(
      { success: false, error: "internal_error" },
      { status: 500 },
    );
  }
}
