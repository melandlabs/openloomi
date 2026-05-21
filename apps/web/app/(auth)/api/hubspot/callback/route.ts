import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { upsertIntegrationAccount } from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";
import { isTauriMode } from "@/lib/env/constants";
import { getCloudUrl } from "@/lib/auth/cloud-proxy";
import { getApplicationBaseUrl } from "@/lib/env";
import { decryptToken } from "@openloomi/security/token-encryption";

const HUBSPOT_TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";
const HUBSPOT_INTROSPECT_URL = "https://api.hubapi.com/oauth/v1/access-tokens";
const HUBSPOT_STATE_COOKIE = "hubspot_oauth_state";

type HubspotTokenResponse = {
  access_token?: string;
  refresh_token?: string | null;
  expires_in?: number | null;
  token_type?: string | null;
  scope?: string | null;
  hub_id?: number | null;
  user?: string | null;
  user_id?: number | null;
  error?: string | null;
};

type HubspotTokenIntrospection = {
  hub_id?: number | null;
  hub_domain?: string | null;
  user?: string | null;
  user_id?: number | null;
  token?: string | null;
  expires_in?: number | null;
  scope?: string[];
  token_type?: string;
};

type StatePayload = {
  userId: string;
  ts: number;
  nonce?: string;
};

export const runtime = "nodejs";

function buildHtmlResponse({
  title,
  heading,
  message,
  errorDetail,
  status,
  isSuccess,
}: {
  title: string;
  heading: string;
  message: string;
  errorDetail?: string;
  status: number;
  isSuccess: boolean;
}) {
  const headingColor = isSuccess
    ? "#10b981"
    : status >= 500
      ? "#e74c3c"
      : "#f59e0b";
  return new NextResponse(
    `<!DOCTYPE html>
<html>
  <head>
    <title>${title}</title>
    <style>
      body { font-family: 'Noto Sans SC', 'PingFang SC', 'Helvetica Neue', -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
      .container { text-align: center; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; }
      h1 { color: ${headingColor}; margin-bottom: 20px; }
      p { color: #616061; line-height: 1.6; }
      .error-detail { font-size: 12px; color: #999; margin-top: 10px; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>${heading}</h1>
      <p>${message}</p>
      ${errorDetail ? `<p class="error-detail">Error: ${errorDetail}</p>` : ""}
      ${isSuccess ? "<p>You can close this window and return to the app.</p>" : ""}
    </div>
    <script>
      if (window.opener) {
        window.opener.postMessage({ platform: "hubspot", success: ${isSuccess} }, "*");
        setTimeout(function() { window.close(); }, 2000);
      }
    </script>
  </body>
</html>`,
    {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

export async function GET(request: Request) {
  console.log("[hubspot] Callback received");
  const baseUrl = getApplicationBaseUrl();

  // Tauri desktop: forward to cloud
  if (isTauriMode()) {
    try {
      const cloudUrl = getCloudUrl();
      const url = new URL(request.url);
      const redirectUrl = `${cloudUrl}/api/hubspot/callback?${url.searchParams.toString()}`;

      console.log(
        "[hubspot] Tauri mode detected, forwarding to cloud:",
        redirectUrl,
      );

      const response = await fetch(redirectUrl);
      const html = await response.text();

      return new NextResponse(html, {
        status: response.status,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (error) {
      console.error("[hubspot] Failed to forward to cloud:", error);
      return buildHtmlResponse({
        title: "Authorization Failed",
        heading: "Authorization Failed",
        message: "Failed to connect to cloud service. Please try again.",
        status: 503,
        isSuccess: false,
      });
    }
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    console.log("[hubspot] Callback cancelled:", errorParam);
    return buildHtmlResponse({
      title: "Authorization Cancelled",
      heading: "Authorization Cancelled",
      message: errorParam || "Authorization was cancelled.",
      status: 400,
      isSuccess: false,
    });
  }

  if (!stateParam) {
    console.log("[hubspot] Missing state parameter");
    return buildHtmlResponse({
      title: "Invalid Callback",
      heading: "Invalid Callback",
      message: "Missing authorization state. Please try again.",
      status: 400,
      isSuccess: false,
    });
  }

  // Decode state - may be encrypted (cloud/Tauri flow) or plain cookie (web flow)
  let userId: string | null = null;
  let statePayload: StatePayload | null = null;

  // Try to parse as encrypted state first (cloud flow)
  try {
    const decrypted = decryptToken(stateParam);
    statePayload = JSON.parse(decrypted) as StatePayload;
    if (statePayload?.userId) {
      userId = statePayload.userId;
    }
  } catch {
    // Not encrypted state, try cookie validation (web flow)
    const cookieStore = await cookies();
    const storedState = cookieStore.get(HUBSPOT_STATE_COOKIE)?.value;

    if (!storedState || storedState !== stateParam) {
      console.log("[hubspot] Invalid OAuth state");
      return buildHtmlResponse({
        title: "Invalid State",
        heading: "Invalid Authorization State",
        message: "Please try again.",
        status: 400,
        isSuccess: false,
      });
    }
  }

  // If still no userId, the state is invalid
  if (!userId) {
    console.log("[hubspot] Could not determine userId from state");
    return buildHtmlResponse({
      title: "Invalid State",
      heading: "Invalid Authorization State",
      message: "Could not determine user identity. Please try again.",
      status: 400,
      isSuccess: false,
    });
  }

  // Check state age (10 minutes)
  if (statePayload && Date.now() - statePayload.ts > 10 * 60 * 1000) {
    console.log("[hubspot] State expired");
    return buildHtmlResponse({
      title: "Authorization Expired",
      heading: "Authorization Expired",
      message: "Please try again.",
      status: 400,
      isSuccess: false,
    });
  }

  if (!code) {
    console.log("[hubspot] Missing authorization code");
    return buildHtmlResponse({
      title: "Invalid Callback",
      heading: "Invalid Callback",
      message: "Missing authorization code from HubSpot.",
      status: 400,
      isSuccess: false,
    });
  }

  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.log("[hubspot] HubSpot credentials not configured");
    return buildHtmlResponse({
      title: "Configuration Error",
      heading: "Configuration Error",
      message: "HubSpot integration is not configured.",
      status: 500,
      isSuccess: false,
    });
  }

  const redirectUri =
    process.env.HUBSPOT_REDIRECT_URI ?? `${baseUrl}/api/hubspot/callback`;

  console.log("[hubspot] All validations passed, exchanging code for token...");

  try {
    // Exchange authorization code for tokens
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    });

    const tokenResponse = await fetch(HUBSPOT_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!tokenResponse.ok) {
      const body = (await tokenResponse.json().catch(() => ({}))) as {
        error?: string;
        error_description?: string;
      };
      const reason =
        body.error_description ?? body.error ?? "OAuth exchange failed.";
      console.log("[hubspot] Token exchange failed:", reason);
      return buildHtmlResponse({
        title: "Authorization Failed",
        heading: "Authorization Failed",
        message: reason,
        status: 400,
        isSuccess: false,
      });
    }

    const data = (await tokenResponse.json()) as HubspotTokenResponse;
    if (!data.access_token) {
      console.log("[hubspot] No access token returned");
      return buildHtmlResponse({
        title: "Authorization Failed",
        heading: "Authorization Failed",
        message: "HubSpot did not return an access token.",
        status: 400,
        isSuccess: false,
      });
    }

    // Get additional token info
    const tokenInfo = await fetchTokenInfo(data.access_token).catch(() => null);

    const expiresAt = data.expires_in
      ? Date.now() + data.expires_in * 1000
      : null;

    // Prepare HubSpot credentials
    const credentials = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt,
      tokenType: data.token_type ?? null,
      scope: data.scope ?? null,
      hubId: data.hub_id ?? null,
      userEmail: data.user ?? tokenInfo?.user ?? null,
      userId:
        data.user_id?.toString() ?? tokenInfo?.user_id?.toString() ?? null,
    };

    // Store in database
    await upsertIntegrationAccount({
      userId,
      platform: "hubspot",
      externalId: data.hub_id?.toString() ?? data.user ?? userId,
      displayName: `HubSpot (${data.user ?? "Account"})`,
      credentials,
      metadata: {
        hubId: data.hub_id,
        hubDomain: tokenInfo?.hub_domain ?? null,
        userEmail: data.user ?? tokenInfo?.user ?? null,
      },
    });

    console.log("[hubspot] Successfully stored account for user:", userId);

    return buildHtmlResponse({
      title: "Authorization Successful",
      heading: "Authorization Successful!",
      message: "Your HubSpot account has been connected.",
      status: 200,
      isSuccess: true,
    });
  } catch (error) {
    console.error("[hubspot] Callback handling failed", error);
    const message =
      error instanceof AppError
        ? error.message
        : "Failed to complete the authorization. Please try again.";
    return buildHtmlResponse({
      title: "Authorization Failed",
      heading: "Authorization Failed",
      message: "Failed to complete the authorization. Please try again.",
      errorDetail: message,
      status: 500,
      isSuccess: false,
    });
  }
}

async function fetchTokenInfo(
  accessToken: string,
): Promise<HubspotTokenIntrospection | null> {
  const response = await fetch(
    `${HUBSPOT_INTROSPECT_URL}/${encodeURIComponent(accessToken)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as HubspotTokenIntrospection;
}
