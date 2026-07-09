#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import https from "node:https";
import os from "node:os";
import path from "node:path";

const BRIDGE_VERSION = "0.5.0";
const PLUGIN_PHASE = "one-shot-execution";
const COMMAND_TIMEOUT_MS = 5000;
const RUN_TIMEOUT_MS = 120000;
const MAX_COMMAND_OUTPUT = 4096;
const DEBUG_DISCOVERY = process.env.OPENLOOMI_DEBUG_DISCOVERY === "1";

const COMMANDS = new Set([
  "configure-ai-provider",
  "help",
  "install-openloomi",
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
  writeJson(await buildSetupStatus());
}

async function buildSetupStatus() {
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

  return {
    ...baseStatus,
    ...getReadinessDecision(discovery, token, aiProvider),
  };
}

function installInstructions() {
  const plan = getInstallPlan();

  writeJson({
    nextAction: "install_openloomi",
    reason: "INSTALL_REQUIRED",
    ready: false,
    installPlan: plan,
    instructions: [
      "Install OpenLoomi from an official release artifact or provide a source checkout with a staged openloomi-ctl.",
      "The bridge will not download or launch an installer unless install-openloomi is called with --confirm.",
      "After installation, re-run setup-status from the Codex plugin.",
    ],
    bridge: {
      name: "openloomi-codex-bridge",
      version: BRIDGE_VERSION,
      phase: PLUGIN_PHASE,
    },
  });
}

async function installOpenLoomi(args) {
  const flags = parseFlags(args);
  const plan = getInstallPlan();

  if (!flags.confirm) {
    writeJson({
      ready: false,
      nextAction: "confirm_install_openloomi",
      reason: "INSTALL_CONFIRMATION_REQUIRED",
      installPlan: plan,
      command:
        "install-openloomi --confirm --artifact-url <official OpenLoomi installer URL> [--sha256 <sha256>] [--launch]",
      safety:
        "No download or installer launch has been performed. Re-run with --confirm only after reviewing the artifact source.",
    });
    return;
  }

  if (!flags.artifactUrl) {
    writeJson(
      {
        ready: false,
        nextAction: "provide_official_artifact_url",
        reason: "ARTIFACT_URL_REQUIRED",
        installPlan: plan,
        message:
          "A confirmed install requires --artifact-url pointing to an official OpenLoomi release artifact.",
      },
      1,
    );
    return;
  }

  const artifact = validateArtifactUrl(flags.artifactUrl);

  if (!artifact.valid) {
    writeJson(
      {
        ready: false,
        nextAction: "provide_official_artifact_url",
        reason: "ARTIFACT_URL_NOT_ALLOWED",
        message: artifact.reason,
        allowedHosts: getAllowedArtifactHosts(),
      },
      1,
    );
    return;
  }

  const download = await downloadInstallerArtifact(artifact.url);

  if (flags.sha256) {
    const actualSha256 = await sha256File(download.path);

    if (actualSha256.toLowerCase() !== flags.sha256.toLowerCase()) {
      writeJson(
        {
          ready: false,
          nextAction: "provide_valid_artifact",
          reason: "ARTIFACT_SHA256_MISMATCH",
          expectedSha256: flags.sha256,
          actualSha256,
          downloaded: true,
          launched: false,
        },
        1,
      );
      return;
    }
  }

  if (flags.launch) {
    launchInstaller(download.path);
  }

  writeJson({
    ready: false,
    nextAction: flags.launch
      ? "rerun_setup_status"
      : "run_downloaded_installer",
    reason: flags.launch ? "INSTALLER_LAUNCHED" : "INSTALLER_DOWNLOADED",
    downloaded: true,
    launched: Boolean(flags.launch),
    artifact: {
      url: artifact.url.toString(),
      sha256Verified: Boolean(flags.sha256),
      installerPath: DEBUG_DISCOVERY ? download.path : null,
      installerPathPresent: true,
    },
    message: flags.launch
      ? "The installer was launched after explicit confirmation. Re-run setup-status after installation completes."
      : "The installer was downloaded after explicit confirmation. Set OPENLOOMI_DEBUG_DISCOVERY=1 to show the local installer path, or re-run with --launch to start it.",
  });
}

function configureAiProvider(args) {
  const secretViolation = getSecretArgViolation(args);

  if (secretViolation) {
    writeJson(
      {
        ready: false,
        nextAction: "open_openloomi_ai_provider_setup",
        reason: "SECRET_INPUT_NOT_ALLOWED",
        rejectedFlag: secretViolation.flag,
        message:
          "API keys, OAuth tokens, and other secrets must not be passed through Codex chat or command-line arguments. Use an OpenLoomi-owned setup UI or CLI surface instead.",
      },
      1,
    );
    return;
  }

  const flags = parseFlags(args);
  const aiProvider = getAiProviderStatus();
  const codexOAuth = getCodexOAuthFeasibility();
  const setupRequest = getAiProviderSetupRequest(flags);

  writeJson({
    ready: aiProvider.configured,
    nextAction: aiProvider.configured
      ? "setup_status"
      : "open_openloomi_ai_provider_setup",
    reason: aiProvider.configured
      ? "AI_PROVIDER_CONFIGURED"
      : "AI_PROVIDER_REQUIRED",
    aiProviderConfigured: aiProvider.configured,
    checks: {
      aiProvider: aiProvider.checked,
    },
    codexOAuth,
    setupRequest,
    setupOptions: getAiProviderSetupOptions(codexOAuth),
    safety:
      "Only non-secret provider preferences may pass through Codex. API key entry must happen in OpenLoomi-owned UI or CLI surfaces.",
  });
}

function getInstallPlan() {
  return {
    platform: process.platform,
    arch: process.arch,
    supported: ["darwin", "linux", "win32"].includes(process.platform),
    officialReleasePage: "https://github.com/openloomi/openloomi/releases",
    requiredUserAction:
      "Review the official artifact URL, then re-run install-openloomi with --confirm.",
    safety: [
      "The plugin never downloads an installer without --confirm.",
      "The plugin never launches an installer without --launch.",
      "Use --sha256 when official checksum metadata is available.",
      "Local installer paths are hidden unless OPENLOOMI_DEBUG_DISCOVERY=1 is set.",
    ],
  };
}

function parseFlags(args) {
  const flags = {
    artifactUrl: null,
    baseUrl: null,
    confirm: false,
    launch: false,
    model: null,
    permissionMode: null,
    provider: null,
    sha256: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--confirm") {
      flags.confirm = true;
      continue;
    }

    if (arg === "--launch") {
      flags.launch = true;
      continue;
    }

    if (arg === "--provider") {
      flags.provider = args[index + 1] || null;
      index += 1;
      continue;
    }

    if (arg.startsWith("--provider=")) {
      flags.provider = arg.slice("--provider=".length);
      continue;
    }

    if (arg === "--base-url") {
      flags.baseUrl = args[index + 1] || null;
      index += 1;
      continue;
    }

    if (arg.startsWith("--base-url=")) {
      flags.baseUrl = arg.slice("--base-url=".length);
      continue;
    }

    if (arg === "--model") {
      flags.model = args[index + 1] || null;
      index += 1;
      continue;
    }

    if (arg.startsWith("--model=")) {
      flags.model = arg.slice("--model=".length);
      continue;
    }

    if (arg === "--permission-mode") {
      flags.permissionMode = args[index + 1] || null;
      index += 1;
      continue;
    }

    if (arg.startsWith("--permission-mode=")) {
      flags.permissionMode = arg.slice("--permission-mode=".length);
      continue;
    }

    if (arg === "--artifact-url") {
      flags.artifactUrl = args[index + 1] || null;
      index += 1;
      continue;
    }

    if (arg.startsWith("--artifact-url=")) {
      flags.artifactUrl = arg.slice("--artifact-url=".length);
      continue;
    }

    if (arg === "--sha256") {
      flags.sha256 = args[index + 1] || null;
      index += 1;
      continue;
    }

    if (arg.startsWith("--sha256=")) {
      flags.sha256 = arg.slice("--sha256=".length);
    }
  }

  return flags;
}

function getSecretArgViolation(args) {
  const secretFlags = [
    "--api-key",
    "--apikey",
    "--auth-token",
    "--oauth-token",
    "--refresh-token",
    "--secret",
    "--token",
  ];

  for (const arg of args) {
    const normalized = arg.toLowerCase();
    const flag = secretFlags.find(
      (candidate) =>
        normalized === candidate || normalized.startsWith(`${candidate}=`),
    );

    if (flag) {
      return {
        flag,
      };
    }
  }

  return null;
}

function getCodexOAuthFeasibility() {
  const markedSupported = process.env.OPENLOOMI_CODEX_OAUTH_SUPPORTED === "1";

  return {
    available: markedSupported,
    source: markedSupported
      ? "OPENLOOMI_CODEX_OAUTH_SUPPORTED"
      : "not-configured",
    reason: markedSupported
      ? "OFFICIAL_CODEX_OAUTH_SURFACE_MARKED_AVAILABLE"
      : "NO_OFFICIAL_CODEX_OAUTH_SURFACE_VERIFIED",
    note: "Codex OAuth should only be used after an official supported surface is verified.",
  };
}

function getAiProviderSetupRequest(flags) {
  return {
    provider: sanitizePreference(flags.provider),
    baseUrl: sanitizePreference(flags.baseUrl),
    model: sanitizePreference(flags.model),
    apiKeyProvided: false,
    secretInputAccepted: false,
  };
}

function getAiProviderSetupOptions(codexOAuth) {
  return [
    {
      id: "codex_oauth",
      available: codexOAuth.available,
      ownedBy: "Codex/OpenLoomi",
      collectsSecrets: false,
      reason: codexOAuth.reason,
    },
    {
      id: "openloomi_desktop_settings",
      available: true,
      ownedBy: "OpenLoomi",
      collectsSecrets: true,
      action:
        "Open OpenLoomi Desktop settings and configure provider base URL, API key, and model name there.",
    },
    {
      id: "openloomi_cli_interactive",
      available: true,
      ownedBy: "OpenLoomi",
      collectsSecrets: true,
      action:
        "Use an OpenLoomi-owned interactive CLI setup surface when openloomi-ctl exposes one.",
    },
  ];
}

function sanitizePreference(value) {
  if (!hasValue(value)) {
    return null;
  }

  return value.trim().slice(0, 256);
}

function validateArtifactUrl(value) {
  let url;

  try {
    url = new URL(value);
  } catch {
    return {
      valid: false,
      reason: "Artifact URL is not a valid URL.",
    };
  }

  if (url.protocol !== "https:") {
    return {
      valid: false,
      reason: "Artifact URL must use HTTPS.",
    };
  }

  if (!getAllowedArtifactHosts().includes(url.hostname)) {
    return {
      valid: false,
      reason: "Artifact URL host is not in the official OpenLoomi allowlist.",
    };
  }

  if (
    url.hostname === "github.com" &&
    !url.pathname.toLowerCase().startsWith("/openloomi/openloomi/")
  ) {
    return {
      valid: false,
      reason:
        "GitHub artifact URLs must come from the openloomi/openloomi repository.",
    };
  }

  return {
    valid: true,
    url,
  };
}

function getAllowedArtifactHosts() {
  return ["github.com", "openloomi.ai", "www.openloomi.ai"];
}

async function downloadInstallerArtifact(url) {
  const downloadDir = path.join(os.tmpdir(), "openloomi-codex-plugin");
  const destination = path.join(downloadDir, getInstallerFilename(url));

  mkdirSync(downloadDir, {
    recursive: true,
  });

  await downloadUrl(url, destination);

  return {
    path: destination,
  };
}

function getInstallerFilename(url) {
  const parsedPath = decodeURIComponent(url.pathname);
  const basename = path.basename(parsedPath);
  const fallbackName = `openloomi-installer-${Date.now()}${getInstallerExtension()}`;
  const filename = basename && basename !== "/" ? basename : fallbackName;

  return filename.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function getInstallerExtension() {
  if (process.platform === "win32") {
    return ".exe";
  }

  if (process.platform === "darwin") {
    return ".dmg";
  }

  return ".AppImage";
}

function downloadUrl(url, destination, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error("Too many redirects while downloading installer."));
      return;
    }

    const request = https.get(url, (response) => {
      const statusCode = response.statusCode || 0;
      const location = response.headers.location;

      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume();
        downloadUrl(new URL(location, url), destination, redirectCount + 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (statusCode !== 200) {
        response.resume();
        reject(new Error(`Installer download failed with HTTP ${statusCode}.`));
        return;
      }

      const file = createWriteStream(destination, {
        flags: "w",
      });

      response.pipe(file);
      file.on("finish", () => {
        file.close(resolve);
      });
      file.on("error", reject);
    });

    request.on("error", reject);
  });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.on("end", () => {
      resolve(hash.digest("hex"));
    });
    stream.on("error", reject);
  });
}

function launchInstaller(filePath) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? filePath
        : "xdg-open";
  const args =
    process.platform === "darwin" || process.platform === "linux"
      ? [filePath]
      : [];
  const child = spawn(command, args, {
    detached: true,
    shell: process.platform === "win32",
    stdio: "ignore",
    windowsHide: false,
  });

  child.unref();
}

function getPermissionMode(value) {
  const allowed = new Set(["allow", "ask", "deny"]);

  if (allowed.has(value)) {
    return value;
  }

  return "deny";
}

function runOpenLoomiOneShot({ ctlPath, permissionMode, prompt }) {
  return runCommandWithInput(
    ctlPath,
    ["--one-shot", "--stdin", "--json", "--permission-mode", permissionMode],
    prompt,
    RUN_TIMEOUT_MS,
  );
}

function runCommandWithInput(command, args, input, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
    }, timeoutMs);

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

    child.stdin.end(input);
  });
}

function normalizeRunFailure(result) {
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();

  if (output.includes("login") || output.includes("auth")) {
    return {
      nextAction: "login_openloomi",
      reason: "LOGIN_REQUIRED",
      openloomi: summarizeRunProcess(result),
    };
  }

  if (
    output.includes("api key") ||
    output.includes("model provider") ||
    output.includes("ai provider")
  ) {
    return {
      nextAction: "configure_ai_provider",
      reason: "AI_PROVIDER_REQUIRED",
      openloomi: summarizeRunProcess(result),
    };
  }

  if (output.includes("connector") || output.includes("integration")) {
    return {
      nextAction: "configure_connectors",
      reason: "CONNECTOR_SETUP_REQUIRED",
      openloomi: summarizeRunProcess(result),
    };
  }

  return {
    nextAction: "inspect_openloomi_error",
    reason: "OPENLOOMI_RUN_FAILED",
    openloomi: summarizeRunProcess(result),
    error: parseJsonOrText(result.stderr || result.stdout),
  };
}

function summarizeRunProcess(result) {
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    stdoutPresent: hasValue(result.stdout),
    stderrPresent: hasValue(result.stderr),
  };
}

function parseJsonOrText(value) {
  if (!hasValue(value)) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return {
      text: value.trim(),
    };
  }
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
  const flags = parseFlags(process.argv.slice(3));
  const prompt = await readStdin();

  if (!hasValue(prompt)) {
    writeJson(
      {
        ready: false,
        nextAction: "provide_stdin_prompt",
        reason: "PROMPT_REQUIRED",
        message:
          "Pass the task prompt over stdin. Do not place long prompts or secrets in command-line arguments.",
      },
      1,
    );
    return;
  }

  const setup = await buildSetupStatus();

  if (!setup.ready) {
    writeJson(
      {
        ...setup,
        ran: false,
        command: "run",
        message:
          "OpenLoomi is not ready for one-shot execution. Complete the reported nextAction first.",
      },
      1,
    );
    return;
  }

  const permissionMode = getPermissionMode(flags.permissionMode);
  const result = await runOpenLoomiOneShot({
    ctlPath: setup.ctlPath,
    permissionMode,
    prompt,
  });

  if (result.exitCode !== 0) {
    writeJson(
      {
        ready: false,
        ran: true,
        ...normalizeRunFailure(result),
      },
      1,
    );
    return;
  }

  writeJson({
    ready: true,
    ran: true,
    nextAction: "done",
    reason: "RUN_COMPLETE",
    result: parseJsonOrText(result.stdout),
    openloomi: {
      exitCode: result.exitCode,
      signal: result.signal,
      stderrPresent: hasValue(result.stderr),
    },
  });
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
    case "configure-ai-provider":
      configureAiProvider(process.argv.slice(3));
      break;
    case "help":
      help();
      break;
    case "install-openloomi":
      await installOpenLoomi(process.argv.slice(3));
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
