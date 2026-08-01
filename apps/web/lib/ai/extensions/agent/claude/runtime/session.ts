import type {
  Options,
  Query,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { assertRuntimeSessionStateTransition } from "@openloomi/ai/agent/runtime-instructions";
import type {
  RuntimeDeliveryReceipt,
  RuntimeInstruction,
  RuntimeRunEpochAdvanceResult,
  RuntimeSessionLifecycleControlPort,
  RuntimeSessionState,
  RuntimeTerminalInputHold,
  RuntimeTurnBoundary,
  RuntimeTurnBoundaryInputHold,
  RuntimeTurnTerminal,
} from "@openloomi/ai/agent/runtime-instructions";
import { AgentOutputEventBus } from "@openloomi/ai/agent/runtime";
import {
  AgentSupplementalInputQueue,
  SupplementalInputRuntimeInstructionTransport,
  type AgentSupplementalInputHold,
} from "@openloomi/ai/agent/supplemental-input";
import type {
  AgentMessage,
  AgentSupplementalInput,
  AgentSupplementalInputSource,
} from "@openloomi/ai/agent/types";

import type { ClaudeRuntimeLogger } from "../skills";
import type {
  ClaudeRuntimeEventObserverPort,
  ClaudeRuntimeToolOutcome,
  ClaudeRuntimeToolStart,
} from "./event-observer";
import { ClaudeInputMultiplexer } from "./input-multiplexer";
import { ClaudeOutputMultiplexer } from "./output-multiplexer";
import type { ClaudeSdkTransport } from "./sdk-transport";

export interface ClaudeRuntimeSessionOptions {
  runtimeSessionId: string;
  runEpoch: number;
  sdkTransport: ClaudeSdkTransport;
  logger: ClaudeRuntimeLogger;
  createMessageId: () => string;
  supplementalInput?: AgentSupplementalInputSource;
}

interface TerminalWaiter {
  expectedRunEpoch: number;
  afterTerminalSequence: number;
  resolve: (terminal: RuntimeTurnTerminal) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/**
 * Owns one Claude SDK Query and exposes an OpenLoomi runtime-session boundary.
 * Goal lifecycle and persistence intentionally remain outside this class.
 */
export class ClaudeRuntimeSession implements RuntimeSessionLifecycleControlPort {
  readonly runtimeSessionId: string;

  private readonly sdkTransport: ClaudeSdkTransport;
  private readonly logger: ClaudeRuntimeLogger;
  private readonly output: AgentOutputEventBus<AgentMessage>;
  private readonly outputMultiplexer: ClaudeOutputMultiplexer;
  private readonly inputQueue: AgentSupplementalInputQueue;
  private readonly instructionTransport: SupplementalInputRuntimeInstructionTransport;
  private readonly externalInput?: AgentSupplementalInputSource;

  private query: Query | null = null;
  private outputPump: Promise<void> | null = null;
  private currentState: RuntimeSessionState = "starting";
  private processedSdkMessages = 0;
  private closing = false;
  private providerOutputEpoch: number;
  private terminalSequence = 0;
  private readonly terminalHistory: RuntimeTurnTerminal[] = [];
  private readonly terminalWaiters = new Set<TerminalWaiter>();
  private eventObserver: ClaudeRuntimeEventObserverPort | null = null;

  claudeSessionId?: string;

  constructor(options: ClaudeRuntimeSessionOptions) {
    assertRunEpoch(options.runEpoch);
    this.runtimeSessionId = options.runtimeSessionId;
    this.providerOutputEpoch = options.runEpoch;
    this.sdkTransport = options.sdkTransport;
    this.logger = options.logger;
    this.output = new AgentOutputEventBus<AgentMessage>();
    this.outputMultiplexer = new ClaudeOutputMultiplexer(
      options.createMessageId,
    );

    if (options.supplementalInput instanceof AgentSupplementalInputQueue) {
      this.inputQueue = options.supplementalInput;
    } else {
      this.inputQueue = new AgentSupplementalInputQueue({
        runEpoch: options.runEpoch,
      });
      this.externalInput = options.supplementalInput;
    }

    this.instructionTransport =
      new SupplementalInputRuntimeInstructionTransport({
        runtimeSessionId: options.runtimeSessionId,
        runEpoch: options.runEpoch,
        queue: this.inputQueue,
      });
  }

  get state(): RuntimeSessionState {
    return this.currentState;
  }

  get runEpoch(): number {
    return this.inputQueue.getRunEpoch();
  }

  get liveInputSource(): AgentSupplementalInputSource {
    return this.inputQueue;
  }

  get sdkMessageCount(): number {
    return this.processedSdkMessages;
  }

  attachEventObserver(observer: ClaudeRuntimeEventObserverPort): void {
    if (this.query || this.currentState !== "starting") {
      throw new ClaudeRuntimeSessionError(
        "already_started",
        "Claude runtime event observer must be attached before start",
      );
    }
    if (this.eventObserver && this.eventObserver !== observer) {
      throw new ClaudeRuntimeSessionError(
        "observer_already_attached",
        "Claude runtime session already has an event observer",
      );
    }
    this.eventObserver = observer;
  }

  start(input: {
    initialPrompt: string | AsyncIterable<SDKUserMessage>;
    queryOptions?: Options;
  }): void {
    if (this.query || this.currentState !== "starting") {
      throw new ClaudeRuntimeSessionError(
        "already_started",
        "Claude runtime session can only be started once",
      );
    }

    this.inputQueue.setHandoffHandler((supplementalInput) => {
      this.observeSupplementalInputHandoff(supplementalInput);
      void this.observeInstructionWritten(
        supplementalInput.id,
        supplementalInput.runEpoch,
      );
    });
    const multiplexer = new ClaudeInputMultiplexer(
      input.initialPrompt,
      this.runtimeSessionId,
      this.inputQueue,
    );
    try {
      this.query = this.sdkTransport.startQuery({
        prompt: multiplexer.toSdkPrompt(),
        options: input.queryOptions,
      });
      this.inputQueue.setInterruptHandler(() => this.query?.interrupt());
      this.transition("running");
      this.outputPump = this.pumpQuery(this.query);
      if (this.externalInput) {
        void this.pumpExternalInput(this.externalInput);
      }
    } catch (error) {
      try {
        this.query?.close();
      } catch {
        // Preserve the original startup failure.
      }
      this.inputQueue.close();
      this.output.abort(error);
      this.transition("failed");
      throw error;
    }
  }

  subscribe(): AsyncIterable<AgentMessage> {
    return this.output.subscribe();
  }

  async deliver(
    instruction: RuntimeInstruction,
  ): Promise<RuntimeDeliveryReceipt> {
    const idle = this.currentState === "idle";
    const receipt = await this.instructionTransport.deliver(instruction, {
      interruptControl: !idle,
      interruptSteer: !idle,
    });
    if (receipt.state !== "queued" || !this.query) return receipt;

    if (
      instruction.kind === "control.interrupt" ||
      instruction.kind === "goal.pause" ||
      instruction.kind === "goal.cancel"
    ) {
      await this.observeInstructionWritten(
        instruction.id,
        instruction.payload.expectedRunEpoch,
      );
      if (
        this.runEpoch === instruction.payload.expectedRunEpoch &&
        (this.currentState === "running" || this.currentState === "evaluating")
      ) {
        this.transition("interrupted");
      }
      return receipt;
    }

    if (instruction.deliveryMode === "next_boundary" && idle) {
      this.inputQueue.releasePendingInform();
    }
    return receipt;
  }

  async interrupt(
    input: string | { reason: string; expectedRunEpoch: number },
  ): Promise<void> {
    const request =
      typeof input === "string"
        ? { reason: input, expectedRunEpoch: this.runEpoch }
        : input;

    if (!this.query) {
      throw new ClaudeRuntimeSessionError(
        "not_started",
        "Claude runtime session has not started",
      );
    }
    await this.instructionTransport.interrupt(request);
    if (this.runEpoch !== request.expectedRunEpoch) {
      throw new ClaudeRuntimeSessionError(
        "invalid_run_epoch",
        `Run epoch advanced while interrupt ${request.expectedRunEpoch} was in flight`,
      );
    }
    if (this.currentState === "running" || this.currentState === "evaluating") {
      this.transition("interrupted");
    }
  }

  captureTurnBoundary(): RuntimeTurnBoundary {
    return {
      runtimeSessionId: this.runtimeSessionId,
      runEpoch: this.runEpoch,
      terminalSequence: this.terminalSequence,
      state: this.currentState,
    };
  }

  captureTurnBoundaryAndHoldPendingInput(
    expectedRunEpoch: number,
  ): RuntimeTurnBoundaryInputHold {
    assertRunEpoch(expectedRunEpoch);
    if (this.runEpoch !== expectedRunEpoch) {
      throw new ClaudeRuntimeSessionError(
        "invalid_run_epoch",
        `Expected run epoch ${expectedRunEpoch}, active epoch is ${this.runEpoch}`,
      );
    }

    const queueHold =
      this.inputQueue.holdPendingInputForRunEpoch(expectedRunEpoch);
    try {
      const boundary = this.captureTurnBoundary();
      if (boundary.runEpoch !== expectedRunEpoch) {
        throw new ClaudeRuntimeSessionError(
          "invalid_run_epoch",
          `Expected run epoch ${expectedRunEpoch}, active epoch is ${boundary.runEpoch}`,
        );
      }
      return {
        boundary,
        hold: this.createTerminalInputHold(queueHold),
      };
    } catch (error) {
      queueHold.release();
      throw error;
    }
  }

  private createTerminalInputHold(
    hold: AgentSupplementalInputHold,
  ): RuntimeTerminalInputHold {
    return {
      runEpoch: hold.runEpoch,
      release: (options = {}) => {
        hold.release();
        if (
          options.releasePendingIfIdle === true &&
          this.currentState === "idle" &&
          this.runEpoch === hold.runEpoch
        ) {
          this.inputQueue.releasePendingInform();
        }
      },
    };
  }

  waitForTurnTerminal(input: {
    expectedRunEpoch: number;
    afterTerminalSequence: number;
    signal?: AbortSignal;
  }): Promise<RuntimeTurnTerminal> {
    assertRunEpoch(input.expectedRunEpoch);
    if (
      !Number.isInteger(input.afterTerminalSequence) ||
      input.afterTerminalSequence < 0
    ) {
      throw new ClaudeRuntimeSessionError(
        "invalid_terminal_boundary",
        "afterTerminalSequence must be a non-negative integer",
      );
    }
    if (input.signal?.aborted) {
      return Promise.reject(this.terminalWaitAborted());
    }

    const observed = this.terminalHistory.find(
      (terminal) =>
        terminal.runEpoch === input.expectedRunEpoch &&
        terminal.terminalSequence > input.afterTerminalSequence,
    );
    if (observed) return Promise.resolve(structuredClone(observed));

    if (this.runEpoch !== input.expectedRunEpoch) {
      return Promise.reject(
        new ClaudeRuntimeSessionError(
          "invalid_run_epoch",
          `Expected run epoch ${input.expectedRunEpoch}, active epoch is ${this.runEpoch}`,
        ),
      );
    }
    if (this.currentState === "closed" || this.currentState === "failed") {
      return Promise.reject(this.terminalUnavailable(this.currentState));
    }

    return new Promise<RuntimeTurnTerminal>((resolve, reject) => {
      const waiter: TerminalWaiter = {
        expectedRunEpoch: input.expectedRunEpoch,
        afterTerminalSequence: input.afterTerminalSequence,
        resolve,
        reject,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      };
      if (input.signal) {
        waiter.onAbort = () => {
          if (!this.terminalWaiters.delete(waiter)) return;
          this.removeWaiterAbortListener(waiter);
          reject(this.terminalWaitAborted());
        };
        input.signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.terminalWaiters.add(waiter);
    });
  }

  advanceRunEpoch(input: {
    expectedRunEpoch: number;
    nextRunEpoch: number;
  }): RuntimeRunEpochAdvanceResult {
    if (this.currentState !== "idle") {
      throw new ClaudeRuntimeSessionError(
        "turn_not_terminal",
        `Cannot advance runEpoch while Runtime Session is ${this.currentState}`,
      );
    }
    const discarded = this.instructionTransport.advanceRunEpoch(input);
    return {
      previousRunEpoch: input.expectedRunEpoch,
      runEpoch: input.nextRunEpoch,
      discardedInputIds: discarded.map((entry) => entry.id),
    };
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;

    this.inputQueue.setInterruptHandler(null);
    this.inputQueue.setHandoffHandler(null);
    try {
      this.query?.close();
    } catch (error) {
      this.logger.warn(
        `[Claude ${this.runtimeSessionId}] Failed to close SDK Query`,
        error,
      );
    }
    this.inputQueue.close();
    try {
      this.externalInput?.close?.();
    } catch (error) {
      this.logger.warn(
        `[Claude ${this.runtimeSessionId}] Failed to close external live input`,
        error,
      );
    }
    this.output.close();
    this.rejectTerminalWaiters(this.terminalUnavailable("closed"));
    if (this.currentState !== "closed" && this.currentState !== "failed") {
      this.transition("closed");
    }

    if (this.outputPump) await this.outputPump;
    if (this.eventObserver) {
      try {
        await this.eventObserver.flush();
      } catch (error) {
        this.logger.warn(
          `[Claude ${this.runtimeSessionId}] Failed to flush Goal observations`,
          error,
        );
      }
    }
  }

  private async pumpQuery(query: Query): Promise<void> {
    let failed = false;
    try {
      for await (const message of query) {
        const observedRunEpoch = this.providerOutputEpoch;
        this.processedSdkMessages++;
        this.updateSessionFromSdkMessage(message, observedRunEpoch);
        await this.recordProviderObservation(message, observedRunEpoch);
        for (const agentMessage of this.outputMultiplexer.convert(message)) {
          await this.output.publish({
            ...agentMessage,
            runEpoch: observedRunEpoch,
          });
        }
        if (message.type === "result") {
          if (observedRunEpoch === this.runEpoch) {
            this.inputQueue.releasePendingInform();
            if (
              this.currentState !== "idle" &&
              this.currentState !== "closed" &&
              this.currentState !== "failed"
            ) {
              this.transition("idle");
            }
          }
          this.recordTerminal(observedRunEpoch);
        }
      }
      this.output.close();
    } catch (error) {
      if (!this.closing) {
        failed = true;
        this.output.abort(error);
      }
    } finally {
      this.inputQueue.close();
      this.rejectTerminalWaiters(
        this.terminalUnavailable(failed ? "failed" : "closed"),
      );
      if (
        !this.closing &&
        this.currentState !== "closed" &&
        this.currentState !== "failed"
      ) {
        this.transition(failed ? "failed" : "closed");
      }
    }
  }

  private async pumpExternalInput(
    source: AgentSupplementalInputSource,
  ): Promise<void> {
    try {
      for await (const input of source) {
        await this.inputQueue.enqueue({
          ...input,
          runEpoch: input.runEpoch ?? this.runEpoch,
        });
      }
    } catch (error) {
      if (!this.closing) {
        this.logger.warn(
          `[Claude ${this.runtimeSessionId}] External live input stopped unexpectedly`,
          error,
        );
      }
    }
  }

  private updateSessionFromSdkMessage(
    message: SDKMessage,
    observedRunEpoch: number,
  ): void {
    if (message.type === "system" && message.subtype === "init") {
      this.claudeSessionId = message.session_id;
    }
    if (
      observedRunEpoch === this.runEpoch &&
      message.type !== "result" &&
      (this.currentState === "idle" ||
        this.currentState === "evaluating" ||
        this.currentState === "interrupted")
    ) {
      this.transition("running");
    }
  }

  private observeSupplementalInputHandoff(input: AgentSupplementalInput): void {
    const inputRunEpoch = input.runEpoch ?? this.runEpoch;
    if (
      inputRunEpoch !== this.runEpoch ||
      this.currentState === "closed" ||
      this.currentState === "failed"
    ) {
      return;
    }

    this.providerOutputEpoch = inputRunEpoch;
    if (
      this.currentState === "starting" ||
      this.currentState === "idle" ||
      this.currentState === "evaluating" ||
      this.currentState === "interrupted"
    ) {
      this.transition("running");
    }
  }

  async captureToolStart(
    input: Omit<ClaudeRuntimeToolStart, "runEpoch">,
  ): Promise<void> {
    if (!this.eventObserver) return;
    await this.eventObserver.captureToolStart({
      ...input,
      runEpoch: this.providerOutputEpoch,
    });
  }

  async observeToolOutcome(
    input: Omit<ClaudeRuntimeToolOutcome, "runEpoch">,
  ): Promise<void> {
    if (!this.eventObserver) return;
    await this.eventObserver.observeToolOutcome({
      ...input,
      runEpoch: this.providerOutputEpoch,
    });
  }

  private async observeInstructionWritten(
    instructionId: string,
    runEpoch: number,
  ): Promise<void> {
    await this.recordObservation("record SDK instruction handoff", (observer) =>
      observer.instructionWritten({
        instructionId,
        runEpoch,
        recordedAt: new Date().toISOString(),
      }),
    );
  }

  private async recordProviderObservation(
    message: SDKMessage,
    runEpoch: number,
  ): Promise<void> {
    await this.recordObservation("record SDK event", (observer) =>
      observer.observeSdkMessage(message, runEpoch),
    );
  }

  private async recordObservation(
    operation: string,
    record: (observer: ClaudeRuntimeEventObserverPort) => Promise<void>,
  ): Promise<void> {
    const observer = this.eventObserver;
    if (!observer) return;
    try {
      await record(observer);
    } catch (error) {
      this.logger.warn(
        `[Claude ${this.runtimeSessionId}] Failed to ${operation}`,
        error,
      );
    }
  }

  private recordTerminal(runEpoch: number): void {
    const terminal: RuntimeTurnTerminal = {
      runtimeSessionId: this.runtimeSessionId,
      runEpoch,
      terminalSequence: ++this.terminalSequence,
      state: "idle",
    };
    this.terminalHistory.push(terminal);
    if (this.terminalHistory.length > 64) this.terminalHistory.shift();

    for (const waiter of [...this.terminalWaiters]) {
      if (
        waiter.expectedRunEpoch !== runEpoch ||
        waiter.afterTerminalSequence >= terminal.terminalSequence
      ) {
        continue;
      }
      this.terminalWaiters.delete(waiter);
      this.removeWaiterAbortListener(waiter);
      waiter.resolve(structuredClone(terminal));
    }
  }

  private rejectTerminalWaiters(error: Error): void {
    for (const waiter of this.terminalWaiters) {
      this.removeWaiterAbortListener(waiter);
      waiter.reject(error);
    }
    this.terminalWaiters.clear();
  }

  private removeWaiterAbortListener(waiter: TerminalWaiter): void {
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
    }
  }

  private terminalWaitAborted(): ClaudeRuntimeSessionError {
    return new ClaudeRuntimeSessionError(
      "terminal_wait_aborted",
      "Waiting for the Claude turn terminal boundary was aborted",
    );
  }

  private terminalUnavailable(
    state: "closed" | "failed",
  ): ClaudeRuntimeSessionError {
    return new ClaudeRuntimeSessionError(
      "terminal_unavailable",
      `Claude Runtime Session became ${state} before the turn terminal boundary was observed`,
    );
  }

  private transition(next: RuntimeSessionState): void {
    if (this.currentState === next) return;
    assertRuntimeSessionStateTransition(this.currentState, next);
    this.currentState = next;
  }
}

export type ClaudeRuntimeSessionErrorCode =
  | "already_started"
  | "invalid_terminal_boundary"
  | "invalid_run_epoch"
  | "not_started"
  | "observer_already_attached"
  | "terminal_unavailable"
  | "terminal_wait_aborted"
  | "turn_not_terminal";

export class ClaudeRuntimeSessionError extends Error {
  constructor(
    public readonly code: ClaudeRuntimeSessionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ClaudeRuntimeSessionError";
  }
}

function assertRunEpoch(runEpoch: number): void {
  if (!Number.isInteger(runEpoch) || runEpoch < 0) {
    throw new ClaudeRuntimeSessionError(
      "invalid_run_epoch",
      "runEpoch must be a non-negative integer",
    );
  }
}
