import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import type {
  MemoryStage,
  MemorySummaryQuery,
  MemorySummaryRecord,
  RawMessage,
  RawMessageEmbeddingUpdate,
  RawMessageQuery,
  RawMessageStats,
  RawMessageStorageManager,
} from "../../indexeddb/src/storage";
import { initializeRawMessageSchema } from "./schema";

type DatabaseLike = Database.Database;

interface RawMessageRow {
  id: number;
  message_id: string;
  platform: string;
  bot_id: string;
  user_id: string;
  channel: string | null;
  person: string | null;
  timestamp: number;
  content: string;
  attachments: string | null;
  embedding: Buffer | null;
  embedding_model: string | null;
  embedding_content_hash: string | null;
  embedding_dimensions: number | null;
  embedding_updated_at: number | null;
  metadata: string | null;
  created_at: number;
  memory_stage: MemoryStage | null;
  access_count: number | null;
  last_access_at: number | null;
  importance_score: number | null;
  archived_at: number | null;
  is_pinned: number | null;
  summary_ref_id: string | null;
}

interface MemorySummaryRow {
  summary_id: string;
  user_id: string;
  summary_tier: "L1" | "L2" | "L3";
  source_tier: MemoryStage;
  start_timestamp: number;
  end_timestamp: number;
  message_count: number;
  source_record_ids: string | null;
  key_points: string | null;
  keywords: string | null;
  keywords_text: string | null;
  summary_text: string;
  dimensions: string | null;
  quality_score: number | null;
  created_at: number;
  updated_at: number;
}

export interface SQLiteRawMessageManagerOptions {
  dbPath?: string;
  db?: DatabaseLike;
  vectorDimensions?: number;
  enableVectorSearch?: boolean;
}

export interface SQLiteRawMessageSemanticSearchInput {
  userId: string;
  queryEmbedding: number[];
  embeddingModel?: string;
  limit?: number;
  scanLimit?: number;
  threshold?: number;
  includeArchived?: boolean;
  platform?: string;
  botId?: string;
  channel?: string;
  person?: string;
  startTime?: number;
  endTime?: number;
}

export interface SQLiteRawMessageSemanticSearchResult {
  type: "memory";
  id: string;
  content: string;
  similarity: number;
  metadata: {
    userId: string;
    platform: string;
    botId: string;
    channel?: string;
    person?: string;
    timestamp: number;
    memoryStage?: string;
    embeddingModel?: string;
  };
  message: RawMessage;
}

function stringifyJson(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  return JSON.stringify(value);
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function floatArrayToBuffer(
  values: number[] | undefined,
): Buffer | null {
  if (!values || values.length === 0) {
    return null;
  }
  const buffer = Buffer.allocUnsafe(values.length * 4);
  for (let index = 0; index < values.length; index += 1) {
    buffer.writeFloatLE(values[index], index * 4);
  }
  return buffer;
}

export function bufferToFloatArray(
  buffer: Buffer | null,
): number[] | undefined {
  if (!buffer || buffer.length === 0) {
    return undefined;
  }
  const values: number[] = [];
  for (let offset = 0; offset < buffer.length; offset += 4) {
    values.push(buffer.readFloatLE(offset));
  }
  return values;
}

function toRawMessage(row: RawMessageRow): RawMessage {
  return {
    id: row.id,
    messageId: row.message_id,
    platform: row.platform,
    botId: row.bot_id,
    userId: row.user_id,
    channel: row.channel ?? undefined,
    person: row.person ?? undefined,
    timestamp: row.timestamp,
    content: row.content,
    attachments: parseJson(row.attachments, undefined),
    embedding: bufferToFloatArray(row.embedding),
    embeddingModel: row.embedding_model ?? undefined,
    embeddingContentHash: row.embedding_content_hash ?? undefined,
    embeddingDimensions: row.embedding_dimensions ?? undefined,
    embeddingUpdatedAt: row.embedding_updated_at ?? undefined,
    metadata: parseJson(row.metadata, undefined),
    createdAt: row.created_at,
    memoryStage: row.memory_stage ?? "short",
    accessCount: row.access_count ?? 0,
    lastAccessAt: row.last_access_at ?? undefined,
    importanceScore: row.importance_score ?? 0,
    archivedAt: row.archived_at ?? undefined,
    isPinned: Boolean(row.is_pinned ?? 0),
    summaryRefId: row.summary_ref_id ?? undefined,
  };
}

function toSummaryRecord(row: MemorySummaryRow): MemorySummaryRecord {
  return {
    summaryId: row.summary_id,
    userId: row.user_id,
    summaryTier: row.summary_tier,
    sourceTier: row.source_tier,
    startTimestamp: row.start_timestamp,
    endTimestamp: row.end_timestamp,
    messageCount: row.message_count,
    sourceRecordIds: parseJson(row.source_record_ids, []),
    keyPoints: parseJson(row.key_points, []),
    keywords: parseJson(row.keywords, []),
    keywordsText: row.keywords_text ?? undefined,
    summaryText: row.summary_text,
    dimensions: parseJson(row.dimensions, undefined),
    qualityScore: row.quality_score ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function buildFtsQuery(keywords: string[]): string {
  return keywords
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .map((keyword) => `"${keyword.replace(/"/g, '""')}"`)
    .join(" OR ");
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length === 0 || vecA.length !== vecB.length) {
    return Number.NaN;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < vecA.length; index += 1) {
    dot += vecA[index] * vecB[index];
    normA += vecA[index] * vecA[index];
    normB += vecB[index] * vecB[index];
  }

  if (normA === 0 || normB === 0) {
    return Number.NaN;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function normalizeTimestampToMs(value: number): number {
  if (value < 1e11) {
    return Math.floor(value * 1000);
  }
  return Math.floor(value);
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export class SQLiteRawMessageManager implements RawMessageStorageManager {
  private readonly db: DatabaseLike;
  private readonly ownsConnection: boolean;
  private readonly vectorDimensions: number;
  private readonly enableVectorSearch: boolean;
  private initialized = false;
  private vectorSearchAvailable = false;

  constructor(options: SQLiteRawMessageManagerOptions | string = ":memory:") {
    if (typeof options === "string") {
      this.db = new Database(options);
      this.ownsConnection = true;
      this.vectorDimensions = 1536;
      this.enableVectorSearch = true;
      return;
    }

    if (options.db) {
      this.db = options.db;
      this.ownsConnection = false;
      this.vectorDimensions = options.vectorDimensions ?? 1536;
      this.enableVectorSearch = options.enableVectorSearch ?? true;
      return;
    }

    this.db = new Database(options.dbPath ?? ":memory:");
    this.ownsConnection = true;
    this.vectorDimensions = options.vectorDimensions ?? 1536;
    this.enableVectorSearch = options.enableVectorSearch ?? true;
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }
    initializeRawMessageSchema(this.db);
    this.initializeVectorSearch();
    this.initialized = true;
  }

  async close(): Promise<void> {
    if (this.ownsConnection) {
      this.db.close();
    }
    this.initialized = false;
  }

  async storeMessage(message: RawMessage): Promise<number> {
    await this.init();

    const normalized = {
      ...message,
      memoryStage: message.memoryStage ?? "short",
      accessCount: message.accessCount ?? 0,
      importanceScore: message.importanceScore ?? 0,
      isPinned: message.isPinned ?? false,
      createdAt: message.createdAt ?? currentUnixSeconds(),
    };

    this.db
      .prepare(
        `
          INSERT INTO raw_messages (
            message_id, platform, bot_id, user_id, channel, person, timestamp,
            content, attachments, embedding, embedding_model,
            embedding_content_hash, embedding_dimensions, embedding_updated_at,
            metadata, created_at, memory_stage, access_count, last_access_at,
            importance_score, archived_at, is_pinned, summary_ref_id
          )
          VALUES (
            @messageId, @platform, @botId, @userId, @channel, @person,
            @timestamp, @content, @attachments, @embedding, @embeddingModel,
            @embeddingContentHash, @embeddingDimensions, @embeddingUpdatedAt,
            @metadata, @createdAt, @memoryStage, @accessCount, @lastAccessAt,
            @importanceScore, @archivedAt, @isPinned, @summaryRefId
          )
          ON CONFLICT(message_id) DO UPDATE SET
            platform = excluded.platform,
            bot_id = excluded.bot_id,
            user_id = excluded.user_id,
            channel = excluded.channel,
            person = excluded.person,
            timestamp = excluded.timestamp,
            content = excluded.content,
            attachments = excluded.attachments,
            embedding = excluded.embedding,
            embedding_model = excluded.embedding_model,
            embedding_content_hash = excluded.embedding_content_hash,
            embedding_dimensions = excluded.embedding_dimensions,
            embedding_updated_at = excluded.embedding_updated_at,
            metadata = excluded.metadata,
            created_at = excluded.created_at,
            memory_stage = excluded.memory_stage,
            access_count = excluded.access_count,
            last_access_at = excluded.last_access_at,
            importance_score = excluded.importance_score,
            archived_at = excluded.archived_at,
            is_pinned = excluded.is_pinned,
            summary_ref_id = excluded.summary_ref_id
        `,
      )
      .run({
        messageId: normalized.messageId,
        platform: normalized.platform,
        botId: normalized.botId,
        userId: normalized.userId,
        channel: normalized.channel ?? null,
        person: normalized.person ?? null,
        timestamp: normalized.timestamp,
        content: normalized.content,
        attachments: stringifyJson(normalized.attachments),
        embedding: floatArrayToBuffer(normalized.embedding),
        embeddingModel: normalized.embeddingModel ?? null,
        embeddingContentHash: normalized.embeddingContentHash ?? null,
        embeddingDimensions:
          normalized.embeddingDimensions ??
          normalized.embedding?.length ??
          null,
        embeddingUpdatedAt: normalized.embeddingUpdatedAt ?? null,
        metadata: stringifyJson(normalized.metadata),
        createdAt: normalized.createdAt,
        memoryStage: normalized.memoryStage,
        accessCount: normalized.accessCount,
        lastAccessAt: normalized.lastAccessAt ?? null,
        importanceScore: normalized.importanceScore,
        archivedAt: normalized.archivedAt ?? null,
        isPinned: normalized.isPinned ? 1 : 0,
        summaryRefId: normalized.summaryRefId ?? null,
      });

    const row = this.db
      .prepare("SELECT id FROM raw_messages WHERE message_id = ?")
      .get(normalized.messageId) as { id: number };
    this.upsertVectorForMessage(normalized.messageId, normalized.embedding);
    return row.id;
  }

  async storeMessages(messages: RawMessage[]): Promise<number[]> {
    await this.init();
    const ids: number[] = [];
    const insertMany = this.db.transaction((items: RawMessage[]) => {
      for (const message of items) {
        const existing = this.storeMessageSync(message);
        ids.push(existing);
      }
    });
    insertMany(messages);
    return ids;
  }

  async queryMessages(query: RawMessageQuery): Promise<RawMessage[]> {
    await this.init();

    const where: string[] = [];
    const params: Record<string, unknown> = {};

    if (query.userId) {
      where.push("user_id = @userId");
      params.userId = query.userId;
    }
    if (query.platform) {
      where.push("platform = @platform");
      params.platform = query.platform;
    }
    if (query.botId) {
      where.push("bot_id = @botId");
      params.botId = query.botId;
    }
    if (query.channel) {
      where.push("lower(coalesce(channel, '')) LIKE @channel ESCAPE '\\'");
      params.channel = `%${escapeLike(query.channel.toLowerCase())}%`;
    }
    if (query.person) {
      where.push("lower(coalesce(person, '')) LIKE @person ESCAPE '\\'");
      params.person = `%${escapeLike(query.person.toLowerCase())}%`;
    }
    if (query.startTime !== undefined) {
      where.push("timestamp >= @startTime");
      params.startTime = query.startTime;
    }
    if (query.endTime !== undefined) {
      where.push("timestamp < @endTime");
      params.endTime = query.endTime;
    }
    if (query.memoryStages?.length) {
      where.push(
        `coalesce(memory_stage, 'short') IN (${query.memoryStages
          .map((_, index) => `@memoryStage${index}`)
          .join(", ")})`,
      );
      query.memoryStages.forEach((stage, index) => {
        params[`memoryStage${index}`] = stage;
      });
    }
    if (!query.includeArchived) {
      where.push("archived_at IS NULL");
    }
    if (query.keywords?.length) {
      const ftsQuery = buildFtsQuery(query.keywords);
      if (ftsQuery) {
        where.push(
          "id IN (SELECT rowid FROM raw_messages_fts WHERE raw_messages_fts MATCH @ftsQuery)",
        );
        params.ftsQuery = ftsQuery;
      }
    }

    const order = query.reverse ? "DESC" : "ASC";
    params.limit = query.pageSize ?? query.limit ?? 50;
    params.offset = query.offset ?? 0;

    const sql = `
      SELECT *
      FROM raw_messages
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY timestamp ${order}, id ${order}
      LIMIT @limit OFFSET @offset
    `;

    return (this.db.prepare(sql).all(params) as RawMessageRow[]).map(
      toRawMessage,
    );
  }

  async queryMessagesGrouped(
    query: RawMessageQuery,
  ): Promise<Record<string, RawMessage[]>> {
    const messages = await this.queryMessages({
      ...query,
      limit: query.limit ? query.limit * 10 : 1000,
    });

    if (messages.length === 0 || query.groupBy === "none" || !query.groupBy) {
      return { all: messages };
    }

    const grouped: Record<string, RawMessage[]> = {};
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    for (const message of messages) {
      const date = new Date(message.timestamp * 1000);
      let key = date.toISOString().split("T")[0];

      if (query.groupBy === "day") {
        const localDate = new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
        );
        if (localDate.getTime() === today.getTime()) {
          key = "Today";
        } else if (localDate.getTime() === yesterday.getTime()) {
          key = "Yesterday";
        }
      } else if (query.groupBy === "week") {
        const dayOfWeek = date.getDay();
        const monday = new Date(date);
        monday.setDate(date.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        key = `Week of ${monday.toISOString().split("T")[0]}`;
      } else if (query.groupBy === "month") {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
          2,
          "0",
        )}`;
      }

      grouped[key] = grouped[key] ?? [];
      grouped[key].push(message);
    }

    const sorted: Record<string, RawMessage[]> = {};
    for (const key of Object.keys(grouped).sort((a, b) => {
      if (a === "Today") return -1;
      if (b === "Today") return 1;
      if (a === "Yesterday") return -1;
      if (b === "Yesterday") return 1;
      return b.localeCompare(a);
    })) {
      sorted[key] = grouped[key];
    }
    return sorted;
  }

  async getStats(): Promise<RawMessageStats> {
    await this.init();
    const total = this.db
      .prepare("SELECT COUNT(*) AS count FROM raw_messages")
      .get() as { count: number };
    const platforms = this.db
      .prepare(
        "SELECT platform, COUNT(*) AS count FROM raw_messages GROUP BY platform",
      )
      .all() as Array<{ platform: string; count: number }>;
    const bots = this.db
      .prepare(
        "SELECT bot_id, COUNT(*) AS count FROM raw_messages GROUP BY bot_id",
      )
      .all() as Array<{ bot_id: string; count: number }>;
    const times = this.db
      .prepare(
        "SELECT MIN(timestamp) AS oldest, MAX(timestamp) AS newest FROM raw_messages",
      )
      .get() as { oldest: number | null; newest: number | null };

    return {
      totalMessages: total.count,
      messagesByPlatform: Object.fromEntries(
        platforms.map((row) => [row.platform, row.count]),
      ),
      messagesByBot: Object.fromEntries(
        bots.map((row) => [row.bot_id, row.count]),
      ),
      oldestMessage: times.oldest ?? undefined,
      newestMessage: times.newest ?? undefined,
    };
  }

  async getMessageById(messageId: string): Promise<RawMessage | null> {
    await this.init();
    const row = this.db
      .prepare("SELECT * FROM raw_messages WHERE message_id = ?")
      .get(messageId) as RawMessageRow | undefined;
    return row ? toRawMessage(row) : null;
  }

  async deleteOldMessages(olderThan: number, userId?: string): Promise<number> {
    await this.init();
    const result = userId
      ? this.db
          .prepare(
            "DELETE FROM raw_messages WHERE created_at < ? AND user_id = ?",
          )
          .run(olderThan, userId)
      : this.db
          .prepare("DELETE FROM raw_messages WHERE created_at < ?")
          .run(olderThan);
    return result.changes;
  }

  async clearAll(): Promise<void> {
    await this.init();
    this.db.exec(`
      DELETE FROM raw_messages;
      DELETE FROM memory_summaries;
      INSERT INTO raw_messages_fts(raw_messages_fts) VALUES('rebuild');
    `);
    this.clearVectorTable();
  }

  async upsertSummaries(summaries: MemorySummaryRecord[]): Promise<void> {
    await this.init();
    const stmt = this.db.prepare(`
      INSERT INTO memory_summaries (
        summary_id, user_id, summary_tier, source_tier, start_timestamp,
        end_timestamp, message_count, source_record_ids, key_points, keywords,
        keywords_text, summary_text, dimensions, quality_score, created_at,
        updated_at
      )
      VALUES (
        @summaryId, @userId, @summaryTier, @sourceTier, @startTimestamp,
        @endTimestamp, @messageCount, @sourceRecordIds, @keyPoints, @keywords,
        @keywordsText, @summaryText, @dimensions, @qualityScore, @createdAt,
        @updatedAt
      )
      ON CONFLICT(summary_id) DO UPDATE SET
        user_id = excluded.user_id,
        summary_tier = excluded.summary_tier,
        source_tier = excluded.source_tier,
        start_timestamp = excluded.start_timestamp,
        end_timestamp = excluded.end_timestamp,
        message_count = excluded.message_count,
        source_record_ids = excluded.source_record_ids,
        key_points = excluded.key_points,
        keywords = excluded.keywords,
        keywords_text = excluded.keywords_text,
        summary_text = excluded.summary_text,
        dimensions = excluded.dimensions,
        quality_score = excluded.quality_score,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `);

    const upsertMany = this.db.transaction((items: MemorySummaryRecord[]) => {
      for (const summary of items) {
        stmt.run({
          summaryId: summary.summaryId,
          userId: summary.userId,
          summaryTier: summary.summaryTier,
          sourceTier: summary.sourceTier,
          startTimestamp: summary.startTimestamp,
          endTimestamp: summary.endTimestamp,
          messageCount: summary.messageCount,
          sourceRecordIds: stringifyJson(summary.sourceRecordIds),
          keyPoints: stringifyJson(summary.keyPoints),
          keywords: stringifyJson(summary.keywords),
          keywordsText: summary.keywordsText ?? summary.keywords.join(" "),
          summaryText: summary.summaryText,
          dimensions: stringifyJson(summary.dimensions),
          qualityScore: summary.qualityScore ?? null,
          createdAt: summary.createdAt,
          updatedAt: summary.updatedAt,
        });
      }
    });
    upsertMany(summaries);
  }

  async querySummaries(
    query: MemorySummaryQuery,
  ): Promise<MemorySummaryRecord[]> {
    await this.init();

    const where: string[] = ["user_id = @userId"];
    const params: Record<string, unknown> = { userId: query.userId };

    if (query.summaryTiers?.length) {
      where.push(
        `summary_tier IN (${query.summaryTiers
          .map((_, index) => `@summaryTier${index}`)
          .join(", ")})`,
      );
      query.summaryTiers.forEach((tier, index) => {
        params[`summaryTier${index}`] = tier;
      });
    }
    if (query.startTime !== undefined) {
      where.push("end_timestamp >= @startTime");
      params.startTime = query.startTime;
    }
    if (query.endTime !== undefined) {
      where.push("start_timestamp < @endTime");
      params.endTime = query.endTime;
    }
    if (query.keywords?.length) {
      query.keywords.forEach((keyword, index) => {
        where.push(
          `(lower(coalesce(keywords_text, '')) LIKE @keyword${index} ESCAPE '\\' OR lower(summary_text) LIKE @keyword${index} ESCAPE '\\')`,
        );
        params[`keyword${index}`] = `%${escapeLike(keyword.toLowerCase())}%`;
      });
    }

    const order = (query.reverse ?? true) ? "DESC" : "ASC";
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM memory_summaries
          WHERE ${where.join(" AND ")}
          ORDER BY end_timestamp ${order}
        `,
      )
      .all(params) as MemorySummaryRow[];

    let summaries = rows.map(toSummaryRecord);
    if (query.dimensions) {
      summaries = summaries.filter((summary) => {
        const dimensions = summary.dimensions ?? {};
        return Object.entries(query.dimensions ?? {}).every(
          ([key, value]) => value === undefined || dimensions[key] === value,
        );
      });
    }

    const offset = query.offset ?? 0;
    const pageSize = query.pageSize ?? query.limit ?? 50;
    return summaries.slice(offset, offset + pageSize);
  }

  async markMessagesAccessed(
    messageIds: string[],
    at = Date.now(),
    userId?: string,
  ): Promise<number> {
    await this.init();
    return this.updateMessagesByMessageIds(
      messageIds,
      `
        access_count = coalesce(access_count, 0) + 1,
        last_access_at = @at
      `,
      { at },
      userId,
    );
  }

  async promoteMessagesToStage(
    messageIds: string[],
    stage: MemoryStage,
    options?: { userId?: string; summaryRefId?: string; promotedAt?: number },
  ): Promise<number> {
    await this.init();
    const existingRows = this.getRowsByMessageIds(messageIds, options?.userId);
    let changed = 0;
    const stmt = this.db.prepare(`
      UPDATE raw_messages
      SET memory_stage = @stage,
          summary_ref_id = @summaryRefId,
          metadata = @metadata
      WHERE message_id = @messageId
    `);
    const updateMany = this.db.transaction((rows: RawMessageRow[]) => {
      for (const row of rows) {
        const metadata = {
          ...parseJson<Record<string, unknown>>(row.metadata, {}),
          ...(options?.promotedAt
            ? { memoryPromotedAt: options.promotedAt }
            : {}),
        };
        changed += stmt.run({
          stage,
          summaryRefId: options?.summaryRefId ?? row.summary_ref_id,
          metadata: stringifyJson(metadata),
          messageId: row.message_id,
        }).changes;
      }
    });
    updateMany(existingRows);
    return changed;
  }

  async archiveMessages(
    messageIds: string[],
    archivedAt = Date.now(),
    userId?: string,
  ): Promise<number> {
    await this.init();
    return this.updateMessagesByMessageIds(
      messageIds,
      "archived_at = @archivedAt",
      { archivedAt },
      userId,
    );
  }

  async hardDeleteArchived(
    olderThan: number,
    userId?: string,
  ): Promise<number> {
    await this.init();
    const result = userId
      ? this.db
          .prepare(
            "DELETE FROM raw_messages WHERE archived_at IS NOT NULL AND archived_at < ? AND user_id = ?",
          )
          .run(olderThan, userId)
      : this.db
          .prepare(
            "DELETE FROM raw_messages WHERE archived_at IS NOT NULL AND archived_at < ?",
          )
          .run(olderThan);
    return result.changes;
  }

  async updateMessageEmbeddings(
    updates: RawMessageEmbeddingUpdate[],
    userId?: string,
  ): Promise<number> {
    await this.init();
    const stmt = this.db.prepare(`
      UPDATE raw_messages
      SET embedding = @embedding,
          embedding_model = @embeddingModel,
          embedding_content_hash = @embeddingContentHash,
          embedding_dimensions = @embeddingDimensions,
          embedding_updated_at = @embeddingUpdatedAt
      WHERE message_id = @messageId
      ${userId ? "AND user_id = @userId" : ""}
    `);
    let changed = 0;
    const updateMany = this.db.transaction(
      (items: RawMessageEmbeddingUpdate[]) => {
        for (const update of items) {
          changed += stmt.run({
            messageId: update.messageId,
            embedding: floatArrayToBuffer(update.embedding),
            embeddingModel: update.embeddingModel,
            embeddingContentHash: update.embeddingContentHash,
            embeddingDimensions:
              update.embeddingDimensions ?? update.embedding.length,
            embeddingUpdatedAt: update.embeddingUpdatedAt ?? Date.now(),
            userId,
          }).changes;
          this.upsertVectorForMessage(update.messageId, update.embedding);
        }
      },
    );
    updateMany(updates.filter((update) => update.messageId));
    return changed;
  }

  private storeMessageSync(message: RawMessage): number {
    const normalized = {
      ...message,
      memoryStage: message.memoryStage ?? "short",
      accessCount: message.accessCount ?? 0,
      importanceScore: message.importanceScore ?? 0,
      isPinned: message.isPinned ?? false,
      createdAt: message.createdAt ?? currentUnixSeconds(),
    };

    this.db
      .prepare(
        `
          INSERT INTO raw_messages (
            message_id, platform, bot_id, user_id, channel, person, timestamp,
            content, attachments, embedding, embedding_model,
            embedding_content_hash, embedding_dimensions, embedding_updated_at,
            metadata, created_at, memory_stage, access_count, last_access_at,
            importance_score, archived_at, is_pinned, summary_ref_id
          )
          VALUES (
            @messageId, @platform, @botId, @userId, @channel, @person,
            @timestamp, @content, @attachments, @embedding, @embeddingModel,
            @embeddingContentHash, @embeddingDimensions, @embeddingUpdatedAt,
            @metadata, @createdAt, @memoryStage, @accessCount, @lastAccessAt,
            @importanceScore, @archivedAt, @isPinned, @summaryRefId
          )
          ON CONFLICT(message_id) DO UPDATE SET
            platform = excluded.platform,
            bot_id = excluded.bot_id,
            user_id = excluded.user_id,
            channel = excluded.channel,
            person = excluded.person,
            timestamp = excluded.timestamp,
            content = excluded.content,
            attachments = excluded.attachments,
            embedding = excluded.embedding,
            embedding_model = excluded.embedding_model,
            embedding_content_hash = excluded.embedding_content_hash,
            embedding_dimensions = excluded.embedding_dimensions,
            embedding_updated_at = excluded.embedding_updated_at,
            metadata = excluded.metadata,
            created_at = excluded.created_at,
            memory_stage = excluded.memory_stage,
            access_count = excluded.access_count,
            last_access_at = excluded.last_access_at,
            importance_score = excluded.importance_score,
            archived_at = excluded.archived_at,
            is_pinned = excluded.is_pinned,
            summary_ref_id = excluded.summary_ref_id
        `,
      )
      .run({
        messageId: normalized.messageId,
        platform: normalized.platform,
        botId: normalized.botId,
        userId: normalized.userId,
        channel: normalized.channel ?? null,
        person: normalized.person ?? null,
        timestamp: normalized.timestamp,
        content: normalized.content,
        attachments: stringifyJson(normalized.attachments),
        embedding: floatArrayToBuffer(normalized.embedding),
        embeddingModel: normalized.embeddingModel ?? null,
        embeddingContentHash: normalized.embeddingContentHash ?? null,
        embeddingDimensions:
          normalized.embeddingDimensions ??
          normalized.embedding?.length ??
          null,
        embeddingUpdatedAt: normalized.embeddingUpdatedAt ?? null,
        metadata: stringifyJson(normalized.metadata),
        createdAt: normalized.createdAt,
        memoryStage: normalized.memoryStage,
        accessCount: normalized.accessCount,
        lastAccessAt: normalized.lastAccessAt ?? null,
        importanceScore: normalized.importanceScore,
        archivedAt: normalized.archivedAt ?? null,
        isPinned: normalized.isPinned ? 1 : 0,
        summaryRefId: normalized.summaryRefId ?? null,
      });

    const row = this.db
      .prepare("SELECT id FROM raw_messages WHERE message_id = ?")
      .get(normalized.messageId) as { id: number };
    this.upsertVectorForMessage(normalized.messageId, normalized.embedding);
    return row.id;
  }

  async searchMessagesSemantically(
    input: SQLiteRawMessageSemanticSearchInput,
  ): Promise<SQLiteRawMessageSemanticSearchResult[]> {
    await this.init();

    if (input.queryEmbedding.length === 0) {
      return [];
    }

    if (
      this.vectorSearchAvailable &&
      input.queryEmbedding.length === this.vectorDimensions
    ) {
      return this.searchMessagesWithVectorTable(input);
    }

    return this.searchMessagesWithStoredEmbeddings(input);
  }

  private initializeVectorSearch(): void {
    if (!this.enableVectorSearch) {
      return;
    }

    try {
      (sqliteVec as any).load(this.db);
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS raw_messages_vec
        USING vec0(
          embedding float[${this.vectorDimensions}],
          message_id TEXT PRIMARY KEY
        )
      `);
      this.vectorSearchAvailable = true;
      this.rebuildVectorTable();
    } catch (error) {
      this.vectorSearchAvailable = false;
      console.warn("[SQLite Raw Messages] sqlite-vec unavailable:", error);
    }
  }

  private upsertVectorForMessage(
    messageId: string,
    embedding: number[] | undefined,
  ): void {
    if (!this.vectorSearchAvailable) {
      return;
    }

    const deleteStmt = this.db.prepare(
      "DELETE FROM raw_messages_vec WHERE message_id = ?",
    );
    deleteStmt.run(messageId);

    if (!embedding || embedding.length !== this.vectorDimensions) {
      return;
    }

    this.db
      .prepare(
        `
          INSERT INTO raw_messages_vec (embedding, message_id)
          VALUES (?, ?)
        `,
      )
      .run(floatArrayToBuffer(embedding), messageId);
  }

  private rebuildVectorTable(): void {
    if (!this.vectorSearchAvailable) {
      return;
    }

    this.clearVectorTable();
    const rows = this.db
      .prepare(
        `
          SELECT message_id, embedding, embedding_dimensions
          FROM raw_messages
          WHERE embedding IS NOT NULL
            AND embedding_dimensions = ?
        `,
      )
      .all(this.vectorDimensions) as Array<{
      message_id: string;
      embedding: Buffer;
      embedding_dimensions: number;
    }>;

    const stmt = this.db.prepare(
      "INSERT INTO raw_messages_vec (embedding, message_id) VALUES (?, ?)",
    );
    const insertMany = this.db.transaction(
      (items: Array<{ message_id: string; embedding: Buffer }>) => {
        for (const row of items) {
          stmt.run(row.embedding, row.message_id);
        }
      },
    );
    insertMany(rows);
  }

  private clearVectorTable(): void {
    if (!this.vectorSearchAvailable) {
      return;
    }
    this.db.prepare("DELETE FROM raw_messages_vec").run();
  }

  private searchMessagesWithVectorTable(
    input: SQLiteRawMessageSemanticSearchInput,
  ): SQLiteRawMessageSemanticSearchResult[] {
    const limit = Math.max(1, Math.floor(input.limit ?? 10));
    const scanLimit = Math.max(
      limit,
      Math.floor(input.scanLimit ?? limit * 10),
    );
    const threshold = input.threshold ?? 0.7;
    const rows = this.db
      .prepare(
        `
          SELECT message_id, distance
          FROM raw_messages_vec
          WHERE embedding MATCH ?
          ORDER BY distance
          LIMIT ?
        `,
      )
      .all(floatArrayToBuffer(input.queryEmbedding), scanLimit) as Array<{
      message_id: string;
      distance: number;
    }>;

    const byDistance = new Map(
      rows.map((row) => [row.message_id, row.distance]),
    );
    const messages = this.getRowsByMessageIds(rows.map((row) => row.message_id))
      .map(toRawMessage)
      .filter((message) => this.matchesSemanticFilters(message, input));

    return messages
      .map((message) =>
        this.toSemanticSearchResult(
          message,
          1 - (byDistance.get(message.messageId) ?? Number.POSITIVE_INFINITY),
        ),
      )
      .filter(
        (result): result is SQLiteRawMessageSemanticSearchResult =>
          result !== null && result.similarity >= threshold,
      )
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  private searchMessagesWithStoredEmbeddings(
    input: SQLiteRawMessageSemanticSearchInput,
  ): SQLiteRawMessageSemanticSearchResult[] {
    const limit = Math.max(1, Math.floor(input.limit ?? 10));
    const scanLimit = Math.max(
      limit,
      Math.floor(input.scanLimit ?? limit * 10),
    );
    const threshold = input.threshold ?? 0.7;

    return this.queryMessagesSync({
      userId: input.userId,
      includeArchived: input.includeArchived ?? false,
      reverse: true,
      pageSize: scanLimit,
      platform: input.platform,
      botId: input.botId,
      channel: input.channel,
      person: input.person,
      startTime: input.startTime,
      endTime: input.endTime,
    })
      .map((message) => {
        if (!message.embedding || message.embedding.length === 0) {
          return null;
        }
        if (
          input.embeddingModel &&
          message.embeddingModel &&
          message.embeddingModel !== input.embeddingModel
        ) {
          return null;
        }
        const similarity = cosineSimilarity(
          input.queryEmbedding,
          message.embedding,
        );
        return this.toSemanticSearchResult(message, similarity);
      })
      .filter(
        (result): result is SQLiteRawMessageSemanticSearchResult =>
          result !== null &&
          Number.isFinite(result.similarity) &&
          result.similarity >= threshold,
      )
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  private matchesSemanticFilters(
    message: RawMessage,
    input: SQLiteRawMessageSemanticSearchInput,
  ): boolean {
    if (message.userId !== input.userId) {
      return false;
    }
    if (!input.includeArchived && message.archivedAt !== undefined) {
      return false;
    }
    if (
      input.embeddingModel &&
      message.embeddingModel !== input.embeddingModel
    ) {
      return false;
    }
    if (input.platform && message.platform !== input.platform) {
      return false;
    }
    if (input.botId && message.botId !== input.botId) {
      return false;
    }
    if (
      input.channel &&
      !message.channel?.toLowerCase().includes(input.channel.toLowerCase())
    ) {
      return false;
    }
    if (
      input.person &&
      !message.person?.toLowerCase().includes(input.person.toLowerCase())
    ) {
      return false;
    }
    if (input.startTime !== undefined && message.timestamp < input.startTime) {
      return false;
    }
    if (input.endTime !== undefined && message.timestamp >= input.endTime) {
      return false;
    }
    return true;
  }

  private toSemanticSearchResult(
    message: RawMessage,
    similarity: number,
  ): SQLiteRawMessageSemanticSearchResult | null {
    if (!Number.isFinite(similarity)) {
      return null;
    }

    return {
      type: "memory",
      id: message.messageId,
      content: message.archivedAt ? "" : message.content,
      similarity,
      metadata: {
        userId: message.userId,
        platform: message.platform,
        botId: message.botId,
        channel: message.channel,
        person: message.person,
        timestamp: normalizeTimestampToMs(message.timestamp),
        memoryStage: message.memoryStage,
        embeddingModel: message.embeddingModel,
      },
      message,
    };
  }

  private queryMessagesSync(query: RawMessageQuery): RawMessage[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};

    if (query.userId) {
      where.push("user_id = @userId");
      params.userId = query.userId;
    }
    if (query.platform) {
      where.push("platform = @platform");
      params.platform = query.platform;
    }
    if (query.botId) {
      where.push("bot_id = @botId");
      params.botId = query.botId;
    }
    if (query.channel) {
      where.push("lower(coalesce(channel, '')) LIKE @channel ESCAPE '\\'");
      params.channel = `%${escapeLike(query.channel.toLowerCase())}%`;
    }
    if (query.person) {
      where.push("lower(coalesce(person, '')) LIKE @person ESCAPE '\\'");
      params.person = `%${escapeLike(query.person.toLowerCase())}%`;
    }
    if (query.startTime !== undefined) {
      where.push("timestamp >= @startTime");
      params.startTime = query.startTime;
    }
    if (query.endTime !== undefined) {
      where.push("timestamp < @endTime");
      params.endTime = query.endTime;
    }
    if (!query.includeArchived) {
      where.push("archived_at IS NULL");
    }

    const order = query.reverse ? "DESC" : "ASC";
    params.limit = query.pageSize ?? query.limit ?? 50;
    params.offset = query.offset ?? 0;

    return (
      this.db
        .prepare(
          `
            SELECT *
            FROM raw_messages
            ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
            ORDER BY timestamp ${order}, id ${order}
            LIMIT @limit OFFSET @offset
          `,
        )
        .all(params) as RawMessageRow[]
    ).map(toRawMessage);
  }

  private getRowsByMessageIds(
    messageIds: string[],
    userId?: string,
  ): RawMessageRow[] {
    const ids = Array.from(new Set(messageIds.filter(Boolean)));
    if (ids.length === 0) {
      return [];
    }
    const params: Record<string, unknown> = {};
    const placeholders = ids
      .map((id, index) => {
        params[`id${index}`] = id;
        return `@id${index}`;
      })
      .join(", ");
    if (userId) {
      params.userId = userId;
    }
    return this.db
      .prepare(
        `
          SELECT *
          FROM raw_messages
          WHERE message_id IN (${placeholders})
          ${userId ? "AND user_id = @userId" : ""}
        `,
      )
      .all(params) as RawMessageRow[];
  }

  private updateMessagesByMessageIds(
    messageIds: string[],
    setSql: string,
    params: Record<string, unknown>,
    userId?: string,
  ): number {
    const ids = Array.from(new Set(messageIds.filter(Boolean)));
    if (ids.length === 0) {
      return 0;
    }
    const queryParams = { ...params } as Record<string, unknown>;
    const placeholders = ids
      .map((id, index) => {
        queryParams[`id${index}`] = id;
        return `@id${index}`;
      })
      .join(", ");
    if (userId) {
      queryParams.userId = userId;
    }
    const result = this.db
      .prepare(
        `
          UPDATE raw_messages
          SET ${setSql}
          WHERE message_id IN (${placeholders})
          ${userId ? "AND user_id = @userId" : ""}
        `,
      )
      .run(queryParams);
    return result.changes;
  }
}
