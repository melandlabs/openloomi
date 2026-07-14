/**
 * Custom decision types — per-user extension to the closed `DecisionType`
 * union. The schema is intentionally narrow: users register a label,
 * icon, and a `BuiltInActionKind` that the existing runner already
 * knows how to execute. The classifier (and the agentic tick) read the
 * registered list and add new ids to its candidate set without changing
 * the union itself.
 *
 * Persistence: a single JSON file at `~/.openloomi/loop/custom-types.json`.
 * Mirrors the `mutes` module in `store.ts` — module-level cache +
 * `invalidate()`, atomic writes via `writeJsonAtomic`, ids re-derived
 * from `types` on every write as defence in depth.
 *
 * Scope: per-user (no workspace sharing). The skill catalogue in
 * `skills/openloomi-loop/SKILL.md` documents the HTTP API.
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { ensureDirs, LOOP_PATHS } from "./paths";

/**
 * Closed union of `ActionKind` literals that the runner knows how to
 * execute today. Custom types must map to one of these — the `string`
 * open form in `ActionKind` is reserved for agent-emitted kinds, not
 * user-registered ones, so the runner can keep its switch total.
 */
export const BUILTIN_ACTION_KINDS = [
  "calendar_rsvp",
  "email_reply",
  "slack_reply",
  "github_review",
  "deadline_notify",
  "todo",
  "linear_review",
  "requirement_synthesis",
  "release_plan",
  "contact_update",
  "doc_update",
  "brief",
  "wrap",
  "quiet_digest",
] as const;

export type BuiltInActionKind = (typeof BUILTIN_ACTION_KINDS)[number];

/**
 * Closed set of `DecisionType` literals currently defined in `types.ts`.
 * Custom ids must NOT collide with these — the union is closed by design
 * (UI dispatch tables, classifier switches, pet surfaces all assume the
 * known ids). Surfaced as a `Set` for cheap lookup in the validator.
 */
export const BUILTIN_DECISION_TYPES: ReadonlySet<string> = new Set([
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
]);

/** snake_case, 2-41 chars, starts with a letter. Mirrors `DecisionType`. */
export const CUSTOM_TYPE_ID_RE = /^[a-z][a-z0-9_]{1,40}$/;

/** Remix-icon class name — e.g. `ri-cake-2-line`. */
export const REMIX_ICON_RE = /^ri-[a-z0-9-]+$/;

export interface CustomDecisionType {
  /** snake_case, 2-41 chars, must not collide with `BUILTIN_DECISION_TYPES`. */
  id: string;
  /** 1-40 char human label rendered on cards. */
  label: string;
  /** Remix icon class; empty string → render fallback (ri-question-line). */
  icon: string;
  /** Optional description for tooltips and the prompt injection. */
  description?: string;
  /** Must be one of `BUILTIN_ACTION_KINDS`. */
  actionKind: BuiltInActionKind;
  /** ISO timestamp. */
  createdAt: string;
}

export interface CustomTypesFile {
  version: 1;
  types: CustomDecisionType[];
  /** Recomputed from `types` on every write. */
  ids: string[];
}

/** Validation error message — surfaced verbatim by the API layer. */
export interface CustomTypeValidationError {
  ok: false;
  error: string;
}

export interface CustomTypeValidationOk {
  ok: true;
  type: CustomDecisionType;
}

export type CustomTypeValidationResult =
  | CustomTypeValidationOk
  | CustomTypeValidationError;

// ---------------------------------------------------------------------------
// Small utils (mirror store.ts:42-61 / store.ts:371-394)
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
    // Fallback for filesystems where rename-over-existing fails (rare on
    // POSIX; the mutes module does the same).
    writeFileSync(p, JSON.stringify(obj, null, 2));
  }
}

function emptyFile(): CustomTypesFile {
  return { version: 1, types: [], ids: [] };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a candidate `CustomDecisionType` (without `createdAt`). Returns
 * the same shape stamped with `createdAt` when valid, or a `CustomTypeValidationError`
 * on the first failure. Pure — no I/O, no cache mutation.
 *
 * `actionKind` is taken as a plain `string` so the validator can return
 * the proper "must be one of: …" error on unknown literals — the union
 * type would be a lie at the API boundary (the request body is untyped).
 */
export function validateCustomType(
  input: Omit<Partial<CustomDecisionType>, "actionKind"> & {
    id: string;
    label: string;
    actionKind: string;
  },
  options: { now?: string } = {},
): CustomTypeValidationResult {
  if (typeof input.id !== "string" || !CUSTOM_TYPE_ID_RE.test(input.id)) {
    return {
      ok: false,
      error:
        "id must be snake_case, 2-41 chars, start with a letter (e.g. birthday_wish)",
    };
  }
  if (BUILTIN_DECISION_TYPES.has(input.id)) {
    return {
      ok: false,
      error: `id collides with built-in decision type: ${input.id}`,
    };
  }
  if (
    typeof input.label !== "string" ||
    input.label.length < 1 ||
    input.label.length > 40
  ) {
    return {
      ok: false,
      error: "label must be 1-40 characters",
    };
  }
  if (
    typeof input.icon !== "string" ||
    (input.icon.length > 0 && !REMIX_ICON_RE.test(input.icon))
  ) {
    return {
      ok: false,
      error:
        "icon must be a valid remix-icon class (e.g. ri-cake-2-line) or empty",
    };
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
  if (
    typeof input.actionKind !== "string" ||
    !BUILTIN_ACTION_KINDS.includes(input.actionKind as BuiltInActionKind)
  ) {
    return {
      ok: false,
      error: `actionKind must be one of: ${BUILTIN_ACTION_KINDS.join(", ")}`,
    };
  }
  const out: CustomDecisionType = {
    id: input.id,
    label: input.label,
    icon: input.icon,
    actionKind: input.actionKind as BuiltInActionKind,
    createdAt: options.now ?? nowIso(),
    ...(input.description ? { description: input.description } : {}),
  };
  return { ok: true, type: out };
}

// ---------------------------------------------------------------------------
// Module-level cache + atomic persistence
// ---------------------------------------------------------------------------

let cache: CustomTypesFile | null = null;

function readFile(): CustomTypesFile {
  if (cache) return cache;
  ensureDirs();
  const raw = readJson<CustomTypesFile>(LOOP_PATHS.customTypes, emptyFile());
  // Defensive: any drift between `types` and `ids` is repaired on read.
  const types = Array.isArray(raw.types) ? raw.types : [];
  const ids = Array.from(new Set(types.map((t) => t.id)));
  cache = { version: 1, types, ids };
  return cache;
}

function writeFile(file: CustomTypesFile): void {
  // Always re-derive `ids` from `types` before writing — defence in depth
  // so a future mutation that forgets to update `ids` cannot desync the
  // file. Mirrors `mutes.writeMutes` in store.ts:387-394.
  const ids = Array.from(new Set(file.types.map((t) => t.id)));
  const out: CustomTypesFile = { version: 1, types: file.types, ids };
  writeJsonAtomic(LOOP_PATHS.customTypes, out);
  cache = out;
}

export const customTypes = {
  /** All custom types, in insertion order. */
  list(): CustomDecisionType[] {
    return [...readFile().types];
  },
  /** O(1) membership check. */
  has(id: string): boolean {
    return readFile().ids.includes(id);
  },
  /** Get a single type by id; returns null when absent. */
  get(id: string): CustomDecisionType | null {
    return readFile().types.find((t) => t.id === id) ?? null;
  },
  /**
   * Idempotent upsert. Same id returns the existing row with a fresh
   * `createdAt` only if the input is materially different; otherwise the
   * existing row is returned unchanged. Pure I/O — the API layer
   * validates first and only calls this with a typed input.
   */
  upsert(type: CustomDecisionType): {
    ok: true;
    type: CustomDecisionType;
    created: boolean;
  } {
    const cur = readFile();
    const existingIdx = cur.types.findIndex((t) => t.id === type.id);
    if (existingIdx >= 0) {
      const existing = cur.types[existingIdx];
      const same =
        existing.label === type.label &&
        existing.icon === type.icon &&
        existing.actionKind === type.actionKind &&
        (existing.description ?? "") === (type.description ?? "");
      if (same) {
        return { ok: true, type: existing, created: false };
      }
      const next = cur.types.slice();
      next[existingIdx] = type;
      writeFile({ version: 1, types: next, ids: next.map((t) => t.id) });
      return { ok: true, type, created: false };
    }
    const next = [...cur.types, type];
    writeFile({ version: 1, types: next, ids: next.map((t) => t.id) });
    return { ok: true, type, created: true };
  },
  /** Remove by id. Returns true when something was deleted. */
  remove(id: string): boolean {
    const cur = readFile();
    const next = cur.types.filter((t) => t.id !== id);
    if (next.length === cur.types.length) return false;
    writeFile({ version: 1, types: next, ids: next.map((t) => t.id) });
    return true;
  },
  /** Drop the in-memory cache — call after external file edits / tests. */
  invalidate(): void {
    cache = null;
  },
};
