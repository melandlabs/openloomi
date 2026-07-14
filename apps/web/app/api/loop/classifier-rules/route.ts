/**
 * GET  /api/loop/classifier-rules    → list all user-defined rules
 * PUT  /api/loop/classifier-rules    → upsert a single rule
 *   body = Omit<ClassifierRule, "createdAt">
 *
 * Classifier rules are the deterministic layer above custom types /
 * channels. Each rule pins a signal pattern (via a safe AST of
 * `when` predicates) to a forced `then.type` / `then.actionKind` /
 * `then.confidence`. The agentic tick prompt injects them as hard
 * constraints in §5, and the watcher post-processes the agent's
 * output to make the routing deterministic.
 *
 * Safety: the `when` clauses are validated against the closed
 * `RULE_OPS` set in `lib/loop/classifier-rules.ts`. No eval, no
 * arbitrary JS — only JSON-serialisable predicate objects.
 */

import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import {
  classifierRules,
  customTypes,
  log,
  RULE_ID_RE,
  validateClassifierRule,
} from "@/lib/loop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ rules: classifierRules.list() });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "list classifier rules failed",
      },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  try {
    await auth().catch(() => null);
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "body must be a JSON object" },
        { status: 400 },
      );
    }
    if (typeof body.id !== "string" || !RULE_ID_RE.test(body.id)) {
      return NextResponse.json(
        {
          error:
            "id must be snake_case, 2-41 chars, start with a letter (e.g. force_birthday)",
        },
        { status: 400 },
      );
    }
    if (!Array.isArray(body.when)) {
      return NextResponse.json(
        { error: "when must be an array of conditions" },
        { status: 400 },
      );
    }
    if (
      !body.then ||
      typeof body.then !== "object" ||
      Array.isArray(body.then)
    ) {
      return NextResponse.json(
        {
          error:
            "then must be an object with type (and optional actionKind / confidence)",
        },
        { status: 400 },
      );
    }
    const knownCustomTypeIds = customTypes.list().map((t) => t.id);
    const result = validateClassifierRule(
      {
        id: body.id,
        when: body.when as Parameters<typeof validateClassifierRule>[0]["when"],
        // biome-ignore lint/suspicious/noThenProperty: `then` is the schema-defined action block key on ClassifierRule; renaming would break the persisted JSON contract
        then: body.then as Parameters<typeof validateClassifierRule>[0]["then"],
        ...(typeof body.label === "string" ? { label: body.label } : {}),
        ...(typeof body.description === "string"
          ? { description: body.description }
          : {}),
      },
      { knownCustomTypeIds },
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    const upsert = classifierRules.upsert(result.rule);
    log(
      `[loop.classifierRules] ${upsert.created ? "created" : "updated"} ${result.rule.id}`,
    );
    return NextResponse.json({ rule: upsert.rule });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "upsert classifier rule failed",
      },
      { status: 500 },
    );
  }
}
