/**
 * Composio CLI direct probe — fast-path for `/api/loop/connectors`.
 *
 * The agentic path in `composio-bridge.ts` dispatches a 100+ line prompt to
 * `/api/native/agent` and waits 60–120s (up to 10 min on cold first probe)
 * for the LLM to enumerate the user's Composio connections. For a pure
 * read-only "is gmail connected?" question, that's pure waste — the
 * `composio` CLI can answer it in ~200ms with two `execFile` calls.
 *
 * This module implements that fast-path:
 *
 *   1. `composio whoami` — verifies the CLI is on `$PATH` AND that the
 *      user's API key is valid. Cheap (~50ms). Distinguishes "CLI missing"
 *      (ENOENT) from "CLI installed but auth broken" (non-zero exit /
 *      stderr containing "not logged in" / "auth").
 *   2. `composio connections list` — returns the per-toolkit JSON the
 *      bridge needs to build `ConnectorEntry[]`. Shape is
 *      `{ "<toolkit_slug>": [{ status, alias, word_id, permission_group }] }`,
 *      already grouped by toolkit. Normalize slugs (CLI returns
 *      `googlecalendar`, the Loop uses `google_calendar`) and emit one
 *      entry per toolkit with the parsed `accounts[]`. Does NOT require
 *      `composio dev init` — it's a top-level command that talks to the
 *      cloud, so the fast-path works from any cwd.
 *
 * Any failure here (CLI missing, auth broken, JSON malformed, unknown
 * slug, network timeout) returns a structured `ProbeOutcome` failure kind
 * so `probeConnectorState` can fall through to the agentic path without
 * losing diagnostic context. The agentic path is ALWAYS the fallback of
 * last resort — when the CLI can answer, we never spin up an agent
 * runtime.
 *
 * CLI contract (pinned against `composio 0.2.32`):
 *   - `whoami` → exits 0 with a one-line JSON `{account_type, email, ...}`
 *   - `connections list` → JSON object keyed by toolkit slug, each value
 *     an array of `{ status, alias, word_id, permission_group }`. `status`
 *     is `"ACTIVE"` for healthy connections, `"EXPIRED"` / `"FAILED"` /
 *     etc. for unusable ones. No `id` / `toolkit_slug` / `user_id` fields
 *     — `word_id` is the canonical identifier per account.
 */

import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { writeConnectorSnapshot } from "./connectors";
import { log } from "./store";
import type { ConnectorAccount, ConnectorEntry } from "./types";

const execFileAsync = promisify(execFile);

/**
 * Per-call timeout for a single `composio` invocation. The CLI's own
 * startup + a `whoami` round-trip rarely exceeds 5s; `connections list`
 * adds a network round-trip. 15s is a comfortable ceiling that still
 * leaves room for a slow first call after install (cold auth cache,
 * network jitter).
 */
const CLI_CALL_TIMEOUT_MS = 15 * 1000;

/**
 * What `composio whoami` returns on success — a single line of JSON.
 * `account_type` is `"human"` for a logged-in user (the agentic prompt's
 * "skill" surface is keyed on this). We don't act on any other field.
 */
interface WhoamiResult {
  account_type?: string;
  email?: string;
  current_org_name?: string;
}

/**
 * Shape of one entry from `composio connections list`. Pinned against
 * `composio 0.2.32` — fields beyond this set may appear in newer CLI
 * versions and are ignored. Note: no `id` / `toolkit_slug` / `user_id`
 * in this version; `word_id` is the per-account identifier.
 */
interface ConnectedAccountRaw {
  status?: string;
  alias?: string | null;
  word_id?: string;
  permission_group?: string | null;
}

/**
 * Slug normalization: the `composio` CLI's `toolkit_slug` field doesn't
 * always match the Loop's internal connector ids. Today there's exactly
 * one mismatch we know about (`googlecalendar` vs `google_calendar`),
 * but this map is the right place to add more as they surface. Unknown
 * slugs are passed through unchanged so we don't silently drop data the
 * UI might already know how to render.
 */
const SLUG_TO_LOOP_ID: Record<string, string> = {
  googlecalendar: "google_calendar",
  // Add more as discovered. Don't remove entries without a sweep across
  // the connector UI / readiness surface — silently renaming an id
  // would orphan a `LoopMonitoredToolkit` flag on the persisted cache.
};

/**
 * Loop's canonical 6-entry catalog (#361) — see `composio-bridge.ts`.
 * Re-stated here so the CLI probe can backfill any toolkit the CLI
 * didn't report (zero matches for that toolkit → `connected: false`),
 * mirroring the agentic probe's "preserve catalog length" contract.
 */
const DEFAULT_TOOLKITS: Array<{
  id: string;
  label: string;
  localOnly?: boolean;
  localOnlyMessage?: string;
}> = [
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
 * Outcome of a CLI-direct probe. Mirrors `ProbeOutcome` in
 * `composio-bridge.ts` — kept structurally similar so the agentic
 * fallback can treat a CLI `kind === "ok"` exactly the same as an
 * agentic one. The new failure kinds (`cli_not_found`,
 * `cli_unauthorized`, `cli_no_dev_project`, `cli_malformed`) are
 * surfaced as `lastProbeError` diagnostics by the cache layer so the
 * UI can tell the user "CLI missing — falling back to agent" instead
 * of just "no sources connected".
 */
export type CliProbeOutcome =
  | { kind: "ok"; entries: ConnectorEntry[]; surfaces: string[] }
  | { kind: "cli_not_found"; error: string }
  | { kind: "cli_unauthorized"; error: string }
  | { kind: "cli_no_dev_project"; error: string }
  | { kind: "cli_malformed"; diagnostic: string }
  | { kind: "cli_timeout"; durationMs: number };

/**
 * Run a single `composio` CLI invocation. Catches `ENOENT` and other
 * spawn-level failures and returns a structured error so callers can
 * render a `cli_not_found` outcome instead of throwing.
 *
 * `execImpl` is a test seam — production passes the real
 * `promisify(execFile)`. Tests pass a stub returning `{stdout, stderr}`
 * synchronously (the same shape `callComposioTool` uses in `watcher.ts`)
 * so we don't have to fight `util.promisify`'s callback arity against
 * `vi.fn()` mocks.
 */
interface ExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Finder/launchd does not inherit shell PATH additions, while the Composio
 * installer places the CLI at `~/.composio/composio`. Prefer that documented
 * user install location when it is executable, then retain the existing
 * PATH lookup as the fallback for every other installation layout.
 */
function resolveComposioExecutable(env: NodeJS.ProcessEnv): string {
  const home = env.HOME || env.USERPROFILE || homedir();
  const userInstall = join(home, ".composio", "composio");
  try {
    accessSync(userInstall, constants.X_OK);
    return userInstall;
  } catch {
    return "composio";
  }
}

async function runCli(
  executable: string,
  args: string[],
  execImpl: (
    cmd: string,
    args: string[],
    opts: unknown,
  ) => Promise<ExecResult> = execFileAsync as unknown as (
    cmd: string,
    args: string[],
    opts: unknown,
  ) => Promise<ExecResult>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true; result: ExecResult } | { ok: false; error: string }> {
  try {
    const result = await execImpl(executable, args, {
      timeout: CLI_CALL_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      // `whoami` and `connections list` both print JSON to stdout.
      // Don't ask for human-readable output — we want the raw shape so
      // the parser can stay stable across CLI versions.
      env: { ...env, NO_COLOR: "1" },
    });
    return { ok: true, result };
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException & {
      stderr?: string;
      stdout?: string;
      killed?: boolean;
      signal?: string;
    };
    // ENOENT = the resolved executable couldn't be spawned. Surface it
    // distinctly so the agentic fallback isn't blamed for the gap.
    if (err?.code === "ENOENT") {
      return {
        ok: false,
        error: "composio CLI not found at ~/.composio/composio or on $PATH",
      };
    }
    // Spawn-level timeout — the CLI didn't return within
    // `CLI_CALL_TIMEOUT_MS`. The agentic fallback will retry.
    if (err?.killed || err?.signal === "SIGTERM") {
      return {
        ok: false,
        error: `composio CLI timed out after ${CLI_CALL_TIMEOUT_MS}ms`,
      };
    }
    // All other failures carry the CLI's own stderr — bubble it up
    // so the diagnostic stays actionable.
    const text =
      `${err?.stderr ?? ""}\n${err?.stdout ?? ""}\n${err?.message ?? ""}`.trim();
    return { ok: false, error: text || "composio CLI failed" };
  }
}

/**
 * `composio whoami` — verifies CLI + key. On non-zero exit, decide
 * between `cli_unauthorized` (auth broken) and `cli_malformed`
 * (something else went wrong, e.g. unexpected JSON shape).
 */
async function probeWhoami(
  executable: string,
  execImpl?: (
    cmd: string,
    args: string[],
    opts: unknown,
  ) => Promise<ExecResult>,
  env?: NodeJS.ProcessEnv,
): Promise<
  { ok: true; whoami: WhoamiResult } | { ok: false; outcome: CliProbeOutcome }
> {
  const r = await runCli(executable, ["whoami"], execImpl, env);
  if (!r.ok) {
    return {
      ok: false,
      outcome: { kind: "cli_not_found", error: r.error },
    };
  }
  const stdout = r.result.stdout.trim();
  // `whoami` exits non-zero on auth failure; success is a single JSON
  // object. We don't have access to the exit code via execFile's
  // resolved promise, so we infer "not logged in" from the stderr
  // shape (CLI prints "Not logged in" / "login required").
  if (!stdout) {
    const stderr = r.result.stderr.trim();
    if (/not logged in|login required|unauthor/i.test(stderr)) {
      return {
        ok: false,
        outcome: { kind: "cli_unauthorized", error: stderr },
      };
    }
    return {
      ok: false,
      outcome: {
        kind: "cli_malformed",
        diagnostic: `whoami returned empty stdout; stderr=${stderr.slice(0, 200)}`,
      },
    };
  }
  let parsed: WhoamiResult;
  try {
    parsed = JSON.parse(stdout) as WhoamiResult;
  } catch {
    return {
      ok: false,
      outcome: {
        kind: "cli_malformed",
        diagnostic: `whoami stdout not JSON: ${stdout.slice(0, 200)}`,
      },
    };
  }
  // `account_type === "human"` is the only "logged in" shape we care
  // about; `"agent"` accounts don't have user-owned connected accounts.
  if (parsed.account_type !== "human") {
    return {
      ok: false,
      outcome: {
        kind: "cli_unauthorized",
        error: `whoami account_type=${parsed.account_type ?? "unknown"}`,
      },
    };
  }
  return { ok: true, whoami: parsed };
}

/**
 * `composio connections list`. Returns the raw `{ toolkit: accounts[] }`
 * map on success, or a structured failure when the JSON can't be parsed
 * or has the wrong shape. Top-level command — works from any cwd, no
 * `dev init` required.
 */
async function probeConnectedAccounts(
  executable: string,
  execImpl?: (
    cmd: string,
    args: string[],
    opts: unknown,
  ) => Promise<ExecResult>,
  env?: NodeJS.ProcessEnv,
): Promise<
  | { ok: true; accounts: Record<string, ConnectedAccountRaw[]> }
  | { ok: false; outcome: CliProbeOutcome }
> {
  const r = await runCli(executable, ["connections", "list"], execImpl, env);
  if (!r.ok) {
    return {
      ok: false,
      outcome: {
        kind: "cli_malformed",
        diagnostic: `connections list failed: ${r.error}`,
      },
    };
  }
  const stdout = r.result.stdout.trim();
  const stderr = r.result.stderr.trim();
  if (!stdout) {
    return {
      ok: false,
      outcome: {
        kind: "cli_malformed",
        diagnostic: `connections list returned empty stdout; stderr=${stderr.slice(0, 200)}`,
      },
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return {
      ok: false,
      outcome: {
        kind: "cli_malformed",
        diagnostic: `connections list stdout not JSON: ${stdout.slice(0, 200)}`,
      },
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      outcome: {
        kind: "cli_malformed",
        diagnostic: `connections list not a JSON object: ${typeof parsed}`,
      },
    };
  }
  return {
    ok: true,
    accounts: parsed as Record<string, ConnectedAccountRaw[]>,
  };
}

/**
 * Reduce the raw account list into a per-toolkit `ConnectorEntry[]`,
 * mirroring `composio-bridge.ts::probeConnectorState`'s output shape.
 * Catalog length is preserved via backfill — every toolkit the Loop
 * tracks gets a row, connected or not.
 */
function buildEntries(
  raw: Record<string, ConnectedAccountRaw[]>,
  toolkits: typeof DEFAULT_TOOLKITS,
): ConnectorEntry[] {
  // `connections list` returns `{ "<toolkit_slug>": accounts[] }` —
  // already grouped by toolkit. Bucket under the normalized id
  // (CLI returns `googlecalendar`, Loop uses `google_calendar`).
  // Unknown slugs are bucketed under their raw slug so the data isn't
  // silently dropped (the UI may already render them via custom
  // channels).
  const buckets = new Map<string, ConnectorAccount[]>();
  const slugFor = (slug: string) => SLUG_TO_LOOP_ID[slug] ?? slug;
  for (const [slug, accounts] of Object.entries(raw)) {
    if (!Array.isArray(accounts)) continue;
    const id = slugFor(slug);
    if (!buckets.has(id)) buckets.set(id, []);
    for (const r of accounts) {
      // `word_id` is the canonical identifier per account in this CLI
      // version (no `id` field). Skip rows without one — they're
      // structurally broken and have no stable handle.
      if (!r.word_id || typeof r.word_id !== "string") continue;
      // `connections list` returns EVERY account the user has ever
      // linked — EXPIRED / FAILED / etc. included — and the CLI
      // doesn't expose a `--status` filter for this subcommand
      // (compare to the old `dev connected-accounts list --status
      // ACTIVE` which filtered server-side). The Loop only cares
      // about ACTIVE accounts, so we drop the rest here. The
      // `connected` flag below is still derived from whether any
      // ACTIVE row exists, so a toolkit with 15 EXPIRED + 1 ACTIVE
      // shows as "1 account, connected" — not "16 accounts, of which
      // 15 are dead".
      if (r.status !== "ACTIVE") continue;
      const acc: ConnectorAccount = {
        id: r.word_id,
        // `alias` is the user's optional label for the account; fall
        // back to `word_id` (e.g. `gmail_curve-feared`) so the UI
        // always has *something* to render. Never includes secrets.
        label:
          (typeof r.alias === "string" && r.alias) || r.word_id || undefined,
        healthy: true,
      };
      buckets.get(id)?.push(acc);
    }
  }

  const stamp = new Date().toISOString();
  const out: ConnectorEntry[] = [];
  for (const t of toolkits) {
    const accounts = buckets.get(t.id);
    if (t.localOnly) {
      // Mirror the agentic probe's contract — local-only toolkits
      // never come from the CLI; report them as offline with the
      // sentinel `lastError`.
      out.push({
        id: t.id,
        label: t.label,
        connected: false,
        accountCount: 0,
        lastError: t.localOnlyMessage ?? "local-only",
        probed: true,
        fetchedAt: stamp,
      });
      continue;
    }
    if (accounts && accounts.length > 0) {
      out.push({
        id: t.id,
        label: t.label,
        connected: true,
        accountCount: accounts.length,
        accounts,
        probed: true,
        fetchedAt: stamp,
      });
    } else {
      out.push({
        id: t.id,
        label: t.label,
        connected: false,
        accountCount: 0,
        lastError: "not connected",
        probed: true,
        fetchedAt: stamp,
      });
    }
  }
  return out;
}

/**
 * Probe the active Composio connections via the user's local `composio`
 * CLI. On any failure returns a structured outcome; on success persists
 * the snapshot via `writeConnectorSnapshot` and returns `kind: "ok"`.
 *
 * The two-step pipeline (`whoami` → `connections list`) is
 * deliberately short-circuited: if `whoami` fails we don't bother with
 * the list call — both depend on a working CLI + auth.
 *
 * Callers (`probeConnectorState` in `composio-bridge.ts`) should treat
 * every non-`ok` outcome as a fallback signal: "CLI couldn't answer,
 * hand off to the agentic path."
 */
export async function probeViaCli(
  opts: {
    toolkits?: typeof DEFAULT_TOOLKITS;
    execImpl?: (
      cmd: string,
      args: string[],
      opts: unknown,
    ) => Promise<ExecResult>;
    /** Environment used for CLI discovery/execution; exposed for regression tests. */
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<CliProbeOutcome> {
  const toolkits = opts.toolkits ?? DEFAULT_TOOLKITS;
  const env = opts.env ?? process.env;
  const executable = resolveComposioExecutable(env);
  const t0 = Date.now();
  log("composio-cli: probing via local composio CLI");

  // Step 1 — verify CLI + auth. If this fails, the list call is
  // guaranteed to fail too, so we surface immediately. We deliberately
  // do NOT call `writeProbeError` here: `probeConnectorState` is going
  // to fall through to the agentic path, which either succeeds
  // (rewriting the cache via `writeConnectorSnapshot` and dropping any
  // stale diagnostic) or fails (writing its own agentic-kind
  // `lastProbeError`). A CLI diagnostic would only ever be visible if
  // the agentic path *also* failed AND for some reason didn't write
  // its own — which the agentic path is contractually obligated not to
  // do. So the CLI diagnostic is dead weight; the caller's
  // `probeConnectorState` gets the full picture and decides what to
  // persist.
  const whoami = await probeWhoami(executable, opts.execImpl, env);
  if (!whoami.ok) {
    log(`composio-cli: whoami outcome=${whoami.outcome.kind}`);
    return whoami.outcome;
  }

  // Step 2 — fetch the active account list. Failure here means CLI is
  // installed and auth works, but we can't enumerate accounts (most
  // commonly the JSON shape changed). Same persistence rationale as
  // above — caller decides.
  const list = await probeConnectedAccounts(executable, opts.execImpl, env);
  if (!list.ok) {
    log(`composio-cli: list outcome=${list.outcome.kind}`);
    return list.outcome;
  }

  const entries = buildEntries(list.accounts, toolkits);
  // Total active accounts across all toolkits — used in the log line so
  // operators can sanity-check the snapshot size at a glance.
  const totalAccounts = Object.values(list.accounts).reduce(
    (n, arr) => n + (Array.isArray(arr) ? arr.length : 0),
    0,
  );
  try {
    writeConnectorSnapshot(entries);
    log(
      `composio-cli: ok — persisted ${entries.length} connector entries (${totalAccounts} active account(s)) in ${Date.now() - t0}ms`,
    );
  } catch (e) {
    // Persistence is best-effort — return the entries anyway so the
    // caller can surface them in-memory and the next refresh retries.
    log(
      `composio-cli: snapshot persistence failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
  return {
    kind: "ok",
    entries,
    surfaces: ["cli"],
  };
}
