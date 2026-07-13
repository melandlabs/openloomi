import { afterEach, describe, expect, it } from "vitest";

import { buildCliEnvironment } from "@/lib/ai/extensions/agent/cli-process";

const originalEnv = process.env;

afterEach(() => {
  process.env = originalEnv;
});

describe("CLI process environment", () => {
  it("does not expose unrelated server secrets to agent runtimes", () => {
    process.env = {
      NODE_ENV: "test",
      PATH: "test-path",
      DATABASE_URL: "postgres://secret",
      AUTH_SECRET: "auth-secret",
      OPENAI_API_KEY: "model-secret",
      OPENCLAW_GATEWAY_TOKEN: "gateway-secret",
      CODEX_API_KEY: "codex-secret",
      CODEX_HOME: "/tmp/codex-home",
    };

    expect(buildCliEnvironment()).toMatchObject({
      NODE_ENV: "test",
      PATH: "test-path",
      OPENAI_API_KEY: "model-secret",
      OPENCLAW_GATEWAY_TOKEN: "gateway-secret",
      CODEX_API_KEY: "codex-secret",
      CODEX_HOME: "/tmp/codex-home",
    });
    expect(buildCliEnvironment()).not.toHaveProperty("DATABASE_URL");
    expect(buildCliEnvironment()).not.toHaveProperty("AUTH_SECRET");
  });

  it("supports an explicit server-controlled allowlist and trusted overrides", () => {
    process.env = {
      NODE_ENV: "test",
      OPENLOOMI_AGENT_ENV_ALLOWLIST: "HTTPS_PROXY, CORPORATE_CA",
      HTTPS_PROXY: "http://proxy.example.test",
      CORPORATE_CA: "/certs/ca.pem",
      UNRELATED_SECRET: "hidden",
    };

    expect(buildCliEnvironment({ RUN_MODE: "test" })).toEqual({
      NODE_ENV: "test",
      HTTPS_PROXY: "http://proxy.example.test",
      CORPORATE_CA: "/certs/ca.pem",
      RUN_MODE: "test",
    });
  });
});
