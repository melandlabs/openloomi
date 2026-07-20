export const DEFAULT_AGENT_OUTPUT_SUBSCRIBER_CAPACITY = 256;
export const DEFAULT_AGENT_OUTPUT_REPLAY_CAPACITY = 256;

const MAX_OUTPUT_CAPACITY = 10_000;

export type AgentOutputEventBusErrorCode =
  | "aborted"
  | "closed"
  | "invalid_capacity";

export class AgentOutputEventBusError extends Error {
  constructor(
    public readonly code: AgentOutputEventBusErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AgentOutputEventBusError";
  }
}

export interface AgentOutputEventBusOptions {
  /** Maximum events buffered independently for each subscriber. */
  subscriberCapacity?: number;
  /** Recent events retained for subscribers that join after publication. */
  replayCapacity?: number;
}

export interface AgentOutputSubscriptionOptions {
  /** Replays the retained event window. Defaults to true. */
  replay?: boolean;
}

interface Subscriber<T> {
  id: number;
  pending: T[];
  waiters: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: unknown) => void;
  }>;
  capacityWaiters: Array<() => void>;
  active: boolean;
}

/**
 * Multi-subscriber event bus with bounded per-subscriber buffers.
 *
 * Publication is serialized and waits for every active subscriber to have
 * capacity, so a slow subscriber applies backpressure without causing another
 * subscriber to miss or reorder events. A subscriber that no longer wants
 * output must return its iterator, which releases any blocked publisher.
 */
export class AgentOutputEventBus<T> {
  private readonly subscriberCapacity: number;
  private readonly replayCapacity: number;
  private readonly subscribers = new Map<number, Subscriber<T>>();
  private readonly replay: T[] = [];

  private state: "open" | "closed" | "aborted" = "open";
  private abortError: AgentOutputEventBusError | null = null;
  private nextSubscriberId = 1;
  private publishTail: Promise<void> = Promise.resolve();

  constructor(options: AgentOutputEventBusOptions = {}) {
    this.subscriberCapacity = validateCapacity(
      "subscriberCapacity",
      options.subscriberCapacity ?? DEFAULT_AGENT_OUTPUT_SUBSCRIBER_CAPACITY,
      false,
    );
    this.replayCapacity = validateCapacity(
      "replayCapacity",
      options.replayCapacity ?? DEFAULT_AGENT_OUTPUT_REPLAY_CAPACITY,
      true,
    );
  }

  /**
   * Publishes one event atomically to the current subscriber set. Concurrent
   * publishers are serialized so every subscriber observes the same order.
   */
  publish(event: T): Promise<void> {
    const operation = this.publishTail.then(() => this.publishOne(event));
    this.publishTail = operation.catch(() => {});
    return operation;
  }

  subscribe(options: AgentOutputSubscriptionOptions = {}): AsyncIterable<T> {
    const subscriber: Subscriber<T> = {
      id: this.nextSubscriberId++,
      pending:
        options.replay === false
          ? []
          : this.replay.slice(-this.subscriberCapacity),
      waiters: [],
      capacityWaiters: [],
      active: true,
    };
    this.subscribers.set(subscriber.id, subscriber);

    let iteratorCreated = false;
    return {
      [Symbol.asyncIterator]: () => {
        if (iteratorCreated) {
          throw new AgentOutputEventBusError(
            "closed",
            "An output subscription supports exactly one iterator",
          );
        }
        iteratorCreated = true;
        return this.createIterator(subscriber);
      },
    };
  }

  /** Stops publication and lets subscribers drain events already buffered. */
  close(): void {
    if (this.state !== "open") return;
    this.state = "closed";
    this.releaseAllCapacityWaiters();
    for (const subscriber of this.subscribers.values()) {
      this.finishSubscriberIfDrained(subscriber);
    }
  }

  /** Stops immediately and rejects all current and future subscriber reads. */
  abort(cause: unknown): void {
    if (this.state !== "open") return;
    this.state = "aborted";
    this.abortError = new AgentOutputEventBusError(
      "aborted",
      "Agent output event bus aborted",
      cause,
    );
    this.releaseAllCapacityWaiters();
    for (const subscriber of this.subscribers.values()) {
      subscriber.active = false;
      subscriber.pending.splice(0);
      for (const waiter of subscriber.waiters.splice(0)) {
        waiter.reject(this.abortError);
      }
    }
    this.subscribers.clear();
  }

  private async publishOne(event: T): Promise<void> {
    this.assertPublishable();
    const subscribers = [...this.subscribers.values()].filter(
      (subscriber) => subscriber.active,
    );

    await Promise.all(
      subscribers.map((subscriber) => this.waitForCapacity(subscriber)),
    );
    this.assertPublishable();

    this.replay.push(event);
    if (this.replay.length > this.replayCapacity) {
      this.replay.splice(0, this.replay.length - this.replayCapacity);
    }

    for (const subscriber of subscribers) {
      if (!subscriber.active) continue;
      const waiter = subscriber.waiters.shift();
      if (waiter) {
        waiter.resolve({ value: event, done: false });
      } else {
        subscriber.pending.push(event);
      }
    }
  }

  private waitForCapacity(subscriber: Subscriber<T>): Promise<void> {
    if (
      !subscriber.active ||
      subscriber.waiters.length > 0 ||
      subscriber.pending.length < this.subscriberCapacity
    ) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      subscriber.capacityWaiters.push(resolve);
    });
  }

  private createIterator(subscriber: Subscriber<T>): AsyncIterator<T> {
    let finished = false;
    return {
      next: () => {
        if (finished) return Promise.resolve(doneResult());
        return this.next(subscriber);
      },
      return: () => {
        if (!finished) {
          finished = true;
          this.removeSubscriber(subscriber);
        }
        return Promise.resolve(doneResult());
      },
    };
  }

  private next(subscriber: Subscriber<T>): Promise<IteratorResult<T>> {
    if (this.state === "aborted") {
      this.removeSubscriber(subscriber);
      return Promise.reject(this.abortError);
    }

    if (subscriber.pending.length > 0) {
      const event = subscriber.pending.shift() as T;
      this.releaseCapacityWaiter(subscriber);
      return Promise.resolve({ value: event, done: false });
    }
    if (!subscriber.active || this.state === "closed") {
      this.removeSubscriber(subscriber);
      return Promise.resolve(doneResult());
    }

    return new Promise((resolve, reject) => {
      subscriber.waiters.push({ resolve, reject });
    });
  }

  private removeSubscriber(subscriber: Subscriber<T>): void {
    if (!subscriber.active) return;
    subscriber.active = false;
    subscriber.pending.splice(0);
    this.subscribers.delete(subscriber.id);
    for (const waiter of subscriber.waiters.splice(0)) {
      waiter.resolve(doneResult());
    }
    for (const release of subscriber.capacityWaiters.splice(0)) release();
  }

  private finishSubscriberIfDrained(subscriber: Subscriber<T>): void {
    if (subscriber.pending.length > 0) return;
    for (const waiter of subscriber.waiters.splice(0)) {
      waiter.resolve(doneResult());
    }
    this.removeSubscriber(subscriber);
  }

  private releaseCapacityWaiter(subscriber: Subscriber<T>): void {
    const release = subscriber.capacityWaiters.shift();
    release?.();
  }

  private releaseAllCapacityWaiters(): void {
    for (const subscriber of this.subscribers.values()) {
      for (const release of subscriber.capacityWaiters.splice(0)) release();
    }
  }

  private assertPublishable(): void {
    if (this.state === "aborted") throw this.abortError;
    if (this.state === "closed") {
      throw new AgentOutputEventBusError(
        "closed",
        "Cannot publish to a closed agent output event bus",
      );
    }
  }
}

function validateCapacity(
  name: string,
  value: number,
  allowZero: boolean,
): number {
  const minimum = allowZero ? 0 : 1;
  if (
    !Number.isInteger(value) ||
    value < minimum ||
    value > MAX_OUTPUT_CAPACITY
  ) {
    throw new AgentOutputEventBusError(
      "invalid_capacity",
      `${name} must be an integer between ${minimum} and ${MAX_OUTPUT_CAPACITY}`,
    );
  }
  return value;
}

function doneResult(): IteratorReturnResult<undefined> {
  return { value: undefined, done: true };
}
