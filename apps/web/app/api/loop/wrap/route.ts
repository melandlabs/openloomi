/**
 * POST /api/loop/wrap  { force?: boolean }
 *   Builds the evening wrap and enqueues a `type:"wrap"` decision card.
 */

import { NextResponse } from "next/server";
import { triggerWrap } from "@/lib/loop";

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
    const out = await triggerWrap({ force: body.force ?? true });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "wrap failed" },
      { status: 500 },
    );
  }
}
