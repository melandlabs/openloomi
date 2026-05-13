/**
 * WhatsApp Adapter - Thin wrapper with web-specific dependency injection
 *
 * This module re-exports the WhatsAppAdapter from @openloomi/integrations/whatsapp
 * with web-specific dependencies (Redis auth state, file ingester, config provider)
 * injected via the BaileysAuthStateProvider interface.
 */

import type { AuthenticationState } from "@whiskeysockets/baileys/lib/Types/Auth";
import type {
  BaileysAuthStateProvider,
  ClientRegistry,
  FileIngester,
  ConfigProvider,
} from "@openloomi/integrations/core";
import { WhatsAppAdapter as BaseWhatsAppAdapter } from "@openloomi/integrations/whatsapp";
import { WhatsAppBaileysAuthState } from "./whatsapp-auth-state";
import { whatsappClientRegistry } from "./client-registry";

// Re-export types and activeAdapters for backward compatibility
export type {
  WhatsAppDialogInfo,
  WhatsAppUserInfo,
} from "@openloomi/integrations/whatsapp";
export { activeAdapters } from "@openloomi/integrations/whatsapp";

// Re-export conversation store
export { WhatsAppConversationStore } from "@openloomi/integrations/whatsapp";

// Re-export client registry
export { WhatsAppClientRegistry } from "@openloomi/integrations/whatsapp/client-registry";
export { whatsappClientRegistry } from "./client-registry";

/**
 * Web-specific BaileysAuthStateProvider implementation
 * that wraps WhatsAppBaileysAuthState (Redis/file-based)
 */
class WebBaileysAuthStateProvider implements BaileysAuthStateProvider {
  async createAuthState(sessionId: string): Promise<AuthenticationState> {
    const authState = new WhatsAppBaileysAuthState(sessionId);
    return authState.ensureAuthState();
  }
}

const webAuthStateProvider = new WebBaileysAuthStateProvider();

/**
 * Web config provider implementation
 */
const webConfigProvider: ConfigProvider = {
  get(key: string): string | undefined {
    return process.env[key];
  },
  getRequired(key: string): string {
    const value = process.env[key];
    if (!value) {
      throw new Error(`Config key "${key}" not configured`);
    }
    return value;
  },
};

/**
 * Create a WhatsAppAdapter with web-specific dependencies injected.
 * This is the recommended way to create WhatsAppAdapter instances in the web app.
 */
export function createWhatsAppAdapter(opts?: {
  botId?: string;
  ownerUserId?: string;
  ownerUserType?: string;
  sessionKey?: string;
  fileIngester?: FileIngester;
}): BaseWhatsAppAdapter {
  return new BaseWhatsAppAdapter({
    ...opts,
    authStateProvider: webAuthStateProvider,
    clientRegistry: whatsappClientRegistry as unknown as ClientRegistry,
    configProvider: webConfigProvider,
    fileIngester: opts?.fileIngester,
  });
}

/**
 * @deprecated Use createWhatsAppAdapter instead
 */
export class WhatsAppAdapter extends BaseWhatsAppAdapter {
  constructor(opts?: {
    botId?: string;
    ownerUserId?: string;
    ownerUserType?: string;
    sessionKey?: string;
    fileIngester?: FileIngester;
  }) {
    super({
      ...opts,
      authStateProvider: webAuthStateProvider,
      clientRegistry: whatsappClientRegistry as unknown as ClientRegistry,
      configProvider: webConfigProvider,
      fileIngester: opts?.fileIngester,
    });
  }
}
