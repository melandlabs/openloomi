import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, connect } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import spawn from "cross-spawn";
import {
  runNativeAgentRequest,
  type NativeAgentHost,
  type NativeAgentRunnerContext,
} from "@openloomi/ai/agent/native-runner";
import { getAgentRegistry } from "@openloomi/ai/agent/registry";
import type { AgentMessage } from "@openloomi/ai/agent/types";

import { codexPlugin } from "@/lib/ai/extensions/agent/codex";
import { openclawPlugin } from "@/lib/ai/extensions/agent/openclaw";
import { opencodePlugin } from "@/lib/ai/extensions/agent/opencode";
import { resolveNativeAgentProviderRequest } from "@/lib/ai/native-agent/provider-env";

const shouldRunOpenCode = process.env.RUN_OPENCODE_REAL === "1";
const shouldRunCodex = process.env.RUN_CODEX_REAL === "1";
const shouldRunOpenClaw = process.env.RUN_OPENCLAW_REAL === "1";
const describeOpenCode = shouldRunOpenCode ? describe : describe.skip;
const describeCodex = shouldRunCodex ? describe : describe.skip;
const describeOpenClaw = shouldRunOpenClaw ? describe : describe.skip;
const repoTempDir = join(process.cwd(), "..", "..", ".tmp");
const envSnapshot = { ...process.env };
const tempDirs: string[] = [];
let gatewayProcess: ChildProcess | undefined;
let providersRegistered = false;

interface RealCredentials {
  apiKey: string;
  baseUrl: string;
  model: string;
}

afterEach(async () => {
  await stopGateway();
  process.env = { ...envSnapshot };
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
});

describeOpenCode("OpenCode real CLI integration", () => {
  it("runs through provider env, native host, registry, and the real OpenCode CLI", async () => {
    const credentials = await loadRealCredentials();
    const workDir = await createTempWorkDir("opencode");
    configureOpenCode(credentials);

    const messages = await runRealPrompt(
      "Reply with exactly: OPENCODE_OPENLOOMI_SMOKE_OK. Do not modify files or use tools.",
      workDir,
      180_000,
    );

    expectSuccessfulRun(messages, "OPENCODE_OPENLOOMI_SMOKE_OK");
  }, 190_000);
});

describeCodex("Codex real CLI integration", () => {
  it("runs through provider env, native host, registry, and codex exec --json", async () => {
    process.env.OPENLOOMI_AGENT_PROVIDER = "codex";
    process.env.OPENLOOMI_AGENT_CODEX_COMMAND = "codex";
    process.env.OPENLOOMI_AGENT_CODEX_SANDBOX = "read-only";
    process.env.OPENLOOMI_AGENT_CODEX_SKIP_GIT_REPO_CHECK = "true";
    process.env.OPENLOOMI_AGENT_CODEX_TIMEOUT_MS = "180000";
    process.env.OPENLOOMI_AGENT_CODEX_MODEL = undefined;

    const messages = await runRealPrompt(
      "Reply with exactly: CODEX_OPENLOOMI_SMOKE_OK. Do not modify files or use tools.",
      await createTempWorkDir("codex"),
      180_000,
    );

    expectSuccessfulRun(messages, "CODEX_OPENLOOMI_SMOKE_OK");
  }, 190_000);
});

describeOpenClaw("OpenClaw real ACP integration", () => {
  it("runs through provider env, native host, ACP bridge, and a real Gateway", async () => {
    const credentials = await loadRealCredentials();
    const workDir = await createTempWorkDir("openclaw-workspace");
    const stateDir = await createTempDir("openclaw-state");
    const configPath = join(stateDir, "openclaw.json");
    const tokenFile = join(stateDir, "gateway.token");
    const gatewayToken = randomBytes(32).toString("hex");
    const openclawCommand =
      process.env.OPENLOOMI_OPENCLAW_REAL_COMMAND?.trim() || "openclaw";
    const port = await findAvailablePort();

    await writeFile(tokenFile, gatewayToken, "utf8");
    await writeFile(
      configPath,
      JSON.stringify(createOpenClawConfig(credentials, workDir, port), null, 2),
      "utf8",
    );
    configureOpenClaw(
      credentials,
      stateDir,
      configPath,
      tokenFile,
      gatewayToken,
      port,
      openclawCommand,
    );
    await startGateway(port, openclawCommand);

    const promptPromise = runRealPrompt(
      "Reply with exactly: OPENCLAW_OPENLOOMI_SMOKE_OK. Do not modify files or use tools.",
      workDir,
      180_000,
    );
    const pairingRequestId = await waitForOpenClawAcpPairingRequest(stateDir);
    await approveOpenClawPairing(port, gatewayToken, pairingRequestId);
    let messages = await promptPromise;

    if (getOpenClawPairingRequestId(messages)) {
      messages = await runRealPrompt(
        "Reply with exactly: OPENCLAW_OPENLOOMI_SMOKE_OK. Do not modify files or use tools.",
        workDir,
        180_000,
      );
    }

    expectSuccessfulRun(messages, "OPENCLAW_OPENLOOMI_SMOKE_OK");
  }, 380_000);
});

function configureOpenCode(credentials: RealCredentials) {
  const modelRef = `anthropic/${credentials.model}`;
  process.env.ANTHROPIC_API_KEY = credentials.apiKey;
  process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
    model: modelRef,
    small_model: modelRef,
    provider: {
      anthropic: {
        models: {
          [credentials.model]: {
            name: "OpenLoomi real integration model",
          },
        },
        options: {
          apiKey: "{env:ANTHROPIC_API_KEY}",
          baseURL: `${credentials.baseUrl.replace(/\/+$/, "")}/v1`,
        },
      },
    },
    permission: { "*": "deny" },
  });
  process.env.OPENLOOMI_AGENT_PROVIDER = "opencode";
  process.env.OPENLOOMI_AGENT_OPENCODE_COMMAND = "opencode";
  process.env.OPENLOOMI_AGENT_OPENCODE_MODEL = modelRef;
  process.env.OPENLOOMI_AGENT_OPENCODE_TIMEOUT_MS = "180000";
  process.env.OPENLOOMI_AGENT_OPENCODE_ALLOW_AUTO_APPROVE = "false";
  process.env.OPENLOOMI_AGENT_OPENCODE_AGENT = undefined;
}

function configureOpenClaw(
  credentials: RealCredentials,
  stateDir: string,
  configPath: string,
  tokenFile: string,
  gatewayToken: string,
  port: number,
  openclawCommand: string,
) {
  process.env.ANTHROPIC_API_KEY = credentials.apiKey;
  process.env.OPENCLAW_GATEWAY_TOKEN = gatewayToken;
  process.env.OPENCLAW_STATE_DIR = stateDir;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  process.env.OPENLOOMI_AGENT_PROVIDER = "openclaw";
  process.env.OPENLOOMI_AGENT_OPENCLAW_COMMAND = openclawCommand;
  process.env.OPENLOOMI_AGENT_OPENCLAW_GATEWAY_URL = `ws://127.0.0.1:${port}`;
  process.env.OPENLOOMI_AGENT_OPENCLAW_TOKEN_FILE = tokenFile;
  process.env.OPENLOOMI_AGENT_OPENCLAW_SESSION =
    "agent:main:openloomi-real-smoke";
  process.env.OPENLOOMI_AGENT_OPENCLAW_RESET_SESSION = "true";
  process.env.OPENLOOMI_AGENT_OPENCLAW_NO_PREFIX_CWD = "true";
  process.env.OPENLOOMI_AGENT_OPENCLAW_PROVENANCE = "off";
  process.env.OPENLOOMI_AGENT_OPENCLAW_TIMEOUT_MS = "180000";
}

function createOpenClawConfig(
  credentials: RealCredentials,
  workDir: string,
  port: number,
) {
  const modelRef = `openloomi-real/${credentials.model}`;
  return {
    gateway: {
      auth: { mode: "token", token: "${OPENCLAW_GATEWAY_TOKEN}" },
      bind: "loopback",
      mode: "local",
      port,
    },
    agents: {
      defaults: {
        model: { primary: modelRef },
        models: { [modelRef]: { alias: "OpenLoomi real integration" } },
        timeoutSeconds: 180,
        workspace: workDir,
      },
    },
    models: {
      mode: "replace",
      providers: {
        "openloomi-real": {
          api: "anthropic-messages",
          apiKey: "${ANTHROPIC_API_KEY}",
          baseUrl: `${credentials.baseUrl.replace(/\/+$/, "")}/v1`,
          models: [
            {
              id: credentials.model,
              name: "OpenLoomi real integration model",
              input: ["text"],
              contextWindow: 200000,
              maxTokens: 8192,
            },
          ],
        },
      },
    },
    plugins: {
      entries: {
        "admin-http-rpc": { enabled: true },
      },
    },
  };
}

async function loadRealCredentials(): Promise<RealCredentials> {
  const userId = process.env.OPENLOOMI_RUNTIME_REAL_USER_ID?.trim();
  if (!userId) {
    throw new Error(
      "Set OPENLOOMI_RUNTIME_REAL_USER_ID to a user with an enabled anthropic_compatible setting.",
    );
  }
  const { getUserLlmProviderConfig } =
    await import("@/lib/ai/user-llm-api-settings");
  const config = await getUserLlmProviderConfig({
    userId,
    providerType: "anthropic_compatible",
  });
  if (!config) {
    throw new Error(
      `No enabled anthropic_compatible setting found for OPENLOOMI_RUNTIME_REAL_USER_ID=${userId}.`,
    );
  }
  return config;
}

async function runRealPrompt(
  prompt: string,
  workDir: string,
  timeoutMs: number,
) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const run = await runNativeAgentRequest(
      {
        prompt,
        workDir,
        useProvidedWorkDir: true,
        permissionMode: "dontAsk",
        providerConfig: {
          opencodePath: "request-must-not-override-command",
          openclawPath: "request-must-not-override-command",
          codexPath: "request-must-not-override-command",
          timeoutMs: 1,
        },
      },
      createContext(abortController),
      realRuntimeHost,
    );
    return await collectMessages(run.generator);
  } finally {
    clearTimeout(timeout);
  }
}

const realRuntimeHost: NativeAgentHost = {
  registry: getAgentRegistry(),
  registerProviders() {
    if (providersRegistered) return;
    const registry = getAgentRegistry();
    registry.register(opencodePlugin);
    registry.register(codexPlugin);
    registry.register(openclawPlugin);
    providersRegistered = true;
  },
  prepareRequest: (body) => resolveNativeAgentProviderRequest(body),
  getUserLlmProviderConfig: async () => {
    throw new Error(
      "External runtime real smokes must use their runtime configuration, not Claude model injection.",
    );
  },
  logger: console,
};

function createContext(
  abortController: AbortController,
): NativeAgentRunnerContext {
  const userId =
    process.env.OPENLOOMI_RUNTIME_REAL_USER_ID?.trim() ?? "runtime-real-user";
  return {
    session: { user: { id: userId, type: "test" } },
    userId,
    abortController,
    permissionHandler: async () => ({ behavior: "deny" }),
    emitPermissionRequestEvents: true,
  };
}

async function collectMessages(generator: AsyncGenerator<AgentMessage>) {
  const messages: AgentMessage[] = [];
  for await (const message of generator) messages.push(message);
  return messages;
}

function expectSuccessfulRun(messages: AgentMessage[], marker: string) {
  const text = messages
    .map((message) => (message.type === "text" ? message.content : ""))
    .join("");

  console.info(
    `[real runtime smoke] ${marker}`,
    messages.map((message) =>
      message.type === "error"
        ? { type: message.type, message: message.message }
        : message.type,
    ),
  );
  expect(messages.some((message) => message.type === "session")).toBe(true);
  expect(messages.some((message) => message.type === "result")).toBe(true);
  expect(messages.some((message) => message.type === "done")).toBe(true);
  expect(messages.filter((message) => message.type === "error")).toEqual([]);
  expect(text).toContain(marker);
}

async function createTempWorkDir(name: string) {
  const dir = await createTempDir(`openloomi-${name}`);
  await writeFile(
    join(dir, "README.txt"),
    "Temporary OpenLoomi real runtime smoke workspace.\n",
    "utf8",
  );
  return dir;
}

async function createTempDir(prefix: string) {
  await mkdir(repoTempDir, { recursive: true });
  const dir = await mkdtemp(join(repoTempDir, `${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

async function findAvailablePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function getOpenClawPairingRequestId(messages: AgentMessage[]) {
  for (const message of messages) {
    if (message.type !== "error") continue;
    const match = message.message?.match(
      /scope upgrade pending approval \(requestId: ([^)]+)\)/,
    );
    if (match?.[1]) return match[1];
  }
  return undefined;
}

async function waitForOpenClawAcpPairingRequest(stateDir: string) {
  const pendingPath = join(stateDir, "devices", "pending.json");
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    try {
      const pending = JSON.parse(await readFile(pendingPath, "utf8")) as Record<
        string,
        { displayName?: string; requestId?: string }
      >;
      const request = Object.values(pending).find(
        (entry) => entry.displayName === "ACP",
      );
      if (request?.requestId) return request.requestId;
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? error.code
          : undefined;
      if (code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for OpenClaw ACP device pairing request");
}

async function approveOpenClawPairing(
  port: number,
  token: string,
  requestId: string,
) {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/admin/rpc`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      method: "device.pair.approve",
      params: { requestId },
    }),
  });
  const result = (await response.json()) as {
    ok?: boolean;
    error?: { message?: string };
  };
  if (!response.ok || result.ok !== true) {
    throw new Error(
      `Failed to approve OpenClaw ACP device pairing: ${result.error?.message ?? response.statusText}`,
    );
  }
}

async function startGateway(port: number, command: string) {
  let output = "";
  let healthOutput = "";
  gatewayProcess = spawn(
    command,
    [
      "gateway",
      "run",
      "--port",
      String(port),
      "--auth",
      "token",
      "--allow-unconfigured",
    ],
    {
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  gatewayProcess.stdout?.on("data", (chunk) => {
    output = `${output}${String(chunk)}`.slice(-20_000);
  });
  gatewayProcess.stderr?.on("data", (chunk) => {
    output = `${output}${String(chunk)}`.slice(-20_000);
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    if (gatewayProcess.exitCode !== null) {
      throw new Error(`OpenClaw Gateway exited before startup: ${output}`);
    }
    if (await canConnect(port)) {
      const health = await probeGatewayHealth(port, command);
      healthOutput = health.output;
      if (health.ok) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Timed out waiting for OpenClaw Gateway: ${output}\nHealth probe: ${healthOutput}`,
  );
}

async function probeGatewayHealth(port: number, command: string) {
  return await new Promise<{ ok: boolean; output: string }>((resolve) => {
    let output = "";
    const probe = spawn(
      command,
      [
        "gateway",
        "health",
        "--url",
        `ws://127.0.0.1:${port}`,
        "--timeout",
        "5000",
        "--token",
        process.env.OPENCLAW_GATEWAY_TOKEN ?? "",
      ],
      {
        env: process.env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    probe.stdout?.on("data", (chunk) => {
      output = `${output}${String(chunk)}`.slice(-20_000);
    });
    probe.stderr?.on("data", (chunk) => {
      output = `${output}${String(chunk)}`.slice(-20_000);
    });
    probe.once("error", (error) =>
      resolve({ ok: false, output: `${output}${error.message}` }),
    );
    probe.once("close", (code) =>
      resolve({ ok: code === 0, output: `${output}\nexit=${code}` }),
    );
  });
}

async function canConnect(port: number) {
  return await new Promise<boolean>((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function stopGateway() {
  const processToStop = gatewayProcess;
  gatewayProcess = undefined;
  if (!processToStop?.pid || processToStop.exitCode !== null) return;

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn(
        "taskkill",
        ["/F", "/T", "/PID", String(processToStop.pid)],
        { windowsHide: true, stdio: "ignore" },
      );
      killer.once("close", () => resolve());
      killer.once("error", () => resolve());
    });
  } else {
    processToStop.kill("SIGTERM");
  }
}
