import type {
  HookCallback,
  Query,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { AgentSupplementalInputQueue } from "@openloomi/ai/agent/supplemental-input";
import type { AgentSupplementalInputSource } from "@openloomi/ai/agent/types";
import { describe, expect, it, vi } from "vitest";

import {
  createClaudeStreamingPrompt,
  createClaudeSupplementalInputHooks,
  startClaudeLiveQuery,
} from "@/lib/ai/extensions/agent/claude/live-input";

const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const CREATED_AT = "2026-07-20T00:00:00.000Z";

function logger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function sdkMessage(content: string): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
    session_id: SESSION_ID,
  };
}

function fakeQuery() {
  const interrupt = vi.fn(async () => {});
  const close = vi.fn();
  const query = {
    interrupt,
    close,
  } as unknown as Query;
  return { query, interrupt, close };
}

describe("Claude live input prompt", () => {
  it("keeps one-shot prompts unchanged when no live source is supplied", () => {
    const handle = fakeQuery();
    const queryFactory = vi.fn(() => handle.query);
    const liveQuery = startClaudeLiveQuery({
      queryFactory,
      initialPrompt: "initial request",
      options: { model: "claude-test" },
      sessionId: SESSION_ID,
      logger: logger(),
    });

    expect(queryFactory).toHaveBeenCalledWith({
      prompt: "initial request",
      options: { model: "claude-test" },
    });
    liveQuery.dispose();
    expect(handle.close).not.toHaveBeenCalled();
  });

  it("streams the initial prompt before released inform and steer inputs", async () => {
    const queue = new AgentSupplementalInputQueue();
    const handle = fakeQuery();
    let prompt: string | AsyncIterable<SDKUserMessage> | undefined;
    const liveQuery = startClaudeLiveQuery({
      queryFactory: (input) => {
        prompt = input.prompt;
        return handle.query;
      },
      initialPrompt: "initial request",
      supplementalInput: queue,
      sessionId: SESSION_ID,
      logger: logger(),
    });

    expect(typeof prompt).not.toBe("string");
    const iterator = (prompt as AsyncIterable<SDKUserMessage>)[
      Symbol.asyncIterator
    ]();
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: {
        type: "user",
        message: { role: "user", content: "initial request" },
        session_id: SESSION_ID,
      },
    });

    await queue.enqueue({
      id: "inform-1",
      content: "apply this at the next boundary",
      createdAt: CREATED_AT,
      intent: "inform",
    });
    expect(queue.hasPending()).toBe(true);
    expect(liveQuery.releaseBoundary()).toBe(1);
    await expect(iterator.next()).resolves.toMatchObject({
      value: {
        message: {
          content: "apply this at the next boundary",
        },
        priority: "next",
        shouldQuery: true,
        timestamp: CREATED_AT,
      },
    });

    const nextSteer = iterator.next();
    await queue.enqueue({
      id: "steer-1",
      content: "change direction now",
      createdAt: CREATED_AT,
      intent: "steer",
    });
    await expect(nextSteer).resolves.toMatchObject({
      value: {
        message: { content: "change direction now" },
        priority: "now",
      },
    });
    expect(handle.interrupt).toHaveBeenCalledOnce();

    liveQuery.dispose();
    liveQuery.dispose();
    expect(handle.close).toHaveBeenCalledOnce();
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it("preserves every media message before consuming supplemental input", async () => {
    const queue = new AgentSupplementalInputQueue();
    const first = sdkMessage("media message one");
    const second = sdkMessage("media message two");
    async function* mediaPrompt() {
      yield first;
      yield second;
    }

    const prompt = createClaudeStreamingPrompt({
      initialPrompt: mediaPrompt(),
      supplementalInput: queue,
      sessionId: SESSION_ID,
    });
    const iterator = prompt[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      value: first,
      done: false,
    });
    await queue.enqueue({
      id: "steer-after-media",
      content: "runtime update",
      createdAt: CREATED_AT,
      intent: "steer",
    });
    await expect(iterator.next()).resolves.toEqual({
      value: second,
      done: false,
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { message: { content: "runtime update" } },
      done: false,
    });
    await iterator.return?.(undefined);
  });

  it("closes the source when query creation fails", () => {
    const close = vi.fn();
    const source = {
      close,
      async *[Symbol.asyncIterator]() {},
    } satisfies AgentSupplementalInputSource;

    expect(() =>
      startClaudeLiveQuery({
        queryFactory: () => {
          throw new Error("query failed");
        },
        initialPrompt: "initial request",
        supplementalInput: source,
        sessionId: SESSION_ID,
        logger: logger(),
      }),
    ).toThrow("query failed");
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("Claude supplemental input hooks", () => {
  it("atomically adds pending informs to the post-tool batch context", async () => {
    const queue = new AgentSupplementalInputQueue();
    await queue.enqueue({
      id: "inform-at-tool-boundary",
      content: "the external approval is now available",
      createdAt: CREATED_AT,
      intent: "inform",
    });

    const hooks = createClaudeSupplementalInputHooks({
      supplementalInput: queue,
      sessionId: SESSION_ID,
      logger: logger(),
    });
    const callback = hooks?.PostToolBatch?.[0]?.hooks[0] as HookCallback;
    const output = await callback({} as never, undefined, {
      signal: new AbortController().signal,
    });

    expect(output).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PostToolBatch",
        additionalContext: expect.stringContaining(
          "the external approval is now available",
        ),
      },
    });
    expect(queue.hasPending()).toBe(false);
    await expect(
      callback({} as never, undefined, {
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({});
  });

  it("does not let a faulty source hide the tool result", async () => {
    const runtimeLogger = logger();
    const source = {
      takePendingInform: () => {
        throw new Error("source failed");
      },
      async *[Symbol.asyncIterator]() {},
    } satisfies AgentSupplementalInputSource;
    const hooks = createClaudeSupplementalInputHooks({
      supplementalInput: source,
      sessionId: SESSION_ID,
      logger: runtimeLogger,
    });
    const callback = hooks?.PostToolBatch?.[0]?.hooks[0] as HookCallback;

    await expect(
      callback({} as never, undefined, {
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({});
    expect(runtimeLogger.warn).toHaveBeenCalledOnce();
  });
});
