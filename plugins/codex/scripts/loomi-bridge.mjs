#!/usr/bin/env node

const BRIDGE_VERSION = "0.1.0";

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

function phaseTwoNotice(command) {
  return {
    command,
    phase: "mvp-plugin-skeleton",
    implemented: false,
    message:
      "This command is part of the Phase 2 plugin skeleton. Runtime discovery and execution are implemented in later phases.",
  };
}

function setupStatus() {
  writeJson({
    mode: "unconfigured",
    installed: false,
    ctlPath: null,
    version: null,
    tokenPresent: false,
    aiProviderConfigured: false,
    connectorStatusAvailable: false,
    apiReachable: false,
    ready: false,
    nextAction: "install_openloomi",
    reason: "INSTALL_REQUIRED",
    ...phaseTwoNotice("setup-status"),
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
    ...phaseTwoNotice("install-instructions"),
  });
}

function version() {
  writeJson({
    name: "openloomi-codex-bridge",
    version: BRIDGE_VERSION,
    pluginPhase: "mvp-plugin-skeleton",
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
      ...phaseTwoNotice("run"),
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
      setupStatus();
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
