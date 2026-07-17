import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildNativeAgentCli } from "../../scripts/build-native-agent-cli.js";

const webDir = fileURLToPath(new URL("../..", import.meta.url));
const tempDirs: string[] = [];
let bundlePath: string;

beforeAll(async () => {
  const bundleDir = await mkdtemp(join(webDir, ".native-agent-cli-test-"));
  tempDirs.push(bundleDir);
  bundlePath = join(bundleDir, "native-agent-cli.cjs");
  await buildNativeAgentCli({
    output: bundlePath,
    logLevel: "silent",
    quiet: true,
  });
}, 30_000);

afterAll(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("packaged native-agent CLI bundle", () => {
  it("does not contain createRequire calls backed by an empty import_meta URL", async () => {
    const bundle = await readFile(bundlePath, "utf8");

    expect(bundle).toContain("__openloomiCjsImportMetaUrl");
    expect(bundle).toMatch(
      /createRequire\)?\(__openloomiCjsImportMetaUrl\)|createRequire\)\(__openloomiCjsImportMetaUrl\)/,
    );
    expect(bundle).not.toMatch(
      /createRequire\)?\(import_meta\d*\.url\)|createRequire\)\(import_meta\d*\.url\)/,
    );
  });

  it("executes the built CJS bundle through Codex without an Anthropic key", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "openloomi-bundled-codex-"));
    tempDirs.push(workDir);
    await writeFile(
      join(workDir, "exec"),
      [
        'console.log(JSON.stringify({ type: "thread.started", thread_id: "bundle-thread" }));',
        'console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", id: "message-1", text: "PACKAGED_CODEX_OK" } }));',
        'console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 2, output_tokens: 1 } }));',
      ].join("\n"),
      "utf8",
    );

    const tokenPayload = Buffer.from(
      JSON.stringify({
        id: "bundle-test-user",
        type: "regular",
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
      "utf8",
    ).toString("base64url");
    const input = {
      prompt: "Reply PACKAGED_CODEX_OK only.",
      authToken: `${tokenPayload}.test-signature`,
      platform: "cli-test",
      workDir,
      useProvidedWorkDir: true,
      cliPermissionMode: "deny",
      skillsConfig: {
        enabled: false,
        userDirEnabled: false,
        appDirEnabled: false,
      },
      mcpConfig: {
        enabled: false,
        userDirEnabled: false,
        appDirEnabled: false,
      },
    };

    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_OPTIONS: "--conditions=react-server",
      OPENLOOMI_AGENT_PROVIDER: "codex",
      OPENLOOMI_AGENT_CODEX_COMMAND: process.execPath,
      OPENLOOMI_AGENT_CODEX_SKIP_GIT_REPO_CHECK: "true",
      DEPLOYMENT_MODE: "tauri",
      IS_TAURI: "true",
      TAURI_MODE: "1",
      TAURI_DATA_DIR: join(workDir, "data"),
      TAURI_DB_PATH: join(workDir, "data", "data.db"),
    };
    childEnv.ANTHROPIC_API_KEY = undefined;
    childEnv.ANTHROPIC_AUTH_TOKEN = undefined;
    childEnv.CLAUDE_CODE_OAUTH_TOKEN = undefined;

    const result = await runProcess(
      process.execPath,
      [bundlePath],
      `${JSON.stringify(input)}\n`,
      { cwd: webDir, env: childEnv },
    );

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stderr).not.toContain("createRequire");
    const messages = result.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(messages).toContainEqual({
      kind: "result",
      output: expect.objectContaining({
        response: "PACKAGED_CODEX_OK",
        session_id: "bundle-thread",
        error: null,
      }),
    });
  });
});

function runProcess(
  command: string,
  args: string[],
  input: string,
  options: { cwd: string; env: NodeJS.ProcessEnv },
) {
  return new Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`native-agent bundle timed out: ${stderr}`));
    }, 15_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ exitCode, stdout, stderr });
    });
    child.stdin.end(input);
  });
}
