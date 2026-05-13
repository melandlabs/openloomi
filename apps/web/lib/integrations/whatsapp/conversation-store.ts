/**
 * WhatsApp Self-Message Conversation Store
 *
 * File-backed per-day in-memory store for conversation history with AI.
 * Data persists to ~/.openloomi/memory/whatsapp/YYYY-MM-DD.json
 *
 * Token trimming is handled by handleAgentRuntime (40K budget) — not here.
 */

import { WhatsAppConversationStore } from "@openloomi/integrations/whatsapp/conversation-store";
import { getAppMemoryDir } from "@/lib/utils/path";

export { WhatsAppConversationStore };

export const whatsappConversationStore = new WhatsAppConversationStore(
  getAppMemoryDir(),
);
