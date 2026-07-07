import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildHermesAcpCommand } from "@/lib/ai/extensions/agent/hermes/command";
import { buildOpenCodeRunCommand } from "@/lib/ai/extensions/agent/opencode/command";
import {
  getConfiguredDefaultAgentProvider,
  resolveNativeAgentProviderRequest,
} from "@/lib/ai/native-agent/provider-env";
import type { NativeAgentRequest } from "@openloomi/ai/agent/native-runner";

const AGENT_ENV_KEYS = [
  "OPENLOOMI_AGENT_PROVIDER",
  "OPENLOOMI_AGENT_OPENCODE_COMMAND",
  "OPENLOOMI_AGENT_OPENCODE_MODEL",
  "OPENLOOMI_AGENT_OPENCODE_AGENT",
  "OPENLOOMI_AGENT_OPENCODE_TIMEOUT_MS",
  "OPENLOOMI_AGENT_OPENCODE_ALLOW_AUTO_APPROVE",
  "OPENLOOMI_AGENT_HERMES_COMMAND",
  "OPENLOOMI_AGENT_HERMES_PROFILE",
  "OPENLOOMI_AGENT_HERMES_TIMEOUT_MS",
  "OPENLOOMI_AGENT_HERMES_MODEL",
  "OPENLOOMI_AGENT_HERMES_PROVIDER",
];

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = process.env;
  process.env = { ...originalEnv };
  clearAgentEnv(process.env);
});

afterEach(() => {
  process.env = originalEnv;
});

describe("native agent provider env resolver", () => {
  it("defaults to Claude without env or request provider", () => {
    const request = resolveNativeAgentProviderRequest(baseRequest());

    expect(request.provider).toBe("claude");
    expect(getConfiguredDefaultAgentProvider()).toBe("claude");
  });

  it("uses OpenCode from env when the request does not specify a provider", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "opencode";

    const request = resolveNativeAgentProviderRequest(baseRequest());

    expect(request.provider).toBe("opencode");
    expect(getConfiguredDefaultAgentProvider()).toBe("opencode");
  });

  it("uses Hermes from env when the request does not specify a provider", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "hermes";

    const request = resolveNativeAgentProviderRequest(baseRequest());

    expect(request.provider).toBe("hermes");
    expect(getConfiguredDefaultAgentProvider()).toBe("hermes");
  });

  it("lets request provider override env provider", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "hermes";

    const request = resolveNativeAgentProviderRequest({
      ...baseRequest(),
      provider: "claude",
    });

    expect(request.provider).toBe("claude");
  });

  it("treats an empty provider env value as unconfigured", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "  ";

    expect(resolveNativeAgentProviderRequest(baseRequest()).provider).toBe(
      "claude",
    );
  });

  it("fails clearly for an unknown env provider", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "unknown-runtime";

    expect(() => resolveNativeAgentProviderRequest(baseRequest())).toThrow(
      /Unsupported OPENLOOMI_AGENT_PROVIDER/,
    );
  });

  it.each([
    ["true", true],
    ["1", true],
    ["false", false],
    ["0", false],
  ])("parses allowAutoApprove boolean value %s", (rawValue, expected) => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "opencode";
    process.env.OPENLOOMI_AGENT_OPENCODE_ALLOW_AUTO_APPROVE = rawValue;

    const request = resolveNativeAgentProviderRequest(baseRequest());

    expect(request.providerConfig).toMatchObject({
      allowAutoApprove: expected,
    });
  });

  it("fails clearly for an invalid allowAutoApprove value", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "opencode";
    process.env.OPENLOOMI_AGENT_OPENCODE_ALLOW_AUTO_APPROVE = "yes-please";

    expect(() => resolveNativeAgentProviderRequest(baseRequest())).toThrow(
      /OPENLOOMI_AGENT_OPENCODE_ALLOW_AUTO_APPROVE/,
    );
  });

  it("parses a positive OpenCode timeout", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "opencode";
    process.env.OPENLOOMI_AGENT_OPENCODE_TIMEOUT_MS = "2500";

    const request = resolveNativeAgentProviderRequest(baseRequest());

    expect(request.providerConfig).toMatchObject({ timeoutMs: 2500 });
  });

  it.each(["0", "-1", "1.5", "slow"])(
    "fails clearly for invalid OpenCode timeout %s",
    (rawValue) => {
      process.env.OPENLOOMI_AGENT_PROVIDER = "opencode";
      process.env.OPENLOOMI_AGENT_OPENCODE_TIMEOUT_MS = rawValue;

      expect(() => resolveNativeAgentProviderRequest(baseRequest())).toThrow(
        /OPENLOOMI_AGENT_OPENCODE_TIMEOUT_MS/,
      );
    },
  );

  it("lets request model override env model", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "opencode";
    process.env.OPENLOOMI_AGENT_OPENCODE_MODEL = "env/model";

    const request = resolveNativeAgentProviderRequest({
      ...baseRequest(),
      modelConfig: { model: "request/model" },
    });

    expect(request.modelConfig?.model).toBe("request/model");
  });

  it("lets request providerConfig fields override env providerConfig fields", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "opencode";
    process.env.OPENLOOMI_AGENT_OPENCODE_COMMAND = "env-opencode";
    process.env.OPENLOOMI_AGENT_OPENCODE_AGENT = "env-agent";

    const request = resolveNativeAgentProviderRequest({
      ...baseRequest(),
      providerConfig: {
        opencodePath: "request-opencode",
        agent: "request-agent",
      },
    });

    expect(request.providerConfig).toMatchObject({
      opencodePath: "request-opencode",
      agent: "request-agent",
    });
  });

  it("does not let request allowAutoApprove enable --auto without the env cap", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "opencode";

    const request = resolveNativeAgentProviderRequest({
      ...baseRequest(),
      providerConfig: {
        allowAutoApprove: true,
      },
    });
    const command = buildOpenCodeRunCommand({
      prompt: "ship it",
      cwd: "/workspace/project",
      permissionMode: "bypassPermissions",
      providerConfig: request.providerConfig,
    });

    expect(request.providerConfig).toMatchObject({
      allowAutoApprove: false,
    });
    expect(command.args).not.toContain("--auto");
  });

  it("lets request lower env-capped allowAutoApprove", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "opencode";
    process.env.OPENLOOMI_AGENT_OPENCODE_ALLOW_AUTO_APPROVE = "true";

    const request = resolveNativeAgentProviderRequest({
      ...baseRequest(),
      providerConfig: {
        allowAutoApprove: false,
      },
    });

    expect(request.providerConfig).toMatchObject({
      allowAutoApprove: false,
    });
  });

  it("parses Hermes command, profile, and timeout from env", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "hermes";
    process.env.OPENLOOMI_AGENT_HERMES_COMMAND = "env-hermes";
    process.env.OPENLOOMI_AGENT_HERMES_PROFILE = "coding";
    process.env.OPENLOOMI_AGENT_HERMES_TIMEOUT_MS = "3000";

    const request = resolveNativeAgentProviderRequest(baseRequest());

    expect(request.providerConfig).toEqual({
      hermesPath: "env-hermes",
      profile: "coding",
      timeoutMs: 3000,
    });
  });

  it.each(["0", "-1", "1.5", "slow"])(
    "fails clearly for invalid Hermes timeout %s",
    (rawValue) => {
      process.env.OPENLOOMI_AGENT_PROVIDER = "hermes";
      process.env.OPENLOOMI_AGENT_HERMES_TIMEOUT_MS = rawValue;

      expect(() => resolveNativeAgentProviderRequest(baseRequest())).toThrow(
        /OPENLOOMI_AGENT_HERMES_TIMEOUT_MS/,
      );
    },
  );

  it("rejects Hermes model env because ACP model switching is not supported in this MVP", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "hermes";
    process.env.OPENLOOMI_AGENT_HERMES_MODEL = "nous/hermes";

    expect(() => resolveNativeAgentProviderRequest(baseRequest())).toThrow(
      /OPENLOOMI_AGENT_HERMES_MODEL is not supported/,
    );
  });

  it("rejects Hermes provider env because ACP provider switching is not supported in this MVP", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "hermes";
    process.env.OPENLOOMI_AGENT_HERMES_PROVIDER = "openrouter";

    expect(() => resolveNativeAgentProviderRequest(baseRequest())).toThrow(
      /OPENLOOMI_AGENT_HERMES_PROVIDER is not supported/,
    );
  });

  it("rejects request model for Hermes because ACP model switching is not supported in this MVP", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "hermes";

    expect(() =>
      resolveNativeAgentProviderRequest({
        ...baseRequest(),
        modelConfig: { model: "request/model" },
      }),
    ).toThrow(/Hermes model selection is not supported/);
  });

  it("does not let request providerConfig override Hermes server-side config or inject flags", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "hermes";
    process.env.OPENLOOMI_AGENT_HERMES_COMMAND = "env-hermes";
    process.env.OPENLOOMI_AGENT_HERMES_PROFILE = "env-profile";
    process.env.OPENLOOMI_AGENT_HERMES_TIMEOUT_MS = "3000";

    const request = resolveNativeAgentProviderRequest({
      ...baseRequest(),
      providerConfig: {
        hermesPath: "request-hermes",
        profile: "request-profile",
        timeoutMs: 1,
        extraArgs: ["--yolo"],
        yolo: true,
        env: { HERMES_YOLO_MODE: "1" },
      },
    });
    const command = buildHermesAcpCommand(request.providerConfig);

    expect(request.providerConfig).toEqual({
      hermesPath: "env-hermes",
      profile: "env-profile",
      timeoutMs: 3000,
    });
    expect(command.command).toBe("env-hermes");
    expect(command.args).toEqual(["--profile", "env-profile", "acp"]);
    expect(command.args).not.toContain("--yolo");
  });
});

function baseRequest(): NativeAgentRequest {
  return {
    prompt: "hello",
  };
}

function clearAgentEnv(env: NodeJS.ProcessEnv) {
  for (const key of AGENT_ENV_KEYS) {
    delete env[key];
  }
}
