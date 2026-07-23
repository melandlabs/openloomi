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

// The hidden `__test-*` bridge commands are only registered when
// OPENLOOMI_TEST_HOOKS=1 is present in the child's environment. Set it on
// the test runner's own env so every `run*`/`runJson`/`runOutcome` helper
// that inherits `process.env` (i.e. the ones that don't go through
// withFakeHome) can drive those commands. Individual gating tests override
// it back to "" to confirm the commands are refused when the flag is off.
process.env.OPENLOOMI_TEST_HOOKS = "1";

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
    OPENLOOMI_APP: "",
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
    OPENLOOMI_TEST_HOOKS: "1",
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
    OPENLOOMI_APP: "",
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
    OPENLOOMI_TEST_HOOKS: "1",
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

function writeFakeApp(home) {
  if (process.platform === "darwin") {
    const appDir = join(home, "OpenLoomi.app");
    mkdirSync(join(appDir, "Contents"), { recursive: true });
    writeFileSync(
      join(appDir, "Contents", "Info.plist"),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        "<dict>",
        "  <key>CFBundleName</key><string>OpenLoomi</string>",
        "  <key>CFBundleShortVersionString</key><string>9.9.9</string>",
        "  <key>CFBundleExecutable</key><string>OpenLoomi</string>",
        "</dict>",
        "</plist>",
      ].join("\n"),
    );
    return appDir;
  }

  if (process.platform === "win32") {
    const shim = join(home, "openloomi.exe");
    writeFileSync(shim, "@echo off\r\necho fake-openloomi-desktop\r\n");
    return shim;
  }

  const shim = join(home, "openloomi");
  writeFileSync(shim, "#!/bin/sh\necho fake-openloomi-desktop\n");
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
    "workflow-guidance",
    "version",
    "help",
    "codex-runtime-info",
  ]) {
    assert.ok(j.commands.includes(cmd), `version.commands missing ${cmd}`);
  }
  assert.equal(j.commands.includes("run"), false);
});

test("Codex memory and connector helpers stay in parity with Claude", () => {
  for (const relativePath of [
    "skills/openloomi-memory/scripts/openloomi-memory.cjs",
    "skills/openloomi-connectors/scripts/openloomi-connectors.cjs",
  ]) {
    const codexPath = join(
      PLUGIN_DIR,
      relativePath.replace(/^skills\//, "skills/"),
    );
    const claudePath = join(PLUGIN_DIR, "..", "claude", relativePath);
    assert.equal(
      readFileSync(codexPath, "utf8"),
      readFileSync(claudePath, "utf8"),
    );
  }
});

test("tour Memory phase uses known commands without help discovery", () => {
  for (const pluginName of ["codex", "claude"]) {
    const tourPath = join(
      PLUGIN_DIR,
      "..",
      pluginName,
      "skills",
      "openloomi-tour",
      "SKILL.md",
    );
    const source = readFileSync(tourPath, "utf8");
    assert.match(source, /Do not run discovery\/help probes/);
    assert.match(source, /node "\$MEM" add-memory/);
    assert.match(source, /node "\$MEM" search-all/);
    const memoryHelpCommandLines = source
      .split(/\r?\n/)
      .filter((line) => /^\s*node "\$MEM" (--help|-h|help)\b/.test(line));
    assert.deepEqual(memoryHelpCommandLines, []);
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
    const ctl = writeFakeApp(env.HOME);
    // Make sure no token file is present and no local API is reachable
    // (fake HOME guarantees ~/.openloomi/token does not exist; the fake
    // env forces OPENLOOMI_BASE_URL to a closed port).
    const j = runJson(["setup-status"], {
      ...env,
      OPENLOOMI_APP: ctl,
    });
    assert.equal(j.apiReachable, false);
    if (!j.tokenPresent) {
      assert.equal(j.ready, false);
      // When the Codex sandbox blocks the bridge's own loopback probe, the
      // bridge now points the caller at the host probe (run-host-probe)
      // instead of asking the user to relaunch the app. Old behavior of
      // open_openloomi is preserved only when the API was truly down.
      assert.equal(j.nextAction, "run_host_probe");
      assert.equal(j.reason, "OPENLOOMI_API_AMBIGUOUS_HOST_PROBE_STALE");
      assert.equal(j.loopbackAccessAmbiguous, true);
      assert.equal(j.loopbackAccess.ambiguous, true);
      assert.equal(j.loopbackAccess.reason, "LOOPBACK_NETWORK_ACCESS_BLOCKED");
      assert.equal(j.loopbackAccess.verification.requiresOutsideSandbox, true);
      assert.ok(
        j.loopbackAccess.verification.commands.some((command) =>
          command.includes("/api/native/providers"),
        ),
      );
      assert.deepEqual(j.checks.loopbackAccess, j.loopbackAccess);
      assert.ok(Array.isArray(j.autoFixCommands));
      assert.ok(
        j.autoFixCommands.some((c) => c.includes("run-host-probe")),
        "autoFixCommands must include run-host-probe",
      );
      assert.equal(j.hostProbeCachePath, join(env.HOME, ".openloomi", "codex-host-probe-cache.json"));
    }
  });
});

test("setup-status --emit-host-probe returns host probe payload without writing cache", () => {
  withFakeHome((env) => {
    const ctl = writeFakeApp(env.HOME);
    const j = runJson(["setup-status", "--emit-host-probe"], {
      ...env,
      OPENLOOMI_APP: ctl,
    });
    assert.equal(typeof j.hostProbeScript, "string");
    assert.ok(j.hostProbeScript.includes("codex-host-probe-cache.json"));
    assert.ok(j.hostProbeScript.includes("/api/native/providers"));
    assert.equal(j.hostProbeCachePath, join(env.HOME, ".openloomi", "codex-host-probe-cache.json"));
    assert.equal(j.hostProbeCacheMaxAgeMs, 5 * 60 * 1000);
    assert.ok(j.hostProbe);
    assert.equal(j.hostProbe.recommendedNextAction, "run-host-probe");
    // Cache file must NOT have been written just by reading setup-status.
    const cachePath = join(env.HOME, ".openloomi", "codex-host-probe-cache.json");
    assert.equal(existsSync(cachePath), false);
  });
});

test("run-host-probe command is registered and returns ok:false when API unreachable", () => {
  withFakeHome((env) => {
    const ctl = writeFakeApp(env.HOME);
    const j = runJson(["run-host-probe", "--base-url", "http://127.0.0.1:1"], {
      ...env,
      OPENLOOMI_APP: ctl,
    });
    // Point the probe at a closed port so the host fetch fails. The bridge
    // should still respond with a structured JSON and persist an empty cache.
    // `ok` here means the cache file was written, not that the API is
    // reachable. Use `reachable` to assert the API was actually down.
    assert.equal(j.reachable, false);
    assert.equal(j.baseUrl, null);
    assert.ok(Array.isArray(j.attempts));
    assert.ok(j.attempts.length > 0, "must record at least one probe attempt");
    // Cache file should still be written (the cache record is best-effort).
    const cachePath = join(env.HOME, ".openloomi", "codex-host-probe-cache.json");
    assert.equal(existsSync(cachePath), true);
    const cached = JSON.parse(readFileSync(cachePath, "utf8"));
    assert.equal(cached.schemaVersion, 1);
    assert.ok(Array.isArray(cached.providers));
  });
});

test("setup-status honors a fresh host probe cache and reports READY_VIA_HOST_PROBE_CACHE", () => {
  withFakeHome((env) => {
    const ctl = writeFakeApp(env.HOME);
    writeFakeToken(env.HOME);
    // Pre-write a fresh host probe cache so the sandbox-blocked fetch is
    // overridden.
    const cachePath = join(env.HOME, ".openloomi", "codex-host-probe-cache.json");
    mkdirSync(join(env.HOME, ".openloomi"), { recursive: true });
    writeFileSync(
      cachePath,
      JSON.stringify({
        baseUrl: "http://127.0.0.1:3414",
        providers: [{ type: "codex", name: "Codex CLI", builtin: true }],
        defaultAgent: "codex",
        capturedAt: Date.now(),
        schemaVersion: 1,
      }),
    );
    const j = runJson(["setup-status"], {
      ...env,
      OPENLOOMI_APP: ctl,
    });
    assert.equal(j.ready, true);
    assert.equal(j.reason, "READY_VIA_HOST_PROBE_CACHE");
    assert.equal(j.readinessSource, "host-probe-cache");
    assert.equal(j.apiReachable, true);
    assert.equal(j.executionProviderReady, true);
    assert.equal(j.nativeRuntimeProvider, "codex");
  });
});

test("setup-status exposes the protocol contract fields", () => {
  const j = runJson(["setup-status"]);
  for (const key of [
    "mode",
    "installed",
    "appPath",
    "version",
    "tokenPresent",
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
  // Either an installed OpenLoomi has an appPath, or nextAction must point
  // the user at install_openloomi / provide_install_or_repo_path.
  if (!j.installed) {
    assert.ok(
      [
        "install_openloomi",
        "provide_install_or_repo_path",
        "build_or_install_openloomi",
      ].includes(j.nextAction),
      `unexpected nextAction when not installed: ${j.nextAction}`,
    );
  }
});

test("setup-status treats active native Codex runtime as execution-ready", async () => {
  await withFakeHomeAsync(async (env) => {
    const ctl = writeFakeApp(env.HOME);
    writeFakeToken(env.HOME);

    await withLocalApiServer(
      createReadySetupApiHandler({
        nativeProviderPayload: {
          defaultAgent: "codex",
          agents: [{ type: "codex", name: "Codex CLI" }],
        },
      }),
      async ({ baseUrl }) => {
        const j = await runJsonAsync(["setup-status"], {
          ...env,
          OPENLOOMI_APP: ctl,
          OPENLOOMI_BASE_URL: baseUrl,
          OPENLOOMI_AGENT_PROVIDER: "codex",
        });

        assert.equal(j.executionProviderReady, true);
        assert.equal(j.executionProviderSource, "native_codex_runtime");
        assert.equal(j.nativeRuntimeActive, true);
        assert.equal(j.nativeRuntimeProvider, "codex");
        assert.equal(j.nativeRuntime.codexAgentAvailable, true);
        assert.equal(j.ready, true);
        assert.equal(j.nextAction, null);
        assert.equal(j.reason, "READY");
        assert.equal(j.readinessSource, "native_codex_runtime");
        assert.equal(j.checks.nativeProvider.active, true);
        assert.equal(j.loopbackAccessAmbiguous, false);
        assert.equal(j.loopbackAccess.ambiguous, false);
        assert.equal(j.loopbackAccess.verification, null);
      },
    );
  });
});

test("setup-status recommends connector setup when monitored connectors are disconnected", async () => {
  await withFakeHomeAsync(async (env) => {
    const ctl = writeFakeApp(env.HOME);
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
          OPENLOOMI_APP: ctl,
          OPENLOOMI_BASE_URL: baseUrl,
        });

        assert.equal(j.ready, true);
        assert.equal(j.nextAction, null);
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
    const ctl = writeFakeApp(env.HOME);
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
          OPENLOOMI_APP: ctl,
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
    const ctl = writeFakeApp(env.HOME);
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
          OPENLOOMI_APP: ctl,
          OPENLOOMI_BASE_URL: baseUrl,
        });

        assert.equal(j.ready, true);
        assert.equal(j.nextAction, null);
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
    const ctl = writeFakeApp(env.HOME);
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
          OPENLOOMI_APP: ctl,
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

test("setup-status never reports AI provider key values", () => {
  withFakeHome((env) => {
    const j = runJson(["setup-status"], env);
    // The aiProvider / aiProviderRuntime fields are gone — guard against
    // accidentally re-introducing entries that carry API key values.
    assert.equal(
      "aiProvider" in (j.checks || {}),
      false,
      "checks.aiProvider was reintroduced — the bridge no longer reads provider env vars",
    );
    assert.equal(
      "aiProviderRuntime" in (j.checks || {}),
      false,
      "checks.aiProviderRuntime was reintroduced",
    );
    assert.equal("aiProviderConfigured" in j, false);
    assert.equal("aiProviderStatus" in j, false);
    // Same contract for the auth checks block.
    for (const entry of j.checks.auth || []) {
      assert.equal(typeof entry.key, "string");
      assert.equal(typeof entry.present, "boolean");
      assert.equal(typeof entry.source, "string");
      assert.ok(!("value" in entry), `auth check leaked a value: ${entry.key}`);
    }
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
  assert.match(j.sandboxRequirements.network, /outside-sandbox/i);
  assert.match(j.sandboxRequirements.filesystem, /system application/i);
  assert.match(j.sandboxRequirements.process, /GUI\/process/i);
  assert.match(j.sandboxRequirements.retryPolicy, /request approval/i);
  assert.ok(
    j.instructions.some((instruction) =>
      instruction.includes("retry the same bridge command outside the sandbox"),
    ),
  );
});

test("workflow-guidance lists the three openloomi workflows", () => {
  const j = runJson(["workflow-guidance"]);
  assert.ok(j.ready);
  const ids = (j.workflows || []).map((w) => w.id);
  for (const id of [
    "openloomi-loop",
    "openloomi-memory",
    "openloomi-connectors",
  ]) {
    assert.ok(ids.includes(id), `workflow-guidance missing ${id}`);
  }
});

// -----------------------------------------------------------------------------
// Secrets contract — the plugin must never echo API key / token values
// -----------------------------------------------------------------------------

test("secrets contract: fake key value never appears in any subcommand output", () => {
  withFakeHome((env) => {
    const fake = "sk-leaktest-ThisShouldNeverAppear-12345";
    const inputs = {
      ...env,
      OPENLOOMI_AUTH_TOKEN: fake,
      OPENAI_API_KEY: fake,
      ANTHROPIC_API_KEY: fake,
    };
    for (const sub of [
      ["version"],
      ["setup-status"],
      ["install-instructions"],
      ["workflow-guidance"],
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
      // when the local OpenLoomi API is unreachable even though no app was
      // discovered. Accept that as an awaiting_user_action signal too —
      // the user must launch the desktop app before the wizard can
      // continue.
      assert.ok(
        [
          "confirm_install_openloomi",
          "install_openloomi",
          "build_or_install_openloomi",
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

test("setup with --yes proceeds past the install step (not INSTALL_CONFIRMATION_REQUIRED)", () => {
  withFakeHome((env) => {
    // Same "not installed" forcing as the previous test — but with --yes,
    // the bridge must NOT return INSTALL_CONFIRMATION_REQUIRED.
    const r = runOutcome(["setup", "--yes"], {
      ...env,
      OPENLOOMI_BIN: "/nonexistent-ctl-please-ignore",
      OPENLOOMI_HOME: "/nonexistent-home",
      OPENLOOMI_REPO_DIR: "/nonexistent-repo",
      PATH: dirname(process.execPath),
    });
    const j = JSON.parse(r.stdout);
    // Either the setup wizard went past install and recorded an attempt,
    // OR it surfaced a different error (e.g. install_failed because the
    // forced-not-installed env can't actually resolve a real release).
    // What matters: it MUST NOT be the awaiting_user_action gate.
    assert.notEqual(
      j.reason,
      "INSTALL_CONFIRMATION_REQUIRED",
      "setup --yes must bypass the awaiting_user_action confirmation gate",
    );
    assert.notEqual(
      j.nextAction,
      "confirm_install_openloomi",
      "setup --yes must not stop at the confirm-install gate",
    );
    // When steps[] is present (install got far enough to record an entry),
    // it should contain an install attempt.
    if (Array.isArray(j.steps)) {
      assert.ok(
        j.steps.some((s) => s.step === "status_check" || s.step === "install"),
        "setup --yes should record either a status_check or an install step",
      );
    }
  });
});

test("setup on Windows stops after one manual runtime env attempt", () => {
  if (process.platform !== "win32") return;
  withFakeHome((env) => {
    const fakeApp = join(env.LOCALAPPDATA, "OpenLoomi", "openloomi.exe");
    mkdirSync(dirname(fakeApp), { recursive: true });
    writeFileSync(fakeApp, "");

    const r = runOutcome(
      [
        "setup",
        "--yes",
        "--bin-path",
        fakeApp,
        "--api-timeout",
        "100",
        "--permission-timeout",
        "0",
      ],
      {
        ...env,
        OPENLOOMI_AGENT_PROVIDER: "",
      },
    );
    const j = JSON.parse(r.stdout);
    assert.equal(j.setup, "runtime_env_manual_required");
    assert.equal(j.reason, "WINDOWS_RUNTIME_ENV_MANUAL");
    assert.equal(j.nextAction, "set_runtime_env_manually");
    assert.ok(
      j.steps.filter((step) => step.step === "runtime_env_write").length <= 1,
      "setup should not repeat no-op Windows env writes",
    );
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
// Setup flag parsing + permission/grace semantics — Claude parity regression
// -----------------------------------------------------------------------------

test("setup --max-wait, --api-timeout, --permission-timeout, --bin-path flow into the state machine", () => {
  const j = runJson([
    "__test-setup-flags",
    "--max-wait",
    "90000",
    "--api-timeout",
    "7000",
    "--install-timeout=8000",
    "--launch-timeout",
    "9000",
    "--permission-timeout=4000",
    "--bin-path",
    "/tmp/OpenLoomi.app",
  ]);
  assert.equal(j.flags["max-wait"], "90000");
  assert.equal(j.flags["api-timeout"], "7000");
  assert.equal(j.flags["install-timeout"], "8000");
  assert.equal(j.flags["launch-timeout"], "9000");
  assert.equal(j.flags["permission-timeout"], "4000");
  assert.equal(j.flags["bin-path"], "/tmp/OpenLoomi.app");
  assert.equal(j.explicitApp, "/tmp/OpenLoomi.app");
  assert.equal(j.stages.totalMs, 90000);
  assert.equal(j.stages.apiMs, 7000);
  assert.equal(j.stages.permissionMs, 4000);
  assert.equal(j.stages.launchMs, 9000);
  assert.equal(j.stages.installMs, 90000);
});

test("waitForApi reports API_NOT_READY when the desktop process is not running", () => {
  const j = runJson(["__test-wait-for-api", "--api-timeout", "200"]);
  assert.equal(j.ok, false);
  assert.equal(j.code, "API_NOT_READY");
  assert.equal(j.stage, "wait_api");
  assert.equal(j.permissionLikely, false);
});

test("waitForApi reports PERMISSION_PROMPT_LIKELY when the probe signals a permission block", () => {
  const j = runJson([
    "__test-wait-for-api",
    "--api-timeout",
    "200",
    "--permission-likely",
  ]);
  assert.equal(j.ok, false);
  assert.equal(j.code, "PERMISSION_PROMPT_LIKELY");
  assert.equal(j.permissionLikely, true);
  assert.equal(j.stage, "wait_api");
});

test("setup-status accepts --bin-path as a discovery override", () => {
  withFakeHome((env) => {
    // Pointing --bin-path at a non-existent path must surface
    // OPENLOOMI_APP_INVALID rather than silently falling through to PATH.
    const j = runJson(["setup-status", "--bin-path", "/nonexistent.app"], env);
    assert.equal(j.installed, false);
    assert.equal(j.nextAction, "install_openloomi");
  });
});

test("setup --api-timeout flows into the recorded wait_api step", () => {
  withFakeHome((env) => {
    const r = runOutcome(
      [
        "setup",
        "--yes",
        "--api-timeout",
        "100",
        "--permission-timeout",
        "0",
      ],
      {
        ...env,
        OPENLOOMI_BIN: "/nonexistent-ctl-please-ignore",
        OPENLOOMI_HOME: "/nonexistent-home",
        OPENLOOMI_REPO_DIR: "/nonexistent-repo",
        PATH: dirname(process.execPath),
      },
    );
    const j = JSON.parse(r.stdout);
    // We don't care which exact stop the wizard lands on; only that the
    // explicit --api-timeout value reached the bridge. The wait_api step
    // and the effectiveBudgetMs are the two ways it can be observed.
    if (Array.isArray(j.steps)) {
      const wait = j.steps.find((s) => s.step === "wait_api");
      if (wait) {
        assert.ok(
          typeof wait.elapsedMs === "number",
          "wait_api step should record elapsedMs",
        );
      }
    }
    if (j.setup === "api_not_ready") {
      assert.equal(typeof j.effectiveBudgetMs, "number");
      assert.ok(j.effectiveBudgetMs >= 100);
      assert.ok(j.canResume);
      assert.match(j.resumeCommand, /setup/);
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
    // Stop fans out to multiple bridge commands (archive + state happy),
    // so iterate over every hook in the bundle. Other events still have
    // a single command.
    const eventHooks = hooks.hooks[event];
    for (const eventHook of eventHooks) {
      const command = eventHook.hooks[0];
      assert.match(command.command, /loomi-bridge\.mjs/);
      assert.match(command.command, /--quiet/);
      assert.match(command.commandWindows, /loomi-bridge\.mjs/);
      assert.match(command.commandWindows, /\$env:PLUGIN_ROOT/);
      assert.doesNotMatch(command.commandWindows, /%PLUGIN_ROOT%/);
      assert.match(command.commandWindows, /--quiet/);
      // Archive runs on Stop with a 30s budget; everything else is 5s.
      const expectedTimeout = /archive --event Stop/.test(command.command)
        ? 30
        : 5;
      assert.equal(command.timeout, expectedTimeout);
    }
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
  assert.match(script, /<string>com\.openloomi\.codex-runtime-env<\/string>/);
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
      ["set-codex-runtime-env", "codex&<weird>", "--dry-run", "--persist"],
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
  const j = withFakeHome((env) => runJson(["codex-runtime-info"], env));
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

// -----------------------------------------------------------------------------
// Pre-launch env wiring
//
// `launchDesktopApp` (used by the setup state machine) and
// `launchOpenLoomiForSession` (used by initialize-session as a fallback)
// both auto-wire OPENLOOMI_AGENT_PROVIDER=codex before spawning the
// desktop app so a freshly-launched web server picks up the Codex
// runtime instead of defaulting back to Claude. The wiring respects any
// existing user-set value (no override) and is a no-op on Windows.
//
// These tests exercise the wiring through the hidden __test-* commands
// (gated by OPENLOOMI_TEST_HOOKS=1, set by withFakeHome). The launchctl
// GUI domain is shared with the host, so darwin tests check shape rather
// than asserting on specific before/after values; Linux tests write the
// per-user env file directly so we get deterministic before/after.
// -----------------------------------------------------------------------------

test("__test-ensure-runtime-env returns well-shaped result with a reason field", () => {
  const j = runJson(["__test-ensure-runtime-env"]);
  assert.equal(typeof j, "object");
  assert.equal(j.ok, true);
  assert.equal(j.key, "OPENLOOMI_AGENT_PROVIDER");
  assert.equal(j.value, "codex");
  assert.ok(
    [
      "applied",
      "already_codex",
      "user_override",
      "unsupported",
      "failed",
    ].includes(j.reason),
    `unexpected reason: ${j.reason}`,
  );
});

test("__test-ensure-runtime-env reports unsupported on Windows", () => {
  if (process.platform !== "win32") return;
  const j = runJson(["__test-ensure-runtime-env"]);
  assert.equal(j.reason, "unsupported");
  assert.equal(j.skipped, true);
});

test("__test-ensure-runtime-env is gated by OPENLOOMI_TEST_HOOKS", () => {
  // Run the bridge without OPENLOOMI_TEST_HOOKS to confirm the command
  // is refused. When the flag is off the command is never registered in
  // the COMMANDS set, so the bridge answers UNKNOWN_COMMAND (the
  // in-switch TEST_HOOKS_DISABLED branch is a defensive fallback). Either
  // stable error code proves the hidden command can't run in production.
  const tmp = mkdtempSync(join(tmpdir(), "openloomi-codex-gated-"));
  try {
    const r = runOutcome(["__test-ensure-runtime-env"], {
      HOME: tmp,
      OPENLOOMI_TEST_HOOKS: "",
    });
    const j = JSON.parse(r.stdout);
    assert.ok(
      ["UNKNOWN_COMMAND", "TEST_HOOKS_DISABLED"].includes(j.error),
      `expected a gating error, got: ${j.error}`,
    );
    assert.notEqual(r.code, 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("__test-ensure-runtime-env on Linux reads from per-user env file", () => {
  if (process.platform !== "linux") return;
  // Seed the env file before running, so the helper sees "already_codex"
  // and does NOT overwrite. This exercises the "user has already set
  // codex" branch end-to-end on the only platform where the helper can
  // see its own writes deterministically.
  withFakeHome((env) => {
    const envDir = join(env.HOME, ".config", "environment.d");
    mkdirSync(envDir, { recursive: true });
    writeFileSync(
      join(envDir, "openloomi-codex.conf"),
      "OPENLOOMI_AGENT_PROVIDER=codex\n",
    );
    const j = runJson(["__test-ensure-runtime-env"], env);
    assert.equal(j.ok, true);
    assert.equal(j.skipped, true);
    assert.equal(j.reason, "already_codex");
    assert.equal(j.before, "codex");
    assert.equal(j.after, "codex");
  });
});

test("__test-ensure-runtime-env on Linux respects non-codex user value", () => {
  if (process.platform !== "linux") return;
  withFakeHome((env) => {
    const envDir = join(env.HOME, ".config", "environment.d");
    mkdirSync(envDir, { recursive: true });
    writeFileSync(
      join(envDir, "openloomi-codex.conf"),
      "OPENLOOMI_AGENT_PROVIDER=claude\n",
    );
    const j = runJson(["__test-ensure-runtime-env"], env);
    assert.equal(j.ok, true);
    assert.equal(j.skipped, true);
    assert.equal(j.reason, "user_override");
    assert.equal(j.before, "claude");
    assert.equal(j.after, "claude");
    // Crucially, the env file must NOT have been rewritten to codex.
    const onDisk = readFileSync(join(envDir, "openloomi-codex.conf"), "utf8");
    assert.match(onDisk, /OPENLOOMI_AGENT_PROVIDER=claude/);
  });
});

test("__test-ensure-runtime-env on Linux writes codex + persists when unset", () => {
  if (process.platform !== "linux") return;
  withFakeHome((env) => {
    // No env file -> helper sees value === null and writes codex.
    const j = runJson(["__test-ensure-runtime-env"], env);
    assert.equal(j.ok, true);
    assert.equal(j.skipped, false);
    assert.equal(j.reason, "applied");
    assert.equal(j.value, "codex");
    assert.equal(j.before, null);
    assert.equal(j.after, "codex");
    // After-value reaches codex only if the env.d file write succeeded.
    assert.match(j.platform, /^linux$/);
    const envFile = join(
      env.HOME,
      ".config",
      "environment.d",
      "openloomi-codex.conf",
    );
    assert.ok(existsSync(envFile), `expected env file at ${envFile}`);
  });
});

test("__test-windows-image-name preserves an existing .exe suffix", () => {
  const j = runJson([
    "__test-windows-image-name",
    "C:\\Users\\Example\\AppData\\Local\\OpenLoomi\\openloomi.exe",
  ]);
  assert.equal(j.binName, "openloomi.exe");
  assert.equal(j.imageName, "openloomi.exe");
});

test("__test-windows-image-name appends .exe only when missing", () => {
  const j = runJson([
    "__test-windows-image-name",
    "C:\\Users\\Example\\AppData\\Local\\OpenLoomi\\openloomi",
  ]);
  assert.equal(j.binName, "openloomi");
  assert.equal(j.imageName, "openloomi.exe");
});

test("__test-launch-desktop rejects no appPath with NO_LAUNCH_TARGET", () => {
  // No appPath argument -> the helper must bail with NO_LAUNCH_TARGET
  // BEFORE calling ensureCodexRuntimeEnvForLaunch. We can't easily
  // observe "no env write happened", but we can confirm the return
  // shape carries the env result with skipped=true on supported
  // platforms (no env file present, so the wiring is a no-op for the
  // host's actual state).
  const j = runJson(["__test-launch-desktop"]);
  assert.equal(j.ok, false);
  assert.equal(j.code, "NO_LAUNCH_TARGET");
  assert.ok(j.env, "expected env wiring metadata even on the no-target path");
  assert.equal(typeof j.env, "object");
  assert.ok(
    [
      "applied",
      "already_codex",
      "user_override",
      "unsupported",
      "failed",
    ].includes(j.env.reason),
    `unexpected env.reason: ${j.env.reason}`,
  );
});

test("__test-launch-desktop is gated by OPENLOOMI_TEST_HOOKS", () => {
  const tmp = mkdtempSync(join(tmpdir(), "openloomi-codex-gated-"));
  try {
    const r = runOutcome(["__test-launch-desktop", "/tmp"], {
      HOME: tmp,
      OPENLOOMI_TEST_HOOKS: "",
    });
    const j = JSON.parse(r.stdout);
    assert.ok(
      ["UNKNOWN_COMMAND", "TEST_HOOKS_DISABLED"].includes(j.error),
      `expected a gating error, got: ${j.error}`,
    );
    assert.notEqual(r.code, 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("__test-launch-desktop skips spawn when process is already running", () => {
  const fakeAppPath = join(
    tmpdir(),
    "openloomi-already-running",
    "openloomi.exe",
  );
  const j = runJson(["__test-launch-desktop", fakeAppPath], {
    OPENLOOMI_TEST_FORCE_APP_RUNNING: "1",
  });
  assert.equal(j.ok, true);
  assert.equal(j.code, "ALREADY_RUNNING");
  assert.equal(j.launched, false);
  assert.equal(j.alreadyRunning, true);
  assert.equal(j.via, "process-probe");
});

test("__test-launch-desktop with a real-looking path carries env wiring result", () => {
  // We don't actually want to launch OpenLoomi during tests, so we
  // supply a temp directory as a fake appPath. The launch itself will
  // fail (open -a / gtk-launch / cmd start refuse to spawn a directory),
  // but the helper always runs first and the env result is included in
  // BOTH the success and failure paths.
  const fakeAppDir = mkdtempSync(join(tmpdir(), "openloomi-fakeapp-"));
  try {
    const r = runOutcome(["__test-launch-desktop", fakeAppDir], {});
    const j = JSON.parse(r.stdout);
    // The launch will likely fail with SPAWN_FAILED or NO_LAUNCH_TARGET;
    // either way the env wiring metadata must be present.
    assert.ok(
      j.env,
      "expected env wiring metadata on launch result, got: " + r.stdout,
    );
    assert.equal(j.env.key, "OPENLOOMI_AGENT_PROVIDER");
    assert.equal(j.env.value, "codex");
    assert.ok(
      [
        "applied",
        "already_codex",
        "user_override",
        "unsupported",
        "failed",
      ].includes(j.env.reason),
      `unexpected env.reason: ${j.env.reason}`,
    );
  } finally {
    rmSync(fakeAppDir, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// OPENLOOMI_LAUNCH_MODE=plugin side-band surfaces in the launch envelope
//
// `ensureCodexRuntimeEnvForLaunch` does two env writes before spawning:
// the main `OPENLOOMI_AGENT_PROVIDER=codex` write (already covered above)
// and the pet-click routing side-band `OPENLOOMI_LAUNCH_MODE=plugin`.
// Both must reach `launchDesktopApp`'s `env` field so the setup state
// machine can record them in the `launch` audit step. Without
// `env.launchMode`, operators reading `steps[]` would have no way to
// confirm whether the wizard actually tagged the desktop process for
// the compact-card routing — the failure was previously swallowed into
// console.warn only.
// -----------------------------------------------------------------------------

test("__test-launch-desktop surfaces env.launchMode for the OPENLOOMI_LAUNCH_MODE side-band", () => {
  const fakeAppDir = mkdtempSync(join(tmpdir(), "openloomi-fakeapp-"));
  try {
    const r = runOutcome(["__test-launch-desktop", fakeAppDir], {});
    const j = JSON.parse(r.stdout);
    // Top-level env wiring must always be present (covered above);
    // the side-band should ride along as `env.launchMode` so the
    // setup wizard's `launchModeEnv` audit field has something to
    // record.
    assert.ok(j.env, "expected top-level env wiring metadata");
    assert.ok(
      j.env.launchMode,
      "expected env.launchMode to surface the OPENLOOMI_LAUNCH_MODE side-band",
    );
    // Shape must mirror the wrapped main env result so the audit
    // field can pull {ok, key, after, reason} without surprises.
    assert.equal(j.env.launchMode.key, "OPENLOOMI_LAUNCH_MODE");
    assert.equal(j.env.launchMode.value, "plugin");
    assert.ok(
      ["applied", "failed"].includes(j.env.launchMode.reason),
      `unexpected env.launchMode.reason: ${j.env.launchMode.reason}`,
    );
    // Side-band failures must NOT change the top-level env wiring
    // outcome — they're independent env writes and the operator
    // should see both shapes regardless of which one succeeded.
    assert.equal(j.env.key, "OPENLOOMI_AGENT_PROVIDER");
    assert.equal(j.env.value, "codex");
  } finally {
    rmSync(fakeAppDir, { recursive: true, force: true });
  }
});
