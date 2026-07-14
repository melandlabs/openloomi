import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

const getUserLlmProviderConfigMock = vi.fn();

vi.mock("@/lib/ai/user-llm-api-settings", () => ({
  getUserLlmProviderConfig: getUserLlmProviderConfigMock,
}));

const registerProvidersMock = vi.fn();

vi.mock("@/lib/ai/native-agent/host", () => ({
  nativeAgentHost: { registerProviders: registerProvidersMock },
}));

const resolveNativeAgentProviderRequestMock = vi.fn();

vi.mock("@/lib/ai/native-agent/provider-env", () => ({
  resolveNativeAgentProviderRequest: resolveNativeAgentProviderRequestMock,
}));

const createAgentMock = vi.fn();

vi.mock("@openloomi/ai/agent/registry", () => ({
  getAgentRegistry: () => ({ create: createAgentMock }),
}));

async function loadResolver() {
  // Reset module cache so each test re-evaluates the env-derivation call.
  vi.resetModules();
  const mod = await import("@/lib/ai/provider-resolver");
  return mod.resolveLlmProvider;
}

describe("resolveLlmProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.OPENLOOMI_AGENT_PROVIDER = undefined;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns the HTTP Anthropic provider when the user has an anthropic_compatible row", async () => {
    getUserLlmProviderConfigMock.mockResolvedValueOnce({
      apiKey: "sk-test",
      baseUrl: "https://api.example.com",
      model: "claude-sonnet-4-6",
    });
    const resolve = await loadResolver();
    const provider = await resolve({
      userId: "user-1",
      prefer: "anthropic_messages",
    });
    expect(provider).toBeDefined();
    expect(provider?.flavor).toBe("anthropic_http");
    expect(provider?.model).toBe("claude-sonnet-4-6");
    expect(getUserLlmProviderConfigMock).toHaveBeenCalledWith({
      userId: "user-1",
      providerType: "anthropic_compatible",
    });
  });

  it("returns the HTTP OpenAI provider when the user has an openai_compatible row", async () => {
    getUserLlmProviderConfigMock.mockResolvedValueOnce({
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com",
      model: "gpt-4o",
    });
    const resolve = await loadResolver();
    const provider = await resolve({
      userId: "user-1",
      prefer: "chat_completions",
    });
    expect(provider).toBeDefined();
    expect(provider?.flavor).toBe("openai_http");
    expect(provider?.model).toBe("gpt-4o");
  });

  it("falls back to the agent runtime when no HTTP provider is configured", async () => {
    getUserLlmProviderConfigMock.mockResolvedValueOnce(undefined);
    process.env.OPENLOOMI_AGENT_PROVIDER = "codex";
    resolveNativeAgentProviderRequestMock.mockReturnValueOnce({
      provider: "codex",
      providerConfig: { codexPath: "codex" },
      modelConfig: { model: "gpt-5-codex" },
    });
    const resolve = await loadResolver();
    const provider = await resolve({
      userId: "user-1",
      prefer: "anthropic_messages",
    });
    expect(provider).toBeDefined();
    expect(provider?.flavor).toBe("agent_runtime");
  });

  it("returns undefined when neither HTTP nor a non-claude agent runtime is configured", async () => {
    getUserLlmProviderConfigMock.mockResolvedValueOnce(undefined);
    process.env.OPENLOOMI_AGENT_PROVIDER = "claude";
    resolveNativeAgentProviderRequestMock.mockReturnValueOnce({
      provider: "claude",
    });
    const resolve = await loadResolver();
    const provider = await resolve({
      userId: "user-1",
      prefer: "anthropic_messages",
    });
    expect(provider).toBeUndefined();
  });

  it("returns undefined when userId is absent and no runtime is set", async () => {
    // No HTTP path attempted (no userId) and OPENLOOMI_AGENT_PROVIDER unset.
    const resolve = await loadResolver();
    const provider = await resolve({
      userId: undefined,
      prefer: "chat_completions",
    });
    expect(provider).toBeUndefined();
    expect(getUserLlmProviderConfigMock).not.toHaveBeenCalled();
  });
});
