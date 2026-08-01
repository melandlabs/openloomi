import {
  GoalEvidenceSchema,
  RuntimeInstructionSchema,
  assertDeliveryStateTransition,
  assertGoalRunStatusTransition,
  canonicalJson,
  type AgentGoalRun,
  type AgentGoalStatePort,
  type DeliveryState,
  type GoalEvidence,
  type GoalRunStatus,
  type RuntimeClockPort,
  type RuntimeDeliveryReceipt,
  type RuntimeIdGeneratorPort,
  type RuntimeInstruction,
  type RuntimeInstructionDelivery,
} from "@openloomi/ai/agent/runtime-instructions";

import { KeyedSerialExecutor } from "./keyed-serial-executor";
import type {
  RuntimeEvidenceDraft,
  RuntimeObservationContext,
  RuntimeObservationJournalPort,
  RuntimeProviderEventObservation,
  RuntimeUsageDelta,
} from "./runtime-observation";

interface PreparedInstruction {
  instruction: RuntimeInstruction;
  runEpoch: number;
}

interface StoredDelivery {
  delivery: RuntimeInstructionDelivery;
  instruction: RuntimeInstruction;
  runEpoch: number;
}

interface RuntimeObservationSession {
  ownerId: string;
  runtimeSessionId: string;
  providerSessionId?: string;
  preparedInstructions: Map<string, PreparedInstruction>;
  deliveries: Map<string, StoredDelivery>;
  runs: Map<string, AgentGoalRun>;
  runIdsByGoalEpoch: Map<string, string>;
  evidence: Map<string, GoalEvidence>;
  processedProviderEvents: Set<string>;
}

interface MaterializedEvidence {
  dedupeKey: string;
  evidence: GoalEvidence;
}

type RuntimeObservationJournalErrorCode =
  | "delivery_conflict"
  | "invalid_observation"
  | "provider_session_conflict";

class RuntimeObservationJournalError extends Error {
  constructor(
    public readonly code: RuntimeObservationJournalErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "RuntimeObservationJournalError";
  }
}

/**
 * Process-local Goal Run, delivery acknowledgement, usage, and evidence
 * journal. It is deliberately separate from the authoritative Goal/outbox
 * aggregate: later durable adapters can persist these high-volume observations
 * without widening the Goal mutation transaction.
 */
export class InMemoryRuntimeObservationJournal implements RuntimeObservationJournalPort {
  private readonly sessions = new Map<string, RuntimeObservationSession>();
  private readonly mutations = new KeyedSerialExecutor();

  constructor(
    private readonly goals: AgentGoalStatePort,
    private readonly clock: RuntimeClockPort,
    private readonly ids: RuntimeIdGeneratorPort,
  ) {}

  async prepareDelivery(input: {
    ownerId: string;
    instruction: RuntimeInstruction;
  }): Promise<void> {
    const ownerId = requiredIdentifier(input.ownerId, "ownerId");
    const instruction = parseInstruction(input.instruction);
    const runEpoch = await this.goals.getRuntimeSessionRunEpoch(
      ownerId,
      instruction.targetSessionId,
    );
    const scope = sessionScope(ownerId, instruction.targetSessionId);

    await this.mutations.run(scope, () => {
      const session = this.getOrCreateSession(
        ownerId,
        instruction.targetSessionId,
      );
      const existing = session.preparedInstructions.get(instruction.id);
      if (existing) {
        assertSameInstruction(existing.instruction, instruction);
        if (existing.runEpoch !== runEpoch) {
          throw journalError(
            "delivery_conflict",
            `Instruction ${instruction.id} was prepared for runEpoch ${existing.runEpoch}, not ${runEpoch}`,
          );
        }
        return;
      }
      session.preparedInstructions.set(instruction.id, {
        instruction: structuredClone(instruction),
        runEpoch,
      });
    });
  }

  async recordDeliveryReceipt(input: {
    ownerId: string;
    instruction: RuntimeInstruction;
    receipt: RuntimeDeliveryReceipt;
  }): Promise<void> {
    const ownerId = requiredIdentifier(input.ownerId, "ownerId");
    const instruction = parseInstruction(input.instruction);
    const receipt = parseReceipt(input.receipt, instruction);
    const scope = sessionScope(ownerId, instruction.targetSessionId);

    await this.mutations.run(scope, async () => {
      const session = this.getOrCreateSession(
        ownerId,
        instruction.targetSessionId,
      );
      let prepared = session.preparedInstructions.get(instruction.id);
      if (!prepared) {
        const runEpoch = await this.goals.getRuntimeSessionRunEpoch(
          ownerId,
          instruction.targetSessionId,
        );
        prepared = { instruction: structuredClone(instruction), runEpoch };
        session.preparedInstructions.set(instruction.id, prepared);
      } else {
        assertSameInstruction(prepared.instruction, instruction);
      }

      const existing = session.deliveries.get(instruction.id);
      if (existing) {
        assertSameInstruction(existing.instruction, instruction);
        if (existing.runEpoch !== prepared.runEpoch) {
          throw journalError(
            "delivery_conflict",
            `Delivery ${instruction.id} changed runEpoch`,
          );
        }
        if (existing.delivery.state !== "rejected") {
          this.applyReceiptToExisting(session, existing, receipt);
          return;
        }
        if (receipt.state === "rejected") return;
        this.createDeliveryAttempt(
          session,
          prepared,
          receipt,
          existing.delivery.attempt + 1,
        );
        return;
      }
      this.createDeliveryAttempt(session, prepared, receipt, 1);
    });
  }

  async recordInstructionHandoff(input: {
    ownerId: string;
    runtimeSessionId: string;
    instructionId: string;
    runEpoch: number;
    recordedAt?: string;
  }): Promise<boolean> {
    const ownerId = requiredIdentifier(input.ownerId, "ownerId");
    const runtimeSessionId = requiredIdentifier(
      input.runtimeSessionId,
      "runtimeSessionId",
    );
    const instructionId = requiredIdentifier(
      input.instructionId,
      "instructionId",
    );
    const runEpoch = nonNegativeInteger(input.runEpoch, "runEpoch");
    const recordedAt = isoTimestamp(
      input.recordedAt ?? this.clock.now().toISOString(),
      "recordedAt",
    );
    const scope = sessionScope(ownerId, runtimeSessionId);

    return this.mutations.run(scope, async () => {
      const session = this.sessions.get(scope);
      if (!session) return false;
      const prepared = session.preparedInstructions.get(instructionId);
      if (!prepared) return false;
      if (prepared.runEpoch !== runEpoch) return false;
      const authoritativeEpoch = await this.goals.getRuntimeSessionRunEpoch(
        ownerId,
        runtimeSessionId,
      );
      if (authoritativeEpoch !== runEpoch) return false;

      const stored = session.deliveries.get(instructionId);
      if (!stored || stored.delivery.state === "rejected") {
        this.createDeliveryAttempt(
          session,
          prepared,
          {
            instructionId,
            runtimeSessionId,
            state: "written_to_sdk",
            recordedAt,
          },
          stored ? stored.delivery.attempt + 1 : 1,
        );
        return true;
      }
      if (!isProviderAcceptedState(stored.delivery.state)) return false;
      this.markWritten(session, stored, { runEpoch, recordedAt });
      return true;
    });
  }

  async setProviderSession(input: {
    ownerId: string;
    runtimeSessionId: string;
    providerSessionId: string;
  }): Promise<void> {
    const ownerId = requiredIdentifier(input.ownerId, "ownerId");
    const runtimeSessionId = requiredIdentifier(
      input.runtimeSessionId,
      "runtimeSessionId",
    );
    const providerSessionId = requiredIdentifier(
      input.providerSessionId,
      "providerSessionId",
    );
    const scope = sessionScope(ownerId, runtimeSessionId);
    await this.mutations.run(scope, () => {
      const session = this.getOrCreateSession(ownerId, runtimeSessionId);
      if (
        session.providerSessionId !== undefined &&
        session.providerSessionId !== providerSessionId
      ) {
        throw journalError(
          "provider_session_conflict",
          `Runtime Session ${runtimeSessionId} already observes provider session ${session.providerSessionId}`,
        );
      }
      this.assignProviderSession(session, providerSessionId);
    });
  }

  async captureContext(input: {
    ownerId: string;
    runtimeSessionId: string;
    runEpoch: number;
  }): Promise<RuntimeObservationContext | null> {
    const ownerId = requiredIdentifier(input.ownerId, "ownerId");
    const runtimeSessionId = requiredIdentifier(
      input.runtimeSessionId,
      "runtimeSessionId",
    );
    const runEpoch = nonNegativeInteger(input.runEpoch, "runEpoch");
    const scope = sessionScope(ownerId, runtimeSessionId);
    return this.mutations.run(scope, async () => {
      const authoritativeEpoch = await this.goals.getRuntimeSessionRunEpoch(
        ownerId,
        runtimeSessionId,
      );
      if (authoritativeEpoch !== runEpoch) return null;
      const session = this.sessions.get(scope);
      if (!session) return null;
      return cloneContext(this.latestWrittenContext(session, runEpoch));
    });
  }

  async observeProviderEvent(
    input: RuntimeProviderEventObservation,
  ): Promise<boolean> {
    const parsed = parseProviderObservation(input);
    const scope = sessionScope(parsed.ownerId, parsed.runtimeSessionId);

    return this.mutations.run(scope, async () => {
      const authoritativeEpoch = await this.goals.getRuntimeSessionRunEpoch(
        parsed.ownerId,
        parsed.runtimeSessionId,
      );
      if (authoritativeEpoch !== parsed.runEpoch) return false;

      const session = this.sessions.get(scope);
      if (!session) return false;
      if (session.processedProviderEvents.has(parsed.eventKey)) return false;
      this.assertProviderSession(session, parsed.providerSessionId);

      const context = parsed.context
        ? this.validateContext(session, parsed.context, parsed.runEpoch)
        : this.latestWrittenContext(session, parsed.runEpoch);
      const evidence = context
        ? this.materializeEvidence(session, context, parsed.evidence ?? [])
        : [];
      const run = context ? session.runs.get(context.goalRunId) : undefined;
      if (
        run &&
        parsed.usage &&
        (!Number.isSafeInteger(run.tokensUsed + parsed.usage.tokensUsed) ||
          !Number.isSafeInteger(run.turnsUsed + parsed.usage.turnsUsed))
      ) {
        throw journalError(
          "invalid_observation",
          "Provider usage would overflow Goal Run counters",
        );
      }

      session.processedProviderEvents.add(parsed.eventKey);
      if (parsed.providerSessionId) {
        this.assignProviderSession(session, parsed.providerSessionId);
      }
      this.markWrittenDeliveriesObserved(
        session,
        parsed.runEpoch,
        parsed.providerEventId,
        parsed.observedAt,
      );
      if (parsed.terminal) {
        this.markNormalDeliveriesApplied(
          session,
          parsed.runEpoch,
          parsed.providerEventId,
          parsed.observedAt,
        );
      }

      if (!context || !run) return true;
      if (!isRunTerminal(run.status)) {
        if (run.status === "queued") this.transitionRun(run, "running");
        run.lastActivityAt = latestTimestamp(
          run.lastActivityAt,
          parsed.observedAt,
        );
        if (parsed.usage) {
          run.tokensUsed += parsed.usage.tokensUsed;
          run.turnsUsed += parsed.usage.turnsUsed;
        }
      }

      for (const item of evidence) {
        session.evidence.set(item.dedupeKey, item.evidence);
      }
      return true;
    });
  }

  async finalizeControlInstruction(input: {
    ownerId: string;
    runtimeSessionId: string;
    instructionId: string;
    runEpoch: number;
    status: "paused" | "cancelled";
    recordedAt?: string;
  }): Promise<void> {
    const ownerId = requiredIdentifier(input.ownerId, "ownerId");
    const runtimeSessionId = requiredIdentifier(
      input.runtimeSessionId,
      "runtimeSessionId",
    );
    const instructionId = requiredIdentifier(
      input.instructionId,
      "instructionId",
    );
    const runEpoch = nonNegativeInteger(input.runEpoch, "runEpoch");
    const recordedAt = isoTimestamp(
      input.recordedAt ?? this.clock.now().toISOString(),
      "recordedAt",
    );
    const scope = sessionScope(ownerId, runtimeSessionId);

    await this.mutations.run(scope, () => {
      const session = this.sessions.get(scope);
      const stored = session?.deliveries.get(instructionId);
      if (!session || !stored) return;
      if (stored.runEpoch !== runEpoch) {
        throw journalError(
          "delivery_conflict",
          `Control instruction ${instructionId} belongs to runEpoch ${stored.runEpoch}, not ${runEpoch}`,
        );
      }
      if (!isInterruptControl(stored.instruction)) {
        throw journalError(
          "delivery_conflict",
          `Instruction ${instructionId} is not a lifecycle control instruction`,
        );
      }
      if (!isProviderAcceptedState(stored.delivery.state)) {
        throw journalError(
          "delivery_conflict",
          `Control instruction ${instructionId} cannot finalize from ${stored.delivery.state}`,
        );
      }
      if (
        (input.status === "paused" &&
          stored.instruction.kind !== "goal.pause") ||
        (input.status === "cancelled" &&
          stored.instruction.kind !== "goal.cancel" &&
          stored.instruction.kind !== "control.interrupt")
      ) {
        throw journalError(
          "delivery_conflict",
          `Control instruction ${instructionId} cannot finalize as ${input.status}`,
        );
      }
      const run = stored.delivery.goalRunId
        ? session.runs.get(stored.delivery.goalRunId)
        : undefined;
      const next: GoalRunStatus = input.status;
      if (run && !isRunTerminal(run.status) && run.status !== next) {
        // Validate the complete operation before changing the delivery. A
        // failed run transition must never leave a partially applied receipt.
        assertGoalRunStatusTransition(run.status, next);
      }
      const finalizedAt = latestTimestamp(
        recordedAt,
        stored.delivery.updatedAt,
        run?.lastActivityAt,
      );
      const syntheticEventId = boundedIdentifier(
        `runtime-boundary:${instructionId}`,
      );
      if (stored.delivery.state === "queued") {
        this.transitionDelivery(stored.delivery, "written_to_sdk", finalizedAt);
      }
      if (stored.delivery.state === "written_to_sdk") {
        this.transitionDelivery(
          stored.delivery,
          "observed",
          finalizedAt,
          syntheticEventId,
        );
      }
      if (stored.delivery.state === "observed") {
        this.transitionDelivery(
          stored.delivery,
          "applied",
          finalizedAt,
          stored.delivery.providerEventId ?? syntheticEventId,
        );
      }

      if (!run || isRunTerminal(run.status)) return;
      if (run.status !== next) this.transitionRun(run, next);
      run.goalRevision = Math.max(
        run.goalRevision,
        stored.instruction.goalRevision ?? run.goalRevision,
      );
      run.lastActivityAt = finalizedAt;
      if (next === "cancelled") run.completedAt = finalizedAt;
    });
  }

  async supersedeDeliveries(input: {
    ownerId: string;
    runtimeSessionId: string;
    instructionIds: string[];
    reason: string;
  }): Promise<void> {
    const ownerId = requiredIdentifier(input.ownerId, "ownerId");
    const runtimeSessionId = requiredIdentifier(
      input.runtimeSessionId,
      "runtimeSessionId",
    );
    const instructionIds = [
      ...new Set(
        input.instructionIds.map((id) =>
          requiredIdentifier(id, "instructionId"),
        ),
      ),
    ];
    const reason = requiredText(input.reason, "reason", 8_000);
    const scope = sessionScope(ownerId, runtimeSessionId);
    const now = this.clock.now().toISOString();

    await this.mutations.run(scope, () => {
      const session = this.sessions.get(scope);
      if (!session) return;
      const queued: StoredDelivery[] = [];
      for (const instructionId of instructionIds) {
        const stored = session.deliveries.get(instructionId);
        if (!stored || stored.delivery.state === "superseded") continue;
        if (stored.delivery.state !== "queued") {
          throw journalError(
            "delivery_conflict",
            `Only a queued delivery can be superseded; ${instructionId} is ${stored.delivery.state}`,
          );
        }
        queued.push(stored);
      }

      // Nothing is mutated until every delivery has passed validation.
      for (const stored of queued) {
        this.transitionDelivery(stored.delivery, "superseded", now);
        stored.delivery.errorCode = "superseded";
        stored.delivery.errorMessage = reason;
      }
    });
  }

  async listGoalRuns(
    ownerId: string,
    runtimeSessionId: string,
  ): Promise<AgentGoalRun[]> {
    const scope = validatedScope(ownerId, runtimeSessionId);
    return [...(this.sessions.get(scope)?.runs.values() ?? [])]
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
      .map((run) => structuredClone(run));
  }

  async listDeliveries(
    ownerId: string,
    runtimeSessionId: string,
  ): Promise<RuntimeInstructionDelivery[]> {
    const scope = validatedScope(ownerId, runtimeSessionId);
    return [...(this.sessions.get(scope)?.deliveries.values() ?? [])]
      .map(({ delivery }) => structuredClone(delivery))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async listEvidence(
    ownerId: string,
    runtimeSessionId: string,
  ): Promise<GoalEvidence[]> {
    const scope = validatedScope(ownerId, runtimeSessionId);
    return [...(this.sessions.get(scope)?.evidence.values() ?? [])]
      .sort((left, right) => left.observedAt.localeCompare(right.observedAt))
      .map((evidence) => structuredClone(evidence));
  }

  private getOrCreateSession(
    ownerId: string,
    runtimeSessionId: string,
  ): RuntimeObservationSession {
    const scope = sessionScope(ownerId, runtimeSessionId);
    const existing = this.sessions.get(scope);
    if (existing) return existing;
    const created: RuntimeObservationSession = {
      ownerId,
      runtimeSessionId,
      preparedInstructions: new Map(),
      deliveries: new Map(),
      runs: new Map(),
      runIdsByGoalEpoch: new Map(),
      evidence: new Map(),
      processedProviderEvents: new Set(),
    };
    this.sessions.set(scope, created);
    return created;
  }

  private ensureGoalRun(
    session: RuntimeObservationSession,
    prepared: PreparedInstruction,
    startedAt: string,
  ): AgentGoalRun | undefined {
    const { instruction, runEpoch } = prepared;
    if (
      instruction.goalId === undefined ||
      instruction.goalRevision === undefined
    ) {
      return undefined;
    }
    const runKey = goalRunKey(instruction.goalId, runEpoch);
    const existingId = session.runIdsByGoalEpoch.get(runKey);
    if (existingId) {
      const existing = session.runs.get(existingId);
      if (!existing) {
        throw journalError("invalid_observation", "Goal Run index is corrupt");
      }
      if (
        existing.providerSessionId === undefined &&
        session.providerSessionId !== undefined
      ) {
        existing.providerSessionId = session.providerSessionId;
      }
      return existing;
    }

    const run: AgentGoalRun = {
      id: this.ids.generate(),
      ownerId: session.ownerId,
      goalId: instruction.goalId,
      goalRevision: instruction.goalRevision,
      runtimeSessionId: session.runtimeSessionId,
      ...(session.providerSessionId === undefined
        ? {}
        : { providerSessionId: session.providerSessionId }),
      runEpoch,
      status: "queued",
      turnsUsed: 0,
      tokensUsed: 0,
      startedAt,
      lastActivityAt: startedAt,
    };
    session.runs.set(run.id, run);
    session.runIdsByGoalEpoch.set(runKey, run.id);
    return run;
  }

  private createDeliveryAttempt(
    session: RuntimeObservationSession,
    prepared: PreparedInstruction,
    receipt: RuntimeDeliveryReceipt,
    attempt: number,
  ): StoredDelivery {
    const { instruction } = prepared;
    const createdAt = receipt.recordedAt;
    const state = receipt.state;
    const goalRun =
      state === "rejected"
        ? undefined
        : this.ensureGoalRun(session, prepared, createdAt);
    const stored: StoredDelivery = {
      instruction: structuredClone(instruction),
      runEpoch: prepared.runEpoch,
      delivery: {
        id: this.ids.generate(),
        ownerId: session.ownerId,
        instructionId: instruction.id,
        runtimeSessionId: instruction.targetSessionId,
        ...(goalRun === undefined ? {} : { goalRunId: goalRun.id }),
        state,
        attempt,
        ...(receipt.providerEventId === undefined
          ? {}
          : { providerEventId: receipt.providerEventId }),
        ...(state === "rejected" && receipt.reason
          ? {
              errorCode: "transport_rejected",
              errorMessage: receipt.reason,
            }
          : {}),
        createdAt,
        updatedAt: createdAt,
      },
    };
    session.deliveries.set(instruction.id, stored);

    if (state === "written_to_sdk") {
      this.markWritten(session, stored, {
        runEpoch: prepared.runEpoch,
        recordedAt: receipt.recordedAt,
      });
    }
    return stored;
  }

  private markWritten(
    session: RuntimeObservationSession,
    stored: StoredDelivery,
    handoff: { runEpoch: number; recordedAt: string },
  ): void {
    if (stored.runEpoch !== handoff.runEpoch) return;
    if (stored.delivery.state === "queued") {
      this.transitionDelivery(
        stored.delivery,
        "written_to_sdk",
        handoff.recordedAt,
      );
    }
    if (
      stored.delivery.state !== "written_to_sdk" &&
      stored.delivery.state !== "observed" &&
      stored.delivery.state !== "applied" &&
      stored.delivery.state !== "completed"
    ) {
      return;
    }
    const prepared = session.preparedInstructions.get(stored.instruction.id);
    const run = prepared
      ? this.ensureGoalRun(session, prepared, handoff.recordedAt)
      : undefined;
    if (!run || isInterruptControl(stored.instruction)) return;
    run.goalRevision = Math.max(
      run.goalRevision,
      stored.instruction.goalRevision ?? run.goalRevision,
    );
    if (
      run.status === "queued" ||
      run.status === "paused" ||
      run.status === "blocked"
    ) {
      this.transitionRun(run, "running");
    }
    run.lastActivityAt = latestTimestamp(
      run.lastActivityAt,
      handoff.recordedAt,
    );
  }

  private latestWrittenContext(
    session: RuntimeObservationSession,
    runEpoch: number,
  ): RuntimeObservationContext | null {
    let latest: StoredDelivery | undefined;
    for (const stored of session.deliveries.values()) {
      if (
        stored.runEpoch !== runEpoch ||
        isInterruptControl(stored.instruction) ||
        stored.delivery.goalRunId === undefined ||
        stored.instruction.goalId === undefined ||
        stored.instruction.goalRevision === undefined ||
        !isProviderVisibleState(stored.delivery.state)
      ) {
        continue;
      }
      if (
        latest === undefined ||
        stored.instruction.sequence > latest.instruction.sequence
      ) {
        latest = stored;
      }
    }
    if (
      !latest?.delivery.goalRunId ||
      !latest.instruction.goalId ||
      !latest.instruction.goalRevision
    ) {
      return null;
    }
    return {
      ownerId: session.ownerId,
      runtimeSessionId: session.runtimeSessionId,
      goalRunId: latest.delivery.goalRunId,
      goalId: latest.instruction.goalId,
      goalRevision: latest.instruction.goalRevision,
      instructionId: latest.instruction.id,
      runEpoch,
    };
  }

  private validateContext(
    session: RuntimeObservationSession,
    context: RuntimeObservationContext,
    runEpoch: number,
  ): RuntimeObservationContext | null {
    if (
      context.ownerId !== session.ownerId ||
      context.runtimeSessionId !== session.runtimeSessionId ||
      context.runEpoch !== runEpoch
    ) {
      return null;
    }
    const run = session.runs.get(context.goalRunId);
    const delivery = session.deliveries.get(context.instructionId);
    if (
      !run ||
      !delivery ||
      run.goalId !== context.goalId ||
      delivery.delivery.goalRunId !== run.id ||
      delivery.instruction.goalId !== context.goalId ||
      delivery.instruction.goalRevision !== context.goalRevision
    ) {
      return null;
    }
    return context;
  }

  private markWrittenDeliveriesObserved(
    session: RuntimeObservationSession,
    runEpoch: number,
    providerEventId: string,
    observedAt: string,
  ): void {
    // Claude does not echo an OpenLoomi instruction ID in output events. The
    // first causal provider event therefore acknowledges every instruction
    // already handed to this provider turn, scoped by the current runEpoch.
    for (const stored of session.deliveries.values()) {
      if (
        stored.runEpoch === runEpoch &&
        !isInterruptControl(stored.instruction) &&
        stored.delivery.state === "written_to_sdk"
      ) {
        this.transitionDelivery(
          stored.delivery,
          "observed",
          observedAt,
          providerEventId,
        );
      }
    }
  }

  private markNormalDeliveriesApplied(
    session: RuntimeObservationSession,
    runEpoch: number,
    providerEventId: string,
    observedAt: string,
  ): void {
    for (const stored of session.deliveries.values()) {
      if (
        stored.runEpoch === runEpoch &&
        stored.delivery.state === "observed" &&
        !isInterruptControl(stored.instruction)
      ) {
        this.transitionDelivery(
          stored.delivery,
          "applied",
          observedAt,
          providerEventId,
        );
      }
    }
  }

  private materializeEvidence(
    session: RuntimeObservationSession,
    context: RuntimeObservationContext,
    drafts: RuntimeEvidenceDraft[],
  ): MaterializedEvidence[] {
    const result: MaterializedEvidence[] = [];
    const seen = new Set<string>();
    for (const draft of drafts) {
      const dedupeKey = JSON.stringify([
        context.goalRunId,
        draft.sourceEventId,
      ]);
      if (session.evidence.has(dedupeKey) || seen.has(dedupeKey)) continue;
      try {
        result.push({
          dedupeKey,
          evidence: GoalEvidenceSchema.parse({
            id: this.ids.generate(),
            goalId: context.goalId,
            goalRunId: context.goalRunId,
            goalRevision: context.goalRevision,
            instructionId: context.instructionId,
            type: draft.type,
            sourceEventId: draft.sourceEventId,
            summary: draft.summary,
            ...(draft.success === undefined ? {} : { success: draft.success }),
            payload: draft.payload,
            observedAt: draft.observedAt,
          }),
        });
        seen.add(dedupeKey);
      } catch (cause) {
        throw journalError(
          "invalid_observation",
          `Provider evidence ${draft.sourceEventId} is invalid`,
          cause,
        );
      }
    }
    return result;
  }

  private applyReceiptToExisting(
    session: RuntimeObservationSession,
    stored: StoredDelivery,
    receipt: RuntimeDeliveryReceipt,
  ): void {
    if (receipt.state === "rejected") {
      if (stored.delivery.state === "queued") {
        this.transitionDelivery(
          stored.delivery,
          "rejected",
          receipt.recordedAt,
          receipt.providerEventId,
        );
        stored.delivery.errorCode = "transport_rejected";
        stored.delivery.errorMessage = receipt.reason;
      } else if (stored.delivery.state !== "rejected") {
        throw journalError(
          "delivery_conflict",
          `Delivery ${stored.instruction.id} cannot regress from ${stored.delivery.state} to rejected`,
        );
      }
      return;
    }
    if (stored.delivery.state === "rejected") {
      throw journalError(
        "delivery_conflict",
        `Rejected delivery ${stored.instruction.id} cannot be accepted later`,
      );
    }
    if (
      receipt.state === "written_to_sdk" &&
      stored.delivery.state === "queued"
    ) {
      this.transitionDelivery(
        stored.delivery,
        "written_to_sdk",
        receipt.recordedAt,
        receipt.providerEventId,
      );
      this.markWritten(session, stored, {
        runEpoch: stored.runEpoch,
        recordedAt: receipt.recordedAt,
      });
    }
  }

  private assertProviderSession(
    session: RuntimeObservationSession,
    providerSessionId: string | undefined,
  ): void {
    if (providerSessionId === undefined) return;
    if (
      session.providerSessionId !== undefined &&
      session.providerSessionId !== providerSessionId
    ) {
      throw journalError(
        "provider_session_conflict",
        `Provider event belongs to ${providerSessionId}, not ${session.providerSessionId}`,
      );
    }
  }

  private assignProviderSession(
    session: RuntimeObservationSession,
    providerSessionId: string,
  ): void {
    session.providerSessionId = providerSessionId;
    for (const run of session.runs.values()) {
      if (run.providerSessionId === undefined) {
        run.providerSessionId = providerSessionId;
      }
    }
  }

  private transitionDelivery(
    delivery: RuntimeInstructionDelivery,
    next: DeliveryState,
    updatedAt: string,
    providerEventId?: string,
  ): void {
    if (delivery.state === next) return;
    assertDeliveryStateTransition(delivery.state, next);
    delivery.state = next;
    delivery.updatedAt = latestTimestamp(delivery.updatedAt, updatedAt);
    if (providerEventId !== undefined)
      delivery.providerEventId = providerEventId;
  }

  private transitionRun(run: AgentGoalRun, next: GoalRunStatus): void {
    if (run.status === next) return;
    assertGoalRunStatusTransition(run.status, next);
    run.status = next;
  }
}

function parseInstruction(candidate: RuntimeInstruction): RuntimeInstruction {
  try {
    return RuntimeInstructionSchema.parse(candidate);
  } catch (cause) {
    throw journalError(
      "invalid_observation",
      "Runtime delivery references an invalid instruction",
      cause,
    );
  }
}

function parseReceipt(
  candidate: RuntimeDeliveryReceipt,
  instruction: RuntimeInstruction,
): RuntimeDeliveryReceipt {
  if (
    !candidate ||
    typeof candidate !== "object" ||
    candidate.instructionId !== instruction.id ||
    candidate.runtimeSessionId !== instruction.targetSessionId ||
    (candidate.state !== "queued" &&
      candidate.state !== "written_to_sdk" &&
      candidate.state !== "rejected")
  ) {
    throw journalError(
      "invalid_observation",
      "Runtime delivery receipt does not match its instruction",
    );
  }
  isoTimestamp(candidate.recordedAt, "receipt.recordedAt");
  return structuredClone(candidate);
}

function parseProviderObservation(
  input: RuntimeProviderEventObservation,
): RuntimeProviderEventObservation {
  const parsed: RuntimeProviderEventObservation = {
    ownerId: requiredIdentifier(input.ownerId, "ownerId"),
    runtimeSessionId: requiredIdentifier(
      input.runtimeSessionId,
      "runtimeSessionId",
    ),
    runEpoch: nonNegativeInteger(input.runEpoch, "runEpoch"),
    eventKey: requiredText(input.eventKey, "eventKey", 1_024),
    providerEventId: requiredIdentifier(
      input.providerEventId,
      "providerEventId",
    ),
    observedAt: isoTimestamp(input.observedAt, "observedAt"),
    ...(input.providerSessionId === undefined
      ? {}
      : {
          providerSessionId: requiredIdentifier(
            input.providerSessionId,
            "providerSessionId",
          ),
        }),
    ...(input.terminal === undefined ? {} : { terminal: input.terminal }),
    ...(input.usage === undefined ? {} : { usage: parseUsage(input.usage) }),
    ...(input.context === undefined
      ? {}
      : { context: structuredClone(input.context) }),
    ...(input.evidence === undefined
      ? {}
      : { evidence: structuredClone(input.evidence) }),
  };
  return parsed;
}

function parseUsage(usage: RuntimeUsageDelta): RuntimeUsageDelta {
  return {
    tokensUsed: nonNegativeInteger(usage.tokensUsed, "usage.tokensUsed"),
    turnsUsed: nonNegativeInteger(usage.turnsUsed, "usage.turnsUsed"),
  };
}

function assertSameInstruction(
  left: RuntimeInstruction,
  right: RuntimeInstruction,
): void {
  if (canonicalJson(left) !== canonicalJson(right)) {
    throw journalError(
      "delivery_conflict",
      `Instruction ID ${right.id} was reused with different content`,
    );
  }
}

function isInterruptControl(instruction: RuntimeInstruction): boolean {
  return (
    instruction.kind === "control.interrupt" ||
    instruction.kind === "goal.pause" ||
    instruction.kind === "goal.cancel"
  );
}

function isProviderVisibleState(state: DeliveryState): boolean {
  return (
    state === "written_to_sdk" ||
    state === "observed" ||
    state === "applied" ||
    state === "completed"
  );
}

function isProviderAcceptedState(state: DeliveryState): boolean {
  return state === "queued" || isProviderVisibleState(state);
}

function isRunTerminal(status: GoalRunStatus): boolean {
  return (
    status === "completed" ||
    status === "cancelled" ||
    status === "budget_limited" ||
    status === "failed"
  );
}

function cloneContext(
  context: RuntimeObservationContext | null,
): RuntimeObservationContext | null {
  return context === null ? null : structuredClone(context);
}

function goalRunKey(goalId: string, runEpoch: number): string {
  return JSON.stringify([goalId, runEpoch]);
}

function validatedScope(ownerId: string, runtimeSessionId: string): string {
  return sessionScope(
    requiredIdentifier(ownerId, "ownerId"),
    requiredIdentifier(runtimeSessionId, "runtimeSessionId"),
  );
}

function sessionScope(ownerId: string, runtimeSessionId: string): string {
  return JSON.stringify([ownerId, runtimeSessionId]);
}

function requiredIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw journalError("invalid_observation", `${field} must be a string`);
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 256 ||
    normalized !== value
  ) {
    throw journalError(
      "invalid_observation",
      `${field} must contain 1 to 256 characters without surrounding whitespace`,
    );
  }
  return value;
}

function boundedIdentifier(value: string): string {
  return value.length <= 256 ? value : value.slice(0, 256);
}

function requiredText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") {
    throw journalError("invalid_observation", `${field} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw journalError(
      "invalid_observation",
      `${field} must contain 1 to ${maximum} characters`,
    );
  }
  return normalized;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw journalError(
      "invalid_observation",
      `${field} must be a non-negative integer`,
    );
  }
  return value as number;
}

function isoTimestamp(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw journalError(
      "invalid_observation",
      `${field} must be an ISO date-time`,
    );
  }
  return value;
}

function latestTimestamp(...values: Array<string | undefined>): string {
  let latest: string | undefined;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value === undefined) continue;
    const time = Date.parse(value);
    if (time > latestTime) {
      latest = value;
      latestTime = time;
    }
  }
  if (latest === undefined) {
    throw journalError("invalid_observation", "A timestamp is required");
  }
  return latest;
}

function journalError(
  code: RuntimeObservationJournalErrorCode,
  message: string,
  cause?: unknown,
): RuntimeObservationJournalError {
  return new RuntimeObservationJournalError(code, message, cause);
}
