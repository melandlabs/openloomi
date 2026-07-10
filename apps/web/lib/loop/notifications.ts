/**
 * Loop desktop-notification helper (#288).
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
 */

import { isNoopDecision } from "./store";
import { readPreferences } from "./preferences";
import { sendNotification } from "@/lib/tauri";
import type { LoopDecision } from "./types";

export interface NotificationsResult {
  considered: number;
  sent: number;
  filtered: number;
  skippedOptOut: boolean;
  errors: number;
}

/** Pure filter — exported for tests. */
export function filterActionable(decisions: LoopDecision[]): LoopDecision[] {
  return decisions.filter((d) => !isNoopDecision(d));
}

/**
 * Send desktop notifications for a batch of decisions. No-op when:
 *   - prefs.desktopNotifications is false (default), OR
 *   - all records are filtered out by isNoopDecision.
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
    errors: 0,
  };
  if (prefs.desktopNotifications === false) {
    result.skippedOptOut = true;
    return result;
  }
  for (const d of actionable) {
    try {
      const title = `openloomi-loop: ${d.title}`;
      const body =
        typeof d.dialogue === "string" && d.dialogue
          ? d.dialogue
          : `New pending decision (${d.type})`;
      await sendNotification(title, body);
      result.sent++;
    } catch (e) {
      result.errors++;
      console.error("[loop.notifications] send failed:", e);
    }
  }
  return result;
}
