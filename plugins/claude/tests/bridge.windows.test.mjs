// SPDX-License-Identifier: Apache-2.0
//
// Windows-only discovery tests for the Claude plugin bridge. These tests keep
// Windows path/layout coverage isolated from the cross-platform bridge suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createFakeOpenLoomiBin,
  isWindows,
  makePath,
  mergeEnv,
  withIsolatedHome,
} from './helpers/platform-fixtures.mjs';

const PLUGIN_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const BRIDGE = join(PLUGIN_DIR, 'scripts', 'loomi-bridge.mjs');

function runJson(args, env = {}) {
  const out = execFileSync('node', [BRIDGE, ...args], {
    encoding: 'utf8',
    env: mergeEnv(process.env, env),
  });
  return JSON.parse(out);
}

test('windows discovery: OPENLOOMI_BIN can point at a Windows executable', { skip: !isWindows }, () => {
  withIsolatedHome((env) => {
    const fake = createFakeOpenLoomiBin(join(env.HOME, 'fake-bin'), {
      name: 'fake-openloomi',
    });
    const j = runJson(['setup-status'], {
      ...env,
      OPENLOOMI_BIN: fake.binPath,
    });

    assert.equal(j.installed, true);
    assert.equal(j.binPath, fake.binPath);
    assert.equal(j.source, 'OPENLOOMI_BIN');
    assert.match(j.version, /^\d+\.\d+\.\d+/);
  });
});

test('windows discovery: LOCALAPPDATA platform default is isolated', { skip: !isWindows }, () => {
  withIsolatedHome((env) => {
    const installDir = join(env.LOCALAPPDATA, 'OpenLoomi');
    const fake = createFakeOpenLoomiBin(installDir, { name: 'openloomi.exe' });
    const j = runJson(['setup-status'], env);

    assert.equal(j.installed, true);
    assert.equal(j.binPath, fake.binPath);
    assert.equal(j.source, 'platform-default');
  });
});

test('windows discovery: LOCALAPPDATA desktop marker without binary reports finalization state', { skip: !isWindows }, () => {
  withIsolatedHome((env) => {
    const installDir = join(env.LOCALAPPDATA, 'OpenLoomi');
    mkdirSync(installDir, { recursive: true });
    const j = runJson(['setup-status'], env);

    assert.equal(j.installed, true);
    assert.equal(j.binPath, null);
    assert.equal(j.source, 'desktop-only');
    assert.equal(j.reason, 'OPENLOOMI_NOT_FINALIZED');
    assert.equal(j.nextAction, 'launch_openloomi_to_finalize');
    assert.equal(j.desktopMarker, installDir);
  });
});

test('windows discovery: PATH lookup is isolated', { skip: !isWindows }, () => {
  withIsolatedHome((env) => {
    const pathDir = join(env.HOME, 'path-bin');
    const fake = createFakeOpenLoomiBin(pathDir, { name: 'openloomi.exe' });
    const j = runJson(['setup-status'], {
      ...env,
      PATH: makePath([pathDir]),
    });

    assert.equal(j.installed, true);
    assert.equal(j.binPath, fake.binPath);
    assert.equal(j.source, 'PATH');
  });
});

test('windows discovery: no candidates reports not installed without touching host paths', { skip: !isWindows }, () => {
  withIsolatedHome((env) => {
    const j = runJson(['setup-status'], env);

    assert.equal(j.installed, false);
    assert.equal(j.binPath, null);
    assert.equal(j.reason, 'OPENLOOMI_NOT_INSTALLED');
    assert.equal(j.nextAction, 'install_openloomi');
  });
});
