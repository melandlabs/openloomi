import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  max,
  min,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { getDb, initDb, isDbInitialized } from "@/lib/db/adapters";
import {
  memorySummaries,
  rawMessages,
  type MemorySummaryRow,
  type RawMessageRow,
} from "@/lib/db/schema.pg";
import { isTauriMode } from "@/lib/env/constants";
import type {
  MemoryStage,
  MemorySummaryQuery,
  MemorySummaryRecord,
  RawMessage,
  RawMessageEmbeddingUpdate,
  RawMessageQuery,
  RawMessageStats,
  RawMessageStorageManager,
} from "@openloomi/indexeddb/storage";

interface PostgresRawMessageSemanticSearchInput {
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

interface PostgresRawMessageSemanticSearchResult {
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

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function normalizeTimestampToMs(timestamp: number): number {
  return timestamp < 1e11 ? timestamp * 1000 : timestamp;
}

function embeddingToText(embedding: number[] | undefined): string | null {
  if (!embedding || embedding.length === 0) {
    return null;
  }
  return `[${embedding.join(",")}]`;
}

function parseEmbedding(value: string | null): number[] | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    const vector = parsed.map((item) => Number(item));
    return vector.every((item) => Number.isFinite(item)) ? vector : undefined;
  } catch {
    return undefined;
  }
}

function toRawMessage(row: RawMessageRow): RawMessage {
  return {
    id: row.id,
    messageId: row.messageId,
    platform: row.platform,
    botId: row.botId,
    userId: row.userId,
    channel: row.channel ?? undefined,
    person: row.person ?? undefined,
    timestamp: row.timestamp,
    content: row.content,
    attachments: row.attachments ?? undefined,
    embedding: parseEmbedding(row.embedding),
    embeddingModel: row.embeddingModel ?? undefined,
    embeddingContentHash: row.embeddingContentHash ?? undefined,
    embeddingDimensions: row.embeddingDimensions ?? undefined,
    embeddingUpdatedAt: row.embeddingUpdatedAt ?? undefined,
    metadata: row.metadata ?? undefined,
    createdAt: row.createdAt,
    memoryStage: (row.memoryStage ?? "short") as MemoryStage,
    accessCount: row.accessCount ?? 0,
    lastAccessAt: row.lastAccessAt ?? undefined,
    importanceScore: row.importanceScore ?? 0,
    archivedAt: row.archivedAt ?? undefined,
    isPinned: row.isPinned ?? false,
    summaryRefId: row.summaryRefId ?? undefined,
  };
}

function toSummaryRecord(row: MemorySummaryRow): MemorySummaryRecord {
  return {
    summaryId: row.summaryId,
    userId: row.userId,
    summaryTier: row.summaryTier as MemorySummaryRecord["summaryTier"],
    sourceTier: row.sourceTier as MemoryStage,
    startTimestamp: row.startTimestamp,
    endTimestamp: row.endTimestamp,
    messageCount: row.messageCount,
    sourceRecordIds: row.sourceRecordIds ?? [],
    keyPoints: row.keyPoints ?? [],
    keywords: row.keywords ?? [],
    keywordsText: row.keywordsText ?? undefined,
    summaryText: row.summaryText,
    dimensions: row.dimensions ?? undefined,
    qualityScore: row.qualityScore ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function buildKeywordCondition(keywords: string[]): SQL | undefined {
  const trimmed = keywords.map((keyword) => keyword.trim()).filter(Boolean);
  if (trimmed.length === 0) {
    return undefined;
  }

  const query = trimmed.join(" | ");
  const fallbackConditions = trimmed.map((keyword) => {
    const pattern = `%${escapeLike(keyword.toLowerCase())}%`;
    return sql`lower(${rawMessages.content}) LIKE ${pattern} ESCAPE '\\'
      OR lower(coalesce(${rawMessages.channel}, '')) LIKE ${pattern} ESCAPE '\\'
      OR lower(coalesce(${rawMessages.person}, '')) LIKE ${pattern} ESCAPE '\\'`;
  });

  return or(
    sql`to_tsvector('simple', coalesce(${rawMessages.content}, '') || ' ' || coalesce(${rawMessages.channel}, '') || ' ' || coalesce(${rawMessages.person}, '')) @@ plainto_tsquery('simple', ${query})`,
    ...fallbackConditions,
  );
}

function buildMessageConditions(query: RawMessageQuery): SQL[] {
  const conditions: SQL[] = [];

  if (query.userId) {
    conditions.push(eq(rawMessages.userId, query.userId));
  }
  if (query.platform) {
    conditions.push(eq(rawMessages.platform, query.platform));
  }
  if (query.botId) {
    conditions.push(eq(rawMessages.botId, query.botId));
  }
  if (query.channel) {
    conditions.push(
      sql`lower(coalesce(${rawMessages.channel}, '')) LIKE ${`%${escapeLike(query.channel.toLowerCase())}%`} ESCAPE '\\'`,
    );
  }
  if (query.person) {
    conditions.push(
      sql`lower(coalesce(${rawMessages.person}, '')) LIKE ${`%${escapeLike(query.person.toLowerCase())}%`} ESCAPE '\\'`,
    );
  }
  if (query.startTime !== undefined) {
    conditions.push(gte(rawMessages.timestamp, query.startTime));
  }
  if (query.endTime !== undefined) {
    conditions.push(lt(rawMessages.timestamp, query.endTime));
  }
  if (query.memoryStages?.length) {
    conditions.push(inArray(rawMessages.memoryStage, query.memoryStages));
  }
  if (!query.includeArchived) {
    conditions.push(isNull(rawMessages.archivedAt));
  }
  if (query.keywords?.length) {
    const keywordCondition = buildKeywordCondition(query.keywords);
    if (keywordCondition) {
      conditions.push(keywordCondition);
    }
  }

  return conditions;
}

function buildSummaryConditions(query: MemorySummaryQuery): SQL[] {
  const conditions: SQL[] = [eq(memorySummaries.userId, query.userId)];

  if (query.summaryTiers?.length) {
    conditions.push(inArray(memorySummaries.summaryTier, query.summaryTiers));
  }
  if (query.startTime !== undefined) {
    conditions.push(gte(memorySummaries.endTimestamp, query.startTime));
  }
  if (query.endTime !== undefined) {
    conditions.push(lt(memorySummaries.startTimestamp, query.endTime));
  }
  if (query.keywords?.length) {
    const keywordConditions = query.keywords
      .map((keyword) => keyword.trim())
      .filter(Boolean)
      .map((keyword) => {
        const pattern = `%${escapeLike(keyword.toLowerCase())}%`;
        return sql`lower(coalesce(${memorySummaries.keywordsText}, '')) LIKE ${pattern} ESCAPE '\\'
          OR lower(${memorySummaries.summaryText}) LIKE ${pattern} ESCAPE '\\'`;
      });
    if (keywordConditions.length > 0) {
      conditions.push(or(...keywordConditions) as SQL);
    }
  }

  return conditions;
}

function matchesSummaryDimensions(
  summary: MemorySummaryRecord,
  dimensions: MemorySummaryQuery["dimensions"],
): boolean {
  if (!dimensions) {
    return true;
  }
  const values = summary.dimensions ?? {};
  return Object.entries(dimensions).every(
    ([key, value]) => value === undefined || values[key] === value,
  );
}

export class PostgresRawMessageManager implements RawMessageStorageManager {
  private initialized = false;
  private db?: ReturnType<typeof getDb>;

  constructor(db?: ReturnType<typeof getDb>) {
    this.db = db;
  }

  async init(): Promise<void> {
    if (isTauriMode()) {
      throw new Error(
        "Postgres raw message storage is only available in server mode.",
      );
    }
    if (!this.db) {
      if (!isDbInitialized()) {
        initDb();
      }
      this.db = getDb();
    }
    this.initialized = true;
  }

  async close(): Promise<void> {
    this.initialized = false;
  }

  private async getDatabase() {
    if (!this.initialized || !this.db) {
      await this.init();
    }
    return this.db ?? getDb();
  }

  async storeMessage(message: RawMessage): Promise<number> {
    const ids = await this.storeMessages([message]);
    return ids[0] ?? 0;
  }

  async storeMessages(messages: RawMessage[]): Promise<number[]> {
    if (messages.length === 0) {
      return [];
    }

    const db = await this.getDatabase();
    const rows = messages.map((message) => {
      const normalized = {
        ...message,
        memoryStage: message.memoryStage ?? "short",
        accessCount: message.accessCount ?? 0,
        importanceScore: message.importanceScore ?? 0,
        isPinned: message.isPinned ?? false,
        createdAt: message.createdAt ?? currentUnixSeconds(),
      };
      return {
        messageId: normalized.messageId,
        platform: normalized.platform,
        botId: normalized.botId,
        userId: normalized.userId,
        channel: normalized.channel ?? null,
        person: normalized.person ?? null,
        timestamp: normalized.timestamp,
        content: normalized.content,
        attachments: normalized.attachments ?? null,
        embedding: embeddingToText(normalized.embedding),
        embeddingModel: normalized.embeddingModel ?? null,
        embeddingContentHash: normalized.embeddingContentHash ?? null,
        embeddingDimensions:
          normalized.embeddingDimensions ??
          normalized.embedding?.length ??
          null,
        embeddingUpdatedAt: normalized.embeddingUpdatedAt ?? null,
        metadata: normalized.metadata ?? null,
        createdAt: normalized.createdAt,
        memoryStage: normalized.memoryStage,
        accessCount: normalized.accessCount,
        lastAccessAt: normalized.lastAccessAt ?? null,
        importanceScore: normalized.importanceScore,
        archivedAt: normalized.archivedAt ?? null,
        isPinned: normalized.isPinned,
        summaryRefId: normalized.summaryRefId ?? null,
      };
    });

    const inserted = await db
      .insert(rawMessages)
      .values(rows)
      .onConflictDoUpdate({
        target: rawMessages.messageId,
        set: {
          platform: sql`excluded.platform`,
          botId: sql`excluded.bot_id`,
          userId: sql`excluded.user_id`,
          channel: sql`excluded.channel`,
          person: sql`excluded.person`,
          timestamp: sql`excluded.timestamp`,
          content: sql`excluded.content`,
          attachments: sql`excluded.attachments`,
          embedding: sql`excluded.embedding`,
          embeddingModel: sql`excluded.embedding_model`,
          embeddingContentHash: sql`excluded.embedding_content_hash`,
          embeddingDimensions: sql`excluded.embedding_dimensions`,
          embeddingUpdatedAt: sql`excluded.embedding_updated_at`,
          metadata: sql`excluded.metadata`,
          createdAt: sql`excluded.created_at`,
          memoryStage: sql`excluded.memory_stage`,
          accessCount: sql`excluded.access_count`,
          lastAccessAt: sql`excluded.last_access_at`,
          importanceScore: sql`excluded.importance_score`,
          archivedAt: sql`excluded.archived_at`,
          isPinned: sql`excluded.is_pinned`,
          summaryRefId: sql`excluded.summary_ref_id`,
        },
      })
      .returning({ id: rawMessages.id });

    return inserted.map((row: { id: number }) => row.id);
  }

  async queryMessages(query: RawMessageQuery): Promise<RawMessage[]> {
    const db = await this.getDatabase();
    const conditions = buildMessageConditions(query);
    const order = query.reverse ? desc : asc;
    const rows = (await db
      .select()
      .from(rawMessages)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(order(rawMessages.timestamp), order(rawMessages.id))
      .limit(query.pageSize ?? query.limit ?? 50)
      .offset(query.offset ?? 0)) as RawMessageRow[];

    return rows.map(toRawMessage);
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
      const date = new Date(normalizeTimestampToMs(message.timestamp));
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
        monday.setDate(date.getDate() - dayOfWeek + 1);
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

    return grouped;
  }

  async getStats(): Promise<RawMessageStats> {
    const db = await this.getDatabase();
    const [totalRow] = await db.select({ value: count() }).from(rawMessages);
    const platformRows = await db
      .select({ platform: rawMessages.platform, value: count() })
      .from(rawMessages)
      .groupBy(rawMessages.platform);
    const botRows = await db
      .select({ botId: rawMessages.botId, value: count() })
      .from(rawMessages)
      .groupBy(rawMessages.botId);
    const [rangeRow] = await db
      .select({
        oldest: min(rawMessages.timestamp),
        newest: max(rawMessages.timestamp),
      })
      .from(rawMessages);

    return {
      totalMessages: Number(totalRow?.value ?? 0),
      messagesByPlatform: Object.fromEntries(
        platformRows.map((row: { platform: string; value: number }) => [
          row.platform,
          Number(row.value),
        ]),
      ),
      messagesByBot: Object.fromEntries(
        botRows.map((row: { botId: string; value: number }) => [
          row.botId,
          Number(row.value),
        ]),
      ),
      oldestMessage:
        typeof rangeRow?.oldest === "number" ? rangeRow.oldest : undefined,
      newestMessage:
        typeof rangeRow?.newest === "number" ? rangeRow.newest : undefined,
    };
  }

  async getMessageById(messageId: string): Promise<RawMessage | null> {
    const db = await this.getDatabase();
    const [row] = (await db
      .select()
      .from(rawMessages)
      .where(eq(rawMessages.messageId, messageId))
      .limit(1)) as RawMessageRow[];
    return row ? toRawMessage(row) : null;
  }

  async deleteOldMessages(olderThan: number, userId?: string): Promise<number> {
    const db = await this.getDatabase();
    const conditions = [lt(rawMessages.createdAt, olderThan)];
    if (userId) {
      conditions.push(eq(rawMessages.userId, userId));
    }
    const deleted = await db
      .delete(rawMessages)
      .where(and(...conditions))
      .returning({ id: rawMessages.id });
    return deleted.length;
  }

  async clearAll(): Promise<void> {
    const db = await this.getDatabase();
    await db.delete(rawMessages);
    await db.delete(memorySummaries);
  }

  async upsertSummaries(summaries: MemorySummaryRecord[]): Promise<void> {
    if (summaries.length === 0) {
      return;
    }
    const db = await this.getDatabase();
    const rows = summaries.map((summary) => ({
      summaryId: summary.summaryId,
      userId: summary.userId,
      summaryTier: summary.summaryTier,
      sourceTier: summary.sourceTier,
      startTimestamp: summary.startTimestamp,
      endTimestamp: summary.endTimestamp,
      messageCount: summary.messageCount,
      sourceRecordIds: summary.sourceRecordIds,
      keyPoints: summary.keyPoints,
      keywords: summary.keywords,
      keywordsText: summary.keywordsText ?? summary.keywords.join(" "),
      summaryText: summary.summaryText,
      dimensions: summary.dimensions ?? null,
      qualityScore: summary.qualityScore ?? null,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
    }));

    await db
      .insert(memorySummaries)
      .values(rows)
      .onConflictDoUpdate({
        target: memorySummaries.summaryId,
        set: {
          userId: sql`excluded.user_id`,
          summaryTier: sql`excluded.summary_tier`,
          sourceTier: sql`excluded.source_tier`,
          startTimestamp: sql`excluded.start_timestamp`,
          endTimestamp: sql`excluded.end_timestamp`,
          messageCount: sql`excluded.message_count`,
          sourceRecordIds: sql`excluded.source_record_ids`,
          keyPoints: sql`excluded.key_points`,
          keywords: sql`excluded.keywords`,
          keywordsText: sql`excluded.keywords_text`,
          summaryText: sql`excluded.summary_text`,
          dimensions: sql`excluded.dimensions`,
          qualityScore: sql`excluded.quality_score`,
          createdAt: sql`excluded.created_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  async querySummaries(
    query: MemorySummaryQuery,
  ): Promise<MemorySummaryRecord[]> {
    const db = await this.getDatabase();
    const conditions = buildSummaryConditions(query);
    const order = (query.reverse ?? true) ? desc : asc;
    const rows = (await db
      .select()
      .from(memorySummaries)
      .where(and(...conditions))
      .orderBy(order(memorySummaries.endTimestamp))
      .limit(query.pageSize ?? query.limit ?? 50)
      .offset(query.offset ?? 0)) as MemorySummaryRow[];

    return rows.map(toSummaryRecord).filter((summary) => {
      return matchesSummaryDimensions(summary, query.dimensions);
    });
  }

  async markMessagesAccessed(
    messageIds: string[],
    at = Date.now(),
    userId?: string,
  ): Promise<number> {
    if (messageIds.length === 0) {
      return 0;
    }
    const db = await this.getDatabase();
    const conditions = [inArray(rawMessages.messageId, messageIds)];
    if (userId) {
      conditions.push(eq(rawMessages.userId, userId));
    }
    const rows = await db
      .update(rawMessages)
      .set({
        accessCount: sql`coalesce(${rawMessages.accessCount}, 0) + 1`,
        lastAccessAt: at,
      })
      .where(and(...conditions))
      .returning({ id: rawMessages.id });
    return rows.length;
  }

  async promoteMessagesToStage(
    messageIds: string[],
    stage: MemoryStage,
    options?: { userId?: string; summaryRefId?: string; promotedAt?: number },
  ): Promise<number> {
    if (messageIds.length === 0) {
      return 0;
    }
    const db = await this.getDatabase();
    const existing = await this.getRowsByMessageIds(
      messageIds,
      options?.userId,
    );
    if (existing.length === 0) {
      return 0;
    }

    const changed = await Promise.all(
      existing.map((row) => {
        const metadata = {
          ...(row.metadata ?? {}),
          ...(options?.promotedAt
            ? { memoryPromotedAt: options.promotedAt }
            : {}),
        };
        return db
          .update(rawMessages)
          .set({
            memoryStage: stage,
            summaryRefId: options?.summaryRefId ?? row.summaryRefId,
            metadata,
          })
          .where(eq(rawMessages.messageId, row.messageId))
          .returning({ id: rawMessages.id });
      }),
    );
    return changed.reduce((total, rows) => total + rows.length, 0);
  }

  async archiveMessages(
    messageIds: string[],
    archivedAt = Date.now(),
    userId?: string,
  ): Promise<number> {
    if (messageIds.length === 0) {
      return 0;
    }
    const db = await this.getDatabase();
    const conditions = [inArray(rawMessages.messageId, messageIds)];
    if (userId) {
      conditions.push(eq(rawMessages.userId, userId));
    }
    const rows = await db
      .update(rawMessages)
      .set({ archivedAt })
      .where(and(...conditions))
      .returning({ id: rawMessages.id });
    return rows.length;
  }

  async hardDeleteArchived(
    olderThan: number,
    userId?: string,
  ): Promise<number> {
    const db = await this.getDatabase();
    const conditions = [
      isNotNull(rawMessages.archivedAt),
      lt(rawMessages.archivedAt, olderThan),
    ];
    if (userId) {
      conditions.push(eq(rawMessages.userId, userId));
    }
    const rows = await db
      .delete(rawMessages)
      .where(and(...conditions))
      .returning({ id: rawMessages.id });
    return rows.length;
  }

  async updateMessageEmbeddings(
    updates: RawMessageEmbeddingUpdate[],
    userId?: string,
  ): Promise<number> {
    if (updates.length === 0) {
      return 0;
    }
    const db = await this.getDatabase();
    let changed = 0;

    for (const update of updates.filter((item) => item.messageId)) {
      const conditions = [eq(rawMessages.messageId, update.messageId)];
      if (userId) {
        conditions.push(eq(rawMessages.userId, userId));
      }
      const rows = await db
        .update(rawMessages)
        .set({
          embedding: embeddingToText(update.embedding),
          embeddingModel: update.embeddingModel,
          embeddingContentHash: update.embeddingContentHash,
          embeddingDimensions:
            update.embeddingDimensions ?? update.embedding.length,
          embeddingUpdatedAt: update.embeddingUpdatedAt ?? Date.now(),
        })
        .where(and(...conditions))
        .returning({ id: rawMessages.id });
      changed += rows.length;
    }

    return changed;
  }

  async searchMessagesSemantically(
    input: PostgresRawMessageSemanticSearchInput,
  ): Promise<PostgresRawMessageSemanticSearchResult[]> {
    const db = await this.getDatabase();
    if (input.queryEmbedding.length === 0) {
      return [];
    }

    const limit = Math.max(1, Math.floor(input.limit ?? 10));
    const threshold = input.threshold ?? 0.7;
    const queryEmbedding = `[${input.queryEmbedding.join(",")}]`;
    const distanceSql = sql`${rawMessages.embedding}::vector <=> ${queryEmbedding}::vector`;
    const similaritySql = sql<number>`1 - (${distanceSql})`;
    const conditions = buildMessageConditions({
      userId: input.userId,
      platform: input.platform,
      botId: input.botId,
      channel: input.channel,
      person: input.person,
      startTime: input.startTime,
      endTime: input.endTime,
      includeArchived: input.includeArchived,
    });
    conditions.push(isNotNull(rawMessages.embedding));
    if (input.embeddingModel) {
      conditions.push(eq(rawMessages.embeddingModel, input.embeddingModel));
    }

    const rows = (await db
      .select({
        row: rawMessages,
        similarity: similaritySql,
      })
      .from(rawMessages)
      .where(and(...conditions, sql`${distanceSql} < ${1 - threshold}`))
      .orderBy(distanceSql)
      .limit(limit)) as Array<{ row: RawMessageRow; similarity: number }>;

    return rows
      .map(({ row, similarity }) =>
        this.toSemanticSearchResult(toRawMessage(row), Number(similarity)),
      )
      .filter(
        (result): result is PostgresRawMessageSemanticSearchResult =>
          result !== null,
      );
  }

  private async getRowsByMessageIds(
    messageIds: string[],
    userId?: string,
  ): Promise<RawMessageRow[]> {
    const ids = Array.from(new Set(messageIds.filter(Boolean)));
    if (ids.length === 0) {
      return [];
    }
    const db = await this.getDatabase();
    const conditions = [inArray(rawMessages.messageId, ids)];
    if (userId) {
      conditions.push(eq(rawMessages.userId, userId));
    }
    return (await db
      .select()
      .from(rawMessages)
      .where(and(...conditions))) as RawMessageRow[];
  }

  private toSemanticSearchResult(
    message: RawMessage,
    similarity: number,
  ): PostgresRawMessageSemanticSearchResult | null {
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
}

let manager: PostgresRawMessageManager | null = null;

export function isPostgresRawMessageStorageAvailable(): boolean {
  return !isTauriMode();
}

export async function getPostgresRawMessageManager(): Promise<PostgresRawMessageManager> {
  if (!isPostgresRawMessageStorageAvailable()) {
    throw new Error(
      "Postgres raw message storage is only available in server mode.",
    );
  }

  if (!manager) {
    manager = new PostgresRawMessageManager();
    await manager.init();
  }

  return manager;
}

export async function closePostgresRawMessageManager(): Promise<void> {
  if (!manager) {
    return;
  }
  await manager.close();
  manager = null;
}
