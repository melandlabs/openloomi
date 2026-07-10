import { afterEach, beforeEach, describe, expect, it } from "vitest";

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = process.env;
  process.env = { ...originalEnv };
  process.env.OPENLOOMI_AGENT_PROVIDER = undefined;
  process.env.OPENLOOMI_AGENT_HERMES_MODEL = undefined;
  process.env.OPENLOOMI_AGENT_HERMES_PROVIDER = undefined;
});

afterEach(() => {
  process.env = originalEnv;
});

describe("native providers API", () => {
  it("returns Claude as the default when no provider env is configured", async () => {
    const { GET } = await import("@/app/api/native/providers/route");

    const response = await GET();
    const body = (await response.json()) as ProvidersResponse;

    expect(body.defaultAgent).toBe("claude");
    expect(body.agents.filter((agent) => agent.type === "claude")).toHaveLength(
      1,
    );
    expect(
      body.agents.filter((agent) => agent.type === "opencode"),
    ).toHaveLength(1);
    expect(body.agents.filter((agent) => agent.type === "hermes")).toHaveLength(
      1,
    );
    expect(
      body.agents.filter((agent) => agent.type === "openclaw"),
    ).toHaveLength(1);
    expect(body.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "opencode",
          supportsSandbox: false,
        }),
        expect.objectContaining({
          type: "hermes",
          supportsSandbox: false,
        }),
        expect.objectContaining({
          type: "openclaw",
          supportsSandbox: false,
        }),
      ]),
    );
  });

  it("returns OpenCode as the default when configured by env", async () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "opencode";
    const { GET } = await import("@/app/api/native/providers/route");

    const response = await GET();
    const body = (await response.json()) as ProvidersResponse;

    expect(body.defaultAgent).toBe("opencode");
    expect(body.agents.filter((agent) => agent.type === "claude")).toHaveLength(
      1,
    );
    expect(
      body.agents.filter((agent) => agent.type === "opencode"),
    ).toHaveLength(1);
    expect(body.agents.filter((agent) => agent.type === "hermes")).toHaveLength(
      1,
    );
    expect(
      body.agents.find((agent) => agent.type === "opencode")?.supportsSandbox,
    ).toBe(false);
  });

  it("returns Hermes as the default when configured by env", async () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "hermes";
    const { GET } = await import("@/app/api/native/providers/route");

    const response = await GET();
    const body = (await response.json()) as ProvidersResponse;

    expect(body.defaultAgent).toBe("hermes");
    expect(body.agents.filter((agent) => agent.type === "claude")).toHaveLength(
      1,
    );
    expect(
      body.agents.filter((agent) => agent.type === "opencode"),
    ).toHaveLength(1);
    expect(body.agents.filter((agent) => agent.type === "hermes")).toHaveLength(
      1,
    );
    expect(
      body.agents.find((agent) => agent.type === "hermes")?.supportsSandbox,
    ).toBe(false);
  });

  it("returns OpenClaw as the default when configured by env", async () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "openclaw";
    const { GET } = await import("@/app/api/native/providers/route");

    const response = await GET();
    const body = (await response.json()) as ProvidersResponse;

    expect(body.defaultAgent).toBe("openclaw");
    expect(
      body.agents.find((agent) => agent.type === "openclaw"),
    ).toMatchObject({
      supportsSandbox: false,
    });
  });
});

interface ProvidersResponse {
  agents: Array<{ type: string; supportsSandbox: boolean }>;
  defaultAgent: string;
}
