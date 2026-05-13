/**
 * GitHub OAuth Sign-In
 *
 * Local: proxies to cloud /api/auth/github-signin (cloud creates session).
 * Cloud: receives the forwarded request, creates session in cloud Redis,
 * generates GitHub OAuth URL, returns { url, sessionId }.
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
        `${cloudUrl}/api/auth/github-signin?from=local`,
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
          .catch(() => ({ error: "Failed to start GitHub OAuth" }));
        return NextResponse.json(error, { status: cloudResponse.status });
      }

      const data = await cloudResponse.json();
      return NextResponse.json(data);
    } catch (error) {
      console.error("[GitHubSignIn] Failed to forward to cloud:", error);
      return NextResponse.json(
        { error: "Failed to start GitHub OAuth" },
        { status: 503 },
      );
    }
  }

  // Cloud (forwarded): create session + generate GitHub URL
  try {
    const sessionId = randomUUID();
    const callbackUrl = `${cloudUrl}/api/auth/callback/github`;

    console.log("[GitHubSignIn] Cloud: creating session", sessionId);
    await ensureRedis();
    const setOk = await setLoginSession(sessionId, {
      provider: "github",
      phone: "pending",
      status: "pending",
      createdAt: Date.now(),
    });
    console.log("[GitHubSignIn] Cloud: setLoginSession result:", setOk);
    if (!setOk) {
      return NextResponse.json(
        { error: "Session creation failed" },
        { status: 500 },
      );
    }

    const oauthState = encodeOAuthState({
      v: 1,
      sid: sessionId,
      p: "github",
      t: Date.now(),
    });
    const githubResponse = await fetch(
      `${cloudUrl}/api/remote-auth/oauth/github?redirect_uri=${encodeURIComponent(callbackUrl)}&state=${encodeURIComponent(oauthState)}`,
    );

    if (!githubResponse.ok) {
      const errorText = await githubResponse.text();
      console.error("[GitHubSignIn] GitHub OAuth error:", errorText);
      let error: { error: string };
      try {
        error = JSON.parse(errorText);
      } catch {
        error = { error: "Failed to get GitHub OAuth URL" };
      }
      return NextResponse.json(error, { status: githubResponse.status });
    }

    const { url: githubOAuthUrl } = await githubResponse.json();

    return NextResponse.json({
      url: githubOAuthUrl,
      sessionId,
    });
  } catch (error) {
    console.error("[GitHubSignIn] Cloud handler error:", error);
    return NextResponse.json(
      { error: "Failed to start GitHub OAuth" },
      { status: 500 },
    );
  }
}
