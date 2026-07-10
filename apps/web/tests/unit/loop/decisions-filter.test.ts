import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mutable tmp dir reference for the mocked paths module. Each beforeEach
// creates a fresh dir and rewrites LOOP_HOME so test runs are isolated
// from each other AND from the user's real ~/.openloomi/loop.
let LOOP_HOME = "";

vi.mock("@/lib/loop/paths", async () => {
  const { join } = await import("node:path");
  // Build the paths object dynamically on each property access so the
  // mocked module sees the *current* LOOP_HOME, not the one captured at
  // module load time.
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

const { isNoopDecision, decisions } = await import("@/lib/loop/store");

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "loomi-dec-"));
  LOOP_HOME = join(tmp, ".openloomi", "loop");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("isNoopDecision", () => {
  it("rejects type=noop", () => {
    expect(isNoopDecision({ type: "noop", title: "anything" })).toBe(true);
  });
  it("rejects type=tick_summary", () => {
    expect(isNoopDecision({ type: "tick_summary", title: "x" })).toBe(true);
  });
  it("rejects '0 new decisions' titles", () => {
    expect(isNoopDecision({ type: "todo", title: "0 new decisions." })).toBe(
      true,
    );
    expect(
      isNoopDecision({ type: "todo", title: "  0 New Decisions today" }),
    ).toBe(true);
  });
  it("rejects context.source === 'loop_tick'", () => {
    expect(
      isNoopDecision({
        type: "todo",
        title: "Real title",
        context: { source: "loop_tick" },
      }),
    ).toBe(true);
  });
  it("rejects context.noop === true", () => {
    expect(
      isNoopDecision({
        type: "rsvp",
        title: "Yes",
        context: { noop: true },
      }),
    ).toBe(true);
  });
  it("accepts normal actionable decisions", () => {
    expect(isNoopDecision({ type: "rsvp", title: "Reply to Alice" })).toBe(
      false,
    );
  });
});

describe("decisions.add() filter", () => {
  it("returns null and does not write pending for noop records", () => {
    const before = decisions.list("pending").length;
    const dec = decisions.add({
      type: "noop",
      title: "Tick clean. 0 new decisions.",
      action: { kind: "todo", params: {} },
    });
    expect(dec).toBeNull();
    expect(decisions.list("pending").length).toBe(before);
  });

  it("returns null for tick_summary", () => {
    const dec = decisions.add({
      type: "tick_summary",
      title: "Tick result",
      action: { kind: "todo", params: {} },
    });
    expect(dec).toBeNull();
  });

  it("still persists a real brief card", () => {
    const dec = decisions.add({
      type: "brief",
      title: "Morning brief · 2026-07-10",
      action: { kind: "brief", params: { date: "2026-07-10" } },
    });
    expect(dec).not.toBeNull();
    expect(dec?.type).toBe("brief");
  });
});
