/**
 * DELETE /api/loop/types/[id]
 *   Remove a custom decision type by id. Built-in types are never
 *   removable through this endpoint (the validator already rejects them
 *   on upsert) — `404` is returned for ids the user never registered.
 */

import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { customTypes } from "@/lib/loop";
import { log } from "@/lib/loop";
import { CUSTOM_TYPE_ID_RE } from "@/lib/loop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  try {
    await auth().catch(() => null);
    const { id } = await ctx.params;
    if (typeof id !== "string" || !CUSTOM_TYPE_ID_RE.test(id)) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const removed = customTypes.remove(id);
    if (!removed) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    log(`[loop.customTypes] removed ${id}`);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "delete custom type failed" },
      { status: 500 },
    );
  }
}
