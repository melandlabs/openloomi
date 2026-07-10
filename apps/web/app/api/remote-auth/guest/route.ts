/**
 * Cloud guest login API
 * Used by the local OpenLoomi Claude/Codex plugins to mint a guest bearer
 * token without going through the web sign-in flow. Mirrors the user
 * creation logic in `app/(auth)/api/auth/guest/route.ts` but returns a
 * bearer token + auth cookies instead of NextAuth session cookies, so the
 * resulting token is compatible with the Tauri desktop runtime's
 * `~/.openloomi/token` file and the standard
 * `Authorization: Bearer <token>` API contract.
 *
 * - Web: direct handling (rate limited)
 * - Tauri desktop: handled locally — guest accounts are not forwarded to
 *   the cloud; the whole point is to give a desktop user a local identity
 *   without requiring OAuth/credentials.
 */

import type { NextRequest } from "next/server";
import { getUser, createUser } from "@/lib/db/queries";
import { DUMMY_PASSWORD } from "@/lib/env/constants";
import {
  generateToken,
  getTokenLifetime,
  withErrorHandler,
  createSuccessResponse,
  createErrorResponse,
} from "@/lib/auth/remote-auth-utils";
import {
  withRateLimit,
  createRateLimitResponse,
  RateLimitPresets,
} from "@/lib/rate-limit/middleware";
import { setAuthCookies } from "@/lib/auth/cookie-auth";

export async function POST(request: NextRequest) {
  // Guest login is rate-limited like register (one fresh guest per install
  // is the common case, but plugins can retry on transient failures).
  const rateLimitResult = await withRateLimit(
    request,
    RateLimitPresets.register,
  );
  if (!rateLimitResult.success) {
    return createRateLimitResponse(rateLimitResult);
  }

  return withErrorHandler(async () => {
    // Generate a unique guest email. Same shape as the web guest page so
    // a user that signs in via the web first and then re-mints from the
    // plugin (or vice-versa) lands on a recognisable account.
    const guestId = `guest-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 8)}`;
    const guestEmail = `${guestId}@guest.local`;

    // Idempotent: if the email already exists (extremely unlikely with
    // the timestamp+random suffix, but defensive), skip creation and
    // re-use the existing row.
    const existing = await getUser(guestEmail);
    let userId: string;
    let userName: string;

    if (existing.length > 0) {
      userId = existing[0].id;
      userName = existing[0].name ?? guestEmail.split("@")[0] ?? "guest";
    } else {
      const [created] = await createUser(guestEmail, DUMMY_PASSWORD);
      if (!created) {
        return createErrorResponse("Failed to create guest user", 500);
      }
      userId = created.id;
      userName = created.name ?? guestEmail.split("@")[0] ?? "guest";
    }

    // Mint a bearer token. Same token format as /api/remote-auth/login
    // and /api/remote-auth/register, so the Tauri `load_token` verifier
    // accepts it without any extra wiring.
    const token = generateToken(userId, guestEmail);

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      id: userId,
      email: guestEmail,
      exp: now + getTokenLifetime(),
      iat: now,
    };

    const response = createSuccessResponse({
      user: {
        id: userId,
        email: guestEmail,
        name: userName,
        avatarUrl: null,
        type: "guest",
      },
      token,
    });
    return setAuthCookies(response, token, payload);
  });
}
