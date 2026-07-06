/**
 * Loop scheduler — Loop's three recurring jobs (tick / brief / wrap) are
 * ScheduledJob rows in the existing `scheduled_jobs` table, dispatched
 * through the cron executor's `customJobHandlers` registry. This means
 * the existing `lib/cron/local-scheduler.ts` polls the table every minute
 * and runs due jobs the same way it runs character agent-tasks — no
 * bespoke Croner/setInterval loop here, no duplicated cron parsing.
 *
 * On boot (instrumentation.ts) we register the three handlers
 * ("loop.tick" / "loop.brief" / "loop.wrap") and idempotently ensure the
 * three ScheduledJob rows exist on the active user, mirroring the current
 * ~/.openloomi/loop/config.json preferences. Settings changes route
 * through `syncLoopJobsForUser()` so the schedule on disk always tracks
 * the user's last save.
 *
 * Public surface kept stable so call-sites (cli.ts, server.ts,
 * instrumentation.ts, /api/loop/preferences) don't need to change:
 *   start() / stop() / isStarted() / status() / briefTimeToCron()
 */

import { createJob, deleteJob, listJobs, updateJob } from "@/lib/cron/service";
import type { ScheduleConfig } from "@/lib/cron/types";

import { registerLoopHandlers } from "./handlers";
import { readPreferences } from "./preferences";
import { log } from "./store";

/**
 * Active user under whose account loop ScheduledJob rows live. The
 * /api/scheduled-jobs/internal/scheduler route sets this via
 * `setSchedulerUserId()`; we mirror it locally so ensureLoopJobs runs
 * against the same user that the existing local-scheduler is filtering
 * due-jobs for. Stays null at instrumentation time (no auth yet) — we
 * can't insert into `scheduled_jobs.userId` without a real `User` row to
 * satisfy the FK, so row creation is deferred to the auth-aware path.
 */
let activeUserId: string | null = null;
let lastEnsuredAt = 0;

/* ------------------------------------------------------------------ */
/* Public job-name constants                                          */
/* ------------------------------------------------------------------ */

export const LOOP_JOB_NAMES = {
  tick: "Loop: tick",
  brief: "Loop: morning brief",
  wrap: "Loop: evening wrap",
} as const;

type LoopJobKind = keyof typeof LOOP_JOB_NAMES;

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Convert "HH:MM" 24h local time into a 5-field cron expression. Returns
 * null for malformed input so callers can decide what to do (the
 * existing local-scheduler accepts ScheduleConfig objects directly).
 */
export function briefTimeToCron(time: string): string | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!m) return null;
  return `${m[2]} ${m[1]} * * *`;
}

/** Find the existing loop job row for this user by display name. */
async function findJobByName(userId: string, name: string) {
  const jobs = await listJobs(userId, { includeDisabled: true });
  return jobs.find((j: { name: string }) => j.name === name) ?? null;
}

/** Compute the ScheduleConfig for one loop job from current prefs. */
function scheduleFor(
  kind: LoopJobKind,
  prefs: ReturnType<typeof readPreferences>,
): ScheduleConfig {
  if (kind === "tick") {
    const minutes = Math.max(1, Math.round(prefs.intervalSec / 60));
    return { type: "interval-minutes", minutes };
  }
  const time = kind === "brief" ? prefs.briefTime : prefs.wrapTime;
  const expr = briefTimeToCron(time);
  if (!expr) return { type: "interval-minutes", minutes: 60 }; // safe fallback
  return { type: "cron", expression: expr };
}

function jobConfigFor(kind: LoopJobKind) {
  return { type: "custom" as const, handler: `loop.${kind}` as const };
}

/** Resolve which user loop jobs should belong to. */
function resolveUserId(userId?: string): string | null {
  if (userId) return userId;
  if (activeUserId) return activeUserId;
  return null;
}

/* ------------------------------------------------------------------ */
/* Cron-equivalent: idempotent ensureLoopJobs                         */
/* ------------------------------------------------------------------ */

/**
 * Idempotently create or update the three loop ScheduledJob rows so they
 * reflect current preferences. Safe to call repeatedly — re-runs with the
 * same prefs are no-ops at the SQL level (no spurious lastRunAt bumps).
 *
 * When no user id is available (e.g. instrumentation-time boot before
 * auth has happened), this is a no-op. The job rows have a FK on
 * `User.id`, so we cannot insert against a phantom id — the rows are
 * reconciled later via `syncLoopJobsForUser()` once the runtime knows
 * who's logged in.
 */
export async function ensureLoopJobs(
  prefs: ReturnType<typeof readPreferences>,
  userId?: string,
): Promise<{ created: string[]; updated: string[]; skipped: string[] }> {
  const uid = resolveUserId(userId);
  if (!uid) {
    return { created: [], updated: [], skipped: [] };
  }
  activeUserId = uid;
  const enabled = prefs.enabled;
  const summary = {
    created: [] as string[],
    updated: [] as string[],
    skipped: [] as string[],
  };

  for (const kind of Object.keys(LOOP_JOB_NAMES) as LoopJobKind[]) {
    const name = LOOP_JOB_NAMES[kind];
    const schedule = scheduleFor(kind, prefs);
    const job = jobConfigFor(kind);
    const desiredEnabled = enabled;

    const existing = await findJobByName(uid, name);
    if (!existing) {
      await createJob(uid, {
        name,
        description: `Loop ${kind} (built-in)`,
        schedule,
        job,
        enabled: desiredEnabled,
      });
      summary.created.push(name);
      log(`[scheduler] created ${name} enabled=${desiredEnabled}`);
      continue;
    }

    // Cheap delta check — only touch the row when something changed.
    const sameSchedule =
      existing.scheduleType === schedule.type &&
      (schedule.type !== "cron" ||
        existing.cronExpression === schedule.expression) &&
      (schedule.type !== "interval-minutes" ||
        existing.intervalMinutes === schedule.minutes);
    const sameEnabled = existing.enabled === desiredEnabled;

    const existingCfgStr =
      typeof existing.jobConfig === "string"
        ? existing.jobConfig
        : JSON.stringify(existing.jobConfig);
    const sameHandler = existingCfgStr.includes(`"handler":"loop.${kind}"`);

    if (sameSchedule && sameEnabled && sameHandler) {
      summary.skipped.push(name);
      continue;
    }

    const patch: Parameters<typeof updateJob>[2] = {};
    if (!sameSchedule) patch.schedule = schedule;
    if (!sameEnabled) patch.enabled = desiredEnabled;
    if (!sameHandler) patch.job = job;

    await updateJob(uid, existing.id, patch);
    summary.updated.push(name);
    log(`[scheduler] updated ${name} enabled=${desiredEnabled}`);
  }

  lastEnsuredAt = Date.now();
  return summary;
}

/** Drop the three loop rows for the active user (used when loop is off). */
export async function removeLoopJobs(userId?: string): Promise<void> {
  const uid = resolveUserId(userId);
  if (!uid) return;
  for (const name of Object.values(LOOP_JOB_NAMES)) {
    const job = await findJobByName(uid, name);
    if (job) {
      await deleteJob(uid, job.id);
      log(`[scheduler] removed ${name}`);
    }
  }
}

/**
 * Public hook for the settings panel: re-sync the rows from prefs after
 * a PUT, no matter which user the runtime is currently scoped to.
 */
export async function syncLoopJobsForUser(userId: string): Promise<void> {
  registerLoopHandlers();
  const prefs = readPreferences();
  await ensureLoopJobs(prefs, userId);
}

/**
 * Set the runtime's active user without touching jobs. Called by
 * instrumented routes (existing /api/scheduled-jobs/internal/scheduler)
 * that already know the user id, or by the loop prefs handler.
 */
export function setActiveUser(userId: string | null): void {
  activeUserId = userId;
}

/* ------------------------------------------------------------------ */
/* Boot / lifecycle                                                   */
/* ------------------------------------------------------------------ */

let started = false;

/**
 * Boot-time entrypoint used by instrumentation.ts. Registers handlers
 * so the cron executor can dispatch `loop.tick` / `loop.brief` / `loop.wrap`
 * as soon as a row with that handler name is created. Row creation itself
 * is deferred to the auth-aware path: the existing
 * `/api/scheduled-jobs/internal/scheduler` route calls
 * `syncLoopJobsForUser(userId)` once it has resolved a real userId, and
 * the settings panel PUT path does the same. We can't insert against the
 * `User` FK at instrumentation time because no user is logged in yet.
 */
export async function start(userId?: string): Promise<void> {
  registerLoopHandlers();
  if (userId) activeUserId = userId;
  started = true;
}

/** Stop hook. Execution lives in the local-scheduler; we only clear state. */
export function stop(): void {
  started = false;
  activeUserId = null;
}

export function isStarted(): boolean {
  return started;
}

export function status(): {
  started: boolean;
  tickIntervalSec: number;
  briefTime: string;
  wrapTime: string;
  enabled: boolean;
  activeUserId: string | null;
  lastEnsuredAt: string | null;
} {
  const prefs = readPreferences();
  return {
    started,
    tickIntervalSec: prefs.intervalSec,
    briefTime: prefs.briefTime,
    wrapTime: prefs.wrapTime,
    enabled: prefs.enabled,
    activeUserId,
    lastEnsuredAt: lastEnsuredAt ? new Date(lastEnsuredAt).toISOString() : null,
  };
}
