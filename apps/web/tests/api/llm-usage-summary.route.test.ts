import { describe, beforeEach, test, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

type AuthUser = { id: string; type: "regular" };

const authState = vi.hoisted(() => ({
  user: { id: "user-llm-usage", type: "regular" as const } as AuthUser | null,
}));

vi.mock("@/app/(auth)/auth", () => ({
  auth: async () => (authState.user ? { user: authState.user } : null),
  __setUser: (user: AuthUser | null) => {
    authState.user = user;
  },
}));

const dualAuthState = vi.hoisted(() => ({
  // Set null to simulate 401 from getAuthUser.
  reject: false,
  user: { id: "user-llm-usage", type: "regular" as const } as AuthUser | null,
}));

vi.mock("@/lib/auth/dual-auth", () => ({
  getAuthUser: async () => {
    if (dualAuthState.reject) return null;
    return dualAuthState.user;
  },
}));

// Auto-guest bootstrap is the new first-hit fallback when getAuthUser
// rejects. Mirrored as a hoisted mock so individual tests can flip the
// outcome — without it, ensureGuestSession would try to hit the real DB
// and FS during unit runs. `null` simulates a failed bootstrap (the
// route should then 401).
const autoGuestState = vi.hoisted(() => ({
  session: null as { user: { id: string; email: string | null } } | null,
  minted: false,
}));

vi.mock("@/lib/auth/auto-guest", () => ({
  ensureGuestSession: async () => ({
    session: autoGuestState.session,
    attachSessionCookies: () => {},
    minted: autoGuestState.minted,
    guestEmail: autoGuestState.session?.user?.email ?? null,
  }),
}));

const dbState = vi.hoisted(() => ({
  providerSince: null as Date | null,
  currentProvider: undefined as
    | { providerType: string; model: string | null; enabledSince: Date }
    | undefined,
}));

vi.mock("@/lib/db/queries", () => ({
  getUserLlmProviderEarliestEnabledSince: vi.fn(async (_userId: string) => ({
    providerSince: dbState.providerSince,
    currentProvider: dbState.currentProvider,
  })),
}));

const summaryState = vi.hoisted(() => ({
  configured: false,
  runCount: 0,
  totalTokens: 0,
  error: undefined as string | undefined,
}));

vi.mock("@/lib/llm-usage/summary", () => ({
  // Pass through the providerContext the route hands us so the new
  // env-runtime override (synthesized currentProvider for codex / etc.)
  // is visible in the response. The other summary fields stay controlled
  // by summaryState for the existing assertions.
  getUserUsageSummary: vi.fn(
    async (
      _userId: string,
      providerContext: {
        providerSince: Date | null;
        currentProvider?: {
          providerType: string;
          model: string | null;
          enabledSince: Date;
        };
      },
    ) => ({
      configured: summaryState.configured,
      providerSince: providerContext.providerSince
        ? providerContext.providerSince.toISOString()
        : null,
      currentProvider: providerContext.currentProvider
        ? {
            providerType: providerContext.currentProvider.providerType,
            model: providerContext.currentProvider.model,
            enabledSince:
              providerContext.currentProvider.enabledSince.toISOString(),
          }
        : undefined,
      totals: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: summaryState.totalTokens,
      },
      runCount: summaryState.runCount,
      firstRunAt: null,
      lastRunAt: null,
      trackedEndpoints: ["native-agent"],
      trackedProviders: ["anthropic_compatible"],
      asOf: "2026-07-09T00:00:00.000Z",
      error: summaryState.error,
    }),
  ),
}));

// Hoist the env-resolved agent runtime so individual tests can flip it.
// Default "claude" matches the existing contract; the new codex-specific
// test flips it to "codex" before calling GET. Hoisted because
// `vi.mock` factories run before the test module is parsed and need
// captured state via `vi.hoisted`.
const agentProviderState = vi.hoisted(() => ({
  currentDefaultProvider: "claude" as "claude" | "codex",
}));

vi.mock("@/lib/ai/native-agent/provider-env", () => ({
  getConfiguredDefaultAgentProvider: () =>
    agentProviderState.currentDefaultProvider,
}));

import { GET } from "@/app/api/llm/usage/summary/route";

describe("GET /api/llm/usage/summary", () => {
  beforeEach(() => {
    dbState.providerSince = null;
    dbState.currentProvider = undefined;
    summaryState.configured = false;
    summaryState.runCount = 0;
    summaryState.totalTokens = 0;
    summaryState.error = undefined;
    dualAuthState.reject = false;
    dualAuthState.user = { id: "user-llm-usage", type: "regular" };
    // Default: auto-guest succeeds with the same dual-auth user so the
    // existing positive-path tests keep working unchanged.
    autoGuestState.session = dualAuthState.user
      ? { user: { id: dualAuthState.user.id, email: null } }
      : null;
    autoGuestState.minted = false;
    agentProviderState.currentDefaultProvider = "claude";
  });

  test("returns 401 when unauthenticated", async () => {
    // Simulate the dual-auth reject path AND a failed auto-guest
    // bootstrap — the route should still 401 because no user identity
    // is recoverable.
    dualAuthState.reject = true;
    autoGuestState.session = null;
    const res = await GET(
      new Request("http://localhost/api/llm/usage/summary"),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  test("auto-mints guest and returns 200 when dual-auth rejects but bootstrap succeeds", async () => {
    // This mirrors the fresh `pnpm tauri:dev` install path: the cookie
    // jar is empty so `getAuthUser` rejects, but `ensureGuestSession`
    // mints a stable anon-id and returns a session — the route must
    // NOT bounce through /guest-login or 401 here.
    dualAuthState.reject = true;
    autoGuestState.session = {
      user: { id: "guest-bootstrap-1", email: "anon-x@guest.local" },
    };
    autoGuestState.minted = true;
    const res = await GET(
      new Request("http://localhost/api/llm/usage/summary"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // The minted guest identity must be the one used downstream.
    expect(body.configured).toBe(false);
  });

  test("returns configured=false with zero totals when no provider", async () => {
    dbState.providerSince = null;
    summaryState.configured = false;
    const res = await GET(
      new Request("http://localhost/api/llm/usage/summary"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configured).toBe(false);
    expect(body.totals.totalTokens).toBe(0);
    expect(body.runCount).toBe(0);
    expect(body.trackedEndpoints).toContain("native-agent");
  });

  test("returns configured=true with non-zero totals", async () => {
    dbState.providerSince = new Date("2026-06-12T08:31:02.000Z");
    dbState.currentProvider = {
      providerType: "anthropic_compatible",
      model: "claude-sonnet-4-6",
      enabledSince: new Date("2026-06-12T08:31:02.000Z"),
    };
    summaryState.configured = true;
    summaryState.runCount = 42;
    summaryState.totalTokens = 12345;
    const res = await GET(
      new Request("http://localhost/api/llm/usage/summary"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configured).toBe(true);
    expect(body.runCount).toBe(42);
    expect(body.totals.totalTokens).toBe(12345);
    expect(body.trackedProviders).toContain("anthropic_compatible");
  });

  test("passes through usage_unavailable error without 500", async () => {
    dbState.providerSince = new Date("2026-06-12T08:31:02.000Z");
    summaryState.configured = true;
    summaryState.error = "usage_unavailable";
    const res = await GET(
      new Request("http://localhost/api/llm/usage/summary"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBe("usage_unavailable");
  });

  test("treats non-claude env runtime as configured even with no DB row", async () => {
    // Simulate `OPENLOOMI_AGENT_PROVIDER=codex` and a fresh user with
    // no `user_llm_api_settings` row. Without the route-level override
    // the card would render "No LLM provider" — the env-resolved runtime
    // should still flip `configured: true` and surface the runtime name.
    dbState.providerSince = null;
    dbState.currentProvider = undefined;
    summaryState.configured = true;
    summaryState.runCount = 0;
    summaryState.totalTokens = 0;
    agentProviderState.currentDefaultProvider = "codex";

    const res = await GET(
      new Request("http://localhost/api/llm/usage/summary"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configured).toBe(true);
    expect(body.currentProvider?.providerType).toBe("codex");
    // The route synthesizes an epoch-0 baseline so the SQL filter
    // counts every historical native-agent row for this user. The pet
    // card detects the sentinel and suppresses the "since X" line.
    expect(body.providerSince).toBe("1970-01-01T00:00:00.000Z");
  });
});
