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

const { filterActionable, notifyForDecisions } =
  await import("@/lib/loop/notifications");
const { sendNotification } = await import("@/lib/tauri");
const { writePreferences, readPreferences } =
  await import("@/lib/loop/preferences");

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

describe("filterActionable", () => {
  it("drops noop and tick_summary records", () => {
    const out = filterActionable([realDec, noopDec]);
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
});
