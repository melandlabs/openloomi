/**
 * HubSpot OAuth start endpoint (public API, no authentication required)
 *
 * Used for local version integration OAuth:
 * - No user login required
 * - Generate authorization URL and return
 * - Identify user through encrypted state during callback
 */

import { type NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { withRateLimit, RateLimitPresets } from "@/lib/rate-limit/middleware";
import { encryptToken } from "@openloomi/security/token-encryption";

const HUBSPOT_AUTHORIZE_URL = "https://app.hubspot.com/oauth/authorize";
const HUBSPOT_SCOPES = [
  "crm.objects.deals.read",
  "crm.objects.deals.write",
  "crm.schemas.deals.read",
  "crm.objects.contacts.read",
  "crm.objects.contacts.write",
  "oauth",
];

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
 * GET /api/integrations/hubspot/oauth/start?userId=xxx
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

  // Validate userId - must be provided
  if (!userId || userId === "local") {
    return NextResponse.json(
      { error: "Invalid or missing userId. Please log in again." },
      { status: 400 },
    );
  }

  // Check configuration
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        error:
          "HubSpot integration is not configured. Set HUBSPOT_CLIENT_ID/HUBSPOT_CLIENT_SECRET.",
      },
      { status: 500 },
    );
  }

  // Get callback URL
  const cloudUrl =
    process.env.CLOUD_API_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://app.openloomi.ai";

  const redirectUri =
    process.env.HUBSPOT_REDIRECT_URI || `${cloudUrl}/api/hubspot/callback`;

  // Generate encrypted state containing userId
  const state = generateState(userId);

  // Build HubSpot authorization URL
  const url = new URL(HUBSPOT_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", HUBSPOT_SCOPES.join(" "));
  url.searchParams.set("state", state);

  return NextResponse.json({
    authorizationUrl: url.toString(),
    state,
  });
}
