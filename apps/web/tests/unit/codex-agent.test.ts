import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { AgentMessage, TaskPlan } from "@openloomi/ai/agent/types";
import {
  CodexAgent,
  CODEX_INTERRUPTED_MARKER,
  formatCodexInterruptedError,
  parseCodexInterruptedError,
} from "@/lib/ai/extensions/agent/codex";
import {
  buildCodexRunCommand,
  CodexCommandNotFoundError,
  normalizeCodexProviderConfig,
  resolveCodexSandboxMode,
} from "@/lib/ai/extensions/agent/codex/command";
import { parseCodexJsonLine } from "@/lib/ai/extensions/agent/codex/parser";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
});

describe("Codex command builder", () => {
  it("builds the MVP exec --json command with default sandbox + approval", () => {
    const command = buildCodexRunCommand({
      prompt: "fix the failing tests",
      cwd: "/workspace/project",
      model: "gpt-5.4",
      providerConfig: {
        codexPath: "codex-bin",
        profile: "work",
      },
    });

    expect(command.command).toBe("codex-bin");
    expect(command.args).toEqual([
      "exec",
      "--json",
      "-p",
      "work",
      "-m",
      "gpt-5.4",
      "--sandbox",
      process.platform === "darwin" ? "danger-full-access" : "workspace-write",
      "--skip-git-repo-check",
      "fix the failing tests",
    ]);
    expect(command.args).not.toContain("--full-auto");
  });

  it("runs macOS execution turns without the workspace-write sandbox", () => {
    for (const mode of ["run", "execute"] as const) {
      for (const configuredSandbox of [undefined, "workspace-write"] as const) {
        expect(resolveCodexSandboxMode(mode, configuredSandbox, "darwin")).toBe(
          "danger-full-access",
        );
      }
    }
  });

  it("preserves an explicit read-only sandbox for macOS execution", () => {
    expect(resolveCodexSandboxMode("execute", "read-only", "darwin")).toBe(
      "read-only",
    );
  });

  it("keeps workspace-write as the Linux and Windows execution default", () => {
    for (const platform of ["linux", "win32"] as const) {
      expect(resolveCodexSandboxMode("run", undefined, platform)).toBe(
        "workspace-write",
      );
    }
  });

  it("forces read-only sandbox and skips --full-auto during planning", () => {
    const command = buildCodexRunCommand({
      prompt: "draft a plan",
      cwd: "/workspace/project",
      mode: "plan",
      permissionMode: "bypassPermissions",
      providerConfig: { fullAuto: true },
    });

    const sandboxIdx = command.args.indexOf("--sandbox");
    expect(sandboxIdx).toBeGreaterThan(-1);
    expect(command.args[sandboxIdx + 1]).toBe("read-only");
    expect(command.args).not.toContain("--full-auto");
    expect(
      resolveCodexSandboxMode("plan", "danger-full-access", "darwin"),
    ).toBe("read-only");
  });

  it("passes --full-auto only for bypassPermissions with explicit provider opt-in", () => {
    const command = buildCodexRunCommand({
      prompt: "ship it",
      cwd: "/workspace/project",
      permissionMode: "bypassPermissions",
      providerConfig: { fullAuto: true },
    });

    expect(command.args).toContain("--full-auto");
    expect(command.args.at(-1)).toBe("ship it");
  });

  it("does not pass --full-auto for bypassPermissions without explicit opt-in", () => {
    const command = buildCodexRunCommand({
      prompt: "ship it",
      cwd: "/workspace/project",
      permissionMode: "bypassPermissions",
      providerConfig: { fullAuto: false },
    });

    expect(command.args).not.toContain("--full-auto");
  });

  it("rejects unsafe sandbox/approval values and ignores unsafe extraArgs", () => {
    const command = buildCodexRunCommand({
      prompt: "validate input",
      cwd: "/workspace/project",
      providerConfig: {
        sandbox: "danger-full-access",
        askForApproval: "never",
        extraArgs: ["--full-auto", "safe-arg", "--sandbox"],
      },
    });

    expect(command.args).toContain("--sandbox");
    expect(command.args).toContain("danger-full-access");
    // Codex CLI 0.144 dropped `--ask-for-approval`. The config field is
    // still parsed so existing user settings keep loading, but
    // `buildCodexRunCommand` must not emit the flag anymore.
    expect(command.args).not.toContain("--ask-for-approval");
    expect(command.args).not.toContain("never");
    // extraArgs are appended after `--` so they cannot smuggle flags into the
    // global argv; here we just verify the guard value is present.
    const guardIndex = command.args.indexOf("--");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(command.args[guardIndex + 1]).toBe("safe-arg");
    // And the smuggled --full-auto only lands after the guard, so Codex will
    // treat it as the prompt position, not as a flag.
    expect(command.args).toContain("safe-arg");
  });

  it("normalizes timeoutMs from provider config", () => {
    const config = normalizeCodexProviderConfig({ timeoutMs: 12_345 });
    expect(config.timeoutMs).toBe(12_345);

    expect(
      normalizeCodexProviderConfig({ timeoutMs: -5 }).timeoutMs,
    ).toBeUndefined();
    expect(
      normalizeCodexProviderConfig({ timeoutMs: "nope" }).timeoutMs,
    ).toBeUndefined();
  });
});

describe("Codex interrupted marker", () => {
  it("round-trips workspace + completed artifacts through format/parse", () => {
    const raw = formatCodexInterruptedError({
      timeoutMs: 900_000,
      workspacePath: "/workspace/project",
      completedArtifacts: ["data.csv", "report.md"],
    });

    expect(raw.startsWith(CODEX_INTERRUPTED_MARKER)).toBe(true);

    const parsed = parseCodexInterruptedError(raw);
    expect(parsed).toEqual({
      timeoutMs: 900_000,
      workspacePath: "/workspace/project",
      completedArtifacts: ["data.csv", "report.md"],
      canResume: true,
    });
  });

  it("returns null for unrelated errors so callers can chain safely", () => {
    expect(
      parseCodexInterruptedError("Codex CLI exited with code 7"),
    ).toBeNull();
    expect(parseCodexInterruptedError("")).toBeNull();
    expect(
      parseCodexInterruptedError(`${CODEX_INTERRUPTED_MARKER} not-json`),
    ).toBeNull();
  });
});

describe("CodexAgent", () => {
  it("defaults skipGitRepoCheck to true and honours an explicit false", () => {
    expect(normalizeCodexProviderConfig({}).skipGitRepoCheck).toBe(true);
    expect(
      normalizeCodexProviderConfig({ skipGitRepoCheck: false })
        .skipGitRepoCheck,
    ).toBe(false);
  });
});

describe("Codex parser", () => {
  it("ignores empty and invalid JSON lines", () => {
    expect(parseCodexJsonLine("")).toEqual([]);
    expect(parseCodexJsonLine("   ")).toEqual([]);
    expect(parseCodexJsonLine("not-json")).toEqual([]);
  });

  it("projects thread.started into a session message", () => {
    expect(
      parseCodexJsonLine(
        JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
      ),
    ).toEqual([{ type: "session", sessionId: "thread-1" }]);
  });

  it("projects agent_message and reasoning items into text/reasoning", () => {
    expect(
      parseCodexJsonLine(
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "agent_message",
            id: "msg-1",
            text: "hello",
          },
        }),
      ),
    ).toEqual([{ type: "text", content: "hello" }]);

    expect(
      parseCodexJsonLine(
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "reasoning",
            id: "r-1",
            text: "thinking",
          },
        }),
      ),
    ).toEqual([{ type: "reasoning", content: "thinking" }]);
  });

  it("emits tool_use + tool_result for completed command_execution items", () => {
    expect(
      parseCodexJsonLine(
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "command_execution",
            id: "cmd-1",
            command: "pwd",
            aggregated_output: "/workspace/project\n",
            exit_code: 0,
            status: "completed",
          },
        }),
      ),
    ).toEqual([
      {
        type: "tool_result",
        toolUseId: "cmd-1",
        output: "/workspace/project\n",
        isError: false,
      },
    ]);
  });

  it("marks failed command executions with isError: true", () => {
    const messages = parseCodexJsonLine(
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "command_execution",
          id: "cmd-2",
          command: "false",
          aggregated_output: "boom",
          exit_code: 1,
          status: "failed",
        },
      }),
    );
    expect(messages).toEqual([
      {
        type: "tool_result",
        toolUseId: "cmd-2",
        output: "boom",
        isError: true,
      },
    ]);
  });

  it("only emits tool_use for running command_execution items", () => {
    expect(
      parseCodexJsonLine(
        JSON.stringify({
          type: "item.started",
          item: {
            type: "command_execution",
            id: "cmd-3",
            command: "sleep 5",
          },
        }),
      ),
    ).toEqual([
      {
        type: "tool_use",
        id: "cmd-3",
        name: "shell",
        input: { command: "sleep 5" },
      },
    ]);
  });

  it("projects file_change items into tool_use + tool_result with summary", () => {
    expect(
      parseCodexJsonLine(
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "file_change",
            id: "fc-1",
            changes: [
              { path: "src/a.ts", kind: "update" },
              { path: "src/b.ts", kind: "create" },
            ],
          },
        }),
      ),
    ).toEqual([
      {
        type: "tool_result",
        toolUseId: "fc-1",
        output: "update src/a.ts\ncreate src/b.ts",
        isError: false,
      },
    ]);
  });

  it("surfaces Codex self-diagnostics as a non-fatal tool_result, not a fatal error", () => {
    expect(
      parseCodexJsonLine(
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "error",
            id: "err-1",
            message: "tool failed",
          },
        }),
      ),
    ).toEqual([
      {
        type: "tool_result",
        toolUseId: "err-1",
        output: "tool failed",
        isError: false,
      },
    ]);
  });

  it("projects turn.completed usage onto a result message", () => {
    expect(
      parseCodexJsonLine(
        JSON.stringify({
          type: "turn.completed",
          usage: {
            input_tokens: 12,
            cached_input_tokens: 4,
            output_tokens: 6,
          },
        }),
      ),
    ).toEqual([
      {
        type: "result",
        content: "turn.completed",
        usage: { inputTokens: 12, outputTokens: 6 },
      },
    ]);
  });

  it("skips turn.completed usage when not numeric", () => {
    expect(
      parseCodexJsonLine(
        JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: "nope" },
        }),
      ),
    ).toEqual([{ type: "result", content: "turn.completed" }]);
  });

  it("maps top-level error events to an error message", () => {
    expect(
      parseCodexJsonLine(JSON.stringify({ type: "error", message: "boom" })),
    ).toEqual([{ type: "error", message: "boom" }]);
  });

  // Issue #385 — Codex CLI 0.144+ emits non-terminal retry/transport
  // fallback notices using the same top-level `{"type":"error",…}` shape
  // as fatal errors (e.g. "Reconnecting... 2/5 (request timed out)"). These
  // must NOT be projected to a fatal `error` AgentMessage; they are
  // transient status from a still-running turn and the chat UI surfaces
  // them via a brief info toast only.
  it("classifies 'Reconnecting... n/m' as a retry, not a fatal error", () => {
    const messages = parseCodexJsonLine(
      JSON.stringify({
        type: "error",
        message: "Reconnecting... 2/5 (request timed out)",
      }),
    );
    expect(messages).toEqual([
      {
        type: "retry",
        content: "Reconnecting... 2/5 (request timed out)",
        attempt: 2,
        maxAttempts: 5,
      },
    ]);
  });

  it("classifies 'stream disconnected - retrying sampling request (n/m)' as a retry", () => {
    const messages = parseCodexJsonLine(
      JSON.stringify({
        type: "error",
        message: "stream disconnected - retrying sampling request (3/5 ...)",
      }),
    );
    expect(messages).toEqual([
      {
        type: "retry",
        content: "stream disconnected - retrying sampling request (3/5 ...)",
        attempt: 3,
        maxAttempts: 5,
      },
    ]);
  });

  it("classifies 'falling back to HTTP' as a retry without attempt numbers", () => {
    const messages = parseCodexJsonLine(
      JSON.stringify({
        type: "error",
        message: "falling back to HTTP",
      }),
    );
    expect(messages).toEqual([
      {
        type: "retry",
        content: "falling back to HTTP",
      },
    ]);
  });

  it("keeps a fatal Codex exit-code error fatal even when it mentions a transient keyword", () => {
    // A genuine terminal error (here, a non-zero CLI exit) must still
    // surface as `type: "error"` so the chat UI can render exactly one
    // terminal error card per the acceptance criteria of #385.
    const messages = parseCodexJsonLine(
      JSON.stringify({
        type: "error",
        message: "Codex CLI exited with code 7: connection refused",
      }),
    );
    expect(messages).toEqual([
      {
        type: "error",
        message: "Codex CLI exited with code 7: connection refused",
      },
    ]);
  });

  it("ignores unknown event types without crashing", () => {
    expect(
      parseCodexJsonLine(JSON.stringify({ type: "future.event", x: 1 })),
    ).toEqual([]);
  });
});

describe("CodexAgent", () => {
  it("runs a thread, forwards session id, and yields text + result", async () => {
    const workDir = await createFakeCodexWorkDir(defaultFakeCodexScript());
    const agent = new CodexAgent({
      provider: "codex",
      workDir,
      providerConfig: { codexPath: process.execPath },
    });

    const messages = await collectMessages(agent.run("hello codex"));

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "session" }),
        expect.objectContaining({ type: "text", content: "hello" }),
        expect.objectContaining({ type: "tool_use", name: "shell" }),
        expect.objectContaining({
          type: "tool_result",
          output: "/workspace\n",
          isError: false,
        }),
        expect.objectContaining({
          type: "result",
          content: "success",
          usage: { inputTokens: 9, outputTokens: 4 },
        }),
      ]),
    );
    expect(messages.at(-1)?.type).toBe("done");

    const args = JSON.parse(
      await readFile(join(workDir, "args.json"), "utf8"),
    ) as string[];
    expect(args).toContain("--json");
    expect(args).toContain("--sandbox");
    expect(args).toContain(
      process.platform === "darwin" ? "danger-full-access" : "workspace-write",
    );
    // Codex CLI 0.144 dropped `--ask-for-approval`; the argv no longer
    // carries an approval flag.
    expect(args).not.toContain("--ask-for-approval");
    expect(args).toContain("--skip-git-repo-check");
    expect(args.at(-1)).toBe("hello codex");
  });

  it("embeds conversation context into the Codex prompt", async () => {
    const workDir = await createFakeCodexWorkDir(defaultFakeCodexScript());
    const agent = new CodexAgent({
      provider: "codex",
      workDir,
      providerConfig: { codexPath: process.execPath },
    });

    await collectMessages(
      agent.run("current question", {
        conversation: [
          { role: "user", content: "earlier question" },
          { role: "assistant", content: "earlier answer" },
        ],
      }),
    );

    const args = JSON.parse(
      await readFile(join(workDir, "args.json"), "utf8"),
    ) as string[];
    const prompt = args.at(-1) ?? "";
    expect(prompt).toEqual(expect.stringContaining("earlier question"));
    expect(prompt).toEqual(expect.stringContaining("current question"));
  });

  it("converts a nonzero CLI exit into an error message", async () => {
    const workDir = await createFakeCodexWorkDir(`
console.error("simulated failure");
process.exit(7);
`);

    const agent = new CodexAgent({
      provider: "codex",
      workDir,
      providerConfig: { codexPath: process.execPath },
    });

    const messages = await collectMessages(agent.run("do work"));

    expect(messages.find((message) => message.type === "error")).toMatchObject({
      type: "error",
      message: expect.stringContaining("Codex CLI exited with code 7"),
    });
    expect(
      messages.find((message) => message.type === "error")?.message,
    ).toContain("simulated failure");
    expect(messages.at(-1)?.type).toBe("done");
  });

  it("returns a clear error when the codex executable is missing", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "openloomi-codex-test-"));
    tempDirs.push(workDir);

    const agent = new CodexAgent({
      provider: "codex",
      workDir,
      providerConfig: { codexPath: "definitely-not-openloomi-codex" },
    });

    const messages = await collectMessages(agent.run("do work"));

    expect(messages.find((message) => message.type === "error")).toMatchObject({
      type: "error",
      message: expect.stringContaining("Codex CLI executable not found"),
    });
    expect(messages.at(-1)?.type).toBe("done");
  });

  it("surfaces CodexCommandNotFoundError type when codex is missing", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "openloomi-codex-test-"));
    tempDirs.push(workDir);

    const agent = new CodexAgent({
      provider: "codex",
      workDir,
      providerConfig: { codexPath: "definitely-not-openloomi-codex" },
    });

    const messages = await collectMessages(agent.run("anything"));
    const error = messages.find((message) => message.type === "error");
    expect(error?.message).toMatch(/Codex CLI executable not found/);
    // The exported class exists so consumers can `instanceof` narrow errors.
    expect(CodexCommandNotFoundError).toBeDefined();
  });

  it("forces read-only sandbox during planning and never opts into --full-auto", async () => {
    const workDir = await createFakeCodexWorkDir(`
require("node:fs").writeFileSync("args.json", JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({ type: "text", text: JSON.stringify({ type: "direct_answer", answer: "ok" }) }));
`);
    const agent = new CodexAgent({
      provider: "codex",
      workDir,
      providerConfig: { codexPath: process.execPath, fullAuto: true },
    });

    await collectMessages(
      agent.plan("draft a plan", {
        permissionMode: "bypassPermissions",
      }),
    );

    const args = JSON.parse(
      await readFile(join(workDir, "args.json"), "utf8"),
    ) as string[];
    const sandboxIdx = args.indexOf("--sandbox");
    expect(sandboxIdx).toBeGreaterThan(-1);
    expect(args[sandboxIdx + 1]).toBe("read-only");
    expect(args).not.toContain("--full-auto");
  });

  it("retains and deletes plans across successful executions", async () => {
    const workDir = await createFakeCodexWorkDir(`
require("node:fs").writeFileSync("args.json", JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({ type: "text", text: JSON.stringify({
  type: "plan",
  goal: "Do work",
  steps: [{ id: "1", description: "Complete implementation" }]
}) }));
`);

    const agent = new CodexAgent({
      provider: "codex",
      workDir,
      providerConfig: { codexPath: process.execPath },
    });

    const planMessages = await collectMessages(agent.plan("plan the work"));
    const plan = planMessages.find((message) => message.type === "plan")
      ?.plan as TaskPlan | undefined;
    expect(plan).toBeDefined();
    if (!plan) {
      throw new Error("Expected Codex planning to produce a plan");
    }
    const planId = plan.id;
    expect(agent.getPlan(planId)).toBe(plan);

    await writeFakeCodexScript(
      workDir,
      `console.log(JSON.stringify({ type: "text", text: "done" }));`,
    );
    await collectMessages(agent.execute({ planId, originalPrompt: "do work" }));
    expect(agent.getPlan(planId)).toBeUndefined();
  });

  it("decodes UTF-8 JSON events split across stdout chunks", async () => {
    const workDir = await createFakeCodexWorkDir(`
const payload = Buffer.from(JSON.stringify({ type: "item.completed", item: { type: "agent_message", id: "msg-1", text: "你好" } }) + "\\n");
const split = payload.indexOf(Buffer.from("你")) + 1;
process.stdout.write(payload.subarray(0, split));
setTimeout(() => process.stdout.write(payload.subarray(split)), 10);
`);
    const agent = new CodexAgent({
      provider: "codex",
      workDir,
      providerConfig: { codexPath: process.execPath },
    });

    const messages = await collectMessages(agent.run("unicode"));

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", content: "你好" }),
      ]),
    );
  });

  // Issue #385 — non-terminal Codex retry/transport-fallback events must
  // not be projected to a fatal `error` AgentMessage and must not suppress
  // the final success `result`. The chat UI relies on this invariant to
  // avoid rendering duplicate Agent Execution Timeout cards above a
  // successful reply.
  it("treats Codex retry events as transient and still yields a success result", async () => {
    const workDir = await createFakeCodexWorkDir(`
require("node:fs").writeFileSync("args.json", JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({ type: "thread.started", thread_id: "thread-1" }));
// Non-terminal transport-fallback notices that used to be projected as
// fatal error AgentMessages and rendered as duplicate Agent Execution
// Timeout cards. The parser must classify them as retry and the agent
// must keep the turn alive through to the successful reply.
console.log(JSON.stringify({ type: "error", message: "Reconnecting... 2/5 (request timed out)" }));
console.log(JSON.stringify({ type: "error", message: "Reconnecting... 3/5 (request timed out)" }));
console.log(JSON.stringify({ type: "error", message: "stream disconnected - retrying sampling request (4/5 ...)" }));
console.log(JSON.stringify({ type: "error", message: "falling back to HTTP" }));
console.log(JSON.stringify({
  type: "item.completed",
  item: { type: "agent_message", id: "msg-1", text: "测试成功" }
}));
console.log(JSON.stringify({
  type: "turn.completed",
  usage: { input_tokens: 7, output_tokens: 3 }
}));
`);

    const agent = new CodexAgent({
      provider: "codex",
      workDir,
      providerConfig: { codexPath: process.execPath },
    });

    const messages = await collectMessages(agent.run("只回复：测试成功"));

    // No fatal error was emitted — every transport-fallback line is a retry.
    expect(
      messages.find((message) => message.type === "error"),
    ).toBeUndefined();

    // The four retry notices survive as `retry` AgentMessages carrying
    // attempt/maxAttempts where the original text encodes them.
    const retries = messages.filter((message) => message.type === "retry");
    expect(retries).toHaveLength(4);
    expect(retries[0]).toMatchObject({
      type: "retry",
      content: "Reconnecting... 2/5 (request timed out)",
      attempt: 2,
      maxAttempts: 5,
    });
    expect(retries[1]).toMatchObject({
      type: "retry",
      content: "Reconnecting... 3/5 (request timed out)",
      attempt: 3,
      maxAttempts: 5,
    });
    expect(retries[2]).toMatchObject({
      type: "retry",
      content: "stream disconnected - retrying sampling request (4/5 ...)",
      attempt: 4,
      maxAttempts: 5,
    });
    // "falling back to HTTP" carries no attempt numbers.
    expect(retries[3]).toMatchObject({
      type: "retry",
      content: "falling back to HTTP",
    });
    expect((retries[3] as { attempt?: number }).attempt).toBeUndefined();
    expect(
      (retries[3] as { maxAttempts?: number }).maxAttempts,
    ).toBeUndefined();

    // The successful reply still arrives exactly once.
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", content: "测试成功" }),
        expect.objectContaining({
          type: "result",
          content: "success",
          usage: { inputTokens: 7, outputTokens: 3 },
        }),
      ]),
    );
    expect(
      messages.filter((message) => message.type === "result"),
    ).toHaveLength(1);

    expect(messages.at(-1)?.type).toBe("done");
  });

  // Issue #356 — provider-timeout interruption must not leave in-flight tool
  // parts stuck in `executing` and must emit a structured error so the chat
  // UI can offer an explicit Continue action.
  it("emits interrupted tool_results + a structured error when the provider timeout fires", async () => {
    // Hang forever — the agent's timeout is what should kill us.
    const workDir = await createFakeCodexWorkDir(`
require("node:fs").writeFileSync("args.json", JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({ type: "thread.started", thread_id: "thread-1" }));
// A file_change that does land before the deadline so we can verify the
// preservation list reaches the chat UI.
console.log(JSON.stringify({
  type: "item.completed",
  item: { type: "file_change", id: "fc-1", changes: [{ path: "report.md", kind: "create" }] }
}));
// A long-running tool_use that NEVER completes — the timeout must convert
// it into a synthetic interrupted tool_result.
console.log(JSON.stringify({
  type: "item.started",
  item: { type: "command_execution", id: "cmd-hang", command: "sleep 60" }
}));
// Block forever; the agent should kill us via timeoutMs.
setInterval(() => {}, 1000);
`);

    const agent = new CodexAgent({
      provider: "codex",
      workDir,
      providerConfig: { codexPath: process.execPath, timeoutMs: 250 },
    });

    const messages = await collectMessages(agent.run("long task"));

    // The in-flight tool_use must be transitioned to a terminal state so the
    // chat UI does not leave it stuck as "executing" forever.
    const interruptedResult = messages.find(
      (message) =>
        message.type === "tool_result" && message.toolUseId === "cmd-hang",
    );
    expect(interruptedResult).toMatchObject({
      type: "tool_result",
      toolUseId: "cmd-hang",
      isError: true,
    });

    // The error message must carry the interruption marker and a structured
    // payload (workspace + completed artifacts) that the chat UI parses to
    // render the Continue action.
    const error = messages.find(
      (message) =>
        message.type === "error" &&
        typeof message.message === "string" &&
        message.message.startsWith("__CODEX_INTERRUPTED__"),
    );
    expect(error).toBeDefined();
    expect(error?.message).toContain("__CODEX_INTERRUPTED__");
    expect(error?.message).toContain(workDir);
    expect(error?.message).toContain("report.md");
    expect(error?.message).toMatch(/"canResume":\s*true/);

    // The agent still closes with `done` so the SSE stream terminates cleanly
    // and the chat UI does not loop waiting for a result.
    expect(messages.at(-1)?.type).toBe("done");
  });

  // The continuation case from the acceptance criteria: once a previous run
  // has been interrupted, a follow-up run that starts from the same workspace
  // must reuse the artifacts that landed before the timeout rather than
  // restarting collection from scratch.
  it("lets a follow-up run reuse artifacts from an interrupted predecessor", async () => {
    // First run is interrupted mid-tool by the provider timeout.
    const workDir = await createFakeCodexWorkDir(`
require("node:fs").writeFileSync("args.json", JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({ type: "thread.started", thread_id: "thread-1" }));
console.log(JSON.stringify({
  type: "item.completed",
  item: { type: "file_change", id: "fc-1", changes: [{ path: "data.csv", kind: "create" }] }
}));
console.log(JSON.stringify({
  type: "item.started",
  item: { type: "command_execution", id: "cmd-hang", command: "sleep 60" }
}));
setInterval(() => {}, 1000);
`);

    const firstAgent = new CodexAgent({
      provider: "codex",
      workDir,
      providerConfig: { codexPath: process.execPath, timeoutMs: 250 },
    });
    const firstRun = await collectMessages(firstAgent.run("start work"));
    const interruptedError = firstRun.find(
      (message) =>
        message.type === "error" &&
        typeof message.message === "string" &&
        message.message.startsWith("__CODEX_INTERRUPTED__"),
    );
    expect(interruptedError).toBeDefined();

    // Second run uses a fast-finishing fake so we can assert the workspace
    // (and therefore the preserved artifact) is still the same place a
    // continuation would pick up from.
    await writeFakeCodexScript(workDir, defaultFakeCodexScript());

    const secondAgent = new CodexAgent({
      provider: "codex",
      workDir,
      providerConfig: { codexPath: process.execPath },
    });
    const secondRun = await collectMessages(secondAgent.run("continue"));

    expect(secondRun).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "session" }),
        expect.objectContaining({ type: "text", content: "hello" }),
        expect.objectContaining({
          type: "result",
          content: "success",
        }),
      ]),
    );
    // The continuation never restarted the run from scratch — the workspace
    // path is unchanged and the previously-written artifact remains in place.
    expect(secondRun.at(-1)?.type).toBe("done");
  });
});

async function createFakeCodexWorkDir(script: string) {
  const workDir = await mkdtemp(join(tmpdir(), "openloomi-codex-test-"));
  tempDirs.push(workDir);
  await writeFakeCodexScript(workDir, script, "exec");
  return workDir;
}

async function writeFakeCodexScript(
  workDir: string,
  script: string,
  filename = "exec",
) {
  await writeFile(join(workDir, filename), script, "utf8");
}

function defaultFakeCodexScript() {
  // Emits a representative Codex NDJSON event stream:
  // thread.started -> item.started (command_execution) -> item.completed
  // (agent_message + command_execution) -> turn.completed (with usage).
  return `
const args = process.argv.slice(2);
require("node:fs").writeFileSync("args.json", JSON.stringify(args));
console.log(JSON.stringify({ type: "thread.started", thread_id: "thread-1" }));
console.log(JSON.stringify({
  type: "item.started",
  item: { type: "command_execution", id: "cmd-1", command: "pwd" }
}));
console.log(JSON.stringify({
  type: "item.completed",
  item: { type: "command_execution", id: "cmd-1", command: "pwd", aggregated_output: "/workspace\\n", exit_code: 0, status: "completed" }
}));
console.log(JSON.stringify({
  type: "item.completed",
  item: { type: "agent_message", id: "msg-1", text: "hello" }
}));
console.log(JSON.stringify({
  type: "turn.completed",
  usage: { input_tokens: 9, cached_input_tokens: 4, output_tokens: 4 }
}));
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
