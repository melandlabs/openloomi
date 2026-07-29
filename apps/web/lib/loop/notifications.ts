/**
 * Loop desktop-notification helper (#288, SP-4).
 *
 * Filters out non-actionable records (noop, tick_summary, "0 new decisions"
 * titles, context.noop === true, context.source === "loop_tick") and only
 * fires a native macOS / OS notification when the user has opted in via
 * LoopPreferences.desktopNotifications (default false).
 *
 * The pet bubble/card is the Loop's primary desktop surface and is always
 * on. This helper exists for the rare high-priority path and is NOT
 * called from routine tick completions — handleTick / handleBrief /
 * handleWrap do NOT call it today; the pet watcher
 * (apps/web/src-tauri/src/pet/watcher.rs) is the canonical fan-out for
 * fresh decisions.
 *
 * SP-4 throttling:
 *   - `attentionBudget.daily` (default 3) caps notifications per
 *     user-local day. Counter persisted to `~/.openloomi/loop/attention.json`
 *     so a server restart / config PUT doesn't lose the running count.
 *   - P0-priority decisions bypass the budget by default; toggle via
 *     `attentionBudget.p0BypassBudget = false`.
 *   - `cooldown.windowSec` (default 1800 = 30 min) suppresses repeats
 *     from the same source after a dismiss. Backed by `MuteRule.cooldown_until`
 *     so the existing dismiss-write path produces cooldowns for free.
 *   - Bubble is unaffected — the pet still surfaces every pending
 *     decision via the watcher; only the OS notification is throttled.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensureDirs, ensureParent, LOOP_PATHS } from "./paths";
import { isNoopDecision, mutes } from "./store";
import { readPreferences } from "./preferences";
import { sendNotification } from "@/lib/tauri";
import type { LoopDecision } from "./types";

export interface NotificationsResult {
  considered: number;
  sent: number;
  filtered: number;
  skippedOptOut: boolean;
  /** P0 notifications that bypassed the daily budget. */
  sentP0Bypass: number;
  /** Notifications the budget suppressed (over daily cap, P0 bypass off). */
  budgetSuppressed: number;
  /** Notifications the per-source cooldown suppressed. */
  cooldownSuppressed: number;
  errors: number;
}

/** Pure filter — exported for tests. */
export function filterActionable(decisions: LoopDecision[]): LoopDecision[] {
  return decisions.filter((d) => !isNoopDecision(d));
}

// ---------------------------------------------------------------------------
// Daily attention counter (SP-4)
// ---------------------------------------------------------------------------

interface AttentionState {
  /** User-local YYYY-MM-DD the counter is anchored to. */
  day: string;
  count: number;
}

function readAttentionState(): AttentionState {
  try {
    if (!existsSync(LOOP_PATHS.attention)) return { day: "", count: 0 };
    const raw = JSON.parse(readFileSync(LOOP_PATHS.attention, "utf8"));
    if (
      raw &&
      typeof raw === "object" &&
      typeof raw.day === "string" &&
      typeof raw.count === "number"
    ) {
      return { day: raw.day, count: Math.max(0, Math.floor(raw.count)) };
    }
  } catch {
    /* fall through */
  }
  return { day: "", count: 0 };
}

function writeAttentionState(state: AttentionState): void {
  ensureParent(LOOP_PATHS.attention);
  ensureDirs();
  try {
    writeFileSync(LOOP_PATHS.attention, JSON.stringify(state, null, 2));
  } catch {
    /* best effort — the budget is advisory, never block the fan-out */
  }
}

/** Format `now` as YYYY-MM-DD in the user-local timezone (or UTC
 *  fallback when the runtime has no Intl data). */
export function localDayKey(now: Date = new Date()): string {
  try {
    // Mirror the same shape `briefTimeToCron` uses so the budget
    // rolls over at the same wall-clock midnight the brief/wrap
    // schedules do. Falling back to UTC keeps tests deterministic
    // when the env has no locale data.
    const fmt = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    return fmt.format(now); // en-CA → YYYY-MM-DD
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Read the current count for `today`, resetting when the stored
 *  day doesn't match. Exported for tests. */
export function getAttentionCount(now: Date = new Date()): number {
  const today = localDayKey(now);
  const state = readAttentionState();
  if (state.day !== today) return 0;
  return state.count;
}

/** True iff the daily cap has been reached. Pure of any side
 *  effect; does NOT bump the counter. */
export function isOverBudget(
  prefs: { attentionBudget?: { daily: number; p0BypassBudget?: boolean } },
  now: Date = new Date(),
): boolean {
  const budget = prefs.attentionBudget ?? { daily: 3, p0BypassBudget: true };
  const today = localDayKey(now);
  const state = readAttentionState();
  if (state.day !== today) return false; // fresh day → always under
  return state.count >= Math.max(0, Math.floor(budget.daily));
}

/** Increment the daily counter and persist. Resets the day when the
 *  stored day doesn't match `now`. Exported for tests. */
export function bumpAttentionCount(now: Date = new Date()): AttentionState {
  const today = localDayKey(now);
  const state = readAttentionState();
  const next: AttentionState =
    state.day === today
      ? { day: today, count: state.count + 1 }
      : { day: today, count: 1 };
  writeAttentionState(next);
  return next;
}

/** Compute the per-source mute key for a decision's notification
 *  path. The shape mirrors `mutes.ts::muteKeyFor` for the supported
 *  types; the bubble + card surface don't need this — the cooldown
 *  is purely an OS-notification suppression. Returns `null` when
 *  the decision's signal type has no stable identity (a cooldown
 *  on "unknown" is a no-op anyway, so we just skip the gate). */
function cooldownKeyFor(decision: LoopDecision): string | null {
  const src = decision.source_signal;
  if (!src) return null;
  // The full muteKeyFor lives in store.ts and would import-cycle;
  // replicate the email branch inline because email_burst_digest
  // (the SP-3 hot path) is the only place we actually need it.
  if (src.type === "email") {
    const p = src.payload as Record<string, unknown>;
    const raw = String(p.from ?? p.sender ?? "").trim();
    const m = raw.match(/<([^>]+)>/);
    const addr = (m ? m[1] : raw).toLowerCase().trim();
    return addr ? `email:${addr}` : null;
  }
  return null;
}

/** True when the decision's source is in a per-source cooldown
 *  window. Pure of any side effect; the underlying `mutes` cache
 *  is invalidated on every dismiss write so this is always
 *  current. */
export function isInCooldown(
  decision: LoopDecision,
  now: Date = new Date(),
): boolean {
  const key = cooldownKeyFor(decision);
  if (!key) return false;
  return mutes.cooldownActive(key, now);
}

/**
 * Send desktop notifications for a batch of decisions. No-op when:
 *   - prefs.desktopNotifications is false (default), OR
 *   - all records are filtered out by isNoopDecision.
 *
 * SP-4: each individual send is gated by the daily budget
 * (LoopPreferences.attentionBudget) and the per-source cooldown
 * (MuteRule.cooldown_until). P0 priority bypasses the budget by
 * default. The bubble is unaffected.
 *
 * Never throws — best-effort delivery, errors are logged.
 */
export async function notifyForDecisions(
  decisions: LoopDecision[],
): Promise<NotificationsResult> {
  const prefs = readPreferences();
  const actionable = filterActionable(decisions);
  const result: NotificationsResult = {
    considered: decisions.length,
    sent: 0,
    filtered: decisions.length - actionable.length,
    skippedOptOut: false,
    sentP0Bypass: 0,
    budgetSuppressed: 0,
    cooldownSuppressed: 0,
    errors: 0,
  };
  if (prefs.desktopNotifications === false) {
    result.skippedOptOut = true;
    return result;
  }
  // Pre-compute the budget gate so a batch of P0+don't-care items
  // doesn't spam the user. We snapshot once: by the time the
  // P0-bypass branch fires, the counter has already been bumped
  // for prior sends in this loop, so the cap is enforced
  // cumulatively.
  const budget = prefs.attentionBudget ?? {
    daily: 3,
    p0BypassBudget: true,
  };
  for (const d of actionable) {
    try {
      if (isInCooldown(d)) {
        result.cooldownSuppressed++;
        continue;
      }
      const isP0 = d.priority === "P0";
      const bypass = isP0 && (budget.p0BypassBudget ?? true);
      if (!bypass && isOverBudget(prefs)) {
        result.budgetSuppressed++;
        continue;
      }
      const title = `openloomi-loop: ${d.title}`;
      const body =
        typeof d.dialogue === "string" && d.dialogue
          ? d.dialogue
          : `New pending decision (${d.type})`;
      await sendNotification(title, body);
      bumpAttentionCount();
      result.sent++;
      if (bypass && isP0) result.sentP0Bypass++;
    } catch (e) {
      result.errors++;
      console.error("[loop.notifications] send failed:", e);
    }
  }
  return result;
}
