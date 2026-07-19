/**
 * Composio bridge — thin wrapper that turns "ask the agent to probe
 * Composio connection state" into a single async function.
 *
 * The Loop is fully agentic: the agent at `/api/native/agent` is the
 * only component that talks to Composio (via the `composio` skill and
 * `composio` CLI). This module does NOT call Composio's REST API
 * directly — doing so would require a parallel `COMPOSIO_API_KEY` and
 * duplicate the agent's discovery work.
 *
 * The bridge exists so non-tick callers (the dev panel's "check
 * connections" button, the `?refresh=1` route param) can ask for a
 * fresh connector snapshot without going through a full tick (which
 * also pulls signals, enriches, classifies, etc.). It does this by
 * posting a small "probe only" prompt to the same `/api/native/agent`
 * endpoint the tick uses; the agent runs the same §1 of the tick
 * prompt (discover which Composio surfaces are reachable), returns
 * the `connectors` block in its `result` event, and we persist +
 * return it.
 *
 * The result is shape-compatible with `ConnectorEntry[]` from
 * `types.ts`; persistence is the same `writeConnectorSnapshot` the
 * tick uses, so the cache stays single-source.
 */

import { invokeAgentPrompt } from "./runner";
import { writeConnectorSnapshot, writeProbeError } from "./connectors";
import { log } from "./store";
import type { ConnectorAccount, ConnectorEntry } from "./types";

/**
 * Structured result of a connector probe (#391).
 *
 * The old contract collapsed every failure — transport error, empty SSE
 * response, malformed JSON, agent HTTP error — into an opaque `null`, so
 * the cache got no diagnostic and the UI could only render "No sources
 * connected" whether the user genuinely had nothing connected or the
 * probe itself was broken. This tagged union preserves the failure mode
 * so `refreshConnectors` can persist a `lastProbeError` and the API /
 * card can surface an actionable hint. Mirrors the `LoopDecisionExecution`
 * tagged-union precedent in `outcomes.ts`.
 */
export type ProbeOutcome =
  | { kind: "ok"; entries: ConnectorEntry[]; surfaces: string[] }
  | { kind: "transport_error"; error: string }
  | { kind: "agent_http_error"; status?: number; error: string }
  | { kind: "empty_response" }
  | { kind: "malformed_response"; diagnostic: string }
  | { kind: "timeout"; durationMs: number };

interface ProbeConnectorPromptOptions {
  /**
   * The toolkits to ask the agent to probe. Defaults to the canonical
   * 6-entry set: gmail / google_calendar / github / slack / linear /
   * obsidian. Obsidian is reported as `connected: false` with a
   * `local-only` lastError — Chronicle owns its watch state and
   * there's no Composio adapter for it.
   */
  toolkits?: Array<{
    id: string;
    label: string;
    /** When true, skip the Composio probe and report `connected: false`. */
    localOnly?: boolean;
    /** Optional lastError string for the local-only branch. */
    localOnlyMessage?: string;
  }>;
}

const DEFAULT_TOOLKITS: NonNullable<ProbeConnectorPromptOptions["toolkits"]> = [
  { id: "gmail", label: "Gmail" },
  { id: "google_calendar", label: "Google Calendar" },
  { id: "github", label: "GitHub" },
  { id: "slack", label: "Slack" },
  { id: "linear", label: "Linear" },
  {
    id: "obsidian",
    label: "Obsidian",
    localOnly: true,
    localOnlyMessage: "local-only",
  },
];

/**
 * Build the small prompt that asks the agent to probe the configured
 * toolkits via whatever Composio surfaces are reachable in the current
 * session (composio CLI / composio skill / openloomi-memory insights).
 * The prompt is intentionally narrow — no signal pull, no classify, no
 * decision persist. The expected output is a single `result` event whose
 * `content` is a JSON `connectors` block matching `ConnectorEntry[]`.
 *
 * IMPORTANT: the prompt requires the agent to **work through every
 * surface, even after an earlier one errors**. The original wording
 * "try in parallel" let the agent give up after the first failure
 * (e.g. the \`composio\` skill errored with an internal exception),
 * which produced a false "no composio surface reachable" snapshot even
 * when \`Bash(composio connections list)\` would have worked fine. The
 * procedure below makes the agent's responsibility explicit: the only
 * acceptable reason to report \`surfaces_used: []\` is that ALL THREE
 * surfaces were attempted and ALL THREE failed.
 */
function buildProbePrompt(
  toolkits: NonNullable<ProbeConnectorPromptOptions["toolkits"]>,
): string {
  const catalog = toolkits
    .map((t) => {
      if (t.localOnly) {
        return `  - ${t.id} (${t.label}): local-only — do NOT probe. Report \`{ id: "${t.id}", label: "${t.label}", connected: false, accountCount: 0, accounts: [], lastError: "${t.localOnlyMessage ?? "local-only"}" }\`.`;
      }
      return `  - ${t.id} (${t.label}): use the active Composio surface. Enumerate EVERY active connected account for this toolkit (issue #360 — a toolkit can have more than one). If at least one is active, report \`{ id: "${t.id}", label: "${t.label}", connected: true, accountCount: <int>, accounts: [{ id: "<connected_account_id>", label: "<email-or-handle-or-null>", healthy: true }, …] }\` with one \`accounts\` entry per active account and \`accountCount === accounts.length\`. If none, report \`{ id: "${t.id}", label: "${t.label}", connected: false, accountCount: 0, accounts: [], lastError: "not connected" }\`.`;
    })
    .join("\n");

  return `You are running a **connector probe** for the openloomi Loop. Your job is to inspect active Composio surfaces, identify which of the toolkits below have at least one healthy connected account, and emit a single structured \`result\` event. NO signal pull, NO classify, NO decision persist — just the connector snapshot.

# Available Composio surfaces — work through ALL of them before giving up

You MUST attempt every surface below, **in order**, even if an earlier surface errors. A non-zero exit, a "command not found", an exception from the skill runtime, or a malformed response from any one surface is NEVER sufficient reason to declare the probe done. Only after steps 1, 2, and 3 have all failed may you fall through to step 4.

  1. **CLI reachable?** — Run \`Bash(composio whoami)\`. This is the cheapest sanity check; if it succeeds, the CLI is on \`$PATH\` and the user's API key is valid. Record this surface as \`"cli"\` in \`surfaces_used\`.

  2. **CLI connections snapshot** — Run \`Bash(composio connections list)\` (and, for a per-account breakdown, \`Bash(composio manage connected-accounts list --status ACTIVE)\`). It returns JSON of the form \`{ "<toolkit>": [{ "status": "ACTIVE", "word_id": "...", ... }, ...] }\`. Treat entries with \`status === "ACTIVE"\` as healthy connections; everything else as disconnected. Combine this result into the per-toolkit \`connected\` / \`accountCount\` / \`accounts\` / \`lastError\` fields. Each ACTIVE account becomes one \`accounts\` entry with its non-secret \`{ id, label }\` (id = \`connected_account_id\` / \`word_id\`; label = the account email / handle when present). NEVER include tokens or secrets.

  3. **\`composio\` skill** — Run \`Skill composio connections list\`. Independent of the CLI; in sandboxed shells (or when \`composio\` is not on \`$PATH\`) this may be the only surface that returns data. If step 1 or 2 already succeeded, still run this step — its result can confirm or contradict the CLI.

  4. **No surface reachable** — ONLY reach this step when steps 1, 2, and 3 ALL failed. Report \`surfaces_used: []\` and set every non-local-only entry to \`connected: false\` with \`lastError: "no composio surface reachable"\`.

If multiple surfaces return data, merge them: a toolkit with at least one ACTIVE / healthy report from ANY surface counts as \`connected: true\` with that surface's \`accountCount\` and merged \`accounts\` (dedupe accounts by \`id\`). A later surface's failure does not invalidate an earlier surface's success.

# Toolkits to probe

${catalog}

# Output

Emit exactly one SSE \`result\` event with this content:

\`\`\`json
{
  "scanned": 0,
  "surfaced": 0,
  "muted": 0,
  "errors": 0,
  "duration_ms": <int>,
  "surfaces_used": ["cli", "skill", "insights", "local-only"],
  "connectors": [
    { "id": "<toolkit-id>", "label": "<label>", "connected": <bool>, "accountCount": <int>, "accounts": [{ "id": "<connected_account_id>", "label": "<email-or-handle-or-null>", "healthy": true }], "lastError": "<optional: short string>" }
  ]
}
\`\`\`

The \`connectors\` array MUST contain one entry per toolkit in the catalog above, in the same order, with the \`id\` and \`label\` matching exactly. Do not omit any toolkit. \`accountCount\` MUST equal \`accounts.length\`, and every \`accounts\` entry carries only the non-secret \`{ id, label, healthy }\` — never tokens or credentials.

Do not pull signals, do not classify, do not write to \`~/.openloomi/loop/\` — the bridge persists the snapshot for you. Just emit the \`result\` event and stop.`;
}

interface ConnectorBlockShape {
  surfaces_used?: unknown;
  connectors?: Array<{
    id?: unknown;
    label?: unknown;
    connected?: unknown;
    accountCount?: unknown;
    accounts?: unknown;
    lastError?: unknown;
  }>;
}

/**
 * Extract a `{ connectors: [...] }` block from the agent's `result`
 * SSE event payload. `res.result` is whatever `evt.content` was on
 * the last `result` event; the agent may store it as a string (with
 * embedded JSON) or as a parsed object depending on the runtime.
 * Returns `null` if no usable block is found.
 */
function extractConnectorsFromResult(
  result: unknown,
): ConnectorBlockShape | null {
  if (!result) return null;
  // Direct object case — some runtimes pre-parse `evt.content`.
  if (typeof result === "object") {
    const obj = result as ConnectorBlockShape;
    if (Array.isArray(obj.connectors)) return obj;
    return null;
  }
  // Stringified JSON case — parse if it looks like a JSON object.
  if (typeof result === "string") {
    const trimmed = result.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
    try {
      const parsed = JSON.parse(trimmed) as ConnectorBlockShape;
      if (Array.isArray(parsed.connectors)) return parsed;
    } catch {
      /* fall through */
    }
  }
  return null;
}

/**
 * Mine the agent's text output for a `connectors` array. This is the
 * fallback path for short probes where the agent prints the JSON in
 * its text rather than emitting a structured `result` event. We try
 * three patterns, in order of reliability:
 *
 *   1. **` ```json ... ``` ` block** — markdown-wrapped, easiest to
 *      extract cleanly. Pick the LAST one (the agent typically
 *      appends the final summary last).
 *   2. **Inline `{ "connectors": [...] }` JSON object** — the agent
 *      often prints the raw JSON without wrapping. Find every `{`
 *      that opens a candidate object, walk the braces to its matching
 *      `}`, parse, and keep the last one whose `connectors` field is
 *      an array.
 *   3. **Anything else** — give up.
 *
 * Returns `null` if no matching block is found.
 */
function extractConnectorsFromText(text: string): ConnectorBlockShape | null {
  if (!text) return null;

  // 1. ```json ... ``` block, take the LAST one.
  const codeBlockRe = /```json\s*([\s\S]*?)```/g;
  let lastJson: string | null = null;
  for (const match of text.matchAll(codeBlockRe)) {
    lastJson = match[1];
  }
  if (lastJson) {
    const parsed = tryParseJsonObject(lastJson);
    if (parsed) return parsed;
  }

  // 2. Bare inline JSON object containing "connectors". We scan the
  // text for every "{" that could start an object, brace-match to its
  // closing "}", and try to parse. This is robust to agents that
  // print raw JSON without a markdown wrapper.
  const obj = extractLastConnectorsObject(text);
  if (obj) return obj;

  return null;
}

/** Try to parse `s` as a JSON object that has a `connectors` array. */
function tryParseJsonObject(s: string): ConnectorBlockShape | null {
  const trimmed = s.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as ConnectorBlockShape;
    if (Array.isArray(parsed.connectors)) return parsed;
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Walk `text` left-to-right; for every `{` we find, brace-match to
 * its closing `}`, and if the resulting substring parses as a JSON
 * object with a `connectors` array, keep it. Returns the LAST such
 * match — agents typically write the final structured payload last.
 */
function extractLastConnectorsObject(text: string): ConnectorBlockShape | null {
  let last: ConnectorBlockShape | null = null;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    // Skip if this `{` is inside a string literal at the top level —
    // we do a quick scan forward, treating `\"` as escaped.
    const end = findMatchingBrace(text, i);
    if (end < 0) continue;
    const candidate = text.slice(i, end + 1);
    const parsed = tryParseJsonObject(candidate);
    if (parsed) last = parsed;
    i = end; // skip past this object
  }
  return last;
}

/**
 * Given an index pointing at `{` in `text`, find the index of its
 * matching `}` (string-aware: braces inside JSON strings don't count).
 * Returns -1 if no match is found before end-of-string.
 */
function findMatchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let isEscaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (c === "\\") {
        isEscaped = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Fourth extraction pass (#391): walk `res.events` for any event whose
 * `content` (already-parsed object or stringified JSON) carries a
 * `connectors` array. Covers agents that wrap the snapshot inside a
 * `tool_call` / `tool_result` event instead of the final `result` event.
 * Returns the LAST usable block found (agents emit the final payload
 * last), or `null` when no event contains one.
 */
function extractConnectorsFromEvents(
  events: unknown[] | undefined,
): ConnectorBlockShape | null {
  if (!Array.isArray(events)) return null;
  let last: ConnectorBlockShape | null = null;
  for (const evt of events) {
    if (!evt || typeof evt !== "object") continue;
    const content = (evt as { content?: unknown }).content;
    if (!content) continue;
    if (typeof content === "object") {
      const obj = content as ConnectorBlockShape;
      if (Array.isArray(obj.connectors)) last = obj;
      continue;
    }
    if (typeof content === "string") {
      const parsed = tryParseJsonObject(content);
      if (parsed) last = parsed;
    }
  }
  return last;
}

/** Read `surfaces_used` from a parsed block as a clean `string[]`. */
function readSurfaces(block: ConnectorBlockShape): string[] {
  if (!Array.isArray(block.surfaces_used)) return [];
  return block.surfaces_used.filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
}

/**
 * Parse the agent's per-account `accounts` array into a clean,
 * non-secret `ConnectorAccount[]`. Tolerant of missing / malformed shapes:
 * anything without a usable `id` is skipped, and only the whitelisted
 * `{ id, label, healthy, lastError }` fields survive — no token or credential
 * field the agent may have accidentally included is copied through.
 * Returns `undefined` when there is nothing usable so the entry stays sparse.
 */
function parseAccounts(raw: unknown): ConnectorAccount[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ConnectorAccount[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = rec.id ?? rec.connected_account_id ?? rec.word_id;
    if (typeof id !== "string" || !id.trim() || seen.has(id)) continue;
    seen.add(id);
    const account: ConnectorAccount = { id };
    if (typeof rec.label === "string" && rec.label.trim()) {
      account.label = rec.label;
    } else if (typeof rec.email === "string" && rec.email.trim()) {
      account.label = rec.email;
    }
    if (typeof rec.healthy === "boolean") account.healthy = rec.healthy;
    if (typeof rec.lastError === "string" && rec.lastError) {
      account.lastError = rec.lastError;
    }
    out.push(account);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Probe the configured toolkits by asking the agent to inspect the
 * active Composio surface, then persist + return the result.
 *
 * Returns a structured {@link ProbeOutcome} (#391) instead of the old
 * opaque `null`: `{ kind: "ok" }` on success, or one of the failure
 * kinds (`transport_error` / `agent_http_error` / `empty_response` /
 * `malformed_response`) so the caller can persist a `lastProbeError`
 * and the UI can render an actionable hint rather than a false "no
 * sources connected" empty state. On any failure this also stamps the
 * cache's `lastProbeError` via `writeProbeError` so the next API read
 * can surface the reason alongside the (possibly stale) entries.
 *
 * Callers that only want the old `ConnectorEntry[] | null` contract can
 * use {@link probeConnectorStateEntries}.
 */
export async function probeConnectorState(
  opts: ProbeConnectorPromptOptions = {},
): Promise<ProbeOutcome> {
  const toolkits = opts.toolkits ?? DEFAULT_TOOLKITS;
  const prompt = buildProbePrompt(toolkits);

  log(
    `composio-bridge: dispatching connector probe prompt (${prompt.length} chars)`,
  );
  let res: Awaited<ReturnType<typeof invokeAgentPrompt>>;
  try {
    res = await invokeAgentPrompt(prompt, {
      // Generous timeout — a probe runs the agent's composio surface
      // discovery (CLI `whoami` + `connections list` → skill → insights)
      // and pings 5 toolkits. Cold skill loads, OAuth token refresh, and
      // per-toolkit network round-trips each add latency; in real
      // environments we've seen the tail of this distribution land
      // around 60–90s, and a particularly cold first probe (just-
      // installed user, no cached composio surface, all 5 toolkits to
      // enumerate) can stretch well past 2 minutes. 10 minutes gives a
      // comfortable buffer without leaving a hung request alive forever
      // and matches `PROBE_TIMEOUT_MS` in `connectors.ts` so the
      // `silent` race and the underlying SSE timeout align — the lower
      // of the two will hit first, which keeps the contract predictable.
      // The full tick uses 15m because it does much more work (signal
      // pull + enrich + classify + persist); the probe is intentionally
      // shorter than that.
      //
      // This is the *full* probe timeout (used by `refreshConnectors()`
      // without `silent`). The card-open path uses a 10 min `silent`
      // ceiling + 30s cooldown to bound the worst case, but a fire-and-
      // forget probe triggered by saving the AI key (PUT
      // /api/preferences/ai) uses this larger budget so a cold install
      // can actually land.
      timeoutMs: 10 * 60 * 1000,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`composio-bridge: probe outcome=transport_error: ${msg}`);
    writeProbeError("transport_error", msg);
    return { kind: "transport_error", error: msg };
  }

  if (!res.ok) {
    const msg = res.error ?? `HTTP ${res.status ?? "?"}`;
    log(
      `composio-bridge: probe outcome=agent_http_error status=${res.status ?? "?"}: ${msg}`,
    );
    writeProbeError(
      "agent_http_error",
      res.status ? `HTTP ${res.status}: ${msg}` : msg,
    );
    return { kind: "agent_http_error", status: res.status, error: msg };
  }

  // The agent has THREE ways to return the snapshot; the prompt asks
  // for the structured `result` event path. In practice we see all of
  // them, so we try each in order of reliability:
  //
  //   - **Preferred**: a `result` SSE event with `content` set to the
  //     JSON object — `runner.ts` reads `evt.content` into `res.result`.
  //   - **Text fallback**: the agent prints the JSON in its text output.
  //     We grep the text tail for a ```json ... ``` block and parse it.
  //   - **Event fallback** (#391): the agent wrapped the snapshot inside
  //     a `tool_call` / `tool_result` event rather than the final
  //     `result`. Walk `res.events` for any event whose `content`
  //     carries a `connectors` array.
  const fromResult = extractConnectorsFromResult(res.result);
  let raw: ConnectorBlockShape | null = fromResult;
  let path = "result";
  if (!raw) {
    raw = extractConnectorsFromText(res.text ?? "");
    if (raw) path = "text-mining";
  }
  if (!raw) {
    raw = extractConnectorsFromEvents(res.events);
    if (raw) path = "event-walk";
  }

  if (!raw || !Array.isArray(raw.connectors) || raw.connectors.length === 0) {
    // Distinguish the two failure shapes (#391):
    //   - `empty_response`: the agent produced NO usable output at all
    //     (no result, no text, no reasoning) — the exact bug in #391
    //     where the native Codex runtime returns a hollow envelope.
    //   - `malformed_response`: the agent DID produce output, but no
    //     extraction pass found a parseable `connectors` array.
    const text = res.text ?? "";
    const reasoning = res.reasoning ?? "";
    const eventCount = Array.isArray(res.events) ? res.events.length : 0;
    const hasOutput =
      text.trim().length > 0 ||
      reasoning.trim().length > 0 ||
      res.result != null ||
      eventCount > 0;
    if (!hasOutput) {
      log(
        `composio-bridge: probe outcome=empty_response — no result/text/reasoning/events`,
      );
      writeProbeError(
        "empty_response",
        "agent returned no output (empty result / text / reasoning / events)",
      );
      return { kind: "empty_response" };
    }
    const diagnostic = `events=${eventCount} text-head="${text.slice(0, 200)}"`;
    log(`composio-bridge: probe outcome=malformed_response — ${diagnostic}`);
    writeProbeError("malformed_response", diagnostic);
    return { kind: "malformed_response", diagnostic };
  }

  log(
    `composio-bridge: probe outcome=ok — extracted ${raw.connectors.length} connectors (path=${path})`,
  );

  const stamp = new Date().toISOString();
  const entries: ConnectorEntry[] = raw.connectors.map((c) => {
    const id = String(c.id ?? "unknown");
    const accounts = parseAccounts(c.accounts);
    // Prefer the enumerated account list as the source of truth for the
    // count (#360) — an agent that reports `accountCount: 1` but lists two
    // accounts was wrong about the count, not the accounts. Fall back to the
    // reported scalar when no account list came back.
    const accountCount = accounts
      ? accounts.length
      : Number(c.accountCount ?? 0);
    return {
      id,
      label: typeof c.label === "string" ? c.label : id,
      connected: Boolean(c.connected),
      accountCount,
      ...(accounts ? { accounts } : {}),
      ...(typeof c.lastError === "string" && c.lastError
        ? { lastError: c.lastError }
        : {}),
      // `probed: true` — this row came back from a real agent probe
      // (even if the agent reported the toolkit as disconnected), so
      // the UI should render a real "Reachable" / "Offline" pill, not
      // the "Pending first probe" sentinel.
      probed: true,
      fetchedAt: stamp,
    };
  });

  // Backfill any toolkit the agent forgot to report — guarantees the
  // returned array always matches the requested catalog length so the
  // UI's "5/6 connected" math doesn't lie when the agent's result was
  // truncated.
  const seen = new Set(entries.map((e) => e.id));
  for (const t of toolkits) {
    if (seen.has(t.id)) continue;
    entries.push({
      id: t.id,
      label: t.label,
      connected: false,
      accountCount: 0,
      lastError: t.localOnlyMessage ?? "agent did not report this toolkit",
      // `probed: true` — even the backfill came out of a probe attempt,
      // the agent just forgot to emit it. The UI shouldn't render
      // these as "Pending first probe" — they're "Offline (no agent
      // report)" which is a *known* state, not an unknown one.
      probed: true,
      fetchedAt: stamp,
    });
  }

  try {
    writeConnectorSnapshot(entries);
    log(
      `composio-bridge: persisted ${entries.length} connector snapshot entries`,
    );
  } catch (e) {
    log(
      `composio-bridge: failed to persist snapshot: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    // Still return the entries — the caller can use them in-memory
    // and the next tick will rewrite the cache.
  }

  const surfaces =
    readSurfaces(raw).length > 0
      ? readSurfaces(raw)
      : entries.filter((e) => e.connected).map((e) => e.id);
  return { kind: "ok", entries, surfaces };
}

/**
 * Backward-compatible thin wrapper (#391): returns the old
 * `ConnectorEntry[] | null` contract. Existing callers that only care
 * about "did we get entries or not" keep working unchanged — on a
 * `kind: "ok"` outcome we return the entries, on any failure kind we
 * return `null`. New callers that need the failure reason should call
 * {@link probeConnectorState} directly.
 */
export async function probeConnectorStateEntries(
  opts: ProbeConnectorPromptOptions = {},
): Promise<ConnectorEntry[] | null> {
  const outcome = await probeConnectorState(opts);
  return outcome.kind === "ok" ? outcome.entries : null;
}
