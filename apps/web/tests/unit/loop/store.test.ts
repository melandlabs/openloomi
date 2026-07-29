/**
 * Regression coverage for `lib/loop/store.ts` — the JSON-backed decision
 * store. These tests pin:
 *
 *   1. SP-1 — `decisions.add` stamps `context.priority` + top-level
 *      `dec.priority` via `normalizeDecision`, using
 *      `readiness.ts::derivePriority` (NOT confidence).
 *   2. SP-1 — the `version: 2` migration fires exactly once on the
 *      first read of a legacy (pre-SP-1) decisions.json, persists
 *      the backfilled priorities, and stays silent on subsequent
 *      reads (so the watcher's mtime-based transition diff doesn't
 *      churn).
 *   3. SP-1 — `decisions.add` retains FIFO storage order (insertion
 *      order); ranking is a *read-time* projection, not a sort on
 *      insert. The Rust watcher projects via `rank_pending`.
 *
 * The store writes to `~/.openloomi/loop/decisions.json`; these tests
 * override `LOOP_PATHS.home` via the test-only hook in
 * `lib/loop/paths.ts` so they run in a sandboxed temp dir.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// `vi.mock` is hoisted above top-level statements, so the temp dir
// must be created inside `vi.hoisted` to avoid a TDZ error. The
// hoisted callback runs in a sandbox that pre-resolves ESM imports,
// so we use `require` for the fs/path calls.
const { tempHome } = vi.hoisted(() => {
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const os = require("node:os") as typeof import("node:os");
  return {
    tempHome: fs.mkdtempSync(path.join(os.tmpdir(), "openloomi-store-test-")),
  };
});

// Override the loop home BEFORE importing the store so `LOOP_PATHS`
// resolves to the temp dir on first read.
vi.mock("@/lib/loop/paths", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/loop/paths")>(
      "@/lib/loop/paths",
    );
  return {
    ...actual,
    LOOP_PATHS: {
      ...actual.LOOP_PATHS,
      home: tempHome,
      decisions: join(tempHome, "decisions.json"),
      mutes: join(tempHome, "mutes.json"),
      log: join(tempHome, "loop.log"),
    },
    ensureDirs: () => {
      // no-op — tempHome already exists
    },
  };
});

import { decisions } from "@/lib/loop/store";
import { LOOP_PATHS } from "@/lib/loop/paths";

beforeEach(() => {
  // Fresh file per test so migration + version-stamping can be
  // observed in isolation.
  if (existsSync(LOOP_PATHS.decisions)) {
    rmSync(LOOP_PATHS.decisions);
  }
  if (existsSync(LOOP_PATHS.mutes)) {
    rmSync(LOOP_PATHS.mutes);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// SP-1 — priority stamp on add
// ---------------------------------------------------------------------------

describe("decisions.add — SP-1 priority stamp", () => {
  it("writes context.priority and top-level priority for an urgent rsvp", () => {
    // Frozen `now` so the deadline is <24h and `derivePriority` returns P0.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:00:00Z"));
    try {
      const dec = decisions.add({
        type: "rsvp",
        title: "RSVP — project sync",
        action: {
          kind: "calendar_rsvp",
          params: {
            start: "2026-07-16T18:00:00Z", // 6h
            organizer: "alice@example.com",
            attendeesCount: 2,
          },
        },
      });
      expect(dec).not.toBeNull();
      if (!dec) throw new Error("dec is null");
      expect(dec.priority).toBe("P0");
      expect(dec.context?.priority).toBe("P0");
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes P2 for a not_actionable decision regardless of confidence", () => {
    // quiet_digest always resolves to readiness=not_actionable per
    // readiness.ts → derivePriority always returns P2. The confidence
    // 0.9 is irrelevant (and is what the old Rust `match confidence`
    // would have wrongly bucketed as P0).
    const dec = decisions.add({
      type: "quiet_digest",
      title: "AI news digest",
      action: {
        kind: "quiet_digest",
        params: { module: "ai-news-digest" },
      },
      confidence: 0.9,
    });
    expect(dec).not.toBeNull();
    if (!dec) throw new Error("dec is null");
    expect(dec.priority).toBe("P2");
    expect(dec.context?.priority).toBe("P2");
  });

  it("retains FIFO insertion order — the priority is on the record, not the order", () => {
    // Insert P1 first, P0 second. The pending array should still be
    // [P0, P1] (insertion order = reverse of insertion because
    // `unshift` puts the new row at the head). The rank projection
    // is the consumer's job (Rust `rank_pending` / TS `rankByPriority`).
    const p1 = decisions.add({
      type: "todo",
      title: "Pick up issue #1",
      action: {
        kind: "todo",
        params: { title: "stale task" },
      },
    });
    const p0 = decisions.add({
      type: "rsvp",
      title: "RSVP — urgent",
      action: {
        kind: "calendar_rsvp",
        params: {
          start: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
          organizer: "alice@example.com",
        },
      },
    });
    expect(p1).not.toBeNull();
    expect(p0).not.toBeNull();
    if (!p0 || !p1) throw new Error("p0 or p1 is null");
    const list = decisions.pending();
    expect(list.map((d) => d.id)).toEqual([p0.id, p1.id]);
  });
});

// ---------------------------------------------------------------------------
// SP-1 — version: 2 migration gate
// ---------------------------------------------------------------------------

describe("decisions — SP-1 version: 2 migration", () => {
  it("backfills priority for legacy rows on the first read", () => {
    // Write a pre-SP-1 decisions.json: no `version`, no `priority` field.
    const legacy = {
      pending: [
        {
          id: "dec_legacy_p0",
          ts: "2026-07-16T10:00:00Z",
          status: "pending",
          type: "rsvp",
          title: "Legacy urgent RSVP",
          action: {
            kind: "calendar_rsvp",
            params: {
              start: "2026-07-16T18:00:00Z",
              organizer: "alice@example.com",
            },
          },
        },
        {
          id: "dec_legacy_p2",
          ts: "2026-07-16T10:00:00Z",
          status: "pending",
          type: "todo",
          title: "Legacy todo",
          action: { kind: "todo", params: { title: "task" } },
        },
      ],
      done: [],
      dismissed: [],
    };
    writeFileSync(LOOP_PATHS.decisions, JSON.stringify(legacy));

    // First read triggers the migration. The pending list comes back
    // stamped with priority AND the file is rewritten with `version: 2`.
    const first = decisions.list("pending");
    expect(first).toHaveLength(2);
    for (const d of first) {
      expect(d.priority).toMatch(/^P[012]$/);
      expect(d.context?.priority).toBe(d.priority);
    }

    // File on disk now carries the version gate.
    const onDisk = JSON.parse(readFileSync(LOOP_PATHS.decisions, "utf8"));
    expect(onDisk.version).toBe(2);
  });

  it("does not re-write the file when the version is already 2 (idempotent)", () => {
    // Write a v2 file with priorities already present. Read it twice
    // and observe that the mtime does not change on the second read
    // (no needless churn → watcher's mtime-based transition diff
    // stays stable).
    const v2 = {
      version: 2,
      pending: [
        {
          id: "dec_v2",
          ts: "2026-07-16T10:00:00Z",
          status: "pending",
          type: "todo",
          title: "v2",
          action: { kind: "todo", params: { title: "task" } },
          priority: "P1",
          context: { priority: "P1" },
        },
      ],
      done: [],
      dismissed: [],
    };
    writeFileSync(LOOP_PATHS.decisions, JSON.stringify(v2));
    const mtimeBefore = require("node:fs").statSync(
      LOOP_PATHS.decisions,
    ).mtimeMs;

    // Sleep so any spurious write would be observable as an mtime bump.
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    return sleep(20).then(() => {
      decisions.list("pending");
      const mtimeAfter = require("node:fs").statSync(
        LOOP_PATHS.decisions,
      ).mtimeMs;
      expect(mtimeAfter).toBe(mtimeBefore);
    });
  });
});
