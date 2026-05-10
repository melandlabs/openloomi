/**
 * SQLite-compatible schema definitions
 * Converts PostgreSQL types to SQLite equivalents:
 * - uuid() → text()
 * - timestamp → integer (Unix timestamp in milliseconds)
 * - jsonb → text (JSON string)
 * - array() → text (JSON array string)
 * - boolean → integer (0/1)
 * - numeric/decimal → text
 */

import { sql, type InferInsertModel, type InferSelectModel } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
import type { DetailData, TimelineData } from "../ai/subagents/insights";

// ============================================================================
// Core Tables
// ============================================================================

export const user = sqliteTable("User", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  password: text("password"),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  firstLoginAt: integer("first_login_at", { mode: "timestamp" }),
  lastLoginAt: integer("last_login_at", { mode: "timestamp" }),
  finishOnboarding: integer("finish_on_boarding", { mode: "boolean" })
    .notNull()
    .default(sql`0`),
  sessionVersion: integer("session_version").notNull().default(1),
});

export type User = InferSelectModel<typeof user>;

export const passwordResetToken = sqliteTable(
  "PasswordResetToken",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
    createdAt: integer("createdAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    tokenKey: uniqueIndex("PasswordResetToken_token_key").on(table.token),
    userIdx: index("PasswordResetToken_user_idx").on(table.userId),
  }),
);

export type PasswordResetToken = InferSelectModel<typeof passwordResetToken>;

export const chat = sqliteTable("Chat", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  title: text("title").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  visibility: text("visibility").notNull().default("private"),
});

export type Chat = InferSelectModel<typeof chat>;

export const chatInsights = sqliteTable(
  "chat_insights",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    chatId: text("chat_id")
      .notNull()
      .references(() => chat.id, { onDelete: "cascade" }),
    insightId: text("insight_id")
      .notNull()
      .references(() => insight.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
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

export const message = sqliteTable("Message_v2", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  chatId: text("chatId")
    .notNull()
    .references(() => chat.id),
  role: text("role").notNull(),
  parts: text("parts").notNull(), // JSON string
  attachments: text("attachments").notNull(), // JSON string
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  metadata: text("metadata"), // JSON string
});

export type DBMessage = InferSelectModel<typeof message>;

export const vote = sqliteTable(
  "Vote_v2",
  {
    chatId: text("chatId")
      .notNull()
      .references(() => chat.id),
    messageId: text("messageId")
      .notNull()
      .references(() => message.id),
    isUpvoted: integer("isUpvoted", { mode: "boolean" }).notNull(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.chatId, table.messageId] }),
    };
  },
);

export type Vote = InferSelectModel<typeof vote>;

export const stream = sqliteTable("Stream", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  chatId: text("chatId").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
});

export type Stream = InferSelectModel<typeof stream>;

// ============================================================================
// Platform Integrations
// ============================================================================

export const integrationAccounts = sqliteTable(
  "platform_accounts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("userId")
      .notNull()
      .references(() => user.id),
    platform: text("platform").notNull(),
    externalId: text("external_id").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("active"),
    metadata: text("metadata"), // JSON string
    credentialsEncrypted: text("credentials_encrypted").notNull(),
    encryptionKeyId: text("encryption_key_id"),
    lastRotatedAt: integer("last_rotated_at", { mode: "timestamp" }),
    rotationCount: integer("rotation_count").notNull().default(0),
    keyVersion: integer("key_version").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
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
export const credentialRotationHistory = sqliteTable(
  "credential_rotation_history",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accountId: text("account_id")
      .notNull()
      .references(() => integrationAccounts.id, { onDelete: "cascade" }),
    credentialsEncrypted: text("credentials_encrypted").notNull(),
    encryptionKeyId: text("encryption_key_id"),
    rotatedAt: integer("rotated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    rotatedBy: text("rotated_by"),
    reason: text("reason"),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    accountIdx: index("credential_rotation_history_account_idx").on(
      table.accountId,
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
export const credentialAccessLog = sqliteTable(
  "credential_access_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    accountId: text("account_id")
      .notNull()
      .references(() => integrationAccounts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    accessedAt: integer("accessed_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    metadata: text("metadata"), // JSON string
    success: integer("success", { mode: "boolean" }).notNull().default(true),
    errorMessage: text("error_message"),
  },
  (table) => ({
    accountIdx: index("credential_access_log_account_idx").on(table.accountId),
    userIdx: index("credential_access_log_user_idx").on(table.userId),
    actionIdx: index("credential_access_log_action_idx").on(table.action),
  }),
);

export type CredentialAccessLog = InferSelectModel<typeof credentialAccessLog>;
export type InsertCredentialAccessLog = InferInsertModel<
  typeof credentialAccessLog
>;

export const integrationCatalog = sqliteTable(
  "integration_catalog",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    slug: text("slug").notNull(),
    integrationId: text("integration_id").notNull(),
    integrationType: text("integration_type").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    url: text("url").notNull(),
    logoUrl: text("logo_url"),
    config: text("config").default("{}"), // JSON string
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    slugUnique: uniqueIndex("integration_catalog_slug_idx").on(table.slug),
  }),
);

export type IntegrationCatalogEntry = InferSelectModel<
  typeof integrationCatalog
>;

// ============================================================================
// RSS Subscriptions
// ============================================================================

export const rssSubscriptions = sqliteTable(
  "rss_subscriptions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    catalogId: text("catalog_id").references(() => integrationCatalog.id, {
      onDelete: "set null",
    }),
    integrationAccountId: text("integration_account_id").references(
      () => integrationAccounts.id,
      { onDelete: "set null" },
    ),
    sourceUrl: text("source_url").notNull(),
    title: text("title"),
    category: text("category"),
    status: text("status").notNull().default("active"),
    sourceType: text("source_type").notNull().default("custom"),
    etag: text("etag"),
    lastModified: text("last_modified"),
    lastFetchedAt: integer("last_fetched_at", { mode: "timestamp" }),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    userSourceUnique: uniqueIndex("rss_subscriptions_user_url_idx").on(
      table.userId,
      table.sourceUrl,
    ),
  }),
);

export type RssSubscription = InferSelectModel<typeof rssSubscriptions>;

export const rssItems = sqliteTable(
  "rss_items",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => rssSubscriptions.id, { onDelete: "cascade" }),
    guidHash: text("guid_hash").notNull(),
    title: text("title"),
    summary: text("summary"),
    content: text("content"),
    link: text("link"),
    publishedAt: integer("published_at", { mode: "timestamp" }),
    fetchedAt: integer("fetched_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    status: text("status").notNull().default("pending"),
    metadata: text("metadata"), // JSON string
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

// ============================================================================
// Bot
// ============================================================================

export const bot = sqliteTable("Bot", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  platformAccountId: text("platform_account_id").references(
    () => integrationAccounts.id,
    {
      onDelete: "cascade",
    },
  ),
  name: text("name").notNull(),
  description: text("description").notNull(),
  adapter: text("adapter").notNull(),
  adapterConfig: text("adapter_config").notNull(), // JSON string
  enable: integer("enable", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type Bot = InferSelectModel<typeof bot>;

// ============================================================================
// Insight
// ============================================================================

type HistorySummary = {
  title: string;
  content: string;
};

type StrategicAnalysis = {
  relationship: string;
  opportunity: string;
  risk: string;
};

type Strategic = StrategicAnalysis;

type Action = InsightAction;

type Stakeholder = InsightStakeholder;

type Task = InsightTaskItem;

type RiskFlag = InsightRiskFlag;

type ActionRequiredDetails = InsightActionRequirementDetails;

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

export const insight = sqliteTable("Insight", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  botId: text("botId").notNull(),
  dedupeKey: text("dedupe_key"),
  taskLabel: text("taskLabel").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  importance: text("importance").notNull(),
  urgency: text("urgency").notNull(),
  platform: text("platform"),
  account: text("account"),
  groups: text("groups").notNull().default("[]").$type<string[]>(), // JSON array string
  people: text("people").notNull().default("[]").$type<string[]>(), // JSON array string
  time: integer("time", { mode: "timestamp" }).notNull(),
  details: text("details").$type<DetailData[] | null>(), // JSON string
  timeline: text("timeline").$type<TimelineData[] | null>(), // JSON string
  insights: text("insights").$type<StoredInsight[] | null>(), // JSON string
  trendDirection: text("trend_direction"),
  trendConfidence: text("trend_confidence").$type<number | null>(), // Numeric as text
  sentiment: text("sentiment"),
  sentimentConfidence: text("sentiment_confidence").$type<number | null>(), // Numeric as text
  intent: text("intent"),
  trend: text("trend"),
  issueStatus: text("issue_status"),
  communityTrend: text("community_trend"),
  duplicateFlag: integer("duplicate_flag", { mode: "boolean" }),
  impactLevel: text("impact_level"),
  resolutionHint: text("resolution_hint"),
  topKeywords: text("top_keywords").default("[]").$type<string[]>(), // JSON array string
  topEntities: text("top_entities").default("[]").$type<string[]>(), // JSON array string
  topVoices: text("top_voices").$type<InsightTopVoice[] | null>(), // JSON string
  sources: text("sources").$type<InsightSource[] | null>(), // JSON string
  sourceConcentration: text("source_concentration"),
  buyerSignals: text("buyer_signals").default("[]").$type<string[]>(), // JSON array string
  stakeholders: text("stakeholders").$type<InsightStakeholder[] | null>(), // JSON string
  contractStatus: text("contract_status"),
  signalType: text("signal_type"),
  confidence: text("confidence").$type<number | null>(), // Numeric as text
  scope: text("scope"),
  nextActions: text("next_actions").$type<InsightAction[] | null>(), // JSON string
  followUps: text("follow_ups").$type<InsightFollowUp[] | null>(), // JSON string
  actionRequired: integer("action_required", { mode: "boolean" }),
  actionRequiredDetails: text(
    "action_required_details",
  ).$type<InsightActionRequirementDetails | null>(), // JSON string
  isUnreplied: integer("is_unreplied", { mode: "boolean" }).default(false),
  myTasks: text("my_tasks").$type<InsightTaskItem[] | null>(), // JSON string
  waitingForMe: text("waiting_for_me").$type<InsightTaskItem[] | null>(), // JSON string
  waitingForOthers: text("waiting_for_others").$type<
    InsightTaskItem[] | null
  >(), // JSON string
  clarifyNeeded: integer("clarify_needed", { mode: "boolean" }),
  categories: text("categories").default("[]").$type<string[]>(), // JSON array string
  learning: text("learning"),
  priority: text("priority").$type<InsightPriority | null>(), // JSON string
  experimentIdeas: text("experiment_ideas").$type<
    InsightExperimentIdea[] | null
  >(), // JSON string
  executiveSummary: text("executive_summary"),
  riskFlags: text("risk_flags").$type<InsightRiskFlag[] | null>(), // JSON string
  client: text("client"),
  projectName: text("project_name"),
  nextMilestone: text("next_milestone"),
  dueDate: text("due_date"),
  paymentInfo: text("payment_info"),
  entity: text("entity"),
  why: text("why"),
  historySummary: text("history_summary").$type<HistorySummary | null>(), // JSON string
  strategic: text("strategic").$type<Strategic | null>(), // JSON string
  roleAttribution: text(
    "role_attribution",
  ).$type<InsightRoleAttribution | null>(), // JSON string
  alerts: text("alerts").$type<InsightAlert[] | null>(), // JSON string
  compactedIntoInsightId: text("compacted_into_insight_id"),
  pendingDeletionAt: integer("pending_deletion_at", { mode: "timestamp" }),
  isArchived: integer("is_archived", { mode: "boolean" })
    .notNull()
    .default(false),
  isFavorited: integer("is_favorited", { mode: "boolean" })
    .notNull()
    .default(false),
  archivedAt: integer("archived_at", { mode: "timestamp" }),
  favoritedAt: integer("favorited_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  timelineVersion: integer("timeline_version").notNull().default(1),
  lastTimelineUpdate: integer("last_timeline_update", { mode: "timestamp" }),
});

export type Insight = InferSelectModel<typeof insight>;
export type InsertInsight = InferInsertModel<typeof insight>;

export const insightCompactionLinks = sqliteTable(
  "insight_compaction_links",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    compactedInsightId: text("compacted_insight_id")
      .notNull()
      .references(() => insight.id, { onDelete: "cascade" }),
    sourceInsightId: text("source_insight_id")
      .notNull()
      .references(() => insight.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    uniqueCompactedSource: uniqueIndex(
      "insight_compaction_links_compacted_source_idx",
    ).on(table.compactedInsightId, table.sourceInsightId),
    userIdx: index("insight_compaction_links_user_idx").on(table.userId),
    compactedIdx: index("insight_compaction_links_compacted_idx").on(
      table.compactedInsightId,
    ),
    sourceIdx: index("insight_compaction_links_source_idx").on(
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
// ============================================================================
// Insight Notes
// ============================================================================

// Insight Notes Table
// Stores user notes/comments on insights
export const insightNotes = sqliteTable("insight_notes", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  insightId: text("insight_id")
    .notNull()
    .references(() => insight.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  content: text("content").notNull(),
  source: text("source", {
    enum: ["manual", "ai_conversation"],
  })
    .notNull()
    .default("manual"),
  sourceMessageId: text("source_message_id"), // Optional: reference to message if from AI conversation
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type InsightNote = InferSelectModel<typeof insightNotes>;
export type InsertInsightNote = InferInsertModel<typeof insightNotes>;

// ============================================================================
// Insight Brief Categories
// ============================================================================

// Insight Brief Categories Table
// Stores user's manual category assignments for insights in Brief panel
export const insightBriefCategories = sqliteTable(
  "insight_brief_categories",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    insightId: text("insight_id")
      .notNull()
      .references(() => insight.id, { onDelete: "cascade" }),
    category: text("category", {
      enum: ["urgent", "important", "monitor", "archive"],
    }).notNull(),
    dedupeKey: text("dedupe_key"), // For exact matching similar insights
    title: text("title"), // For fuzzy matching similar insights
    assignedAt: integer("assigned_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    source: text("source", { enum: ["manual", "auto", "unpinned"] })
      .notNull()
      .default("manual"),
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

// ============================================================================
// Insight Documents
// ============================================================================

// Insight Documents Table
// Associates documents with insights
export const insightDocuments = sqliteTable("insight_documents", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  insightId: text("insight_id")
    .notNull()
    .references(() => insight.id, { onDelete: "cascade" }),
  documentId: text("document_id")
    .notNull()
    .references(() => ragDocuments.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type InsightDocument = InferSelectModel<typeof insightDocuments>;
export type InsertInsightDocument = InferInsertModel<typeof insightDocuments>;

// ============================================================================
// Insight Settings & Filters
// ============================================================================

export const userInsightSettings = sqliteTable("user_insight_settings", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  focusPeople: text("focus_people").notNull().default("[]"), // JSON array string
  focusTopics: text("focus_topics").notNull().default("[]"), // JSON array string
  language: text("language").notNull().default(""),
  refreshIntervalMinutes: integer("refresh_interval_minutes")
    .notNull()
    .default(60),
  aiSoulPrompt: text("ai_soul_prompt"),
  /** User manually filled industry (JSON array string), max 4 items */
  identityIndustries: text("identity_industries"),
  /** User manually filled work description, max 5000 characters */
  identityWorkDescription: text("identity_work_description"),
  lastMessageProcessedAt: integer("last_message_processed_at", {
    mode: "timestamp",
  }),
  lastActiveAt: integer("last_active_at", { mode: "timestamp" }),
  lastInsightMaintenanceRunAt: integer("last_insight_maintenance_run_at", {
    mode: "timestamp",
  }),
  activityTier: text("activity_tier").notNull().default("low"),
  lastUpdated: integer("last_updated", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type DBInsightSettings = InferSelectModel<typeof userInsightSettings>;
export type DBInsertInsightSettings = InferInsertModel<
  typeof userInsightSettings
>;

const KNOWN_ACTIVITY_TIERS = new Set(["high", "medium", "low", "dormant"]);

export const insightTimelineHistory = sqliteTable(
  "insight_timeline_history",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    insightId: text("insight_id")
      .notNull()
      .references(() => insight.id, { onDelete: "cascade" }),
    timelineEventId: text("timeline_event_id").notNull(),
    version: integer("version").notNull(),
    eventTime: text("event_time"), // Numeric as text
    summary: text("summary").notNull(),
    label: text("label").notNull(),
    changeType: text("change_type").notNull(),
    changeReason: text("change_reason").notNull(),
    changedBy: text("changed_by").notNull().default("system"),
    previousSnapshot: text("previous_snapshot").$type<Record<
      string,
      unknown
    > | null>(), // JSON object
    diffSummary: text("diff_summary"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
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

// Insight Processing Failures
export const insightProcessingFailures = sqliteTable(
  "insight_processing_failures",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    botId: text("bot_id")
      .notNull()
      .references(() => bot.id, { onDelete: "cascade" }),
    groupName: text("group_name").notNull(),
    failureCount: integer("failure_count").notNull().default(1),
    status: text("status").notNull().default("pending"), // pending | retrying | skipped
    lastError: text("last_error"),
    lastAttemptedAt: integer("last_attempted_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    processedSince: integer("processed_since").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    // Unique constraint: one record per bot per group
    uniqueBotGroup: uniqueIndex("insight_failures_bot_group_idx").on(
      table.botId,
      table.groupName,
    ),
    // Query optimization: fast lookup for retry candidates
    botStatusIdx: index("insight_failures_bot_status_idx").on(
      table.botId,
      table.status,
    ),
    // Cleanup optimization: find expired failure records
    attemptedAtIdx: index("insight_failures_attempted_idx").on(
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

// ============================================================================
// Helper Functions (ported from PG schema)
// ============================================================================

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
  aiSoulPrompt: string | null;
  identityIndustries: string[] | null;
  identityWorkDescription: string | null;
  lastMessageProcessedAt: Date | null;
  lastActiveAt: Date | null;
  lastInsightMaintenanceRunAt?: Date | null;
  activityTier: "high" | "medium" | "low" | "dormant";
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
    aiSoulPrompt: dbSettings.aiSoulPrompt ?? null,
    identityIndustries:
      dbSettings.identityIndustries != null
        ? (JSON.parse(dbSettings.identityIndustries) as string[])
        : null,
    identityWorkDescription: dbSettings.identityWorkDescription ?? null,
    lastMessageProcessedAt: dbSettings.lastMessageProcessedAt ?? null,
    lastActiveAt: dbSettings.lastActiveAt ?? null,
    lastInsightMaintenanceRunAt: dbSettings.lastInsightMaintenanceRunAt ?? null,
    activityTier: normalizeActivityTier(dbSettings.activityTier),
    lastUpdated: dbSettings.lastUpdated,
  };
}

export function serializeInsightSettings(
  settings: InsightSettings,
): Omit<DBInsertInsightSettings, "id" | "lastUpdated"> {
  return {
    userId: settings.userId,
    focusPeople: JSON.stringify(settings.focusPeople),
    focusTopics: JSON.stringify(settings.focusTopics),
    language: settings.language,
    refreshIntervalMinutes: settings.refreshIntervalMinutes,
    aiSoulPrompt: settings.aiSoulPrompt ?? null,
    identityIndustries:
      settings.identityIndustries != null &&
      settings.identityIndustries.length > 0
        ? JSON.stringify(settings.identityIndustries)
        : null,
    identityWorkDescription: settings.identityWorkDescription ?? null,
    lastMessageProcessedAt: settings.lastMessageProcessedAt,
    lastActiveAt: settings.lastActiveAt,
    lastInsightMaintenanceRunAt: settings.lastInsightMaintenanceRunAt,
    activityTier: settings.activityTier,
  };
}

// ============================================================================
// RAG (Retrieval-Augmented Generation) Tables
// ============================================================================

export const ragDocuments = sqliteTable("rag_documents", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  totalChunks: integer("total_chunks").notNull().default(0),
  blobPath: text("blob_path"), // Path to the original binary file (e.g., Vercel Blob URL or local file path)
  uploadedAt: integer("uploaded_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  metadata: text("metadata"), // JSON string
});

export type RAGDocument = InferSelectModel<typeof ragDocuments>;
export type InsertRAGDocument = InferInsertModel<typeof ragDocuments>;

export const ragChunks = sqliteTable(
  "rag_chunks",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => ragDocuments.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: text("embedding"), // JSON array string for vector, nullable for skipEmbeddings mode
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    metadata: text("metadata"), // JSON string
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

// ============================================================================
// Missing Tables (converted from PostgreSQL schema)
// ============================================================================

// User Subscriptions
export const userSubscriptions = sqliteTable(
  "user_subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    planName: text("plan_name").notNull(),
    startDate: integer("start_date", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    endDate: integer("end_date", { mode: "timestamp" }),
    isActive: integer("is_active", { mode: "boolean" }).default(true),
    autoRenew: integer("auto_renew", { mode: "boolean" }).default(true),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeCustomerId: text("stripe_customer_id"),
    stripePriceId: text("stripe_price_id"),
    status: text("status").default("incomplete").notNull(),
    billingCycle: text("billing_cycle"),
    lastPaymentDate: integer("last_payment_date", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    affiliateId: text("affiliate_id"),
    affiliateCode: text("affiliate_code"),
    affiliateCommissionRate: text("affiliate_commission_rate"), // numeric as text
  },
  (table) => ({
    uniqueUserSubscription: uniqueIndex("unique_user_subscription").on(
      table.userId,
      table.isActive,
    ),
  }),
);

export type UserSubscription = InferSelectModel<typeof userSubscriptions>;
export type InsertUserSubscription = InferInsertModel<typeof userSubscriptions>;

// Insight Filters
export const insightFilters = sqliteTable(
  "insight_filters",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    color: text("color"),
    icon: text("icon"),
    sortOrder: integer("sort_order").notNull().default(0),
    isPinned: integer("is_pinned", { mode: "boolean" })
      .notNull()
      .default(false),
    isArchived: integer("is_archived", { mode: "boolean" })
      .notNull()
      .default(false),
    source: text("source").notNull().default("user"),
    definition: text("definition").notNull(), // JSON string
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
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

// Insight Tabs
export const insightTabs = sqliteTable(
  "insight_tabs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    icon: text("icon"),
    filterIds: text("filter_ids").$type<string[]>(), // JSON array string
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    userIdIdx: index("insight_tabs_user_idx").on(table.userId),
  }),
);

export type DBInsightTab = InferSelectModel<typeof insightTabs>;
export type DBInsertInsightTab = InferInsertModel<typeof insightTabs>;

// User Categories
export const userCategories = sqliteTable(
  "user_categories",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    color: text("color"),
    icon: text("icon"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    userIdIdx: index("user_categories_user_idx").on(table.userId),
    userIdNameIdx: uniqueIndex("user_categories_user_name_idx").on(
      table.userId,
      table.name,
    ),
  }),
);

export type DBUserCategory = InferSelectModel<typeof userCategories>;
export type DBInsertUserCategory = InferInsertModel<typeof userCategories>;

// User Contacts
export const userContacts = sqliteTable(
  "user_meta_contacts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    contactId: text("contact_id").notNull(),
    contactName: text("contact_name").notNull(),
    type: text("contact_type"),
    botId: text("bot_id"),
    contactMeta: text("contact_meta"), // JSON string
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
export type InsertUserContact = InferInsertModel<typeof userContacts>;

/** DingTalk inbound message cache (Insight), aligned with PostgreSQL table name */
export const dingtalkBotInsightMessages = sqliteTable(
  "dingtalk_bot_insight_messages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    botId: text("bot_id")
      .notNull()
      .references(() => bot.id),
    chatId: text("chat_id").notNull(),
    msgId: text("msg_id").notNull(),
    senderId: text("sender_id"),
    senderName: text("sender_name"),
    text: text("text").notNull(),
    tsSec: integer("ts_sec").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
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

// Feedback
export const feedback = sqliteTable(
  "feedback",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }), // Optional: supports anonymous feedback
    contactEmail: text("contact_email"), // Optional: contact email for anonymous users
    content: text("content").notNull(),
    type: text("type").notNull(), // 'bug', 'feature', 'improvement', 'general'
    title: text("title").notNull(),
    description: text("description").notNull(),
    status: text("status").notNull().default("open"), // 'open', 'in_progress', 'resolved', 'closed'
    priority: text("priority").default("medium"), // 'low', 'medium', 'high', 'urgent'
    source: text("source").default("web"), // 'web', 'desktop', 'api'
    systemInfo: text("system_info"), // JSON string: System info (platform, version, etc.)
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    userIdIdx: index("feedback_user_idx").on(table.userId),
    statusIdx: index("feedback_status_idx").on(table.status),
  }),
);

export type Feedback = InferSelectModel<typeof feedback>;
export type InsertFeedback = InferInsertModel<typeof feedback>;

// Survey
export const survey = sqliteTable(
  "survey",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    industry: text("industry").notNull(), // Industry
    role: text("role").notNull(), // Role
    roles: text("roles").default("[]"), // Multi-role selection, JSON array string
    otherRole: text("other_role"), // Other role
    size: text("size").notNull(), // Company size
    communicationTools: text("communication_tools").notNull().default("[]"), // Communication tools, JSON array string
    dailyMessages: text("daily_messages").notNull(), // Daily message volume
    challenges: text("challenges").notNull().default("[]"), // Pain points/issues, JSON array string
    workDescription: text("work_description"), // Work description
    submittedAt: integer("submitted_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`), // Submission time
  },
  (table) => ({
    userIdIdx: index("survey_user_idx").on(table.userId),
  }),
);

export type Survey = InferSelectModel<typeof survey>;
export type InsertSurvey = InferInsertModel<typeof survey>;

// Report Events
export const reportEvents = sqliteTable(
  "report_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    cadence: text("cadence").notNull().default("weekly"),
    sourceType: text("source_type").notNull(),
    provider: text("provider").notNull(),
    sourceId: text("source_id").notNull(),
    occurredAt: integer("occurred_at", { mode: "timestamp" }).notNull(),
    importance: text("importance").notNull().default("medium"),
    topicKey: text("topic_key"),
    summary: text("summary").notNull(),
    metadata: text("metadata"), // JSON string
    ingestedAt: integer("ingested_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    weekBucket: text("week_bucket").notNull(), // Date as ISO string
    monthBucket: text("month_bucket"), // Date as ISO string
    dedupeHash: text("dedupe_hash").notNull(),
  },
  (table) => ({
    uniqueEvent: uniqueIndex("report_events_user_source_idx").on(
      table.userId,
      table.sourceType,
      table.sourceId,
    ),
    dedupe: uniqueIndex("report_events_dedupe_idx").on(
      table.userId,
      table.dedupeHash,
    ),
    weekIdx: index("report_events_user_week_idx").on(
      table.userId,
      table.weekBucket,
    ),
  }),
);

export type ReportEvent = InferSelectModel<typeof reportEvents>;
export type InsertReportEvent = InferInsertModel<typeof reportEvents>;

// User Email Preferences
export const userEmailPreferences = sqliteTable(
  "user_email_preferences",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    marketingOptIn: integer("marketing_opt_in", { mode: "boolean" })
      .notNull()
      .default(sql`1`),
    marketingOptedOutAt: integer("marketing_opted_out_at", {
      mode: "timestamp",
    }),
    unsubscribeToken: text("unsubscribe_token").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    lastEmailSentAt: integer("last_email_sent_at", { mode: "timestamp" }),
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

// Marketing Email Log
export const marketingEmailLog = sqliteTable(
  "marketing_email_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    stage: text("stage").notNull(),
    template: text("template").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").notNull().default("sent"),
    error: text("error"),
    metadata: text("metadata"), // JSON string
    sentAt: integer("sent_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
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

// Weekly Reports
export const weeklyReports = sqliteTable(
  "weekly_reports",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    cadence: text("cadence").notNull().default("weekly"),
    rangeStart: text("range_start").notNull(), // Date as ISO string
    rangeEnd: text("range_end").notNull(), // Date as ISO string
    status: text("status").notNull().default("draft"),
    structuredPayload: text("structured_payload").notNull(), // JSON string
    markdown: text("markdown").notNull(),
    generatedAt: integer("generated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    editedAt: integer("edited_at", { mode: "timestamp" }),
    sentAt: integer("sent_at", { mode: "timestamp" }),
    sourceStats: text("source_stats"), // JSON string
    modelVersion: text("model_version").notNull(),
    checksum: text("checksum"),
  },
  (table) => ({
    uniqueRange: uniqueIndex("weekly_reports_user_role_range_idx").on(
      table.userId,
      table.role,
      table.rangeStart,
      table.cadence,
    ),
    rangeIdx: index("weekly_reports_range_idx").on(
      table.userId,
      table.rangeStart,
      table.rangeEnd,
    ),
  }),
);

export type WeeklyReport = InferSelectModel<typeof weeklyReports>;
export type InsertWeeklyReport = InferInsertModel<typeof weeklyReports>;

// Weekly Report Revisions
export const weeklyReportRevisions = sqliteTable(
  "weekly_report_revisions",
  {
    id: text("id").primaryKey(),
    reportId: text("report_id")
      .notNull()
      .references(() => weeklyReports.id, { onDelete: "cascade" }),
    snapshotType: text("snapshot_type").notNull().default("system"),
    payload: text("payload").notNull(), // JSON string
    markdown: text("markdown").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => ({
    reportIdx: index("weekly_report_revisions_report_idx").on(table.reportId),
  }),
);

export type WeeklyReportRevision = InferSelectModel<
  typeof weeklyReportRevisions
>;
export type InsertWeeklyReportRevision = InferInsertModel<
  typeof weeklyReportRevisions
>;

// People Graph Snapshot
export const peopleGraphSnapshot = sqliteTable(
  "people_graph_snapshot",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    nodes: text("nodes").notNull(), // JSON string
    edges: text("edges").notNull(), // JSON string
    context: text("context").notNull().default(""),
    windowDays: integer("window_days").notNull().default(90),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    uniq: uniqueIndex("people_graph_snapshot_user_idx").on(table.userId),
  }),
);

export type DBPeopleGraphSnapshot = InferSelectModel<
  typeof peopleGraphSnapshot
>;
export type DBInsertPeopleGraphSnapshot = InferInsertModel<
  typeof peopleGraphSnapshot
>;

// Person Custom Fields
export const personCustomFields = sqliteTable(
  "person_custom_fields",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    personId: text("person_id").notNull(),
    fields: text("fields").notNull().default("{}"), // JSON string
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
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

// User Roles
export const userRoles = sqliteTable(
  "user_roles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    roleKey: text("role_key").notNull(), // Role key like 'admin', 'user', 'moderator', etc.
    source: text("source").notNull(), // Where this role came from: 'profile', 'inferred', etc.
    confidence: text("confidence").notNull().default("0.5").$type<number>(), // Confidence score as text (SQLite doesn't have numeric type)
    firstDetectedAt: integer("first_detected_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    lastConfirmedAt: integer("last_confirmed_at", { mode: "timestamp" }),
    evidence: text("evidence"), // JSON string for evidence object
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    userIdIdx: index("user_roles_user_idx").on(table.userId, table.roleKey), // Aligned with PG: composite index
    uniqueRole: uniqueIndex("user_roles_unique").on(
      // Aligned with PG: includes source
      table.userId,
      table.roleKey,
      table.source,
    ),
  }),
);

export type UserRole = InferSelectModel<typeof userRoles>;
export type InsertUserRole = InferInsertModel<typeof userRoles>;

// Telegram Accounts
export const telegramAccounts = sqliteTable(
  "telegram_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    telegramUserId: text("telegram_user_id").notNull(),
    telegramChatId: text("telegram_chat_id").notNull(),
    username: text("username"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    languageCode: text("language_code"),
    isBot: integer("is_bot", { mode: "boolean" }).notNull().default(false),
    linkedAt: integer("linked_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    lastCommandAt: integer("last_command_at", { mode: "timestamp" }),
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

// WhatsApp Accounts
export const whatsappAccounts = sqliteTable(
  "whatsapp_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    whatsappUserId: text("whatsapp_user_id").notNull(), // Phone number
    username: text("username"),
    pushName: text("push_name"),
    linkedAt: integer("linked_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    lastCommandAt: integer("last_command_at", { mode: "timestamp" }),
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

// Discord Accounts
export const discordAccounts = sqliteTable(
  "discord_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    discordUserId: text("discord_user_id").notNull(),
    discordGuildId: text("discord_guild_id"),
    discordChannelId: text("discord_channel_id"),
    username: text("username"),
    globalName: text("global_name"),
    linkedAt: integer("linked_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    lastCommandAt: integer("last_command_at", { mode: "timestamp" }),
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

// ============================================================================
// Quota & Credits
// ============================================================================

// User Free Quota
export const userFreeQuota = sqliteTable(
  "user_free_quota",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    totalQuota: integer("total_quota").notNull().default(100), // Default free tier quota
    usedQuota: integer("used_quota").notNull().default(0),
    lastAdjustedAt: integer("last_adjusted_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    uniqueUser: uniqueIndex("unique_free_user").on(table.userId),
  }),
);

export type UserFreeQuota = InferSelectModel<typeof userFreeQuota>;

// User Monthly Quota
export const userMonthlyQuota = sqliteTable(
  "user_monthly_quota",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    year: integer("year").notNull(), // Year (e.g., 2024)
    month: integer("month").notNull(), // Month (1-12)
    totalQuota: integer("total_quota").notNull(), // Monthly total quota (based on subscription plan)
    usedQuota: integer("used_quota").notNull().default(0), // Monthly used quota
    isRefreshed: integer("is_refreshed", { mode: "boolean" }).default(false), // Flag: whether monthly refresh is completed
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
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

export type UserMonthlyQuota = InferSelectModel<typeof userMonthlyQuota>;

// User Reward Events
export const userRewardEvents = sqliteTable(
  "user_reward_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    rewardType: text("reward_type").notNull(),
    status: text("status").notNull().default("available"),
    creditsGranted: integer("credits_granted").notNull().default(0),
    triggerReference: text("trigger_reference"),
    metadata: text("metadata"), // JSON string
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    grantedAt: integer("granted_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    userIdIdx: index("user_reward_events_user_idx").on(table.userId),
    statusIdx: index("user_reward_events_status_idx").on(table.status),
    rewardTypeUnique: uniqueIndex("user_reward_unique_type").on(
      // Aligned with PG
      table.userId,
      table.rewardType,
    ),
  }),
);

export type UserRewardEvent = InferSelectModel<typeof userRewardEvents>;

// User Credit Ledger
export const userCreditLedger = sqliteTable(
  "user_credit_ledger",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(), // Aligned with PG: Positive = credit, Negative = debit
    balanceAfter: integer("balance_after"), // Aligned with PG: allowed to be null
    source: text("source").notNull().default("reward"), // Aligned with PG
    rewardEventId: text("reward_event_id").references(
      () => userRewardEvents.id,
    ), // Aligned with PG
    metadata: text("metadata"), // JSON string
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    userIdIdx: index("user_credit_ledger_user_idx").on(table.userId),
    userIdCreatedAtIdx: index("user_credit_ledger_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  }),
);

export type UserCreditLedger = InferSelectModel<typeof userCreditLedger>;

// ============================================================================
// Presentation Types
// ============================================================================

export type PresentationTemplateType =
  | "weekly_deck"
  | "project_status"
  | "product_proposal"
  | "account_review"
  | "ops_review"
  | "executive_deck"
  | "pitch"
  | "custom";

export type PresentationJobStatus =
  | "queued"
  | "collecting_sources"
  | "structuring_layers"
  | "preparing_prompt"
  | "gamma_generating"
  | "downloading_artifacts"
  | "ready"
  | "failed"
  | "cancelled";

export type PresentationRequestedFormat = "pptx" | "pdf" | "html";

export type PresentationProgressStepId =
  | "collect_sources"
  | "structure_layers"
  | "reasoning"
  | "prepare_prompt"
  | "gamma_generate"
  | "download_artifacts";

export type PresentationProgressStepStatus = "pending" | "active" | "complete";

export type PresentationJobProgressStep = {
  id: PresentationProgressStepId;
  label: string;
  status: PresentationProgressStepStatus;
  startedAt?: string | null;
  completedAt?: string | null;
};

export type PresentationJobProgress = {
  stage: PresentationJobStatus;
  percent: number;
  steps: PresentationJobProgressStep[];
};

export type PresentationSourceFilters = {
  channels?: string[];
  files?: string[];
  tasks?: string[];
} | null;

export type PresentationStyleProfile = Record<string, unknown> | null;

export type PresentationGammaStatus = {
  status?: string | null;
  gammaUrl?: string | null;
  credits?: {
    deducted?: number | null;
    remaining?: number | null;
  } | null;
  message?: string | null;
} | null;

export type PresentationEventLayerItem = {
  id: string;
  occurredAt: string;
  title: string;
  summary: string;
  category:
    | "highlight"
    | "decision"
    | "risk"
    | "dependency"
    | "request"
    | "milestone";
  importance: "low" | "medium" | "high";
  source: { provider: string; channel?: string; url?: string };
  relatedTasks?: Array<{ id?: string; title?: string; status?: string }>;
  tags?: string[];
};

export type PresentationKnowledgeLayerNode = {
  id: string;
  topic: string;
  problem: string;
  opportunity?: string;
  insights: string[];
  metrics?: Array<{ label: string; value: string; delta?: string }>;
  supportingEvents: string[];
};

export type PresentationReasoningLayerItem = {
  id: string;
  conclusion: string;
  rationale: string[];
  risks?: string[];
  nextSteps?: string[];
  tone: "sales" | "support" | "community" | "executive" | "personal";
};

export type PresentationSlideBlock =
  | string
  | PresentationEventLayerItem[]
  | PresentationKnowledgeLayerNode[]
  | PresentationReasoningLayerItem[];

export type PresentationSlideDefinition = {
  id: string;
  templateSlot:
    | "cover"
    | "highlights"
    | "timeline"
    | "events"
    | "problems"
    | "opportunities"
    | "reasoning"
    | "plan"
    | "risks"
    | "attachments";
  title: string;
  layout: "title-bullets" | "two-column" | "timeline" | "table" | "summary";
  blocks: Array<{
    type: "text" | "timeline" | "table" | "image";
    content: PresentationSlideBlock;
  }>;
};

export type PresentationOutlinePayload = {
  eventLayer: PresentationEventLayerItem[];
  knowledgeLayer: PresentationKnowledgeLayerNode[];
  reasoningLayer: PresentationReasoningLayerItem[];
  slides: PresentationSlideDefinition[];
  timeline?: Record<string, unknown> | null;
  sourceStats?: Record<string, unknown>;
  modelVersion?: string;
};

// ============================================================================
// Presentation Tables
// ============================================================================

export const presentationJobs = sqliteTable(
  "presentation_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    templateType: text("template_type").notNull(),
    cadence: text("cadence").notNull().default("weekly"),
    timeRangeStart: text("time_range_start").notNull(), // Date as ISO string
    timeRangeEnd: text("time_range_end").notNull(), // Date as ISO string
    status: text("status").notNull().default("queued"),
    progress: text("progress"), // JSON string
    sourceFilters: text("source_filters"), // JSON string
    styleProfile: text("style_profile"), // JSON string
    requestedFormats: text("requested_formats")
      .notNull()
      .default('["pptx"]')
      .$type<string[]>(), // JSON array string
    gammaGenerationId: text("gamma_generation_id"),
    gammaTemplateId: text("gamma_template_id"),
    gammaStatus: text("gamma_status"), // JSON string
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => ({
    userIdx: index("presentation_jobs_user_idx").on(
      table.userId,
      table.createdAt,
    ),
    statusIdx: index("presentation_jobs_status_idx").on(table.status),
  }),
);

export type PresentationJob = InferSelectModel<typeof presentationJobs>;
export type InsertPresentationJob = InferInsertModel<typeof presentationJobs>;

export const presentationOutlines = sqliteTable(
  "presentation_outlines",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => presentationJobs.id, { onDelete: "cascade" }),
    eventLayer: text("event_layer").notNull(), // JSON string
    knowledgeLayer: text("knowledge_layer").notNull(), // JSON string
    reasoningLayer: text("reasoning_layer").notNull(), // JSON string
    slides: text("slides").notNull(), // JSON string
    timeline: text("timeline"), // JSON string
    sourceStats: text("source_stats"), // JSON string
    modelVersion: text("model_version").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    jobIdx: index("presentation_outlines_job_idx").on(table.jobId),
  }),
);

export type PresentationOutline = InferSelectModel<typeof presentationOutlines>;
export type InsertPresentationOutline = InferInsertModel<
  typeof presentationOutlines
>;

// User File Usage tracking
export const userFileUsage = sqliteTable("user_file_usage", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  usedBytes: integer("used_bytes").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type UserFileUsage = InferSelectModel<typeof userFileUsage>;

// User Files (needed for presentation artifacts)
export const userFiles = sqliteTable(
  "user_files",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    chatId: text("chat_id").references(() => chat.id, {
      onDelete: "set null",
    }),
    messageId: text("message_id").references(() => message.id, {
      onDelete: "set null",
    }),
    blobUrl: text("blob_url").notNull(),
    blobPathname: text("blob_pathname").notNull(),
    storageProvider: text("storage_provider").notNull().default("vercel_blob"),
    providerFileId: text("provider_file_id"),
    providerMetadata: text("provider_metadata"), // JSON string
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    savedAt: integer("saved_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
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

export const presentationArtifacts = sqliteTable(
  "presentation_artifacts",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => presentationJobs.id, { onDelete: "cascade" }),
    format: text("format").notNull(),
    fileId: text("file_id")
      .notNull()
      .references(() => userFiles.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("gamma"),
    gammaExportUrl: text("gamma_export_url"),
    checksum: text("checksum"),
    sizeBytes: integer("size_bytes"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => ({
    jobFormatIdx: uniqueIndex("presentation_artifacts_job_format_idx").on(
      table.jobId,
      table.format,
    ),
  }),
);

export type PresentationArtifact = InferSelectModel<
  typeof presentationArtifacts
>;
export type InsertPresentationArtifact = InferInsertModel<
  typeof presentationArtifacts
>;

// ============================================================================
// SCHEDULED JOBS SYSTEM (SQLite version)
// ============================================================================

// Scheduled jobs table - stores cron jobs and scheduled tasks
export const scheduledJobs = sqliteTable(
  "scheduled_jobs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),

    // Schedule configuration
    scheduleType: text("schedule_type").notNull().default("cron"), // cron | interval | once
    cronExpression: text("cron_expression"), // for type=cron
    intervalMinutes: integer("interval_minutes"), // for type=interval
    scheduledAt: integer("scheduled_at", { mode: "timestamp" }), // for type=once

    // Job configuration
    jobType: text("job_type").notNull().default("custom"), // agent | webhook | insight_refresh | custom
    jobConfig: text("job_config")
      .notNull()
      .default("{}")
      .$type<Record<string, unknown>>(), // JSON object

    // Execution settings
    enabled: integer("enabled", { mode: "boolean" })
      .notNull()
      .default(sql`1`),
    timezone: text("timezone").notNull().default("UTC"),

    // State tracking
    lastRunAt: integer("last_run_at", { mode: "timestamp" }),
    nextRunAt: integer("next_run_at", { mode: "timestamp" }),
    lastStatus: text("last_status"), // success | error | running | pending
    lastError: text("last_error"),
    runCount: integer("run_count").notNull().default(0),
    failureCount: integer("failure_count").notNull().default(0),

    // Timestamps
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
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

// Job execution history table - logs each job execution
export const jobExecutions = sqliteTable(
  "job_executions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    jobId: text("job_id")
      .notNull()
      .references(() => scheduledJobs.id, { onDelete: "cascade" }),

    // Execution details
    status: text("status").notNull(), // success | error | timeout
    startedAt: integer("started_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    durationMs: integer("duration_ms"),

    // Result data
    result: text("result").$type<Record<string, unknown> | null>(), // JSON object
    error: text("error"), // Error message if failed
    output: text("output"), // Text output/logs

    // Metadata
    triggeredBy: text("triggered_by").notNull().default("scheduler"), // scheduler | manual | api
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
export const characters = sqliteTable("characters", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  avatarConfig: text("avatar_config").default(JSON.stringify({})),
  jobId: text("job_id")
    .notNull()
    .unique()
    .references(() => scheduledJobs.id, { onDelete: "cascade" }),
  insightId: text("insight_id")
    .notNull()
    .unique()
    .references(() => insight.id, { onDelete: "set null" }),
  status: text("status").notNull().default("active"),
  lastExecutionAt: integer("last_execution_at", { mode: "timestamp" }),
  lastExecutionStatus: text("last_execution_status"),
  sources: text("sources").default(JSON.stringify([])),
  topics: text("topics").default(JSON.stringify([])),
  notificationChannels: text("notification_channels").default(
    JSON.stringify([]),
  ),
  systemNotification: integer("system_notification", { mode: "boolean" })
    .notNull()
    .default(sql`1`),
  systemType: text("system_type"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type Character = InferSelectModel<typeof characters>;
export type InsertCharacter = InferInsertModel<typeof characters>;

// ============================================================================
// Weight Management Tables
// ============================================================================

// Insight Weights Table (SQLite)
// Stores weight-related data for insights (separate table for cleaner separation)
export const insightWeights = sqliteTable(
  "insight_weights",
  {
    id: text("id").primaryKey(),
    insightId: text("insight_id").references(() => insight.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    customWeightMultiplier: integer("custom_weight_multiplier")
      .notNull()
      .default(1),
    lastViewedAt: integer("last_viewed_at", { mode: "timestamp" }).notNull(),
    lastRankCalculatedAt: integer("last_rank_calculated_at", {
      mode: "timestamp",
    }).notNull(),
    currentEventRank: integer("current_event_rank").notNull().default(0),
    accessCountTotal: integer("access_count_total").notNull().default(0),
    accessCount7d: integer("access_count_7d").notNull().default(0),
    accessCount30d: integer("access_count_30d").notNull().default(0),
    lastAccessedAt: integer("last_accessed_at", { mode: "timestamp" }),
    lastWeightAdjustmentReason: text("last_weight_adjustment_reason"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
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

// Insight Weight History Table (SQLite)
// Tracks all weight adjustments for insights
export const insightWeightHistory = sqliteTable(
  "insight_weight_history",
  {
    id: text("id").primaryKey(),
    insightId: text("insight_id").references(() => insight.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    adjustmentType: text("adjustment_type").notNull(),
    weightBefore: text("weight_before").notNull(),
    weightAfter: text("weight_after").notNull(),
    weightDelta: text("weight_delta").notNull(),
    customMultiplierBefore: text("custom_multiplier_before"),
    customMultiplierAfter: text("custom_multiplier_after"),
    reason: text("reason").notNull(),
    context: text("context").$type<string | null>(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
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

// Insight View History Table (SQLite)
// Tracks user views of insights
export const insightViewHistory = sqliteTable(
  "insight_view_history",
  {
    id: text("id").primaryKey(),
    insightId: text("insight_id").references(() => insight.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    viewDurationSeconds: integer("view_duration_seconds"),
    viewSource: text("view_source").notNull(),
    viewContext: text("view_context").$type<string | null>(),
    viewedAt: integer("viewed_at", { mode: "timestamp" }).notNull(),
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

// Insight Weight Config Table (SQLite)
// Stores weight configuration (global and per-user)
export const insightWeightConfig = sqliteTable(
  "insight_weight_config",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    configKey: text("config_key").notNull(),
    configValue: text("config_value").notNull(),
    description: text("description"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
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
