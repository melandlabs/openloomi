/**
 * POST /api/loop/action/schedule
 *
 * Schedule a Loop decision action as a one-shot cron job. Used by the
 * pet card (and any other UI surface) so that every Run / Dismiss /
 * Dry / Promote click:
 *   - gets an execution record (jobExecutions row in the existing
 *     `jobExecutions` table)
 *   - is cancellable before fire (DELETE /api/loop/action/[id])
 *   - survives UI reloads (the row lives in the DB, not in memory)
 *   - fires asynchronously without blocking the user's interaction
 *
 * Body:
 *   { decision_id: string, action: 'run'|'dry'|'dismiss'|'promote', body?: object }
 *
 * Response (200):
 *   { action_id: string, fire_at: ISOString, decision_id: string, action }
 *
 * Why a 30s grace period before fire?
 *   The local-scheduler polls every 60s, so a `scheduledAt = now+30s`
 *   job will be picked up 30–90s after creation. That window is long
 *   enough for the user to read the "Scheduled" banner and tap Cancel,
 *   but short enough that the action still feels live. Without the
 *   grace, the job could fire on the very next 60s tick and the user
 *   would see no feedback between click and effect.
 *
 * Why stuff the payload into jobConfig?
 *   The cron's JobConfig type only declares a few fields (handler,
 *   modelConfig, characterId) — but the underlying column is JSON, so
 *   arbitrary keys are accepted at the storage layer. We cast through
 *   `unknown` to add a `payload` slot without modifying the cron types,
 *   and the loop.action handler reads it back. This keeps the payload
 *   inside the row's natural JSON envelope (no stringly-typed hack on
 *   the description column).
 */

import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { withAutoGuest } from "@/lib/auth/with-auto-guest";
import { createJob, decisions, registerLoopHandlers } from "@/lib/loop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GRACE_MS = 30_000;
const ALLOWED_ACTIONS = new Set(["run", "dry", "dismiss", "promote"]);

/** Human-friendly verb per action, used in the scheduled-job name. */
const ACTION_VERB: Record<string, string> = {
  run: "Run",
  dry: "Dry-run",
  dismiss: "Dismiss",
  promote: "Promote",
};

export const POST = withAutoGuest(async (req: Request) => {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "auth required" }, { status: 401 });
    }
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }
    const decisionId = String(body.decision_id ?? "").trim();
    const action = String(body.action ?? "").trim();
    if (!decisionId) {
      return NextResponse.json(
        { error: "decision_id required" },
        { status: 400 },
      );
    }
    if (!ALLOWED_ACTIONS.has(action)) {
      return NextResponse.json(
        { error: `action must be one of ${[...ALLOWED_ACTIONS].join("|")}` },
        { status: 400 },
      );
    }
    // Make sure the loop.action handler is registered before we
    // schedule a job that uses it. Idempotent.
    registerLoopHandlers();

    const fireAt = new Date(Date.now() + GRACE_MS);
    const payload = {
      decision_id: decisionId,
      action,
      body: body.body ?? null,
    };
    // Look up the decision so the scheduled-jobs list shows a name a
    // human can actually read. Fall back to the bare id when the
    // decision is gone (stale row, manual payload, etc.) — the handler
    // will still surface a useful error at fire time.
    const dec = decisions.get(decisionId);
    const decisionTitle = (dec?.title ?? "").trim() || decisionId;
    const verb = ACTION_VERB[action] ?? action;
    // Cast through unknown so we can add a `payload` slot to JobConfig
    // without forking the cron types. The DB column accepts arbitrary
    // JSON; loop.action reads `jobConfig.payload` back at fire time.
    const jobConfig = {
      type: "custom",
      handler: "loop.action",
      payload,
    } as unknown as Parameters<typeof createJob>[1]["job"];

    const job = await createJob(userId, {
      name: `${verb} "${decisionTitle}"`,
      description: `${decisionTitle} · fires in ${Math.round(GRACE_MS / 1000)}s`,
      schedule: { type: "once", at: fireAt },
      job: jobConfig,
      enabled: true,
    });
    return NextResponse.json({
      action_id: job.id,
      fire_at: fireAt.toISOString(),
      decision_id: decisionId,
      action,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "schedule failed" },
      { status: 500 },
    );
  }
});
