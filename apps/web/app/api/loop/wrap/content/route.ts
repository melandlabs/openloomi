/**
 * GET /api/loop/wrap/content
 *
 * Returns the most recent evening-wrap snapshot. Mirrors the
 * `/api/loop/brief/content` endpoint — read by the pet card's
 * "Open wrap" button and the `/wrap` page. The wrap is built by
 * `lib/loop/wrap.ts` and persisted to `~/.openloomi/loop/wrap.json`.
 *
 * Response 200 (found):
 *   { ok: true, wrap: WrapSnapshot | null }
 */

import { NextResponse } from "next/server";
import { readWrap } from "@/lib/loop/wrap";
import { auth } from "@/app/(auth)/auth";
import { withAutoGuest } from "@/lib/auth/with-auto-guest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withAutoGuest(async () => {
  try {
    // Mirror /api/loop/brief/content: a fresh Tauri install has no
    // session yet, so the wrapper auto-mints a guest on the first
    // call instead of bouncing to /guest-login (which races one
    // guest row per parallel API call).
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "auth required" }, { status: 401 });
    }
    const wrap = readWrap();
    return NextResponse.json({ ok: true, wrap });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "read failed" },
      { status: 500 },
    );
  }
});
