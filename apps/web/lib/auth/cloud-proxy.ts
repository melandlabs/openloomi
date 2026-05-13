/**
 * Cloud API proxy utility functions
 */

import type { NextRequest } from "next/server";

/**
 * Get cloud API URL
 */
export function getCloudUrl(): string {
  return (
    process.env.CLOUD_API_URL ||
    process.env.NEXT_PUBLIC_CLOUD_API_URL ||
    "https://app.openloomi.ai"
  );
}

/**
 * Forward request to cloud (only called in local environment)
 */
export async function forwardToCloud(
  request: NextRequest,
  path: string,
  body?: string,
): Promise<Response> {
  const cloudUrl = getCloudUrl();
  const url = `${cloudUrl}${path}`;

  // Forward headers
  const headers = new Headers();
  headers.set("Content-Type", "application/json");

  // Forward Authorization (Bearer token)
  const authHeader = request.headers.get("Authorization");
  if (authHeader) {
    headers.set("Authorization", authHeader);
  }

  // Forward Cookie (session authentication)
  const cookieHeader = request.headers.get("Cookie");
  if (cookieHeader) {
    headers.set("Cookie", cookieHeader);
  }

  try {
    const response = await fetch(url, {
      method: request.method,
      headers,
      body:
        request.method !== "GET" ? body || (await request.text()) : undefined,
    });

    const data = await response.json();

    return Response.json(data, { status: response.status });
  } catch (error) {
    console.error(`[Cloud Proxy] Failed to forward to ${url}:`, error);
    return new Response(
      JSON.stringify({
        error: "Failed to connect to cloud API",
        message: "Please try again later",
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
