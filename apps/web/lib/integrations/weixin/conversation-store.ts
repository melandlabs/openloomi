/**
 * WeChat iLink Conversation Store
 *
 * File-backed per-day in-memory store for conversation history with AI.
 * Data persists to ~/.openloomi/memory/weixin/YYYY-MM-DD.json
 *
 * Token trimming is handled by handleAgentRuntime (40K budget) — not here.
 */

import { WeixinConversationStore } from "@openloomi/integrations/weixin/conversation-store";
import { getAppMemoryDir } from "@/lib/utils/path";

export { WeixinConversationStore };

export const weixinConversationStore = new WeixinConversationStore(
  getAppMemoryDir(),
);
