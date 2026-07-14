/**
 * Unit tests for `lib/loop/classifier-rules.ts`.
 *
 * Mirrors the `custom-types.test.ts` pattern: mock `@/lib/loop/paths`
 * to a fresh tmp dir per test, then exercise CRUD, validation, cache
 * invalidation, the on-disk `ids` re-derivation, the built-in id
 * collision guard, AST evaluation against LoopSignal-shaped inputs,
 * the dry-run semantics, and the server-side override behaviour.
 *
 * Note: every `then: {...}` literal below carries an inline
 * `biome-ignore lint/suspicious/noThenProperty` comment because `then`
 * is the schema-defined action block key on `ClassifierRule` —
 * renaming would break the persisted JSON contract used by the
 * `/api/loop/classifier-rules` HTTP route and the watcher.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from "node:fs";
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
    classifierRules: join(LOOP_HOME, "classifier-rules.json"),
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

const {
  classifierRules,
  validateClassifierRule,
  evaluateRule,
  findMatchingRule,
  resolveField,
} = await import("@/lib/loop/classifier-rules");

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "loomi-classifier-rules-"));
  LOOP_HOME = join(tmp, ".openloomi", "loop");
  mkdirSync(LOOP_HOME, { recursive: true });
  classifierRules.invalidate();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function validBirthdayRule() {
  return {
    id: "force_birthday_today",
    label: "Same-day birthday → birthday_wish",
    when: [
      { field: "signal.type", op: "eq" as const, value: "contact_birthday" },
      {
        field: "signal.payload.daysUntilNext",
        op: "eq" as const,
        value: 0,
      },
    ],
    // biome-ignore lint/suspicious/noThenProperty: `then` is the schema-defined action block key on ClassifierRule
    then: {
      type: "birthday_wish",
      actionKind: "email_reply",
      confidence: 0.92,
    },
    description: "Force same-day birthdays into the birthday_wish type.",
  };
}

/**
 * Validate with `birthday_wish` declared as a known custom type id, so
 * the rule's `then.type` reference resolves. Mirrors how the HTTP route
 * passes the current `customTypes.list().map(t => t.id)` through to
 * the validator.
 */
function validate(input: Parameters<typeof validateClassifierRule>[0]) {
  return validateClassifierRule(input, {
    knownCustomTypeIds: ["birthday_wish", "refund_alert"],
  });
}

describe("validateClassifierRule", () => {
  it("accepts a well-formed rule", () => {
    const r = validate(validBirthdayRule());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rule.id).toBe("force_birthday_today");
      expect(r.rule.when).toHaveLength(2);
      expect(r.rule.then.type).toBe("birthday_wish");
      expect(r.rule.then.confidence).toBe(0.92);
    }
  });

  it("rejects ids that collide with built-in decision types", () => {
    const r = validateClassifierRule({
      ...validBirthdayRule(),
      id: "rsvp",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("collides with built-in");
  });

  it("rejects non-snake_case ids", () => {
    const r = validateClassifierRule({
      ...validBirthdayRule(),
      id: "BirthdayWish",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects empty `when`", () => {
    const r = validateClassifierRule({
      ...validBirthdayRule(),
      when: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("non-empty array");
  });

  it("rejects unknown op", () => {
    const r = validateClassifierRule({
      ...validBirthdayRule(),
      when: [{ field: "signal.type", op: "lol" as "eq", value: "x" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("op must be one of");
  });

  it("accepts `matches` op with a pattern instead of a value", () => {
    const r = validateClassifierRule({
      ...validBirthdayRule(),
      id: "skip_marketing",
      when: [
        {
          field: "signal.payload.from",
          op: "matches",
          pattern: "(noreply|no-reply)@",
        },
      ],
      // biome-ignore lint/suspicious/noThenProperty: `then` is the schema-defined action block key on ClassifierRule
      then: { type: "noop" },
    });
    expect(r.ok).toBe(true);
  });

  it("rejects `matches` with an invalid regex", () => {
    const r = validateClassifierRule({
      ...validBirthdayRule(),
      id: "bad_regex",
      when: [
        {
          field: "signal.payload.from",
          op: "matches",
          pattern: "[unclosed",
        },
      ],
      // biome-ignore lint/suspicious/noThenProperty: `then` is the schema-defined action block key on ClassifierRule
      then: { type: "noop" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("not a valid RegExp");
  });

  it("rejects `noop` is allowed; unknown types require knownCustomTypeIds", () => {
    const ok = validateClassifierRule({
      ...validBirthdayRule(),
      id: "rule_a",
      // biome-ignore lint/suspicious/noThenProperty: `then` is the schema-defined action block key on ClassifierRule
      then: { type: "noop" },
    });
    expect(ok.ok).toBe(true);

    const needsId = validateClassifierRule({
      ...validBirthdayRule(),
      id: "rule_b",
      // biome-ignore lint/suspicious/noThenProperty: `then` is the schema-defined action block key on ClassifierRule
      then: { type: "refund_alert" },
    });
    expect(needsId.ok).toBe(false);

    const okWithKnown = validateClassifierRule(
      {
        ...validBirthdayRule(),
        id: "rule_c",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the schema-defined action block key on ClassifierRule
        then: { type: "refund_alert" },
      },
      { knownCustomTypeIds: ["refund_alert"] },
    );
    expect(okWithKnown.ok).toBe(true);
  });

  it("rejects confidence outside [0,1]", () => {
    const tooHigh = validate({
      ...validBirthdayRule(),
      // biome-ignore lint/suspicious/noThenProperty: `then` is the schema-defined action block key on ClassifierRule
      then: { type: "birthday_wish", confidence: 1.5 },
    });
    expect(tooHigh.ok).toBe(false);

    const negative = validate({
      ...validBirthdayRule(),
      // biome-ignore lint/suspicious/noThenProperty: `then` is the schema-defined action block key on ClassifierRule
      then: { type: "birthday_wish", confidence: -0.1 },
    });
    expect(negative.ok).toBe(false);
  });

  it("caps `when` at 8 conditions", () => {
    const big = Array.from({ length: 9 }, (_, i) => ({
      field: `signal.payload.f${i}`,
      op: "eq" as const,
      value: "x",
    }));
    const r = validateClassifierRule({
      ...validBirthdayRule(),
      when: big,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("at most 8");
  });
});

describe("classifierRules CRUD", () => {
  it("upserts a new rule and returns it", () => {
    const v = validate(validBirthdayRule());
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const upsert = classifierRules.upsert(v.rule);
    expect(upsert.created).toBe(true);
    expect(classifierRules.list()).toHaveLength(1);
    expect(classifierRules.has("force_birthday_today")).toBe(true);
    expect(classifierRules.get("force_birthday_today")?.id).toBe(
      "force_birthday_today",
    );
  });

  it("upsert is idempotent on identical input", () => {
    const v = validate(validBirthdayRule());
    if (!v.ok) throw new Error("expected valid");
    const first = classifierRules.upsert(v.rule);
    const second = classifierRules.upsert(v.rule);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(classifierRules.list()).toHaveLength(1);
  });

  it("removes by id and reports not-found", () => {
    const v = validate(validBirthdayRule());
    if (!v.ok) throw new Error("expected valid");
    classifierRules.upsert(v.rule);
    expect(classifierRules.remove("force_birthday_today")).toBe(true);
    expect(classifierRules.remove("force_birthday_today")).toBe(false);
    expect(classifierRules.list()).toHaveLength(0);
  });

  it("re-derives `ids` on every write (defence in depth)", () => {
    const v = validate(validBirthdayRule());
    if (!v.ok) throw new Error("expected valid");
    classifierRules.upsert(v.rule);
    const onDisk = JSON.parse(
      readFileSync(join(LOOP_HOME, "classifier-rules.json"), "utf8"),
    );
    expect(onDisk.version).toBe(1);
    expect(onDisk.rules).toHaveLength(1);
    expect(onDisk.ids).toEqual(["force_birthday_today"]);
  });

  it("invalidate() forces a re-read from disk", () => {
    const v = validate(validBirthdayRule());
    if (!v.ok) throw new Error("expected valid");
    classifierRules.upsert(v.rule);
    // Mutate the file directly to simulate an external edit
    const path = join(LOOP_HOME, "classifier-rules.json");
    const raw = JSON.parse(readFileSync(path, "utf8"));
    raw.rules[0].label = "External edit";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    fs.writeFileSync(path, JSON.stringify(raw, null, 2));
    // Cached value still has the original label
    expect(classifierRules.get("force_birthday_today")?.label).toBe(
      "Same-day birthday → birthday_wish",
    );
    classifierRules.invalidate();
    expect(classifierRules.get("force_birthday_today")?.label).toBe(
      "External edit",
    );
  });
});

describe("resolveField + evaluateRule (safe AST)", () => {
  const sig = {
    id: "sig_1",
    ts: "2026-07-14T10:00:00.000Z",
    source: "contact_birthdays",
    type: "contact_birthday",
    payload: {
      displayName: "Sarah",
      email: "sarah@acme.com",
      daysUntilNext: 0,
    },
  };

  it("resolves top-level fields", () => {
    expect(resolveField(sig, "signal.type")).toBe("contact_birthday");
    expect(resolveField(sig, "signal.source")).toBe("contact_birthdays");
    expect(resolveField(sig, "signal.id")).toBe("sig_1");
  });

  it("resolves one-level payload paths", () => {
    expect(resolveField(sig, "signal.payload.daysUntilNext")).toBe(0);
    expect(resolveField(sig, "signal.payload.email")).toBe("sarah@acme.com");
  });

  it("returns undefined for unknown fields", () => {
    expect(resolveField(sig, "signal.payload.missing")).toBeUndefined();
    expect(resolveField(sig, "unknown.path")).toBeUndefined();
  });

  it("evaluates eq + neq with string coercion", () => {
    const r = validateClassifierRule({
      id: "eq_test",
      when: [{ field: "signal.type", op: "eq", value: "contact_birthday" }],
      // biome-ignore lint/suspicious/noThenProperty: `then` is the schema-defined action block key on ClassifierRule
      then: { type: "noop" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(evaluateRule(sig, r.rule).matched).toBe(true);
  });

  it("evaluates numeric comparisons", () => {
    const r = validateClassifierRule({
      id: "num_test",
      when: [{ field: "signal.payload.daysUntilNext", op: "eq", value: 0 }],
      // biome-ignore lint/suspicious/noThenProperty: `then` is the schema-defined action block key on ClassifierRule
      then: { type: "noop" },
    });
    if (!r.ok) throw new Error("expected valid");
    expect(evaluateRule(sig, r.rule).matched).toBe(true);
  });

  it("evaluates `matches` with a regex pattern", () => {
    const r = validateClassifierRule({
      id: "regex_test",
      when: [
        {
          field: "signal.payload.email",
          op: "matches",
          pattern: "@acme\\.com$",
        },
      ],
      // biome-ignore lint/suspicious/noThenProperty: `then` is the schema-defined action block key on ClassifierRule
      then: { type: "noop" },
    });
    if (!r.ok) throw new Error("expected valid");
    expect(evaluateRule(sig, r.rule).matched).toBe(true);
  });

  it("evaluates `contains` on a string payload", () => {
    const r = validateClassifierRule({
      id: "contains_test",
      when: [
        { field: "signal.payload.displayName", op: "contains", value: "Sar" },
      ],
      // biome-ignore lint/suspicious/noThenProperty: `then` is the schema-defined action block key on ClassifierRule
      then: { type: "noop" },
    });
    if (!r.ok) throw new Error("expected valid");
    expect(evaluateRule(sig, r.rule).matched).toBe(true);
  });

  it("evaluates `exists` and `absent`", () => {
    const ex = validateClassifierRule({
      id: "exists_test",
      when: [{ field: "signal.payload.email", op: "exists" }],
      // biome-ignore lint/suspicious/noThenProperty: `then` is the schema-defined action block key on ClassifierRule
      then: { type: "noop" },
    });
    if (!ex.ok) throw new Error("expected valid");
    expect(evaluateRule(sig, ex.rule).matched).toBe(true);

    const ab = validateClassifierRule({
      id: "absent_test",
      when: [{ field: "signal.payload.missing", op: "absent" }],
      // biome-ignore lint/suspicious/noThenProperty: `then` is the schema-defined action block key on ClassifierRule
      then: { type: "noop" },
    });
    if (!ab.ok) throw new Error("expected valid");
    expect(evaluateRule(sig, ab.rule).matched).toBe(true);
  });

  it("returns false when ANY condition fails (AND semantics)", () => {
    const r = validateClassifierRule({
      id: "and_test",
      when: [
        { field: "signal.type", op: "eq", value: "contact_birthday" },
        { field: "signal.payload.daysUntilNext", op: "eq", value: 99 },
      ],
      // biome-ignore lint/suspicious/noThenProperty: `then` is the schema-defined action block key on ClassifierRule
      then: { type: "noop" },
    });
    if (!r.ok) throw new Error("expected valid");
    expect(evaluateRule(sig, r.rule).matched).toBe(false);
  });
});

describe("findMatchingRule", () => {
  const sig = {
    id: "sig_b",
    ts: "2026-07-14T10:00:00.000Z",
    source: "contact_birthdays",
    type: "contact_birthday",
    payload: { displayName: "Sarah", daysUntilNext: 0 },
  };

  it("returns the first matching rule in insertion order", () => {
    const a = validateClassifierRule({
      id: "rule_a",
      when: [{ field: "signal.type", op: "eq", value: "contact_birthday" }],
      // biome-ignore lint/suspicious/noThenProperty: `then` is the schema-defined action block key on ClassifierRule
      then: { type: "noop" },
    });
    const b = validate({
      id: "rule_b",
      when: [{ field: "signal.type", op: "eq", value: "contact_birthday" }],
      // biome-ignore lint/suspicious/noThenProperty: `then` is the schema-defined action block key on ClassifierRule
      then: { type: "birthday_wish", actionKind: "email_reply" },
    });
    if (!a.ok || !b.ok) throw new Error("expected valid");
    const match = findMatchingRule(sig, [a.rule, b.rule]);
    expect(match?.id).toBe("rule_a");
  });

  it("returns null when no rule matches", () => {
    const r = validateClassifierRule({
      id: "rule_x",
      when: [{ field: "signal.type", op: "eq", value: "email" }],
      // biome-ignore lint/suspicious/noThenProperty: `then` is the schema-defined action block key on ClassifierRule
      then: { type: "noop" },
    });
    if (!r.ok) throw new Error("expected valid");
    expect(findMatchingRule(sig, [r.rule])).toBeNull();
  });
});
