/**
 * @openloomi/integrations - Unified package for openloomi integration packages
 *
 * This is the main entry point that re-exports core interfaces and types.
 * Individual platform adapters are available via subpaths:
 * - @openloomi/integrations/whatsapp
 * - @openloomi/integrations/weixin
 * - @openloomi/integrations/telegram
 * etc.
 */

// Re-export core interfaces
export type {
  IntegrationContext,
  CredentialStore,
  AuthProvider,
  SessionStore,
  FileIngester,
  ConfigProvider,
  ClientRegistry,
  BaileysAuthStateProvider,
  InboundMessageHandler,
} from "./core/index.js";

export type { AIHandler, AIHandlerOptions } from "./core/ai-handler.js";
