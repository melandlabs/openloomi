/**
 * GET  /api/loop/decision/[id]   → full decision JSON
 * POST /api/loop/decision/[id]   → { action: 'run'|'dry'|'dismiss'|'promote', reason? }
 */

import { NextResponse } from "next/server";
import { applyDecisionAction, getDecision } from "@/lib/loop";
import type { DecisionActionInput } from "@/lib/loop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params;
    const dec = getDecision(id);
    if (!dec) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ decision: dec });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "get failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params;
    let body: DecisionActionInput;
    try {
      body = (await req.json()) as DecisionActionInput;
    } catch {
      return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }
    if (!body || !body.action) {
      return NextResponse.json({ error: "action required" }, { status: 400 });
    }
    const out = await applyDecisionAction(id, body);
    const status = out.ok ? 200 : 400;
    return NextResponse.json(out, { status });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "action failed" },
      { status: 500 },
    );
  }
}
