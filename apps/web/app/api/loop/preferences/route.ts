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
  "timezone",
  "narrative",
  "desktopNotifications",
  "quietWhenEmpty",
  "quietDayFiller",
];

const ALLOWED_FILLER_IDS = [
  "none",
  "ai-news-digest",
  "weather-calendar",
  "memory-resurface",
] as const;

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

/**
 * IANA timezone sanity check. We don't try to canonicalise (V8's
 * `Intl.DateTimeFormat({ timeZone })` would, but that throws on invalid
 * inputs, and we want non-fatal gating). Loose check: looks like
 * "Region/City" or "Etc/UTC", length-bounded so a 64kB string can't
 * land in `config.json`.
 */
const TIMEZONE_RE = /^[A-Za-z_]+(?:\/[A-Za-z_+\-]+){0,3}$/;

export async function GET() {
  try {
    const prefs = getPreferences();
    // Self-heal: even if the user never clicks Save, opening the Loop
    // settings panel should re-anchor any cron rows whose `timezone`
    // drifted (e.g. created by an older code path with `timezone=UTC`).
    // Soft-fails so a DB hiccup doesn't break the GET — the user still
    // sees their prefs; they just may not see the underlying rows healed.
    try {
      const session = await auth();
      const userId = session?.user?.id;
      if (userId) {
        const { ensureLoopJobs } = await import("@/lib/loop");
        await ensureLoopJobs(prefs, userId);
      }
    } catch (healErr) {
      console.warn("[loop] GET-side ensureLoopJobs failed:", healErr);
    }
    return NextResponse.json({ preferences: prefs });
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
    if (body.narrative !== undefined && typeof body.narrative !== "boolean") {
      return NextResponse.json(
        { error: "narrative must be a boolean" },
        { status: 400 },
      );
    }
    // #316 — quiet-mode prefs. `quietWhenEmpty` mirrors the narrative
    // boolean check. `quietDayFiller` is a closed union — anything else
    // is a typo or a forward-compat probe we don't want to silently
    // accept (it would resolve to "none" at runtime and confuse users).
    if (
      body.quietWhenEmpty !== undefined &&
      typeof body.quietWhenEmpty !== "boolean"
    ) {
      return NextResponse.json(
        { error: "quietWhenEmpty must be a boolean" },
        { status: 400 },
      );
    }
    if (
      body.quietDayFiller !== undefined &&
      !ALLOWED_FILLER_IDS.includes(
        body.quietDayFiller as (typeof ALLOWED_FILLER_IDS)[number],
      )
    ) {
      return NextResponse.json(
        {
          error: `quietDayFiller must be one of: ${ALLOWED_FILLER_IDS.join(", ")}`,
        },
        { status: 400 },
      );
    }
    // `timezone` is optional. When supplied it must be a plausible IANA
    // string; an empty string clears it (server Intl takes over).
    if (body.timezone !== undefined && body.timezone !== null) {
      if (
        typeof body.timezone !== "string" ||
        body.timezone.length > 64 ||
        (body.timezone.length > 0 && !TIMEZONE_RE.test(body.timezone))
      ) {
        return NextResponse.json(
          { error: "timezone must be a valid IANA name like Asia/Shanghai" },
          { status: 400 },
        );
      }
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
