/**
 * GET /api/llm/usage/summary
 *
 * Returns the cumulative native-agent token usage for the authenticated
 * user since they first configured an LLM provider. Designed for the
 * LOOMI Online card.
 *
 * Status semantics:
 * - 401 when no authenticated user AND auto-guest bootstrap fails
 *   (mirrors `/api/native/agent`).
 * - 200 with `configured: false` when the user has no enabled provider.
 * - 200 with `configured: true` and zero totals when the user has a
 *   provider but no usage has been recorded yet.
 * - 200 with `error: "usage_unavailable"` when the usage file could not
 *   be read; the card renders its error state without breaking other
 *   functionality.
 *
 * First-hit auto-guest: a fresh `pnpm tauri:dev` install has no
 * NextAuth session cookie yet but the home view fetches usage right
 * after the pet opens the main webview. The route falls through to
 * `ensureGuestSession()` (see `lib/auth/auto-guest.ts`) — same
 * plumbing the plugins use via `/api/remote-auth/guest`, just
 * in-process so we don't redirect each parallel call to /guest-login
 * and race-create one guest account per request.
 */

import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import { getAuthUser } from "@/lib/auth/dual-auth";
import { ensureGuestSession } from "@/lib/auth/auto-guest";
import { getUserLlmProviderEarliestEnabledSince } from "@/lib/db/queries";
import { getConfiguredDefaultAgentProvider } from "@/lib/ai/native-agent/provider-env";
import { getUserUsageSummary } from "@/lib/llm-usage/summary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  let authUser = await getAuthUser(req);
  let attachSessionCookies: ((response: NextResponse) => void) | null = null;

  if (!authUser?.id) {
    const guest = await ensureGuestSession();
    if (guest.session?.user?.id) {
      authUser = {
        id: guest.session.user.id,
        email: guest.session.user.email,
        name: guest.session.user.name,
        type: guest.session.user.type,
      };
    }
    if (guest.minted) {
      attachSessionCookies = guest.attachSessionCookies;
    }
    if (!authUser?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const response = await renderSummaryResponse(authUser.id);
    if (attachSessionCookies) {
      attachSessionCookies(response);
    }
    return response;
  } catch (error) {
    console.error("[llm-usage/summary] unexpected error:", error);
    const errorBody = {
      error: "usage_unavailable",
      message:
        error instanceof Error ? error.message : "Unexpected server error",
    };
    const errorResp = NextResponse.json(errorBody, { status: 200 });
    if (attachSessionCookies) {
      attachSessionCookies(errorResp);
    }
    return errorResp;
  }
}

async function renderSummaryResponse(userId: string): Promise<NextResponse> {
  // Mirror the `webSession` path used by `/api/native/agent` so the
  // summary endpoint reports the same identity as the SSE caller.
  await auth().catch(() => null);

  const providerContext = await getUserLlmProviderEarliestEnabledSince(userId);

  // Non-claude runtimes (codex/opencode/hermes/openclaw) ship their own
  // CLI auth and don't require a `user_llm_api_settings` row. When the
  // env-resolved runtime is one of those and no DB row exists, the
  // user is *still* configured from a runtime perspective — synthesize
  // an epoch-0 baseline so the SQL filter counts every recorded
  // native-agent row for this user (including prior claude calls), and
  // surface the runtime as the current provider in the card tooltip.
  // The pet card detects the epoch sentinel and suppresses the
  // "since X" line because we don't actually know when the env var
  // was first set.
  const defaultAgent = getConfiguredDefaultAgentProvider();
  if (!providerContext.providerSince && defaultAgent !== "claude") {
    providerContext.providerSince = new Date(0);
    providerContext.currentProvider = {
      providerType: defaultAgent,
      model: null,
      enabledSince: new Date(0),
    };
  }

  const summary = await getUserUsageSummary(userId, providerContext);
  return NextResponse.json(summary);
}
