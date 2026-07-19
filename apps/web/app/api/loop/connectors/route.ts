/**
 * GET  /api/loop/connectors               → cached
 * GET  /api/loop/connectors?refresh=1     → force refresh
 * POST /api/loop/connectors  {refresh:true} → force refresh
 */

import { NextResponse } from "next/server";
import { connectors } from "@/lib/loop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    // `?refresh=1` is a convenience for callers that can't easily POST a
    // JSON body (e.g., `<img src>`, simple `fetch()` probes, server
    // components). The actual refresh path is identical to POST
    // `{refresh:true}` — full 120s probe timeout, no silent-mode
    // short-circuit. Use POST when you want a controlled refresh and
    // don't mind the wait.
    const url = new URL(req.url);
    const refresh = url.searchParams.get("refresh") === "1";
    const { items, lastProbeError } = await connectors({ refresh });
    // `lastProbeError` (#391) is only present when the most recent probe
    // failed; omit the key entirely on the happy path so existing
    // clients reading just `items` see no shape change.
    return NextResponse.json(
      lastProbeError ? { items, lastProbeError } : { items },
    );
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
    const { items, lastProbeError } = await connectors({
      refresh: !!body.refresh,
    });
    return NextResponse.json(
      lastProbeError ? { items, lastProbeError } : { items },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "connectors failed" },
      { status: 500 },
    );
  }
}
