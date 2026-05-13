/**
 * WhatsApp Client Registry
 *
 * Global registry to track all active Baileys WASocket instances.
 * Used by the self-message listener to access connected sockets.
 *
 * Implements the ClientRegistry interface from @openloomi/integrations/core
 */

import type { WASocket } from "@whiskeysockets/baileys";
import type { ClientRegistry } from "@openloomi/integrations/core";

// Module instance ID to detect if the module is being re-imported
const MODULE_ID = Math.random().toString(36).slice(2, 8);

class WhatsAppClientRegistry implements ClientRegistry {
  private clients: Map<string, WASocket> = new Map();

  /**
   * Register a socket for a specific account. Idempotent — if a socket is already
   * registered for this accountId, skip the registration to avoid overwriting the
   * existing socket (which may be owned by the self-listener).
   */
  registerClient(sessionKey: string, client: WASocket): void {
    const existing = this.clients.get(sessionKey);
    if (existing && existing !== client) {
      console.log(
        `[WhatsAppClientRegistry] SKIP REGISTER: sessionKey=${sessionKey} already has socket (new sock.user=${client.user?.id}, existing sock.user=${existing.user?.id}), not overwriting`,
      );
      return;
    }
    this.clients.set(sessionKey, client);
  }

  /**
   * Unregister a socket
   */
  unregisterClient(sessionKey: string): void {
    console.log(
      `[WhatsAppClientRegistry] UNREGISTER instance=${MODULE_ID} sessionKey=${sessionKey} (before keys=${[...this.clients.keys()]})`,
    );
    this.clients.delete(sessionKey);
  }

  /**
   * Get a socket by account ID
   */
  getClientBySessionKey(sessionKey: string): WASocket | undefined {
    return this.clients.get(sessionKey);
  }

  /**
   * Get all registered sockets
   */
  getAll(): Map<string, WASocket> {
    return new Map(this.clients);
  }

  /**
   * Check if a socket is registered
   */
  has(sessionKey: string): boolean {
    return this.clients.has(sessionKey);
  }

  /**
   * Clear all sockets
   */
  clear(): void {
    this.clients.clear();
  }

  // ---- Backward-compatible aliases for web code ----

  /**
   * @deprecated Use registerClient instead
   */
  register(accountId: string, sock: WASocket): void {
    this.registerClient(accountId, sock);
  }

  /**
   * @deprecated Use getClientBySessionKey instead
   */
  get(accountId: string): WASocket | undefined {
    return this.getClientBySessionKey(accountId);
  }

  /**
   * @deprecated Use unregisterClient instead
   */
  unregister(accountId: string): void {
    this.unregisterClient(accountId);
  }
}

export { WhatsAppClientRegistry };
