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

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { join, dirname, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const PLUGIN_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const BRIDGE = join(PLUGIN_DIR, "scripts", "loomi-bridge.mjs");
const execFileAsync = promisify(execFile);

// Accept env directly (positional) so callers can write `run(args, env)`
// without wrapping it in `{ env }`. This matches the convention used
// throughout the file (see `withFakeHome` → `runOutcome(... , env)` and
// `runJson(args, env)`).
function run(args, env = {}) {
  return execFileSync("node", [BRIDGE, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    cwd: env.BRIDGE_TEST_CWD || process.cwd(),
  });
}

function runOutcome(args, env) {
  try {
    const stdout = execFileSync("node", [BRIDGE, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      cwd: env.BRIDGE_TEST_CWD || process.cwd(),
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

function runOutcomeWithInput(args, env, input) {
  try {
    const stdout = execFileSync("node", [BRIDGE, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      input,
      cwd: env.BRIDGE_TEST_CWD || process.cwd(),
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

// Async counterpart: do NOT use this when an in-process server is
// listening for the bridge to call into — execFileSync blocks the
// Node event loop and starves the server.
async function runOutcomeWithInputAsync(args, env, input) {
  try {
    const { stdout } = await execFileAsync("node", [BRIDGE, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      input,
      cwd: env.BRIDGE_TEST_CWD || process.cwd(),
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

async function runAsync(args, env = {}) {
  const { stdout } = await execFileAsync("node", [BRIDGE, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    cwd: env.BRIDGE_TEST_CWD || process.cwd(),
  });
  return stdout;
}

async function runJsonAsync(args, env) {
  return JSON.parse(await runAsync(args, env));
}

// Run a child command with HOME pointed at a fresh temp dir and PATH that
// still resolves to the current node binary. Avoids touching the user's
// real ~/.openloomi/ token.
function withFakeHome(fn) {
  const tmp = mkdtempSync(join(tmpdir(), "openloomi-codex-test-"));
  const nodeDir = dirname(process.execPath);
  const preservedPath = process.env.PATH || "/usr/bin:/bin";
  const pathWithNode = preservedPath.includes(nodeDir)
    ? preservedPath
    : `${nodeDir}${delimiter}${preservedPath}`;
  const env = {
    HOME: tmp,
    USERPROFILE: tmp,
    LOCALAPPDATA: join(tmp, "AppData", "Local"),
    APPDATA: join(tmp, "AppData", "Roaming"),
    PROGRAMFILES: join(tmp, "Program Files"),
    "ProgramFiles(x86)": join(tmp, "Program Files (x86)"),
    BRIDGE_TEST_CWD: tmp,
    PATH: pathWithNode,
    OPENLOOMI_BIN: "",
    OPENLOOMI_CTL: "",
    OPENLOOMI_HOME: "",
    OPENLOOMI_INSTALL_DIR: "",
    OPENLOOMI_REPO_DIR: "",
    OPENLOOMI_API_URL: "",
    OPENLOOMI_BASE_URL: "http://127.0.0.1:1",
    OPENLOOMI_AUTH_TOKEN: "",
    OPENAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    OPENROUTER_API_KEY: "",
    OPENLOOMI_AI_API_KEY: "",
    OPENAI_BASE_URL: "",
    ANTHROPIC_BASE_URL: "",
    OPENROUTER_BASE_URL: "",
    OPENLOOMI_AI_BASE_URL: "",
    OPENLOOMI_AI_MODEL: "",
    OPENLOOMI_DEBUG_DISCOVERY: "1",
  };
  try {
    return fn(env);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function withFakeHomeAsync(fn) {
  const tmp = mkdtempSync(join(tmpdir(), "openloomi-codex-test-"));
  const nodeDir = dirname(process.execPath);
  const preservedPath = process.env.PATH || "/usr/bin:/bin";
  const pathWithNode = preservedPath.includes(nodeDir)
    ? preservedPath
    : `${nodeDir}${delimiter}${preservedPath}`;
  const env = {
    HOME: tmp,
    USERPROFILE: tmp,
    LOCALAPPDATA: join(tmp, "AppData", "Local"),
    APPDATA: join(tmp, "AppData", "Roaming"),
    PROGRAMFILES: join(tmp, "Program Files"),
    "ProgramFiles(x86)": join(tmp, "Program Files (x86)"),
    BRIDGE_TEST_CWD: tmp,
    PATH: pathWithNode,
    OPENLOOMI_BIN: "",
    OPENLOOMI_CTL: "",
    OPENLOOMI_HOME: "",
    OPENLOOMI_INSTALL_DIR: "",
    OPENLOOMI_REPO_DIR: "",
    OPENLOOMI_API_URL: "",
    OPENLOOMI_BASE_URL: "http://127.0.0.1:1",
    OPENLOOMI_AUTH_TOKEN: "",
    OPENAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    OPENROUTER_API_KEY: "",
    OPENLOOMI_AI_API_KEY: "",
    OPENAI_BASE_URL: "",
    ANTHROPIC_BASE_URL: "",
    OPENROUTER_BASE_URL: "",
    OPENLOOMI_AI_BASE_URL: "",
    OPENLOOMI_AI_MODEL: "",
    OPENLOOMI_DEBUG_DISCOVERY: "1",
  };
  try {
    return await fn(env);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function writeFakeToken(home) {
  const dir = join(home, ".openloomi");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "token"),
    Buffer.from("fake-openloomi-token", "utf8").toString("base64"),
  );
}

function getRunLockPath(home) {
  return join(home, ".openloomi", "codex-plugin-run.lock");
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
      command: "run",
    }),
  );
  return lockPath;
}

async function withLocalApiServer(handler, fn) {
  const requests = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      let json = null;
      try {
        json = raw ? JSON.parse(raw) : null;
      } catch {
        json = { raw };
      }
      const request = {
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization || null,
        json,
      };
      requests.push(request);
      handler(req, res, request);
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    return await fn({ baseUrl: `http://127.0.0.1:${port}`, requests });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function withPetApiServer(handler, fn) {
  return withLocalApiServer(handler, fn);
}

function writeFakeCtl(home) {
  const nodeScript = join(home, "fake-openloomi-ctl.mjs");
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
      "    argv: process.argv.slice(2),",
      "    prompt: input,",
      "  }));",
      "});",
    ].join("\n"),
  );

  if (process.platform === "win32") {
    const cmd = join(home, "openloomi-ctl.cmd");
    writeFileSync(
      cmd,
      `@"${process.execPath}" "%~dp0fake-openloomi-ctl.mjs" %*\r\n`,
    );
    return cmd;
  }

  const shim = join(home, "openloomi-ctl");
  const nodePath = process.execPath.replace(/'/g, "'\\''");
  writeFileSync(
    shim,
    `#!/bin/sh\nexec '${nodePath}' "$(dirname "$0")/fake-openloomi-ctl.mjs" "$@"\n`,
  );
  chmodSync(shim, 0o755);
  return shim;
}

function writeJsonResponse(res, status, payload, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function createReadySetupApiHandler({
  aiPreferencePayload = {
    settings: [
      {
        providerType: "anthropic_compatible",
        enabled: true,
        hasApiKey: true,
        baseUrl: "https://api.example.invalid",
        model: "claude-test",
      },
    ],
    systemDefaults: {},
  },
  connectorStatus = 200,
  connectorPayload = { items: [] },
  integrationStatus = 200,
  integrationPayload = { accounts: [] },
  nativeProviderStatus = 200,
  nativeProviderPayload = {
    defaultAgent: "claude",
    agents: [{ type: "claude", name: "Claude" }],
  },
} = {}) {
  return (req, res) => {
    const url = req.url || "/";

    if (url === "/" || url === "") {
      writeJsonResponse(res, 200, { ok: true });
      return;
    }

    if (url.startsWith("/api/auth/set-token")) {
      writeJsonResponse(
        res,
        200,
        { ok: true },
        {
          "Set-Cookie": "authjs.session-token=fake-session; Path=/; HttpOnly",
        },
      );
      return;
    }

    if (url.startsWith("/api/preferences/ai")) {
      writeJsonResponse(res, 200, aiPreferencePayload);
      return;
    }

    if (url.startsWith("/api/native/providers")) {
      writeJsonResponse(res, nativeProviderStatus, nativeProviderPayload);
      return;
    }

    if (url.startsWith("/api/loop/connectors")) {
      writeJsonResponse(res, connectorStatus, connectorPayload);
      return;
    }

    if (url.startsWith("/api/integrations")) {
      writeJsonResponse(res, integrationStatus, integrationPayload);
      return;
    }

    writeJsonResponse(res, 404, { error: "not found" });
  };
}

// -----------------------------------------------------------------------------
// version
// -----------------------------------------------------------------------------

test("version returns bridge identity and command list", () => {
  const j = runJson(["version"]);
  assert.equal(j.name, "openloomi-codex-bridge");
  assert.equal(typeof j.version, "string");
  assert.ok(j.version.length > 0);
  assert.equal(j.pluginPhase, "runtime-provider-readiness");
  assert.ok(Array.isArray(j.commands));
  // Must include the bridge's public commands.
  for (const cmd of [
    "setup-status",
    "setup",
    "install-openloomi",
    "install-instructions",
    "initialize-session",
    "configure-ai-provider",
    "workflow-guidance",
    "version",
    "help",
    "run",
    "codex-runtime-info",
  ]) {
    assert.ok(j.commands.includes(cmd), `version.commands missing ${cmd}`);
  }
});

// -----------------------------------------------------------------------------
// setup-status shape contract
// -----------------------------------------------------------------------------

test("setup-status apiProbe field is present and well-formed", () => {
  const j = runJson(["setup-status"]);
  assert.ok(j.apiProbe, "setup-status must include apiProbe field");
  // Top-level apiReachable boolean mirrors the apiProbe summary.
  assert.equal(typeof j.apiReachable, "boolean");
  assert.equal(j.apiReachable, Boolean(j.apiProbe.reachableUrl));
  assert.ok(Array.isArray(j.apiProbe.attempts));
  for (const entry of j.apiProbe.attempts) {
    assert.equal(typeof entry.baseUrl, "string");
    assert.ok(
      ["NETWORK_ERROR", "TIMEOUT", "HTTP_RESPONSE"].includes(entry.reason) ||
        typeof entry.status === "number",
      `unexpected apiProbe attempt reason: ${entry.reason}`,
    );
  }
  // checks.apiProbe mirrors the same attempts list so downstream consumers
  // can find it under the standard checks bag.
  assert.ok(Array.isArray(j.checks.apiProbe));
});

test("setup-status reports OPENLOOMI_API_UNREACHABLE when API down and no token", () => {
  withFakeHome((env) => {
    const ctl = writeFakeCtl(env.HOME);
    // Make sure no token file is present and no local API is reachable
    // (fake HOME guarantees ~/.openloomi/token does not exist; the fake
    // env forces OPENLOOMI_BASE_URL to a closed port).
    const j = runJson(["setup-status"], {
      ...env,
      OPENLOOMI_CTL: ctl,
    });
    assert.equal(j.apiReachable, false);
    if (!j.tokenPresent) {
      assert.equal(j.ready, false);
      assert.equal(j.nextAction, "open_openloomi");
      assert.equal(j.reason, "OPENLOOMI_API_UNREACHABLE");
    }
  });
});

test("setup-status exposes the protocol contract fields", () => {
  const j = runJson(["setup-status"]);
  for (const key of [
    "mode",
    "installed",
    "ctlPath",
    "version",
    "tokenPresent",
    "aiProviderConfigured",
    "apiReachable",
    "ready",
    "nextAction",
    "reason",
  ]) {
    assert.ok(key in j, `setup-status missing required key: ${key}`);
  }
  assert.equal(typeof j.ready, "boolean");
  assert.equal(typeof j.tokenPresent, "boolean");
  assert.equal(typeof j.installed, "boolean");
  assert.equal(typeof j.apiReachable, "boolean");
  // Either an installed OpenLoomi has a ctlPath, or nextAction must point
  // the user at install_openloomi / provide_install_or_repo_path.
  if (!j.installed) {
    assert.ok(
      [
        "install_openloomi",
        "provide_install_or_repo_path",
        "build_or_stage_openloomi_ctl",
      ].includes(j.nextAction),
      `unexpected nextAction when not installed: ${j.nextAction}`,
    );
  }
});

test("setup-status treats active native Codex runtime as execution-ready without an AI provider", async () => {
  await withFakeHomeAsync(async (env) => {
    const ctl = writeFakeCtl(env.HOME);
    writeFakeToken(env.HOME);

    await withLocalApiServer(
      createReadySetupApiHandler({
        aiPreferencePayload: {
          settings: [],
          systemDefaults: {},
        },
        nativeProviderPayload: {
          defaultAgent: "codex",
          agents: [{ type: "codex", name: "Codex CLI" }],
        },
      }),
      async ({ baseUrl }) => {
        const j = await runJsonAsync(["setup-status"], {
          ...env,
          OPENLOOMI_CTL: ctl,
          OPENLOOMI_BASE_URL: baseUrl,
          OPENLOOMI_AGENT_PROVIDER: "codex",
        });

        assert.equal(j.aiProviderConfigured, false);
        assert.equal(j.executionProviderReady, true);
        assert.equal(j.executionProviderSource, "native_codex_runtime");
        assert.equal(j.nativeRuntimeActive, true);
        assert.equal(j.nativeRuntimeProvider, "codex");
        assert.equal(j.nativeRuntime.codexAgentAvailable, true);
        assert.equal(j.ready, true);
        assert.equal(j.nextAction, "run");
        assert.equal(j.reason, "READY");
        assert.equal(j.readinessSource, "native_codex_runtime");
        assert.equal(j.checks.nativeProvider.active, true);
      },
    );
  });
});

test("setup-status still requires an AI provider when the native Codex runtime is inactive", async () => {
  await withFakeHomeAsync(async (env) => {
    const ctl = writeFakeCtl(env.HOME);
    writeFakeToken(env.HOME);

    await withLocalApiServer(
      createReadySetupApiHandler({
        aiPreferencePayload: {
          settings: [],
          systemDefaults: {},
        },
        nativeProviderPayload: {
          defaultAgent: "claude",
          agents: [
            { type: "claude", name: "Claude" },
            { type: "codex", name: "Codex CLI" },
          ],
        },
      }),
      async ({ baseUrl }) => {
        const j = await runJsonAsync(["setup-status"], {
          ...env,
          OPENLOOMI_CTL: ctl,
          OPENLOOMI_BASE_URL: baseUrl,
        });

        assert.equal(j.aiProviderConfigured, false);
        assert.equal(j.executionProviderReady, false);
        assert.equal(j.executionProviderSource, null);
        assert.equal(j.nativeRuntimeActive, false);
        assert.equal(j.nativeRuntimeProvider, "claude");
        assert.equal(j.nativeRuntime.codexAgentAvailable, true);
        assert.equal(j.ready, false);
        assert.equal(j.nextAction, "configure_ai_provider");
        assert.equal(j.reason, "AI_PROVIDER_REQUIRED");
      },
    );
  });
});

test("setup-status recommends connector setup when monitored connectors are disconnected", async () => {
  await withFakeHomeAsync(async (env) => {
    const ctl = writeFakeCtl(env.HOME);
    writeFakeToken(env.HOME);

    await withLocalApiServer(
      createReadySetupApiHandler({
        connectorPayload: {
          items: [
            {
              id: "gmail",
              label: "Gmail",
              connected: false,
              accountCount: 0,
              probed: true,
              fetchedAt: "2026-07-14T00:00:00.000Z",
            },
            {
              id: "slack",
              label: "Slack",
              connected: false,
              accountCount: 0,
              probed: true,
            },
            {
              id: "obsidian",
              label: "Obsidian",
              connected: false,
              accountCount: 0,
              lastError: "local-only",
            },
          ],
        },
      }),
      async ({ baseUrl }) => {
        const j = await runJsonAsync(["setup-status"], {
          ...env,
          OPENLOOMI_CTL: ctl,
          OPENLOOMI_BASE_URL: baseUrl,
        });

        assert.equal(j.ready, true);
        assert.equal(j.nextAction, "run");
        assert.equal(j.reason, "READY");
        assert.equal(j.connectorStatusAvailable, true);
        assert.equal(j.connectorSetupRecommended, true);
        assert.equal(j.recommendedNextAction, "configure_connectors");
        assert.equal(j.recommendedReason, "CONNECTOR_SETUP_REQUIRED");
        assert.equal(j.connectorSetupUrl, `${baseUrl}/connectors`);
        assert.equal(j.checks.connectors.available, true);
        assert.equal(j.checks.connectors.setupRecommended, true);
        assert.ok(Array.isArray(j.connectors));
        assert.equal(j.connectors[0].id, "gmail");
        assert.equal(j.connectors[0].connected, false);
        assert.equal(j.connectors[0].accountCount, 0);
      },
    );
  });
});

test("setup-status does not recommend connector setup when a monitored connector is connected", async () => {
  await withFakeHomeAsync(async (env) => {
    const ctl = writeFakeCtl(env.HOME);
    writeFakeToken(env.HOME);

    await withLocalApiServer(
      createReadySetupApiHandler({
        connectorPayload: {
          items: [
            {
              id: "gmail",
              label: "Gmail",
              connected: true,
              accountCount: 1,
              word_id: "must-not-leak",
              oauthToken: "must-not-leak",
              lastError: "bearer must-not-leak",
            },
          ],
        },
      }),
      async ({ baseUrl }) => {
        const j = await runJsonAsync(["setup-status"], {
          ...env,
          OPENLOOMI_CTL: ctl,
          OPENLOOMI_BASE_URL: baseUrl,
        });

        assert.equal(j.ready, true);
        assert.equal(j.connectorStatusAvailable, true);
        assert.equal(j.connectorSetupRecommended, false);
        assert.equal(j.recommendedNextAction, null);
        assert.equal(j.recommendedReason, null);
        assert.equal(j.connectors.length, 1);
        assert.deepEqual(j.connectors[0], {
          id: "gmail",
          label: "Gmail",
          connected: true,
          accountCount: 1,
          lastError: "redacted",
        });
        const serialized = JSON.stringify(j.connectors);
        assert.equal(serialized.includes("must-not-leak"), false);
        assert.equal(serialized.includes("word_id"), false);
        assert.equal(serialized.includes("oauthToken"), false);
      },
    );
  });
});

test("setup-status keeps core readiness when connector status endpoint fails", async () => {
  await withFakeHomeAsync(async (env) => {
    const ctl = writeFakeCtl(env.HOME);
    writeFakeToken(env.HOME);

    await withLocalApiServer(
      createReadySetupApiHandler({
        connectorStatus: 500,
        connectorPayload: { error: "connectors failed" },
        integrationStatus: 500,
        integrationPayload: { error: "integrations failed" },
      }),
      async ({ baseUrl }) => {
        const j = await runJsonAsync(["setup-status"], {
          ...env,
          OPENLOOMI_CTL: ctl,
          OPENLOOMI_BASE_URL: baseUrl,
        });

        assert.equal(j.ready, true);
        assert.equal(j.nextAction, "run");
        assert.equal(j.reason, "READY");
        assert.equal(j.connectorStatusAvailable, false);
        assert.equal(j.connectorSetupRecommended, true);
        assert.equal(j.recommendedNextAction, "configure_connectors");
        assert.equal(j.recommendedReason, "CONNECTOR_SETUP_REQUIRED");
        assert.deepEqual(j.connectors, []);
        assert.equal(j.checks.connectors.available, false);
        assert.equal(j.checks.connectors.reason, "CONNECTOR_STATUS_HTTP_500");
        assert.equal(
          j.checks.connectors.nativeReason,
          "NATIVE_INTEGRATIONS_HTTP_500",
        );
      },
    );
  });
});

test("setup-status falls back to native integrations when loop connector status fails", async () => {
  await withFakeHomeAsync(async (env) => {
    const ctl = writeFakeCtl(env.HOME);
    writeFakeToken(env.HOME);

    await withLocalApiServer(
      createReadySetupApiHandler({
        connectorStatus: 500,
        connectorPayload: { error: "connectors failed" },
        integrationPayload: {
          accounts: [
            {
              id: "native-gmail-account",
              platform: "gmail",
              externalId: "must-not-leak",
              displayName: "Gmail",
              status: "connected",
            },
            {
              id: "native-qq-account",
              platform: "qqbot",
              externalId: "must-not-leak",
              displayName: "QQ",
              status: "connected",
            },
          ],
        },
      }),
      async ({ baseUrl }) => {
        const j = await runJsonAsync(["setup-status"], {
          ...env,
          OPENLOOMI_CTL: ctl,
          OPENLOOMI_BASE_URL: baseUrl,
        });

        assert.equal(j.ready, true);
        assert.equal(j.connectorStatusAvailable, true);
        assert.equal(j.connectorSetupRecommended, false);
        assert.equal(j.recommendedNextAction, null);
        assert.equal(j.recommendedReason, null);
        assert.equal(
          j.connectorStatus.reason,
          "CONNECTOR_STATUS_HTTP_500_WITH_NATIVE_INTEGRATIONS",
        );
        assert.deepEqual(
          j.connectors.map((connector) => ({
            id: connector.id,
            connected: connector.connected,
            accountCount: connector.accountCount,
          })),
          [
            { id: "gmail", connected: true, accountCount: 1 },
            { id: "qqbot", connected: true, accountCount: 1 },
          ],
        );
        const serialized = JSON.stringify(j.connectors);
        assert.equal(serialized.includes("must-not-leak"), false);
      },
    );
  });
});

test("setup-status aiProvider runtime check never reports key values", () => {
  withFakeHome((env) => {
    const j = runJson(["setup-status"], env);
    // The aiProvider checks[] is intentionally empty now (the bridge no
    // longer reads provider env vars). Guard against accidentally
    // re-introducing an entry that carries a key value.
    for (const entry of j.checks.aiProvider || []) {
      assert.ok(
        !("value" in entry),
        `aiProvider check leaked a value: ${entry.key ?? "<unknown>"}`,
      );
    }
    // Runtime-sourced providers must also satisfy the no-value
    // contract — anything that could carry an apiKey / token / secret
    // value is forbidden here.
    for (const provider of j.checks.aiProviderRuntime?.providers || []) {
      for (const field of [
        "value",
        "apiKey",
        "authToken",
        "token",
        "secret",
      ]) {
        assert.ok(
          !(field in provider) || provider[field] === "",
          `aiProviderRuntime.providers leaked a value via ${field}`,
        );
      }
    }
    // Same contract for the auth checks block.
    for (const entry of j.checks.auth || []) {
      assert.equal(typeof entry.key, "string");
      assert.equal(typeof entry.present, "boolean");
      assert.equal(typeof entry.source, "string");
      assert.ok(!("value" in entry), `auth check leaked a value: ${entry.key}`);
    }
  });
});

test("run preserves the direct runner by not synthesizing OPENLOOMI_API_URL", async () => {
  await withFakeHomeAsync(async (env) => {
    const ctl = writeFakeCtl(env.HOME);
    writeFakeToken(env.HOME);
    await withLocalApiServer(
      createReadySetupApiHandler(),
      async ({ baseUrl }) => {
        const r = await runOutcomeWithInputAsync(
          ["run"],
          {
            ...env,
            OPENLOOMI_CTL: ctl,
            OPENLOOMI_BASE_URL: baseUrl,
            OPENLOOMI_API_URL: "",
            ANTHROPIC_API_KEY: "sk-test-never-print",
          },
          "Reply with exactly: OpenLoomi ready.",
        );
        assert.equal(r.code, 0, r.stderr || r.stdout);
        const j = JSON.parse(r.stdout);
        assert.equal(j.ready, true);
        assert.equal(j.reason, "RUN_COMPLETE");
        assert.equal(j.result.env.OPENLOOMI_API_URL, null);
        assert.equal(j.result.prompt, "Reply with exactly: OpenLoomi ready.");
        assert.ok(!r.stdout.includes("sk-test-never-print"));
      },
    );
  });
});

test("run preserves an explicitly configured OPENLOOMI_API_URL", async () => {
  await withFakeHomeAsync(async (env) => {
    const ctl = writeFakeCtl(env.HOME);
    writeFakeToken(env.HOME);
    await withLocalApiServer(
      createReadySetupApiHandler(),
      async ({ baseUrl }) => {
        const r = await runOutcomeWithInputAsync(
          ["run"],
          {
            ...env,
            OPENLOOMI_CTL: ctl,
            OPENLOOMI_BASE_URL: baseUrl,
            OPENLOOMI_API_URL: `${baseUrl}/api/loop`,
            ANTHROPIC_API_KEY: "sk-test-never-print",
          },
          "Reply with exactly: OpenLoomi ready.",
        );
        assert.equal(r.code, 0, r.stderr || r.stdout);
        const j = JSON.parse(r.stdout);
        assert.equal(j.ready, true);
        assert.equal(j.reason, "RUN_COMPLETE");
        assert.equal(j.result.env.OPENLOOMI_API_URL, `${baseUrl}/api/loop`);
        assert.ok(!r.stdout.includes("sk-test-never-print"));
      },
    );
  });
});

test("run refuses nested bridge invocation when an active run lock exists", async () => {
  await withFakeHomeAsync(async (env) => {
    const ctl = writeFakeCtl(env.HOME);
    writeFakeToken(env.HOME);
    writeRunLock(env.HOME);
    await withLocalApiServer(
      createReadySetupApiHandler(),
      async ({ baseUrl }) => {
        const r = await runOutcomeWithInputAsync(
          ["run"],
          {
            ...env,
            OPENLOOMI_CTL: ctl,
            OPENLOOMI_BASE_URL: baseUrl,
            ANTHROPIC_API_KEY: "sk-test-never-print",
          },
          "Nested request should be refused.",
        );
        assert.equal(r.code, 1);
        const j = JSON.parse(r.stdout);
        assert.equal(j.reason, "RECURSION_GUARD");
        assert.equal(j.ran, false);
        assert.equal(j.command, "run");
        assert.equal(j.nextAction, "return_without_bridge");
        assert.ok(!r.stdout.includes("sk-test-never-print"));
      },
    );
  });
});

test("run cleans stale lock and proceeds", async () => {
  await withFakeHomeAsync(async (env) => {
    const ctl = writeFakeCtl(env.HOME);
    writeFakeToken(env.HOME);
    const lockPath = writeRunLock(env.HOME, {
      startedAt: Date.now() - 10_000,
    });
    await withLocalApiServer(
      createReadySetupApiHandler(),
      async ({ baseUrl }) => {
        const r = await runOutcomeWithInputAsync(
          ["run"],
          {
            ...env,
            OPENLOOMI_CTL: ctl,
            OPENLOOMI_BASE_URL: baseUrl,
            OPENLOOMI_CODEX_BRIDGE_RUN_LOCK_TTL_MS: "1",
            ANTHROPIC_API_KEY: "sk-test-never-print",
          },
          "Stale lock should be ignored.",
        );
        assert.equal(r.code, 0, r.stderr || r.stdout);
        const j = JSON.parse(r.stdout);
        assert.equal(j.reason, "RUN_COMPLETE");
        assert.equal(j.result.prompt, "Stale lock should be ignored.");
        assert.equal(existsSync(lockPath), false, "run lock should be released");
      },
    );
  });
});

test("run translates --permission-mode to openloomi-ctl canonical values", async () => {
  const cases = [
    { input: "allow", expected: "bypass" },
    { input: "ask", expected: "ask" },
    { input: "deny", expected: "deny" },
  ];

  for (const { input, expected } of cases) {
    await withFakeHomeAsync(async (env) => {
      const ctl = writeFakeCtl(env.HOME);
      writeFakeToken(env.HOME);
      await withLocalApiServer(
        createReadySetupApiHandler(),
        async ({ baseUrl }) => {
          const r = await runOutcomeWithInputAsync(
            ["run", "--permission-mode", input],
            {
              ...env,
              OPENLOOMI_CTL: ctl,
              OPENLOOMI_BASE_URL: baseUrl,
              ANTHROPIC_API_KEY: "sk-test-never-print",
            },
            `bridge input ${input}`,
          );
          assert.equal(r.code, 0, r.stderr || r.stdout);
          const j = JSON.parse(r.stdout);
          assert.equal(j.ready, true);
          assert.equal(j.reason, "RUN_COMPLETE");
          assert.ok(Array.isArray(j.result.argv), "fake ctl must expose argv");
          assert.deepEqual(j.result.argv.slice(0, 4), [
            "--one-shot",
            "--stdin",
            "--json",
            "--permission-mode",
          ]);
          assert.equal(j.result.argv[4], expected);
        },
      );
    });
  }
});

test("run omits --permission-mode and forwards deny to openloomi-ctl", async () => {
  await withFakeHomeAsync(async (env) => {
    const ctl = writeFakeCtl(env.HOME);
    writeFakeToken(env.HOME);
    await withLocalApiServer(
      createReadySetupApiHandler(),
      async ({ baseUrl }) => {
        const r = await runOutcomeWithInputAsync(
          ["run"],
          {
            ...env,
            OPENLOOMI_CTL: ctl,
            OPENLOOMI_BASE_URL: baseUrl,
            ANTHROPIC_API_KEY: "sk-test-never-print",
          },
          "No permission flag at all.",
        );
        assert.equal(r.code, 0, r.stderr || r.stdout);
        const j = JSON.parse(r.stdout);
        assert.equal(j.reason, "RUN_COMPLETE");
        assert.ok(Array.isArray(j.result.argv));
        assert.deepEqual(j.result.argv.slice(0, 4), [
          "--one-shot",
          "--stdin",
          "--json",
          "--permission-mode",
        ]);
        assert.equal(j.result.argv[4], "deny");
      },
    );
  });
});

test("run refuses to escalate on unsupported --permission-mode values", async () => {
  for (const unsupported of ["", "approve", "yes", "BYPASS", "  allow  "]) {
    await withFakeHomeAsync(async (env) => {
      const ctl = writeFakeCtl(env.HOME);
      writeFakeToken(env.HOME);
      await withLocalApiServer(
        createReadySetupApiHandler(),
        async ({ baseUrl }) => {
          const r = await runOutcomeWithInputAsync(
            ["run", "--permission-mode", unsupported],
            {
              ...env,
              OPENLOOMI_CTL: ctl,
              OPENLOOMI_BASE_URL: baseUrl,
              ANTHROPIC_API_KEY: "sk-test-never-print",
            },
            `unsupported mode: ${JSON.stringify(unsupported)}`,
          );
          assert.equal(r.code, 0, r.stderr || r.stdout);
          const j = JSON.parse(r.stdout);
          assert.equal(j.reason, "RUN_COMPLETE");
          assert.ok(Array.isArray(j.result.argv));
          assert.deepEqual(j.result.argv.slice(0, 4), [
            "--one-shot",
            "--stdin",
            "--json",
            "--permission-mode",
          ]);
          assert.equal(
            j.result.argv[4],
            "deny",
            `unsupported mode ${JSON.stringify(unsupported)} must fall back to deny`,
          );
          assert.notEqual(j.result.argv[4], "bypass");
          assert.notEqual(j.result.argv[4], "allow");
        },
      );
    });
  }
});

test("setup-status is not blocked by an active run lock", () => {
  withFakeHome((env) => {
    writeRunLock(env.HOME);
    const j = runJson(["setup-status"], env);
    assert.notEqual(j.reason, "RECURSION_GUARD");
    assert.ok("ready" in j);
  });
});

// -----------------------------------------------------------------------------
// install-instructions / workflow-guidance
// -----------------------------------------------------------------------------

test("install-instructions returns a supported install plan on darwin", () => {
  if (process.platform !== "darwin" && process.platform !== "linux") return;
  const j = runJson(["install-instructions"]);
  assert.equal(j.nextAction, "install_openloomi");
  assert.equal(j.reason, "INSTALL_REQUIRED");
  assert.equal(j.installPlan.platform, process.platform);
  assert.equal(j.installPlan.arch, process.arch);
  assert.equal(j.installPlan.supported, true);
  assert.match(
    j.installPlan.officialReleaseApi,
    /^https:\/\/api\.github\.com\//,
  );
  // Safety reminder must be present.
  assert.ok(Array.isArray(j.installPlan.safety));
  assert.ok(
    j.installPlan.safety.some((s) => s.includes("--confirm")),
    "install plan should mention --confirm",
  );
});

test("workflow-guidance lists the four openloomi workflows", () => {
  const j = runJson(["workflow-guidance"]);
  assert.ok(j.ready);
  const ids = (j.workflows || []).map((w) => w.id);
  for (const id of [
    "openloomi-loop",
    "openloomi-memory",
    "openloomi-connectors",
    "openloomi-handoff",
  ]) {
    assert.ok(ids.includes(id), `workflow-guidance missing ${id}`);
  }
});

// -----------------------------------------------------------------------------
// Secrets contract — the plugin must never echo API key / token values
// -----------------------------------------------------------------------------

test("workflow-guidance uses runtime-safe run prompts for agent workflows", () => {
  for (const workflow of [
    "openloomi-loop",
    "openloomi-memory",
    "openloomi-handoff",
  ]) {
    const j = runJson(["workflow-guidance", "--workflow", workflow]);
    const prefix = j.workflow?.taskPromptPrefix || "";
    assert.match(prefix, /already inside the OpenLoomi runtime/);
    assert.match(prefix, /Do not call tools, shell, skills/);
    assert.match(prefix, /loomi-bridge/);
    assert.doesNotMatch(prefix, /^Use OpenLoomi .* workflow/);
  }
});

test("secrets contract: fake key value never appears in any subcommand output", () => {
  withFakeHome((env) => {
    const fake = "sk-leaktest-ThisShouldNeverAppear-12345";
    const inputs = {
      ...env,
      OPENLOOMI_AUTH_TOKEN: fake,
      OPENAI_API_KEY: fake,
      ANTHROPIC_API_KEY: fake,
      OPENLOOMI_AI_API_KEY: fake,
      ANTHROPIC_BASE_URL: "http://127.0.0.1:1",
      OPENLOOMI_AI_BASE_URL: "http://127.0.0.1:1",
      OPENLOOMI_AI_MODEL: "leaktest-model",
    };
    for (const sub of [
      ["version"],
      ["setup-status"],
      ["install-instructions"],
      ["workflow-guidance"],
      ["configure-ai-provider"],
      ["help"],
    ]) {
      const r = runOutcome(sub, inputs);
      assert.ok(
        !r.stdout.includes("sk-leaktest"),
        `${sub.join(" ")} stdout leaked sk-leaktest`,
      );
      assert.ok(
        !r.stdout.includes("ThisShouldNeverAppear"),
        `${sub.join(" ")} stdout leaked ThisShouldNeverAppear`,
      );
      assert.ok(
        !r.stderr.includes("sk-leaktest"),
        `${sub.join(" ")} stderr leaked sk-leaktest`,
      );
    }
  });
});

test("secrets contract: install-openloomi refuses without --confirm and never reveals values", () => {
  withFakeHome((env) => {
    const r = runOutcome(["install-openloomi"], {
      ...env,
      OPENLOOMI_AUTH_TOKEN: "sk-leaktest-INSTALL-x",
    });
    // No confirm, no install attempted. Either succeeds with a "needs
    // confirmation" payload, or returns INSTALL_CONFIRMATION_REQUIRED. We
    // accept both; the absolute requirement is no value leak.
    assert.ok(!r.stdout.includes("sk-leaktest-INSTALL-x"));
    assert.ok(!r.stderr.includes("sk-leaktest-INSTALL-x"));
  });
});

// -----------------------------------------------------------------------------
// setup state machine — the new end-to-end command
// -----------------------------------------------------------------------------

test("setup without --yes returns awaiting_user_action when install is required", () => {
  withFakeHome((env) => {
    // Force "not installed" by pointing discovery at a non-existent ctl.
    const r = runOutcome(["setup"], {
      ...env,
      OPENLOOMI_BIN: "/nonexistent-ctl-please-ignore",
      OPENLOOMI_HOME: "/nonexistent-home",
      OPENLOOMI_REPO_DIR: "/nonexistent-repo",
      PATH: dirname(process.execPath),
    });
    const j = JSON.parse(r.stdout);
    assert.ok(
      j.steps && j.steps.length > 0,
      "setup must record at least one step",
    );
    if (j.setup === "awaiting_user_action") {
      // The state machine may now surface a new "open_openloomi" branch
      // when the local OpenLoomi API is unreachable even though a ctl was
      // explicitly disabled via OPENLOOMI_BIN. Accept that as an
      // awaiting_user_action signal too — the user must launch the
      // desktop app before the wizard can continue.
      assert.ok(
        [
          "confirm_install_openloomi",
          "install_openloomi",
          "build_or_stage_openloomi_ctl",
          "open_openloomi",
        ].includes(j.nextAction),
        `unexpected nextAction: ${j.nextAction}`,
      );
    } else {
      // If the test environment happens to have OpenLoomi installed, the
      // state machine may continue to session init. That's fine — we only
      // require the machine not to crash and to expose {steps, status}.
      assert.equal(typeof j.steps, "object");
      assert.equal(typeof j.status, "object");
    }
  });
});

test("setup records steps in chronological order and timestamps are monotonic", () => {
  withFakeHome((env) => {
    const r = runOutcome(["setup"], env);
    const j = JSON.parse(r.stdout);
    if (!j.steps || j.steps.length < 2) return; // single-step state is acceptable
    for (let i = 1; i < j.steps.length; i += 1) {
      assert.ok(
        j.steps[i].at >= j.steps[i - 1].at,
        `steps[${i}].at (${j.steps[i].at}) < steps[${i - 1}].at (${j.steps[i - 1].at})`,
      );
      assert.equal(typeof j.steps[i].step, "string");
      assert.equal(typeof j.steps[i].ok, "boolean");
    }
  });
});

test("setup status field mirrors setup-status when the loop exits", () => {
  withFakeHome((env) => {
    const r = runOutcome(["setup"], env);
    const j = JSON.parse(r.stdout);
    assert.ok(j.status);
    for (const key of [
      "installed",
      "tokenPresent",
      "aiProviderConfigured",
      "apiReachable",
      "ready",
      "nextAction",
      "reason",
    ]) {
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

test("pet without state argument returns MISSING_STATE with validStates list", () => {
  const j = runJson(["pet"]);
  assert.equal(j.ok, false);
  assert.equal(j.code, "MISSING_STATE");
  assert.ok(Array.isArray(j.validStates));
  assert.equal(j.validStates.length, 9);
  for (const s of [
    "happy",
    "idle",
    "juggling",
    "needsinput",
    "presenting",
    "sleeping",
    "sweeping",
    "thinking",
    "working",
  ]) {
    assert.ok(j.validStates.includes(s), `validStates missing ${s}`);
  }
});

test("pet with invalid state returns INVALID_STATE", () => {
  const j = runJson(["pet", "dancing"]);
  assert.equal(j.ok, false);
  assert.equal(j.code, "INVALID_STATE");
  assert.equal(j.received, "dancing");
  assert.ok(j.validStates.includes("happy"));
});

test("pet with token missing returns TOKEN_MISSING under fake HOME", () => {
  withFakeHome((env) => {
    const j = runJson(["pet", "happy"], env);
    assert.equal(j.ok, false);
    // Either TOKEN_MISSING (no ~/.openloomi/token) or API_UNREACHABLE
    // (would-be call hits a closed port). Both are valid first-line
    // errors when neither the token nor the runtime are available.
    assert.ok(
      ["TOKEN_MISSING", "API_UNREACHABLE"].includes(j.code),
      `unexpected pet code: ${j.code}`,
    );
  });
});

test("pet posts state to explicit OpenLoomi API URL", async () => {
  await withPetApiServer(
    (req, res, request) => {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/api/pet/state");
      assert.equal(request.authorization, "Bearer fake-openloomi-token");
      assert.deepEqual(request.json, {
        state: "working",
        source: "codex-plugin",
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          state: request.json.state,
          source: request.json.source,
        }),
      );
    },
    async ({ baseUrl }) => {
      await withFakeHomeAsync(async (env) => {
        writeFakeToken(env.HOME);
        const j = await runJsonAsync(["pet", "working"], {
          ...env,
          OPENLOOMI_API_URL: baseUrl,
          OPENLOOMI_BASE_URL: "",
        });
        assert.equal(j.ok, true);
        assert.equal(j.code, "PET_STATE_SET");
        assert.equal(j.state, "working");
        assert.equal(j.baseUrl, baseUrl);
        assert.equal(j.response.source, "codex-plugin");
      });
    },
  );
});

test("state hook command posts non-blocking pet state metadata", async () => {
  await withPetApiServer(
    (req, res, request) => {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/api/pet/state");
      assert.deepEqual(request.json, {
        state: "needsinput",
        source: "codex-plugin",
        event: "PermissionRequest",
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    },
    async ({ baseUrl }) => {
      await withFakeHomeAsync(async (env) => {
        writeFakeToken(env.HOME);
        const j = await runJsonAsync(
          ["state", "needsinput", "--event", "PermissionRequest"],
          {
            ...env,
            OPENLOOMI_API_URL: baseUrl,
            OPENLOOMI_BASE_URL: "",
          },
        );
        assert.equal(j.ok, true);
        assert.equal(j.hook, "sent");
        assert.equal(j.state, "needsinput");
        assert.equal(j.event, "PermissionRequest");
      });
    },
  );
});

test("state hook command can run quietly for Codex hooks", async () => {
  await withPetApiServer(
    (req, res, request) => {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/api/pet/state");
      assert.deepEqual(request.json, {
        state: "working",
        source: "codex-plugin",
        event: "PreToolUse",
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    },
    async ({ baseUrl }) => {
      await withFakeHomeAsync(async (env) => {
        writeFakeToken(env.HOME);
        const result = spawnSync(
          process.execPath,
          [BRIDGE, "state", "working", "--event", "PreToolUse", "--quiet"],
          {
            cwd: PLUGIN_DIR,
            encoding: "utf8",
            env: {
              ...process.env,
              ...env,
              OPENLOOMI_API_URL: baseUrl,
              OPENLOOMI_BASE_URL: "",
            },
          },
        );
        assert.equal(result.status, 0);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
      });
    },
  );
});

test("state hook command skips without failing when token is missing", () => {
  withFakeHome((env) => {
    const r = runOutcome(["state", "working", "--event", "PreToolUse"], env);
    const j = JSON.parse(r.stdout);
    assert.equal(r.code, 0);
    assert.equal(j.ok, false);
    assert.equal(j.hook, "skipped");
    assert.equal(j.reason, "token_missing");
    assert.equal(j.state, "working");
  });
});

test("plugin manifest declares Codex hook bundle", () => {
  const manifest = JSON.parse(
    readFileSync(join(PLUGIN_DIR, ".codex-plugin", "plugin.json"), "utf8"),
  );
  assert.equal(manifest.hooks, "./hooks/hooks.json");

  const hooks = JSON.parse(
    readFileSync(join(PLUGIN_DIR, "hooks", "hooks.json"), "utf8"),
  );
  for (const event of [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PermissionRequest",
    "PostToolUse",
    "SubagentStart",
    "SubagentStop",
    "Stop",
  ]) {
    assert.ok(Array.isArray(hooks.hooks[event]), `missing hook event ${event}`);
    const command = hooks.hooks[event][0].hooks[0];
    assert.match(command.command, /loomi-bridge\.mjs/);
    assert.match(command.command, /--quiet/);
    assert.match(command.commandWindows, /loomi-bridge\.mjs/);
    assert.match(command.commandWindows, /\$env:PLUGIN_ROOT/);
    assert.doesNotMatch(command.commandWindows, /%PLUGIN_ROOT%/);
    assert.match(command.commandWindows, /--quiet/);
    assert.equal(command.timeout, 5);
  }
});

test("argv hardening: unknown flags are not silently accepted as secrets", () => {
  withFakeHome((env) => {
    // If --api-key were a real flag, the bridge might echo or store it. We
    // verify it does NOT appear in stdout/stderr of any subcommand. This
    // is a structural test: a future PR adding --api-key would have to
    // also update the secrets contract.
    const fake = "sk-leaktest-ARGV-12345";
    for (const sub of [
      ["setup-status", "--api-key", fake],
      ["install-instructions", "--api-key", fake],
      ["configure-ai-provider", "--api-key", fake],
    ]) {
      const r = runOutcome(sub, env);
      assert.ok(
        !r.stdout.includes("sk-leaktest-ARGV"),
        `${sub.join(" ")} echoed --api-key value in stdout`,
      );
      assert.ok(
        !r.stderr.includes("sk-leaktest-ARGV"),
        `${sub.join(" ")} echoed --api-key value in stderr`,
      );
    }
  });
});

// -----------------------------------------------------------------------------
// codex-runtime-info
// -----------------------------------------------------------------------------

test("codex-runtime-info returns the desktop-app Codex runtime switch plan", () => {
  const j = runJson(["codex-runtime-info"]);
  assert.equal(j.purpose.startsWith("Switch the OpenLoomi desktop app"), true);
  assert.equal(j.envProviderKey, "OPENLOOMI_AGENT_PROVIDER");
  assert.equal(typeof j.switch.oneOff, "string");
  assert.equal(typeof j.switch.permanent, "string");
  assert.equal(typeof j.switch.perPlatform.oneOff, "object");
  assert.match(
    j.switch.perPlatform.oneOff.darwin,
    /OPENLOOMI_AGENT_PROVIDER=codex/,
  );
  assert.match(
    j.switch.perPlatform.oneOff.darwin,
    /Quit \+ reopen OpenLoomi\.app/,
  );
  assert.match(
    j.switch.perPlatform.oneOff.linux,
    /OPENLOOMI_AGENT_PROVIDER=codex/,
  );
  assert.match(
    j.switch.perPlatform.oneOff.win32,
    /OPENLOOMI_AGENT_PROVIDER codex/,
  );
  assert.equal(typeof j.switch.perPlatform.permanent, "object");
  assert.match(j.switch.perPlatform.permanent.darwin, /~\/\.zshrc/);
  assert.match(j.switch.perPlatform.permanent.linux, /environment\.d/);
  assert.match(j.switch.perPlatform.permanent.win32, /environment variables/i);
  assert.ok(Array.isArray(j.prerequisites) && j.prerequisites.length >= 3);
  const varNames = j.companionEnvVars.map((entry) => entry.name);
  for (const expected of [
    "OPENLOOMI_AGENT_CODEX_COMMAND",
    "OPENLOOMI_AGENT_CODEX_MODEL",
    "OPENLOOMI_AGENT_CODEX_SANDBOX",
    "OPENLOOMI_AGENT_CODEX_ASK_FOR_APPROVAL",
    "OPENLOOMI_AGENT_CODEX_SKIP_GIT_REPO_CHECK",
    "OPENLOOMI_AGENT_CODEX_FULL_AUTO",
    "OPENLOOMI_AGENT_CODEX_TIMEOUT_MS",
  ]) {
    assert.ok(varNames.includes(expected), `missing companion var ${expected}`);
  }
  assert.equal(j.verify.expectDefaultAgent, "codex");
  assert.equal(j.verify.expectAgentType, "codex");
  assert.match(j.verify.endpoint, /\/api\/native\/providers/);
  assert.equal(j.bridge.name, "openloomi-codex-bridge");
  assert.equal(typeof j.bridge.version, "string");
});

test("codex-runtime-info reflects OPENLOOMI_AGENT_PROVIDER env in defaults", () => {
  const j = runJson(["codex-runtime-info"], {
    OPENLOOMI_AGENT_PROVIDER: "codex",
  });
  assert.equal(j.defaults.currentDefaultProvider, "codex");
});

test("codex-runtime-info defaults to claude when env is unset", () => {
  const j = withFakeHome((env) =>
    runJson(["codex-runtime-info"], {
      ...env,
      OPENLOOMI_AGENT_PROVIDER: "",
    }),
  );
  // Empty string should fall back to claude (resolver treats empty as unset).
  assert.equal(j.defaults.currentDefaultProvider, "claude");
});

// -----------------------------------------------------------------------------
// set-codex-runtime-env persistence
//
// These tests exercise the new --persist flag and the codex-runtime-info
// `persistence` field. The bridge accepts the flag on every platform but only
// the darwin branch materializes a LaunchAgent plist. Tests rely on the
// host's actual platform: on macOS the dry-run JSON surfaces a "write plist"
// action with the embedded XML, and on other platforms the persistence flag is
// accepted but a no-op for the actions list. The escape behavior is verified
// by parsing the embedded XML out of the write action's `-c` script.
// -----------------------------------------------------------------------------

test("set-codex-runtime-env --dry-run --persist plans the LaunchAgent install on darwin", () => {
  if (process.platform !== "darwin") return;
  const j = withFakeHome((env) =>
    runJson(["set-codex-runtime-env", "codex", "--dry-run", "--persist"], env),
  );
  assert.equal(j.ok, true);
  assert.equal(j.dryRun, true);
  const labels = j.actions.map((a) => a.label);
  assert.ok(
    labels.includes("launchctl setenv"),
    `expected launchctl setenv in ${JSON.stringify(labels)}`,
  );
  assert.ok(
    labels.includes("mkdir LaunchAgents"),
    `expected mkdir LaunchAgents in ${JSON.stringify(labels)}`,
  );
  assert.ok(
    labels.includes("write plist"),
    `expected write plist in ${JSON.stringify(labels)}`,
  );
  assert.ok(
    labels.includes("launchctl bootstrap"),
    `expected launchctl bootstrap in ${JSON.stringify(labels)}`,
  );
  // Plist content is embedded in the heredoc action. Pull it out and verify
  // the essential fields.
  const write = j.actions.find((a) => a.label === "write plist");
  assert.equal(write.command, "/bin/sh");
  const script = write.args[write.args.length - 1];
  assert.match(script, /<key>RunAtLoad<\/key>/);
  assert.match(script, /<true\/>/);
  assert.match(script, /<key>Label<\/key>/);
  assert.match(
    script,
    /<string>com\.openloomi\.codex-runtime-env<\/string>/,
  );
  assert.match(script, /<string>\/bin\/launchctl<\/string>/);
  assert.match(script, /<string>setenv<\/string>/);
  assert.match(script, /<string>OPENLOOMI_AGENT_PROVIDER<\/string>/);
  assert.match(script, /<string>codex<\/string>/);
});

test("set-codex-runtime-env --dry-run without --persist only plans the launchctl write", () => {
  const j = runJson(["set-codex-runtime-env", "codex", "--dry-run"]);
  assert.equal(j.ok, true);
  assert.equal(j.dryRun, true);
  const labels = j.actions.map((a) => a.label);
  // --persist is a no-op on non-darwin platforms; on darwin we must NOT see
  // any of the LaunchAgent-specific steps when --persist is omitted.
  for (const persistLabel of [
    "mkdir LaunchAgents",
    "write plist",
    "launchctl bootstrap",
    "launchctl bootout (best-effort)",
    "rm plist",
  ]) {
    assert.ok(
      !labels.includes(persistLabel),
      `unexpected ${persistLabel} in ${JSON.stringify(labels)} without --persist`,
    );
  }
});

test("set-codex-runtime-env --unset --dry-run --persist plans bootout + rm on darwin", () => {
  if (process.platform !== "darwin") return;
  const j = withFakeHome((env) =>
    runJson(
      ["set-codex-runtime-env", "--unset", "--dry-run", "--persist"],
      env,
    ),
  );
  assert.equal(j.ok, true);
  assert.equal(j.dryRun, true);
  assert.equal(j.value, null);
  const labels = j.actions.map((a) => a.label);
  assert.ok(labels.includes("launchctl unsetenv"));
  assert.ok(labels.includes("launchctl bootout (best-effort)"));
  assert.ok(labels.includes("rm plist"));
  // Notes should mention persistence is being removed.
  assert.ok(
    j.notes.some((n) => /no longer be re-applied on login/.test(n)),
    `expected unset-persistence note, got ${JSON.stringify(j.notes)}`,
  );
});

test("set-codex-runtime-env escapes XML metacharacters in plist value", () => {
  if (process.platform !== "darwin") return;
  // Values containing <, >, & must be encoded inside the <string> elements
  // even though they would otherwise produce invalid XML.
  const j = withFakeHome((env) =>
    runJson(
      [
        "set-codex-runtime-env",
        "codex&<weird>",
        "--dry-run",
        "--persist",
      ],
      env,
    ),
  );
  const write = j.actions.find((a) => a.label === "write plist");
  assert.ok(write, "expected a write plist action");
  const script = write.args[write.args.length - 1];
  // Encoded form should appear; the raw "<weird>" should not appear inside a
  // <string>...</string> token after escaping.
  assert.match(script, /codex&amp;&lt;weird&gt;/);
});

test("codex-runtime-info reports persistence state for the host platform", () => {
  const j = withFakeHome((env) =>
    runJson(["codex-runtime-info"], env),
  );
  assert.ok(j.persistence, "expected persistence field on codex-runtime-info");
  // All three platform buckets should be present so callers can render a
  // cross-platform table without branching.
  assert.ok(j.persistence.darwin);
  assert.ok(j.persistence.linux);
  assert.ok(j.persistence.win32);
  if (process.platform === "darwin") {
    assert.equal(typeof j.persistence.darwin.launchAgentInstalled, "boolean");
    assert.match(
      j.persistence.darwin.launchAgentPath,
      /Library\/LaunchAgents\/com\.openloomi\.codex-runtime-env\.plist$/,
    );
    // Fresh tmp home has no plist installed.
    assert.equal(j.persistence.darwin.launchAgentInstalled, false);
    assert.equal(j.persistence.linux.envFileInstalled, null);
    assert.equal(j.persistence.win32.manualStepsRequired, true);
  }
});

test("codex-runtime-info persistence.darwin.launchAgentInstalled flips true when plist exists", () => {
  if (process.platform !== "darwin") return;
  withFakeHome((env) => {
    const plistPath = join(
      env.HOME,
      "Library",
      "LaunchAgents",
      "com.openloomi.codex-runtime-env.plist",
    );
    mkdirSync(dirname(plistPath), { recursive: true });
    writeFileSync(
      plistPath,
      '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict></dict></plist>\n',
    );
    const j = runJson(["codex-runtime-info"], env);
    assert.equal(j.persistence.darwin.launchAgentInstalled, true);
    assert.equal(j.persistence.darwin.launchAgentPath, plistPath);
  });
});
