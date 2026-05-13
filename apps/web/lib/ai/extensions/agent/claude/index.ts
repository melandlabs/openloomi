/**
 * Claude Agent SDK Adapter
 *
 * Implementation of the IAgent interface using @anthropic-ai/claude-agent-sdk
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import {
  createSdkMcpServer,
  type Options,
  query,
  tool,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import {
  BaseAgent,
  formatPlanForExecution,
  getWorkspaceInstruction,
  parsePlanFromResponse,
  parsePlanningResponse,
  PLANNING_INSTRUCTION,
  type SandboxOptions,
} from "@openloomi/ai/agent";
// Import plugin definition helpers
import { CLAUDE_METADATA, defineAgentPlugin } from "@openloomi/ai/agent/plugin";
import type { AgentPlugin } from "@openloomi/ai/agent/plugin";
import type {
  AgentConfig,
  AgentMessage,
  AgentOptions,
  AgentProvider,
  ConversationMessage,
  ExecuteOptions,
  ImageAttachment,
  McpConfig,
  PDFAttachment,
  PlanOptions,
  SkillsConfig,
} from "@openloomi/ai/agent/types";
import { MAX_CONVERSATION_HISTORY_TOKENS } from "@/lib/ai/runtime/shared";
import {
  DEFAULT_API_HOST,
  DEFAULT_API_PORT,
  DEFAULT_WORK_DIR,
} from "@/lib/env/config/constants";
import { DEFAULT_AI_MODEL } from "@/lib/env/constants";
import {
  PDF_MAX_PAGES,
  PDF_MAX_SIZE_MB,
  PREFER_NATIVE_PDF,
} from "@/lib/files/config";
import { filterToolCallText } from "@openloomi/shared";
import { generateUUID } from "@/lib/utils";
import { estimateTokens } from "@/lib/ai";
import {
  loadMcpServers,
  createBusinessToolsMcpServer,
  type McpServerConfig,
} from "@/lib/ai/mcp";

// Skills are loaded directly by Claude SDK from ~/.openloomi/skills/ via settingSources: ['user']
// No custom loading needed
// ============================================================================
// Logging - uses shared logger (writes to ~/.openloomi/logs/openloomi.log)
// ============================================================================
import { createLogger, LOG_FILE_PATH } from "@/lib/utils/logger";

const logger = createLogger("ClaudeAgent");

// Sandbox API URL - use the main API's sandbox endpoints
// API port: 2620 for production, 2026 for development
// In dev mode (NODE_ENV not set or 'development'), use 2026
const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === "development";
const API_PORT =
  process.env.PORT || (isDev ? "2026" : String(DEFAULT_API_PORT));
const SANDBOX_API_URL =
  process.env.SANDBOX_API_URL || `http://${DEFAULT_API_HOST}:${API_PORT}`;

/**
 * Spawn Claude Code process with proper shell support
 * This ensures shell scripts (.sh, .cmd) are executed correctly
 */
function spawnClaudeCodeProcess(options: {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string | undefined>;
  signal?: AbortSignal;
}) {
  const { spawn, exec } = require("node:child_process");
  const os = platform();

  // Kill the entire process tree on Windows when abort is signaled.
  // Node.js's AbortController only kills the immediate child, but on Windows
  // cmd.exe does not propagate SIGTERM/SIGKILL to its children — the grandchild
  // CLI process can outlive the abort. Using taskkill /F /T /PID ensures all
  // descendants are terminated.
  const registerWindowsTreeKill = (childProcess: ReturnType<typeof spawn>) => {
    if (os === "win32" && childProcess.pid) {
      childProcess.signal?.addEventListener("abort", () => {
        exec(
          `taskkill /F /T /PID ${childProcess.pid}`,
          { windowsHide: true },
          (err: Error | null) => {
            // Ignore errors — process may already be dead
          },
        );
      });
    }
  };

  // Resolve cwd to an absolute path on Windows to prevent spawn() from
  // falling back to process.cwd() when given a relative or invalid path.
  // On Windows, spawn() with a relative cwd uses the current process dir,
  // which can cause the agent to run in the wrong directory (e.g. cli-bundle).
  let resolvedCwd = options.cwd;
  if (resolvedCwd) {
    const isAbsolute =
      os === "win32"
        ? /^[a-zA-Z]:[\\/]/.test(resolvedCwd) // e.g. C:\ or C:/
        : resolvedCwd.startsWith("/");
    if (!isAbsolute) {
      // Convert relative path to absolute
      resolvedCwd = join(process.cwd(), resolvedCwd);
    }
  }

  // For bundled Claude Code, execute cli.js directly with bundled node (or system node as fallback)
  // This avoids shell issues and environment variable leaking
  // Detect bundled Claude Code wrapper (both Unix .sh and Windows .cmd)
  const isBundledClaude =
    (options.command.endsWith(".sh") || options.command.endsWith(".cmd")) &&
    options.command.includes("cli-bundle");

  if (isBundledClaude) {
    // Normalize path separators for cross-platform use
    const normalizedCommand = options.command.replace(/\\/g, "/");
    const bundleDir = normalizedCommand.split("/").slice(0, -1).join("/");
    const cliJsPath = join(bundleDir, "cli.js");

    let nodeToUse: string;
    if (os === "win32") {
      // On Windows, the bundled node is a Linux ELF binary (not usable).
      // Try the Rust-downloaded .openloomi\node\node.exe first, then system PATH.
      const openloomiNode = join(homedir(), ".openloomi", "node", "node.exe");
      nodeToUse = existsSync(openloomiNode) ? openloomiNode : "node";
    } else {
      // Unix: use bundled node if it exists, otherwise system node
      const nodeBinPath = join(bundleDir, "node");
      nodeToUse = existsSync(nodeBinPath) ? nodeBinPath : "node";
    }

    const childProcess = spawn(nodeToUse, [cliJsPath, ...options.args], {
      cwd: resolvedCwd,
      env: { ...options.env, CLAUDECODE: "" },
      stdio: ["pipe", "pipe", "pipe"],
      signal: options.signal,
      windowsHide: true,
    });
    registerWindowsTreeKill(childProcess);

    // CRITICAL: Also update global process.env immediately after spawn
    // to ensure child process doesn't inherit CLAUDECODE from parent process
    process.env.CLAUDECODE = "";

    return childProcess;
  }

  // For other shell scripts, use the appropriate shell
  const isShellScript =
    options.command.endsWith(".sh") || options.command.endsWith(".cmd");

  if (isShellScript) {
    if (os === "win32") {
      // Windows: use cmd.exe to execute .cmd files
      const childProcess = spawn(
        "cmd.exe",
        ["/c", options.command, ...options.args],
        {
          cwd: resolvedCwd,
          env: options.env,
          stdio: ["pipe", "pipe", "pipe"],
          signal: options.signal,
          windowsHide: true,
        },
      );
      registerWindowsTreeKill(childProcess);
      return childProcess;
    }

    // Unix-like: use sh with full path to execute .sh files
    // IMPORTANT: Use full path /bin/sh since PATH may not be set correctly in spawn
    const childProcess = spawn(
      "/bin/sh",
      [
        "-c",
        `unset CLAUDECODE && exec "$0" "$@"`,
        options.command,
        ...options.args,
      ],
      {
        cwd: resolvedCwd,
        env: options.env,
        stdio: ["pipe", "pipe", "pipe"],
        signal: options.signal,
        windowsHide: true,
      },
    );
    registerWindowsTreeKill(childProcess);
    return childProcess;
  }

  // Direct spawn for executables
  const childProcess = spawn(options.command, options.args, {
    cwd: resolvedCwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
    signal: options.signal,
    windowsHide: true,
  });
  registerWindowsTreeKill(childProcess);
  return childProcess;
}

/**
 * Check if running with administrator/elevated privileges
 */
function hasElevatedPrivileges(): boolean {
  const os = platform();
  if (os !== "win32") {
    // Unix-like: check if running as root
    return process.getuid?.() === 0;
  }
  // Windows: no simple way to check without external modules
  // We'll detect elevation failures during install
  return false;
}

/**
 * Detect if running in PowerShell environment
 */
function isPowerShell(): boolean {
  return (
    process.env.PSModulePath !== undefined ||
    process.title?.includes("pwsh") ||
    process.title?.includes("powershell")
  );
}

/**
 * Get platform-specific installation instructions
 */
function getInstallationInstructions(os: string): string {
  switch (os) {
    case "win32":
      return `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📦 INSTALL CLAUDE CODE (Windows)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Option 1 - RECOMMENDED: Download installer
  → Visit: https://github.com/anthropics/claude-code/releases
  → Download and run the .exe installer

Option 2: Install via npm
  → Open Command Prompt or PowerShell as Administrator
  → Run: npm install -g @anthropic-ai/claude-code

Option 3: Install via winget
  → Run: winget install claude-code

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    case "darwin":
      return `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📦 INSTALL CLAUDE CODE (macOS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Option 1 - RECOMMENDED: Install via Homebrew
  → Run: brew install claude-code

Option 2: Install via npm
  → Run: npm install -g @anthropic-ai/claude-code

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    default:
      return `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📦 INSTALL CLAUDE CODE (Linux)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Option 1: Install via npm
  → Run: npm install -g @anthropic-ai/claude-code

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  }
}

/**
 * Attempt to install Claude Code automatically
 * Returns true if installation was successful
 */
async function installClaudeCode(): Promise<boolean> {
  const os = platform();
  const shellInfo = isPowerShell() ? " (PowerShell)" : "";
  console.log(
    `[Claude] Attempting to install Claude Code on ${os}${shellInfo}...`,
  );

  try {
    if (os === "darwin") {
      // macOS: Try Homebrew first, then npm
      try {
        console.log("[Claude] Installing via Homebrew...");
        execSync("brew install claude-code", {
          encoding: "utf-8",
          stdio: "inherit",
        });
        console.log("[Claude] ✓ Successfully installed via Homebrew");
        return true;
      } catch {
        console.log("[Claude] Homebrew failed, trying npm...");
      }
    } else if (os === "win32") {
      // Windows: Don't auto-install via npm (often fails without admin rights)
      // Instead, provide clear instructions to user
      console.error("[Claude] Claude Code is not installed on your system.");
      console.error(getInstallationInstructions(os));
      console.error(
        "[Claude] After installation, please restart openloomi to continue.",
      );
      return false;
    }

    // Fallback: Use npm (works on all platforms)
    console.log("[Claude] Installing via npm...");
    const hasElevation = hasElevatedPrivileges();

    if (os === "linux" && !hasElevation) {
      console.warn(
        "[Claude] ⚠️  Warning: Installing without sudo. If installation fails, try: sudo npm install -g @anthropic-ai/claude-code",
      );
    }

    execSync("npm install -g @anthropic-ai/claude-code", {
      encoding: "utf-8",
      stdio: "inherit",
    });

    console.log("[Claude] ✓ Successfully installed via npm");
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error("[Claude] ✗ Failed to install Claude Code automatically");
    console.error(`[Claude] Error: ${errorMessage}`);

    // Provide platform-specific guidance
    if (os === "win32") {
      console.error(
        "[Claude] Please run Command Prompt or PowerShell as Administrator and try again.",
      );
    } else if (os === "linux" && !hasElevatedPrivileges()) {
      console.error(
        "[Claude] Try installing with sudo: sudo npm install -g @anthropic-ai/claude-code",
      );
    }

    console.error(getInstallationInstructions(os));
    return false;
  }
}

/**
 * Check if running in a packaged Tauri app environment
 */
function isPackagedApp(): boolean {
  // Check if running from a bundled binary (via pkg)
  // @ts-expect-error - pkg specific property
  if (process.pkg) {
    return true;
  }

  // Check for Tauri environment
  if (process.env.TAURI_ENV || process.env.TAURI) {
    return true;
  }

  // Check if executable path contains typical app bundle paths
  const execPath = process.execPath;
  if (
    execPath.includes(".app/Contents/MacOS") ||
    execPath.includes("\\openloomi\\") ||
    execPath.includes("/openloomi/")
  ) {
    return true;
  }

  // Check for production environment
  if (process.env.NODE_ENV === "production") {
    return true;
  }

  return false;
}

/**
 * Get the target triple for the current platform
 */
export function getTargetTriple(): string {
  const os = platform();
  const cpuArch = arch();

  if (os === "darwin") {
    return cpuArch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  if (os === "linux") {
    return cpuArch === "arm64"
      ? "aarch64-unknown-linux-gnu"
      : "x86_64-unknown-linux-gnu";
  }
  if (os === "win32") {
    return "x86_64-pc-windows-msvc";
  }

  return "unknown";
}

/**
 * Get the path to bundled sidecar Claude Code executable
 * The bundle structure is:
 * - claude-{target} or claude (launcher script)
 * - claude-bundle/
 *   - node (Node.js binary)
 *   - node_modules/@anthropic-ai/claude-code/ (Claude Code package)
 */
/**
 * Get the path to the bundled sidecar Claude Code.
 * Searches for cli-bundle directory and creates a wrapper script to use the bundled node.
 * The wrapper script is written to the exec directory and returned as the Claude Code path.
 */
function getSidecarClaudeCodePath(): string | undefined {
  const os = platform();
  const execDir = dirname(process.execPath);

  // Possible locations for the bundled Claude Code (cli-bundle directory)
  const bundleLocations = [
    // Dev mode: check apps/web/cli-bundle (monorepo structure)
    join(process.cwd(), "apps", "web", "cli-bundle"),
    join(process.cwd(), "cli-bundle"),
    join(process.cwd(), "..", "web", "cli-bundle"),
    // Same directory as openloomi-api
    join(execDir, "cli-bundle"),
    // macOS: Tauri places resources in Resources
    join(execDir, "..", "Resources", "cli-bundle"),
    // macOS: Tauri places resources with preserved path structure
    join(execDir, "..", "Resources", "_up_", "src-api", "dist", "cli-bundle"),
    // Windows: Tauri places resources relative to exe
    join(execDir, "_up_", "src-api", "dist", "cli-bundle"),
    // Linux: Tauri deb/rpm places resources in /usr/lib/<AppName>/
    join(
      execDir,
      "..",
      "lib",
      "openloomi",
      "_up_",
      "src-api",
      "dist",
      "cli-bundle",
    ),
    join(
      execDir,
      "..",
      "lib",
      "openloomi",
      "_up_",
      "src-api",
      "dist",
      "cli-bundle",
    ),
    // Legacy claude-bundle for backward compatibility
    join(execDir, "claude-bundle"),
    join(execDir, "..", "Resources", "claude-bundle"),
  ];

  for (const bundleDir of bundleLocations) {
    if (!existsSync(bundleDir)) continue;

    // New bundle structure: files are directly in bundle directory (cli.js, vendor/, node)
    const claudeCliPath = join(bundleDir, "cli.js");
    const nodeBinPath = join(bundleDir, os === "win32" ? "node.exe" : "node");
    const vendorDir = join(bundleDir, "vendor");

    if (existsSync(claudeCliPath) && existsSync(vendorDir)) {
      // Create a wrapper script directly in the bundle directory
      const wrapperScriptName = os === "win32" ? "claude.cmd" : "claude.sh";
      const wrapperScriptPath = join(bundleDir, wrapperScriptName);
      const hasBundledNode = existsSync(nodeBinPath);

      // Only create the wrapper if it doesn't exist
      if (!existsSync(wrapperScriptPath)) {
        if (os === "win32") {
          // Windows batch file
          // Priority: bundled node.exe > .openloomi\node\node.exe (Rust-downloaded) > system node
          const wrapperContent = `@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set NODE_OPTIONS=--max-old-space-size=8192
if exist "%~dp0\\node.exe" (
  "%~dp0\\node.exe" --max-old-space-size=8192 "%~dp0\\cli.js" %*
) else (
  if exist "%USERPROFILE%\\.openloomi\\node\\node.exe" (
    "%USERPROFILE%\\.openloomi\\node\\node.exe" --max-old-space-size=8192 "%~dp0\\cli.js" %*
  ) else (
    node --max-old-space-size=8192 "%~dp0\\cli.js" %*
  )
)
endlocal`;
          writeFile(wrapperScriptPath, wrapperContent, { mode: 0o644 });
        } else {
          // Unix shell script - prefer bundled node, fall back to system node
          // Use \n to ensure Unix line endings
          const wrapperContent = hasBundledNode
            ? `#!/bin/bash\ncd "$(dirname "$0")"\nexec "$(dirname "$0")/node" --max-old-space-size=8192 "$(dirname "$0")/cli.js" "$@"\n`
            : `#!/bin/bash\ncd "$(dirname "$0")"\nif [ -x "$(dirname "$0")/node" ]; then\n  exec "$(dirname "$0")/node" --max-old-space-size=8192 "$(dirname "$0")/cli.js" "$@"\nelse\n  exec node --max-old-space-size=8192 "$(dirname "$0")/cli.js" "$@"\nfi\n`;
          writeFile(wrapperScriptPath, wrapperContent, { mode: 0o755 });
        }
      }

      console.log(
        `[Claude] Using bundled Claude Code: ${wrapperScriptPath}${
          hasBundledNode ? " (bundled node)" : " (system node)"
        }`,
      );
      return wrapperScriptPath;
    }
  }
}

/**
 * Build extended PATH that includes common package manager bin locations
 */
function getExtendedPath(): string {
  const home = homedir();
  const os = platform();
  const isWindows = os === "win32";
  const pathSeparator = isWindows ? ";" : ":";

  const paths = [process.env.PATH || ""];

  if (isWindows) {
    // Windows paths
    paths.push(
      join(home, "AppData", "Roaming", "npm"),
      join(home, "AppData", "Local", "Programs", "nodejs"),
      join(home, ".volta", "bin"),
      "C:\\Program Files\\nodejs",
      "C:\\Program Files (x86)\\nodejs",
    );
  } else {
    // Unix paths
    paths.push(
      "/usr/local/bin",
      "/opt/homebrew/bin",
      `${home}/.local/bin`,
      `${home}/.npm-global/bin`,
      `${home}/.volta/bin`,
      `${home}/code/node/npm_global/bin`,
    );

    // Add nvm paths (Unix only)
    const nvmDir = join(home, ".nvm", "versions", "node");
    try {
      if (existsSync(nvmDir)) {
        const versions = readdirSync(nvmDir);
        for (const version of versions) {
          paths.push(join(nvmDir, version, "bin"));
        }
      }
    } catch {
      // nvm not installed
    }
  }

  return paths.join(pathSeparator);
}

/**
 * Get the path to the claude-code executable.
 * Priority order:
 * 1. Bundled sidecar Claude Code (if app was built with runtime)
 * 2. CLAUDE_CODE_PATH env var
 * 3. User-installed Claude Code (via which/where, npm global, common paths, nvm, etc.)
 */
function getClaudeCodePath(): string | undefined {
  // Priority 1: Check for bundled sidecar Claude Code first
  const sidecarPath = getSidecarClaudeCodePath();
  if (sidecarPath) {
    return sidecarPath;
  }

  const os = platform();
  const extendedEnv = { ...process.env, PATH: getExtendedPath() };

  // Priority 2: Check if CLAUDE_CODE_PATH env var is set
  if (
    process.env.CLAUDE_CODE_PATH &&
    existsSync(process.env.CLAUDE_CODE_PATH)
  ) {
    console.log(
      `[Claude] Using CLAUDE_CODE_PATH: ${process.env.CLAUDE_CODE_PATH}`,
    );
    return process.env.CLAUDE_CODE_PATH;
  }

  // Priority 3: Check for user-installed Claude Code via 'which'/'where' with extended PATH
  try {
    if (os === "win32") {
      const whereResult = execSync("where claude", {
        encoding: "utf-8",
        stdio: "pipe",
        env: extendedEnv,
      }).trim();
      const firstPath = whereResult.split("\n")[0];
      if (firstPath && existsSync(firstPath)) {
        console.log(
          `[Claude] ✓ Found user-installed Claude Code at: ${firstPath}`,
        );
        return firstPath;
      }
    } else {
      // Try with login shell to get user's PATH
      try {
        const shellWhichResult = execSync('bash -l -c "which claude"', {
          encoding: "utf-8",
          stdio: "pipe",
          env: extendedEnv,
        }).trim();
        if (shellWhichResult && existsSync(shellWhichResult)) {
          console.log(
            `[Claude] ✓ Found user-installed Claude Code at: ${shellWhichResult}`,
          );
          return shellWhichResult;
        }
      } catch {
        // Try zsh if bash fails
        try {
          const zshWhichResult = execSync('zsh -l -c "which claude"', {
            encoding: "utf-8",
            stdio: "pipe",
            env: extendedEnv,
          }).trim();
          if (zshWhichResult && existsSync(zshWhichResult)) {
            console.log(
              `[Claude] ✓ Found user-installed Claude Code at: ${zshWhichResult}`,
            );
            return zshWhichResult;
          }
        } catch {
          // Fall through to other checks
        }
      }

      // Fallback: simple which with extended PATH
      const whichResult = execSync("which claude", {
        encoding: "utf-8",
        stdio: "pipe",
        env: extendedEnv,
      }).trim();
      if (whichResult && existsSync(whichResult)) {
        console.log(
          `[Claude] ✓ Found user-installed Claude Code at: ${whichResult}`,
        );
        return whichResult;
      }
    }
  } catch {
    // 'which/where claude' failed, user doesn't have claude installed globally
    const searchCommand = os === "win32" ? "where claude" : "which claude";
    console.log(
      `[Claude] ℹ️  ${searchCommand} failed - Claude Code not in PATH`,
    );
  }

  // Priority 2: Try to get npm global bin path dynamically
  try {
    const npmPrefix = execSync("npm config get prefix", {
      encoding: "utf-8",
      stdio: "pipe",
      env: extendedEnv,
    }).trim();
    if (npmPrefix) {
      const npmBinPath = join(npmPrefix, "bin", "claude");
      if (existsSync(npmBinPath)) {
        console.log(`[Claude] Found Claude Code at npm global: ${npmBinPath}`);
        return npmBinPath;
      }
    }
  } catch {
    // npm not available
  }

  // Priority 3: Check common install locations
  const home = homedir();
  const commonPaths =
    os === "win32"
      ? [
          join(home, "AppData", "Local", "Programs", "claude", "claude.exe"),
          join(home, "AppData", "Roaming", "npm", "claude.cmd"),
        ]
      : [
          "/usr/local/bin/claude",
          "/opt/homebrew/bin/claude",
          join(home, ".local", "bin", "claude"),
          join(home, ".npm-global", "bin", "claude"),
          join(home, ".volta", "bin", "claude"), // Volta
          join(home, "code", "node", "npm_global", "bin", "claude"), // Custom npm global path
        ];

  // Priority 3.5: Also check nvm paths (dynamically find node versions)
  if (os !== "win32") {
    const nvmDir = join(home, ".nvm", "versions", "node");
    try {
      const versions = readdirSync(nvmDir);
      for (const version of versions) {
        const nvmPath = join(nvmDir, version, "bin", "claude");
        if (existsSync(nvmPath)) {
          console.log(`[Claude] Found Claude Code at nvm path: ${nvmPath}`);
          return nvmPath;
        }
      }
    } catch {
      // nvm not installed or no versions
    }
  }

  for (const p of commonPaths) {
    if (existsSync(p)) {
      console.log(`[Claude] Found Claude Code at: ${p}`);
      return p;
    }
  }

  // Claude Code not found - provide helpful message
  console.warn(
    "[Claude] ════════════════════════════════════════════════════════════════════",
  );
  console.warn("[Claude] ⚠️  Claude Code not found on your system");
  console.warn(
    "[Claude] ════════════════════════════════════════════════════════════════════",
  );

  if (os === "win32") {
    console.warn(getInstallationInstructions(os));
    console.warn(
      "[Claude] After installing, restart openloomi for the changes to take effect.",
    );
  } else {
    console.warn(
      "[Claude] Please install it or rebuild the app with --with-claude flag.",
    );
    console.warn(getInstallationInstructions(os));
  }

  console.warn(
    "[Claude] ════════════════════════════════════════════════════════════════════",
  );
  return undefined;
}

/**
 * Ensure Claude Code is available, install if necessary
 * Note: If app was built with --with-claude, sidecar will be used automatically
 */
async function ensureClaudeCode(): Promise<string | undefined> {
  let path = getClaudeCodePath();

  if (!path) {
    const os = platform();
    const isPackaged = isPackagedApp();

    // Check if we're in a packaged app without sidecar Claude Code
    if (isPackaged) {
      console.log(
        "[Claude] ℹ️  Running in packaged app mode without bundled Claude Code",
      );
    } else {
      console.log("[Claude] ℹ️  Running in development mode");
    }

    // Try automatic installation (will provide instructions on Windows)
    console.log(`[Claude] 📦 Attempting to install Claude Code for ${os}...`);

    const installed = await installClaudeCode();
    if (installed) {
      // Re-check after installation
      path = getClaudeCodePath();
      if (path) {
        console.log(`[Claude] ✓ Claude Code installed at: ${path}`);
      } else {
        console.error(
          "[Claude] ✗ Installation completed but Claude Code still not found in PATH",
        );
        console.error(
          "[Claude] Please restart openloomi after installation completes",
        );
      }
    } else {
      console.error(
        "[Claude] ✗ Automatic installation failed or skipped (see instructions above)",
      );
    }
  }

  return path;
}

/**
 * Expand ~ to home directory and normalize path separators
 */
function expandPath(inputPath: string): string {
  let result = inputPath;

  // Expand ~ to home directory
  if (result.startsWith("~")) {
    result = join(homedir(), result.slice(1));
  }

  // Normalize path separators for current platform
  if (platform() === "win32") {
    result = result.replace(/\//g, "\\");
  }

  return result;
}

/**
 * Generate a fallback slug from prompt for session directory name
 * Only used when no session path is provided from frontend
 */
function generateFallbackSlug(prompt: string, taskId: string): string {
  // Convert Chinese to pinyin-like or just use alphanumeric
  let slug = prompt
    .toLowerCase()
    // Remove Chinese and keep only alphanumeric
    .replace(/[\u4e00-\u9fff]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");

  if (!slug || slug.length < 3) {
    slug = "task";
  }

  const suffix = taskId.slice(-6);
  return `${slug}-${suffix}`;
}

/**
 * Get language instruction based on user preference
 * Returns a prompt instruction telling the agent to use the specified language
 */
function getLanguageInstruction(language: string | undefined): string {
  if (!language) return "";

  // Check if language is Chinese
  const isChinese =
    language === "zh-Hans" || language === "zh-CN" || language.startsWith("zh");

  if (isChinese) {
    return "\n\n**Language Preference**:\nPlease reply in Simplified Chinese.\n";
  }

  // Default to English for other languages
  return "\n\n**Language Preference**:\nPlease reply in English.\n";
}

/**
 * Get or create session working directory
 * If workDir already contains a valid session path (from frontend), use it directly
 * Otherwise, generate a new session folder
 * NOTE: This function only computes the path, it does NOT create the directory
 */
function getSessionWorkDir(
  workDir: string = DEFAULT_WORK_DIR,
  prompt?: string,
  taskId?: string,
): string {
  const expandedPath = expandPath(workDir);

  // DEFENSIVE: Ensure the path is absolute. On Windows, spawn() with a
  // relative cwd falls back to process.cwd(), which can cause the agent
  // to run in the wrong directory (e.g. cli-bundle instead of the session dir).
  // Paths starting with ~ (unexpanded), relative paths, or suspicious values
  // like "cli-bundle" are converted to absolute paths under process.cwd().
  const os = platform();
  const isAbsolute =
    os === "win32"
      ? /^[a-zA-Z]:[\\/]/.test(expandedPath) // e.g. C:\ or C:/
      : expandedPath.startsWith("/");
  const suspiciousPath =
    !isAbsolute ||
    expandedPath === "cli-bundle" ||
    expandedPath.startsWith("cli-bundle") ||
    expandedPath.includes("/cli-bundle") ||
    expandedPath.includes("\\cli-bundle");
  let safePath = expandedPath;
  if (suspiciousPath) {
    safePath = join(process.cwd(), expandedPath);
    console.warn(
      "[Claude] getSessionWorkDir: suspicious or relative path detected, resolving to cwd:",
      safePath,
    );
  }

  // Check if the workDir is already a session folder path from frontend
  // Session paths from frontend look like: ~/.openloomi/sessions/{sessionId}/task-{xx}
  // or: ~/.openloomi/sessions/{sessionId}
  // Support both Unix (/) and Windows (\) path separators (case-insensitive for Windows)
  const normalizedForCheck = os === "win32" ? safePath.toLowerCase() : safePath;
  const hasSessionsPath =
    normalizedForCheck.includes("/sessions/") ||
    normalizedForCheck.includes("\\sessions\\");
  const endsWithSessions =
    normalizedForCheck.endsWith("/sessions") ||
    normalizedForCheck.endsWith("\\sessions");
  if (hasSessionsPath && !endsWithSessions) {
    return safePath;
  }

  // No session path provided, generate one (fallback for backward compatibility)
  const baseDir = safePath;
  const sessionsDir = join(baseDir, "sessions");

  let folderName: string;
  // PRIORITY: Always use taskId when available (it's the chatId from frontend)
  // This ensures the workspace files are stored at ~/.openloomi/sessions/{chatId}/
  // which matches what WorkspacePanel expects
  if (taskId) {
    folderName = taskId;
  } else if (prompt) {
    folderName = generateFallbackSlug(prompt, generateUUID());
  } else {
    folderName = `session-${Date.now()}`;
  }

  const targetDir = join(sessionsDir, folderName);
  return targetDir;
}

/**
 * Ensure a directory exists, creating it if necessary
 * This should be called only when actually writing files
 */
async function ensureDir(dirPath: string): Promise<void> {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch (error) {
    console.error("Failed to create directory:", error);
  }
}

/**
 * Save images to disk and return file paths
 */
async function saveImagesToDisk(
  images: ImageAttachment[],
  workDir: string,
): Promise<string[]> {
  const savedPaths: string[] = [];

  if (images.length === 0) {
    return savedPaths;
  }

  // Only create directory when we actually have images to save
  await ensureDir(workDir);

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const ext = image.mimeType.split("/")[1] || "png";
    const filename = `image_${Date.now()}_${i}.${ext}`;
    const filePath = join(workDir, filename);

    try {
      // Skip URL-type images (cloud will fetch them)
      if (image.url) {
        console.log(`[Claude] Skipping URL-type image: ${image.url}`);
        continue;
      }
      if (!image.data) {
        console.warn("[Claude] Skipping image with no data or url");
        continue;
      }
      // Remove data URL prefix if present (e.g., "data:image/png;base64,")
      let base64Data = image.data;
      if (base64Data.includes(",")) {
        base64Data = base64Data.split(",")[1];
      }

      const buffer = Buffer.from(base64Data, "base64");
      await writeFile(filePath, buffer);
      savedPaths.push(filePath);
      console.log(`[Claude] Saved image to: ${filePath}`);
    } catch (error) {
      console.error(`[Claude] Failed to save image: ${error}`);
    }
  }

  return savedPaths;
}

/**
 * Save file attachments to disk and return file paths
 * Used for user-uploaded files (PDF, documents, etc.)
 */
async function saveFileAttachments(
  files: { name: string; data: string; mimeType: string }[],
  workDir: string,
): Promise<string[]> {
  const savedPaths: string[] = [];

  if (files.length === 0) {
    return savedPaths;
  }

  // Only create directory when we actually have files to save
  await ensureDir(workDir);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    // Use the original filename if available
    const filename = file.name || `file_${Date.now()}_${i}`;
    const filePath = join(workDir, filename);

    try {
      // Remove data URL prefix if present (e.g., "data:application/pdf;base64,")
      let base64Data = file.data;
      if (base64Data.includes(",")) {
        base64Data = base64Data.split(",")[1];
      }

      const buffer = Buffer.from(base64Data, "base64");
      await writeFile(filePath, buffer);
      savedPaths.push(filePath);
      console.log(
        `[Claude] Saved file attachment to: ${filePath} (${(buffer.length / 1024).toFixed(2)}KB)`,
      );
    } catch (error) {
      console.error(
        `[Claude] Failed to save file attachment ${filename}: ${error}`,
      );
    }
  }

  return savedPaths;
}

/**
 * Get instruction for using business tools properly
 * This helps Agent understand when to use business tools vs file operations
 */
function getBusinessToolsInstruction(excludeTools?: string[]): string {
  const excludeSet = new Set(excludeTools ?? []);
  const createScheduledJobInstruction = excludeSet.has("createScheduledJob")
    ? ""
    : `
7. **createScheduledJob** - Use when user asks for RECURRING or SCHEDULED tasks:
   - "Do this every few hours..." / "Every few hours..."
   - "Remind me every morning..." / "Daily reminder..."
   - "Run this task every week..." / "Weekly task..."
   - "Check every hour..." / "Hourly check..."
   - "Send notification periodically..." / "Schedule notification..."
   - "Every hour, daily, weekly..." / "Recurring schedule..."
   - "Every X time..." / "Custom interval..."

   **Schedule types:**
   - cron: Use cron expressions (e.g., '0 * * * *' for every hour, '0 9 * * *' for daily at 9am)
   - interval: Simple interval in minutes (e.g., minutes: 60 for every hour)
   - once: One-time execution at specific time

   **CRITICAL: The 'description' field MUST preserve the user's exact original request:**
   - Keep the platform name (Telegram, Slack, Email, etc.)
   - Keep the recipient identity (user says 'me', use 'me' NOT 'user')
   - Keep the specific action/content
   - Use user's original language and wording
`;

  return `
=== BUSINESS TOOLS GUIDELINE ===

When user asks questions about their tasks, schedule, or chat history, ALWAYS use business tools FIRST:

1. **chatInsight** - Use for queries about:
   - "What are my tasks today" / "What's on my schedule today"
   - "My todos" / "My tasks" / "My backlog"
   - "Important items" / "Priorities"
   - "Chat history" / "Conversations"
   - "Project updates" / "Project progress"
   **⚠️ IMPORTANT - Auto-download attachments:**
   - When insight results contain attachments (files), ALWAYS use downloadInsightAttachment to download them to the session workDir automatically
   - Do NOT just show attachment info - download the actual files so user can access them
   - Use the blobPath from the attachment object to download

2. **queryContacts** - Use for queries about:
   - "My contacts" / "Who is X" / "Contact information"
   - Before sending messages or replies, use this to find the contact person's information

3. **queryIntegrations** - Use for queries about:
   - "My accounts" / "What platforms are connected" / "Connected services"
   - Before sending messages or replies, use this to check which platforms are integrated (Slack, Discord, Telegram, etc.)

4. **searchKnowledgeBase** - Use for queries about:
   - "My documents" / "Knowledge base" / "Files"

5. **searchMemoryPath** - Use for queries about:
   - Personal information (e.g., 'Who is my boss?', 'Tell me about my team', 'What is my manager's name?')
   - Projects and tasks (e.g., 'What are my project notes?', 'Show my task list')
   - Meeting notes and summaries
   - Any other personal information stored in memory

   **IMPORTANT**: When the user asks questions about themselves, their contacts, their projects, their team, or any personal information, ALWAYS use searchMemoryPath tool to search for relevant information in the user's memory FIRST before answering.

6. **createInsight** - Use when user says:
   - "Create a reminder" / "Remind me"
   - "Remember this" / "Note this"
   - "I want to track this" / "Track this"
   ⚠️ DO NOT use createInsight to update an existing tracking — use modifyInsight instead!
${createScheduledJobInstruction}

8. **modifyInsight** - Use when:
   - User wants to **update an existing insight/tracking** (e.g., "update the progress", "add an update", "log a new event")
   - User says "update" or "add an update" referring to an existing tracking
   - Tracking the progression of an existing insight (add timeline event, update status)
   - Marking tasks as complete, updating task status
   - ⚠️ Requires insightId of the focused/active insight — if no focused insight exists, ask the user which tracking to update
   - When updating, use the "timeline" field to record new progress/events

9. **listScheduledJobs** - Use when:
   - User asks "list my scheduled jobs" / "show my scheduled tasks"
   - User wants to see all their scheduled jobs
   - Before updating a job, use this to find the jobId

10. **updateScheduledJob** - Use when:
    - User wants to **update an existing scheduled job** (e.g., "update the description", "change the schedule")
    - User says "update timer" or "modify scheduled job"
    - ⚠️ Requires jobId — use listScheduledJobs first to find the job to update

11. **sendReply** - Use when user says:
   - "Reply to him" / "Reply to her"
   - "Send message" / "Send a message"
   - "Tell XXX" / "Message XXX"

   **IMPORTANT WORKFLOW for sending messages/replies:**
   - Step 1: Use queryContacts to find the target contact's information
   - Step 2: Use queryIntegrations to check available platforms
   - Step 3: Use sendReply to send the message through the appropriate platform integration

   Examples:
   - User: "Reply to Zhang San, tell him..." → Query "Zhang San" from contacts → Check platforms → Send reply
   - User: "Send a message to Li Si" → Query "Li Si" from contacts → Check platforms → Send message
   - User: "Tell team..." → Query team contacts → Check integrations → Send message

   **⚠️ CRITICAL - Telegram/WhatsApp Bot Conversations:**
   - If you are running inside a Telegram or WhatsApp bot conversation:
   - **Files are AUTOMATICALLY sent to the user** - Any files you create in the workDir will be sent automatically
   - You can freely generate files (reports, scripts, documents, etc.) - they will be delivered to the user
   - To send files from user's computer (e.g., Desktop), copy them to workDir using Bash/Read/Write tools
   - DO NOT use sendReply to send files - the platform runtime handles file delivery automatically
   - Only use sendReply to send TEXT messages to OTHER contacts (not back to the current user)

12. **getRawMessages / searchRawMessages** - Use for querying stored message history:
   - "Search my messages" / "Find messages about..."
   - "Show my chat history" / "What did I talk about..."
   - Querying historical messages from all platforms

   **⚠️ IMPORTANT - Auto-download attachments from raw messages:**
   - When raw message results contain attachments (files, images, documents), use downloadInsightAttachment to download them
   - Check the attachments array in message results for url, blobPath, or downloadUrl fields
   - Download relevant attachments so you can analyze the full content
   - This is especially important for emails with attachments (PDFs, documents, etc.)

ONLY use Read/Write/Edit/Grep tools when user asks about CODE or FILES in the workspace.
DO NOT use file system tools to query user's tasks or chat history.

========================================

`;
}

/**
 * Default allowed tools for execution
 */
const ALLOWED_TOOLS = [
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
  "Bash",
  "WebSearch",
  "WebFetch",
  "Skill",
  "Task",
  "LSP",
  "TodoWrite",
];

/**
 * Create sandbox MCP server with inline tools
 * @param sandboxProvider - The sandbox provider to use (e.g., 'codex', 'claude', 'native')
 */
function createSandboxMcpServer(sandboxProvider?: string) {
  return createSdkMcpServer({
    name: "sandbox",
    version: "1.0.0",
    tools: [
      tool(
        "sandbox_run_script",
        `Run a script file in an isolated sandbox container. Automatically detects the runtime (Python, Node.js, Bun) based on file extension.

IMPORTANT: The sandbox is isolated and CANNOT write files to the host filesystem.
- Scripts should output results to stdout (print/console.log)
- After execution, use the Write tool to save stdout content to files if needed
- Do NOT write files inside the script - it will fail with PermissionError

Example workflow:
1. Write script that prints results to stdout
2. Run script with sandbox_run_script
3. Use Write tool to save the stdout output to a file`,
        {
          filePath: z
            .string()
            .describe("Absolute path to the script file to execute"),
          workDir: z
            .string()
            .describe("Working directory containing the script"),
          args: z
            .array(z.string())
            .optional()
            .describe("Optional command line arguments"),
          packages: z
            .array(z.string())
            .optional()
            .describe(
              "Optional packages to install (pip for Python, npm for Node.js)",
            ),
          timeout: z
            .number()
            .optional()
            .describe("Execution timeout in milliseconds (default: 120000)"),
        },
        async (args) => {
          try {
            const response = await fetch(
              `${SANDBOX_API_URL}/sandbox/run/file`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...args, provider: sandboxProvider }),
              },
            );

            if (!response.ok) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Sandbox service error: HTTP ${response.status}. The sandbox service may not be running.`,
                  },
                ],
                isError: true,
              };
            }

            const result = (await response.json()) as {
              success: boolean;
              exitCode: number;
              runtime?: string;
              duration?: number;
              stdout?: string;
              stderr?: string;
              error?: string;
            } | null;

            if (!result) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: "Sandbox service returned empty response. The sandbox service may not be available.",
                  },
                ],
                isError: true,
              };
            }

            let output = "";
            if (result.success) {
              output = `Script executed successfully (exit code: ${result.exitCode})\n`;
              output += `Runtime: ${result.runtime || "unknown"}\n`;
              output += `Duration: ${result.duration || 0}ms\n\n`;
              if (result.stdout) output += `--- stdout ---\n${result.stdout}\n`;
              if (result.stderr) output += `--- stderr ---\n${result.stderr}\n`;
            } else {
              output = `Script execution failed (exit code: ${result.exitCode})\n`;
              if (result.error) output += `Error: ${result.error}\n`;
              if (result.stderr) output += `--- stderr ---\n${result.stderr}\n`;
              if (result.stdout) output += `--- stdout ---\n${result.stdout}\n`;
            }

            return {
              content: [{ type: "text" as const, text: output }],
              isError: !result.success,
            };
          } catch (error) {
            // Network error or sandbox service not running
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Sandbox service unavailable: ${errorMsg}. Please ensure the sandbox service is running or disable sandbox mode.`,
                },
              ],
              isError: true,
            };
          }
        },
      ),
      tool(
        "sandbox_run_command",
        `Execute a shell command in an isolated sandbox container.

IMPORTANT: The sandbox is isolated and CANNOT write files to the host filesystem.
- Commands should output results to stdout
- Use Write tool to save any output to files after execution
- File write operations inside sandbox will fail with PermissionError`,
        {
          command: z
            .string()
            .describe("The command to execute (e.g., 'python', 'node', 'pip')"),
          args: z
            .array(z.string())
            .optional()
            .describe("Arguments for the command"),
          workDir: z
            .string()
            .describe("Working directory for command execution"),
          image: z
            .string()
            .optional()
            .describe("Container image (auto-detected if not specified)"),
          timeout: z
            .number()
            .optional()
            .describe("Execution timeout in milliseconds"),
        },
        async (args) => {
          try {
            const response = await fetch(`${SANDBOX_API_URL}/sandbox/exec`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                command: args.command,
                args: args.args,
                cwd: args.workDir,
                image: args.image,
                timeout: args.timeout,
                provider: sandboxProvider,
              }),
            });

            if (!response.ok) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Sandbox service error: HTTP ${response.status}. The sandbox service may not be running.`,
                  },
                ],
                isError: true,
              };
            }

            const result = (await response.json()) as {
              success: boolean;
              exitCode: number;
              duration?: number;
              stdout?: string;
              stderr?: string;
              error?: string;
            } | null;

            if (!result) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: "Sandbox service returned empty response. The sandbox service may not be available.",
                  },
                ],
                isError: true,
              };
            }

            let output = "";
            if (result.success) {
              output = `Command executed successfully (exit code: ${result.exitCode})\n`;
              output += `Duration: ${result.duration || 0}ms\n\n`;
              if (result.stdout) output += `--- stdout ---\n${result.stdout}\n`;
              if (result.stderr) output += `--- stderr ---\n${result.stderr}\n`;
            } else {
              output = `Command failed (exit code: ${result.exitCode})\n`;
              if (result.error) output += `Error: ${result.error}\n`;
              if (result.stderr) output += `--- stderr ---\n${result.stderr}\n`;
            }

            return {
              content: [{ type: "text" as const, text: output }],
              isError: !result.success,
            };
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Sandbox service unavailable: ${errorMsg}. Please ensure the sandbox service is running or disable sandbox mode.`,
                },
              ],
              isError: true,
            };
          }
        },
      ),
    ],
  });
}

/**
 * Claude Agent SDK implementation
 */
export class ClaudeAgent extends BaseAgent {
  readonly provider: AgentProvider = "claude";

  // Counter for generating unique message IDs
  private messageCounter = 0;

  // Generate unique message ID for deduplication
  private generateMessageId(): string {
    return `msg_${Date.now()}_${++this.messageCounter}`;
  }

  /**
   * Build settingSources for Claude SDK
   *
   * IMPORTANT: Claude SDK loads skills from ~/.claude/skills/ when 'user' source is enabled.
   * We sync ~/.openloomi/skills/ to ~/.claude/skills/ on agent creation via syncSkillsToClaude().
   *
   * IMPORTANT: When using custom API (baseUrl + apiKey configured), we MUST NOT use 'user'
   * source because SDK reads ~/.claude/settings.json which takes priority over environment variables.
   * In this case, we use 'project' only to bypass the user settings file.
   */
  private buildSettingSources(
    skillsConfig?: SkillsConfig,
  ): ("user" | "project")[] {
    // Default case: only use the project settings
    return ["project"];
  }

  /**
   * Check if using custom (non-Anthropic) API
   */
  private isUsingCustomApi(): boolean {
    return !!this.config.baseUrl;
  }

  /**
   * Build environment variables for the SDK query
   * Supports custom API endpoint and API key (including OpenRouter)
   * Also includes extended PATH for packaged app compatibility
   *
   * NOTE: SDK expects Record<string, string>, so we filter out undefined values
   */
  private buildEnvConfig(): Record<string, string> {
    const env: Record<string, string | undefined> = { ...process.env };

    // IMPORTANT: Remove CLAUDECODE environment variable to allow nested sessions
    // This is necessary when openloomi itself is running inside a Claude Code environment
    // Without this, the child Claude Code process will detect the nested session
    // and exit with error "Claude Code cannot be launched inside another Claude Code session"
    // Use delete operator to completely remove the key
    env.CLAUDECODE = undefined;

    // Extend PATH for packaged app to find node and other binaries
    env.PATH = getExtendedPath();

    // When user configures custom API in settings, we need to ensure it takes priority
    // over any config from ~/.claude/settings.json (which is read via settingSources: ['user'])
    // Delete env vars to prevent them from being overridden by ~/.claude/settings.json
    if (this.config.apiKey) {
      // Use ANTHROPIC_AUTH_TOKEN for custom API key
      env.ANTHROPIC_AUTH_TOKEN = this.config.apiKey;
      // Delete ANTHROPIC_API_KEY to ensure AUTH_TOKEN takes priority
      env.ANTHROPIC_API_KEY = undefined;

      // Handle base URL: set if configured, delete if not (to use default Anthropic API)
      if (this.config.baseUrl) {
        env.ANTHROPIC_BASE_URL = this.config.baseUrl;
      } else {
        // Delete to ensure default Anthropic API is used, not from ~/.claude/settings.json
        env.ANTHROPIC_BASE_URL = undefined;
        logger.info(
          "[ClaudeAgent] Using custom API key with default Anthropic base URL",
        );
      }
    } else {
      // No API key provided in modelConfig, use environment variables
      // Check if ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY is set
      const envKey = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY;
      if (envKey) {
        logger.info(
          "[ClaudeAgent] Using API config from environment: key present",
        );
      } else {
        logger.warn(
          "[ClaudeAgent] No API key configured in modelConfig or environment variables",
        );
        logger.warn(
          "[ClaudeAgent] Set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN in environment, or provide apiKey in modelConfig",
        );
      }
    }

    // Set model configuration
    if (this.config.model) {
      env.ANTHROPIC_MODEL = this.config.model;
      // Also set default models for different tiers (useful for OpenRouter model names)
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = this.config.model;
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = this.config.model;
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = this.config.model;
    } else if (this.config.apiKey) {
      // When using custom API but no model specified, use LLM_MODEL environment variable
      const llmModel = process.env.LLM_MODEL;
      if (llmModel) {
        env.ANTHROPIC_MODEL = llmModel;
        env.ANTHROPIC_DEFAULT_SONNET_MODEL = llmModel;
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL = llmModel;
        env.ANTHROPIC_DEFAULT_OPUS_MODEL = llmModel;
      } else {
        // to let the third-party API use its default model
        env.ANTHROPIC_MODEL = undefined;
        env.ANTHROPIC_DEFAULT_SONNET_MODEL = undefined;
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL = undefined;
        env.ANTHROPIC_DEFAULT_OPUS_MODEL = undefined;
      }
    } else {
      // When neither model nor apiKey is specified, use the default AI model
      // to prevent SDK from reading invalid model from ~/.claude/settings.json
      env.ANTHROPIC_MODEL = DEFAULT_AI_MODEL;
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = DEFAULT_AI_MODEL;
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = DEFAULT_AI_MODEL;
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = DEFAULT_AI_MODEL;
    }

    // Set thinking configuration based on thinkingLevel
    // Maps to ANTHROPIC_THINKING_BUDGET env var for extended thinking
    if (this.config.thinkingLevel === "disabled") {
      env.ANTHROPIC_THINKING_BUDGET = undefined;
    } else if (this.config.thinkingLevel === "low") {
      env.ANTHROPIC_THINKING_BUDGET = "2048";
    } else if (this.config.thinkingLevel === "adaptive") {
      env.ANTHROPIC_THINKING_BUDGET = "32000";
    }
    // If thinkingLevel is not set, leave undefined (SDK default)

    // When using custom API, disable telemetry and non-essential traffic
    // This helps avoid potential issues with third-party API compatibility
    if (this.isUsingCustomApi()) {
      env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
    }

    // IMPORTANT: Set IS_SANDBOX=1 to bypass the root/sudo security check
    // when using --allow-dangerously-skip-permissions in Linux/Unix environments
    // This is needed for Tauri development which often runs as root
    if (process.platform !== "win32") {
      env.IS_SANDBOX = "1";
    }

    // Filter out undefined values - SDK expects Record<string, string>
    const filteredEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined) {
        filteredEnv[key] = value;
      }
    }

    // CRITICAL: Set global process.env so child process inherits it
    // The SDK spawns Claude Code CLI as a child process, which needs
    // to inherit these environment variables
    if (filteredEnv.ANTHROPIC_BASE_URL) {
      process.env.ANTHROPIC_BASE_URL = filteredEnv.ANTHROPIC_BASE_URL;
    }
    if (filteredEnv.ANTHROPIC_AUTH_TOKEN) {
      process.env.ANTHROPIC_AUTH_TOKEN = filteredEnv.ANTHROPIC_AUTH_TOKEN;
    }
    if (filteredEnv.ANTHROPIC_MODEL) {
      process.env.ANTHROPIC_MODEL = filteredEnv.ANTHROPIC_MODEL;
    }
    if (filteredEnv.ANTHROPIC_THINKING_BUDGET !== undefined) {
      process.env.ANTHROPIC_THINKING_BUDGET =
        filteredEnv.ANTHROPIC_THINKING_BUDGET;
    }
    // CRITICAL: Also remove CLAUDECODE from global process.env
    if (!filteredEnv.CLAUDECODE) {
      process.env.CLAUDECODE = undefined;
    }

    return filteredEnv;
  }

  /**
   * Estimate token count for a text string.
   * Delegates to the shared estimateTokens utility which correctly handles
   * CJK characters (1 char ≈ 1 token) vs Latin text (5 chars ≈ 1 token).
   */
  private estimateTokenCount(text: string): number {
    return estimateTokens(text);
  }

  /**
   * Format conversation history for inclusion in prompt with token length limits
   */
  private formatConversationHistory(
    conversation?: ConversationMessage[],
  ): string {
    if (!conversation || conversation.length === 0) {
      return "";
    }

    // Get token limits from agent config, fallback to defaults
    const maxHistoryTokens =
      (this.config.providerConfig?.maxHistoryTokens as number) ||
      MAX_CONVERSATION_HISTORY_TOKENS;
    const minMessagesToKeep = 3; // Always keep at least 3 most recent messages

    // Format all messages first
    const allFormattedMessages = conversation.map((msg) => {
      const role = msg.role === "user" ? "User" : "Assistant";
      let messageContent = `${role}: ${typeof msg.content === "string" ? filterToolCallText(msg.content) : msg.content}`;

      // Include image references if present
      // Note: Images are sent as content blocks to the LLM, so they're already visible
      if (msg.imagePaths && msg.imagePaths.length > 0) {
        messageContent += `\n[This message includes ${msg.imagePaths.length} image(s) which have been provided for analysis. The images are included as content blocks in this message, so you can view and analyze them directly.]`;
      }

      // Handle non-string content (like ToolModelMessage with ToolContent array)
      // This prevents [object Object] from being displayed
      if (typeof msg.content !== "string") {
        try {
          messageContent = `${role}: ${JSON.stringify(msg.content)}`;
        } catch {
          messageContent = `${role}: [Tool/Model Message - Unable to format]`;
        }
      }

      return messageContent;
    });

    // Calculate tokens for each message
    const messageTokens = allFormattedMessages.map((msg) => ({
      content: msg,
      tokens: this.estimateTokenCount(msg),
    }));

    // Start with the most recent messages and work backwards
    let totalTokens = 0;
    const selectedMessages: string[] = [];

    // Always keep at least minMessagesToKeep messages
    const startIndex = Math.max(0, messageTokens.length - minMessagesToKeep);

    for (let i = messageTokens.length - 1; i >= startIndex; i--) {
      const message = messageTokens[i];
      if (totalTokens + message.tokens <= maxHistoryTokens) {
        selectedMessages.unshift(message.content);
        totalTokens += message.tokens;
      } else {
        break;
      }
    }

    // If we have room for more messages, try to add older ones
    for (let i = startIndex - 1; i >= 0; i--) {
      const message = messageTokens[i];
      if (totalTokens + message.tokens <= maxHistoryTokens) {
        selectedMessages.unshift(message.content);
        totalTokens += message.tokens;
      } else {
        break;
      }
    }

    if (selectedMessages.length === 0) {
      return "";
    }

    const formattedMessages = selectedMessages.join("\n\n");
    const truncationNotice =
      conversation.length > selectedMessages.length
        ? `\n\n[Note: Conversation history truncated. Showing ${selectedMessages.length} of ${conversation.length} messages to stay within token limits.]`
        : "";

    logger.info(
      `[formatConversationHistory] Selected ${selectedMessages.length} of ${conversation.length} messages, estimated ${totalTokens} tokens (limit: ${maxHistoryTokens})`,
    );

    return `## Previous Conversation Context
The following is the conversation history. Use this context to understand and respond to the current message appropriately.

${formattedMessages}${truncationNotice}\n\n---\n## Current Request\n`;
  }

  /**
   * Direct execution mode (without planning)
   */
  async *run(
    prompt: string,
    options?: AgentOptions,
  ): AsyncGenerator<AgentMessage> {
    // Pass external abortController to session so that when connection closes it can properly stop Agent
    const session = this.createSession("executing", {
      abortController: options?.abortController,
    });
    yield {
      type: "session",
      sessionId: session.id,
      messageId: this.generateMessageId(),
    };

    const sessionCwd = getSessionWorkDir(
      options?.cwd || this.config.workDir,
      prompt,
      options?.taskId,
    );
    // Ensure the working directory exists before calling SDK
    await ensureDir(sessionCwd);

    // Sync skills to sessionCwd for 'project' settingSource (always runs)
    try {
      const { syncSkillsToClaude } = require("@/lib/ai/skills/loader");
      const syncStart = Date.now();
      syncSkillsToClaude(sessionCwd);
      logger.info(
        `[Claude ${session.id}] Synced skills to session directory: ${sessionCwd} (${Date.now() - syncStart}ms)`,
      );
      // Also sync to bundled CLI directory on Windows
      // The Skills tool may resolve skill scripts relative to where Claude Code is located
      const bundledCliPath = getClaudeCodePath();
      if (bundledCliPath) {
        const bundleDir = dirname(bundledCliPath);
        if (bundleDir !== sessionCwd) {
          const bundleSyncStart = Date.now();
          syncSkillsToClaude(bundleDir);
          logger.info(
            `[Claude ${session.id}] Synced skills to CLI bundle directory: ${bundleDir} (${Date.now() - bundleSyncStart}ms)`,
          );
        }
      }
    } catch (error) {
      logger.error(
        `[Claude ${session.id}] Failed to sync skills to session:`,
        error,
      );
    }

    const sentTextHashes = new Set<string>();
    const sentToolIds = new Set<string>();

    // Build sandbox options for workspace instruction
    const sandboxOpts: SandboxOptions | undefined = options?.sandbox?.enabled
      ? {
          enabled: true,
          image: options.sandbox.image,
          apiEndpoint: options.sandbox.apiEndpoint || SANDBOX_API_URL,
        }
      : undefined;

    // Handle image attachments - directly send to Claude API
    // When images are present, we use AsyncIterable<SDKUserMessage> format
    // to include images as content blocks instead of saving to disk
    const images = options?.images || [];
    const hasImages = images.length > 0;
    if (hasImages) {
      console.log(
        `[Claude ${session.id}] Processing ${images.length} image(s) for direct API transmission`,
      );
      images.forEach((img, i) => {
        console.log(
          `[Claude ${session.id}] Image ${i}: mimeType=${img.mimeType}, dataLength=${img.data?.length || 0}`,
        );
      });

      // Also save images to disk for later access by the agent
      const imagePaths = await saveImagesToDisk(images, sessionCwd);
      console.log(
        `[Claude ${session.id}] Saved ${imagePaths.length} images to disk for later access: ${imagePaths.join(", ")}`,
      );
    }

    // Handle PDF attachments - directly send to Claude API as document blocks
    // Only use native PDF API if PREFER_NATIVE_PDF is enabled
    const pdfs = options?.pdfs || [];
    const hasPDFs = pdfs.length > 0 && PREFER_NATIVE_PDF;
    if (hasPDFs) {
      console.log(
        `[Claude ${session.id}] Processing ${pdfs.length} PDF(s) for native API transmission`,
      );

      // Calculate total PDF size (base64 is ~4/3 of binary, so multiply by 0.75)
      let totalPdfSizeMB = 0;
      pdfs.forEach((pdf, i) => {
        const sizeMB = pdf.data ? (pdf.data.length * 0.75) / (1024 * 1024) : 0;
        totalPdfSizeMB += sizeMB;
        console.log(
          `[Claude ${session.id}] PDF ${i}: mimeType=${pdf.mimeType}, pageCount=${pdf.pageCount || "unknown"}, estimatedSize=${sizeMB.toFixed(2)}MB, hasUrl=${!!pdf.url}`,
        );
      });

      // Check total PDF size - reject if too large (4MB limit to stay under Vercel's 4.5MB request body limit)
      const MAX_TOTAL_PDF_SIZE_MB = 4;
      if (totalPdfSizeMB > MAX_TOTAL_PDF_SIZE_MB) {
        const errorMsg = `Total PDF size (${totalPdfSizeMB.toFixed(2)}MB) exceeds maximum allowed size (${MAX_TOTAL_PDF_SIZE_MB}MB). To fix this: 1) Split PDFs into smaller files (< ${MAX_TOTAL_PDF_SIZE_MB}MB each) or 2) Use image scans of documents instead of PDF files or 3) Summarize documents before sending.`;
        console.error(`[Claude ${session.id}] ${errorMsg}`);
        throw new Error(errorMsg);
      }

      // Check page count and size limits (only for PDFs with data, not URL references)
      const oversizedPDFs = pdfs.filter((pdf) => {
        if (!pdf.data) return false;
        const pageCount = pdf.pageCount || 0;
        const sizeMB = (pdf.data.length * 0.75) / (1024 * 1024);
        return pageCount > PDF_MAX_PAGES || sizeMB > PDF_MAX_SIZE_MB;
      });
      if (oversizedPDFs.length > 0) {
        console.warn(
          `[Claude ${session.id}] Warning: ${oversizedPDFs.length} PDF(s) exceed size/page limits, will fallback to text extraction`,
        );
      }
    }

    // Handle file attachments (PDF, documents, etc.) - save to disk for agent access
    const fileAttachments = options?.fileAttachments || [];
    if (fileAttachments.length > 0) {
      console.log(
        `[Claude ${session.id}] Processing ${fileAttachments.length} file attachment(s)`,
      );
      fileAttachments.forEach((file, i) => {
        console.log(
          `[Claude ${session.id}] File ${i}: name=${file.name}, mimeType=${file.mimeType}, dataLength=${file.data?.length || 0}`,
        );
      });

      // Save file attachments to disk
      const filePaths = await saveFileAttachments(fileAttachments, sessionCwd);
      console.log(
        `[Claude ${session.id}] Saved ${filePaths.length} file attachment(s) to disk: ${filePaths.join(", ")}`,
      );
    }

    // Format conversation history to include context from previous messages
    const conversationContext = this.formatConversationHistory(
      options?.conversation,
    );

    // List available files in workspace and add to prompt
    // Note: Image files are excluded since they're sent as content blocks
    let fileListInfo = "";
    try {
      const fs = await import("node:fs");
      if (fs.existsSync(sessionCwd)) {
        const files = fs.readdirSync(sessionCwd);
        const IMAGE_EXTENSIONS = [
          ".png",
          ".jpg",
          ".jpeg",
          ".gif",
          ".webp",
          ".svg",
          ".ico",
          ".bmp",
        ];
        const nonHiddenFiles = files.filter((f: string) => {
          // Skip hidden files
          if (f.startsWith(".")) return false;
          // Skip image files (they're sent as content blocks, not need to read via tool)
          const ext = f.toLowerCase().substring(f.lastIndexOf("."));
          return !IMAGE_EXTENSIONS.includes(ext);
        });
        if (nonHiddenFiles.length > 0) {
          fileListInfo = `\n\n📁 **FILES IN YOUR WORKSPACE**:\n${nonHiddenFiles.map((f: string) => `  - ${f}`).join("\n")}\n\nThese files are available in your working directory (${sessionCwd}). You can read them using the Read tool.\n`;
        }
      }
    } catch (error) {
      console.error(
        `[Claude ${session.id}] Failed to list workspace files:`,
        error,
      );
    }

    // CRITICAL: Prepend image/PDF instruction when media is present
    // This MUST come first to ensure the model prioritizes media analysis
    let mediaPrefix = "";
    if (hasImages) {
      // Use Chinese instruction for ZhipuAI models, English for others
      mediaPrefix = `[IMAGE ANALYSIS] User uploaded ${images.length} image(s). Please analyze the image(s) first, then answer:\n\n`;
    }
    if (hasPDFs) {
      const pdfPrefix = `[PDF ANALYSIS] User uploaded ${pdfs.length} PDF document(s). Please analyze the PDF(s) first, then answer:\n\n`;
      mediaPrefix = pdfPrefix + mediaPrefix; // Prepend PDF instruction first
    }

    // Get user aiSoulPrompt from options
    const userAiSoulPrompt = options?.aiSoulPrompt ?? undefined;

    // Get user language preference
    const userLanguage = options?.language ?? undefined;

    // Build the base prompt (without images)
    // Prepend image instruction FIRST so the model sees it before all other context
    // Include user's custom AI Soul prompt if available
    const aiSoulInstruction =
      userAiSoulPrompt && userAiSoulPrompt.trim().length > 0
        ? `\n\n**User-Defined AI Soul (Custom Instructions)**:\n${userAiSoulPrompt.trim()}\n`
        : "";

    // Include language instruction based on user preference
    const languageInstruction = getLanguageInstruction(userLanguage);

    // Build the base prompt (without images)
    // IMPORTANT: aiSoulInstruction must come FIRST (after mediaPrefix) to override default identity
    // so user's custom instructions take precedence over system-defined identity
    const basePrompt =
      mediaPrefix +
      languageInstruction +
      aiSoulInstruction +
      getWorkspaceInstruction(
        sessionCwd,
        sandboxOpts,
        options?.timezone ?? undefined,
      ) +
      fileListInfo +
      conversationContext +
      prompt;

    // Ensure Claude Code is installed
    const claudeCodePath = await ensureClaudeCode();
    if (!claudeCodePath) {
      yield {
        type: "error",
        message: "__CLAUDE_CODE_NOT_FOUND__",
      };
      yield { type: "done", messageId: this.generateMessageId() };
      return;
    }

    // Load user-configured MCP servers based on mcpConfig settings
    const userMcpServers = await loadMcpServers(
      options?.mcpConfig as McpConfig | undefined,
    );

    // Build query options
    // Use settingSources based on skillsConfig to control skill loading
    // - 'user' source loads from ~/.claude directory (User skills)
    // - 'project' source loads from project/.claude directory
    // User's custom API settings from openloomi settings page are passed via env config
    // which takes priority over ~/.claude/settings.json because we set ANTHROPIC_API_KEY directly
    const settingSources: ("user" | "project")[] = this.buildSettingSources(
      options?.skillsConfig,
    );

    // Build environment variables
    const envConfig = this.buildEnvConfig();

    // When using custom API, pass custom settings with env vars to override user settings
    // This ensures our config takes priority over ~/.claude/settings.json
    let settingsConfig: string | undefined;
    if (this.isUsingCustomApi()) {
      const customSettings = {
        env: {
          ANTHROPIC_BASE_URL: this.config.baseUrl || "",
          ANTHROPIC_AUTH_TOKEN: this.config.apiKey || "",
          ANTHROPIC_MODEL: this.config.model || "",
          ...(this.config.thinkingLevel === "disabled"
            ? { ANTHROPIC_THINKING_BUDGET: "" }
            : this.config.thinkingLevel === "low"
              ? { ANTHROPIC_THINKING_BUDGET: "2048" }
              : this.config.thinkingLevel === "adaptive"
                ? { ANTHROPIC_THINKING_BUDGET: "32000" }
                : {}),
        },
        skipWebFetchPreflight: true,
      };
      settingsConfig = JSON.stringify(customSettings);
    }

    const queryOptions = {
      cwd: sessionCwd,
      tools: { type: "preset", preset: "claude_code" },
      allowedTools: options?.allowedTools || ALLOWED_TOOLS,
      settingSources,
      settings: settingsConfig,
      // Use permissionMode from options, default to "bypassPermissions" for backward compatibility
      permissionMode: options?.permissionMode || "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      // session.abortController now directly uses the externally passed abortController
      abortController: session.abortController,
      env: envConfig,
      model: this.config.model,
      pathToClaudeCodeExecutable: claudeCodePath,
      maxTurns: 1000, // Allow more agentic turns before stopping
      // Enable includePartialMessages for streaming output (disabled by default, used for Telegram/WhatsApp)
      includePartialMessages: options?.stream ?? false,
      // Enable debug mode (only in development)
      ...(isDev ? { debug: true, debugFile: LOG_FILE_PATH } : {}),
      // Capture stderr for debugging
      stderr: (data: string) => {
        logger.error(`[Claude ${session.id}] STDERR: ${data}`);
      },
      spawnClaudeCodeProcess,

      // Enable Anthropic prompt caching for system prompt to reduce redundant input token costs
      // cache_control: { type: "ephemeral" } caches the static business tools instruction block
      // with a 5-minute TTL, saving 60-90% of input tokens for repeated turns (#1496)
      systemPrompt: getBusinessToolsInstruction(options?.excludeTools),

      // Add canUseTool callback if permissionMode is not bypassPermissions
      ...(options?.permissionMode &&
      options.permissionMode !== "bypassPermissions" &&
      options.onPermissionRequest
        ? {
            canUseTool: async (toolName, toolInput, canUseToolOptions) => {
              logger.info(
                `[Claude ${session.id}] Permission request: ${toolName}`,
                { toolInput, decisionReason: canUseToolOptions.decisionReason },
              );

              try {
                const result = await options.onPermissionRequest?.({
                  toolName,
                  toolInput,
                  toolUseID: canUseToolOptions.toolUseID,
                  decisionReason: canUseToolOptions.decisionReason,
                  blockedPath: canUseToolOptions.blockedPath,
                });

                // If no permission handler, deny by default
                if (!result) {
                  logger.warn(
                    `[Claude ${session.id}] No permission handler, denying ${toolName}`,
                  );
                  return {
                    behavior: "deny",
                    message: "Permission check not available",
                    toolUseID: canUseToolOptions.toolUseID,
                  };
                }

                logger.info(
                  `[Claude ${session.id}] Permission decision: ${result.behavior}`,
                );

                // Transform to SDK's PermissionResult type
                if (result.behavior === "allow") {
                  return {
                    behavior: "allow",
                    updatedInput: result.updatedInput,
                    toolUseID: canUseToolOptions.toolUseID,
                  };
                }
                return {
                  behavior: "deny",
                  message: result.message || "Permission denied by user",
                  toolUseID: canUseToolOptions.toolUseID,
                };
              } catch (error) {
                logger.error(
                  `[Claude ${session.id}] Permission request error:`,
                  error,
                );
                // Deny on error
                return {
                  behavior: "deny",
                  message:
                    error instanceof Error
                      ? error.message
                      : "Permission check failed",
                  toolUseID: canUseToolOptions.toolUseID,
                };
              }
            },
          }
        : {}),
    } as Options;

    // Initialize MCP servers with user-configured servers
    const mcpServers: Record<
      string,
      McpServerConfig | ReturnType<typeof createSandboxMcpServer>
    > = {
      ...userMcpServers,
    };

    // Add sandbox MCP server if sandbox is enabled
    if (options?.sandbox?.enabled) {
      mcpServers.sandbox = createSandboxMcpServer(options.sandbox.provider);
      // Add sandbox tools to allowed tools
      queryOptions.allowedTools = [
        ...(options?.allowedTools || ALLOWED_TOOLS),
        "sandbox_run_script",
        "sandbox_run_command",
      ];
    }

    // Add business tools MCP server if user session is provided
    if (options?.session) {
      try {
        mcpServers["business-tools"] = createBusinessToolsMcpServer(
          options.session,
          options.authToken, // Pass cloud auth token for embeddings API
          options?.onInsightChange,
          options.sessionId, // Pass sessionId as chatId for insight association
          {
            excludeTools: options?.excludeTools,
          },
        );
        // Add business tools to allowed tools
        queryOptions.allowedTools = [
          ...(queryOptions.allowedTools || ALLOWED_TOOLS),
          "chatInsight",
          "modifyInsight",
          "createInsight",
          "deleteInsight",
          "createScheduledJob",
          "listScheduledJobs",
          "deleteScheduledJob",
          "toggleScheduledJob",
          "updateScheduledJob",
          "executeScheduledJob",
          "sendReply",
          "queryContacts",
          "queryIntegrations",
          "searchKnowledgeBase",
          "searchMemoryPath",
          "getRawMessages",
          "searchRawMessages",
          "getFullDocumentContent",
          "listKnowledgeBaseDocuments",
          "downloadInsightAttachment",
          "time",
          ...(options?.executionReport?.enabled
            ? ["submitExecutionReport"]
            : []),
        ];
      } catch (error) {
        logger.error(
          `[Claude ${session.id}] Failed to create business tools MCP server:`,
          error,
        );
      }
    }

    // Apply excludeTools filter if specified (must be after all allowedTools modifications)
    if (options?.excludeTools && options.excludeTools.length > 0) {
      const excludeSet = new Set(options.excludeTools);
      queryOptions.allowedTools = (queryOptions.allowedTools || []).filter(
        (tool: string) => !excludeSet.has(tool),
      );
      logger.info(
        `[Claude ${session.id}] Excluded tools: ${options.excludeTools.join(", ")}`,
      );
    }

    // Only add mcpServers to options if there are any configured
    if (Object.keys(mcpServers).length > 0) {
      queryOptions.mcpServers = mcpServers;
    } else {
      logger.warn(
        `[Claude ${session.id}] No MCP servers configured (sandbox disabled or no user MCP servers)`,
      );
    }

    // Log detailed query options for debugging
    const envConfigForLogging = queryOptions.env || {};

    try {
      // Determine whether to send images/PDFs directly or use text-only prompt
      const hasMedia = hasImages || hasPDFs;
      const queryPrompt = hasMedia
        ? this.createUserMessageWithMedia(
            basePrompt,
            images,
            hasPDFs ? pdfs : undefined,
            session.id,
          )
        : basePrompt;

      // Track whether we've sent text via stream_event to avoid duplication
      let hasStreamedText = false;
      let queryMessageCount = 0;

      for await (const message of query({
        prompt: queryPrompt,
        options: queryOptions,
      })) {
        if (session.abortController.signal.aborted) {
          console.log(
            `[Claude ${session.id}] query() abort signal detected, breaking loop`,
          );
          break;
        }

        for (const agentMessage of this.processMessage(
          message,
          session.id,
          sentTextHashes,
          sentToolIds,
          hasStreamedText,
        )) {
          yield agentMessage;
          // Track if we just sent text from stream_event
          if (
            (message as { type?: string }).type === "stream_event" &&
            agentMessage.type === "text"
          ) {
            hasStreamedText = true;
          }
        }

        // Reset hasStreamedText after processing all messages in this batch
        // If we sent stream text, reset the flag for the next assistant message
        if ((message as { type?: string }).type === "assistant") {
          hasStreamedText = false;
        }

        queryMessageCount++;
      }
      console.log(
        `[Claude ${session.id}] query() for-await loop completed normally. Total SDK messages: ${queryMessageCount}`,
      );
    } catch (error) {
      // Log detailed error information to file for debugging
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      logger.error(`[Claude ${session.id}] Error occurred`, {
        error: {
          name: error instanceof Error ? error.name : "Unknown",
          message: errorMessage,
          stack: errorStack,
        },
        config: {
          baseUrl: this.config.baseUrl || "(default)",
          apiKey: this.config.apiKey ? "configured" : "not set",
          model: this.config.model || "(default)",
        },
        env: {
          ANTHROPIC_BASE_URL:
            this.buildEnvConfig().ANTHROPIC_BASE_URL || "(not set)",
          ANTHROPIC_MODEL: this.buildEnvConfig().ANTHROPIC_MODEL || "(not set)",
          hasAuthToken: !!this.buildEnvConfig().ANTHROPIC_AUTH_TOKEN,
        },
      });

      // Check for API key related errors (including Chinese error messages from third-party APIs)
      // IMPROVED: More precise error classification to avoid false positives
      const noApiKeyConfigured =
        !this.config.apiKey &&
        !process.env.ANTHROPIC_API_KEY &&
        !process.env.ANTHROPIC_AUTH_TOKEN;
      const processExitError = errorMessage.includes("exited with code");
      const processCrash =
        errorMessage.includes("killed") || errorMessage.includes("OOM");

      // Check if using custom API - process exit with custom API is likely API compatibility issue
      const usingCustomApi = this.isUsingCustomApi();

      // Cloud proxy / domestic API common Chinese authentication errors (must be grouped with 401, otherwise falls to __INTERNAL_ERROR__)
      const isCloudProxyAuthShape =
        errorMessage.includes("无效的令牌") ||
        errorMessage.includes("new_api_error") ||
        /Failed to authenticate/i.test(errorMessage);

      // IMPROVED: More precise API key error detection
      // Only match EXPLICIT authentication errors, not generic errors that might contain these keywords
      const isApiKeyError =
        isCloudProxyAuthShape ||
        // Explicit API key errors (but NOT when combined with process/timeout keywords)
        ((errorMessage.includes("Invalid API key") ||
          errorMessage.includes("invalid_api_key")) &&
          !errorMessage.includes("timeout") &&
          !errorMessage.includes("Process") &&
          !errorMessage.includes("exited")) ||
        // Explicit authentication failure messages
        errorMessage.includes("AUTH_KEY_UNREGISTERED") ||
        errorMessage.includes("AUTH_BYTES_INVALID") ||
        (errorMessage.includes("authentication failed") &&
          !errorMessage.includes("Process")) ||
        // Explicit 401/403 errors (but NOT from process crashes or network issues)
        ((errorMessage.includes("401") || errorMessage.includes("403")) &&
          !errorMessage.includes("Process") &&
          !errorMessage.includes("exited") &&
          !errorMessage.includes("timeout") &&
          !errorMessage.includes("connection") &&
          !errorMessage.includes("ETIMEDOUT") &&
          !errorMessage.includes("ECONNREFUSED")) ||
        // Only treat as API key error if no API key AND process exited (legacy behavior)
        (noApiKeyConfigured && processExitError && !processCrash);

      // Custom API + process exit error = likely API compatibility issue
      const isApiCompatibilityError =
        usingCustomApi && processExitError && !processCrash;

      // NEW: Detect process crashes (OOM, killed, etc.) - should be retryable
      const isProcessCrash =
        processCrash ||
        errorMessage.includes("137") ||
        errorMessage.includes("SIGKILL");

      // NEW: Detect timeout errors - should be retryable
      const isTimeoutError =
        errorMessage.includes("timeout") ||
        errorMessage.includes("TIMEDOUT") ||
        errorMessage.includes("ETIMEDOUT");

      // IMPROVED: Handle errors with proper classification
      if (isApiKeyError) {
        // Fatal auth error - user must fix API key configuration
        logger.error(`[Claude ${session.id}] API key authentication error`);
        yield {
          type: "error",
          message: "__API_KEY_ERROR__",
        };
      } else if (isApiCompatibilityError) {
        // Custom API compatibility error - show more specific message
        logger.error(
          `[Claude ${session.id}] Custom API compatibility error. Check if the API endpoint supports Claude Code SDK format.`,
        );
        yield {
          type: "error",
          message: "__CUSTOM_API_ERROR__",
        };
      } else if (isProcessCrash) {
        // Process crash (OOM, killed) - this is retryable
        logger.warn(
          `[Claude ${session.id}] Process crash detected (OOM/killed). This error is retryable.`,
          { errorMessage },
        );
        yield {
          type: "error",
          message: `__PROCESS_CRASH__|${LOG_FILE_PATH}`,
        };
      } else if (isTimeoutError) {
        // Timeout error - this is retryable
        logger.warn(
          `[Claude ${session.id}] Timeout detected. This error is retryable.`,
          { errorMessage },
        );
        yield {
          type: "error",
          message: `__TIMEOUT_ERROR__|${LOG_FILE_PATH}`,
        };
      } else {
        // Other internal errors
        logger.error(`[Claude ${session.id}] Internal error:`, errorMessage);
        yield {
          type: "error",
          message: `__INTERNAL_ERROR__|${LOG_FILE_PATH}`,
        };
      }
    } finally {
      this.sessions.delete(session.id);
      // Windows-only: clear skills to prevent stale state between sessions
      if (process.platform === "win32") {
        try {
          const { clearSkillsFromClaude } = require("@/lib/ai/skills/loader");
          clearSkillsFromClaude(sessionCwd);
          const bundledCliPath = getClaudeCodePath();
          if (bundledCliPath) {
            const bundleDir = dirname(bundledCliPath);
            if (bundleDir !== sessionCwd) clearSkillsFromClaude(bundleDir);
          }
        } catch {}
      }
      yield { type: "done", messageId: this.generateMessageId() };
    }
  }

  /**
   * Planning phase only
   */
  async *plan(
    prompt: string,
    options?: PlanOptions,
  ): AsyncGenerator<AgentMessage> {
    // Pass external abortController to session
    const session = this.createSession("planning", {
      abortController: options?.abortController,
    });
    yield {
      type: "session",
      sessionId: session.id,
      messageId: this.generateMessageId(),
    };

    // Get session working directory
    const sessionCwd = getSessionWorkDir(
      options?.cwd || this.config.workDir,
      prompt,
      options?.taskId,
    );
    // Ensure the working directory exists before calling SDK
    await ensureDir(sessionCwd);

    // Sync skills to sessionCwd for 'project' settingSource (always runs)
    try {
      const { syncSkillsToClaude } = require("@/lib/ai/skills/loader");
      syncSkillsToClaude(sessionCwd);
      logger.info(
        `[Claude ${session.id}] Synced skills to session directory: ${sessionCwd}`,
      );
      // Also sync to bundled CLI directory on Windows
      const bundledCliPath = getClaudeCodePath();
      if (bundledCliPath) {
        const bundleDir = dirname(bundledCliPath);
        if (bundleDir !== sessionCwd) {
          syncSkillsToClaude(bundleDir);
          logger.info(
            `[Claude ${session.id}] Synced skills to CLI bundle directory: ${bundleDir}`,
          );
        }
      }
    } catch (error) {
      logger.error(
        `[Claude ${session.id}] Failed to sync skills to session:`,
        error,
      );
    }
    console.log(`[Claude ${session.id}] Working directory: ${sessionCwd}`);
    console.log(`[Claude ${session.id}] Planning phase started`);

    // Include workspace instruction in planning prompt
    const workspaceInstruction = `
## CRITICAL: Output Directory
**ALL files must be saved to: ${sessionCwd}**
If you need to create any files during planning, use this directory.
`;

    // Get user aiSoulPrompt from options
    const userAiSoulPrompt = options?.aiSoulPrompt ?? undefined;

    // Get user language preference
    const userLanguage = options?.language ?? undefined;

    // Include user's custom AI Soul prompt if available
    const aiSoulInstruction =
      userAiSoulPrompt && userAiSoulPrompt.trim().length > 0
        ? `\n\n**User-Defined AI Soul (Custom Instructions)**:\n${userAiSoulPrompt.trim()}\n`
        : "";

    // Include language instruction based on user preference
    const languageInstruction = getLanguageInstruction(userLanguage);

    const planningPrompt =
      workspaceInstruction + languageInstruction + aiSoulInstruction + prompt;

    let fullResponse = "";

    // Ensure Claude Code is installed
    const claudeCodePath = await ensureClaudeCode();
    if (!claudeCodePath) {
      yield {
        type: "error",
        message: "__CLAUDE_CODE_NOT_FOUND__",
      };
      yield { type: "done", messageId: this.generateMessageId() };
      return;
    }

    // Use settingSources based on skillsConfig and custom API config
    const planSettingSources: ("user" | "project")[] = this.buildSettingSources(
      options?.skillsConfig,
    );

    const envConfig = this.buildEnvConfig();

    // When using custom API, pass custom settings with env vars to override user settings
    let planSettingsConfig: string | undefined;
    if (this.isUsingCustomApi()) {
      const customSettings = {
        env: {
          ANTHROPIC_BASE_URL: this.config.baseUrl || "",
          ANTHROPIC_AUTH_TOKEN: this.config.apiKey || "",
          ANTHROPIC_MODEL: this.config.model || "",
          ...(this.config.thinkingLevel === "disabled"
            ? { ANTHROPIC_THINKING_BUDGET: "" }
            : this.config.thinkingLevel === "low"
              ? { ANTHROPIC_THINKING_BUDGET: "2048" }
              : this.config.thinkingLevel === "adaptive"
                ? { ANTHROPIC_THINKING_BUDGET: "32000" }
                : {}),
        },
      };
      planSettingsConfig = JSON.stringify(customSettings);
    }

    const queryOptions = {
      cwd: sessionCwd, // Set working directory for planning phase
      settingSources: planSettingSources,
      settings: planSettingsConfig,
      allowedTools: [], // No tools in planning phase
      // Use permissionMode from options, default to "bypassPermissions"
      permissionMode: options?.permissionMode || "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      // session.abortController now directly uses the externally passed abortController
      abortController: session.abortController,
      env: envConfig,
      model: this.config.model,
      pathToClaudeCodeExecutable: claudeCodePath,
      // Enable debug mode for planning (only in development)
      ...(isDev ? { debug: true, debugFile: LOG_FILE_PATH } : {}),
      spawnClaudeCodeProcess,
      stderr: (data: string) => {
        logger.error(`[Claude ${session.id}] [PLAN] STDERR: ${data}`);
      },

      // Enable Anthropic prompt caching for system prompt to reduce redundant input token costs
      // cache_control: { type: "ephemeral" } caches the static planning instruction block
      // with a 5-minute TTL, saving 60-90% of input tokens for repeated turns (#1496)
      systemPrompt: PLANNING_INSTRUCTION(options?.timezone ?? undefined),
    } as Options;

    logger.info(
      `[Claude ${session.id}] [PLAN] about to call query() with cwd=${sessionCwd}, settingSources=${planSettingSources.join(",")}`,
    );

    try {
      for await (const message of query({
        prompt: planningPrompt,
        options: queryOptions,
      })) {
        if (session.abortController.signal.aborted) break;

        if (message.type === "assistant" && message.message?.content) {
          for (const block of message.message.content) {
            if ("text" in block) {
              fullResponse += block.text;
              yield {
                type: "text",
                content: block.text,
                messageId: this.generateMessageId(),
              };
            }
          }
        }
      }

      // Parse the planning response - can be direct answer or plan
      const planningResult = parsePlanningResponse(fullResponse);

      if (planningResult?.type === "direct_answer") {
        // Simple question - return direct answer, no plan needed
        console.log(
          `[Claude ${session.id}] Direct answer provided (no plan needed)`,
        );
        yield {
          type: "direct_answer",
          content: planningResult.answer,
          messageId: this.generateMessageId(),
        };
      } else if (
        planningResult?.type === "plan" &&
        planningResult.plan.steps.length > 0
      ) {
        // Complex task - return plan
        this.storePlan(planningResult.plan);
        console.log(
          `[Claude ${session.id}] Plan created: ${planningResult.plan.id} with ${planningResult.plan.steps.length} steps`,
        );
        yield {
          type: "plan",
          plan: planningResult.plan,
          messageId: this.generateMessageId(),
        };
      } else {
        // Fallback: try to parse as plan directly
        const plan = parsePlanFromResponse(fullResponse);
        if (plan && plan.steps.length > 0) {
          this.storePlan(plan);
          console.log(
            `[Claude ${session.id}] Plan created: ${plan.id} with ${plan.steps.length} steps`,
          );
          yield { type: "plan", plan, messageId: this.generateMessageId() };
        } else {
          // If no structured response, treat as direct answer
          console.log(
            `[Claude ${session.id}] No plan found, treating as direct answer`,
          );
          yield {
            type: "direct_answer",
            content: fullResponse.trim(),
            messageId: this.generateMessageId(),
          };
        }
      }
    } catch (error) {
      console.error(`[Claude ${session.id}] Planning error:`, error);
      yield {
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      // Windows-only: clear skills to prevent stale state between sessions
      if (process.platform === "win32") {
        try {
          const { clearSkillsFromClaude } = require("@/lib/ai/skills/loader");
          clearSkillsFromClaude(sessionCwd);
          const bundledCliPath = getClaudeCodePath();
          if (bundledCliPath) {
            const bundleDir = dirname(bundledCliPath);
            if (bundleDir !== sessionCwd) clearSkillsFromClaude(bundleDir);
          }
        } catch {}
      }
      yield { type: "done", messageId: this.generateMessageId() };
    }
  }

  /**
   * Create a user message with optional image and PDF attachments
   * This enables sending images and PDFs directly to Claude API instead of saving to disk
   */
  private async *createUserMessageWithMedia(
    prompt: string,
    images: ImageAttachment[],
    pdfs?: PDFAttachment[],
    sessionId?: string,
  ): AsyncGenerator<SDKUserMessage> {
    // Build content blocks - IMAGES/PDFS FIRST, then text
    // This helps the model prioritize media analysis
    // Use any to support both Anthropic and ZhipuAI image formats
    const contentBlocks: any[] = [];

    // Add PDFs as document blocks (before images)
    if (pdfs && pdfs.length > 0) {
      for (const pdf of pdfs) {
        let pdfBlock: any;

        if (pdf.url) {
          // Cloud URL (e.g. TUS blobUrl) - pass as document with URL source
          pdfBlock = {
            type: "document",
            source: {
              type: "url",
              media_type: "application/pdf",
              url: pdf.url,
            },
          };
          console.log(
            `[Claude ${sessionId}] Added PDF document block (URL): ${pdf.url}`,
          );
        } else if (pdf.data) {
          // Base64 encoded PDF data
          let base64Data = pdf.data;
          // Remove data URL prefix if present (e.g., "data:application/pdf;base64,")
          if (base64Data.includes(",")) {
            base64Data = base64Data.split(",")[1];
          }

          // Anthropic document block for PDFs
          pdfBlock = {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64Data,
            },
          };
          console.log(
            `[Claude ${sessionId}] Added PDF document block: pageCount=${pdf.pageCount || "unknown"}, dataLength=${base64Data.length}`,
          );
        } else {
          console.warn(
            `[Claude ${sessionId}] PDF attachment missing both data and url, skipping`,
          );
          continue;
        }
        contentBlocks.push(pdfBlock);
      }
      console.log(`[Claude ${sessionId}] Total PDFs: ${pdfs.length}`);
    }

    // Add images as content blocks
    if (images && images.length > 0) {
      for (const image of images) {
        let imageBlock:
          | Anthropic.ImageBlockParam
          | { type: "image_url"; image_url: { url: string } };

        if (image.url) {
          // Cloud URL (e.g. TUS blobUrl) - pass as image_url block, cloud will fetch it
          imageBlock = {
            type: "image_url",
            image_url: {
              url: image.url,
            },
          };
          console.log(
            `[Claude ${sessionId}] Added image_url content block (URL): ${image.url}`,
          );
        } else if (image.data) {
          // Base64 encoded image data
          let base64Data = image.data;
          // Remove data URL prefix if present (e.g., "data:image/png;base64,")
          if (base64Data.includes(",")) {
            base64Data = base64Data.split(",")[1];
          }

          // Standard Anthropic format
          imageBlock = {
            type: "image",
            source: {
              type: "base64",
              media_type: image.mimeType as
                | "image/jpeg"
                | "image/png"
                | "image/gif"
                | "image/webp",
              data: base64Data,
            },
          };
          const source = imageBlock.source as {
            type: string;
            media_type: string;
            data: string;
          };
          console.log(
            `[Claude ${sessionId}] Added image content block: type=${source.media_type}, dataLength=${source.data.length}`,
          );
        } else {
          console.warn(
            `[Claude ${sessionId}] Skipping image: neither url nor data provided`,
          );
          continue;
        }
        contentBlocks.push(imageBlock);
      }
      console.log(`[Claude ${sessionId}] Total images: ${images.length}`);
    }

    // Add text block LAST
    contentBlocks.push({ type: "text", text: prompt });
    const pdfCount = pdfs?.length || 0;
    console.log(
      `[Claude ${sessionId}] Total content blocks: ${contentBlocks.length} (${pdfCount} PDFs + ${images.length} images + 1 text), textLength=${prompt.length}`,
    );

    const messageParam: Anthropic.MessageParam = {
      role: "user",
      content: contentBlocks,
    };

    const sdkUserMessage: SDKUserMessage = {
      type: "user",
      message: messageParam,
      parent_tool_use_id: null,
      session_id: sessionId || "",
    };

    const contentArray = messageParam.content as any[];
    // Calculate checksums for media data to detect corruption during SDK serialization
    const mediaDataChecksums = contentArray
      .filter(
        (b) =>
          b.type === "image" || b.type === "image_url" || b.type === "document",
      )
      .map((b: any) => {
        // Handle Anthropic format (source.data), ZhipuAI format (image_url.url), and document blocks
        const data = b.type === "image_url" ? b.image_url.url : b.source?.data;
        // Simple checksum: sum of character codes modulo 10000
        let checksum = 0;
        for (let i = 0; i < Math.min(data.length, 1000); i++) {
          checksum = (checksum + data.charCodeAt(i)) % 10000;
        }
        return {
          type: b.type,
          dataLength: data.length,
          checksum: `${checksum}`,
        };
      });

    console.log(
      `[Claude ${sessionId}] SDKUserMessage created with content blocks array:`,
      {
        role: messageParam.role,
        contentType: Array.isArray(messageParam.content)
          ? "array"
          : typeof messageParam.content,
        contentBlockTypes: contentArray.map((b) => b.type),
        totalBlocks: contentArray.length,
        textLength: prompt.length,
        mediaDataChecksums,
        blockOrder: contentArray.map((b, i) => `${i}:${b.type}`).join(", "),
        firstBlockType: contentArray[0]?.type,
        lastBlockType: contentArray[contentArray.length - 1]?.type,
      },
    );

    yield sdkUserMessage;
  }

  /**
   * Execute an approved plan
   */
  async *execute(options: ExecuteOptions): AsyncGenerator<AgentMessage> {
    // Pass external abortController to session
    const session = this.createSession("executing", {
      abortController: options?.abortController,
    });
    yield {
      type: "session",
      sessionId: session.id,
      messageId: this.generateMessageId(),
    };

    // Use the plan passed in options, or fall back to local lookup
    const plan = options.plan || this.getPlan(options.planId);
    if (!plan) {
      console.error(`[Claude ${session.id}] Plan not found: ${options.planId}`);
      yield {
        type: "error",
        message: `Plan not found: ${options.planId}`,
        messageId: this.generateMessageId(),
      };
      yield { type: "done", messageId: this.generateMessageId() };
      return;
    }

    console.log(`[Claude ${session.id}] Using plan: ${plan.id} (${plan.goal})`);

    const sessionCwd = getSessionWorkDir(
      options.cwd || this.config.workDir,
      options.originalPrompt,
      options.taskId,
    );
    // Ensure the working directory exists before calling SDK
    await ensureDir(sessionCwd);

    // Sync skills to sessionCwd for 'project' settingSource (always runs)
    try {
      const { syncSkillsToClaude } = require("@/lib/ai/skills/loader");
      syncSkillsToClaude(sessionCwd);
      logger.info(
        `[Claude ${session.id}] Synced skills to session directory: ${sessionCwd}`,
      );
      // Also sync to bundled CLI directory on Windows
      const bundledCliPath = getClaudeCodePath();
      if (bundledCliPath) {
        const bundleDir = dirname(bundledCliPath);
        if (bundleDir !== sessionCwd) {
          syncSkillsToClaude(bundleDir);
          logger.info(
            `[Claude ${session.id}] Synced skills to CLI bundle directory: ${bundleDir}`,
          );
        }
      }
    } catch (error) {
      logger.error(
        `[Claude ${session.id}] Failed to sync skills to session:`,
        error,
      );
    }

    logger.info(`[Claude ${session.id}] Working directory: ${sessionCwd}`);
    // Log sandbox config for debugging
    logger.info(`[Claude ${session.id}] Execute sandbox config:`, {
      hasSandbox: !!options.sandbox,
      sandboxEnabled: options.sandbox?.enabled,
      sandboxProvider: options.sandbox?.provider,
    });
    if (options.sandbox?.enabled) {
      logger.info(
        `[Claude ${session.id}] Sandbox mode enabled with provider: ${options.sandbox.provider}`,
      );
    } else {
      logger.warn(`[Claude ${session.id}] Sandbox NOT enabled for execution`);
    }

    // Build sandbox options for workspace instruction
    const sandboxOpts: SandboxOptions | undefined = options.sandbox?.enabled
      ? {
          enabled: true,
          image: options.sandbox.image,
          apiEndpoint: options.sandbox.apiEndpoint || SANDBOX_API_URL,
        }
      : undefined;

    // Pass workDir and sandbox to formatPlanForExecution so skills know where to save files
    // Get aiSoulPrompt from options
    const userAiSoulPrompt = options.aiSoulPrompt ?? undefined;

    // Get user language preference
    const userLanguage = options.language ?? undefined;

    const executionPrompt = `${formatPlanForExecution(plan, sessionCwd, sandboxOpts, userAiSoulPrompt, userLanguage, options.timezone ?? undefined)}\n\nOriginal request: ${options.originalPrompt}`;
    logger.info(
      `[Claude ${session.id}] Execution phase started for plan: ${options.planId}`,
    );

    const sentTextHashes = new Set<string>();
    const sentToolIds = new Set<string>();

    // Ensure Claude Code is installed
    logger.info(
      `[Claude ${session.id}] [EXEC] Step 1: calling ensureClaudeCode()`,
    );
    const claudeCodePath = await ensureClaudeCode();
    logger.info(
      `[Claude ${session.id}] [EXEC] Step 1: ensureClaudeCode returned: ${claudeCodePath || "NOT FOUND"}`,
    );
    if (!claudeCodePath) {
      yield {
        type: "error",
        message: "__CLAUDE_CODE_NOT_FOUND__",
      };
      yield { type: "done", messageId: this.generateMessageId() };
      return;
    }

    // Load user-configured MCP servers based on mcpConfig settings
    logger.info(`[Claude ${session.id}] [EXEC] calling loadMcpServers()`);
    const userMcpServers = await loadMcpServers(
      options.mcpConfig as McpConfig | undefined,
    );
    logger.info(
      `[Claude ${session.id}] [EXEC] loadMcpServers done, servers: ${Object.keys(userMcpServers).join(",") || "(none)"}`,
    );

    // Build query options
    // Use settingSources based on skillsConfig to control skill loading
    const execSettingSources: ("user" | "project")[] = this.buildSettingSources(
      options.skillsConfig,
    );
    logger.info(
      `[Claude ${session.id}] Execute skills config:`,
      options.skillsConfig,
    );
    logger.info(
      `[Claude ${session.id}] Execute setting sources: ${execSettingSources.join(", ")}`,
    );

    const envConfig = this.buildEnvConfig();

    // When using custom API, pass custom settings with env vars to override user settings
    let execSettingsConfig: string | undefined;
    if (this.isUsingCustomApi()) {
      const customSettings = {
        env: {
          ANTHROPIC_BASE_URL: this.config.baseUrl || "",
          ANTHROPIC_AUTH_TOKEN: this.config.apiKey || "",
          ANTHROPIC_MODEL: this.config.model || "",
          ...(this.config.thinkingLevel === "disabled"
            ? { ANTHROPIC_THINKING_BUDGET: "" }
            : this.config.thinkingLevel === "low"
              ? { ANTHROPIC_THINKING_BUDGET: "2048" }
              : this.config.thinkingLevel === "adaptive"
                ? { ANTHROPIC_THINKING_BUDGET: "32000" }
                : {}),
        },
      };
      execSettingsConfig = JSON.stringify(customSettings);
    }

    const queryOptions = {
      cwd: sessionCwd,
      tools: { type: "preset", preset: "claude_code" },
      allowedTools: options.allowedTools || ALLOWED_TOOLS,
      settings: execSettingsConfig,
      settingSources: execSettingSources,
      // Use permissionMode from options, default to "bypassPermissions"
      permissionMode: options.permissionMode || "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      // session.abortController now directly uses the externally passed abortController
      abortController: session.abortController,
      env: envConfig,
      model: this.config.model,
      pathToClaudeCodeExecutable: claudeCodePath,
      maxTurns: 1000, // Allow more agentic turns before stopping
      // Enable includePartialMessages for streaming output
      includePartialMessages: true,
      // Capture stderr for debugging
      stderr: (data: string) => {
        logger.error(`[Claude ${session.id}] STDERR: ${data}`);
      },
      // Enable debug mode for execution (only in development)
      ...(isDev ? { debug: true, debugFile: LOG_FILE_PATH } : {}),
      spawnClaudeCodeProcess,

      // Enable Anthropic prompt caching for system prompt to reduce redundant input token costs
      // cache_control: { type: "ephemeral" } caches the static execution role instruction block
      // with a 5-minute TTL, saving 60-90% of input tokens for repeated turns (#1496)
      systemPrompt:
        "You are executing a pre-approved plan with full permissions to use all available tools.",

      // Add canUseTool callback if permissionMode is not bypassPermissions
      ...(options.permissionMode &&
      options.permissionMode !== "bypassPermissions" &&
      options.onPermissionRequest
        ? {
            canUseTool: async (toolName, toolInput, canUseToolOptions) => {
              logger.info(
                `[Claude ${session.id}] Permission request (execute): ${toolName}`,
                { toolInput, decisionReason: canUseToolOptions.decisionReason },
              );

              try {
                const result = await options.onPermissionRequest?.({
                  toolName,
                  toolInput,
                  toolUseID: canUseToolOptions.toolUseID,
                  decisionReason: canUseToolOptions.decisionReason,
                  blockedPath: canUseToolOptions.blockedPath,
                });

                // If no permission handler, deny by default
                if (!result) {
                  logger.warn(
                    `[Claude ${session.id}] No permission handler (execute), denying ${toolName}`,
                  );
                  return {
                    behavior: "deny",
                    message: "Permission check not available",
                    toolUseID: canUseToolOptions.toolUseID,
                  };
                }

                logger.info(
                  `[Claude ${session.id}] Permission decision (execute): ${result.behavior}`,
                );

                // Transform to SDK's PermissionResult type
                if (result.behavior === "allow") {
                  return {
                    behavior: "allow",
                    updatedInput: result.updatedInput,
                    toolUseID: canUseToolOptions.toolUseID,
                  };
                }
                return {
                  behavior: "deny",
                  message: result.message || "Permission denied by user",
                  toolUseID: canUseToolOptions.toolUseID,
                };
              } catch (error) {
                logger.error(
                  `[Claude ${session.id}] Permission request error (execute):`,
                  error,
                );
                // Deny on error
                return {
                  behavior: "deny",
                  message:
                    error instanceof Error
                      ? error.message
                      : "Permission check failed",
                  toolUseID: canUseToolOptions.toolUseID,
                };
              }
            },
          }
        : {}),
    } as Options;

    // Initialize MCP servers with user-configured servers
    const mcpServers: Record<
      string,
      McpServerConfig | ReturnType<typeof createSandboxMcpServer>
    > = {
      ...userMcpServers,
    };

    // Add sandbox MCP server if sandbox is enabled
    if (options.sandbox?.enabled) {
      mcpServers.sandbox = createSandboxMcpServer(options.sandbox.provider);
      // Add sandbox tools to allowed tools
      queryOptions.allowedTools = [
        ...(options.allowedTools || ALLOWED_TOOLS),
        "sandbox_run_script",
        "sandbox_run_command",
      ];
    }

    // Add business tools MCP server if user session is provided
    if (options.session) {
      try {
        mcpServers["business-tools"] = createBusinessToolsMcpServer(
          options.session,
          options.authToken,
          options?.onInsightChange,
          options.sessionId, // Pass sessionId as chatId for insight association
          {
            excludeTools: options.excludeTools,
          },
        );
        // Add business tools to allowed tools
        queryOptions.allowedTools = [
          ...(queryOptions.allowedTools || ALLOWED_TOOLS),
          "chatInsight",
          "modifyInsight",
          "createInsight",
          "deleteInsight",
          "createScheduledJob",
          "listScheduledJobs",
          "deleteScheduledJob",
          "toggleScheduledJob",
          "updateScheduledJob",
          "executeScheduledJob",
          "sendReply",
          "queryContacts",
          "queryIntegrations",
          "searchKnowledgeBase",
          "searchMemoryPath",
          "getRawMessages",
          "searchRawMessages",
          "getFullDocumentContent",
          "listKnowledgeBaseDocuments",
          "downloadInsightAttachment",
          "time",
          ...(options.executionReport?.enabled
            ? ["submitExecutionReport"]
            : []),
        ];
        logger.info(
          `[Claude ${session.id}] Execute: Business tools MCP server loaded with user session`,
        );
      } catch (error) {
        logger.error(
          `[Claude ${session.id}] Execute: Failed to create business tools MCP server:`,
          error,
        );
      }
    }

    // Apply excludeTools filter if specified (must be after all allowedTools modifications)
    if (options.excludeTools && options.excludeTools.length > 0) {
      const excludeSet = new Set(options.excludeTools);
      queryOptions.allowedTools = (queryOptions.allowedTools || []).filter(
        (tool: string) => !excludeSet.has(tool),
      );
      logger.info(
        `[Claude ${session.id}] Execute: Excluded tools: ${options.excludeTools.join(", ")}`,
      );
    }

    // Only add mcpServers to options if there are any configured
    if (Object.keys(mcpServers).length > 0) {
      queryOptions.mcpServers = mcpServers;
    } else {
      logger.warn(`[Claude ${session.id}] Execute: No MCP servers configured`);
    }

    try {
      // Track whether we've sent text via stream_event to avoid duplication
      let hasStreamedText = false;

      logger.info(
        `[Claude ${session.id}] [EXEC] about to call query() with cwd=${sessionCwd}, settingSources=${execSettingSources.join(",")}`,
      );
      for await (const message of query({
        prompt: executionPrompt,
        options: queryOptions,
      })) {
        if (session.abortController.signal.aborted) break;

        for (const agentMessage of this.processMessage(
          message,
          session.id,
          sentTextHashes,
          sentToolIds,
          hasStreamedText,
        )) {
          yield agentMessage;
          // Track if we just sent text from stream_event
          if (
            (message as { type?: string }).type === "stream_event" &&
            agentMessage.type === "text"
          ) {
            hasStreamedText = true;
          }
        }

        // Reset hasStreamedText after processing all messages in this batch
        // If we sent stream text, reset the flag for the next assistant message
        if ((message as { type?: string }).type === "assistant") {
          hasStreamedText = false;
        }
      }
    } catch (error) {
      console.error(`[Claude ${session.id}] Execution error:`, error);
      yield {
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      console.log(`[Claude ${session.id}] Execution done`);
      this.deletePlan(options.planId);
      this.sessions.delete(session.id);
      // Windows-only: clear skills to prevent stale state between sessions
      if (process.platform === "win32") {
        try {
          const { clearSkillsFromClaude } = require("@/lib/ai/skills/loader");
          clearSkillsFromClaude(sessionCwd);
          const bundledCliPath = getClaudeCodePath();
          if (bundledCliPath) {
            const bundleDir = dirname(bundledCliPath);
            if (bundleDir !== sessionCwd) clearSkillsFromClaude(bundleDir);
          }
        } catch {}
      }
      yield { type: "done", messageId: this.generateMessageId() };
    }
  }

  /**
   * Sanitize text content to remove internal implementation details
   * that should not be exposed to users
   *
   * IMPROVED: More precise error detection to avoid false positives
   */
  private sanitizeText(text: string): string {
    let sanitized = text;

    // IMPROVED: More precise API key error patterns
    // Only match EXPLICIT authentication errors
    const apiKeyErrorPatterns = [
      /Invalid API key/i,
      /invalid_api_key/i,
      /API key.*invalid/i,
      /authentication failed/i,
      /Unauthorized/i,
      /AUTH_KEY_UNREGISTERED/,
      /AUTH_BYTES_INVALID/,
    ];

    // Check if error message contains process crash or timeout keywords
    const hasProcessCrash = /killed|OOM|SIGKILL|code 137/i.test(sanitized);
    const hasTimeout = /timeout|TIMEDOUT|ETIMEDOUT/i.test(sanitized);
    const hasProcessExit = /Process|exited with code/i.test(sanitized);

    // Only check for API key errors if NOT related to process crash/timeout
    const hasApiKeyError =
      !hasProcessCrash &&
      !hasTimeout &&
      !hasProcessExit &&
      apiKeyErrorPatterns.some((pattern) => pattern.test(sanitized));

    // Replace "Claude Code process exited with code X" with a special marker
    // The marker will be replaced with localized text on the frontend
    sanitized = sanitized.replace(
      /Claude Code process exited with code \d+/gi,
      "__AGENT_PROCESS_ERROR__",
    );

    // Remove "Please run /login" messages - not relevant for custom API users
    sanitized = sanitized.replace(/\s*[·•\-–—]\s*Please run \/login\.?/gi, "");
    sanitized = sanitized.replace(/Please run \/login\.?/gi, "");

    // If API key error detected, replace entire message with special marker
    // This ensures frontend shows the config prompt instead of raw error
    if (hasApiKeyError) {
      return "__API_KEY_ERROR__";
    }

    return sanitized;
  }

  /**
   * Process SDK messages and convert to AgentMessage format
   */
  private *processMessage(
    message: unknown,
    sessionId: string,
    sentTextHashes: Set<string>,
    sentToolIds: Set<string>,
    hasStreamedText: boolean,
  ): Generator<AgentMessage> {
    const msg = message as {
      type: string;
      message?: { content?: unknown[] };
      subtype?: string;
      total_cost_usd?: number;
      duration_ms?: number;
      event?: {
        type: string;
        delta?: { type?: string; text?: string };
        content_block?: Record<string, unknown>;
      };
    };

    let currentHasStreamedText = hasStreamedText;

    // Handle streaming partial messages (when includePartialMessages is enabled)
    if (msg.type === "stream_event" && msg.event) {
      const event = msg.event;

      // content_block_delta contains incremental text
      if (
        event.type === "content_block_delta" &&
        event.delta &&
        event.delta.type === "text_delta" &&
        event.delta.text
      ) {
        const textDelta = event.delta.text;
        if (textDelta) {
          currentHasStreamedText = true;
          yield {
            type: "text",
            content: textDelta,
            messageId: this.generateMessageId(),
          };
        }
      }

      // Handle thinking delta (extended thinking)
      // Note: SDK uses "thinking_delta" type, not "reasoning_delta"
      if (
        event.type === "content_block_delta" &&
        (event.delta as { type?: string; thinking?: string })?.type ===
          "thinking_delta" &&
        (event.delta as { thinking?: string }).thinking
      ) {
        yield {
          type: "reasoning",
          content: (event.delta as { thinking?: string }).thinking,
          messageId: this.generateMessageId(),
        };
      }

      // content_block_start -- tool_use starts streaming
      if (event.type === "content_block_start" && event.content_block) {
        const block = event.content_block;
        if ("name" in block && "id" in block) {
          const toolId = block.id as string;
          const toolName = block.name as string;
          if (!sentToolIds.has(toolId)) {
            sentToolIds.add(toolId);
            yield {
              type: "tool_use",
              id: toolId,
              name: toolName,
              input: block.input,
              messageId: this.generateMessageId(),
            };
          }
        }
      }

      // content_block_delta -- streaming tool input (input_json_delta)
      if (
        event.type === "content_block_delta" &&
        event.delta?.type === "input_json_delta"
      ) {
        // The full input is already provided in content_block_start.
        // Subsequent input_json_delta events just stream the input parameters.
        // The tool_use event was already emitted with the initial input in content_block_start.
      }
    }

    if (msg.type === "assistant" && msg.message?.content) {
      // Skip entire assistant message text if we've already sent it via stream_event
      // This prevents duplicate text when includePartialMessages is enabled
      if (currentHasStreamedText) {
        // Skip all text blocks in this assistant message
        // But still process tool blocks if any
        for (const block of msg.message.content as Record<string, unknown>[]) {
          if ("name" in block && "id" in block) {
            const toolId = block.id as string;
            const toolName = block.name as string;
            if (!sentToolIds.has(toolId)) {
              sentToolIds.add(toolId);
              yield {
                type: "tool_use",
                id: toolId,
                name: toolName,
                input: block.input,
                messageId: this.generateMessageId(),
              };
            }
          }
        }
        // Early return - skip yielding any text from this assistant message
        return;
      }

      // No streaming happened, yield text blocks normally
      for (const block of msg.message.content as Record<string, unknown>[]) {
        if ("text" in block) {
          const sanitizedText = this.sanitizeText(block.text as string);
          const textHash = sanitizedText.slice(0, 100);

          if (!sentTextHashes.has(textHash)) {
            sentTextHashes.add(textHash);
            yield {
              type: "text",
              content: sanitizedText,
              messageId: this.generateMessageId(),
            };
          }
        } else if ("name" in block && "id" in block) {
          const toolId = block.id as string;
          const toolName = block.name as string;

          // Special handling for AskUserQuestion tool
          if (toolName === "AskUserQuestion" && !sentToolIds.has(toolId)) {
            sentToolIds.add(toolId);
            // Extract question data from tool input
            const toolInput = block.input as {
              questions?: Array<{
                question: string;
                header: string;
                options: Array<{ label: string; description?: string }>;
                multiSelect?: boolean;
              }>;
            };

            if (toolInput.questions && toolInput.questions.length > 0) {
              yield {
                type: "question",
                question: {
                  id: toolId,
                  questions: toolInput.questions,
                  status: "pending",
                },
                messageId: this.generateMessageId(),
              };
            }
          } else if (!sentToolIds.has(toolId)) {
            sentToolIds.add(toolId);
            yield {
              type: "tool_use",
              id: toolId,
              name: toolName,
              input: block.input,
              messageId: this.generateMessageId(),
            };
          }
        }
      }
    }

    if (msg.type === "user" && msg.message?.content) {
      for (const block of msg.message.content as Record<string, unknown>[]) {
        if ("type" in block && block.type === "tool_result") {
          const toolUseIdSnake = (block as { tool_use_id?: unknown })
            .tool_use_id;
          const toolUseIdCamel = (block as { toolUseId?: unknown }).toolUseId;
          const isErrorSnake = (block as { is_error?: unknown }).is_error;
          const isErrorCamel = (block as { isError?: unknown }).isError;
          const toolUseId = toolUseIdSnake ?? toolUseIdCamel;
          const rawIsError = isErrorSnake ?? isErrorCamel;
          const isError = typeof rawIsError === "boolean" ? rawIsError : false;

          yield {
            type: "tool_result",
            toolUseId: (toolUseId ?? "") as string,
            output:
              typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content),
            isError,
            messageId: this.generateMessageId(),
          };
        }
      }
    }

    if (msg.type === "result") {
      yield {
        type: "result",
        content: msg.subtype,
        cost: msg.total_cost_usd,
        duration: msg.duration_ms,
      };
    }
  }
}

/**
 * Factory function to create Claude agent
 */
export function createClaudeAgent(config: AgentConfig): ClaudeAgent {
  // Sync ~/.openloomi/skills/ to project .claude/skills/ for Claude SDK to load them
  // When using custom API, we use 'project' source which reads from .claude/skills/ in the working directory
  try {
    const { syncSkillsToClaude } = require("@/lib/ai/skills/loader");
    syncSkillsToClaude(config.workDir);
  } catch (error) {
    // Don't fail agent creation if skills sync fails
    console.error("[ClaudeAgent] Failed to sync skills:", error);
  }
  return new ClaudeAgent(config);
}

/**
 * Claude agent plugin definition
 */
export const claudePlugin: AgentPlugin = defineAgentPlugin({
  metadata: CLAUDE_METADATA,
  factory: (config) => createClaudeAgent(config),
});
