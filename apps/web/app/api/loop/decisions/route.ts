/**
 * GET /api/loop/decisions?status=pending|done|dismissed
 *   Returns the requested bucket. Defaults to all (pending+done+dismissed).
 */

import { NextResponse } from "next/server";
import { listDecisions } from "@/lib/loop";
import type { DecisionStatus } from "@/lib/loop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID: DecisionStatus[] = ["pending", "done", "dismissed"];

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status") as DecisionStatus | null;
    if (status && !VALID.includes(status)) {
      return NextResponse.json(
        { error: `invalid status: ${status}` },
        { status: 400 },
      );
    }
    const items = listDecisions(status ?? undefined);
    return NextResponse.json({ items, count: items.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "list failed" },
      { status: 500 },
    );
  }
}
