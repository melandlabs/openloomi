/**
 * Quiet-day module framework (#316).
 *
 * When the brief or wrap snapshot comes up empty, the loop's default
 * behaviour is to skip the templated "nothing to do" card entirely
 * (`prefs.quietWhenEmpty === true`, the new default). To make the empty
 * morning / evening worth opening, the user can opt into a content
 * module that fills the card slot with something the user actually wants
 * to see — a 3-bullet news digest, weather + first meeting, or a
 * resurfaced memory.
 *
 * Architecture mirrors the brief / wrap narrative path:
 *   - `QuietDayModule` is the contract: a label, an availability check,
 *     and a `buildDecision()` that returns a fully-formed `LoopDecision`
 *     ready for `decisions.add()`.
 *   - The registry `QUIET_DAY_MODULES` indexes implementations by their
 *     `QuietDayFillerId`. Adding a module is a one-line entry + a new
 *     `quiet-modules/<id>.ts` file.
 *   - `runQuietDayModule()` is the single entry point called by the
 *     brief / wrap orchestrators. It is total: unknown id, unavailable
 *     module, and thrown exceptions all collapse to `null` so callers
 *     can stay simple (and stay safe — the user has opted in but the
 *     pipeline must not crash on a flaky network).
 *
 * Modules are kept under `lib/loop/modules/` to make future drop-ins
 * (e.g. a "lo-fi music" or "fitness streak" filler) obvious.
 */

import { log } from "./store";
import type { LoopDecision, LoopPreferences, QuietDayFillerId } from "./types";
import { aiNewsDigest } from "./modules/ai-news-digest";
import { weatherCalendar } from "./modules/weather-calendar";
import { memoryResurface } from "./modules/memory-resurface";

/**
 * Context handed to a module's `buildDecision()`. The module decides
 * how to use it — most just need `kind` + `date` for the headline
 * ("Morning digest" vs. "Evening digest") and `prefs` for any user-level
 * knobs (location for weather, etc.).
 */
export interface QuietDayContext {
  /** Which scheduled card triggered the quiet path. */
  kind: "brief" | "wrap";
  /** ISO date (YYYY-MM-DD) of the snapshot — also the card's date stamp. */
  date: string;
  /** Full preferences snapshot — modules should not mutate. */
  prefs: LoopPreferences;
}

/**
 * A quiet-day filler. Implementations live in `lib/loop/modules/<id>.ts`
 * and are registered in `QUIET_DAY_MODULES`.
 */
export interface QuietDayModule {
  /** Filler id — also the registry key. */
  id: QuietDayFillerId;
  /** Short human label, surfaced in any future settings UI. */
  label: string;
  /**
   * Cheap probe that returns `false` when the module cannot run right
   * now (e.g. no agent available, network down). Returning `false` is
   * the same as returning `null` from `buildDecision()` — the caller
   * degrades to skipping the card. The check must be idempotent and
   * best-effort: a throw here is logged and treated as unavailable.
   */
  isAvailable(): Promise<boolean>;
  /**
   * Produce a `quiet_digest` decision card, or `null` to skip. Modules
   * decide their own copy / data — same shape as any other `LoopDecision`
   * (id / ts / type / title / action / context / dialogue / nextStep).
   * Implementations MUST NOT throw — catch internally and return `null`.
   */
  buildDecision(ctx: QuietDayContext): Promise<LoopDecision | null>;
}

/**
 * Module registry — indexed by `QuietDayFillerId`. Order is preserved
 * for any future UI iteration; "none" intentionally has no entry here
 * and is short-circuited by callers before lookup.
 */
export const QUIET_DAY_MODULES: Record<QuietDayFillerId, QuietDayModule> = {
  none: {
    id: "none",
    label: "Skip the card (default)",
    isAvailable: async () => true,
    buildDecision: async () => null,
  },
  "ai-news-digest": aiNewsDigest,
  "weather-calendar": weatherCalendar,
  "memory-resurface": memoryResurface,
};

/**
 * Run a quiet-day module by id. Total function:
 *   - unknown id  → returns `null`, logs
 *   - isAvailable === false → returns `null`, logs
 *   - buildDecision throws  → caught, logged, returns `null`
 *   - buildDecision returns `null` → returns `null` (no log; expected path)
 *
 * Never throws. The brief / wrap orchestrators can call this without
 * try/catch and treat `null` as "no card to enqueue".
 */
export async function runQuietDayModule(
  id: QuietDayFillerId,
  ctx: QuietDayContext,
): Promise<LoopDecision | null> {
  if (id === "none") return null;
  const mod = QUIET_DAY_MODULES[id];
  if (!mod) {
    log(`[loop.quiet] unknown module id: ${id}`);
    return null;
  }
  try {
    if (!(await mod.isAvailable())) {
      log(`[loop.quiet] module ${id} unavailable`);
      return null;
    }
    const decision = await mod.buildDecision(ctx);
    if (!decision) return null;
    // Defensive: stamp a consistent type/action id in case the module
    // forgot. We never trust a module's `type` for a quiet_digest card.
    decision.type = "quiet_digest";
    decision.action = { kind: "quiet_digest", params: { module: id } };
    return decision;
  } catch (e) {
    log(
      `[loop.quiet] module ${id} threw: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return null;
  }
}
