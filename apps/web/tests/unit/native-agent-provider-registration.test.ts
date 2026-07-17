import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  claudeModuleLoads: 0,
  register: vi.fn(),
  has: vi.fn(() => false),
}));

vi.mock("@openloomi/ai/agent/registry", () => ({
  getAgentRegistry: () => ({
    has: state.has,
    register: state.register,
  }),
}));

const claudePlugin = {
  metadata: {
    type: "claude",
    name: "Claude",
    version: "test",
    description: "test provider",
    supportsPlan: true,
    supportsStreaming: true,
    supportsSandbox: true,
  },
  factory: vi.fn(),
};

vi.mock("@/lib/ai/extensions/agent/claude", () => {
  state.claudeModuleLoads += 1;
  return { claudePlugin };
});

const codexPlugin = {
  metadata: {
    type: "codex",
    name: "Codex",
    version: "test",
    description: "test provider",
    supportsPlan: true,
    supportsStreaming: true,
    supportsSandbox: true,
  },
  factory: vi.fn(),
};

vi.mock("@/lib/ai/extensions/agent/codex", () => ({ codexPlugin }));

import { registerNativeAgentProvider } from "@/lib/ai/native-agent/register-provider";

describe("native agent provider registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.claudeModuleLoads = 0;
  });

  it("loads and registers Codex without evaluating the Claude module", async () => {
    await registerNativeAgentProvider("codex");

    expect(state.claudeModuleLoads).toBe(0);
    expect(state.register).toHaveBeenCalledOnce();
    expect(state.register).toHaveBeenCalledWith(codexPlugin);

    state.register.mockClear();
    await registerNativeAgentProvider("claude");

    expect(state.claudeModuleLoads).toBe(1);
    expect(state.register).toHaveBeenCalledOnce();
    expect(state.register).toHaveBeenCalledWith(claudePlugin);
  });
});
