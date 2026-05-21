/**
 * LinkedIn OAuth start endpoint (public API, no authentication required)
 *
 * Used for local version integration OAuth:
 * - No user login required
 * - Generate authorization URL and return
 * - Identify user through state during callback
 */

import { type NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { withRateLimit, RateLimitPresets } from "@/lib/rate-limit/middleware";
import { encryptToken } from "@openloomi/security/token-encryption";

const LINKEDIN_SCOPES = ["openid", "profile", "email", "w_member_social"];

/**
 * Generate encrypted state containing user information
 * Format: encrypted JSON { userId, ts, nonce }
 */
function generateState(userId: string): string {
  const statePayload = {
    userId,
    ts: Date.now(),
    nonce: randomUUID(),
  };
  return encryptToken(JSON.stringify(statePayload));
}

/**
 * GET /api/integrations/linkedin/oauth/start?userId=xxx
 */
export async function GET(request: NextRequest) {
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
        headers: {
          "Content-Type": "application/json",
          "X-RateLimit-Remaining": rateLimitResult.remaining.toString(),
          "X-RateLimit-Reset": rateLimitResult.resetTime.toString(),
        },
      },
    );
  }

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
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        error:
          "LinkedIn integration is not configured. Set LINKEDIN_CLIENT_ID/LINKEDIN_CLIENT_SECRET.",
      },
      { status: 500 },
    );
  }

  // Get callback URL (use frontend callback page)
  const cloudUrl =
    process.env.CLOUD_API_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://app.openloomi.ai";

  // Use frontend callback page and pass userId in state
  const redirectUri = `${cloudUrl}/api/linkedin/callback`;

  // Generate OAuth state containing user information
  const state = generateState(userId);

  // Build LinkedIn authorization URL
  const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", LINKEDIN_SCOPES.join(" "));
  url.searchParams.set("state", state);

  return NextResponse.json({
    authorizationUrl: url.toString(),
    state,
  });
}
