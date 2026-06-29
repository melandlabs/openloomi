import { mkdtemp, readFile, rm } from "node:fs/promises";
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
  it("runs through package core using host-provided adapters", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "openloomi-native-runner-"));
    tempDirs.push(workDir);

    const agent = new CapturingAgent();
    const registerProviders = vi.fn();
    const host: NativeAgentHost = {
      registry: createRegistry(agent),
      registerProviders,
      getUserInsightSettings: async () => ({
        aiSoulPrompt: "answer as the user's operator",
        language: "zh-CN",
      }),
      getUserLlmProviderConfig: async () => ({
        apiKey: "saved-key",
        baseUrl: "https://llm.example.test",
        model: "saved-model",
      }),
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
