/**
 * DELETE /api/loop/action/[id]
 *
 * Cancel a scheduled one-shot Loop action that hasn't fired yet.
 *
 * Status transitions:
 *   scheduled (lastRunAt = null)        → 200 {cancelled: true}
 *   already fired (lastRunAt != null)   → 409 {cancelled: false, reason}
 *   not found / wrong owner             → 404
 *
 * Race protection: the local-scheduler fires due-jobs every minute.
 * Between "I see it's still scheduled" and "I delete the row", the job
 * could fire. Drizzle's DELETE is atomic — if the row is gone when we
 * run the DELETE, we report 404. The caller (pet card) treats 404 as
 * "already gone" and quietly moves on.
 */

import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/app/(auth)/auth";
import { withAutoGuest } from "@/lib/auth/with-auto-guest";
import { deleteJob, getJob } from "@/lib/loop";
import { db } from "@/lib/db";
import { scheduledJobs } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export const DELETE = withAutoGuest<RouteCtx>(async (_req, ctx) => {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "auth required" }, { status: 401 });
    }
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    // Inspect first so we can return a clean 409 if it's already in
    // flight. We rely on lastRunAt as the "has fired" signal — once
    // the local-scheduler runs the job it sets lastRunAt + lastStatus.
    const job = await getJob(userId, id);
    if (!job) {
      return NextResponse.json(
        { cancelled: false, reason: "not_found" },
        { status: 404 },
      );
    }
    if (job.lastRunAt) {
      return NextResponse.json(
        {
          cancelled: false,
          reason: "already_fired",
          last_status: job.lastStatus ?? "running",
        },
        { status: 409 },
      );
    }
    // Race-safe delete: only succeed when lastRunAt is still null.
    // If the scheduler fired between getJob() and now, this where
    // clause matches zero rows and we fall through to the 409 path.
    const result = await db
      .delete(scheduledJobs)
      .where(
        and(
          eq(scheduledJobs.userId, userId),
          eq(scheduledJobs.id, id),
          isNull(scheduledJobs.lastRunAt),
        ),
      )
      .returning({ id: scheduledJobs.id });
    if (result.length === 0) {
      // Job fired between our check and our delete.
      return NextResponse.json(
        { cancelled: false, reason: "already_fired" },
        { status: 409 },
      );
    }
    // Keep the symmetric cron helper in sync so other call-sites don't
    // see a stale row. `deleteJob` is a no-op when the row is already
    // gone, so this is safe even if our conditional delete above was
    // the one that removed it.
    await deleteJob(userId, id).catch(() => {});
    return NextResponse.json({ cancelled: true, action_id: id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "cancel failed" },
      { status: 500 },
    );
  }
});
