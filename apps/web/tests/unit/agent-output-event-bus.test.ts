import { AgentOutputEventBus } from "@openloomi/ai/agent/runtime";
import { describe, expect, it } from "vitest";

describe("AgentOutputEventBus", () => {
  it("broadcasts the same ordered events to multiple subscribers", async () => {
    const bus = new AgentOutputEventBus<number>({ replayCapacity: 4 });
    const first = bus.subscribe()[Symbol.asyncIterator]();
    const second = bus.subscribe()[Symbol.asyncIterator]();

    await bus.publish(1);
    await bus.publish(2);

    await expect(first.next()).resolves.toEqual({ value: 1, done: false });
    await expect(first.next()).resolves.toEqual({ value: 2, done: false });
    await expect(second.next()).resolves.toEqual({ value: 1, done: false });
    await expect(second.next()).resolves.toEqual({ value: 2, done: false });
    bus.close();
  });

  it("replays the bounded recent window to a late subscriber", async () => {
    const bus = new AgentOutputEventBus<number>({ replayCapacity: 2 });
    await bus.publish(1);
    await bus.publish(2);
    await bus.publish(3);

    const subscriber = bus.subscribe()[Symbol.asyncIterator]();
    await expect(subscriber.next()).resolves.toEqual({ value: 2, done: false });
    await expect(subscriber.next()).resolves.toEqual({ value: 3, done: false });
    bus.close();
    await expect(subscriber.next()).resolves.toEqual({
      value: undefined,
      done: true,
    });
  });

  it("backpressures publication until every subscriber has capacity", async () => {
    const bus = new AgentOutputEventBus<number>({
      subscriberCapacity: 1,
      replayCapacity: 0,
    });
    const first = bus.subscribe({ replay: false })[Symbol.asyncIterator]();
    const second = bus.subscribe({ replay: false })[Symbol.asyncIterator]();
    await bus.publish(1);

    let published = false;
    const blocked = bus.publish(2).then(() => {
      published = true;
    });
    await Promise.resolve();
    expect(published).toBe(false);

    await first.next();
    await Promise.resolve();
    expect(published).toBe(false);

    await second.next();
    await blocked;
    expect(published).toBe(true);
    await expect(first.next()).resolves.toEqual({ value: 2, done: false });
    await expect(second.next()).resolves.toEqual({ value: 2, done: false });
    bus.close();
  });

  it("releases blocked publishers when a slow subscriber disconnects", async () => {
    const bus = new AgentOutputEventBus<number>({
      subscriberCapacity: 1,
      replayCapacity: 0,
    });
    const subscriber = bus.subscribe({ replay: false })[Symbol.asyncIterator]();
    await bus.publish(1);
    const blocked = bus.publish(2);

    await subscriber.return?.(undefined);
    await expect(blocked).resolves.toBeUndefined();
    bus.close();
  });

  it("drains on close and rejects immediately on abort", async () => {
    const drainingBus = new AgentOutputEventBus<string>();
    const draining = drainingBus.subscribe()[Symbol.asyncIterator]();
    await drainingBus.publish("last");
    drainingBus.close();
    await expect(draining.next()).resolves.toEqual({
      value: "last",
      done: false,
    });
    await expect(draining.next()).resolves.toEqual({
      value: undefined,
      done: true,
    });

    const abortedBus = new AgentOutputEventBus<string>();
    const aborted = abortedBus.subscribe()[Symbol.asyncIterator]();
    abortedBus.abort(new Error("provider failed"));
    await expect(aborted.next()).rejects.toMatchObject({
      code: "aborted",
      cause: expect.objectContaining({ message: "provider failed" }),
    });
  });
});
