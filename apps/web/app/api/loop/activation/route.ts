/**
 * GET  /api/loop/activation         → current ActivationState (cached on disk)
 * POST /api/loop/activation         → trigger an event
 *   { action: "first_check" | "mark_seen" | "refresh" }
 *
 * Issue #351 — shared, resumable activation state machine. This endpoint is
 * the single source of truth that every surface (Desktop web, Tauri pet,
 * Codex / Claude bridges) reads to know where the user is stuck on the road
 * to their first reviewed decision card. The state lives on disk at
 * `~/.openloomi/loop/activation_state.json` so a Tauri pet watcher polling
 * files can read it without an HTTP round-trip back into the Next.js server.
 *
 * `ready: true` (returned by the bridges' setup-status) still means
 * `coreReady` only — runtime up + AI provider configured + native CLI
 * logged in. Activation is a SEPARATE axis: even a "ready" install shows
 * nothing useful until the user connects a data source, runs a first
 * check, and reviews the first decision that surfaces.
 *
 * Auth model mirrors the AI preferences route: the Tauri pet / dev
 * shell may hit this without a session, in which case we still try
 * to derive `coreReady` from the native runtime probe so the pet's
 * first-load CTAs don't get stuck on a guest bootstrap window.
 * Authenticated web sessions additionally consult the user's saved
 * AI provider rows.
 */

import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getUserLlmApiSettings } from "@/lib/db/queries";
import { isTauriMode } from "@/lib/env/constants";
import { getConfiguredDefaultAgentProvider } from "@/lib/ai/native-agent/provider-env";
import { probeNativeClaudeRuntime } from "@/lib/ai/native-agent/runtime-probe";
import {
  computeActivationState,
  readActivationState,
  recordEvent as recordActivationEvent,
  type ActivationState,
  type ComputeActivationOptions,
} from "@/lib/loop/activation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * `coreReady` mirrors the bridge's `ready: true` derivation:
 *   - Authenticated session OR Tauri shell (the pet webview is a
 *     separate origin and shares no cookie jar with main webview).
 *   - The configured native runtime is ready — either a non-Claude
 *     provider (codex/opencode/hermes/openclaw) which carries its own
 *     auth, OR the user's local `claude` CLI is authenticated (probed
 *     via {@link probeNativeClaudeRuntime}).
 *   - Otherwise a user-saved `userLlmApiSettings` row counts as a
 *     manually configured provider.
 *
 * The previous env-var check was retired: it conflated "the OpenLoomi
 * process was launched with an Anthropic key in its env" with "the
 * user has a working AI provider", and forced the plugin to push
 * shell env into per-user settings to keep them in sync.
 */
async function resolveCoreReady(): Promise<boolean> {
  const session = await auth().catch(() => null);
  const hasSession = Boolean(session?.user?.id);
  if (!hasSession && !isTauriMode()) return false;

  const defaultAgent = getConfiguredDefaultAgentProvider();
  // Non-Claude providers (codex/opencode/hermes/openclaw) carry their
  // own auth — `coreReady` doesn't need an anthropic key for them.
  if (defaultAgent !== "claude") return true;

  // For the built-in Claude agent, the runtime's source of truth is the
  // user's local `claude auth status`. The probe result is cached for
  // ~30s by `probeNativeClaudeRuntime`, so this stays cheap across the
  // burst of consecutive requests the watcher fires.
  const native = await probeNativeClaudeRuntime();
  if (native?.authenticated) return true;

  if (!session?.user?.id) return false;
  try {
    const settings = await getUserLlmApiSettings(session.user.id);
    const hasConfiguredKey = settings.some((s) => {
      if (!s.enabled) return false;
      if (s.providerType !== "anthropic_compatible") return false;
      // The safe variant never exposes the key — but `enabled:true`
      // alone implies a key was previously saved. If the caller
      // needs to test the key itself they go through /api/preferences/ai.
      return Boolean(s.baseUrl) || Boolean(s.model);
    });
    return hasConfiguredKey;
  } catch {
    // Fail open — if the DB read errors we'd rather report
    // `coreReady: true` and let the user hit the AI provider
    // configuration step than lock them into "setup_pending"
    // because of a transient DB hiccup. The activation module
    // can always be re-derived later from `recordEvent("tick")`.
    return true;
  }
}

/**
 * Derive the same `baseUrl` shape the bridges use: the incoming
 * request's origin when present (so a UI deep-link renders a fully
 * qualified URL), otherwise null and let the activation module
 * default to a same-origin `/connectors` relative path.
 */
function resolveBaseUrl(req: NextRequest): string | null {
  try {
    const origin = req.nextUrl.origin;
    if (!origin || origin === "null") return null;
    // Tauri webview URLs include a custom protocol scheme; strip them
    // so we never echo a `tauri://localhost` literal back into the UI.
    if (origin.startsWith("tauri:")) return null;
    return origin;
  } catch {
    return null;
  }
}

async function loadActivationState(req: NextRequest): Promise<{
  state: ActivationState;
  persisted: boolean;
}> {
  const cached = readActivationState();
  if (cached) return { state: cached, persisted: true };

  const opts: ComputeActivationOptions = {
    coreReady: await resolveCoreReady(),
    baseUrl: resolveBaseUrl(req),
  };
  const state = computeActivationState(opts);
  return { state, persisted: false };
}

export async function GET(req: NextRequest) {
  try {
    const baseUrl = resolveBaseUrl(req);
    const coreReady = await resolveCoreReady();
    const cached = readActivationState();
    if (cached) {
      // Refresh the two live flags (`coreReady`, `dataSourceReady`)
      // against the request's current view of the world without
      // touching the sticky progress flags. Returning the freshest
      // shape is the whole point of GET — caching the response on
      // the client side would defeat it.
      const next = computeActivationState({
        coreReady,
        baseUrl,
        dataSourceReady: cached.dataSourceReady,
      });
      return NextResponse.json({ state: next });
    }

    // First call after install: derive from scratch and persist so
    // the Tauri watcher (which polls the on-disk file) sees a real
    // value without an HTTP round-trip.
    const fresh = computeActivationState({ coreReady, baseUrl });
    return NextResponse.json({ state: fresh });
  } catch (error) {
    return NextResponse.json(
      {
        error: "activation_load_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

interface ActivationPostBody {
  action?: unknown;
  decisionId?: unknown;
}

export async function POST(req: NextRequest) {
  let body: ActivationPostBody = {};
  try {
    body = (await req.json()) as ActivationPostBody;
  } catch {
    /* default to refresh */
  }

  const action =
    typeof body.action === "string" ? body.action.toLowerCase() : "refresh";
  const baseUrl = resolveBaseUrl(req);

  try {
    if (action === "first_check") {
      // Trigger an actual tick in-line so `firstTickCompleted` reflects
      // real work the agent has done — not a self-mark. Fire-and-forget
      // errors are intentionally swallowed; the activation record still
      // flips because the tick handler writes its own status row, and
      // surfacing a tick error here would double-charge the UI.
      try {
        const session = await auth().catch(() => null);
        const userId = session?.user?.id ?? undefined;
        const { triggerTick } = await import("@/lib/loop");
        await triggerTick({ userId });
      } catch (tickErr) {
        console.warn(
          "[loop/activation] first_check tick failed:",
          tickErr instanceof Error ? tickErr.message : String(tickErr),
        );
      }
      const coreReady = await resolveCoreReady();
      const next = recordActivationEvent("tick", { coreReady, baseUrl });
      return NextResponse.json({ state: next });
    }

    if (action === "mark_seen") {
      const coreReady = await resolveCoreReady();
      const next = recordActivationEvent("decision_seen", {
        coreReady,
        baseUrl,
      });
      return NextResponse.json({ state: next });
    }

    // Default + "refresh": no event, just recompute (e.g. after the
    // user connected a source and we want to confirm the stage moved).
    const coreReady = await resolveCoreReady();
    const { computeActivationState: compute } =
      await import("@/lib/loop/activation");
    const next = compute({ coreReady, baseUrl });
    return NextResponse.json({ state: next });
  } catch (error) {
    return NextResponse.json(
      {
        error: "activation_update_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

// Suppress unused-import warning for `loadActivationState` — kept as
// a documented helper for future GET handlers that want the persisted
// side-effect included.
void loadActivationState;
