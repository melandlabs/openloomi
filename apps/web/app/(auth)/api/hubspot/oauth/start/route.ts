import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { getApplicationBaseUrl } from "@/lib/env";
import { getCloudUrl } from "@/lib/auth/cloud-proxy";
import { isTauriMode } from "@/lib/env/constants";
import { getAuthUser } from "@/lib/auth/dual-auth";
import { encryptToken } from "@openloomi/security/token-encryption";

const HUBSPOT_AUTHORIZE_URL = "https://app.hubspot.com/oauth/authorize";
const HUBSPOT_STATE_COOKIE = "hubspot_oauth_state";
const OAUTH_STATE_TTL_SECONDS = 10 * 60; // 10 minutes
const HUBSPOT_SCOPES = [
  "crm.objects.deals.read",
  "crm.objects.deals.write",
  "crm.schemas.deals.read",
  "crm.objects.contacts.read",
  "crm.objects.contacts.write",
  "oauth",
];

type StartPayload = {
  redirectUri?: string;
  redirectPath?: string;
  token?: string; // Bearer token from Tauri client
};

/**
 * Generate encrypted state containing user information
 */
function generateEncryptedState(userId: string, returnTo?: string): string {
  const statePayload = {
    userId,
    ts: Date.now(),
    returnTo,
    nonce: randomUUID(),
  };
  return encryptToken(JSON.stringify(statePayload));
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as StartPayload;

  console.log("[HubSpot OAuth] IS_TAURI env:", process.env.IS_TAURI);
  console.log("[HubSpot OAuth] isTauriMode():", isTauriMode());
  console.log(
    "[HubSpot OAuth] token from payload:",
    payload.token ? "exists" : "undefined",
  );

  // ========================================
  // 1. Tauri local version: forward to cloud public API (no auth required)
  // ========================================
  if (isTauriMode()) {
    console.log(
      "[HubSpot OAuth] Tauri mode detected, forwarding to cloud public API",
    );
    return forwardToCloudPublicAPI(payload.token);
  }

  // ========================================
  // 2. Authentication check: supports both session and Bearer token
  // ========================================
  const user = await getAuthUser(request);

  if (!user) {
    console.log(
      "[HubSpot OAuth] Authentication failed: no valid session or token",
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[HubSpot OAuth] Authenticated user:", user.id);

  // ========================================
  // 3. Web side: handle directly
  // ========================================
  return handleDirectly(payload, user.id);
}

// ========================================
// Helper functions
// ========================================

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Forward to cloud public API (used by Tauri local version)
 * Includes retry logic with exponential backoff for transient failures.
 */
async function forwardToCloudPublicAPI(token?: string) {
  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 500;

  if (!token) {
    return NextResponse.json(
      { error: "Authentication required. Please log in first." },
      { status: 401 },
    );
  }

  const { getUserIdFromToken } = await import("@/lib/auth/token-manager");
  const userId = getUserIdFromToken(token);

  if (!userId) {
    console.error("[HubSpot OAuth] Invalid token, cannot extract userId");
    return NextResponse.json(
      { error: "Invalid or expired token. Please log in again." },
      { status: 401 },
    );
  }

  const cloudUrl = getCloudUrl();
  const url = `${cloudUrl}/api/integrations/hubspot/oauth/start?userId=${userId}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: "Failed to start OAuth" }));
        console.error(
          `[HubSpot OAuth] Cloud API error (attempt ${attempt}):`,
          error,
        );

        // Only retry on 503 Service Unavailable
        if (response.status === 503 && attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
          console.log(
            `[HubSpot OAuth] Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`,
          );
          await sleep(delay);
          continue;
        }
        return NextResponse.json(error, { status: response.status });
      }

      const data = await response.json();
      return NextResponse.json(data);
    } catch (error) {
      console.error(
        `[HubSpot OAuth] Fetch failed (attempt ${attempt}/${MAX_RETRIES}):`,
        error,
      );

      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(
          `[HubSpot OAuth] Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`,
        );
        await sleep(delay);
      } else {
        console.error("[HubSpot OAuth] All retry attempts exhausted");
        return NextResponse.json(
          { error: "Failed to start OAuth flow" },
          { status: 503 },
        );
      }
    }
  }
}

/**
 * Cloud environment handles OAuth directly
 */
async function handleDirectly(payload: StartPayload, userId: string) {
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

  const baseUrl = getApplicationBaseUrl();
  const redirectUri = resolveRedirectUri(
    payload.redirectUri,
    payload.redirectPath ?? "/api/hubspot/callback",
    process.env.HUBSPOT_REDIRECT_URI,
  );

  // Generate encrypted state with userId
  const state = generateEncryptedState(userId, payload.redirectPath);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: HUBSPOT_SCOPES.join(" "),
    state,
  });

  const authorizationUrl = `${HUBSPOT_AUTHORIZE_URL}?${params.toString()}`;

  const response = NextResponse.json(
    {
      authorizationUrl,
      state,
      redirectUri,
    },
    { status: 200 },
  );

  response.cookies.set({
    name: HUBSPOT_STATE_COOKIE,
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

  const path = ensureLeadingSlash(redirectPath || "/api/hubspot/callback");
  return `${getApplicationBaseUrl()}${path}`.replace(/\/$/, "");
}

function ensureLeadingSlash(path: string) {
  const trimmed = path.trim();
  if (!trimmed) {
    return "/api/hubspot/callback";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function sanitizeAbsoluteUri(uri: string) {
  return uri.trim().replace(/\/$/, "");
}
