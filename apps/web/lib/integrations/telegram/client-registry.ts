/**
 * Telegram Client Registry
 *
 * Global registry to track active TelegramClient instances.
 * Used by TelegramAdapter to reuse existing connections from User Listener,
 * avoiding multiple MTProto connections for the same session.
 */

import type { ClientRegistry } from "@openloomi/integrations/core";
import type { TelegramClient } from "telegram";
import { getActiveListenerClientBySession } from "./user-listener";

/**
 * TelegramClientRegistry - implements ClientRegistry interface
 *
 * Wraps the user listener's client lookup to provide shared client reuse
 * for TelegramAdapter instances.
 */
class TelegramClientRegistry implements ClientRegistry {
  /**
   * Get a connected client by session key
   * Delegates to the User Listener's client lookup
   */
  getClientBySessionKey(sessionKey: string): TelegramClient | undefined {
    return getActiveListenerClientBySession(sessionKey);
  }

  /**
   * Register is not applicable for Telegram - clients are managed by User Listener
   * This is a no-op to satisfy the interface
   */
  registerClient(_sessionKey: string, _client: unknown): void {
    // No-op: Telegram clients are managed by TelegramUserListener
    // This method exists only to satisfy the ClientRegistry interface
  }

  /**
   * Unregister is not applicable for Telegram - clients are managed by User Listener
   * This is a no-op to satisfy the interface
   */
  unregisterClient(_sessionKey: string): void {
    // No-op: Telegram clients are managed by TelegramUserListener
    // This method exists only to satisfy the ClientRegistry interface
  }
}

/**
 * Singleton instance of TelegramClientRegistry
 */
export const telegramClientRegistry = new TelegramClientRegistry();
