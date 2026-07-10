import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildHermesAcpCommand } from "@/lib/ai/extensions/agent/hermes/command";
import { buildOpenCodeRunCommand } from "@/lib/ai/extensions/agent/opencode/command";
import { buildOpenClawAcpCommand } from "@/lib/ai/extensions/agent/openclaw/command";
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
  "OPENLOOMI_AGENT_OPENCLAW_COMMAND",
  "OPENLOOMI_AGENT_OPENCLAW_GATEWAY_URL",
  "OPENLOOMI_AGENT_OPENCLAW_TOKEN_FILE",
  "OPENLOOMI_AGENT_OPENCLAW_PASSWORD_FILE",
  "OPENLOOMI_AGENT_OPENCLAW_SESSION",
  "OPENLOOMI_AGENT_OPENCLAW_SESSION_LABEL",
  "OPENLOOMI_AGENT_OPENCLAW_REQUIRE_EXISTING",
  "OPENLOOMI_AGENT_OPENCLAW_RESET_SESSION",
  "OPENLOOMI_AGENT_OPENCLAW_NO_PREFIX_CWD",
  "OPENLOOMI_AGENT_OPENCLAW_PROVENANCE",
  "OPENLOOMI_AGENT_OPENCLAW_TIMEOUT_MS",
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

  it("uses OpenClaw from env and builds its ACP bridge command", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "openclaw";
    process.env.OPENLOOMI_AGENT_OPENCLAW_COMMAND = "openclaw-custom";
    process.env.OPENLOOMI_AGENT_OPENCLAW_GATEWAY_URL =
      "wss://gateway.example.test";
    process.env.OPENLOOMI_AGENT_OPENCLAW_TOKEN_FILE = "/secrets/token";
    process.env.OPENLOOMI_AGENT_OPENCLAW_SESSION = "agent:main:main";
    process.env.OPENLOOMI_AGENT_OPENCLAW_REQUIRE_EXISTING = "true";
    process.env.OPENLOOMI_AGENT_OPENCLAW_NO_PREFIX_CWD = "1";
    process.env.OPENLOOMI_AGENT_OPENCLAW_PROVENANCE = "meta+receipt";
    process.env.OPENLOOMI_AGENT_OPENCLAW_TIMEOUT_MS = "4000";

    const request = resolveNativeAgentProviderRequest({
      ...baseRequest(),
      provider: "claude",
      modelConfig: { model: "request-model" },
      providerConfig: { openclawPath: "request-command" },
    });
    const command = buildOpenClawAcpCommand(request.providerConfig);

    expect(request.provider).toBe("openclaw");
    expect(request.modelConfig).toBeUndefined();
    expect(request.providerConfig).toEqual({
      openclawPath: "openclaw-custom",
      gatewayUrl: "wss://gateway.example.test",
      tokenFile: "/secrets/token",
      session: "agent:main:main",
      requireExisting: true,
      noPrefixCwd: true,
      provenance: "meta+receipt",
      timeoutMs: 4000,
    });
    expect(command).toEqual({
      command: "openclaw-custom",
      args: [
        "acp",
        "--url",
        "wss://gateway.example.test",
        "--token-file",
        "/secrets/token",
        "--session",
        "agent:main:main",
        "--require-existing",
        "--no-prefix-cwd",
        "--provenance",
        "meta+receipt",
      ],
    });
  });

  it("validates OpenClaw session and gateway environment configuration", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "openclaw";
    process.env.OPENLOOMI_AGENT_OPENCLAW_SESSION = "agent:main:main";
    process.env.OPENLOOMI_AGENT_OPENCLAW_SESSION_LABEL = "main";

    expect(() => resolveNativeAgentProviderRequest(baseRequest())).toThrow(
      /mutually exclusive/,
    );

    process.env.OPENLOOMI_AGENT_OPENCLAW_SESSION = undefined;
    process.env.OPENLOOMI_AGENT_OPENCLAW_SESSION_LABEL = undefined;
    process.env.OPENLOOMI_AGENT_OPENCLAW_GATEWAY_URL = "https://not-websocket";
    expect(() => resolveNativeAgentProviderRequest(baseRequest())).toThrow(
      /must use ws: or wss:/,
    );
  });

  it("keeps runtime selection server-controlled when a request names another provider", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "hermes";

    const request = resolveNativeAgentProviderRequest({
      ...baseRequest(),
      provider: "claude",
    });

    expect(request.provider).toBe("hermes");
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

  it("keeps the OpenCode model server-controlled", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "opencode";
    process.env.OPENLOOMI_AGENT_OPENCODE_MODEL = "env/model";

    const request = resolveNativeAgentProviderRequest({
      ...baseRequest(),
      modelConfig: { model: "request/model" },
    });

    expect(request.modelConfig?.model).toBe("env/model");
  });

  it("keeps OpenCode executable and agent config server-controlled", () => {
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
      opencodePath: "env-opencode",
      agent: "env-agent",
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

    expect(request.providerConfig).not.toHaveProperty("allowAutoApprove");
    expect(command.args).not.toContain("--auto");
  });

  it("does not let a request change env-capped allowAutoApprove", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "opencode";
    process.env.OPENLOOMI_AGENT_OPENCODE_ALLOW_AUTO_APPROVE = "true";

    const request = resolveNativeAgentProviderRequest({
      ...baseRequest(),
      providerConfig: {
        allowAutoApprove: false,
      },
    });

    expect(request.providerConfig).toMatchObject({
      allowAutoApprove: true,
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

  it("applies a Hermes model from trusted env config", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "hermes";
    process.env.OPENLOOMI_AGENT_HERMES_MODEL = "nous/hermes";

    expect(
      resolveNativeAgentProviderRequest(baseRequest()).modelConfig,
    ).toEqual({ model: "nous/hermes" });
  });

  it("requires a Hermes model when an inference provider is configured", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "hermes";
    process.env.OPENLOOMI_AGENT_HERMES_PROVIDER = "openrouter";

    expect(() => resolveNativeAgentProviderRequest(baseRequest())).toThrow(
      /OPENLOOMI_AGENT_HERMES_PROVIDER requires OPENLOOMI_AGENT_HERMES_MODEL/,
    );
  });

  it("qualifies a trusted Hermes model with its inference provider", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "hermes";
    process.env.OPENLOOMI_AGENT_HERMES_PROVIDER = "openrouter";
    process.env.OPENLOOMI_AGENT_HERMES_MODEL = "anthropic/claude-sonnet-4.6";

    expect(
      resolveNativeAgentProviderRequest(baseRequest()).modelConfig,
    ).toEqual({ model: "openrouter:anthropic/claude-sonnet-4.6" });
  });

  it("drops the generic chat model when Hermes is only the env default", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "hermes";

    expect(
      resolveNativeAgentProviderRequest({
        ...baseRequest(),
        modelConfig: {
          apiKey: "cloud-token",
          baseUrl: "https://cloud.example.test",
          model: "anthropic/claude-sonnet-4.6",
        },
      }).modelConfig,
    ).toBeUndefined();
  });

  it("does not let an explicit Hermes request select an ACP model", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "hermes";
    process.env.OPENLOOMI_AGENT_HERMES_MODEL = "env/hermes-model";

    expect(
      resolveNativeAgentProviderRequest({
        ...baseRequest(),
        provider: "hermes",
        modelConfig: { model: "openrouter:anthropic/claude-sonnet-4.6" },
      }).modelConfig,
    ).toEqual({ model: "env/hermes-model" });
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
