/**
 * Contacts tool - Query user contacts
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Session } from "next-auth";
import { getUserContacts } from "@/lib/db/queries";
import { AppError } from "@openloomi/shared/errors";

/**
 * Create the queryContacts tool
 */
export function createContactsTool(session: Session) {
  return tool(
    "queryContacts",
    "Query and retrieve user's contacts with pagination support. This tool can fetch contacts with optional filtering by name and paginated results. Results include contact details and pagination metadata.",
    {
      filter: z
        .object({
          name: z
            .string()
            .optional()
            .describe(
              "Optional name to search for specific contacts (partial matches allowed)",
            ),
        })
        .optional()
        .describe("Optional filter criteria to narrow down contact results"),
      page: z.coerce
        .number()
        .int()
        .min(1)
        .optional()
        .default(1)
        .describe("Page number (starting from 1), default is 1"),
      pageSize: z.coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(10)
        .describe("Number of items per page (1-100), default is 10"),
    },
    async (args) => {
      try {
        const { filter, page = 1, pageSize = 10 } = args;

        const contacts = await getUserContacts(session.user.id);

        let resultContacts = contacts.map((c) => ({
          name: c.contactName,
          type: c.type,
        }));

        if (filter?.name) {
          const searchTerm = filter.name.toLowerCase();
          resultContacts = resultContacts.filter((contact) =>
            contact.name?.toLowerCase().includes(searchTerm),
          );
        }

        const totalCount = resultContacts.length;
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const paginatedContacts = resultContacts.slice(startIndex, endIndex);
        const totalPages = Math.ceil(totalCount / pageSize);

        const responseData = {
          success: paginatedContacts.length > 0,
          message:
            paginatedContacts.length > 0
              ? `Successfully retrieved ${paginatedContacts.length} contact(s) (page ${page} of ${totalPages})`
              : "No contacts found in this page",
          contacts: paginatedContacts,
          pagination: {
            page,
            pageSize,
            totalCount,
            totalPages,
            hasMore: page < totalPages,
            hasPrevious: page > 1,
          },
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
              : "Unknown error occurred while querying contacts";
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to query contacts: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
