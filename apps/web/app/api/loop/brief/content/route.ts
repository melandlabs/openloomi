/**
 * GET /api/loop/brief/content
 *
 * Returns the most recent morning-brief snapshot as JSON. The brief is
 * built by `lib/loop/brief.ts` (triggered by `POST /api/loop/brief` or
 * the `loop.brief` cron job) and persisted to
 * `~/.openloomi/loop/brief.json`. The pet card's "Open brief" button
 * and the `/brief` page both read through this endpoint so they show
 * the same content without each side re-implementing the file parse.
 *
 * Response 200 (found):
 *   { ok: true, brief: BriefSnapshot | null }
 *
 * Response 200 (no snapshot yet):
 *   { ok: true, brief: null }
 *
 * The endpoint never 404s on "no brief yet" — the page renders an
 * empty state in that case and offers a "Generate now" button that
 * calls `POST /api/loop/brief`.
 */

import { NextResponse } from "next/server";
import { readBrief } from "@/lib/loop/brief";
import { auth } from "@/app/(auth)/auth";
import { withAutoGuest } from "@/lib/auth/with-auto-guest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withAutoGuest(async () => {
  try {
    // Auth is required so a user can only read their own brief; on a
    // single-user local install the file is the only one present so
    // this is largely a smoke check. withAutoGuest transparently
    // mints a guest on first-hit so a fresh Tauri install doesn't
    // bounce through /guest-login (which would race-create one
    // guest row per parallel API call).
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "auth required" }, { status: 401 });
    }
    const brief = readBrief();
    return NextResponse.json({ ok: true, brief });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "read failed" },
      { status: 500 },
    );
  }
});
