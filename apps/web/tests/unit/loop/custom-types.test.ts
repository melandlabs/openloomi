/**
 * Unit tests for `lib/loop/custom-types.ts`. Mirrors the `mutes` test
 * pattern: mock `@/lib/loop/paths` to a fresh tmp dir per test, then
 * exercise CRUD, validation, cache invalidation, the on-disk `ids`
 * re-derivation, and the built-in id collision guard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let LOOP_HOME = "";

vi.mock("@/lib/loop/paths", async () => {
  const { join } = await import("node:path");
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
    customTypes: join(LOOP_HOME, "custom-types.json"),
    customChannels: join(LOOP_HOME, "custom-channels.json"),
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
    },
  };
});

const { customTypes, validateCustomType, BUILTIN_DECISION_TYPES } =
  await import("@/lib/loop/custom-types");
const { readFileSync, writeFileSync } = await import("node:fs");
const { LOOP_PATHS } = await import("@/lib/loop/paths");

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "loomi-custom-types-"));
  LOOP_HOME = join(tmp, ".openloomi", "loop");
  mkdirSync(LOOP_HOME, { recursive: true });
  customTypes.invalidate();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const valid = (id = "birthday_wish") =>
  ({
    id,
    label: "Birthday wish",
    icon: "ri-cake-2-line",
    actionKind: "email_reply" as const,
    description: "Draft a happy-birthday email",
  }) as const;

describe("validateCustomType", () => {
  it("accepts a well-formed type", () => {
    const r = validateCustomType(valid());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.type.id).toBe("birthday_wish");
      expect(r.type.actionKind).toBe("email_reply");
      expect(r.type.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it("rejects ids that collide with built-in DecisionType", () => {
    for (const id of ["rsvp", "draft_reply", "quiet_digest", "unknown"]) {
      const r = validateCustomType({ ...valid(id), id });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toMatch(/collides with built-in/);
      }
    }
  });

  it("rejects bad id shapes", () => {
    for (const id of ["", "A", "1abc", "a-b", "a".repeat(50)]) {
      const r = validateCustomType({ ...valid(id), id });
      expect(r.ok).toBe(false);
    }
  });

  it("rejects actionKind outside the 14 built-ins", () => {
    const r = validateCustomType({
      ...valid(),
      actionKind: "send_sms" as never,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/actionKind must be one of/);
  });

  it("rejects label outside 1-40 chars", () => {
    expect(validateCustomType({ ...valid(), label: "" }).ok).toBe(false);
    expect(validateCustomType({ ...valid(), label: "a".repeat(41) }).ok).toBe(
      false,
    );
  });

  it("accepts an empty icon (fallback at render time)", () => {
    const r = validateCustomType({ ...valid(), icon: "" });
    expect(r.ok).toBe(true);
  });
});

describe("customTypes CRUD", () => {
  it("starts empty", () => {
    expect(customTypes.list()).toEqual([]);
    expect(customTypes.has("birthday_wish")).toBe(false);
  });

  it("upsert creates a new row", () => {
    const r = validateCustomType(valid());
    if (!r.ok) throw new Error("expected ok");
    const out = customTypes.upsert(r.type);
    expect(out.created).toBe(true);
    expect(customTypes.has("birthday_wish")).toBe(true);
    expect(customTypes.get("birthday_wish")?.label).toBe("Birthday wish");
  });

  it("upsert is idempotent on unchanged input", () => {
    const r = validateCustomType(valid());
    if (!r.ok) throw new Error("expected ok");
    customTypes.upsert(r.type);
    const second = customTypes.upsert(r.type);
    expect(second.created).toBe(false);
    expect(customTypes.list()).toHaveLength(1);
  });

  it("upsert updates an existing row when the payload changes", () => {
    const r1 = validateCustomType(valid());
    if (!r1.ok) throw new Error("expected ok");
    customTypes.upsert(r1.type);
    const r2 = validateCustomType({ ...valid(), label: "Birthday greeting" });
    if (!r2.ok) throw new Error("expected ok");
    customTypes.upsert(r2.type);
    expect(customTypes.list()).toHaveLength(1);
    expect(customTypes.get("birthday_wish")?.label).toBe("Birthday greeting");
  });

  it("remove returns true on hit, false on miss", () => {
    const r = validateCustomType(valid());
    if (!r.ok) throw new Error("expected ok");
    customTypes.upsert(r.type);
    expect(customTypes.remove("nope")).toBe(false);
    expect(customTypes.remove("birthday_wish")).toBe(true);
    expect(customTypes.list()).toHaveLength(0);
  });

  it("recomputes `ids` on every write — defence in depth", () => {
    const r1 = validateCustomType(valid("foo_a"));
    const r2 = validateCustomType(valid("foo_b"));
    if (!r1.ok || !r2.ok) throw new Error("expected ok");
    customTypes.upsert(r1.type);
    customTypes.upsert(r2.type);
    // Tamper with the on-disk `ids` to simulate drift, then re-read.
    const file = join(LOOP_HOME, "custom-types.json");
    const onDisk = JSON.parse(readFileSync(file, "utf8")) as {
      types: unknown[];
      ids: string[];
    };
    onDisk.ids = ["stale_id_1", "stale_id_2"];
    writeFileSync(file, JSON.stringify(onDisk));
    customTypes.invalidate();
    // The list (and `ids` derivation) should repair itself on read.
    expect(customTypes.has("foo_a")).toBe(true);
    expect(customTypes.has("foo_b")).toBe(true);
    expect(customTypes.has("stale_id_1")).toBe(false);
  });

  it("invalidate drops the in-memory cache", () => {
    const r = validateCustomType(valid());
    if (!r.ok) throw new Error("expected ok");
    customTypes.upsert(r.type);
    expect(customTypes.has("birthday_wish")).toBe(true);
    // External edit — bypass the API.
    const file = join(LOOP_HOME, "custom-types.json");
    writeFileSync(file, JSON.stringify({ version: 1, types: [], ids: [] }));
    // Cache still hot → list is stale.
    expect(customTypes.has("birthday_wish")).toBe(true);
    customTypes.invalidate();
    expect(customTypes.has("birthday_wish")).toBe(false);
  });
});

describe("BUILTIN_DECISION_TYPES", () => {
  it("contains the 16 known built-ins", () => {
    expect(BUILTIN_DECISION_TYPES.size).toBe(17);
    for (const t of [
      "rsvp",
      "draft_reply",
      "review_pr",
      "todo",
      "slack_reply",
      "deadline_reminder",
      "release_plan",
      "requirement_synthesis",
      "linear_review",
      "contact_update",
      "doc_update",
      "brief",
      "wrap",
      "noop",
      "tick_summary",
      "quiet_digest",
      "unknown",
    ]) {
      expect(BUILTIN_DECISION_TYPES.has(t)).toBe(true);
    }
  });
});
