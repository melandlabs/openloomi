/**
 * Unit tests for `lib/loop/custom-channels.ts`. Mirrors the
 * `custom-types` test pattern: mock `@/lib/loop/paths` to a fresh
 * tmp dir per test, then exercise CRUD, validation, cache
 * invalidation, the on-disk `ids` re-derivation, and the
 * `eventFilter` shape check.
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

const { customChannels, validateCustomChannel, MIN_POLL_INTERVAL_SEC } =
  await import("@/lib/loop/custom-channels");
const { readFileSync, writeFileSync } = await import("node:fs");

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "loomi-custom-channels-"));
  LOOP_HOME = join(tmp, ".openloomi", "loop");
  mkdirSync(LOOP_HOME, { recursive: true });
  customChannels.invalidate();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const valid = (id = "stripe_charges") => ({
  id,
  label: "Stripe charges",
  toolkit: "stripe",
  toolSlug: "STRIPE_LIST_CHARGES",
  pollIntervalSec: 600,
  signalType: "stripe_charge",
  payloadShape: "{id, amount, status, customer}",
});

describe("validateCustomChannel", () => {
  it("accepts a well-formed channel", () => {
    const r = validateCustomChannel(valid());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.channel.id).toBe("stripe_charges");
      expect(r.channel.toolSlug).toBe("STRIPE_LIST_CHARGES");
      expect(r.channel.pollIntervalSec).toBe(600);
    }
  });

  it("rejects bad id shapes", () => {
    for (const id of ["", "A", "1abc", "a-b", "a".repeat(50)]) {
      const r = validateCustomChannel({ ...valid(id), id });
      expect(r.ok).toBe(false);
    }
  });

  it("rejects bad toolkit slugs", () => {
    for (const toolkit of ["Stripe", "STRIPE", "Stripe-2", "s"]) {
      const r = validateCustomChannel({ ...valid(), toolkit });
      expect(r.ok).toBe(false);
    }
  });

  it("rejects bad toolSlug shapes", () => {
    for (const toolSlug of [
      "stripe_list_charges",
      "StripeListCharges",
      "STRIPE-LIST-CHARGES",
      "",
    ]) {
      const r = validateCustomChannel({ ...valid(), toolSlug });
      expect(r.ok).toBe(false);
    }
  });

  it("rejects pollIntervalSec < MIN_POLL_INTERVAL_SEC", () => {
    const r = validateCustomChannel({ ...valid(), pollIntervalSec: 30 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(new RegExp(String(MIN_POLL_INTERVAL_SEC)));
    }
  });

  it("rejects bad signalType shapes", () => {
    for (const signalType of ["", "Stripe-Charge", "1charge", "a".repeat(50)]) {
      const r = validateCustomChannel({ ...valid(), signalType });
      expect(r.ok).toBe(false);
    }
  });

  it("accepts an empty eventFilter (all records pass)", () => {
    const r = validateCustomChannel({ ...valid(), eventFilter: [] });
    expect(r.ok).toBe(true);
  });

  it("accepts well-formed eventFilter entries", () => {
    const r = validateCustomChannel({
      ...valid(),
      eventFilter: [
        { field: "status", op: "eq", value: "succeeded" },
        { field: "amount", op: "gt", value: 1000 },
        { field: "description", op: "contains", value: "annual" },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects malformed eventFilter entries", () => {
    const base = valid();
    expect(
      validateCustomChannel({ ...base, eventFilter: "not-an-array" as never })
        .ok,
    ).toBe(false);
    expect(
      validateCustomChannel({
        ...base,
        eventFilter: [
          { field: "x", op: "eq", value: 1 },
          { field: "", op: "eq", value: 1 },
        ],
      } as never).ok,
    ).toBe(false);
    expect(
      validateCustomChannel({
        ...base,
        eventFilter: [{ field: "x", op: "mismatch" as never, value: 1 }],
      }).ok,
    ).toBe(false);
    expect(
      validateCustomChannel({
        ...base,
        eventFilter: [
          { field: "x", op: "eq", value: { complex: true } as never },
        ],
      }).ok,
    ).toBe(false);
  });
});

describe("customChannels CRUD", () => {
  it("starts empty", () => {
    expect(customChannels.list()).toEqual([]);
    expect(customChannels.has("stripe_charges")).toBe(false);
  });

  it("upsert creates a new row", () => {
    const r = validateCustomChannel(valid());
    if (!r.ok) throw new Error("expected ok");
    const out = customChannels.upsert(r.channel);
    expect(out.created).toBe(true);
    expect(customChannels.list()).toHaveLength(1);
    expect(customChannels.get("stripe_charges")?.toolkit).toBe("stripe");
  });

  it("upsert is idempotent on unchanged input", () => {
    const r = validateCustomChannel(valid());
    if (!r.ok) throw new Error("expected ok");
    customChannels.upsert(r.channel);
    const second = customChannels.upsert(r.channel);
    expect(second.created).toBe(false);
    expect(customChannels.list()).toHaveLength(1);
  });

  it("upsert updates an existing row when the payload changes", () => {
    const r1 = validateCustomChannel(valid());
    if (!r1.ok) throw new Error("expected ok");
    customChannels.upsert(r1.channel);
    const r2 = validateCustomChannel({
      ...valid(),
      pollIntervalSec: 1200,
    });
    if (!r2.ok) throw new Error("expected ok");
    customChannels.upsert(r2.channel);
    expect(customChannels.list()).toHaveLength(1);
    expect(customChannels.get("stripe_charges")?.pollIntervalSec).toBe(1200);
  });

  it("remove returns true on hit, false on miss", () => {
    const r = validateCustomChannel(valid());
    if (!r.ok) throw new Error("expected ok");
    customChannels.upsert(r.channel);
    expect(customChannels.remove("nope")).toBe(false);
    expect(customChannels.remove("stripe_charges")).toBe(true);
    expect(customChannels.list()).toHaveLength(0);
  });

  it("recomputes `ids` on every write", () => {
    const r1 = validateCustomChannel(valid("foo_a"));
    const r2 = validateCustomChannel(valid("foo_b"));
    if (!r1.ok || !r2.ok) throw new Error("expected ok");
    customChannels.upsert(r1.channel);
    customChannels.upsert(r2.channel);
    const file = join(LOOP_HOME, "custom-channels.json");
    const onDisk = JSON.parse(readFileSync(file, "utf8")) as {
      channels: unknown[];
      ids: string[];
    };
    onDisk.ids = ["stale"];
    writeFileSync(file, JSON.stringify(onDisk));
    customChannels.invalidate();
    expect(customChannels.has("foo_a")).toBe(true);
    expect(customChannels.has("foo_b")).toBe(true);
    expect(customChannels.has("stale")).toBe(false);
  });

  it("invalidate drops the in-memory cache", () => {
    const r = validateCustomChannel(valid());
    if (!r.ok) throw new Error("expected ok");
    customChannels.upsert(r.channel);
    expect(customChannels.has("stripe_charges")).toBe(true);
    const file = join(LOOP_HOME, "custom-channels.json");
    writeFileSync(file, JSON.stringify({ version: 1, channels: [], ids: [] }));
    expect(customChannels.has("stripe_charges")).toBe(true);
    customChannels.invalidate();
    expect(customChannels.has("stripe_charges")).toBe(false);
  });
});
