import { sql, type InferInsertModel, type InferSelectModel } from "drizzle-orm";
import {
  pgTable,
  varchar,
  timestamp,
  json,
  uuid,
  text,
  primaryKey,
  boolean,
  jsonb,
  uniqueIndex,
  unique,
  integer,
  numeric,
  index,
  bigint,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { DetailData, TimelineData } from "../ai/subagents/insights";
import type { ContactMeta } from "@alloomi/integrations/contacts";
import type { InsightFilter } from "@/lib/insights/filter-schema";

export const user = pgTable("User", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  email: varchar("email", { length: 64 }).notNull(),
  password: varchar("password", { length: 64 }),
  name: varchar("name", { length: 64 }),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  firstLoginAt: timestamp("first_login_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  finishOnboarding: boolean("finish_on_boarding").notNull().default(false),
  sessionVersion: integer("session_version").notNull().default(1),
});

export type User = InferSelectModel<typeof user>;

export const passwordResetToken = pgTable(
  "PasswordResetToken",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: varchar("token", { length: 128 }).notNull(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tokenKey: uniqueIndex("PasswordResetToken_token_key").on(table.token),
    userIdx: index("PasswordResetToken_user_idx").on(table.userId),
  }),
);

export type PasswordResetToken = InferSelectModel<typeof passwordResetToken>;

export const chat = pgTable(
  "Chat",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    createdAt: timestamp("createdAt").notNull(),
    title: text("title").notNull(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
    visibility: varchar("visibility", { enum: ["public", "private"] })
      .notNull()
      .default("private"),
  },
  (table) => ({
    userIdIdx: index("chat_user_id_idx").on(table.userId),
  }),
);

export type Chat = InferSelectModel<typeof chat>;

export const chatInsights = pgTable(
  "chat_insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chat.id, { onDelete: "cascade" }),
    insightId: uuid("insight_id")
      .notNull()
      .references(() => insight.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueChatInsight: uniqueIndex("chat_insights_chat_insight_idx").on(
      table.chatId,
      table.insightId,
    ),
    chatIdx: index("chat_insights_chat_idx").on(table.chatId),
    insightIdx: index("chat_insights_insight_idx").on(table.insightId),
  }),
);

export type ChatInsight = InferSelectModel<typeof chatInsights>;
export type InsertChatInsight = InferInsertModel<typeof chatInsights>;

export const message = pgTable(
  "Message_v2",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    chatId: uuid("chatId")
      .notNull()
      .references(() => chat.id),
    role: varchar("role").notNull(),
    parts: json("parts").notNull(),
    attachments: json("attachments").notNull(),
    createdAt: timestamp("createdAt").notNull(),
    metadata: jsonb("metadata"),
  },
  (table) => ({
    chatIdIdx: index("message_chat_id_idx").on(table.chatId),
  }),
);

export type DBMessage = InferSelectModel<typeof message>;

export const vote = pgTable(
  "Vote_v2",
  {
    chatId: uuid("chatId")
      .notNull()
      .references(() => chat.id),
    messageId: uuid("messageId")
      .notNull()
      .references(() => message.id),
    isUpvoted: boolean("isUpvoted").notNull(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.chatId, table.messageId] }),
    };
  },
);

export type Vote = InferSelectModel<typeof vote>;

export const stream = pgTable("Stream", {
  id: uuid("id").primaryKey().defaultRandom(),
  chatId: uuid("chatId")
    .notNull()
    .references(() => chat.id, { onDelete: "cascade" }),
  createdAt: timestamp("createdAt").notNull(),
});

export type Stream = InferSelectModel<typeof stream>;

export const integrationAccounts = pgTable(
  "platform_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
    platform: varchar("platform", {
      length: 32,
      enum: [
        "telegram",
        "whatsapp",
        "slack",
        "discord",
        "gmail",
        "outlook",
        "linkedin",
        "instagram",
        "twitter",
        "google_calendar",
        "outlook_calendar",
        "teams",
        "facebook_messenger",
        "google_drive",
        "google_docs",
        "hubspot",
        "notion",
        "github",
        "asana",
        "jira",
        "linear",
        "imessage",
        "feishu",
        "dingtalk",
        "qqbot",
        "weixin",
      ],
    }).notNull(),
    externalId: text("external_id").notNull(),
    displayName: text("display_name").notNull(),
    status: varchar("status", { length: 32 }).notNull().default("active"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown> | null>()
      .default(null),
    credentialsEncrypted: text("credentials_encrypted").notNull(),
    encryptionKeyId: text("encryption_key_id"),
    lastRotatedAt: timestamp("last_rotated_at", { withTimezone: true }),
    rotationCount: integer("rotation_count").notNull().default(0),
    keyVersion: integer("key_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    uniqueUserPlatformExternal: uniqueIndex(
      "platform_accounts_user_platform_external_id_idx",
    ).on(table.userId, table.platform, table.externalId),
    userLookup: index("platform_accounts_user_idx").on(table.userId),
  }),
);

export type IntegrationAccount = InferSelectModel<typeof integrationAccounts>;
export type InsertIntegrationAccount = InferInsertModel<
  typeof integrationAccounts
>;

// Credential Rotation History - stores previous credentials during rotation
export const credentialRotationHistory = pgTable(
  "credential_rotation_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => integrationAccounts.id, { onDelete: "cascade" }),
    credentialsEncrypted: text("credentials_encrypted").notNull(),
    encryptionKeyId: text("encryption_key_id"),
    rotatedAt: timestamp("rotated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    rotatedBy: text("rotated_by"),
    reason: text("reason"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    accountIdx: index("credential_rotation_history_account_idx").on(
      table.accountId,
      table.rotatedAt.desc(),
    ),
    expiresIdx: index("credential_rotation_history_expires_idx").on(
      table.expiresAt,
    ),
  }),
);

export type CredentialRotationHistory = InferSelectModel<
  typeof credentialRotationHistory
>;
export type InsertCredentialRotationHistory = InferInsertModel<
  typeof credentialRotationHistory
>;

// Credential Access Log - audit log for credential operations
export const credentialAccessLog = pgTable(
  "credential_access_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => integrationAccounts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 16 })
      .notNull()
      .$type<"read" | "update" | "rotate" | "delete">(),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: text("user_agent"),
    accessedAt: timestamp("accessed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown> | null>()
      .default(null),
    success: boolean("success").notNull().default(true),
    errorMessage: text("error_message"),
  },
  (table) => ({
    accountIdx: index("credential_access_log_account_idx").on(
      table.accountId,
      table.accessedAt.desc(),
    ),
    userIdx: index("credential_access_log_user_idx").on(
      table.userId,
      table.accessedAt.desc(),
    ),
    actionIdx: index("credential_access_log_action_idx").on(
      table.action,
      table.accessedAt.desc(),
    ),
  }),
);

export type CredentialAccessLog = InferSelectModel<typeof credentialAccessLog>;
export type InsertCredentialAccessLog = InferInsertModel<
  typeof credentialAccessLog
>;

export const integrationCatalog = pgTable(
  "integration_catalog",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 64 }).notNull(),
    integrationId: varchar("integration_id", { length: 32 }).notNull(),
    integrationType: varchar("integration_type", { length: 32 }).notNull(),
    category: varchar("category", { length: 64 }).notNull(),
    title: text("title").notNull(),
    description: text("description"),
    url: text("url").notNull(),
    logoUrl: text("logo_url"),
    config: jsonb("config").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    slugUnique: uniqueIndex("integration_catalog_slug_idx").on(table.slug),
  }),
);

export type IntegrationCatalogEntry = InferSelectModel<
  typeof integrationCatalog
>;

export const rssSubscriptions = pgTable(
  "rss_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    catalogId: uuid("catalog_id").references(() => integrationCatalog.id, {
      onDelete: "set null",
    }),
    integrationAccountId: uuid("integration_account_id").references(
      () => integrationAccounts.id,
      { onDelete: "set null" },
    ),
    sourceUrl: text("source_url").notNull(),
    title: text("title"),
    category: varchar("category", { length: 64 }),
    status: varchar("status", { length: 32 }).notNull().default("active"),
    sourceType: varchar("source_type", { length: 32 })
      .notNull()
      .default("custom"),
    etag: text("etag"),
    lastModified: text("last_modified"),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    lastErrorCode: varchar("last_error_code", { length: 32 }),
    lastErrorMessage: text("last_error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userSourceUnique: uniqueIndex("rss_subscriptions_user_url_idx").on(
      table.userId,
      table.sourceUrl,
    ),
  }),
);

export type RssSubscription = InferSelectModel<typeof rssSubscriptions>;

export const rssItems = pgTable(
  "rss_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => rssSubscriptions.id, { onDelete: "cascade" }),
    guidHash: varchar("guid_hash", { length: 128 }).notNull(),
    title: text("title"),
    summary: text("summary"),
    content: text("content"),
    link: text("link"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: varchar("status", { length: 32 }).notNull().default("pending"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown> | null>()
      .default(null),
  },
  (table) => ({
    subscriptionGuidUnique: uniqueIndex("rss_items_subscription_guid_idx").on(
      table.subscriptionId,
      table.guidHash,
    ),
    publishedIdx: index("rss_items_published_idx").on(table.publishedAt),
  }),
);

export type RssItem = InferSelectModel<typeof rssItems>;
export type InsertRssItem = InferInsertModel<typeof rssItems>;

export const bot = pgTable(
  "Bot",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
    platformAccountId: uuid("platform_account_id").references(
      () => integrationAccounts.id,
      {
        onDelete: "cascade",
      },
    ),
    name: varchar("name", { length: 255 }).notNull(),
    description: varchar("description", { length: 255 }).notNull(),
    adapter: varchar("adapter", { length: 255 }).notNull(),
    adapterConfig: json("adapter_config").notNull(),
    enable: boolean("enable").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index("bot_user_id_idx").on(table.userId),
  }),
);

export type Bot = InferSelectModel<typeof bot>;

type HistorySummary = {
  title: string;
  content: string;
};

type Strategic = {
  relationship: string;
  opportunity: string;
  risk: string;
};

type StoredInsight = {
  category: string;
  value: string;
  confidence: number;
  evidence?: string[];
  byRole?: string | null;
};

type InsightStakeholder = {
  name: string;
  role?: string | null;
};

type InsightTopVoice = {
  user: string;
  influenceScore: number;
};

export type InsightAction = {
  action?: string | null;
  owner?: string | null;
  eta?: string | null;
  reason?: string | null;
  confidence?: number | null;
  byRole?: string | null;
};

type InsightSource = {
  platform?: string | null;
  snippet: string;
  link?: string | null;
};

type InsightActionRequirementDetails = {
  who?: string | null;
  what?: string | null;
  when?: string | null;
};

export type InsightTaskStatus =
  | "pending"
  | "completed"
  | "blocked"
  | "delegated";

export type InsightTaskItem = {
  id?: string | null;
  title?: string | null;
  context?: string | null;
  owner?: string | null;
  ownerType?: string | null;
  requester?: string | null;
  requesterId?: string | null;
  responder?: string | null;
  responderId?: string | null;
  deadline?: string | null;
  rawDeadline?: string | null;
  followUpAt?: string | null;
  followUpNote?: string | null;
  lastFollowUpAt?: string | null;
  acknowledgedAt?: string | null;
  priority?: string | null;
  status?: InsightTaskStatus | null;
  confidence?: number | null;
  labels?: string[] | null;
  sourceDetailIds?: string[] | null;
  watchers?: string[] | null;
};

type InsightPriority =
  | string
  | {
      value: string;
      reason?: string | null;
    };

type InsightExperimentIdea = {
  idea: string;
  goal?: string | null;
  method?: string | null;
  expectedSignal?: string | null;
};

export type InsightRiskFlag = {
  issue: string;
  owner?: string | null;
  eta?: string | null;
  impact?: string | null;
  confidence?: number | null;
};

type InsightFollowUp = {
  action: string;
  reason?: string | null;
  confidence?: number | null;
};

type InsightRoleAttribution = {
  winner?: string[];
  conflicts?: Array<{
    field: string;
    candidates: Array<{
      role: string;
      value?: unknown;
      confidence?: number | null;
    }>;
    resolvedBy?: string | null;
  }>;
};

type InsightAlert = {
  code: string;
  message: string;
  insightId?: string | null;
};

export const insight = pgTable(
  "Insight",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    botId: uuid("botId").notNull(),
    dedupeKey: text("dedupe_key"),
    taskLabel: text("taskLabel").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    importance: varchar("importance", { length: 30 }).notNull(),
    urgency: varchar("urgency", { length: 30 }).notNull(),
    platform: text("platform"),
    account: text("account"),
    groups: text("groups")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    people: text("people")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    time: timestamp("time").notNull(),
    details: jsonb("details").$type<DetailData[] | null>().default(null),
    timeline: jsonb("timeline").$type<TimelineData[] | null>().default(null),
    insights: jsonb("insights").$type<StoredInsight[] | null>().default(null),
    trendDirection: text("trend_direction"),
    trendConfidence: numeric("trend_confidence", { precision: 5, scale: 4 })
      .$type<number | null>()
      .default(null),
    sentiment: text("sentiment"),
    sentimentConfidence: numeric("sentiment_confidence", {
      precision: 5,
      scale: 4,
    })
      .$type<number | null>()
      .default(null),
    intent: text("intent"),
    trend: text("trend"),
    issueStatus: text("issue_status"),
    communityTrend: text("community_trend"),
    duplicateFlag: boolean("duplicate_flag"),
    impactLevel: text("impact_level"),
    resolutionHint: text("resolution_hint"),
    topKeywords: text("top_keywords")
      .array()
      .default(sql`ARRAY[]::text[]`),
    topEntities: text("top_entities")
      .array()
      .default(sql`ARRAY[]::text[]`),
    topVoices: jsonb("top_voices")
      .$type<InsightTopVoice[] | null>()
      .default(null),
    sources: jsonb("sources").$type<InsightSource[] | null>().default(null),
    sourceConcentration: text("source_concentration"),
    buyerSignals: text("buyer_signals")
      .array()
      .default(sql`ARRAY[]::text[]`),
    stakeholders: jsonb("stakeholders")
      .$type<InsightStakeholder[] | null>()
      .default(null),
    contractStatus: text("contract_status"),
    signalType: text("signal_type"),
    confidence: numeric("confidence", { precision: 5, scale: 4 })
      .$type<number | null>()
      .default(null),
    scope: text("scope"),
    nextActions: jsonb("next_actions")
      .$type<InsightAction[] | null>()
      .default(null),
    followUps: jsonb("follow_ups")
      .$type<InsightFollowUp[] | null>()
      .default(null),
    actionRequired: boolean("action_required"),
    actionRequiredDetails: jsonb("action_required_details")
      .$type<InsightActionRequirementDetails | null>()
      .default(null),
    isUnreplied: boolean("is_unreplied").default(false),
    myTasks: jsonb("my_tasks").$type<InsightTaskItem[] | null>().default(null),
    waitingForMe: jsonb("waiting_for_me")
      .$type<InsightTaskItem[] | null>()
      .default(null),
    waitingForOthers: jsonb("waiting_for_others")
      .$type<InsightTaskItem[] | null>()
      .default(null),
    clarifyNeeded: boolean("clarify_needed"),
    categories: text("categories")
      .array()
      .default(sql`ARRAY[]::text[]`),
    learning: text("learning"),
    priority: jsonb("priority").$type<InsightPriority | null>().default(null),
    experimentIdeas: jsonb("experiment_ideas")
      .$type<InsightExperimentIdea[] | null>()
      .default(null),
    executiveSummary: text("executive_summary"),
    riskFlags: jsonb("risk_flags")
      .$type<InsightRiskFlag[] | null>()
      .default(null),
    client: text("client"),
    projectName: text("project_name"),
    nextMilestone: text("next_milestone"),
    dueDate: text("due_date"),
    paymentInfo: text("payment_info"),
    entity: text("entity"),
    why: text("why"),
    historySummary: jsonb("history_summary")
      .$type<HistorySummary | null>()
      .default(null),
    strategic: jsonb("strategic").$type<Strategic | null>().default(null),
    roleAttribution: jsonb("role_attribution")
      .$type<InsightRoleAttribution | null>()
      .default(null),
    alerts: jsonb("alerts").$type<InsightAlert[] | null>().default(null),
    pendingDeletionAt: timestamp("pending_deletion_at", {
      withTimezone: true,
    }),
    compactedIntoInsightId: uuid("compacted_into_insight_id").references(
      (): AnyPgColumn => insight.id,
      { onDelete: "set null" },
    ),
    isArchived: boolean("is_archived").notNull().default(false),
    isFavorited: boolean("is_favorited").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    favoritedAt: timestamp("favorited_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    botIdTimeIdx: index("insight_bot_id_time_idx").on(
      table.botId,
      table.time.desc(),
    ),
    botIdArchivedIdx: index("insight_bot_id_archived_idx").on(
      table.botId,
      table.isArchived,
    ),
    botIdPendingDeletionIdx: index("insight_bot_id_pending_deletion_idx").on(
      table.botId,
      table.pendingDeletionAt,
    ),
    compactedIntoInsightIdx: index("insight_compacted_into_idx").on(
      table.compactedIntoInsightId,
    ),
  }),
);

export type Insight = InferSelectModel<typeof insight>;
export type InsertInsight = InferInsertModel<typeof insight>;

export const insightCompactionLinks = pgTable(
  "insight_compaction_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    compactedInsightId: uuid("compacted_insight_id")
      .notNull()
      .references(() => insight.id, { onDelete: "cascade" }),
    sourceInsightId: uuid("source_insight_id")
      .notNull()
      .references(() => insight.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    compactedInsightIdx: index("insight_compaction_links_compacted_idx").on(
      table.compactedInsightId,
    ),
    sourceInsightIdx: index("insight_compaction_links_source_idx").on(
      table.sourceInsightId,
    ),
    uniquePairIdx: uniqueIndex("insight_compaction_links_pair_idx").on(
      table.compactedInsightId,
      table.sourceInsightId,
    ),
  }),
);

export type InsightCompactionLink = InferSelectModel<
  typeof insightCompactionLinks
>;
export type InsertInsightCompactionLink = InferInsertModel<
  typeof insightCompactionLinks
>;

// Insight Notes Table
// Stores user notes/comments on insights
export const insightNotes = pgTable(
  "insight_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    insightId: uuid("insight_id")
      .notNull()
      .references(() => insight.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    content: text("content").notNull(),
    source: varchar("source", {
      length: 32,
      enum: ["manual", "ai_conversation"],
    })
      .notNull()
      .default("manual"),
    sourceMessageId: uuid("source_message_id"), // Optional: reference to message if from AI conversation
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    insightIdx: index("insight_notes_insight_idx").on(table.insightId),
    userIdx: index("insight_notes_user_idx").on(table.userId),
    createdAtIdx: index("insight_notes_created_at_idx").on(table.createdAt),
  }),
);

export type InsightNote = InferSelectModel<typeof insightNotes>;
export type InsertInsightNote = InferInsertModel<typeof insightNotes>;

// Insight Brief Categories Table
// Stores user's manual category assignments for insights in Brief panel
export const insightBriefCategories = pgTable(
  "insight_brief_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    insightId: uuid("insight_id")
      .notNull()
      .references(() => insight.id, { onDelete: "cascade" }),
    category: varchar("category", { length: 20 })
      .notNull()
      .$type<"urgent" | "important" | "monitor" | "archive">(),
    dedupeKey: text("dedupe_key"), // For exact matching similar insights
    title: text("title"), // For fuzzy matching similar insights
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    source: varchar("source", { length: 20 }).notNull().default("manual"), // "manual" | "auto"
  },
  (table) => ({
    uniqueUserInsight: uniqueIndex(
      "insight_brief_categories_user_insight_idx",
    ).on(table.userId, table.insightId),
    userIdx: index("insight_brief_categories_user_idx").on(table.userId),
    dedupeKeyIdx: index("insight_brief_categories_dedupe_idx").on(
      table.dedupeKey,
    ),
    categoryIdx: index("insight_brief_categories_category_idx").on(
      table.category,
    ),
    assignedAtIdx: index("insight_brief_categories_assigned_at_idx").on(
      table.assignedAt,
    ),
  }),
);

export type InsightBriefCategory = InferSelectModel<
  typeof insightBriefCategories
>;
export type InsertInsightBriefCategory = InferInsertModel<
  typeof insightBriefCategories
>;

// Insight Documents Table
// Associates documents with insights
export const insightDocuments = pgTable(
  "insight_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    insightId: uuid("insight_id")
      .notNull()
      .references(() => insight.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => ragDocuments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    insightIdx: index("insight_documents_insight_idx").on(table.insightId),
    documentIdx: index("insight_documents_document_idx").on(table.documentId),
    userIdx: index("insight_documents_user_idx").on(table.userId),
    uniqueInsightDocument: unique("unique_insight_document").on(
      table.insightId,
      table.documentId,
    ),
  }),
);

export type InsightDocument = InferSelectModel<typeof insightDocuments>;
export type InsertInsightDocument = InferInsertModel<typeof insightDocuments>;

export const userInsightSettings = pgTable("user_insight_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("userId")
    .notNull()
    .references(() => user.id),
  // Store as JSON Array String
  focusPeople: text("focus_people").notNull().default(JSON.stringify([])),
  // Store as JSON Array String
  focusTopics: text("focus_topics").notNull().default(JSON.stringify([])),
  language: text("language").notNull().default(""),
  refreshIntervalMinutes: integer("refresh_interval_minutes")
    .notNull()
    .default(60),
  lastMessageProcessedAt: timestamp("last_message_processed_at"),
  lastActiveAt: timestamp("last_active_at"),
  lastInsightMaintenanceRunAt: timestamp("last_insight_maintenance_run_at"),
  activityTier: varchar("activity_tier", { length: 16 })
    .notNull()
    .default("low"),
  aiSoulPrompt: text("ai_soul_prompt"),
  /** User manually filled industry (JSON array string), max 4 items, takes priority over survey */
  identityIndustries: text("identity_industries"),
  /** User manually filled work description, max 5000 characters, takes priority over survey */
  identityWorkDescription: text("identity_work_description"),
  lastUpdated: timestamp("last_updated").notNull().defaultNow(),
});
export type DBInsightSettings = InferSelectModel<typeof userInsightSettings>;
export type DBInsertInsightSettings = InferInsertModel<
  typeof userInsightSettings
>;
const KNOWN_ACTIVITY_TIERS = new Set(["high", "medium", "low", "dormant"]);

export const personCustomFields = pgTable(
  "person_custom_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    personId: text("person_id").notNull(),
    fields: jsonb("fields")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    uniq: uniqueIndex("person_custom_fields_user_person_idx").on(
      table.userId,
      table.personId,
    ),
  }),
);
export type DBPersonCustomFields = InferSelectModel<typeof personCustomFields>;
export type DBInsertPersonCustomFields = InferInsertModel<
  typeof personCustomFields
>;

function normalizeActivityTier(
  tier?: string | null,
): "high" | "medium" | "low" | "dormant" {
  if (tier && KNOWN_ACTIVITY_TIERS.has(tier)) {
    return tier as "high" | "medium" | "low" | "dormant";
  }
  return "low";
}

export type InsightSettings = {
  id?: string;
  userId: string;
  focusPeople: string[];
  focusTopics: string[];
  language: string;
  refreshIntervalMinutes: number;
  lastMessageProcessedAt: Date | null;
  lastActiveAt: Date | null;
  lastInsightMaintenanceRunAt?: Date | null;
  activityTier: "high" | "medium" | "low" | "dormant";
  aiSoulPrompt: string | null;
  identityIndustries: string[] | null;
  identityWorkDescription: string | null;
  lastUpdated: Date;
};
export function parseInsightSettings(
  dbSettings: DBInsightSettings,
): InsightSettings {
  return {
    id: dbSettings.id,
    userId: dbSettings.userId,
    focusPeople: Array.isArray(dbSettings.focusPeople)
      ? dbSettings.focusPeople
      : JSON.parse(dbSettings.focusPeople),
    focusTopics: Array.isArray(dbSettings.focusTopics)
      ? dbSettings.focusTopics
      : JSON.parse(dbSettings.focusTopics),
    language: dbSettings.language,
    refreshIntervalMinutes: dbSettings.refreshIntervalMinutes ?? 30,
    lastMessageProcessedAt: dbSettings.lastMessageProcessedAt ?? null,
    lastActiveAt: dbSettings.lastActiveAt ?? null,
    lastInsightMaintenanceRunAt: dbSettings.lastInsightMaintenanceRunAt ?? null,
    activityTier: normalizeActivityTier(dbSettings.activityTier),
    aiSoulPrompt: dbSettings.aiSoulPrompt ?? null,
    identityIndustries:
      dbSettings.identityIndustries != null
        ? (JSON.parse(dbSettings.identityIndustries) as string[])
        : null,
    identityWorkDescription: dbSettings.identityWorkDescription ?? null,
    lastUpdated: dbSettings.lastUpdated,
  };
}

export const userRoles = pgTable(
  "user_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    roleKey: text("role_key").notNull(),
    source: text("source").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 })
      .$type<number>()
      .notNull()
      .default(0.5),
    firstDetectedAt: timestamp("first_detected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }),
    evidence: jsonb("evidence")
      .$type<Record<string, unknown> | null>()
      .default(null),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    uniqueRole: uniqueIndex("user_roles_unique").on(
      table.userId,
      table.roleKey,
      table.source,
    ),
    userIdx: index("user_roles_user_idx").on(table.userId, table.roleKey),
  }),
);
export type UserRole = InferSelectModel<typeof userRoles>;
export type InsertUserRole = InferInsertModel<typeof userRoles>;

export function serializeInsightSettings(
  settings: InsightSettings,
): Omit<DBInsertInsightSettings, "id" | "lastUpdated"> {
  return {
    userId: settings.userId,
    focusPeople: Array.isArray(settings.focusPeople)
      ? JSON.stringify(settings.focusPeople)
      : settings.focusPeople,
    focusTopics: Array.isArray(settings.focusTopics)
      ? JSON.stringify(settings.focusTopics)
      : settings.focusTopics,
    language: settings.language,
    refreshIntervalMinutes: settings.refreshIntervalMinutes,
    lastMessageProcessedAt: settings.lastMessageProcessedAt,
    lastActiveAt: settings.lastActiveAt,
    lastInsightMaintenanceRunAt: settings.lastInsightMaintenanceRunAt,
    activityTier: settings.activityTier,
    aiSoulPrompt: settings.aiSoulPrompt ?? null,
    identityIndustries:
      settings.identityIndustries != null &&
      settings.identityIndustries.length > 0
        ? JSON.stringify(settings.identityIndustries)
        : null,
    identityWorkDescription: settings.identityWorkDescription ?? null,
  };
}

export const insightFilters = pgTable(
  "insight_filters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    color: varchar("color", { length: 16 }),
    icon: varchar("icon", { length: 64 }),
    sortOrder: integer("sort_order").notNull().default(0),
    isPinned: boolean("is_pinned").notNull().default(false),
    isArchived: boolean("is_archived").notNull().default(false),
    source: varchar("source", { length: 16 }).notNull().default("user"),
    definition: jsonb("definition").$type<InsightFilter>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userSlugIdx: uniqueIndex("insight_filters_user_slug_idx").on(
      table.userId,
      table.slug,
    ),
    userIdx: index("insight_filters_user_idx").on(table.userId),
  }),
);
export type DBInsightFilter = InferSelectModel<typeof insightFilters>;
export type DBInsertInsightFilter = InferInsertModel<typeof insightFilters>;

export const insightTabs = pgTable(
  "insight_tabs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: varchar("type", { length: 16 }).notNull().default("custom"),
    filter: jsonb("filter").$type<InsightFilter>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdx: index("insight_tabs_user_idx").on(table.userId),
    userEnabledIdx: index("insight_tabs_user_enabled_idx").on(
      table.userId,
      table.enabled,
    ),
  }),
);
export type DBInsightTab = InferSelectModel<typeof insightTabs>;
export type DBInsertInsightTab = InferInsertModel<typeof insightTabs>;

export const userCategories = pgTable(
  "user_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 128 }).notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userCategoryNameIdx: uniqueIndex("user_categories_user_name_idx").on(
      table.userId,
      table.name,
    ),
    userIdx: index("user_categories_user_idx").on(table.userId),
  }),
);
export type DBUserCategory = InferSelectModel<typeof userCategories>;
export type DBInsertUserCategory = InferInsertModel<typeof userCategories>;

export const telegramAccounts = pgTable(
  "telegram_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
    telegramUserId: text("telegram_user_id").notNull(),
    telegramChatId: text("telegram_chat_id").notNull(),
    username: text("username"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    languageCode: text("language_code"),
    isBot: boolean("is_bot").notNull().default(false),
    linkedAt: timestamp("linked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastCommandAt: timestamp("last_command_at", { withTimezone: true }),
  },
  (table) => ({
    uniqueTelegramUser: uniqueIndex("telegram_accounts_telegram_user_idx").on(
      table.telegramUserId,
    ),
    telegramUserPerUser: uniqueIndex(
      "telegram_accounts_user_and_telegram_idx",
    ).on(table.userId, table.telegramUserId),
    telegramUserLookup: index("telegram_accounts_user_idx").on(table.userId),
  }),
);

export type TelegramAccount = InferSelectModel<typeof telegramAccounts>;
export type InsertTelegramAccount = InferInsertModel<typeof telegramAccounts>;

export const discordAccounts = pgTable(
  "discord_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
    discordUserId: text("discord_user_id").notNull(),
    discordGuildId: text("discord_guild_id"),
    discordChannelId: text("discord_channel_id"),
    username: text("username"),
    globalName: text("global_name"),
    linkedAt: timestamp("linked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastCommandAt: timestamp("last_command_at", { withTimezone: true }),
  },
  (table) => ({
    uniqueDiscordUser: uniqueIndex("discord_accounts_discord_user_idx").on(
      table.discordUserId,
    ),
    discordUserPerUser: uniqueIndex("discord_accounts_user_and_discord_idx").on(
      table.userId,
      table.discordUserId,
    ),
    discordUserLookup: index("discord_accounts_user_idx").on(table.userId),
  }),
);

export type DiscordAccount = InferSelectModel<typeof discordAccounts>;
export type InsertDiscordAccount = InferInsertModel<typeof discordAccounts>;

export const userContacts = pgTable(
  "user_meta_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
    contactId: text("contact_id").notNull(),
    contactName: text("contact_name").notNull(),
    type: text("contact_type"),
    botId: text("bot_id"),
    contactMeta: jsonb("contact_meta")
      .$type<ContactMeta | null>()
      .default(null),
  },
  (table) => ({
    uniqueUserContact: uniqueIndex("unique_user_contact").on(
      table.userId,
      table.botId,
      table.contactName,
    ),
  }),
);

export type UserContact = InferSelectModel<typeof userContacts>;

/**
 * DingTalk Stream inbound message cache, for Insight to pull history by session (DingTalk has no official session message list API)
 */
export const dingtalkBotInsightMessages = pgTable(
  "dingtalk_bot_insight_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, { onDelete: "cascade" }),
    chatId: text("chat_id").notNull(),
    msgId: text("msg_id").notNull(),
    senderId: text("sender_id"),
    senderName: text("sender_name"),
    text: text("text").notNull(),
    tsSec: integer("ts_sec").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    uniqBotMsgId: uniqueIndex("dingtalk_bot_insight_msg_bot_msgid_idx").on(
      table.botId,
      table.msgId,
    ),
    lookupIdx: index("dingtalk_bot_insight_msg_lookup_idx").on(
      table.userId,
      table.botId,
      table.chatId,
      table.tsSec,
    ),
  }),
);

export type DingtalkBotInsightMessage = InferSelectModel<
  typeof dingtalkBotInsightMessages
>;

export const affiliates = pgTable(
  "affiliates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    code: varchar("code", { length: 64 }).notNull(),
    slug: varchar("slug", { length: 64 }),
    commissionRate: numeric("commission_rate", { precision: 6, scale: 4 })
      .$type<number>()
      .notNull()
      .default(0),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown> | null>()
      .default(null),
  },
  (table) => ({
    uniqueAffiliateCode: uniqueIndex("unique_affiliate_code").on(table.code),
    uniqueAffiliateSlug: uniqueIndex("unique_affiliate_slug").on(table.slug),
    uniqueAffiliateUser: uniqueIndex("unique_affiliate_user").on(table.userId),
  }),
);
export type Affiliate = InferSelectModel<typeof affiliates>;
export type AffiliateInsert = InferInsertModel<typeof affiliates>;

export const affiliateClicks = pgTable("affiliate_clicks", {
  id: uuid("id").primaryKey().defaultRandom(),
  affiliateId: uuid("affiliate_id")
    .notNull()
    .references(() => affiliates.id, { onDelete: "cascade" }),
  url: varchar("url", { length: 512 }),
  referrer: varchar("referrer", { length: 512 }),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata")
    .$type<Record<string, unknown> | null>()
    .default(null),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type AffiliateClick = InferSelectModel<typeof affiliateClicks>;

export const affiliatePayouts = pgTable("affiliate_payouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  affiliateId: uuid("affiliate_id")
    .notNull()
    .references(() => affiliates.id, { onDelete: "cascade" }),
  method: varchar("method", { length: 32 }).notNull(),
  destinationDetails: jsonb("destination_details")
    .$type<Record<string, unknown> | null>()
    .default(null),
  currency: varchar("currency", { length: 8 }).notNull().default("USD"),
  amount: numeric("amount", { precision: 12, scale: 2 })
    .$type<number>()
    .notNull(),
  status: varchar("status", { length: 16 }).notNull().default("requested"),
  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  processedAt: timestamp("processed_at"),
  remarks: text("remarks"),
  adminUserId: uuid("admin_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type AffiliatePayout = InferSelectModel<typeof affiliatePayouts>;

export const coupons = pgTable(
  "coupons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 96 }).notNull(),
    planId: varchar("plan_id", { length: 32 }),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    stripeCouponId: varchar("stripe_coupon_id", { length: 64 }).notNull(),
    stripePromotionCodeId: varchar("stripe_promotion_code_id", {
      length: 64,
    }).notNull(),
    stripePromotionCode: varchar("stripe_promotion_code", {
      length: 64,
    }).notNull(),
    discountType: varchar("discount_type", { length: 16 }).notNull(),
    percentageOff: numeric("percentage_off", { precision: 5, scale: 2 })
      .$type<number | null>()
      .default(null),
    amountOff: numeric("amount_off", { precision: 12, scale: 2 })
      .$type<number | null>()
      .default(null),
    currency: varchar("currency", { length: 8 }),
    duration: varchar("duration", { length: 16 }).notNull().default("once"),
    durationInMonths: integer("duration_in_months"),
    maxRedemptions: integer("max_redemptions").notNull().default(1),
    redeemedCount: integer("redeemed_count").notNull().default(0),
    activationExpiresAt: timestamp("activation_expires_at", {
      withTimezone: true,
    }),
    assignedUserId: uuid("assigned_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    assignedEmail: varchar("assigned_email", { length: 128 }),
    roleTag: varchar("role_tag", { length: 64 }),
    label: varchar("label", { length: 128 }),
    notes: text("notes"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown> | null>()
      .default(null),
    createdByUserId: uuid("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    redeemedByUserId: uuid("redeemed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    stripeCheckoutSessionId: varchar("stripe_checkout_session_id", {
      length: 255,
    }),
    stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
  },
  (table) => ({
    uniqueCouponCode: uniqueIndex("unique_coupon_code").on(table.code),
    couponPlanIdx: index("coupon_plan_idx").on(table.planId),
    couponStatusIdx: index("coupon_status_idx").on(table.status),
    couponAssignedUserIdx: index("coupon_assigned_user_idx").on(
      table.assignedUserId,
    ),
  }),
);
export type Coupon = InferSelectModel<typeof coupons>;
export type CouponInsert = InferInsertModel<typeof coupons>;

export const couponRedemptions = pgTable(
  "coupon_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    couponId: uuid("coupon_id")
      .notNull()
      .references(() => coupons.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    stripeCheckoutSessionId: varchar("stripe_checkout_session_id", {
      length: 255,
    }),
    stripeSubscriptionId: varchar("stripe_subscription_id", {
      length: 255,
    }),
    stripeCustomerId: varchar("stripe_customer_id", { length: 64 }),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    redemptionCouponIdx: index("coupon_redemption_coupon_idx").on(
      table.couponId,
    ),
    redemptionUserIdx: index("coupon_redemption_user_idx").on(table.userId),
    uniqueRedemptionSession: uniqueIndex("coupon_redemption_session_unique").on(
      table.stripeCheckoutSessionId,
    ),
  }),
);
export type CouponRedemption = InferSelectModel<typeof couponRedemptions>;
export type CouponRedemptionInsert = InferInsertModel<typeof couponRedemptions>;

export const userSubscriptions = pgTable(
  "user_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
    planName: text("plan_name").notNull(),
    startDate: timestamp("start_date").notNull().defaultNow(), // Subscription start date
    endDate: timestamp("end_date"), // Subscription end date (null means permanent)
    isActive: boolean("is_active").default(true), // Is active
    autoRenew: boolean("auto_renew").default(true), // Auto renew enabled
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeCustomerId: text("stripe_customer_id"),
    stripePriceId: text("stripe_price_id"),
    status: varchar("status", { length: 32 }).default("incomplete").notNull(),
    billingCycle: varchar("billing_cycle", { length: 16 }),
    lastPaymentDate: timestamp("last_payment_date"), // Last payment date
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
    affiliateId: uuid("affiliate_id").references(() => affiliates.id, {
      onDelete: "set null",
    }),
    affiliateCode: varchar("affiliate_code", { length: 64 }),
    affiliateCommissionRate: numeric("affiliate_commission_rate", {
      precision: 6,
      scale: 4,
    })
      .$type<number | null>()
      .default(null),
  },
  (table) => ({
    uniqueUserSubscription: uniqueIndex("unique_user_subscription").on(
      table.userId,
      table.isActive,
    ),
  }),
);

export const affiliateTransactions = pgTable(
  "affiliate_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    affiliateId: uuid("affiliate_id")
      .notNull()
      .references(() => affiliates.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id").references(
      () => userSubscriptions.id,
      {
        onDelete: "set null",
      },
    ),
    orderId: text("order_id").notNull(),
    userId: uuid("user_id").references(() => user.id, { onDelete: "set null" }),
    planId: text("plan_id"),
    currency: varchar("currency", { length: 8 }).notNull().default("USD"),
    amount: numeric("amount", { precision: 12, scale: 2 })
      .$type<number>()
      .notNull(),
    commissionRate: numeric("commission_rate", { precision: 6, scale: 4 })
      .$type<number>()
      .notNull(),
    commissionAmount: numeric("commission_amount", { precision: 12, scale: 2 })
      .$type<number>()
      .notNull(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    payoutId: uuid("payout_id").references(() => affiliatePayouts.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown> | null>()
      .default(null),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueAffiliateOrder: uniqueIndex("unique_affiliate_order").on(
      table.orderId,
    ),
    affiliateIdx: index("affiliate_transactions_affiliate_idx").on(
      table.affiliateId,
    ),
    affiliateStatusIdx: index("affiliate_transactions_status_idx").on(
      table.affiliateId,
      table.status,
    ),
  }),
);
export type AffiliateTransaction = InferSelectModel<
  typeof affiliateTransactions
>;

export const userMonthlyQuota = pgTable(
  "user_monthly_quota",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
    year: integer("year").notNull(), // Year (e.g., 2024)
    month: integer("month").notNull(), // Month (1-12)
    totalQuota: integer("total_quota").notNull(), // Monthly total quota (based on subscription plan)
    usedQuota: integer("used_quota").notNull().default(0), // Monthly used quota
    isRefreshed: boolean("is_refreshed").default(false), // Flag: whether monthly refresh is completed
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    // Unique index: one user can only have one record per month
    uniqueUserMonth: uniqueIndex("unique_user_month").on(
      table.userId,
      table.year,
      table.month,
    ),
  }),
);

export const userFreeQuota = pgTable(
  "user_free_quota",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id),
    totalQuota: integer("total_quota").notNull().default(2048),
    usedQuota: integer("used_quota").notNull().default(0),
    lastAdjustedAt: timestamp("last_adjusted_at").defaultNow(),
  },
  (table) => ({
    uniqueUser: uniqueIndex("unique_free_user").on(table.userId),
  }),
);

export const userRewardEvents = pgTable(
  "user_reward_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    rewardType: varchar("reward_type", { length: 64 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("available"),
    creditsGranted: integer("credits_granted").notNull().default(0),
    triggerReference: text("trigger_reference"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown> | null>()
      .default(null),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    grantedAt: timestamp("granted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    rewardTypeUnique: uniqueIndex("user_reward_unique_type").on(
      table.userId,
      table.rewardType,
    ),
    userStatusIdx: index("user_reward_status_idx").on(
      table.userId,
      table.status,
    ),
  }),
);

export const userCreditLedger = pgTable(
  "user_credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    balanceAfter: integer("balance_after"),
    source: varchar("source", { length: 32 }).notNull().default("reward"),
    rewardEventId: uuid("reward_event_id").references(
      () => userRewardEvents.id,
      { onDelete: "set null" },
    ),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown> | null>()
      .default(null),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userLedgerIdx: index("user_credit_ledger_user_idx").on(table.userId),
    rewardLedgerIdx: index("user_credit_ledger_reward_idx").on(
      table.rewardEventId,
    ),
  }),
);

export const userFileUsage = pgTable("user_file_usage", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  usedBytes: bigint("used_bytes", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type UserFileUsage = InferSelectModel<typeof userFileUsage>;

export const userFiles = pgTable(
  "user_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    chatId: uuid("chat_id").references(() => chat.id, {
      onDelete: "set null",
    }),
    messageId: uuid("message_id").references(() => message.id, {
      onDelete: "set null",
    }),
    blobUrl: text("blob_url").notNull(),
    blobPathname: text("blob_pathname").notNull(),
    storageProvider: varchar("storage_provider", {
      length: 32,
      enum: ["vercel_blob", "google_drive", "notion"],
    })
      .notNull()
      .default("vercel_blob"),
    providerFileId: text("provider_file_id"),
    providerMetadata: jsonb("provider_metadata")
      .$type<Record<string, unknown> | null>()
      .default(null),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    savedAt: timestamp("saved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdx: index("user_files_user_idx").on(table.userId),
    providerPathIdx: uniqueIndex("user_files_provider_path_idx").on(
      table.storageProvider,
      table.blobPathname,
    ),
  }),
);

export type UserFile = InferSelectModel<typeof userFiles>;

export const userEmailPreferences = pgTable(
  "user_email_preferences",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(true),
    marketingOptedOutAt: timestamp("marketing_opted_out_at", {
      withTimezone: true,
    }),
    unsubscribeToken: uuid("unsubscribe_token").defaultRandom().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastEmailSentAt: timestamp("last_email_sent_at", { withTimezone: true }),
  },
  (table) => ({
    uniqueUnsubscribeToken: uniqueIndex(
      "user_email_preferences_unsubscribe_token_key",
    ).on(table.unsubscribeToken),
  }),
);
export type UserEmailPreferences = InferSelectModel<
  typeof userEmailPreferences
>;

export const marketingEmailLog = pgTable(
  "marketing_email_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 128 }).notNull(),
    stage: varchar("stage", { length: 64 }).notNull(),
    template: varchar("template", { length: 64 }).notNull(),
    dedupeKey: varchar("dedupe_key", { length: 128 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("sent"),
    error: text("error"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown> | null>()
      .default(null),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    dedupe: uniqueIndex("marketing_email_log_dedupe_idx").on(
      table.userId,
      table.dedupeKey,
    ),
    stageIdx: index("marketing_email_log_stage_idx").on(
      table.stage,
      table.sentAt,
    ),
  }),
);
export type MarketingEmailLog = InferSelectModel<typeof marketingEmailLog>;

export const feedback = pgTable("feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => user.id, { onDelete: "cascade" }), // Optional: supports anonymous feedback
  contactEmail: text("contact_email"), // Optional: contact email for anonymous users
  content: text("content").notNull(),
  type: text("type").notNull().default("general"), // 'bug', 'feature', 'improvement', 'general'
  title: text("title").notNull().default(""), // Title (default empty string)
  description: text("description").notNull().default(""), // Description (default empty string)
  status: text("status").notNull().default("open"), // 'open', 'in_progress', 'resolved', 'closed'
  priority: text("priority").default("medium"), // 'low', 'medium', 'high', 'urgent'
  source: text("source").default("web"), // 'web', 'desktop', 'api'
  systemInfo: json("system_info"), // System info (platform, version, etc.)
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type Feedback = InferSelectModel<typeof feedback>;

export const stripeWebhookEvents = pgTable(
  "stripe_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stripeEventId: text("stripe_event_id").notNull(),
    eventType: text("event_type").notNull(),
    status: varchar("status", { length: 32 }).notNull().default("processing"),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
    processedAt: timestamp("processed_at"),
  },
  (table) => ({
    uniqueStripeEvent: uniqueIndex("unique_stripe_event").on(
      table.stripeEventId,
    ),
  }),
);

// 👉 Define survey table (for survey data)
export const survey = pgTable("survey", {
  id: uuid("id").primaryKey().defaultRandom(), // Primary key UUID, auto-generated by default
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  industry: text("industry").notNull(), // Industry (corresponds to SurveyAnswers.industry)
  role: text("role").notNull(), // Role (corresponds to SurveyAnswers.role)
  roles: text("roles").array().default([]), // Multi-role selection
  otherRole: text("other_role"),
  size: text("size").notNull(), // Company size (corresponds to SurveyAnswers.size)
  communicationTools: text("communication_tools").array().notNull(), // Communication tools (array type)
  dailyMessages: text("daily_messages").notNull(), // Daily message volume (corresponds to SurveyAnswers.dailyMessages)
  challenges: text("challenges").array().notNull(), // Pain points/issues (array type)
  workDescription: text("work_description"),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(), // Submission time, defaults to current time
});

export type Survey = InferSelectModel<typeof survey>;

// RAG Documents table - stores document metadata
export const ragDocuments = pgTable(
  "rag_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    contentType: varchar("content_type", { length: 100 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    totalChunks: integer("total_chunks").notNull().default(0),
    blobPath: text("blob_path"), // Path to original binary file (e.g., Vercel Blob URL or local file path)
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdx: index("rag_documents_user_idx").on(table.userId),
    uploadedAtIdx: index("rag_documents_uploaded_at_idx").on(table.uploadedAt),
  }),
);

export type RAGDocument = InferSelectModel<typeof ragDocuments>;
export type InsertRAGDocument = InferInsertModel<typeof ragDocuments>;

// RAG Chunks table - stores document chunks with embeddings using pgvector
export const ragChunks = pgTable(
  "rag_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => ragDocuments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    // Store embedding as text - will be cast to vector in queries
    // Nullable to support skipEmbeddings mode where chunks are stored without vectors
    embedding: text("embedding"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    documentIdIdx: index("rag_chunks_document_idx").on(table.documentId),
    userIdx: index("rag_chunks_user_idx").on(table.userId),
    documentChunkIdx: uniqueIndex("rag_chunks_doc_chunk_idx").on(
      table.documentId,
      table.chunkIndex,
    ),
  }),
);

export type RAGChunk = InferSelectModel<typeof ragChunks>;
export type InsertRAGChunk = InferInsertModel<typeof ragChunks>;

// Landing Promo Registration table
// Tracks users who registered through the landing page promotion
export const landingPromoRegistrations = pgTable(
  "landing_promo_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    promoCode: varchar("promo_code", { length: 64 })
      .notNull()
      .default("6M_FREE_PRO"),
    monthsGranted: integer("months_granted").notNull().default(6),
    planName: text("plan_name").notNull().default("pro"),
    status: varchar("status", { length: 32 }).notNull().default("active"), // active, expired, claimed
    claimedAt: timestamp("claimed_at"),
    expiresAt: timestamp("expires_at").notNull(),
    referralCode: varchar("referral_code", { length: 64 }), // Unique referral code for this user
    referredBy: uuid("referred_by").references(
      (): any => landingPromoRegistrations.id,
      {
        onDelete: "set null",
      },
    ),
    referralCount: integer("referral_count").notNull().default(0), // Number of successful referrals
    metadata: jsonb("metadata")
      .$type<Record<string, unknown> | null>()
      .default(null),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdx: index("landing_promo_user_idx").on(table.userId),
    emailIdx: index("landing_promo_email_idx").on(table.email),
    promoCodeIdx: index("landing_promo_code_idx").on(table.promoCode),
    statusIdx: index("landing_promo_status_idx").on(table.status),
    referralCodeIdx: uniqueIndex("landing_promo_referral_code_idx").on(
      table.referralCode,
    ),
    expiresAtIdx: index("landing_promo_expires_at_idx").on(table.expiresAt),
  }),
);

export type LandingPromoRegistration = InferSelectModel<
  typeof landingPromoRegistrations
>;
export type InsertLandingPromoRegistration = InferInsertModel<
  typeof landingPromoRegistrations
>;

// WhatsApp Accounts
export const whatsappAccounts = pgTable(
  "whatsapp_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    whatsappUserId: text("whatsapp_user_id").notNull(),
    username: text("username"),
    pushName: text("push_name"),
    linkedAt: timestamp("linked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastCommandAt: timestamp("last_command_at", { withTimezone: true }),
  },
  (table) => ({
    uniqueWhatsappUser: uniqueIndex("whatsapp_accounts_whatsapp_user_idx").on(
      table.whatsappUserId,
    ),
    whatsappUserPerUser: uniqueIndex(
      "whatsapp_accounts_user_and_whatsapp_idx",
    ).on(table.userId, table.whatsappUserId),
    whatsappUserLookup: index("whatsapp_accounts_user_idx").on(table.userId),
  }),
);

export type WhatsAppAccount = InferSelectModel<typeof whatsappAccounts>;
export type InsertWhatsAppAccount = InferInsertModel<typeof whatsappAccounts>;

// Insight Processing Failures
export const insightProcessingFailures = pgTable(
  "insight_processing_failures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, { onDelete: "cascade" }),
    groupName: text("group_name").notNull(),
    failureCount: integer("failure_count").notNull().default(1),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    lastError: text("last_error"),
    lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedSince: integer("processed_since").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    uniqueBotGroup: uniqueIndex("insight_failures_bot_group_idx").on(
      table.botId,
      table.groupName,
    ),
    botStatusIdx: index("insight_failures_bot_status_idx").on(
      table.botId,
      table.status,
    ),
    attemptedIdx: index("insight_failures_attempted_idx").on(
      table.lastAttemptedAt,
    ),
  }),
);

export type InsightProcessingFailure = InferSelectModel<
  typeof insightProcessingFailures
>;
export type InsertInsightProcessingFailure = InferInsertModel<
  typeof insightProcessingFailures
>;

// Scheduled Jobs
export const scheduledJobs = pgTable(
  "scheduled_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    scheduleType: varchar("schedule_type", { length: 20 })
      .notNull()
      .default("cron"),
    cronExpression: varchar("cron_expression", { length: 100 }),
    intervalMinutes: integer("interval_minutes"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    jobType: varchar("job_type", { length: 50 }).notNull().default("custom"),
    jobConfig: jsonb("job_config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    enabled: boolean("enabled").notNull().default(true),
    timezone: varchar("timezone", { length: 50 }).notNull().default("UTC"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastStatus: varchar("last_status", { length: 20 }),
    lastError: text("last_error"),
    runCount: integer("run_count").notNull().default(0),
    failureCount: integer("failure_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdx: index("scheduled_jobs_user_idx").on(table.userId),
    enabledIdx: index("scheduled_jobs_enabled_idx").on(table.enabled),
    nextRunAtIdx: index("scheduled_jobs_next_run_idx").on(table.nextRunAt),
    userEnabledIdx: index("scheduled_jobs_user_enabled_idx").on(
      table.userId,
      table.enabled,
    ),
  }),
);

export type ScheduledJob = InferSelectModel<typeof scheduledJobs>;
export type InsertScheduledJob = InferInsertModel<typeof scheduledJobs>;

// Job Executions
export const jobExecutions = pgTable(
  "job_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => scheduledJobs.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 20 }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    result: jsonb("result").$type<Record<string, unknown> | null>(),
    error: text("error"),
    output: text("output"),
    triggeredBy: varchar("triggered_by", { length: 50 })
      .notNull()
      .default("scheduler"),
  },
  (table) => ({
    jobIdIdx: index("job_executions_job_idx").on(table.jobId),
    startedAtIdx: index("job_executions_started_at_idx").on(table.startedAt),
    statusIdx: index("job_executions_status_idx").on(table.status),
  }),
);

export type JobExecution = InferSelectModel<typeof jobExecutions>;
export type InsertJobExecution = InferInsertModel<typeof jobExecutions>;

// Characters
export const characters = pgTable(
  "characters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 50 }).notNull(),
    avatarConfig: jsonb("avatar_config")
      .$type<Record<string, unknown>>()
      .default({}),
    jobId: uuid("job_id")
      .notNull()
      .unique()
      .references(() => scheduledJobs.id, { onDelete: "cascade" }),
    insightId: uuid("insight_id")
      .notNull()
      .unique()
      .references(() => insight.id, { onDelete: "set null" }),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    lastExecutionAt: timestamp("last_execution_at", { withTimezone: true }),
    lastExecutionStatus: varchar("last_execution_status", { length: 20 }),
    sources: jsonb("sources")
      .$type<
        Array<{
          type: "file" | "channel" | "folder";
          name: string;
          id?: string;
          path?: string;
        }>
      >()
      .default([]),
    topics: jsonb("topics").$type<string[]>().default([]).notNull(),
    notificationChannels: jsonb("notification_channels")
      .$type<string[]>()
      .default([])
      .notNull(),
    systemNotification: boolean("system_notification").notNull().default(true),
    systemType: varchar("system_type", { length: 50 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdx: index("characters_user_idx").on(table.userId),
  }),
);

export type Character = InferSelectModel<typeof characters>;
export type InsertCharacter = InferInsertModel<typeof characters>;

// Insight Timeline History
export const insightTimelineHistory = pgTable(
  "insight_timeline_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    insightId: uuid("insight_id")
      .notNull()
      .references(() => insight.id, { onDelete: "cascade" }),
    timelineEventId: text("timeline_event_id").notNull(),
    version: integer("version").notNull(),
    eventTime: text("event_time"),
    summary: text("summary").notNull(),
    label: text("label").notNull(),
    changeType: text("change_type").notNull(),
    changeReason: text("change_reason").notNull(),
    changedBy: text("changed_by").notNull().default("system"),
    previousSnapshot: jsonb("previous_snapshot"),
    diffSummary: text("diff_summary"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sourceMessageId: text("source_message_id"),
  },
  (table) => ({
    insightIdIdx: index("timeline_history_insight_idx").on(table.insightId),
    timelineEventIdIdx: index("timeline_history_event_idx").on(
      table.timelineEventId,
    ),
    createdAtIdx: index("timeline_history_created_idx").on(table.createdAt),
    insightEventIdx: index("timeline_history_insight_event_idx").on(
      table.insightId,
      table.timelineEventId,
    ),
  }),
);

export type InsightTimelineHistory = InferSelectModel<
  typeof insightTimelineHistory
>;
export type InsertInsightTimelineHistory = InferInsertModel<
  typeof insightTimelineHistory
>;

// Insight Weights Table
// Stores weight-related data for insights (separate table for cleaner separation of concerns)
export const insightWeights = pgTable(
  "insight_weights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    insightId: uuid("insight_id")
      .notNull()
      .references(() => insight.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    customWeightMultiplier: numeric("custom_weight_multiplier", {
      precision: 4,
      scale: 2,
    })
      .$type<number>()
      .notNull()
      .default(1),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    lastRankCalculatedAt: timestamp("last_rank_calculated_at", {
      withTimezone: true,
    }),
    currentEventRank: numeric("current_event_rank", { precision: 10, scale: 4 })
      .$type<number>()
      .notNull()
      .default(0),
    accessCountTotal: integer("access_count_total").notNull().default(0),
    accessCount7d: integer("access_count_7d").notNull().default(0),
    accessCount30d: integer("access_count_30d").notNull().default(0),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    lastWeightAdjustmentReason: text("last_weight_adjustment_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    uniqueInsightUser: uniqueIndex("weights_insight_user_idx").on(
      table.insightId,
      table.userId,
    ),
    insightIdx: index("weights_insight_idx").on(table.insightId),
    userIdx: index("weights_user_idx").on(table.userId),
    lastViewedIdx: index("weights_last_viewed_idx").on(table.lastViewedAt),
    accessCount30dIdx: index("weights_access_count_30d_idx").on(
      table.userId,
      table.accessCount30d,
    ),
    lastAccessedIdx: index("weights_last_accessed_idx").on(
      table.userId,
      table.lastAccessedAt,
    ),
  }),
);

export type InsightWeight = InferSelectModel<typeof insightWeights>;
export type InsertInsightWeight = InferInsertModel<typeof insightWeights>;

// Insight Weight History Table
// Tracks all weight adjustments for insights
export const insightWeightHistory = pgTable(
  "insight_weight_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    insightId: uuid("insight_id")
      .notNull()
      .references(() => insight.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    adjustmentType: varchar("adjustment_type", { length: 20 })
      .notNull()
      .$type<
        "favorite" | "unfavorite" | "view" | "decay" | "manual" | "system"
      >(),
    weightBefore: numeric("weight_before", { precision: 10, scale: 4 })
      .$type<number>()
      .notNull(),
    weightAfter: numeric("weight_after", { precision: 10, scale: 4 })
      .$type<number>()
      .notNull(),
    weightDelta: numeric("weight_delta", { precision: 10, scale: 4 })
      .$type<number>()
      .notNull(),
    customMultiplierBefore: numeric("custom_multiplier_before", {
      precision: 4,
      scale: 2,
    }).$type<number | null>(),
    customMultiplierAfter: numeric("custom_multiplier_after", {
      precision: 4,
      scale: 2,
    }).$type<number | null>(),
    reason: text("reason").notNull(),
    context: jsonb("context")
      .$type<Record<string, unknown> | null>()
      .default(null),
    ipAddress: varchar("ip_address", { length: 45 }), // IPv6 support
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    insightIdx: index("weight_history_insight_idx").on(
      table.insightId,
      table.createdAt,
    ),
    userIdx: index("weight_history_user_idx").on(table.userId, table.createdAt),
    typeIdx: index("weight_history_type_idx").on(
      table.adjustmentType,
      table.createdAt,
    ),
  }),
);

export type InsightWeightHistory = InferSelectModel<
  typeof insightWeightHistory
>;
export type InsertInsightWeightHistory = InferInsertModel<
  typeof insightWeightHistory
>;

// Insight View History Table
// Tracks user views of insights
export const insightViewHistory = pgTable(
  "insight_view_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    insightId: uuid("insight_id")
      .notNull()
      .references(() => insight.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    viewDurationSeconds: integer("view_duration_seconds"),
    viewSource: varchar("view_source", { length: 20 })
      .notNull()
      .$type<"list" | "detail" | "search" | "favorite">(),
    viewContext: jsonb("view_context")
      .$type<Record<string, unknown> | null>()
      .default(null),
    viewedAt: timestamp("viewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    uniqueInsightUserTime: uniqueIndex("view_history_insight_user_time_idx").on(
      table.insightId,
      table.userId,
      table.viewedAt,
    ),
    insightUserIdx: index("view_history_insight_user_idx").on(
      table.insightId,
      table.userId,
      table.viewedAt,
    ),
    userTimeIdx: index("view_history_user_time_idx").on(
      table.userId,
      table.viewedAt,
    ),
  }),
);

export type InsightViewHistory = InferSelectModel<typeof insightViewHistory>;
export type InsertInsightViewHistory = InferInsertModel<
  typeof insightViewHistory
>;

// Insight Weight Config Table
// Stores weight configuration (global and per-user)
export const insightWeightConfig = pgTable(
  "insight_weight_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    configKey: varchar("config_key", { length: 50 }).notNull(),
    configValue: jsonb("config_value")
      .$type<Record<string, unknown>>()
      .notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    uniqueUserKey: uniqueIndex("weight_config_user_key_idx").on(
      table.userId,
      table.configKey,
    ),
  }),
);

export type InsightWeightConfig = InferSelectModel<typeof insightWeightConfig>;
export type InsertInsightWeightConfig = InferInsertModel<
  typeof insightWeightConfig
>;
