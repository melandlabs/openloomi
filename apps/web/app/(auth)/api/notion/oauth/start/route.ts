import { NextResponse } from "next/server";

import { getApplicationBaseUrl } from "@/lib/env";
import { getCloudUrl } from "@/lib/auth/cloud-proxy";
import { isTauriMode } from "@/lib/env/constants";
import { getAuthUser } from "@/lib/auth/dual-auth";
import { encryptToken } from "@openloomi/security/token-encryption";

const NOTION_AUTHORIZE_URL = "https://api.notion.com/v1/oauth/authorize";
const NOTION_STATE_COOKIE = "notion_oauth_state";
const OAUTH_STATE_TTL_SECONDS = 10 * 60; // 10 minutes

type StartPayload = {
  redirectUri?: string;
  redirectPath?: string;
  token?: string; // Bearer token from Tauri client
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as StartPayload;

  console.log("[Notion OAuth] IS_TAURI env:", process.env.IS_TAURI);
  console.log("[Notion OAuth] isTauriMode():", isTauriMode());
  console.log(
    "[Notion OAuth] token from payload:",
    payload.token ? "exists" : "undefined",
  );

  // ========================================
  // 1. Tauri local version: forward to cloud public API (no auth required)
  // ========================================
  if (isTauriMode()) {
    console.log(
      "[Notion OAuth] Tauri mode detected, forwarding to cloud public API",
    );
    return forwardToCloudPublicAPI(payload.token);
  }

  // ========================================
  // 2. Authentication check: supports both session and Bearer token
  // ========================================
  const user = await getAuthUser(request);

  if (!user) {
    console.log(
      "[Notion OAuth] Authentication failed: no valid session or token",
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[Notion OAuth] Authenticated user:", user.id);

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
      console.error("[Notion OAuth] Invalid token, cannot extract userId");
      return NextResponse.json(
        { error: "Invalid or expired token. Please log in again." },
        { status: 401 },
      );
    }

    const response = await fetch(
      `${cloudUrl}/api/integrations/notion/oauth/start?userId=${userId}`,
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
      console.error("[Notion OAuth] Cloud API error:", error);
      return NextResponse.json(error, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[Notion OAuth] Failed to forward to cloud:", error);
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
  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        error:
          "Notion integration is not configured. Set NOTION_CLIENT_ID/NOTION_CLIENT_SECRET.",
      },
      { status: 500 },
    );
  }

  const baseUrl = getApplicationBaseUrl();
  const redirectUri = resolveRedirectUri(
    payload.redirectUri,
    payload.redirectPath ?? "/notion-authorized",
    process.env.NOTION_REDIRECT_URI,
  );

  const returnTo = `${baseUrl}/?page=profile`;
  const state = encryptToken(
    JSON.stringify({
      userId,
      ts: Date.now(),
      returnTo,
    }),
  );

  const scope = process.env.NOTION_OAUTH_SCOPES;

  const notionAuth = new URL(NOTION_AUTHORIZE_URL);
  notionAuth.searchParams.set("client_id", clientId);
  notionAuth.searchParams.set("response_type", "code");
  notionAuth.searchParams.set("owner", "user");
  notionAuth.searchParams.set("redirect_uri", redirectUri);
  if (scope) {
    notionAuth.searchParams.set("scope", scope);
  }
  notionAuth.searchParams.set("state", state);

  const response = NextResponse.json(
    {
      authorizationUrl: notionAuth.toString(),
      state,
      redirectUri,
    },
    { status: 200 },
  );

  response.cookies.set({
    name: NOTION_STATE_COOKIE,
    value: state,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });

  return response;
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

  const path = ensureLeadingSlash(redirectPath || "/notion-authorized");
  return `${getApplicationBaseUrl()}${path}`.replace(/\/$/, "");
}

function ensureLeadingSlash(path: string) {
  const trimmed = path.trim();
  if (!trimmed) {
    return "/notion-authorized";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function sanitizeAbsoluteUri(uri: string) {
  return uri.trim().replace(/\/$/, "");
}
