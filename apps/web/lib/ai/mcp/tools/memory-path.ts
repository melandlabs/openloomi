/**
 * Memory Path tool - searchMemoryPath
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { Session } from "next-auth";
import { z } from "zod";

import { getDefaultMemoryPath, searchMemoryPath } from "./memory-path-search";

/**
 * Create the searchMemoryPath tool
 */
export function createMemoryPathTool(session: Session) {
  return tool(
    "searchMemoryPath",
    [
      "**MUST USE this tool when user asks about:**",
      "- Personal information stored in memory (e.g., 'Who is my boss?', 'Tell me about my team')",
      "- Notes or files they've created (e.g., 'What did I write about X?', 'Find my notes about Y')",
      "- People information (e.g., 'What do you know about John?', 'My colleague info')",
      "- Projects or tasks in memory (e.g., 'What are my project notes?', 'Show my task list')",
      "- Strategy or planning documents (e.g., 'What is my strategy?', 'Show my plans')",
      "- Past conversations / chat history (e.g., 'what did we talk about yesterday?', 'what did I say before?')",
      "",
      "**CRITICAL: This tool provides ADDITIONAL search results to complement searchKnowledgeBase results.**",
      "- If this tool finds no results, do NOT conclude that 'no information exists'",
      "- Always combine results from this tool with searchKnowledgeBase results",
      "- This tool searches user-created markdown files, while searchKnowledgeBase searches uploaded documents",
      "- Use BOTH tools together for comprehensive results",
      "",
      "**MEMORY STRUCTURE:**",
      "- /people/ - Person profiles and contact info",
      "- /projects/ - Project notes and documentation",
      "- /notes/ - Personal notes and memos",
      "- /strategy/ - Strategy and planning documents",
      "",
      "**CONVERSATION HISTORY (cross-platform):**",
      "Use the Read tool to access conversation history stored in:",
      "  <appDataDir>/data/memory/{platform}/YYYY-MM-DD.json",
      "Where {platform} is one of: whatsapp, gmail, weixin, imessage, telegram, feishu, lark",
      "Each file contains JSON with messages grouped by userKey and accountId.",
      "Use this to look up past conversations across days, especially useful when:",
      "- User asks about something discussed earlier ('what did we talk about yesterday?')",
      "- User references a previous topic ('as I mentioned before...')",
      "- Building context for a continuing conversation",
      "",
      "**Usage Examples:**",
      "- 'Who is my boss?' -> Searches for 'boss' in all memory files",
      "- 'What are my project notes?' -> Searches /projects/ directory",
      "- 'Tell me about John' -> Searches for 'John' in all memory files",
    ].join("\n"),
    {
      query: z
        .string()
        .describe("Search query to find matching files and content"),
      searchInFiles: z
        .boolean()
        .default(true)
        .describe("Whether to search within file content. Defaults to true."),
      directory: z
        .string()
        .optional()
        .describe(
          "Specific subdirectory to search (e.g., 'people', 'projects'). If not specified, searches all directories.",
        ),
    },
    async (args) => {
      try {
        const { query, searchInFiles = true, directory } = args;

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

        const result = searchMemoryPath({
          query,
          searchInFiles,
          directory,
          memoryPath: getDefaultMemoryPath(),
        });

        return {
          content: [
            {
              type: "text" as const,
              text: result.content,
            },
          ],
          data: result.data,
          isError: result.isError === true,
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to search memory directory: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          data: {
            error: error instanceof Error ? error.message : "Unknown error",
          },
          isError: true,
        };
      }
    },
  );
}
