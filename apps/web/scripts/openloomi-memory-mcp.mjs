#!/usr/bin/env node

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const SERVER_NAME = "openloomi_memory";

async function main() {
  const { searchMemoryPath } = await loadMemorySearchModule();
  const server = new McpServer({
    name: SERVER_NAME,
    version: "1.0.0",
  });

  server.registerTool(
    "searchMemoryPath",
    {
      description: [
        "Search OpenLoomi's local markdown/json memory files for personal context.",
        "Use this for user memory recall, notes, people, projects, strategy, and past conversation lookups.",
        "This tool reads only the OpenLoomi memory directory and does not call RAG or embedding APIs.",
      ].join(" "),
      inputSchema: {
        query: z
          .string()
          .describe("Search query to find matching memory files and content"),
        searchInFiles: z
          .boolean()
          .default(true)
          .describe("Whether to search within file content."),
        directory: z
          .string()
          .optional()
          .describe(
            "Optional memory subdirectory, such as people or projects.",
          ),
      },
    },
    async ({ query, searchInFiles = true, directory }) => {
      if (!process.env.OPENLOOMI_MCP_USER_ID) {
        return {
          content: [
            {
              type: "text",
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
        memoryPath: process.env.OPENLOOMI_MEMORY_PATH,
      });

      return {
        content: [
          {
            type: "text",
            text: result.content,
          },
        ],
        isError: result.isError === true,
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function loadMemorySearchModule() {
  const candidates = [
    new URL("./memory-path-search.js", import.meta.url),
    new URL("../lib/ai/mcp/tools/memory-path-search.js", import.meta.url),
  ];

  for (const candidate of candidates) {
    if (existsSync(fileURLToPath(candidate))) {
      return import(candidate.href);
    }
  }

  throw new Error(
    "Unable to locate OpenLoomi memory-path-search helper for MCP server.",
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : error;
  process.stderr.write(`[${SERVER_NAME}] ${String(message)}\n`);
  process.exit(1);
});
