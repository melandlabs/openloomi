import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  checkOpenLoomiReadiness,
  formatOpenLoomiReadiness,
  type OpenLoomiReadiness,
} from "../openloomi/readiness";
import type { OpenLoomiToolContext } from "./index";

function toStructuredContent(
  readiness: OpenLoomiReadiness,
): Record<string, unknown> {
  return { ...readiness };
}

export function registerStatusTools(
  server: McpServer,
  context: OpenLoomiToolContext,
): void {
  server.registerTool(
    "openloomi_status",
    {
      title: "OpenLoomi Status",
      description:
        "Check whether the local OpenLoomi Desktop API and MCP token authentication are ready.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const readiness = await checkOpenLoomiReadiness({
        authToken: context.authToken,
        preferredBaseUrl: context.client.baseUrl,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: formatOpenLoomiReadiness(readiness),
          },
        ],
        structuredContent: toStructuredContent(readiness),
      };
    },
  );

  server.registerTool(
    "openloomi_setup",
    {
      title: "OpenLoomi Setup",
      description:
        "Run first-use OpenLoomi MCP setup checks and return the exact next step when Desktop, API, token, or auth is not ready.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const readiness = await checkOpenLoomiReadiness({
        authToken: context.authToken,
        preferredBaseUrl: context.client.baseUrl,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: formatOpenLoomiReadiness(readiness),
          },
        ],
        structuredContent: toStructuredContent(readiness),
      };
    },
  );
}
