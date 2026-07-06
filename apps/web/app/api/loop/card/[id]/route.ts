/**
 * GET /api/loop/card/[id]
 *   Returns the card-shaped JSON the pet / web UI consume directly:
 *     - source_chain
 *     - why
 *     - dialogue
 *     - nextStep
 */

import { NextResponse } from "next/server";
import { getCard } from "@/lib/loop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params;
    const card = getCard(id);
    if (!card) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(card);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "card failed" },
      { status: 500 },
    );
  }
}
