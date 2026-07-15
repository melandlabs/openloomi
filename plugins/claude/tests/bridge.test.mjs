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

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  chmodSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  createFakeOpenLoomiBin,
  makeIsolatedEnv,
  makePath,
  mergeEnv,
  withIsolatedHome,
} from "./helpers/platform-fixtures.mjs";

const PLUGIN_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const BRIDGE = join(PLUGIN_DIR, "scripts", "loomi-bridge.mjs");
const execFileAsync = promisify(execFile);

function run(args, options = {}) {
  const env =
    options && Object.prototype.hasOwnProperty.call(options, "env")
      ? options.env
      : options;
  try {
    return execFileSync("node", [BRIDGE, ...args], {
      encoding: "utf8",
      env: mergeEnv(process.env, env),
    });
  } catch (e) {
    // Bridge intentionally exits with non-zero for known error cases
    // (e.g. CLAUDE_ENV_NOT_SET, INVALID_STATE). Tests that expect a
    // non-zero code use `runOutcome`. For convenience we surface the
    // captured stdout (parsed JSON) when present.
    const status = e.status ?? 1;
    const out = String(e.stdout ?? "");
    // Construct a synthetic Error-like with the captured output so
    // callers that need the JSON can recover it.
    const err = new Error(`bridge exited with status ${status}`);
    err.stdout = out;
    err.stderr = String(e.stderr ?? "");
    err.status = status;
    throw err;
  }
}

function runOutcome(args, env) {
  try {
    const stdout = execFileSync("node", [BRIDGE, ...args], {
      encoding: "utf8",
      env: mergeEnv(process.env, env),
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return {
      code: e.status ?? 1,
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? ""),
    };
  }
}

function runJson(args, env) {
  return JSON.parse(run(args, env));
}

async function runAsync(args, env) {
  try {
    const result = await execFileAsync("node", [BRIDGE, ...args], {
      encoding: "utf8",
      env: mergeEnv(process.env, env),
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (e) {
    return {
      code: e.code ?? e.status ?? 1,
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? ""),
    };
  }
}

async function runJsonAsync(args, env) {
  const result = await runAsync(args, env);
  if (result.code !== 0) {
    throw new Error(
      `bridge exited with ${result.code}: ${result.stdout || result.stderr}`,
    );
  }
  return JSON.parse(result.stdout);
}

function withClaHome(fn) {
  return withIsolatedHome(fn);
}

async function withClaHomeAsync(fn, options = {}) {
  const home = mkdtempSync(join(tmpdir(), "openloomi-test-"));
  try {
    const env = makeIsolatedEnv(home, options);
    return await fn(env, { home });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

async function withPreferencesServer(payload, fn) {
  const server = createServer((req, res) => {
    if (req.url === "/api/preferences/ai") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }
    if (req.url === "/api/remote-auth/user") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ user: { id: "test-user" } }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function createFakeClaudeCli(dir, { authenticated = true } = {}) {
  mkdirSync(dir, { recursive: true });
  const scriptPath = join(dir, "fake-claude.mjs");
  writeFileSync(
    scriptPath,
    `
const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('1.2.3');
  process.exit(0);
}
if (args[0] === 'auth' && args[1] === 'status') {
  if (${authenticated ? "true" : "false"}) {
    console.log(JSON.stringify({ authenticated: true }));
    process.exit(0);
  }
  console.error('Not authenticated. Please log in.');
  process.exit(1);
}
console.error('unexpected fake claude args: ' + args.join(' '));
process.exit(1);
`,
  );

  if (process.platform === "win32") {
    const binPath = join(dir, "claude.cmd");
    writeFileSync(
      binPath,
      `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`,
    );
    return binPath;
  }

  const binPath = join(dir, "claude");
  writeFileSync(
    binPath,
    `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`,
    { mode: 0o755 },
  );
  chmodSync(binPath, 0o755);
  return binPath;
}

function aiPreferencesPayload(overrides = {}) {
  return {
    settings: [],
    systemDefaults: {
      anthropic_compatible: {
        hasApiKey: false,
      },
    },
    defaultAgent: "claude",
    ...overrides,
  };
}

test("version subcommand emits plugin metadata", () => {
  const j = runJson(["version"]);
  assert.equal(j.ok, true);
  assert.equal(j.plugin, "openloomi");
  assert.match(j.version, /^\d+\.\d+\.\d+$/);
});

test("help subcommand lists all advertised subcommands", () => {
  const out = run(["help"]);
  for (const sub of [
    "setup",
    "setup-status",
    "install",
    "login",
    "guest-login",
    "sync-claude-env",
    "pet",
    "state",
    "archive",
    "usage",
    "install-hooks",
    "uninstall-hooks",
    "hooks-status",
    "version",
  ]) {
    assert.match(out, new RegExp(sub));
  }
});

test("unknown subcommand emits structured error", () => {
  let code = 0;
  let out = "";
  try {
    out = run(["nonsense"]);
  } catch (e) {
    code = e.status || 1;
    out = String(e.stdout || "");
  }
  assert.equal(code, 1);
  const j = JSON.parse(out);
  assert.equal(j.ok, false);
  assert.equal(j.code, "UNKNOWN_SUBCOMMAND");
});

test("discovery: OPENLOOMI_NOT_INSTALLED when no helper is reachable", () => {
  // Skip on hosts where OpenLoomi is already installed (e.g. a developer
  // machine) — the test's premise of "no helper reachable anywhere" doesn't
  // hold there. The `packageDefaults` + `desktop-marker` paths will pick
  // up the existing install.
  if (
    existsSync("/Applications/OpenLoomi.app") ||
    existsSync("/opt/openloomi")
  ) {
    return;
  }
  withClaHome((env) => {
    const j = runJson(["setup-status"], env);
    assert.equal(j.installed, false);
    assert.equal(j.binPath, null);
    assert.equal(j.ready, false);
    assert.equal(j.nextAction, "install_openloomi");
    assert.equal(j.reason, "OPENLOOMI_NOT_INSTALLED");
  });
});

test("discovery: respects OPENLOOMI_BIN env when binary present", () => {
  withClaHome((env) => {
    const fake = createFakeOpenLoomiBin(join(env.HOME, "fake-bin"), {
      name: "fake-helper",
    });

    // Pass the env as a single object literal so it's easier to debug
    // what's actually being handed to execFileSync.
    const envPass = {
      ...env,
      OPENLOOMI_BIN: fake.binPath,
    };

    assert.equal(
      envPass.ANTHROPIC_AUTH_TOKEN,
      "",
      "test must clear ANTHROPIC_AUTH_TOKEN",
    );

    let out;
    try {
      out = execFileSync("node", [BRIDGE, "setup-status"], {
        encoding: "utf8",
        env: envPass,
      });
    } catch (e) {
      throw new Error(`bridge exec failed: ${String(e.stdout ?? "")}`);
    }

    const j = JSON.parse(out);
    if (!j.installed) {
      throw new Error(`expected installed; got: ${JSON.stringify(j, null, 2)}`);
    }
    assert.equal(j.installed, true);
    assert.equal(j.binPath, fake.binPath);
    assert.match(
      j.version,
      new RegExp(fake.expectedVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    assert.equal(j.source, "OPENLOOMI_BIN");
  });
});

test("discovery: SOURCE_FOUND_CLI_NOT_BUILT when repo dir set without built ctl", () => {
  withClaHome((env) => {
    const repo = join(env.HOME, "fake-repo", "openloomi");
    mkdirSync(join(repo, "apps", "web", "src-tauri"), { recursive: true });
    writeFileSync(join(repo, "package.json"), "{}");
    writeFileSync(join(repo, "apps", "web", "src-tauri", "Cargo.toml"), "");
    let out;
    try {
      out = execFileSync("node", [BRIDGE, "setup-status"], {
        encoding: "utf8",
        env: {
          ...env,
          PATH: makePath(),
          OPENLOOMI_REPO_DIR: repo,
          OPENLOOMI_BIN: "",
          OPENLOOMI_HOME: "",
          OPENLOOMI_AUTH_TOKEN: "",
          OPENLOOMI_BASE_URL: "",
          CLAUDE_PLUGIN_DATA: "",
          ANTHROPIC_API_KEY: "",
          ANTHROPIC_AUTH_TOKEN: "",
          ANTHROPIC_BASE_URL: "",
          ANTHROPIC_MODEL: "",
        },
      });
    } catch (e) {
      throw new Error(`bridge exec failed: ${String(e.stdout ?? "")}`);
    }

    const j = JSON.parse(out);
    assert.equal(j.installed, false);
    assert.equal(j.reason, "SOURCE_FOUND_CLI_NOT_BUILT");
    assert.equal(j.nextAction, "build_or_stage_openloomi");
    assert.ok(j.hint?.needed);
  });
});

test("claudeEnvSyncable reflects env presence without printing values", () => {
  // Skip on hosts where OpenLoomi is already installed — its presence
  // changes the discovery outcome regardless of OPENLOOMI_BIN.
  if (
    existsSync("/Applications/OpenLoomi.app") ||
    existsSync("/opt/openloomi")
  ) {
    return;
  }
  withClaHome((env) => {
    let out;
    try {
      out = execFileSync("node", [BRIDGE, "setup-status"], {
        encoding: "utf8",
        env: {
          ...env,
          PATH: makePath(),
          OPENLOOMI_BIN: "/nonexistent-ctl",
          OPENLOOMI_HOME: "",
          OPENLOOMI_REPO_DIR: "",
          OPENLOOMI_AUTH_TOKEN: "",
          OPENLOOMI_BASE_URL: "",
          CLAUDE_PLUGIN_DATA: "",
          ANTHROPIC_API_KEY: "sk-test-redacted-12345",
          ANTHROPIC_AUTH_TOKEN: "",
          ANTHROPIC_BASE_URL: "https://api.example.com",
          ANTHROPIC_MODEL: "claude-opus-4-6",
        },
      });
    } catch (e) {
      throw new Error(`bridge exec failed: ${String(e.stdout ?? "")}`);
    }

    assert.ok(
      !out.includes("sk-test-redacted-12345"),
      "stdout must not echo ANTHROPIC_API_KEY",
    );
    const j = JSON.parse(out);
    assert.equal(j.claudeEnvSyncable, true);
    assert.equal(j.installed, false);
    assert.equal(j.nextAction, "install_openloomi");
  });
});

test("sync-claude-env refuses to run without env vars", () => {
  withClaHome((env) => {
    const r = runOutcome(["sync-claude-env"], {
      ...env,
      OPENLOOMI_BASE_URL: "http://127.0.0.1:1",
    });
    assert.notEqual(
      r.code,
      0,
      "sync-claude-env must exit non-zero when env missing",
    );
    const j = JSON.parse(r.stdout);
    assert.equal(j.ok, false);
    assert.equal(j.code, "CLAUDE_ENV_NOT_SET");
    assert.deepEqual(j.checked.ANTHROPIC_API_KEY, {
      present: false,
      source: "env",
    });
    assert.deepEqual(j.checked.ANTHROPIC_AUTH_TOKEN, {
      present: false,
      source: "env",
    });
  });
});

test("install without --yes from a non-TTY shell returns NON_INTERACTIVE_REQUIRES_YES", () => {
  // execFileSync spawns node without a TTY (stdout is captured, not a
  // terminal), which is the same shape Claude Code's Bash tool produces.
  // The bridge must NOT silently cancel — it must surface a clear code
  // explaining the missing --yes flag.
  withClaHome((env) => {
    const r = runOutcome(["install"], env);
    const j = JSON.parse(r.stdout);
    assert.equal(j.install?.ok, false);
    assert.equal(j.install?.code, "NON_INTERACTIVE_REQUIRES_YES");
    assert.match(j.install?.message || "", /--yes/);
  });
});

test("install --yes from a non-TTY shell does not prompt (proceeds to platform script)", () => {
  // With --yes, the bridge skips the y/N prompt and runs the platform
  // install script. We can't ship a real OpenLoomi bundle in tests, so
  // the script will fail with INSTALL_SCRIPT_MISSING or a download
  // failure — either is fine, the point is that we got past the prompt.
  withClaHome((env) => {
    const r = runOutcome(["install", "--yes"], env);
    const j = JSON.parse(r.stdout);
    assert.equal(j.install?.code !== "NON_INTERACTIVE_REQUIRES_YES", true);
    assert.equal(j.install?.code !== "CANCELLED", true);
  });
});

test("pet subcommand rejects invalid state names", () => {
  const r = runOutcome(["pet", "notarealstate"]);
  assert.notEqual(r.code, 0, "pet must exit non-zero on invalid state");
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, false);
  assert.equal(j.code, "INVALID_STATE");
  assert.ok(Array.isArray(j.validStates));
  assert.ok(j.validStates.includes("happy"));
  assert.ok(j.validStates.includes("thinking"));
});

test("state subcommand marks invalid names as skipped without exit 1", () => {
  // Hooks should always exit 0 with structured JSON.
  const out = run(["state", "notareal", "--event", "PreToolUse"]);
  const j = JSON.parse(out);
  // The JSON shape must include either archive or {ok,state}.
  assert.ok("state" in j);
});

test("archive subcommand with empty stdin emits skipped reason and exits 0", () => {
  let code = 0;
  let out = "";
  try {
    out = execFileSync("node", [BRIDGE, "archive"], {
      encoding: "utf8",
      input: "",
      env: { ...process.env, OPENLOOMI_AUTH_TOKEN: "" },
    });
  } catch (e) {
    code = e.status ?? 1;
    out = String(e.stdout ?? "");
  }
  // archive MUST exit 0 even on parse failure.
  assert.equal(code, 0);
  const j = JSON.parse(out);
  assert.equal(j.continue, true);
  assert.ok(["skipped", "ok"].includes(j._openloomi.archive));
});

test("archive subcommand with valid Stop payload writes JSON insight (mocked)", () => {
  // We exercise the path that fails to reach the API (no server) and
  // ensures it still exits 0 with "endpoint_missing" / "api_unreachable".
  const tmp = mkdtempSync(join(tmpdir(), "openloomi-archive-"));
  try {
    const transcript = join(tmp, "transcript.jsonl");
    writeFileSync(
      transcript,
      `${[
        JSON.stringify({ type: "user", message: { content: "hello there" } }),
        JSON.stringify({
          type: "assistant",
          message: { content: "general kenobi" },
        }),
      ].join("\n")}\n`,
    );

    const payload = {
      hook_event_name: "Stop",
      session_id: "sess-test-1",
      transcript_path: transcript,
    };

    let code = 0;
    let out = "";
    try {
      out = execFileSync("node", [BRIDGE, "archive"], {
        encoding: "utf8",
        input: JSON.stringify(payload),
        env: {
          ...process.env,
          OPENLOOMI_AUTH_TOKEN: "mock-bearer-token",
          OPENLOOMI_BASE_URL: "http://127.0.0.1:1", // unreachable
        },
      });
    } catch (e) {
      code = e.status ?? 1;
      out = String(e.stdout ?? "");
    }
    assert.equal(code, 0, "archive must never block Stop with non-zero exit");
    const j = JSON.parse(out);
    assert.equal(j.continue, true);
    // Reason will be api_unreachable, network failure, or http_*. The
    // important guarantee is the exit code and the structured output.
    assert.ok(
      j._openloomi.archive === "ok" || j._openloomi.archive === "skipped",
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("hooks-status reads ~/.claude/settings.json without crashing", () => {
  withClaHome((env) => {
    const out = run(["hooks-status"], env);
    const j = JSON.parse(out);
    assert.equal(j.ok, true);
    assert.equal(typeof j.installed, "boolean");
    assert.equal(j.marker, "_openloomi_plugin");
    assert.equal(j.schema, "per-event");
    assert.equal(j.legacyBlockKey, "__openloomi_claude_plugin_hooks__");
  });
});

test("hooks-merge.cjs install merges per-event into settings.hooks; uninstall removes it", () => {
  withClaHome((env) => {
    const merge = join(PLUGIN_DIR, "scripts", "hooks-merge.cjs");
    const settingsPath = join(env.HOME, ".claude", "settings.json");

    // Make sure the dir exists for the atomic writer.
    mkdirSync(join(env.HOME, ".claude"), { recursive: true });

    const installOut = execFileSync("node", [merge, "install"], {
      env,
      encoding: "utf8",
    });
    const installJson = JSON.parse(installOut);
    assert.equal(installJson.ok, true);
    assert.equal(existsSync(settingsPath), true);

    // Verify the per-event schema: each known event must be a top-level
    // key in settings.hooks, NOT nested under __openloomi_claude_plugin_hooks__.
    const afterInstall = JSON.parse(readFileSync(settingsPath, "utf8"));
    assert.ok(afterInstall.hooks, "settings.hooks must exist");
    assert.ok(
      !afterInstall.hooks.__openloomi_claude_plugin_hooks__,
      "legacy nested block must NOT be written",
    );
    assert.ok(
      Array.isArray(afterInstall.hooks.SessionStart),
      "SessionStart must be a top-level array in settings.hooks",
    );
    assert.ok(
      afterInstall.hooks.SessionStart.length > 0,
      "SessionStart must have at least one entry",
    );
    const marked = afterInstall.hooks.SessionStart.some(
      (e) => e && e._openloomi_plugin === true,
    );
    assert.ok(marked, "installed entries must carry _openloomi_plugin marker");

    // Verify a second install is idempotent.
    const second = execFileSync("node", [merge, "install"], {
      env,
      encoding: "utf8",
    });
    const secondJson = JSON.parse(second);
    assert.equal(secondJson.alreadyInstalled, true);
    const afterSecond = JSON.parse(readFileSync(settingsPath, "utf8"));
    assert.equal(
      afterSecond.hooks.SessionStart.length,
      afterInstall.hooks.SessionStart.length,
      "second install must not duplicate entries",
    );

    const uninstallOut = execFileSync("node", [merge, "uninstall"], {
      env,
      encoding: "utf8",
    });
    const uninstallJson = JSON.parse(uninstallOut);
    assert.equal(uninstallJson.ok, true);
    assert.equal(uninstallJson.removed, true);

    const afterUninstall = JSON.parse(readFileSync(settingsPath, "utf8"));
    const stillMarked = (afterUninstall.hooks?.SessionStart || []).some(
      (e) => e && e._openloomi_plugin === true,
    );
    assert.ok(!stillMarked, "no marker entries may remain after uninstall");
  });
});

test("secrets contract: sync-claude-env never echoes key value", () => {
  // Run a deliberate negative test: set a recognisable fake key, run
  // sync-claude-env with a guaranteed-unreachable API, and grep stdout
  // for the fake key's substring. It MUST NOT appear.
  withClaHome((env) => {
    const r = runOutcome(["sync-claude-env"], {
      ...env,
      ANTHROPIC_API_KEY: "sk-leaktest-ThisShouldNeverAppear-12345",
      ANTHROPIC_BASE_URL: "http://127.0.0.1:1",
      ANTHROPIC_MODEL: "claude-opus-4-6",
      OPENLOOMI_BASE_URL: "http://127.0.0.1:1",
      OPENLOOMI_AUTH_TOKEN: "mock-bearer",
    });
    assert.ok(
      !r.stdout.includes("sk-leaktest"),
      "stdout must not echo ANTHROPIC_API_KEY value",
    );
    assert.ok(
      !r.stdout.includes("ThisShouldNeverAppear"),
      "stdout must not echo key substring",
    );
    assert.ok(
      !r.stderr.includes("sk-leaktest"),
      "stderr must not echo key value either",
    );
  });
});

test("guest-login against unreachable API exits non-zero with NETWORK or ENDPOINT_MISSING", () => {
  // The guest endpoint lives on the local OpenLoomi runtime. With a
  // guaranteed-unreachable base URL, the call must surface a structured
  // code (NETWORK for a connect failure, ENDPOINT_MISSING if the server
  // replies 404) and NEVER echo a token to stdout — there isn't one
  // yet, and the bridge must not pretend otherwise.
  withClaHome((env) => {
    const r = runOutcome(["guest-login"], {
      ...env,
      OPENLOOMI_BASE_URL: "http://127.0.0.1:1",
    });
    assert.notEqual(
      r.code,
      0,
      "guest-login must exit non-zero on a failed call",
    );
    const j = JSON.parse(r.stdout);
    assert.equal(j.ok, false);
    assert.ok(
      ["NETWORK", "ENDPOINT_MISSING", "NO_TOKEN_IN_RESPONSE"].includes(j.guest),
      `unexpected guest code: ${j.guest}`,
    );
    // Must not include a token or any Authorization header in stdout.
    assert.ok(
      !/Bearer\s+[A-Za-z0-9._-]+/.test(r.stdout),
      "stdout must not contain a Bearer token",
    );
  });
});

test("setup-status treats authenticated native Claude runtime as ready without API key", async () => {
  await withClaHomeAsync(async (env) => {
    const fakeOpenLoomi = createFakeOpenLoomiBin(join(env.HOME, "fake-bin"), {
      name: "openloomi",
    });
    const fakeClaude = createFakeClaudeCli(join(env.HOME, "fake-claude"), {
      authenticated: true,
    });

    await withPreferencesServer(aiPreferencesPayload(), async (baseUrl) => {
      const j = await runJsonAsync(["setup-status"], {
        ...env,
        OPENLOOMI_BIN: fakeOpenLoomi.binPath,
        OPENLOOMI_AUTH_TOKEN: "mock-bearer",
        OPENLOOMI_BASE_URL: baseUrl,
        CLAUDE_CODE_PATH: fakeClaude,
      });

      assert.equal(j.aiProviderConfigured, false);
      assert.equal(j.executionProviderReady, true);
      assert.equal(j.executionProviderSource, "native_claude_runtime");
      assert.equal(j.nativeRuntimeActive, true);
      assert.equal(j.nativeRuntimeStatus, "CLAUDE_CLI_AUTHENTICATED");
      assert.equal(j.nativeRuntime.authenticated, true);
      assert.equal(j.ready, true);
      assert.equal(j.nextAction, "run");
      assert.equal(j.reason, "READY");
    });
  });
});

test("setup-status reports Claude CLI auth requirement instead of AI_PROVIDER_REQUIRED", async () => {
  await withClaHomeAsync(async (env) => {
    const fakeOpenLoomi = createFakeOpenLoomiBin(join(env.HOME, "fake-bin"), {
      name: "openloomi",
    });
    const fakeClaude = createFakeClaudeCli(join(env.HOME, "fake-claude"), {
      authenticated: false,
    });

    await withPreferencesServer(aiPreferencesPayload(), async (baseUrl) => {
      const j = await runJsonAsync(["setup-status"], {
        ...env,
        OPENLOOMI_BIN: fakeOpenLoomi.binPath,
        OPENLOOMI_AUTH_TOKEN: "mock-bearer",
        OPENLOOMI_BASE_URL: baseUrl,
        CLAUDE_CODE_PATH: fakeClaude,
      });

      assert.equal(j.aiProviderConfigured, false);
      assert.equal(j.executionProviderReady, false);
      assert.equal(j.nativeRuntimeActive, true);
      assert.equal(j.nativeRuntimeStatus, "CLAUDE_CLI_AUTH_REQUIRED");
      assert.equal(j.nativeRuntime.authenticated, false);
      assert.equal(j.ready, false);
      assert.equal(j.nextAction, "login_claude_cli");
      assert.equal(j.reason, "CLAUDE_CLI_AUTH_REQUIRED");
    });
  });
});

test("setup-status reports missing Claude CLI instead of AI_PROVIDER_REQUIRED", async () => {
  await withClaHomeAsync(async (env) => {
    const fakeOpenLoomi = createFakeOpenLoomiBin(join(env.HOME, "fake-bin"), {
      name: "openloomi",
    });

    await withPreferencesServer(aiPreferencesPayload(), async (baseUrl) => {
      const j = await runJsonAsync(["setup-status"], {
        ...env,
        PATH: makePath(),
        OPENLOOMI_BIN: fakeOpenLoomi.binPath,
        OPENLOOMI_AUTH_TOKEN: "mock-bearer",
        OPENLOOMI_BASE_URL: baseUrl,
        CLAUDE_CODE_PATH: "",
      });

      assert.equal(j.aiProviderConfigured, false);
      assert.equal(j.executionProviderReady, false);
      assert.equal(j.nativeRuntimeActive, true);
      assert.equal(j.nativeRuntimeStatus, "CLAUDE_CLI_UNAVAILABLE");
      assert.equal(j.nativeRuntime.available, false);
      assert.equal(j.ready, false);
      assert.equal(j.nextAction, "install_claude_cli");
      assert.equal(j.reason, "CLAUDE_CLI_UNAVAILABLE");
    });
  });
});

test("setup-status keeps direct Anthropic-compatible provider path ready", async () => {
  await withClaHomeAsync(async (env) => {
    const fakeOpenLoomi = createFakeOpenLoomiBin(join(env.HOME, "fake-bin"), {
      name: "openloomi",
    });

    await withPreferencesServer(
      aiPreferencesPayload({
        systemDefaults: {
          anthropic_compatible: {
            hasApiKey: true,
          },
        },
      }),
      async (baseUrl) => {
        const j = await runJsonAsync(["setup-status"], {
          ...env,
          PATH: makePath(),
          OPENLOOMI_BIN: fakeOpenLoomi.binPath,
          OPENLOOMI_AUTH_TOKEN: "mock-bearer",
          OPENLOOMI_BASE_URL: baseUrl,
          CLAUDE_CODE_PATH: "",
        });

        assert.equal(j.aiProviderConfigured, true);
        assert.equal(j.executionProviderReady, true);
        assert.equal(j.executionProviderSource, "ai_provider");
        assert.equal(j.ready, true);
        assert.equal(j.nextAction, "run");
        assert.equal(j.reason, "READY");
      },
    );
  });
});

test("setup-status exposes canGuestLogin=false when API is unreachable", () => {
  // Skip on hosts where OpenLoomi is already installed — its presence
  // makes the API reachable for real and would flip canGuestLogin to true.
  if (
    existsSync("/Applications/OpenLoomi.app") ||
    existsSync("/opt/openloomi")
  ) {
    return;
  }
  withClaHome((env) => {
    let out;
    try {
      out = execFileSync("node", [BRIDGE, "setup-status"], {
        encoding: "utf8",
        env: {
          ...env,
          PATH: makePath(),
          OPENLOOMI_BIN: "/nonexistent-ctl",
          OPENLOOMI_BASE_URL: "http://127.0.0.1:1",
        },
      });
    } catch (e) {
      throw new Error(`bridge exec failed: ${String(e.stdout ?? "")}`);
    }
    const j = JSON.parse(out);
    // canGuestLogin is true only when apiReachable is true. With a
    // guaranteed-unreachable base URL the field must be false.
    assert.equal(j.canGuestLogin, false);
    assert.equal(j.apiReachable, false);
  });
});
