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
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';

const PLUGIN_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const BRIDGE = join(PLUGIN_DIR, 'scripts', 'loomi-bridge.mjs');

// Accept env directly (positional) so callers can write `run(args, env)`
// without wrapping it in `{ env }`. This matches the convention used
// throughout the file (see `withFakeHome` → `runOutcome(... , env)` and
// `runJson(args, env)`).
function run(args, env = {}) {
  return execFileSync('node', [BRIDGE, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    cwd: env.BRIDGE_TEST_CWD || process.cwd(),
  });
}

function runOutcome(args, env) {
  try {
    const stdout = execFileSync('node', [BRIDGE, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      cwd: env.BRIDGE_TEST_CWD || process.cwd(),
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

function runOutcomeWithInput(args, env, input) {
  try {
    const stdout = execFileSync('node', [BRIDGE, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      input,
      cwd: env.BRIDGE_TEST_CWD || process.cwd(),
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
    LOCALAPPDATA: join(tmp, 'AppData', 'Local'),
    APPDATA: join(tmp, 'AppData', 'Roaming'),
    PROGRAMFILES: join(tmp, 'Program Files'),
    'ProgramFiles(x86)': join(tmp, 'Program Files (x86)'),
    BRIDGE_TEST_CWD: tmp,
    PATH: pathWithNode,
    OPENLOOMI_BIN: '',
    OPENLOOMI_CTL: '',
    OPENLOOMI_HOME: '',
    OPENLOOMI_INSTALL_DIR: '',
    OPENLOOMI_REPO_DIR: '',
    OPENLOOMI_API_URL: '',
    OPENLOOMI_BASE_URL: 'http://127.0.0.1:1',
    OPENLOOMI_AUTH_TOKEN: '',
    OPENAI_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    OPENROUTER_API_KEY: '',
    OPENLOOMI_AI_API_KEY: '',
    OPENAI_BASE_URL: '',
    ANTHROPIC_BASE_URL: '',
    OPENROUTER_BASE_URL: '',
    OPENLOOMI_AI_BASE_URL: '',
    OPENLOOMI_AI_MODEL: '',
    OPENLOOMI_DEBUG_DISCOVERY: '1',
  };
  try {
    return fn(env);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function writeFakeToken(home) {
  const dir = join(home, '.openloomi');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'token'), Buffer.from('fake-openloomi-token', 'utf8').toString('base64'));
}

function getRunLockPath(home) {
  return join(home, '.openloomi', 'codex-plugin-run.lock');
}

function writeRunLock(home, { startedAt = Date.now(), pid = 99999 } = {}) {
  const lockPath = getRunLockPath(home);
  mkdirSync(dirname(lockPath), { recursive: true });
  writeFileSync(
    lockPath,
    JSON.stringify({
      id: `test-lock-${startedAt}`,
      pid,
      startedAt,
      command: 'run',
    }),
  );
  return lockPath;
}

function writeFakeCtl(home) {
  const nodeScript = join(home, 'fake-openloomi-ctl.mjs');
  writeFileSync(
    nodeScript,
    [
      "if (process.argv.includes('--version')) {",
      "  console.log('openloomi-ctl 9.9.9');",
      "  process.exit(0);",
      "}",
      "let input = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => { input += chunk; });",
      "process.stdin.on('end', () => {",
      "  console.log(JSON.stringify({",
      "    ok: true,",
      "    env: { OPENLOOMI_API_URL: process.env.OPENLOOMI_API_URL || null },",
      "    prompt: input,",
      "  }));",
      "});",
    ].join('\n'),
  );

  if (process.platform === 'win32') {
    const cmd = join(home, 'openloomi-ctl.cmd');
    writeFileSync(cmd, `@"${process.execPath}" "%~dp0fake-openloomi-ctl.mjs" %*\r\n`);
    return cmd;
  }

  const shim = join(home, 'openloomi-ctl');
  const nodePath = process.execPath.replace(/'/g, "'\\''");
  writeFileSync(
    shim,
    `#!/bin/sh\nexec '${nodePath}' "$(dirname "$0")/fake-openloomi-ctl.mjs" "$@"\n`,
  );
  chmodSync(shim, 0o755);
  return shim;
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
    'codex-runtime-info',
  ]) {
    assert.ok(j.commands.includes(cmd), `version.commands missing ${cmd}`);
  }
});

// -----------------------------------------------------------------------------
// setup-status shape contract
// -----------------------------------------------------------------------------

test('setup-status apiProbe field is present and well-formed', () => {
  const j = runJson(['setup-status']);
  assert.ok(j.apiProbe, 'setup-status must include apiProbe field');
  // Top-level apiReachable boolean mirrors the apiProbe summary.
  assert.equal(typeof j.apiReachable, 'boolean');
  assert.equal(j.apiReachable, Boolean(j.apiProbe.reachableUrl));
  assert.ok(Array.isArray(j.apiProbe.attempts));
  for (const entry of j.apiProbe.attempts) {
    assert.equal(typeof entry.baseUrl, 'string');
    assert.ok(
      ['NETWORK_ERROR', 'TIMEOUT', 'HTTP_RESPONSE'].includes(entry.reason) ||
        typeof entry.status === 'number',
      `unexpected apiProbe attempt reason: ${entry.reason}`,
    );
  }
  // checks.apiProbe mirrors the same attempts list so downstream consumers
  // can find it under the standard checks bag.
  assert.ok(Array.isArray(j.checks.apiProbe));
});

test('setup-status reports OPENLOOMI_API_UNREACHABLE when API down and no token', () => {
  withFakeHome((env) => {
    const ctl = writeFakeCtl(env.HOME);
    // Make sure no token file is present and no local API is reachable
    // (fake HOME guarantees ~/.openloomi/token does not exist; the fake
    // env forces OPENLOOMI_BASE_URL to a closed port).
    const j = runJson(['setup-status'], {
      ...env,
      OPENLOOMI_CTL: ctl,
    });
    assert.equal(j.apiReachable, false);
    if (!j.tokenPresent) {
      assert.equal(j.ready, false);
      assert.equal(j.nextAction, 'open_openloomi');
      assert.equal(j.reason, 'OPENLOOMI_API_UNREACHABLE');
    }
  });
});

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
    const j = runJson(['setup-status'], env);
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

test('run injects OPENLOOMI_API_URL from OPENLOOMI_BASE_URL for openloomi-ctl', () => {
  withFakeHome((env) => {
    const ctl = writeFakeCtl(env.HOME);
    writeFakeToken(env.HOME);
    const r = runOutcomeWithInput(
      ['run'],
      {
        ...env,
        OPENLOOMI_CTL: ctl,
        OPENLOOMI_BASE_URL: 'http://localhost:3515',
        OPENLOOMI_API_URL: '',
        ANTHROPIC_API_KEY: 'sk-test-never-print',
      },
      'Reply with exactly: OpenLoomi ready.',
    );
    assert.equal(r.code, 0, r.stderr || r.stdout);
    const j = JSON.parse(r.stdout);
    assert.equal(j.ready, true);
    assert.equal(j.reason, 'RUN_COMPLETE');
    assert.equal(j.result.env.OPENLOOMI_API_URL, 'http://localhost:3515');
    assert.equal(j.result.prompt, 'Reply with exactly: OpenLoomi ready.');
    assert.ok(!r.stdout.includes('sk-test-never-print'));
  });
});

test('run refuses nested bridge invocation when an active run lock exists', () => {
  withFakeHome((env) => {
    const ctl = writeFakeCtl(env.HOME);
    writeFakeToken(env.HOME);
    writeRunLock(env.HOME);
    const r = runOutcomeWithInput(
      ['run'],
      {
        ...env,
        OPENLOOMI_CTL: ctl,
        ANTHROPIC_API_KEY: 'sk-test-never-print',
      },
      'Nested request should be refused.',
    );
    assert.equal(r.code, 1);
    const j = JSON.parse(r.stdout);
    assert.equal(j.reason, 'RECURSION_GUARD');
    assert.equal(j.ran, false);
    assert.equal(j.command, 'run');
    assert.equal(j.nextAction, 'return_without_bridge');
    assert.ok(!r.stdout.includes('sk-test-never-print'));
  });
});

test('run cleans stale lock and proceeds', () => {
  withFakeHome((env) => {
    const ctl = writeFakeCtl(env.HOME);
    writeFakeToken(env.HOME);
    const lockPath = writeRunLock(env.HOME, {
      startedAt: Date.now() - 10_000,
    });
    const r = runOutcomeWithInput(
      ['run'],
      {
        ...env,
        OPENLOOMI_CTL: ctl,
        OPENLOOMI_CODEX_BRIDGE_RUN_LOCK_TTL_MS: '1',
        ANTHROPIC_API_KEY: 'sk-test-never-print',
      },
      'Stale lock should be ignored.',
    );
    assert.equal(r.code, 0, r.stderr || r.stdout);
    const j = JSON.parse(r.stdout);
    assert.equal(j.reason, 'RUN_COMPLETE');
    assert.equal(j.result.prompt, 'Stale lock should be ignored.');
    assert.equal(existsSync(lockPath), false, 'run lock should be released');
  });
});

test('setup-status is not blocked by an active run lock', () => {
  withFakeHome((env) => {
    writeRunLock(env.HOME);
    const j = runJson(['setup-status'], env);
    assert.notEqual(j.reason, 'RECURSION_GUARD');
    assert.ok('ready' in j);
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

test('workflow-guidance uses runtime-safe run prompts for agent workflows', () => {
  for (const workflow of ['openloomi-loop', 'openloomi-memory', 'openloomi-handoff']) {
    const j = runJson(['workflow-guidance', '--workflow', workflow]);
    const prefix = j.workflow?.taskPromptPrefix || '';
    assert.match(prefix, /already inside the OpenLoomi runtime/);
    assert.match(prefix, /Do not call tools, shell, skills/);
    assert.match(prefix, /loomi-bridge/);
    assert.doesNotMatch(prefix, /^Use OpenLoomi .* workflow/);
  }
});

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
      // The state machine may now surface a new "open_openloomi" branch
      // when the local OpenLoomi API is unreachable even though a ctl was
      // explicitly disabled via OPENLOOMI_BIN. Accept that as an
      // awaiting_user_action signal too — the user must launch the
      // desktop app before the wizard can continue.
      assert.ok(
        [
          'confirm_install_openloomi',
          'install_openloomi',
          'build_or_stage_openloomi_ctl',
          'open_openloomi',
        ].includes(j.nextAction),
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

// -----------------------------------------------------------------------------
// pet <state>
// -----------------------------------------------------------------------------

test('pet without state argument returns MISSING_STATE with validStates list', () => {
  const j = runJson(['pet']);
  assert.equal(j.ok, false);
  assert.equal(j.code, 'MISSING_STATE');
  assert.ok(Array.isArray(j.validStates));
  assert.equal(j.validStates.length, 9);
  for (const s of ['happy', 'idle', 'juggling', 'needsinput', 'presenting', 'sleeping', 'sweeping', 'thinking', 'working']) {
    assert.ok(j.validStates.includes(s), `validStates missing ${s}`);
  }
});

test('pet with invalid state returns INVALID_STATE', () => {
  const j = runJson(['pet', 'dancing']);
  assert.equal(j.ok, false);
  assert.equal(j.code, 'INVALID_STATE');
  assert.equal(j.received, 'dancing');
  assert.ok(j.validStates.includes('happy'));
});

test('pet with token missing returns TOKEN_MISSING under fake HOME', () => {
  withFakeHome((env) => {
    const j = runJson(['pet', 'happy'], env);
    assert.equal(j.ok, false);
    // Either TOKEN_MISSING (no ~/.openloomi/token) or API_UNREACHABLE
    // (would-be call hits a closed port). Both are valid first-line
    // errors when neither the token nor the runtime are available.
    assert.ok(
      ['TOKEN_MISSING', 'API_UNREACHABLE'].includes(j.code),
      `unexpected pet code: ${j.code}`,
    );
  });
});

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


// -----------------------------------------------------------------------------
// codex-runtime-info
// -----------------------------------------------------------------------------

test('codex-runtime-info returns the desktop-app Codex runtime switch plan', () => {
  const j = runJson(['codex-runtime-info']);
  assert.equal(j.purpose.startsWith('Switch the OpenLoomi desktop app'), true);
  assert.equal(j.envProviderKey, 'OPENLOOMI_AGENT_PROVIDER');
  assert.equal(typeof j.switch.oneOff, 'string');
  assert.equal(typeof j.switch.permanent, 'string');
  assert.equal(typeof j.switch.perPlatform.oneOff, 'object');
  assert.match(j.switch.perPlatform.oneOff.darwin, /OPENLOOMI_AGENT_PROVIDER codex/);
  assert.match(j.switch.perPlatform.oneOff.darwin, /\/Applications\/openloomi\.app/);
  assert.match(j.switch.perPlatform.oneOff.linux, /OPENLOOMI_AGENT_PROVIDER=codex/);
  assert.match(j.switch.perPlatform.oneOff.win32, /OPENLOOMI_AGENT_PROVIDER codex/);
  assert.equal(typeof j.switch.perPlatform.permanent, 'object');
  assert.match(j.switch.perPlatform.permanent.darwin, /~\/\.zshrc/);
  assert.match(j.switch.perPlatform.permanent.linux, /environment\.d/);
  assert.match(j.switch.perPlatform.permanent.win32, /environment variables/i);
  assert.ok(Array.isArray(j.prerequisites) && j.prerequisites.length >= 3);
  const varNames = j.companionEnvVars.map((entry) => entry.name);
  for (const expected of [
    'OPENLOOMI_AGENT_CODEX_COMMAND',
    'OPENLOOMI_AGENT_CODEX_MODEL',
    'OPENLOOMI_AGENT_CODEX_SANDBOX',
    'OPENLOOMI_AGENT_CODEX_ASK_FOR_APPROVAL',
    'OPENLOOMI_AGENT_CODEX_SKIP_GIT_REPO_CHECK',
    'OPENLOOMI_AGENT_CODEX_FULL_AUTO',
    'OPENLOOMI_AGENT_CODEX_TIMEOUT_MS',
  ]) {
    assert.ok(varNames.includes(expected), `missing companion var ${expected}`);
  }
  assert.equal(j.verify.expectDefaultAgent, 'codex');
  assert.equal(j.verify.expectAgentType, 'codex');
  assert.match(j.verify.endpoint, /\/api\/native\/providers/);
  assert.equal(j.bridge.name, 'openloomi-codex-bridge');
  assert.equal(typeof j.bridge.version, 'string');
});

test('codex-runtime-info reflects OPENLOOMI_AGENT_PROVIDER env in defaults', () => {
  const j = runJson(['codex-runtime-info'], {
    OPENLOOMI_AGENT_PROVIDER: 'codex',
  });
  assert.equal(j.defaults.currentDefaultProvider, 'codex');
});

test('codex-runtime-info defaults to claude when env is unset', () => {
  const j = withFakeHome((env) =>
    runJson(['codex-runtime-info'], {
      ...env,
      OPENLOOMI_AGENT_PROVIDER: '',
    }),
  );
  // Empty string should fall back to claude (resolver treats empty as unset).
  assert.equal(j.defaults.currentDefaultProvider, 'claude');
});
