/**
 * @openloomi/integrations/core - Shared interfaces for integration platform implementations
 *
 * These interfaces define the contract between the platform-agnostic integration code
 * in @openloomi/integrations and the application-specific implementations provided by
 * the consuming application (e.g., apps/web).
 *
 * The consuming application must provide implementations of these interfaces
 * that connect to its specific database, auth system, and infrastructure.
 */

// ============================================================================
// Platform & Credential Types
// ============================================================================

/** Platform identifier for integrations */
export type PlatformId =
  | "telegram"
  | "whatsapp"
  | "discord"
  | "slack"
  | "gmail"
  | "gmail"
  | "notion"
  | "google-drive"
  | "linear"
  | "jira"
  | "asana"
  | "hubspot"
  | "feishu"
  | "dingtalk"
  | "weixin"
  | "imessage"
  | "instagram"
  | "linkedin"
  | "x"
  | "facebook-messenger"
  | "qqbot"
  | "teams";

/** User type within the platform */
export type UserType = "user" | "guest";

/** Base integration account data */
export interface IntegrationAccount {
  id: string;
  userId: string;
  platform: PlatformId;
  platformAccountId: string | null;
  status: string | null;
  credentials: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Bot with its associated platform account */
export interface Bot {
  id: string;
  userId: string;
  platformAccountId: string | null;
  // ... other bot fields
}

/** Bot with its platform account */
export interface BotWithAccount {
  platformAccount: IntegrationAccount | null;
}

// ============================================================================
// Credential Store - Database operations for integration accounts
// ============================================================================

export interface CredentialStore {
  /**
   * Get all integration accounts for a user
   */
  getAccountsByUserId(userId: string): Promise<IntegrationAccountWithBot[]>;

  /**
   * Get integration account by platform for a user
   */
  getAccountByPlatform(
    userId: string,
    platform: PlatformId,
  ): Promise<IntegrationAccountWithBot | null>;

  /**
   * Get integration account by ID
   */
  getAccountById(
    userId: string,
    platformAccountId: string,
  ): Promise<IntegrationAccount | null>;

  /**
   * Update integration account credentials/metadata/status
   */
  updateAccount(params: {
    userId: string;
    platformAccountId: string;
    status?: string;
    credentials?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void>;

  /**
   * Create a new integration account
   */
  createAccount(params: {
    userId: string;
    platform: PlatformId;
    platformAccountId?: string | null;
    status?: string;
    credentials?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<IntegrationAccount>;
}

/** Integration account with its associated bot */
export interface IntegrationAccountWithBot extends IntegrationAccount {
  bot: Bot | null;
}

// ============================================================================
// Auth Provider - Authentication and user info
// ============================================================================

export interface AuthProvider {
  /**
   * Get the current user's ID
   */
  getUserId(): string | null;

  /**
   * Get the current user's auth token (Bearer token)
   */
  getToken(): string | null;

  /**
   * Get the current user's type
   */
  getUserType(): UserType | null;
}

// ============================================================================
// Session Store - Redis-like session storage for OAuth state
// ============================================================================

export interface SessionStore {
  /**
   * Get a value by key
   */
  get(key: string): Promise<string | null>;

  /**
   * Set a value with optional expiration
   */
  set(key: string, value: string, options?: { ex?: number }): Promise<void>;

  /**
   * Delete a key
   */
  del(key: string): Promise<void>;

  /**
   * Find keys matching a pattern
   */
  keys(pattern: string): Promise<string[]>;
}

// ============================================================================
// File Ingester - Attachment/file ingestion
// ============================================================================

/** Download result for external attachment */
export interface AttachmentDownloadPayload {
  data: ArrayBuffer;
  contentType?: string;
  sizeBytes: number;
}

/** Ingested attachment result */
export interface IngestedAttachment {
  name: string;
  url: string;
  downloadUrl: string;
  contentType: string;
  sizeBytes: number;
  blobPath: string;
  source: string;
  cid?: string;
}

/** Options for ingesting an external attachment */
export interface IngestExternalOptions {
  source: string;
  userId: string;
  maxSizeBytes?: number;
  mimeTypeHint?: string | null;
  sizeHintBytes?: number | null;
  originalFileName?: string | null;
  downloadAttachment: () => Promise<AttachmentDownloadPayload>;
}

/** Result of an external attachment ingestion attempt */
export interface IngestResult {
  success: boolean;
  reason?: string;
  attachment?: IngestedAttachment;
}

export interface FileIngester {
  /**
   * Ingest an external attachment for a user
   */
  ingestExternal(options: IngestExternalOptions): Promise<IngestResult>;

  /**
   * Ingest an attachment for a user (simpler form)
   */
  ingestForUser(options: {
    source: string;
    ownerUserId: string;
    ownerUserType?: UserType;
    maxSizeBytes?: number;
    mimeTypeHint?: string | null;
    sizeHintBytes?: number | null;
    originalFileName?: string | null;
    contentId?: string | null;
    downloadAttachment: () => Promise<AttachmentDownloadPayload>;
    logger?: Pick<typeof console, "warn" | "error">;
    logContext?: string;
  }): Promise<IngestedAttachment | null>;

  /**
   * Ingest multiple attachments
   */
  ingestMany(options: {
    source: string;
    ownerUserId: string;
    ownerUserType?: UserType;
    maxSizeBytes?: number;
    attachments: Array<{
      mimeTypeHint?: string | null;
      sizeHintBytes?: number | null;
      originalFileName?: string | null;
      contentId?: string | null;
      downloadAttachment: () => Promise<AttachmentDownloadPayload>;
    }>;
    logger?: Pick<typeof console, "warn" | "error">;
    logContext?: string;
  }): Promise<IngestedAttachment[]>;
}

// ============================================================================
// Config Provider - Environment variables
// ============================================================================

export interface ConfigProvider {
  /**
   * Get an environment variable
   */
  get(key: string): string | undefined;

  /**
   * Get a required environment variable (throws if not set)
   */
  getRequired(key: string): string;
}

/**
 * Extended config provider interface with AI-specific configuration.
 * Provided by the consuming application (e.g., apps/web).
 */
export interface AppConfigProvider extends ConfigProvider {
  /**
   * Get the default AI model identifier
   */
  getDefaultAIModel(): string;

  /**
   * Get the AI proxy base URL
   */
  getAIProxyBaseUrl(): string;

  /**
   * Get the application memory directory path
   */
  getAppMemoryDir(): string;
}

// ============================================================================
// Cloud Sync Provider - Tauri cloud sync operations
// ============================================================================

export interface CloudSyncProvider {
  /**
   * Sync integrations to local storage
   */
  syncAccounts(): Promise<number>;

  /**
   * Check if cloud sync is enabled
   */
  isEnabled(): boolean;
}

// ============================================================================
// Client Registry - Shared client management for platform adapters
// ============================================================================

/**
 * Interface for managing shared platform clients.
 * Allows adapters to reuse connections created by other components
 * (e.g., user listeners) to avoid creating multiple connections for the same session.
 *
 * Implementations should be provided by the consuming application.
 */
export interface ClientRegistry {
  /**
   * Get a connected client by session key
   */
  getClientBySessionKey(sessionKey: string): unknown | undefined;

  /**
   * Register a client for a session
   */
  registerClient(sessionKey: string, client: unknown): void;

  /**
   * Unregister a client
   */
  unregisterClient(sessionKey: string): void;
}

// ============================================================================
// Integration Context - Aggregates all platform dependencies
// ============================================================================

/**
 * Context object that aggregates all platform-specific dependencies
 * needed by integration code. This is passed to integration initializers
 * rather than having them import from specific application modules.
 */
export interface IntegrationContext {
  credentialStore: CredentialStore;
  authProvider: AuthProvider;
  sessionStore: SessionStore;
  fileIngester: FileIngester;
  configProvider: ConfigProvider;
  cloudSyncProvider: CloudSyncProvider;
}

/**
 * Default empty implementations for optional dependencies.
 * These no-op implementations allow integration code to function
 * when certain features are not available.
 */
export const noopCredentialStore: CredentialStore = {
  getAccountsByUserId: async () => [],
  getAccountByPlatform: async () => null,
  getAccountById: async () => null,
  updateAccount: async () => {},
  createAccount: async () => {
    throw new Error("noopCredentialStore.createAccount not implemented");
  },
};

export const noopAuthProvider: AuthProvider = {
  getUserId: () => null,
  getToken: () => null,
  getUserType: () => null,
};

export const noopSessionStore: SessionStore = {
  get: async () => null,
  set: async () => {},
  del: async () => {},
  keys: async () => [],
};

export const noopFileIngester: FileIngester = {
  ingestExternal: async () => ({ success: false, reason: "noop" }),
  ingestForUser: async () => null,
  ingestMany: async () => [],
};

export const noopConfigProvider: ConfigProvider = {
  get: () => undefined,
  getRequired: (key: string) => {
    throw new Error(`Config key "${key}" not configured`);
  },
};

export const noopCloudSyncProvider: CloudSyncProvider = {
  syncAccounts: async () => 0,
  isEnabled: () => false,
};

/**
 * Creates a minimal context with all noop implementations.
 * Useful for testing or when only some dependencies are needed.
 */
export function createMinimalContext(
  partial: Partial<IntegrationContext> = {},
): IntegrationContext {
  return {
    credentialStore: partial.credentialStore ?? noopCredentialStore,
    authProvider: partial.authProvider ?? noopAuthProvider,
    sessionStore: partial.sessionStore ?? noopSessionStore,
    fileIngester: partial.fileIngester ?? noopFileIngester,
    configProvider: partial.configProvider ?? noopConfigProvider,
    cloudSyncProvider: partial.cloudSyncProvider ?? noopCloudSyncProvider,
  };
}

// Re-export AIHandler interface
export type { AIHandler, AIHandlerOptions } from "./ai-handler.js";

// ============================================================================
// Baileys Auth State Provider - For WhatsApp
// ============================================================================

export interface BaileysAuthStateProvider {
  /**
   * Create an auth state instance for a session
   */
  createAuthState(sessionId: string): Promise<AuthenticationState>;
}

import type { AuthenticationState } from "@whiskeysockets/baileys/lib/Types/Auth";

// ============================================================================
// Inbound Message Handler - For ws-listeners
// ============================================================================

/**
 * Callback type for inbound message handlers used by ws-listeners.
 * Allows platform-agnostic message processing in packages while
 * delegating AI runtime calls to the web application.
 */
export type InboundMessageHandler = (event: {
  platform: PlatformId;
  accountId: string;
  message: {
    chatId: string;
    msgId: string;
    senderId: string;
    senderName?: string;
    text: string;
    chatType: "p2p" | "group";
    raw?: unknown;
  };
}) => Promise<void>;
