import { describe, expect, it } from "vitest";
import {
  runAgentRuntimeRequest,
  type AgentRuntimePermissionRequest,
} from "@openloomi/ai/agent/runtime";
import { AgentRegistry } from "@openloomi/ai/agent/registry";
import { hermesPlugin } from "@/lib/ai/extensions/agent/hermes";
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

describe("agent runtime", () => {
  it("registers and creates arbitrary string providers", () => {
    const registry = new AgentRegistry();
    const agent = new PermissionAgent("custom-cli");

    registry.register({
      metadata: {
        type: "custom-cli",
        name: "Custom CLI",
        supportsPlan: true,
        supportsStreaming: true,
        supportsSandbox: false,
      },
      factory: () => agent,
    });

    expect(registry.create({ provider: "custom-cli" })).toBe(agent);
    expect(registry.getRegistered()).toContain("custom-cli");
  });

  it("registers and creates the Hermes provider plugin", () => {
    const registry = new AgentRegistry();

    registry.register(hermesPlugin);

    const agent = registry.create({ provider: "hermes" });
    expect(agent.provider).toBe("hermes");
    expect(registry.getMetadata("hermes")).toMatchObject({
      type: "hermes",
      supportsStreaming: true,
      supportsSandbox: false,
    });
  });

  it("runs through the shared runtime and surfaces permission request events", async () => {
    const permissionRequests: AgentRuntimePermissionRequest[] = [];
    const run = await runAgentRuntimeRequest(
      {
        prompt: "create a file",
        config: createConfig(),
        options: {},
      },
      {
        registry: createRegistry(new PermissionAgent()),
        emitPermissionRequestEvents: true,
        logger: silentLogger,
        permissionHandler: async (request) => {
          permissionRequests.push(request);
          return { behavior: "allow" };
        },
      },
    );

    const messages = await collectMessages(run.generator);

    expect(permissionRequests).toHaveLength(1);
    expect(messages.map((message) => message.type)).toEqual([
      "text",
      "permission_request",
    ]);
    expect(messages[0].content).toBe("permission:allow");
    expect(messages[1].permissionRequest?.toolName).toBe("Write");
    expect(run.shouldAbortOnClose()).toBe(false);
  });

  it("auto-denies protected tools in dontAsk mode when no host handler is present", async () => {
    const run = await runAgentRuntimeRequest(
      {
        prompt: "create a file",
        config: createConfig(),
        options: { permissionMode: "dontAsk" },
      },
      {
        registry: createRegistry(new PermissionAgent()),
        emitPermissionRequestEvents: true,
        logger: silentLogger,
      },
    );

    const messages = await collectMessages(run.generator);

    expect(messages[0].content).toBe("permission:deny");
    expect(
      messages.some((message) => message.type === "permission_request"),
    ).toBe(true);
  });

  it("converts sudo password prompts into runtime password_input events", async () => {
    const run = await runAgentRuntimeRequest(
      {
        prompt: "run sudo",
        config: createConfig(),
        options: {},
      },
      {
        registry: createRegistry(new SudoAgent()),
        logger: silentLogger,
        permissionHandler: async () => ({ behavior: "allow" }),
        detectPasswordPrompt: (output) => output.includes("Password:"),
      },
    );

    const messages = await collectMessages(run.generator);

    expect(messages.map((message) => message.type)).toEqual([
      "password_input",
      "tool_result",
    ]);
    expect(messages[0].passwordInput).toEqual({
      toolUseID: "tool-1",
      originalCommand: "sudo whoami",
    });
  });

  it("keeps shouldAbortOnClose true when the stream is closed early", async () => {
    const run = await runAgentRuntimeRequest(
      {
        prompt: "start a long run",
        config: createConfig(),
        options: {},
      },
      {
        registry: createRegistry(new LongRunningAgent()),
        logger: silentLogger,
      },
    );

    await expect(run.generator.next()).resolves.toMatchObject({
      value: { type: "text", content: "started" },
      done: false,
    });
    await run.generator.return(undefined);

    expect(run.shouldAbortOnClose()).toBe(true);
  });
});

class PermissionAgent implements IAgent {
  readonly provider: AgentProvider;

  constructor(provider: AgentProvider = "custom") {
    this.provider = provider;
  }

  async *run(
    _prompt: string,
    options?: AgentOptions,
  ): AsyncGenerator<AgentMessage> {
    const decision = await options?.onPermissionRequest?.({
      toolName: "Write",
      toolInput: { file_path: "test.txt", content: "hello" },
      toolUseID: "tool-1",
    });

    yield {
      type: "text",
      content: `permission:${decision?.behavior ?? "none"}`,
    };
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

class SudoAgent extends PermissionAgent {
  override async *run(
    _prompt: string,
    options?: AgentOptions,
  ): AsyncGenerator<AgentMessage> {
    await options?.onPermissionRequest?.({
      toolName: "Bash",
      toolInput: { command: "sudo whoami" },
      toolUseID: "tool-1",
    });

    yield {
      type: "tool_result",
      toolUseId: "tool-1",
      output: "Password:",
    };
  }
}

class LongRunningAgent extends PermissionAgent {
  override async *run(): AsyncGenerator<AgentMessage> {
    yield { type: "text", content: "started" };
    await new Promise(() => {});
  }
}

function createConfig(): AgentConfig {
  return { provider: "custom" };
}

function createRegistry(agent: IAgent): AgentRegistry {
  return {
    create: () => agent,
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
