import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { OpenLoomiToolContext } from "./index";
import { jsonToolResult, withReadyOpenLoomiClient } from "./response";

const CONNECTOR_READ_TIMEOUT_MS = 30000;
const CONNECTOR_REFRESH_TIMEOUT_MS = 55000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchesPlatform(value: unknown, platform: string): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const normalizedPlatform = platform.trim().toLowerCase();
  const candidates = [
    value.platform,
    value.id,
    value.name,
    value.key,
    value.source,
  ];

  return candidates.some(
    (candidate) =>
      typeof candidate === "string" &&
      candidate.trim().toLowerCase() === normalizedPlatform,
  );
}

function filterByPlatform<T>(items: T[], platform?: string): T[] {
  if (!platform?.trim()) {
    return items;
  }

  return items.filter((item) => matchesPlatform(item, platform));
}

function filterByStatus<T>(items: T[], status?: string): T[] {
  if (!status?.trim()) {
    return items;
  }

  const normalizedStatus = status.trim().toLowerCase();
  return items.filter((item) => {
    if (!isRecord(item) || typeof item.status !== "string") {
      return false;
    }
    return item.status.trim().toLowerCase() === normalizedStatus;
  });
}

export function registerConnectorTools(
  server: McpServer,
  context: OpenLoomiToolContext,
): void {
  server.registerTool(
    "openloomi_connectors_list_accounts",
    {
      title: "OpenLoomi Connected Accounts",
      description:
        "List native OpenLoomi integration accounts for the authenticated local user.",
      inputSchema: {
        platform: z
          .string()
          .min(1)
          .optional()
          .describe("Optional platform filter, such as gmail, slack, weixin."),
        status: z
          .string()
          .min(1)
          .optional()
          .describe("Optional account status filter, such as active."),
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
        "OpenLoomi connected account listing failed",
        async (client) => {
          const result = await client.getJson("/api/integrations/accounts", {
            timeoutMs: CONNECTOR_READ_TIMEOUT_MS,
          });
          const accounts =
            isRecord(result) && Array.isArray(result.accounts)
              ? filterByStatus(
                  filterByPlatform(result.accounts, args.platform),
                  args.status,
                )
              : [];
          const filtered = {
            ...(isRecord(result) ? result : { result }),
            accounts,
            count: accounts.length,
            filters: {
              platform: args.platform ?? null,
              status: args.status ?? null,
            },
          };

          return jsonToolResult("OpenLoomi connected accounts", filtered);
        },
      ),
  );

  server.registerTool(
    "openloomi_connectors_status",
    {
      title: "OpenLoomi Connector Status",
      description:
        "Run OpenLoomi's native live connector health check, including native account readiness when authentication is available.",
      inputSchema: {
        platform: z
          .string()
          .min(1)
          .optional()
          .describe("Optional platform filter, such as gmail, slack, weixin."),
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
        "OpenLoomi connector status failed",
        async (client) => {
          const result = await client.getJson(
            "/api/loop/connectors?refresh=1",
            {
              timeoutMs: CONNECTOR_REFRESH_TIMEOUT_MS,
            },
          );
          const items =
            isRecord(result) && Array.isArray(result.items)
              ? filterByPlatform(result.items, args.platform)
              : [];
          const nativeAccounts =
            isRecord(result) && Array.isArray(result.nativeAccounts)
              ? filterByPlatform(result.nativeAccounts, args.platform)
              : undefined;
          const filtered = {
            ...(isRecord(result) ? result : { result }),
            items,
            nativeAccounts,
            count: items.length,
            filters: {
              platform: args.platform ?? null,
              mode: "live",
            },
          };

          return jsonToolResult("OpenLoomi connector status", filtered);
        },
      ),
  );
}
