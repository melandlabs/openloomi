/**
 * Memory resurface — quiet-day filler (#316).
 *
 * On a quiet morning or evening, surface 2 insights from the user's own
 * memory that they haven't seen in a week. The agent uses
 * `openloomi-memory.cjs` (already a tool on $PATH inside the agent's
 * shell) to query the knowledge base / insights store. Output is plain
 * bullets — no web calls, no external APIs.
 *
 * Output shape (rendered by `renderQuietDigest` in `loomi-card.html`):
 *   - `context.items[]` = array of `{ title, summary, ref }` bullets
 *   - `dialogue`        = the headline string
 *   - `nextStep`        = "Tap to revisit what you decided."
 *
 * No side effects: the agent must not write to memory or send any
 * external messages — read-only resurface.
 */

import { invokeAgentPrompt } from "../runner";
import type { LoopDecision } from "../types";
import type { QuietDayContext, QuietDayModule } from "../quiet-modules";

const RESURFACE_TIMEOUT_MS = 60 * 1000;

interface ParsedResurface {
  headline?: string;
  bullets?: Array<{ title?: string; summary?: string; ref?: string }>;
  model?: string;
}

function parseResurfacePayload(res: {
  ok: boolean;
  result?: unknown;
  text?: string;
  error?: string;
}): ParsedResurface | null {
  const fromObj = (obj: unknown): ParsedResurface | null => {
    if (!obj || typeof obj !== "object") return null;
    const o = obj as Record<string, unknown>;
    if (!Array.isArray(o.bullets)) return null;
    return {
      headline: typeof o.headline === "string" ? o.headline : undefined,
      bullets: o.bullets as ParsedResurface["bullets"],
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

const PROMPT = `You are filling in for an empty OpenLoomi Loop card — the user has nothing actionable today, so we want to put 2 of their own past insights on the card as a "remember this?" nudge. You have tool use — use the Bash tool to query the user's memory.

# Step 1 — query memory

Run these two queries IN PARALLEL using the Bash tool (use \`timeout 8\` to cap each):

  # 1. Insights from the last 30 days, ranked by recency.
  node \$OPENLOOMI_MEMORY_DIR/scripts/openloomi-memory.cjs list-insights --days=30 --limit=40

  # 2. Knowledge-base hits on broad themes — pick 2-3 short keywords that
  #    would surface evergreen decisions (e.g. "auth", "loomilib roadmap",
  #    "team rituals").
  node \$OPENLOOMI_MEMORY_DIR/scripts/openloomi-memory.cjs search-knowledge "<theme>"

From those results, pick 2 insights that:
  - the user has NOT engaged with in the last 7 days (so this feels new, not stale), AND
  - are still relevant (not "yesterday's weather" — pick decisions / commitments / learnings that age well).

# Step 2 — emit the resurface

Emit a SINGLE SSE \`result\` event whose \`content\` is a JSON object with this exact shape:

{
  "headline": string,        // ≤ 80 chars; NOT "Morning:" / "Evening:"
  "bullets": [               // exactly 2 items
    { "title": string, "summary": string, "ref": string }
  ],
  "model"?: string
}

# Rules

- Exactly 2 bullets. If you can only find 1 good one, return 1 — do NOT pad.
- Each "title" is the insight's title or a 1-line topic (≤ 80 chars).
- Each "summary" is 1 sentence (≤ 140 chars, plain prose, no markdown) recapping the decision / commitment.
- Each "ref" is a short path or identifier that points back to the source (e.g. "insights/auth_call.md" or "knowledge/loomilib/roadmap.md"). This lets the user click through to the original.
- If you can find nothing worth resurfacing, return \`bullets: []\` — do NOT fabricate.
- If you cannot emit a structured \`result\` event, fall back to a \`\`\`json fenced block.
- No side effects — read-only resurface. Do NOT write to memory, send mail, or post anywhere.`;

export const memoryResurface: QuietDayModule = {
  id: "memory-resurface",
  label: "2 insights from your memory",
  isAvailable: async () => {
    // Memory tools are always available inside the agent — the prompt
    // is the probe. Empty bullets → null.
    return true;
  },
  async buildDecision(ctx: QuietDayContext): Promise<LoopDecision | null> {
    const res = await invokeAgentPrompt(PROMPT, {
      timeoutMs: RESURFACE_TIMEOUT_MS,
    });
    const parsed = parseResurfacePayload(res);
    const bullets = parsed?.bullets ?? [];
    if (bullets.length === 0) return null;

    const headline = (parsed?.headline ?? "Worth a re-read").slice(0, 80);
    const items = bullets.slice(0, 2).map((b) => ({
      title: String(b.title ?? "Untitled insight").slice(0, 80),
      summary: String(b.summary ?? "").slice(0, 140),
      ref: String(b.ref ?? "").slice(0, 200),
    }));

    const now = new Date().toISOString();
    return {
      id: `quiet_${ctx.kind}_${now}`,
      ts: now,
      status: "pending",
      type: "quiet_digest",
      title: `${ctx.kind === "brief" ? "Morning" : "Evening"} digest · ${ctx.date}`,
      action: { kind: "quiet_digest", params: { module: "memory-resurface" } },
      dialogue: headline,
      nextStep: "Tap to revisit what you decided.",
      context: {
        why: [
          `Quiet ${ctx.kind} on ${ctx.date}`,
          `Filler: ${items.length} resurfaced insight${items.length === 1 ? "" : "s"}`,
          ...(parsed?.model ? [`Agent model: ${parsed.model}`] : []),
        ],
        memory_refs: items.map((i) => i.ref).filter((r) => r.length > 0),
        items,
      },
      confidence: 0.85,
    };
  },
};
