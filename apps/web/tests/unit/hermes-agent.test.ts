import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage, TaskPlan } from "@openloomi/ai/agent/types";
import { HermesAgent } from "@/lib/ai/extensions/agent/hermes";
import { buildHermesAcpCommand } from "@/lib/ai/extensions/agent/hermes/command";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
});

describe("Hermes ACP command builder", () => {
  it("builds hermes acp without yolo flags", () => {
    const command = buildHermesAcpCommand({
      hermesPath: "hermes-bin",
      profile: "coding",
      extraArgs: ["--yolo"],
      yolo: true,
      env: { HERMES_YOLO_MODE: "1" },
    });

    expect(command.command).toBe("hermes-bin");
    expect(command.args).toEqual(["--profile", "coding", "acp"]);
    expect(command.args).not.toContain("--yolo");
  });
});

describe("HermesAgent", () => {
  it("runs initialize/session/new/session/prompt and maps ACP updates", async () => {
    const workDir = await createFakeHermesWorkDir(defaultFakeAcpScript());
    const agent = createAgent(workDir);

    const messages = await collectMessages(agent.run("normal run"));

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "session" }),
        expect.objectContaining({ type: "text", content: "hello" }),
        expect.objectContaining({ type: "reasoning", content: "thinking" }),
        expect.objectContaining({
          type: "tool_use",
          id: "tool-1",
          name: "Run command",
          input: { command: "pwd" },
        }),
        expect.objectContaining({
          type: "tool_result",
          toolUseId: "tool-1",
          output: "tool output",
          isError: false,
        }),
        expect.objectContaining({
          type: "result",
          content: "end_turn",
          usage: { inputTokens: 3, outputTokens: 4 },
        }),
      ]),
    );
    expect(countDone(messages)).toBe(1);

    const calls = await readJsonLines(join(workDir, "calls.jsonl"));
    expect(calls.map((call) => call.method)).toEqual([
      "initialize",
      "session/new",
      "session/prompt",
    ]);
    const initializeParams = calls[0].params as Record<string, unknown>;
    const newSessionParams = calls[1].params as Record<string, unknown>;
    expect(initializeParams).toMatchObject({
      protocolVersion: expect.any(Number),
      clientInfo: { name: "openloomi", version: expect.any(String) },
    });
    expect(initializeParams.clientCapabilities).not.toHaveProperty("terminal");
    expect(newSessionParams).toMatchObject({
      cwd: workDir,
      mcpServers: [],
    });
  });

  it("applies an explicitly configured model to the new ACP session", async () => {
    const workDir = await createFakeHermesWorkDir(defaultFakeAcpScript());
    const agent = createAgent(
      workDir,
      {},
      "openrouter:anthropic/claude-sonnet-4.6",
    );

    await collectMessages(agent.run("normal run"));

    const calls = await readJsonLines(join(workDir, "calls.jsonl"));
    expect(calls.map((call) => call.method)).toEqual([
      "initialize",
      "session/new",
      "session/set_model",
      "session/prompt",
    ]);
    expect(calls[2].params).toEqual({
      sessionId: "hermes-session-1",
      modelId: "openrouter:anthropic/claude-sonnet-4.6",
    });
  });

  it("turns JSON-RPC prompt errors into one error and exactly one done", async () => {
    const workDir = await createFakeHermesWorkDir(defaultFakeAcpScript());
    const agent = createAgent(workDir);

    const messages = await collectMessages(agent.run("jsonrpc-error"));

    expect(messages.find((message) => message.type === "error")).toMatchObject({
      type: "error",
      message: expect.stringContaining("fake prompt failure"),
    });
    expect(countDone(messages)).toBe(1);
  });

  it("rejects pending RPC calls when Hermes exits cleanly without responding", async () => {
    const workDir = await createFakeHermesWorkDir(`
process.stdin.once("data", () => process.exit(0));
`);
    const agent = createAgent(workDir);

    const messages = await withTimeout(
      collectMessages(agent.run("exit before initialize response")),
      5000,
    );

    expect(messages.find((message) => message.type === "error")).toMatchObject({
      type: "error",
      message: expect.stringContaining(
        "exited before responding to pending request(s): initialize",
      ),
    });
    expect(countDone(messages)).toBe(1);
  });

  it("times out, kills the ACP process, and yields exactly one done", async () => {
    const workDir = await createFakeHermesWorkDir(defaultFakeAcpScript());
    const agent = createAgent(workDir, { timeoutMs: 100 });

    const messages = await withTimeout(
      collectMessages(agent.run("hang forever")),
      5000,
    );

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", content: "started" }),
        expect.objectContaining({
          type: "error",
          message: expect.stringContaining("Hermes ACP timed out after 100ms"),
        }),
      ]),
    );
    expect(countDone(messages)).toBe(1);
  });

  it("returns a clear error when the Hermes executable is missing", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "openloomi-hermes-test-"));
    tempDirs.push(workDir);
    const agent = new HermesAgent({
      provider: "hermes",
      workDir,
      providerConfig: {
        hermesPath: "definitely-not-openloomi-hermes",
      },
    });

    const messages = await collectMessages(agent.run("do work"));

    expect(messages.find((message) => message.type === "error")).toMatchObject({
      type: "error",
      message: expect.stringContaining("Hermes ACP executable not found"),
    });
    expect(countDone(messages)).toBe(1);
  });

  it("maps permission allow decisions to an existing allow_once option id", async () => {
    const workDir = await createFakeHermesWorkDir(defaultFakeAcpScript());
    const agent = createAgent(workDir);
    const onPermissionRequest = vi.fn(
      async (): Promise<{ behavior: "allow" }> => ({ behavior: "allow" }),
    );

    const messages = await collectMessages(
      agent.run("permission allow", { onPermissionRequest }),
    );

    expect(onPermissionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "Run command",
        toolInput: { command: "rm -rf /tmp/example" },
        toolUseID: "tool-2",
      }),
    );
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          content: "permission:allow-once",
        }),
      ]),
    );
    const permissions = await readJsonLines(
      join(workDir, "permission-responses.jsonl"),
    );
    expect(permissions.at(-1)?.result).toEqual({
      outcome: { outcome: "selected", optionId: "allow-once" },
    });
    expect(countDone(messages)).toBe(1);
  });

  it("maps permission deny decisions to an existing reject option id", async () => {
    const workDir = await createFakeHermesWorkDir(defaultFakeAcpScript());
    const agent = createAgent(workDir);

    const messages = await collectMessages(
      agent.run("permission deny", {
        onPermissionRequest: async () => ({ behavior: "deny" }),
      }),
    );

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          content: "permission:reject-once",
        }),
      ]),
    );
    const permissions = await readJsonLines(
      join(workDir, "permission-responses.jsonl"),
    );
    expect(permissions.at(-1)?.result).toEqual({
      outcome: { outcome: "selected", optionId: "reject-once" },
    });
    expect(countDone(messages)).toBe(1);
  });

  it("denies permission requests when no handler is configured", async () => {
    const workDir = await createFakeHermesWorkDir(defaultFakeAcpScript());
    const agent = createAgent(workDir);

    const messages = await collectMessages(agent.run("permission no handler"));

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          content: "permission:reject-once",
        }),
      ]),
    );
    expect(countDone(messages)).toBe(1);
  });

  it("cancels pending permissions and sends session/cancel on stop", async () => {
    const workDir = await createFakeHermesWorkDir(defaultFakeAcpScript());
    const agent = createAgent(workDir);
    const generator = agent.run("permission wait", {
      onPermissionRequest: async () => new Promise(() => {}),
    });

    const sessionMessage = (await generator.next()).value as AgentMessage;
    expect(sessionMessage.type).toBe("session");
    if (!sessionMessage.sessionId) {
      throw new Error("Expected Hermes run to yield a session id");
    }

    const remainingMessagesPromise = collectMessages(generator);
    await waitForFile(join(workDir, "permission-requests.jsonl"));
    await agent.stop(sessionMessage.sessionId);
    const messages = await withTimeout(remainingMessagesPromise, 5000);

    const cancels = await readJsonLines(join(workDir, "cancels.jsonl"));
    const permissions = await readJsonLines(
      join(workDir, "permission-responses.jsonl"),
    );
    expect(cancels.at(-1)?.params).toEqual({ sessionId: "hermes-session-1" });
    expect(permissions.at(-1)?.result).toEqual({
      outcome: { outcome: "cancelled" },
    });
    expect(countDone(messages)).toBe(1);
  });

  it("denies permission requests during planning", async () => {
    const workDir = await createFakeHermesWorkDir(defaultFakeAcpScript());
    const agent = createAgent(workDir);

    const messages = await collectMessages(agent.plan("permission plan"));

    const permissions = await readJsonLines(
      join(workDir, "permission-responses.jsonl"),
    );
    expect(permissions.at(-1)?.result).toEqual({
      outcome: { outcome: "selected", optionId: "reject-once" },
    });
    expect(messages.find((message) => message.type === "plan")).toBeUndefined();
    expect(countDone(messages)).toBe(1);
  });

  it("returns method-not-found for unsupported agent-to-client requests", async () => {
    const workDir = await createFakeHermesWorkDir(defaultFakeAcpScript());
    const agent = createAgent(workDir);

    const messages = await collectMessages(agent.run("unsupported request"));

    const unsupported = await readJsonLines(join(workDir, "unsupported.jsonl"));
    expect(unsupported.at(-1)?.error).toMatchObject({
      code: -32601,
      message: expect.stringContaining("Unsupported Hermes ACP client method"),
    });
    expect(messages.find((message) => message.type === "error")).toMatchObject({
      type: "error",
      message: expect.stringContaining("Unsupported Hermes ACP client method"),
    });
    expect(countDone(messages)).toBe(1);
  });

  it("stores plans and deletes them only after successful execution", async () => {
    const workDir = await createFakeHermesWorkDir(planFakeAcpScript());
    const agent = createAgent(workDir);

    const planMessages = await collectMessages(agent.plan("plan the work"));
    const plan = planMessages.find((message) => message.type === "plan")
      ?.plan as TaskPlan | undefined;
    expect(plan).toBeDefined();
    if (!plan) {
      throw new Error("Expected Hermes planning to produce a plan");
    }
    expect(agent.getPlan(plan.id)).toBe(plan);

    await writeFakeHermesScript(workDir, errorFakeAcpScript());
    const failedMessages = await collectMessages(
      agent.execute({ planId: plan.id, originalPrompt: "do work" }),
    );

    expect(
      failedMessages.find((message) => message.type === "error"),
    ).toMatchObject({
      type: "error",
      message: expect.stringContaining("execution failed"),
    });
    expect(agent.getPlan(plan.id)).toBe(plan);
    expect(countDone(failedMessages)).toBe(1);

    await writeFakeHermesScript(workDir, successFakeAcpScript());
    const successMessages = await collectMessages(
      agent.execute({ planId: plan.id, originalPrompt: "do work" }),
    );

    expect(agent.getPlan(plan.id)).toBeUndefined();
    expect(countDone(successMessages)).toBe(1);
  });
});

function createAgent(
  workDir: string,
  providerConfig: Record<string, unknown> = {},
  model?: string,
) {
  return new HermesAgent({
    provider: "hermes",
    workDir,
    model,
    providerConfig: {
      hermesPath: process.execPath,
      ...providerConfig,
    },
  });
}

async function createFakeHermesWorkDir(script: string) {
  const workDir = await mkdtemp(join(tmpdir(), "openloomi-hermes-test-"));
  tempDirs.push(workDir);
  await writeFakeHermesScript(workDir, script);
  return workDir;
}

async function writeFakeHermesScript(workDir: string, script: string) {
  await writeFile(join(workDir, "acp"), script, "utf8");
}

function defaultFakeAcpScript() {
  return `
const fs = require("node:fs");
const readline = require("node:readline");

function append(file, value) {
  fs.appendFileSync(file, JSON.stringify(value) + "\\n");
}
function send(value) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\\n");
}
function respond(id, result) {
  send({ id, result });
}
function fail(id, message) {
  send({ id, error: { code: -32000, message } });
}
function update(sessionId, update) {
  send({ method: "session/update", params: { sessionId, update } });
}
function textContent(text) {
  return { type: "text", text };
}

let promptId;
let sessionId = "hermes-session-1";
let waitForCancel = false;

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);

  if (message.method) {
    append("calls.jsonl", { method: message.method, params: message.params });
  }

  if (!message.method && message.id === "permission-1") {
    append("permission-responses.jsonl", message);
    if (waitForCancel) {
      return;
    }
    const optionId = message.result?.outcome?.optionId || message.result?.outcome?.outcome;
    update(sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: textContent("permission:" + optionId)
    });
    respond(promptId, { stopReason: "end_turn" });
    return;
  }

  if (!message.method && message.id === "unsupported-1") {
    append("unsupported.jsonl", message);
    respond(promptId, { stopReason: "end_turn" });
    return;
  }

  switch (message.method) {
    case "initialize":
      respond(message.id, {
        protocolVersion: message.params.protocolVersion,
        agentInfo: { name: "fake-hermes", version: "0.0.0" },
        agentCapabilities: { sessionCapabilities: {} },
      });
      break;
    case "session/new":
      respond(message.id, { sessionId });
      break;
    case "session/set_model":
      respond(message.id, {});
      break;
    case "session/cancel":
      append("cancels.jsonl", message);
      if (promptId) {
        respond(promptId, { stopReason: "cancelled" });
      }
      break;
    case "session/prompt": {
      promptId = message.id;
      const prompt = message.params.prompt.map((block) => block.text || "").join("");
      if (prompt.includes("jsonrpc-error")) {
        fail(message.id, "fake prompt failure");
        return;
      }
      if (prompt.includes("hang forever")) {
        update(sessionId, {
          sessionUpdate: "agent_message_chunk",
          content: textContent("started")
        });
        setInterval(() => {}, 1000);
        return;
      }
      if (prompt.includes("permission")) {
        waitForCancel = prompt.includes("permission wait");
        append("permission-requests.jsonl", { prompt });
        send({
          id: "permission-1",
          method: "session/request_permission",
          params: {
            sessionId,
            toolCall: {
              toolCallId: "tool-2",
              title: "Run command",
              rawInput: { command: "rm -rf /tmp/example" }
            },
            options: [
              { optionId: "allow-always", name: "Allow always", kind: "allow_always" },
              { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
              { optionId: "reject-once", name: "Deny", kind: "reject_once" }
            ]
          }
        });
        return;
      }
      if (prompt.includes("unsupported request")) {
        send({
          id: "unsupported-1",
          method: "terminal/create",
          params: { command: "pwd" }
        });
        return;
      }
      update(sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: textContent("hello")
      });
      update(sessionId, {
        sessionUpdate: "agent_thought_chunk",
        content: textContent("thinking")
      });
      update(sessionId, {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Run command",
        rawInput: { command: "pwd" },
        status: "pending"
      });
      update(sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
        rawOutput: "tool output"
      });
      update(sessionId, {
        sessionUpdate: "usage_update",
        usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 }
      });
      update(sessionId, { sessionUpdate: "unknown_event", raw: true });
      respond(message.id, {
        stopReason: "end_turn",
        usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 }
      });
      break;
    }
    default:
      append("unsupported.jsonl", {
        id: message.id,
        method: message.method,
        error: { code: -32601, message: "unsupported by fake server" }
      });
      send({ id: message.id, error: { code: -32601, message: "unsupported by fake server" } });
  }
});

rl.on("close", () => process.exit(0));
`;
}

function planFakeAcpScript() {
  return `
const readline = require("node:readline");
function send(value) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\\n");
}
function respond(id, result) {
  send({ id, result });
}
function update(sessionId, update) {
  send({ method: "session/update", params: { sessionId, update } });
}
const sessionId = "hermes-session-1";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    respond(message.id, { protocolVersion: message.params.protocolVersion, agentCapabilities: {} });
  } else if (message.method === "session/new") {
    respond(message.id, { sessionId });
  } else if (message.method === "session/prompt") {
    const response = {
      type: "plan",
      goal: "Do work",
      steps: [{ id: "1", description: "Complete implementation" }]
    };
    update(sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: JSON.stringify(response) }
    });
    respond(message.id, { stopReason: "end_turn" });
  }
});
`;
}

function errorFakeAcpScript() {
  return `
const readline = require("node:readline");
function send(value) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\\n");
}
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ id: message.id, result: { protocolVersion: message.params.protocolVersion, agentCapabilities: {} } });
  } else if (message.method === "session/new") {
    send({ id: message.id, result: { sessionId: "hermes-session-1" } });
  } else if (message.method === "session/prompt") {
    send({ id: message.id, error: { code: -32000, message: "execution failed" } });
  }
});
`;
}

function successFakeAcpScript() {
  return `
const readline = require("node:readline");
function send(value) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\\n");
}
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ id: message.id, result: { protocolVersion: message.params.protocolVersion, agentCapabilities: {} } });
  } else if (message.method === "session/new") {
    send({ id: message.id, result: { sessionId: "hermes-session-1" } });
  } else if (message.method === "session/prompt") {
    send({
      method: "session/update",
      params: {
        sessionId: "hermes-session-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "executed" }
        }
      }
    });
    send({ id: message.id, result: { stopReason: "end_turn" } });
  }
});
`;
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

function countDone(messages: AgentMessage[]) {
  return messages.filter((message) => message.type === "done").length;
}

async function readJsonLines(filePath: string) {
  const text = await readFile(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function waitForFile(filePath: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await readFile(filePath, "utf8");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`Timed out waiting for ${filePath}`);
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
