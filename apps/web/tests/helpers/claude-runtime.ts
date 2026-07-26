import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { vi } from "vitest";

import type {
  ClaudeSdkQueryInput,
  ClaudeSdkTransport,
} from "@/lib/ai/extensions/agent/claude/runtime";

export interface ControlledClaudeQuery {
  readonly query: Query;
  readonly interrupt: ReturnType<typeof vi.fn<() => Promise<void>>>;
  readonly close: ReturnType<typeof vi.fn<() => void>>;
  push(message: SDKMessage): void;
}

export function createControlledClaudeQuery(): ControlledClaudeQuery {
  const pending: SDKMessage[] = [];
  const waiters: Array<(result: IteratorResult<SDKMessage>) => void> = [];
  let closed = false;

  const finish = () => {
    if (closed) return;
    closed = true;
    for (const waiter of waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  };
  const interrupt = vi.fn(async () => {});
  const close = vi.fn(finish);
  const iterator = {
    next: () => {
      const message = pending.shift();
      if (message) return Promise.resolve({ value: message, done: false });
      if (closed) {
        return Promise.resolve({ value: undefined, done: true } as const);
      }
      return new Promise<IteratorResult<SDKMessage>>((resolve) => {
        waiters.push(resolve);
      });
    },
    return: async () => {
      finish();
      return { value: undefined, done: true } as const;
    },
    [Symbol.asyncIterator]() {
      return this;
    },
    interrupt,
    close,
  } as unknown as Query;

  return {
    query: iterator,
    interrupt,
    close,
    push(message: SDKMessage) {
      if (closed) throw new Error("Fake Query is closed");
      const waiter = waiters.shift();
      if (waiter) waiter({ value: message, done: false });
      else pending.push(message);
    },
  };
}

export function createFakeClaudeSdkTransport(handle: ControlledClaudeQuery): {
  transport: ClaudeSdkTransport;
  readonly queryInput: ClaudeSdkQueryInput | undefined;
} {
  let queryInput: ClaudeSdkQueryInput | undefined;
  const transport: ClaudeSdkTransport = {
    startQuery(input) {
      queryInput = input;
      return handle.query;
    },
  };
  return {
    transport,
    get queryInput() {
      return queryInput;
    },
  };
}
