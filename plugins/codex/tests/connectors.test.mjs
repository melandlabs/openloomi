// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "../../..");
const CLIENT = join(
  REPO_ROOT,
  "plugins/codex/skills/openloomi-connectors/scripts/openloomi-connectors.cjs",
);
const MCP_SERVER = join(
  REPO_ROOT,
  "plugins/codex/scripts/openloomi-mcp-server.cjs",
);
const MCP_CONFIG = join(REPO_ROOT, "plugins/codex/.mcp.json");
const PLUGIN_MANIFEST = join(
  REPO_ROOT,
  "plugins/codex/.codex-plugin/plugin.json",
);
const CODEX_CONNECTOR_SKILL = join(
  REPO_ROOT,
  "plugins/codex/skills/openloomi-connectors/SKILL.md",
);
const CONNECTOR_COPIES = [
  join(
    REPO_ROOT,
    "skills/openloomi-connectors/scripts/openloomi-connectors.cjs",
  ),
  join(
    REPO_ROOT,
    "plugins/claude/skills/openloomi-connectors/scripts/openloomi-connectors.cjs",
  ),
  CLIENT,
];
const SECRET = "connector-test-secret-that-must-never-leak";

function testEnv(home, extra = {}) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    OPENLOOMI_API_URL: "",
    OPENLOOMI_BASE_URL: "",
    OPENLOOMI_API_TIMEOUT_MS: "250",
    OPENLOOMI_API_PROBE_TIMEOUT_MS: "100",
    CODEX_SANDBOX_NETWORK_DISABLED: "",
    ...extra,
  };
}

function makeHome(token = SECRET) {
  const home = mkdtempSync(join(tmpdir(), "openloomi-connectors-test-"));
  const tokenDir = join(home, ".openloomi");
  mkdirSync(tokenDir, { recursive: true });
  writeFileSync(join(tokenDir, "token"), Buffer.from(token).toString("base64"));
  return home;
}

async function runClient(args, env) {
  try {
    const result = await execFileAsync(process.execPath, [CLIENT, ...args], {
      env,
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: error.code,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

function jsonOutput(result) {
  const output =
    result.code === 0 ? result.stdout : result.stderr || result.stdout;
  assert.notEqual(output.trim(), "", "connector CLI returned no JSON");
  return JSON.parse(output);
}

function readBody(request) {
  return new Promise((resolveBody) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolveBody(body));
  });
}

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function sendProviderIdentity(response) {
  sendJson(response, 200, {
    agents: [{ id: "codex", type: "codex" }],
    defaultAgent: "codex",
  });
}

async function startServer(handler, port = 0) {
  const server = createServer(handler);
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

async function withApi(handler, callback) {
  const home = makeHome();
  const api = await startServer(handler);
  try {
    return await callback({
      home,
      url: api.url,
      env: testEnv(home, { OPENLOOMI_API_URL: api.url }),
    });
  } finally {
    await api.close();
    rmSync(home, { recursive: true, force: true });
  }
}

test("all three packaged connector clients stay byte-for-byte identical", () => {
  const [canonical, ...copies] = CONNECTOR_COPIES.map((file) =>
    readFileSync(file, "utf8"),
  );
  for (let index = 0; index < copies.length; index += 1) {
    assert.equal(
      copies[index],
      canonical,
      `${CONNECTOR_COPIES[index + 1]} drifted from ${CONNECTOR_COPIES[0]}`,
    );
  }
});

test("an explicit loopback URL is probed without credentials before Bearer auth", async () => {
  const requests = [];
  await withApi(
    async (request, response) => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
      });
      if (requests.length === 1) {
        sendProviderIdentity(response);
      } else {
        sendJson(response, 200, { accounts: [] });
      }
    },
    async ({ env }) => {
      const result = await runClient(["list-accounts"], env);
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(jsonOutput(result), { accounts: [], total: 0 });
    },
  );

  assert.ok(requests.length >= 2, JSON.stringify(requests));
  assert.equal(requests[0].authorization, undefined);
  assert.equal(requests.at(-1).url, "/api/integrations/accounts");
  assert.equal(requests.at(-1).authorization, `Bearer ${SECRET}`);
});

test("a missing token fails before any authenticated API request", async () => {
  let requestCount = 0;
  const api = await startServer((_request, response) => {
    requestCount += 1;
    sendProviderIdentity(response);
  });
  const home = mkdtempSync(join(tmpdir(), "openloomi-connectors-no-token-"));
  try {
    const result = await runClient(
      ["list-accounts"],
      testEnv(home, { OPENLOOMI_API_URL: api.url }),
    );
    assert.notEqual(result.code, 0);
    assert.equal(jsonOutput(result).error.code, "AUTH_TOKEN_MISSING");
    assert.equal(requestCount, 0);
  } finally {
    await api.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("an invalid encoded token fails safely without network or token disclosure", async () => {
  const home = makeHome();
  const invalidToken = "not-valid-base64!";
  writeFileSync(join(home, ".openloomi", "token"), invalidToken);
  try {
    const result = await runClient(["list-accounts"], testEnv(home));
    assert.notEqual(result.code, 0);
    assert.equal(jsonOutput(result).error.code, "AUTH_TOKEN_INVALID");
    assert.ok(!`${result.stdout}${result.stderr}`.includes(invalidToken));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("list-accounts redacts credentials and sensitive account fields without leaking the token", async () => {
  await withApi(
    (request, response) => {
      if (!request.headers.authorization) {
        sendProviderIdentity(response);
        return;
      }
      sendJson(response, 200, {
        accounts: [
          {
            id: "account-1",
            platform: "telegram",
            displayName: "Safe display name",
            status: "active",
            createdAt: "2026-01-01T00:00:00.000Z",
            botId: "bot-1",
            externalId: "private@example.test",
            credentials: { password: "account-password" },
            accessToken: "account-access-token",
            refreshToken: "account-refresh-token",
            metadata: { apiSecret: "metadata-secret" },
          },
        ],
      });
    },
    async ({ env }) => {
      const result = await runClient(["list-accounts"], env);
      assert.equal(result.code, 0, result.stderr);
      const output = `${result.stdout}\n${result.stderr}`;
      for (const forbidden of [
        SECRET,
        "private@example.test",
        "account-password",
        "account-access-token",
        "account-refresh-token",
        "metadata-secret",
      ]) {
        assert.ok(!output.includes(forbidden), `leaked ${forbidden}`);
      }
      const parsed = jsonOutput(result);
      assert.deepEqual(parsed.accounts, [
        {
          id: "account-1",
          platform: "telegram",
          displayName: "Safe display name",
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
          botId: "bot-1",
        },
      ]);
    },
  );
});

test("status filters accounts and exposes only its public account projection", async () => {
  const seen = [];
  await withApi(
    (request, response) => {
      if (!request.headers.authorization) return sendProviderIdentity(response);
      seen.push({ method: request.method, url: request.url });
      sendJson(response, 200, {
        accounts: [
          {
            id: "tg-1",
            platform: "telegram",
            displayName: "Telegram",
            status: "active",
            createdAt: "2026-01-01T00:00:00Z",
            botId: "bot-tg",
            credentials: { token: "hidden" },
          },
          {
            id: "wa-1",
            platform: "whatsapp",
            credentials: { token: "hidden-2" },
          },
        ],
      });
    },
    async ({ env }) => {
      const result = await runClient(["status", "tg"], env);
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(jsonOutput(result), {
        platform: "telegram",
        connected: true,
        accounts: [
          {
            id: "tg-1",
            displayName: "Telegram",
            status: "active",
            createdAt: "2026-01-01T00:00:00Z",
            botId: "bot-tg",
          },
        ],
      });
      assert.ok(!result.stdout.includes("hidden"));
    },
  );
  assert.deepEqual(seen, [
    { method: "GET", url: "/api/integrations/accounts" },
  ]);
});

test("status does not call an expired account connected", async () => {
  await withApi(
    (request, response) => {
      if (!request.headers.authorization) return sendProviderIdentity(response);
      sendJson(response, 200, {
        accounts: [
          { id: "tg-expired", platform: "telegram", status: "expired" },
        ],
      });
    },
    async ({ env }) => {
      const result = await runClient(["status", "telegram"], env);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(jsonOutput(result).connected, false);
    },
  );
});

test("query-contacts sends the encoded GET path", async () => {
  const seen = [];
  await withApi(
    (request, response) => {
      if (!request.headers.authorization) return sendProviderIdentity(response);
      seen.push({ method: request.method, url: request.url });
      sendJson(response, 200, { contacts: [], success: true });
    },
    async ({ env }) => {
      const result = await runClient(
        ["query-contacts", "--name=Jane Doe/+", "--page=2", "--pageSize=25"],
        env,
      );
      assert.equal(result.code, 0, result.stderr);
    },
  );
  assert.deepEqual(seen, [
    {
      method: "GET",
      url: "/api/contacts?page=2&pageSize=25&name=Jane+Doe%2F%2B",
    },
  ]);
});

test("send-reply sends the documented POST body", async () => {
  const seen = [];
  await withApi(
    async (request, response) => {
      if (!request.headers.authorization) return sendProviderIdentity(response);
      seen.push({
        method: request.method,
        url: request.url,
        body: JSON.parse(await readBody(request)),
      });
      sendJson(response, 200, { success: true, messageId: "message-1" });
    },
    async ({ env }) => {
      const result = await runClient(
        [
          "send-reply",
          "--botId=bot-1",
          "--recipients=alice,bob",
          "--message=Hello there",
          "--confirmed=true",
          "--subject=Subject",
          "--cc=carol",
          "--bcc=dave,erin",
        ],
        env,
      );
      assert.equal(result.code, 0, result.stderr);
    },
  );
  assert.deepEqual(seen, [
    {
      method: "POST",
      url: "/api/messages",
      body: {
        botId: "bot-1",
        recipients: ["alice", "bob"],
        message: "Hello there",
        subject: "Subject",
        cc: ["carol"],
        bcc: ["dave", "erin"],
      },
    },
  ]);
});

test("disconnect sends DELETE to the encoded account path", async () => {
  const seen = [];
  await withApi(
    (request, response) => {
      if (!request.headers.authorization) return sendProviderIdentity(response);
      seen.push({ method: request.method, url: request.url });
      sendJson(response, 200, { success: true });
    },
    async ({ env }) => {
      const result = await runClient(
        ["disconnect", "account:one", "--confirmed=true"],
        env,
      );
      assert.equal(result.code, 0, result.stderr);
    },
  );
  assert.deepEqual(seen, [
    { method: "DELETE", url: "/api/integrations/account%3Aone" },
  ]);
});

test("HTTP 200 operation failures are structured CLI failures without secret leakage", async () => {
  await withApi(
    (request, response) => {
      if (!request.headers.authorization) return sendProviderIdentity(response);
      sendJson(response, 200, {
        success: false,
        error: `foreign connector detail: ${SECRET}`,
      });
    },
    async ({ env }) => {
      const result = await runClient(
        [
          "send-reply",
          "--botId=bot-1",
          "--recipients=alice",
          "--message=hello",
          "--confirmed=true",
        ],
        env,
      );
      assert.notEqual(result.code, 0);
      assert.equal(jsonOutput(result).error.code, "API_OPERATION_FAILED");
      assert.ok(!`${result.stdout}${result.stderr}`.includes(SECRET));
    },
  );
});

for (const [name, body] of [
  ["missing success", {}],
  ["non-boolean success", { success: "true" }],
]) {
  test(`HTTP 200 ${name} mutation responses are rejected by the CLI`, async () => {
    await withApi(
      (request, response) => {
        if (!request.headers.authorization)
          return sendProviderIdentity(response);
        sendJson(response, 200, body);
      },
      async ({ env }) => {
        const result = await runClient(
          ["disconnect", "account-1", "--confirmed=true"],
          env,
        );
        assert.notEqual(result.code, 0);
        assert.equal(jsonOutput(result).error.code, "INVALID_API_RESPONSE");
      },
    );
  });
}

test("CLI mutations require an explicit confirmation flag", async () => {
  const home = makeHome();
  try {
    for (const args of [
      ["disconnect", "account-1"],
      ["send-reply", "--botId=bot", "--recipients=alice", "--message=hello"],
    ]) {
      const result = await runClient(args, testEnv(home));
      assert.notEqual(result.code, 0);
      assert.equal(jsonOutput(result).error.code, "CONFIRMATION_REQUIRED");
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

for (const failure of [
  {
    name: "401",
    status: 401,
    body: { error: "bad credentials" },
    code: "AUTH_FAILED",
  },
  {
    name: "500",
    status: 500,
    body: { error: "database failed" },
    code: "API_HTTP_ERROR",
  },
]) {
  test(`${failure.name} responses are structured failures, not successful account lists`, async () => {
    await withApi(
      (request, response) => {
        if (!request.headers.authorization)
          return sendProviderIdentity(response);
        sendJson(response, failure.status, failure.body);
      },
      async ({ env }) => {
        const result = await runClient(["list-accounts"], env);
        assert.notEqual(result.code, 0);
        const error = jsonOutput(result);
        assert.equal(error.error.code, failure.code);
        assert.equal(error.error.status, failure.status);
        assert.ok(!`${result.stdout}${result.stderr}`.includes(SECRET));
      },
    );
  });
}

test("malformed JSON is a structured INVALID_API_RESPONSE failure", async () => {
  await withApi(
    (request, response) => {
      if (!request.headers.authorization) return sendProviderIdentity(response);
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{ definitely not json");
    },
    async ({ env }) => {
      const result = await runClient(["list-accounts"], env);
      assert.notEqual(result.code, 0);
      const error = jsonOutput(result);
      assert.equal(error.error.code, "INVALID_API_RESPONSE");
    },
  );
});

test("a successful response without an accounts array is not reported as disconnected", async () => {
  await withApi(
    (request, response) => {
      if (!request.headers.authorization) return sendProviderIdentity(response);
      sendJson(response, 200, { success: true });
    },
    async ({ env }) => {
      const result = await runClient(["status", "telegram"], env);
      assert.notEqual(result.code, 0);
      assert.equal(jsonOutput(result).error.code, "INVALID_API_RESPONSE");
    },
  );
});

test("connection refusal reports attempts without claiming the sandbox is responsible", async () => {
  const closed = await startServer((_request, response) => response.end());
  const url = closed.url;
  await closed.close();
  const home = makeHome();
  try {
    const result = await runClient(
      ["list-accounts"],
      testEnv(home, { OPENLOOMI_API_URL: url }),
    );
    assert.notEqual(result.code, 0);
    const error = jsonOutput(result);
    assert.equal(error.error.code, "LOCAL_API_UNREACHABLE");
    assert.equal(error.error.tokenPresent, true);
    assert.equal(error.error.loopbackAccessAmbiguous, true);
    assert.ok(
      Array.isArray(error.error.attempts) && error.error.attempts.length >= 1,
    );
    assert.ok(!`${result.stdout}${result.stderr}`.includes(SECRET));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("the Codex sandbox marker upgrades an unreachable loopback error to SANDBOX_BLOCKED", async () => {
  const closed = await startServer((_request, response) => response.end());
  const url = closed.url;
  await closed.close();
  const home = makeHome();
  try {
    const result = await runClient(
      ["list-accounts"],
      testEnv(home, {
        OPENLOOMI_API_URL: url,
        CODEX_SANDBOX_NETWORK_DISABLED: "1",
      }),
    );
    assert.notEqual(result.code, 0);
    const error = jsonOutput(result);
    assert.equal(error.error.code, "SANDBOX_BLOCKED");
    assert.equal(error.error.tokenPresent, true);
    assert.equal(error.error.loopbackAccessAmbiguous, true);
    assert.ok(Array.isArray(error.error.attempts));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

async function startFixedMutationServers(mutationBehavior) {
  let fallbackRequests = 0;
  const first = await startServer((request, response) => {
    if (request.url === "/api/native/providers") {
      sendProviderIdentity(response);
      return;
    }
    mutationBehavior(request, response);
  }, 3414);
  try {
    const fallback = await startServer((_request, response) => {
      fallbackRequests += 1;
      sendJson(response, 200, { success: true });
    }, 3515);
    return {
      fallbackRequests: () => fallbackRequests,
      close: async () => {
        await Promise.all([first.close(), fallback.close()]);
      },
    };
  } catch (error) {
    await first.close();
    throw error;
  }
}

test(
  "a timed-out mutation is not replayed on the fallback port",
  { concurrency: false },
  async (t) => {
    let servers;
    try {
      servers = await startFixedMutationServers((_request, _response) => {
        // Deliberately accept the request but never produce a response. Once a
        // mutation reaches this point its outcome is unknown and replay is unsafe.
      });
    } catch (error) {
      if (error.code === "EADDRINUSE")
        return t.skip("OpenLoomi development ports are in use");
      throw error;
    }
    const home = makeHome();
    try {
      const result = await runClient(
        [
          "send-reply",
          "--botId=bot",
          "--recipients=alice",
          "--message=hello",
          "--confirmed=true",
        ],
        testEnv(home, {
          OPENLOOMI_API_TIMEOUT_MS: "80",
          OPENLOOMI_API_PROBE_TIMEOUT_MS: "80",
        }),
      );
      assert.notEqual(result.code, 0);
      assert.equal(jsonOutput(result).error.code, "REQUEST_OUTCOME_UNKNOWN");
      assert.equal(servers.fallbackRequests(), 0);
    } finally {
      rmSync(home, { recursive: true, force: true });
      await servers.close();
    }
  },
);

test(
  "an ECONNRESET mutation is not replayed on the fallback port",
  { concurrency: false },
  async (t) => {
    let servers;
    try {
      servers = await startFixedMutationServers((request) => {
        request.socket.destroy();
      });
    } catch (error) {
      if (error.code === "EADDRINUSE")
        return t.skip("OpenLoomi development ports are in use");
      throw error;
    }
    const home = makeHome();
    try {
      const result = await runClient(
        ["disconnect", "account-1", "--confirmed=true"],
        testEnv(home),
      );
      assert.notEqual(result.code, 0);
      assert.equal(jsonOutput(result).error.code, "REQUEST_OUTCOME_UNKNOWN");
      assert.equal(servers.fallbackRequests(), 0);
    } finally {
      rmSync(home, { recursive: true, force: true });
      await servers.close();
    }
  },
);

test(
  "a read request retries the verified fallback port",
  { concurrency: false },
  async (t) => {
    let first;
    let fallback;
    try {
      first = await startServer((request, response) => {
        if (request.url === "/api/native/providers") {
          sendProviderIdentity(response);
          return;
        }
        request.socket.destroy();
      }, 3414);
      fallback = await startServer((request, response) => {
        if (request.url === "/api/native/providers") {
          sendProviderIdentity(response);
          return;
        }
        sendJson(response, 200, {
          accounts: [
            { id: "fallback-account", platform: "telegram", status: "active" },
          ],
        });
      }, 3515);
    } catch (error) {
      if (first?.server.listening) await first.close();
      await fallback?.close();
      if (error.code === "EADDRINUSE")
        return t.skip("OpenLoomi development ports are in use");
      throw error;
    }

    const home = makeHome();
    try {
      const result = await runClient(["list-accounts"], testEnv(home));
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(jsonOutput(result), {
        accounts: [
          {
            id: "fallback-account",
            platform: "telegram",
            status: "active",
          },
        ],
        total: 1,
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
      await Promise.all([
        first.server.listening ? first.close() : Promise.resolve(),
        fallback.close(),
      ]);
    }
  },
);

test(
  "a mutation retries the fallback only when the first request never connects",
  { concurrency: false },
  async (t) => {
    let first;
    let fallback;
    let fallbackMutations = 0;
    try {
      first = await startServer((request, response) => {
        if (request.url === "/api/native/providers") {
          // Stop accepting connections before completing the successful
          // identity response. The subsequent mutation is therefore known
          // not to have reached this candidate and is safe to try elsewhere.
          first.server.close();
          response.setHeader("connection", "close");
          setTimeout(() => sendProviderIdentity(response), 40);
        }
      }, 3414);
      fallback = await startServer((request, response) => {
        if (request.url === "/api/native/providers") {
          sendProviderIdentity(response);
          return;
        }
        fallbackMutations += 1;
        sendJson(response, 200, { success: true });
      }, 3515);
    } catch (error) {
      if (first?.server.listening) await first.close();
      await fallback?.close();
      if (error.code === "EADDRINUSE")
        return t.skip("OpenLoomi development ports are in use");
      throw error;
    }

    const home = makeHome();
    try {
      const result = await runClient(
        ["disconnect", "account-1", "--confirmed=true"],
        testEnv(home, { OPENLOOMI_API_PROBE_TIMEOUT_MS: "500" }),
      );
      assert.equal(result.code, 0, result.stderr);
      assert.equal(fallbackMutations, 1);
    } finally {
      rmSync(home, { recursive: true, force: true });
      await Promise.all([
        first.server.listening ? first.close() : Promise.resolve(),
        fallback.close(),
      ]);
    }
  },
);

test("connect returns a desktop UI handoff and never submits connector credentials", async () => {
  await withApi(
    (request, response) => {
      assert.equal(request.headers.authorization, undefined);
      sendProviderIdentity(response);
    },
    async ({ env }) => {
      const result = await runClient(["connect", "telegram"], env);
      assert.equal(result.code, 0, result.stderr);
      const handoff = jsonOutput(result);
      assert.equal(handoff.platform, "telegram");
      assert.deepEqual(Object.keys(handoff).sort(), [
        "handoffUrl",
        "instructions",
        "platform",
      ]);
      assert.match(
        handoff.handoffUrl,
        /^http:\/\/127\.0\.0\.1:\d+\/connectors\?/,
      );
    },
  );
});

test("connect rejects secret-bearing argv without echoing the secret", async () => {
  const secretArgs = [
    "raw-positional-secret",
    "--password",
    "--password=",
    "--clientSecret=",
    "--appSecret=",
    "--token=",
  ];
  const home = makeHome();
  try {
    for (const argument of secretArgs) {
      const value = `${argument}${SECRET}`;
      const result = await runClient(
        ["connect", "dingtalk", value],
        testEnv(home),
      );
      assert.notEqual(result.code, 0, `${argument} should be refused`);
      assert.ok(!`${result.stdout}${result.stderr}`.includes(value));
      assert.equal(jsonOutput(result).error.code, "SECRETS_NOT_ACCEPTED");
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("unknown command and platform failures do not echo untrusted input", async () => {
  const home = makeHome();
  try {
    for (const { args, code } of [
      { args: [SECRET], code: "UNKNOWN_COMMAND" },
      { args: ["status", SECRET], code: "UNKNOWN_PLATFORM" },
      { args: ["connect", SECRET], code: "UNKNOWN_PLATFORM" },
    ]) {
      const result = await runClient(args, testEnv(home));
      assert.notEqual(result.code, 0);
      assert.equal(jsonOutput(result).error.code, code);
      assert.ok(!`${result.stdout}${result.stderr}`.includes(SECRET));
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("explicit API overrides reject non-loopback and credential-bearing URLs", async () => {
  const home = makeHome();
  try {
    for (const url of [
      "https://127.0.0.1:3414",
      "http://example.com:3414",
      "http://user:password@localhost:3414",
    ]) {
      const result = await runClient(
        ["list-accounts"],
        testEnv(home, { OPENLOOMI_API_URL: url }),
      );
      assert.notEqual(result.code, 0);
      assert.equal(jsonOutput(result).error.code, "INVALID_API_URL");
      assert.ok(!`${result.stdout}${result.stderr}`.includes("user:password"));
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("plugin MCP config resolves the server from the installed plugin root", () => {
  const manifest = JSON.parse(readFileSync(PLUGIN_MANIFEST, "utf8"));
  const config = JSON.parse(readFileSync(MCP_CONFIG, "utf8"));
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.deepEqual(Object.keys(config.mcpServers), ["openloomi"]);
  assert.deepEqual(config.mcpServers.openloomi, {
    command: "node",
    args: ["scripts/openloomi-mcp-server.cjs"],
    cwd: ".",
  });
  assert.ok(!readFileSync(MCP_CONFIG, "utf8").includes("${PLUGIN_ROOT}"));

  const skill = readFileSync(CODEX_CONNECTOR_SKILL, "utf8");
  for (const tool of [
    "list_platforms",
    "list_accounts",
    "connector_status",
    "connect",
    "disconnect",
    "query_contacts",
    "send_reply",
  ]) {
    assert.match(skill, new RegExp(`mcp__openloomi__${tool}\\b`));
  }
});

function startMcp(env) {
  const child = spawn(process.execPath, [MCP_SERVER], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdoutBuffer = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map();

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    while (stdoutBuffer.includes("\n")) {
      const newline = stdoutBuffer.indexOf("\n");
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        for (const entry of pending.values()) entry.reject(error);
        pending.clear();
        continue;
      }
      const entry = pending.get(message.id);
      if (entry) {
        clearTimeout(entry.timer);
        pending.delete(message.id);
        entry.resolve(message);
      }
    }
  });
  child.on("exit", (code, signal) => {
    const error = new Error(
      `MCP server exited before replying (code=${code}, signal=${signal}): ${stderr}`,
    );
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  });

  return {
    notify(method, params = {}) {
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
      );
    },
    request(method, params = {}) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolveRequest, rejectRequest) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rejectRequest(
            new Error(`Timed out waiting for ${method}; stderr: ${stderr}`),
          );
        }, 3_000);
        pending.set(id, {
          resolve: resolveRequest,
          reject: rejectRequest,
          timer,
        });
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
        );
      });
    },
    async close() {
      child.stdin.end();
      await new Promise((resolveExit) => {
        if (child.exitCode !== null) resolveExit();
        else child.once("exit", resolveExit);
      });
      assert.equal(stderr, "", `MCP server wrote to stderr: ${stderr}`);
    },
  };
}

function structuredToolContent(response) {
  assert.equal(response.jsonrpc, "2.0");
  assert.ok(response.result);
  assert.ok(Array.isArray(response.result.content));
  assert.equal(response.result.content[0].type, "text");
  assert.deepEqual(
    JSON.parse(response.result.content[0].text),
    response.result.structuredContent,
  );
  return response.result.structuredContent;
}

test("MCP server completes a real stdio initialize, tools/list, tools/call, and confirmation flow", async () => {
  const mutations = [];
  await withApi(
    async (request, response) => {
      if (!request.headers.authorization) {
        sendProviderIdentity(response);
        return;
      }
      const body =
        request.method === "POST" ? JSON.parse(await readBody(request)) : null;
      mutations.push({ method: request.method, url: request.url, body });
      sendJson(response, 200, { success: true });
    },
    async ({ env }) => {
      const mcp = startMcp(env);
      try {
        const initialized = await mcp.request("initialize", {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "openloomi-contract-test", version: "1.0.0" },
        });
        assert.equal(initialized.result.protocolVersion, "2025-03-26");
        assert.equal(
          initialized.result.serverInfo.name,
          "openloomi-connectors",
        );
        assert.deepEqual(initialized.result.capabilities, {
          tools: { listChanged: false },
        });
        mcp.notify("notifications/initialized");

        const listed = await mcp.request("tools/list");
        const tools = listed.result.tools;
        assert.deepEqual(
          tools.map((tool) => tool.name),
          [
            "list_platforms",
            "list_accounts",
            "connector_status",
            "connect",
            "disconnect",
            "query_contacts",
            "send_reply",
          ],
        );
        assert.equal(
          tools.find((tool) => tool.name === "disconnect").annotations
            .destructiveHint,
          true,
        );
        assert.equal(
          tools.find((tool) => tool.name === "send_reply").annotations
            .idempotentHint,
          false,
        );

        const platformCall = await mcp.request("tools/call", {
          name: "list_platforms",
          arguments: {},
        });
        assert.equal(platformCall.result.isError, undefined);
        assert.equal(structuredToolContent(platformCall).total, 7);

        for (const malformed of [
          {
            name: "connector_status",
            arguments: { platform: 42 },
          },
          {
            name: "query_contacts",
            arguments: { page: 0 },
          },
          {
            name: "query_contacts",
            arguments: { pageSize: 101 },
          },
          {
            name: "disconnect",
            arguments: { accountId: " ", confirmed: true },
          },
          {
            name: "send_reply",
            arguments: {
              botId: "bot-1",
              recipients: [" "],
              message: "hello",
              confirmed: true,
            },
          },
        ]) {
          const refused = await mcp.request("tools/call", malformed);
          assert.equal(refused.result.isError, true);
          assert.equal(
            structuredToolContent(refused).error.code,
            "INVALID_ARGUMENT",
          );
        }

        for (const unconfirmed of [
          {
            name: "disconnect",
            arguments: { accountId: "account-1" },
          },
          {
            name: "send_reply",
            arguments: {
              botId: "bot-1",
              recipients: ["alice"],
              message: "hello",
            },
          },
        ]) {
          const refused = await mcp.request("tools/call", unconfirmed);
          assert.equal(refused.result.isError, true);
          assert.equal(
            structuredToolContent(refused).error.code,
            "CONFIRMATION_REQUIRED",
          );
        }
        assert.deepEqual(mutations, []);

        const sent = await mcp.request("tools/call", {
          name: "send_reply",
          arguments: {
            botId: "bot-1",
            recipients: ["alice"],
            message: "hello",
            confirmed: true,
          },
        });
        assert.equal(sent.result.isError, undefined);
        assert.deepEqual(structuredToolContent(sent), { success: true });

        const disconnected = await mcp.request("tools/call", {
          name: "disconnect",
          arguments: { accountId: "account-1", confirmed: true },
        });
        assert.equal(disconnected.result.isError, undefined);
        assert.deepEqual(structuredToolContent(disconnected), {
          success: true,
        });
      } finally {
        await mcp.close();
      }
    },
  );

  assert.deepEqual(mutations, [
    {
      method: "POST",
      url: "/api/messages",
      body: {
        botId: "bot-1",
        recipients: ["alice"],
        message: "hello",
      },
    },
    { method: "DELETE", url: "/api/integrations/account-1", body: null },
  ]);
});

test("MCP marks HTTP 200 operation failures as tool errors", async () => {
  await withApi(
    (request, response) => {
      if (!request.headers.authorization) return sendProviderIdentity(response);
      sendJson(response, 200, {
        success: false,
        error: `foreign connector detail: ${SECRET}`,
      });
    },
    async ({ env }) => {
      const mcp = startMcp(env);
      try {
        const response = await mcp.request("tools/call", {
          name: "send_reply",
          arguments: {
            botId: "bot-1",
            recipients: ["alice"],
            message: "hello",
            confirmed: true,
          },
        });
        assert.equal(response.result.isError, true);
        const structured = structuredToolContent(response);
        assert.equal(structured.error.code, "API_OPERATION_FAILED");
        assert.ok(!JSON.stringify(structured).includes(SECRET));
      } finally {
        await mcp.close();
      }
    },
  );
});

test("MCP rejects malformed HTTP 200 mutation responses", async () => {
  await withApi(
    (request, response) => {
      if (!request.headers.authorization) return sendProviderIdentity(response);
      sendJson(response, 200, { success: "true" });
    },
    async ({ env }) => {
      const mcp = startMcp(env);
      try {
        const response = await mcp.request("tools/call", {
          name: "disconnect",
          arguments: { accountId: "account-1", confirmed: true },
        });
        assert.equal(response.result.isError, true);
        assert.equal(
          structuredToolContent(response).error.code,
          "INVALID_API_RESPONSE",
        );
      } finally {
        await mcp.close();
      }
    },
  );
});
