import {
  type AgentSupplementalInputEnqueueResult,
  AgentSupplementalInputQueue,
  AgentSupplementalInputQueueError,
} from "@openloomi/ai/agent/supplemental-input";
import type {
  AgentSupplementalInput,
  AgentSupplementalInputIntent,
} from "@openloomi/ai/agent/types";
import { describe, expect, it, vi } from "vitest";

const CREATED_AT = "2026-07-20T00:00:00.000Z";

function input(
  id: string,
  intent: AgentSupplementalInputIntent = "inform",
  content = `content:${id}`,
): AgentSupplementalInput {
  return { id, content, createdAt: CREATED_AT, intent };
}

function accepted(result: AgentSupplementalInputEnqueueResult) {
  if (result.status !== "accepted") {
    throw new Error(`Expected accepted input, received ${result.status}`);
  }
  return result;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe("AgentSupplementalInputQueue delivery", () => {
  it("delivers queued and waiting inputs in FIFO order", async () => {
    const queue = new AgentSupplementalInputQueue();
    await queue.enqueue(input("first"));
    await queue.enqueue(input("second"));
    expect(queue.releasePendingInform()).toBe(2);

    const iterator = queue[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { id: "first" },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { id: "second" },
    });

    const waiting = iterator.next();
    await queue.enqueue(input("third"));
    expect(queue.releasePendingInform()).toBe(1);
    await expect(waiting).resolves.toMatchObject({
      done: false,
      value: { id: "third" },
    });

    queue.close();
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it("pairs concurrent iterator waiters with concurrent producers without loss", async () => {
    const queue = new AgentSupplementalInputQueue();
    const iterator = queue[Symbol.asyncIterator]();
    const first = iterator.next();
    const second = iterator.next();

    await Promise.all([
      queue.enqueue(input("first")),
      queue.enqueue(input("second")),
    ]);
    expect(queue.releasePendingInform()).toBe(2);

    await expect(first).resolves.toMatchObject({ value: { id: "first" } });
    await expect(second).resolves.toMatchObject({ value: { id: "second" } });
    expect(queue.hasPending()).toBe(false);
    queue.close();
  });

  it("normalizes legacy intent and deduplicates by normalized id", async () => {
    const queue = new AgentSupplementalInputQueue();
    const first = await queue.enqueue({
      id: "  message-1  ",
      content: "redirect the active run",
      createdAt: CREATED_AT,
    });
    const duplicate = await queue.enqueue({
      id: "message-1",
      content: "this duplicate must not be enqueued",
      createdAt: CREATED_AT,
      intent: "inform",
    });

    expect(accepted(first)).toMatchObject({
      input: { id: "message-1", intent: "steer" },
      interrupt: { status: "unavailable" },
    });
    expect(duplicate).toEqual({
      status: "duplicate",
      id: "message-1",
      interrupt: { status: "not_requested" },
    });
    expect(queue.size).toBe(1);
  });

  it("stores an immutable snapshot instead of the producer's object", async () => {
    const queue = new AgentSupplementalInputQueue();
    const candidate = input("immutable", "inform", "original content");
    const result = accepted(await queue.enqueue(candidate));

    candidate.content = "mutated producer content";

    expect(Object.isFrozen(result.input)).toBe(true);
    expect(() => {
      (result.input as { content: string }).content = "mutated result content";
    }).toThrow(TypeError);

    const iterator = queue[Symbol.asyncIterator]();
    queue.releasePendingInform();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { content: "original content" },
    });
  });

  it("fences inputs by run epoch and discards pending work from older runs", async () => {
    const queue = new AgentSupplementalInputQueue({ runEpoch: 5 });
    await queue.enqueue({ ...input("old-inform"), runEpoch: 5 });

    expect(queue.getRunEpoch()).toBe(5);
    expect(queue.advanceRunEpoch(6)).toMatchObject([
      { id: "old-inform", runEpoch: 5 },
    ]);
    expect(queue.hasPending()).toBe(false);
    await expect(
      queue.enqueue({ ...input("late-old-run"), runEpoch: 5 }),
    ).rejects.toMatchObject({ code: "epoch_mismatch" });
    await expect(
      queue.enqueue({ ...input("future-run"), runEpoch: 7 }),
    ).rejects.toMatchObject({ code: "epoch_mismatch" });

    await expect(
      queue.enqueue({ ...input("current-run"), runEpoch: 6 }),
    ).resolves.toMatchObject({
      status: "accepted",
      input: { runEpoch: 6 },
    });
    queue.close();
  });

  it("holds inform input until a provider releases the natural boundary", async () => {
    const queue = new AgentSupplementalInputQueue();
    const iterator = queue[Symbol.asyncIterator]();
    const waiting = iterator.next();
    let settled = false;
    void waiting.then(() => {
      settled = true;
    });

    await queue.enqueue(input("boundary-input"));
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(queue.hasPending()).toBe(true);
    expect(queue.releasePendingInform()).toBe(1);
    expect(queue.releasePendingInform()).toBe(0);
    await expect(waiting).resolves.toMatchObject({
      value: { id: "boundary-input", intent: "inform" },
    });
  });

  it("lets a steer release earlier informs without breaking FIFO", async () => {
    const queue = new AgentSupplementalInputQueue();
    const iterator = queue[Symbol.asyncIterator]();
    const first = iterator.next();
    const second = iterator.next();

    await queue.enqueue(input("inform-first"));
    await queue.enqueue(input("steer-second", "steer"));

    await expect(first).resolves.toMatchObject({
      value: { id: "inform-first" },
    });
    await expect(second).resolves.toMatchObject({
      value: { id: "steer-second" },
    });
  });

  it("applies backpressure only to inputs that have not been yielded", async () => {
    const queue = new AgentSupplementalInputQueue({ maxPendingInputs: 2 });
    await queue.enqueue(input("first"));
    await queue.enqueue(input("second"));

    await expect(queue.enqueue(input("third"))).rejects.toMatchObject({
      code: "full",
    });

    const iterator = queue[Symbol.asyncIterator]();
    queue.releasePendingInform();
    await iterator.next();
    await expect(queue.enqueue(input("third"))).resolves.toMatchObject({
      status: "accepted",
    });
    expect(queue.size).toBe(2);
  });

  it("accepts an urgent steer when its release frees waiting capacity", async () => {
    const queue = new AgentSupplementalInputQueue({ maxPendingInputs: 1 });
    const iterator = queue[Symbol.asyncIterator]();
    const waiting = iterator.next();
    await queue.enqueue(input("held-inform"));

    await expect(queue.enqueue(input("another-inform"))).rejects.toMatchObject({
      code: "full",
    });
    await expect(
      queue.enqueue(input("urgent-steer", "steer")),
    ).resolves.toMatchObject({ status: "accepted" });

    await expect(waiting).resolves.toMatchObject({
      value: { id: "held-inform" },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { id: "urgent-steer" },
    });
    expect(queue.size).toBe(0);
  });

  it("takes only leading informs so later input cannot overtake a steer", async () => {
    const queue = new AgentSupplementalInputQueue();
    await queue.enqueue(input("inform-1"));
    await queue.enqueue(input("steer-1", "steer"));
    await queue.enqueue(input("inform-2"));

    expect(queue.takePendingInform().map((item) => item.id)).toEqual([
      "inform-1",
    ]);
    expect(queue.takePendingInform()).toEqual([]);
    expect(queue.size).toBe(2);

    const iterator = queue[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { id: "steer-1", intent: "steer" },
    });
    expect(queue.takePendingInform().map((item) => item.id)).toEqual([
      "inform-2",
    ]);
  });

  it("allows a tool boundary to consume inform before a waiting iterator", async () => {
    const queue = new AgentSupplementalInputQueue();
    const iterator = queue[Symbol.asyncIterator]();
    const waiting = iterator.next();

    await queue.enqueue(input("tool-boundary"));

    expect(queue.takePendingInform()).toMatchObject([
      { id: "tool-boundary", intent: "inform" },
    ]);
    queue.close();
    await expect(waiting).resolves.toEqual({ done: true, value: undefined });
  });
});

describe("AgentSupplementalInputQueue interruption", () => {
  it("coalesces concurrent steer inputs into one in-flight interrupt", async () => {
    const queue = new AgentSupplementalInputQueue();
    const releaseInterrupt = deferred<void>();
    const interruptHandler = vi.fn(async () => {
      expect(queue.hasPending()).toBe(true);
      await releaseInterrupt.promise;
    });
    queue.setInterruptHandler(interruptHandler);

    const first = queue.enqueue(input("steer-1", "steer"));
    await Promise.resolve();
    const second = queue.enqueue(input("steer-2", "steer"));
    await Promise.resolve();

    expect(interruptHandler).toHaveBeenCalledTimes(1);
    releaseInterrupt.resolve();

    expect(accepted(await first).interrupt).toEqual({
      status: "completed",
      coalesced: false,
    });
    expect(accepted(await second).interrupt).toEqual({
      status: "completed",
      coalesced: true,
    });
  });

  it("never interrupts for inform or duplicate inputs", async () => {
    const queue = new AgentSupplementalInputQueue();
    const interruptHandler = vi.fn();
    queue.setInterruptHandler(interruptHandler);

    const inform = await queue.enqueue(input("inform", "inform"));
    const steer = await queue.enqueue(input("steer", "steer"));
    const duplicate = await queue.enqueue(input("steer", "steer"));

    expect(accepted(inform).interrupt).toEqual({ status: "not_requested" });
    expect(accepted(steer).interrupt).toEqual({
      status: "completed",
      coalesced: false,
    });
    expect(duplicate.status).toBe("duplicate");
    expect(interruptHandler).toHaveBeenCalledTimes(1);
  });

  it("reports interrupt failure without retracting the accepted input", async () => {
    const queue = new AgentSupplementalInputQueue();
    queue.setInterruptHandler(() => {
      throw new Error("provider interrupt failed");
    });

    const result = accepted(await queue.enqueue(input("steer", "steer")));

    expect(result.interrupt).toMatchObject({
      status: "failed",
      coalesced: false,
      error: expect.objectContaining({ message: "provider interrupt failed" }),
    });
    expect(queue.size).toBe(1);
  });
});

describe("AgentSupplementalInputQueue lifecycle", () => {
  it("closes gracefully after draining accepted inputs", async () => {
    const queue = new AgentSupplementalInputQueue();
    await queue.enqueue(input("accepted"));
    const iterator = queue[Symbol.asyncIterator]();

    queue.close();

    await expect(queue.enqueue(input("late"))).rejects.toMatchObject({
      code: "closed",
    });
    expect(() => queue.setInterruptHandler(() => undefined)).toThrow(
      expect.objectContaining({ code: "closed" }),
    );
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { id: "accepted" },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it("aborts immediately and returns inputs that were not yielded", async () => {
    const queue = new AgentSupplementalInputQueue();
    await queue.enqueue(input("first"));
    await queue.enqueue(input("second"));

    expect(queue.abort().map((item) => item.id)).toEqual(["first", "second"]);
    expect(queue.size).toBe(0);

    const iterator = queue[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it("aborts a waiting consumer and returns a held inform", async () => {
    const queue = new AgentSupplementalInputQueue();
    const iterator = queue[Symbol.asyncIterator]();
    const waiting = iterator.next();

    await queue.enqueue(input("held-inform"));

    expect(queue.abort().map((item) => item.id)).toEqual(["held-inform"]);
    await expect(waiting).resolves.toEqual({ done: true, value: undefined });
  });

  it("allows exactly one async consumer", () => {
    const queue = new AgentSupplementalInputQueue();
    queue[Symbol.asyncIterator]();

    expect(() => queue[Symbol.asyncIterator]()).toThrow(
      expect.objectContaining({ code: "multiple_consumers" }),
    );
  });
});

describe("AgentSupplementalInputQueue validation", () => {
  it("rejects invalid configuration and malformed inputs", async () => {
    expect(
      () => new AgentSupplementalInputQueue({ maxPendingInputs: 0 }),
    ).toThrow(AgentSupplementalInputQueueError);

    const queue = new AgentSupplementalInputQueue({ maxInputBytes: 4 });
    await expect(
      queue.enqueue(input("too-large", "inform", "你好")),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      queue.enqueue({
        id: "bad-date",
        content: "content",
        createdAt: "not-a-date",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      queue.enqueue({
        id: "date-without-timezone",
        content: "content",
        createdAt: "2026-07-20T00:00:00",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      queue.enqueue({ id: " ", content: "content", createdAt: CREATED_AT }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});
