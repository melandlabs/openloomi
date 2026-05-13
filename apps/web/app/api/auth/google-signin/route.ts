/**
 * Google OAuth Sign-In
 *
 * Local: proxies to cloud /api/auth/google-signin (cloud creates session).
 * Cloud: receives the forwarded request, creates session in cloud Redis,
 * generates Google OAuth URL, returns { url, sessionId }.
 */

import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import {
  setLoginSession,
  encodeOAuthState,
  ensureRedis,
} from "@/lib/session/context";

export async function GET(request: NextRequest) {
  const cloudUrl =
    process.env.CLOUD_API_URL ||
    process.env.NEXT_PUBLIC_CLOUD_API_URL ||
    "https://app.openloomi.ai";

  // Detect if this is a forwarded request from local proxy
  const isForwarded = request.nextUrl.searchParams.get("from") === "local";

  if (!isForwarded) {
    // Local: proxy to cloud
    try {
      const cloudResponse = await fetch(
        `${cloudUrl}/api/auth/google-signin?from=local`,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: request.headers.get("Authorization") || "",
          },
        },
      );

      if (!cloudResponse.ok) {
        const error = await cloudResponse
          .json()
          .catch(() => ({ error: "Failed to start Google OAuth" }));
        return NextResponse.json(error, { status: cloudResponse.status });
      }

      const data = await cloudResponse.json();
      return NextResponse.json(data);
    } catch (error) {
      console.error("[GoogleSignIn] Failed to forward to cloud:", error);
      return NextResponse.json(
        { error: "Failed to start Google OAuth" },
        { status: 503 },
      );
    }
  }

  // Cloud (forwarded): create session + generate Google URL
  try {
    const sessionId = randomUUID();
    const callbackUrl = `${cloudUrl}/api/auth/callback/google`;

    console.log("[GoogleSignIn] Cloud: creating session", sessionId);
    await ensureRedis();
    const setOk = await setLoginSession(sessionId, {
      provider: "google",
      phone: "pending",
      status: "pending",
      createdAt: Date.now(),
    });
    console.log("[GoogleSignIn] Cloud: setLoginSession result:", setOk);
    if (!setOk) {
      return NextResponse.json(
        { error: "Session creation failed" },
        { status: 500 },
      );
    }

    const oauthState = encodeOAuthState({
      v: 1,
      sid: sessionId,
      p: "google",
      t: Date.now(),
    });
    const googleResponse = await fetch(
      `${cloudUrl}/api/remote-auth/oauth/google?redirect_uri=${encodeURIComponent(callbackUrl)}&state=${encodeURIComponent(oauthState)}`,
    );

    if (!googleResponse.ok) {
      const error = await googleResponse
        .json()
        .catch(() => ({ error: "Failed to get Google OAuth URL" }));
      return NextResponse.json(error, { status: googleResponse.status });
    }

    const { url: googleOAuthUrl } = await googleResponse.json();

    return NextResponse.json({
      url: googleOAuthUrl,
      sessionId,
    });
  } catch (error) {
    console.error("[GoogleSignIn] Cloud handler error:", error);
    return NextResponse.json(
      { error: "Failed to start Google OAuth" },
      { status: 500 },
    );
  }
}
