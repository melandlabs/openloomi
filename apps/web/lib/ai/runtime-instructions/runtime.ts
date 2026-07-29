import type {
  RuntimeClockPort,
  RuntimeIdGeneratorPort,
} from "@openloomi/ai/agent/runtime-instructions";

import { GoalService } from "./goal-service";
import { GoalLifecycleService } from "./goal-lifecycle-service";
import { GoalReplacementCoordinator } from "./goal-replacement-coordinator";
import { InMemoryAgentGoalState } from "./in-memory-goal-state";
import { RuntimeInstructionDispatcher } from "./instruction-dispatcher";
import { RuntimeSessionRegistry } from "./runtime-session-registry";

export interface InMemoryAgentGoalRuntime {
  readonly state: InMemoryAgentGoalState;
  readonly sessions: RuntimeSessionRegistry;
  readonly dispatcher: RuntimeInstructionDispatcher;
  readonly goals: GoalService;
  readonly replacements: GoalReplacementCoordinator;
}

export type AgentGoalRuntime = Pick<
  InMemoryAgentGoalRuntime,
  "sessions" | "goals" | "replacements"
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
  const clock = options.clock ?? { now: () => new Date() };
  const idGenerator = options.idGenerator ?? {
    generate: () => crypto.randomUUID(),
  };
  const lifecycle = new GoalLifecycleService(
    state,
    dispatcher,
    sessions,
    clock,
    idGenerator,
  );
  const goals = new GoalService(
    state,
    dispatcher,
    clock,
    idGenerator,
    lifecycle,
  );
  const replacements = new GoalReplacementCoordinator(
    state,
    dispatcher,
    sessions,
    clock,
    idGenerator,
  );
  return { state, sessions, dispatcher, goals, replacements };
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
