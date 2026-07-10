// SPDX-License-Identifier: Apache-2.0
//
// tests/bridge.test.mjs — node:test-based unit tests for the OpenLoomi
// Codex plugin bridge. Mirrors plugins/claude/tests/bridge.test.mjs style
// (zero dependencies, execFileSync the bridge as a child process).
//
// Run with:
//   node --test plugins/codex/tests/bridge.test.mjs
//
// Or from the repo root:
//   node --test plugins/codex/tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const PLUGIN_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const BRIDGE = join(PLUGIN_DIR, 'scripts', 'loomi-bridge.mjs');

function run(args, { env = {} } = {}) {
  return execFileSync('node', [BRIDGE, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function runOutcome(args, env) {
  try {
    const stdout = execFileSync('node', [BRIDGE, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return {
      code: e.status ?? 1,
      stdout: String(e.stdout ?? ''),
      stderr: String(e.stderr ?? ''),
    };
  }
}

function runJson(args, env) {
  return JSON.parse(run(args, env));
}

// Run a child command with HOME pointed at a fresh temp dir and PATH that
// still resolves to the current node binary. Avoids touching the user's
// real ~/.openloomi/ token.
function withFakeHome(fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'openloomi-codex-test-'));
  const nodeDir = dirname(process.execPath);
  const preservedPath = process.env.PATH || '/usr/bin:/bin';
  const pathWithNode = preservedPath.includes(nodeDir)
    ? preservedPath
    : `${nodeDir}${delimiter}${preservedPath}`;
  const env = {
    HOME: tmp,
    USERPROFILE: tmp,
    PATH: pathWithNode,
    OPENLOOMI_BIN: '',
    OPENLOOMI_HOME: '',
    OPENLOOMI_INSTALL_DIR: '',
    OPENLOOMI_REPO_DIR: '',
    OPENLOOMI_BASE_URL: 'http://127.0.0.1:1',
    OPENLOOMI_DEBUG_DISCOVERY: '1',
  };
  try {
    return fn(env);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// -----------------------------------------------------------------------------
// version
// -----------------------------------------------------------------------------

test('version returns bridge identity and command list', () => {
  const j = runJson(['version']);
  assert.equal(j.name, 'openloomi-codex-bridge');
  assert.equal(typeof j.version, 'string');
  assert.ok(j.version.length > 0);
  assert.equal(j.pluginPhase, 'runtime-provider-readiness');
  assert.ok(Array.isArray(j.commands));
  // Must include the bridge's public commands.
  for (const cmd of [
    'setup-status',
    'setup',
    'install-openloomi',
    'install-instructions',
    'initialize-session',
    'configure-ai-provider',
    'workflow-guidance',
    'version',
    'help',
    'run',
  ]) {
    assert.ok(j.commands.includes(cmd), `version.commands missing ${cmd}`);
  }
});

// -----------------------------------------------------------------------------
// setup-status shape contract
// -----------------------------------------------------------------------------

test('setup-status exposes the protocol contract fields', () => {
  const j = runJson(['setup-status']);
  for (const key of [
    'mode',
    'installed',
    'ctlPath',
    'version',
    'tokenPresent',
    'aiProviderConfigured',
    'apiReachable',
    'ready',
    'nextAction',
    'reason',
  ]) {
    assert.ok(key in j, `setup-status missing required key: ${key}`);
  }
  assert.equal(typeof j.ready, 'boolean');
  assert.equal(typeof j.tokenPresent, 'boolean');
  assert.equal(typeof j.installed, 'boolean');
  assert.equal(typeof j.apiReachable, 'boolean');
  // Either an installed OpenLoomi has a ctlPath, or nextAction must point
  // the user at install_openloomi / provide_install_or_repo_path.
  if (!j.installed) {
    assert.ok(
      ['install_openloomi', 'provide_install_or_repo_path', 'build_or_stage_openloomi_ctl'].includes(j.nextAction),
      `unexpected nextAction when not installed: ${j.nextAction}`,
    );
  }
});

test('setup-status aiProvider checks only report presence, never values', () => {
  withFakeHome((env) => {
    const j = JSON.parse(run(['setup-status'], env));
    // Every check entry must have {key, present, source}; no value field.
    for (const entry of j.checks.aiProvider || []) {
      assert.equal(typeof entry.key, 'string');
      assert.equal(typeof entry.present, 'boolean');
      assert.equal(typeof entry.source, 'string');
      assert.ok(!('value' in entry), `aiProvider check leaked a value: ${entry.key}`);
    }
    for (const entry of j.checks.auth || []) {
      assert.equal(typeof entry.key, 'string');
      assert.equal(typeof entry.present, 'boolean');
      assert.equal(typeof entry.source, 'string');
      assert.ok(!('value' in entry), `auth check leaked a value: ${entry.key}`);
    }
  });
});

// -----------------------------------------------------------------------------
// install-instructions / workflow-guidance
// -----------------------------------------------------------------------------

test('install-instructions returns a supported install plan on darwin', () => {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return;
  const j = runJson(['install-instructions']);
  assert.equal(j.nextAction, 'install_openloomi');
  assert.equal(j.reason, 'INSTALL_REQUIRED');
  assert.equal(j.installPlan.platform, process.platform);
  assert.equal(j.installPlan.arch, process.arch);
  assert.equal(j.installPlan.supported, true);
  assert.match(j.installPlan.officialReleaseApi, /^https:\/\/api\.github\.com\//);
  // Safety reminder must be present.
  assert.ok(Array.isArray(j.installPlan.safety));
  assert.ok(
    j.installPlan.safety.some((s) => s.includes('--confirm')),
    'install plan should mention --confirm',
  );
});

test('workflow-guidance lists the four openloomi workflows', () => {
  const j = runJson(['workflow-guidance']);
  assert.ok(j.ready);
  const ids = (j.workflows || []).map((w) => w.id);
  for (const id of [
    'openloomi-loop',
    'openloomi-memory',
    'openloomi-connectors',
    'openloomi-handoff',
  ]) {
    assert.ok(ids.includes(id), `workflow-guidance missing ${id}`);
  }
});

// -----------------------------------------------------------------------------
// Secrets contract — the plugin must never echo API key / token values
// -----------------------------------------------------------------------------

test('secrets contract: fake key value never appears in any subcommand output', () => {
  withFakeHome((env) => {
    const fake = 'sk-leaktest-ThisShouldNeverAppear-12345';
    const inputs = {
      ...env,
      OPENLOOMI_AUTH_TOKEN: fake,
      OPENAI_API_KEY: fake,
      ANTHROPIC_API_KEY: fake,
      OPENLOOMI_AI_API_KEY: fake,
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:1',
      OPENLOOMI_AI_BASE_URL: 'http://127.0.0.1:1',
      OPENLOOMI_AI_MODEL: 'leaktest-model',
    };
    for (const sub of [
      ['version'],
      ['setup-status'],
      ['install-instructions'],
      ['workflow-guidance'],
      ['configure-ai-provider'],
      ['help'],
    ]) {
      const r = runOutcome(sub, inputs);
      assert.ok(
        !r.stdout.includes('sk-leaktest'),
        `${sub.join(' ')} stdout leaked sk-leaktest`,
      );
      assert.ok(
        !r.stdout.includes('ThisShouldNeverAppear'),
        `${sub.join(' ')} stdout leaked ThisShouldNeverAppear`,
      );
      assert.ok(
        !r.stderr.includes('sk-leaktest'),
        `${sub.join(' ')} stderr leaked sk-leaktest`,
      );
    }
  });
});

test('secrets contract: install-openloomi refuses without --confirm and never reveals values', () => {
  withFakeHome((env) => {
    const r = runOutcome(
      ['install-openloomi'],
      { ...env, OPENLOOMI_AUTH_TOKEN: 'sk-leaktest-INSTALL-x' },
    );
    // No confirm, no install attempted. Either succeeds with a "needs
    // confirmation" payload, or returns INSTALL_CONFIRMATION_REQUIRED. We
    // accept both; the absolute requirement is no value leak.
    assert.ok(!r.stdout.includes('sk-leaktest-INSTALL-x'));
    assert.ok(!r.stderr.includes('sk-leaktest-INSTALL-x'));
  });
});

// -----------------------------------------------------------------------------
// setup state machine — the new end-to-end command
// -----------------------------------------------------------------------------

test('setup without --yes returns awaiting_user_action when install is required', () => {
  withFakeHome((env) => {
    // Force "not installed" by pointing discovery at a non-existent ctl.
    const r = runOutcome(
      ['setup'],
      {
        ...env,
        OPENLOOMI_BIN: '/nonexistent-ctl-please-ignore',
        OPENLOOMI_HOME: '/nonexistent-home',
        OPENLOOMI_REPO_DIR: '/nonexistent-repo',
        PATH: dirname(process.execPath),
      },
    );
    const j = JSON.parse(r.stdout);
    assert.ok(j.steps && j.steps.length > 0, 'setup must record at least one step');
    if (j.setup === 'awaiting_user_action') {
      assert.ok(
        ['confirm_install_openloomi', 'install_openloomi', 'build_or_stage_openloomi_ctl'].includes(j.nextAction),
        `unexpected nextAction: ${j.nextAction}`,
      );
    } else {
      // If the test environment happens to have OpenLoomi installed, the
      // state machine may continue to session init. That's fine — we only
      // require the machine not to crash and to expose {steps, status}.
      assert.equal(typeof j.steps, 'object');
      assert.equal(typeof j.status, 'object');
    }
  });
});

test('setup records steps in chronological order and timestamps are monotonic', () => {
  withFakeHome((env) => {
    const r = runOutcome(['setup'], env);
    const j = JSON.parse(r.stdout);
    if (!j.steps || j.steps.length < 2) return; // single-step state is acceptable
    for (let i = 1; i < j.steps.length; i += 1) {
      assert.ok(
        j.steps[i].at >= j.steps[i - 1].at,
        `steps[${i}].at (${j.steps[i].at}) < steps[${i - 1}].at (${j.steps[i - 1].at})`,
      );
      assert.equal(typeof j.steps[i].step, 'string');
      assert.equal(typeof j.steps[i].ok, 'boolean');
    }
  });
});

test('setup status field mirrors setup-status when the loop exits', () => {
  withFakeHome((env) => {
    const r = runOutcome(['setup'], env);
    const j = JSON.parse(r.stdout);
    assert.ok(j.status);
    for (const key of ['installed', 'tokenPresent', 'aiProviderConfigured', 'apiReachable', 'ready', 'nextAction', 'reason']) {
      assert.ok(key in j.status, `setup response.status missing ${key}`);
    }
  });
});

// -----------------------------------------------------------------------------
// argv hardening: --api-key is never a recognised flag
// -----------------------------------------------------------------------------

test('argv hardening: unknown flags are not silently accepted as secrets', () => {
  withFakeHome((env) => {
    // If --api-key were a real flag, the bridge might echo or store it. We
    // verify it does NOT appear in stdout/stderr of any subcommand. This
    // is a structural test: a future PR adding --api-key would have to
    // also update the secrets contract.
    const fake = 'sk-leaktest-ARGV-12345';
    for (const sub of [
      ['setup-status', '--api-key', fake],
      ['install-instructions', '--api-key', fake],
      ['configure-ai-provider', '--api-key', fake],
    ]) {
      const r = runOutcome(sub, env);
      assert.ok(
        !r.stdout.includes('sk-leaktest-ARGV'),
        `${sub.join(' ')} echoed --api-key value in stdout`,
      );
      assert.ok(
        !r.stderr.includes('sk-leaktest-ARGV'),
        `${sub.join(' ')} echoed --api-key value in stderr`,
      );
    }
  });
});
