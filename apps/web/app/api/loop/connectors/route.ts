/**
 * GET  /api/loop/connectors          → cached (60s TTL)
 * POST /api/loop/connectors  {refresh:true} → force refresh
 */

import { NextResponse } from "next/server";
import { connectors } from "@/lib/loop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const items = await connectors();
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "connectors failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    let body: { refresh?: boolean } = {};
    try {
      body = (await req.json()) as { refresh?: boolean };
    } catch {
      /* default to no-refresh */
    }
    const items = await connectors({ refresh: !!body.refresh });
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "connectors failed" },
      { status: 500 },
    );
  }
}
