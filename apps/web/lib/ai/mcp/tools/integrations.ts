/**
 * Integrations tool - Query user integrations/bots
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Session } from "next-auth";
import { getBotsByUserId } from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";

/**
 * Create the queryIntegrations tool
 */
export function createIntegrationsTool(session: Session) {
  return tool(
    "queryIntegrations",
    "Query and retrieve user's accounts with their associated integration platform. This tool can fetch all bots or search for specific bots by name. Results include details and linked account information.",
    {
      platform: z
        .object({
          name: z
            .string()
            .optional()
            .describe(
              "Optional platform name to search for specific bots (partial matches allowed)",
            ),
        })
        .optional()
        .describe("Optional filter criteria to narrow down bot results"),
      limit: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of results to return (default: 20)"),
    },
    async (args) => {
      try {
        const { platform, limit } = args;

        const { bots, hasMore } = await getBotsByUserId({
          id: session.user.id,
          limit: limit ?? null,
          startingAfter: null,
          endingBefore: null,
          onlyEnable: true,
        });

        let resultBots = bots.map((bot) => {
          return {
            platform: bot.platformAccount?.platform,
            metadata: bot.platformAccount?.metadata,
            botId: bot.id,
            botName: bot.name,
            adapter: bot.adapter,
          };
        });

        if (platform?.name) {
          const searchTerm = platform.name.toLowerCase();
          resultBots = resultBots.filter((botItem) =>
            botItem.platform?.toLowerCase().includes(searchTerm),
          );
        }

        const responseData = {
          success: true,
          message:
            resultBots.length > 0
              ? `Successfully retrieved ${resultBots.length} bot(s)${hasMore ? " (more available)" : ""}`
              : "No bots found",
          bots: resultBots,
          count: resultBots.length,
          hasMore,
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(responseData, null, 2),
            },
          ],
          data: responseData,
        };
      } catch (error) {
        const errorMessage =
          error instanceof AppError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Unknown error occurred while querying bots";
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to query bots: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
