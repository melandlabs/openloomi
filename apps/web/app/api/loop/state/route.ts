/**
 * GET /api/loop/state — aggregated dashboard payload
 *   Loop preferences, counts (pending/done/dismissed/signals),
 *   connector status, last-tick timestamp.
 */

import { NextResponse } from "next/server";
import { state } from "@/lib/loop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const payload = await state();
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "loop state failed" },
      { status: 500 },
    );
  }
}
