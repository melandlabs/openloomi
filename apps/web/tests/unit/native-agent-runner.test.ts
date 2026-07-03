import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runNativeAgentRequest,
  type NativeAgentHost,
} from "@openloomi/ai/agent/native-runner";
import type { AgentRegistry } from "@openloomi/ai/agent/registry";
import type {
  AgentConfig,
  AgentMessage,
  AgentOptions,
  AgentProvider,
  ExecuteOptions,
  IAgent,
  TaskPlan,
} from "@openloomi/ai/agent/types";
import { resolveNativeAgentProviderRequest } from "@/lib/ai/native-agent/provider-env";

const silentLogger = {
  log: () => {},
  warn: () => {},
  error: () => {},
};

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
});

describe("native agent runner", () => {
  it("defaults to Claude when no env or request provider is configured", async () => {
    const agent = new CapturingAgent();
    const getUserLlmProviderConfig = vi.fn(async () => ({
      apiKey: "saved-key",
      baseUrl: "https://llm.example.test",
      model: "saved-model",
    }));
    const host: NativeAgentHost = {
      registry: createRegistry(agent),
      prepareRequest: (body) => resolveNativeAgentProviderRequest(body, {}),
      getUserLlmProviderConfig,
      logger: silentLogger,
    };

    const run = await runNativeAgentRequest(
      {
        prompt: "default provider",
        modelConfig: {
          apiKey: "request-key",
          model: "request-model",
          thinkingLevel: "low",
        },
      },
      createContext(),
      host,
    );

    await collectMessages(run.generator);

    expect(getUserLlmProviderConfig).toHaveBeenCalledWith({
      userId: "user-1",
      providerType: "anthropic_compatible",
    });
    expect(agent.config).toMatchObject({
      provider: "claude",
      apiKey: "saved-key",
      baseUrl: "https://llm.example.test",
      model: "saved-model",
      thinkingLevel: "low",
    });
  });

  it("uses OpenCode env defaults when request provider is not set", async () => {
    const agent = new CapturingAgent();
    const getUserLlmProviderConfig = vi.fn();
    const host: NativeAgentHost = {
      registry: createRegistry(agent),
      prepareRequest: (body) =>
        resolveNativeAgentProviderRequest(body, {
          OPENLOOMI_AGENT_PROVIDER: "opencode",
          OPENLOOMI_AGENT_OPENCODE_COMMAND: "env-opencode",
          OPENLOOMI_AGENT_OPENCODE_MODEL: "env/model",
          OPENLOOMI_AGENT_OPENCODE_AGENT: "env-agent",
          OPENLOOMI_AGENT_OPENCODE_TIMEOUT_MS: "5000",
          OPENLOOMI_AGENT_OPENCODE_ALLOW_AUTO_APPROVE: "true",
        }),
      getUserLlmProviderConfig,
      logger: silentLogger,
    };

    const run = await runNativeAgentRequest(
      {
        prompt: "use env opencode",
        modelConfig: {
          apiKey: "anthropic-key-that-should-not-leak",
          baseUrl: "https://anthropic-compatible.example.test",
          thinkingLevel: "low",
        },
      },
      createContext(),
      host,
    );

    await collectMessages(run.generator);

    expect(getUserLlmProviderConfig).not.toHaveBeenCalled();
    expect(agent.config).toMatchObject({
      provider: "opencode",
      model: "env/model",
      providerConfig: {
        opencodePath: "env-opencode",
        agent: "env-agent",
        timeoutMs: 5000,
        allowAutoApprove: true,
      },
    });
    expect(agent.config?.apiKey).toBeUndefined();
    expect(agent.config?.baseUrl).toBeUndefined();
    expect(agent.config?.thinkingLevel).toBeUndefined();
  });

  it("lets request provider override OpenCode env default", async () => {
    const agent = new CapturingAgent();
    const getUserLlmProviderConfig = vi.fn(async () => ({
      apiKey: "saved-key",
      baseUrl: "https://llm.example.test",
      model: "saved-model",
    }));
    const host: NativeAgentHost = {
      registry: createRegistry(agent),
      prepareRequest: (body) =>
        resolveNativeAgentProviderRequest(body, {
          OPENLOOMI_AGENT_PROVIDER: "opencode",
        }),
      getUserLlmProviderConfig,
      logger: silentLogger,
    };

    const run = await runNativeAgentRequest(
      {
        prompt: "force claude",
        provider: "claude",
      },
      createContext(),
      host,
    );

    await collectMessages(run.generator);

    expect(agent.config).toMatchObject({
      provider: "claude",
      apiKey: "saved-key",
      baseUrl: "https://llm.example.test",
      model: "saved-model",
    });
  });

  it("runs through package core using host-provided adapters", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "openloomi-native-runner-"));
    tempDirs.push(workDir);

    const agent = new CapturingAgent();
    const registerProviders = vi.fn();
    const getUserLlmProviderConfig = vi.fn(async () => ({
      apiKey: "saved-key",
      baseUrl: "https://llm.example.test",
      model: "saved-model",
    }));
    const host: NativeAgentHost = {
      registry: createRegistry(agent),
      registerProviders,
      getUserInsightSettings: async () => ({
        aiSoulPrompt: "answer as the user's operator",
        language: "zh-CN",
      }),
      getUserLlmProviderConfig,
      logger: silentLogger,
    };

    const run = await runNativeAgentRequest(
      {
        prompt: "summarize the attached note",
        provider: "claude",
        modelConfig: {
          apiKey: "request-key",
          model: "request-model",
          thinkingLevel: "low",
        },
        workDir,
        useProvidedWorkDir: true,
        allowedTools: ["Read"],
        disallowedTools: ["Write"],
        fileAttachments: [
          {
            name: "note.txt",
            data: Buffer.from("hello from attachment").toString("base64"),
            mimeType: "text/plain",
          },
        ],
      },
      {
        session: { user: { id: "user-1", type: "regular" } },
        userId: "user-1",
        abortController: new AbortController(),
      },
      host,
    );

    const messages = await collectMessages(run.generator);

    expect(registerProviders).toHaveBeenCalledTimes(1);
    expect(getUserLlmProviderConfig).toHaveBeenCalledWith({
      userId: "user-1",
      providerType: "anthropic_compatible",
    });
    expect(agent.config).toMatchObject({
      provider: "claude",
      apiKey: "saved-key",
      baseUrl: "https://llm.example.test",
      model: "saved-model",
      thinkingLevel: "low",
      workDir,
    });
    expect(agent.options).toMatchObject({
      aiSoulPrompt: "answer as the user's operator",
      language: "zh-CN",
      allowedTools: ["Read"],
      disallowedTools: ["Write"],
      useProvidedWorkDir: true,
    });
    expect(agent.prompt).toContain(
      "tools disabled by permission policy: Write",
    );
    expect(agent.prompt).toContain("note.txt");
    await expect(readFile(join(workDir, "note.txt"), "utf8")).resolves.toBe(
      "hello from attachment",
    );
    expect(messages).toEqual([{ type: "text", content: "ok" }]);
  });

  it("passes custom provider config without reading Anthropic settings", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "openloomi-opencode-runner-"));
    tempDirs.push(workDir);

    const agent = new CapturingAgent();
    const getUserLlmProviderConfig = vi.fn();
    const host: NativeAgentHost = {
      registry: createRegistry(agent),
      getUserLlmProviderConfig,
      logger: silentLogger,
    };

    const run = await runNativeAgentRequest(
      {
        prompt: "use opencode",
        provider: "opencode",
        providerConfig: {
          agent: "build",
          allowAutoApprove: true,
        },
        modelConfig: {
          apiKey: "anthropic-key-that-should-not-leak",
          baseUrl: "https://anthropic-compatible.example.test",
          model: "openai/gpt-5",
          thinkingLevel: "low",
        },
        workDir,
      },
      {
        session: { user: { id: "user-1", type: "regular" } },
        userId: "user-1",
        abortController: new AbortController(),
      },
      host,
    );

    await collectMessages(run.generator);

    expect(getUserLlmProviderConfig).not.toHaveBeenCalled();
    expect(agent.config).toMatchObject({
      provider: "opencode",
      model: "openai/gpt-5",
      workDir,
      providerConfig: {
        agent: "build",
        allowAutoApprove: true,
      },
    });
    expect(agent.config?.apiKey).toBeUndefined();
    expect(agent.config?.baseUrl).toBeUndefined();
    expect(agent.config?.thinkingLevel).toBeUndefined();
  });

  it("sanitizes file attachment names before saving to the workspace", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "openloomi-native-files-"));
    tempDirs.push(workDir);

    const agent = new CapturingAgent();
    const host: NativeAgentHost = {
      registry: createRegistry(agent),
      logger: silentLogger,
    };

    const run = await runNativeAgentRequest(
      {
        prompt: "sanitize attachments",
        provider: "opencode",
        workDir,
        fileAttachments: [
          {
            name: "../escape.txt",
            data: Buffer.from("escape").toString("base64"),
            mimeType: "text/plain",
          },
          {
            name: "/tmp/absolute.txt",
            data: Buffer.from("absolute").toString("base64"),
            mimeType: "text/plain",
          },
          {
            name: "nested/name.txt",
            data: Buffer.from("nested").toString("base64"),
            mimeType: "text/plain",
          },
          {
            name: "../escape.txt",
            data: Buffer.from("second escape").toString("base64"),
            mimeType: "text/plain",
          },
        ],
      },
      {
        session: { user: { id: "user-1", type: "regular" } },
        userId: "user-1",
        abortController: new AbortController(),
      },
      host,
    );

    await collectMessages(run.generator);

    await expect(readFile(join(workDir, "escape.txt"), "utf8")).resolves.toBe(
      "escape",
    );
    await expect(readFile(join(workDir, "absolute.txt"), "utf8")).resolves.toBe(
      "absolute",
    );
    await expect(readFile(join(workDir, "name.txt"), "utf8")).resolves.toBe(
      "nested",
    );
    await expect(readFile(join(workDir, "escape-2.txt"), "utf8")).resolves.toBe(
      "second escape",
    );

    await expect(readdir(join(workDir, "nested"))).rejects.toThrow();
    expect(agent.prompt).toContain("escape.txt");
    expect(agent.prompt).toContain("escape-2.txt");
    expect(agent.prompt).not.toContain("../escape.txt");
  });
});

class CapturingAgent implements IAgent {
  readonly provider: AgentProvider = "custom";
  config?: AgentConfig;
  prompt = "";
  options?: AgentOptions;

  async *run(
    prompt: string,
    options?: AgentOptions,
  ): AsyncGenerator<AgentMessage> {
    this.prompt = prompt;
    this.options = options;
    yield { type: "text", content: "ok" };
  }

  async *plan(): AsyncGenerator<AgentMessage> {
    yield { type: "plan", plan: createPlan() };
  }

  async *execute(_options: ExecuteOptions): AsyncGenerator<AgentMessage> {
    yield { type: "text", content: "executed" };
  }

  async stop(): Promise<void> {}

  getPlan(): TaskPlan | undefined {
    return createPlan();
  }

  deletePlan(): void {}
}

function createRegistry(agent: CapturingAgent): AgentRegistry {
  return {
    create: (config: AgentConfig) => {
      agent.config = config;
      return agent;
    },
  } as unknown as AgentRegistry;
}

function createPlan(): TaskPlan {
  return {
    id: "plan-1",
    goal: "test",
    steps: [],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

async function collectMessages(
  generator: AsyncGenerator<AgentMessage>,
): Promise<AgentMessage[]> {
  const messages: AgentMessage[] = [];
  for await (const message of generator) {
    messages.push(message);
  }
  return messages;
}

function createContext() {
  return {
    session: { user: { id: "user-1", type: "regular" } },
    userId: "user-1",
    abortController: new AbortController(),
  };
}
