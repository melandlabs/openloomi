// SPDX-License-Identifier: Apache-2.0
//
// Guard against mojibake in copied plugin text. The Claude plugin intentionally
// contains some non-ASCII text (arrows, emoji, Chinese platform names), so this
// checks for known corruption markers instead of banning Unicode outright.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { TextDecoder } from 'node:util';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const decoder = new TextDecoder('utf-8', { fatal: true });

const TEXT_EXTENSIONS = new Set([
  '',
  '.cjs',
  '.gitignore',
  '.json',
  '.md',
  '.mjs',
  '.ps1',
  '.sh',
]);

const SKIP_DIRS = new Set(['assets']);

const cp = (...codes) => String.fromCodePoint(...codes);

const MOJIBAKE_MARKERS = [
  cp(0xfffd),
  cp(0x9225),
  cp(0x922b),
  cp(0x9239),
  cp(0x6402),
  cp(0x8133),
  cp(0x951f),
  cp(0x00e2, 0x20ac),
  cp(0x00c3),
  cp(0x00c2),
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path, out);
      continue;
    }
    if (stat.isFile() && TEXT_EXTENSIONS.has(extname(path))) out.push(path);
  }
  return out;
}

function lineForIndex(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

test('Claude plugin text files are valid UTF-8 and free of known mojibake markers', () => {
  const failures = [];

  for (const file of walk(PLUGIN_DIR)) {
    const rel = relative(PLUGIN_DIR, file);
    let text;
    try {
      text = decoder.decode(readFileSync(file));
    } catch (error) {
      failures.push(`${rel}: invalid UTF-8 (${error.message})`);
      continue;
    }

    for (const marker of MOJIBAKE_MARKERS) {
      const index = text.indexOf(marker);
      if (index >= 0) {
        failures.push(`${rel}:${lineForIndex(text, index)} contains mojibake marker ${JSON.stringify(marker)}`);
      }
    }
  }

  assert.deepEqual(failures, []);
});
