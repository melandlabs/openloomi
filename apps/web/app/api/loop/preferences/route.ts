/**
 * GET  /api/loop/preferences  → current prefs
 * PUT  /api/loop/preferences  → patch (validated) + sync the three loop
 *                              ScheduledJob rows for the current user so
 *                              the existing local-scheduler picks the new
 *                              schedule up on its next minute-tick.
 */

import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getPreferences, setPreferencesForUser } from "@/lib/loop";
import type { LoopPreferences } from "@/lib/loop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_KEYS: (keyof LoopPreferences)[] = [
  "enabled",
  "briefTime",
  "wrapTime",
  "intervalSec",
  "noReplySkip",
  "promotionSkip",
];

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

export async function GET() {
  try {
    return NextResponse.json({ preferences: getPreferences() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "preferences failed" },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  try {
    let body: Partial<LoopPreferences> = {};
    try {
      body = (await req.json()) as Partial<LoopPreferences>;
    } catch {
      return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }
    for (const k of Object.keys(body)) {
      if (!ALLOWED_KEYS.includes(k as keyof LoopPreferences)) {
        return NextResponse.json(
          { error: `unknown field ${k}` },
          { status: 400 },
        );
      }
    }
    if (body.briefTime && !TIME_RE.test(body.briefTime)) {
      return NextResponse.json(
        { error: "briefTime must be HH:MM" },
        { status: 400 },
      );
    }
    if (body.wrapTime && !TIME_RE.test(body.wrapTime)) {
      return NextResponse.json(
        { error: "wrapTime must be HH:MM" },
        { status: 400 },
      );
    }
    if (typeof body.intervalSec === "number" && body.intervalSec < 30) {
      return NextResponse.json(
        { error: "intervalSec must be >= 30" },
        { status: 400 },
      );
    }
    // Resolve the current user. When undefined (CLI direct call without
    // auth) we fall back to a plain writePreferences so the config file
    // still updates — there's no user to attach loop cron rows to, and
    // the next auth-aware path (settings panel / scheduler init) will
    // reconcile once a real userId is available.
    let userId: string | undefined;
    try {
      const session = await auth();
      userId = session?.user?.id;
    } catch {
      userId = undefined;
    }
    if (userId) {
      const prefs = await setPreferencesForUser(body, userId);
      return NextResponse.json({ preferences: prefs });
    }
    const { writePreferences } = await import("@/lib/loop/preferences");
    const next = writePreferences(body);
    return NextResponse.json({ preferences: next });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "preferences update failed" },
      { status: 500 },
    );
  }
}
