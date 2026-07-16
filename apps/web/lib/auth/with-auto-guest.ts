/**
 * Higher-order wrapper for Next.js Route Handlers that should
 * transparently bootstrap an anonymous guest when called without a
 * session.
 *
 * Routes wrap their handler like:
 *
 *   export const GET = withAutoGuest(async (req) => {
 *     const session = ...   // now guaranteed to exist
 *     return NextResponse.json({...});
 *   });
 *
 * The wrapper:
 *  1. Calls `auth()`. If a session exists, falls through.
 *  2. Otherwise calls `ensureGuestSession()` — same helper the plugins
 *     use via `/api/remote-auth/guest`.
 *  3. Re-runs the handler with a populated session.
 *  4. After the handler returns, attaches any cookies the mint wrote
 *     (NextAuth session, csrf, `loomi-anon-id`) onto the outgoing
 *     NextResponse. This mirrors the manual cookie-copy block in
 *     `app/(auth)/api/auth/guest/route.ts:62-77` so we keep parity
 *     with the existing redirect handler.
 *
 * If everything is fine, the wrapper is essentially a no-op for the
 * caller; the only observable change on a hot path is one extra
 * `auth()` call we already pay for in the wrapped handler.
 *
 * Runtime: must run with `runtime = "nodejs"` — see `auto-guest.ts`.
 */

import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/app/(auth)/auth";
import { ensureGuestSession } from "./auto-guest";

type JsonHandler<TCtx> = (
  request: NextRequest,
  ctx: TCtx,
) => Promise<NextResponse>;

export function withAutoGuest<TCtx = unknown>(
  handler: JsonHandler<TCtx>,
): JsonHandler<TCtx> {
  return async (request, ctx) => {
    let session = await auth();
    let attachSessionCookies: ((response: NextResponse) => void) | null = null;

    if (!session?.user?.id) {
      const guest = await ensureGuestSession();
      session = guest.session;
      if (guest.minted) {
        attachSessionCookies = guest.attachSessionCookies;
      }
    }

    if (!session?.user?.id) {
      const errResp = NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
      if (attachSessionCookies) {
        attachSessionCookies(errResp);
      }
      return errResp;
    }

    const response = await handler(request, ctx);
    if (attachSessionCookies) {
      attachSessionCookies(response);
    }
    return response;
  };
}
