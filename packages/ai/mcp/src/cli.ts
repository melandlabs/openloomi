#!/usr/bin/env node

import { runOpenLoomiMcpStdioServer } from "./server";

async function main(): Promise<void> {
  await runOpenLoomiMcpStdioServer();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[openloomi-mcp] ${message}`);
  process.exit(1);
});
