/**
 * POST /api/loop/tick
 *   Run a single tick pipeline (signals → classify → enqueue). Returns the
 *   structured result with scanned/surfaced/muted counts and any errors.
 */

import { auth } from "@/app/(auth)/auth";
import { triggerTick } from "@/lib/loop";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    // Enrichment (contact / memory / project lookup) requires the active
    // user id — pull it from the session. If the request is unauthenticated
    // (e.g. CLI / pet) we fall through with `undefined` so the tick still
    // runs with base confidence (graceful degradation).
    const session = await auth().catch(() => null);
    const userId = session?.user?.id ?? undefined;
    const out = await triggerTick({ userId });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "tick failed" },
      { status: 500 },
    );
  }
}
