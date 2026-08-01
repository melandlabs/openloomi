import type {
  GoalEvidenceType,
  RuntimeDeliveryReceipt,
  RuntimeInstruction,
} from "@openloomi/ai/agent/runtime-instructions";

export interface RuntimeEvidenceDraft {
  type: GoalEvidenceType;
  sourceEventId: string;
  summary: string;
  success?: boolean;
  payload: unknown;
  observedAt: string;
}

export interface RuntimeObservationContext {
  ownerId: string;
  runtimeSessionId: string;
  goalRunId: string;
  goalId: string;
  goalRevision: number;
  instructionId: string;
  runEpoch: number;
}

export interface RuntimeUsageDelta {
  tokensUsed: number;
  turnsUsed: number;
}

export interface RuntimeProviderEventObservation {
  ownerId: string;
  runtimeSessionId: string;
  runEpoch: number;
  eventKey: string;
  providerEventId: string;
  providerSessionId?: string;
  observedAt: string;
  terminal?: boolean;
  usage?: RuntimeUsageDelta;
  context?: RuntimeObservationContext;
  evidence?: RuntimeEvidenceDraft[];
}

export interface RuntimeDeliveryJournalPort {
  prepareDelivery(input: {
    ownerId: string;
    instruction: RuntimeInstruction;
  }): Promise<void>;

  recordDeliveryReceipt(input: {
    ownerId: string;
    instruction: RuntimeInstruction;
    receipt: RuntimeDeliveryReceipt;
  }): Promise<void>;

  supersedeDeliveries(input: {
    ownerId: string;
    runtimeSessionId: string;
    instructionIds: string[];
    reason: string;
  }): Promise<void>;
}

export interface RuntimeLifecycleObservationPort extends Pick<
  RuntimeDeliveryJournalPort,
  "supersedeDeliveries"
> {
  finalizeControlInstruction(input: {
    ownerId: string;
    runtimeSessionId: string;
    instructionId: string;
    runEpoch: number;
    status: "paused" | "cancelled";
    recordedAt?: string;
  }): Promise<void>;
}

/** Provider-facing observation boundary used by runtime adapters. */
export interface RuntimeProviderObservationPort {
  recordInstructionHandoff(input: {
    ownerId: string;
    runtimeSessionId: string;
    instructionId: string;
    runEpoch: number;
    recordedAt?: string;
  }): Promise<boolean>;

  setProviderSession(input: {
    ownerId: string;
    runtimeSessionId: string;
    providerSessionId: string;
  }): Promise<void>;

  captureContext(input: {
    ownerId: string;
    runtimeSessionId: string;
    runEpoch: number;
  }): Promise<RuntimeObservationContext | null>;

  observeProviderEvent(
    input: RuntimeProviderEventObservation,
  ): Promise<boolean>;
}

/** Complete boundary implemented by process-local and future durable journals. */
export interface RuntimeObservationJournalPort
  extends
    RuntimeDeliveryJournalPort,
    RuntimeLifecycleObservationPort,
    RuntimeProviderObservationPort {}

/** Observation recording is best effort and must not undo Goal commands. */
export async function recordRuntimeObservation(
  operation: string,
  record: () => Promise<unknown> | undefined,
): Promise<void> {
  try {
    await record();
  } catch (error) {
    console.error(`[Agent Goal Runtime] Failed to ${operation}`, error);
  }
}
