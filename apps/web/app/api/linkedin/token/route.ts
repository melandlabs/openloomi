import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import {
  getIntegrationAccountByPlatform,
  loadIntegrationCredentials,
  upsertIntegrationAccount,
} from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";

export const runtime = "nodejs";

type LinkedInCredentials = {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: number | null;
};

type LinkedInTokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
};

/**
 * GET /api/linkedin/token
 * Get the user's LinkedIn access token for AI usage.
 * The AI uses this token with the LinkedIn skill to operate LinkedIn.
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
      platform: "linkedin",
    });

    if (!account) {
      return NextResponse.json(
        { success: false, error: "not_connected" },
        { status: 404 },
      );
    }

    const credentials =
      loadIntegrationCredentials<LinkedInCredentials>(account);

    if (!credentials?.accessToken) {
      return NextResponse.json(
        { success: false, error: "not_connected" },
        { status: 404 },
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

      // Refresh the token
      const refreshed = await refreshLinkedInToken(
        credentials.accessToken,
        credentials.refreshToken,
      );

      if (!refreshed) {
        return NextResponse.json(
          { success: false, error: "token_expired" },
          { status: 401 },
        );
      }

      // Update credentials with refreshed values
      credentials.accessToken = refreshed.access_token;
      credentials.expiresAt = refreshed.expires_in
        ? Date.now() + refreshed.expires_in * 1000
        : null;
      if (refreshed.refresh_token) {
        credentials.refreshToken = refreshed.refresh_token;
      }

      // Persist the refreshed credentials
      await upsertIntegrationAccount({
        userId: session.user.id,
        platform: "linkedin",
        externalId: account.externalId,
        displayName: account.displayName,
        credentials,
        metadata: account.metadata as Record<string, unknown>,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        accessToken: credentials.accessToken,
        expiresAt: credentials.expiresAt,
        email: (account.metadata as { email?: string })?.email ?? null,
        name: (account.metadata as { name?: string })?.name ?? null,
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
    console.error("[linkedin/token] Failed to get token:", error);
    return NextResponse.json(
      { success: false, error: "internal_error" },
      { status: 500 },
    );
  }
}

async function refreshLinkedInToken(
  accessToken: string,
  refreshToken: string,
): Promise<LinkedInTokenResponse | null> {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("[linkedin/token] LinkedIn OAuth not configured");
    return null;
  }

  try {
    const response = await fetch(
      "https://www.linkedin.com/oauth/v2/accessToken",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      },
    );

    if (!response.ok) {
      console.error(
        "[linkedin/token] Token refresh failed:",
        await response.text(),
      );
      return null;
    }

    return (await response.json()) as LinkedInTokenResponse;
  } catch (error) {
    console.error("[linkedin/token] Token refresh error:", error);
    return null;
  }
}
