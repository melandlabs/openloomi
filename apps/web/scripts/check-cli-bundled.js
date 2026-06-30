import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  findBundledCliLayout,
  normalizePlatform,
  verifyBundledCliLayout,
} from "./cli-bundled.js";

function fail(message) {
  console.error(`[bundled CLI check] ${message}`);
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

function runCli(binaryPath, args, env = {}) {
  return spawnSync(binaryPath, args, {
    cwd: path.dirname(binaryPath),
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
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

function isolatedTokenEnv(tempRoot, platform) {
  const home = path.join(tempRoot, "home");
  fs.mkdirSync(home, { recursive: true });

  const env = {
    OPENLOOMI_AUTH_TOKEN: "",
    OPENLOOMI_API_URL: "",
    OPENLOOMI_CLI_DIRECT: "",
    HOME: home,
    USERPROFILE: home,
  };

  if (platform === "windows") {
    env.APPDATA = path.join(home, "AppData", "Roaming");
    env.LOCALAPPDATA = path.join(home, "AppData", "Local");
    fs.mkdirSync(env.APPDATA, { recursive: true });
    fs.mkdirSync(env.LOCALAPPDATA, { recursive: true });
  }

  return env;
}

function canExecutePlatform(platform) {
  return normalizePlatform(process.platform) === platform;
}

function prepareInputPath(inputPath) {
  const absoluteInput = path.resolve(inputPath);
  if (!fs.existsSync(absoluteInput)) {
    fail(`bundle/resource path not found: ${absoluteInput}`);
  }

  if (fs.statSync(absoluteInput).isFile() && absoluteInput.endsWith(".deb")) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openloomi-deb-"));
    const extractDir = path.join(tempRoot, "extract");
    fs.mkdirSync(extractDir, { recursive: true });
    const result = spawnSync("dpkg-deb", ["-x", absoluteInput, extractDir], {
      encoding: "utf8",
      timeout: 120_000,
    });
    if (result.error || result.status !== 0) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      throw new Error(
        `failed to extract deb package ${absoluteInput}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }
    return {
      checkPath: extractDir,
      cleanup: () => fs.rmSync(tempRoot, { recursive: true, force: true }),
    };
  }

  return { checkPath: absoluteInput, cleanup: () => {} };
}

function checkBundledCli(inputPath, options = {}) {
  const platform = normalizePlatform(options.platform ?? process.platform);
  const prepared = prepareInputPath(inputPath);

  try {
    const verification = verifyBundledCliLayout(prepared.checkPath, platform);
    if (!verification.ok) {
      fail(verification.error);
    }

    const layout = findBundledCliLayout(prepared.checkPath, platform);
    if (!canExecutePlatform(platform)) {
      console.log(
        `[bundled CLI check] Verified layout for ${platform}; skipped execution on ${process.platform}`,
      );
      return;
    }

    assertCommandOk("--version", runCli(layout.binaryPath, ["--version"]));
    assertCommandOk("--help", runCli(layout.binaryPath, ["--help"]));

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openloomi-cli-"));
    try {
      const missingToken = assertJsonStdout(
        "missing token JSON error",
        runCli(
          layout.binaryPath,
          [
            "--one-shot",
            "Reply with exactly: OK",
            "--json",
            "--permission-mode",
            "deny",
          ],
          isolatedTokenEnv(tempRoot, platform),
        ),
        1,
      );

      if (
        missingToken.ok !== false ||
        missingToken.error?.code !== "not_authenticated" ||
        !String(missingToken.error?.message ?? "").includes(
          "OPENLOOMI_AUTH_TOKEN",
        )
      ) {
        throw new Error(
          `unexpected missing-token JSON payload: ${JSON.stringify(missingToken)}`,
        );
      }
    } finally {
      if (process.env.OPENLOOMI_KEEP_CLI_BUNDLED_CHECK !== "1") {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    }

    console.log(`[bundled CLI check] Verified ${verification.binaryPath}`);
    console.log(`[bundled CLI check] Runner ${verification.runner}`);
    console.log(`[bundled CLI check] Runtime ${verification.runtimeAppDir}`);
  } finally {
    prepared.cleanup();
  }
}

const rawArgs = process.argv.slice(2);
const targetPath = positionalArgs(rawArgs)[0] ?? ".";

try {
  checkBundledCli(targetPath, {
    platform: parseOption(rawArgs, "--platform", undefined),
  });
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
