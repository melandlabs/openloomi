import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { auth } from "@/app/(auth)/auth";
import { getApplicationBaseUrl } from "@/lib/env";
import { encryptToken } from "@openloomi/security/token-encryption";

const OUTLOOK_CAL_STATE_COOKIE = "outlook_cal_oauth_state";
const OAUTH_STATE_TTL_SECONDS = 10 * 60;

const DEFAULT_SCOPES = [
  "offline_access",
  "User.Read",
  "Calendars.Read",
  "Calendars.ReadWrite",
].join(" ");

type StartPayload = {
  redirectUri?: string;
  redirectPath?: string;
};

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as StartPayload;

  const clientId = process.env.OUTLOOK_CALENDAR_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "Outlook Calendar OAuth is not configured" },
      { status: 500 },
    );
  }

  const tenant = process.env.OUTLOOK_CALENDAR_TENANT_ID || "common";
  const scope = process.env.OUTLOOK_CALENDAR_SCOPE ?? DEFAULT_SCOPES;
  const statePayload = {
    nonce: randomUUID(),
    ts: Date.now(),
    userId: session.user.id,
    returnTo: `${getApplicationBaseUrl()}/?page=profile`,
    redirectPath: payload.redirectPath,
  };
  const state = encryptToken(JSON.stringify(statePayload));

  const redirectUri = resolveRedirectUri(
    payload.redirectUri,
    payload.redirectPath ?? "/outlook-calendar-authorized",
    process.env.OUTLOOK_CALENDAR_REDIRECT_URI,
  );

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope,
    state,
    prompt: "select_account",
  });

  const authorizationUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params.toString()}`;

  const response = NextResponse.json(
    { authorizationUrl, state, redirectUri },
    { status: 200 },
  );

  response.cookies.set({
    name: OUTLOOK_CAL_STATE_COOKIE,
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

  const path = ensureLeadingSlash(
    redirectPath || "/outlook-calendar-authorized",
  );
  return `${getApplicationBaseUrl()}${path}`.replace(/\/$/, "");
}

function ensureLeadingSlash(path: string) {
  const trimmed = path.trim();
  if (!trimmed) {
    return "/outlook-calendar-authorized";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function sanitizeAbsoluteUri(uri: string) {
  return uri.trim().replace(/\/$/, "");
}
