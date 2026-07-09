#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BRIDGE_VERSION = "0.2.0";
const PLUGIN_PHASE = "discovery-readiness";
const COMMAND_TIMEOUT_MS = 5000;
const MAX_COMMAND_OUTPUT = 4096;
const DEBUG_DISCOVERY = process.env.OPENLOOMI_DEBUG_DISCOVERY === "1";

const COMMANDS = new Set([
  "help",
  "install-instructions",
  "run",
  "setup-status",
  "version",
]);

function writeJson(payload, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = exitCode;
}

async function setupStatus() {
  const discovery = await discoverOpenLoomi();
  const token = getTokenStatus();
  const aiProvider = getAiProviderStatus();

  const baseStatus = {
    mode: discovery.mode,
    installed: discovery.installed,
    ctlPath: discovery.ctlPath,
    version: discovery.version,
    tokenPresent: token.present,
    aiProviderConfigured: aiProvider.configured,
    connectorStatusAvailable: false,
    apiReachable: false,
    discoverySource: discovery.source,
    sourceRoot: DEBUG_DISCOVERY ? discovery.sourceRoot : null,
    sourceRootPresent: Boolean(discovery.sourceRoot),
    bridge: {
      name: "openloomi-codex-bridge",
      version: BRIDGE_VERSION,
      phase: PLUGIN_PHASE,
    },
    checks: {
      auth: token.checked,
      aiProvider: aiProvider.checked,
      discovery: discovery.checked,
    },
  };

  writeJson({
    ...baseStatus,
    ...getReadinessDecision(discovery, token, aiProvider),
  });
}

function installInstructions() {
  writeJson({
    nextAction: "install_openloomi",
    reason: "INSTALL_REQUIRED",
    ready: false,
    instructions: [
      "Install OpenLoomi from an official release artifact.",
      "After installation, re-run setup-status from the Codex plugin.",
      "For a source checkout, configure OPENLOOMI_REPO_DIR or OPENLOOMI_CTL once the CLI is staged.",
    ],
    bridge: {
      name: "openloomi-codex-bridge",
      version: BRIDGE_VERSION,
      phase: PLUGIN_PHASE,
    },
  });
}

function version() {
  writeJson({
    name: "openloomi-codex-bridge",
    version: BRIDGE_VERSION,
    pluginPhase: PLUGIN_PHASE,
    commands: Array.from(COMMANDS).sort(),
  });
}

async function run() {
  await readStdin();

  writeJson(
    {
      ready: false,
      nextAction: "setup_status",
      reason: "RUN_NOT_IMPLEMENTED",
      command: "run",
      phase: PLUGIN_PHASE,
      implemented: false,
      message:
        "Task execution is implemented in a later phase. Run setup-status to inspect OpenLoomi readiness first.",
    },
    1,
  );
}

function help() {
  writeJson({
    usage: "node scripts/loomi-bridge.mjs <command>",
    commands: Array.from(COMMANDS).sort(),
  });
}

async function discoverOpenLoomi() {
  const checked = [];
  const explicitCtl = process.env.OPENLOOMI_CTL;

  if (explicitCtl) {
    const result = await validateCtlPath(expandHome(explicitCtl), {
      mode: "packaged",
      source: "OPENLOOMI_CTL",
      checked,
    });

    if (result.status === "found" || result.status === "invalid") {
      return result;
    }
  }

  for (const envName of ["OPENLOOMI_HOME", "OPENLOOMI_INSTALL_DIR"]) {
    const root = process.env[envName];

    if (!root) {
      continue;
    }

    const result = await validateRootCandidates(expandHome(root), {
      mode: "packaged",
      source: envName,
      checked,
    });

    if (result.status === "found" || result.status === "invalid") {
      return result;
    }
  }

  const sourceRoot = process.env.OPENLOOMI_REPO_DIR;

  if (sourceRoot) {
    const result = await inspectSourceCheckout(expandHome(sourceRoot), {
      source: "OPENLOOMI_REPO_DIR",
      checked,
    });

    if (result.status === "found" || result.status === "source-missing-cli") {
      return result;
    }
  }

  const pathResult = await validatePathLookup(checked);

  if (pathResult.status === "found") {
    return pathResult;
  }

  const platformRoots = getPlatformInstallRoots();
  let platformCandidatesChecked = 0;

  for (const root of platformRoots) {
    const platformChecked = [];
    const result = await validateRootCandidates(root, {
      mode: "packaged",
      source: "platform-default",
      checked: platformChecked,
    });
    platformCandidatesChecked += getCtlCandidatesForRoot(root).length;

    if (result.status === "found" || result.status === "invalid") {
      return {
        ...result,
        checked: [...checked, ...platformChecked],
      };
    }
  }

  checked.push({
    source: "platform-default",
    present: false,
    rootsChecked: platformRoots.length,
    candidatesChecked: platformCandidatesChecked,
  });

  const savedConfig = getSavedConfigCandidates();

  for (const config of savedConfig) {
    if (config.ctlPath) {
      const result = await validateCtlPath(config.ctlPath, {
        mode: "packaged",
        source: config.source,
        checked,
      });

      if (result.status === "found") {
        return result;
      }
    }

    if (config.root) {
      const result = await validateRootCandidates(config.root, {
        mode: "packaged",
        source: config.source,
        checked,
      });

      if (result.status === "found") {
        return result;
      }
    }
  }

  const cwdSource = await inspectSourceCheckout(process.cwd(), {
    source: "current-working-directory",
    checked,
  });

  if (
    cwdSource.status === "found" ||
    cwdSource.status === "source-missing-cli"
  ) {
    return cwdSource;
  }

  return {
    status: "missing",
    mode: "unconfigured",
    installed: false,
    ctlPath: null,
    version: null,
    source: null,
    sourceRoot: null,
    checked,
  };
}

async function validatePathLookup(checked) {
  const candidates = findOnPath("openloomi-ctl");

  for (const candidate of candidates) {
    const result = await validateCtlPath(candidate, {
      mode: "packaged",
      source: "PATH",
      checked,
      recordMissing: false,
    });

    if (result.status === "found") {
      return result;
    }
  }

  checked.push({
    source: "PATH",
    present: false,
    candidatesChecked: candidates.length,
  });

  return {
    status: "missing",
  };
}

async function inspectSourceCheckout(root, options) {
  const normalizedRoot = normalizePath(root);

  if (!normalizedRoot || !isDirectory(normalizedRoot)) {
    options.checked.push({
      source: options.source,
      present: false,
      ...debugPath("path", normalizedRoot),
    });

    return {
      status: "missing",
    };
  }

  if (!isSourceCheckout(normalizedRoot)) {
    options.checked.push({
      source: options.source,
      present: false,
      reason: "SOURCE_MARKERS_NOT_FOUND",
      ...debugPath("path", normalizedRoot),
    });

    return {
      status: "missing",
    };
  }

  const result = await validateRootCandidates(normalizedRoot, {
    mode: "source",
    source: options.source,
    checked: options.checked,
  });

  if (result.status === "found") {
    return {
      ...result,
      sourceRoot: normalizedRoot,
    };
  }

  return {
    status: "source-missing-cli",
    mode: "source",
    installed: false,
    ctlPath: null,
    version: null,
    source: options.source,
    sourceRoot: normalizedRoot,
    checked: options.checked,
  };
}

async function validateRootCandidates(root, options) {
  const normalizedRoot = normalizePath(root);
  const candidates = getCtlCandidatesForRoot(normalizedRoot);

  for (const candidate of candidates) {
    const result = await validateCtlPath(candidate, {
      ...options,
      recordMissing: false,
    });

    if (result.status === "found") {
      return result;
    }
  }

  options.checked.push({
    source: options.source,
    present: false,
    candidatesChecked: candidates.length,
    ...debugPath("root", normalizedRoot),
  });

  return {
    status: "missing",
  };
}

async function validateCtlPath(candidate, options) {
  const normalizedPath = normalizePath(candidate);

  if (!normalizedPath || !isFile(normalizedPath)) {
    if (options.recordMissing !== false) {
      options.checked.push({
        source: options.source,
        present: false,
        ...debugPath("path", normalizedPath),
      });
    }

    return {
      status: "missing",
    };
  }

  const versionResult = await runCommand(normalizedPath, ["--version"]);
  const version = firstLine(versionResult.stdout || versionResult.stderr);

  options.checked.push({
    source: options.source,
    present: true,
    versionValid: versionResult.exitCode === 0,
    ...debugPath("path", normalizedPath),
  });

  if (versionResult.exitCode !== 0) {
    return {
      status: "invalid",
      mode: options.mode,
      installed: false,
      ctlPath: normalizedPath,
      version,
      source: options.source,
      sourceRoot: null,
      checked: options.checked,
      commandError: {
        exitCode: versionResult.exitCode,
        signal: versionResult.signal,
      },
    };
  }

  return {
    status: "found",
    mode: options.mode,
    installed: true,
    ctlPath: normalizedPath,
    version,
    source: options.source,
    sourceRoot: null,
    checked: options.checked,
  };
}

function getReadinessDecision(discovery, token, aiProvider) {
  if (discovery.status === "invalid") {
    return {
      ready: false,
      nextAction: "provide_install_or_repo_path",
      reason: "OPENLOOMI_CTL_INVALID",
    };
  }

  if (discovery.status === "source-missing-cli") {
    return {
      ready: false,
      nextAction: "build_or_stage_openloomi_ctl",
      reason: "SOURCE_FOUND_CLI_NOT_BUILT",
    };
  }

  if (!discovery.installed) {
    return {
      ready: false,
      nextAction: "install_openloomi",
      reason: "INSTALL_REQUIRED",
    };
  }

  if (!token.present) {
    return {
      ready: false,
      nextAction: "login_openloomi",
      reason: "LOGIN_REQUIRED",
    };
  }

  if (!aiProvider.configured) {
    return {
      ready: false,
      nextAction: "configure_ai_provider",
      reason: "AI_PROVIDER_REQUIRED",
    };
  }

  return {
    ready: true,
    nextAction: "run",
    reason: "READY",
  };
}

function getTokenStatus() {
  const checked = [
    {
      key: "OPENLOOMI_AUTH_TOKEN",
      present: hasValue(process.env.OPENLOOMI_AUTH_TOKEN),
      source: "env",
    },
  ];

  const tokenPath = path.join(os.homedir(), ".openloomi", "token");

  checked.push({
    key: "~/.openloomi/token",
    present: isFile(tokenPath),
    source: "file",
  });

  return {
    present: checked.some((item) => item.present),
    checked,
  };
}

function getAiProviderStatus() {
  const providerKeys = [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENROUTER_API_KEY",
    "OPENLOOMI_AI_API_KEY",
  ];
  const optionalKeys = [
    "OPENAI_BASE_URL",
    "ANTHROPIC_BASE_URL",
    "OPENROUTER_BASE_URL",
    "OPENLOOMI_AI_BASE_URL",
    "OPENLOOMI_AI_MODEL",
  ];
  const checked = [...providerKeys, ...optionalKeys].map((key) => ({
    key,
    present: hasValue(process.env[key]),
    source: "env",
  }));

  return {
    configured: providerKeys.some((key) => hasValue(process.env[key])),
    checked,
  };
}

function getCtlCandidatesForRoot(root) {
  const normalizedRoot = normalizePath(root);

  if (!normalizedRoot) {
    return [];
  }

  const names = getCtlNames();
  const directories = [
    "",
    "bin",
    "cli",
    path.join("resources", "cli"),
    path.join("src-tauri", "cli"),
    path.join("target", "release"),
    path.join("apps", "web", "src-tauri", "cli"),
    path.join("apps", "web", "src-tauri", "target", "release"),
  ];

  return unique(
    directories.flatMap((directory) =>
      names.map((name) => path.join(normalizedRoot, directory, name)),
    ),
  );
}

function getCtlNames() {
  if (process.platform === "win32") {
    return [
      "openloomi-ctl.exe",
      "openloomi-ctl.cmd",
      "openloomi-ctl.bat",
      "openloomi-ctl",
    ];
  }

  return ["openloomi-ctl"];
}

function getPlatformInstallRoots() {
  const home = os.homedir();

  if (process.platform === "win32") {
    return unique(
      [
        process.env.LOCALAPPDATA &&
          path.join(process.env.LOCALAPPDATA, "OpenLoomi"),
        process.env.LOCALAPPDATA &&
          path.join(process.env.LOCALAPPDATA, "openloomi"),
        process.env.APPDATA && path.join(process.env.APPDATA, "OpenLoomi"),
        process.env.ProgramFiles &&
          path.join(process.env.ProgramFiles, "OpenLoomi"),
        process.env["ProgramFiles(x86)"] &&
          path.join(process.env["ProgramFiles(x86)"], "OpenLoomi"),
      ].filter(Boolean),
    );
  }

  if (process.platform === "darwin") {
    return [
      "/Applications/OpenLoomi.app/Contents/Resources",
      "/Applications/OpenLoomi.app/Contents/MacOS",
      path.join(home, "Applications", "OpenLoomi.app", "Contents", "Resources"),
      path.join(home, ".openloomi"),
    ];
  }

  return [
    "/opt/openloomi",
    "/usr/local/openloomi",
    path.join(home, ".local", "share", "openloomi"),
    path.join(home, ".openloomi"),
  ];
}

function getSavedConfigCandidates() {
  const candidates = [];
  const configPath = path.join(os.homedir(), ".openloomi", "codex-plugin.json");

  if (!isFile(configPath)) {
    return candidates;
  }

  try {
    const config = JSON.parse(readFileText(configPath));

    if (typeof config.openloomiCtl === "string") {
      candidates.push({
        ctlPath: expandHome(config.openloomiCtl),
        source: "~/.openloomi/codex-plugin.json",
      });
    }

    if (typeof config.openloomiHome === "string") {
      candidates.push({
        root: expandHome(config.openloomiHome),
        source: "~/.openloomi/codex-plugin.json",
      });
    }
  } catch {
    candidates.push({
      source: "~/.openloomi/codex-plugin.json",
      invalid: true,
    });
  }

  return candidates;
}

function findOnPath(commandName) {
  const pathValue = process.env.PATH || "";
  const names = process.platform === "win32" ? getCtlNames() : [commandName];

  return unique(
    pathValue
      .split(path.delimiter)
      .flatMap((directory) => names.map((name) => path.join(directory, name))),
  );
}

function isSourceCheckout(root) {
  return (
    isFile(path.join(root, "package.json")) &&
    isFile(path.join(root, "apps", "web", "src-tauri", "Cargo.toml"))
  );
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
    }, COMMAND_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        signal: null,
        stdout,
        stderr: error.message,
      });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        signal,
        stdout,
        stderr,
      });
    });
  });
}

function appendLimited(current, chunk) {
  return `${current}${chunk.toString("utf8")}`.slice(0, MAX_COMMAND_OUTPUT);
}

function firstLine(value) {
  const line = String(value || "")
    .split(/\r?\n/)
    .find((entry) => entry.trim().length > 0);

  return line ? line.trim() : null;
}

function readFileText(filePath) {
  return isFile(filePath) ? readFileSync(filePath, "utf8") : "";
}

function isFile(filePath) {
  try {
    return (
      Boolean(filePath) && existsSync(filePath) && statSync(filePath).isFile()
    );
  } catch {
    return false;
  }
}

function isDirectory(filePath) {
  try {
    return (
      Boolean(filePath) &&
      existsSync(filePath) &&
      statSync(filePath).isDirectory()
    );
  } catch {
    return false;
  }
}

function normalizePath(value) {
  return value ? path.resolve(expandHome(value)) : null;
}

function expandHome(value) {
  if (!value || !value.startsWith("~")) {
    return value;
  }

  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith(`~${path.sep}`) || value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function debugPath(key, value) {
  return DEBUG_DISCOVERY && value ? { [key]: value } : {};
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = "";

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => resolve(input));
    process.stdin.on("error", reject);

    if (process.stdin.isTTY) {
      resolve("");
    }
  });
}

async function main() {
  const command = process.argv[2] || "help";

  if (!COMMANDS.has(command)) {
    writeJson(
      {
        error: "UNKNOWN_COMMAND",
        message: `Unknown command: ${command}`,
        commands: Array.from(COMMANDS).sort(),
      },
      1,
    );
    return;
  }

  switch (command) {
    case "help":
      help();
      break;
    case "install-instructions":
      installInstructions();
      break;
    case "run":
      await run();
      break;
    case "setup-status":
      await setupStatus();
      break;
    case "version":
      version();
      break;
  }
}

main().catch((error) => {
  writeJson(
    {
      error: "BRIDGE_ERROR",
      message: error instanceof Error ? error.message : String(error),
    },
    1,
  );
});
