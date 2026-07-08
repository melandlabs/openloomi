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
import { writeConnectorSnapshot } from "./connectors";
import { log } from "./store";
import type { ConnectorEntry } from "./types";

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
 * session (composio skill / composio CLI / openloomi-memory insights —
 * co-equal, run concurrently). The prompt is intentionally narrow —
 * no signal pull, no classify, no decision persist. The expected
 * output is a single `result` event whose `content` is a JSON
 * `connectors` block matching `ConnectorEntry[]`.
 */
function buildProbePrompt(
  toolkits: NonNullable<ProbeConnectorPromptOptions["toolkits"]>,
): string {
  const catalog = toolkits
    .map((t) => {
      if (t.localOnly) {
        return `  - ${t.id} (${t.label}): local-only — do NOT probe. Report \`{ id: "${t.id}", label: "${t.label}", connected: false, accountCount: 0, lastError: "${t.localOnlyMessage ?? "local-only"}" }\`.`;
      }
      return `  - ${t.id} (${t.label}): use the active Composio surface. If active, report \`{ id: "${t.id}", label: "${t.label}", connected: true, accountCount: <int> }\`. If not, report \`{ id: "${t.id}", label: "${t.label}", connected: false, accountCount: 0, lastError: "not connected" }\`.`;
    })
    .join("\n");

  return `You are running a **connector probe** for the openloomi Loop. Your job is to inspect the active Composio surface, identify which of the toolkits below have at least one healthy connected account, and emit a single structured \`result\` event. NO signal pull, NO classify, NO decision persist — just the connector snapshot.

# Available Composio surfaces (try in parallel)

  1. **\`composio\` skill** — \`Skill composio connections list\`. The skill surface.
  2. **\`composio\` CLI** — \`Bash(composio connections list)\`. The CLI surface.
  3. **No surface reachable** — fall back to the insights surface and report \`connected: false\` for every entry that isn't a local-only toolkit (see catalog below).

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
  "surfaces_used": ["<skill|cli|insights|local-only>", ...],
  "connectors": [
    { "id": "<toolkit-id>", "label": "<label>", "connected": <bool>, "accountCount": <int>, "lastError": "<optional: short string>" }
  ]
}
\`\`\`

The \`connectors\` array MUST contain one entry per toolkit in the catalog above, in the same order, with the \`id\` and \`label\` matching exactly. Do not omit any toolkit. If the active Composio surface could not be reached at all, report \`surfaces_used: []\` and set every non-local-only connector to \`connected: false\` with \`lastError: "no composio surface reachable"\`.

Do not pull signals, do not classify, do not write to \`~/.openloomi/loop/\` — the bridge persists the snapshot for you. Just emit the \`result\` event and stop.`;
}

interface ConnectorBlockShape {
  connectors?: Array<{
    id?: unknown;
    label?: unknown;
    connected?: unknown;
    accountCount?: unknown;
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
 * Probe the configured toolkits by asking the agent to inspect the
 * active Composio surface, then persist + return the result. On any
 * failure (transport error, malformed result, timeout) return
 * `null` — the caller is expected to fall back to the cache.
 */
export async function probeConnectorState(
  opts: ProbeConnectorPromptOptions = {},
): Promise<ConnectorEntry[] | null> {
  const toolkits = opts.toolkits ?? DEFAULT_TOOLKITS;
  const prompt = buildProbePrompt(toolkits);

  log(
    `composio-bridge: dispatching connector probe prompt (${prompt.length} chars)`,
  );
  let res: Awaited<ReturnType<typeof invokeAgentPrompt>>;
  try {
    res = await invokeAgentPrompt(prompt, {
      // Generous timeout — a probe runs the agent's composio surface
      // discovery (skill / CLI / insights) and pings 5 toolkits. Cold
      // skill loads, OAuth token refresh, and per-toolkit network
      // round-trips each add latency; in real environments we've seen
      // the tail of this distribution land around 60–90s. 120s gives a
      // comfortable buffer without leaving a hung request alive forever.
      // The full tick uses 15m because it does much more work (signal
      // pull + enrich + classify + persist); the probe is intentionally
      // shorter than that.
      timeoutMs: 120 * 1000,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`composio-bridge: probe transport failed: ${msg}`);
    return null;
  }

  if (!res.ok) {
    log(
      `composio-bridge: probe returned error: ${res.error ?? `HTTP ${res.status ?? "?"}`}`,
    );
    return null;
  }

  // The agent has TWO ways to return the snapshot, and the prompt asks
  // for the structured `result` event path. In practice we see both:
  //
  //   - **Preferred**: a `result` SSE event with `content` set to the
  //     JSON object — the agent's runtime wraps the final structured
  //     payload this way. `runner.ts` reads `evt.content` into
  //     `res.result`.
  //
  //   - **Fallback**: the agent prints the JSON in its text output
  //     (because the prompt only said "emit the result event" and the
  //     short probe doesn't trigger the structured event reliably).
  //     We grep the text tail for a ```json ... ``` block and parse it.
  //
  // Try preferred first, fall back to text-mining. This makes the
  // bridge robust to either agent behavior.
  const fromResult = extractConnectorsFromResult(res.result);
  let raw: ConnectorBlockShape | null = fromResult;
  if (!raw) {
    raw = extractConnectorsFromText(res.text ?? "");
  }

  if (!raw || !Array.isArray(raw.connectors) || raw.connectors.length === 0) {
    // Both extraction paths failed — the agent didn't emit a `result`
    // event with the snapshot AND didn't print a parseable JSON block
    // in its text output. Log the tail of each so we can debug what
    // shape it actually produced.
    log(
      `composio-bridge: probe returned no connectors block — text-tail="${(res.text ?? "").slice(-300)}" reasoning-tail="${(res.reasoning ?? "").slice(-150)}"`,
    );
    return null;
  }

  log(
    `composio-bridge: extracted ${raw.connectors.length} connectors (path=${raw === fromResult ? "result" : "text-mining"})`,
  );

  const stamp = new Date().toISOString();
  const entries: ConnectorEntry[] = raw.connectors.map((c) => {
    const id = String(c.id ?? "unknown");
    return {
      id,
      label: typeof c.label === "string" ? c.label : id,
      connected: Boolean(c.connected),
      accountCount: Number(c.accountCount ?? 0),
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

  return entries;
}
