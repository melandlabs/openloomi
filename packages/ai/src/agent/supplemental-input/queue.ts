import { z } from "zod";
import type {
  AgentSupplementalInput,
  AgentSupplementalInputIntent,
  AgentSupplementalInputSource,
} from "../types";

export const DEFAULT_SUPPLEMENTAL_INPUT_MAX_PENDING = 128;
// Runtime instructions allow a 256 KiB structured payload. XML escaping can
// expand that payload by roughly 5x, so the live queue needs bounded headroom
// for the formatted representation without rejecting a protocol-valid input.
export const DEFAULT_SUPPLEMENTAL_INPUT_MAX_BYTES = 2 * 1024 * 1024;

const MAX_INPUT_ID_CHARACTERS = 256;
const MAX_CREATED_AT_CHARACTERS = 64;
const MAX_CONFIGURED_PENDING_INPUTS = 10_000;
const MAX_CONFIGURED_INPUT_BYTES = 16 * 1024 * 1024;

export interface AgentSupplementalInputQueueOptions {
  /** Maximum inputs waiting to be yielded. Inputs already yielded do not count. */
  maxPendingInputs?: number;
  /** Maximum UTF-8 size of one input's content. */
  maxInputBytes?: number;
  /** Initial run fence. Inputs without an epoch inherit this value. */
  runEpoch?: number;
}

export type AgentSupplementalInputQueueErrorCode =
  | "closed"
  | "epoch_mismatch"
  | "full"
  | "invalid_input"
  | "multiple_consumers";

export class AgentSupplementalInputQueueError extends Error {
  constructor(
    public readonly code: AgentSupplementalInputQueueErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentSupplementalInputQueueError";
  }
}

export type AgentSupplementalInputInterruptResult =
  | { status: "not_requested" | "unavailable" }
  | { status: "completed"; coalesced: boolean }
  | { status: "failed"; coalesced: boolean; error: Error };

export type AgentSupplementalInputEnqueueResult =
  | {
      status: "accepted";
      input: NormalizedAgentSupplementalInput;
      interrupt: AgentSupplementalInputInterruptResult;
    }
  | {
      status: "duplicate";
      id: string;
      interrupt: { status: "not_requested" };
    };

export type NormalizedAgentSupplementalInput = Readonly<
  AgentSupplementalInput & {
    intent: AgentSupplementalInputIntent;
    runEpoch: number;
  }
>;

interface PendingInput {
  input: NormalizedAgentSupplementalInput;
  releasable: boolean;
}

type IteratorWaiter = (result: IteratorResult<AgentSupplementalInput>) => void;

type InterruptOutcome =
  | { status: "completed" }
  | { status: "failed"; error: Error };

const isoDateTimeSchema = z.iso.datetime({ offset: true });

/**
 * Single-consumer, push-driven input stream for a live agent run.
 *
 * Accepted inputs are delivered FIFO and deduplicated by id for the lifetime
 * of the queue. `inform` inputs remain pending until a provider consumes them
 * with `takePendingInform()` or releases them at a natural boundary. A `steer`
 * input releases all earlier inputs so it cannot overtake them.
 *
 * `close()` rejects new inputs but lets the consumer drain inputs that were
 * already accepted; `abort()` terminates immediately and returns the inputs
 * that had not yet been yielded.
 *
 * A steer input is enqueued before its interrupt handler runs so a provider can
 * observe the input as soon as the interrupted turn returns control. Concurrent
 * steer inputs share one in-flight interrupt request. An interrupt failure does
 * not retract an already accepted input and is reported in the enqueue result.
 */
export class AgentSupplementalInputQueue implements AgentSupplementalInputSource {
  private readonly maxPendingInputs: number;
  private readonly maxInputBytes: number;
  private readonly pending: PendingInput[] = [];
  private readonly waiters: IteratorWaiter[] = [];
  private readonly acceptedIds = new Set<string>();

  private state: "open" | "closed" | "aborted" = "open";
  private activeRunEpoch: number;
  private iteratorCreated = false;
  private interruptHandler: (() => Promise<void> | void) | null = null;
  private interruptInFlight: Promise<InterruptOutcome> | null = null;

  constructor(options: AgentSupplementalInputQueueOptions = {}) {
    this.maxPendingInputs = validatePositiveIntegerOption(
      "maxPendingInputs",
      options.maxPendingInputs ?? DEFAULT_SUPPLEMENTAL_INPUT_MAX_PENDING,
      MAX_CONFIGURED_PENDING_INPUTS,
    );
    this.maxInputBytes = validatePositiveIntegerOption(
      "maxInputBytes",
      options.maxInputBytes ?? DEFAULT_SUPPLEMENTAL_INPUT_MAX_BYTES,
      MAX_CONFIGURED_INPUT_BYTES,
    );
    this.activeRunEpoch = validateRunEpoch(options.runEpoch ?? 0);
  }

  get size(): number {
    return this.pending.length;
  }

  async enqueue(
    candidate: AgentSupplementalInput,
  ): Promise<AgentSupplementalInputEnqueueResult> {
    if (this.state !== "open") {
      throw queueError("closed", "Supplemental input queue is closed");
    }

    const input = normalizeInput(
      candidate,
      this.maxInputBytes,
      this.activeRunEpoch,
    );

    if (input.runEpoch !== this.activeRunEpoch) {
      throw queueError(
        "epoch_mismatch",
        `Supplemental input runEpoch ${input.runEpoch} does not match active runEpoch ${this.activeRunEpoch}`,
      );
    }

    if (this.acceptedIds.has(input.id)) {
      return {
        status: "duplicate",
        id: input.id,
        interrupt: { status: "not_requested" },
      };
    }

    const steerCanReleaseWaitingCapacity =
      input.intent === "steer" && this.waiters.length > 0;
    if (
      this.pending.length >= this.maxPendingInputs &&
      !steerCanReleaseWaitingCapacity
    ) {
      throw queueError(
        "full",
        `Supplemental input queue has reached its ${this.maxPendingInputs}-input limit`,
      );
    }

    this.acceptedIds.add(input.id);
    this.pending.push({ input, releasable: input.intent === "steer" });
    if (input.intent === "steer") {
      this.releaseThrough(input.id);
    }
    this.drainReleasableInputs();

    const interrupt =
      input.intent === "steer"
        ? await this.interrupt()
        : { status: "not_requested" as const };

    return { status: "accepted", input, interrupt };
  }

  setInterruptHandler(handler: (() => Promise<void> | void) | null): void {
    if (handler !== null && typeof handler !== "function") {
      throw queueError(
        "invalid_input",
        "Interrupt handler must be a function or null",
      );
    }
    if (this.state !== "open" && handler !== null) {
      throw queueError(
        "closed",
        "Cannot attach an interrupt handler to a closed queue",
      );
    }
    this.interruptHandler = handler;
  }

  hasPending(): boolean {
    return this.pending.length > 0;
  }

  takePendingInform(): AgentSupplementalInput[] {
    const informs: NormalizedAgentSupplementalInput[] = [];
    while (this.pending[0]?.input.intent === "inform") {
      const entry = this.pending.shift();
      if (entry !== undefined) informs.push(entry.input);
    }

    this.drainReleasableInputs();
    return informs;
  }

  releasePendingInform(): number {
    let released = 0;
    for (const entry of this.pending) {
      if (entry.input.intent === "inform" && !entry.releasable) {
        entry.releasable = true;
        released++;
      }
    }
    this.drainReleasableInputs();
    return released;
  }

  getRunEpoch(): number {
    return this.activeRunEpoch;
  }

  /**
   * Moves the queue to a newer run and removes inputs that can no longer be
   * applied. Inputs already yielded remain fenced by downstream event state.
   */
  advanceRunEpoch(nextRunEpoch: number): AgentSupplementalInput[] {
    const normalizedEpoch = validateRunEpoch(nextRunEpoch);
    if (normalizedEpoch <= this.activeRunEpoch) {
      throw queueError(
        "epoch_mismatch",
        `nextRunEpoch must be greater than active runEpoch ${this.activeRunEpoch}`,
      );
    }

    this.activeRunEpoch = normalizedEpoch;
    const discarded = this.pending.splice(0).map((entry) => entry.input);
    this.drainReleasableInputs();
    return discarded;
  }

  /** Requests the provider interrupt currently bound to this live queue. */
  async interrupt(): Promise<AgentSupplementalInputInterruptResult> {
    if (this.interruptHandler === null) {
      return { status: "unavailable" };
    }

    const activeInterrupt = this.interruptInFlight;
    if (activeInterrupt !== null) {
      return withCoalescedFlag(await activeInterrupt, true);
    }

    const handler = this.interruptHandler;
    const operation: Promise<InterruptOutcome> = Promise.resolve()
      .then(() => handler())
      .then((): InterruptOutcome => ({ status: "completed" }))
      .catch(
        (error: unknown): InterruptOutcome => ({
          status: "failed",
          error: normalizeError(error),
        }),
      );
    this.interruptInFlight = operation;

    try {
      return withCoalescedFlag(await operation, false);
    } finally {
      if (this.interruptInFlight === operation) {
        this.interruptInFlight = null;
      }
    }
  }

  /** Rejects future writes and ends iteration after accepted inputs drain. */
  close(): void {
    if (this.state !== "open") return;
    this.state = "closed";
    this.interruptHandler = null;
    this.acceptedIds.clear();
    for (const entry of this.pending) {
      entry.releasable = true;
    }
    this.drainReleasableInputs();
  }

  /** Terminates immediately and returns inputs that had not yet been yielded. */
  abort(): AgentSupplementalInput[] {
    const discarded = this.pending.splice(0).map((entry) => entry.input);
    this.state = "aborted";
    this.interruptHandler = null;
    this.acceptedIds.clear();
    this.resolveAllWaitersDone();
    return discarded;
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentSupplementalInput> {
    if (this.iteratorCreated) {
      throw queueError(
        "multiple_consumers",
        "Supplemental input queue supports exactly one async consumer",
      );
    }
    this.iteratorCreated = true;

    let finished = false;
    return {
      next: () => {
        if (finished) return Promise.resolve(doneResult());
        return this.next();
      },
      return: () => {
        finished = true;
        this.abort();
        return Promise.resolve(doneResult());
      },
    };
  }

  private next(): Promise<IteratorResult<AgentSupplementalInput>> {
    const entry = this.pending[0];
    if (entry?.releasable) {
      this.pending.shift();
      return Promise.resolve({ value: entry.input, done: false });
    }
    if (this.state !== "open") {
      return Promise.resolve(doneResult());
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private releaseThrough(inputId: string): void {
    for (const entry of this.pending) {
      entry.releasable = true;
      if (entry.input.id === inputId) return;
    }
  }

  private drainReleasableInputs(): void {
    while (this.waiters.length > 0 && this.pending[0]?.releasable) {
      const waiter = this.waiters.shift();
      const entry = this.pending.shift();
      if (waiter === undefined || entry === undefined) break;
      waiter({ value: entry.input, done: false });
    }
    this.finishWaitingConsumersIfDrained();
  }

  private finishWaitingConsumersIfDrained(): void {
    if (this.state !== "open" && this.pending.length === 0) {
      this.resolveAllWaitersDone();
    }
  }

  private resolveAllWaitersDone(): void {
    for (const waiter of this.waiters.splice(0)) {
      waiter(doneResult());
    }
  }
}

function normalizeInput(
  candidate: AgentSupplementalInput,
  maxInputBytes: number,
  activeRunEpoch: number,
): NormalizedAgentSupplementalInput {
  if (candidate === null || typeof candidate !== "object") {
    throw queueError("invalid_input", "Supplemental input must be an object");
  }

  if (typeof candidate.id !== "string") {
    throw queueError("invalid_input", "Supplemental input id must be a string");
  }
  const id = candidate.id.trim();
  if (id.length === 0 || id.length > MAX_INPUT_ID_CHARACTERS) {
    throw queueError(
      "invalid_input",
      `Supplemental input id must contain 1-${MAX_INPUT_ID_CHARACTERS} characters`,
    );
  }

  if (
    typeof candidate.content !== "string" ||
    candidate.content.trim().length === 0
  ) {
    throw queueError(
      "invalid_input",
      "Supplemental input content must be a non-empty string",
    );
  }
  const contentBytes = new TextEncoder().encode(candidate.content).byteLength;
  if (contentBytes > maxInputBytes) {
    throw queueError(
      "invalid_input",
      `Supplemental input content exceeds the ${maxInputBytes}-byte limit`,
    );
  }

  if (
    typeof candidate.createdAt !== "string" ||
    candidate.createdAt.length === 0 ||
    candidate.createdAt.length > MAX_CREATED_AT_CHARACTERS ||
    !isoDateTimeSchema.safeParse(candidate.createdAt).success
  ) {
    throw queueError(
      "invalid_input",
      "Supplemental input createdAt must be an ISO 8601 date-time with a timezone",
    );
  }

  const intent = candidate.intent ?? "steer";
  if (intent !== "steer" && intent !== "inform") {
    throw queueError(
      "invalid_input",
      "Supplemental input intent must be steer or inform",
    );
  }

  const runEpoch =
    candidate.runEpoch === undefined
      ? activeRunEpoch
      : validateRunEpoch(candidate.runEpoch);

  return Object.freeze({
    id,
    content: candidate.content,
    createdAt: candidate.createdAt,
    runEpoch,
    intent,
  });
}

function validateRunEpoch(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw queueError(
      "invalid_input",
      "runEpoch must be a non-negative integer",
    );
  }
  return value;
}

function validatePositiveIntegerOption(
  name: string,
  value: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw queueError(
      "invalid_input",
      `${name} must be an integer between 1 and ${maximum}`,
    );
  }
  return value;
}

function withCoalescedFlag(
  outcome: InterruptOutcome,
  coalesced: boolean,
): AgentSupplementalInputInterruptResult {
  return outcome.status === "completed"
    ? { status: "completed", coalesced }
    : { status: "failed", coalesced, error: outcome.error };
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function doneResult(): IteratorReturnResult<undefined> {
  return { value: undefined, done: true };
}

function queueError(
  code: AgentSupplementalInputQueueErrorCode,
  message: string,
): AgentSupplementalInputQueueError {
  return new AgentSupplementalInputQueueError(code, message);
}
