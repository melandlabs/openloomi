import type {
  HookCallback,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  RUNTIME_INSTRUCTION_SCHEMA_VERSION,
  RuntimeInstructionSchema,
  type RuntimeInstructionTransportPort,
} from "@openloomi/ai/agent/runtime-instructions";
import { AgentSupplementalInputQueue } from "@openloomi/ai/agent/supplemental-input";
import type { AgentSupplementalInputSource } from "@openloomi/ai/agent/types";
import { describe, expect, it, vi } from "vitest";

import {
  ClaudeInputMultiplexer,
  ClaudeGoalRuntimeRegistrationError,
  ClaudeRuntimeSession,
  createClaudeSupplementalInputHooks,
  startClaudeGoalRuntimeSession,
} from "@/lib/ai/extensions/agent/claude/runtime";
import { createInMemoryAgentGoalRuntime } from "@/lib/ai/runtime-instructions/runtime";
import {
  createControlledClaudeQuery,
  createFakeClaudeSdkTransport,
} from "../helpers/claude-runtime";

const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const INSTRUCTION_ID = "22222222-2222-4222-8222-222222222222";
const CREATED_AT = "2026-07-20T00:00:00.000Z";

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function initMessage(): SDKMessage {
  return {
    type: "system",
    subtype: "init",
    session_id: "claude-provider-session",
  } as SDKMessage;
}

function assistantMessage(text: string): SDKMessage {
  return {
    type: "assistant",
    message: { content: [{ type: "text", text }] },
  } as SDKMessage;
}

function resultMessage(): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 10,
    total_cost_usd: 0.01,
    usage: { input_tokens: 4, output_tokens: 2 },
  } as SDKMessage;
}

function runtimeInstruction(overrides: Record<string, unknown> = {}) {
  return RuntimeInstructionSchema.parse({
    schemaVersion: RUNTIME_INSTRUCTION_SCHEMA_VERSION,
    id: INSTRUCTION_ID,
    sequence: 1,
    kind: "context.remove",
    deliveryMode: "steer",
    targetSessionId: SESSION_ID,
    payload: { contextRefId: "jira-176" },
    source: { type: "user", authority: "user" },
    idempotencyKey: "runtime-session-test-1",
    issuedAt: CREATED_AT,
    ...overrides,
  });
}

describe("Claude Goal runtime registration", () => {
  it("registers, resolves, and releases an authenticated Claude runtime", async () => {
    const handle = createControlledClaudeQuery();
    const sdk = createFakeClaudeSdkTransport(handle);
    const runtime = new ClaudeRuntimeSession({
      runtimeSessionId: SESSION_ID,
      runEpoch: 0,
      sdkTransport: sdk.transport,
      logger: logger(),
      createMessageId: () => "message-id",
    });
    const goalRuntime = createInMemoryAgentGoalRuntime();
    const registration = await startClaudeGoalRuntimeSession({
      session: { user: { id: "authenticated-owner" } },
      runtime,
      start: { initialPrompt: "initial request" },
      goalRuntime,
    });

    expect(registration).toMatchObject({
      ownerId: "authenticated-owner",
      runtimeSessionId: SESSION_ID,
    });
    expect(runtime.state).toBe("running");
    await expect(
      goalRuntime.sessions.resolve("authenticated-owner", SESSION_ID),
    ).resolves.toBe(runtime);

    registration?.release();
    await expect(
      goalRuntime.sessions.resolve("authenticated-owner", SESSION_ID),
    ).resolves.toBeNull();
    await runtime.close();
  });

  it.each([
    ["a missing session", undefined],
    ["a blank owner ID", { user: { id: "   " } }],
  ])("does not register %s", async (_case, agentSession) => {
    const handle = createControlledClaudeQuery();
    const sdk = createFakeClaudeSdkTransport(handle);
    const runtime = new ClaudeRuntimeSession({
      runtimeSessionId: SESSION_ID,
      runEpoch: 0,
      sdkTransport: sdk.transport,
      logger: logger(),
      createMessageId: () => "message-id",
    });
    const goalRuntime = createInMemoryAgentGoalRuntime();
    expect(
      await startClaudeGoalRuntimeSession({
        session: agentSession,
        runtime,
        start: { initialPrompt: "initial request" },
        goalRuntime,
      }),
    ).toBeUndefined();
    expect(goalRuntime.sessions.size).toBe(0);
    await runtime.close();
  });

  it("never registers a Claude runtime whose SDK query fails to start", async () => {
    const runtime = new ClaudeRuntimeSession({
      runtimeSessionId: SESSION_ID,
      runEpoch: 0,
      sdkTransport: {
        startQuery() {
          throw new Error("SDK startup failed");
        },
      },
      logger: logger(),
      createMessageId: () => "message-id",
    });
    const goalRuntime = createInMemoryAgentGoalRuntime();

    await expect(
      startClaudeGoalRuntimeSession({
        session: { user: { id: "authenticated-owner" } },
        runtime,
        start: { initialPrompt: "initial request" },
        goalRuntime,
      }),
    ).rejects.toThrow("SDK startup failed");
    expect(runtime.state).toBe("failed");
    expect(goalRuntime.sessions.size).toBe(0);
  });

  it("does not start a Query when live-session registration conflicts", async () => {
    const handle = createControlledClaudeQuery();
    const sdk = createFakeClaudeSdkTransport(handle);
    const runtime = new ClaudeRuntimeSession({
      runtimeSessionId: SESSION_ID,
      runEpoch: 0,
      sdkTransport: sdk.transport,
      logger: logger(),
      createMessageId: () => "message-id",
    });
    const goalRuntime = createInMemoryAgentGoalRuntime();
    const occupiedTransport: RuntimeInstructionTransportPort = {
      runtimeSessionId: SESSION_ID,
      async deliver(instruction) {
        return {
          instructionId: instruction.id,
          runtimeSessionId: SESSION_ID,
          state: "queued",
          recordedAt: CREATED_AT,
        };
      },
      async interrupt() {},
    };
    const occupiedRegistration = goalRuntime.sessions.register({
      ownerId: "authenticated-owner",
      transport: occupiedTransport,
    });

    await expect(
      startClaudeGoalRuntimeSession({
        session: { user: { id: "authenticated-owner" } },
        runtime,
        start: { initialPrompt: "initial request" },
        goalRuntime,
      }),
    ).rejects.toMatchObject({ code: "transport_conflict" });
    expect(sdk.queryInput).toBeUndefined();
    expect(handle.close).not.toHaveBeenCalled();
    expect(runtime.state).toBe("closed");
    await expect(
      goalRuntime.sessions.resolve("authenticated-owner", SESSION_ID),
    ).resolves.toBe(occupiedTransport);

    occupiedRegistration.release();
  });

  it("closes the Query and releases registration when pending replay is rejected", async () => {
    const handle = createControlledClaudeQuery();
    const sdk = createFakeClaudeSdkTransport(handle);
    const runtime = new ClaudeRuntimeSession({
      runtimeSessionId: SESSION_ID,
      runEpoch: 0,
      sdkTransport: sdk.transport,
      logger: logger(),
      createMessageId: () => "message-id",
    });
    const goalRuntime = createInMemoryAgentGoalRuntime();
    vi.spyOn(goalRuntime.goals, "replayPendingInstructions").mockResolvedValue({
      status: "rejected",
      instructionId: INSTRUCTION_ID,
      receipt: {
        instructionId: INSTRUCTION_ID,
        runtimeSessionId: SESSION_ID,
        state: "rejected",
        recordedAt: CREATED_AT,
        reason: "runtime closed",
      },
    });

    await expect(
      startClaudeGoalRuntimeSession({
        session: { user: { id: "authenticated-owner" } },
        runtime,
        start: { initialPrompt: "initial request" },
        goalRuntime,
      }),
    ).rejects.toBeInstanceOf(ClaudeGoalRuntimeRegistrationError);
    expect(handle.close).toHaveBeenCalledOnce();
    expect(runtime.state).toBe("closed");
    expect(goalRuntime.sessions.size).toBe(0);
  });
});

describe("ClaudeRuntimeSession", () => {
  it("owns the SDK Query, captures the Claude session ID, and publishes AgentMessages", async () => {
    const handle = createControlledClaudeQuery();
    const sdk = createFakeClaudeSdkTransport(handle);
    const session = new ClaudeRuntimeSession({
      runtimeSessionId: SESSION_ID,
      runEpoch: 0,
      sdkTransport: sdk.transport,
      logger: logger(),
      createMessageId: () => "message-id",
    });
    const output = session.subscribe()[Symbol.asyncIterator]();

    session.start({ initialPrompt: "initial request" });
    expect(session.state).toBe("running");
    const prompt = sdk.queryInput?.prompt as AsyncIterable<SDKUserMessage>;
    await expect(prompt[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      value: { message: { content: "initial request" } },
    });

    handle.push(initMessage());
    handle.push(assistantMessage("hello from Claude"));
    await expect(output.next()).resolves.toMatchObject({
      value: {
        type: "text",
        content: "hello from Claude",
        messageId: "message-id",
      },
    });
    expect(session.claudeSessionId).toBe("claude-provider-session");

    handle.push(resultMessage());
    await expect(output.next()).resolves.toMatchObject({
      value: { type: "result", content: "success" },
    });
    await Promise.resolve();
    expect(session.state).toBe("idle");
    expect(session.sdkMessageCount).toBe(3);

    await session.close();
    expect(handle.close).toHaveBeenCalledOnce();
    expect(session.state).toBe("closed");
  });

  it("delivers formatted instructions through its live input channel and interrupts the Query", async () => {
    const handle = createControlledClaudeQuery();
    const sdk = createFakeClaudeSdkTransport(handle);
    const session = new ClaudeRuntimeSession({
      runtimeSessionId: SESSION_ID,
      runEpoch: 2,
      sdkTransport: sdk.transport,
      logger: logger(),
      createMessageId: () => "message-id",
    });
    session.start({ initialPrompt: "initial request" });

    const prompt = sdk.queryInput?.prompt as AsyncIterable<SDKUserMessage>;
    const input = prompt[Symbol.asyncIterator]();
    await expect(input.next()).resolves.toMatchObject({
      value: { message: { content: "initial request" } },
    });

    await expect(session.deliver(runtimeInstruction())).resolves.toMatchObject({
      state: "queued",
    });
    await expect(input.next()).resolves.toMatchObject({
      value: {
        priority: "now",
        message: { content: expect.stringContaining("context.remove") },
      },
    });
    expect(handle.interrupt).toHaveBeenCalledOnce();

    await session.interrupt("manual replacement");
    expect(handle.interrupt).toHaveBeenCalledTimes(2);
    session.advanceRunEpoch(3);
    expect(session.runEpoch).toBe(3);
    await session.close();
  });

  it("rejects stale run epochs and invalid state transitions", async () => {
    const handle = createControlledClaudeQuery();
    const sdk = createFakeClaudeSdkTransport(handle);
    const session = new ClaudeRuntimeSession({
      runtimeSessionId: SESSION_ID,
      runEpoch: 4,
      sdkTransport: sdk.transport,
      logger: logger(),
      createMessageId: () => "message-id",
    });
    session.start({ initialPrompt: "initial request" });

    await expect(
      session.interrupt({ reason: "stale", expectedRunEpoch: 3 }),
    ).rejects.toMatchObject({ code: "invalid_run_epoch" });
    expect(() => session.advanceRunEpoch(4)).toThrowError(
      expect.objectContaining({ code: "invalid_run_epoch" }),
    );
    expect(() => session.start({ initialPrompt: "again" })).toThrowError(
      expect.objectContaining({ code: "already_started" }),
    );
    await session.close();
  });
});

describe("Claude runtime input and hooks", () => {
  it("preserves every initial media message before supplemental input", async () => {
    const queue = new AgentSupplementalInputQueue();
    const first = {
      type: "user",
      message: { role: "user", content: "media one" },
      parent_tool_use_id: null,
    } as SDKUserMessage;
    const second = {
      type: "user",
      message: { role: "user", content: "media two" },
      parent_tool_use_id: null,
    } as SDKUserMessage;
    async function* initialMedia() {
      yield first;
      yield second;
    }

    const prompt = new ClaudeInputMultiplexer(
      initialMedia(),
      SESSION_ID,
      queue,
    ).toSdkPrompt() as AsyncIterable<SDKUserMessage>;
    const iterator = prompt[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      value: first,
      done: false,
    });
    await queue.enqueue({
      id: "runtime-update",
      content: "runtime update",
      createdAt: CREATED_AT,
      intent: "steer",
    });
    await expect(iterator.next()).resolves.toEqual({
      value: second,
      done: false,
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { message: { content: "runtime update" }, priority: "now" },
    });
    await iterator.return?.(undefined);
  });

  it("injects informs once at PostToolBatch without hiding source failures", async () => {
    const queue = new AgentSupplementalInputQueue();
    await queue.enqueue({
      id: "inform-at-boundary",
      content: "approval is now available",
      createdAt: CREATED_AT,
      intent: "inform",
    });
    const hooks = createClaudeSupplementalInputHooks({
      supplementalInput: queue,
      sessionId: SESSION_ID,
      logger: logger(),
    });
    const callback = hooks?.PostToolBatch?.[0]?.hooks[0] as HookCallback;
    await expect(
      callback({} as never, undefined, {
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      hookSpecificOutput: {
        additionalContext: expect.stringContaining("approval is now available"),
      },
    });
    expect(queue.hasPending()).toBe(false);

    const runtimeLogger = logger();
    const faultySource = {
      takePendingInform: () => {
        throw new Error("source failed");
      },
      async *[Symbol.asyncIterator]() {},
    } satisfies AgentSupplementalInputSource;
    const faultyHooks = createClaudeSupplementalInputHooks({
      supplementalInput: faultySource,
      sessionId: SESSION_ID,
      logger: runtimeLogger,
    });
    const faultyCallback = faultyHooks?.PostToolBatch?.[0]
      ?.hooks[0] as HookCallback;
    await expect(
      faultyCallback({} as never, undefined, {
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({});
    expect(runtimeLogger.warn).toHaveBeenCalledOnce();
  });
});
