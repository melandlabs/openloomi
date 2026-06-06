/**
 * SQLite vector store backed by the sqlite-vec extension.
 *
 * Application tables remain the source of truth. This store owns a compact
 * record table plus one vec0 table per embedding dimension, which allows model
 * migrations (for example 384 -> 1024 dimensions) without rebuilding unrelated
 * collections or mixing incompatible vectors.
 */

import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import type {
  DocumentChunk,
  IVectorStore,
  VectorSearchFilter,
  VectorSearchResult,
  VectorStoreSearchOptions,
  VectorStoreStats,
} from "./vector-service";

export type { DocumentChunk, VectorSearchResult } from "./vector-service";

// Kept for source compatibility with callers that still pass the app schema.
// The generic index intentionally does not depend on Drizzle or business tables.
export interface SchemaModule {
  [key: string]: unknown;
}

export interface SQLiteVecStoreOptions {
  collectionName?: string;
}

interface StoredVectorRecord {
  id: string;
  document_id: string;
  content: string;
  metadata: string | null;
  embedding: Buffer;
  dimensions: number;
}

const DEFAULT_COLLECTION_NAME = "openloomi_rag_chunks";
const SEARCH_OVERFETCH_MULTIPLIER = 8;

export class SQLiteVecStore implements IVectorStore {
  private readonly db: Database.Database;
  private readonly collectionName: string;
  private readonly recordsTableName: string;
  private readonly vectorTablePrefix: string;

  constructor(
    dbPath: string,
    _schemaModule?: SchemaModule,
    options: SQLiteVecStoreOptions = {},
  ) {
    this.collectionName = options.collectionName || DEFAULT_COLLECTION_NAME;
    const safeCollectionName = sanitizeIdentifier(this.collectionName);
    this.recordsTableName = `openloomi_vec_${safeCollectionName}_records`;
    this.vectorTablePrefix = `openloomi_vec_${safeCollectionName}_d`;

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL");

    try {
      sqliteVec.load(this.db);
    } catch (error) {
      this.db.close();
      throw new Error(
        `sqlite-vec extension is unavailable for collection "${this.collectionName}": ${toErrorMessage(error)}`,
      );
    }

    this.initializeRecordsTable();
  }

  async addChunk(chunk: DocumentChunk): Promise<void> {
    await this.addChunks([chunk]);
  }

  async addChunks(chunks: DocumentChunk[]): Promise<void> {
    if (chunks.length === 0) {
      return;
    }

    const upsertMany = this.db.transaction((items: DocumentChunk[]) => {
      for (const chunk of items) {
        validateEmbedding(chunk.id, chunk.embedding);
        const previous = this.getRecord(chunk.id);

        if (previous && previous.dimensions !== chunk.embedding.length) {
          this.deleteVector(previous.dimensions, chunk.id);
        }

        const dimensions = chunk.embedding.length;
        this.ensureVectorTable(dimensions);
        this.db
          .prepare(
            `
              INSERT INTO ${this.recordsTableName} (
                id, document_id, content, metadata, embedding, dimensions,
                updated_at
              )
              VALUES (
                @id, @documentId, @content, @metadata, @embedding, @dimensions,
                @updatedAt
              )
              ON CONFLICT(id) DO UPDATE SET
                document_id = excluded.document_id,
                content = excluded.content,
                metadata = excluded.metadata,
                embedding = excluded.embedding,
                dimensions = excluded.dimensions,
                updated_at = excluded.updated_at
            `,
          )
          .run({
            id: chunk.id,
            documentId: chunk.documentId,
            content: chunk.content,
            metadata: stringifyMetadata(chunk.metadata),
            embedding: floatArrayToBuffer(chunk.embedding),
            dimensions,
            updatedAt: Date.now(),
          });

        // vec0 upsert support differs between extension versions. Delete then
        // insert is deterministic and remains inside the surrounding transaction.
        this.deleteVector(dimensions, chunk.id);
        this.db
          .prepare(
            `
              INSERT INTO ${this.getVectorTableName(dimensions)}
                (embedding, record_id)
              VALUES (?, ?)
            `,
          )
          .run(floatArrayToBuffer(chunk.embedding), chunk.id);
      }
    });

    upsertMany(chunks);
  }

  async similaritySearch(
    queryEmbedding: number[],
    limit = 10,
    userId?: string,
  ): Promise<VectorSearchResult[]> {
    return this.similaritySearchWithOptions(queryEmbedding, {
      limit,
      filter: userId ? { userId } : undefined,
    });
  }

  async similaritySearchWithOptions(
    queryEmbedding: number[],
    options: VectorStoreSearchOptions,
  ): Promise<VectorSearchResult[]> {
    validateEmbedding("query", queryEmbedding);
    const dimensions = queryEmbedding.length;
    if (!this.vectorTableExists(dimensions)) {
      return [];
    }

    const limit = Math.max(1, Math.floor(options.limit ?? 10));
    const scanLimit = Math.max(limit, limit * SEARCH_OVERFETCH_MULTIPLIER);
    const nearest = this.db
      .prepare(
        `
          SELECT record_id, distance
          FROM ${this.getVectorTableName(dimensions)}
          WHERE embedding MATCH ?
          ORDER BY distance
          LIMIT ?
        `,
      )
      .all(floatArrayToBuffer(queryEmbedding), scanLimit) as Array<{
      record_id: string;
      distance: number;
    }>;

    const records = this.getRecords(nearest.map((item) => item.record_id));
    const recordsById = new Map(records.map((record) => [record.id, record]));

    const results: VectorSearchResult[] = [];
    for (const item of nearest) {
      const record = recordsById.get(item.record_id);
      if (!record) {
        continue;
      }
      const metadata = parseMetadata(record.metadata);
      if (!matchesFilter(metadata, options.filter)) {
        continue;
      }

      results.push({
        id: record.id,
        content: record.content,
        score: distanceToScore(item.distance),
        documentId: record.document_id,
        metadata,
        embedding: options.includeEmbeddings
          ? bufferToFloatArray(record.embedding)
          : undefined,
      });
      if (results.length >= limit) {
        break;
      }
    }
    return results;
  }

  async deleteDocument(documentId: string): Promise<void> {
    const records = this.db
      .prepare(
        `
          SELECT id, dimensions
          FROM ${this.recordsTableName}
          WHERE document_id = ?
        `,
      )
      .all(documentId) as Array<{ id: string; dimensions: number }>;

    const deleteRecords = this.db.transaction(
      (items: Array<{ id: string; dimensions: number }>) => {
        for (const record of items) {
          this.deleteVector(record.dimensions, record.id);
        }
        this.db
          .prepare(`DELETE FROM ${this.recordsTableName} WHERE document_id = ?`)
          .run(documentId);
      },
    );
    deleteRecords(records);
  }

  async deleteOlderThan(
    timestamp: number,
    timestampField = "timestamp",
  ): Promise<number> {
    const records = this.db
      .prepare(`SELECT id, metadata, dimensions FROM ${this.recordsTableName}`)
      .all() as Array<{
      id: string;
      metadata: string | null;
      dimensions: number;
    }>;
    const expired = records.filter((record) => {
      const value = normalizeTimestamp(
        parseMetadata(record.metadata)[timestampField],
      );
      return Number.isFinite(value) && value < timestamp;
    });

    const deleteExpired = this.db.transaction((items: typeof expired) => {
      const deleteRecord = this.db.prepare(
        `DELETE FROM ${this.recordsTableName} WHERE id = ?`,
      );
      for (const record of items) {
        this.deleteVector(record.dimensions, record.id);
        deleteRecord.run(record.id);
      }
    });
    deleteExpired(expired);
    return expired.length;
  }

  async getDocumentCount(): Promise<number> {
    const result = this.db
      .prepare(
        `SELECT COUNT(DISTINCT document_id) AS count FROM ${this.recordsTableName}`,
      )
      .get() as { count: number };
    return result.count;
  }

  async getChunkCount(): Promise<number> {
    const result = this.db
      .prepare(`SELECT COUNT(*) AS count FROM ${this.recordsTableName}`)
      .get() as { count: number };
    return result.count;
  }

  async getStats(): Promise<VectorStoreStats> {
    const result = this.db
      .prepare(
        `
          SELECT COUNT(*) AS count, MAX(dimensions) AS dimensions
          FROM ${this.recordsTableName}
        `,
      )
      .get() as { count: number; dimensions: number | null };
    return {
      count: result.count,
      dimensions: result.dimensions ?? 0,
    };
  }

  async clear(): Promise<void> {
    const vectorTables = this.listVectorTables();
    const clearAll = this.db.transaction(() => {
      for (const tableName of vectorTables) {
        this.db.exec(`DROP TABLE IF EXISTS ${tableName}`);
      }
      this.db.prepare(`DELETE FROM ${this.recordsTableName}`).run();
    });
    clearAll();
  }

  close(): void {
    if (this.db.open) {
      this.db.close();
    }
  }

  private initializeRecordsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.recordsTableName} (
        id TEXT PRIMARY KEY NOT NULL,
        document_id TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        embedding BLOB NOT NULL,
        dimensions INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ${this.recordsTableName}_document_idx
        ON ${this.recordsTableName}(document_id);
      CREATE INDEX IF NOT EXISTS ${this.recordsTableName}_dimensions_idx
        ON ${this.recordsTableName}(dimensions);
    `);
  }

  private ensureVectorTable(dimensions: number): void {
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${this.getVectorTableName(dimensions)}
      USING vec0(
        embedding float[${dimensions}],
        record_id TEXT PRIMARY KEY
      )
    `);
  }

  private vectorTableExists(dimensions: number): boolean {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(this.getVectorTableName(dimensions)),
    );
  }

  private getVectorTableName(dimensions: number): string {
    if (!Number.isInteger(dimensions) || dimensions <= 0) {
      throw new Error(`Invalid embedding dimensions: ${dimensions}`);
    }
    return `${this.vectorTablePrefix}${dimensions}`;
  }

  private listVectorTables(): string[] {
    return (
      this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ?",
        )
        .all(`${this.vectorTablePrefix}%`) as Array<{ name: string }>
    ).map((row) => row.name);
  }

  private getRecord(id: string): StoredVectorRecord | undefined {
    return this.db
      .prepare(`SELECT * FROM ${this.recordsTableName} WHERE id = ?`)
      .get(id) as StoredVectorRecord | undefined;
  }

  private getRecords(ids: string[]): StoredVectorRecord[] {
    if (ids.length === 0) {
      return [];
    }
    const placeholders = ids.map(() => "?").join(", ");
    return this.db
      .prepare(
        `SELECT * FROM ${this.recordsTableName} WHERE id IN (${placeholders})`,
      )
      .all(...ids) as StoredVectorRecord[];
  }

  private deleteVector(dimensions: number, id: string): void {
    if (!this.vectorTableExists(dimensions)) {
      return;
    }
    this.db
      .prepare(
        `DELETE FROM ${this.getVectorTableName(dimensions)} WHERE record_id = ?`,
      )
      .run(id);
  }
}

const storeInstances = new Map<string, SQLiteVecStore>();

export async function getSQLiteVecStore(
  dbPath: string,
  schemaModule?: SchemaModule,
  options: SQLiteVecStoreOptions = {},
): Promise<SQLiteVecStore> {
  const collectionName = options.collectionName || DEFAULT_COLLECTION_NAME;
  const instanceKey = `${dbPath}::${collectionName}`;
  let instance = storeInstances.get(instanceKey);
  if (!instance) {
    instance = new SQLiteVecStore(dbPath, schemaModule, options);
    storeInstances.set(instanceKey, instance);
  }
  return instance;
}

export function resetSQLiteVecStore(): void {
  for (const store of storeInstances.values()) {
    store.close();
  }
  storeInstances.clear();
}

function sanitizeIdentifier(value: string): string {
  const sanitized = value.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!sanitized || !/^[a-z_]/.test(sanitized)) {
    return `collection_${sanitized || "default"}`;
  }
  return sanitized;
}

function validateEmbedding(id: string, embedding: number[]): void {
  if (
    embedding.length === 0 ||
    !embedding.every((value) => Number.isFinite(value))
  ) {
    throw new Error(`Vector record ${id} has an invalid embedding`);
  }
}

function floatArrayToBuffer(values: number[]): Buffer {
  const buffer = Buffer.allocUnsafe(values.length * 4);
  for (let index = 0; index < values.length; index += 1) {
    buffer.writeFloatLE(values[index], index * 4);
  }
  return buffer;
}

function bufferToFloatArray(buffer: Buffer): number[] {
  const values: number[] = [];
  for (let offset = 0; offset < buffer.length; offset += 4) {
    values.push(buffer.readFloatLE(offset));
  }
  return values;
}

function stringifyMetadata(
  metadata: Record<string, unknown> | undefined,
): string | null {
  return metadata ? JSON.stringify(metadata) : null;
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function matchesFilter(
  metadata: Record<string, unknown>,
  filter?: VectorSearchFilter,
): boolean {
  if (!filter) {
    return true;
  }
  if (filter.userId && metadata.userId !== filter.userId) return false;
  if (filter.platform && metadata.platform !== filter.platform) return false;
  if (filter.channel && metadata.channel !== filter.channel) return false;

  const timestamp = normalizeTimestamp(metadata.timestamp);
  if (filter.startTime !== undefined || filter.endTime !== undefined) {
    if (!Number.isFinite(timestamp)) return false;
    if (filter.startTime !== undefined && timestamp < filter.startTime) {
      return false;
    }
    if (filter.endTime !== undefined && timestamp > filter.endTime) {
      return false;
    }
  }
  return true;
}

function normalizeTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  return Number.NaN;
}

function distanceToScore(distance: number): number {
  return 1 / (1 + Math.max(0, distance));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
