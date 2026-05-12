import type { MemoryRecord } from "./contracts";

export const MEMORY_RECORD_EMBEDDING_TEXT_VERSION =
  "memory-record-embedding-text-v1";

const DEFAULT_MAX_TEXT_LENGTH = 8_000;

export type MemoryRecordEmbeddingTextInput = Partial<
  Record<
    keyof Pick<
      MemoryRecord,
      | "id"
      | "timestamp"
      | "text"
      | "mediaRefs"
      | "tier"
      | "dimensions"
      | "metadata"
    >,
    unknown
  >
>;

export interface BuildMemoryRecordEmbeddingTextOptions {
  maxLength?: number;
}

export interface MemoryRecordEmbeddingDocument {
  content: string;
  contentHash: string;
  textVersion: typeof MEMORY_RECORD_EMBEDDING_TEXT_VERSION;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatPrimitive(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "string") {
    const trimmed = compactWhitespace(value);
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return null;
}

function flattenValue(value: unknown, depth = 0): string[] {
  const primitive = formatPrimitive(value);
  if (primitive) {
    return [primitive];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenValue(item, depth));
  }

  if (!isPlainRecord(value) || depth > 2) {
    return [];
  }

  return Object.keys(value)
    .sort()
    .flatMap((key) => {
      if (key.startsWith("__")) {
        return [];
      }
      const flattened = flattenValue(value[key], depth + 1);
      return flattened.map((item) => `${key}: ${item}`);
    });
}

function appendSection(
  sections: string[],
  label: string,
  value: unknown,
): void {
  const flattened = flattenValue(value);
  if (flattened.length === 0) {
    return;
  }
  sections.push(`${label}: ${Array.from(new Set(flattened)).join("; ")}`);
}

function truncateAtBoundary(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const truncated = value.slice(0, maxLength);
  const boundary = Math.max(
    truncated.lastIndexOf("\n"),
    truncated.lastIndexOf(". "),
    truncated.lastIndexOf("; "),
    truncated.lastIndexOf(" "),
  );

  if (boundary < Math.floor(maxLength * 0.75)) {
    return truncated.trim();
  }
  return truncated.slice(0, boundary).trim();
}

export function hashMemoryRecordEmbeddingContent(content: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;

  for (let i = 0; i < content.length; i += 1) {
    hash ^= BigInt(content.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * prime);
  }

  return `${MEMORY_RECORD_EMBEDDING_TEXT_VERSION}:${hash.toString(16).padStart(16, "0")}`;
}

export function buildMemoryRecordEmbeddingText(
  record: MemoryRecordEmbeddingTextInput,
  options: BuildMemoryRecordEmbeddingTextOptions = {},
): string {
  const sections: string[] = [];

  appendSection(sections, "Text", record.text);
  appendSection(sections, "Time", record.timestamp);
  appendSection(sections, "Tier", record.tier);
  appendSection(sections, "Media", record.mediaRefs);
  appendSection(sections, "Dimensions", record.dimensions);
  appendSection(sections, "Metadata", record.metadata);

  return truncateAtBoundary(
    sections.join("\n"),
    options.maxLength ?? DEFAULT_MAX_TEXT_LENGTH,
  );
}

export function buildMemoryRecordEmbeddingDocument(
  record: MemoryRecordEmbeddingTextInput,
  options: BuildMemoryRecordEmbeddingTextOptions = {},
): MemoryRecordEmbeddingDocument {
  const content = buildMemoryRecordEmbeddingText(record, options);
  return {
    content,
    contentHash: hashMemoryRecordEmbeddingContent(content),
    textVersion: MEMORY_RECORD_EMBEDDING_TEXT_VERSION,
  };
}
