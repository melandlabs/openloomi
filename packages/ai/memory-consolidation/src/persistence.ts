import type {
  MemorySemanticDraftCandidate,
  SemanticMemoryDraft,
} from "./semantic-draft";

export interface SemanticMemoryDraftPersistenceItem {
  candidate: MemorySemanticDraftCandidate;
  draft: SemanticMemoryDraft;
}

export interface PersistedSemanticMemoryDraft {
  draftId: string;
  type: SemanticMemoryDraft["type"];
  content: string;
  sourceRecordIds: string[];
  confidence: number;
  metadata?: Record<string, unknown>;
  sourceClusterKey: string;
  competitionKey: string;
  evidenceCount: number;
  score: number;
  reasonCodes: MemorySemanticDraftCandidate["reasonCodes"];
  createdAt: number;
}

export interface SemanticMemoryDraftStoreSaveInput {
  userId: string;
  drafts: PersistedSemanticMemoryDraft[];
  now: number;
  dryRun: false;
}

export interface SemanticMemoryDraftStore {
  saveDrafts(input: SemanticMemoryDraftStoreSaveInput): Promise<void>;
}

export interface PersistSemanticMemoryDraftsInput {
  userId: string;
  items: SemanticMemoryDraftPersistenceItem[];
  store?: SemanticMemoryDraftStore;
  now?: number;
  enabled?: boolean;
  dryRun?: boolean;
}

export interface PersistSemanticMemoryDraftsResult {
  status: "disabled" | "dry-run" | "persisted";
  userId: string;
  dryRun: boolean;
  plannedDrafts: PersistedSemanticMemoryDraft[];
  persistedCount: number;
  skippedReason?: "persistence_disabled" | "dry_run";
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function buildPersistedDraft(
  item: SemanticMemoryDraftPersistenceItem,
  createdAt: number,
): PersistedSemanticMemoryDraft {
  return {
    draftId: item.candidate.draftId,
    type: item.draft.type,
    content: item.draft.content,
    sourceRecordIds: [...item.candidate.sourceRecordIds],
    confidence: clamp01(item.draft.confidence),
    metadata: item.draft.metadata ? { ...item.draft.metadata } : undefined,
    sourceClusterKey: item.candidate.sourceClusterKey,
    competitionKey: item.candidate.competitionKey,
    evidenceCount: item.candidate.evidenceCount,
    score: item.candidate.score,
    reasonCodes: [...item.candidate.reasonCodes],
    createdAt,
  };
}

export async function persistSemanticMemoryDrafts(
  input: PersistSemanticMemoryDraftsInput,
): Promise<PersistSemanticMemoryDraftsResult> {
  const now = input.now ?? Date.now();
  const plannedDrafts = input.items.map((item) =>
    buildPersistedDraft(item, now),
  );

  if (input.enabled !== true) {
    return {
      status: "disabled",
      userId: input.userId,
      dryRun: input.dryRun !== false,
      plannedDrafts,
      persistedCount: 0,
      skippedReason: "persistence_disabled",
    };
  }

  if (input.dryRun !== false) {
    return {
      status: "dry-run",
      userId: input.userId,
      dryRun: true,
      plannedDrafts,
      persistedCount: 0,
      skippedReason: "dry_run",
    };
  }

  if (!input.store) {
    throw new Error("Semantic draft persistence requires a store.");
  }

  await input.store.saveDrafts({
    userId: input.userId,
    drafts: plannedDrafts,
    now,
    dryRun: false,
  });

  return {
    status: "persisted",
    userId: input.userId,
    dryRun: false,
    plannedDrafts,
    persistedCount: plannedDrafts.length,
  };
}
