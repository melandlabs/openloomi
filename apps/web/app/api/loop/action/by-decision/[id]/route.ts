/**
 * GET /api/loop/action/by-decision/[id]
 *
 * Returns the most recent loop-action ScheduledJob whose payload references
 * the given decision_id. Powers the pet's "Open brief / Open wrap / Open
 * plan / Edit" buttons — those used to navigate directly to `/loop/<id>`,
 * but the chat layout's loop detail page is being phased out in favour of
 * the canonical scheduled-jobs execution view. So when a user clicks an
 * "Open" button in the pet card the web listener fetches this endpoint,
 * gets back the corresponding `action_id` (== ScheduledJob.id), and
 * navigates to `/scheduled-jobs/<action_id>`.
 *
 * Implementation notes:
 *  - Loop action jobs store their `decision_id` inside `jobConfig.payload`
 *    as JSON. `jobConfig` is a TEXT column on both pg and sqlite schemas,
 *    so we look up candidate rows by `user_id` + `job_type='custom'` (the
 *    marker the schedule route writes) and confirm the decision_id match
 *    in app code. The candidate limit (50) keeps a single paged read of
 *    the user's recent loop actions — enough to find any active decision
 *    but small enough to not pull the full job table.
 *  - Returns `{ action_id: null }` (200) when no row matches so the caller
 *    can decide whether to fall back to the scheduled-jobs list or to
 *    schedule a new "open" action.
 *  - `decision_id` values are UUIDs / ULIDs; the LIKE filter would in
 *    principle be vulnerable to wildcard injection but we control the
 *    column for the bound parameter (Drizzle parametrises `like()`),
 *    so no escape is needed — and we still re-verify the match on the
 *    parsed JSON object before returning.
 */

import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/app/(auth)/auth";
import { withAutoGuest } from "@/lib/auth/with-auto-guest";
import { db } from "@/lib/db";
import { scheduledJobs } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export const GET = withAutoGuest<RouteCtx>(async (_req, ctx) => {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "auth required" }, { status: 401 });
    }
    const { id } = await ctx.params;
    const decisionId = String(id ?? "").trim();
    if (!decisionId) {
      return NextResponse.json(
        { error: "decision id required" },
        { status: 400 },
      );
    }

    const candidates = await db
      .select({
        id: scheduledJobs.id,
        jobConfig: scheduledJobs.jobConfig,
        createdAt: scheduledJobs.createdAt,
        lastRunAt: scheduledJobs.lastRunAt,
        lastStatus: scheduledJobs.lastStatus,
        lastError: scheduledJobs.lastError,
      })
      .from(scheduledJobs)
      .where(
        and(
          eq(scheduledJobs.userId, userId),
          eq(scheduledJobs.jobType, "custom"),
        ),
      )
      .orderBy(desc(scheduledJobs.createdAt))
      .limit(50);

    for (const row of candidates) {
      const raw = row.jobConfig;
      const cfg =
        typeof raw === "string"
          ? safeJsonParse(raw)
          : (raw as Record<string, unknown> | null);
      const payload =
        cfg && typeof cfg === "object"
          ? (cfg as Record<string, unknown>).payload
          : null;
      if (
        payload &&
        typeof payload === "object" &&
        (payload as Record<string, unknown>).decision_id === decisionId
      ) {
        const { status, last_run_at, last_status } = deriveStatus({
          lastRunAt: row.lastRunAt,
          lastStatus: row.lastStatus,
          lastError: row.lastError,
        });
        return NextResponse.json({
          action_id: row.id,
          status,
          last_run_at,
          last_status,
        });
      }
    }

    return NextResponse.json({
      action_id: null,
      status: "not_found",
      last_run_at: null,
      last_status: null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "lookup failed" },
      { status: 500 },
    );
  }
});

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

interface JobStatusRow {
  lastRunAt: Date | null | undefined;
  lastStatus: string | null | undefined;
  lastError: string | null | undefined;
}

interface DerivedStatus {
  /**
   * Lifecycle bucket for the polling fallback:
   * - `pending`: scheduled but has not yet produced a `last_run_at`.
   * - `completed`: ran successfully (lastStatus in {success, completed}).
   * - `failed`: ran and errored (lastStatus=error OR lastError non-null).
   * - `not_found`: no ScheduledJob matches the decision id.
   */
  status: "pending" | "completed" | "failed" | "not_found";
  /** ISO timestamp of the most recent run, or null if it never ran. */
  last_run_at: string | null;
  /**
   * Raw lastStatus string as stored on the row. May be one of
   * `success` | `error` | `running` | `pending`, or null when never run.
   * Mirrors the DB column so the card can render nuanced messages
   * (e.g. "running" if the cron fired but hasn't recorded an outcome
   * yet) without re-querying.
   */
  last_status: "success" | "error" | "running" | "pending" | null;
}

/**
 * Pure status projection over a `scheduled_jobs` row. Centralized here
 * so the route stays a thin DB-read and the polling fallback in
 * `loomi-card.html` can rely on a stable, documented shape.
 *
 * Rules:
 * - `lastRunAt == null` → still pending (the cron hasn't fired yet).
 *   `last_status` mirrors the stored `lastStatus` (defaults to
 *   `"pending"` for legacy rows that pre-date the column).
 * - `lastStatus === "error"` OR a non-null `lastError` → terminal
 *   failure. We surface `"error"` as `last_status` so the card can
 *   distinguish "ran but errored" from "ran successfully".
 * - Anything else with `lastRunAt` set → completed (success).
 */
export function deriveStatus(job: JobStatusRow | null): DerivedStatus {
  if (job == null) {
    return { status: "not_found", last_run_at: null, last_status: null };
  }
  if (job.lastRunAt == null) {
    const stored = (job.lastStatus ??
      "pending") as DerivedStatus["last_status"];
    return {
      status: "pending",
      last_run_at: null,
      last_status: stored,
    };
  }
  const lastRunIso = job.lastRunAt.toISOString();
  if (
    job.lastStatus === "error" ||
    (job.lastError != null && job.lastError !== "")
  ) {
    return {
      status: "failed",
      last_run_at: lastRunIso,
      last_status: "error",
    };
  }
  return {
    status: "completed",
    last_run_at: lastRunIso,
    last_status: (job.lastStatus as DerivedStatus["last_status"]) ?? "success",
  };
}
