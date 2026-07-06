/**
 * Loop cron handlers — registered into the cron executor's custom-handler
 * registry so the existing local-scheduler (lib/cron/local-scheduler.ts)
 * drives our tick / brief / wrap jobs the same way it drives character
 * agent-tasks. We intentionally do NOT maintain our own Croner/setInterval
 * loop here; the schedule for each job is configured on the corresponding
 * ScheduledJob row in `scheduled_jobs` (handler: "loop.tick" / "loop.brief"
 * / "loop.wrap"), and lib/loop/scheduler.ts ensures those rows exist.
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
  const { run } = await import("./tick");
  return runAsJob(() => Promise.resolve(run()), context);
}

/** Handler for `loop.brief` — build a morning brief card and enqueue it. */
async function handleBrief(
  context: JobExecutionContext,
): Promise<JobExecutionResult> {
  // brief.ts exports `buildAndEnqueue` as its native name; it's already async.
  const { buildAndEnqueue } = await import("./brief");
  return runAsJob(
    () => Promise.resolve(buildAndEnqueue({ force: true })),
    context,
  );
}

/** Handler for `loop.wrap` — build an evening wrap card and enqueue it. */
async function handleWrap(
  context: JobExecutionContext,
): Promise<JobExecutionResult> {
  const { buildAndEnqueue } = await import("./wrap");
  return runAsJob(
    () => Promise.resolve(buildAndEnqueue({ force: true })),
    context,
  );
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
  registered = true;
}

export const LOOP_HANDLER_NAMES = [
  "loop.tick",
  "loop.brief",
  "loop.wrap",
] as const;
export type LoopHandlerName = (typeof LOOP_HANDLER_NAMES)[number];
