/**
 * AI / tech news digest — quiet-day filler (#316).
 *
 * On a quiet morning, ask the agent to surface the last 24 hours of
 * AI / tech news as 3 bullet headlines + 1-line summaries. Uses the
 * same native-agent endpoint the brief / wrap narratives use, with
 * web-search tool use via Composio. If the agent has no web search
 * available (or returns no result), this module degrades to `null`
 * and the caller falls back to "skip the card entirely".
 *
 * Output shape (rendered by `renderQuietDigest` in `loomi-card.html`):
 *   - `context.items[]` = array of `{ title, summary, url? }` bullets
 *   - `dialogue`        = the headline string
 *   - `nextStep`        = "Tap to read the 3 stories."
 *
 * No side effects: the agent must not send mail, post to Slack, etc.
 */

import { invokeAgentPrompt } from "../runner";
import type { LoopDecision } from "../types";
import type { QuietDayContext, QuietDayModule } from "../quiet-modules";

const DIGEST_TIMEOUT_MS = 90 * 1000; // 90s — shorter than narrative (web search only)

interface ParsedDigest {
  headline?: string;
  bullets?: Array<{ title?: string; summary?: string; url?: string }>;
  model?: string;
}

function parseDigestPayload(res: {
  ok: boolean;
  result?: unknown;
  text?: string;
  error?: string;
}): ParsedDigest | null {
  const fromObj = (obj: unknown): ParsedDigest | null => {
    if (!obj || typeof obj !== "object") return null;
    const o = obj as Record<string, unknown>;
    if (!Array.isArray(o.bullets)) return null;
    return {
      headline: typeof o.headline === "string" ? o.headline : undefined,
      bullets: o.bullets as ParsedDigest["bullets"],
      model: typeof o.model === "string" ? o.model : undefined,
    };
  };
  if (!res.ok) return null;
  const fromResult = fromObj(res.result);
  if (fromResult) return fromResult;
  const m = /```json\s*([\s\S]+?)```/.exec(res.text ?? "");
  if (m) {
    try {
      return fromObj(JSON.parse(m[1]));
    } catch {
      return null;
    }
  }
  return null;
}

const PROMPT = `You are filling in for an empty OpenLoomi Loop morning — the user has no pending items today, so we want a 3-bullet digest of "what's happening in AI / tech in the last 24h" to put on their card. You have web search — use it.

# Step 1 — search the web

Use web search (Composio's google_search / composio_search / exa_search — pick whichever your toolkit exposes) to find 3 distinct stories from the last 24 hours that an AI/tech-aware user would care about. Avoid press-release rewrites; prefer the actual news (a model release, a research breakthrough, a major outage, an open-source drop, etc.).

# Step 2 — emit the digest

Emit a single SSE \`result\` event whose \`content\` is a JSON object with this exact shape:

{
  "headline": string,        // ≤ 80 chars, no "Morning:" prefix
  "bullets": [               // exactly 3 items
    { "title": string, "summary": string, "url"?: string }
  ],
  "model"?: string
}

# Rules

- Exactly 3 bullets. If you can only find 2 good stories, return 2 — do NOT pad with weak ones.
- Each summary is 1 sentence, ≤ 140 chars, plain prose, no markdown, no emoji.
- Each title is ≤ 80 chars.
- url is optional but encouraged — include it when you have a real source.
- If you cannot emit a structured \`result\` event, fall back to a single \`\`\`json fenced block in your text reply with the same shape.
- If web search returns nothing useful, return \`bullets: []\` (empty array) — do NOT fabricate.
- No side effects. This is read-only summarization.`;

export const aiNewsDigest: QuietDayModule = {
  id: "ai-news-digest",
  label: "Last 24h in AI / tech",
  isAvailable: async () => {
    // The agent has web search via Composio in the standard setup; if
    // a particular environment is missing it, the prompt will return
    // empty bullets and we degrade to null below. Keep this as `true`
    // to avoid an extra round-trip — the prompt itself is the probe.
    return true;
  },
  async buildDecision(ctx: QuietDayContext): Promise<LoopDecision | null> {
    const res = await invokeAgentPrompt(PROMPT, {
      timeoutMs: DIGEST_TIMEOUT_MS,
    });
    const parsed = parseDigestPayload(res);
    const bullets = parsed?.bullets ?? [];
    if (bullets.length === 0) return null;

    const headline = (parsed?.headline ?? "Last 24h in AI / tech").slice(0, 80);
    const items = bullets.slice(0, 3).map((b) => ({
      title: String(b.title ?? "").slice(0, 80) || "Untitled",
      summary: String(b.summary ?? "").slice(0, 140),
      ...(typeof b.url === "string" && b.url ? { url: b.url } : {}),
    }));

    const now = new Date().toISOString();
    return {
      id: `quiet_${ctx.kind}_${now}`,
      ts: now,
      status: "pending",
      type: "quiet_digest",
      title: `${ctx.kind === "brief" ? "Morning" : "Evening"} digest · ${ctx.date}`,
      action: { kind: "quiet_digest", params: { module: "ai-news-digest" } },
      dialogue: headline,
      nextStep: `Tap to read the ${items.length} ${items.length === 1 ? "story" : "stories"}.`,
      context: {
        why: [
          `Quiet ${ctx.kind} on ${ctx.date}`,
          "Filler: 3 last-24h AI / tech headlines",
          ...(parsed?.model ? [`Agent model: ${parsed.model}`] : []),
        ],
        memory_refs: [],
        items,
      },
      confidence: 0.75,
    };
  },
};
