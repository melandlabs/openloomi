/**
 * DELETE /api/loop/channels/[id]
 *   Remove a custom signal channel by id. Built-in connectors are
 *   never removable through this endpoint (they're hard-coded in
 *   `connectors.ts:FALLBACK_CONNECTORS`) — `404` is returned for ids
 *   the user never registered.
 */

import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { customChannels } from "@/lib/loop";
import { log } from "@/lib/loop";
import { CUSTOM_CHANNEL_ID_RE } from "@/lib/loop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  try {
    await auth().catch(() => null);
    const { id } = await ctx.params;
    if (typeof id !== "string" || !CUSTOM_CHANNEL_ID_RE.test(id)) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const removed = customChannels.remove(id);
    if (!removed) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    log(`[loop.customChannels] removed ${id}`);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "delete custom channel failed",
      },
      { status: 500 },
    );
  }
}
