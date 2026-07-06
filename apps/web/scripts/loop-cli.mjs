#!/usr/bin/env node
/**
 * Thin shim so the openloomi-loop skill can invoke the Loop CLI without
 * depending on `tsx` in its package.json. Locates the workspace's tsx
 * binary and forwards all CLI args to lib/loop/cli.ts.
 *
 * Usage:
 *   node apps/web/scripts/loop-cli.mjs <command> [args]
 *
 * The skill's openloomi-loop.cjs spawns this directly. For dev convenience
 * pnpm has a `loop` script that invokes this same entry.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// apps/web/scripts/loop-cli.mjs → apps/web
const WEB_DIR = resolve(__dirname, "..");
// /Users/timi/codes/openloomi/apps/web → monorepo root
const ROOT_DIR = resolve(WEB_DIR, "..", "..");

function findTsxBin() {
  const candidates = [
    join(ROOT_DIR, "node_modules", ".bin", "tsx"),
    join(WEB_DIR, "node_modules", ".bin", "tsx"),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

const tsx = findTsxBin();
const cli = join(WEB_DIR, "lib", "loop", "cli.ts");

if (!tsx) {
  console.error(
    "[loop-cli] tsx not found in monorepo or web node_modules — install with `pnpm install`",
  );
  process.exit(1);
}
if (!existsSync(cli)) {
  console.error(`[loop-cli] cli.ts missing at ${cli}`);
  process.exit(1);
}

const child = spawn(tsx, [cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: process.cwd(),
});
child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (e) => {
  console.error("[loop-cli] spawn failed:", e.message);
  process.exit(1);
});