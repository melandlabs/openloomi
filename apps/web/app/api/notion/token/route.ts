import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import { getNotionContext } from "@/lib/integrations/notion";
import { upsertIntegrationAccount } from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";

export const runtime = "nodejs";

/**
 * GET /api/notion/token
 * Get the user's Notion access token for AI usage.
 * The AI uses this token with the notion skill to operate Notion.
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
    const context = await getNotionContext(session.user.id);
    let { credentials } = context;

    // Check if token is expired and needs refresh
    if (credentials.expiresAt && Date.now() >= credentials.expiresAt) {
      if (!credentials.refreshToken) {
        return NextResponse.json(
          { success: false, error: "token_expired" },
          { status: 401 },
        );
      }

      // Refresh the token
      const refreshed = await refreshNotionToken(
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
      credentials = {
        ...credentials,
        accessToken: refreshed.access_token,
        expiresAt: refreshed.expires_in
          ? Date.now() + refreshed.expires_in * 1000
          : null,
      };

      // Persist the refreshed credentials
      await upsertIntegrationAccount({
        userId: session.user.id,
        platform: "notion",
        externalId: context.account.externalId,
        displayName: context.account.displayName,
        credentials,
        metadata: context.metadata as Record<string, unknown>,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        apiKey: credentials.accessToken,
        workspaceId: credentials.workspaceId ?? null,
        workspaceName: credentials.workspaceName ?? null,
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
    console.error("[notion/token] Failed to get token:", error);
    return NextResponse.json(
      { success: false, error: "internal_error" },
      { status: 500 },
    );
  }
}

type NotionRefreshResponse = {
  access_token: string;
  token_type?: string;
  refresh_token?: string;
  expires_in?: number;
};

async function refreshNotionToken(
  accessToken: string,
  refreshToken: string,
): Promise<NotionRefreshResponse | null> {
  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("[notion/token] Notion OAuth not configured");
    return null;
  }

  try {
    const response = await fetch("https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      console.error(
        "[notion/token] Token refresh failed:",
        await response.text(),
      );
      return null;
    }

    return (await response.json()) as NotionRefreshResponse;
  } catch (error) {
    console.error("[notion/token] Token refresh error:", error);
    return null;
  }
}
