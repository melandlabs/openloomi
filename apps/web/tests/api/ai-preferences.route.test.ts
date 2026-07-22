import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const authState = vi.hoisted(() => ({
  session: { user: { id: "user-1" } } as { user: { id: string } } | null,
}));

vi.mock("@/app/(auth)/auth", () => ({
  auth: vi.fn(async () => authState.session),
}));

vi.mock("@/lib/env/constants", () => ({
  isTauriMode: vi.fn(() => true),
}));

const providerState = vi.hoisted(() => ({
  defaultAgent: "claude",
}));

vi.mock("@/lib/ai/native-agent/provider-env", () => ({
  getConfiguredDefaultAgentProvider: vi.fn(() => providerState.defaultAgent),
}));

const nativeProbe = vi.hoisted(() => ({
  probe: vi.fn(),
}));

vi.mock("@/lib/ai/native-agent/runtime-probe", () => ({
  probeNativeClaudeRuntime: nativeProbe.probe,
}));

const dbState = vi.hoisted(() => ({
  settings: [] as unknown[],
}));

vi.mock("@/lib/db/queries", () => ({
  getUserLlmApiSettings: vi.fn(async () => dbState.settings),
  getUserLlmApiSettingWithApiKey: vi.fn(),
  upsertUserLlmApiSetting: vi.fn(),
  deleteUserLlmApiSetting: vi.fn(),
}));

const { GET } = await import("@/app/(chat)/api/preferences/ai/route");

beforeEach(() => {
  authState.session = { user: { id: "user-1" } };
  providerState.defaultAgent = "claude";
  dbState.settings = [
    {
      providerType: "openai_compatible",
      baseUrl: "https://api.example.test/v1",
      model: "test-model",
      enabled: true,
    },
  ];
  nativeProbe.probe.mockReset();
  nativeProbe.probe.mockResolvedValue({
    checked: true,
    available: true,
    authenticated: true,
    active: true,
    ready: true,
    reason: "CLAUDE_CLI_AUTHENTICATED",
    defaultAgent: "claude",
    cliPathPresent: true,
    cliPathSource: "PATH",
    versionPresent: true,
    probes: {},
  });
});

describe("GET /api/preferences/ai", () => {
  test("returns saved settings when the default Claude runtime probe fails", async () => {
    nativeProbe.probe.mockRejectedValue(new Error("probe failed"));

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.defaultAgent).toBe("claude");
    expect(body.nativeRuntime).toBeNull();
    expect(body.settings).toEqual(dbState.settings);
  });

  test("keeps Claude as the default preferred runtime when probe succeeds", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.defaultAgent).toBe("claude");
    expect(body.nativeRuntime.ready).toBe(true);
    expect(nativeProbe.probe).toHaveBeenCalledTimes(1);
  });

  test("does not probe Claude when an alternate native agent is configured", async () => {
    providerState.defaultAgent = "codex";

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.defaultAgent).toBe("codex");
    expect(body.nativeRuntime).toBeNull();
    expect(nativeProbe.probe).not.toHaveBeenCalled();
  });
});
