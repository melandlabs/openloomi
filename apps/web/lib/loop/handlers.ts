/**
 * Loop cron handlers — registered into the cron executor's custom-handler
 * registry so the existing local-scheduler (lib/cron/local-scheduler.ts)
 * drives our tick / brief / wrap / action jobs the same way it drives
 * character agent-tasks. We intentionally do NOT maintain our own
 * Croner/setInterval loop here; the schedule for each job is configured
 * on the corresponding ScheduledJob row in `scheduled_jobs`
 * (handler: "loop.tick" / "loop.brief" / "loop.wrap" / "loop.action"),
 * and lib/loop/scheduler.ts ensures the recurring rows exist. One-shot
 * `loop.action` rows are inserted on-demand by
 * /api/loop/action/schedule when the user clicks a card button.
 */

import { log } from "./store";
import { registerCustomHandler } from "@/lib/cron/executor";
import type { JobExecutionContext, JobExecutionResult } from "@/lib/cron/types";

/**
 * Wrap an arbitrary loop operation into the JobExecutionResult shape the
 * cron executor expects. We never throw — failures are turned into
 * `{status: "error", error}` so the executor can log them and write a
 * jobExecutions row in a consistent way. `duration` is set here too so
 * the result conforms to the type without the executor overwriting it.
 */
async function runAsJob(
  op: () => Promise<unknown>,
  context: JobExecutionContext,
): Promise<JobExecutionResult> {
  const t0 = Date.now();
  try {
    const result = await op();
    const summary =
      result && typeof result === "object"
        ? JSON.stringify(result).slice(0, 2_000)
        : String(result ?? "");
    log(`[handler] job=${context.jobId} ok: ${summary}`);
    return { status: "success", output: summary, duration: Date.now() - t0 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`[handler] job=${context.jobId} error: ${msg}`);
    return { status: "error", error: msg, duration: Date.now() - t0 };
  }
}

/** Handler for `loop.tick` — pull signals, classify, enqueue new decisions. */
async function handleTick(
  context: JobExecutionContext,
): Promise<JobExecutionResult> {
  // Lazy import to avoid pulling the whole tick graph (and its DB / signal
  // pullers) into the executor's main module graph at registration time.
  // tick.ts exports the function as `run`; we call it directly. Its return
  // is synchronous (LoopTickResult), so we wrap with Promise.resolve to
  // satisfy the runAsJob contract.
  const { run, setActiveUser } = await import("./tick");
  const { runOnce: runWatcher } = await import("./watcher");
  return runAsJob(async () => {
    // First, have the watcher pull any new events from connected
    // integrations. The watch pass appends directly to signals.jsonl, and
    // the tick's 2h lookback will pick up everything we just wrote.
    setActiveUser(context.userId);
    const watchResult = await runWatcher({ userId: context.userId });
    const tickResult = await run({ userId: context.userId });
    // #288 — fire-and-forget desktop notifications only for fresh,
    // actionable decisions. Pet bubble is the primary surface; this is
    // opt-in via LoopPreferences.desktopNotifications. Errors are
    // swallowed and logged by notifyForDecisions.
    if (tickResult.newDecisions && tickResult.newDecisions.length > 0) {
      const { notifyForDecisions } = await import("./notifications");
      await notifyForDecisions(tickResult.newDecisions);
    }
    return { ...tickResult, watch: watchResult };
  }, context);
}

/** Handler for `loop.brief` — build a morning brief card and enqueue it. */
async function handleBrief(
  context: JobExecutionContext,
): Promise<JobExecutionResult> {
  // brief.ts exports `buildAndEnqueue` as its native name; it's async because
  // the narrative enrichment runs fire-and-forget after the card is enqueued.
  // The function returns once the card is queued; the background agent call
  // completes (or times out) on its own and is captured by the
  // `kickOffBackgroundEnrichment` helper — it MUST NOT throw, so a slow /
  // failed agent never causes a cron row to error.
  const { buildAndEnqueue } = await import("./brief");
  return runAsJob(async () => {
    const out = await buildAndEnqueue({ force: true });
    return {
      card: out.card?.id ?? null,
      narrative: !!out.snapshot.narrative,
    };
  }, context);
}

/** Handler for `loop.wrap` — build an evening wrap card and enqueue it. */
async function handleWrap(
  context: JobExecutionContext,
): Promise<JobExecutionResult> {
  const { buildAndEnqueue } = await import("./wrap");
  return runAsJob(async () => {
    const out = await buildAndEnqueue({ force: true });
    return {
      card: out.card?.id ?? null,
      narrative: !!out.snapshot.narrative,
    };
  }, context);
}

/**
 * Handler for `loop.action` — execute a single Loop decision action
 * scheduled by the pet card (or any other UI surface) via
 * /api/loop/action/schedule.
 *
 * The ScheduledJob's `jobConfig.payload` carries:
 *   { decision_id: string, action: 'run'|'dry'|'dismiss', body?: object }
 *
 * We delegate to `applyDecisionAction` (the same entry point
 * /api/loop/decision/[id] uses) so the existing tooling — runner.ts,
 * dismissDecision, the agent SSE call — is exercised once. The handler
 * never throws; failures are wrapped into `{status: "error"}` so the
 * executor can write a jobExecutions row consistently.
 *
 * After the decision moves, the watcher picks up the new
 * decisions.jsonl state on its next poll and emits `loop:decision` to
 * the bubble + card webviews — that's how the card learns the action
 * completed. No need for a bespoke completion event.
 */
async function handleAction(
  context: JobExecutionContext,
): Promise<JobExecutionResult> {
  const { applyDecisionAction } = await import("./server");
  const { decisions } = await import("./store");
  return runAsJob(async () => {
    const cfg =
      typeof context.jobConfig === "string"
        ? JSON.parse(context.jobConfig)
        : (context.jobConfig ?? {});
    const payload = cfg?.payload ?? {};
    const decisionId = String(payload.decision_id ?? "").trim();
    const action = String(payload.action ?? "").trim();
    if (!decisionId) {
      throw new Error("missing decision_id in jobConfig.payload");
    }
    if (!action) {
      throw new Error("missing action in jobConfig.payload");
    }
    // Stash the per-click sub-action body (e.g. { response: "yes" }
    // for RSVP, { verdict: "approve" } for PR review) on the
    // decision's context. The runner's buildPrompt already
    // serializes `context` into the JSON the agent reads, so the
    // agent gets the user's specific sub-action without us having to
    // fork the prompt template.
    if (action === "run" && payload.body && typeof payload.body === "object") {
      const current = decisions.get(decisionId);
      if (current) {
        decisions.update(decisionId, {
          context: {
            ...(current.context ?? {}),
            sub_action: payload.body,
          },
        });
      }
    }
    const out = await applyDecisionAction(decisionId, {
      action: action as "run" | "dry" | "dismiss" | "promote",
    });
    if (!out.ok) {
      throw new Error(out.error ?? `${action} failed`);
    }
    return {
      decision_id: decisionId,
      action,
      status: out.status,
      ...(out.result !== undefined ? { result: out.result } : {}),
    };
  }, context);
}

let registered = false;

/**
 * Idempotently register all three handlers into the cron executor registry.
 * Safe to call multiple times — only the first call has side effects.
 */
export function registerLoopHandlers(): void {
  if (registered) return;
  registerCustomHandler("loop.tick", handleTick);
  registerCustomHandler("loop.brief", handleBrief);
  registerCustomHandler("loop.wrap", handleWrap);
  registerCustomHandler("loop.action", handleAction);
  registered = true;
}

export const LOOP_HANDLER_NAMES = [
  "loop.tick",
  "loop.brief",
  "loop.wrap",
  "loop.action",
] as const;
export type LoopHandlerName = (typeof LOOP_HANDLER_NAMES)[number];
