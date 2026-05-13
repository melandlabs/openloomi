/**
 * Raw Messages tools - getRawMessages, searchRawMessages
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Session } from "next-auth";

/**
 * Create the raw messages tools
 */
export function createRawMessagesTools(session: Session) {
  return [
    // getRawMessages tool
    tool(
      "getRawMessages",
      [
        "Search and retrieve ORIGINAL MESSAGE CONTENT stored in browser's IndexedDB.",
        "",
        "**⭐ SEARCH STRATEGY - IMPORTANT:**",
        "- When searching, use MULTIPLE SEPARATE keywords instead of a single long phrase",
        "- Try different keyword combinations if first search doesn't find results",
        "- Examples:",
        "  ❌ BAD: keywords=['openloomi PR feature'] (too specific, won't match)",
        "  ✅ GOOD: Try keywords=['PR'], then keywords=['openloomi'], then keywords=['feature'] (multiple searches)",
        "",
        "**CRITICAL: Use this tool whenever the user asks to search, find, or query their STORED MESSAGES, CHAT HISTORY, or CONVERSATIONS.**",
        "",
        "This tool searches through messages that were previously collected and stored in the browser's IndexedDB.",
        "Users often refer to these as: 'my messages', 'chat history', 'conversations', 'stored information', etc.",
        "",
        "**PAGINATION:** To handle large result sets efficiently:",
        "- Start with offset=0, pageSize=50 (recommended default)",
        "- If 'hasMore=true' in the response, call again with offset=previousOffset + previousPageSize",
        "- Continue until 'hasMore=false' or you have collected sufficient results",
        "",
        "**Available search parameters:**",
        "- keywords: Search terms - will search across ALL fields (message content, channel name, sender name). This is the MOST COMMON parameter.",
        "- days: Number of days to look back (e.g., 1, 7, 30). Default is 30 days.",
        "- platform: Filter by platform (ONLY if user explicitly mentions a specific platform)",
        "- person: Filter by sender name",
        "- channel: Filter by channel/chat name",
        "- groupBy: Group results by 'day' (Today/Yesterday), 'week', or 'month'",
        "- offset: Number of messages to skip for pagination (default: 0)",
        "- pageSize: Number of messages per page (default: 50, max: 100)",
        "",
        "**Examples of when to use this tool:**",
        "- 'Search my messages for SmartBI' → keywords=['SmartBI']",
        "- 'Search last 7 days for meetings' → keywords=['meeting'], days=7",
        "- 'Find conversations about meetings' → keywords=['meeting'], groupBy='day'",
        "- 'What did John say about X?' → person='John Doe', keywords=['X']",
        "- 'Show my Slack messages from today' → platform='slack', days=1, groupBy='day'",
      ].join("\n"),
      {
        botId: z
          .string()
          .optional()
          .describe(
            "DEPRECATED: Do NOT use this parameter - it will restrict results to a single bot. Always search across all bots for better results.",
          ),
        platform: z
          .string()
          .optional()
          .describe(
            "Platform name (slack, discord, telegram, gmail, outlook, teams, linkedin, instagram, twitter, whatsapp)",
          ),
        channel: z.string().optional().describe("Channel or chat name"),
        person: z.string().optional().describe("Sender or person name"),
        days: z.coerce
          .number()
          .int()
          .min(1)
          .max(365)
          .default(30)
          .describe(
            "Number of days to look back from now (1-365, default: 30)",
          ),
        startTime: z.coerce
          .number()
          .optional()
          .describe(
            "Start timestamp (Unix timestamp in seconds) - only use if user provides specific timestamp",
          ),
        endTime: z.coerce
          .number()
          .optional()
          .describe(
            "End timestamp (Unix timestamp in seconds) - only use if user provides specific timestamp",
          ),
        keywords: z
          .array(z.string())
          .optional()
          .describe(
            "Keywords to search for - will search across content, channel, and person fields",
          ),
        groupBy: z
          .enum(["none", "day", "week", "month"])
          .optional()
          .describe(
            "Group messages by time period: 'day', 'week', 'month', or 'none' for flat list",
          ),
        offset: z.coerce
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Number of messages to skip for pagination (default: 0)"),
        pageSize: z.coerce
          .number()
          .int()
          .min(1)
          .max(100)
          .default(50)
          .describe("Number of messages per page (default: 50, max: 100)"),
      },
      async (args) => {
        try {
          // Validate user session
          if (!session?.user?.id) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Unauthorized: invalid user session",
                },
              ],
              isError: true,
            };
          }

          const userId = session.user.id;

          // Add userId to params
          const params = { ...args, userId };

          // Convert days to startTime if provided
          let processedParams = { ...params };
          if (args.days && !args.startTime) {
            const secondsPerDay = 24 * 60 * 60;
            const startTime =
              Math.floor(Date.now() / 1000) - args.days * secondsPerDay;
            processedParams = {
              ...params,
              startTime,
            };
          }

          // Return structured response with pagination info
          // The actual query will be executed on the client side by the frontend
          const response = {
            method: "indexeddb_query",
            params: {
              ...processedParams,
              offset: args.offset ?? 0,
              pageSize: args.pageSize ?? 50,
            },
            pagination: {
              offset: args.offset ?? 0,
              pageSize: args.pageSize ?? 50,
              hasMore: true, // Will be updated by client-side handler
            },
          };

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(response),
              },
            ],
            data: response,
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to search messages: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    ),

    // searchRawMessages tool
    tool(
      "searchRawMessages",
      [
        "**⭐ SEARCH STRATEGY - IMPORTANT:**",
        "- When searching, use MULTIPLE SEPARATE keywords instead of a single long phrase",
        "- Try different keyword combinations if first search doesn't find results",
        "- Examples:",
        "  ❌ BAD: keywords=['openloomi PR feature'] (too specific, won't match)",
        "  ✅ GOOD: Try keywords=['PR'], then keywords=['openloomi'], then keywords=['feature'] (multiple searches)",
        "",
        "Search the user's raw messages data stored in browser's IndexedDB.",
        "This includes original message content from all platforms (Telegram, Slack, Discord, etc.).",
        "",
        "**CRITICAL: This tool provides ADDITIONAL search results to complement chatInsight results.**",
        "- If this tool finds no results, do NOT conclude that 'no information exists'",
        "- Always combine results from this tool with chatInsight results",
        "- This tool searches raw message content, while chatInsight searches extracted insights",
        "- Use BOTH tools together for comprehensive results",
        "",
        "**Available search parameters:**",
        "- keywords: Search terms - will search across ALL fields (message content, channel name, sender name). This is the MOST COMMON parameter.",
        "- days: Number of days to look back (e.g., 1, 7, 30). Default is 30 days.",
        "- platform: Filter by platform (ONLY if user explicitly mentions a specific platform)",
        "- person: Filter by sender name",
        "- channel: Filter by channel/chat name",
        "- groupBy: Group results by 'day' (Today/Yesterday), 'week', or 'month'",
        "- offset: Number of messages to skip for pagination (default: 0)",
        "- pageSize: Number of messages per page (default: 50, max: 100)",
        "",
        "**Usage Examples:**",
        "- 'Search my messages for openloomi' → keywords=['openloomi']",
        "- 'Search last 7 days for meetings' → keywords=['meeting'], days=7",
        "- 'Find conversations about PR' → keywords=['PR'], groupBy='day'",
        "- 'What did John say about X?' → person='John Doe', keywords=['X']",
        "- 'Show my Slack messages from today' → platform='slack', days=1, groupBy='day'",
      ].join("\n"),
      {
        botId: z
          .string()
          .optional()
          .describe(
            "DEPRECATED: Do NOT use this parameter - it will restrict results to a single bot. Always search across all bots for better results.",
          ),
        platform: z
          .string()
          .optional()
          .describe(
            "Platform name (slack, discord, telegram, gmail, outlook, teams, linkedin, instagram, twitter, whatsapp)",
          ),
        channel: z.string().optional().describe("Channel or chat name"),
        person: z.string().optional().describe("Sender or person name"),
        days: z.coerce
          .number()
          .int()
          .min(1)
          .max(365)
          .default(30)
          .describe(
            "Number of days to look back from now (1-365, default: 30)",
          ),
        startTime: z.coerce
          .number()
          .optional()
          .describe(
            "Start timestamp (Unix timestamp in seconds) - only use if user provides specific timestamp",
          ),
        endTime: z.coerce
          .number()
          .optional()
          .describe(
            "End timestamp (Unix timestamp in seconds) - only use if user provides specific timestamp",
          ),
        keywords: z
          .array(z.string())
          .optional()
          .describe(
            "Keywords to search for - will search across content, channel, and person fields",
          ),
        groupBy: z
          .enum(["none", "day", "week", "month"])
          .optional()
          .describe(
            "Group messages by time period: 'day', 'week', 'month', or 'none' for flat list",
          ),
        offset: z.coerce
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Number of messages to skip for pagination (default: 0)"),
        pageSize: z.coerce
          .number()
          .int()
          .min(1)
          .max(100)
          .default(50)
          .describe("Number of messages per page (default: 50, max: 100)"),
      },
      async (args) => {
        try {
          // Validate user session
          if (!session?.user?.id) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Unauthorized: invalid user session",
                },
              ],
              isError: true,
            };
          }

          const userId = session.user.id;

          // Add userId to params
          const params = { ...args, userId };

          // Convert days to startTime if provided
          let processedParams = { ...params };
          if (args.days && !args.startTime) {
            const secondsPerDay = 24 * 60 * 60;
            const startTime =
              Math.floor(Date.now() / 1000) - args.days * secondsPerDay;
            processedParams = {
              ...params,
              startTime,
            };
          }

          // Return structured response with pagination info
          // The actual query will be executed on the client side by the frontend
          const response = {
            method: "indexeddb_query",
            params: {
              ...processedParams,
              offset: args.offset ?? 0,
              pageSize: args.pageSize ?? 50,
            },
            pagination: {
              offset: args.offset ?? 0,
              pageSize: args.pageSize ?? 50,
              hasMore: true, // Will be updated by client-side handler
            },
          };

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(response),
              },
            ],
            data: response,
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to search messages: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      },
    ),
  ];
}
