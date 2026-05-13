/**
 * Chat Insight tool - Query chat insights with filtering
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Session } from "next-auth";
import {
  getBotsByUserId,
  getStoredInsightsByBotIds,
  getInsightsByIdsForUser,
  getInsightsWithNotesAndDocuments,
  getInsightChats,
} from "@/lib/db/queries";
import {
  type InsightFilterDefinition,
  insightFilterDefinitionSchema,
} from "@/lib/insights/filter-schema";
import { filterInsights } from "@/lib/insights/filter-utils";
import { formatInsight, INSIGHT_FILTER_KINDS } from "./shared";

type InsightsNotesDocumentsMap = Awaited<
  ReturnType<typeof getInsightsWithNotesAndDocuments>
>;

/**
 * Create the chatInsight tool
 */
export function createChatInsightTool(session: Session) {
  return tool(
    "chatInsight",
    [
      "**📋 WHAT ARE INSIGHTS?**",
      "Insights are structured information extracted from user's chat history across all platforms (Telegram, Email, Slack, iMessage, etc.).",
      "Each insight represents: an important conversation, todo item, project progress, decision record, etc.",
      "",
      "**🎯 MUST USE this tool when user asks about:**",
      "",
      "[Tasks & Todos]",
      "- What's on my schedule today / Today's tasks",
      "- My todos / My tasks / My backlog",
      "- Any urgent tasks",
      "- Task status",
      "",
      "[Projects & Progress]",
      "- Project updates / Status of X",
      "- How's project X going",
      "- Any important updates recently",
      "",
      "[Chat History]",
      "- Chat history / Conversations with someone",
      "- What did we discuss about X",
      "- Conversation with XX",
      "",
      "[Important Items]",
      "- Important items / Priorities",
      "- Items needing attention",
      "",
      "**⚙️ PARAMETERS - HOW TO USE:**",
      "",
      "[days - Time Range]",
      "- Default: 7 days",
      "- For broader searches: 14, 30, 60, 90 days",
      "- Examples:",
      "  * Today's events → days=1",
      "  * Last two weeks → days=14",
      "  * This month's progress → days=30",
      "",
      "[withDetail - Include Details]",
      "- Default: false (returns only title and summary)",
      "- Set to true when user asks: 'What did we discuss?', 'Tell me more about X', 'Details of Y'",
      "- Use true when needs to view chat content or discussion details",
      "- IMPORTANT: When withDetail=true, each detail has an 'attachments' array with file info",
      "- Each attachment has 'downloadUrl' field - use this to download files! (NOT blobPath!)",
      "",
      "[📎 ATTACHMENTS]",
      "- Insights may have attachments (documents, files) associated with them",
      "- Each insight result includes:",
      "  * hasAttachments: boolean - true if the insight has any attachments",
      "  * attachmentsCount: number - total number of attachments",
      "  * attachmentsSummary: string - formatted list of attachments with filename and size (e.g., '📎 report.pdf (1.2 MB)')",
      "",
      "[searchMode - Search Mode]",
      "- 'basic' (default): searches title and summary only - faster, more precise",
      "- 'comprehensive': searches all fields including details - more results but may have false positives",
      "- Recommend: try basic first, if no results then use comprehensive",
      "",
      "[keyword - Keyword Search] ⭐ RECOMMENDED",
      "- Supports single keyword or array: keyword='PR' or keyword=['PR', 'development', 'dev']",
      "- Search strategy: use multiple independent keywords instead of long phrases",
      "- Examples:",
      "  ❌ BAD: keyword='openloomi PR feature development' (too specific, hard to match)",
      "  ✅ GOOD: keyword=['openloomi', 'PR', 'feature', 'development'] (multiple keywords)",
      "  ✅ GOOD: keyword=['SmartBI', 'project']",
      "",
      "**📝 USAGE EXAMPLES:**",
      "",
      "[Task Queries]",
      "- 'What's on my schedule today?' → keyword=unspecified, days=1, searchMode='basic'",
      "- 'My urgent tasks' → filterDefinition={kind:'urgency', values:['ASAP']}, days=7",
      "- 'This week's todos' → days=7, searchMode='basic'",
      "",
      "[Project Progress]",
      "- 'SmartBI project progress' → keyword=['SmartBI', 'progress'], days=30, withDetail=true, searchMode='basic'",
      "- 'openloomi PR status' → keyword=['openloomi', 'PR', 'pull request'], days=30, searchMode='basic'",
      "- 'Any important updates recently' → filterDefinition={kind:'importance', values:['Important']}, days=7",
      "",
      "[Chat History]",
      "- 'What did we discuss about design' → keyword=['design', 'discussion'], days=14, withDetail=true, searchMode='comprehensive'",
      "- 'Conversation with Alice' → keyword=['Alice', 'conversation'], days=30, withDetail=true",
      "",
      "[SEARCH TIPS]",
      "1. Use multiple related keywords instead of complete sentences",
      "2. Include synonyms in both languages: ['PR', 'pull request', 'merge request']",
      "3. If first search has no results, try: increasing days range, using comprehensive mode, trying other keywords",
      "4. Prefer using 'keyword' parameter as it's more flexible than filterDefinition",
      "",
      "[Pagination]",
      "- If results show 'hasMore: true', use 'page: 2', 'page: 3', etc. to get more results",
      "- For keyword searches, AI should automatically paginate through all matching insights",
      "- Example: if page 1 returns 30 results with hasMore: true, call again with page: 2",
      "",
      "--- Technical Details ---",
      `Filter kinds available: ${INSIGHT_FILTER_KINDS.join(", ")}`,
      "PREFER 'keyword' parameter for general searches. Use 'filterDefinition' only for complex filters.",
    ].join("\n"),
    {
      withDetail: z
        .union([z.boolean(), z.string()])
        .transform((val) => {
          // Handle various string values that represent true
          if (typeof val === "string") {
            const lowerVal = val.toLowerCase();
            return ["true", "yes", "1", "important", "on"].includes(lowerVal);
          }
          return val;
        })
        .default(false)
        .describe(
          "Whether to include the 'detail' field in the insight. Accepts boolean (true/false) or string values like 'important', 'yes', 'true'. Defaults to false (no details). **SET TO TRUE** when user asks 'What did we discuss?', 'Tell me about X', 'What happened with Y', or needs specific chat content/progress updates.",
        ),
      days: z.coerce
        .number()
        .int()
        .positive()
        .default(7)
        .describe(
          "Number of days of chat insights to retrieve. Default is 7 days. **USE LARGER VALUES** like 14, 30, 60 for broader searches about projects, people, or topics.",
        ),
      searchMode: z
        .enum(["basic", "comprehensive"])
        .default("basic")
        .describe(
          "Search mode: 'basic' searches only title and description (faster, fewer results), 'comprehensive' searches all fields including details and may return many results.",
        ),
      keyword: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe(
          "Keyword(s) to search for. This will be automatically converted to a keyword filter. Use this for simple searches. For complex filters, use filterDefinition instead.",
        ),
      insightIds: z
        .array(z.string())
        .optional()
        .describe(
          "Array of specific insight IDs to retrieve. When provided, returns only the specified insights. Use this when you have insight IDs from the focused insights context or previous queries. This takes priority over all other filter parameters.",
        ),
      page: z.coerce
        .number()
        .int()
        .min(1, "Page number must be at least 1")
        .optional()
        .default(1)
        .describe("Page number (starting from 1), default is 1"),
      pageSize: z.coerce
        .number()
        .int()
        .min(1, "Page size must be at least 1")
        .max(50, "Maximum page size is 50")
        .optional()
        .default(30)
        .describe("Number of insights per page (1-50), default is 30"),
      filterDefinition: z
        .any()
        .optional()
        .describe(
          [
            `Custom insight filter rules (HIGHEST PRIORITY). Only use the following 'kind' values in conditions: ${INSIGHT_FILTER_KINDS.join(", ")}.`,
            "",
            "⭐ PREFER 'keyword' for general searches - it's more flexible and searches across multiple fields.",
            "",
            "CRITICAL: conditions must be an array of OBJECTS with 'kind' field.",
            '❌ WRONG: {"conditions": ["CSale", "collaboration"]}',
            '✅ CORRECT (keyword - RECOMMENDED): {"match":"all","conditions":[{"kind":"keyword","values":["CSale","collaboration","opportunity"]}]}',
            '✅ CORRECT (category - MORE RESTRICTIVE): {"match":"all","conditions":[{"kind":"category","values":["CSale","collaboration","opportunity"]}]}',
            "",
            "More examples:",
            '- Keywords: {"match":"all","conditions":[{"kind":"keyword","values":["Design"],"fields":["title"]}]}',
            '- Platform: {"match":"all","conditions":[{"kind":"platform","values":["slack","discord"]}]}',
            '- Time window: {"match":"all","conditions":[{"kind":"time_window","withinHours":720}]}',
            '- Importance: {"match":"all","conditions":[{"kind":"importance","values":["Important"]}]}',
            '- Combined: {"match":"all","conditions":[{"kind":"keyword","values":["Design"]},{"kind":"platform","values":["slack"]}]}',
            "",
            "Do NOT use 'kind' values not in the list (e.g., 'topic' is invalid, use 'keyword' or 'category' instead).",
          ].join("\n"),
        ),
    },
    async (args) => {
      try {
        const {
          withDetail = false,
          days = 7,
          page = 1,
          pageSize = 30,
          filterDefinition,
          searchMode = "basic",
          keyword,
          insightIds,
        } = args;

        // Auto-convert keyword parameter to filterDefinition
        let effectiveFilterDefinition = filterDefinition;
        if (keyword && !filterDefinition) {
          // Handle different keyword formats
          let keywordValues: string[];
          if (Array.isArray(keyword)) {
            keywordValues = keyword;
          } else if (typeof keyword === "string") {
            // Check if it's a JSON array string
            if (keyword.startsWith("[") && keyword.endsWith("]")) {
              try {
                keywordValues = JSON.parse(keyword);
              } catch {
                // Not valid JSON, treat as single keyword
                keywordValues = [keyword];
              }
            } else {
              // Single keyword string
              keywordValues = [keyword];
            }
          } else {
            keywordValues = [String(keyword)];
          }

          effectiveFilterDefinition = {
            match: "any" as const,
            conditions: [
              {
                kind: "keyword",
                values: keywordValues,
                match: "any" as const,
              },
            ],
          };
        }

        // Parse filter
        let parsedFilter: InsightFilterDefinition | null = null;
        try {
          if (effectiveFilterDefinition) {
            // Auto-repair common AI mistakes
            let repairedFilter = effectiveFilterDefinition;

            // Check if filterDefinition is a JSON string (common mistake)
            if (typeof repairedFilter === "string") {
              repairedFilter = JSON.parse(repairedFilter);
            }

            // Check if filterDefinition uses old format {keyword: [...]} instead of {conditions: [...]}
            // Convert to proper format
            if (!repairedFilter.conditions && repairedFilter.keyword) {
              repairedFilter = {
                match: "any" as const,
                conditions: [
                  {
                    kind: "keyword",
                    values: Array.isArray(repairedFilter.keyword)
                      ? repairedFilter.keyword
                      : [repairedFilter.keyword],
                    match: "any" as const,
                  },
                ],
              };
            }

            // If conditions is missing or empty, don't apply filter (return all insights)
            if (
              !repairedFilter.conditions ||
              repairedFilter.conditions.length === 0
            ) {
              // parsedFilter stays null, which means no filter applied
            } else if (
              Array.isArray(repairedFilter.conditions) &&
              repairedFilter.conditions.length > 0 &&
              typeof repairedFilter.conditions[0] === "string"
            ) {
              // Convert strings to keyword filter objects (common mistake)
              repairedFilter = {
                ...repairedFilter,
                conditions: repairedFilter.conditions.map((condition: any) => ({
                  kind: "keyword",
                  values: Array.isArray(condition) ? condition : [condition],
                  match: "any" as const,
                })),
              };

              parsedFilter =
                insightFilterDefinitionSchema.parse(repairedFilter);
            } else {
              // Parse normally
              parsedFilter =
                insightFilterDefinitionSchema.parse(repairedFilter);
            }
          }
        } catch (error) {
          console.warn("[chatInsight] Invalid insight filter", error);
        }

        // Apply searchMode: modify keyword filters to search only specific fields
        if (parsedFilter && searchMode === "basic") {
          // Modify keyword conditions to only search title and description fields
          parsedFilter = {
            ...parsedFilter,
            conditions: parsedFilter.conditions.map((condition) => {
              if (condition.kind === "keyword") {
                const modified = {
                  ...condition,
                  fields: [
                    "title",
                    "description",
                    "groups",
                    "people",
                    "details",
                    "sources",
                    "insight_keywords",
                  ] as (
                    | "title"
                    | "description"
                    | "groups"
                    | "people"
                    | "details"
                    | "sources"
                    | "insight_keywords"
                  )[],
                };
                return modified;
              }
              return condition;
            }),
          };
        } else if (parsedFilter && searchMode === "comprehensive") {
          console.log(
            "[chatInsight] Applying 'comprehensive' search mode - searching all fields",
          );
        }
        const bots = await getBotsByUserId({
          id: session.user.id,
          limit: null,
          startingAfter: null,
          endingBefore: null,
          onlyEnable: false,
        });

        if (bots.bots.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No bots found for the user",
              },
            ],
            data: {
              insights: [],
              pagination: {
                page,
                pageSize,
                totalCount: 0,
                totalPages: 0,
                hasMore: false,
                hasPrevious: false,
              },
            },
          };
        }

        // When insightIds is provided, query directly by ID, skip other filtering logic
        if (insightIds && insightIds.length > 0) {
          console.log("[chatInsight] Querying insights by IDs:", {
            count: insightIds.length,
            ids: insightIds,
          });

          // Query directly by ID
          const insightsByIds = await getInsightsByIdsForUser({
            userId: session.user.id,
            insightIds,
          });

          // Format insights
          const formattedInsights = insightsByIds.map((item) =>
            formatInsight(item.insight, withDetail),
          );

          // Get notes and documents
          let insightsNotesDocumentsMap: InsightsNotesDocumentsMap = new Map();
          if (formattedInsights.length > 0) {
            try {
              const queryInsightIds = formattedInsights.map((i) => i.id);
              insightsNotesDocumentsMap =
                await getInsightsWithNotesAndDocuments({
                  userId: session.user.id,
                  insightIds: queryInsightIds,
                });
            } catch (error) {
              console.error(
                "[chatInsight] Failed to fetch notes and documents for insights:",
                error,
              );
            }
          }

          // Fetch related chat IDs for each insight
          const insightsChatsMap = new Map<string, string[]>();
          if (formattedInsights.length > 0) {
            try {
              const insightIdsList = formattedInsights.map((i) => i.id);
              // Batch fetch chat IDs for all insights
              const chatIdsPromises = insightIdsList.map(async (insightId) => {
                const chatIds = await getInsightChats({ insightId });
                return { insightId, chatIds };
              });
              const chatIdsResults = await Promise.all(chatIdsPromises);
              chatIdsResults.forEach(({ insightId, chatIds }) => {
                insightsChatsMap.set(insightId, chatIds);
              });
            } catch (error) {
              console.error(
                "[chatInsight] Failed to fetch related chat IDs for insights:",
                error,
              );
            }
          }

          // Attach notes, documents and related chat IDs to formatted insights
          const insightsWithNotesAndDocuments = formattedInsights.map(
            (insight) => {
              const data = insightsNotesDocumentsMap.get(insight.id);
              return {
                insight,
                notes: data?.notes || [],
                documents: data?.documents || [],
                relatedChatIds: insightsChatsMap.get(insight.id) || [],
              };
            },
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(insightsWithNotesAndDocuments, null, 2),
              },
            ],
            data: {
              insights: insightsWithNotesAndDocuments,
              pagination: {
                page: 1,
                pageSize: insightIds.length,
                totalCount: insightIds.length,
                totalPages: 1,
                hasMore: false,
                hasPrevious: false,
              },
            },
          };
        }

        const targetBotIds = bots.bots.map((b) => b.id);
        const historyDays = 1;
        const { insights: insightItems } = await getStoredInsightsByBotIds({
          ids: targetBotIds,
          days: Math.min(historyDays, days),
        });

        let notFound = false;
        let filteredInsights = insightItems;
        if (parsedFilter) {
          filteredInsights = filterInsights(insightItems, parsedFilter);
          if (filteredInsights.length === 0) {
            // When filter matches nothing, return empty array instead of all insights
            // This prevents agent from claiming it found results when none matched the filter
            filteredInsights = [];
            notFound = true;
          }
        }

        const formattedInsights = filteredInsights.map((item) =>
          formatInsight(item, withDetail),
        );

        // Fetch notes and documents for insights
        let insightsNotesDocumentsMap: InsightsNotesDocumentsMap = new Map();
        if (formattedInsights.length > 0) {
          try {
            const insightIds = formattedInsights.map((i) => i.id);
            insightsNotesDocumentsMap = await getInsightsWithNotesAndDocuments({
              userId: session.user.id,
              insightIds,
            });
          } catch (error) {
            console.error(
              "[chatInsight] Failed to fetch notes and documents for insights:",
              error,
            );
          }
        }

        // Fetch related chat IDs for each insight
        const insightsChatsMap = new Map<string, string[]>();
        if (formattedInsights.length > 0) {
          try {
            const insightIdsList = formattedInsights.map((i) => i.id);
            // Batch fetch chat IDs for all insights
            const chatIdsPromises = insightIdsList.map(async (insightId) => {
              const chatIds = await getInsightChats({ insightId });
              return { insightId, chatIds };
            });
            const chatIdsResults = await Promise.all(chatIdsPromises);
            chatIdsResults.forEach(({ insightId, chatIds }) => {
              insightsChatsMap.set(insightId, chatIds);
            });
          } catch (error) {
            console.error(
              "[chatInsight] Failed to fetch related chat IDs for insights:",
              error,
            );
          }
        }

        // Format file size helper
        const formatFileSize = (bytes: number | null | undefined) => {
          if (!bytes) return "";
          if (bytes < 1024) return `${bytes} B`;
          if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
          return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        };

        // Attach notes, documents and related chat IDs to formatted insights
        const insightsWithNotesAndDocuments = formattedInsights.map(
          (insight) => {
            const data = insightsNotesDocumentsMap.get(insight.id);

            return {
              ...insight,
              notes: data?.notes || [],
              documents: data?.documents || [],
              relatedChatIds: insightsChatsMap.get(insight.id) || [],
            };
          },
        );

        const totalCount = insightsWithNotesAndDocuments.length;
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const paginatedInsights = insightsWithNotesAndDocuments.slice(
          startIndex,
          endIndex,
        );
        const totalPages = Math.ceil(totalCount / pageSize);
        const hasMore = page < totalPages;
        const hasPrevious = page > 1;

        // Directly return data as JSON, like Web Agent does
        const responseData = {
          success: paginatedInsights.length > 0,
          message:
            paginatedInsights.length > 0
              ? `Successfully retrieved ${paginatedInsights.length} insight(s) (page ${page} of ${totalPages})`
              : notFound
                ? "No insights match the specified filter criteria. Try using different or broader search terms."
                : "openloomi has not yet completed your history message aggregation, please add more integrations and try again later",
          insights: paginatedInsights,
          pagination: {
            page,
            pageSize,
            totalCount,
            totalPages,
            hasMore,
            hasPrevious,
            notFound,
          },
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(responseData, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
