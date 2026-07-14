/**
 * Custom signal channels — per-user extension to the FALLBACK_CONNECTORS
 * list. Each entry is a Composio-backed puller: the loop watcher, on each
 * tick, walks the registered list, calls the named tool via the composio
 * bridge, and appends a `LoopSignal` per record.
 *
 * Persistence: a single JSON file at `~/.openloomi/loop/custom-channels.json`.
 * Mirrors `custom-types.ts` and the `mutes` module in `store.ts` —
 * module-level cache + `invalidate()`, atomic writes via
 * `writeJsonAtomic`, ids re-derived from `channels` on every write as
 * defence in depth.
 *
 * Scope: per-user. The skill catalogue in `skills/openloomi-loop/SKILL.md`
 * documents the HTTP API. Composio's own credentials / connection state
 * live in the user's composio account; the channel here is a thin
 * configuration on top.
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { ensureDirs, LOOP_PATHS } from "./paths";

/** snake_case, 2-41 chars, starts with a letter. */
export const CUSTOM_CHANNEL_ID_RE = /^[a-z][a-z0-9_]{1,40}$/;

/**
 * Composio toolkits and tool slugs are uppercase, dot-separated, and
 * use ASCII letters / digits / underscores. We are deliberately loose
 * (we can't enumerate Composio's 1000+ toolkits here) and let the
 * runtime fail fast if the slug is wrong — the user gets a clear error
 * from the composio bridge instead of a 400 that pretends to be clever.
 */
export const COMPOSIO_SLUG_RE = /^[A-Z][A-Z0-9_]*$/;

export const MIN_POLL_INTERVAL_SEC = 60;
export const DEFAULT_POLL_INTERVAL_SEC = 600;

export const FILTER_OPS = ["eq", "neq", "gt", "lt", "contains"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export interface ChannelEventFilter {
  /** Field path on the record returned by the tool (dot-separated). */
  field: string;
  /** Comparison operator. */
  op: FilterOp;
  /** Right-hand side of the comparison. String or number. */
  value: string | number;
}

export interface CustomChannel {
  /** snake_case, 2-41 chars. */
  id: string;
  /** 1-40 char human label. */
  label: string;
  /** Composio toolkit slug (e.g. "stripe", "github", "notion"). */
  toolkit: string;
  /** Composio tool slug to invoke (e.g. "STRIPE_LIST_CHARGES"). */
  toolSlug: string;
  /** Minimum poll interval in seconds. Default 600. */
  pollIntervalSec: number;
  /**
   * Value written to `LoopSignal.type` for each record the tool returns.
   * Convention: `<channel>_<event>` (e.g. "stripe_charge").
   */
  signalType: string;
  /**
   * Optional natural-language description of the payload shape — injected
   * into the tick prompt so the agent knows how to map records onto the
   * classifier. Keep short, e.g. `{id, amount, status, customer}`.
   */
  payloadShape?: string;
  /** Optional record-level filter — only matching records become signals. */
  eventFilter?: ChannelEventFilter[];
  /** ISO timestamp. */
  createdAt: string;
}

export interface CustomChannelsFile {
  version: 1;
  channels: CustomChannel[];
  /** Recomputed from `channels` on every write. */
  ids: string[];
}

export interface CustomChannelValidationError {
  ok: false;
  error: string;
}

export interface CustomChannelValidationOk {
  ok: true;
  channel: CustomChannel;
}

export type CustomChannelValidationResult =
  | CustomChannelValidationOk
  | CustomChannelValidationError;

// ---------------------------------------------------------------------------
// Small utils
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

function emptyFile(): CustomChannelsFile {
  return { version: 1, channels: [], ids: [] };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const SIGNAL_TYPE_RE = /^[a-z][a-z0-9_]{1,40}$/;

function isFilterOp(x: unknown): x is FilterOp {
  return typeof x === "string" && (FILTER_OPS as readonly string[]).includes(x);
}

export function validateCustomChannel(
  input: Partial<CustomChannel> & {
    id: string;
    label: string;
    toolkit: string;
    toolSlug: string;
    signalType: string;
  },
  options: { now?: string } = {},
): CustomChannelValidationResult {
  if (typeof input.id !== "string" || !CUSTOM_CHANNEL_ID_RE.test(input.id)) {
    return {
      ok: false,
      error:
        "id must be snake_case, 2-41 chars, start with a letter (e.g. stripe_charges)",
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
    typeof input.toolkit !== "string" ||
    !/^[a-z][a-z0-9_-]{1,40}$/.test(input.toolkit)
  ) {
    return {
      ok: false,
      error:
        "toolkit must be a lowercase Composio toolkit slug (e.g. stripe, github)",
    };
  }
  if (
    typeof input.toolSlug !== "string" ||
    !COMPOSIO_SLUG_RE.test(input.toolSlug)
  ) {
    return {
      ok: false,
      error:
        "toolSlug must be an UPPERCASE Composio tool slug (e.g. STRIPE_LIST_CHARGES)",
    };
  }
  if (
    typeof input.pollIntervalSec !== "number" ||
    !Number.isFinite(input.pollIntervalSec) ||
    input.pollIntervalSec < MIN_POLL_INTERVAL_SEC
  ) {
    return {
      ok: false,
      error: `pollIntervalSec must be a number >= ${MIN_POLL_INTERVAL_SEC}`,
    };
  }
  if (
    typeof input.signalType !== "string" ||
    !SIGNAL_TYPE_RE.test(input.signalType)
  ) {
    return {
      ok: false,
      error:
        "signalType must be snake_case, 2-41 chars, start with a letter (e.g. stripe_charge)",
    };
  }
  if (
    input.payloadShape !== undefined &&
    (typeof input.payloadShape !== "string" || input.payloadShape.length > 280)
  ) {
    return {
      ok: false,
      error: "payloadShape must be a string up to 280 chars",
    };
  }
  if (input.eventFilter !== undefined) {
    if (!Array.isArray(input.eventFilter)) {
      return { ok: false, error: "eventFilter must be an array" };
    }
    for (const f of input.eventFilter) {
      if (!f || typeof f !== "object") {
        return { ok: false, error: "eventFilter entries must be objects" };
      }
      if (typeof f.field !== "string" || f.field.length === 0) {
        return {
          ok: false,
          error: "eventFilter.field must be a non-empty string",
        };
      }
      if (!isFilterOp(f.op)) {
        return {
          ok: false,
          error: `eventFilter.op must be one of: ${FILTER_OPS.join(", ")}`,
        };
      }
      if (typeof f.value !== "string" && typeof f.value !== "number") {
        return {
          ok: false,
          error: "eventFilter.value must be a string or number",
        };
      }
    }
  }
  const out: CustomChannel = {
    id: input.id,
    label: input.label,
    toolkit: input.toolkit,
    toolSlug: input.toolSlug,
    pollIntervalSec: input.pollIntervalSec,
    signalType: input.signalType,
    createdAt: options.now ?? nowIso(),
    ...(input.payloadShape ? { payloadShape: input.payloadShape } : {}),
    ...(input.eventFilter ? { eventFilter: input.eventFilter } : {}),
  };
  return { ok: true, channel: out };
}

// ---------------------------------------------------------------------------
// Module-level cache + atomic persistence
// ---------------------------------------------------------------------------

let cache: CustomChannelsFile | null = null;

function readFile(): CustomChannelsFile {
  if (cache) return cache;
  ensureDirs();
  const raw = readJson<CustomChannelsFile>(
    LOOP_PATHS.customChannels,
    emptyFile(),
  );
  const channels = Array.isArray(raw.channels) ? raw.channels : [];
  const ids = Array.from(new Set(channels.map((c) => c.id)));
  cache = { version: 1, channels, ids };
  return cache;
}

function writeFile(file: CustomChannelsFile): void {
  const ids = Array.from(new Set(file.channels.map((c) => c.id)));
  const out: CustomChannelsFile = { version: 1, channels: file.channels, ids };
  writeJsonAtomic(LOOP_PATHS.customChannels, out);
  cache = out;
}

export const customChannels = {
  list(): CustomChannel[] {
    return [...readFile().channels];
  },
  has(id: string): boolean {
    return readFile().ids.includes(id);
  },
  get(id: string): CustomChannel | null {
    return readFile().channels.find((c) => c.id === id) ?? null;
  },
  upsert(channel: CustomChannel): {
    ok: true;
    channel: CustomChannel;
    created: boolean;
  } {
    const cur = readFile();
    const existingIdx = cur.channels.findIndex((c) => c.id === channel.id);
    if (existingIdx >= 0) {
      const existing = cur.channels[existingIdx];
      const same =
        existing.label === channel.label &&
        existing.toolkit === channel.toolkit &&
        existing.toolSlug === channel.toolSlug &&
        existing.pollIntervalSec === channel.pollIntervalSec &&
        existing.signalType === channel.signalType &&
        (existing.payloadShape ?? "") === (channel.payloadShape ?? "") &&
        JSON.stringify(existing.eventFilter ?? []) ===
          JSON.stringify(channel.eventFilter ?? []);
      if (same) {
        return { ok: true, channel: existing, created: false };
      }
      const next = cur.channels.slice();
      next[existingIdx] = channel;
      writeFile({ version: 1, channels: next, ids: next.map((c) => c.id) });
      return { ok: true, channel, created: false };
    }
    const next = [...cur.channels, channel];
    writeFile({ version: 1, channels: next, ids: next.map((c) => c.id) });
    return { ok: true, channel, created: true };
  },
  remove(id: string): boolean {
    const cur = readFile();
    const next = cur.channels.filter((c) => c.id !== id);
    if (next.length === cur.channels.length) return false;
    writeFile({ version: 1, channels: next, ids: next.map((c) => c.id) });
    return true;
  },
  invalidate(): void {
    cache = null;
  },
};
