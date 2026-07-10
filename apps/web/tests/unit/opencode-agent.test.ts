import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { AgentMessage, TaskPlan } from "@openloomi/ai/agent/types";
import { OpenCodeAgent } from "@/lib/ai/extensions/agent/opencode";
import {
  buildOpenCodeRunCommand,
  normalizeOpenCodeProviderConfig,
} from "@/lib/ai/extensions/agent/opencode/command";
import { parseOpenCodeJsonLine } from "@/lib/ai/extensions/agent/opencode/parser";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
});

describe("OpenCode command builder", () => {
  it("builds the MVP run command without --auto by default", () => {
    const command = buildOpenCodeRunCommand({
      prompt: "fix the tests",
      cwd: "/workspace/project",
      model: "anthropic/claude-sonnet-4.6",
      providerConfig: {
        agent: "build",
        files: ["src/a.ts", "src/b.ts"],
        allowAutoApprove: true,
      },
    });

    expect(command.command).toBe("opencode");
    expect(command.args).toEqual([
      "run",
      "--format",
      "json",
      "--dir",
      "/workspace/project",
      "--model",
      "anthropic/claude-sonnet-4.6",
      "--agent",
      "build",
      "--file",
      "src/a.ts",
      "--file",
      "src/b.ts",
      "fix the tests",
    ]);
    expect(command.args).not.toContain("--auto");
  });

  it("passes --auto only for bypassPermissions with explicit provider opt-in", () => {
    const command = buildOpenCodeRunCommand({
      prompt: "ship it",
      cwd: "/workspace/project",
      permissionMode: "bypassPermissions",
      providerConfig: {
        allowAutoApprove: true,
      },
    });

    expect(command.args).toContain("--auto");
    expect(command.args.at(-1)).toBe("ship it");
  });

  it("does not pass --auto for bypassPermissions without explicit opt-in", () => {
    const command = buildOpenCodeRunCommand({
      prompt: "ship it",
      cwd: "/workspace/project",
      permissionMode: "bypassPermissions",
      providerConfig: {
        allowAutoApprove: false,
      },
    });

    expect(command.args).not.toContain("--auto");
  });

  it("does not allow file values to smuggle --auto", () => {
    const command = buildOpenCodeRunCommand({
      prompt: "inspect files",
      cwd: "/workspace/project",
      providerConfig: {
        files: ["safe.ts", "--auto"],
        extraArgs: ["--auto"],
      },
      permissionMode: "bypassPermissions",
    });

    expect(command.args).toContain("safe.ts");
    expect(command.args).not.toContain("--auto");
  });

  it("normalizes timeoutMs from provider config", () => {
    expect(normalizeOpenCodeProviderConfig({ timeoutMs: 2500 }).timeoutMs).toBe(
      2500,
    );
    expect(
      normalizeOpenCodeProviderConfig({ timeoutMs: -1 }).timeoutMs,
    ).toBeUndefined();
  });
});

describe("OpenCode parser", () => {
  it("parses a JSON text event", () => {
    expect(
      parseOpenCodeJsonLine(JSON.stringify({ type: "text", text: "hello" })),
    ).toEqual([
      {
        type: "text",
        content: "hello",
      },
    ]);
  });

  it("parses nested text events", () => {
    expect(
      parseOpenCodeJsonLine(
        JSON.stringify({
          type: "message",
          message: { content: "nested hello" },
        }),
      ),
    ).toEqual([
      {
        type: "text",
        content: "nested hello",
      },
    ]);
  });

  it("parses partial tool result events", () => {
    expect(
      parseOpenCodeJsonLine(
        JSON.stringify({ type: "tool_result", tool_use_id: "tool-1" }),
      ),
    ).toEqual([
      {
        type: "tool_result",
        toolUseId: "tool-1",
        output: "",
        isError: false,
      },
    ]);
  });

  it("parses error events", () => {
    expect(
      parseOpenCodeJsonLine(
        JSON.stringify({ type: "error", error: { message: "bad run" } }),
      ),
    ).toEqual([
      {
        type: "error",
        message: "bad run",
      },
    ]);
  });

  it("parses done events as result messages", () => {
    expect(
      parseOpenCodeJsonLine(
        JSON.stringify({ type: "done", cost: 0.25, duration_ms: 123 }),
      ),
    ).toEqual([
      {
        type: "result",
        content: "done",
        cost: 0.25,
        duration: 123,
      },
    ]);
  });

  it("parses current OpenCode part-based tool, reasoning, and usage events", () => {
    expect(
      parseOpenCodeJsonLine(
        JSON.stringify({
          type: "tool_use",
          sessionID: "session-1",
          part: {
            type: "tool",
            id: "part-1",
            callID: "call-1",
            tool: "bash",
            state: {
              status: "completed",
              input: { command: "pwd" },
              output: "workspace",
            },
          },
        }),
      ),
    ).toEqual([
      {
        type: "tool_use",
        id: "call-1",
        name: "bash",
        input: { command: "pwd" },
      },
      {
        type: "tool_result",
        toolUseId: "call-1",
        output: "workspace",
        isError: false,
      },
    ]);

    expect(
      parseOpenCodeJsonLine(
        JSON.stringify({
          type: "reasoning",
          part: { type: "reasoning", text: "thinking" },
        }),
      ),
    ).toEqual([{ type: "reasoning", content: "thinking" }]);

    expect(
      parseOpenCodeJsonLine(
        JSON.stringify({
          type: "step_finish",
          part: {
            type: "step-finish",
            reason: "tool-calls",
            cost: 0.25,
            tokens: { input: 10, output: 4 },
          },
        }),
      ),
    ).toEqual([
      {
        type: "result",
        content: "tool-calls",
        cost: 0.25,
        usage: { inputTokens: 10, outputTokens: 4 },
      },
    ]);
  });

  it("uses nested OpenCode error data when present", () => {
    expect(
      parseOpenCodeJsonLine(
        JSON.stringify({
          type: "error",
          error: {
            name: "ProviderAuthError",
            data: { message: "authentication failed" },
          },
        }),
      ),
    ).toEqual([{ type: "error", message: "authentication failed" }]);
  });

  it("ignores invalid JSON lines", () => {
    expect(parseOpenCodeJsonLine("not-json")).toEqual([]);
  });

  it("ignores unknown JSON events without crashing", () => {
    expect(
      parseOpenCodeJsonLine(JSON.stringify({ type: "unknown", raw: true })),
    ).toEqual([]);
  });
});

describe("OpenCodeAgent", () => {
  it("does not pass --auto during planning", async () => {
    const workDir = await createFakeOpenCodeWorkDir(`
const fs = require("node:fs");
fs.writeFileSync("args.json", JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({
  type: "text",
  text: JSON.stringify({ type: "direct_answer", answer: "ok" })
}));
`);

    const agent = new OpenCodeAgent({
      provider: "opencode",
      workDir,
      providerConfig: {
        opencodePath: process.execPath,
        allowAutoApprove: true,
      },
    });

    await collectMessages(
      agent.plan("make a plan", { permissionMode: "bypassPermissions" }),
    );

    const args = JSON.parse(
      await readFile(join(workDir, "args.json"), "utf8"),
    ) as string[];
    expect(args).not.toContain("--auto");
  });

  it("passes conversation context and materialized images to OpenCode", async () => {
    const workDir = await createFakeOpenCodeWorkDir(`
const fs = require("node:fs");
fs.writeFileSync("args.json", JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({ type: "text", text: "ok" }));
`);
    const agent = new OpenCodeAgent({
      provider: "opencode",
      workDir,
      providerConfig: { opencodePath: process.execPath },
    });

    await collectMessages(
      agent.run("current question", {
        conversation: [
          { role: "user", content: "earlier question" },
          { role: "assistant", content: "earlier answer" },
        ],
        images: [{ data: "aGVsbG8=", mimeType: "image/png" }],
      }),
    );

    const args = JSON.parse(
      await readFile(join(workDir, "args.json"), "utf8"),
    ) as string[];
    const fileFlag = args.indexOf("--file");
    expect(fileFlag).toBeGreaterThan(-1);
    expect(args[fileFlag + 1]).toBe(
      join(workDir, ".openloomi-inputs", "image-1.png"),
    );
    const imagePath = args[fileFlag + 1];
    if (!imagePath) throw new Error("Expected an OpenCode --file path");
    expect(await readFile(imagePath, "utf8")).toBe("hello");
    expect(args.at(-1)).toEqual(expect.stringContaining("earlier question"));
    expect(args.at(-1)).toEqual(expect.stringContaining("current question"));
  });

  it("stops a running OpenCode process through the session controller", async () => {
    const workDir = await createFakeOpenCodeWorkDir(`
console.log(JSON.stringify({ type: "text", text: "started" }));
setInterval(() => {}, 1000);
`);

    const agent = new OpenCodeAgent({
      provider: "opencode",
      workDir,
      providerConfig: {
        opencodePath: process.execPath,
      },
    });
    const generator = agent.run("run for a while");

    const sessionResult = await generator.next();
    const sessionMessage = sessionResult.value as AgentMessage;
    expect(sessionMessage.type).toBe("session");
    expect(sessionMessage.sessionId).toBeTruthy();
    const sessionId = sessionMessage.sessionId;
    if (!sessionId) {
      throw new Error("Expected OpenCode run to yield a session id");
    }

    await expect(generator.next()).resolves.toMatchObject({
      value: { type: "text", content: "started" },
      done: false,
    });

    await agent.stop(sessionId);
    const remainingMessages = await withTimeout(
      collectMessages(generator),
      5000,
    );

    expect(remainingMessages.some((message) => message.type === "error")).toBe(
      true,
    );
    expect(remainingMessages.at(-1)?.type).toBe("done");
  });

  it("converts a nonzero CLI exit into an error message", async () => {
    const workDir = await createFakeOpenCodeWorkDir(`
console.log(JSON.stringify({ type: "text", text: "partial output" }));
console.error("simulated failure");
process.exit(7);
`);

    const agent = new OpenCodeAgent({
      provider: "opencode",
      workDir,
      providerConfig: {
        opencodePath: process.execPath,
      },
    });

    const messages = await collectMessages(agent.run("do work"));

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", content: "partial output" }),
      ]),
    );
    expect(messages.find((message) => message.type === "error")).toMatchObject({
      type: "error",
      message: expect.stringContaining("OpenCode CLI exited with code 7"),
    });
    expect(
      messages.find((message) => message.type === "error")?.message,
    ).toContain("simulated failure");
    expect(messages.at(-1)?.type).toBe("done");
  });

  it("decodes UTF-8 JSON events split across stdout chunks", async () => {
    const workDir = await createFakeOpenCodeWorkDir(`
const payload = Buffer.from(JSON.stringify({ type: "text", text: "你好" }) + "\\n");
const split = payload.indexOf(Buffer.from("你")) + 1;
process.stdout.write(payload.subarray(0, split));
setTimeout(() => process.stdout.write(payload.subarray(split)), 10);
`);
    const agent = new OpenCodeAgent({
      provider: "opencode",
      workDir,
      providerConfig: { opencodePath: process.execPath },
    });

    const messages = await collectMessages(agent.run("unicode"));

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", content: "你好" }),
      ]),
    );
  });

  it("aggregates OpenCode step usage into the terminal result", async () => {
    const workDir = await createFakeOpenCodeWorkDir(`
console.log(JSON.stringify({ type: "text", part: { type: "text", text: "done" } }));
console.log(JSON.stringify({ type: "step_finish", part: {
  type: "step-finish", reason: "tool-calls", cost: 0.1,
  tokens: { input: 10, output: 2 }
} }));
console.log(JSON.stringify({ type: "step_finish", part: {
  type: "step-finish", reason: "end_turn", cost: 0.2,
  tokens: { input: 5, output: 3 }
} }));
`);
    const agent = new OpenCodeAgent({
      provider: "opencode",
      workDir,
      providerConfig: { opencodePath: process.execPath },
    });

    const messages = await collectMessages(agent.run("collect usage"));

    const result = messages.find((message) => message.type === "result");
    expect(result).toMatchObject({
      type: "result",
      content: "success",
      usage: { inputTokens: 15, outputTokens: 5 },
    });
    expect(result?.cost).toBeCloseTo(0.3);
  });

  it("does not report success after an OpenCode error event", async () => {
    const workDir = await createFakeOpenCodeWorkDir(`
console.log(JSON.stringify({
  type: "error",
  error: { name: "ProviderAuthError", data: { message: "bad credentials" } }
}));
`);
    const agent = new OpenCodeAgent({
      provider: "opencode",
      workDir,
      providerConfig: { opencodePath: process.execPath },
    });

    const messages = await collectMessages(agent.run("fail safely"));

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "error", message: "bad credentials" }),
      ]),
    );
    expect(messages.some((message) => message.type === "result")).toBe(false);
    expect(messages.at(-1)?.type).toBe("done");
  });

  it("times out and terminates a long-running OpenCode process", async () => {
    const workDir = await createFakeOpenCodeWorkDir(`
console.log(JSON.stringify({ type: "text", text: "started" }));
setInterval(() => {}, 1000);
`);

    const agent = new OpenCodeAgent({
      provider: "opencode",
      workDir,
      providerConfig: {
        opencodePath: process.execPath,
        timeoutMs: 100,
      },
    });

    const messages = await withTimeout(
      collectMessages(agent.run("time out")),
      5000,
    );

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", content: "started" }),
      ]),
    );
    expect(messages.find((message) => message.type === "error")).toMatchObject({
      type: "error",
      message: expect.stringContaining("OpenCode CLI timed out after 100ms"),
    });
    expect(messages.at(-1)?.type).toBe("done");
  });

  it("returns a clear error when the opencode executable is missing", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "openloomi-opencode-test-"));
    tempDirs.push(workDir);

    const agent = new OpenCodeAgent({
      provider: "opencode",
      workDir,
      providerConfig: {
        opencodePath: "definitely-not-openloomi-opencode",
      },
    });

    const messages = await collectMessages(agent.run("do work"));

    expect(messages.find((message) => message.type === "error")).toMatchObject({
      type: "error",
      message: expect.stringContaining("OpenCode CLI executable not found"),
    });
    expect(messages.at(-1)?.type).toBe("done");
  });

  it("retains a plan after failed execution and deletes it after success", async () => {
    const workDir = await createFakeOpenCodeWorkDir(`
const response = {
  type: "plan",
  goal: "Do work",
  steps: [{ id: "1", description: "Complete implementation" }]
};
console.log(JSON.stringify({ type: "text", text: JSON.stringify(response) }));
`);

    const agent = new OpenCodeAgent({
      provider: "opencode",
      workDir,
      providerConfig: {
        opencodePath: process.execPath,
      },
    });

    const planMessages = await collectMessages(agent.plan("plan the work"));
    const plan = planMessages.find((message) => message.type === "plan")
      ?.plan as TaskPlan | undefined;
    expect(plan).toBeDefined();
    if (!plan) {
      throw new Error("Expected OpenCode planning to produce a plan");
    }
    const planId = plan.id;

    await writeFakeOpenCodeScript(
      workDir,
      `
console.error("execution failed");
process.exit(9);
`,
    );

    const failedMessages = await collectMessages(
      agent.execute({ planId, originalPrompt: "do work" }),
    );

    expect(
      failedMessages.find((message) => message.type === "error"),
    ).toMatchObject({
      type: "error",
      message: expect.stringContaining("execution failed"),
    });
    expect(agent.getPlan(planId)).toBe(plan);

    await writeFakeOpenCodeScript(
      workDir,
      `
console.log(JSON.stringify({ type: "text", text: "done" }));
`,
    );

    await collectMessages(agent.execute({ planId, originalPrompt: "do work" }));
    expect(agent.getPlan(planId)).toBeUndefined();
  });

  it("exposes OpenCode metadata from the providers API without changing the default", async () => {
    const originalEnv = process.env;
    process.env = { ...originalEnv };
    process.env.OPENLOOMI_AGENT_PROVIDER = undefined;
    const { GET } = await import("@/app/api/native/providers/route");

    try {
      const response = await GET();
      const body = (await response.json()) as {
        agents: Array<{ type: string; supportsSandbox: boolean }>;
        defaultAgent: string;
      };

      expect(body.defaultAgent).toBe("claude");
      expect(
        body.agents.filter((agent) => agent.type === "claude"),
      ).toHaveLength(1);
      expect(
        body.agents.filter((agent) => agent.type === "opencode"),
      ).toHaveLength(1);
      expect(body.agents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "opencode",
            supportsSandbox: false,
          }),
        ]),
      );
    } finally {
      process.env = originalEnv;
    }
  });
});

async function createFakeOpenCodeWorkDir(script: string) {
  const workDir = await mkdtemp(join(tmpdir(), "openloomi-opencode-test-"));
  tempDirs.push(workDir);
  await writeFakeOpenCodeScript(workDir, script);
  return workDir;
}

async function writeFakeOpenCodeScript(workDir: string, script: string) {
  await writeFile(join(workDir, "run"), script, "utf8");
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
