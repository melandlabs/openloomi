/**
 * Slack OAuth start endpoint (public API, no authentication required)
 *
 * Used for local version integration OAuth:
 * - No user login required
 * - Generate authorization URL and return
 * - Identify user through state during callback
 */

import { type NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { slackAuthConfig } from "@/app/(auth)/auth.config";

/**
 * Generate state containing user information
 * Format: {userId}:{uuid}
 */
function generateState(userId: string): string {
  const uuid = randomUUID();
  return `${userId}:${uuid}`;
}

/**
 * GET /api/integrations/slack/oauth/start?userId=local
 */
export async function GET(request: NextRequest) {
  // Get user ID (from query parameters)
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  // Validate userId - must be provided and a valid UUID
  if (!userId || userId === "local") {
    return NextResponse.json(
      { error: "Invalid or missing userId. Please log in again." },
      { status: 400 },
    );
  }

  // Check configuration
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "Slack OAuth is not configured" },
      { status: 500 },
    );
  }

  // Get callback URL (use frontend callback page)
  const cloudUrl =
    process.env.CLOUD_API_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://app.openloomi.ai";

  // Use frontend callback page and pass userId in state
  const finalRedirectUri = `${cloudUrl}/slack-authorized`;

  // Generate OAuth state containing user information
  const state = generateState(userId);

  // Use scopes from configuration (consistent with Web client)
  const scopes = slackAuthConfig.oauth_config.params.scope.join(",");
  const userScopes = slackAuthConfig.oauth_config.params.user_scope.join(",");

  // Generate authorization URL
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", finalRedirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes);
  url.searchParams.set("user_scope", userScopes);

  return NextResponse.json({
    authorizationUrl: url.toString(),
    state,
  });
}
