#!/usr/bin/env node
/**
 * openloomi-loop CLI shim — thin wrapper that forwards every subcommand to
 * `apps/web/scripts/loop-cli.mjs`, which loads the TypeScript CLI from the
 * main app.
 *
 * This file is intentionally small. All business logic lives in
 * `apps/web/lib/loop/`. The shim exists so that legacy callers (and Claude)
 * can keep using the same `node $SKILL_DIR/scripts/openloomi-loop.cjs <cmd>`
 * invocation without knowing about the monorepo layout.
 *
 * Locates the workspace root by walking up from this file's directory
 * looking for a sibling `apps/web` directory.
 */

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const SCRIPT_DIR = __dirname;
const SKILL_DIR = path.resolve(SCRIPT_DIR, '..');

function findCliEntry() {
  const candidates = [
    path.resolve(SKILL_DIR, '..', '..', 'apps', 'web', 'scripts', 'loop-cli.mjs'),
    path.resolve(SKILL_DIR, '..', '..', '..', 'apps', 'web', 'scripts', 'loop-cli.mjs'),
    path.resolve(process.cwd(), 'apps', 'web', 'scripts', 'loop-cli.mjs'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const cli = findCliEntry();
if (!cli) {
  process.stderr.write(
    `[openloomi-loop] cannot find apps/web/scripts/loop-cli.mjs\n` +
      `  Looked from ${SKILL_DIR}\n` +
      `  Run from inside the openloomi monorepo, or set OPENLOOMI_LOOP_CLI to the absolute path.\n`,
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const child = spawn(process.execPath, [cli, ...args], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: process.env,
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (e) => {
  process.stderr.write(`[openloomi-loop] spawn failed: ${e.message}\n`);
  process.exit(1);
});