/**
 * User-defined deterministic classifier rules — per-user extension to the
 * built-in `classify.ts` rule list and the agentic tick prompt's §5
 * classifier block.
 *
 * Why this exists alongside custom types / channels:
 *
 *   - Custom types give the agent *new ids to pick from*; they don't
 *     change *which signals get classified how*. If the LLM keeps
 *     misclassifying a Stripe refund as a `slack_reply`, registering
 *     a `refund_alert` type alone won't fix it — the LLM still has to
 *     notice the refund-shaped payload and reach for it.
 *   - Custom channels add new *signal sources*; same problem: once the
 *     signal is in the stream, classification is still up to the LLM.
 *   - **Classifier rules** are the deterministic layer above both:
 *     users say "if the signal looks like X, the decision MUST be
 *     type Y with actionKind Z and confidence ≥ W". The agent still
 *     produces the title / dialogue / why[] / params, but the
 *     routing decision is forced.
 *
 * Persistence: a single JSON file at
 * `~/.openloomi/loop/classifier-rules.json`. Mirrors `custom-types.ts` —
 * module-level cache + `invalidate()`, atomic writes via
 * `writeJsonAtomic`, ids re-derived on every write as defence in depth.
 *
 * Safety: the `when` field is a small AST of safe predicates over
 * signal fields (no eval, no arbitrary JS). See `RULE_OPS` for the
 * closed op set and `evaluateRule()` for the evaluator. This makes the
 * rules safe to deserialise from disk or HTTP without sandboxing.
 *
 * Scope: per-user (no workspace sharing). The skill catalogue in
 * `skills/openloomi-loop/SKILL.md` documents the HTTP API.
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { ensureDirs, LOOP_PATHS } from "./paths";
import { BUILTIN_DECISION_TYPES } from "./custom-types";
import type { LoopSignal } from "./types";

// ---------------------------------------------------------------------------
// AST — small, safe predicate language
// ---------------------------------------------------------------------------

/**
 * Closed set of operators supported in a `when` clause. Adding a new op
 * is a deliberate code change — users cannot extend this set from JSON.
 */
export const RULE_OPS = [
  "eq", // string/number/boolean equality (coerced)
  "neq", // inequality
  "contains", // substring (string field) or membership (array field)
  "matches", // RegExp test (string field, anchored)
  "startsWith", // string field
  "endsWith", // string field
  "gt",
  "lt",
  "gte",
  "lte",
  "exists", // field is present and non-null (value is ignored)
  "absent", // field is missing or null
] as const;

export type RuleOp = (typeof RULE_OPS)[number];

/**
 * A single predicate. Multiple conditions in a rule's `when` array are
 * AND-ed together. `field` is a dotted path resolved against the signal
 * via `resolveField()` — e.g. `signal.type`, `signal.payload.from`,
 * `signal.source`. Values are JSON primitives; regex `pattern` is inlined
 * as a string and compiled with a global flag for repeated matching.
 */
export interface RuleCondition {
  field: string;
  op: RuleOp;
  value?: string | number | boolean;
  /** Used by `matches`. Compiled once via `compileRule` for repeated eval. */
  pattern?: string;
}

/**
 * What a rule does when its `when` matches. `type` may be a built-in
 * `DecisionType` literal, a custom type id, or the special string
 * `"noop"` (the rule suppresses the signal — `#288` semantics, the
 * decision is dropped at the store layer).
 *
 * `confidence` is a *floor*: the rule never lowers the agent's
 * confidence, only raises it to the configured minimum.
 */
export interface RuleAction {
  /** built-in DecisionType | custom id | "noop" */
  type: string;
  /** When set, overrides `action.kind` on the persisted decision. */
  actionKind?: string;
  /** Floor in [0, 1]. The agent's confidence wins if it's higher. */
  confidence?: number;
}

export interface ClassifierRule {
  /** snake_case, 2-41 chars, must not collide with built-in type ids
   *  (rule ids are user-namespace, but reusing a built-in id would
   *  shadow it in the prompt's "user-defined" section). */
  id: string;
  /** Optional 1-60 char label rendered on the rule card. */
  label?: string;
  /** AND-ed predicates. At least one is required. */
  when: RuleCondition[];
  then: RuleAction;
  /** ≤ 280 chars; injected into the prompt as natural-language guidance. */
  description?: string;
  createdAt: string;
}

export interface ClassifierRulesFile {
  version: 1;
  rules: ClassifierRule[];
  /** Recomputed from `rules` on every write. */
  ids: string[];
}

/** Same shape as custom types — reuse the rule id regex. */
export const RULE_ID_RE = /^[a-z][a-z0-9_]{1,40}$/;

/** Dry-run / evaluation result shape. */
export interface RuleEvaluation {
  matched: boolean;
  /** Only present when `matched === true`. */
  then?: RuleAction;
}

export interface RuleValidationOk {
  ok: true;
  rule: ClassifierRule;
}
export interface RuleValidationError {
  ok: false;
  error: string;
}
export type ClassifierRuleValidationResult =
  | RuleValidationOk
  | RuleValidationError;

// ---------------------------------------------------------------------------
// File IO — mirror custom-types.ts
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function readJson<T>(p: string, fallback: T): T {
  try {
    if (!existsSync(p)) return fallback;
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(p: string, obj: unknown): void {
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  try {
    renameSync(tmp, p);
  } catch {
    writeFileSync(p, JSON.stringify(obj, null, 2));
  }
}

function emptyFile(): ClassifierRulesFile {
  return { version: 1, rules: [], ids: [] };
}

let cache: ClassifierRulesFile | null = null;

function readFile(): ClassifierRulesFile {
  if (cache) return cache;
  ensureDirs();
  const raw = readJson<ClassifierRulesFile>(
    LOOP_PATHS.classifierRules,
    emptyFile(),
  );
  const rules = Array.isArray(raw.rules) ? raw.rules : [];
  const ids = Array.from(new Set(rules.map((r) => r.id)));
  cache = { version: 1, rules, ids };
  return cache;
}

function writeFile(file: ClassifierRulesFile): void {
  const ids = Array.from(new Set(file.rules.map((r) => r.id)));
  const out: ClassifierRulesFile = { version: 1, rules: file.rules, ids };
  writeJsonAtomic(LOOP_PATHS.classifierRules, out);
  cache = out;
}

// ---------------------------------------------------------------------------
// Field resolution — safe dotted-path lookup over a LoopSignal
// ---------------------------------------------------------------------------

/**
 * Resolve a dotted path against a `LoopSignal`. Supports
 * `signal.<field>` and `signal.payload.<field>` (one level deep).
 * Returns `undefined` when any segment is missing.
 *
 * This is intentionally tiny: signals are flat objects with a known
 * shape (`id`, `ts`, `source`, `type`, `payload`, plus optional `_origin`,
 * `_insightId`). Going deeper would let users reach into payload
 * structures of arbitrary depth, which we don't want to encourage
 * (rules should target the shape, not the contents).
 */
export function resolveField(
  signal: Partial<LoopSignal>,
  path: string,
): unknown {
  if (!path.startsWith("signal.")) return undefined;
  const rest = path.slice("signal.".length);
  if (rest === "id") return signal.id;
  if (rest === "ts") return signal.ts;
  if (rest === "source") return signal.source;
  if (rest === "type") return signal.type;
  if (rest === "_origin") return signal._origin;
  if (rest === "_insightId") return signal._insightId;
  if (rest.startsWith("payload.")) {
    const key = rest.slice("payload.".length);
    const payload = signal.payload;
    if (!payload || typeof payload !== "object") return undefined;
    // Allow ONE more dot of nesting (e.g. payload.metadata.tag) — enough
    // for common Composio tool shapes without opening arbitrary depth.
    if (key.includes(".")) {
      const [head, ...tail] = key.split(".");
      let cur: unknown = (payload as Record<string, unknown>)[head];
      for (const seg of tail) {
        if (cur && typeof cur === "object") {
          cur = (cur as Record<string, unknown>)[seg];
        } else {
          return undefined;
        }
      }
      return cur;
    }
    return (payload as Record<string, unknown>)[key];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Predicate evaluation
// ---------------------------------------------------------------------------

function asNumber(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string") {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(x: unknown): string | null {
  return typeof x === "string" ? x : null;
}

const compiledPatternCache = new WeakMap<RuleCondition, RegExp | null>();

function compilePattern(c: RuleCondition): RegExp | null {
  if (compiledPatternCache.has(c)) {
    return compiledPatternCache.get(c) ?? null;
  }
  const src = c.pattern ?? (typeof c.value === "string" ? c.value : "");
  let re: RegExp | null = null;
  try {
    re = new RegExp(src);
  } catch {
    re = null;
  }
  compiledPatternCache.set(c, re);
  return re;
}

function evaluateCondition(
  signal: Partial<LoopSignal>,
  c: RuleCondition,
): boolean {
  if (!RULE_OPS.includes(c.op)) return false;
  const v = resolveField(signal, c.field);
  switch (c.op) {
    case "exists":
      return v !== undefined && v !== null;
    case "absent":
      return v === undefined || v === null;
    case "eq":
      // Coerce booleans / numbers to strings for stable comparison
      // (JSON has only one number type, but signals come from diverse
      // sources — payload.{amount} may be a string OR a number).
      return v === c.value || String(v) === String(c.value);
    case "neq":
      return v !== c.value && String(v) !== String(c.value);
    case "contains": {
      if (typeof v === "string" && typeof c.value === "string") {
        return v.includes(c.value);
      }
      if (Array.isArray(v) && typeof c.value === "string") {
        return v.includes(c.value);
      }
      return false;
    }
    case "matches": {
      if (typeof v !== "string") return false;
      const re = compilePattern(c);
      return re ? re.test(v) : false;
    }
    case "startsWith": {
      const s = asString(v);
      return typeof c.value === "string" && s !== null && s.startsWith(c.value);
    }
    case "endsWith": {
      const s = asString(v);
      return typeof c.value === "string" && s !== null && s.endsWith(c.value);
    }
    case "gt":
    case "lt":
    case "gte":
    case "lte": {
      const lhs = asNumber(v);
      const rhs = asNumber(c.value);
      if (lhs === null || rhs === null) return false;
      if (c.op === "gt") return lhs > rhs;
      if (c.op === "lt") return lhs < rhs;
      if (c.op === "gte") return lhs >= rhs;
      return lhs <= rhs;
    }
    default:
      return false;
  }
}

/**
 * Evaluate one rule against one signal. Returns the matched `then` when
 * all conditions are satisfied (AND). Safe — no eval, no JS execution.
 */
export function evaluateRule(
  signal: Partial<LoopSignal>,
  rule: ClassifierRule,
): RuleEvaluation {
  if (!Array.isArray(rule.when) || rule.when.length === 0) {
    return { matched: false };
  }
  for (const c of rule.when) {
    if (!evaluateCondition(signal, c)) return { matched: false };
  }
  return {
    matched: true,
    // biome-ignore lint/suspicious/noThenProperty: `then` is the schema-defined action block key on ClassifierRule
    then: rule.then,
  };
}

/**
 * Find the first matching rule for a signal. Deterministic — rules are
 * tested in insertion order; the first match wins. The watcher calls
 * this after each agentic tick to back-fill `type` / `actionKind` /
 * `confidence` overrides for any decision whose `source_signal` matches
 * a rule.
 */
export function findMatchingRule(
  signal: Partial<LoopSignal>,
  rules: ClassifierRule[],
): ClassifierRule | null {
  for (const r of rules) {
    if (evaluateRule(signal, r).matched) return r;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a candidate classifier rule (without `createdAt`). Pure — no
 * I/O, no cache mutation. Returns the input stamped with `createdAt`
 * when valid, or a `RuleValidationError` on the first failure.
 */
export function validateClassifierRule(
  input: {
    id: string;
    label?: string;
    when?: RuleCondition[];
    then?: Partial<RuleAction>;
    description?: string;
  },
  options: { now?: string; knownCustomTypeIds?: string[] } = {},
): ClassifierRuleValidationResult {
  if (typeof input.id !== "string" || !RULE_ID_RE.test(input.id)) {
    return {
      ok: false,
      error:
        "id must be snake_case, 2-41 chars, start with a letter (e.g. force_birthday)",
    };
  }
  // Rule ids share the DecisionType namespace — same collision rule as
  // custom types so the prompt's classifier list is unambiguous.
  if (BUILTIN_DECISION_TYPES.has(input.id)) {
    return {
      ok: false,
      error: `id collides with built-in decision type: ${input.id}`,
    };
  }
  if (
    input.label !== undefined &&
    (typeof input.label !== "string" ||
      input.label.length < 1 ||
      input.label.length > 60)
  ) {
    return { ok: false, error: "label must be 1-60 characters" };
  }
  if (!Array.isArray(input.when) || input.when.length === 0) {
    return {
      ok: false,
      error: "when must be a non-empty array of conditions",
    };
  }
  // Cap the rule size — protects the prompt from pathological expansions.
  if (input.when.length > 8) {
    return { ok: false, error: "when may have at most 8 conditions" };
  }
  for (let i = 0; i < input.when.length; i++) {
    const c = input.when[i];
    if (!c || typeof c !== "object") {
      return { ok: false, error: `when[${i}] must be an object` };
    }
    if (typeof c.field !== "string" || c.field.length === 0) {
      return {
        ok: false,
        error: `when[${i}].field must be a non-empty string`,
      };
    }
    if (!RULE_OPS.includes(c.op)) {
      return {
        ok: false,
        error: `when[${i}].op must be one of: ${RULE_OPS.join(", ")}`,
      };
    }
    // exists/absent don't need a value (they check field presence).
    // matches reads from `pattern` instead of `value` so the value check
    // is skipped there too — but we still validate `pattern` below.
    if (c.op !== "exists" && c.op !== "absent" && c.op !== "matches") {
      if (
        c.value === undefined ||
        c.value === null ||
        typeof c.value === "object"
      ) {
        return {
          ok: false,
          error: `when[${i}].value must be a string, number, or boolean`,
        };
      }
    }
    if (c.op === "matches" && typeof c.pattern === "string") {
      try {
        new RegExp(c.pattern);
      } catch (e) {
        return {
          ok: false,
          error: `when[${i}].pattern is not a valid RegExp: ${
            e instanceof Error ? e.message : String(e)
          }`,
        };
      }
    }
  }
  if (!input.then || typeof input.then !== "object") {
    return { ok: false, error: "then must be an object" };
  }
  const t = input.then;
  if (typeof t.type !== "string" || t.type.length === 0) {
    return { ok: false, error: "then.type is required" };
  }
  // Then.type may be: built-in DecisionType, registered custom id, or "noop".
  if (
    t.type !== "noop" &&
    !BUILTIN_DECISION_TYPES.has(t.type) &&
    !(options.knownCustomTypeIds ?? []).includes(t.type)
  ) {
    return {
      ok: false,
      error: `then.type must be a built-in decision type, a registered custom type, or "noop"`,
    };
  }
  if (
    t.actionKind !== undefined &&
    (typeof t.actionKind !== "string" || t.actionKind.length === 0)
  ) {
    return { ok: false, error: "then.actionKind must be a non-empty string" };
  }
  if (t.confidence !== undefined) {
    if (
      typeof t.confidence !== "number" ||
      !Number.isFinite(t.confidence) ||
      t.confidence < 0 ||
      t.confidence > 1
    ) {
      return {
        ok: false,
        error: "then.confidence must be a number between 0 and 1",
      };
    }
  }
  if (
    input.description !== undefined &&
    (typeof input.description !== "string" || input.description.length > 280)
  ) {
    return {
      ok: false,
      error: "description must be a string up to 280 chars",
    };
  }
  const rule: ClassifierRule = {
    id: input.id,
    when: input.when,
    // biome-ignore lint/suspicious/noThenProperty: `then` is the schema-defined action block key on ClassifierRule
    then: {
      type: t.type,
      ...(t.actionKind !== undefined ? { actionKind: t.actionKind } : {}),
      ...(t.confidence !== undefined ? { confidence: t.confidence } : {}),
    },
    createdAt: options.now ?? nowIso(),
    ...(input.label ? { label: input.label } : {}),
    ...(input.description ? { description: input.description } : {}),
  };
  return { ok: true, rule };
}

// ---------------------------------------------------------------------------
// Public CRUD surface — mirrors customTypes
// ---------------------------------------------------------------------------

export const classifierRules = {
  /** All rules, in insertion order. */
  list(): ClassifierRule[] {
    return [...readFile().rules];
  },
  /** O(1) membership check. */
  has(id: string): boolean {
    return readFile().ids.includes(id);
  },
  /** Get a single rule by id. */
  get(id: string): ClassifierRule | null {
    return readFile().rules.find((r) => r.id === id) ?? null;
  },
  /**
   * Idempotent upsert. If the existing rule is materially identical,
   * the row is returned unchanged; otherwise the new row replaces it
   * (keeping `createdAt` of the original).
   */
  upsert(rule: ClassifierRule): {
    ok: true;
    rule: ClassifierRule;
    created: boolean;
  } {
    const cur = readFile();
    const idx = cur.rules.findIndex((r) => r.id === rule.id);
    if (idx >= 0) {
      const existing = cur.rules[idx];
      const sameThen =
        existing.then.type === rule.then.type &&
        (existing.then.actionKind ?? "") === (rule.then.actionKind ?? "") &&
        (existing.then.confidence ?? -1) === (rule.then.confidence ?? -1);
      const sameWhen =
        JSON.stringify(existing.when) === JSON.stringify(rule.when);
      const sameMeta =
        (existing.label ?? "") === (rule.label ?? "") &&
        (existing.description ?? "") === (rule.description ?? "");
      if (sameThen && sameWhen && sameMeta) {
        return { ok: true, rule: existing, created: false };
      }
      const next = cur.rules.slice();
      next[idx] = rule;
      writeFile({ version: 1, rules: next, ids: next.map((r) => r.id) });
      return { ok: true, rule, created: false };
    }
    const next = [...cur.rules, rule];
    writeFile({ version: 1, rules: next, ids: next.map((r) => r.id) });
    return { ok: true, rule, created: true };
  },
  /** Remove by id. Returns true when something was deleted. */
  remove(id: string): boolean {
    const cur = readFile();
    const next = cur.rules.filter((r) => r.id !== id);
    if (next.length === cur.rules.length) return false;
    writeFile({ version: 1, rules: next, ids: next.map((r) => r.id) });
    return true;
  },
  /** Drop the in-memory cache — call after external file edits / tests. */
  invalidate(): void {
    cache = null;
  },
};
