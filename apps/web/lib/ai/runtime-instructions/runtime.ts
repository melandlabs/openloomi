import type {
  RuntimeClockPort,
  RuntimeIdGeneratorPort,
} from "@openloomi/ai/agent/runtime-instructions";

import { GoalService } from "./goal-service";
import { InMemoryAgentGoalState } from "./in-memory-goal-state";
import { RuntimeInstructionDispatcher } from "./instruction-dispatcher";
import { RuntimeSessionRegistry } from "./runtime-session-registry";

export interface InMemoryAgentGoalRuntime {
  readonly state: InMemoryAgentGoalState;
  readonly sessions: RuntimeSessionRegistry;
  readonly dispatcher: RuntimeInstructionDispatcher;
  readonly goals: GoalService;
}

export type AgentGoalRuntime = Pick<
  InMemoryAgentGoalRuntime,
  "sessions" | "goals"
>;

export function createInMemoryAgentGoalRuntime(
  options: {
    clock?: RuntimeClockPort;
    idGenerator?: RuntimeIdGeneratorPort;
  } = {},
): InMemoryAgentGoalRuntime {
  const state = new InMemoryAgentGoalState();
  const sessions = new RuntimeSessionRegistry();
  const dispatcher = new RuntimeInstructionDispatcher(sessions, state);
  const goals = new GoalService(
    state,
    dispatcher,
    options.clock ?? { now: () => new Date() },
    options.idGenerator ?? { generate: () => crypto.randomUUID() },
  );
  return { state, sessions, dispatcher, goals };
}

let agentGoalRuntime: InMemoryAgentGoalRuntime | undefined;

/**
 * Process-local composition root used by Claude sessions and future Goal
 * entry points. A durable state adapter can replace the in-memory adapter
 * without changing callers.
 */
export function getAgentGoalRuntime(): AgentGoalRuntime {
  agentGoalRuntime ??= createInMemoryAgentGoalRuntime();
  return agentGoalRuntime;
}
