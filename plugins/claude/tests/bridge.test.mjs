// SPDX-License-Identifier: Apache-2.0
//
// tests/bridge.test.mjs — node:test-based unit tests for the OpenLoomi
// Claude plugin bridge. We don't pull in vitest/mocha/node-tap; the
// project's standard test runner is the built-in `node:test`.
//
// Run with:
//   node --test plugins/claude/tests/bridge.test.mjs
//
// Or from the repo root:
//   node --test plugins/claude/tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const PLUGIN_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const BRIDGE = join(PLUGIN_DIR, 'scripts', 'loomi-bridge.mjs');

function run(args, { env = {} } = {}) {
  try {
    return execFileSync('node', [BRIDGE, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
  } catch (e) {
    // Bridge intentionally exits with non-zero for known error cases
    // (e.g. CLAUDE_ENV_NOT_SET, INVALID_STATE). Tests that expect a
    // non-zero code use `runOutcome`. For convenience we surface the
    // captured stdout (parsed JSON) when present.
    const status = e.status ?? 1;
    const out = String(e.stdout ?? '');
    // Construct a synthetic Error-like with the captured output so
    // callers that need the JSON can recover it.
    const err = new Error(`bridge exited with status ${status}`);
    err.stdout = out;
    err.stderr = String(e.stderr ?? '');
    err.status = status;
    throw err;
  }
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

function withClaHome(fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'openloomi-test-'));
  // Preserve PATH but GUARANTEE that the directory holding the current
  // `node` binary is included, so spawned `node` is always discoverable.
  const nodeDir = dirname(process.execPath);
  const preservedPath = process.env.PATH || '/usr/bin:/bin';
  const pathWithNode = preservedPath.includes(nodeDir)
    ? preservedPath
    : `${nodeDir}${delimiter}${preservedPath}`;
  const homeEnv = {
    HOME: tmp,
    USERPROFILE: tmp,
    PATH: pathWithNode,
    OPENLOOMI_BIN: '',
    OPENLOOMI_HOME: '',
    OPENLOOMI_REPO_DIR: '',
    OPENLOOMI_AUTH_TOKEN: '',
    OPENLOOMI_BASE_URL: '',
    CLAUDE_PLUGIN_DATA: '',
    // Bridge reads these for sync-claude-env; test must wipe so leak
    // tests can prove they don't accidentally pass when the user has
    // real Anthropic credentials on the host.
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_AUTH_TOKEN: '',
    ANTHROPIC_BASE_URL: '',
    ANTHROPIC_MODEL: '',
  };
  try {
    return fn({ ...homeEnv, TMPDIR: tmp });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test('version subcommand emits plugin metadata', () => {
  const j = runJson(['version']);
  assert.equal(j.ok, true);
  assert.equal(j.plugin, 'openloomi');
  assert.match(j.version, /^\d+\.\d+\.\d+$/);
});

test('help subcommand lists all advertised subcommands', () => {
  const out = run(['help']);
  for (const sub of [
    'setup',
    'setup-status',
    'install',
    'login',
    'guest-login',
    'sync-claude-env',
    'pet',
    'state',
    'archive',
    'usage',
    'install-hooks',
    'uninstall-hooks',
    'hooks-status',
    'version',
  ]) {
    assert.match(out, new RegExp(sub));
  }
});

test('unknown subcommand emits structured error', () => {
  let code = 0;
  let out = '';
  try {
    out = run(['nonsense']);
  } catch (e) {
    code = e.status || 1;
    out = String(e.stdout || '');
  }
  assert.equal(code, 1);
  const j = JSON.parse(out);
  assert.equal(j.ok, false);
  assert.equal(j.code, 'UNKNOWN_SUBCOMMAND');
});

test('discovery: OPENLOOMI_NOT_INSTALLED when no helper is reachable', () => {
  // Skip on hosts where OpenLoomi is already installed (e.g. a developer
  // machine) — the test's premise of "no helper reachable anywhere" doesn't
  // hold there. The `packageDefaults` + `desktop-marker` paths will pick
  // up the existing install.
  if (existsSync('/Applications/OpenLoomi.app') || existsSync('/opt/openloomi')) {
    return;
  }
  withClaHome((env) => {
    const j = runJson(['setup-status'], env);
    assert.equal(j.installed, false);
    assert.equal(j.binPath, null);
    assert.equal(j.ready, false);
    assert.equal(j.nextAction, 'install_openloomi');
    assert.equal(j.reason, 'OPENLOOMI_NOT_INSTALLED');
  });
});

test('discovery: respects OPENLOOMI_BIN env when binary present', () => {
  withClaHome((env) => {
    // Spawn a fake helper by writing it to a temp dir. The fake prints just
    // a version string — the bridge's version regex matches any X.Y.Z, so we
    // don't need to mimic the real binary's full "name version" output.
    const fake = join(env.HOME, 'fake-helper');
    writeFileSync(fake, '#!/bin/sh\necho 9.9.9\n');
    try { execFileSync('chmod', ['+x', fake]); } catch { /* noop */ }

    // Build a PATH that has only the node binary's directory + minimal
    // platform paths. This guarantees no real helper binary from the user's
    // PATH interferes with the test.
    const nodeDir = dirname(process.execPath);
    const safePath = [nodeDir, '/usr/bin', '/bin'].join(delimiter);

    // Pass the env as a single object literal so it's easier to debug
    // what's actually being handed to execFileSync.
    const envPass = {
      HOME: env.HOME,
      USERPROFILE: env.USERPROFILE,
      PATH: safePath,
      OPENLOOMI_BIN: fake,
      OPENLOOMI_HOME: '',
      OPENLOOMI_REPO_DIR: '',
      OPENLOOMI_AUTH_TOKEN: '',
      OPENLOOMI_BASE_URL: '',
      CLAUDE_PLUGIN_DATA: '',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: '',
      ANTHROPIC_MODEL: '',
    };

    assert.equal(envPass.ANTHROPIC_AUTH_TOKEN, '', 'test must clear ANTHROPIC_AUTH_TOKEN');

    let out;
    try {
      out = execFileSync('node', [BRIDGE, 'setup-status'], {
        encoding: 'utf8',
        env: envPass,
      });
    } catch (e) {
      throw new Error(`bridge exec failed: ${String(e.stdout ?? '')}`);
    }

    const j = JSON.parse(out);
    if (!j.installed) {
      throw new Error(`expected installed; got: ${JSON.stringify(j, null, 2)}`);
    }
    assert.equal(j.installed, true);
    assert.equal(j.binPath, fake);
    assert.match(j.version, /9\.9\.9/);
    assert.equal(j.source, 'OPENLOOMI_BIN');
  });
});

test('discovery: SOURCE_FOUND_CLI_NOT_BUILT when repo dir set without built ctl', () => {
  withClaHome((env) => {
    const repo = join(env.HOME, 'fake-repo', 'openloomi');
    mkdirSync(join(repo, 'apps', 'web', 'src-tauri'), { recursive: true });
    writeFileSync(join(repo, 'package.json'), '{}');
    writeFileSync(join(repo, 'apps', 'web', 'src-tauri', 'Cargo.toml'), '');
    const nodeDir = dirname(process.execPath);
    const safePath = [nodeDir, '/usr/bin', '/bin'].join(delimiter);

    let out;
    try {
      out = execFileSync('node', [BRIDGE, 'setup-status'], {
        encoding: 'utf8',
        env: {
          HOME: env.HOME,
          USERPROFILE: env.USERPROFILE,
          PATH: safePath,
          OPENLOOMI_REPO_DIR: repo,
          OPENLOOMI_BIN: '',
          OPENLOOMI_HOME: '',
          OPENLOOMI_AUTH_TOKEN: '',
          OPENLOOMI_BASE_URL: '',
          CLAUDE_PLUGIN_DATA: '',
          ANTHROPIC_API_KEY: '',
          ANTHROPIC_AUTH_TOKEN: '',
          ANTHROPIC_BASE_URL: '',
          ANTHROPIC_MODEL: '',
        },
      });
    } catch (e) {
      throw new Error(`bridge exec failed: ${String(e.stdout ?? '')}`);
    }

    const j = JSON.parse(out);
    assert.equal(j.installed, false);
    assert.equal(j.reason, 'SOURCE_FOUND_CLI_NOT_BUILT');
    assert.equal(j.nextAction, 'build_or_stage_openloomi');
    assert.ok(j.hint?.needed);
  });
});

test('claudeEnvSyncable reflects env presence without printing values', () => {
  // Skip on hosts where OpenLoomi is already installed — its presence
  // changes the discovery outcome regardless of OPENLOOMI_BIN.
  if (existsSync('/Applications/OpenLoomi.app') || existsSync('/opt/openloomi')) {
    return;
  }
  withClaHome((env) => {
    const nodeDir = dirname(process.execPath);
    const safePath = [nodeDir, '/usr/bin', '/bin'].join(delimiter);

    let out;
    try {
      out = execFileSync('node', [BRIDGE, 'setup-status'], {
        encoding: 'utf8',
        env: {
          HOME: env.HOME,
          USERPROFILE: env.USERPROFILE,
          PATH: safePath,
          OPENLOOMI_BIN: '/nonexistent-ctl',
          OPENLOOMI_HOME: '',
          OPENLOOMI_REPO_DIR: '',
          OPENLOOMI_AUTH_TOKEN: '',
          OPENLOOMI_BASE_URL: '',
          CLAUDE_PLUGIN_DATA: '',
          ANTHROPIC_API_KEY: 'sk-test-redacted-12345',
          ANTHROPIC_AUTH_TOKEN: '',
          ANTHROPIC_BASE_URL: 'https://api.example.com',
          ANTHROPIC_MODEL: 'claude-opus-4-6',
        },
      });
    } catch (e) {
      throw new Error(`bridge exec failed: ${String(e.stdout ?? '')}`);
    }

    assert.ok(!out.includes('sk-test-redacted-12345'), 'stdout must not echo ANTHROPIC_API_KEY');
    const j = JSON.parse(out);
    assert.equal(j.claudeEnvSyncable, true);
    assert.equal(j.installed, false);
    assert.equal(j.nextAction, 'install_openloomi');
  });
});

test('sync-claude-env refuses to run without env vars', () => {
  withClaHome((env) => {
    const r = runOutcome(
      ['sync-claude-env'],
      { ...env, OPENLOOMI_BASE_URL: 'http://127.0.0.1:1' }
    );
    assert.notEqual(r.code, 0, 'sync-claude-env must exit non-zero when env missing');
    const j = JSON.parse(r.stdout);
    assert.equal(j.ok, false);
    assert.equal(j.code, 'CLAUDE_ENV_NOT_SET');
    assert.deepEqual(j.checked.ANTHROPIC_API_KEY, { present: false, source: 'env' });
    assert.deepEqual(j.checked.ANTHROPIC_AUTH_TOKEN, { present: false, source: 'env' });
  });
});

test('install without --yes from a non-TTY shell returns NON_INTERACTIVE_REQUIRES_YES', () => {
  // execFileSync spawns node without a TTY (stdout is captured, not a
  // terminal), which is the same shape Claude Code's Bash tool produces.
  // The bridge must NOT silently cancel — it must surface a clear code
  // explaining the missing --yes flag.
  withClaHome((env) => {
    const r = runOutcome(['install'], env);
    const j = JSON.parse(r.stdout);
    assert.equal(j.install?.ok, false);
    assert.equal(j.install?.code, 'NON_INTERACTIVE_REQUIRES_YES');
    assert.match(j.install?.message || '', /--yes/);
  });
});

test('install --yes from a non-TTY shell does not prompt (proceeds to platform script)', () => {
  // With --yes, the bridge skips the y/N prompt and runs the platform
  // install script. We can't ship a real OpenLoomi bundle in tests, so
  // the script will fail with INSTALL_SCRIPT_MISSING or a download
  // failure — either is fine, the point is that we got past the prompt.
  withClaHome((env) => {
    const r = runOutcome(['install', '--yes'], env);
    const j = JSON.parse(r.stdout);
    assert.equal(j.install?.code !== 'NON_INTERACTIVE_REQUIRES_YES', true);
    assert.equal(j.install?.code !== 'CANCELLED', true);
  });
});

test('pet subcommand rejects invalid state names', () => {
  const r = runOutcome(['pet', 'notarealstate']);
  assert.notEqual(r.code, 0, 'pet must exit non-zero on invalid state');
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, false);
  assert.equal(j.code, 'INVALID_STATE');
  assert.ok(Array.isArray(j.validStates));
  assert.ok(j.validStates.includes('happy'));
  assert.ok(j.validStates.includes('thinking'));
});

test('state subcommand marks invalid names as skipped without exit 1', () => {
  // Hooks should always exit 0 with structured JSON.
  const out = run(['state', 'notareal', '--event', 'PreToolUse']);
  const j = JSON.parse(out);
  // The JSON shape must include either archive or {ok,state}.
  assert.ok('state' in j);
});

test('archive subcommand with empty stdin emits skipped reason and exits 0', () => {
  let code = 0;
  let out = '';
  try {
    out = execFileSync('node', [BRIDGE, 'archive'], {
      encoding: 'utf8',
      input: '',
      env: { ...process.env, OPENLOOMI_AUTH_TOKEN: '' },
    });
  } catch (e) {
    code = e.status ?? 1;
    out = String(e.stdout ?? '');
  }
  // archive MUST exit 0 even on parse failure.
  assert.equal(code, 0);
  const j = JSON.parse(out);
  assert.equal(j.continue, true);
  assert.ok(['skipped', 'ok'].includes(j._openloomi.archive));
});

test('archive subcommand with valid Stop payload writes JSON insight (mocked)', () => {
  // We exercise the path that fails to reach the API (no server) and
  // ensures it still exits 0 with "endpoint_missing" / "api_unreachable".
  const tmp = mkdtempSync(join(tmpdir(), 'openloomi-archive-'));
  try {
    const transcript = join(tmp, 'transcript.jsonl');
    writeFileSync(
      transcript,
      `${[
        JSON.stringify({ type: 'user', message: { content: 'hello there' } }),
        JSON.stringify({ type: 'assistant', message: { content: 'general kenobi' } }),
      ].join('\n')}\n`
    );

    const payload = {
      hook_event_name: 'Stop',
      session_id: 'sess-test-1',
      transcript_path: transcript,
    };

    let code = 0;
    let out = '';
    try {
      out = execFileSync('node', [BRIDGE, 'archive'], {
        encoding: 'utf8',
        input: JSON.stringify(payload),
        env: {
          ...process.env,
          OPENLOOMI_AUTH_TOKEN: 'mock-bearer-token',
          OPENLOOMI_BASE_URL: 'http://127.0.0.1:1', // unreachable
        },
      });
    } catch (e) {
      code = e.status ?? 1;
      out = String(e.stdout ?? '');
    }
    assert.equal(code, 0, 'archive must never block Stop with non-zero exit');
    const j = JSON.parse(out);
    assert.equal(j.continue, true);
    // Reason will be api_unreachable, network failure, or http_*. The
    // important guarantee is the exit code and the structured output.
    assert.ok(j._openloomi.archive === 'ok' || j._openloomi.archive === 'skipped');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('hooks-status reads ~/.claude/settings.json without crashing', () => {
  withClaHome((env) => {
    const out = run(['hooks-status'], env);
    const j = JSON.parse(out);
    assert.equal(j.ok, true);
    assert.equal(typeof j.installed, 'boolean');
    assert.equal(j.marker, '_openloomi_plugin');
    assert.equal(j.blockKey, '__openloomi_claude_plugin_hooks__');
  });
});

test('hooks-merge.cjs install adds plugin block; uninstall removes it', () => {
  withClaHome((env) => {
    const merge = join(PLUGIN_DIR, 'scripts', 'hooks-merge.cjs');
    const settingsPath = join(env.HOME, '.claude', 'settings.json');

    // Make sure the dir exists for the atomic writer.
    execFileSync('mkdir', ['-p', join(env.HOME, '.claude')]);

    const installOut = execFileSync('node', [merge, 'install'], {
      env,
      encoding: 'utf8',
    });
    const installJson = JSON.parse(installOut);
    assert.equal(installJson.ok, true);
    assert.equal(existsSync(settingsPath), true);

    // Verify a second install is idempotent.
    const second = execFileSync('node', [merge, 'install'], { env, encoding: 'utf8' });
    const secondJson = JSON.parse(second);
    assert.equal(secondJson.alreadyInstalled, true);

    const uninstallOut = execFileSync('node', [merge, 'uninstall'], {
      env,
      encoding: 'utf8',
    });
    const uninstallJson = JSON.parse(uninstallOut);
    assert.equal(uninstallJson.ok, true);
    assert.equal(uninstallJson.removed, true);
  });
});

test('secrets contract: sync-claude-env never echoes key value', () => {
  // Run a deliberate negative test: set a recognisable fake key, run
  // sync-claude-env with a guaranteed-unreachable API, and grep stdout
  // for the fake key's substring. It MUST NOT appear.
  withClaHome((env) => {
    const r = runOutcome(['sync-claude-env'], {
      ...env,
      ANTHROPIC_API_KEY: 'sk-leaktest-ThisShouldNeverAppear-12345',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:1',
      ANTHROPIC_MODEL: 'claude-opus-4-6',
      OPENLOOMI_BASE_URL: 'http://127.0.0.1:1',
      OPENLOOMI_AUTH_TOKEN: 'mock-bearer',
    });
    assert.ok(!r.stdout.includes('sk-leaktest'), 'stdout must not echo ANTHROPIC_API_KEY value');
    assert.ok(!r.stdout.includes('ThisShouldNeverAppear'), 'stdout must not echo key substring');
    assert.ok(!r.stderr.includes('sk-leaktest'), 'stderr must not echo key value either');
  });
});

test('guest-login against unreachable API exits non-zero with NETWORK or ENDPOINT_MISSING', () => {
  // The guest endpoint lives on the local OpenLoomi runtime. With a
  // guaranteed-unreachable base URL, the call must surface a structured
  // code (NETWORK for a connect failure, ENDPOINT_MISSING if the server
  // replies 404) and NEVER echo a token to stdout — there isn't one
  // yet, and the bridge must not pretend otherwise.
  withClaHome((env) => {
    const r = runOutcome(['guest-login'], {
      ...env,
      OPENLOOMI_BASE_URL: 'http://127.0.0.1:1',
    });
    assert.notEqual(r.code, 0, 'guest-login must exit non-zero on a failed call');
    const j = JSON.parse(r.stdout);
    assert.equal(j.ok, false);
    assert.ok(['NETWORK', 'ENDPOINT_MISSING', 'NO_TOKEN_IN_RESPONSE'].includes(j.guest),
      `unexpected guest code: ${j.guest}`);
    // Must not include a token or any Authorization header in stdout.
    assert.ok(!/Bearer\s+[A-Za-z0-9._-]+/.test(r.stdout), 'stdout must not contain a Bearer token');
  });
});

test('setup-status exposes canGuestLogin=false when API is unreachable', () => {
  // Skip on hosts where OpenLoomi is already installed — its presence
  // makes the API reachable for real and would flip canGuestLogin to true.
  if (existsSync('/Applications/OpenLoomi.app') || existsSync('/opt/openloomi')) {
    return;
  }
  withClaHome((env) => {
    const nodeDir = dirname(process.execPath);
    const safePath = [nodeDir, '/usr/bin', '/bin'].join(delimiter);
    let out;
    try {
      out = execFileSync('node', [BRIDGE, 'setup-status'], {
        encoding: 'utf8',
        env: {
          ...env,
          PATH: safePath,
          OPENLOOMI_BIN: '/nonexistent-ctl',
          OPENLOOMI_BASE_URL: 'http://127.0.0.1:1',
        },
      });
    } catch (e) {
      throw new Error(`bridge exec failed: ${String(e.stdout ?? '')}`);
    }
    const j = JSON.parse(out);
    // canGuestLogin is true only when apiReachable is true. With a
    // guaranteed-unreachable base URL the field must be false.
    assert.equal(j.canGuestLogin, false);
    assert.equal(j.apiReachable, false);
  });
});
