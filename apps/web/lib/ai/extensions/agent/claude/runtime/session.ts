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
  RuntimeInstructionTransportPort,
  RuntimeSessionState,
} from "@openloomi/ai/agent/runtime-instructions";
import { AgentOutputEventBus } from "@openloomi/ai/agent/runtime";
import {
  AgentSupplementalInputQueue,
  SupplementalInputRuntimeInstructionTransport,
} from "@openloomi/ai/agent/supplemental-input";
import type {
  AgentMessage,
  AgentSupplementalInputSource,
} from "@openloomi/ai/agent/types";

import type { ClaudeRuntimeLogger } from "../skills";
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

/**
 * Owns one Claude SDK Query and exposes an OpenLoomi runtime-session boundary.
 * Goal lifecycle and persistence intentionally remain outside this class.
 */
export class ClaudeRuntimeSession implements RuntimeInstructionTransportPort {
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

  claudeSessionId?: string;

  constructor(options: ClaudeRuntimeSessionOptions) {
    assertRunEpoch(options.runEpoch);
    this.runtimeSessionId = options.runtimeSessionId;
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
    const receipt = await this.instructionTransport.deliver(instruction);
    if (receipt.state === "queued" && this.query) {
      this.transition("running");
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
    this.transition("interrupted");
  }

  advanceRunEpoch(nextRunEpoch: number): void {
    this.instructionTransport.advanceRunEpoch(nextRunEpoch);
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;

    this.inputQueue.setInterruptHandler(null);
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
    if (this.currentState !== "closed" && this.currentState !== "failed") {
      this.transition("closed");
    }

    if (this.outputPump) await this.outputPump;
  }

  private async pumpQuery(query: Query): Promise<void> {
    let failed = false;
    try {
      for await (const message of query) {
        this.processedSdkMessages++;
        this.observeSdkMessage(message);
        for (const agentMessage of this.outputMultiplexer.convert(message)) {
          await this.output.publish(agentMessage);
        }
        if (message.type === "result") {
          this.inputQueue.releasePendingInform();
          if (
            this.currentState !== "idle" &&
            this.currentState !== "closed" &&
            this.currentState !== "failed"
          ) {
            this.transition("idle");
          }
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

  private observeSdkMessage(message: SDKMessage): void {
    if (message.type === "system" && message.subtype === "init") {
      this.claudeSessionId = message.session_id;
    }
    if (
      message.type !== "result" &&
      (this.currentState === "idle" ||
        this.currentState === "evaluating" ||
        this.currentState === "interrupted")
    ) {
      this.transition("running");
    }
  }

  private transition(next: RuntimeSessionState): void {
    if (this.currentState === next) return;
    assertRuntimeSessionStateTransition(this.currentState, next);
    this.currentState = next;
  }
}

export type ClaudeRuntimeSessionErrorCode =
  | "already_started"
  | "invalid_run_epoch"
  | "not_started";

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
