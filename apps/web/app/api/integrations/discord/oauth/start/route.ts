/**
 * Discord OAuth start endpoint (public API, no authentication required)
 *
 * Used for local version integration OAuth:
 * - No user login required
 * - Generate authorization URL and return
 * - Identify user through state during callback
 */

import { type NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

// Discord OAuth configuration (consistent with web client)
const DISCORD_OAUTH_SCOPES = ["identify", "email", "guilds", "bot"];

/**
 * Generate state containing user information
 * Format: {userId}:{uuid}
 */
function generateState(userId: string): string {
  const uuid = randomUUID();
  return `${userId}:${uuid}`;
}

/**
 * GET /api/integrations/discord/oauth/start?userId=local
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
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "Discord OAuth is not configured" },
      { status: 500 },
    );
  }

  // Get callback URL (use frontend callback page)
  const cloudUrl =
    process.env.CLOUD_API_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://app.openloomi.ai";

  // Use frontend callback page /discord-authorized
  const finalRedirectUri = `${cloudUrl}/discord-authorized`;

  // Generate OAuth state containing user information
  const state = generateState(userId);

  // Generate authorization URL
  const url = new URL("https://discord.com/api/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", finalRedirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", DISCORD_OAUTH_SCOPES.join(" "));
  url.searchParams.set("integration_type", "0");
  url.searchParams.set("permissions", "67584");
  url.searchParams.set("prompt", "consent");

  return NextResponse.json({
    authorizationUrl: url.toString(),
    state,
  });
}
