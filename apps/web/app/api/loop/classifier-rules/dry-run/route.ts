/**
 * POST /api/loop/classifier-rules/dry-run
 *   Body: { signal: Partial<LoopSignal> }
 *   Response: { matches: { ruleId, then }[], trace: { ruleId, matched }[] }
 *
 * Dry-run the rule list against a candidate signal. Used by the
 * `openloomi-loop` skill (and the Settings UI) to preview which rule
 * would fire — without persisting anything. The full trace shows every
 * rule's outcome, so a user can see WHY a particular rule matched and
 * why another didn't.
 *
 * This is the safety net for the deterministic layer: if a user is
 * about to save a rule that swallows too much, dry-run surfaces it
 * before commit.
 */

import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { classifierRules, evaluateRule } from "@/lib/loop";
import type { LoopSignal } from "@/lib/loop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface DryRunBody {
  signal?: Partial<LoopSignal>;
}

export async function POST(req: Request) {
  try {
    await auth().catch(() => null);
    let body: DryRunBody = {};
    try {
      body = (await req.json()) as DryRunBody;
    } catch {
      return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }
    if (!body.signal || typeof body.signal !== "object") {
      return NextResponse.json(
        { error: "body.signal must be a LoopSignal-shaped object" },
        { status: 400 },
      );
    }
    const rules = classifierRules.list();
    const trace = rules.map((r) => {
      const ev = evaluateRule(body.signal as Partial<LoopSignal>, r);
      return { ruleId: r.id, matched: ev.matched };
    });
    const matches = trace
      .filter((t) => t.matched)
      .map((t) => {
        // biome-ignore lint/style/noNonNullAssertion: trace was just produced from `rules` above, so the lookup is guaranteed to succeed
        const r = rules.find((x) => x.id === t.ruleId)!;
        // biome-ignore lint/suspicious/noThenProperty: `then` is the schema-defined action block key on ClassifierRule; renaming would break the persisted JSON contract
        return { ruleId: r.id, then: r.then };
      });
    return NextResponse.json({
      matches,
      trace,
      signal: body.signal,
      totalRules: rules.length,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "dry-run classifier rules failed",
      },
      { status: 500 },
    );
  }
}
