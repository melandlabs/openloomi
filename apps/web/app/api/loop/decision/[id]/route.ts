/**
 * GET   /api/loop/decision/[id]   → full decision JSON
 * POST  /api/loop/decision/[id]   → { action: 'run'|'dry'|'dismiss'|'promote', reason? }
 * PATCH /api/loop/decision/[id]   → { draft: { subject: string|null, body: string } }
 *
 * The PATCH handler is the pet card's inline editor: it persists a
 * user-edited draft (subject + body) into `context.draft` so the runner
 * can pick it up at execute time. Only pending decisions accept edits —
 * 409 if the decision has already been moved to done / dismissed. The
 * `context.draft` slot is not stripped by `normalizeDecision` in
 * `lib/loop/store.ts:88`, so it's safe to write through `decisions.update`.
 */

import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { withAutoGuest } from "@/lib/auth/with-auto-guest";
import { applyDecisionAction, decisions, getDecision, log } from "@/lib/loop";
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

const MAX_DRAFT_BODY = 50_000;
const MAX_DRAFT_SUBJECT = 998;

export const PATCH = withAutoGuest<RouteCtx>(async (req, ctx) => {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "auth required" }, { status: 401 });
    }
    const { id } = await ctx.params;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "bad json" }, { status: 400 });
    }
    const b = (body ?? {}) as {
      draft?: { subject?: unknown; body?: unknown };
    };
    const draftBody = b.draft?.body;
    if (typeof draftBody !== "string" || draftBody.trim().length === 0) {
      return NextResponse.json(
        { error: "draft.body required" },
        { status: 400 },
      );
    }
    if (draftBody.length > MAX_DRAFT_BODY) {
      return NextResponse.json(
        { error: "draft.body too long" },
        { status: 413 },
      );
    }
    const draftSubject = b.draft?.subject;
    if (draftSubject != null && typeof draftSubject !== "string") {
      return NextResponse.json(
        { error: "draft.subject must be string|null" },
        { status: 400 },
      );
    }
    if (
      typeof draftSubject === "string" &&
      draftSubject.length > MAX_DRAFT_SUBJECT
    ) {
      return NextResponse.json(
        { error: "draft.subject too long" },
        { status: 413 },
      );
    }

    const dec = decisions.get(id);
    if (!dec) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (dec.status !== "pending") {
      return NextResponse.json(
        { error: `not pending (${dec.status})` },
        { status: 409 },
      );
    }
    const updated = decisions.update(id, {
      context: {
        ...(dec.context ?? {}),
        draft: { subject: draftSubject ?? null, body: draftBody },
      },
    });
    log(
      `edit ${id} draft subject=${typeof draftSubject === "string" ? draftSubject.length : 0}b body=${draftBody.length}b`,
    );
    return NextResponse.json({ ok: true, decision: updated });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "edit failed" },
      { status: 500 },
    );
  }
});
