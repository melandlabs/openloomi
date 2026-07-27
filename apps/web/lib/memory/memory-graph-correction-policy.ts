import "server-only";

import {
  type MemoryGraphWriteEnvironment,
  type MemoryGraphWritePolicyDecision,
  resolveAllowlistedMemoryGraphPolicy,
} from "./memory-graph-write-policy";

export function resolveMemoryGraphCorrectionPolicy(
  userId: string,
  environment: MemoryGraphWriteEnvironment = process.env,
): MemoryGraphWritePolicyDecision {
  return resolveAllowlistedMemoryGraphPolicy({
    userId,
    enabled: environment.OPENLOOMI_MEMORY_GRAPH_CORRECTION_ENABLED,
    killSwitch: environment.OPENLOOMI_MEMORY_GRAPH_CORRECTION_KILL_SWITCH,
    allowlist: environment.OPENLOOMI_MEMORY_GRAPH_CORRECTION_OPERATOR_USER_IDS,
    reasonCodes: {
      killed: "memory_graph_correction_kill_switch",
      disabled: "memory_graph_correction_disabled",
      missed: "memory_graph_correction_operator_miss",
      enabled: "memory_graph_correction_operator_enabled",
    },
  });
}
