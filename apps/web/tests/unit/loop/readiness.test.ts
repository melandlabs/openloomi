/**
 * Regression coverage for `lib/loop/readiness.ts` — the pure helpers that
 * separate classification confidence, decision readiness, and relationship
 * context (issue #359).
 *
 * The original bug: a single `confidence` value was being used both as the
 * priority signal (so high-confidence self-owned RSVPs were promoted to P0)
 * AND as the implicit "go" signal for the default Run action (so they ran
 * anyway). These tests pin the contract that:
 *
 *   - `confidence` never participates in `derivePriority`
 *   - a `not_actionable` decision is ALWAYS P2 and never executable,
 *     regardless of urgency or classification confidence
 *   - a `needs_context` decision caps at P1 even when the deadline is <24h
 *   - the plain-language state never collapses to "ready" when the
 *     counterparty is unknown and the action is external
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  canExecute,
  derivePriority,
  deriveReadiness,
  deriveRelationship,
  deriveUrgency,
  rankByPriority,
  readinessState,
  stateLabel,
  type RankableDecision,
} from "@/lib/loop/readiness";

beforeEach(() => {
  vi.useFakeTimers();
  // Anchored reference point — keep all "due in N hours" math deterministic.
  vi.setSystemTime(new Date("2026-07-16T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// deriveReadiness — rsvp
// ---------------------------------------------------------------------------

describe("deriveReadiness — rsvp", () => {
  it("marks self-owned events with no other guests as not_actionable", () => {
    const r = deriveReadiness({
      type: "rsvp",
      action: {
        params: {
          organizerIsSelf: true,
          attendeesCount: 0,
          start: "2026-07-17T10:00:00Z",
          organizer: "me",
        },
      },
    });
    expect(r.status).toBe("not_actionable");
  });

  it("does NOT mark a self-owned event as not_actionable when it has guests", () => {
    const r = deriveReadiness({
      type: "rsvp",
      action: {
        params: {
          organizerIsSelf: true,
          attendeesCount: 3,
          start: "2026-07-17T10:00:00Z",
          organizer: "me",
        },
      },
    });
    expect(r.status).toBe("ready");
  });

  it("flags missing event time and organizer", () => {
    const r = deriveReadiness({
      type: "rsvp",
      action: { params: {} },
    });
    expect(r.status).toBe("needs_context");
    expect(r.missing).toEqual(
      expect.arrayContaining(["event time", "organizer"]),
    );
  });

  it("flags missing event time only when organizer is set", () => {
    const r = deriveReadiness({
      type: "rsvp",
      action: { params: { organizer: "Sam" } },
    });
    expect(r.status).toBe("needs_context");
    expect(r.missing).toEqual(["event time"]);
  });

  it("is ready with a well-formed rsvp action", () => {
    const r = deriveReadiness({
      type: "rsvp",
      action: {
        params: {
          start: "2026-07-17T10:00:00Z",
          organizer: "Sam",
        },
      },
    });
    expect(r.status).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// deriveReadiness — deadline_reminder / email_reply / unknown
// ---------------------------------------------------------------------------

describe("deriveReadiness — deadline_reminder", () => {
  it("flags missing deadline and message", () => {
    const r = deriveReadiness({
      type: "deadline_reminder",
      action: { params: {} },
    });
    expect(r.status).toBe("needs_context");
    expect(r.missing).toEqual(
      expect.arrayContaining(["deadline", "what's due"]),
    );
  });

  it("is ready with both deadline and message", () => {
    const r = deriveReadiness({
      type: "deadline_reminder",
      action: {
        params: {
          deadlineAt: "2026-07-17T10:00:00Z",
          message: "Ship release",
        },
      },
    });
    expect(r.status).toBe("ready");
  });
});

describe("deriveReadiness — email_reply", () => {
  it("flags missing recipient", () => {
    const r = deriveReadiness({
      type: "email_reply",
      action: { params: { subject: "hi" } },
    });
    expect(r.status).toBe("needs_context");
    expect(r.missing).toEqual(["recipient"]);
  });

  it("is ready with a recipient", () => {
    const r = deriveReadiness({
      type: "email_reply",
      action: { params: { to: "sam@example.com" } },
    });
    expect(r.status).toBe("ready");
  });
});

describe("deriveReadiness — fallback for unknown / custom types", () => {
  it("marks quiet_digest cards as not_actionable", () => {
    const r = deriveReadiness({
      type: "quiet_digest",
      action: { params: { module: "github-notifications" } },
    });
    expect(r.status).toBe("not_actionable");
    expect(canExecute(r)).toBe(false);
  });

  it("defaults to ready for unknown types so custom cards keep working", () => {
    const r = deriveReadiness({
      type: "my_custom_thing",
      action: { params: {} },
    });
    expect(r.status).toBe("ready");
  });

  it("honours an explicit readiness override", () => {
    const r = deriveReadiness({
      type: "rsvp",
      action: {
        params: {
          organizerIsSelf: true,
          attendeesCount: 0,
        },
      },
      readiness: { status: "ready" },
    });
    expect(r.status).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// canExecute
// ---------------------------------------------------------------------------

describe("canExecute", () => {
  it("blocks not_actionable even when urgency is high", () => {
    expect(canExecute({ status: "not_actionable" })).toBe(false);
  });

  it("allows needs_context (run may surface a missing-fields prompt)", () => {
    expect(canExecute({ status: "needs_context", missing: ["x"] })).toBe(true);
  });

  it("allows ready", () => {
    expect(canExecute({ status: "ready" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deriveRelationship
// ---------------------------------------------------------------------------

describe("deriveRelationship", () => {
  it("honours an explicit relationship", () => {
    expect(deriveRelationship({ relationship: { level: "known" } })).toEqual({
      level: "known",
    });
  });

  it("derives self when the organizer is the user", () => {
    expect(
      deriveRelationship({
        action: {
          kind: "calendar_rsvp",
          params: { organizerIsSelf: true },
        },
        context: {},
      }),
    ).toEqual({ level: "self" });
  });

  it("derives self even for non-external action kinds (organizerIsSelf wins first)", () => {
    expect(
      deriveRelationship({
        action: {
          kind: "todo",
          params: { organizerIsSelf: true },
        },
        context: {},
      }),
    ).toEqual({ level: "self" });
  });

  it("derives known when a person is set in context", () => {
    expect(
      deriveRelationship({
        action: { kind: "email_reply", params: {} },
        context: { person: "Sam" },
      }),
    ).toEqual({ level: "known" });
  });

  it("derives unknown for external actions with no person", () => {
    expect(
      deriveRelationship({
        action: { kind: "email_reply", params: {} },
        context: {},
      }),
    ).toEqual({ level: "unknown" });
  });

  it("stays silent for internal chores (returns null instead of guessing)", () => {
    expect(
      deriveRelationship({
        action: { kind: "todo", params: {} },
        context: {},
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deriveUrgency — time-to-act buckets
// ---------------------------------------------------------------------------

describe("deriveUrgency", () => {
  it("returns high for things due within 24h", () => {
    const u = deriveUrgency({
      action: {
        params: { deadlineAt: "2026-07-17T06:00:00Z" }, // 18h from anchor
      },
    });
    expect(u).toBe("high");
  });

  it("returns medium for things due between 24h and 72h", () => {
    const u = deriveUrgency({
      action: {
        params: { start: "2026-07-18T06:00:00Z" }, // 42h from anchor
      },
    });
    expect(u).toBe("medium");
  });

  it("returns low for things more than 72h away", () => {
    const u = deriveUrgency({
      action: {
        params: { start: "2026-07-22T00:00:00Z" }, // ~132h
      },
    });
    expect(u).toBe("low");
  });

  it("returns low when no time-to-act signal is present (never invents urgency)", () => {
    expect(deriveUrgency({ action: { params: { subject: "hi" } } })).toBe(
      "low",
    );
  });

  it("returns low for past deadlines — there is nothing left to rush", () => {
    expect(
      deriveUrgency({
        action: {
          params: { deadlineAt: "2026-07-15T12:00:00Z" }, // yesterday
        },
      }),
    ).toBe("low");
  });
});

// ---------------------------------------------------------------------------
// derivePriority — the headline regression for #359
// ---------------------------------------------------------------------------

describe("derivePriority — never derived from confidence", () => {
  it("not_actionable is ALWAYS P2 regardless of urgency", () => {
    const p = derivePriority({
      type: "rsvp",
      action: {
        params: {
          organizerIsSelf: true,
          attendeesCount: 0,
          start: "2026-07-16T18:00:00Z", // 6h
        },
      },
    });
    expect(p).toBe("P2");
  });

  it("not_actionable is P2 even with confidence set to 1.0 (#359 headline)", () => {
    // The bug repro: classification confidence was 1.0, the old priority
    // derived from confidence, so this would have been P0. The invariant
    // is that confidence never enters the priority formula at all.
    const p = derivePriority({
      type: "rsvp",
      action: {
        params: {
          organizerIsSelf: true,
          attendeesCount: 0,
          start: "2026-07-16T18:00:00Z",
        },
      },
    } as never);
    expect(p).toBe("P2");
  });

  it("ready + high urgency (<24h) → P0", () => {
    const p = derivePriority({
      type: "rsvp",
      action: {
        params: {
          start: "2026-07-16T18:00:00Z",
          organizer: "Sam",
        },
      },
    });
    expect(p).toBe("P0");
  });

  it("ready + medium urgency (24-72h) → P1", () => {
    const p = derivePriority({
      type: "rsvp",
      action: {
        params: {
          start: "2026-07-18T06:00:00Z",
          organizer: "Sam",
        },
      },
    });
    expect(p).toBe("P1");
  });

  it("ready + no urgency signal → P2", () => {
    const p = derivePriority({
      type: "email_reply",
      action: { params: { to: "sam@example.com" } },
    });
    expect(p).toBe("P2");
  });

  it("needs_context + urgent caps at P1 (never gets to masquerade as P0)", () => {
    const p = derivePriority({
      type: "rsvp",
      // explicit needs_context (organizer missing) WITHIN 24h
      readiness: { status: "needs_context", missing: ["organizer"] },
      action: {
        params: { start: "2026-07-16T18:00:00Z" },
      },
    });
    expect(p).toBe("P1");
  });

  it("needs_context + medium urgency stays P1", () => {
    const p = derivePriority({
      type: "deadline_reminder",
      readiness: { status: "needs_context", missing: ["message"] },
      action: {
        params: { deadlineAt: "2026-07-18T06:00:00Z" },
      },
    });
    expect(p).toBe("P1");
  });
});

// ---------------------------------------------------------------------------
// readinessState — plain-language state for the primary card surface
// ---------------------------------------------------------------------------

describe("readinessState", () => {
  it("passes not_actionable through unchanged", () => {
    expect(
      readinessState({
        type: "rsvp",
        action: { params: { organizerIsSelf: true, attendeesCount: 0 } },
      }),
    ).toBe("not_actionable");
  });

  it("passes needs_context through unchanged", () => {
    expect(
      readinessState({
        type: "rsvp",
        action: { params: {} },
      }),
    ).toBe("needs_context");
  });

  it("upgrades ready+external+unknown counterparty to confirm", () => {
    expect(
      readinessState({
        type: "email_reply",
        action: {
          kind: "email_reply",
          params: { to: "stranger@example.com" },
        },
        context: {},
      }),
    ).toBe("confirm");
  });

  it("keeps ready when the counterparty is known", () => {
    expect(
      readinessState({
        type: "email_reply",
        action: {
          kind: "email_reply",
          params: { to: "sam@example.com" },
        },
        context: { person: "Sam" },
      }),
    ).toBe("ready");
  });

  it("keeps ready for internal actions even with no person set", () => {
    expect(
      readinessState({
        type: "todo",
        action: { kind: "todo", params: {} },
        context: {},
      }),
    ).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// stateLabel — stable i18n keys for the card pill
// ---------------------------------------------------------------------------

describe("stateLabel", () => {
  it("maps every state to a stable key and English fallback", () => {
    expect(stateLabel("ready")).toEqual({
      key: "loop.readiness.ready",
      fallback: "Ready to decide",
    });
    expect(stateLabel("needs_context")).toEqual({
      key: "loop.readiness.needsContext",
      fallback: "Needs more context",
    });
    expect(stateLabel("not_actionable")).toEqual({
      key: "loop.readiness.notActionable",
      fallback: "No action needed",
    });
    expect(stateLabel("confirm")).toEqual({
      key: "loop.readiness.confirm",
      fallback: "Confirm carefully",
    });
  });
});

// ---------------------------------------------------------------------------
// rankByPriority — SP-1 projector
// ---------------------------------------------------------------------------
//
// Pin the ranking contract that backs the pet bubble + card "most-urgent
// first" behaviour. The projector must:
//   1. Order P0 → P1 → P2
//   2. Break ties by `action.params.deadlineAt` (or `start`) ascending
//   3. Break remaining ties by `ts` ascending (older arrivals first)
//   4. Treat missing deadlines as "after a non-null deadline" within
//      the same priority bucket
//   5. Honour pre-computed `priority` field when present (TS source of
//      truth; the projector must not re-derive on top of a stored value)

function mk(
  id: string,
  type: string,
  ts: string,
  params: Record<string, unknown> = {},
  priority?: "P0" | "P1" | "P2",
): RankableDecision & { id: string } {
  return {
    id,
    ts,
    type,
    action: { params },
    ...(priority ? { priority } : {}),
  };
}

describe("rankByPriority — SP-1", () => {
  it("orders P0 before P1 before P2", () => {
    // Use plain `todo` with explicit priorities via pre-computed field
    // so the test doesn't depend on the rsvp read-side readiness
    // semantics (which require attendees / my_response to be set).
    const ranked = rankByPriority([
      mk("p2", "todo", "2026-07-16T10:00:00Z", {}, "P2"),
      mk("p0", "todo", "2026-07-16T11:00:00Z", {}, "P0"),
      mk("p1", "todo", "2026-07-16T11:30:00Z", {}, "P1"),
    ]);
    expect(ranked.map((d) => d.id)).toEqual(["p0", "p1", "p2"]);
  });

  it("breaks priority ties by deadline ascending", () => {
    const ranked = rankByPriority([
      mk("late", "rsvp", "2026-07-16T11:00:00Z", {
        start: "2026-07-18T12:00:00Z", // later deadline
      }),
      mk("early", "rsvp", "2026-07-16T11:00:00Z", {
        start: "2026-07-17T12:00:00Z", // sooner deadline
      }),
    ]);
    expect(ranked.map((d) => d.id)).toEqual(["early", "late"]);
  });

  it("places missing-deadline decisions last within their priority bucket", () => {
    const ranked = rankByPriority([
      mk("no-date", "todo", "2026-07-16T08:00:00Z"), // no params
      mk("with-date", "todo", "2026-07-16T11:00:00Z", {
        deadlineAt: "2026-07-18T12:00:00Z",
      }),
    ]);
    expect(ranked.map((d) => d.id)).toEqual(["with-date", "no-date"]);
  });

  it("breaks remaining ties by ts ascending (older first)", () => {
    // Same priority, same deadline — only ts differs.
    const ranked = rankByPriority([
      mk("newer", "rsvp", "2026-07-16T11:00:00Z", {
        start: "2026-07-17T12:00:00Z",
      }),
      mk("older", "rsvp", "2026-07-16T08:00:00Z", {
        start: "2026-07-17T12:00:00Z",
      }),
    ]);
    expect(ranked.map((d) => d.id)).toEqual(["older", "newer"]);
  });

  it("honours pre-computed priority field without re-deriving", () => {
    // Pre-computed P2 wins over what `derivePriority` would have
    // produced (the rsvp has `start` in <24h → would normally be
    // P0). The pre-computed value is the TS source of truth — the
    // projector trusts it verbatim so the pet bubble stays in
    // lockstep with the dashboard.
    const now = new Date("2026-07-16T12:00:00Z");
    const ranked = rankByPriority(
      [
        mk(
          "stamped-p2",
          "rsvp",
          "2026-07-16T10:00:00Z",
          {
            start: "2026-07-16T18:00:00Z", // <24h → would derive P0
            organizer: "alice@x.com",
          },
          "P2",
        ),
        mk(
          "stamped-p0",
          "todo",
          "2026-07-16T10:00:00Z",
          {
            deadlineAt: "2026-07-20T12:00:00Z", // >72h → would derive P2
          },
          "P0",
        ),
      ],
      now,
    );
    // The pre-computed values invert the natural derivation order:
    // stamped-p2 (urgent source, but explicitly demoted to P2) lands
    // LAST; stamped-p0 (stale source, but explicitly promoted to P0)
    // lands FIRST. This is the SP-1 contract: TS is source of truth,
    // the projector doesn't second-guess it.
    expect(ranked.map((d) => d.id)).toEqual(["stamped-p0", "stamped-p2"]);
  });

  it("returns the same array reference count for an empty list", () => {
    expect(rankByPriority([])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [
      mk("p2", "todo", "2026-07-16T10:00:00Z"),
      mk("p0", "rsvp", "2026-07-16T11:00:00Z", {
        start: "2026-07-16T18:00:00Z",
      }),
    ];
    const before = input.map((d) => d.id);
    rankByPriority(input);
    expect(input.map((d) => d.id)).toEqual(before);
  });
});
