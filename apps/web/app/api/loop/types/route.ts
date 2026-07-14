/**
 * GET  /api/loop/types → list all custom decision types
 * PUT  /api/loop/types → upsert a single custom type
 *   body = Omit<CustomDecisionType, "createdAt">
 *
 * Custom types are a per-user extension to the closed `DecisionType`
 * union. They live in `~/.openloomi/loop/custom-types.json` and are
 * consumed by:
 *   - the tick prompt (classifier candidate list)
 *   - the web decision card (icon / label)
 *   - the pet bubble + card (icon / label)
 * The action must still be one of the 14 built-in `ActionKind` literals
 * — the runner does not learn new execution paths.
 */

import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { customTypes, validateCustomType } from "@/lib/loop";
import { log } from "@/lib/loop";
import { CUSTOM_TYPE_ID_RE } from "@/lib/loop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ types: customTypes.list() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "list custom types failed" },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  // Soft-auth: the file is per-user (in $HOME), so we don't enforce
  // a session — the same shape the `/api/loop/state` GET uses. We do
  // log every write so a misbehaving client is traceable in loop.log.
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
    if (typeof body.id !== "string" || !CUSTOM_TYPE_ID_RE.test(body.id)) {
      return NextResponse.json(
        {
          error:
            "id must be snake_case, 2-41 chars, start with a letter (e.g. birthday_wish)",
        },
        { status: 400 },
      );
    }
    if (typeof body.label !== "string") {
      return NextResponse.json({ error: "label is required" }, { status: 400 });
    }
    if (typeof body.actionKind !== "string") {
      return NextResponse.json(
        { error: "actionKind is required" },
        { status: 400 },
      );
    }
    const result = validateCustomType({
      id: body.id,
      label: body.label,
      icon: typeof body.icon === "string" ? body.icon : "",
      actionKind: body.actionKind,
      ...(typeof body.description === "string"
        ? { description: body.description }
        : {}),
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    const upsert = customTypes.upsert(result.type);
    log(
      `[loop.customTypes] ${upsert.created ? "created" : "updated"} ${result.type.id}`,
    );
    return NextResponse.json({ type: upsert.type });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "upsert custom type failed" },
      { status: 500 },
    );
  }
}
