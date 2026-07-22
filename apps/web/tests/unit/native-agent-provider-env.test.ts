import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildHermesAcpCommand } from "@/lib/ai/extensions/agent/hermes/command";
import { buildOpenCodeRunCommand } from "@/lib/ai/extensions/agent/opencode/command";
import { buildOpenClawAcpCommand } from "@/lib/ai/extensions/agent/openclaw/command";
import { buildCodexRunCommand } from "@/lib/ai/extensions/agent/codex/command";
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
  "OPENLOOMI_AGENT_CODEX_COMMAND",
  "OPENLOOMI_AGENT_CODEX_PROFILE",
  "OPENLOOMI_AGENT_CODEX_MODEL",
  "OPENLOOMI_AGENT_CODEX_SANDBOX",
  "OPENLOOMI_AGENT_CODEX_SKIP_GIT_REPO_CHECK",
  "OPENLOOMI_AGENT_CODEX_FULL_AUTO",
  "OPENLOOMI_AGENT_CODEX_TIMEOUT_MS",
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

  it("uses Codex from env and builds the exec --json command", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "codex";
    process.env.OPENLOOMI_AGENT_CODEX_COMMAND = "codex-custom";
    process.env.OPENLOOMI_AGENT_CODEX_PROFILE = "work";
    process.env.OPENLOOMI_AGENT_CODEX_MODEL = "gpt-5.4";
    process.env.OPENLOOMI_AGENT_CODEX_SANDBOX = "read-only";
    process.env.OPENLOOMI_AGENT_CODEX_ASK_FOR_APPROVAL = "on-request";
    process.env.OPENLOOMI_AGENT_CODEX_SKIP_GIT_REPO_CHECK = "false";
    process.env.OPENLOOMI_AGENT_CODEX_FULL_AUTO = "1";
    process.env.OPENLOOMI_AGENT_CODEX_TIMEOUT_MS = "12000";

    const request = resolveNativeAgentProviderRequest({
      ...baseRequest(),
      provider: "claude",
      modelConfig: { model: "request-model" },
      providerConfig: { codexPath: "request-command" },
    });

    expect(request.provider).toBe("codex");
    expect(request.modelConfig).toEqual({ model: "gpt-5.4" });
    expect(request.providerConfig).toEqual({
      codexPath: "codex-custom",
      profile: "work",
      sandbox: "read-only",
      skipGitRepoCheck: false,
      fullAuto: true,
      timeoutMs: 12000,
    });

    const command = buildCodexRunCommand({
      prompt: "fix the failing tests",
      cwd: "/workspace/project",
      model: request.modelConfig?.model,
      mode: "run",
      permissionMode: "bypassPermissions",
      providerConfig: request.providerConfig,
    });
    expect(command.command).toBe("codex-custom");
    expect(command.args).toContain("exec");
    expect(command.args).toContain("--json");
    expect(command.args).toContain("-p");
    expect(command.args).toContain("work");
    expect(command.args).toContain("-m");
    expect(command.args).toContain("gpt-5.4");
    expect(command.args).toContain("--sandbox");
    expect(command.args).toContain("read-only");
    // Codex CLI 0.144 dropped `--ask-for-approval`. The OPENLOOMI_AGENT_CODEX_ASK_FOR_APPROVAL
    // env var is therefore a no-op at the command-builder level.
    expect(command.args).not.toContain("--ask-for-approval");
    expect(command.args).not.toContain("--skip-git-repo-check");
    expect(command.args).toContain("--full-auto");
    expect(command.args).not.toContain("fix the failing tests");
    expect(command.stdin).toBe("fix the failing tests");
  });

  it("rejects unsupported Codex sandbox env values and silently ignores ASK_FOR_APPROVAL", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "codex";
    process.env.OPENLOOMI_AGENT_CODEX_SANDBOX = "wide-open";
    expect(() => resolveNativeAgentProviderRequest(baseRequest())).toThrow(
      /OPENLOOMI_AGENT_CODEX_SANDBOX/,
    );

    process.env.OPENLOOMI_AGENT_CODEX_SANDBOX = "workspace-write";
    // OPENLOOMI_AGENT_CODEX_ASK_FOR_APPROVAL was retired when Codex CLI 0.144
    // dropped the `--ask-for-approval` flag. Setting it now must not throw
    // and must not leak into providerConfig.
    process.env.OPENLOOMI_AGENT_CODEX_ASK_FOR_APPROVAL = "always";
    const request = resolveNativeAgentProviderRequest(baseRequest());
    expect(request.provider).toBe("codex");
    expect(request.providerConfig).not.toHaveProperty("askForApproval");
  });

  it("uses Codex default sandbox and skipGitRepoCheck when env is unset", () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "codex";
    process.env.OPENLOOMI_AGENT_CODEX_COMMAND = "codex";

    const request = resolveNativeAgentProviderRequest(baseRequest());

    expect(request.provider).toBe("codex");
    expect(request.providerConfig).toEqual({
      codexPath: "codex",
      // skipGitRepoCheck is omitted because the env-resolver only forwards it
      // when explicitly set; the Codex runtime defaults skipGitRepoCheck to
      // true at the command-builder level.
    });

    const command = buildCodexRunCommand({
      prompt: "do work",
      cwd: "/workspace/project",
      mode: "run",
      providerConfig: request.providerConfig,
    });
    expect(command.args).toContain("--sandbox");
    expect(command.args).toContain(
      process.platform === "darwin" ? "danger-full-access" : "workspace-write",
    );
    expect(command.args).toContain("--skip-git-repo-check");
    expect(command.args).not.toContain("--full-auto");
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
