#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const MARKER = '_openloomi_plugin';
const PLUGIN_BLOCK_KEY = '__openloomi_claude_plugin_hooks__';

function settingsPath() {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

function atomicWriteJson(filePath, obj) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, filePath);
}

function loadHooksTemplate() {
  const pluginDir = path.resolve(__dirname, '..');
  const hooksFile = path.join(pluginDir, 'hooks', 'hooks.json');
  return readJsonSafe(hooksFile);
}

function install({ yes }) {
  const settingsFile = settingsPath();
  const settings = readJsonSafe(settingsFile);
  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};

  if (settings.hooks[PLUGIN_BLOCK_KEY]) {
    return {
      ok: true,
      alreadyInstalled: true,
      path: settingsFile,
    };
  }

  const tpl = loadHooksTemplate();
  const templateHooks = (tpl?.hooks) || {};
  const block = {};
  for (const [event, entries] of Object.entries(templateHooks)) {
    block[event] = Array.isArray(entries) ? entries : [entries];
  }
  if (Object.keys(block).length === 0) {
    return {
      ok: false,
      error: 'No hooks loaded from template',
      path: settingsFile,
    };
  }

  settings.hooks[PLUGIN_BLOCK_KEY] = {
    [MARKER]: true,
    hooks: block,
    installedAt: new Date().toISOString(),
  };

  atomicWriteJson(settingsFile, settings);
  return {
    ok: true,
    alreadyInstalled: false,
    path: settingsFile,
    summary: { events: Object.keys(block) },
  };
}

function uninstall() {
  const settingsFile = settingsPath();
  const settings = readJsonSafe(settingsFile);
  let removed = false;
  if (settings.hooks?.[PLUGIN_BLOCK_KEY]) {
    delete settings.hooks[PLUGIN_BLOCK_KEY];
    removed = true;
  } else if (settings.hooks) {
    for (const event of Object.keys(settings.hooks)) {
      const arr = settings.hooks[event];
      if (!Array.isArray(arr)) continue;
      const before = arr.length;
      settings.hooks[event] = arr.filter((entry) => {
        if (!entry) return false;
        if (entry[MARKER]) return false;
        if (entry.hooks && Array.isArray(entry.hooks)) {
          const inner = entry.hooks.filter(
            (h) => !(h && typeof h.command === 'string' && h.command.includes('loomi-bridge.mjs'))
          );
          if (inner.length === 0) return false;
          entry.hooks = inner;
          return true;
        }
        return true;
      });
      if (settings.hooks[event].length !== before) removed = true;
    }
  }
  atomicWriteJson(settingsFile, settings);
  return { ok: true, removed, path: settingsFile };
}

function status() {
  const settingsFile = settingsPath();
  const settings = readJsonSafe(settingsFile);
  const installed = !!(settings.hooks?.[PLUGIN_BLOCK_KEY]);
  return { ok: true, installed, path: settingsFile, marker: MARKER, blockKey: PLUGIN_BLOCK_KEY };
}

function printResult(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + os.EOL);
  if (!obj.ok) process.exit(1);
}

const sub = process.argv[2];
if (sub === 'install') {
  printResult(install({ yes: process.argv.includes('--yes') }));
} else if (sub === 'uninstall') {
  printResult(uninstall());
} else if (sub === 'status') {
  printResult(status());
} else {
  process.stdout.write(
    JSON.stringify(
      { ok: false, code: 'UNKNOWN_SUBCOMMAND', valid: ['install', 'uninstall', 'status'] },
      null,
      2
    ) + os.EOL
  );
  process.exit(1);
}
