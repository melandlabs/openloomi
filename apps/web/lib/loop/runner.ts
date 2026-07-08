/**
 * Loop runner — execute a pending decision by POSTing to the main app's
 * native agent endpoint.
 *
 * POSTs to `/api/native/agent` with `{ prompt }` and parses the SSE
 * response. Reuses the same endpoint the locomo benchmark uses — full
 * agentic tool-use, memory writes, multi-round reasoning.
 *
 * The actual SSE parsing happens inside `/api/native/agent/route.ts`. From
 * the runner's perspective we just POST a prompt, wait for the result event
 * in the SSE stream, and return the final result. The decision is moved to
 * `done` (or stays `pending` on failure) and the result is attached.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { DEV_PORT, PROD_PORT } from "@openloomi/shared";

import { decisions, log } from "./store";
import type { LoopDecision } from "./types";

/**
 * Resolve the URL of the native agent endpoint.
 *
 * The Loop runs *inside* the Next.js process that also serves
 * `/api/native/agent` — so the agent is always on the same host:port as
 * the Next.js dev/release server itself. Port comes from `@openloomi/shared`
 * (`DEV_PORT` / `PROD_PORT`) so we stay in sync with the rest of the app.
 * `LOOP_NATIVE_AGENT_URL` stays as the escape hatch for split-host setups
 * (e.g. agent behind a reverse proxy on another machine).
 */
function resolveNativeAgentUrl(): string {
  if (process.env.LOOP_NATIVE_AGENT_URL) {
    return process.env.LOOP_NATIVE_AGENT_URL.replace(/\/+$/, "");
  }
  const port =
    process.env.PORT ||
    (process.env.NODE_ENV === "development" ? DEV_PORT : PROD_PORT);
  return `http://127.0.0.1:${port}/api/native/agent`;
}

function readToken(): string | null {
  try {
    const p = join(homedir(), ".openloomi", "token");
    if (!existsSync(p)) return null;
    const encoded = readFileSync(p, "utf8").trim();
    return Buffer.from(encoded, "base64").toString("utf8") || null;
  } catch {
    return null;
  }
}

interface NativeAgentResponse {
  ok: boolean;
  status?: number;
  text?: string;
  reasoning?: string;
  result?: unknown;
  events?: unknown[];
  error?: string;
}

export interface SseEvent {
  type?: string;
  content?: unknown;
}

export interface InvokeAgentOptions {
  timeoutMs?: number;
  onEvent?: (e: SseEvent) => void;
}

/**
 * Public agent-entry point used by the loop's tick. Resolves the
 * native-agent URL (env override → default) and POSTs the prompt as
 * `{ prompt }`. Returns the parsed SSE response — caller can read
 * `result` for a structured payload (when the agent emits a `result` event)
 * or fall back to `text` / `events` for streaming output.
 */
export async function invokeAgentPrompt(
  prompt: string,
  opts: InvokeAgentOptions = {},
): Promise<NativeAgentResponse> {
  const url = resolveNativeAgentUrl();
  return postNativeAgent(url, { prompt }, opts);
}

async function postNativeAgent(
  urlStr: string,
  body: Record<string, unknown>,
  opts: { timeoutMs?: number; onEvent?: (e: SseEvent) => void } = {},
): Promise<NativeAgentResponse> {
  const token = readToken();
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { ok: false, error: `bad url ${urlStr}` };
  }
  return new Promise((resolve) => {
    const req = fetch(parsed, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15 * 60 * 1000),
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          resolve({
            ok: false,
            status: res.status,
            error: text || `HTTP ${res.status}`,
          });
          return;
        }
        const reader = res.body?.getReader();
        if (!reader) {
          resolve({ ok: false, status: res.status, error: "no response body" });
          return;
        }
        const decoder = new TextDecoder();
        let buf = "";
        const textChunks: string[] = [];
        const reasoningChunks: string[] = [];
        let result: unknown = null;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl = buf.indexOf("\n");
          while (nl >= 0) {
            const line = buf.slice(0, nl).replace(/\r$/, "");
            buf = buf.slice(nl + 1);
            if (line.startsWith("data:")) {
              const payload = line.slice(5).trim();
              if (payload) {
                try {
                  const evt = JSON.parse(payload) as SseEvent;
                  opts.onEvent?.(evt);
                  if (evt.type === "text" && typeof evt.content === "string") {
                    textChunks.push(evt.content);
                  } else if (
                    evt.type === "reasoning" &&
                    typeof evt.content === "string"
                  ) {
                    reasoningChunks.push(evt.content);
                  } else if (evt.type === "result" && evt.content) {
                    result = evt.content;
                  }
                } catch {
                  /* skip malformed */
                }
              }
            }
            nl = buf.indexOf("\n");
          }
        }
        resolve({
          ok: true,
          status: res.status,
          text: textChunks.join(""),
          reasoning: reasoningChunks.join(""),
          result,
        });
      })
      .catch((err: Error) => resolve({ ok: false, error: err.message }));
  });
}

function buildPrompt(decision: LoopDecision, mode: "dry" | "run"): string {
  const verb = mode === "dry" ? "Simulate executing" : "Execute";
  const parts: string[] = [];
  parts.push(
    `${verb} this OpenLoomi Loop decision and produce a concrete, plain-text summary of what you did (or would do).`,
    "",
    "Decision:",
    JSON.stringify(
      {
        id: decision.id,
        type: decision.type,
        title: decision.title,
        action: decision.action,
        context: decision.context ?? null,
        signal: decision.source_signal ?? null,
      },
      null,
      2,
    ),
  );
  if (Array.isArray(decision.context?.why) && decision.context.why.length) {
    parts.push("", "Why:", ...decision.context.why.map((w) => `- ${w}`));
  }
  if (decision.action?.kind === "deadline_notify") {
    parts.push(
      "",
      'How to execute action.kind === "deadline_notify":',
      "- Default behavior: create a calendar event on the googlecalendar toolkit via composio",
      "  (skill: `Skill composio execute GOOGLECALENDAR_CREATE_EVENT on googlecalendar with {...}`",
      "   or CLI: `composio googlecalendar create_event --json {...}` — pick whichever is on $PATH).",
      '  Title: "Deadline: <params.message>". Start: `params.notifyAt`. End: `params.deadlineAt` (or all-day on `params.deadlineAt`\'s date).',
      '- If `params.channel === "slack"`, send a DM to the user instead via the slack toolkit',
      "  (skill: `Skill composio execute SLACK_SEND_MESSAGE on slack with {...}`",
      '   or CLI: `composio slack send_message --json {...}`) with text "<params.message> — due <params.deadlineAt>".',
      "- Emit a single SSE `result` event whose `content` describes what you did — the system will record `completed_at` and `result` automatically. Include the calendar event id (or `skipped: <reason>` if you could not execute) so the user has a trail.",
    );
  }
  if (mode === "dry") {
    parts.push(
      "",
      "Dry run — DO NOT make any external side effects (no sending emails, accepting invites, etc.). Just describe the plan and any drafts.",
    );
  }
  return parts.join("\n");
}

export interface RunOptions {
  dry?: boolean;
  onEvent?: (e: SseEvent) => void;
  timeoutMs?: number;
}

export interface RunResult {
  ok: boolean;
  status: "done" | "dismissed" | "pending";
  decision: LoopDecision | null;
  result?: unknown;
  error?: string;
}

/**
 * Execute (or dry-run) a decision.
 *  - dry=true  → agent returns a plan only; decision stays `pending`
 *  - dry=false → agent runs; on success the decision is moved to `done`,
 *                on failure it stays `pending` with an attached error
 */
export async function runDecision(
  id: string,
  opts: RunOptions = {},
): Promise<RunResult> {
  const dec = decisions.get(id);
  if (!dec)
    return { ok: false, status: "pending", decision: null, error: "not found" };
  if (dec.status !== "pending") {
    return {
      ok: false,
      status: dec.status,
      decision: dec,
      error: `not pending (${dec.status})`,
    };
  }

  const url = resolveNativeAgentUrl();
  const prompt = buildPrompt(dec, opts.dry ? "dry" : "run");
  log(`run ${dec.id} dry=${!!opts.dry}`);

  const res = await postNativeAgent(
    url,
    { prompt },
    { onEvent: opts.onEvent, timeoutMs: opts.timeoutMs },
  );
  if (!res.ok) {
    decisions.update(dec.id, {
      context: { ...(dec.context ?? {}), last_error: res.error },
    });
    log(`run ${dec.id} failed: ${res.error ?? "unknown"}`);
    return { ok: false, status: "pending", decision: dec, error: res.error };
  }

  if (opts.dry) {
    decisions.update(dec.id, {
      context: {
        ...(dec.context ?? {}),
        dry_run: res.text || JSON.stringify(res.result ?? null),
      },
    });
    return { ok: true, status: "pending", decision: dec, result: res.result };
  }

  const moved = decisions.moveTo(
    dec.id,
    "done",
    res.result ?? res.text ?? null,
  );
  log(`run ${dec.id} → done`);
  return { ok: true, status: "done", decision: moved, result: res.result };
}

export async function dismissDecision(
  id: string,
  reason?: string,
): Promise<RunResult> {
  const dec = decisions.get(id);
  if (!dec)
    return { ok: false, status: "pending", decision: null, error: "not found" };
  const moved = decisions.moveTo(dec.id, "dismissed", reason ?? null);
  log(`dismiss ${dec.id}${reason ? `: ${reason}` : ""}`);
  return { ok: true, status: "dismissed", decision: moved };
}

export async function promoteDecision(id: string): Promise<RunResult> {
  // Re-queue a dismissed decision. Used when a user changes their mind.
  const dec = decisions.get(id);
  if (!dec)
    return { ok: false, status: "pending", decision: null, error: "not found" };
  if (dec.status !== "dismissed") {
    return {
      ok: false,
      status: dec.status,
      decision: dec,
      error: "not dismissed",
    };
  }
  const next = decisions.update(dec.id, {
    status: "pending",
    completed_at: undefined,
  });
  // moveTo back to pending: easiest path is a direct write — update() doesn't
  // move buckets, so we re-issue moveTo from dismissed → pending.
  const moved = decisions.moveTo(dec.id, "pending");
  log(`promote ${dec.id} → pending`);
  return { ok: true, status: "pending", decision: moved ?? next };
}
