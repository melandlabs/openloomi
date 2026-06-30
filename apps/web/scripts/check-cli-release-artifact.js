import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import * as tar from "tar";

import {
  findCliRunnerArtifact,
  getCliBinaryName,
  hasExecutablePermission,
  normalizePlatform,
  verifyCliArtifact,
} from "./cli-artifact.js";

function fail(message) {
  console.error(`[CLI artifact check] ${message}`);
  process.exit(1);
}

function parseOption(args, name, fallback) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) {
    return inline.slice(name.length + 1);
  }

  const index = args.indexOf(name);
  if (index !== -1) {
    return args[index + 1] ?? fallback;
  }

  return fallback;
}

function positionalArgs(args) {
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      if (!arg.includes("=")) {
        index += 1;
      }
      continue;
    }
    positional.push(arg);
  }
  return positional;
}

function inferPlatform(artifactPath) {
  const name = path.basename(artifactPath).toLowerCase();
  if (name.includes("windows")) return "windows";
  if (name.includes("macos") || name.includes("darwin")) return "macos";
  if (name.includes("linux")) return "linux";
  return process.platform;
}

async function extractArtifact(artifactPath, destination) {
  if (artifactPath.endsWith(".zip")) {
    const zip = new AdmZip(artifactPath);
    zip.extractAllTo(destination, true);
    return;
  }

  if (artifactPath.endsWith(".tar.gz") || artifactPath.endsWith(".tgz")) {
    await tar.extract({ file: artifactPath, cwd: destination });
    return;
  }

  throw new Error(`Unsupported CLI artifact extension: ${artifactPath}`);
}

function findExtractedArtifactRoot(extractDir, platform) {
  const binaryName = getCliBinaryName(platform);
  const topLevel = path.join(extractDir, binaryName);
  if (fs.existsSync(topLevel)) {
    return extractDir;
  }

  for (const entry of fs.readdirSync(extractDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = path.join(extractDir, entry.name);
    if (fs.existsSync(path.join(candidate, binaryName))) {
      return candidate;
    }
  }

  return extractDir;
}

function runCli(root, platform, args, env = {}) {
  const binaryPath = path.join(root, getCliBinaryName(platform));
  return spawnSync(binaryPath, args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
  });
}

function runCliAsync(root, platform, args, env = {}) {
  const binaryPath = path.join(root, getCliBinaryName(platform));
  return new Promise((resolve) => {
    const child = spawn(binaryPath, args, {
      cwd: root,
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({
        status: null,
        stdout,
        stderr,
        error: new Error(`command timed out: ${binaryPath} ${args.join(" ")}`),
      });
    }, 120_000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({ status: null, stdout, stderr, error });
    });
    child.on("close", (status) => {
      clearTimeout(timeout);
      resolve({ status, stdout, stderr });
    });
  });
}

function assertCommandOk(label, result) {
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${label} failed with exit code ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
}

function assertJsonStdout(label, result, expectedExit) {
  if (result.error) {
    throw result.error;
  }
  if (result.status !== expectedExit) {
    throw new Error(
      `${label} exited ${result.status}, expected ${expectedExit}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  if (result.stderr.trim()) {
    throw new Error(`${label} polluted stderr:\n${result.stderr}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} did not emit valid JSON: ${error.message}`);
  }
}

async function withMockAgentServer(callback) {
  const server = http.createServer((request, response) => {
    if (!request.url?.startsWith("/api/native/agent")) {
      response.writeHead(404);
      response.end("not found");
      return;
    }

    if (request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"ok":true}');
      return;
    }

    if (request.method !== "POST") {
      response.writeHead(405);
      response.end("method not allowed");
      return;
    }

    request.resume();
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
    });
    response.write('data: {"type":"session","sessionId":"artifact-check"}\n\n');
    response.write('data: {"type":"text","content":"OK"}\n\n');
    response.write('data: {"type":"done"}\n\n');
    response.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("mock agent server did not expose a TCP address");
    }
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function checkArtifact(artifactPath, options = {}) {
  const absoluteArtifact = path.resolve(artifactPath);
  if (!fs.existsSync(absoluteArtifact)) {
    fail(`artifact file not found: ${absoluteArtifact}`);
  }

  const platform = normalizePlatform(
    options.platform ?? inferPlatform(absoluteArtifact),
  );
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "openloomi-cli-release-"),
  );
  const extractDir = path.join(tempRoot, "extract");
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    await extractArtifact(absoluteArtifact, extractDir);
    const root = findExtractedArtifactRoot(extractDir, platform);

    const verification = verifyCliArtifact(root, platform);
    if (!verification.ok) {
      fail(verification.error);
    }

    const binaryPath = path.join(root, getCliBinaryName(platform));
    if (platform !== "windows") {
      const mode = fs.statSync(binaryPath).mode;
      if (!hasExecutablePermission(mode)) {
        fail(`extracted CLI binary is not executable: ${binaryPath}`);
      }
    }

    const runner = findCliRunnerArtifact(root);
    if (!runner) {
      fail(`native-agent runner missing after extraction: ${root}`);
    }

    const resources = path.join(root, "resources", ".next", "standalone");
    if (!fs.existsSync(resources) || !fs.statSync(resources).isDirectory()) {
      fail(`standalone resources missing after extraction: ${resources}`);
    }

    const readme = path.join(root, "README.md");
    if (!fs.existsSync(readme)) {
      fail(`artifact README missing after extraction: ${readme}`);
    }
    const readmeText = fs.readFileSync(readme, "utf8");
    if (!readmeText.includes("Node.js 22 or newer")) {
      fail("artifact README does not document the Node.js runtime requirement");
    }

    assertCommandOk("--version", runCli(root, platform, ["--version"]));
    assertCommandOk("--help", runCli(root, platform, ["--help"]));

    const usageError = assertJsonStdout(
      "JSON usage error",
      runCli(root, platform, ["--one-shot", "--json", "--bad-option"]),
      2,
    );
    if (usageError.ok !== false || usageError.error?.code !== "usage") {
      throw new Error(
        `unexpected JSON usage payload: ${JSON.stringify(usageError)}`,
      );
    }

    await withMockAgentServer(async (baseUrl) => {
      const oneShot = assertJsonStdout(
        "mock one-shot",
        await runCliAsync(
          root,
          platform,
          [
            "--one-shot",
            "Reply with exactly: OK",
            "--json",
            "--permission-mode",
            "deny",
          ],
          {
            OPENLOOMI_API_URL: baseUrl,
            OPENLOOMI_AUTH_TOKEN: "artifact-check-token",
          },
        ),
        0,
      );
      if (oneShot.ok !== true || oneShot.response !== "OK") {
        throw new Error(
          `unexpected mock one-shot payload: ${JSON.stringify(oneShot)}`,
        );
      }
    });

    console.log(`[CLI artifact check] Verified ${absoluteArtifact}`);
    console.log(`[CLI artifact check] Extracted root: ${root}`);
    console.log(`[CLI artifact check] Runner: ${runner}`);
  } finally {
    if (process.env.OPENLOOMI_KEEP_CLI_ARTIFACT_CHECK !== "1") {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

const rawArgs = process.argv.slice(2);
const artifact = positionalArgs(rawArgs)[0];
if (!artifact) {
  fail(
    "Usage: node scripts/check-cli-release-artifact.js <artifact.zip|artifact.tar.gz> [--platform <platform>]",
  );
}

checkArtifact(artifact, {
  platform: parseOption(rawArgs, "--platform", undefined),
}).catch((error) =>
  fail(error instanceof Error ? error.message : String(error)),
);
