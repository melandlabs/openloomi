/**
 * X (Twitter) OAuth start endpoint (public API, no authentication required)
 *
 * Used for local version integration OAuth:
 * - No user login required
 * - Generate authorization URL and return
 * - Identify user through state during callback
 */

import { type NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { encryptToken } from "@openloomi/security/token-encryption";
import { createHash } from "node:crypto";
import { ensureRedis, setLoginSession } from "@/lib/session/context";

const X_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "dm.read",
  "dm.write",
  "like.write",
  "media.write",
  "offline.access",
];

function sha256(buffer: string) {
  return createHash("sha256").update(buffer).digest("base64url");
}

/**
 * Generate state containing user information
 */
function generateState(
  userId: string,
  loginSessionId: string,
  codeVerifier: string,
): string {
  const statePayload = {
    userId,
    nonce: randomUUID(),
    ts: Date.now(),
    loginSessionId,
    codeVerifier,
  };
  return encryptToken(JSON.stringify(statePayload));
}

/**
 * GET /api/integrations/x/oauth/start?userId=local
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
  const clientId = process.env.TWITTER_CLIENT_ID;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "X OAuth is not configured" },
      { status: 500 },
    );
  }

  // Get callback URL
  const cloudUrl =
    process.env.CLOUD_API_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://app.openloomi.ai";

  const redirectUri =
    process.env.TWITTER_REDIRECT_URI ?? `${cloudUrl}/api/x/callback`;

  // Create login session for polling
  const sessionId = randomUUID();
  await ensureRedis();
  await setLoginSession(sessionId, {
    provider: "twitter",
    phone: userId,
    status: "pending",
    createdAt: Date.now(),
  });

  // PKCE
  const codeVerifier = randomUUID().replace(/-/g, "");
  const codeChallenge = sha256(codeVerifier);

  // Generate OAuth state
  const state = generateState(userId, sessionId, codeVerifier);

  // Generate authorization URL
  const url = new URL("https://twitter.com/i/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", X_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return NextResponse.json({
    authorizationUrl: url.toString(),
    sessionId,
    redirectUri,
  });
}
