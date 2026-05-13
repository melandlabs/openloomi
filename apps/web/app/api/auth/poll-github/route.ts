/**
 * Poll GitHub OAuth login session status
 *
 * Proxies to cloud since the session is stored there (GitHub callback updates
 * cloud Redis, not local ioredis-mock in dev).
 */

import { type NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId is required" },
      { status: 400 },
    );
  }

  const cloudUrl =
    process.env.CLOUD_API_URL ||
    process.env.NEXT_PUBLIC_CLOUD_API_URL ||
    "https://app.openloomi.ai";

  try {
    const response = await fetch(
      `${cloudUrl}/api/auth/github-poll?sessionId=${encodeURIComponent(sessionId)}`,
    );

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json(
      { error: "Failed to poll cloud session" },
      { status: 503 },
    );
  }
}
