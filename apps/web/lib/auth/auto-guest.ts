/**
 * Auto-guest bootstrap for routes that should mint an anonymous guest
 * the first time they're hit without a session.
 *
 * Mirrors the plugin-side `POST /api/remote-auth/guest` (see
 * `apps/web/app/api/remote-auth/guest/route.ts`) but instead of returning
 * a Bearer it sets the NextAuth session cookie on the in-flight response
 * so the browser reuses the same identity for every subsequent call.
 *
 * The browser's cookie jar carries the identity, so once the first
 * response lands, every later request hits `auth()` and exits early —
 * we do NOT mint a new user each call. That fixes the original bug where
 * 5 concurrent first-burst requests each spawned one guest row because
 * the proxy redirected each to `/guest-login` and the page ran
 * `POST /api/auth/guest` independently per mount.
 *
 * Stable ID source: an httpOnly `loomi-anon-id` cookie set on the very
 * first request and reused for every subsequent request from the same
 * browser. The guest email is `${anonId}@guest.local` so concurrent
 * first-burst calls race on `getUser(...)` reuse (the row exists after
 * the first insert) instead of each generating a unique timestamp.
 *
 * In Tauri mode the helper additionally writes the freshly minted
 * bearer JWT to `~/.openloomi/token` (base64-encoded, mirroring
 * `apps/web/src-tauri/src/storage.rs:save_token`). This is what
 * the existing `guest-login/page.tsx` does via
 * `invoke("save_token", ...)` after fetching `/api/auth/token` — we
 * just inline the same shape server-side so plugins, Bridge CLI,
 * and any other non-browser consumer can authenticate as the same
 * identity the GUI just adopted. Web mode skips this step because
 * `~/.openloomi/` is a Tauri-specific namespace and the file isn't
 * consumed by anything in pure-web runs.
 *
 * Runtime: must run with `runtime = "nodejs"` — uses `signIn` (which
 * touches NextAuth's adapter layer), `db` (better-sqlite3), and
 * direct FS writes for the token file.
 */

import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import type { Session } from "next-auth";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { auth, signIn } from "@/app/(auth)/auth";
import { getUser, createUser } from "@/lib/db/queries";
import { DUMMY_PASSWORD } from "@/lib/env/constants";
import { generateToken } from "@/lib/auth/remote-auth-utils";

export const ANON_ID_COOKIE = "loomi-anon-id";
const ANON_ID_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year
const GUEST_EMAIL_DOMAIN = "@guest.local";

function newAnonId(): string {
  // Stable, no PII. UUID v4 in hex (strip dashes) keeps it URL-safe
  // and trivially distinguishable from any other `email-prefix` we
  // might use elsewhere. Prefixed with `anon-` so DB inspection can
  // tell guest emails apart from regular users at a glance.
  const hex = (globalThis.crypto?.randomUUID?.() ?? "").replace(/-/g, "");
  if (hex.length === 32) return `anon-${hex}`;
  // Fallback for runtimes without global crypto — extremely unlikely
  // in practice (Node 19+ and the Edge runtime both have it) but we
  // guard so a missing crypto doesn't break first-paint.
  return `anon-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export interface AutoGuestResult {
  /** The session after the bootstrap, or null if minting failed. */
  session: Session | null;
  /**
   * Apply the cookies the bootstrap just minted (`loomi-anon-id`,
   * `authjs.session-token`, csrf) onto a `NextResponse` before
   * returning it. Mirrors the existing
   * `app/(auth)/api/auth/guest/route.ts` post-`signIn` cookie-copy
   * pattern so the browser persists the session across redirects.
   *
   * Safe to call on any NextResponse; no-op when `minted === false`.
   */
  attachSessionCookies: (response: NextResponse) => void;
  /** True if this call actually minted or refreshed a guest. */
  minted: boolean;
  /** The guest email used (or that already exists) — handy for tests. */
  guestEmail: string | null;
}

const NOOP_ATTACH = () => {};

export async function ensureGuestSession(): Promise<AutoGuestResult> {
  // 1. Already authenticated — nothing to do. The browser is reusing
  // the cookies set on the previous response and `auth()` decodes the
  // session JWT into a fully populated Session.
  const existing = await auth();
  if (existing?.user?.id) {
    return {
      session: existing,
      attachSessionCookies: NOOP_ATTACH,
      minted: false,
      guestEmail: existing.user.email ?? null,
    };
  }

  // 2. Resolve anon-id (read or mint + persist). One stable id per
  // browser, persisted for the install lifetime, makes concurrent
  // first-burst calls idempotent on `getUser(guestEmail)`.
  const cookieStore = await cookies();
  let anonId = cookieStore.get(ANON_ID_COOKIE)?.value ?? null;
  let mintedAnon = false;
  if (!anonId) {
    anonId = newAnonId();
    cookieStore.set({
      name: ANON_ID_COOKIE,
      value: anonId,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: ANON_ID_MAX_AGE_SECONDS,
    });
    mintedAnon = true;
  }
  const guestEmail = `${anonId}${GUEST_EMAIL_DOMAIN}`;

  // 3. Idempotent: get-or-create user. Because the anon-id is stable,
  // parallel first-burst calls all hit this `getUser`, see the row on
  // the second-or-later insert, and reuse the same id. No more than
  // one guest row per install.
  const existingUsers = await getUser(guestEmail);
  let userId: string;
  if (existingUsers.length > 0) {
    userId = existingUsers[0].id;
  } else {
    const [created] = await createUser(guestEmail, DUMMY_PASSWORD);
    if (!created) {
      throw new Error("[auto-guest] Failed to create guest user");
    }
    userId = created.id;
  }

  // 4. Re-sign in so the response gets a fresh NextAuth session cookie.
  // We do this even when the user row already existed, because the
  // browser may have lost its session cookie (`/login` clears them per
  // proxy.ts:91-103) while the anon-id persists — re-signing bridges
  // that gap without forcing a new identity.
  await signIn("credentials", {
    email: guestEmail,
    password: DUMMY_PASSWORD,
    redirect: false,
  });

  // 5. In Tauri mode, write the same bearer JWT that the existing
  // `guest-login/page.tsx` flow writes via `invoke("save_token", ...)`
  // — but server-side so plugins / Bridge CLI / anything reading
  // `~/.openloomi/token` outside the browser can authenticate as the
  // same identity the GUI just adopted. Encoding matches
  // `apps/web/src-tauri/src/storage.rs:save_token` (base64-STANDARD
  // of the raw JWT, 0o600 on Unix). Skipped in pure-web mode where
  // the file isn't consumed and `~/.openloomi/` is a Tauri-only
  // namespace. Wrapped in try/catch so a transient FS hiccup never
  // breaks the API response — plugins will simply see the old (or no)
  // token until the next auto-guest run.
  if (process.env.IS_TAURI === "true") {
    await writeTauriTokenFile(userId, guestEmail);
  }

  const session = await auth();

  // 6. Build the cookie-attach hook. We copy every cookie the store
  // currently holds with the canonical NextAuth + anon-id attribute
  // set. Same shape as the existing
  // `app/(auth)/api/auth/guest/route.ts:67-77` post-`signIn` block.
  const attachSessionCookies = (response: NextResponse) => {
    for (const cookie of cookieStore.getAll()) {
      response.cookies.set({
        name: cookie.name,
        value: cookie.value,
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
    }
  };

  return {
    session,
    attachSessionCookies,
    minted: mintedAnon,
    guestEmail,
  };
}

/**
 * Write `~/.openloomi/token` with a base64-STANDARD encoded JWT, mirroring
 * `apps/web/src-tauri/src/storage.rs:save_token`. Used only by the Tauri
 * auto-guest bootstrap so plugins / Bridge CLI / non-browser consumers
 * can authenticate as the same identity the GUI just minted.
 *
 * Best-effort: a transient FS error logs a warning and returns without
 * throwing so the calling API can still respond successfully. The plugin
 * sees the old (or no) token until the next auto-guest run.
 */
async function writeTauriTokenFile(
  userId: string,
  guestEmail: string,
): Promise<void> {
  try {
    const token = generateToken(userId, guestEmail);
    const home = os.homedir();
    if (!home) {
      console.warn("[auto-guest] HOME is not set; skipping token write");
      return;
    }
    const tokenPath = path.join(home, ".openloomi", "token");
    const dir = path.dirname(tokenPath);
    await fs.mkdir(dir, { recursive: true });
    const encoded = Buffer.from(token, "utf8").toString("base64");
    await fs.writeFile(tokenPath, encoded, { encoding: "utf8", mode: 0o600 });
    // Best-effort chmod in case the FS ignored `mode` (some FUSE mounts
    // drop POSIX bits). Mirrors storage.rs:113-119's `chmod 0o600`.
    try {
      await fs.chmod(tokenPath, 0o600);
    } catch {
      /* non-fatal */
    }
    console.log(`[auto-guest] wrote token file: ${tokenPath}`);
  } catch (e) {
    console.warn(
      `[auto-guest] failed to write ~/.openloomi/token: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}
