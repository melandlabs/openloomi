import type { ExtractedMessageInfo } from "@openloomi/integrations/channels/sources/types";

/**
 * Normalize messages input to array
 */
export function normalizeMessagesInput(
  input: unknown[] | string,
): ExtractedMessageInfo[] {
  if (Array.isArray(input)) {
    return input as ExtractedMessageInfo[];
  }
  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed)) {
      return parsed as ExtractedMessageInfo[];
    }
    if (parsed && typeof parsed === "object") {
      return [parsed as ExtractedMessageInfo];
    }
  } catch (error) {
    console.warn(
      "[Insights] Failed to parse messages payload for attachments:",
      error,
    );
  }
  return [];
}

/**
 * Group messages by channel/group
 * @param messages - Original message list
 * @returns Map<channelName, messages[]>
 */
export function groupMessagesByChannel(
  messages: ExtractedMessageInfo[],
): Map<string, ExtractedMessageInfo[]> {
  const grouped = new Map<string, ExtractedMessageInfo[]>();

  for (const msg of messages) {
    // Use chatName as grouping key
    const channel = msg.chatName || "unknown";

    if (!grouped.has(channel)) {
      grouped.set(channel, []);
    }

    grouped.get(channel)?.push(msg);
  }

  console.log(
    `[Insights] Messages grouped by group: ${grouped.size} groups, ` +
      `Total messages: ${messages.length}, ` +
      `Group distribution: ${Array.from(grouped.entries())
        .map(([ch, msgs]) => `${ch}(${msgs.length})`)
        .join(", ")}`,
  );

  return grouped;
}

/**
 * Filter historical insights by group
 * @param insights - All historical insights
 * @param targetGroup - Target group name
 * @returns Insights only related to that group
 */
export function filterInsightsByGroup(
  insights: import("@/lib/ai/subagents/insights").InsightData[],
  targetGroup: string,
): import("@/lib/ai/subagents/insights").InsightData[] {
  return insights.filter((insight) => {
    // Keep if insight's groups include target group
    if (insight.groups && insight.groups.length > 0) {
      return insight.groups.includes(targetGroup);
    }
    // If insight has no groups field or empty array, treat as default group
    return targetGroup === "unknown" || targetGroup === "default";
  });
}

/**
 * For iMessage private chats, merge messages from the same sender with different chatNames
 * This way messages from the same person via different contact methods (phone, email) are merged into the same group
 * @param messages - iMessage raw message list
 * @returns Merged message list (chatName unified as sender name)
 */
export function mergeIMessageMessagesBySender(
  messages: ExtractedMessageInfo[],
): ExtractedMessageInfo[] {
  const merged = new Map<string, ExtractedMessageInfo>();

  for (const msg of messages) {
    // Only process iMessage private chats
    if (!msg.isOutgoing) {
      // Messages not sent by self, keep as-is
      const key = `other:${msg.chatName}`;
      merged.set(key, msg);
      continue;
    }

    const sender = msg.sender || "";

    // Filter out self-messages (sender is "Me")
    const normalizedSender = sender.toLowerCase().trim();
    if (normalizedSender === "me") {
      continue;
    }

    // Use sender as grouping key, merge messages from the same person
    const key = `sender:${sender}`;
    if (!merged.has(key)) {
      // Replace the first message's chatName with sender name (more readable)
      // Clone the message object to avoid modifying the original
      const mergedMsg: ExtractedMessageInfo = {
        ...msg,
        chatName: sender, // Use sender as chatName, helps AI recognize the same person
      };
      merged.set(key, mergedMsg);
    }
  }

  return Array.from(merged.values());
}

/**
 * Estimate token consumption for messages (for credits pre-check)
 * This is a rough estimate, assuming an average of 100 tokens per message
 */
export function estimateTokensForMessages(
  messages: ExtractedMessageInfo[],
): number {
  // Simple estimate: average 100 tokens per message (including history context)
  const AVG_TOKENS_PER_MESSAGE = 100;
  const HISTORY_MULTIPLIER = 2; // History context multiplier

  return messages.length * AVG_TOKENS_PER_MESSAGE * HISTORY_MULTIPLIER;
}
