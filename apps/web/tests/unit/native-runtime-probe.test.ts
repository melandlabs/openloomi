import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: spawnMock,
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn((path: string) => path === "C:\\fake\\claude.exe"),
    readdirSync: vi.fn(() => []),
  };
});

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { clearNativeClaudeRuntimeCache, probeNativeClaudeRuntime } =
  await import("@/lib/ai/native-agent/runtime-probe");

describe("probeNativeClaudeRuntime", () => {
  beforeEach(() => {
    clearNativeClaudeRuntimeCache();
    spawnMock.mockReset();
    process.env.CLAUDE_CODE_PATH = "C:\\fake\\claude.exe";
  });

  afterEach(() => {
    clearNativeClaudeRuntimeCache();
    process.env.CLAUDE_CODE_PATH = undefined;
  });

  test("returns a structured failure when spawning claude fails synchronously", async () => {
    spawnMock.mockImplementation(() => {
      throw new Error("spawn boom");
    });

    const probe = await probeNativeClaudeRuntime();

    expect(probe).not.toBeNull();
    expect(probe?.ready).toBe(false);
    expect(probe?.reason).toBe("CLAUDE_CLI_VERSION_FAILED");
    expect(probe?.probes.version?.error).toEqual({
      code: "SPAWN_FAILED",
      message: "spawn boom",
    });
  });
});
