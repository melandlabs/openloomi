import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

export const isWindows = process.platform === 'win32';

export function nodeBinDir() {
  return dirname(process.execPath);
}

export function makePath(dirs = []) {
  return [nodeBinDir(), ...dirs].join(delimiter);
}

export function mergeEnv(base, overrides = {}) {
  const env = { ...base };
  if (isWindows) {
    for (const key of Object.keys(overrides)) {
      for (const existing of Object.keys(env)) {
        if (existing !== key && existing.toLowerCase() === key.toLowerCase()) {
          delete env[existing];
        }
      }
    }
  }
  return { ...env, ...overrides };
}

function inheritedWindowsEnv() {
  if (!isWindows) return {};
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

export function makeIsolatedEnv(home, { pathDirs = [], overrides = {} } = {}) {
  const localAppData = join(home, 'LocalAppData');
  const programFiles = join(home, 'ProgramFiles');
  mkdirSync(localAppData, { recursive: true });
  mkdirSync(programFiles, { recursive: true });

  return {
    ...inheritedWindowsEnv(),
    HOME: home,
    USERPROFILE: home,
    TMPDIR: home,
    TEMP: home,
    TMP: home,
    PATH: makePath(pathDirs),
    LOCALAPPDATA: localAppData,
    PROGRAMFILES: programFiles,
    OPENLOOMI_BIN: '',
    OPENLOOMI_HOME: '',
    OPENLOOMI_INSTALL_DIR: '',
    OPENLOOMI_REPO_DIR: '',
    OPENLOOMI_AUTH_TOKEN: '',
    OPENLOOMI_BASE_URL: '',
    CLAUDE_PLUGIN_DATA: join(home, '.claude', 'plugins', 'openloomi'),
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_AUTH_TOKEN: '',
    ANTHROPIC_BASE_URL: '',
    ANTHROPIC_MODEL: '',
    ...overrides,
  };
}

export function withIsolatedHome(fn, options = {}) {
  const home = mkdtempSync(join(tmpdir(), 'openloomi-test-'));
  try {
    const env = makeIsolatedEnv(home, options);
    return fn(env, { home });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

export function createFakeOpenLoomiBin(dir, { name = 'openloomi', version = '9.9.9' } = {}) {
  mkdirSync(dir, { recursive: true });

  if (isWindows) {
    const fileName = name.toLowerCase().endsWith('.exe') ? name : `${name}.exe`;
    const binPath = join(dir, fileName);
    copyFileSync(process.execPath, binPath);
    return {
      binPath,
      expectedVersion: process.version.replace(/^v/, ''),
    };
  }

  const binPath = join(dir, name);
  writeFileSync(binPath, `#!/bin/sh\necho ${version}\n`, { mode: 0o755 });
  chmodSync(binPath, 0o755);
  return { binPath, expectedVersion: version };
}
