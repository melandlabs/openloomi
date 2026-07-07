import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";
import { getAgentRegistry } from "@openloomi/ai/agent/registry";
import {
  runNativeAgentRequest,
  type NativeAgentHost,
  type NativeAgentRunnerContext,
} from "@openloomi/ai/agent/native-runner";
import type { AgentMessage } from "@openloomi/ai/agent/types";

import { HermesAgent, hermesPlugin } from "@/lib/ai/extensions/agent/hermes";
import { resolveNativeAgentProviderRequest } from "@/lib/ai/native-agent/provider-env";

const execFileAsync = promisify(execFile);
const shouldRunRealHermes = process.env.RUN_HERMES_REAL === "1";
const shouldRunRealHermesPermission =
  shouldRunRealHermes && process.env.RUN_HERMES_REAL_PERMISSION === "1";
const describeRealHermes = shouldRunRealHermes ? describe : describe.skip;
const repoTempDir = join(process.cwd(), "..", "..", ".tmp");

const tempDirs: string[] = [];
const envSnapshot = { ...process.env };
let providersRegistered = false;

interface HermesRealCredentials {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

afterEach(async () => {
  process.env = { ...envSnapshot };
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
});

describe.skipIf(!shouldRunRealHermes)(
  "Hermes real ACP integration gate",
  () => {
    it("is skipped unless RUN_HERMES_REAL=1", () => {
      expect(shouldRunRealHermes).toBe(true);
    });
  },
);

describeRealHermes("Hermes real ACP integration", () => {
  it("can call the saved OpenLoomi Anthropic-compatible setting directly", async () => {
    redirectHermesTestTempEnv();
    const userId = process.env.OPENLOOMI_HERMES_REAL_USER_ID?.trim();
    if (!userId) {
      console.info(
        "[Hermes real preflight] Skipped direct provider check because OPENLOOMI_HERMES_REAL_USER_ID is not set.",
      );
      return;
    }

    const { getUserLlmProviderConfig } =
      await import("@/lib/ai/user-llm-api-settings");
    const config = await getUserLlmProviderConfig({
      userId,
      providerType: "anthropic_compatible",
    });
    if (!config) {
      throw new Error(
        `No enabled anthropic_compatible OpenLoomi LLM setting was found for OPENLOOMI_HERMES_REAL_USER_ID=${userId}.`,
      );
    }

    const result = await fetchAnthropicCompatibleSmoke(config);
    console.info(
      "[Hermes real preflight direct provider smoke]",
      JSON.stringify(result, null, 2),
    );

    expect(result.ok).toBe(true);
    expect(result.text).toContain("HERMES_OPENLOOMI_DIRECT_OK");
  }, 70_000);

  it("runs a read-only prompt through native host, provider env, registry, and real Hermes ACP", async () => {
    withHermesProviderEnv();
    await applyHermesRealCredentials();
    const workDir = await createTempWorkDir();
    const beforePids = await listHermesProcessIds();
    const abortController = new AbortController();
    const host = createHermesRealHost();

    const run = await runNativeAgentRequest(
      {
        prompt:
          "Reply with exactly: HERMES_OPENLOOMI_SMOKE_OK. Do not modify files. Do not run shell commands.",
        workDir,
        useProvidedWorkDir: true,
        permissionMode: "dontAsk",
        providerConfig: {
          hermesPath: "request-must-not-override-command",
          profile: "request-must-not-override-profile",
          timeoutMs: 1,
          extraArgs: ["--yolo"],
          yolo: true,
        },
      },
      createContext(120_000, abortController),
      host,
    );

    const messages = await collectMessagesWithTimeout(
      run.generator,
      120_000,
      abortController,
    );
    console.info(
      "[Hermes real read-only smoke messages]",
      JSON.stringify(messages, null, 2),
    );
    const text = collectText(messages);
    const errors = messages.filter((message) => message.type === "error");

    expect(messages.some((message) => message.type === "session")).toBe(true);
    expect(
      messages.some(
        (message) => message.type === "text" || message.type === "reasoning",
      ),
    ).toBe(true);
    expect(messages.some((message) => message.type === "result")).toBe(true);
    expect(text).toContain("HERMES_OPENLOOMI_SMOKE_OK");
    expect(errors).toEqual([]);
    expect(countDone(messages)).toBe(1);

    await expectNoNewHermesProcesses(beforePids);
  }, 130_000);

  it("cleans up the real Hermes ACP process when the run is aborted", async () => {
    withHermesProviderEnv({ timeoutMs: "120000" });
    await applyHermesRealCredentials();
    const workDir = await createTempWorkDir();
    const beforePids = await listHermesProcessIds();
    const abortController = new AbortController();
    const host = createHermesRealHost();

    const run = await runNativeAgentRequest(
      {
        prompt:
          "Think for a while before answering. Do not modify files. Do not run tools.",
        workDir,
        useProvidedWorkDir: true,
        permissionMode: "dontAsk",
      },
      createContext(120_000, abortController),
      host,
    );

    const messages: AgentMessage[] = [];
    const reader = (async () => {
      for await (const message of run.generator) {
        messages.push(message);
        if (
          message.type === "session" ||
          message.type === "text" ||
          message.type === "reasoning"
        ) {
          abortController.abort();
        }
      }
    })();

    await withTimeout(reader, 120_000);
    console.info(
      "[Hermes real abort smoke messages]",
      JSON.stringify(messages, null, 2),
    );

    expect(messages.some((message) => message.type === "session")).toBe(true);
    expect(countDone(messages)).toBe(1);
    await expectNoNewHermesProcesses(beforePids);
  }, 130_000);

  it("stops a direct real HermesAgent run through stop(sessionId)", async () => {
    withHermesProviderEnv({ timeoutMs: "120000" });
    await applyHermesRealCredentials();
    const workDir = await createTempWorkDir();
    const beforePids = await listHermesProcessIds();
    const abortController = new AbortController();
    const agent = new HermesAgent({
      provider: "hermes",
      providerConfig: {
        hermesPath: findLocalHermesCommand(),
        timeoutMs: 120_000,
      },
      workDir,
    });
    const messages: AgentMessage[] = [];
    let sessionId: string | undefined;

    const reader = (async () => {
      for await (const message of agent.run(
        "Think for a while before answering. Do not modify files. Do not run tools.",
        {
          abortController,
          cwd: workDir,
          permissionMode: "dontAsk",
        },
      )) {
        messages.push(message);
        if (message.type === "session") {
          sessionId = message.sessionId;
        }
      }
    })();

    await waitFor(() => Boolean(sessionId), 10_000);
    await sleep(12_000);
    if (!sessionId) {
      throw new Error(
        "Hermes real direct stop smoke did not receive a session",
      );
    }
    await agent.stop(sessionId);
    await withTimeout(reader, 120_000);

    console.info(
      "[Hermes real direct stop smoke messages]",
      JSON.stringify(messages, null, 2),
    );

    expect(messages.some((message) => message.type === "session")).toBe(true);
    expect(countDone(messages)).toBe(1);
    await expectNoNewHermesProcesses(beforePids);
  }, 140_000);

  it.skipIf(!shouldRunRealHermesPermission)(
    "attempts a real Hermes permission request and denies it safely",
    async () => {
      withHermesProviderEnv({ timeoutMs: "120000" });
      await applyHermesRealCredentials();
      const workDir = await createTempWorkDir();
      const targetFile = join(workDir, "permission-smoke.txt");
      const beforePids = await listHermesProcessIds();
      const abortController = new AbortController();
      const host = createHermesRealHost();
      const permissionRequests: unknown[] = [];

      const run = await runNativeAgentRequest(
        {
          prompt:
            "Create a file named permission-smoke.txt in the current directory with exactly this content: HERMES_PERMISSION_SMOKE.",
          workDir,
          useProvidedWorkDir: true,
          permissionMode: "default",
        },
        createContext(120_000, abortController, async (request) => {
          permissionRequests.push(request);
          return { behavior: "deny" as const };
        }),
        host,
      );

      const messages = await collectMessagesWithTimeout(
        run.generator,
        120_000,
        abortController,
      );
      console.info(
        "[Hermes real permission smoke messages]",
        JSON.stringify(messages, null, 2),
      );

      const permissionMessages = messages.filter(
        (message) => message.type === "permission_request",
      );
      if (permissionRequests.length === 0 && permissionMessages.length === 0) {
        console.info(
          "[Hermes real permission smoke] Inconclusive: Hermes completed without emitting session/request_permission.",
        );
      } else {
        expect(permissionRequests.length).toBeGreaterThan(0);
        expect(permissionMessages.length).toBeGreaterThan(0);
      }

      expect(existsSync(targetFile)).toBe(false);
      expect(countDone(messages)).toBe(1);
      await expectNoNewHermesProcesses(beforePids);
    },
    130_000,
  );

  it("rejects unsupported Hermes model/provider env overrides before spawning", async () => {
    withHermesProviderEnv();
    process.env.OPENLOOMI_AGENT_HERMES_MODEL = "not-supported";
    process.env.OPENLOOMI_AGENT_HERMES_PROVIDER = "not-supported";
    const host = createHermesRealHost();

    await expect(
      runNativeAgentRequest(
        {
          prompt: "This should fail before Hermes ACP starts.",
          workDir: await createTempWorkDir(),
          useProvidedWorkDir: true,
        },
        createContext(10_000),
        host,
      ),
    ).rejects.toThrow(/OPENLOOMI_AGENT_HERMES_MODEL is not supported/);
  }, 20_000);
});

function withHermesProviderEnv(options: { timeoutMs?: string } = {}) {
  redirectHermesTestTempEnv();
  process.env.OPENLOOMI_AGENT_PROVIDER = "hermes";
  process.env.OPENLOOMI_AGENT_HERMES_COMMAND =
    process.env.OPENLOOMI_AGENT_HERMES_COMMAND || findLocalHermesCommand();
  process.env.OPENLOOMI_AGENT_HERMES_TIMEOUT_MS =
    options.timeoutMs ||
    process.env.OPENLOOMI_AGENT_HERMES_TIMEOUT_MS ||
    "120000";
  process.env.OPENLOOMI_AGENT_HERMES_MODEL = "";
  process.env.OPENLOOMI_AGENT_HERMES_PROVIDER = "";
}

async function applyHermesRealCredentials() {
  const userId = process.env.OPENLOOMI_HERMES_REAL_USER_ID?.trim();
  if (userId) {
    const { getUserLlmProviderConfig } =
      await import("@/lib/ai/user-llm-api-settings");
    const config = await getUserLlmProviderConfig({
      userId,
      providerType: "anthropic_compatible",
    });

    if (!config) {
      throw new Error(
        `RUN_HERMES_REAL=1 was set, but no enabled anthropic_compatible OpenLoomi LLM setting was found for OPENLOOMI_HERMES_REAL_USER_ID=${userId}.`,
      );
    }

    await configureHermesRealCredentials(config);
    console.info(
      `[Hermes real smoke] Loaded OpenLoomi LLM setting for user ${userId}.`,
    );
    return;
  }

  if (
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENAI_API_KEY
  ) {
    return;
  }

  const directApiKey = process.env.OPENLOOMI_HERMES_REAL_API_KEY?.trim();
  if (directApiKey) {
    await configureHermesRealCredentials({
      apiKey: directApiKey,
      baseUrl: process.env.OPENLOOMI_HERMES_REAL_BASE_URL,
      model: process.env.OPENLOOMI_HERMES_REAL_MODEL,
    });
    return;
  }

  throw new Error(
    "RUN_HERMES_REAL=1 requires Hermes credentials. Set OPENLOOMI_HERMES_REAL_USER_ID to a user with an enabled OpenLoomi anthropic_compatible LLM setting, or provide Hermes-supported env credentials such as ANTHROPIC_API_KEY, OPENROUTER_API_KEY, or OPENAI_API_KEY.",
  );
}

async function configureHermesRealCredentials(
  credentials: HermesRealCredentials,
) {
  setHermesCredentialEnv(credentials.apiKey, credentials.baseUrl);

  if (credentials.baseUrl && credentials.model) {
    await createHermesRealHome(credentials);
  }
}

function setHermesCredentialEnv(apiKey: string, baseUrl?: string) {
  const normalizedBaseUrl = baseUrl?.trim();
  if (normalizedBaseUrl) {
    process.env.OPENAI_BASE_URL = normalizedBaseUrl;
  }

  process.env.OPENAI_API_KEY = apiKey;
  process.env.ANTHROPIC_API_KEY = apiKey;
  process.env.OPENLOOMI_HERMES_REAL_PROVIDER_API_KEY = apiKey;

  if (normalizedBaseUrl && /openrouter\.ai/i.test(normalizedBaseUrl)) {
    process.env.OPENROUTER_API_KEY = apiKey;
  }
}

async function createHermesRealHome(credentials: HermesRealCredentials) {
  const hermesHome = await mkdtemp(join(repoTempDir, "openloomi-hermes-home-"));
  tempDirs.push(hermesHome);
  process.env.HERMES_HOME = hermesHome;

  const model = credentials.model?.trim();
  const baseUrl = credentials.baseUrl?.trim();
  if (!model || !baseUrl) {
    return;
  }

  await writeFile(
    join(hermesHome, "config.yaml"),
    [
      "model:",
      "  provider: openloomi-real",
      `  default: ${yamlString(model)}`,
      "",
      "agent:",
      "  coding_context: off",
      "  environment_probe: false",
      "  intent_ack_continuation: false",
      "  parallel_tool_call_guidance: false",
      "  task_completion_guidance: false",
      "  tool_use_enforcement: false",
      "  verify_on_stop: false",
      "  disabled_toolsets:",
      "    - hermes-acp",
      "",
      "auxiliary:",
      "  vision:",
      "    provider: none",
      "",
      "custom_providers:",
      "  - name: openloomi-real",
      `    base_url: ${yamlString(baseUrl)}`,
      "    key_env: OPENLOOMI_HERMES_REAL_PROVIDER_API_KEY",
      "    api_mode: anthropic_messages",
      `    model: ${yamlString(model)}`,
      "",
    ].join("\n"),
    "utf8",
  );
}

function yamlString(value: string) {
  return JSON.stringify(value);
}

function redirectHermesTestTempEnv() {
  const tempDir = join(repoTempDir, "temp");
  process.env.TEMP = tempDir;
  process.env.TMP = tempDir;
  process.env.UV_CACHE_DIR = join(repoTempDir, "uv-cache");
  process.env.UV_PYTHON_INSTALL_DIR = join(repoTempDir, "uv-python");
  process.env.PIP_CACHE_DIR = join(repoTempDir, "pip-cache");
  process.env.npm_config_cache = join(repoTempDir, "npm-cache");
  process.env.PLAYWRIGHT_BROWSERS_PATH = join(
    repoTempDir,
    "playwright-browsers",
  );

  const localHermesHome = join(repoTempDir, "hermes-home");
  if (!process.env.HERMES_HOME && existsSync(localHermesHome)) {
    process.env.HERMES_HOME = localHermesHome;
  }
}

async function fetchAnthropicCompatibleSmoke(
  credentials: HermesRealCredentials,
) {
  const baseUrl = credentials.baseUrl?.trim();
  const model = credentials.model?.trim();
  if (!baseUrl || !model) {
    throw new Error(
      "The OpenLoomi anthropic_compatible setting must include baseUrl and model for the direct real smoke.",
    );
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/v1/messages`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  timeout.unref?.();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "anthropic-version": "2023-06-01",
        authorization: `Bearer ${credentials.apiKey}`,
        "content-type": "application/json",
        "x-api-key": credentials.apiKey,
      },
      body: JSON.stringify({
        max_tokens: 32,
        messages: [
          {
            role: "user",
            content: "Reply with exactly: HERMES_OPENLOOMI_DIRECT_OK",
          },
        ],
        model,
      }),
      signal: controller.signal,
    });
    const body = await response.text();
    return {
      host: new URL(baseUrl).host,
      model,
      ok: response.ok,
      status: response.status,
      text: extractAnthropicText(body),
      bodyStart: body.slice(0, 500),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractAnthropicText(body: string) {
  try {
    const parsed = JSON.parse(body) as {
      content?: Array<{ text?: unknown; type?: unknown }>;
    };
    return (parsed.content || [])
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("");
  } catch {
    return body;
  }
}

function findLocalHermesCommand() {
  const localHermes = join(
    repoTempDir,
    "hermes-home",
    "hermes-agent",
    "venv",
    "Scripts",
    "hermes.exe",
  );
  return existsSync(localHermes) ? localHermes : "hermes";
}

function createHermesRealHost(): NativeAgentHost {
  const getUserLlmProviderConfig = vi.fn(async () => {
    throw new Error(
      "Hermes real smoke must not read Anthropic-compatible settings",
    );
  });

  return {
    registry: getAgentRegistry(),
    registerProviders: registerRealSmokeProviders,
    prepareRequest: (body) => resolveNativeAgentProviderRequest(body),
    getUserLlmProviderConfig,
    logger: console,
  };
}

function registerRealSmokeProviders() {
  if (providersRegistered) {
    return;
  }

  const registry = getAgentRegistry();
  registry.register(hermesPlugin);
  providersRegistered = true;
}

async function createTempWorkDir() {
  const baseDir = repoTempDir;
  await mkdir(baseDir, { recursive: true });
  const workDir = await mkdtemp(join(baseDir, "openloomi-hermes-real-"));
  tempDirs.push(workDir);
  await writeFile(
    join(workDir, "README.txt"),
    "Temporary OpenLoomi Hermes real smoke workspace.\n",
    "utf8",
  );
  return workDir;
}

function createContext(
  timeoutMs: number,
  abortController = new AbortController(),
  permissionHandler: NativeAgentRunnerContext["permissionHandler"] = async () => ({
    behavior: "deny" as const,
  }),
) {
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);
  timeout.unref?.();
  const userId =
    process.env.OPENLOOMI_HERMES_REAL_USER_ID?.trim() || "hermes-real-user";

  return {
    session: { user: { id: userId, type: "test" } },
    userId,
    abortController,
    permissionHandler,
    emitPermissionRequestEvents: true,
  };
}

async function collectMessagesWithTimeout(
  generator: AsyncGenerator<AgentMessage>,
  timeoutMs: number,
  abortController?: AbortController,
) {
  const messages: AgentMessage[] = [];
  const reader = (async () => {
    for await (const message of generator) {
      messages.push(message);
    }
  })();

  try {
    await withTimeout(reader, timeoutMs);
  } catch (error) {
    abortController?.abort();
    await withTimeout(
      reader.catch(() => undefined),
      5000,
    ).catch(() => undefined);
    console.info(
      "[Hermes real smoke partial messages before timeout]",
      JSON.stringify(messages, null, 2),
    );
    throw error;
  }

  return messages;
}

async function collectMessages(generator: AsyncGenerator<AgentMessage>) {
  const messages: AgentMessage[] = [];
  for await (const message of generator) {
    messages.push(message);
  }
  return messages;
}

function collectText(messages: AgentMessage[]) {
  return messages
    .map((message) => {
      if (message.type === "text" || message.type === "reasoning") {
        return message.content;
      }
      return "";
    })
    .join("");
}

function countDone(messages: AgentMessage[]) {
  return messages.filter((message) => message.type === "done").length;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
    }
    await sleep(50);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listHermesProcessIds() {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("powershell", [
        "-NoProfile",
        "-Command",
        "Get-Process | Where-Object { $_.ProcessName -like '*hermes*' } | ForEach-Object { $_.Id }",
      ]);
      return parseProcessIds(stdout);
    } catch {
      return new Set<number>();
    }
  }

  try {
    const { stdout } = await execFileAsync("pgrep", ["-f", "hermes"]);
    return parseProcessIds(stdout);
  } catch {
    return new Set<number>();
  }
}

async function expectNoNewHermesProcesses(beforePids: Set<number>) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  const afterPids = await listHermesProcessIds();
  const newPids = [...afterPids].filter((pid) => !beforePids.has(pid));
  expect(newPids).toEqual([]);
}

function parseProcessIds(stdout: string) {
  return new Set(
    stdout
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter(Number.isFinite),
  );
}
