import "server-only";

import { ensureUserDefaultBot } from "@/lib/db/queries";
import {
  type RawMessageStorageManagerWithSearch,
  getRawMessageManager,
  isRawMessageStorageAvailable,
} from "@/lib/memory/raw-message-store";
import {
  type MemoryGraphLifecycleRuntimeResult,
  type RawMessage,
  runMemoryForgettingCycle,
  storeRawMessagesWithGraphEvolution,
} from "@openloomi/indexeddb";
import type { MemoryGraphEvolutionRunResult } from "@openloomi/memory-consolidation";
import { type ChatMessage, getTextFromMessage } from "@openloomi/shared";
import {
  CHAT_MEMORY_EVIDENCE_ID_PREFIX,
  type MemoryGraphWritePolicyDecision,
  resolveMemoryGraphWritePolicy,
  sanitizeUntrustedMemoryMetadata,
} from "./memory-graph-write-policy";

type SavedChatMessage = ChatMessage & { createdAt: Date };

interface ChatMemoryRevisionMessage {
  id: string;
  role: string;
  parts: unknown;
  metadata?: unknown;
}

type MemoryApplicabilityScope = "global" | "task" | "conversation";

interface PreferenceDimension {
  relationGroup: "language" | "response-style";
  relationValue: string;
}

const PREFERENCE_RELATION_GROUPS: PreferenceDimension["relationGroup"][] = [
  "language",
  "response-style",
];

interface ChatMemoryEvidenceMarker {
  schemaVersion: 1;
  userId: string;
  chatId: string;
  messageId: string;
  sourceIdentityIds: string[];
}

export const CHAT_MEMORY_EVIDENCE_METADATA_KEY = "__openloomiMemoryEvidence";

interface RawEvidenceCandidate {
  messageId: string;
  timestamp: number;
  content: string;
  metadata: Record<string, unknown>;
  importanceScore: number;
}

export type ChatMemoryWriteStatus =
  | "no-op"
  | "baseline"
  | "applied"
  | "partial-failure";

export interface ChatMemoryWriteDiagnostics {
  status: ChatMemoryWriteStatus;
  evidenceCount: number;
  storedCount: number;
  graphPolicy: MemoryGraphWritePolicyDecision;
  graphEvolution?: MemoryGraphEvolutionRunResult;
  graphLifecycle?: MemoryGraphLifecycleRuntimeResult;
  retryable: boolean;
  reasonCodes: string[];
  error?: { name: string; message: string };
}

const LANGUAGE_PATTERNS: Array<{
  value: string;
  patterns: RegExp[];
}> = [
  {
    value: "zh",
    patterns: [
      /\b(?:chinese|mandarin)\b\s+(?:(?:for|in)\s+(?:all\s+)?|as\s+)?(?:responses?|repl(?:y|ies)|answers?)\b/i,
      /\b(?:responses?|repl(?:y|ies)|answers?)\b\s+(?:(?:should|must|can)\s+be\s+|in\s+|using\s+)?(?:chinese|mandarin)\b/i,
      /\b(?:reply|respond|answer|write|speak)\b(?:\s+\w+){0,3}\s+in\s+(?:chinese|mandarin)\b/i,
      /(?:\u4e2d\u6587|\u6c49\u8bed|\u6f22\u8a9e|\u666e\u901a\u8bdd)[^\uff0c\u3002\uff01\uff1f\uff1b\n]{0,10}(?:\u56de\u7b54|\u56de\u590d)/u,
      /(?:\u56de\u7b54|\u56de\u590d)[^\uff0c\u3002\uff01\uff1f\uff1b\n]{0,10}(?:\u4e2d\u6587|\u6c49\u8bed|\u6f22\u8a9e|\u666e\u901a\u8bdd)/u,
    ],
  },
  {
    value: "en",
    patterns: [
      /\benglish\b\s+(?:(?:for|in)\s+(?:all\s+)?|as\s+)?(?:responses?|repl(?:y|ies)|answers?)\b/i,
      /\b(?:responses?|repl(?:y|ies)|answers?)\b\s+(?:(?:should|must|can)\s+be\s+|in\s+|using\s+)?english\b/i,
      /\b(?:reply|respond|answer|write|speak)\b(?:\s+\w+){0,3}\s+in\s+english\b/i,
      /(?:\u82f1\u6587|\u82f1\u8bed)[^\uff0c\u3002\uff01\uff1f\uff1b\n]{0,10}(?:\u56de\u7b54|\u56de\u590d)/u,
      /(?:\u56de\u7b54|\u56de\u590d)[^\uff0c\u3002\uff01\uff1f\uff1b\n]{0,10}(?:\u82f1\u6587|\u82f1\u8bed)/u,
    ],
  },
  {
    value: "ja",
    patterns: [
      /\bjapanese\b\s+(?:(?:for|in)\s+(?:all\s+)?|as\s+)?(?:responses?|repl(?:y|ies)|answers?)\b/i,
      /\b(?:responses?|repl(?:y|ies)|answers?)\b\s+(?:(?:should|must|can)\s+be\s+|in\s+|using\s+)?japanese\b/i,
      /\b(?:reply|respond|answer|write|speak)\b(?:\s+\w+){0,3}\s+in\s+japanese\b/i,
      /(?:\u65e5\u6587|\u65e5\u8bed|\u65e5\u672c\u8a9e)[^\uff0c\u3002\uff01\uff1f\uff1b\n]{0,10}(?:\u56de\u7b54|\u56de\u590d)/u,
      /(?:\u56de\u7b54|\u56de\u590d)[^\uff0c\u3002\uff01\uff1f\uff1b\n]{0,10}(?:\u65e5\u6587|\u65e5\u8bed|\u65e5\u672c\u8a9e)/u,
    ],
  },
];

const STYLE_PATTERNS: Array<{
  value: string;
  patterns: RegExp[];
}> = [
  {
    value: "concise",
    patterns: [
      /\b(?:concise|brief|short)\s+(?:responses?|repl(?:y|ies)|answers?)\b/i,
      /\b(?:responses?|repl(?:y|ies)|answers?)\b\s+(?:(?:should|must|need(?:s)?\s+to)\s+be\s+|to\s+be\s+|be\s+)?(?:concise|brief|short)\b/i,
      /\b(?:reply|respond|answer|write)\b(?:\s+\w+){0,2}\s+(?:concisely|briefly)\b/i,
      /(?:\u7b80\u6d01|\u7b80\u77ed)[^\uff0c\u3002\uff01\uff1f\uff1b\n]{0,8}(?:\u56de\u7b54|\u56de\u590d)/u,
      /(?:\u56de\u7b54|\u56de\u590d)[^\uff0c\u3002\uff01\uff1f\uff1b\n]{0,8}(?:\u7b80\u6d01|\u7b80\u77ed)/u,
    ],
  },
  {
    value: "detailed",
    patterns: [
      /\b(?:detailed|thorough|comprehensive)\s+(?:responses?|repl(?:y|ies)|answers?)\b/i,
      /\b(?:responses?|repl(?:y|ies)|answers?)\b\s+(?:(?:should|must|need(?:s)?\s+to)\s+be\s+|to\s+be\s+|be\s+)?(?:detailed|thorough|comprehensive)\b/i,
      /\b(?:reply|respond|answer|write)\b(?:\s+\w+){0,2}\s+(?:thoroughly|comprehensively|in\s+detail)\b/i,
      /(?:\u8be6\u7ec6|\u5168\u9762)[^\uff0c\u3002\uff01\uff1f\uff1b\n]{0,8}(?:\u56de\u7b54|\u56de\u590d)/u,
      /(?:\u56de\u7b54|\u56de\u590d)[^\uff0c\u3002\uff01\uff1f\uff1b\n]{0,8}(?:\u8be6\u7ec6|\u5168\u9762)/u,
    ],
  },
];

const DURABLE_PREFERENCE_PATTERNS = [
  /\b(?:i|we)\s+(?:really\s+)?(?:prefer|like)\b/i,
  /\b(?:always|from now on|going forward|remember(?: that)?)\b/i,
  /\u6211(?:\u4e00\u76f4)?(?:\u66f4)?(?:\u559c\u6b22|\u504f\u597d|\u4e60\u60ef)/u,
  /\u4ee5\u540e|\u4eca\u540e|\u603b\u662f|\u8bb0\u4f4f/u,
];

const TEMPORARY_PATTERNS = [
  /\b(?:for|in)\s+(?:just\s+)?(?:this|the current)\s+(?:task|conversation|chat|session|request|reply)\b/i,
  /\b(?:for|in)\s+(?:just\s+)?(?:this|the current)\s+(?:project|workspace|domain)\b/i,
  /\b(?:when|while)\s+(?:working|writing|speaking|responding)\s+(?:on|in|for)\s+(?:this|the current)\s+(?:project|workspace|domain)\b/i,
  /\b(?:within|throughout)\s+(?:this|the current)\s+(?:project|workspace|domain)\b/i,
  /\b(?:for|in|within|throughout)\s+(?:the\s+)?(?:project|workspace|domain)\s+(?!(?:all|every|any)\b)[^,.;:!?\n]{1,64}(?=[,.;:!?])/i,
  /\b(?:for|in|within|throughout)\s+(?!(?:all|every|any)\b)(?:the\s+)?[^,.;:!?\n]{1,48}\s+(?:project|workspace|domain)\b/i,
  /\b(?:when|while)\s+working\s+(?:on|in|for)\s+(?!(?:all|every|any)\b)[^,.;:!?\n]{1,64}(?=[,.;:!?])/i,
  /(?:\u5728|\u5f53)[^\uff0c\u3002\uff01\uff1f\uff1b\n]{1,40}(?:\u9879\u76ee|\u5de5\u4f5c\u533a|\u9886\u57df)(?:\u4e2d|\u91cc|\u5185)?/u,
  /\b(?:just\s+)?for\s+(?:today|tonight|this\s+(?:day|week|month))\b/i,
  /\b(?:today|tonight|temporarily)\b/i,
  /\bfor now\b/i,
  /(?:\u8fd9\u6b21|\u672c\u6b21|\u5f53\u524d|\u8fd9\u4e2a|\u672c)(?:\u4efb\u52a1|\u5bf9\u8bdd|\u4f1a\u8bdd|\u8bf7\u6c42|\u56de\u590d)/u,
  /(?:\u8fd9\u4e2a|\u5f53\u524d|\u672c)(?:\u9879\u76ee|\u5de5\u4f5c\u533a|\u9886\u57df)/u,
  /(?:\u4eca\u5929|\u4eca\u65e5|\u6682\u65f6|\u4e34\u65f6)/u,
];

const NEGATED_PREFERENCE_PATTERNS = [
  /\bprefer\s+not\b/i,
  /\b(?:do\s+not|don't|never)\s+(?:reply|respond|answer|write|speak)\b/i,
  /\bnon[-\s]?(?:english|chinese|mandarin|japanese)\s+(?:responses?|repl(?:y|ies)|answers?)\b/i,
  /\b(?:always\s+)?avoid\s+(?:\w+\s+){0,3}(?:responses?|repl(?:y|ies)|answers?)\b/i,
  /(?:\u4e0d\u8981|\u522b)(?:\u518d)?(?:\u7528|\u4f7f\u7528|\u56de\u7b54|\u56de\u590d)/u,
  /\u907f\u514d[^\uff0c\u3002\uff01\uff1f\uff1b\n]{0,12}(?:\u56de\u7b54|\u56de\u590d)/u,
  /\u6211(?:\u4e0d\u559c\u6b22|\u4e0d\u5e0c\u671b|\u4e0d\u60f3)(?:\u6536\u5230|\u4f7f\u7528|\u7528)?/u,
];

const TASK_PATTERNS = [
  /\b(?:this|the current)\s+task\b/i,
  /(?:\u8fd9\u6b21|\u672c\u6b21|\u5f53\u524d|\u8fd9\u4e2a|\u672c)\u4efb\u52a1/u,
];

const INSTRUCTION_PATTERNS = [
  /\b(?:please\s+)?(?:reply|respond|answer|write|speak)\b/i,
  /(?:\u8bf7)?(?:\u7528|\u4f7f\u7528).*(?:\u56de\u7b54|\u56de\u590d)/u,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function firstValue(
  text: string,
  candidates: Array<{ value: string; patterns: RegExp[] }>,
): string | undefined {
  return candidates.find((candidate) => matchesAny(text, candidate.patterns))
    ?.value;
}

function preferenceDimensions(text: string): PreferenceDimension[] {
  const hasDurableSignal = matchesAny(text, DURABLE_PREFERENCE_PATTERNS);
  if (matchesAny(text, NEGATED_PREFERENCE_PATTERNS)) {
    return [];
  }
  const hasTemporarySignal = matchesAny(text, TEMPORARY_PATTERNS);
  const hasInstructionSignal = matchesAny(text, INSTRUCTION_PATTERNS);
  if (!hasDurableSignal && !hasTemporarySignal && !hasInstructionSignal) {
    return [];
  }

  const dimensions: PreferenceDimension[] = [];
  const language = firstValue(text, LANGUAGE_PATTERNS);
  if (language) {
    dimensions.push({ relationGroup: "language", relationValue: language });
  }
  const style = firstValue(text, STYLE_PATTERNS);
  if (style) {
    dimensions.push({
      relationGroup: "response-style",
      relationValue: style,
    });
  }
  return dimensions;
}

function applicabilityScope(text: string): MemoryApplicabilityScope {
  if (matchesAny(text, TEMPORARY_PATTERNS)) {
    return matchesAny(text, TASK_PATTERNS) ? "task" : "conversation";
  }
  return matchesAny(text, DURABLE_PREFERENCE_PATTERNS)
    ? "global"
    : "conversation";
}

function messageText(message: SavedChatMessage): string {
  return Array.isArray(message.parts) ? getTextFromMessage(message).trim() : "";
}
function rawEvidenceIdentity(input: {
  userId: string;
  chatId: string;
  messageId: string;
  relationGroup: PreferenceDimension["relationGroup"];
}): string {
  return `${CHAT_MEMORY_EVIDENCE_ID_PREFIX}${[
    encodeURIComponent(input.userId),
    encodeURIComponent(input.chatId),
    encodeURIComponent(input.messageId),
    input.relationGroup,
  ].join(":")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sourceIdentityIdsForState(input: {
  userId: string;
  chatId: string;
  messageId: string;
  state: ReturnType<typeof revisionState>;
}): string[] {
  return input.state.dimensions.map((dimension) =>
    rawEvidenceIdentity({
      userId: input.userId,
      chatId: input.chatId,
      messageId: input.messageId,
      relationGroup: dimension.relationGroup,
    }),
  );
}

function sourceIdentityIdsForMessage(input: {
  userId: string;
  chatId: string;
  messageId: string;
}): string[] {
  return PREFERENCE_RELATION_GROUPS.map((relationGroup) =>
    rawEvidenceIdentity({ ...input, relationGroup }),
  );
}

function hasPersistedEvidenceMarker(input: {
  userId: string;
  chatId: string;
  message: ChatMemoryRevisionMessage;
  state: ReturnType<typeof revisionState>;
}): boolean {
  if (!isRecord(input.message.metadata)) return false;
  const marker = input.message.metadata[CHAT_MEMORY_EVIDENCE_METADATA_KEY] as
    | Partial<ChatMemoryEvidenceMarker>
    | undefined;
  if (!isRecord(marker) || !Array.isArray(marker.sourceIdentityIds)) {
    return false;
  }
  const expectedIds = sourceIdentityIdsForState({
    userId: input.userId,
    chatId: input.chatId,
    messageId: input.message.id,
    state: input.state,
  });
  return (
    marker.schemaVersion === 1 &&
    marker.userId === input.userId &&
    marker.chatId === input.chatId &&
    marker.messageId === input.message.id &&
    marker.sourceIdentityIds.length === expectedIds.length &&
    expectedIds.every((id) => marker.sourceIdentityIds?.includes(id))
  );
}

export function buildPersistedChatMemoryMetadata(input: {
  userId: string;
  chatId: string;
  message: ChatMemoryRevisionMessage;
  metadata?: unknown;
}): Record<string, unknown> | undefined {
  const metadata = isRecord(input.metadata) ? { ...input.metadata } : {};
  delete metadata[CHAT_MEMORY_EVIDENCE_METADATA_KEY];

  if (input.message.role === "user" && typeof input.message.id === "string") {
    const state = revisionState(input.message);
    if (state.dimensions.length > 0) {
      const marker: ChatMemoryEvidenceMarker = {
        schemaVersion: 1,
        userId: input.userId,
        chatId: input.chatId,
        messageId: input.message.id,
        sourceIdentityIds: sourceIdentityIdsForState({
          userId: input.userId,
          chatId: input.chatId,
          messageId: input.message.id,
          state,
        }),
      };
      metadata[CHAT_MEMORY_EVIDENCE_METADATA_KEY] = marker;
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function revisionState(message: ChatMemoryRevisionMessage): {
  text: string;
  dimensions: PreferenceDimension[];
} {
  const text = messageText(message as SavedChatMessage);
  return { text, dimensions: preferenceDimensions(text) };
}

function sameRevisionState(
  left: ReturnType<typeof revisionState>,
  right: ReturnType<typeof revisionState>,
): boolean {
  return (
    left.text === right.text &&
    left.dimensions.length === right.dimensions.length &&
    left.dimensions.every((dimension, index) => {
      const candidate = right.dimensions[index];
      return (
        candidate?.relationGroup === dimension.relationGroup &&
        candidate.relationValue === dimension.relationValue
      );
    })
  );
}

export interface ChatMemoryRevisionConflict {
  messageId: string;
  reasonCode:
    | "chat_memory_evidence_revision_conflict"
    | "chat_memory_evidence_revision_check_unavailable";
  retryable: boolean;
}

function persistedEvidenceMatchesState(input: {
  evidence: RawMessage;
  userId: string;
  chatId: string;
  messageId: string;
  state: ReturnType<typeof revisionState>;
}): boolean {
  const metadata = isRecord(input.evidence.metadata)
    ? input.evidence.metadata
    : {};
  const expectedIds = sourceIdentityIdsForState({
    userId: input.userId,
    chatId: input.chatId,
    messageId: input.messageId,
    state: input.state,
  });
  return (
    expectedIds.includes(input.evidence.messageId) &&
    input.evidence.userId === input.userId &&
    input.evidence.platform === "openloomi-chat" &&
    input.evidence.channel === input.chatId &&
    input.evidence.person === input.userId &&
    input.evidence.content === input.state.text &&
    metadata.source === "chat-save-messages" &&
    metadata.sourceChatId === input.chatId &&
    metadata.sourceMessageId === input.messageId
  );
}

export async function findChatMemoryRevisionConflict(input: {
  userId: string;
  chatId: string;
  existingMessages: ChatMemoryRevisionMessage[];
  incomingMessages: ChatMemoryRevisionMessage[];
}): Promise<ChatMemoryRevisionConflict | null> {
  const incomingById = new Map(
    input.incomingMessages.map((message) => [message.id, message]),
  );
  const revisions = input.existingMessages.flatMap((existing) => {
    const incoming = incomingById.get(existing.id);
    if (!incoming || existing.role !== "user") return [];
    const existingState = revisionState(existing);
    if (
      existingState.dimensions.length === 0 ||
      sameRevisionState(existingState, revisionState(incoming))
    ) {
      return [];
    }
    return [
      {
        messageId: existing.id,
        evidenceIds: sourceIdentityIdsForState({
          userId: input.userId,
          chatId: input.chatId,
          messageId: existing.id,
          state: existingState,
        }),
        markerProtected: hasPersistedEvidenceMarker({
          userId: input.userId,
          chatId: input.chatId,
          message: existing,
          state: existingState,
        }),
      },
    ];
  });
  const incomingProbes = input.incomingMessages.flatMap((incoming) => {
    if (incoming.role !== "user") return [];
    const state = revisionState(incoming);
    return [
      {
        messageId: incoming.id,
        state,
        evidenceIds: sourceIdentityIdsForMessage({
          userId: input.userId,
          chatId: input.chatId,
          messageId: incoming.id,
        }),
      },
    ];
  });

  const markerProtectedRevision = revisions.find(
    (revision) => revision.markerProtected,
  );
  if (markerProtectedRevision) {
    return {
      messageId: markerProtectedRevision.messageId,
      reasonCode: "chat_memory_evidence_revision_conflict",
      retryable: false,
    };
  }
  if (revisions.length === 0 && incomingProbes.length === 0) return null;

  const unavailable = (): ChatMemoryRevisionConflict => ({
    messageId: revisions[0]?.messageId ?? incomingProbes[0].messageId,
    reasonCode: "chat_memory_evidence_revision_check_unavailable",
    retryable: true,
  });
  if (!isRawMessageStorageAvailable()) {
    return revisions.length > 0 ? unavailable() : null;
  }

  let manager: RawMessageStorageManagerWithSearch;
  try {
    manager = await getRawMessageManager();
  } catch {
    return revisions.length > 0 ? unavailable() : null;
  }

  for (const revision of revisions) {
    for (const evidenceId of revision.evidenceIds) {
      try {
        if (await manager.getMessageById(evidenceId)) {
          return {
            messageId: revision.messageId,
            reasonCode: "chat_memory_evidence_revision_conflict",
            retryable: false,
          };
        }
      } catch {
        return unavailable();
      }
    }
  }

  for (const probe of incomingProbes) {
    for (const evidenceId of probe.evidenceIds) {
      let evidence: RawMessage | null;
      try {
        evidence = await manager.getMessageById(evidenceId);
      } catch {
        return null;
      }
      if (
        evidence &&
        !persistedEvidenceMatchesState({
          evidence,
          userId: input.userId,
          chatId: input.chatId,
          messageId: probe.messageId,
          state: probe.state,
        })
      ) {
        return {
          messageId: probe.messageId,
          reasonCode: "chat_memory_evidence_revision_conflict",
          retryable: false,
        };
      }
    }
  }

  return null;
}

function buildRawEvidenceCandidates(input: {
  userId: string;
  chatId: string;
  messages: SavedChatMessage[];
}): RawEvidenceCandidate[] {
  return input.messages.flatMap((message) => {
    if (message.role !== "user" || typeof message.id !== "string") return [];
    const text = messageText(message);
    if (!text) return [];
    const scope = applicabilityScope(text);
    const createdAt = message.createdAt.getTime();
    if (!Number.isFinite(createdAt)) return [];
    const timestamp = Math.floor(createdAt / 1000);
    return preferenceDimensions(text).map((dimension): RawEvidenceCandidate => {
      const sourceIdentity = rawEvidenceIdentity({
        userId: input.userId,
        chatId: input.chatId,
        messageId: message.id,
        relationGroup: dimension.relationGroup,
      });
      return {
        messageId: sourceIdentity,
        timestamp,
        content: text,
        metadata: {
          source: "chat-save-messages",
          sourceChatId: input.chatId,
          sourceMessageId: message.id,
          sourceIdentity,
          relationGroup: dimension.relationGroup,
          relationValue: dimension.relationValue,
          memoryTopicKeys: [dimension.relationGroup],
          memoryApplicability:
            scope === "global" ? { scope } : { scope, key: input.chatId },
        },
        importanceScore: scope === "global" ? 0.8 : 0.4,
      };
    });
  });
}

function buildRawEvidence(input: {
  userId: string;
  chatId: string;
  botId: string;
  candidates: RawEvidenceCandidate[];
}): RawMessage[] {
  return input.candidates.map((candidate) => ({
    ...candidate,
    platform: "openloomi-chat",
    botId: input.botId,
    userId: input.userId,
    channel: input.chatId,
    person: input.userId,
    attachments: [],
    createdAt: candidate.timestamp,
    memoryStage: "short",
  }));
}

function supportsGraphEvolution(
  manager: RawMessageStorageManagerWithSearch,
): boolean {
  const candidate = manager as Partial<RawMessageStorageManagerWithSearch> & {
    compareAndSwapGraphLedger?: unknown;
  };
  return (
    typeof candidate.storeMessage === "function" &&
    typeof candidate.storeMessages === "function" &&
    typeof candidate.compareAndSwapGraphLedger === "function" &&
    typeof candidate.getMessageById === "function" &&
    typeof candidate.queryMessages === "function"
  );
}

function errorInfo(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

async function countPersistedEvidence(
  manager: RawMessageStorageManagerWithSearch,
  evidence: RawMessage[],
): Promise<number> {
  const persisted = await Promise.all(
    evidence.map(async (message) => {
      try {
        return (await manager.getMessageById(message.messageId)) !== null;
      } catch {
        return false;
      }
    }),
  );
  return persisted.filter(Boolean).length;
}

function lifecycleCanRun(graph: MemoryGraphEvolutionRunResult): boolean {
  return graph.status === "applied" || graph.status === "no-op";
}

export async function writeSavedChatMessagesToMemory(input: {
  userId: string;
  chatId: string;
  messages: SavedChatMessage[];
  now?: number;
}): Promise<ChatMemoryWriteDiagnostics> {
  const now = input.now ?? Date.now();
  const graphPolicy = resolveMemoryGraphWritePolicy(input.userId);
  const candidates = buildRawEvidenceCandidates(input);
  const baseReasonCodes = [...graphPolicy.reasonCodes];

  if (candidates.length === 0) {
    return {
      status: "no-op",
      evidenceCount: 0,
      storedCount: 0,
      graphPolicy,
      retryable: false,
      reasonCodes: unique([
        ...baseReasonCodes,
        "chat_memory_no_supported_evidence",
      ]),
    };
  }

  if (!isRawMessageStorageAvailable()) {
    return {
      status: "baseline",
      evidenceCount: candidates.length,
      storedCount: 0,
      graphPolicy,
      retryable: true,
      reasonCodes: unique([
        ...baseReasonCodes,
        "chat_memory_raw_adapter_missing",
      ]),
    };
  }

  let manager: RawMessageStorageManagerWithSearch;
  try {
    manager = await getRawMessageManager();
  } catch (error) {
    return {
      status: "partial-failure",
      evidenceCount: candidates.length,
      storedCount: 0,
      graphPolicy,
      retryable: true,
      reasonCodes: unique([...baseReasonCodes, "chat_memory_raw_write_failed"]),
      error: errorInfo(error),
    };
  }

  let botId: string;
  try {
    botId = await ensureUserDefaultBot(input.userId);
  } catch (error) {
    return {
      status: "partial-failure",
      evidenceCount: candidates.length,
      storedCount: 0,
      graphPolicy,
      retryable: true,
      reasonCodes: unique([
        ...baseReasonCodes,
        "chat_memory_bot_resolution_failed",
      ]),
      error: errorInfo(error),
    };
  }

  const evidence = buildRawEvidence({
    userId: input.userId,
    chatId: input.chatId,
    botId,
    candidates,
  });

  try {
    const graphAdapterAvailable = supportsGraphEvolution(manager);
    if (!graphPolicy.enabled || !graphAdapterAvailable) {
      const baselineEvidence = evidence.map((message) => ({
        ...message,
        metadata: sanitizeUntrustedMemoryMetadata(message.metadata),
      }));
      const ids = await manager.storeMessages(baselineEvidence);
      return {
        status: "baseline",
        evidenceCount: evidence.length,
        storedCount: ids.length,
        graphPolicy,
        retryable: graphPolicy.enabled && !graphAdapterAvailable,
        reasonCodes: unique([
          ...baseReasonCodes,
          ...(graphPolicy.enabled
            ? ["chat_memory_graph_adapter_missing"]
            : ["chat_memory_baseline_raw_write"]),
        ]),
      };
    }
    const stored = await storeRawMessagesWithGraphEvolution({
      storage: manager,
      messages: evidence,
      graphEvolution: { enabled: true },
      now,
    });
    if (!lifecycleCanRun(stored.graphEvolution)) {
      return {
        status: "partial-failure",
        evidenceCount: evidence.length,
        storedCount: stored.ids.length,
        graphPolicy,
        graphEvolution: stored.graphEvolution,
        retryable: true,
        reasonCodes: unique([
          ...baseReasonCodes,
          ...stored.graphEvolution.reasonCodes,
          "chat_memory_lifecycle_skipped_after_graph_failure",
        ]),
        error: stored.graphEvolution.error,
      };
    }

    try {
      const forgetting = await runMemoryForgettingCycle(manager, input.userId, {
        now,
        graphLifecycle: { enabled: true },
      });
      const graphLifecycle = forgetting.graphLifecycle;
      const graphLifecycleStatus = graphLifecycle?.status;
      if (!graphLifecycle || !graphLifecycleStatus) {
        return {
          status: "partial-failure",
          evidenceCount: evidence.length,
          storedCount: stored.ids.length,
          graphPolicy,
          graphEvolution: stored.graphEvolution,
          retryable: true,
          reasonCodes: unique([
            ...baseReasonCodes,
            ...stored.graphEvolution.reasonCodes,
            "chat_memory_graph_lifecycle_missing",
          ]),
        };
      }

      const lifecycleSucceeded =
        graphLifecycleStatus === "applied" || graphLifecycleStatus === "no-op";
      return {
        status: !lifecycleSucceeded
          ? "partial-failure"
          : stored.graphEvolution.status === "no-op" &&
              graphLifecycleStatus === "no-op"
            ? "no-op"
            : "applied",
        evidenceCount: evidence.length,
        storedCount: stored.ids.length,
        graphPolicy,
        graphEvolution: stored.graphEvolution,
        graphLifecycle,
        retryable: !lifecycleSucceeded,
        reasonCodes: unique([
          ...baseReasonCodes,
          ...stored.graphEvolution.reasonCodes,
          ...graphLifecycle.reasonCodes,
        ]),
        error: graphLifecycle.error,
      };
    } catch (error) {
      const details = errorInfo(error);
      return {
        status: "partial-failure",
        evidenceCount: evidence.length,
        storedCount: stored.ids.length,
        graphPolicy,
        graphEvolution: stored.graphEvolution,
        retryable: true,
        reasonCodes: unique([
          ...baseReasonCodes,
          ...stored.graphEvolution.reasonCodes,
          "chat_memory_graph_lifecycle_failed",
        ]),
        error: details,
      };
    }
  } catch (error) {
    const details = errorInfo(error);
    const storedCount = supportsGraphEvolution(manager)
      ? await countPersistedEvidence(manager, evidence)
      : 0;
    return {
      status: "partial-failure",
      evidenceCount: evidence.length,
      storedCount,
      graphPolicy,
      retryable: true,
      reasonCodes: unique([
        ...baseReasonCodes,
        storedCount > 0
          ? "chat_memory_graph_write_failed_after_raw_persisted"
          : "chat_memory_raw_write_failed",
      ]),
      error: details,
    };
  }
}
