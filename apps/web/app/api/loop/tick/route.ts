/**
 * POST /api/loop/tick
 *   Run a single tick pipeline (signals → classify → enqueue). Returns the
 *   structured result with scanned/surfaced/muted counts and any errors.
 */

import { NextResponse } from "next/server";
import { triggerTick } from "@/lib/loop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    const out = triggerTick();
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "tick failed" },
      { status: 500 },
    );
  }
}
