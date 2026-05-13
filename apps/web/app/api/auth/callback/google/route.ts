/**
 * Google OAuth Callback Handler
 *
 * Receives the Google redirect, exchanges the code, updates the login session,
 * and shows a "success" page. The client polls /api/auth/poll-google to detect
 * completion and stores the token.
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  setLoginSession,
  decodeOAuthState,
  ensureRedis,
} from "@/lib/session/context";

function successHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Authorization Successful</title>
  <style>
    body { font-family: 'Noto Sans SC', 'PingFang SC', 'Helvetica Neue', -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .container { text-align: center; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; }
    h1 { color: #4285f4; margin-bottom: 20px; }
    p { color: #616061; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorization Successful!</h1>
    <p>Your Google account has been connected.</p>
    <p>You can close this window and return to the app.</p>
  </div>
</body>
</html>`;
}

function errorHtml(message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Authorization Failed</title>
  <style>
    body { font-family: 'Noto Sans SC', 'PingFang SC', 'Helvetica Neue', -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .container { text-align: center; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; }
    h1 { color: #ea4335; margin-bottom: 20px; }
    p { color: #616061; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorization Failed</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const rawState = searchParams.get("state");
  const oauthError = searchParams.get("error");

  // Decode and verify the signed OAuth state
  let sessionId: string | null = null;
  if (rawState) {
    const stateData = decodeOAuthState(rawState);
    if (stateData) {
      sessionId = stateData.sid;
      console.log(
        "[GoogleCallback] state decoded successfully, sessionId:",
        sessionId,
      );
    } else {
      console.error("[GoogleCallback] Invalid or tampered OAuth state");
      return new NextResponse(errorHtml("Invalid or tampered OAuth state."), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  }

  // Handle OAuth error from Google
  if (oauthError) {
    console.error("[GoogleCallback] OAuth error:", oauthError);
    if (sessionId) {
      await setLoginSession(sessionId, {
        provider: "google",
        phone: "pending",
        status: "error",
        error: oauthError,
        createdAt: Date.now(),
      });
    }
    return new NextResponse(errorHtml("Google authorization was denied."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Validate required params
  if (!code || !sessionId) {
    return new NextResponse(errorHtml("Missing required parameters."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // HMAC state is verified above — sessionId is trusted. Skip Redis lookup.
  console.log("[GoogleCallback] Proceeding with trusted sessionId:", sessionId);

  try {
    await ensureRedis();

    // Exchange code with the remote-auth exchange endpoint directly
    const cloudUrl =
      process.env.CLOUD_API_URL ||
      process.env.NEXT_PUBLIC_CLOUD_API_URL ||
      "https://app.openloomi.ai";

    const exchangeResponse = await fetch(
      `${cloudUrl}/api/remote-auth/oauth/google/exchange`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      },
    );

    if (!exchangeResponse.ok) {
      const err = await exchangeResponse
        .json()
        .catch(() => ({ error: "Exchange failed" }));
      throw new Error(
        err.error || `Exchange failed: ${exchangeResponse.status}`,
      );
    }

    const result = await exchangeResponse.json();

    if (!result.token || !result.user) {
      throw new Error("Invalid response from exchange API");
    }

    // Update session to completed with token, user, and password (for local signIn)
    const stored = await setLoginSession(sessionId, {
      provider: "google",
      phone: "pending",
      status: "completed",
      token: result.token,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      user: result.user as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      password: (result as any).password,
      createdAt: Date.now(),
    });
    console.log("[GoogleCallback] setLoginSession stored:", stored);

    return new NextResponse(successHtml(), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (error) {
    console.error("[GoogleCallback] Callback error:", error);

    // Update session to error
    await setLoginSession(sessionId, {
      provider: "google",
      phone: "pending",
      status: "error",
      error: error instanceof Error ? error.message : "Authentication failed",
      createdAt: Date.now(),
    });

    return new NextResponse(
      errorHtml(
        error instanceof Error ? error.message : "Authentication failed",
      ),
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}
