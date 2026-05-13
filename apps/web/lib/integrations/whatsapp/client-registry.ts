/**
 * WhatsApp Client Registry
 *
 * Global registry to track all active Baileys WASocket instances.
 * Used by the self-message listener to access connected sockets.
 */

import { WhatsAppClientRegistry } from "@openloomi/integrations/whatsapp/client-registry";

export { WhatsAppClientRegistry };

export const whatsappClientRegistry = new WhatsAppClientRegistry();
