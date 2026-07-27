type MemorySummaryDimensions = Record<
  string,
  string | number | boolean | undefined
>;

interface MemorySummaryPublicationCarrier {
  summaryId?: string;
  userId?: string;
  sourceRecordIds?: string[];
  summaryText?: string;
  keyPoints?: string[];
  keywords?: string[];
  startTimestamp?: number;
  endTimestamp?: number;
  messageCount?: number;
  dimensions?: MemorySummaryDimensions;
}

export const MEMORY_SUMMARY_PUBLICATION_DIMENSION =
  "__openloomiMemoryPublication";
export const MEMORY_SUMMARY_PUBLICATION_REVISION_DIMENSION =
  "__openloomiMemoryPublicationRevision";
export const MEMORY_SUMMARY_PUBLICATION_EXPECTED_REVISION_DIMENSION =
  "__openloomiMemoryPublicationExpectedRevision";
const PENDING_PUBLICATION = "pending";

function hashString(input: string): string {
  let first = 2166136261;
  let second = 5381;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second, 33) ^ code;
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

export function memorySummaryPublicationRevision(
  summary: MemorySummaryPublicationCarrier,
): string {
  const existing =
    summary.dimensions?.[MEMORY_SUMMARY_PUBLICATION_REVISION_DIMENSION];
  if (typeof existing === "string" && existing.length > 0) return existing;

  const dimensions = Object.entries(summary.dimensions ?? {})
    .filter(
      ([key]) =>
        key !== MEMORY_SUMMARY_PUBLICATION_DIMENSION &&
        key !== MEMORY_SUMMARY_PUBLICATION_REVISION_DIMENSION,
    )
    .sort(([left], [right]) => left.localeCompare(right));
  return `v1:${hashString(
    JSON.stringify({
      summaryId: summary.summaryId,
      userId: summary.userId,
      sourceRecordIds: [...(summary.sourceRecordIds ?? [])].sort(),
      summaryText: summary.summaryText,
      keyPoints: summary.keyPoints ?? [],
      keywords: [...(summary.keywords ?? [])].sort(),
      startTimestamp: summary.startTimestamp,
      endTimestamp: summary.endTimestamp,
      messageCount: summary.messageCount,
      dimensions,
    }),
  )}`;
}

export function isMemorySummaryPublicationPending(
  summary: MemorySummaryPublicationCarrier,
): boolean {
  return (
    summary.dimensions?.[MEMORY_SUMMARY_PUBLICATION_DIMENSION] ===
    PENDING_PUBLICATION
  );
}

// Keep publication state and revision in existing JSON dimensions to avoid a migration.
export function stageMemorySummaryPublication<
  T extends MemorySummaryPublicationCarrier,
>(summary: T): T {
  return {
    ...summary,
    dimensions: {
      ...(summary.dimensions ?? {}),
      [MEMORY_SUMMARY_PUBLICATION_DIMENSION]: PENDING_PUBLICATION,
      [MEMORY_SUMMARY_PUBLICATION_REVISION_DIMENSION]:
        memorySummaryPublicationRevision(summary),
    },
  };
}

export function publishMemorySummary<T extends MemorySummaryPublicationCarrier>(
  summary: T,
  options: { expectedRevision?: string } = {},
): T {
  const dimensions = { ...(summary.dimensions ?? {}) };
  delete dimensions[MEMORY_SUMMARY_PUBLICATION_DIMENSION];
  if (options.expectedRevision) {
    dimensions[MEMORY_SUMMARY_PUBLICATION_EXPECTED_REVISION_DIMENSION] =
      options.expectedRevision;
  }
  return {
    ...summary,
    dimensions: Object.keys(dimensions).length > 0 ? dimensions : undefined,
  };
}
