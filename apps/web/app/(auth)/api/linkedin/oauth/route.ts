import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { getApplicationBaseUrl } from "@/lib/env";
import { getCloudUrl } from "@/lib/auth/cloud-proxy";
import { isTauriMode } from "@/lib/env/constants";
import { getAuthUser } from "@/lib/auth/dual-auth";
import { encryptToken } from "@openloomi/security/token-encryption";

const LINKEDIN_SCOPES = ["openid", "profile", "email", "w_member_social"];

type StartPayload = {
  redirectUri?: string;
  redirectPath?: string;
  token?: string; // Bearer token from Tauri client
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as StartPayload;

  // ========================================
  // 1. Tauri local version: forward to cloud public API (no auth required)
  // ========================================
  if (isTauriMode()) {
    return forwardToCloudPublicAPI(payload.token);
  }

  // ========================================
  // 2. Authentication check: supports both session and Bearer token
  // ========================================
  const user = await getAuthUser(request);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ========================================
  // 3. Web side: handle directly
  // ========================================
  return handleDirectly(payload, user.id);
}

// ========================================
// Helper functions
// ========================================

/**
 * Forward to cloud public API (used by Tauri local version)
 */
async function forwardToCloudPublicAPI(token?: string) {
  try {
    const cloudUrl = getCloudUrl();

    if (!token) {
      return NextResponse.json(
        { error: "Authentication required. Please log in first." },
        { status: 401 },
      );
    }

    const { getUserIdFromToken } = await import("@/lib/auth/token-manager");
    const userId = getUserIdFromToken(token);

    if (!userId) {
      console.error("[LinkedIn OAuth] Invalid token, cannot extract userId");
      return NextResponse.json(
        { error: "Invalid or expired token. Please log in again." },
        { status: 401 },
      );
    }

    const response = await fetch(
      `${cloudUrl}/api/integrations/linkedin/oauth/start?userId=${userId}`,
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
      console.error("[LinkedIn OAuth] Cloud API error:", error);
      return NextResponse.json(error, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[LinkedIn OAuth] Failed to forward to cloud:", error);
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

  const baseUrl = getApplicationBaseUrl();
  const redirectUri = resolveRedirectUri(
    payload.redirectUri,
    payload.redirectPath ?? "/api/linkedin/callback",
    process.env.LINKEDIN_REDIRECT_URI,
  );

  const returnTo = `${baseUrl}/?page=profile`;
  const state = encryptToken(
    JSON.stringify({
      userId,
      ts: Date.now(),
      returnTo,
      nonce: randomUUID(),
    }),
  );

  const authUrl = new URL("https://www.linkedin.com/oauth/v2/authorization");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", LINKEDIN_SCOPES.join(" "));
  authUrl.searchParams.set("state", state);

  return NextResponse.json({
    authorizationUrl: authUrl.toString(),
    state,
    redirectUri,
  });
}

function resolveRedirectUri(
  providedUri: string | undefined,
  redirectPath: string,
  overrideUri: string | undefined,
) {
  const explicit = providedUri ?? overrideUri;
  if (explicit) {
    return sanitizeAbsoluteUri(explicit);
  }

  const path = ensureLeadingSlash(redirectPath || "/api/linkedin/callback");
  return `${getApplicationBaseUrl()}${path}`.replace(/\/$/, "");
}

function ensureLeadingSlash(path: string) {
  const trimmed = path.trim();
  if (!trimmed) {
    return "/api/linkedin/callback";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function sanitizeAbsoluteUri(uri: string) {
  return uri.trim().replace(/\/$/, "");
}
