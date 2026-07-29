import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(testDir, "../openloomi/scripts/openloomi.cjs");
const require = createRequire(import.meta.url);
const { runCommand } = require(scriptPath);

function readRequestBody(req) {
  return new Promise((resolveBody) => {
    let text = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      text += chunk;
    });
    req.on("end", () => {
      if (!text) {
        resolveBody(undefined);
        return;
      }
      try {
        resolveBody(JSON.parse(text));
      } catch {
        resolveBody(text);
      }
    });
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendSse(res, frames) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const frame of frames) {
    res.write(`data: ${JSON.stringify(frame)}\n\n`);
  }
  res.end();
}

async function withMockServer(handler, fn) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const body = await readRequestBody(req);
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body,
    });
    await handler(req, res, body, requests);
  });

  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    return await fn({ baseUrl, requests });
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

async function runCli(baseUrl, args, env = {}, fsOverride) {
  const json = await runCommand(args, {
    env: {
      OPENLOOMI_API_URL: baseUrl,
      OPENLOOMI_BASE_URL: "",
      OPENLOOMI_AUTH_TOKEN: "test.jwt.token",
      ...env,
    },
    fs: fsOverride || {
      readFileSync() {
        throw new Error("token file should not be read when env token exists");
      },
    },
  });
  return {
    status: 0,
    json,
  };
}

function defaultProbeHandler(req, res) {
  if (req.url === "/api/remote-auth/user") {
    sendJson(res, 200, {
      success: true,
      data: {
        id: "user_1",
        email: "user@example.test",
        name: "Test User",
        authenticated: true,
      },
    });
    return true;
  }
  return false;
}

test("status probes the user and native provider endpoints", async () => {
  await withMockServer(
    async (req, res) => {
      if (defaultProbeHandler(req, res)) return;
      if (req.url === "/api/native/providers") {
        sendJson(res, 200, {
          defaultAgent: "codex",
          agents: [{ type: "codex", displayName: "Codex" }],
        });
        return;
      }
      sendJson(res, 404, { error: "not found" });
    },
    async ({ baseUrl }) => {
      const result = await runCli(baseUrl, ["status"]);
      assert.equal(result.status, 0);
      assert.equal(result.json.ok, true);
      assert.equal(result.json.baseUrl, baseUrl);
      assert.equal(result.json.auth.available, true);
      assert.equal(result.json.probes.user.authenticated, true);
      assert.equal(result.json.probes.providers.defaultAgent, "codex");
    },
  );
});

test("memory-search falls back from unified memory to RAG search", async () => {
  await withMockServer(
    async (req, res, body) => {
      if (defaultProbeHandler(req, res)) return;
      if (req.url === "/api/memory/search") {
        sendJson(res, 404, { error: "missing route" });
        return;
      }
      if (req.url === "/api/rag/search") {
        assert.deepEqual(body, { query: "alpha project", limit: 7 });
        sendJson(res, 200, {
          query: body.query,
          results: [{ documentId: "doc_1", content: "alpha result" }],
        });
        return;
      }
      sendJson(res, 404, { error: "not found" });
    },
    async ({ baseUrl }) => {
      const result = await runCli(baseUrl, [
        "memory-search",
        "alpha",
        "project",
        "--limit=7",
      ]);
      assert.equal(result.status, 0);
      assert.equal(result.json.ok, true);
      assert.equal(result.json.endpoint, "/api/rag/search");
      assert.equal(result.json.result.results[0].documentId, "doc_1");
    },
  );
});

test("knowledge commands use explicit RAG document APIs", async () => {
  await withMockServer(
    async (req, res, body) => {
      if (defaultProbeHandler(req, res)) return;
      if (req.url === "/api/rag/search") {
        assert.deepEqual(body, { query: "launch plan", limit: 3 });
        sendJson(res, 200, {
          results: [{ documentId: "doc_1", content: "launch result" }],
        });
        return;
      }
      if (req.url === "/api/rag/documents?pageSize=2&cursor=1700000000000") {
        sendJson(res, 200, {
          documents: [{ id: "doc_1", fileName: "launch.md" }],
          hasMore: false,
          nextCursor: null,
          total: 1,
        });
        return;
      }
      if (req.url === "/api/rag/documents/doc_1") {
        sendJson(res, 200, {
          document: {
            id: "doc_1",
            fileName: "launch.md",
            chunks: [{ id: "chunk_1", content: "Launch notes" }],
          },
        });
        return;
      }
      sendJson(res, 404, { error: "not found" });
    },
    async ({ baseUrl }) => {
      const search = await runCli(baseUrl, [
        "knowledge-search",
        "launch",
        "plan",
        "--limit=3",
      ]);
      assert.equal(search.json.ok, true);
      assert.equal(search.json.endpoint, "/api/rag/search");
      assert.equal(search.json.result.results[0].documentId, "doc_1");

      const list = await runCli(baseUrl, [
        "knowledge-list",
        "--limit=2",
        "--cursor=1700000000000",
      ]);
      assert.equal(list.json.ok, true);
      assert.equal(
        list.json.endpoint,
        "/api/rag/documents?pageSize=2&cursor=1700000000000",
      );
      assert.equal(list.json.result.documents[0].fileName, "launch.md");

      const get = await runCli(baseUrl, ["knowledge-get", "doc_1"]);
      assert.equal(get.json.ok, true);
      assert.equal(get.json.endpoint, "/api/rag/documents/doc_1");
      assert.equal(get.json.result.document.chunks[0].content, "Launch notes");
    },
  );
});

test("knowledge-upload posts a small file as multipart form data", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "openloomi-skill-"));
  const filePath = join(tempDir, "phase-five.md");
  writeFileSync(filePath, "# Phase five\n\nUpload me.", "utf8");

  try {
    await withMockServer(
      async (req, res, body) => {
        if (defaultProbeHandler(req, res)) return;
        if (req.url === "/api/rag/upload") {
          assert.equal(req.method, "POST");
          assert.equal(req.headers.authorization, "Bearer test.jwt.token");
          assert.match(
            req.headers["content-type"],
            /^multipart\/form-data; boundary=/,
          );
          assert.match(body, /name="file"; filename="phase-five.md"/);
          assert.match(body, /# Phase five/);
          assert.match(body, /name="skipEmbeddings"/);
          assert.match(body, /true/);
          assert.match(body, /name="cloudAuthToken"/);
          sendJson(res, 200, {
            success: true,
            documentId: "doc_uploaded",
            fileName: "phase-five.md",
          });
          return;
        }
        sendJson(res, 404, { error: "not found" });
      },
      async ({ baseUrl }) => {
        const result = await runCli(
          baseUrl,
          [
            "knowledge-upload",
            filePath,
            "--skip-embeddings",
            "--timeout-ms=2000",
          ],
          {},
          { readFileSync },
        );
        assert.equal(result.json.ok, true);
        assert.equal(result.json.endpoint, "/api/rag/upload");
        assert.equal(result.json.fileName, "phase-five.md");
        assert.equal(result.json.result.documentId, "doc_uploaded");
        assert.doesNotMatch(JSON.stringify(result.json), /test\.jwt\.token/);
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("connectors-list returns accounts and supports platform filtering", async () => {
  await withMockServer(
    async (req, res) => {
      if (defaultProbeHandler(req, res)) return;
      if (req.url === "/api/integrations/accounts") {
        sendJson(res, 200, {
          accounts: [
            {
              id: "int_gmail",
              platform: "gmail",
              displayName: "Gmail",
              status: "active",
              botId: "bot_gmail",
            },
            {
              id: "int_slack",
              platform: "slack",
              displayName: "Slack",
              status: "active",
              botId: "bot_slack",
            },
          ],
        });
        return;
      }
      sendJson(res, 404, { error: "not found" });
    },
    async ({ baseUrl }) => {
      const result = await runCli(baseUrl, [
        "connectors-list",
        "--platform=gmail",
      ]);
      assert.equal(result.status, 0);
      assert.equal(result.json.ok, true);
      assert.equal(result.json.total, 1);
      assert.equal(result.json.accounts[0].id, "int_gmail");
      assert.equal(result.json.accounts[0].botId, "bot_gmail");
    },
  );
});

test("agent-run posts a safe native-agent request and parses SSE output", async () => {
  await withMockServer(
    async (req, res, body) => {
      if (defaultProbeHandler(req, res)) return;
      if (req.url === "/api/native/agent") {
        assert.equal(req.headers.authorization, "Bearer test.jwt.token");
        assert.equal(body.prompt, "Draft reply");
        assert.equal(body.platform, "workbuddy-test");
        assert.equal(body.permissionMode, "dontAsk");
        assert.equal(body.authToken, "test.jwt.token");
        assert.ok(body.allowedTools.includes("Read"));
        assert.ok(!body.allowedTools.includes("Bash"));
        assert.ok(body.disallowedTools.includes("Bash"));
        sendSse(res, [
          { type: "session", sessionId: "session_1" },
          { type: "text", content: "Hello" },
          { type: "tool_use", name: "Skill", input: { skill: "openloomi" } },
          { type: "text", content: " world" },
          { type: "result", cost: 0.12, duration: 345 },
        ]);
        return;
      }
      sendJson(res, 404, { error: "not found" });
    },
    async ({ baseUrl }) => {
      const result = await runCli(baseUrl, [
        "agent-run",
        "Draft",
        "reply",
        "--platform=workbuddy-test",
        "--timeout-ms=2000",
      ]);
      assert.equal(result.status, 0);
      assert.equal(result.json.ok, true);
      assert.equal(result.json.response, "Hello world");
      assert.equal(result.json.result.sessionId, "session_1");
      assert.deepEqual(result.json.result.tools, ["Skill"]);
      assert.deepEqual(result.json.result.skills, ["openloomi"]);
      assert.equal(result.json.result.cost, 0.12);
      assert.equal(result.json.result.durationMs, 345);
    },
  );
});
