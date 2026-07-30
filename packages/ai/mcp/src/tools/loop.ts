import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { OpenLoomiToolContext } from "./index";
import { jsonToolResult, withReadyOpenLoomiClient } from "./response";

const LOOP_READ_TIMEOUT_MS = 55000;

const decisionStatusSchema = z.enum(["pending", "done", "dismissed"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function limitItems<T>(items: T[], limit?: number): T[] {
  if (limit === undefined) {
    return items;
  }

  return items.slice(0, limit);
}

export function registerLoopTools(
  server: McpServer,
  context: OpenLoomiToolContext,
): void {
  server.registerTool(
    "openloomi_loop_state",
    {
      title: "OpenLoomi Loop State",
      description:
        "Read the local OpenLoomi Loop dashboard state, including preferences, counts, connectors, and last tick metadata.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () =>
      withReadyOpenLoomiClient(
        context,
        "OpenLoomi Loop state failed",
        async (client) => {
          const result = await client.getJson("/api/loop/state", {
            timeoutMs: LOOP_READ_TIMEOUT_MS,
          });
          return jsonToolResult("OpenLoomi Loop state", result);
        },
      ),
  );

  server.registerTool(
    "openloomi_loop_list_decisions",
    {
      title: "OpenLoomi Loop Decisions",
      description:
        "List local OpenLoomi Loop decisions. Defaults to pending decisions for the user's approval queue.",
      inputSchema: {
        status: decisionStatusSchema
          .optional()
          .describe("Decision bucket to list. Defaults to pending."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Maximum number of decisions to return."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) =>
      withReadyOpenLoomiClient(
        context,
        "OpenLoomi Loop decision listing failed",
        async (client) => {
          const status = args.status ?? "pending";
          const result = await client.getJson(
            `/api/loop/decisions?status=${encodeURIComponent(status)}`,
            {
              timeoutMs: LOOP_READ_TIMEOUT_MS,
            },
          );
          const items =
            isRecord(result) && Array.isArray(result.items)
              ? limitItems(result.items, args.limit)
              : [];
          const filtered = {
            ...(isRecord(result) ? result : { result }),
            items,
            count: items.length,
            filters: {
              status,
              limit: args.limit ?? null,
            },
          };

          return jsonToolResult("OpenLoomi Loop decisions", filtered);
        },
      ),
  );
}
