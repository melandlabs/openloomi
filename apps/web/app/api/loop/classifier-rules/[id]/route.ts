/**
 * DELETE /api/loop/classifier-rules/[id]
 *   Remove a user-defined classifier rule by id. Returns 404 if the
 *   rule was never registered (or was already removed). Built-in ids
 *   (rsvp / draft_reply / …) are not reachable here because the
 *   validator already rejects them on upsert.
 */

import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { classifierRules, log, RULE_ID_RE } from "@/lib/loop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  try {
    await auth().catch(() => null);
    const { id } = await ctx.params;
    if (typeof id !== "string" || !RULE_ID_RE.test(id)) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const removed = classifierRules.remove(id);
    if (!removed) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    log(`[loop.classifierRules] removed ${id}`);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "delete classifier rule failed",
      },
      { status: 500 },
    );
  }
}
