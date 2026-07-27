import "server-only";

import { CHAT_MEMORY_EVIDENCE_ID_PREFIX } from "@openloomi/indexeddb";

export { CHAT_MEMORY_EVIDENCE_ID_PREFIX };

export interface MemoryGraphWritePolicyDecision {
  enabled: boolean;
  reasonCodes: string[];
}

export type MemoryGraphWriteEnvironment = Readonly<
  Record<string, string | undefined>
>;

export function isReservedChatMemoryEvidenceId(messageId: string): boolean {
  return messageId.startsWith(CHAT_MEMORY_EVIDENCE_ID_PREFIX);
}

const MEMORY_GRAPH_SUMMARY_ID_PREFIXES = [
  "memory-graph-summary:",
  "memory-graph-correction:",
];

export function isReservedMemoryGraphSummaryId(summaryId: string): boolean {
  return MEMORY_GRAPH_SUMMARY_ID_PREFIXES.some((prefix) =>
    summaryId.startsWith(prefix),
  );
}

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function cohortUserIds(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function resolveAllowlistedMemoryGraphPolicy(input: {
  userId: string;
  enabled: string | undefined;
  killSwitch: string | undefined;
  allowlist: string | undefined;
  reasonCodes: {
    killed: string;
    disabled: string;
    missed: string;
    enabled: string;
  };
}): MemoryGraphWritePolicyDecision {
  if (enabled(input.killSwitch)) {
    return { enabled: false, reasonCodes: [input.reasonCodes.killed] };
  }
  if (!enabled(input.enabled)) {
    return { enabled: false, reasonCodes: [input.reasonCodes.disabled] };
  }
  if (!cohortUserIds(input.allowlist).has(input.userId)) {
    return { enabled: false, reasonCodes: [input.reasonCodes.missed] };
  }
  return { enabled: true, reasonCodes: [input.reasonCodes.enabled] };
}

export function resolveMemoryGraphWritePolicy(
  userId: string,
  environment: MemoryGraphWriteEnvironment = process.env,
): MemoryGraphWritePolicyDecision {
  return resolveAllowlistedMemoryGraphPolicy({
    userId,
    enabled: environment.OPENLOOMI_MEMORY_GRAPH_WRITE_ENABLED,
    killSwitch: environment.OPENLOOMI_MEMORY_GRAPH_WRITE_KILL_SWITCH,
    allowlist: environment.OPENLOOMI_MEMORY_GRAPH_WRITE_COHORT_USER_IDS,
    reasonCodes: {
      killed: "memory_graph_write_kill_switch",
      disabled: "memory_graph_write_disabled",
      missed: "memory_graph_write_cohort_miss",
      enabled: "memory_graph_write_cohort_enabled",
    },
  });
}

const UNTRUSTED_GRAPH_METADATA_KEYS = [
  "relationGroup",
  "relationValue",
  "topicKeys",
  "memoryTopicKeys",
  "memoryApplicability",
  "memoryRelation",
  "sourceIdentity",
  "memoryOwnerScope",
] as const;

export function sanitizeUntrustedMemoryMetadata(
  metadata: unknown,
): Record<string, unknown> | undefined {
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata)
  ) {
    return undefined;
  }

  const sanitized = { ...metadata } as Record<string, unknown>;
  for (const key of UNTRUSTED_GRAPH_METADATA_KEYS) {
    delete sanitized[key];
  }
  return sanitized;
}

export function resolveUntrustedRawMemoryGraphWritePolicy(): MemoryGraphWritePolicyDecision {
  return {
    enabled: false,
    reasonCodes: [
      "memory_graph_write_untrusted_raw_baseline_only",
      "untrusted_graph_metadata_discarded",
    ],
  };
}
