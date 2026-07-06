/**
 * POST /api/loop/brief  { force?: boolean }
 *   Builds the morning brief and enqueues a `type:"brief"` decision card.
 */

import { NextResponse } from "next/server";
import { triggerBrief } from "@/lib/loop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    let body: { force?: boolean } = {};
    try {
      body = (await req.json()) as { force?: boolean };
    } catch {
      /* defaults */
    }
    const out = await triggerBrief({ force: body.force ?? true });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "brief failed" },
      { status: 500 },
    );
  }
}
