import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mutable tmp dir reference for the mocked paths/preferences modules so
// test runs are isolated from each other AND from the user's real
// ~/.openloomi/loop. Each beforeEach creates a fresh dir.
let LOOP_HOME = "";

vi.mock("@/lib/tauri", () => ({
  sendNotification: vi.fn(async () => undefined),
}));

vi.mock("@/lib/loop/paths", async () => {
  const { join } = await import("node:path");
  // Build paths dynamically on each property access so the mocked module
  // sees the *current* LOOP_HOME, not the one captured at module load.
  const buildPaths = () => ({
    home: LOOP_HOME,
    signals: join(LOOP_HOME, "signals.jsonl"),
    decisions: join(LOOP_HOME, "decisions.json"),
    status: join(LOOP_HOME, "status.json"),
    brief: join(LOOP_HOME, "brief.json"),
    wrap: join(LOOP_HOME, "wrap.json"),
    connectors: join(LOOP_HOME, "connectors.json"),
    config: join(LOOP_HOME, "config.json"),
    mutes: join(LOOP_HOME, "mutes.json"),
    migrated: join(LOOP_HOME, "migrated.json"),
    log: join(LOOP_HOME, "loop.log"),
    inbox: join(LOOP_HOME, "inbox"),
    syncState: join(LOOP_HOME, "sync-state.json"),
    // SP-4 — daily attention counter
    attention: join(LOOP_HOME, "attention.json"),
  });
  const pathsProxy = new Proxy(
    {},
    {
      get: (_t, prop: string) => (buildPaths() as Record<string, string>)[prop],
    },
  );
  return {
    get LOOP_HOME() {
      return LOOP_HOME;
    },
    LOOP_PATHS: pathsProxy,
    ensureDirs: () => {
      mkdirSync(LOOP_HOME, { recursive: true });
      mkdirSync(join(LOOP_HOME, "inbox", ".processed"), { recursive: true });
      mkdirSync(join(LOOP_HOME, "inbox", ".failed"), { recursive: true });
    },
    ensureParent: (p: string) => {
      const { dirname } = require("node:path") as typeof import("node:path");
      mkdirSync(dirname(p), { recursive: true });
    },
  };
});

const {
  filterActionable,
  notifyForDecisions,
  getAttentionCount,
  bumpAttentionCount,
  isOverBudget,
  localDayKey,
} = await import("@/lib/loop/notifications");
const { sendNotification } = await import("@/lib/tauri");
const { writePreferences, readPreferences } =
  await import("@/lib/loop/preferences");
const { mutes } = await import("@/lib/loop/store");

let tmp: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmp = mkdtempSync(join(tmpdir(), "loomi-notif-"));
  LOOP_HOME = join(tmp, ".openloomi", "loop");
  // Defensive: ensure each test starts with a known-empty preferences file.
  writePreferences({});
  // Sanity: after the reset the default should be false.
  expect(readPreferences().desktopNotifications).toBe(false);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const realDec = {
  id: "d1",
  ts: new Date().toISOString(),
  status: "pending" as const,
  type: "rsvp" as const,
  title: "Reply to Alice",
  action: { kind: "rsvp" as const, params: {} },
};

const noopDec = {
  ...realDec,
  id: "d2",
  type: "noop" as const,
  title: "Tick clean. 0 new decisions.",
};

// #378 — `unknown` is the placeholder type for non-actionable notifications
// the agent used to emit before the aggregator existed. It must never produce
// a desktop notification — `isNoopDecision` now filters it out at the same
// boundary that drops noop / tick_summary / context.noop records.
const unknownDec = {
  ...realDec,
  id: "d3",
  type: "unknown" as const,
  title: "GitHub notification",
};

describe("filterActionable", () => {
  it("drops noop and tick_summary records", () => {
    const out = filterActionable([realDec, noopDec]);
    expect(out.map((d) => d.id)).toEqual(["d1"]);
  });
  it("drops type=unknown records (#378)", () => {
    const out = filterActionable([realDec, unknownDec]);
    expect(out.map((d) => d.id)).toEqual(["d1"]);
  });
});

describe("notifyForDecisions", () => {
  it("short-circuits when desktopNotifications=false (default)", async () => {
    const r = await notifyForDecisions([realDec]);
    expect(r.skippedOptOut).toBe(true);
    expect(r.sent).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("filters out noop records even when opt-in", async () => {
    writePreferences({ desktopNotifications: true });
    const r = await notifyForDecisions([realDec, noopDec]);
    expect(r.considered).toBe(2);
    expect(r.filtered).toBe(1);
    expect(r.sent).toBe(1);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  // #378 — `unknown` records must never fan out to desktop notifications.
  it("filters out type=unknown records even when opt-in", async () => {
    writePreferences({ desktopNotifications: true });
    const r = await notifyForDecisions([realDec, unknownDec]);
    expect(r.considered).toBe(2);
    expect(r.filtered).toBe(1);
    expect(r.sent).toBe(1);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.stringContaining("Reply to Alice"),
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// SP-4 — daily attention budget + per-source cooldown
// ---------------------------------------------------------------------------

const p0Dec = {
  id: "p0_1",
  ts: new Date().toISOString(),
  status: "pending" as const,
  type: "rsvp" as const,
  title: "P0 RSVP",
  action: { kind: "rsvp" as const, params: {} },
  priority: "P0" as const,
};

const p1Dec = {
  id: "p1_1",
  ts: new Date().toISOString(),
  status: "pending" as const,
  type: "todo" as const,
  title: "P1 todo",
  action: { kind: "todo" as const, params: {} },
  priority: "P1" as const,
};

describe("localDayKey", () => {
  it("returns YYYY-MM-DD for a Date in the user's locale", () => {
    const k = localDayKey(new Date("2026-07-17T12:34:56Z"));
    expect(k).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("bumpAttentionCount / getAttentionCount", () => {
  it("starts at 0 when no file exists", () => {
    expect(getAttentionCount()).toBe(0);
  });
  it("increments monotonically within the same day", () => {
    bumpAttentionCount();
    bumpAttentionCount();
    expect(getAttentionCount()).toBe(2);
  });
  it("resets when the day rolls over", () => {
    bumpAttentionCount(new Date("2026-07-16T12:00:00Z"));
    bumpAttentionCount(new Date("2026-07-17T12:00:00Z"));
    expect(getAttentionCount(new Date("2026-07-17T12:00:00Z"))).toBe(1);
    expect(getAttentionCount(new Date("2026-07-16T12:00:00Z"))).toBe(0);
  });
});

describe("isOverBudget", () => {
  it("returns false when under the cap", () => {
    expect(isOverBudget({ attentionBudget: { daily: 3 } })).toBe(false);
  });
  it("returns true once the cap is reached", () => {
    bumpAttentionCount();
    bumpAttentionCount();
    bumpAttentionCount();
    expect(isOverBudget({ attentionBudget: { daily: 3 } })).toBe(true);
  });
  it("uses the default daily=3 when no budget is supplied", () => {
    bumpAttentionCount();
    bumpAttentionCount();
    bumpAttentionCount();
    expect(isOverBudget({})).toBe(true);
  });
});

describe("notifyForDecisions — SP-4 budget + cooldown", () => {
  beforeEach(() => {
    // Reset mutes between tests so cooldowns don't leak.
    mutes.invalidate();
  });
  it("respects the daily cap, dropping P1+ after the threshold", async () => {
    writePreferences({
      desktopNotifications: true,
      attentionBudget: { daily: 2, p0BypassBudget: false },
    });
    const a = { ...p1Dec, id: "a" };
    const b = { ...p1Dec, id: "b" };
    const c = { ...p1Dec, id: "c" };
    const r = await notifyForDecisions([a, b, c]);
    expect(r.sent).toBe(2);
    expect(r.budgetSuppressed).toBe(1);
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });
  it("lets P0 bypass the budget by default", async () => {
    writePreferences({
      desktopNotifications: true,
      attentionBudget: { daily: 1, p0BypassBudget: true },
    });
    // Burn the one P1 slot, then a P0 must still go through.
    const r1 = await notifyForDecisions([{ ...p1Dec, id: "x" }]);
    expect(r1.sent).toBe(1);
    const r2 = await notifyForDecisions([{ ...p0Dec, id: "y" }]);
    expect(r2.sent).toBe(1);
    expect(r2.sentP0Bypass).toBe(1);
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });
  it("p0BypassBudget=false also caps P0", async () => {
    writePreferences({
      desktopNotifications: true,
      attentionBudget: { daily: 1, p0BypassBudget: false },
    });
    const r = await notifyForDecisions([
      { ...p1Dec, id: "x" },
      { ...p0Dec, id: "y" },
    ]);
    expect(r.sent).toBe(1);
    expect(r.budgetSuppressed).toBe(1);
    expect(r.sentP0Bypass).toBe(0);
  });
  it("suppresses notifications when the source is in cooldown", async () => {
    writePreferences({ desktopNotifications: true });
    // Arm a cooldown for the same email sender.
    mutes.add({
      key: "email:alice@example.com",
      scope: { kind: "email", from: "alice@example.com" },
      createdAt: new Date().toISOString(),
      cooldown_until: new Date(Date.now() + 60_000).toISOString(),
    });
    const decWithSource = {
      ...p1Dec,
      id: "z",
      source_signal: {
        id: "sig1",
        ts: new Date().toISOString(),
        source: "gmail",
        type: "email" as const,
        payload: { from: "alice@example.com" },
      },
    };
    const r = await notifyForDecisions([decWithSource]);
    expect(r.sent).toBe(0);
    expect(r.cooldownSuppressed).toBe(1);
    expect(sendNotification).not.toHaveBeenCalled();
  });
  it("cooldown does not block when the source is different", async () => {
    writePreferences({ desktopNotifications: true });
    mutes.add({
      key: "email:bob@example.com",
      scope: { kind: "email", from: "bob@example.com" },
      createdAt: new Date().toISOString(),
      cooldown_until: new Date(Date.now() + 60_000).toISOString(),
    });
    const decWithSource = {
      ...p1Dec,
      id: "z",
      source_signal: {
        id: "sig1",
        ts: new Date().toISOString(),
        source: "gmail",
        type: "email" as const,
        payload: { from: "alice@example.com" },
      },
    };
    const r = await notifyForDecisions([decWithSource]);
    expect(r.sent).toBe(1);
    expect(r.cooldownSuppressed).toBe(0);
  });
});
