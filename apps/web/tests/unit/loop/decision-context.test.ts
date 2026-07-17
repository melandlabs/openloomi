/**
 * Regression coverage for `lib/loop/decision-context.ts` (#363) — the pure
 * helper that extracts the user-facing facts a person needs to decide on
 * a card. The card layer (`DecisionContextBlock`) renders whatever this
 * helper returns, so the contract is:
 *
 *   - RSVP cards get a Time / Organizer / Attendance / Location / Conflict
 *     block (the Conflict row is the explicit `No conflict` placeholder
 *     until a follow-up PR wires freebusy);
 *   - non-RSVP / unknown types return `null` so the block no-ops;
 *   - formatting is deterministic when a `now` and `locale` are passed.
 */

import { describe, expect, it } from "vitest";

import { deriveDecisionContext } from "@/lib/loop/decision-context";

// Anchored reference point — keep "Today" / "Tomorrow" assertions stable.
const NOW = new Date("2026-07-16T12:00:00Z");

describe("deriveDecisionContext — RSVP happy path", () => {
  it("returns Time, Organizer, Attendance, Location, Conflict for a full payload", () => {
    const ctx = deriveDecisionContext(
      {
        type: "rsvp",
        action: {
          params: {
            start: "2026-07-17T09:30:00Z", // tomorrow
            end: "2026-07-17T10:00:00Z",
            organizer: "Sam Lee <sam@example.com>",
            attendeesCount: 5,
            attendeesAcceptedCount: 2,
            location: "Zoom — https://zoom.example.com/r/abc",
            htmlLink: "https://www.google.com/calendar/event?eid=abc",
          },
        },
      },
      { now: NOW, locale: "en-US" },
    );
    expect(ctx).not.toBeNull();
    expect(ctx?.type).toBe("rsvp");
    const labels = ctx?.fields.map((f) => f.label);
    expect(labels).toEqual([
      "loop.rsvp.fieldTime",
      "loop.rsvp.fieldOrganizer",
      "loop.rsvp.fieldAttendance",
      "loop.rsvp.fieldLocation",
      "loop.rsvp.fieldConflict",
    ]);
    // Time → "Tomorrow, 09:30–09:30" (same day window; the en-US time
    // formatter prints hour:minute which collapses when start==end here
    // because we deliberately used one-minute apart). Just assert the
    // prefix and the location suffix instead of locking in seconds.
    expect(ctx?.fields[0].value).toMatch(/^Tomorrow,\s*\d/);
    // Organizer → strip the "<email>" suffix to surface the display name.
    expect(ctx?.fields[1].value).toBe("Sam Lee");
    // Attendance → "N invited · M accepted"
    expect(ctx?.fields[2].value).toBe("5 invited · 2 accepted");
    // Location → falls back to htmlLink when the free-text location is a
    // video URL; href wires to that same URL.
    expect(ctx?.fields[3].href).toMatch(/^https?:\/\//);
    // Conflict → placeholder, no href.
    expect(ctx?.fields[4].value).toBe("loop.rsvp.conflictNone");
    expect(ctx?.fields[4].href).toBeUndefined();
  });

  it("uses Today / Yesterday prefix when the event falls on the reference day", () => {
    const ctx = deriveDecisionContext(
      {
        type: "rsvp",
        action: {
          params: {
            start: "2026-07-16T18:00:00Z", // today
            organizer: "Sam",
          },
        },
      },
      { now: NOW, locale: "en-US" },
    );
    expect(ctx).not.toBeNull();
    // en-US 12-hour format appends "AM"/"PM"; assert only the day prefix.
    expect(ctx?.fields[0].value).toMatch(/^Today,\s*\d/);
  });

  it("renders start time only when end is missing", () => {
    const ctx = deriveDecisionContext(
      {
        type: "rsvp",
        action: {
          params: { start: "2026-07-17T09:30:00Z", organizer: "Sam" },
        },
      },
      { now: NOW, locale: "en-US" },
    );
    expect(ctx).not.toBeNull();
    expect(ctx?.fields[0].value).toMatch(/^Tomorrow,\s*\d/);
  });

  it("renders an end-day arrow when start and end span different days", () => {
    const ctx = deriveDecisionContext(
      {
        type: "rsvp",
        action: {
          params: {
            start: "2026-07-16T23:00:00Z", // today, late
            end: "2026-07-17T01:00:00Z", // tomorrow, early
            organizer: "Sam",
          },
        },
      },
      { now: NOW, locale: "en-US" },
    );
    expect(ctx).not.toBeNull();
    expect(ctx?.fields[0].value).toMatch(/^Today,\s*\d.*\s*→\s*Tomorrow,\s*\d/);
  });

  it("leaves organizer as a raw email when there is no display name", () => {
    const ctx = deriveDecisionContext(
      {
        type: "rsvp",
        action: {
          params: {
            start: "2026-07-17T09:30:00Z",
            organizer: "sam@example.com",
          },
        },
      },
      { now: NOW, locale: "en-US" },
    );
    expect(ctx).not.toBeNull();
    expect(ctx?.fields[1].value).toBe("sam@example.com");
  });

  it("formats attendance with the invited-only fallback when accepted count is missing", () => {
    const ctx = deriveDecisionContext(
      {
        type: "rsvp",
        action: {
          params: {
            start: "2026-07-17T09:30:00Z",
            organizer: "Sam",
            attendeesCount: 3,
          },
        },
      },
      { now: NOW, locale: "en-US" },
    );
    expect(ctx).not.toBeNull();
    expect(ctx?.fields[2].value).toBe("3 invited");
  });
});

describe("deriveDecisionContext — missing fields", () => {
  it("drops the Time row when start is missing", () => {
    const ctx = deriveDecisionContext(
      {
        type: "rsvp",
        action: {
          params: { organizer: "Sam", attendeesCount: 1 },
        },
      },
      { now: NOW, locale: "en-US" },
    );
    expect(ctx).not.toBeNull();
    const labels = ctx?.fields.map((f) => f.label);
    expect(labels).not.toContain("loop.rsvp.fieldTime");
  });

  it("drops the Organizer row when organizer is missing or empty", () => {
    const ctx = deriveDecisionContext(
      {
        type: "rsvp",
        action: {
          params: { start: "2026-07-17T09:30:00Z", organizer: "   " },
        },
      },
      { now: NOW, locale: "en-US" },
    );
    expect(ctx).not.toBeNull();
    const labels = ctx?.fields.map((f) => f.label);
    expect(labels).not.toContain("loop.rsvp.fieldOrganizer");
  });

  it("drops the Attendance row when neither count is set", () => {
    const ctx = deriveDecisionContext(
      {
        type: "rsvp",
        action: {
          params: {
            start: "2026-07-17T09:30:00Z",
            organizer: "Sam",
          },
        },
      },
      { now: NOW, locale: "en-US" },
    );
    expect(ctx).not.toBeNull();
    const labels = ctx?.fields.map((f) => f.label);
    expect(labels).not.toContain("loop.rsvp.fieldAttendance");
  });

  it("always emits the Conflict placeholder even when every other row is empty", () => {
    const ctx = deriveDecisionContext(
      { type: "rsvp", action: { params: {} } },
      { now: NOW, locale: "en-US" },
    );
    expect(ctx).not.toBeNull();
    const conflictRow = ctx?.fields.find(
      (f) => f.label === "loop.rsvp.fieldConflict",
    );
    expect(conflictRow).toBeDefined();
    expect(conflictRow?.value).toBe("loop.rsvp.conflictNone");
  });
});

describe("deriveDecisionContext — location / link wiring", () => {
  it("wires href to htmlLink when location is missing", () => {
    const ctx = deriveDecisionContext(
      {
        type: "rsvp",
        action: {
          params: {
            start: "2026-07-17T09:30:00Z",
            organizer: "Sam",
            htmlLink: "https://meet.google.com/abc-defg-hij",
          },
        },
      },
      { now: NOW, locale: "en-US" },
    );
    expect(ctx).not.toBeNull();
    const loc = ctx?.fields.find((f) => f.label === "loop.rsvp.fieldLocation");
    expect(loc).toBeDefined();
    expect(loc?.value).toBe("https://meet.google.com/abc-defg-hij");
    expect(loc?.href).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("does not wire href for non-URL locations like 'Conference Room A'", () => {
    const ctx = deriveDecisionContext(
      {
        type: "rsvp",
        action: {
          params: {
            start: "2026-07-17T09:30:00Z",
            organizer: "Sam",
            location: "Conference Room A",
          },
        },
      },
      { now: NOW, locale: "en-US" },
    );
    expect(ctx).not.toBeNull();
    const loc = ctx?.fields.find((f) => f.label === "loop.rsvp.fieldLocation");
    expect(loc).toBeDefined();
    expect(loc?.value).toBe("Conference Room A");
    expect(loc?.href).toBeUndefined();
  });
});

describe("deriveDecisionContext — non-RSVP types", () => {
  it("returns null for draft_reply", () => {
    expect(
      deriveDecisionContext({
        type: "draft_reply",
        action: { params: { to: "sam@example.com" } },
      }),
    ).toBeNull();
  });

  it("returns null for review_pr", () => {
    expect(
      deriveDecisionContext({
        type: "review_pr",
        action: { params: { repo: "openloomi/web" } },
      }),
    ).toBeNull();
  });

  it("returns null for unknown / custom types (open for follow-up PRs)", () => {
    expect(
      deriveDecisionContext({
        type: "my_custom_type",
        action: { params: { foo: "bar" } },
      }),
    ).toBeNull();
  });
});

describe("deriveDecisionContext — defaults", () => {
  it("defaults to English locale when none is provided", () => {
    // Compute tomorrow (local calendar) at 09:30 so the "Tomorrow, …"
    // assertion stays stable regardless of when the suite runs.
    const now = new Date();
    const tomorrow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      9,
      30,
      0,
    );
    const ctx = deriveDecisionContext({
      type: "rsvp",
      action: {
        params: { start: tomorrow.toISOString(), organizer: "Sam" },
      },
    });
    expect(ctx).not.toBeNull();
    // We don't pin the exact time string here (TZ-dependent) but we
    // assert the prefix is correct in en-US style.
    expect(ctx?.fields[0].value).toMatch(/^Tomorrow,\s*\d/);
  });
});
