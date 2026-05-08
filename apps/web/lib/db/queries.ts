import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  isNotNull,
  lt,
  max,
  ne,
  or,
  sql,
  type SQL,
  like,
} from "drizzle-orm";
import { config } from "dotenv";

config({
  path: ".env",
});

// Import database adapters (supports dual mode)
import { initDb, getDb } from "./adapters";

import {
  user,
  passwordResetToken,
  chat,
  chatInsights,
  type User,
  type PasswordResetToken,
  message,
  vote,
  type DBMessage,
  type Chat,
  stream,
  bot,
  type Bot,
  insight,
  userInsightSettings,
  type InsightSettings,
  parseInsightSettings,
  userContacts,
  dingtalkBotInsightMessages,
  type UserContact,
  type Feedback,
  feedback,
  type Survey,
  survey,
  userSubscriptions,
  userEmailPreferences,
  type UserEmailPreferences,
  marketingEmailLog,
  telegramAccounts,
  type TelegramAccount,
  whatsappAccounts,
  type WhatsAppAccount,
  discordAccounts,
  type DiscordAccount,
  integrationAccounts,
  type IntegrationAccount,
  integrationCatalog,
  type IntegrationCatalogEntry,
  rssSubscriptions,
  type RssSubscription,
  rssItems,
  type InsertRssItem,
  userRoles,
  type UserRole,
  type Insight,
  type InsertInsight,
  serializeInsightSettings,
  insightFilters,
  type DBInsightFilter,
  type DBInsertInsightFilter,
  insightTabs,
  type DBInsightTab,
  type DBInsertInsightTab,
  userCategories,
  type DBUserCategory,
  type InsightTaskStatus,
  personCustomFields,
  type DBPersonCustomFields,
  ragDocuments,
  ragChunks,
  insightNotes,
  insightDocuments,
  insightProcessingFailures,
  type InsertInsightProcessingFailure,
  credentialAccessLog,
} from "./schema";
import { generateUUID } from "../utils";
import { generateHashedPassword } from "./utils";
import { AppError } from "@alloomi/shared/errors";
import type { UserType } from "@/app/(auth)/auth";
import { isTauriMode } from "@/lib/env/constants";
import { filterDueInsightSettings } from "@/lib/insights/tier";
import type { IntegrationId } from "@/lib/integrations/client";
import type { GeneratedInsightPayload } from "@/lib/insights/types";
import {
  MAX_CUSTOM_INSIGHT_FILTERS,
  type InsightFilterCreatePayload,
  type InsightFilterUpdatePayload,
  type InsightFilterDefinition,
} from "@/lib/insights/filter-schema";
import type { InsightTaskItem, TimelineData } from "../ai/subagents/insights";
import { createHash } from "node:crypto";
import { generateInsightId } from "../insights/transform";

// Import serialization utilities from separate module
export {
  serializeJson,
  deserializeJson,
  normalizeContactMeta,
  normalizeContactMetaList,
  normalizeInsight,
  normalizeInsightList,
  encryptPayload,
  decryptPayload,
  DEFAULT_INSIGHT_TTL_HOURS,
} from "./serialization";
import {
  serializeJson,
  deserializeJson,
  normalizeContactMeta,
  normalizeContactMetaList,
  normalizeInsight,
  normalizeInsightList,
  encryptPayload,
  decryptPayload,
  DEFAULT_INSIGHT_TTL_HOURS,
} from "./serialization";

// Import batch operations from separate module
export { DB_INSERT_CHUNK_SIZE, batchInsert } from "./batch";
import { DB_INSERT_CHUNK_SIZE } from "./batch";

/**
 * Auto-add id field to data being inserted (SQLite requires explicit provision)
 * @param data Data to insert
 * @returns Data with id added
 */
function addIdIfNeeded<T extends Record<string, unknown>>(
  data: T,
): T & { id: string } {
  // If already has id, return directly
  if ("id" in data && data.id) {
    return data as T & { id: string };
  }

  // SQLite mode requires explicit id provision
  if (isTauriMode()) {
    return { ...data, id: generateUUID() } as T & { id: string };
  }

  // PostgreSQL mode has default values, no need to add
  return data as T & { id: string };
}

/**
 * Database-compatible transaction executor
 * SQLite (better-sqlite3) does not support async transactions, requires special handling
 */
async function executeTransaction<T>(
  callback: (tx: typeof db) => Promise<T>,
): Promise<T> {
  // SQLite/better-sqlite3 doesn't support async transaction callbacks
  // In SQLite mode, execute operation directly (relies on transaction isolation provided by WAL mode)
  if (isTauriMode()) {
    return await callback(db as typeof db);
  }

  // PostgreSQL supports full async transactions
  return await db.transaction(callback);
}

/**
 * Database-agnostic case-insensitive search helper function
 * Uses ILIKE in PostgreSQL, LIKE in SQLite (case-insensitive by default)
 */
function caseInsensitiveSearch(column: any, pattern: string): SQL {
  // SQLite's LIKE is case-insensitive for ASCII characters by default
  return isTauriMode() ? like(column, pattern) : ilike(column, pattern);
}

export type BotWithAccount = Bot & {
  platformAccount: IntegrationAccount | null;
};

export type IntegrationAccountWithBot = IntegrationAccount & {
  bot: Bot | null;
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string) {
  return UUID_REGEX.test(value);
}

function hashPasswordResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

// Optionally, if not using email/pass login, you can
// use the Drizzle adapter for Auth.js / NextAuth
// https://authjs.dev/reference/adapter/drizzle

// Initialize database connection (using adapters)
let dbInstance: ReturnType<typeof getDb> | null = null;

export function getDbInstance() {
  if (!dbInstance) {
    dbInstance = initDb();
  }
  return dbInstance;
}

// Export db for backward compatibility
// Use getter for lazy initialization, avoid initializing database connection when module loads
// This way it won't error during build due to missing environment variables
let _cachedDb: ReturnType<typeof getDb> | null = null;

export const db: ReturnType<typeof getDb> = new Proxy({} as any, {
  get(_target, prop) {
    if (!_cachedDb) {
      console.log("[DB] Initializing database connection (first access)...");
      try {
        _cachedDb = getDbInstance();
        console.log("[DB] ✅ Database initialized successfully");
      } catch (error) {
        console.error("[DB] ❌ Failed to initialize database:", error);
        throw error;
      }
    }
    const db = _cachedDb;
    // @ts-ignore - proxy to db instance
    return db[prop];
  },
});

export async function getUserByEmail(email: string) {
  try {
    return await db.select().from(user).where(eq(user.email, email));
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to get user by email. ${error}`,
    );
  }
}

export async function getUser(email: string): Promise<Array<User>> {
  try {
    return await db.select().from(user).where(eq(user.email, email));
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to get user by email. ${error}`,
    );
  }
}

export async function getUserById(id: string): Promise<User | null> {
  try {
    const [record] = await db
      .select()
      .from(user)
      .where(eq(user.id, id))
      .limit(1);

    return record ?? null;
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to get user by id. ${error}`,
    );
  }
}

export type UserProfile = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  hasPassword: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
};

export async function getUserProfile(
  userId: string,
): Promise<UserProfile | null> {
  try {
    const profile = await getUserById(userId);
    if (!profile) return null;

    return {
      id: profile.id,
      email: profile.email,
      name: profile.name ?? null,
      avatarUrl: profile.avatarUrl ?? null,
      hasPassword: Boolean(profile.password),
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      lastLoginAt: profile.lastLoginAt ?? null,
    };
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to get user profile. ${error}`,
    );
  }
}

export async function updateUserProfile(
  userId: string,
  updates: {
    name?: string | null;
    avatarUrl?: string | null;
  },
) {
  const now = new Date();
  const payload: Partial<User> & { updatedAt: Date } = { updatedAt: now };

  if (updates.name !== undefined) {
    const normalized = updates.name?.trim() ?? null;
    payload.name = normalized ? normalized.slice(0, 64) : null;
  }

  if (updates.avatarUrl !== undefined) {
    const normalized = updates.avatarUrl?.trim() ?? null;
    payload.avatarUrl = normalized && normalized.length > 0 ? normalized : null;
  }

  if (Object.keys(payload).length === 1) {
    return getUserById(userId);
  }

  try {
    const [record] = await db
      .update(user)
      .set(payload)
      .where(eq(user.id, userId))
      .returning();
    return record ?? null;
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to update user profile. ${error}`,
    );
  }
}

export async function updateUserOnboarding(
  userId: string,
  finishOnboarding: boolean,
) {
  try {
    await db.update(user).set({ finishOnboarding }).where(eq(user.id, userId));
  } catch (error) {
    console.error("Failed to update user onboarding status:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to update user onboarding status. ${error}`,
    );
  }
}

export async function markUserLoggedIn(userId: string): Promise<{
  isFirstLogin: boolean;
  user: User | null;
}> {
  try {
    const existing = await getUserById(userId);

    if (!existing) {
      console.warn(`[Auth] markUserLoggedIn: user ${userId} not found.`);
      return { isFirstLogin: false, user: null };
    }

    const now = new Date();
    const updates: Partial<User> & { updatedAt: Date; lastLoginAt: Date } = {
      updatedAt: now,
      lastLoginAt: now,
    };

    if (!existing.firstLoginAt) {
      (
        updates as Partial<User> & {
          updatedAt: Date;
          lastLoginAt: Date;
          firstLoginAt: Date;
        }
      ).firstLoginAt = now;
    }

    await db.update(user).set(updates).where(eq(user.id, userId));

    return {
      isFirstLogin: !existing.firstLoginAt,
      user: {
        ...existing,
        firstLoginAt: existing.firstLoginAt ?? now,
        lastLoginAt: now,
        updatedAt: now,
      },
    };
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to record login for user ${userId}. ${
        error instanceof Error ? error.message : error
      }`,
    );
  }
}

export async function createUser(email: string, password: string) {
  const hashedPassword = generateHashedPassword(password);
  const now = new Date(); // SQLite timestamp mode expects Date objects
  const userId = crypto.randomUUID();

  try {
    return await db
      .insert(user)
      .values({
        id: userId,
        email,
        password: hashedPassword,
        name: email.split("@")[0] ?? email,
        createdAt: now,
        updatedAt: now,
        sessionVersion: 1,
      })
      .returning();
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to create user. ${error}`,
    );
  }
}

export async function deletePasswordResetTokensByUserId(userId: string) {
  try {
    await db
      .delete(passwordResetToken)
      .where(eq(passwordResetToken.userId, userId));
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to delete password reset tokens. ${error}`,
    );
  }
}

export async function createPasswordResetTokenRecord({
  userId,
  token,
  expiresAt,
}: {
  userId: string;
  token: string;
  expiresAt: Date;
}): Promise<PasswordResetToken> {
  try {
    const hashedToken = hashPasswordResetToken(token);

    await deletePasswordResetTokensByUserId(userId);

    const [createdToken] = await db
      .insert(passwordResetToken)
      .values({
        id: crypto.randomUUID(),
        userId,
        token: hashedToken,
        expiresAt: expiresAt, // SQLite timestamp mode expects Date objects
        createdAt: new Date(),
      })
      .returning();

    return createdToken;
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to create password reset token. ${error}`,
    );
  }
}

export async function getPasswordResetTokenByToken(
  tokenValue: string,
): Promise<PasswordResetToken | null> {
  try {
    const hashedToken = hashPasswordResetToken(tokenValue);
    const [token] = await db
      .select()
      .from(passwordResetToken)
      .where(eq(passwordResetToken.token, hashedToken))
      .limit(1);

    return token ?? null;
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to fetch password reset token. ${error}`,
    );
  }
}

export async function deletePasswordResetTokenById(id: string) {
  try {
    await db.delete(passwordResetToken).where(eq(passwordResetToken.id, id));
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to delete password reset token. ${error}`,
    );
  }
}

export async function deleteExpiredPasswordResetTokens(
  referenceDate = new Date(),
) {
  try {
    await db
      .delete(passwordResetToken)
      .where(lt(passwordResetToken.expiresAt, referenceDate));
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to delete expired password reset tokens. ${error}`,
    );
  }
}

export async function updateUserPassword(userId: string, password: string) {
  try {
    const hashedPassword = generateHashedPassword(password);

    await db
      .update(user)
      .set({ password: hashedPassword, updatedAt: new Date() })
      .where(eq(user.id, userId));
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to update user password. ${error}`,
    );
  }
}

export async function incrementUserSessionVersion(userId: string) {
  try {
    const [current] = await db
      .select({ sessionVersion: user.sessionVersion })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    await db
      .update(user)
      .set({
        sessionVersion: (current?.sessionVersion ?? 1) + 1,
        updatedAt: new Date(),
      })
      .where(eq(user.id, userId));
  } catch (error) {
    console.error("[incrementUserSessionVersion]", error);
    throw new AppError(
      "bad_request:database",
      "Failed to increment session version",
    );
  }
}

export async function saveChat({
  id,
  userId,
  title,
}: {
  id: string;
  userId: string;
  title: string;
}) {
  try {
    const result = await db
      .insert(chat)
      .values({
        id,
        createdAt: new Date(),
        userId,
        title,
        visibility: "public",
      })
      .onConflictDoUpdate({
        target: chat.id,
        set: {
          title,
          visibility: "public",
        },
      });

    return result;
  } catch (error) {
    console.error(error);
    throw new AppError("bad_request:database", `Failed to save chat. ${error}`);
  }
}

/**
 * Save the association between Chat and Insight
 * A Chat can be associated with multiple Insights, used to record the context source of conversations
 */
export async function saveChatInsights({
  chatId,
  insightIds,
}: {
  chatId: string;
  // Associated insight ID list
  insightIds: string[];
}) {
  if (!insightIds || insightIds.length === 0) {
    return [];
  }

  try {
    const values = insightIds.map((insightId, index) => ({
      chatId,
      insightId,
      sortOrder: index,
    }));

    return await db
      .insert(chatInsights)
      .values(values)
      .onConflictDoNothing()
      .returning();
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to save chat insights. ${error}`,
    );
  }
}

/**
 * Get all Insight IDs associated with a Chat
 */
export async function getChatInsightIds({
  chatId,
}: {
  chatId: string;
}): Promise<string[]> {
  try {
    const results = await db
      .select({ insightId: chatInsights.insightId })
      .from(chatInsights)
      .where(eq(chatInsights.chatId, chatId))
      .orderBy(chatInsights.sortOrder);

    return results.map((r: { insightId: string }) => r.insightId);
  } catch (error) {
    console.error(error);
    return [];
  }
}

/**
 * Get all Chat IDs associated with an Insight
 * Queries two data sources:
 * 1. chatInsights association table
 * 2. Message metadata.focusedInsightIds field (backward compatibility)
 */
export async function getInsightChats({
  insightId,
}: {
  insightId: string;
}): Promise<string[]> {
  try {
    // Method 1: Query from chatInsights association table
    const chatsFromRelation = await db
      .select({ chatId: chatInsights.chatId })
      .from(chatInsights)
      .where(eq(chatInsights.insightId, insightId));

    // Method 2: Query from message metadata.focusedInsightIds (backward compatibility)
    let messagesWithInsight: { chatId: string }[] = [];

    if (isTauriMode()) {
      // SQLite: use JSON functions
      messagesWithInsight = await db
        .select({ chatId: message.chatId })
        .from(message)
        .where(
          sql`EXISTS (
            SELECT 1
            FROM json_each(json_extract(${message.metadata}, '$.focusedInsightIds'))
            WHERE json_each.value = ${insightId}
          )`,
        );
    } else {
      // PostgreSQL: use JSONB @> operator
      messagesWithInsight = await db
        .select({ chatId: message.chatId })
        .from(message)
        .where(
          sql`${message.metadata}->'focusedInsightIds' @> ${JSON.stringify([insightId])}::jsonb`,
        );
    }

    // Merge results from both methods and deduplicate
    const chatIdsFromRelation = chatsFromRelation.map(
      (r: { chatId: string }) => r.chatId,
    );
    const chatIdsFromMessages = messagesWithInsight.map(
      (m: { chatId: string }) => m.chatId,
    );

    return Array.from(
      new Set([...chatIdsFromRelation, ...chatIdsFromMessages]),
    );
  } catch (error) {
    console.error(error);
    return [];
  }
}

/**
 * Get all Insight details associated with a Chat
 * Queries two data sources:
 * 1. chatInsights association table
 * 2. Message metadata.focusedInsightIds field (backward compatibility)
 */
export async function getChatInsights({
  chatId,
}: {
  chatId: string;
}): Promise<Insight[]> {
  try {
    // Method 1: Query from chatInsights association table
    const results = await db
      .select({
        insight: insight,
      })
      .from(chatInsights)
      .innerJoin(insight, eq(chatInsights.insightId, insight.id))
      .where(eq(chatInsights.chatId, chatId))
      .orderBy(chatInsights.sortOrder);

    const insightsFromRelation = results.map(
      (r: { insight: Insight }) => r.insight,
    );

    // Method 2: Query from message metadata.focusedInsightIds (backward compatibility)
    const insightIdsFromMessages: string[] = [];

    // Query all messages directly, then check metadata
    const messagesWithInsight = await db
      .select({ metadata: message.metadata })
      .from(message)
      .where(eq(message.chatId, chatId));

    for (const msg of messagesWithInsight) {
      // In SQLite mode, metadata is a JSON string, need to parse
      let metadata = msg.metadata;
      if (typeof metadata === "string") {
        try {
          metadata = JSON.parse(metadata);
        } catch (e) {
          continue;
        }
      }

      if (metadata && typeof metadata === "object") {
        // Check focusedInsightIds
        const focusedInsightIds = (metadata as any).focusedInsightIds;
        if (Array.isArray(focusedInsightIds)) {
          insightIdsFromMessages.push(...focusedInsightIds.filter(Boolean));
        }
      }
    }

    // If there are extra insight IDs obtained from messages, query them
    const extraIds = insightIdsFromMessages.filter(
      (id) => !insightsFromRelation.some((i: Insight) => i.id === id),
    );

    if (extraIds.length === 0) {
      return insightsFromRelation;
    }

    // Query extra insights
    const extraInsights = await db
      .select()
      .from(insight)
      .where(inArray(insight.id, extraIds));

    // Merge results and deduplicate
    const allInsights = [...insightsFromRelation];
    for (const extraInsight of extraInsights) {
      if (!allInsights.some((i) => i.id === extraInsight.id)) {
        allInsights.push(extraInsight);
      }
    }

    return allInsights;
  } catch (error) {
    console.error(error);
    return [];
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    await db.delete(vote).where(eq(vote.chatId, id));
    await db.delete(message).where(eq(message.chatId, id));
    await db.delete(stream).where(eq(stream.chatId, id));

    const [chatsDeleted] = await db
      .delete(chat)
      .where(eq(chat.id, id))
      .returning();
    return chatsDeleted;
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to delete chat by id. ${error}`,
    );
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}): Promise<{
  chats: Array<
    Chat & {
      latestMessageTime: Date | null;
      latestMessageContent: string | null;
      messageCount: number;
    }
  >;
  hasMore: boolean;
}> {
  try {
    const extendedLimit = limit + 1;

    const query = (whereCondition?: SQL<unknown>) =>
      db
        .select()
        .from(chat)
        .where(
          whereCondition
            ? and(whereCondition, eq(chat.userId, id))
            : eq(chat.userId, id),
        )
        .orderBy(desc(chat.createdAt))
        .limit(extendedLimit);

    let filteredChats: Array<Chat> = [];

    if (startingAfter && !isValidUuid(startingAfter)) {
      return {
        chats: [],
        hasMore: false,
      };
    }

    if (endingBefore && !isValidUuid(endingBefore)) {
      return {
        chats: [],
        hasMore: false,
      };
    }

    if (startingAfter) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, startingAfter))
        .limit(1);

      if (!selectedChat) {
        return {
          chats: [],
          hasMore: false,
        };
      }

      filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
    } else if (endingBefore) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, endingBefore))
        .limit(1);

      if (!selectedChat) {
        return {
          chats: [],
          hasMore: false,
        };
      }

      filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
    } else {
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;
    const chatsToReturn = hasMore
      ? filteredChats.slice(0, limit)
      : filteredChats;

    // Get latest message time and total message count for each chat
    const chatsWithExtendedInfo = await Promise.all(
      chatsToReturn.map(async (chat) => {
        // Get latest message and message count (parallel query)
        const [latestMessages, [{ count: messageCount }]] = await Promise.all([
          db
            .select()
            .from(message)
            .where(eq(message.chatId, chat.id))
            .orderBy(desc(message.createdAt))
            .limit(1),
          db
            .select({ count: count(message.id) })
            .from(message)
            .where(eq(message.chatId, chat.id))
            .execute(),
        ]);

        // Extract text content from latest message
        let latestMessageContent = null;
        if (latestMessages.length > 0) {
          const latestMessage = latestMessages[0];
          type MessagePart = {
            type?: string;
            text?: string;
          };
          const parts = Array.isArray(latestMessage.parts)
            ? (latestMessage.parts as MessagePart[])
            : [];
          if (parts.length > 0) {
            const textParts = parts
              .filter(
                (
                  part,
                ): part is Required<Pick<MessagePart, "text">> & MessagePart =>
                  part?.type === "text" && typeof part.text === "string",
              )
              .map((part) => part.text);
            latestMessageContent = textParts.join("");
          }
        }

        return {
          ...chat,
          latestMessageTime:
            latestMessages.length > 0 ? latestMessages[0].createdAt : null,
          latestMessageContent,
          messageCount: messageCount?.count ?? 0,
        };
      }),
    );

    return {
      chats: chatsWithExtendedInfo,
      hasMore,
    };
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to get chats by user id. ${error}`,
    );
  }
}

export async function getChatById({ id }: { id: string }) {
  try {
    const [selectedChat] = await db.select().from(chat).where(eq(chat.id, id));
    return selectedChat;
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to get chat by id. ${error}`,
    );
  }
}

export async function saveMessages({
  messages,
}: {
  messages: Array<DBMessage>;
}) {
  try {
    // Serialize parts and attachments (compatible with PostgreSQL and SQLite)
    const serializedMessages = messages.map((msg) => {
      const serializedParts = serializeJson(msg.parts as any);
      const serializedAttachments = serializeJson(msg.attachments as any);

      // Build message object, ensure undefined values are handled
      const messageData: any = {
        id: msg.id,
        chatId: msg.chatId,
        role: msg.role,
        parts: serializedParts,
        attachments: serializedAttachments,
        createdAt: msg.createdAt,
      };

      // Only add when metadata has a value (avoid parameter binding issues caused by undefined)
      if (msg.metadata !== undefined && msg.metadata !== null) {
        messageData.metadata = serializeJson(msg.metadata as any);
      }

      return messageData;
    });

    // Batch insert to avoid SQLite parameter binding limit
    for (let i = 0; i < serializedMessages.length; i += DB_INSERT_CHUNK_SIZE) {
      const chunk = serializedMessages.slice(i, i + DB_INSERT_CHUNK_SIZE);
      await db
        .insert(message)
        .values(chunk)
        .onConflictDoUpdate({
          target: message.id,
          set: {
            parts: sql`excluded.parts`,
            attachments: sql`excluded.attachments`,
            metadata: sql`excluded.metadata`,
          },
        });
    }
  } catch (error) {
    console.error("[saveMessages] Error:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to save messages. ${error}`,
    );
  }
}

export async function getMessagesByChatId({
  id,
  limit = 1000,
  offset = 0,
}: {
  id: string;
  limit?: number;
  offset?: number;
}) {
  try {
    const messages = await db
      .select()
      .from(message)
      .where(eq(message.chatId, id))
      .orderBy(asc(message.createdAt))
      .limit(limit)
      .offset(offset);

    // Deserialize parts and attachments (SQLite mode)
    if (isTauriMode()) {
      return messages.map((msg: any) => ({
        ...msg,
        parts: deserializeJson(msg.parts),
        attachments: deserializeJson(msg.attachments),
        metadata: msg.metadata ? deserializeJson(msg.metadata) : msg.metadata,
      }));
    }

    return messages;
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to get messages by chat id. ${error}`,
    );
  }
}

export async function getMessagesWithAttachmentsBefore({
  before,
  limit,
}: {
  before: Date;
  limit: number;
}): Promise<DBMessage[]> {
  try {
    // Check if attachments exist (compatible with PostgreSQL and SQLite)
    const hasAttachmentsCondition = isTauriMode()
      ? sql`json_array_length(${message.attachments}) > 0` // SQLite
      : sql`jsonb_array_length(${message.attachments}::jsonb) > 0`; // PostgreSQL

    const messages = await db
      .select()
      .from(message)
      .where(and(lt(message.createdAt, before), hasAttachmentsCondition))
      .orderBy(asc(message.createdAt))
      .limit(limit);

    // Deserialize parts and attachments (SQLite mode)
    if (isTauriMode()) {
      return messages.map((msg: any) => ({
        ...msg,
        parts: deserializeJson(msg.parts),
        attachments: deserializeJson(msg.attachments),
        metadata: msg.metadata ? deserializeJson(msg.metadata) : msg.metadata,
      }));
    }

    return messages;
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to fetch messages for attachment cleanup. ${error}`,
    );
  }
}

export async function updateMessageFileMetadata({
  messageId,
  attachments,
  parts,
}: {
  messageId: string;
  attachments: unknown;
  parts: unknown;
}) {
  try {
    await db
      .update(message)
      .set({
        attachments: serializeJson(attachments as any),
        parts: serializeJson(parts as any),
      })
      .where(eq(message.id, messageId));
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to update message metadata. ${error}`,
    );
  }
}

export async function voteMessage({
  chatId,
  messageId,
  type,
}: {
  chatId: string;
  messageId: string;
  type: "up" | "down";
}) {
  try {
    const [existingVote] = await db
      .select()
      .from(vote)
      .where(and(eq(vote.messageId, messageId)));

    if (existingVote) {
      return await db
        .update(vote)
        .set({ isUpvoted: type === "up" })
        .where(and(eq(vote.messageId, messageId), eq(vote.chatId, chatId)));
    }
    return await db.insert(vote).values({
      chatId,
      messageId,
      isUpvoted: type === "up",
    });
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to vote message. ${error}`,
    );
  }
}

export async function getVotesByChatId({ id }: { id: string }) {
  try {
    return await db.select().from(vote).where(eq(vote.chatId, id));
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to get votes by chat id. ${error}`,
    );
  }
}

export async function getMessageById({ id }: { id: string }) {
  try {
    const messages = await db.select().from(message).where(eq(message.id, id));

    // Deserialize parts and attachments (SQLite mode)
    if (isTauriMode() && messages.length > 0) {
      return messages.map((msg: any) => ({
        ...msg,
        parts: deserializeJson(msg.parts),
        attachments: deserializeJson(msg.attachments),
        metadata: msg.metadata ? deserializeJson(msg.metadata) : msg.metadata,
      }));
    }

    return messages;
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to get message by id. ${error}`,
    );
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  try {
    const messagesToDelete = await db
      .select({ id: message.id })
      .from(message)
      .where(
        and(eq(message.chatId, chatId), gte(message.createdAt, timestamp)),
      );

    const messageIds = messagesToDelete.map((message: any) => message.id);

    if (messageIds.length > 0) {
      await db
        .delete(vote)
        .where(
          and(eq(vote.chatId, chatId), inArray(vote.messageId, messageIds)),
        );

      return await db
        .delete(message)
        .where(
          and(eq(message.chatId, chatId), inArray(message.id, messageIds)),
        );
    }
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to delete messages by chat id after timestamp. ${error}`,
    );
  }
}

export async function replaceMessagesWithCompactionSummary({
  chatId,
  messageIds,
  summary,
  createdAt,
  compactedMessageCount,
  compactedRangeStart,
  compactedRangeEnd,
  level,
}: {
  chatId: string;
  messageIds: string[];
  summary: string;
  createdAt: Date;
  compactedMessageCount: number;
  compactedRangeStart: string;
  compactedRangeEnd: string;
  level: "soft" | "hard" | "emergency";
}) {
  if (messageIds.length === 0) {
    return null;
  }

  try {
    if (isTauriMode()) {
      type SqliteRawClient = {
        transaction: <T>(callback: () => T) => () => T;
        prepare: (sql: string) => {
          run: (...params: any[]) => unknown;
        };
      };
      const sqlite = (db as typeof db & { $client?: SqliteRawClient }).$client;

      if (!sqlite) {
        throw new Error("SQLite client is not available");
      }

      const summaryMessageId = generateUUID();
      const summaryMetadata = {
        type: "compaction_summary",
        level,
        compactedMessageCount,
        compactedRangeStart,
        compactedRangeEnd,
        sourceMessageIds: messageIds,
      };

      // better-sqlite3 does not support drizzle's async transaction callback,
      // so SQLite needs a native transaction to keep insert+delete atomic.
      const runReplacement = sqlite.transaction(() => {
        sqlite
          .prepare(
            'INSERT INTO "Message_v2" ("id", "chatId", "role", "parts", "attachments", "createdAt", "metadata") VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            summaryMessageId,
            chatId,
            "assistant",
            serializeJson([{ type: "text", text: summary }]),
            serializeJson([]),
            Math.floor(createdAt.getTime() / 1000),
            serializeJson(summaryMetadata),
          );

        for (
          let index = 0;
          index < messageIds.length;
          index += DB_INSERT_CHUNK_SIZE
        ) {
          // Chunk deletes so large compactions stay below SQLite's parameter cap.
          const chunk = messageIds.slice(index, index + DB_INSERT_CHUNK_SIZE);
          const placeholders = chunk.map(() => "?").join(", ");

          sqlite
            .prepare(
              `DELETE FROM "Vote_v2" WHERE "chatId" = ? AND "messageId" IN (${placeholders})`,
            )
            .run(chatId, ...chunk);

          sqlite
            .prepare(
              `DELETE FROM "Message_v2" WHERE "chatId" = ? AND "id" IN (${placeholders})`,
            )
            .run(chatId, ...chunk);
        }
      });

      runReplacement();

      return {
        id: summaryMessageId,
        chatId,
        role: "assistant",
        parts: [{ type: "text", text: summary }],
        attachments: [],
        createdAt,
        metadata: summaryMetadata,
      };
    }

    return await executeTransaction(async (tx) => {
      const [summaryMessage] = await tx
        .insert(message)
        .values({
          id: generateUUID(),
          chatId,
          role: "assistant",
          parts: serializeJson([{ type: "text", text: summary }]),
          attachments: serializeJson([]),
          createdAt,
          metadata: serializeJson({
            type: "compaction_summary",
            level,
            compactedMessageCount,
            compactedRangeStart,
            compactedRangeEnd,
            sourceMessageIds: messageIds,
          }),
        })
        .returning();

      await tx
        .delete(vote)
        .where(
          and(eq(vote.chatId, chatId), inArray(vote.messageId, messageIds)),
        );

      await tx
        .delete(message)
        .where(
          and(eq(message.chatId, chatId), inArray(message.id, messageIds)),
        );

      return summaryMessage ?? null;
    });
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to replace messages with compaction summary. ${error}`,
    );
  }
}

export async function updateChatVisibilityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: "private" | "public";
}) {
  try {
    return await db.update(chat).set({ visibility }).where(eq(chat.id, chatId));
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to update chat visibility by id. ${error}`,
    );
  }
}

export async function getMessageCountByUserId({
  id,
  differenceInHours,
}: {
  id: string;
  differenceInHours: number;
}) {
  try {
    const hoursAgo = new Date(Date.now() - differenceInHours * 60 * 60 * 1000);

    const [stats] = await db
      .select({ count: count(message.id) })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(
        and(
          eq(chat.userId, id),
          gte(message.createdAt, hoursAgo),
          eq(message.role, "user"),
        ),
      )
      .execute();

    return stats?.count ?? 0;
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to get message count by user id. ${error}`,
    );
  }
}

/**
 * Get message statistics for the past 24 hours for a user
 * Includes total message count, Insight event count, and list of platforms involved
 */
export async function getDailyMessageStatsByUserId({
  userId,
}: {
  userId: string;
}): Promise<{
  messageCount: number;
  insightCount: number;
  platforms: string[];
  platformMessageCounts: Record<string, number>;
}> {
  try {
    const bots = await getBotsByUserId({
      id: userId,
      limit: null,
      startingAfter: null,
      endingBefore: null,
      onlyEnable: false,
    });
    const botIds = bots.bots.map((bot) => bot.id);

    const { insights } = await getStoredInsightsByBotIds({
      ids: botIds,
      days: 1,
    });

    // Count total messages, platform list, and message count per platform
    let messageCount = 0;
    const platformCounts: Record<string, number> = {};
    const platformsSet = new Set<string>();

    for (const insight of insights) {
      const sources = insight.sources ?? [];
      const details = insight.details ?? [];
      messageCount += sources.length + details.length;

      for (const source of sources) {
        if (source.platform) {
          platformsSet.add(source.platform);
          platformCounts[source.platform] =
            (platformCounts[source.platform] ?? 0) + 1;
        }
      }
      for (const detail of details) {
        if (detail.platform) {
          platformsSet.add(detail.platform);
          platformCounts[detail.platform] =
            (platformCounts[detail.platform] ?? 0) + 1;
        }
      }
    }

    const platforms = Array.from(platformsSet);

    return {
      messageCount,
      insightCount: insights.length,
      platforms,
      platformMessageCounts: platformCounts,
    };
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to get daily message stats by user id. ${error}`,
    );
  }
}

export async function createStreamId({
  streamId,
  chatId,
}: {
  streamId: string;
  chatId: string;
}) {
  try {
    await db
      .insert(stream)
      .values({ id: streamId, chatId, createdAt: new Date() });
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to create stream id. ${error}`,
    );
  }
}

export async function getStreamIdsByChatId({ chatId }: { chatId: string }) {
  try {
    const streamIds = await db
      .select({ id: stream.id })
      .from(stream)
      .where(eq(stream.chatId, chatId))
      .orderBy(asc(stream.createdAt))
      .execute();

    return streamIds.map(({ id }: any) => id);
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to get stream ids by chat id. ${error}`,
    );
  }
}

/**
 * Retrieve a single bot by its UUID
 * @param id Unique identifier of the bot
 * @returns Bot object if found, undefined otherwise
 */
export async function getBotById({ id }: { id: string }) {
  try {
    const [foundBot] = await db.select().from(bot).where(eq(bot.id, id));
    if (!foundBot) return undefined;
    return {
      ...foundBot,
      adapterConfig: deserializeJson(foundBot.adapterConfig),
    };
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to get bot by id: ${id}. ${error}`,
    );
  }
}

/**
 * Retrieve a single bot with its associated account by bot UUID
 * @param id Unique identifier of the bot
 * @returns BotWithAccount object if found, undefined otherwise
 */
export async function getBotWithAccountById({
  id,
}: {
  id: string;
}): Promise<BotWithAccount | undefined> {
  try {
    const [found] = await db
      .select({
        bot: bot,
        account: integrationAccounts,
      })
      .from(bot)
      .leftJoin(
        integrationAccounts,
        eq(bot.platformAccountId, integrationAccounts.id),
      )
      .where(eq(bot.id, id));

    if (!found) {
      return undefined;
    }

    return {
      ...found.bot,
      adapterConfig: deserializeJson(found.bot.adapterConfig),
      platformAccount: found.account
        ? {
            ...found.account,
            metadata: deserializeJson(found.account.metadata),
          }
        : null,
    } as BotWithAccount;
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to get bot with account by id: ${id}. ${error}`,
    );
  }
}

export async function getBotByAdapter({
  userId,
  adapter,
}: {
  userId: string;
  adapter: string;
}): Promise<Bot | null> {
  try {
    const [foundBot] = await db
      .select()
      .from(bot)
      .where(and(eq(bot.userId, userId), eq(bot.adapter, adapter)))
      .limit(1);
    if (!foundBot) return null;
    return {
      ...foundBot,
      adapterConfig: deserializeJson(foundBot.adapterConfig),
    };
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to get bot by adapter ${adapter}. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function ensureRssBot(userId: string): Promise<Bot> {
  const existing = await getBotByAdapter({ userId, adapter: "rss" });
  if (existing) {
    return existing;
  }

  const botId = await createBot({
    userId,
    name: "RSS Feeds",
    description: "System-managed RSS aggregator",
    adapter: "rss",
    adapterConfig: {},
    enable: true,
    platformAccountId: null,
  });

  const created = await getBotById({ id: botId });
  if (!created) {
    throw new AppError(
      "bad_request:database",
      `Failed to ensure RSS bot for user ${userId}`,
    );
  }
  return created;
}

export async function botExists({
  id,
  userId,
}: {
  id: string;
  userId: string;
}): Promise<Bot | undefined> {
  try {
    const [foundBot] = await db
      .select()
      .from(bot)
      .where(and(eq(bot.id, id), eq(bot.userId, userId)));
    if (!foundBot) return undefined;
    return {
      ...foundBot,
      adapterConfig: deserializeJson(foundBot.adapterConfig),
    };
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to get bot by id: ${id}. ${error}`,
    );
  }
}

/**
 * Retrieve all bots by user id from the database
 * @returns Array of Bot objects sorted by creation date (newest first)
 */
export async function getBotsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
  onlyEnable,
}: {
  id: string;
  limit: number | null;
  startingAfter: string | null;
  endingBefore: string | null;
  onlyEnable: boolean | null;
}): Promise<{ bots: BotWithAccount[]; hasMore: boolean }> {
  try {
    limit = limit ?? 20;
    const extendedLimit = limit + 1;

    const baseQuery = (whereCondition?: SQL<unknown>) =>
      db
        .select({
          bot,
          account: integrationAccounts,
        })
        .from(bot)
        .leftJoin(
          integrationAccounts,
          eq(bot.platformAccountId, integrationAccounts.id),
        )
        .where(
          whereCondition
            ? and(whereCondition, eq(bot.userId, id))
            : eq(bot.userId, id),
        )
        .orderBy(desc(bot.createdAt))
        .limit(extendedLimit + 1);

    type Row = { bot: Bot; account: IntegrationAccount | null };

    let rawBots: Array<Row> = [];
    if (startingAfter) {
      const [selectedBot] = await db
        .select({ bot })
        .from(bot)
        .where(and(eq(bot.id, startingAfter), eq(bot.userId, id)))
        .limit(1);
      if (!selectedBot) {
        throw new AppError(
          "not_found:database",
          `Bot id ${startingAfter} not found`,
        );
      }
      rawBots = await baseQuery(gt(bot.createdAt, selectedBot.bot.createdAt));
    } else if (endingBefore) {
      const [selectedBot] = await db
        .select({ bot })
        .from(bot)
        .where(and(eq(bot.id, endingBefore), eq(bot.userId, id)))
        .limit(1);
      if (!selectedBot) {
        throw new AppError(
          "not_found:database",
          `Bot id ${endingBefore} not found`,
        );
      }
      rawBots = await baseQuery(lt(bot.createdAt, selectedBot.bot.createdAt));
    } else {
      rawBots = await baseQuery();
    }

    const filteredBots = onlyEnable
      ? rawBots.filter((item) => item.bot?.enable === true)
      : rawBots;
    const sorted = filteredBots.sort(
      (a, b) =>
        b.bot.createdAt.getTime() - a.bot.createdAt.getTime() ||
        b.bot.updatedAt.getTime() - a.bot.updatedAt.getTime(),
    );
    const hasMore = sorted.length > extendedLimit;
    const paginated = hasMore ? sorted.slice(0, extendedLimit) : sorted;

    return {
      bots: (hasMore ? paginated.slice(0, limit) : paginated).map(
        ({ bot: botItem, account }) =>
          ({
            ...botItem,
            adapterConfig: deserializeJson(
              botItem.adapterConfig as string | Record<string, unknown> | null,
            ),
            platformAccount: account ?? null,
          }) as BotWithAccount,
      ),
      hasMore,
    };
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to get all bots. ${error}`,
    );
  }
}

/**
 * Delete all bots belonging to a specific user
 * @param id - The user ID
 * @returns The number of deleted bots
 */
export async function deleteAllBotsByUserId({ id }: { id: string }) {
  try {
    const result = await db
      .delete(bot)
      .where(eq(bot.userId, id))
      .returning({ id: bot.id });

    return {
      count: result.length,
      deletedIds: result.map((item: any) => item.id),
    };
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to delete all bots for user ${id}. ${error}`,
    );
  }
}

/**
 * Delete bots by email, adapter type and user ID
 * @param email - The email associated with the bot
 * @param adapter - The adapter type (e.g., "gmail")
 * @param userId - The user ID
 * @returns The number of deleted bots and their IDs
 */
export async function deleteBotByEmailAndAdapter({
  email,
  adapter,
  userId,
}: {
  email: string;
  adapter: string;
  userId: string;
}) {
  try {
    // Check JSON fields (compatible with PostgreSQL and SQLite)
    const emailCheckCondition = isTauriMode()
      ? sql`json_extract(${bot.adapterConfig}, '$.GOOGLE_GMAIL_ADDRESS') = ${email}` // SQLite
      : sql`${bot.adapterConfig}->>'GOOGLE_GMAIL_ADDRESS' = ${email}`; // PostgreSQL

    const botsToDelete = await db
      .select({ id: bot.id })
      .from(bot)
      .where(
        and(
          eq(bot.userId, userId),
          eq(bot.adapter, adapter),
          emailCheckCondition,
        ),
      );

    if (botsToDelete.length === 0) {
      return { count: 0, deletedIds: [] };
    }

    const botIds = botsToDelete.map((item: any) => item.id);

    const result = await db
      .delete(bot)
      .where(and(eq(bot.userId, userId), inArray(bot.id, botIds)))
      .returning({ id: bot.id });

    return {
      count: result.length,
      deletedIds: result.map((item: any) => item.id),
    };
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to delete bots for email ${email}. ${error}`,
    );
  }
}

/**
 * Delete bots by adapter type for a specific user
 * @param adapter - The adapter type (e.g., "whatsapp")
 * @param userId - The user ID
 * @returns The number of deleted bots and their IDs
 */
export async function deleteBotsByAdapter({
  adapter,
  userId,
}: {
  adapter: IntegrationId;
  userId: string;
}) {
  try {
    const accountIds = await db
      .select({ id: integrationAccounts.id })
      .from(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.platform, adapter),
        ),
      );

    const result = await db
      .delete(bot)
      .where(and(eq(bot.userId, userId), eq(bot.adapter, adapter)))
      .returning({ id: bot.id });

    if (accountIds.length > 0) {
      await db.delete(integrationAccounts).where(
        inArray(
          integrationAccounts.id,
          accountIds.map((a: any) => a.id),
        ),
      );
    }

    return {
      count: result.length,
      deletedIds: result.map((item: any) => item.id),
    };
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to delete bots for adapter ${adapter}. ${error}`,
    );
  }
}

export async function getIntegrationAccountsByUserId({
  userId,
}: {
  userId: string;
}): Promise<IntegrationAccountWithBot[]> {
  try {
    const rows = await db
      .select({
        account: integrationAccounts,
        bot: bot,
      })
      .from(integrationAccounts)
      .leftJoin(bot, eq(bot.platformAccountId, integrationAccounts.id))
      .where(eq(integrationAccounts.userId, userId))
      .orderBy(desc(integrationAccounts.createdAt));

    return rows.map(({ account, bot: botRow }: any) => {
      // Parse metadata JSON string in SQLite/Tauri mode so callers can access .sessionKey etc.
      const rawMeta = account.metadata;
      const parsedMeta =
        isTauriMode() && typeof rawMeta === "string" && rawMeta.length > 0
          ? (JSON.parse(rawMeta) as Record<string, unknown>)
          : rawMeta;
      return {
        ...account,
        metadata: parsedMeta,
        bot: botRow
          ? { ...botRow, adapterConfig: deserializeJson(botRow.adapterConfig) }
          : null,
      };
    });
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to load integration accounts. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function getIntegrationAccountByPlatform({
  userId,
  platform,
}: {
  userId: string;
  platform: IntegrationId;
}): Promise<IntegrationAccountWithBot | null> {
  try {
    const [row] = await db
      .select({
        account: integrationAccounts,
        bot: bot,
      })
      .from(integrationAccounts)
      .leftJoin(bot, eq(bot.platformAccountId, integrationAccounts.id))
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.platform, platform),
        ),
      )
      .orderBy(desc(integrationAccounts.createdAt))
      .limit(1);

    if (!row) {
      return null;
    }

    return {
      ...row.account,
      bot: row.bot
        ? { ...row.bot, adapterConfig: deserializeJson(row.bot.adapterConfig) }
        : null,
    };
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to load integration account for platform ${platform}. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function upsertIntegrationAccount({
  userId,
  platform,
  externalId,
  displayName,
  credentials,
  metadata,
  status = "active",
  encryptionKeyId = null,
}: {
  userId: string;
  platform: IntegrationAccount["platform"];
  externalId: string;
  displayName: string;
  credentials: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
  status?: string;
  encryptionKeyId?: string | null;
}): Promise<IntegrationAccount> {
  try {
    const now = new Date();
    const encryptedCredentials = encryptPayload(credentials);

    // For Telegram platform, if a user re-authorizes the same account (same externalId),
    // need to first check if the current user has an account with the same externalId (regardless of status),
    // if it exists, update it to ensure coverage of previously expired authorization
    if (platform === "telegram") {
      const existingAccount = await db
        .select()
        .from(integrationAccounts)
        .where(
          and(
            eq(integrationAccounts.userId, userId),
            eq(integrationAccounts.platform, platform),
            eq(integrationAccounts.externalId, externalId),
          ),
        )
        .limit(1);

      if (existingAccount.length > 0) {
        const existing = existingAccount[0];
        // If the account belongs to the current user, directly update to ensure coverage of previously expired authorization
        const [updated] = await db
          .update(integrationAccounts)
          .set({
            displayName,
            status,
            metadata: serializeJson(metadata),
            credentialsEncrypted: encryptedCredentials,
            encryptionKeyId,
            updatedAt: now,
          })
          .where(eq(integrationAccounts.id, existing.id))
          .returning();
        return updated;
      }
    }

    // For Tauri/SQLite mode, use delete-then-insert to avoid parameter binding issues
    if (isTauriMode()) {
      // Fallback: ensure shadow user exists, otherwise platform_accounts.userId foreign key will fail directly
      const [existingUser] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);

      if (!existingUser) {
        await db.insert(user).values({
          id: userId,
          // In SQLite mode, user.email is non-null, use a stable placeholder email
          email: `${userId}@local`,
          name: userId,
        });
      }

      // First check if it exists
      const existing = await db
        .select()
        .from(integrationAccounts)
        .where(
          and(
            eq(integrationAccounts.userId, userId),
            eq(integrationAccounts.platform, platform),
            eq(integrationAccounts.externalId, externalId),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        // Exists, update it
        const [updated] = await db
          .update(integrationAccounts)
          .set({
            displayName,
            status,
            metadata: serializeJson(metadata),
            credentialsEncrypted: encryptedCredentials,
            encryptionKeyId,
            updatedAt: now,
          })
          .where(eq(integrationAccounts.id, existing[0].id))
          .returning();
        return updated;
      }

      // Does not exist, insert it
      const [inserted] = await db
        .insert(integrationAccounts)
        .values({
          userId,
          platform,
          externalId,
          displayName,
          status,
          metadata: serializeJson(metadata),
          credentialsEncrypted: encryptedCredentials,
          encryptionKeyId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return inserted;
    }

    // PostgreSQL mode: use onConflictDoUpdate
    // serializeJson handles this automatically (PostgreSQL returns object, SQLite returns JSON string)
    const [account] = await db
      .insert(integrationAccounts)
      .values({
        userId,
        platform,
        externalId,
        displayName,
        status,
        metadata: serializeJson(metadata),
        credentialsEncrypted: encryptedCredentials,
        encryptionKeyId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          integrationAccounts.userId,
          integrationAccounts.platform,
          integrationAccounts.externalId,
        ],
        set: {
          displayName,
          status,
          metadata: serializeJson(metadata),
          credentialsEncrypted: encryptedCredentials,
          encryptionKeyId,
          updatedAt: now,
        },
      })
      .returning();

    return account;
  } catch (error) {
    console.error("[IntegrationAccounts] Failed to upsert account", {
      userId,
      platform,
      externalId,
      error,
    });
    throw new AppError(
      "bad_request:database",
      `Failed to store integration account. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function updateIntegrationAccount({
  userId,
  platformAccountId,
  status,
  credentials,
  metadata,
}: {
  userId: string;
  platformAccountId: string;
  status?: string;
  credentials?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}): Promise<IntegrationAccount | null> {
  try {
    const updatePayload: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (typeof status === "string") {
      updatePayload.status = status;
    }

    if (metadata !== undefined) {
      const value = metadata ?? null;
      // Consistent with insert/upsert: SQLite needs JSON string, PostgreSQL can be object; null remains null
      updatePayload.metadata =
        value !== null && typeof value === "object"
          ? (serializeJson(value) as Record<string, unknown>)
          : value;
    }

    if (credentials !== undefined) {
      updatePayload.credentialsEncrypted = encryptPayload(
        credentials ?? Object.create(null),
      );
    }

    if (
      updatePayload.status === undefined &&
      updatePayload.metadata === undefined &&
      updatePayload.credentialsEncrypted === undefined
    ) {
      return await getIntegrationAccountById({
        userId,
        platformAccountId,
      });
    }

    const [updatedAccount] = await db
      .update(integrationAccounts)
      .set(updatePayload)
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.id, platformAccountId),
        ),
      )
      .returning();

    return updatedAccount ?? null;
  } catch (error) {
    console.error("[IntegrationAccounts] Failed to update account", error);
    throw new AppError(
      "bad_request:database",
      `Unable to update integration account ${platformAccountId}. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function deleteIntegrationAccount({
  userId,
  platformAccountId,
}: {
  userId: string;
  platformAccountId: string;
}): Promise<{ deletedAccountId: string | null; deletedBots: string[] }> {
  try {
    const botsToDelete = await db
      .select({ id: bot.id, adapter: bot.adapter })
      .from(bot)
      .where(
        and(
          eq(bot.userId, userId),
          eq(bot.platformAccountId, platformAccountId),
        ),
      );

    const botIds = botsToDelete.map((b: any) => b.id);
    const adapters = botsToDelete.map((b: any) => b.adapter);

    // Delete user contacts associated with these bots
    // IMPORTANT: Only delete contacts for WeChat (which uses context tokens)
    // Other platforms don't need contact cleanup as they use different mechanisms
    if (botIds.length > 0) {
      const weixinBotIds = botsToDelete
        .filter((b: any) => b.adapter === "weixin")
        .map((b: any) => b.id);

      if (weixinBotIds.length > 0) {
        await db
          .delete(userContacts)
          .where(
            and(
              eq(userContacts.userId, userId),
              inArray(userContacts.botId, weixinBotIds),
            ),
          );
      }
    }

    if (botIds.length > 0) {
      await db
        .delete(bot)
        .where(and(eq(bot.userId, userId), inArray(bot.id, botIds)));
    }

    const [deletedAccount] = await db
      .delete(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.id, platformAccountId),
        ),
      )
      .returning({ id: integrationAccounts.id });

    return {
      deletedAccountId: deletedAccount?.id ?? null,
      deletedBots: botIds,
    };
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to delete integration account ${platformAccountId}. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function loadIntegrationCredentials<T = Record<string, unknown>>(
  account: IntegrationAccount | null,
): T | null;
export function loadIntegrationCredentials<T = Record<string, unknown>>(
  account: IntegrationAccount | null,
  auditContext?: {
    userId: string;
    ipAddress?: string;
    userAgent?: string;
  },
): T | null;
export function loadIntegrationCredentials<T = Record<string, unknown>>(
  account: IntegrationAccount | null,
  auditContext?: {
    userId: string;
    ipAddress?: string;
    userAgent?: string;
  },
): T | null {
  if (!account || !account.credentialsEncrypted) {
    return null;
  }

  // Log credential access if audit context is provided
  if (auditContext) {
    try {
      // Dynamic import to avoid circular dependencies
      const { logCredentialAccess } = require("@alloomi/audit");
      logCredentialAccess({
        accountId: account.id,
        userId: auditContext.userId,
        action: "read",
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        success: true,
      });
    } catch {
      // Ignore audit logging errors - should not break credential loading
    }
  }

  return decryptPayload<T>(account.credentialsEncrypted);
}

/**
 * Logs credential access to the database
 *
 * @param params - Credential access log parameters
 */
export async function logCredentialAccessToDb(params: {
  accountId: string;
  userId: string;
  action: "read" | "update" | "rotate" | "delete";
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  success: boolean;
  errorMessage?: string;
}): Promise<void> {
  try {
    await db.insert(credentialAccessLog).values({
      accountId: params.accountId,
      userId: params.userId,
      action: params.action,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      success: params.success,
      errorMessage: params.errorMessage,
    });
  } catch {
    // Ignore database audit logging errors - should not break operations
  }
}

export async function getIntegrationAccountById({
  userId,
  platformAccountId,
}: {
  userId: string;
  platformAccountId: string;
}): Promise<IntegrationAccountWithBot | null> {
  try {
    const [row] = await db
      .select({
        account: integrationAccounts,
        bot: bot,
      })
      .from(integrationAccounts)
      .leftJoin(bot, eq(bot.platformAccountId, integrationAccounts.id))
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.id, platformAccountId),
        ),
      )
      .limit(1);

    if (!row) {
      return null;
    }

    return {
      ...row.account,
      bot: row.bot
        ? { ...row.bot, adapterConfig: deserializeJson(row.bot.adapterConfig) }
        : null,
    };
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to load integration account ${platformAccountId}. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Get integration account by bot ID
 */
export async function getIntegrationAccountByBotId({
  botId,
}: {
  botId: string;
}): Promise<IntegrationAccountWithBot | null> {
  try {
    const [row] = await db
      .select({
        account: integrationAccounts,
        bot: bot,
      })
      .from(bot)
      .leftJoin(
        integrationAccounts,
        eq(bot.platformAccountId, integrationAccounts.id),
      )
      .where(eq(bot.id, botId))
      .limit(1);

    if (!row) {
      return null;
    }

    return {
      ...row.account,
      bot: row.bot
        ? { ...row.bot, adapterConfig: deserializeJson(row.bot.adapterConfig) }
        : null,
    };
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to load account for bot ${botId}. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Create a new bot in the database if no existing bot has the same adapterConfig
 * @param botData Object containing bot properties
 * @returns UUID of the created or existing bot
 */
export async function createBot(botData: {
  name: string;
  userId: string;
  description: string;
  adapter: string;
  adapterConfig: Record<string, unknown>;
  enable?: boolean;
  platformAccountId?: string | null;
}): Promise<string> {
  try {
    if (botData.platformAccountId) {
      const adapterConfigStr = JSON.stringify(botData.adapterConfig);

      // Compare config strings (compatible with PostgreSQL and SQLite)
      const configMatchCondition = isTauriMode()
        ? eq(bot.adapterConfig, adapterConfigStr) // SQLite: compare JSON string directly
        : sql`${bot.adapterConfig}::text = ${adapterConfigStr}::text`; // PostgreSQL: compare after type casting

      const [existingByAccount] = await db
        .select({ id: bot.id })
        .from(bot)
        .where(
          and(
            eq(bot.userId, botData.userId),
            eq(bot.platformAccountId, botData.platformAccountId),
            configMatchCondition,
          ),
        )
        .limit(1);
      if (existingByAccount) {
        return existingByAccount.id;
      }
    }

    const id = generateUUID();
    await db.insert(bot).values({
      id: id,
      userId: botData.userId,
      name: botData.name,
      description: botData.description,
      adapter: botData.adapter,
      adapterConfig: serializeJson(botData.adapterConfig),
      enable: botData.enable ?? false,
      platformAccountId: botData.platformAccountId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return id;
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to create bot. ${error}`,
    );
  }
}

/**
 * Update an existing bot
 * @param id UUID of the bot to update
 * @param updateData Partial object containing fields to update
 */
export async function updateBot(
  id: string,
  updateData: Partial<{
    name: string;
    description: string;
    adapter: string;
    adapterConfig: Record<string, unknown>;
    enable: boolean;
  }>,
): Promise<void> {
  try {
    // Serialize adapterConfig (if exists)
    const safeUpdateData = {
      ...updateData,
      updatedAt: new Date(),
    };

    // If adapterConfig exists, need to serialize
    if (safeUpdateData.adapterConfig) {
      (safeUpdateData as any).adapterConfig = serializeJson(
        safeUpdateData.adapterConfig,
      );
    }

    await db.update(bot).set(safeUpdateData).where(eq(bot.id, id));
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:database",
      `Failed to update bot id: ${id}. ${error}`,
    );
  }
}

/**
 * Delete a bot from the database
 * @param id UUID of the bot to delete
 */
export async function deleteBotById({ id }: { id: string }) {
  try {
    const [botsDeleted] = await db
      .delete(bot)
      .where(eq(bot.id, id))
      .returning();
    return botsDeleted;
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to delete bot id: ${id}. ${error}`,
    );
  }
}

export async function listIntegrationCatalogEntries({
  category,
  integrationType = "feed",
}: {
  category?: string | string[] | null;
  integrationType?: string;
} = {}): Promise<IntegrationCatalogEntry[]> {
  try {
    const filters: SQL[] = [
      eq(integrationCatalog.integrationType, integrationType),
    ];

    if (Array.isArray(category) && category.length > 0) {
      filters.push(inArray(integrationCatalog.category, category));
    } else if (typeof category === "string" && category.length > 0) {
      filters.push(eq(integrationCatalog.category, category));
    }

    return await db
      .select()
      .from(integrationCatalog)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(asc(integrationCatalog.category), asc(integrationCatalog.title));
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to load integration catalog. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function getIntegrationCatalogEntryBySlug({
  slug,
}: {
  slug: string;
}): Promise<IntegrationCatalogEntry | null> {
  try {
    const [entry] = await db
      .select()
      .from(integrationCatalog)
      .where(eq(integrationCatalog.slug, slug))
      .limit(1);
    return entry ?? null;
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to load catalog entry ${slug}. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Only query columns that existed in rss_subscriptions before the 0074 migration, to avoid SELECT errors when migration has not been executed */
const rssSubscriptionSafeSelect = {
  id: rssSubscriptions.id,
  userId: rssSubscriptions.userId,
  catalogId: rssSubscriptions.catalogId,
  integrationAccountId: rssSubscriptions.integrationAccountId,
  sourceUrl: rssSubscriptions.sourceUrl,
  title: rssSubscriptions.title,
  category: rssSubscriptions.category,
  status: rssSubscriptions.status,
  sourceType: rssSubscriptions.sourceType,
  etag: rssSubscriptions.etag,
  lastModified: rssSubscriptions.lastModified,
  lastFetchedAt: rssSubscriptions.lastFetchedAt,
  createdAt: rssSubscriptions.createdAt,
  updatedAt: rssSubscriptions.updatedAt,
};

export async function getRssSubscriptionsByUser({
  userId,
}: {
  userId: string;
}): Promise<RssSubscription[]> {
  try {
    const rows = await db
      .select(rssSubscriptionSafeSelect)
      .from(rssSubscriptions)
      .where(eq(rssSubscriptions.userId, userId))
      .orderBy(desc(rssSubscriptions.createdAt));
    return rows as RssSubscription[];
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to load RSS subscriptions. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function getRssSubscriptionById({
  userId,
  subscriptionId,
}: {
  userId: string;
  subscriptionId: string;
}): Promise<RssSubscription | null> {
  try {
    const [row] = await db
      .select(rssSubscriptionSafeSelect)
      .from(rssSubscriptions)
      .where(
        and(
          eq(rssSubscriptions.id, subscriptionId),
          eq(rssSubscriptions.userId, userId),
        ),
      )
      .limit(1);

    return (row ?? null) as RssSubscription | null;
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to load RSS subscription ${subscriptionId}. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function getRssSubscriptionsDue({
  limit,
  minIntervalMinutes,
}: {
  limit: number;
  minIntervalMinutes: number;
}): Promise<RssSubscription[]> {
  try {
    const normalizedLimit = Number.isFinite(limit) && limit > 0 ? limit : 10;
    const thresholdMs = Math.max(minIntervalMinutes, 1) * 60 * 1000;
    const threshold = new Date(Date.now() - thresholdMs);

    const rows = await db
      .select(rssSubscriptionSafeSelect)
      .from(rssSubscriptions)
      .where(
        and(
          eq(rssSubscriptions.status, "active"),
          or(
            isNull(rssSubscriptions.lastFetchedAt),
            lt(rssSubscriptions.lastFetchedAt, threshold),
          ),
        ),
      )
      .orderBy(asc(rssSubscriptions.lastFetchedAt))
      .limit(normalizedLimit);
    return rows as RssSubscription[];
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to load RSS subscriptions due for polling. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export type RssItemInsertResult = { id: string; guidHash: string };

/**
 * Insert RSS entries. Serialize metadata to DB-compatible format before writing (SQLite needs JSON string).
 */
export async function insertRssItems(
  items: InsertRssItem[],
): Promise<RssItemInsertResult[]> {
  if (items.length === 0) {
    return [];
  }

  const serializedItems = items.map((item) => {
    const meta = item.metadata;
    const metadata =
      meta !== null && meta !== undefined && typeof meta === "object"
        ? serializeJson(meta)
        : meta;
    return { ...item, metadata };
  });

  // Batch insert to avoid SQLite parameter binding limit
  const results: RssItemInsertResult[] = [];
  for (let i = 0; i < serializedItems.length; i += DB_INSERT_CHUNK_SIZE) {
    const chunk = serializedItems.slice(i, i + DB_INSERT_CHUNK_SIZE);
    try {
      const inserted = await db
        .insert(rssItems)
        .values(chunk)
        .onConflictDoNothing()
        .returning({ id: rssItems.id, guidHash: rssItems.guidHash });
      results.push(...inserted);
    } catch (error) {
      throw new AppError(
        "bad_request:database",
        `Failed to insert RSS items. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return results;
}

export async function markRssItemsProcessed(
  updates: Array<{
    id: string;
    status?: string;
    metadata?: Record<string, unknown> | null;
  }>,
) {
  if (updates.length === 0) {
    return;
  }

  try {
    await executeTransaction(async (tx) => {
      for (const update of updates) {
        const meta = update.metadata ?? null;
        const metadata =
          meta !== null && typeof meta === "object"
            ? (serializeJson(meta) as Record<string, unknown>)
            : meta;
        await tx
          .update(rssItems)
          .set({
            status: update.status ?? "processed",
            metadata,
            fetchedAt: new Date(),
          })
          .where(eq(rssItems.id, update.id));
      }
    });
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to update RSS items. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function createRssSubscription({
  userId,
  sourceUrl,
  title,
  category,
  status = "active",
  sourceType = "custom",
  catalogId = null,
  integrationAccountId = null,
}: {
  userId: string;
  sourceUrl: string;
  title?: string | null;
  category?: string | null;
  status?: string;
  sourceType?: string;
  catalogId?: string | null;
  integrationAccountId?: string | null;
}): Promise<RssSubscription> {
  try {
    const normalizedUrl = sourceUrl.trim();
    await ensureRssBot(userId);
    const [row] = await db
      .insert(rssSubscriptions)
      .values({
        userId,
        sourceUrl: normalizedUrl,
        title: title ?? null,
        category: category ?? null,
        status,
        sourceType,
        catalogId,
        integrationAccountId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [rssSubscriptions.userId, rssSubscriptions.sourceUrl],
        set: {
          title: title ?? null,
          category: category ?? null,
          status,
          sourceType,
          catalogId,
          integrationAccountId,
          updatedAt: new Date(),
        },
      })
      .returning();

    return row;
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to create RSS subscription. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function updateRssSubscription({
  userId,
  subscriptionId,
  title,
  category,
  status,
  lastFetchedAt,
  etag,
  lastModified,
  lastErrorCode,
  lastErrorMessage,
}: {
  userId: string;
  subscriptionId: string;
  title?: string | null;
  category?: string | null;
  status?: string;
  lastFetchedAt?: Date | null;
  etag?: string | null;
  lastModified?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
}): Promise<RssSubscription | null> {
  try {
    const payload: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (title !== undefined) payload.title = title;
    if (category !== undefined) payload.category = category;
    if (status !== undefined) payload.status = status;
    if (lastFetchedAt !== undefined) payload.lastFetchedAt = lastFetchedAt;
    if (etag !== undefined) payload.etag = etag;
    if (lastModified !== undefined) payload.lastModified = lastModified;
    if (lastErrorCode !== undefined) payload.lastErrorCode = lastErrorCode;
    if (lastErrorMessage !== undefined)
      payload.lastErrorMessage = lastErrorMessage;

    if (Object.keys(payload).length === 1) {
      return await getRssSubscriptionById({ userId, subscriptionId });
    }

    const [updated] = await db
      .update(rssSubscriptions)
      .set(payload)
      .where(
        and(
          eq(rssSubscriptions.id, subscriptionId),
          eq(rssSubscriptions.userId, userId),
        ),
      )
      .returning();

    return updated ?? null;
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to update RSS subscription ${subscriptionId}. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function deleteRssSubscription({
  userId,
  subscriptionId,
}: {
  userId: string;
  subscriptionId: string;
}): Promise<boolean> {
  try {
    const [deleted] = await db
      .delete(rssSubscriptions)
      .where(
        and(
          eq(rssSubscriptions.id, subscriptionId),
          eq(rssSubscriptions.userId, userId),
        ),
      )
      .returning({ id: rssSubscriptions.id });

    return Boolean(deleted?.id);
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to delete RSS subscription ${subscriptionId}. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Delete Telegram bots from the database where adapterConfig.TG_SESSION equals the given session
 * @param session The TG_SESSION value to match against
 */
export async function deleteTgBotBySession({ session }: { session: string }) {
  try {
    // Check TG_SESSION field in adapterConfig (compatible with PostgreSQL and SQLite)
    const sessionCheckCondition = isTauriMode()
      ? sql`json_extract(${bot.adapterConfig}, '$.TG_SESSION') = ${session}` // SQLite
      : sql`${bot.adapterConfig}::text = ${JSON.stringify({
          TG_SESSION: session,
        })}::text`; // PostgreSQL

    const deletedBots = await db
      .delete(bot)
      .where(sessionCheckCondition)
      .returning();

    return deletedBots;
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to delete bots with TG_SESSION: ${session}. ${error}`,
    );
  }
}

/**
 * Delete Telegram bots from the database where adapterConfig.TG_SESSION equals the given session with the right user id.
 * @param session The TG_SESSION value to match against
 */
export async function deleteTgBotBySessionAndUserId({
  session,
  userId,
}: {
  session: string;
  userId: string;
}) {
  try {
    // Check TG_SESSION field in adapterConfig (compatible with PostgreSQL and SQLite)
    const sessionCheckCondition = isTauriMode()
      ? sql`json_extract(${bot.adapterConfig}, '$.TG_SESSION') = ${session}` // SQLite
      : sql`${bot.adapterConfig}::text = ${JSON.stringify({
          TG_SESSION: session,
        })}::text`; // PostgreSQL

    const deletedBots = await db
      .delete(bot)
      .where(and(eq(bot.userId, userId), sessionCheckCondition))
      .returning();

    return deletedBots;
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to delete bots with TG_SESSION: ${session}. ${error}`,
    );
  }
}

/**
 * Disable Telegram bots in the database where adapterConfig.TG_SESSION equals the given session and matches the user id.
 * (Sets the bot's `enable` field to false)
 * @param session The TG_SESSION value to match against
 * @param userId The user id to filter bots by
 */
export async function disableTgBotBySessionAndUserId({
  session,
  userId,
}: {
  session: string;
  userId: string;
}) {
  try {
    // Check TG_SESSION field in adapterConfig (compatible with PostgreSQL and SQLite)
    const sessionCheckCondition = isTauriMode()
      ? sql`json_extract(${bot.adapterConfig}, '$.TG_SESSION') = ${session}` // SQLite
      : sql`${bot.adapterConfig}::text = ${JSON.stringify({
          TG_SESSION: session,
        })}::text`; // PostgreSQL

    const disabledBots = await db
      .update(bot)
      .set({ enable: false })
      .where(and(eq(bot.userId, userId), sessionCheckCondition))
      .returning();

    return disabledBots;
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to disable bots with TG_SESSION: ${session}. ${error}`,
    );
  }
}

/**
 * Toggle a bot's enabled status
 * @param uuid UUID of the bot
 * @param enable New enabled status
 */
export async function updateBotEnableStatus(
  uuid: string,
  enable: boolean,
): Promise<void> {
  try {
    await db
      .update(bot)
      .set({
        enable,
        updatedAt: new Date(),
      })
      .where(eq(bot.id, uuid));
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to update bot enable status for uuid: ${uuid}. ${error}`,
    );
  }
}

export async function getStoredInsightsByBotIds({
  ids,
  days = 3,
  limit,
  startingAfter,
  endingBefore,
}: {
  ids: string[];
  days?: number;
  limit?: number;
  startingAfter?: string | null;
  endingBefore?: string | null;
}): Promise<{
  insights: (typeof insight.$inferSelect)[];
  hasMore: boolean;
}> {
  try {
    if (ids.length === 0) return { insights: [], hasMore: false };

    if (startingAfter && !isValidUuid(startingAfter)) {
      return { insights: [], hasMore: false };
    }
    if (endingBefore && !isValidUuid(endingBefore)) {
      return { insights: [], hasMore: false };
    }

    const isPaginationEnabled = typeof limit === "number" && limit > 0;
    const extendedLimit = isPaginationEnabled ? limit + 1 : undefined;

    const whereConditions = [
      inArray(insight.botId, ids),
      isNull(insight.pendingDeletionAt),
    ];
    // Only apply time filter when days is explicitly specified and greater than 0
    // If days is 0 or negative, return all data
    if (days > 0) {
      const daysAgo = new Date();
      daysAgo.setTime(daysAgo.getTime() - days * 24 * 60 * 60 * 1000);
      whereConditions.push(gte(insight.time, daysAgo));
    }

    const query = (additionalWhere?: SQL<unknown>) => {
      const baseQuery = db
        .select()
        .from(insight)
        .where(
          additionalWhere
            ? and(...whereConditions, additionalWhere)
            : and(...whereConditions),
        )
        .orderBy(desc(insight.time));

      return isPaginationEnabled
        ? baseQuery.limit(extendedLimit ?? 20)
        : baseQuery;
    };

    let filteredInsights: (typeof insight.$inferSelect)[] = [];

    if (startingAfter) {
      const [selectedInsight] = await db
        .select()
        .from(insight)
        .where(eq(insight.id, startingAfter))
        .limit(1);

      if (!selectedInsight) {
        return { insights: [], hasMore: false };
      }
      filteredInsights = await query(lt(insight.time, selectedInsight.time));
    } else if (endingBefore) {
      const [selectedInsight] = await db
        .select()
        .from(insight)
        .where(eq(insight.id, endingBefore))
        .limit(1);

      if (!selectedInsight) {
        return { insights: [], hasMore: false };
      }
      filteredInsights = await query(lt(insight.time, selectedInsight.time));
    } else {
      filteredInsights = await query();
    }

    let hasMore = false;
    let insightsToReturn = filteredInsights;

    if (isPaginationEnabled) {
      const extendLimit = limit ?? 20;
      hasMore = filteredInsights.length > extendLimit;
      insightsToReturn = hasMore
        ? filteredInsights.slice(0, extendLimit)
        : filteredInsights;
    }

    // Deserialize JSON fields (SQLite mode)
    if (isTauriMode()) {
      insightsToReturn = normalizeInsightList(insightsToReturn);
    }

    return {
      insights: insightsToReturn,
      hasMore,
    };
  } catch (error) {
    console.error("Failed to get insights by bot ids:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to get insights by bot ids. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function getStoredInsightsByBotId({
  id,
  days = 3,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  days?: number;
  limit?: number;
  startingAfter?: string | null;
  endingBefore?: string | null;
}) {
  return getStoredInsightsByBotIds({
    ids: [id],
    days,
    limit,
    startingAfter,
    endingBefore,
  });
}

/**
 * Get insights by bot ID and group names (used for group-based separation processing)
 * @param id - Bot ID
 * @param groups - List of group names
 * @param days - Number of days to query (default 3 days)
 * @param limit - Limit on returned results
 * @param startingAfter - Pagination cursor: results after this time
 * @param endingBefore - Pagination cursor: results before this time
 */
export async function getStoredInsightsByBotIdAndGroups({
  id,
  groups,
  days = 3,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  groups: string[];
  days?: number;
  limit?: number;
  startingAfter?: string | null;
  endingBefore?: string | null;
}): Promise<{
  insights: (typeof insight.$inferSelect)[];
  hasMore: boolean;
}> {
  try {
    if (!id || groups.length === 0) {
      return { insights: [], hasMore: false };
    }

    if (startingAfter && !isValidUuid(startingAfter)) {
      return { insights: [], hasMore: false };
    }
    if (endingBefore && !isValidUuid(endingBefore)) {
      return { insights: [], hasMore: false };
    }

    const isPaginationEnabled = typeof limit === "number" && limit > 0;
    const extendedLimit = isPaginationEnabled ? limit + 1 : undefined;

    const whereConditions = [
      eq(insight.botId, id),
      isNull(insight.pendingDeletionAt),
    ];

    // Add group filter: insight.groups parameter groups may overlap
    // Use PostgreSQL's && operator to check array overlap
    if (groups.length > 0) {
      if (isTauriMode()) {
        // SQLite: groups stored as JSON string, use LIKE to check if any group is included
        const groupConditions = groups.map((g) =>
          like(insight.groups, `%"${g}"%`),
        );
        // @ts-ignore - Dynamic number of OR conditions
        whereConditions.push(or(...groupConditions));
      } else {
        // PostgreSQL: use array overlap operator && for safe parameterized query
        // Pass array directly to Drizzle to handle parameterization and prevent SQL injection
        // @ts-ignore - PostgreSQL-specific array operator
        whereConditions.push(sql`${insight.groups} && ${groups}`);
      }
    }

    // Only apply time filter when days is explicitly specified and greater than 0
    if (days > 0) {
      const daysAgo = new Date();
      daysAgo.setTime(daysAgo.getTime() - days * 24 * 60 * 60 * 1000);
      whereConditions.push(gte(insight.time, daysAgo));
    }

    const query = (additionalWhere?: SQL<unknown>) => {
      const baseQuery = db
        .select()
        .from(insight)
        .where(
          additionalWhere
            ? and(...whereConditions, additionalWhere)
            : and(...whereConditions),
        )
        .orderBy(desc(insight.time));

      return isPaginationEnabled
        ? baseQuery.limit(extendedLimit ?? 20)
        : baseQuery;
    };

    let filteredInsights: (typeof insight.$inferSelect)[] = [];

    if (startingAfter) {
      const [selectedInsight] = await db
        .select()
        .from(insight)
        .where(eq(insight.id, startingAfter))
        .limit(1);

      if (!selectedInsight) {
        return { insights: [], hasMore: false };
      }
      filteredInsights = await query(lt(insight.time, selectedInsight.time));
    } else if (endingBefore) {
      const [selectedInsight] = await db
        .select()
        .from(insight)
        .where(eq(insight.id, endingBefore))
        .limit(1);

      if (!selectedInsight) {
        return { insights: [], hasMore: false };
      }
      filteredInsights = await query(lt(insight.time, selectedInsight.time));
    } else {
      filteredInsights = await query();
    }

    let hasMore = false;
    let insightsToReturn = filteredInsights;

    if (isPaginationEnabled) {
      const extendLimit = limit ?? 20;
      hasMore = filteredInsights.length > extendLimit;
      insightsToReturn = hasMore
        ? filteredInsights.slice(0, extendLimit)
        : filteredInsights;
    }

    // Deserialize JSON fields (SQLite mode)
    if (isTauriMode()) {
      insightsToReturn = normalizeInsightList(insightsToReturn);
    }

    return {
      insights: insightsToReturn,
      hasMore,
    };
  } catch (error) {
    console.error("Failed to get insights by bot id and groups:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to get insights by bot id and groups. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function getInsightByIdForUser({
  userId,
  insightId,
}: {
  userId: string;
  insightId: string;
}): Promise<{ insight: Insight; bot: Bot } | null> {
  try {
    const [record] = await db
      .select({
        insight,
        bot,
      })
      .from(insight)
      .innerJoin(bot, eq(insight.botId, bot.id))
      .where(and(eq(insight.id, insightId), eq(bot.userId, userId)))
      .limit(1);

    if (!record) {
      return null;
    }

    // Deserialize JSON fields (SQLite mode)
    const insightData = isTauriMode()
      ? normalizeInsight(record.insight)
      : record.insight;

    return {
      insight: insightData,
      bot: {
        ...record.bot,
        adapterConfig: deserializeJson(record.bot.adapterConfig),
      },
    };
  } catch (error) {
    console.error("Failed to load insight by id:", error);
    throw new AppError(
      "bad_request:insight",
      `Failed to retrieve insight ${insightId}. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Batch query user's Insights by ID array
 * @param params - Object containing userId and array of Insight IDs
 * @returns Array of Insights with Bot information
 */
export async function getInsightsByIdsForUser({
  userId,
  insightIds,
}: {
  userId: string;
  insightIds: string[];
}): Promise<Array<{ insight: Insight; bot: Bot }>> {
  try {
    if (insightIds.length === 0) {
      return [];
    }

    const records = await db
      .select({
        insight,
        bot,
      })
      .from(insight)
      .innerJoin(bot, eq(insight.botId, bot.id))
      .where(and(inArray(insight.id, insightIds), eq(bot.userId, userId)));

    return records.map((record: any) => {
      // Deserialize JSON fields (SQLite mode)
      const insightData = isTauriMode()
        ? normalizeInsight(record.insight)
        : record.insight;

      return {
        insight: insightData,
        bot: {
          ...record.bot,
          adapterConfig: deserializeJson(record.bot.adapterConfig),
        },
      };
    });
  } catch (error) {
    console.error("Failed to load insights by ids:", error);
    throw new AppError(
      "bad_request:insight",
      `Failed to retrieve insights by IDs. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function updateInsightById({
  insightId,
  botId,
  payload,
}: {
  insightId: string;
  botId: string;
  payload: GeneratedInsightPayload;
}): Promise<Insight> {
  try {
    const [record] = await db
      .update(insight)
      .set({
        dedupeKey: payload.dedupeKey ?? null,
        taskLabel: payload.taskLabel,
        title: payload.title,
        description: payload.description,
        importance: payload.importance,
        urgency: payload.urgency,
        platform: payload.platform ?? null,
        account: payload.account ?? null,
        // Serialize JSON fields for SQLite compatibility
        groups: serializeField(payload.groups, { defaultEmptyArray: true }),
        people: serializeField(payload.people, { defaultEmptyArray: true }),
        time:
          payload.time instanceof Date
            ? payload.time
            : payload.time
              ? new Date(payload.time)
              : new Date(),
        details: serializeField(payload.details),
        timeline: serializeField(payload.timeline),
        insights: serializeField(payload.insights),
        trendDirection: payload.trendDirection ?? null,
        trendConfidence: payload.trendConfidence ?? null,
        sentiment: payload.sentiment ?? null,
        sentimentConfidence: payload.sentimentConfidence ?? null,
        intent: payload.intent ?? null,
        trend: serializeField(payload.trend),
        issueStatus: payload.issueStatus ?? null,
        communityTrend: payload.communityTrend ?? null,
        duplicateFlag: payload.duplicateFlag ?? null,
        impactLevel: payload.impactLevel ?? null,
        resolutionHint: payload.resolutionHint ?? null,
        topKeywords: serializeField(payload.topKeywords, {
          defaultEmptyArray: true,
        }),
        topEntities: serializeField(payload.topEntities, {
          defaultEmptyArray: true,
        }),
        topVoices: serializeField(payload.topVoices),
        sources: serializeField(payload.sources),
        sourceConcentration: payload.sourceConcentration ?? null,
        buyerSignals: serializeField(payload.buyerSignals, {
          defaultEmptyArray: true,
        }),
        stakeholders: serializeField(payload.stakeholders),
        contractStatus: payload.contractStatus ?? null,
        signalType: payload.signalType ?? null,
        confidence: payload.confidence ?? null,
        scope: serializeField(payload.scope),
        nextActions: serializeField(payload.nextActions),
        followUps: serializeField(payload.followUps),
        actionRequired: payload.actionRequired ?? null,
        actionRequiredDetails: serializeField(payload.actionRequiredDetails),
        myTasks: serializeField(payload.myTasks),
        waitingForMe: serializeField(payload.waitingForMe),
        waitingForOthers: serializeField(payload.waitingForOthers),
        clarifyNeeded: serializeField(payload.clarifyNeeded, {
          asBoolean: true,
        }),
        categories: serializeField(payload.categories, {
          defaultEmptyArray: true,
        }),
        learning: serializeField(payload.learning),
        priority: serializeField(null),
        experimentIdeas: serializeField(payload.experimentIdeas),
        executiveSummary: serializeField(payload.executiveSummary),
        riskFlags: serializeField(payload.riskFlags),
        strategic: serializeField(payload.strategic),
        client: payload.client ?? null,
        projectName: payload.projectName ?? null,
        nextMilestone: serializeField(payload.nextMilestone),
        dueDate: serializeField(payload.dueDate),
        paymentInfo: serializeField(payload.paymentInfo),
        entity: serializeField(payload.entity),
        why: serializeField(payload.why),
        historySummary: serializeField(payload.historySummary),
        roleAttribution: serializeField(payload.roleAttribution),
        alerts: serializeField(payload.alerts),
        pendingDeletionAt: null,
        compactedIntoInsightId: null,
        updatedAt: new Date(),
      })
      .where(and(eq(insight.id, insightId), eq(insight.botId, botId)))
      .returning();

    if (!record) {
      throw new AppError(
        "not_found:insight",
        `Insight ${insightId} not found or not owned by bot ${botId}`,
      );
    }
    return record;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    console.error("Failed to update insight:", error);
    throw new AppError(
      "bad_request:insight",
      `Failed to update insight. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function getLatestMessageTimestampByUserId({
  userId,
}: {
  userId: string;
}): Promise<Date | null> {
  try {
    const [record] = await db
      .select({ lastMessageAt: max(message.createdAt) })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(eq(chat.userId, userId));

    return record?.lastMessageAt ?? null;
  } catch (error) {
    console.error("Failed to get latest message timestamp:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to get latest message timestamp. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Delete summaries by ID array
 * @param params - Object containing array of summary IDs to delete
 */
export async function deleteInsightsByIds({ ids }: { ids: string[] }) {
  try {
    // Use transaction to ensure operation atomicity
    await executeTransaction(async (tx) => {
      // Only execute delete when ID array is non-empty
      if (ids.length > 0) {
        // Execute delete: delete all summaries with IDs in the specified array
        await tx
          .delete(insight)
          .where(inArray(insight.id, ids)) // Use inArray condition to match multiple IDs
          .execute();

        console.info(
          `[Insight] Successfully deleted ${ids.length} insights by IDs`,
        );
      }
    });
  } catch (error) {
    console.error("Failed to delete insights by IDs:", error);
    throw new AppError(
      "bad_request:insight",
      `Failed to delete insights by IDs. ${error}`,
    );
  }
}

export async function deleteInsightsByTitles({ titles }: { titles: string[] }) {
  try {
    await executeTransaction(async (tx) => {
      if (titles.length > 0) {
        const result = await tx
          .delete(insight)
          .where(inArray(insight.title, titles))
          .execute();

        console.info(
          `[Insight] Attempted to delete ${titles.length} insights by titles, successfully deleted ${result.count}`,
        );
      }
    });
  } catch (error) {
    console.error("Failed to delete insights by titles:", error);
    throw new AppError(
      "bad_request:insight",
      `Failed to delete insights by titles. ${error}`,
    );
  }
}

export async function appendInsightsByBotId({
  id,
  insights: insightPayloads,
}: {
  id: string;
  insights: GeneratedInsightPayload[];
}): Promise<string[]> {
  // Explicitly return ID array
  try {
    return await executeTransaction(async (tx) => {
      if (insightPayloads.length === 0) {
        return []; // Return empty array when no data
      }

      const formattedSummaries = [];
      for (const item of insightPayloads) {
        // Validate required fields
        if (
          item.taskLabel &&
          item.title &&
          item.description &&
          item.importance &&
          item.urgency
        ) {
          formattedSummaries.push({
            botId: id,
            taskLabel: item.taskLabel,
            title: item.title,
            description: item.description,
            importance: item.importance,
            urgency: item.urgency,
            dedupeKey: item.dedupeKey ?? null,
            groups: serializeJson(item.groups ?? []),
            people: serializeJson(item.people ?? []),
            platform: item.platform ?? null,
            account: item.account ?? null,
            time:
              item.time instanceof Date
                ? item.time
                : item.time
                  ? new Date(item.time)
                  : new Date(),
            details: serializeJson(item.details),
            timeline: serializeJson(item.timeline),
            insights: serializeJson(item.insights),
            trendDirection: item.trendDirection ?? null,
            trendConfidence: item.trendConfidence ?? null,
            sentiment: item.sentiment ?? null,
            sentimentConfidence: item.sentimentConfidence ?? null,
            intent: item.intent ?? null,
            trend: serializeJson(item.trend),
            issueStatus: item.issueStatus ?? null,
            communityTrend: item.communityTrend ?? null,
            duplicateFlag: item.duplicateFlag ?? null,
            impactLevel: item.impactLevel ?? null,
            resolutionHint: item.resolutionHint ?? null,
            topKeywords: serializeJson(item.topKeywords ?? []),
            topEntities: serializeJson(item.topEntities ?? []),
            topVoices: serializeJson(item.topVoices),
            sources: serializeJson(item.sources),
            sourceConcentration: item.sourceConcentration ?? null,
            buyerSignals: serializeJson(item.buyerSignals ?? []),
            stakeholders: serializeJson(item.stakeholders),
            contractStatus: item.contractStatus ?? null,
            signalType: item.signalType ?? null,
            confidence: item.confidence ?? null,
            scope: serializeJson(item.scope),
            nextActions: serializeJson(item.nextActions),
            followUps: serializeJson(item.followUps),
            actionRequired: item.actionRequired ?? null,
            actionRequiredDetails: serializeJson(item.actionRequiredDetails),
            myTasks: serializeJson(item.myTasks),
            waitingForMe: serializeJson(item.waitingForMe),
            waitingForOthers: serializeJson(item.waitingForOthers),
            clarifyNeeded: serializeJson(item.clarifyNeeded),
            categories: serializeJson(item.categories ?? []),
            learning: serializeJson(item.learning),
            priority: serializeJson(null),
            experimentIdeas: serializeJson(item.experimentIdeas),
            executiveSummary: serializeJson(item.executiveSummary),
            riskFlags: serializeJson(item.riskFlags),
            strategic: serializeJson(item.strategic),
            client: item.client ?? null,
            projectName: item.projectName ?? null,
            nextMilestone: serializeJson(item.nextMilestone),
            dueDate: serializeJson(item.dueDate),
            paymentInfo: serializeJson(item.paymentInfo),
            entity: serializeJson(item.entity),
            why: serializeJson(item.why),
            historySummary: serializeJson(item.historySummary),
            roleAttribution: serializeJson(item.roleAttribution),
            alerts: serializeJson(item.alerts),
          });
        }
      }

      if (formattedSummaries.length === 0) {
        return []; // Return empty array when no valid data
      }

      // Execute insert and return record containing ID
      const result = await tx
        .insert(insight)
        .values(formattedSummaries)
        .returning({ id: insight.id }); // Specify to return ID field

      await revivePendingDeletionInsightsForBot({
        tx,
        botId: id,
        candidates: insightPayloads,
      });
      return result.map((item: any) => item.id);
    });
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:insight",
      `Failed to save insights by the bot id. ${error}`,
    );
  }
}

/**
 * Find and migrate old insight related data to new insight
 *
 * When dedupeKey changes cause an insight ID change, this function will:
 * 1. Find similar old insights (by title, group, etc.)
 * 2. Migrate old insight's notes and documents to new insight
 * 3. Return old insight ID (if any)
 */
async function findAndMigrateOldInsightData({
  tx,
  botId,
  newInsightId,
  newTitle,
  newDedupeKey,
  newGroups,
  migratedInsightIds,
}: {
  tx: any;
  botId: string;
  newInsightId: string;
  newTitle: string;
  newDedupeKey: string | null;
  newGroups: string[];
  migratedInsightIds: Set<string>;
}): Promise<string | null> {
  // If new insight has no dedupeKey or groups, cannot match
  if (!newDedupeKey || !newGroups || newGroups.length === 0) {
    return null;
  }

  // Find similar old insights under the same bot
  // Exclude already migrated insights and current new insight
  const oldInsights = await tx
    .select({
      id: insight.id,
      title: insight.title,
      dedupeKey: insight.dedupeKey,
      groups: insight.groups,
    })
    .from(insight)
    .where(
      and(
        eq(insight.botId, botId),
        ne(insight.id, newInsightId),
        // Exclude already migrated insights
        sql`${insight.id} NOT IN ${Array.from(migratedInsightIds)}`,
      ),
    );

  let bestMatchId: string | null = null;
  let bestSimilarity = 0;

  for (const oldInsight of oldInsights) {
    // Skip identical insights (should not happen theoretically, but defensive check)
    if (oldInsight.id === newInsightId) {
      continue;
    }

    // If dedupeKey is the same, skip (should have been handled in upsert logic)
    if (oldInsight.dedupeKey === newDedupeKey) {
      continue;
    }

    let similarity = 0;

    // 1. Check group intersection (high weight)
    const oldGroups = deserializeJson(oldInsight.groups ?? "[]") as string[];
    const intersection = oldGroups.filter((g: string) => newGroups.includes(g));
    if (intersection.length > 0) {
      similarity += 0.3; // Add 30% for shared groups

      // Extra weight for identical groups
      if (
        intersection.length === oldGroups.length &&
        intersection.length === newGroups.length
      ) {
        similarity += 0.2;
      }
    }

    // 2. Check title similarity (medium weight)
    const titleSim = calculateSimilarity(oldInsight.title, newTitle);
    if (titleSim > 0.7) {
      similarity += 0.5 * titleSim;
    }

    // 3. Check dedupeKey similarity (low weight)
    if (oldInsight.dedupeKey && newDedupeKey) {
      const dedupeSim = calculateSimilarity(oldInsight.dedupeKey, newDedupeKey);
      if (dedupeSim > 0.5) {
        similarity += 0.2 * dedupeSim;
      }
    }

    // Need at least 0.6 similarity to consider a match
    if (similarity > 0.6 && similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatchId = oldInsight.id;
    }
  }

  if (!bestMatchId) {
    return null;
  }

  // Check if old insight has associated data
  const [notesCount] = await tx
    .select({ count: sql<number>`count(*)` })
    .from(insightNotes)
    .where(eq(insightNotes.insightId, bestMatchId));
  const notesCountValue = notesCount?.count ?? 0;

  const [docsCount] = await tx
    .select({ count: sql<number>`count(*)` })
    .from(insightDocuments)
    .where(eq(insightDocuments.insightId, bestMatchId));
  const docsCountValue = docsCount?.count ?? 0;

  // Only migrate when there is associated data
  if (notesCountValue === 0 && docsCountValue === 0) {
    console.log(
      `[upsertInsightsByBotId] Old insight ${bestMatchId} has no associated data, skipping migration`,
    );
    return null;
  }

  // Migrate notes
  if (notesCountValue > 0) {
    await tx
      .update(insightNotes)
      .set({ insightId: newInsightId, updatedAt: new Date() })
      .where(eq(insightNotes.insightId, bestMatchId));

    console.log(
      `[upsertInsightsByBotId] Migrated ${notesCountValue} notes from ${bestMatchId} to ${newInsightId}`,
    );
  }

  // Migrate documents
  if (docsCountValue > 0) {
    await tx
      .update(insightDocuments)
      .set({ insightId: newInsightId })
      .where(eq(insightDocuments.insightId, bestMatchId));

    console.log(
      `[upsertInsightsByBotId] Migrated ${docsCountValue} documents from ${bestMatchId} to ${newInsightId}`,
    );
  }

  return bestMatchId;
}

/**
 * Calculate similarity between two strings (used for identifying similar insights)
 */
function calculateSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) return 1.0;

  const editDistance = (s1: string, s2: string): number => {
    const matrix: number[][] = [];
    for (let i = 0; i <= s2.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= s1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= s2.length; i++) {
      for (let j = 1; j <= s1.length; j++) {
        if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1, // deletion
          );
        }
      }
    }

    return matrix[s2.length][s1.length];
  };

  return (longer.length - editDistance(longer, shorter)) / longer.length;
}

type InsightRevivalCandidate = {
  dedupeKey?: string | null;
  title?: string | null;
  projectName?: string | null;
  client?: string | null;
  account?: string | null;
  signalType?: string | null;
};

function normalizeInsightRevivalPart(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : null;
}

// Build several lightweight lookup keys so a resurfaced insight can clear its pending-deletion state even if only part of the context matches.
function buildInsightRevivalKeys(candidate: InsightRevivalCandidate) {
  const keys = new Set<string>();
  const dedupeKey = normalizeInsightRevivalPart(candidate.dedupeKey);
  const title = normalizeInsightRevivalPart(candidate.title);
  const projectName = normalizeInsightRevivalPart(candidate.projectName);
  const client = normalizeInsightRevivalPart(candidate.client);
  const account = normalizeInsightRevivalPart(candidate.account);

  if (dedupeKey) keys.add(`dedupe:${dedupeKey}`);
  if (title) keys.add(`title:${title}`);
  if (title && projectName) keys.add(`title-project:${title}|${projectName}`);
  if (title && client) keys.add(`title-client:${title}|${client}`);
  if (title && account) keys.add(`title-account:${title}|${account}`);

  return keys;
}

// If a user brings an old topic back, revive the matching pending-deletion insights instead of treating them as forgotten forever.
async function revivePendingDeletionInsightsForBot({
  tx,
  botId,
  candidates,
}: {
  tx: any;
  botId: string;
  candidates: InsightRevivalCandidate[];
}) {
  const liveCandidates = candidates.filter(
    (candidate) => candidate.signalType !== "compaction_digest",
  );

  if (liveCandidates.length === 0) {
    return [] as string[];
  }

  const incomingKeys = new Set<string>();
  for (const candidate of liveCandidates) {
    for (const key of buildInsightRevivalKeys(candidate)) {
      incomingKeys.add(key);
    }
  }

  if (incomingKeys.size === 0) {
    return [] as string[];
  }

  const pendingInsights = await tx
    .select({
      id: insight.id,
      dedupeKey: insight.dedupeKey,
      title: insight.title,
      projectName: insight.projectName,
      client: insight.client,
      account: insight.account,
    })
    .from(insight)
    .where(and(eq(insight.botId, botId), isNotNull(insight.pendingDeletionAt)));

  const revivedIds = pendingInsights
    .filter((pending: any) => {
      for (const key of buildInsightRevivalKeys(pending)) {
        if (incomingKeys.has(key)) {
          return true;
        }
      }
      return false;
    })
    .map((pending: any) => pending.id);

  if (revivedIds.length === 0) {
    return [] as string[];
  }

  await tx
    .update(insight)
    .set({
      pendingDeletionAt: null,
      compactedIntoInsightId: null,
      updatedAt: new Date(),
    })
    .where(inArray(insight.id, revivedIds));

  return revivedIds;
}
/**
 * Merge existing and incoming timeline events server-side.
 * Deduplicates by event ID first, then adds existing events not in incoming.
 * This ensures historical timeline events are never lost due to incomplete
 * model output — even if the model only outputs the latest event, older
 * events from the existing timeline are preserved.
 */
function mergeTimelinesServerSide(
  existing: TimelineData[],
  incoming: TimelineData[],
): TimelineData[] {
  const merged = new Map<string, TimelineData>();

  // Add incoming events first (they take precedence for ID matching)
  for (const event of incoming) {
    const id =
      event.id ?? `${event.time ?? ""}-${(event.summary ?? "").slice(0, 50)}`;
    merged.set(id, event);
  }

  // Add existing events not already in incoming
  for (const event of existing) {
    const id =
      event.id ?? `${event.time ?? ""}-${(event.summary ?? "").slice(0, 50)}`;
    if (!merged.has(id)) {
      merged.set(id, event);
    }
  }

  // Sort by time (oldest first)
  return Array.from(merged.values()).sort(
    (a, b) => (a.time ?? 0) - (b.time ?? 0),
  );
}

/**
 * Upsert insights by bot ID - update existing insights or insert new ones
 * Preserves insight IDs when updating based on dedupeKey matching
 * When inserting a new insight, migrates associated data (notes, documents) from similar old insights
 */
export async function upsertInsightsByBotId({
  id,
  insights: insightPayloads,
}: {
  id: string;
  insights: GeneratedInsightPayload[];
}): Promise<string[]> {
  try {
    return await executeTransaction(async (tx) => {
      if (insightPayloads.length === 0) {
        return [];
      }

      const resultIds: string[] = [];

      // Track migrated insights to avoid duplicate migration
      const migratedInsightIds = new Set<string>();

      for (const item of insightPayloads) {
        // Validate required fields
        if (
          !item.taskLabel ||
          !item.title ||
          !item.description ||
          !item.importance ||
          !item.urgency
        ) {
          continue;
        }

        // Check if an insight with the same dedupeKey exists
        let existingInsight: any = null;

        if (item.dedupeKey) {
          const existing = await tx
            .select({
              id: insight.id,
              categories: insight.categories,
              isFavorited: insight.isFavorited,
              favoritedAt: insight.favoritedAt,
              isArchived: insight.isArchived,
              timeline: insight.timeline,
              // Task fields - user may have completed tasks, need to preserve during refresh
              myTasks: insight.myTasks,
              waitingForMe: insight.waitingForMe,
              waitingForOthers: insight.waitingForOthers,
            })
            .from(insight)
            .where(
              and(eq(insight.botId, id), eq(insight.dedupeKey, item.dedupeKey)),
            )
            .limit(1);

          if (existing.length > 0) {
            existingInsight = existing[0];
          }
        }

        // Prepare insight data
        // Serialize all array and object fields (required in SQLite mode)
        const insightData: any = {
          botId: id,
          taskLabel: item.taskLabel,
          title: item.title,
          description: item.description,
          importance: item.importance,
          urgency: item.urgency,
          dedupeKey: item.dedupeKey ?? null,
          groups: serializeJson(item.groups ?? []),
          people: serializeJson(item.people ?? []),
          platform: item.platform ?? null,
          account: item.account ?? null,
          time:
            item.time instanceof Date
              ? item.time
              : item.time
                ? new Date(item.time)
                : new Date(),
          details: serializeJson(item.details),
          timeline: serializeJson(item.timeline),
          insights: serializeJson(item.insights),
          trendDirection: item.trendDirection ?? null,
          trendConfidence: item.trendConfidence ?? null,
          sentiment: item.sentiment ?? null,
          sentimentConfidence: item.sentimentConfidence ?? null,
          intent: item.intent ?? null,
          trend: serializeJson(item.trend),
          issueStatus: item.issueStatus ?? null,
          communityTrend: item.communityTrend ?? null,
          duplicateFlag: item.duplicateFlag ?? null,
          impactLevel: item.impactLevel ?? null,
          resolutionHint: item.resolutionHint ?? null,
          topKeywords: serializeJson(item.topKeywords ?? []),
          topEntities: serializeJson(item.topEntities ?? []),
          topVoices: serializeJson(item.topVoices),
          sources: serializeJson(item.sources),
          sourceConcentration: item.sourceConcentration ?? null,
          buyerSignals: serializeJson(item.buyerSignals ?? []),
          stakeholders: serializeJson(item.stakeholders),
          contractStatus: item.contractStatus ?? null,
          signalType: item.signalType ?? null,
          confidence: item.confidence ?? null,
          scope: serializeJson(item.scope),
          nextActions: serializeJson(item.nextActions),
          followUps: serializeJson(item.followUps),
          actionRequired: item.actionRequired ?? null,
          actionRequiredDetails: serializeJson(item.actionRequiredDetails),
          myTasks: serializeJson(item.myTasks),
          waitingForMe: serializeJson(item.waitingForMe),
          waitingForOthers: serializeJson(item.waitingForOthers),
          clarifyNeeded: serializeJson(item.clarifyNeeded),
          categories: serializeJson(item.categories ?? []),
          learning: serializeJson(item.learning),
          priority: serializeJson(null),
          experimentIdeas: serializeJson(item.experimentIdeas),
          executiveSummary: serializeJson(item.executiveSummary),
          riskFlags: serializeJson(item.riskFlags),
          strategic: serializeJson(item.strategic),
          client: item.client ?? null,
          projectName: item.projectName ?? null,
          nextMilestone: serializeJson(item.nextMilestone),
          dueDate: serializeJson(item.dueDate),
          paymentInfo: serializeJson(item.paymentInfo),
          entity: serializeJson(item.entity),
          why: serializeJson(item.why),
          historySummary: serializeJson(item.historySummary),
          roleAttribution: serializeJson(item.roleAttribution),
          alerts: serializeJson(item.alerts),
        };

        // If exists and has dedupeKey, update; otherwise insert
        if (existingInsight) {
          // Check for document associations (for tracking attachment loss issues)
          const existingDocs = await tx
            .select({ count: sql<number>`count(*)` })
            .from(insightDocuments)
            .where(eq(insightDocuments.insightId, existingInsight.id));
          const docCount = existingDocs[0]?.count ?? 0;

          console.log(
            `[upsertInsightsByBotId] Updating existing insight: id=${existingInsight.id}, dedupeKey=${item.dedupeKey}, title="${item.title}", docCount=${docCount}`,
          );

          const updateData = {
            ...insightData,
            // Preserve user status fields
            categories: existingInsight.categories,
            isFavorited: existingInsight.isFavorited,
            favoritedAt: existingInsight.favoritedAt,
            isArchived: existingInsight.isArchived,
            pendingDeletionAt: null,
            compactedIntoInsightId: null,
            updatedAt: new Date(),
          };

          // Server-side timeline merge: always merge existing + incoming to avoid
          // losing historical events when the model outputs an incomplete timeline.
          // This is critical because the model's output depends on prompt parsing
          // and can occasionally produce only the latest event instead of the full
          // merged history.
          const existingTimeline = existingInsight.timeline ?? [];
          const incomingTimeline = (item.timeline ?? []) as TimelineData[];
          const mergedTimeline = mergeTimelinesServerSide(
            existingTimeline,
            incomingTimeline,
          );
          updateData.timeline = serializeJson(mergedTimeline);

          // Task fields - user may have completed tasks, need to preserve during refresh
          // If new data has no task data (or empty array), preserve existing
          const shouldPreserveMyTasks =
            !item.myTasks ||
            (Array.isArray(item.myTasks) && item.myTasks.length === 0);
          const shouldPreserveWaitingForMe =
            !item.waitingForMe ||
            (Array.isArray(item.waitingForMe) &&
              item.waitingForMe.length === 0);
          const shouldPreserveWaitingForOthers =
            !item.waitingForOthers ||
            (Array.isArray(item.waitingForOthers) &&
              item.waitingForOthers.length === 0);

          if (shouldPreserveMyTasks && existingInsight.myTasks != null) {
            updateData.myTasks = existingInsight.myTasks;
          }
          if (
            shouldPreserveWaitingForMe &&
            existingInsight.waitingForMe != null
          ) {
            updateData.waitingForMe = existingInsight.waitingForMe;
          }
          if (
            shouldPreserveWaitingForOthers &&
            existingInsight.waitingForOthers != null
          ) {
            updateData.waitingForOthers = existingInsight.waitingForOthers;
          }

          await tx
            .update(insight)
            .set(updateData)
            .where(eq(insight.id, existingInsight.id));
          resultIds.push(existingInsight.id);
        } else {
          // For new insights with dedupeKey, use deterministic ID based on botId + dedupeKey
          // This ensures ONE insight ID per group/chat
          const deterministicId =
            item.dedupeKey && id
              ? generateInsightId(id, item.dedupeKey)
              : undefined;

          const insertData = deterministicId
            ? { ...insightData, id: deterministicId }
            : insightData;

          const result = await tx
            .insert(insight)
            .values(insertData)
            .returning({ id: insight.id });
          const newInsightId = result[0].id;

          console.log(
            `[upsertInsightsByBotId] Inserting new insight: id=${newInsightId}, dedupeKey=${item.dedupeKey}, title="${item.title}", botId=${id}`,
          );

          // Attempt to migrate associated data from old similar insights (notes, documents)
          // When dedupeKey changes, this preserves user-added data
          if (!migratedInsightIds.has(newInsightId)) {
            const oldInsightId = await findAndMigrateOldInsightData({
              tx,
              botId: id,
              newInsightId,
              newTitle: item.title,
              newDedupeKey: item.dedupeKey ?? null,
              newGroups: item.groups ?? [],
              migratedInsightIds,
            });
            if (oldInsightId) {
              console.log(
                `[upsertInsightsByBotId] Migrated data from old insight ${oldInsightId} to new insight ${newInsightId}`,
              );
              migratedInsightIds.add(oldInsightId);
            }
          }

          resultIds.push(newInsightId);
        }
      }

      await revivePendingDeletionInsightsForBot({
        tx,
        botId: id,
        candidates: insightPayloads,
      });

      return resultIds;
    });
  } catch (error) {
    console.error(error);
    throw new AppError(
      "bad_request:insight",
      `Failed to upsert insights by bot id. ${error}`,
    );
  }
}

/**
 * Update status of a specified task in an Insight (operates on myTasks/waitingForMe/waitingForOthers fields)
 * @param params - Object containing insightId, userId, taskId, bucket, isCompleted
 */
export async function updateInsightEmbeddedTaskStatus({
  insightId,
  userId,
  taskId,
  bucket,
  isCompleted,
}: {
  insightId: string;
  userId: string;
  taskId: string;
  bucket: "myTasks" | "waitingForMe" | "waitingForOthers";
  isCompleted: boolean;
}) {
  try {
    // Use transaction to ensure operation atomicity (referencing your deleteInsightsByIds implementation)
    return await executeTransaction(async (tx) => {
      // 1. Query target Insight (also verify ownership: linked to user via botId, assuming your bot table has userId field)
      const [targetInsight] = await tx
        .select({
          id: insight.id,
          botId: insight.botId,
          myTasks: insight.myTasks,
          waitingForMe: insight.waitingForMe,
          waitingForOthers: insight.waitingForOthers,
        })
        .from(insight)
        .where(eq(insight.id, insightId))
        .execute();

      if (!targetInsight) {
        throw new Error(`Insight ${insightId} not found`);
      }

      // Parse JSON string to array for SQLite
      let currentTasks = deserializeJson(
        (targetInsight[bucket] as InsightTaskItem[] | null | undefined) ?? [],
      );

      if (!Array.isArray(currentTasks) || currentTasks.length === 0) {
        throw new Error(
          `No tasks found in bucket ${bucket} for insight ${insightId}. ` +
            `currentTasks is: ${JSON.stringify(currentTasks)}`,
        );
      }

      // Extract info from taskId for matching (format: insightId|bucket|index|title|contextLength)
      const taskIdParts = taskId.split("|");
      const taskIndexFromId =
        taskIdParts.length >= 3 ? Number.parseInt(taskIdParts[2], 10) : null;
      const taskTitleFromId = taskIdParts.length >= 4 ? taskIdParts[3] : null;
      const taskContextLengthFromId =
        taskIdParts.length >= 5 ? Number.parseInt(taskIdParts[4], 10) : null;

      console.log(
        `[updateInsightEmbeddedTaskStatus] TaskId info: index=${taskIndexFromId}, title="${taskTitleFromId}", contextLength=${taskContextLengthFromId}`,
      );

      // 4. Find task to update (prefer match by task.id, fall back to storageKey)
      // First, try to find in current bucket using exact taskId match
      let taskIndex = currentTasks.findIndex((task) => {
        // storageKey format: insight.id|bucket|index|titleKey|contextKey.length (generated by frontend buildTasks function)
        const taskStorageKey =
          task.id ??
          `${insightId}|${bucket}|${currentTasks.indexOf(task)}|${(task.title ?? "").toLowerCase().slice(0, 64)}|${(task.context ?? "").slice(0, 96).length}`;
        return taskStorageKey === taskId || task.id === taskId;
      });

      console.log(
        `[updateInsightEmbeddedTaskStatus] First attempt - taskIndex in current bucket: ${taskIndex}`,
      );

      // If not found with exact match, search all buckets using fuzzy matching
      // This handles cases where title was modified
      if (taskIndex === -1) {
        console.log(
          `[updateInsightEmbeddedTaskStatus] Exact match failed, searching all buckets with fuzzy matching...`,
        );
        const allBuckets = [
          "myTasks",
          "waitingForMe",
          "waitingForOthers",
        ] as const;
        for (const searchBucket of allBuckets) {
          const bucketTasks = deserializeJson(
            (targetInsight[searchBucket] as
              | InsightTaskItem[]
              | null
              | undefined) ?? [],
          );
          if (!Array.isArray(bucketTasks) || bucketTasks.length === 0) continue;

          console.log(
            `[updateInsightEmbeddedTaskStatus] Searching bucket "${searchBucket}" with ${bucketTasks.length} tasks`,
          );

          const foundIndex = bucketTasks.findIndex((task, idx) => {
            const contextLength = (task.context ?? "").length;
            const taskTitleKey = (task.title ?? "").toLowerCase().slice(0, 64);

            console.log(
              `[updateInsightEmbeddedTaskStatus] Checking task at index ${idx}: title="${task.title}", contextLength=${contextLength}`,
            );

            // Try multiple matching strategies, in order of reliability:
            // 1. Match by exact position (index) and context length
            if (taskIndexFromId !== null && taskContextLengthFromId !== null) {
              if (
                idx === taskIndexFromId &&
                contextLength === taskContextLengthFromId
              ) {
                console.log(
                  `[updateInsightEmbeddedTaskStatus] Matched by index and contextLength`,
                );
                return true;
              }
            }
            // 2. Match by index only (if contextLength is 0, use index as primary)
            if (taskIndexFromId !== null && idx === taskIndexFromId) {
              console.log(
                `[updateInsightEmbeddedTaskStatus] Matched by index only`,
              );
              return true;
            }
            // 3. Match by title (for backwards compatibility)
            if (taskTitleFromId && taskTitleKey === taskTitleFromId) {
              console.log(`[updateInsightEmbeddedTaskStatus] Matched by title`);
              return true;
            }
            return false;
          });

          if (foundIndex !== -1) {
            // Found the task in another bucket, update the bucket parameter
            taskIndex = foundIndex;
            bucket = searchBucket;
            // Update currentTasks to point to the found bucket's tasks
            (currentTasks as any) = bucketTasks;
            console.log(
              `[updateInsightEmbeddedTaskStatus] Found task in bucket: ${searchBucket}, updating bucket parameter`,
            );
            break;
          }
        }
      }

      if (taskIndex === -1) {
        throw new Error(
          `Task ${taskId} not found in any bucket for insight ${insightId}`,
        );
      }

      const updatedTasks = [...currentTasks];
      const targetTask = updatedTasks[taskIndex];

      updatedTasks[taskIndex] = {
        ...targetTask,
        status: isCompleted
          ? ("completed" as InsightTaskStatus)
          : ("pending" as InsightTaskStatus),
      };

      // 6. Save updated Insight
      await tx
        .update(insight)
        .set({
          [bucket]: serializeJson(updatedTasks),
          updatedAt: new Date(),
        })
        .where(eq(insight.id, insightId))
        .execute();

      console.info(
        `[Insight] Updated task ${taskId} (insight: ${insightId}, bucket: ${bucket}) to status ${isCompleted ? "completed" : "pending"}`,
      );

      return {
        success: true,
        insightId,
        taskId,
        bucket,
        status: updatedTasks[taskIndex].status,
      };
    });
  } catch (error) {
    console.error(
      `[Insight] Failed to update embedded task ${taskId} (insight: ${insightId}, bucket: ${bucket}):`,
      error,
    );
    throw new AppError(
      "bad_request:insight",
      `Failed to update insight task status. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Update context of a specified task in an Insight
 * @param params - Object containing insightId, userId, taskId, bucket, context
 */
export async function updateInsightTaskContext({
  insightId,
  userId,
  taskId,
  bucket,
  context,
}: {
  insightId: string;
  userId: string;
  taskId: string;
  bucket: "myTasks" | "waitingForMe" | "waitingForOthers";
  context: string;
}) {
  try {
    return await executeTransaction(async (tx) => {
      const [targetInsight] = await tx
        .select({
          id: insight.id,
          botId: insight.botId,
          myTasks: insight.myTasks,
          waitingForMe: insight.waitingForMe,
          waitingForOthers: insight.waitingForOthers,
        })
        .from(insight)
        .where(eq(insight.id, insightId))
        .execute();

      if (!targetInsight) {
        throw new Error(`Insight ${insightId} not found`);
      }

      // Parse JSON string to array for SQLite
      let currentTasks = deserializeJson(
        (targetInsight[bucket] as InsightTaskItem[] | null | undefined) ?? [],
      );
      if (!Array.isArray(currentTasks) || currentTasks.length === 0) {
        throw new Error(
          `No tasks found in bucket ${bucket} for insight ${insightId}`,
        );
      }

      // Extract info from taskId for matching (format: insightId|bucket|index|title|contextLength)
      const taskIdParts = taskId.split("|");
      const taskIndexFromId =
        taskIdParts.length >= 3 ? Number.parseInt(taskIdParts[2], 10) : null;
      const taskTitleFromId = taskIdParts.length >= 4 ? taskIdParts[3] : null;
      const taskContextLengthFromId =
        taskIdParts.length >= 5 ? Number.parseInt(taskIdParts[4], 10) : null;

      console.log(
        `[updateInsightTaskContext] TaskId info: index=${taskIndexFromId}, title="${taskTitleFromId}", contextLength=${taskContextLengthFromId}`,
      );

      // First, try to find in current bucket using exact taskId match
      let taskIndex = currentTasks.findIndex((task) => {
        const taskStorageKey =
          task.id ??
          `${insightId}|${bucket}|${currentTasks.indexOf(task)}|${(task.title ?? "").toLowerCase().slice(0, 64)}|${(task.context ?? "").slice(0, 96).length}`;
        return taskStorageKey === taskId || task.id === taskId;
      });

      console.log(
        `[updateInsightTaskContext] First attempt - taskIndex in current bucket: ${taskIndex}`,
      );

      // If not found with exact match, search all buckets using fuzzy matching
      // This handles cases where title was modified
      if (taskIndex === -1) {
        console.log(
          `[updateInsightTaskContext] Exact match failed, searching all buckets with fuzzy matching...`,
        );
        const allBuckets = [
          "myTasks",
          "waitingForMe",
          "waitingForOthers",
        ] as const;
        for (const searchBucket of allBuckets) {
          const bucketTasks = deserializeJson(
            (targetInsight[searchBucket] as
              | InsightTaskItem[]
              | null
              | undefined) ?? [],
          );
          if (!Array.isArray(bucketTasks) || bucketTasks.length === 0) continue;

          console.log(
            `[updateInsightTaskContext] Searching bucket "${searchBucket}" with ${bucketTasks.length} tasks`,
          );

          const foundIndex = bucketTasks.findIndex((task, idx) => {
            const contextLength = (task.context ?? "").length;
            const taskTitleKey = (task.title ?? "").toLowerCase().slice(0, 64);

            console.log(
              `[updateInsightTaskContext] Checking task at index ${idx}: title="${task.title}", contextLength=${contextLength}`,
            );

            // Try multiple matching strategies, in order of reliability:
            // 1. Match by exact position (index) and context length
            if (taskIndexFromId !== null && taskContextLengthFromId !== null) {
              if (
                idx === taskIndexFromId &&
                contextLength === taskContextLengthFromId
              ) {
                console.log(
                  `[updateInsightTaskContext] Matched by index and contextLength`,
                );
                return true;
              }
            }
            // 2. Match by index only (if contextLength is 0, use index as primary)
            if (taskIndexFromId !== null && idx === taskIndexFromId) {
              console.log(`[updateInsightTaskContext] Matched by index only`);
              return true;
            }
            // 3. Match by title (for backwards compatibility)
            if (taskTitleFromId && taskTitleKey === taskTitleFromId) {
              console.log(`[updateInsightTaskContext] Matched by title`);
              return true;
            }
            return false;
          });

          if (foundIndex !== -1) {
            // Found the task in another bucket, update the bucket parameter
            taskIndex = foundIndex;
            bucket = searchBucket;
            // Update currentTasks to point to the found bucket's tasks
            (currentTasks as any) = bucketTasks;
            console.log(
              `[updateInsightTaskContext] Found task in bucket: ${searchBucket}, updating bucket parameter`,
            );
            break;
          }
        }
      }

      if (taskIndex === -1) {
        throw new Error(
          `Task ${taskId} not found in any bucket for insight ${insightId}`,
        );
      }

      const updatedTasks = [...currentTasks];
      updatedTasks[taskIndex] = {
        ...updatedTasks[taskIndex],
        context,
      };

      await tx
        .update(insight)
        .set({
          [bucket]: serializeJson(updatedTasks),
          updatedAt: new Date(),
        })
        .where(eq(insight.id, insightId))
        .execute();

      console.info(
        `[Insight] Updated task ${taskId} context (insight: ${insightId}, bucket: ${bucket})`,
      );

      return {
        success: true,
        insightId,
        taskId,
        bucket,
        context,
      };
    });
  } catch (error) {
    console.error(
      `[Insight] Failed to update task ${taskId} context (insight: ${insightId}, bucket: ${bucket}):`,
      error,
    );
    throw new AppError(
      "bad_request:insight",
      `Failed to update insight task context. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Update all fields of a specified task in an Insight (title, context, deadline, owner, bucket)
 * @param params - Object containing insightId, userId, taskId, bucket, updates
 */
export async function updateInsightTask({
  insightId,
  userId,
  taskId,
  bucket,
  updates,
}: {
  insightId: string;
  userId: string;
  taskId: string;
  bucket: "myTasks" | "waitingForMe" | "waitingForOthers";
  updates: {
    title?: string;
    context?: string;
    deadline?: string | null;
    owner?: string | null;
    requester?: string | null;
    newBucket?: "myTasks" | "waitingForMe" | "waitingForOthers";
    priority?: string | null;
  };
}) {
  try {
    return await executeTransaction(async (tx) => {
      const [targetInsight] = await tx
        .select({
          id: insight.id,
          botId: insight.botId,
          myTasks: insight.myTasks,
          waitingForMe: insight.waitingForMe,
          waitingForOthers: insight.waitingForOthers,
        })
        .from(insight)
        .where(eq(insight.id, insightId))
        .execute();

      if (!targetInsight) {
        throw new Error(`Insight ${insightId} not found`);
      }

      // Parse JSON string to array for SQLite
      let currentTasks = deserializeJson(
        (targetInsight[bucket] as InsightTaskItem[] | null | undefined) ?? [],
      );
      if (!Array.isArray(currentTasks) || currentTasks.length === 0) {
        throw new Error(
          `No tasks found in bucket ${bucket} for insight ${insightId}. ` +
            `currentTasks is: ${JSON.stringify(currentTasks)}, ` +
            `targetInsight[${bucket}] is: ${JSON.stringify(targetInsight[bucket])}`,
        );
      }

      // Extract info from taskId for matching (format: insightId|bucket|index|title|contextLength)
      const taskIdParts = taskId.split("|");
      const taskIndexFromId =
        taskIdParts.length >= 3 ? Number.parseInt(taskIdParts[2], 10) : null;
      const taskTitleFromId = taskIdParts.length >= 4 ? taskIdParts[3] : null;
      const taskContextLengthFromId =
        taskIdParts.length >= 5 ? Number.parseInt(taskIdParts[4], 10) : null;

      // First, try to find in current bucket using exact taskId match
      let taskIndex = currentTasks.findIndex((task) => {
        const taskStorageKey =
          task.id ??
          `${insightId}|${bucket}|${currentTasks.indexOf(task)}|${(task.title ?? "").toLowerCase().slice(0, 64)}|${(task.context ?? "").slice(0, 96).length}`;
        return taskStorageKey === taskId || task.id === taskId;
      });

      // If not found with exact match, search all buckets using fuzzy matching
      // This handles cases where title was modified
      if (taskIndex === -1) {
        const allBuckets = [
          "myTasks",
          "waitingForMe",
          "waitingForOthers",
        ] as const;
        for (const searchBucket of allBuckets) {
          const bucketTasks = deserializeJson(
            (targetInsight[searchBucket] as
              | InsightTaskItem[]
              | null
              | undefined) ?? [],
          );
          if (!Array.isArray(bucketTasks) || bucketTasks.length === 0) continue;

          const foundIndex = bucketTasks.findIndex((task, idx) => {
            const contextLength = (task.context ?? "").length;
            const taskTitleKey = (task.title ?? "").toLowerCase().slice(0, 64);

            // Try multiple matching strategies, in order of reliability:
            // 1. Match by exact position (index) and context length
            if (taskIndexFromId !== null && taskContextLengthFromId !== null) {
              if (
                idx === taskIndexFromId &&
                contextLength === taskContextLengthFromId
              ) {
                return true;
              }
            }
            // 2. Match by index only (if contextLength is 0, use index as primary)
            if (taskIndexFromId !== null && idx === taskIndexFromId) {
              return true;
            }
            // 3. Match by title (for backwards compatibility)
            if (taskTitleFromId && taskTitleKey === taskTitleFromId) {
              return true;
            }
            return false;
          });

          if (foundIndex !== -1) {
            // Found the task in another bucket, update the bucket parameter
            taskIndex = foundIndex;
            bucket = searchBucket;
            // Update currentTasks to point to the found bucket's tasks
            (currentTasks as any) = bucketTasks;
            break;
          }
        }
      }

      if (taskIndex === -1) {
        throw new Error(
          `Task ${taskId} not found in any bucket for insight ${insightId}`,
        );
      }

      const taskToUpdate = currentTasks[taskIndex];
      const updatedTask: InsightTaskItem = {
        ...taskToUpdate,
        ...(updates.title !== undefined && { title: updates.title }),
        ...(updates.context !== undefined && { context: updates.context }),
        ...(updates.deadline !== undefined && { deadline: updates.deadline }),
        ...(updates.owner !== undefined && { owner: updates.owner }),
        ...(updates.requester !== undefined && {
          requester: updates.requester,
        }),
        ...(updates.priority !== undefined && { priority: updates.priority }),
      };

      // If bucket needs to change, remove from source bucket and add to new bucket
      const newBucket = updates.newBucket || bucket;
      const needsBucketChange = newBucket !== bucket;

      if (needsBucketChange) {
        // Remove task from source bucket
        const updatedSourceTasks = [...currentTasks];
        updatedSourceTasks.splice(taskIndex, 1);

        // Get task list for target bucket
        const targetBucketTasks = deserializeJson(
          (targetInsight[newBucket] as InsightTaskItem[] | null | undefined) ||
            [],
        );

        // Add to target bucket
        const updatedTargetTasks = [...targetBucketTasks, updatedTask];

        // Update both buckets
        await tx
          .update(insight)
          .set({
            [bucket]: serializeJson(updatedSourceTasks),
            [newBucket]: serializeJson(updatedTargetTasks),
            updatedAt: new Date(),
          })
          .where(eq(insight.id, insightId))
          .execute();
      } else {
        // Only update task in current bucket
        const updatedTasks = [...currentTasks];
        updatedTasks[taskIndex] = updatedTask;

        await tx
          .update(insight)
          .set({
            [bucket]: serializeJson(updatedTasks),
            updatedAt: new Date(),
          })
          .where(eq(insight.id, insightId))
          .execute();
      }

      console.info(
        `[Insight] Updated task ${taskId} (insight: ${insightId}, bucket: ${bucket}${needsBucketChange ? ` -> ${newBucket}` : ""})`,
      );

      return {
        success: true,
        insightId,
        taskId,
        bucket: newBucket,
        task: updatedTask,
      };
    });
  } catch (error) {
    console.error(
      `[Insight] Failed to update task ${taskId} (insight: ${insightId}, bucket: ${bucket}):`,
      error,
    );
    throw new AppError(
      "bad_request:insight",
      `Failed to update insight task. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Remove task from a specified bucket of an Insight (by taskId/storageKey)
 */
export async function removeInsightTask({
  insightId,
  userId,
  taskId,
  bucket,
}: {
  insightId: string;
  userId: string;
  taskId: string;
  bucket: "myTasks" | "waitingForMe" | "waitingForOthers";
}) {
  try {
    return await executeTransaction(async (tx) => {
      const [targetInsight] = await tx
        .select({
          id: insight.id,
          botId: insight.botId,
          myTasks: insight.myTasks,
          waitingForMe: insight.waitingForMe,
          waitingForOthers: insight.waitingForOthers,
        })
        .from(insight)
        .innerJoin(bot, eq(insight.botId, bot.id))
        .where(and(eq(insight.id, insightId), eq(bot.userId, userId)))
        .execute();

      if (!targetInsight) {
        throw new Error(`Insight ${insightId} not found or access denied`);
      }

      // Parse JSON string to array for SQLite
      let currentTasks = deserializeJson(
        (targetInsight[bucket] as InsightTaskItem[] | null | undefined) ?? [],
      );

      // Extract info from taskId for matching (format: insightId|bucket|index|title|contextLength)
      const taskIdParts = taskId.split("|");
      const taskIndexFromId =
        taskIdParts.length >= 3 ? Number.parseInt(taskIdParts[2], 10) : null;
      const taskTitleFromId = taskIdParts.length >= 4 ? taskIdParts[3] : null;
      const taskContextLengthFromId =
        taskIdParts.length >= 5 ? Number.parseInt(taskIdParts[4], 10) : null;

      // First, try to find in current bucket using exact taskId match
      let taskIndex = -1;
      if (Array.isArray(currentTasks) && currentTasks.length > 0) {
        taskIndex = currentTasks.findIndex((task) => {
          const taskStorageKey =
            task.id ??
            `${insightId}|${bucket}|${currentTasks.indexOf(task)}|${(task.title ?? "").toLowerCase().slice(0, 64)}|${(task.context ?? "").slice(0, 96).length}`;
          return taskStorageKey === taskId || task.id === taskId;
        });
      }

      // If not found with exact match, search all buckets using fuzzy matching
      // This handles cases where:
      // 1. Task was moved to a different bucket (bucket in URL is stale)
      // 2. Title was modified
      // 3. The bucket from URL is empty
      if (taskIndex === -1) {
        const allBuckets = [
          "myTasks",
          "waitingForMe",
          "waitingForOthers",
        ] as const;
        for (const searchBucket of allBuckets) {
          const bucketTasks = deserializeJson(
            (targetInsight[searchBucket] as
              | InsightTaskItem[]
              | null
              | undefined) ?? [],
          );
          if (!Array.isArray(bucketTasks) || bucketTasks.length === 0) continue;

          const foundIndex = bucketTasks.findIndex((task, idx) => {
            const contextLength = (task.context ?? "").length;
            const taskTitleKey = (task.title ?? "").toLowerCase().slice(0, 64);

            // Try multiple matching strategies, in order of reliability:
            // 1. Match by exact position (index) and context length
            if (taskIndexFromId !== null && taskContextLengthFromId !== null) {
              if (
                idx === taskIndexFromId &&
                contextLength === taskContextLengthFromId
              ) {
                return true;
              }
            }
            // 2. Match by index only (if contextLength is 0, use index as primary)
            if (taskIndexFromId !== null && idx === taskIndexFromId) {
              return true;
            }
            // 3. Match by title (for backwards compatibility)
            if (taskTitleFromId && taskTitleKey === taskTitleFromId) {
              return true;
            }
            return false;
          });

          if (foundIndex !== -1) {
            // Found the task in another bucket, update the bucket parameter
            taskIndex = foundIndex;
            bucket = searchBucket;
            // Update currentTasks to point to the found bucket's tasks
            (currentTasks as any) = bucketTasks;
            break;
          }
        }
      }

      if (taskIndex === -1) {
        throw new Error(
          `Task ${taskId} not found in any bucket for insight ${insightId}`,
        );
      }

      const updatedTasks = [...currentTasks];
      updatedTasks.splice(taskIndex, 1);

      await tx
        .update(insight)
        .set({
          [bucket]: serializeJson(updatedTasks),
          updatedAt: new Date(),
        })
        .where(eq(insight.id, insightId))
        .execute();

      return { success: true, insightId, taskId, bucket };
    });
  } catch (error) {
    console.error(
      `[Insight] Failed to remove task ${taskId} (insight: ${insightId}, bucket: ${bucket}):`,
      error,
    );
    throw new AppError(
      "bad_request:insight",
      `Failed to remove insight task. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function getCompletedInsightEmbeddedTasks({
  insightId,
  buckets = ["myTasks", "waitingForMe", "waitingForOthers"],
}: {
  insightId: string;
  buckets?: ("myTasks" | "waitingForMe" | "waitingForOthers")[];
}) {
  try {
    const [targetInsight] = await db
      .select({
        myTasks: insight.myTasks,
        waitingForMe: insight.waitingForMe,
        waitingForOthers: insight.waitingForOthers,
      })
      .from(insight)
      .where(eq(insight.id, insightId))
      .execute();

    if (!targetInsight) {
      throw new Error(`Insight ${insightId} not found`);
    }

    const completedTasks: Record<string, boolean> = {};
    buckets.forEach((bucket) => {
      // Parse JSON string to array for SQLite
      const tasks = deserializeJson(
        (targetInsight[bucket] as InsightTaskItem[] | null | undefined) ?? [],
      );
      if (!Array.isArray(tasks)) return;

      tasks.forEach((task, index) => {
        if (task.status === "completed") {
          const taskStorageKey =
            task.id ??
            `${insightId}|${bucket}|${index}|${(task.title ?? "").toLowerCase().slice(0, 64)}|${(task.context ?? "").slice(0, 96).length}`;
          completedTasks[taskStorageKey] = true;
        }
      });
    });

    console.info(
      `[Insight] Fetched ${Object.keys(completedTasks).length} completed tasks for insight ${insightId}`,
    );
    return completedTasks;
  } catch (error) {
    console.error(
      `[Insight] Failed to fetch completed tasks for insight ${insightId}:`,
      error,
    );
    throw new AppError(
      "bad_request:insight",
      `Failed to fetch completed insight tasks. ${error}`,
    );
  }
}

export type InsightInsertInput = Omit<InsertInsight, "id">;

/**
 * Serialize field value for database insertion
 * Handles different types and null values appropriately
 */
function serializeField(
  data: unknown,
  options?: {
    // For non-null array fields: convert null/undefined to "[]"
    defaultEmptyArray?: boolean;
    // For string fields: ensure string type
    asString?: boolean;
    // For boolean fields: convert to 0/1 in SQLite
    asBoolean?: boolean;
  },
): unknown {
  const {
    defaultEmptyArray = false,
    asString = false,
    asBoolean = false,
  } = options ?? {};

  // Handle null/undefined
  if (data === null || data === undefined) {
    if (defaultEmptyArray) {
      return isTauriMode() ? "[]" : [];
    }
    return null;
  }

  // In PostgreSQL mode, return as-is for most types
  if (!isTauriMode()) {
    return data;
  }

  // SQLite mode specific handling
  if (asBoolean && typeof data === "boolean") {
    return data ? 1 : 0;
  }

  if (typeof data === "string") {
    return data;
  }

  // Serialize arrays and objects to JSON strings for SQLite
  if (typeof data === "object") {
    return JSON.stringify(data);
  }

  // For numbers and booleans (without asBoolean option), return as-is
  return data;
}

export async function insertInsightRecords(
  entries: InsightInsertInput[],
): Promise<string[]> {
  if (entries.length === 0) {
    return [];
  }

  try {
    // Serialize all JSON fields for SQLite compatibility
    // In SQLite mode, JSON fields need to be stored as strings
    const serializedEntries = entries.map((entry) =>
      addIdIfNeeded({
        ...entry,
        // Non-null array fields (default to empty array if null/undefined)
        groups: serializeField(entry.groups, { defaultEmptyArray: true }),
        people: serializeField(entry.people, { defaultEmptyArray: true }),
        topKeywords: serializeField(entry.topKeywords, {
          defaultEmptyArray: true,
        }),
        topEntities: serializeField(entry.topEntities, {
          defaultEmptyArray: true,
        }),
        buyerSignals: serializeField(entry.buyerSignals, {
          defaultEmptyArray: true,
        }),
        categories: serializeField(entry.categories, {
          defaultEmptyArray: true,
        }),
        // Nullable JSON fields (keep null as-is)
        details: serializeField(entry.details),
        timeline: serializeField(entry.timeline),
        insights: serializeField(entry.insights),
        trend: serializeField(entry.trend),
        topVoices: serializeField(entry.topVoices),
        sources: serializeField(entry.sources),
        stakeholders: serializeField(entry.stakeholders),
        scope: serializeField(entry.scope),
        nextActions: serializeField(entry.nextActions),
        followUps: serializeField(entry.followUps),
        actionRequiredDetails: serializeField(entry.actionRequiredDetails),
        myTasks: serializeField(entry.myTasks),
        waitingForMe: serializeField(entry.waitingForMe),
        waitingForOthers: serializeField(entry.waitingForOthers),
        learning: serializeField(entry.learning),
        priority: serializeField(entry.priority),
        experimentIdeas: serializeField(entry.experimentIdeas),
        executiveSummary: serializeField(entry.executiveSummary),
        riskFlags: serializeField(entry.riskFlags),
        strategic: serializeField(entry.strategic),
        nextMilestone: serializeField(entry.nextMilestone),
        dueDate: serializeField(entry.dueDate),
        paymentInfo: serializeField(entry.paymentInfo),
        entity: serializeField(entry.entity),
        why: serializeField(entry.why),
        historySummary: serializeField(entry.historySummary),
        roleAttribution: serializeField(entry.roleAttribution),
        alerts: serializeField(entry.alerts),
        // Boolean/integer fields - ensure proper type
        clarifyNeeded: serializeField(entry.clarifyNeeded, { asBoolean: true }),
      }),
    );

    // Batch insert to avoid SQLite parameter binding limit (55+ fields most likely to trigger limit)
    const results: string[] = [];
    for (let i = 0; i < serializedEntries.length; i += DB_INSERT_CHUNK_SIZE) {
      const chunk = serializedEntries.slice(i, i + DB_INSERT_CHUNK_SIZE);
      const inserted = await db
        .insert(insight)
        .values(chunk)
        .returning({ id: insight.id });
      results.push(...inserted.map((row: any) => row.id));
    }

    const candidatesByBot = new Map<string, InsightRevivalCandidate[]>();
    for (const entry of entries) {
      if (!entry.botId) continue;
      const existing = candidatesByBot.get(entry.botId) ?? [];
      existing.push({
        dedupeKey: entry.dedupeKey ?? null,
        title: entry.title,
        projectName: entry.projectName ?? null,
        client: entry.client ?? null,
        account: entry.account ?? null,
        signalType: entry.signalType ?? null,
      });
      candidatesByBot.set(entry.botId, existing);
    }

    for (const [botId, candidates] of candidatesByBot.entries()) {
      await revivePendingDeletionInsightsForBot({
        tx: db,
        botId,
        candidates,
      });
    }

    return results;
  } catch (error) {
    throw new AppError(
      "bad_request:database",
      `Failed to insert insight records. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function getUserInsightSettings(
  userId: string,
): Promise<InsightSettings | null> {
  try {
    const dbSettings = await db
      .select()
      .from(userInsightSettings)
      .where(eq(userInsightSettings.userId, userId))
      .limit(1);

    return dbSettings.length > 0 ? parseInsightSettings(dbSettings[0]) : null;
  } catch (error) {
    console.error("Failed to get user insight settings:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to retrieve insight settings. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function updateUserInsightSettings(
  userId: string,
  settings: Partial<InsightSettings>,
) {
  try {
    const existing = await getUserInsightSettings(userId);
    const mergedSettings: InsightSettings = {
      focusPeople: [],
      focusTopics: [],
      language: "",
      refreshIntervalMinutes: 30,
      lastMessageProcessedAt: null,
      lastActiveAt: null,
      lastInsightMaintenanceRunAt: null,
      activityTier: "low",
      aiSoulPrompt: null,
      identityIndustries: null,
      identityWorkDescription: null,
      userId,
      ...existing,
      ...settings,
      lastUpdated: new Date(),
    };
    const dbData = serializeInsightSettings(mergedSettings);
    if (existing) {
      return await db
        .update(userInsightSettings)
        .set({
          ...dbData,
          lastUpdated: new Date(),
        })
        .where(eq(userInsightSettings.userId, userId));
    }
    return await db.insert(userInsightSettings).values({
      ...dbData,
      userId,
      id: generateUUID(),
      lastUpdated: new Date(),
    });
  } catch (error) {
    console.error("Failed to update user insight settings:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to update insight settings. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Fetch user subscription info from cloud
 * Only used for shadow users in Tauri mode
 */
async function getCloudUserSubscription(
  userId: string,
): Promise<UserType | null> {
  try {
    const cloudUrl =
      process.env.CLOUD_API_URL || process.env.NEXT_PUBLIC_CLOUD_API_URL;

    if (!cloudUrl) {
      return null;
    }

    // Get token from localStorage or other storage (if available)
    // Server cannot directly access localStorage, token must be passed via other means
    // Return null for now, letting function fall back to local query
    return null;
  } catch (error) {
    console.error("[getUserTypeForService] Cloud fetch error:", error);
    return null;
  }
}

/**
 * Check if user is a shadow user (cloud user in Tauri mode)
 */
function isShadowUser(userId: string): boolean {
  return userId.startsWith("cloud_");
}

/**
 * Get cloud subscription user ID (remove cloud_ prefix)
 */
function getCloudUserId(userId: string): string {
  return isShadowUser(userId) ? userId.substring(6) : userId;
}

export async function getUserTypeForService(userId: string): Promise<UserType> {
  try {
    // Shadow user in Tauri mode: try to fetch subscription info from cloud
    if (isTauriMode() && isShadowUser(userId)) {
      const cloudUserId = getCloudUserId(userId);

      try {
        const cloudUrl =
          process.env.CLOUD_API_URL || process.env.NEXT_PUBLIC_CLOUD_API_URL;

        if (cloudUrl) {
          // Fetch subscription info from cloud via internal subscription query API
          // Note: Cloud authentication is required here
          const response = await fetch(
            `${cloudUrl}/api/user-subscriptions/${cloudUserId}`,
          );

          if (response.ok) {
            const data = await response.json();
            if (data.subscription) {
              const plan = data.subscription.planName?.toLowerCase() ?? "";
              if (plan.includes("team")) return "team";
              if (plan.includes("pro")) return "pro";
              if (plan.includes("basic")) return "basic";
            }
          }
        }
      } catch (cloudError) {
        console.error(
          "[getUserTypeForService] Failed to fetch cloud subscription:",
          cloudError,
        );
        // Continue using local data
      }
    }

    // Fall back to local database query
    const [activeSubscription] = await db
      .select({
        planName: userSubscriptions.planName,
        endDate: userSubscriptions.endDate,
      })
      .from(userSubscriptions)
      .where(
        and(
          eq(userSubscriptions.userId, userId),
          eq(userSubscriptions.isActive, true),
          or(
            isNull(userSubscriptions.endDate),
            gt(userSubscriptions.endDate, new Date()),
          ),
        ),
      )
      .limit(1);

    if (!activeSubscription) {
      return "regular";
    }

    const plan = activeSubscription.planName?.toLowerCase() ?? "";
    if (plan.includes("team")) return "team";
    if (plan.includes("pro")) return "pro";
    if (plan.includes("basic")) return "basic";

    return "regular";
  } catch (error) {
    console.error("Failed to resolve user type for service refresh:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to resolve user type for service refresh. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function getUsersDueForInsightRefresh({
  now,
  limit,
  ttlHours = DEFAULT_INSIGHT_TTL_HOURS,
}: {
  now: Date;
  limit: number;
  ttlHours?: number;
}): Promise<InsightSettings[]> {
  try {
    const rows = await db.select().from(userInsightSettings);
    const settings = rows.map((row: any) => parseInsightSettings(row));

    return filterDueInsightSettings({
      settings,
      now,
      limit,
      ttlHours,
    });
  } catch (error) {
    console.error("Failed to get users due for insight refresh:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to get users due for insight refresh. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function linkTelegramAccount({
  userId,
  account,
}: {
  userId: string;
  account: {
    telegramUserId: string;
    telegramChatId: string;
    username?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    languageCode?: string | null;
    isBot?: boolean;
  };
}): Promise<TelegramAccount> {
  const now = new Date();
  try {
    const [record] = await db
      .insert(telegramAccounts)
      .values({
        userId,
        telegramUserId: account.telegramUserId,
        telegramChatId: account.telegramChatId,
        username: account.username ?? null,
        firstName: account.firstName ?? null,
        lastName: account.lastName ?? null,
        languageCode: account.languageCode ?? null,
        isBot: account.isBot ?? false,
        linkedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: telegramAccounts.telegramUserId,
        set: {
          userId,
          telegramChatId: account.telegramChatId,
          username: account.username ?? null,
          firstName: account.firstName ?? null,
          lastName: account.lastName ?? null,
          languageCode: account.languageCode ?? null,
          isBot: account.isBot ?? false,
          updatedAt: now,
        },
      })
      .returning();

    if (!record) {
      throw new AppError(
        "bad_request:database",
        "Failed to link Telegram account",
      );
    }

    return record;
  } catch (error) {
    console.error("[Telegram] Failed to link account:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to link Telegram account. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function getTelegramAccountByTelegramUserId(
  telegramUserId: string,
): Promise<TelegramAccount | null> {
  try {
    const [record] = await db
      .select()
      .from(telegramAccounts)
      .where(eq(telegramAccounts.telegramUserId, telegramUserId))
      .limit(1);
    return record ?? null;
  } catch (error) {
    console.error("[Telegram] Failed to lookup by telegramUserId:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to load Telegram account by telegram user id. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function getTelegramAccountsByUserId(
  userId: string,
): Promise<TelegramAccount[]> {
  try {
    return await db
      .select()
      .from(telegramAccounts)
      .where(eq(telegramAccounts.userId, userId));
  } catch (error) {
    console.error("[Telegram] Failed to list accounts by user:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to load Telegram accounts for user. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function updateTelegramAccountLastCommand({
  telegramUserId,
  lastCommandAt,
}: {
  telegramUserId: string;
  lastCommandAt: Date;
}) {
  try {
    await db
      .update(telegramAccounts)
      .set({
        lastCommandAt,
        updatedAt: new Date(),
      })
      .where(eq(telegramAccounts.telegramUserId, telegramUserId));
  } catch (error) {
    console.error("[Telegram] Failed to update last command timestamp:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to update Telegram account last command timestamp. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function unlinkTelegramAccount({
  telegramUserId,
}: {
  telegramUserId: string;
}) {
  try {
    await db
      .delete(telegramAccounts)
      .where(eq(telegramAccounts.telegramUserId, telegramUserId));
  } catch (error) {
    console.error("[Telegram] Failed to unlink account:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to unlink Telegram account. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// WhatsApp account operations
export async function getWhatsAppAccountByWhatsAppUserId(
  whatsappUserId: string,
): Promise<WhatsAppAccount | null> {
  try {
    const [record] = await db
      .select()
      .from(whatsappAccounts)
      .where(eq(whatsappAccounts.whatsappUserId, whatsappUserId))
      .limit(1);
    return record ?? null;
  } catch (error) {
    console.error("[WhatsApp] Failed to lookup by whatsappUserId:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to load WhatsApp account by whatsapp user id. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function getWhatsAppAccountsByUserId(
  userId: string,
): Promise<WhatsAppAccount[]> {
  try {
    return await db
      .select()
      .from(whatsappAccounts)
      .where(eq(whatsappAccounts.userId, userId));
  } catch (error) {
    console.error("[WhatsApp] Failed to list accounts by user:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to load WhatsApp accounts for user. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function updateWhatsAppAccountLastCommand({
  whatsappUserId,
  lastCommandAt,
}: {
  whatsappUserId: string;
  lastCommandAt: Date;
}) {
  try {
    await db
      .update(whatsappAccounts)
      .set({
        lastCommandAt,
        updatedAt: new Date(),
      })
      .where(eq(whatsappAccounts.whatsappUserId, whatsappUserId));
  } catch (error) {
    console.error("[WhatsApp] Failed to update last command timestamp:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to update WhatsApp account last command timestamp. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function unlinkWhatsAppAccount({
  whatsappUserId,
}: {
  whatsappUserId: string;
}) {
  try {
    await db
      .delete(whatsappAccounts)
      .where(eq(whatsappAccounts.whatsappUserId, whatsappUserId));
  } catch (error) {
    console.error("[WhatsApp] Failed to unlink account:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to unlink WhatsApp account. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function linkDiscordAccount({
  userId,
  account,
}: {
  userId: string;
  account: {
    discordUserId: string;
    discordGuildId?: string | null;
    discordChannelId?: string | null;
    username?: string | null;
    globalName?: string | null;
  };
}): Promise<DiscordAccount> {
  const now = new Date();
  try {
    const [record] = await db
      .insert(discordAccounts)
      .values({
        userId,
        discordUserId: account.discordUserId,
        discordGuildId: account.discordGuildId ?? null,
        discordChannelId: account.discordChannelId ?? null,
        username: account.username ?? null,
        globalName: account.globalName ?? null,
        linkedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: discordAccounts.discordUserId,
        set: {
          userId,
          discordGuildId: account.discordGuildId ?? null,
          discordChannelId: account.discordChannelId ?? null,
          username: account.username ?? null,
          globalName: account.globalName ?? null,
          updatedAt: now,
        },
      })
      .returning();

    if (!record) {
      throw new AppError(
        "bad_request:database",
        "Failed to link Discord account",
      );
    }

    return record;
  } catch (error) {
    console.error("[Discord] Failed to link account:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to link Discord account. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function getDiscordAccountByDiscordUserId(
  discordUserId: string,
): Promise<DiscordAccount | null> {
  try {
    const [record] = await db
      .select()
      .from(discordAccounts)
      .where(eq(discordAccounts.discordUserId, discordUserId))
      .limit(1);
    return record ?? null;
  } catch (error) {
    console.error("[Discord] Failed to lookup by discordUserId:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to load Discord account by discord user id. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function getDiscordAccountsByUserId(
  userId: string,
): Promise<DiscordAccount[]> {
  try {
    return await db
      .select()
      .from(discordAccounts)
      .where(eq(discordAccounts.userId, userId));
  } catch (error) {
    console.error("[Discord] Failed to list accounts by user:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to load Discord accounts for user. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function updateDiscordAccountLastCommand({
  discordUserId,
  lastCommandAt,
}: {
  discordUserId: string;
  lastCommandAt: Date;
}) {
  try {
    await db
      .update(discordAccounts)
      .set({
        lastCommandAt,
        updatedAt: new Date(),
      })
      .where(eq(discordAccounts.discordUserId, discordUserId));
  } catch (error) {
    console.error("[Discord] Failed to update last command timestamp:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to update Discord account last command timestamp. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function upsertContact(
  contact: Omit<UserContact, "id">,
): Promise<UserContact> {
  try {
    // 1. First query existing record by userId + contactId (primary key semantics)
    const existing = await getContact(contact.userId, contact.contactId);

    // Serialize contact data (especially contactMeta, compatible with PostgreSQL JSONB / SQLite TEXT)
    const serialized = {
      ...contact,
      contactMeta: serializeJson(contact.contactMeta),
      id: existing?.id,
    };

    let result: UserContact[];
    if (existing) {
      // 2. Already exists: update by userId + contactId (keep contactId semantics unchanged)
      result = await db
        .update(userContacts)
        .set({
          ...serialized,
        })
        .where(
          and(
            eq(userContacts.userId, contact.userId),
            eq(userContacts.contactId, contact.contactId),
          ),
        )
        .returning();
    } else {
      // 3. Does not exist: query once more by unique index (userId, botId, contactName) to avoid UNIQUE conflict
      const nameWhere = contact.botId
        ? and(
            eq(userContacts.userId, contact.userId),
            eq(userContacts.botId, contact.botId),
            eq(userContacts.contactName, contact.contactName),
          )
        : and(
            eq(userContacts.userId, contact.userId),
            isNull(userContacts.botId),
            eq(userContacts.contactName, contact.contactName),
          );

      const [existingByName] = await db
        .select()
        .from(userContacts)
        .where(nameWhere)
        .limit(1);

      if (existingByName) {
        // Use existing record, update contactId / contactMeta and other fields
        result = await db
          .update(userContacts)
          .set({
            ...serialized,
            id: existingByName.id,
          })
          .where(eq(userContacts.id, existingByName.id))
          .returning();
      } else {
        // 4. Actually create new contact (use unique index atomic upsert to avoid UNIQUE conflict)
        result = await db
          .insert(userContacts)
          .values({
            ...serialized,
            id: generateUUID(),
          })
          .onConflictDoUpdate({
            target: [
              userContacts.userId,
              userContacts.botId,
              userContacts.contactName,
            ],
            set: {
              contactId: serialized.contactId,
              contactMeta: serialized.contactMeta,
              type: serialized.type,
            },
          })
          .returning();
      }
    }

    return result[0];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Special handling: on unique constraint conflict, indicates contact already exists, return existing record to avoid breaking upstream flow
    if (
      message.includes(
        "UNIQUE constraint failed: user_meta_contacts.user_id, user_meta_contacts.bot_id, user_meta_contacts.contact_name",
      ) ||
      message.includes("UNIQUE constraint failed: user_meta_contacts.id")
    ) {
      // 1. Prefer to precisely query existing row by (userId, botId, contactName)
      try {
        const nameWhere = contact.botId
          ? and(
              eq(userContacts.userId, contact.userId),
              eq(userContacts.botId, contact.botId),
              eq(userContacts.contactName, contact.contactName),
            )
          : and(
              eq(userContacts.userId, contact.userId),
              isNull(userContacts.botId),
              eq(userContacts.contactName, contact.contactName),
            );

        const [existingByName] = await db
          .select()
          .from(userContacts)
          .where(nameWhere)
          .limit(1);

        if (existingByName) {
          console.warn(
            `[Contacts] UNIQUE constraint hit for contact "${contact.contactName}", user ${contact.userId}, bot ${contact.botId ?? "null"} — returning existing row (by name).`,
          );
          return existingByName;
        }
      } catch (logError) {
        console.error(
          "[Contacts] Failed to resolve UNIQUE conflict for upsertContact by name:",
          logError,
        );
      }

      // 2. Then try querying once more by (userId, contactId)
      try {
        const existingById = await getContact(
          contact.userId,
          contact.contactId,
        );
        if (existingById) {
          console.warn(
            `[Contacts] UNIQUE constraint hit but no row found by (userId, botId, contactName); returning row found by (userId, contactId) for contactId=${contact.contactId}.`,
          );
          return existingById;
        }
      } catch (logError) {
        console.error(
          "[Contacts] Failed to resolve UNIQUE conflict for upsertContact by id:",
          logError,
        );
      }

      // 3. Fallback: if still not found, don't break upstream flow, return a contact object based on input params
      console.error(
        "[Contacts] UNIQUE constraint unresolved for upsertContact. Returning synthetic contact from input without DB persistence.",
        {
          contact,
          originalError: message,
        },
      );

      return {
        id: contact.contactId,
        userId: contact.userId,
        contactId: contact.contactId,
        contactName: contact.contactName,
        botId: contact.botId,
        type: (contact as any).type ?? null,
        contactMeta: serializeJson(contact.contactMeta),
      } as UserContact;
    }

    // Other errors are still thrown with original logic, with extra context for debugging
    try {
      const conflictRows = await db
        .select()
        .from(userContacts)
        .where(
          and(
            eq(userContacts.userId, contact.userId),
            contact.botId
              ? eq(userContacts.botId, contact.botId)
              : isNull(userContacts.botId),
            eq(userContacts.contactName, contact.contactName),
          ),
        )
        .limit(5);
      console.error(
        `[Contacts] Failed to upsert contact ${contact.contactId} for user ${contact.userId}, bot ${contact.botId ?? "null"}. Existing rows with same (userId, botId, contactName):`,
        conflictRows,
      );
    } catch (logError) {
      console.error(
        "[Contacts] Failed to log conflict rows for upsertContact:",
        logError,
      );
    }
    console.error(`Failed to upsert contact ${contact.contactId}:`, error);
    throw new AppError(
      "bad_request:database",
      `Failed to save contact. ${message}`,
    );
  }
}

export async function getUserContacts(userId: string): Promise<UserContact[]> {
  try {
    const dbContacts = await db
      .select()
      .from(userContacts)
      .where(eq(userContacts.userId, userId));

    return dbContacts;
  } catch (error) {
    console.error("Failed to get user contacts:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to retrieve contacts. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function deleteAllUserContacts(userId: string) {
  try {
    await db
      .delete(userContacts)
      .where(eq(userContacts.userId, userId))
      .execute();
  } catch (error) {
    console.error("Failed to delete all user contacts:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to delete all contacts. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Get a single contact
 * @param userId - User ID
 * @param contactId - Contact ID
 * @returns Contact object or null
 */
export async function getContact(
  userId: string,
  contactId: string,
): Promise<UserContact | null> {
  try {
    const dbContact = await db
      .select()
      .from(userContacts)
      .where(
        and(
          eq(userContacts.userId, userId),
          eq(userContacts.contactId, contactId),
        ),
      )
      .limit(1);

    const contact = dbContact.length > 0 ? dbContact[0] : null;
    return contact ? normalizeContactMeta(contact) : null;
  } catch (error) {
    console.error(
      `Failed to get contact ${contactId} for user ${userId}:`,
      error,
    );
    throw new AppError(
      "bad_request:database",
      `Failed to retrieve contact. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Search contacts by name (fuzzy match, case-insensitive)
 * @param userId - User ID
 * @param name - Contact name
 * @returns List of matching contacts
 */
export async function getContactsByName(
  userId: string,
  name: string,
): Promise<UserContact[]> {
  try {
    const dbContacts = await db
      .select()
      .from(userContacts)
      .where(
        and(
          eq(userContacts.userId, userId),
          eq(userContacts.contactName, name),
        ),
      )
      .orderBy(userContacts.contactName);

    return normalizeContactMetaList(dbContacts);
  } catch (error) {
    console.error(`Failed to search contacts with term ${name}:`, error);
    throw new AppError(
      "bad_request:database",
      `Failed to search contacts. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function getContactsBySearchTerm(
  userId: string,
  searchTerm: string,
): Promise<UserContact[]> {
  try {
    const dbContacts = await db
      .select()
      .from(userContacts)
      .where(
        and(
          eq(userContacts.userId, userId),
          caseInsensitiveSearch(userContacts.contactName, `%${searchTerm}%`),
        ),
      )
      .orderBy(userContacts.contactName);

    return normalizeContactMetaList(dbContacts);
  } catch (error) {
    console.error(`Failed to search contacts with term ${searchTerm}:`, error);
    throw new AppError(
      "bad_request:database",
      `Failed to search contacts. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Find contact by iMessage chatId format
 * Supports phone numbers (e.g., +8615928069834) and email formats
 * iMessage chatId format is typically: iMessage;-;+1234567890 or iMessage;-;email@example.com
 * @param userId - User ID
 * @param identifier - Phone number or email
 * @param botId - Optional, used to filter contacts for a specific bot
 * @returns Matched contact or null
 */
export async function getContactByIMessageIdentifier(
  userId: string,
  identifier: string,
  botId?: string,
): Promise<UserContact | null> {
  try {
    // Build possible iMessage chatId formats
    const possibleChatIds = [
      identifier, // Direct match
      `iMessage;-;${identifier}`, // Standard iMessage format
      `iMessage;+;${identifier}`, // Alternative iMessage format (group)
    ];

    // Try all possible formats
    for (const chatId of possibleChatIds) {
      const conditions = [
        eq(userContacts.userId, userId),
        eq(userContacts.contactId, chatId),
      ];

      if (botId) {
        conditions.push(eq(userContacts.botId, botId));
      }

      const dbContact = await db
        .select()
        .from(userContacts)
        .where(and(...conditions))
        .limit(1);

      if (dbContact.length > 0) {
        return normalizeContactMeta(dbContact[0]);
      }
    }

    // If direct match fails, try to find via phoneNumber in contactMeta
    // Note: This requires database support for JSON queries
    const allContacts = await db
      .select()
      .from(userContacts)
      .where(
        and(
          eq(userContacts.userId, userId),
          botId ? eq(userContacts.botId, botId) : undefined,
        ),
      );

    // Parse contactMeta of all contacts first
    const normalizedContacts = normalizeContactMetaList(allContacts);

    // Filter contacts with matching phoneNumber or email at application layer
    const normalizedIdentifier = identifier.replace(/\s+/g, "");
    for (const contact of normalizedContacts) {
      const meta = contact.contactMeta as {
        phoneNumber?: string;
        email?: string;
      } | null;
      if (meta) {
        const phoneMatch =
          meta.phoneNumber &&
          meta.phoneNumber.replace(/\s+/g, "") === normalizedIdentifier;
        const emailMatch =
          meta.email &&
          meta.email.toLowerCase() === normalizedIdentifier.toLowerCase();
        if (phoneMatch || emailMatch) {
          return contact;
        }
      }

      // Also check if contactId contains this identifier
      if (contact.contactId.includes(normalizedIdentifier)) {
        return contact;
      }
    }

    return null;
  } catch (error) {
    console.error(
      `Failed to get contact by iMessage identifier ${identifier}:`,
      error,
    );
    return null;
  }
}

export async function bulkUpsertContacts(
  contacts: Omit<UserContact, "id">[],
): Promise<UserContact[]> {
  if (contacts.length === 0) {
    return [];
  }

  try {
    const userId = contacts[0].userId;
    if (!contacts.every((contact) => contact.userId === userId)) {
      throw new AppError(
        "bad_request:database",
        "All contacts in bulk operation must belong to the same user",
      );
    }
    const uniqueContactsMap = new Map<string, Omit<UserContact, "id">>();
    for (const contact of contacts) {
      const conflictKey = `${contact.userId}-${contact.contactName}-${contact.botId || ""}`;
      const existing = uniqueContactsMap.get(conflictKey);
      if (!existing || (!existing.contactMeta && contact.contactMeta)) {
        uniqueContactsMap.set(conflictKey, contact);
      }
    }
    const uniqueContacts = Array.from(uniqueContactsMap.values());

    // Use INSERT + separate UPDATE to avoid Drizzle ORM parameter issues
    // This works for both PostgreSQL and SQLite
    const result: UserContact[] = [];

    for (const contact of uniqueContacts) {
      const id = generateUUID();

      // Normalize contact data - convert undefined to null, serialize JSON for SQLite
      const normalizedContact = {
        ...contact,
        type: contact.type ?? null,
        botId: contact.botId ?? null,
        contactMeta: serializeJson(contact.contactMeta),
      };

      // Build where clause that properly handles NULL botId
      const whereClause = normalizedContact.botId
        ? and(
            eq(userContacts.userId, normalizedContact.userId),
            eq(userContacts.contactName, normalizedContact.contactName),
            eq(userContacts.botId, normalizedContact.botId),
          )
        : and(
            eq(userContacts.userId, normalizedContact.userId),
            eq(userContacts.contactName, normalizedContact.contactName),
            isNull(userContacts.botId),
          );

      // Check if record exists
      const [existing] = await db
        .select()
        .from(userContacts)
        .where(whereClause)
        .limit(1);

      if (existing) {
        // Update existing record
        const [updated] = await db
          .update(userContacts)
          .set({
            contactId: normalizedContact.contactId,
            contactMeta: normalizedContact.contactMeta,
            type: normalizedContact.type,
          })
          .where(eq(userContacts.id, existing.id))
          .returning();

        if (updated) {
          result.push(updated);
        }
      } else {
        // Insert new record
        const [inserted] = await db
          .insert(userContacts)
          .values({
            id,
            userId: normalizedContact.userId,
            contactId: normalizedContact.contactId,
            contactName: normalizedContact.contactName,
            type: normalizedContact.type,
            botId: normalizedContact.botId,
            contactMeta: normalizedContact.contactMeta,
          })
          .returning();

        if (inserted) {
          result.push(inserted);
        }
      }
    }

    return result;
  } catch (error) {
    console.error("Failed to bulk upsert contacts:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to bulk save contacts. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function ensureUserEmailPreferences(
  userId: string,
): Promise<UserEmailPreferences> {
  try {
    const [preferences] = await db
      .select()
      .from(userEmailPreferences)
      .where(eq(userEmailPreferences.userId, userId))
      .limit(1);

    if (preferences) {
      return preferences;
    }

    const [created] = await db
      .insert(userEmailPreferences)
      .values({ userId })
      .returning();

    if (!created) {
      throw new AppError(
        "bad_request:database",
        `Failed to create default email preferences for user ${userId}`,
      );
    }

    return created;
  } catch (error) {
    console.error("[EmailPreferences] ensure failed", error);
    throw new AppError(
      "bad_request:database",
      `Failed to ensure email preferences. ${error}`,
    );
  }
}

export async function updateUserEmailPreferences(
  userId: string,
  updates: Partial<{
    marketingOptIn: boolean;
    marketingOptedOutAt: Date | null;
    lastEmailSentAt: Date | null;
  }>,
) {
  try {
    await db
      .update(userEmailPreferences)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(userEmailPreferences.userId, userId));
  } catch (error) {
    console.error("[EmailPreferences] update failed", error);
    throw new AppError(
      "bad_request:database",
      `Failed to update email preferences for ${userId}. ${error}`,
    );
  }
}

export async function getUserEmailPreferencesByToken(token: string) {
  try {
    const [preferences] = await db
      .select()
      .from(userEmailPreferences)
      .where(eq(userEmailPreferences.unsubscribeToken, token))
      .limit(1);

    return preferences ?? null;
  } catch (error) {
    console.error("[EmailPreferences] lookup by token failed", error);
    throw new AppError(
      "bad_request:database",
      `Failed to lookup email preferences by token. ${error}`,
    );
  }
}

export async function unsubscribeUserByToken(token: string) {
  try {
    const now = new Date();
    const [updated] = await db
      .update(userEmailPreferences)
      .set({
        marketingOptIn: false,
        marketingOptedOutAt: now,
        updatedAt: now,
      })
      .where(eq(userEmailPreferences.unsubscribeToken, token))
      .returning();

    return updated ?? null;
  } catch (error) {
    console.error("[EmailPreferences] unsubscribe failed", error);
    throw new AppError(
      "bad_request:database",
      `Failed to unsubscribe user by token. ${error}`,
    );
  }
}

export async function hasMarketingEmailBeenSent({
  userId,
  dedupeKey,
}: {
  userId: string;
  dedupeKey: string;
}): Promise<boolean> {
  try {
    const [record] = await db
      .select({ id: marketingEmailLog.id })
      .from(marketingEmailLog)
      .where(
        and(
          eq(marketingEmailLog.userId, userId),
          eq(marketingEmailLog.dedupeKey, dedupeKey),
        ),
      )
      .limit(1);

    return Boolean(record);
  } catch (error) {
    console.error("[MarketingEmail] dedupe lookup failed", error);
    throw new AppError(
      "bad_request:database",
      `Failed to check marketing email dedupe key. ${error}`,
    );
  }
}

export async function recordMarketingEmailLog(entry: {
  userId: string;
  email: string;
  stage: string;
  template: string;
  dedupeKey: string;
  status?: "sent" | "queued" | "failed" | "skipped";
  error?: string | null;
  metadata?: Record<string, unknown> | null;
  sentAt?: Date;
}) {
  try {
    await db
      .insert(marketingEmailLog)
      .values({
        userId: entry.userId,
        email: entry.email,
        stage: entry.stage,
        template: entry.template,
        dedupeKey: entry.dedupeKey,
        status: entry.status ?? "sent",
        error: entry.error ?? null,
        metadata: entry.metadata ?? null,
        sentAt: entry.sentAt ?? new Date(),
      })
      .onConflictDoUpdate({
        target: [marketingEmailLog.userId, marketingEmailLog.dedupeKey],
        set: {
          status: entry.status ?? "sent",
          error: entry.error ?? null,
          metadata: entry.metadata ?? null,
          sentAt: entry.sentAt ?? new Date(),
          template: entry.template,
          stage: entry.stage,
          email: entry.email,
        },
      });
  } catch (error) {
    console.error("[MarketingEmail] log failed", error);
    throw new AppError(
      "bad_request:database",
      `Failed to record marketing email log. ${error}`,
    );
  }
}

export async function getRecentMarketingEmailLogs({
  userId,
  stage,
  since,
}: {
  userId: string;
  stage?: string;
  since?: Date;
}) {
  try {
    const conditions: SQL[] = [eq(marketingEmailLog.userId, userId)];
    if (stage) {
      conditions.push(eq(marketingEmailLog.stage, stage));
    }
    if (since) {
      conditions.push(gte(marketingEmailLog.sentAt, since));
    }

    if (conditions.length === 1) {
      return await db
        .select()
        .from(marketingEmailLog)
        .where(conditions[0])
        .orderBy(desc(marketingEmailLog.sentAt));
    }

    return await db
      .select()
      .from(marketingEmailLog)
      .where(and(...conditions))
      .orderBy(desc(marketingEmailLog.sentAt));
  } catch (error) {
    console.error("[MarketingEmail] query logs failed", error);
    throw new AppError(
      "bad_request:database",
      `Failed to fetch marketing email logs. ${error}`,
    );
  }
}

export async function saveFeedback(
  data: Omit<Feedback, "id" | "createdAt">,
): Promise<Feedback> {
  const [newFeedback] = await db
    .insert(feedback)
    .values({
      ...(data as any), // Use type assertion to support extra fields
      // Ensure required fields have default values (compatible with simplified API)
      type: (data as any).type || "general",
      title:
        (data as any).title || data.content?.substring(0, 50) || "Feedback",
      description: (data as any).description || data.content || "",
      status: (data as any).status || "open",
      priority: (data as any).priority || "medium",
      updatedAt: new Date(),
      id: generateUUID(),
      createdAt: new Date(),
    })
    .returning();

  if (!newFeedback) {
    throw new Error("Failed to save feedback");
  }

  return newFeedback;
}

/**
 * Save survey results
 * @param data - Survey data (excluding id and submittedAt, these are auto-generated)
 * @returns Complete saved Survey record
 */
export async function saveSurvey(
  data: Omit<Survey, "id" | "submittedAt">,
): Promise<Survey> {
  const normalizedRoleList = Array.from(
    new Set(
      (data.roles?.length ? data.roles : data.role ? [data.role] : []).filter(
        (roleKey) => typeof roleKey === "string" && roleKey.trim().length > 0,
      ),
    ),
  );
  const primaryRole = normalizedRoleList[0] ?? data.role ?? "other";
  const submissionTimestamp = new Date();
  const normalizedWorkDescription =
    typeof data.workDescription === "string" ? data.workDescription.trim() : "";
  const workDescriptionValue =
    normalizedWorkDescription.length > 0 ? normalizedWorkDescription : null;

  // SQLite column is text, arrays need to be serialized to JSON string to avoid better-sqlite3 parameter binding errors
  const rolesJson =
    typeof data.roles === "string"
      ? data.roles
      : serializeJson(normalizedRoleList);
  const communicationToolsJson =
    typeof data.communicationTools === "string"
      ? data.communicationTools
      : serializeJson(data.communicationTools ?? []);
  const challengesJson =
    typeof data.challenges === "string"
      ? data.challenges
      : serializeJson(data.challenges ?? []);

  return await executeTransaction(async (tx) => {
    const [newSurvey] = await tx
      .insert(survey)
      .values({
        ...data,
        role: primaryRole,
        roles: rolesJson,
        communicationTools: communicationToolsJson,
        challenges: challengesJson,
        workDescription: workDescriptionValue,
        id: generateUUID(),
        submittedAt: submissionTimestamp,
      })
      .returning();

    if (!newSurvey) {
      throw new Error("Failed to save survey: No record returned after insert");
    }

    // Replace survey-derived roles for the user
    await tx
      .delete(userRoles)
      .where(
        and(eq(userRoles.userId, data.userId), eq(userRoles.source, "survey")),
      );

    // better-sqlite3 single binding parameter limit is ~999, batch insert to avoid "Too many parameter values were provided"
    const USER_ROLES_INSERT_CHUNK = 100;
    if (normalizedRoleList.length > 0) {
      const rows = normalizedRoleList.map((roleKey) => ({
        id: generateUUID(),
        userId: data.userId,
        roleKey,
        source: "survey",
        confidence: 0.9,
        lastConfirmedAt: submissionTimestamp,
        evidence: serializeJson({
          kind: "survey",
          submittedAt: submissionTimestamp.toISOString(),
        }),
      }));
      for (let i = 0; i < rows.length; i += USER_ROLES_INSERT_CHUNK) {
        const chunk = rows.slice(i, i + USER_ROLES_INSERT_CHUNK);
        await tx.insert(userRoles).values(chunk);
      }
    }

    return newSurvey;
  });
}

/**
 * Get user's most recent submitted survey
 * @param userId - User ID
 */
export async function getLatestSurveyByUserId(
  userId: string,
): Promise<Survey | null> {
  const [latestSurvey] = await db
    .select()
    .from(survey)
    .where(eq(survey.userId, userId))
    .orderBy(desc(survey.submittedAt))
    .limit(1);

  return latestSurvey ?? null;
}

export async function getUserRoles(userId: string): Promise<UserRole[]> {
  return await db
    .select()
    .from(userRoles)
    .where(eq(userRoles.userId, userId))
    .orderBy(desc(userRoles.confidence), desc(userRoles.updatedAt));
}

export async function upsertUserRole(input: {
  userId: string;
  roleKey: string;
  source: string;
  confidence: number;
  evidence?: Record<string, unknown> | null;
  lastConfirmedAt?: Date | null;
}): Promise<UserRole> {
  const now = new Date();
  const [record] = await db
    .insert(userRoles)
    .values({
      id: generateUUID(),
      userId: input.userId,
      roleKey: input.roleKey,
      source: input.source,
      confidence: input.confidence,
      evidence: serializeJson(input.evidence),
      lastConfirmedAt: input.lastConfirmedAt ?? now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [userRoles.userId, userRoles.roleKey, userRoles.source],
      set: {
        confidence: input.confidence,
        evidence: serializeJson(input.evidence),
        lastConfirmedAt: input.lastConfirmedAt ?? now,
        updatedAt: now,
      },
    })
    .returning();

  if (!record) {
    throw new Error("Failed to upsert user role");
  }

  return record;
}

export async function removeUserRole(input: {
  userId: string;
  roleKey: string;
  source?: string;
}) {
  await db
    .delete(userRoles)
    .where(
      input.source
        ? and(
            eq(userRoles.userId, input.userId),
            eq(userRoles.roleKey, input.roleKey),
            eq(userRoles.source, input.source),
          )
        : and(
            eq(userRoles.userId, input.userId),
            eq(userRoles.roleKey, input.roleKey),
          ),
    );
}

function buildFilterWhereClause(userId: string, includeArchived?: boolean) {
  const baseCondition = eq(insightFilters.userId, userId);
  if (includeArchived) {
    return baseCondition;
  }
  return and(baseCondition, eq(insightFilters.isArchived, false));
}

export async function listInsightFilters(input: {
  userId: string;
  includeArchived?: boolean;
}): Promise<DBInsightFilter[]> {
  return await db
    .select()
    .from(insightFilters)
    .where(buildFilterWhereClause(input.userId, input.includeArchived))
    .orderBy(
      desc(insightFilters.isPinned),
      asc(insightFilters.sortOrder),
      desc(insightFilters.createdAt),
    );
}

export async function getInsightFilterById(input: {
  userId: string;
  filterId: string;
}): Promise<DBInsightFilter | null> {
  const [record] = await db
    .select()
    .from(insightFilters)
    .where(
      and(
        eq(insightFilters.userId, input.userId),
        eq(insightFilters.id, input.filterId),
      ),
    )
    .limit(1);
  return record ?? null;
}

export async function getInsightFilterBySlug(input: {
  userId: string;
  slug: string;
}): Promise<DBInsightFilter | null> {
  const [record] = await db
    .select()
    .from(insightFilters)
    .where(
      and(
        eq(insightFilters.userId, input.userId),
        eq(insightFilters.slug, input.slug),
      ),
    )
    .limit(1);
  return record ?? null;
}

export async function createInsightFilterForUser(input: {
  userId: string;
  payload: InsightFilterCreatePayload;
}): Promise<DBInsightFilter> {
  try {
    return await executeTransaction(async (tx) => {
      const [{ value: existingCount }] = await tx
        .select({ value: count() })
        .from(insightFilters)
        .where(
          and(
            eq(insightFilters.userId, input.userId),
            eq(insightFilters.isArchived, false),
          ),
        );

      if (existingCount >= MAX_CUSTOM_INSIGHT_FILTERS) {
        throw new AppError(
          "bad_request:insight",
          `You can create up to ${MAX_CUSTOM_INSIGHT_FILTERS} filters.`,
        );
      }

      const [slugConflict] = await tx
        .select({ id: insightFilters.id })
        .from(insightFilters)
        .where(
          and(
            eq(insightFilters.userId, input.userId),
            eq(insightFilters.slug, input.payload.slug),
          ),
        )
        .limit(1);

      if (slugConflict) {
        throw new AppError(
          "bad_request:insight",
          "Another filter already uses this slug.",
        );
      }

      const [record] = await tx
        .insert(insightFilters)
        .values({
          id: generateUUID(),
          userId: input.userId,
          label: input.payload.label,
          slug: input.payload.slug,
          description:
            input.payload.description && input.payload.description.length > 0
              ? input.payload.description
              : null,
          color: input.payload.color ?? null,
          icon: input.payload.icon ?? null,
          sortOrder: input.payload.sortOrder ?? existingCount,
          isPinned: input.payload.isPinned ?? false,
          definition: serializeJson(input.payload.definition as any) as any,
          source: "user",
        })
        .returning();

      if (!record) {
        throw new AppError(
          "bad_request:insight",
          "Failed to insert insight filter",
        );
      }

      return record;
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    console.error("[InsightFilters] Create failed", error);
    throw new AppError(
      "bad_request:insight",
      "Unable to create insight filter",
    );
  }
}

export async function updateInsightFilterForUser(input: {
  userId: string;
  filterId: string;
  payload: InsightFilterUpdatePayload;
}): Promise<DBInsightFilter | null> {
  try {
    return await executeTransaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(insightFilters)
        .where(
          and(
            eq(insightFilters.id, input.filterId),
            eq(insightFilters.userId, input.userId),
          ),
        )
        .limit(1);

      if (!existing) {
        return null;
      }

      if (
        input.payload.slug &&
        input.payload.slug.toLowerCase() !== existing.slug.toLowerCase()
      ) {
        const [slugConflict] = await tx
          .select({ id: insightFilters.id })
          .from(insightFilters)
          .where(
            and(
              eq(insightFilters.userId, input.userId),
              eq(insightFilters.slug, input.payload.slug),
            ),
          )
          .limit(1);
        if (slugConflict) {
          throw new AppError(
            "bad_request:insight",
            "Another filter already uses this slug.",
          );
        }
      }

      const updateFields: Partial<DBInsertInsightFilter> = {
        updatedAt: new Date(),
      };

      if (input.payload.label !== undefined) {
        updateFields.label = input.payload.label;
      }
      if (input.payload.slug !== undefined) {
        updateFields.slug = input.payload.slug;
      }
      if (input.payload.description !== undefined) {
        updateFields.description =
          input.payload.description.length > 0
            ? input.payload.description
            : null;
      }
      if (input.payload.color !== undefined) {
        updateFields.color =
          input.payload.color && input.payload.color.length > 0
            ? input.payload.color
            : null;
      }
      if (input.payload.icon !== undefined) {
        updateFields.icon =
          input.payload.icon && input.payload.icon.length > 0
            ? input.payload.icon
            : null;
      }
      if (input.payload.sortOrder !== undefined) {
        updateFields.sortOrder = input.payload.sortOrder;
      }
      if (input.payload.isPinned !== undefined) {
        updateFields.isPinned = input.payload.isPinned;
      }
      if (input.payload.isArchived !== undefined) {
        updateFields.isArchived = input.payload.isArchived;
      }
      if (input.payload.definition !== undefined) {
        updateFields.definition = input.payload.definition;
      }

      const [record] = await tx
        .update(insightFilters)
        .set(updateFields)
        .where(
          and(
            eq(insightFilters.id, input.filterId),
            eq(insightFilters.userId, input.userId),
          ),
        )
        .returning();

      return record ?? null;
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    console.error("[InsightFilters] Update failed", error);
    throw new AppError(
      "bad_request:insight",
      "Unable to update insight filter",
    );
  }
}

export async function removeInsightFilterForUser(input: {
  userId: string;
  filterId: string;
  hardDelete?: boolean;
}): Promise<boolean> {
  if (input.hardDelete) {
    const deleted = await db
      .delete(insightFilters)
      .where(
        and(
          eq(insightFilters.userId, input.userId),
          eq(insightFilters.id, input.filterId),
        ),
      )
      .returning({ id: insightFilters.id });
    return deleted.length > 0;
  }

  const [record] = await db
    .update(insightFilters)
    .set({
      isArchived: true,
      isPinned: false,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(insightFilters.userId, input.userId),
        eq(insightFilters.id, input.filterId),
      ),
    )
    .returning({ id: insightFilters.id });
  return Boolean(record);
}

/**
 * Insight Tabs CRUD operations
 */

/**
 * Get all insight tabs for a user
 */
export async function getUserInsightTabs(
  userId: string,
): Promise<DBInsightTab[]> {
  return await db
    .select()
    .from(insightTabs)
    .where(eq(insightTabs.userId, userId))
    .orderBy(asc(insightTabs.sortOrder), desc(insightTabs.createdAt));
}

/**
 * Create a new insight tab
 */
export async function createInsightTab(input: {
  userId: string;
  name: string;
  filter: InsightFilterDefinition;
}): Promise<DBInsightTab> {
  const [tab] = await db
    .insert(insightTabs)
    .values({
      id: generateUUID(),
      userId: input.userId,
      name: input.name,
      filter: serializeJson(input.filter as any) as any,
      type: "custom",
      enabled: true,
      sortOrder: 0,
    })
    .returning();

  if (!tab) {
    throw new AppError("bad_request:database", "Failed to create insight tab");
  }

  return tab;
}

/**
 * Update an insight tab
 */
export async function updateInsightTab(input: {
  userId: string;
  tabId: string;
  payload: {
    name?: string;
    filter?: InsightFilterDefinition;
    enabled?: boolean;
  };
}): Promise<DBInsightTab | null> {
  const updateFields: Partial<DBInsertInsightTab> = {
    updatedAt: new Date(),
  };

  if (input.payload.name !== undefined) {
    updateFields.name = input.payload.name;
  }
  if (input.payload.filter !== undefined) {
    updateFields.filter = input.payload.filter;
  }
  if (input.payload.enabled !== undefined) {
    updateFields.enabled = input.payload.enabled;
  }

  const [tab] = await db
    .update(insightTabs)
    .set(updateFields)
    .where(
      and(
        eq(insightTabs.id, input.tabId),
        eq(insightTabs.userId, input.userId),
      ),
    )
    .returning();

  return tab ?? null;
}

/**
 * Delete an insight tab
 */
export async function deleteInsightTab(input: {
  userId: string;
  tabId: string;
}): Promise<{ id: string } | null> {
  const [deleted] = await db
    .delete(insightTabs)
    .where(
      and(
        eq(insightTabs.id, input.tabId),
        eq(insightTabs.userId, input.userId),
      ),
    )
    .returning({ id: insightTabs.id });

  return deleted ?? null;
}

/**
 * Reorder tabs
 */
export async function reorderInsightTabs(input: {
  userId: string;
  tabIds: string[];
}): Promise<boolean> {
  try {
    await executeTransaction(async (tx) => {
      for (let i = 0; i < input.tabIds.length; i++) {
        await tx
          .update(insightTabs)
          .set({ sortOrder: i, updatedAt: new Date() })
          .where(
            and(
              eq(insightTabs.id, input.tabIds[i]),
              eq(insightTabs.userId, input.userId),
            ),
          );
      }
    });
    return true;
  } catch (error) {
    console.error("Failed to reorder insight tabs:", error);
    throw new AppError(
      "bad_request:database",
      "Failed to reorder insight tabs",
    );
  }
}

export async function getPersonCustomFields(
  userId: string,
  personId: string,
): Promise<DBPersonCustomFields | null> {
  const [record] = await db
    .select()
    .from(personCustomFields)
    .where(
      and(
        eq(personCustomFields.userId, userId),
        eq(personCustomFields.personId, personId),
      ),
    )
    .limit(1);
  return record ?? null;
}

export async function getPersonCustomFieldMap(
  userId: string,
): Promise<Record<string, Record<string, string>>> {
  const rows = await db
    .select()
    .from(personCustomFields)
    .where(eq(personCustomFields.userId, userId));

  const map: Record<string, Record<string, string>> = {};
  for (const row of rows) {
    // Deserialize fields (SQLite mode)
    const fields = isTauriMode()
      ? typeof row.fields === "string"
        ? JSON.parse(row.fields)
        : row.fields
      : row.fields;
    map[row.personId.toLowerCase()] = fields ?? {};
  }
  return map;
}

export async function upsertPersonCustomFields(input: {
  userId: string;
  personId: string;
  fields: Record<string, string>;
}): Promise<DBPersonCustomFields> {
  const [record] = await db
    .insert(personCustomFields)
    .values({
      id: generateUUID(),
      userId: input.userId,
      personId: input.personId,
      fields: serializeJson(input.fields as any) as any,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [personCustomFields.userId, personCustomFields.personId],
      set: {
        fields: serializeJson(input.fields as any) as any,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!record) {
    throw new AppError(
      "bad_request:database",
      "Failed to persist person custom fields",
    );
  }
  return record;
}

// ===== RAG Queries =====

export interface RagDocumentWithChunks {
  id: string;
  userId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  totalChunks: number;
  uploadedAt: Date;
  chunks?: Array<{
    id: string;
    chunkIndex: number;
    content: string;
  }>;
}

export async function createRagDocument(input: {
  userId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  totalChunks: number;
}): Promise<RagDocumentWithChunks> {
  const [doc] = await db
    .insert(ragDocuments)
    .values({
      id: generateUUID(),
      userId: input.userId,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      totalChunks: input.totalChunks,
    })
    .returning();

  if (!doc) {
    throw new AppError("bad_request:database", "Failed to create RAG document");
  }

  return doc;
}

export async function getRagDocumentsByUserId(
  userId: string,
): Promise<RagDocumentWithChunks[]> {
  return await db
    .select({
      id: ragDocuments.id,
      userId: ragDocuments.userId,
      fileName: ragDocuments.fileName,
      contentType: ragDocuments.contentType,
      sizeBytes: ragDocuments.sizeBytes,
      totalChunks: ragDocuments.totalChunks,
      uploadedAt: ragDocuments.uploadedAt,
    })
    .from(ragDocuments)
    .where(eq(ragDocuments.userId, userId))
    .orderBy(desc(ragDocuments.uploadedAt));
}

export async function getRagDocumentById(
  id: string,
  userId: string,
): Promise<RagDocumentWithChunks | null> {
  const [doc] = await db
    .select()
    .from(ragDocuments)
    .where(and(eq(ragDocuments.id, id), eq(ragDocuments.userId, userId)));

  return doc ?? null;
}

export async function deleteRagDocument(
  id: string,
  userId: string,
): Promise<void> {
  await db
    .delete(ragDocuments)
    .where(and(eq(ragDocuments.id, id), eq(ragDocuments.userId, userId)));

  // Chunks are deleted automatically via CASCADE
}

export async function createRagChunks(
  chunks: Array<{
    documentId: string;
    userId: string;
    chunkIndex: number;
    content: string;
    embedding: string; // JSON stringified array
  }>,
): Promise<void> {
  if (chunks.length === 0) return;

  // Batch insert to avoid SQLite parameter binding limit
  for (let i = 0; i < chunks.length; i += DB_INSERT_CHUNK_SIZE) {
    const chunk = chunks.slice(i, i + DB_INSERT_CHUNK_SIZE);
    await db.insert(ragChunks).values(chunk);
  }
}

export interface RagChunkWithDocument {
  id: string;
  documentId: string;
  userId: string;
  chunkIndex: number;
  content: string;
  similarity?: number;
  documentName: string;
}

export async function searchRagChunksByEmbedding(
  userId: string,
  embedding: number[],
  limit = 5,
  threshold = 0.7,
): Promise<RagChunkWithDocument[]> {
  if (isTauriMode()) {
    // SQLite: Does not support vector operations, use text matching instead
    // Return all chunks and calculate similarity at application layer (simplified version)
    const allChunks = await db
      .select({
        id: ragChunks.id,
        documentId: ragChunks.documentId,
        userId: ragChunks.userId,
        chunkIndex: ragChunks.chunkIndex,
        content: ragChunks.content,
        documentName: ragDocuments.fileName,
      })
      .from(ragChunks)
      .innerJoin(ragDocuments, eq(ragChunks.documentId, ragDocuments.id))
      .where(eq(ragChunks.userId, userId))
      .limit(limit * 2); // Get more results for filtering

    // Simplified version: return first N results directly, without real vector similarity calculation
    // TODO: Implement cosine similarity calculation at application layer
    return allChunks.slice(0, limit).map((chunk: any) => ({
      ...chunk,
      similarity: 1.0, // Return default similarity in SQLite mode
    }));
  }
  const embeddingStr = `[${embedding.join(",")}]`;

  const results = await db.execute(
    sql`
        SELECT
          rc.id,
          rc.document_id as "documentId",
          rc.user_id as "userId",
          rc.chunk_index as "chunkIndex",
          rc.content,
          rd.file_name as "documentName",
          1 - (rc.embedding::vector <=> ${embeddingStr}::vector) as similarity
        FROM rag_chunks rc
        JOIN rag_documents rd ON rc.document_id = rd.id
        WHERE rc.user_id = ${userId}
          AND (rc.embedding::vector <=> ${embeddingStr}::vector) < ${1 - threshold}
        ORDER BY rc.embedding::vector <=> ${embeddingStr}::vector ASC
        LIMIT ${limit}
      `,
  );

  // Type assertion for the raw SQL result
  return (results as unknown as { rows: RagChunkWithDocument[] }).rows;
}

export async function getRagChunksByDocumentId(
  documentId: string,
  userId: string,
): Promise<Array<{ id: string; chunkIndex: number; content: string }>> {
  return await db
    .select({
      id: ragChunks.id,
      chunkIndex: ragChunks.chunkIndex,
      content: ragChunks.content,
    })
    .from(ragChunks)
    .where(
      and(eq(ragChunks.documentId, documentId), eq(ragChunks.userId, userId)),
    )
    .orderBy(asc(ragChunks.chunkIndex));
}

/**
 * Get all categories for a user
 */
export async function getUserCategories(
  userId: string,
): Promise<DBUserCategory[]> {
  return await db
    .select()
    .from(userCategories)
    .where(eq(userCategories.userId, userId))
    .orderBy(asc(userCategories.sortOrder), asc(userCategories.name));
}

/**
 * Get user's category by name (used for duplicate name check)
 */
export async function getUserCategoryByName(
  userId: string,
  name: string,
): Promise<DBUserCategory | null> {
  const [category] = await db
    .select()
    .from(userCategories)
    .where(
      and(eq(userCategories.userId, userId), eq(userCategories.name, name)),
    )
    .limit(1);
  return category ?? null;
}

/**
 * Get category by ID
 */
export async function getUserCategoryById(
  categoryId: string,
): Promise<DBUserCategory | null> {
  const [category] = await db
    .select()
    .from(userCategories)
    .where(eq(userCategories.id, categoryId))
    .limit(1);
  return category ?? null;
}

/**
 * Create user category
 */
export async function createUserCategory(
  userId: string,
  category: {
    name: string;
    description?: string | null;
    isActive?: boolean;
    sortOrder?: number;
  },
): Promise<DBUserCategory> {
  // Check if name already exists
  const existing = await getUserCategoryByName(userId, category.name);
  if (existing) {
    throw new AppError(
      "bad_request:category",
      `Category with name "${category.name}" already exists.`,
    );
  }

  const [newCategory] = await db
    .insert(userCategories)
    .values({
      id: generateUUID(),
      userId,
      name: category.name,
      description: category.description ?? null,
      isActive: category.isActive ?? true,
      sortOrder: category.sortOrder ?? 0,
    })
    .returning();

  if (!newCategory) {
    throw new AppError("offline:category", "Failed to create category");
  }

  return newCategory;
}

/**
 * Update user category
 */
export async function updateUserCategory(
  categoryId: string,
  userId: string,
  updates: {
    name?: string;
    description?: string | null;
    isActive?: boolean;
    sortOrder?: number;
  },
): Promise<DBUserCategory> {
  // If updating name, check if new name conflicts with other categories
  if (updates.name) {
    const existing = await getUserCategoryByName(userId, updates.name);
    if (existing && existing.id !== categoryId) {
      throw new AppError(
        "bad_request:category",
        `Category with name "${updates.name}" already exists.`,
      );
    }
  }

  // Verify category belongs to this user
  const category = await getUserCategoryById(categoryId);
  if (!category || category.userId !== userId) {
    throw new AppError(
      "not_found:category",
      "Category not found or access denied",
    );
  }

  const [updated] = await db
    .update(userCategories)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(userCategories.id, categoryId))
    .returning();

  if (!updated) {
    throw new AppError("offline:category", "Failed to update category");
  }

  return updated;
}

/**
 * Delete user category
 */
export async function deleteUserCategory(
  categoryId: string,
  userId: string,
): Promise<void> {
  // Verify category belongs to this user
  const category = await getUserCategoryById(categoryId);
  if (!category || category.userId !== userId) {
    throw new AppError(
      "not_found:category",
      "Category not found or access denied",
    );
  }

  await db.delete(userCategories).where(eq(userCategories.id, categoryId));
}

/**
 * Batch update category sorting order
 */
export async function updateUserCategoriesSortOrder(
  userId: string,
  sortOrders: Array<{ id: string; sortOrder: number }>,
): Promise<void> {
  await executeTransaction(async (tx) => {
    for (const item of sortOrders) {
      await tx
        .update(userCategories)
        .set({
          sortOrder: item.sortOrder,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(userCategories.id, item.id),
            eq(userCategories.userId, userId),
          ),
        );
    }
  });
}

/**
 * Search events (Insights)
 * @param userId - User ID
 * @param query - Search keyword
 * @param limit - Result limit
 * @returns Search result array
 */
export async function searchEvents(
  userId: string,
  query: string,
  limit = 20,
): Promise<Insight[]> {
  try {
    // Get all bots for user
    const bots = await getBotsByUserId({
      id: userId,
      limit: null,
      startingAfter: null,
      endingBefore: null,
      onlyEnable: false,
    });

    if (bots.bots.length === 0) {
      return [];
    }

    const botIds = bots.bots.map((bot) => bot.id);
    const searchPattern = `%${query}%`;

    const results = await db
      .select()
      .from(insight)
      .where(
        and(
          inArray(insight.botId, botIds),
          or(
            caseInsensitiveSearch(insight.title, searchPattern),
            caseInsensitiveSearch(insight.description, searchPattern),
          ),
        ),
      )
      .orderBy(desc(insight.time))
      .limit(limit);

    // Deserialize JSON fields (SQLite mode)
    if (isTauriMode()) {
      return results.map((insight: any) => normalizeInsight(insight));
    }
    return results;
  } catch (error) {
    console.error("Failed to search events:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to search events. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Search chat history (Chats)
 * @param userId - User ID
 * @param query - Search keyword
 * @param limit - Result limit
 * @returns Search result array
 */
export async function searchChats(
  userId: string,
  query: string,
  limit = 20,
): Promise<
  Array<{
    id: string;
    title: string;
    latestMessageContent: string | null;
    latestMessageTime: Date | null;
  }>
> {
  try {
    const searchPattern = `%${query}%`;

    // Search chat titles
    const chats = await db
      .select({
        id: chat.id,
        title: chat.title,
      })
      .from(chat)
      .where(
        and(
          eq(chat.userId, userId),
          caseInsensitiveSearch(chat.title, searchPattern),
        ),
      )
      .orderBy(desc(chat.createdAt))
      .limit(limit);

    // Get latest message content for each chat
    const chatsWithMessages = await Promise.all(
      chats.map(async (c: { id: string; title: string | null }) => {
        const [latestMessage] = await db
          .select({
            createdAt: message.createdAt,
            parts: message.parts,
          })
          .from(message)
          .where(eq(message.chatId, c.id))
          .orderBy(desc(message.createdAt))
          .limit(1);

        let latestMessageContent: string | null = null;
        if (latestMessage?.parts) {
          type MessagePart = { type?: string; text?: string };
          const parts = Array.isArray(latestMessage.parts)
            ? (latestMessage.parts as MessagePart[])
            : [];
          const textParts = parts
            .filter(
              (
                part,
              ): part is Required<Pick<MessagePart, "text">> & MessagePart =>
                part?.type === "text" && typeof part.text === "string",
            )
            .map((part) => part.text);
          latestMessageContent = textParts.join("");
        }

        return {
          id: c.id,
          title: c.title,
          latestMessageContent,
          latestMessageTime: latestMessage?.createdAt ?? null,
        };
      }),
    );

    return chatsWithMessages;
  } catch (error) {
    console.error("Failed to search chats:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to search chats. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Search action items (Tasks)
 * Extracts tasks from Insights for search
 * @param userId - User ID
 * @param query - Search keyword
 * @param limit - Result limit
 * @returns Search result array
 */
export async function searchTasks(
  userId: string,
  query: string,
  limit = 20,
): Promise<
  Array<{
    id: string;
    title: string;
    context: string | null;
    insightId: string;
  }>
> {
  try {
    const bots = await getBotsByUserId({
      id: userId,
      limit: null,
      startingAfter: null,
      endingBefore: null,
      onlyEnable: false,
    });

    if (bots.bots.length === 0) {
      return [];
    }

    const botIds = bots.bots.map((bot) => bot.id);
    const searchPattern = query.toLowerCase();

    // Get all insights
    const insights = await db
      .select({
        id: insight.id,
        myTasks: insight.myTasks,
        waitingForMe: insight.waitingForMe,
        waitingForOthers: insight.waitingForOthers,
      })
      .from(insight)
      .where(inArray(insight.botId, botIds));

    const results: Array<{
      id: string;
      title: string;
      context: string | null;
      insightId: string;
    }> = [];

    // Iterate through all insights, search for tasks
    for (const insightItem of insights) {
      const buckets = [
        insightItem.myTasks,
        insightItem.waitingForMe,
        insightItem.waitingForOthers,
      ] as Array<InsightTaskItem[] | null | undefined>;

      for (const tasks of buckets) {
        // Parse JSON string to array for SQLite
        const parsedTasks = deserializeJson(tasks ?? []);
        if (!Array.isArray(parsedTasks)) continue;

        for (const task of parsedTasks) {
          const title = (task.title || "").toLowerCase();
          const context = (task.context || "").toLowerCase();

          if (
            title.includes(searchPattern) ||
            context.includes(searchPattern)
          ) {
            const taskId = task.id || `${insightItem.id}|${task.title}`;
            results.push({
              id: taskId,
              title: task.title || "Untitled task",
              context: task.context || null,
              insightId: insightItem.id,
            });

            if (results.length >= limit) {
              return results;
            }
          }
        }
      }
    }

    return results;
  } catch (error) {
    console.error("Failed to search tasks:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to search tasks. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * List all action items in user space (for @ mentions, etc.), no keyword filtering, returns up to limit results
 */
export async function listTasksFromInsights(
  userId: string,
  limit = 5,
): Promise<
  Array<{
    id: string;
    title: string;
    context: string | null;
    insightId: string;
  }>
> {
  try {
    const bots = await getBotsByUserId({
      id: userId,
      limit: null,
      startingAfter: null,
      endingBefore: null,
      onlyEnable: false,
    });
    if (bots.bots.length === 0) return [];
    const botIds = bots.bots.map((bot) => bot.id);
    const insights = await db
      .select({
        id: insight.id,
        myTasks: insight.myTasks,
        waitingForMe: insight.waitingForMe,
        waitingForOthers: insight.waitingForOthers,
      })
      .from(insight)
      .where(inArray(insight.botId, botIds));

    const results: Array<{
      id: string;
      title: string;
      context: string | null;
      insightId: string;
    }> = [];

    for (const insightItem of insights) {
      const buckets = [
        insightItem.myTasks,
        insightItem.waitingForMe,
        insightItem.waitingForOthers,
      ] as Array<InsightTaskItem[] | null | undefined>;
      for (const tasks of buckets) {
        const parsedTasks = deserializeJson(tasks ?? []);
        if (!Array.isArray(parsedTasks)) continue;
        for (const task of parsedTasks) {
          const taskId = task.id || `${insightItem.id}|${task.title}`;
          results.push({
            id: taskId,
            title: task.title || "Untitled task",
            context: task.context ?? null,
            insightId: insightItem.id,
          });
          if (results.length >= limit) return results;
        }
      }
    }
    return results;
  } catch (error) {
    console.error("Failed to list tasks:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to list tasks. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Search people (People)
 * @param userId - User ID
 * @param query - Search keyword
 * @param limit - Result limit
 * @returns Search result array
 */
export async function searchPeople(
  userId: string,
  query: string,
  limit = 20,
): Promise<
  Array<{
    id: string;
    name: string;
    contactMeta: Record<string, unknown> | null;
  }>
> {
  try {
    const searchPattern = `%${query}%`;

    const contacts = await db
      .select({
        id: userContacts.contactId,
        name: userContacts.contactName,
        contactMeta: userContacts.contactMeta,
      })
      .from(userContacts)
      .where(
        and(
          eq(userContacts.userId, userId),
          caseInsensitiveSearch(userContacts.contactName, searchPattern),
        ),
      )
      .orderBy(userContacts.contactName)
      .limit(limit);

    return contacts.map(
      (c: {
        id: string;
        name: string;
        contactMeta: Record<string, unknown> | null;
      }) => ({
        id: c.id,
        name: c.name,
        contactMeta: c.contactMeta,
      }),
    );
  } catch (error) {
    console.error("Failed to search people:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to search people. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Search information sources (Sources)
 * Includes RSS subscriptions and integration accounts
 * @param userId - User ID
 * @param query - Search keyword
 * @param limit - Result limit
 * @returns Search result array
 */
export async function searchSources(
  userId: string,
  query: string,
  limit = 20,
): Promise<Array<{ id: string; name: string; type: string }>> {
  try {
    const searchPattern = `%${query}%`;
    const results: Array<{ id: string; name: string; type: string }> = [];

    // Search RSS subscriptions
    const rssResults = await db
      .select({
        id: rssSubscriptions.id,
        title: rssSubscriptions.title,
        sourceUrl: rssSubscriptions.sourceUrl,
      })
      .from(rssSubscriptions)
      .where(
        and(
          eq(rssSubscriptions.userId, userId),
          or(
            caseInsensitiveSearch(rssSubscriptions.title, searchPattern),
            caseInsensitiveSearch(rssSubscriptions.sourceUrl, searchPattern),
          ),
        ),
      )
      .limit(Math.floor(limit / 2));

    results.push(
      ...rssResults.map(
        (rss: { id: string; title: string | null; sourceUrl: string }) => ({
          id: rss.id,
          name: rss.title || rss.sourceUrl,
          type: "rss",
        }),
      ),
    );

    // Search integration accounts
    const integrationResults = await db
      .select({
        id: integrationAccounts.id,
        platform: integrationAccounts.platform,
        displayName: integrationAccounts.displayName,
      })
      .from(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          or(
            caseInsensitiveSearch(integrationAccounts.platform, searchPattern),
            caseInsensitiveSearch(
              integrationAccounts.displayName,
              searchPattern,
            ),
          ),
        ),
      )
      .limit(Math.floor(limit / 2));

    results.push(
      ...integrationResults.map(
        (acc: { id: string; platform: string; displayName: string }) => ({
          id: acc.id,
          name: acc.displayName || acc.platform,
          type: acc.platform,
        }),
      ),
    );

    return results.slice(0, limit);
  } catch (error) {
    console.error("Failed to search sources:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to search sources. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Search files (Files)
 * Search RAG documents
 * @param userId - User ID
 * @param query - Search keyword
 * @param limit - Result limit
 * @returns Search result array
 */
export async function searchFiles(
  userId: string,
  query: string,
  limit = 20,
): Promise<Array<{ id: string; name: string; createdAt: Date }>> {
  try {
    const searchPattern = `%${query}%`;

    const documents = await db
      .select({
        id: ragDocuments.id,
        name: ragDocuments.fileName,
        uploadedAt: ragDocuments.uploadedAt,
      })
      .from(ragDocuments)
      .where(
        and(
          eq(ragDocuments.userId, userId),
          caseInsensitiveSearch(ragDocuments.fileName, searchPattern),
        ),
      )
      .orderBy(desc(ragDocuments.uploadedAt))
      .limit(limit);

    return documents.map(
      (doc: { id: string; name: string; uploadedAt: Date }) => ({
        id: doc.id,
        name: doc.name,
        createdAt: doc.uploadedAt,
      }),
    );
  } catch (error) {
    console.error("Failed to search files:", error);
    throw new AppError(
      "bad_request:database",
      `Failed to search files. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ============================================================================
// Insight Processing Failures - Automatic Retry Mechanism
// ============================================================================

/**
 * Maximum number of consecutive failures before marking a group as skipped
 */
const MAX_FAILURE_COUNT = 5;

/**
 * Record a group processing failure for automatic retry
 * @param params - Contains botId, groupName, processedSince timestamp, and error
 */
export async function recordInsightFailure({
  botId,
  groupName,
  processedSince,
  error,
}: {
  botId: string;
  groupName: string;
  processedSince: number;
  error: Error;
}) {
  try {
    const db = getDb();

    // Check if record already exists
    const existing = await db
      .select()
      .from(insightProcessingFailures)
      .where(
        and(
          eq(insightProcessingFailures.botId, botId),
          eq(insightProcessingFailures.groupName, groupName),
        ),
      )
      .limit(1);

    const now = new Date();

    if (existing.length > 0) {
      // Update existing record
      const record = existing[0];
      const newFailureCount = record.failureCount + 1;
      const newStatus =
        newFailureCount >= MAX_FAILURE_COUNT ? "skipped" : "pending";

      await db
        .update(insightProcessingFailures)
        .set({
          failureCount: newFailureCount,
          status: newStatus,
          lastError: error.message,
          lastAttemptedAt: now,
          processedSince,
          updatedAt: now,
        })
        .where(eq(insightProcessingFailures.id, record.id));

      console.warn(
        `[Insight Failures] Updated failure record for bot ${botId} group "${groupName}": count=${newFailureCount}, status=${newStatus}`,
      );
    } else {
      // Insert new record
      const insert: InsertInsightProcessingFailure = {
        botId,
        groupName,
        failureCount: 1,
        status: "pending",
        lastError: error.message,
        lastAttemptedAt: now,
        processedSince,
        createdAt: now,
        updatedAt: now,
      };

      await db.insert(insightProcessingFailures).values(insert);

      console.warn(
        `[Insight Failures] Recorded failure for bot ${botId} group "${groupName}": since=${new Date(
          processedSince * 1000,
        ).toLocaleString()}, error=${error.message}`,
      );
    }
  } catch (error) {
    // Don't throw - logging failure shouldn't break the main flow
    console.error(
      `[Insight Failures] Failed to record insight failure for bot ${botId} group "${groupName}":`,
      error,
    );
  }
}

/**
 * Get failed groups that need to be retried
 * @param params - Contains botId
 * @returns Array of failed groups with retry info
 */
export async function getFailedGroupsToRetry({
  botId,
}: {
  botId: string;
}): Promise<
  Array<{
    groupName: string;
    processedSince: number;
    failureCount: number;
  }>
> {
  try {
    const db = getDb();

    const records = await db
      .select({
        groupName: insightProcessingFailures.groupName,
        processedSince: insightProcessingFailures.processedSince,
        failureCount: insightProcessingFailures.failureCount,
      })
      .from(insightProcessingFailures)
      .where(
        and(
          eq(insightProcessingFailures.botId, botId),
          inArray(insightProcessingFailures.status, ["pending", "retrying"]),
        ),
      );

    return records;
  } catch (error) {
    console.error(
      `[Insight Failures] Failed to get failed groups for bot ${botId}:`,
      error,
    );
    return [];
  }
}

/**
 * Clear group failure record (called after successful processing)
 * @param params - Contains botId and groupName
 */
export async function clearInsightFailure({
  botId,
  groupName,
}: {
  botId: string;
  groupName: string;
}) {
  try {
    const db = getDb();

    await db
      .delete(insightProcessingFailures)
      .where(
        and(
          eq(insightProcessingFailures.botId, botId),
          eq(insightProcessingFailures.groupName, groupName),
        ),
      );

    console.info(
      `[Insight Failures] Cleared failure record for bot ${botId} group "${groupName}"`,
    );
  } catch (error) {
    // Don't throw - cleanup failure shouldn't break the main flow
    console.error(
      `[Insight Failures] Failed to clear insight failure for bot ${botId} group "${groupName}":`,
      error,
    );
  }
}

/**
 * Mark group as retrying (update status)
 * @param params - Contains botId and groupName
 */
export async function markGroupRetrying({
  botId,
  groupName,
}: {
  botId: string;
  groupName: string;
}) {
  try {
    const db = getDb();

    await db
      .update(insightProcessingFailures)
      .set({
        status: "retrying",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(insightProcessingFailures.botId, botId),
          eq(insightProcessingFailures.groupName, groupName),
        ),
      );

    console.info(
      `[Insight Failures] Marked bot ${botId} group "${groupName}" as retrying`,
    );
  } catch (error) {
    // Don't throw - status update failure shouldn't break the main flow
    console.error(
      `[Insight Failures] Failed to mark group as retrying for bot ${botId} group "${groupName}":`,
      error,
    );
  }
}

/**
 * Cleanup old failure records (N days ago)
 * @param params - Contains days (default 7)
 */
export async function cleanupOldFailureRecords({
  days = 7,
}: {
  days?: number;
} = {}) {
  try {
    const db = getDb();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await db
      .delete(insightProcessingFailures)
      .where(lt(insightProcessingFailures.lastAttemptedAt, cutoffDate))
      .returning();

    console.info(
      `[Insight Failures] Cleaned up ${result.length} old failure records (older than ${days} days)`,
    );

    return result.length;
  } catch (error) {
    console.error(
      `[Insight Failures] Failed to cleanup old failure records:`,
      error,
    );
    return 0;
  }
}

/**
 * Get insights with their associated notes and documents
 * @param params - Contains userId and insightIds
 * @returns Map of insightId to { notes, documents }
 */
export async function getInsightsWithNotesAndDocuments({
  userId,
  insightIds,
}: {
  userId: string;
  insightIds: string[];
}): Promise<
  Map<
    string,
    {
      notes: Array<{
        id: string;
        content: string;
        source: "manual" | "ai_conversation";
        sourceMessageId: string | null;
        createdAt: Date;
        updatedAt: Date;
      }>;
      documents: Array<{
        id: string;
        fileName: string;
        contentType: string;
        sizeBytes: number;
        totalChunks: number;
        uploadedAt: Date;
      }>;
    }
  >
> {
  try {
    if (insightIds.length === 0) {
      return new Map();
    }

    const db = getDb();

    // Fetch all notes for the insights
    const notesResult = await db
      .select({
        insightId: insightNotes.insightId,
        id: insightNotes.id,
        content: insightNotes.content,
        source: insightNotes.source,
        sourceMessageId: insightNotes.sourceMessageId,
        createdAt: insightNotes.createdAt,
        updatedAt: insightNotes.updatedAt,
      })
      .from(insightNotes)
      .where(
        and(
          eq(insightNotes.userId, userId),
          inArray(insightNotes.insightId, insightIds),
        ),
      )
      .orderBy(desc(insightNotes.createdAt));

    // Fetch all documents for the insights
    const documentsResult = await db
      .select({
        insightId: insightDocuments.insightId,
        id: ragDocuments.id,
        fileName: ragDocuments.fileName,
        contentType: ragDocuments.contentType,
        sizeBytes: ragDocuments.sizeBytes,
        totalChunks: ragDocuments.totalChunks,
        uploadedAt: ragDocuments.uploadedAt,
        blobPath: ragDocuments.blobPath,
      })
      .from(insightDocuments)
      .innerJoin(ragDocuments, eq(insightDocuments.documentId, ragDocuments.id))
      .where(
        and(
          eq(insightDocuments.userId, userId),
          inArray(insightDocuments.insightId, insightIds),
        ),
      )
      .orderBy(desc(insightDocuments.createdAt));

    // Build the result map
    const result = new Map<
      string,
      {
        notes: Array<{
          id: string;
          content: string;
          source: "manual" | "ai_conversation";
          sourceMessageId: string | null;
          createdAt: Date;
          updatedAt: Date;
        }>;
        documents: Array<{
          id: string;
          fileName: string;
          contentType: string;
          sizeBytes: number;
          totalChunks: number;
          uploadedAt: Date;
          blobPath: string | null;
        }>;
      }
    >();

    // Initialize map with empty arrays for each insight
    for (const insightId of insightIds) {
      result.set(insightId, { notes: [], documents: [] });
    }

    // Group notes by insightId
    for (const note of notesResult) {
      const insightData = result.get(note.insightId);
      if (insightData) {
        insightData.notes.push({
          id: note.id,
          content: note.content,
          source: note.source as "manual" | "ai_conversation",
          sourceMessageId: note.sourceMessageId,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
        });
      }
    }

    // Group documents by insightId
    for (const doc of documentsResult) {
      const insightData = result.get(doc.insightId);
      if (insightData) {
        insightData.documents.push({
          id: doc.id,
          fileName: doc.fileName,
          contentType: doc.contentType,
          sizeBytes: doc.sizeBytes,
          totalChunks: doc.totalChunks,
          uploadedAt: doc.uploadedAt,
          blobPath: doc.blobPath,
        });
      }
    }

    return result;
  } catch (error) {
    console.error(
      "[Insights] Failed to get insights with notes and documents:",
      error,
    );
    throw new AppError(
      "bad_request:database",
      `Failed to get insights with notes and documents. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** List cached message chat IDs for a DingTalk bot (used by Insight to discover chats with only history but no contact records) */
export async function listDingTalkInsightChatIdsForBot(params: {
  userId: string;
  botId: string;
}): Promise<string[]> {
  const rows = await db
    .select({ chatId: dingtalkBotInsightMessages.chatId })
    .from(dingtalkBotInsightMessages)
    .where(
      and(
        eq(dingtalkBotInsightMessages.userId, params.userId),
        eq(dingtalkBotInsightMessages.botId, params.botId),
      ),
    );
  const chatIds: string[] = rows.map((r: { chatId: unknown }) =>
    typeof r.chatId === "string" ? r.chatId : String(r.chatId ?? ""),
  );
  return [...new Set(chatIds)];
}

/** Persist DingTalk inbound messages for Insight to aggregate by session (deduplicate by msg_id under same bot) */
export async function insertDingTalkInsightMessageIgnoreDuplicate(params: {
  userId: string;
  botId: string;
  chatId: string;
  msgId: string;
  senderId?: string | null;
  senderName?: string | null;
  text: string;
  tsSec: number;
}): Promise<void> {
  try {
    await db
      .insert(dingtalkBotInsightMessages)
      .values({
        userId: params.userId,
        botId: params.botId,
        chatId: params.chatId,
        msgId: params.msgId,
        senderId: params.senderId ?? null,
        senderName: params.senderName ?? null,
        text: params.text,
        tsSec: params.tsSec,
      })
      .onConflictDoNothing({
        target: [
          dingtalkBotInsightMessages.botId,
          dingtalkBotInsightMessages.msgId,
        ],
      });
  } catch (error) {
    console.warn("[DingTalk] Failed to write Insight cache:", error);
  }
}

export type DingTalkInsightStoredRow = {
  chatId: string;
  msgId: string;
  senderId: string | null;
  senderName: string | null;
  text: string;
  tsSec: number;
};

/** Fetch messages within time window by session, max maxPerChat per session (prefer newer messages) */
export async function listDingTalkInsightMessagesForInsights(params: {
  userId: string;
  botId: string;
  chatIds: string[];
  sinceSec: number;
  maxPerChat: number;
}): Promise<DingTalkInsightStoredRow[]> {
  const { userId, botId, chatIds, sinceSec, maxPerChat } = params;
  if (chatIds.length === 0) return [];

  const rows = await db
    .select({
      chatId: dingtalkBotInsightMessages.chatId,
      msgId: dingtalkBotInsightMessages.msgId,
      senderId: dingtalkBotInsightMessages.senderId,
      senderName: dingtalkBotInsightMessages.senderName,
      text: dingtalkBotInsightMessages.text,
      tsSec: dingtalkBotInsightMessages.tsSec,
    })
    .from(dingtalkBotInsightMessages)
    .where(
      and(
        eq(dingtalkBotInsightMessages.userId, userId),
        eq(dingtalkBotInsightMessages.botId, botId),
        inArray(dingtalkBotInsightMessages.chatId, chatIds),
        gte(dingtalkBotInsightMessages.tsSec, sinceSec),
      ),
    )
    .orderBy(desc(dingtalkBotInsightMessages.tsSec));

  const perChatCount = new Map<string, number>();
  const picked: DingTalkInsightStoredRow[] = [];
  for (const r of rows) {
    const n = perChatCount.get(r.chatId) ?? 0;
    if (n >= maxPerChat) continue;
    perChatCount.set(r.chatId, n + 1);
    picked.push({
      chatId: r.chatId,
      msgId: r.msgId,
      senderId: r.senderId,
      senderName: r.senderName,
      text: r.text,
      tsSec: r.tsSec,
    });
  }
  picked.sort((a, b) => a.tsSec - b.tsSec);
  return picked;
}

/**
 * Check if a WeChat bot has any contacts with valid lastContextToken
 * @param userId - User ID
 * @param botId - Bot ID
 * @returns true if the bot has at least one contact with a non-empty and non-expired lastContextToken
 */
export async function weixinBotHasValidContextToken(
  userId: string,
  botId: string,
): Promise<boolean> {
  try {
    const contacts = await db
      .select()
      .from(userContacts)
      .where(
        and(eq(userContacts.userId, userId), eq(userContacts.botId, botId)),
      );

    if (contacts.length === 0) {
      return false;
    }

    // Normalize contactMeta for all contacts
    const normalizedContacts = normalizeContactMetaList(contacts);

    // Check if any contact has a valid (non-empty, non-expired) lastContextToken
    const WEIXIN_TOKEN_MAX_AGE_MS = 23 * 60 * 60 * 1000; // 23 hours
    for (const contact of normalizedContacts) {
      const meta = contact.contactMeta as
        | { lastContextToken?: string; lastContextTokenAt?: number }
        | null
        | undefined;
      const token = meta?.lastContextToken?.trim();
      const age = meta?.lastContextTokenAt
        ? Date.now() - meta.lastContextTokenAt
        : Number.POSITIVE_INFINITY;
      if (token && age < WEIXIN_TOKEN_MAX_AGE_MS) {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error(
      `[Queries] Failed to check WeChat bot context tokens: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}
