import { describe, beforeEach, afterEach, test, expect, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("server-only", () => ({}));

// `lib/db/queries.ts` and its transitive `helpers.ts` both call
// `dotenv.config({ path: ".env" })` at module-init time. Stub it out so
// test-time env isolation isn't reset by the host project's `.env`.
vi.mock("dotenv", () => ({
  config: () => ({ parsed: {} }),
  parse: () => ({}),
}));

vi.mock("@/app/(auth)/auth", () => ({
  auth: async () => ({ user: { id: "user-1", type: "regular" } }),
}));

vi.mock("@/lib/env/constants", () => ({
  isTauriMode: () => false,
}));

vi.mock("@/lib/ai/native-agent/provider-env", () => ({
  getConfiguredDefaultAgentProvider: () => "claude",
}));

// The runtime probe is the single source of truth for "is the user's
// local `claude` CLI authenticated". Each test mutates the flags
// below to flip between the fresh-install and authenticated branches.
const nativeProbe = vi.hoisted(() => ({
  authenticated: false,
  available: true,
  reason: "CLAUDE_CLI_AUTH_REQUIRED" as
    | "CLAUDE_CLI_AUTHENTICATED"
    | "CLAUDE_CLI_AUTH_REQUIRED",
}));
vi.mock("@/lib/ai/native-agent/runtime-probe", () => ({
  probeNativeClaudeRuntime: vi.fn(async () => ({
    checked: true as const,
    available: nativeProbe.available,
    authenticated: nativeProbe.authenticated,
    active: nativeProbe.authenticated,
    ready: nativeProbe.authenticated,
    reason: nativeProbe.reason,
    defaultAgent: "claude" as const,
    cliPathPresent: nativeProbe.available,
    cliPathSource: nativeProbe.available ? ("PATH" as const) : null,
    versionPresent: nativeProbe.available,
    probes: {},
  })),
}));

const userLlmSettings = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/lib/db/queries", () => ({
  getUserLlmApiSettings: vi.fn(async () => userLlmSettings.rows),
}));

const triggerTickResult = vi.hoisted(() => ({
  fail: false,
  out: { scanned: 0, surfaced: 0, muted: 0, newDecisions: [], errors: [] },
}));
vi.mock("@/lib/loop", async () => {
  const actual = await vi.importActual<typeof import("@/lib/loop/activation")>(
    "@/lib/loop/activation",
  );
  return {
    ...actual,
    triggerTick: vi.fn(async () => {
      if (triggerTickResult.fail) throw new Error("tick failed");
      return triggerTickResult.out;
    }),
  };
});

let LOOP_HOME = "";

vi.mock("@/lib/loop/paths", async () => {
  const { join } = await import("node:path");
  const buildPaths = () => ({
    home: LOOP_HOME,
    signals: join(LOOP_HOME, "signals.jsonl"),
    decisions: join(LOOP_HOME, "decisions.json"),
    status: join(LOOP_HOME, "status.json"),
    brief: join(LOOP_HOME, "brief.json"),
    wrap: join(LOOP_HOME, "wrap.json"),
    connectors: join(LOOP_HOME, "connectors.json"),
    config: join(LOOP_HOME, "config.json"),
    mutes: join(LOOP_HOME, "mutes.json"),
    migrated: join(LOOP_HOME, "migrated.json"),
    log: join(LOOP_HOME, "loop.log"),
    inbox: join(LOOP_HOME, "inbox"),
    syncState: join(LOOP_HOME, "sync-state.json"),
    customTypes: join(LOOP_HOME, "custom-types.json"),
    customChannels: join(LOOP_HOME, "custom-channels.json"),
    classifierRules: join(LOOP_HOME, "classifier-rules.json"),
    activationState: join(LOOP_HOME, "activation_state.json"),
  });
  const pathsProxy = new Proxy(
    {},
    {
      get: (_t, prop: string) => (buildPaths() as Record<string, string>)[prop],
    },
  );
  return {
    get LOOP_HOME() {
      return LOOP_HOME;
    },
    LOOP_PATHS: pathsProxy,
    ensureDirs: () => {
      mkdirSync(LOOP_HOME, { recursive: true });
      mkdirSync(join(LOOP_HOME, "inbox", ".processed"), { recursive: true });
      mkdirSync(join(LOOP_HOME, "inbox", ".failed"), { recursive: true });
    },
    ensureParent: (p: string) => {
      const { dirname } = require("node:path") as typeof import("node:path");
      mkdirSync(dirname(p), { recursive: true });
    },
    migrate: () => null,
  };
});

const { GET, POST } = await import("@/app/api/loop/activation/route");

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "loomi-act-route-"));
  LOOP_HOME = join(tmp, ".openloomi", "loop");
  mkdirSync(LOOP_HOME, { recursive: true });
  userLlmSettings.rows = [];
  triggerTickResult.fail = false;
  // Default to the "fresh install" probe result. Tests that want the
  // "user has authenticated claude CLI" path set this to true.
  nativeProbe.authenticated = false;
  nativeProbe.available = true;
  nativeProbe.reason = "CLAUDE_CLI_AUTH_REQUIRED";
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// Helper: build a plain `Request` plus a `nextUrl` shim so the
// `resolveBaseUrl()` helper inside the route handler, which reads
// `req.nextUrl.origin`, gets a usable URL even though we are not
// going through Next.js' request adapter. Mirrors the convention in
// `tests/api/insight-analytics.route.test.ts`.
function makeRequest(url: string, init?: RequestInit) {
  const req = new Request(url, init) as unknown as Parameters<typeof GET>[0] & {
    nextUrl?: URL;
  };
  try {
    (req as { nextUrl?: URL }).nextUrl = new URL(url);
  } catch {
    /* ignore — relative URLs would already be rejected upstream */
  }
  return req as unknown as Parameters<typeof GET>[0];
}

describe("GET /api/loop/activation", () => {
  test("returns computed state on a fresh install", async () => {
    const res = await GET(makeRequest("http://localhost/api/loop/activation"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state.activationStage).toBe("uninitialized");
    expect(body.state.recommendedNextAction).toBe("finish_setup");
  });

  test("uses absolute baseUrl for setupUrl when origin is provided", async () => {
    const res = await GET(
      makeRequest("http://127.0.0.1:3414/api/loop/activation"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state.setupUrl).toBe("http://127.0.0.1:3414/connectors");
  });

  test("treats an authenticated `claude` CLI as coreReady regardless of user rows", async () => {
    // The user's host-side `claude auth login` succeeded — the
    // runtime probe says so. No per-user key, no env var mirroring.
    nativeProbe.authenticated = true;
    nativeProbe.reason = "CLAUDE_CLI_AUTHENTICATED";
    const res = await GET(makeRequest("http://localhost/api/loop/activation"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state.coreReady).toBe(true);
  });
});

describe("POST /api/loop/activation", () => {
  test("first_check triggers a tick and marks firstTickCompleted", async () => {
    const res = await POST(
      makeRequest("http://localhost/api/loop/activation", {
        method: "POST",
        body: JSON.stringify({ action: "first_check" }),
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state.firstTickCompleted).toBe(true);
  });

  test("first_check swallows tick failures", async () => {
    triggerTickResult.fail = true;
    const res = await POST(
      makeRequest("http://localhost/api/loop/activation", {
        method: "POST",
        body: JSON.stringify({ action: "first_check" }),
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
  });

  test("mark_seen sets firstDecisionSeen", async () => {
    const res = await POST(
      makeRequest("http://localhost/api/loop/activation", {
        method: "POST",
        body: JSON.stringify({ action: "mark_seen" }),
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state.firstDecisionSeen).toBe(true);
  });

  test("refresh re-derives from disk without flipping flags", async () => {
    const res = await POST(
      makeRequest("http://localhost/api/loop/activation", {
        method: "POST",
        body: JSON.stringify({ action: "refresh" }),
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // fresh install → stage is uninitialized
    expect(body.state.activationStage).toBe("uninitialized");
  });

  test("unknown action falls back to refresh", async () => {
    const res = await POST(
      makeRequest("http://localhost/api/loop/activation", {
        method: "POST",
        body: JSON.stringify({ action: "definitely-not-a-real-action" }),
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
  });
});
