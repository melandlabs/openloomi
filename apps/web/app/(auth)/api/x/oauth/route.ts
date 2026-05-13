import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { encryptToken } from "@openloomi/security/token-encryption";
import { getApplicationBaseUrl } from "@/lib/env";
import { getCloudUrl } from "@/lib/auth/cloud-proxy";
import { isTauriMode } from "@/lib/env/constants";
import { getAuthUser } from "@/lib/auth/dual-auth";
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

const X_STATE_COOKIE = "x_oauth_state";
const OAUTH_STATE_TTL_SECONDS = 10 * 60;

type StartPayload = {
  redirectUri?: string;
  redirectPath?: string;
  token?: string; // Bearer token from Tauri client
};

function sha256(buffer: string) {
  return createHash("sha256").update(buffer).digest("base64url");
}

export async function POST(request: Request) {
  // Parse body like Discord/Slack OAuth start routes do
  const payload = (await request.json().catch(() => ({}))) as StartPayload;

  // Tauri local version: forward to cloud public API
  if (isTauriMode()) {
    return forwardToCloudPublicAPI(payload.token);
  }

  // Authentication check
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return handleDirectly(payload, user.id);
}

/**
 * Forward to cloud public API (used by Tauri local version)
 */
async function forwardToCloudPublicAPI(token?: string) {
  try {
    const cloudUrl = getCloudUrl();

    // Must provide a valid token
    if (!token) {
      return NextResponse.json(
        { error: "Authentication required. Please log in first." },
        { status: 401 },
      );
    }

    // Parse token to get userId
    const { getUserIdFromToken } = await import("@/lib/auth/token-manager");
    const userId = getUserIdFromToken(token);

    if (!userId) {
      console.error("[X OAuth] Invalid token, cannot extract userId");
      return NextResponse.json(
        { error: "Invalid or expired token. Please log in again." },
        { status: 401 },
      );
    }

    const response = await fetch(
      `${cloudUrl}/api/integrations/x/oauth/start?userId=${userId}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: "Failed to start OAuth" }));
      return NextResponse.json(error, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[X OAuth] Failed to forward to cloud:", error);
    return NextResponse.json(
      { error: "Failed to start OAuth flow" },
      { status: 503 },
    );
  }
}

/**
 * Cloud environment handles OAuth directly
 */
async function handleDirectly(payload: StartPayload, userId: string) {
  await ensureRedis();

  const clientId = process.env.TWITTER_CLIENT_ID;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        error: "X integration is not configured. Set TWITTER_CLIENT_ID/SECRET.",
      },
      { status: 500 },
    );
  }

  const baseUrl = getApplicationBaseUrl();
  // Use client-provided redirectPath, or default to /api/x/callback
  const redirectPath = payload.redirectPath || "/api/x/callback";
  const redirectUri =
    process.env.TWITTER_REDIRECT_URI ?? `${baseUrl}${redirectPath}`;

  // Create login session for polling
  const sessionId = randomUUID();
  await setLoginSession(sessionId, {
    provider: "twitter",
    phone: userId,
    status: "pending",
    createdAt: Date.now(),
  });

  const statePayload = {
    userId,
    nonce: randomUUID(),
    ts: Date.now(),
    returnTo: `${baseUrl}${redirectPath.replace("/api/x/callback", "/?page=profile")}`,
    loginSessionId: sessionId,
  };

  // PKCE
  const codeVerifier = randomUUID().replace(/-/g, "");
  const codeChallenge = sha256(codeVerifier);
  const verifierState = encryptToken(
    JSON.stringify({ ...statePayload, codeVerifier }),
  );

  const authorizeUrl = new URL("https://twitter.com/i/oauth2/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", X_SCOPES.join(" "));
  authorizeUrl.searchParams.set("state", verifierState);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.json(
    {
      authorizationUrl: authorizeUrl.toString(),
      sessionId,
      redirectUri,
    },
    { status: 200 },
  );

  response.cookies.set({
    name: X_STATE_COOKIE,
    value: verifierState,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });

  return response;
}
