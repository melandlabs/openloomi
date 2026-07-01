import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, "..");

const RUNNER_NAMES = ["native-agent-cli.cjs", "native-agent-cli.mjs"];

export function normalizePlatform(platform = process.platform) {
  switch (platform) {
    case "win32":
    case "windows":
      return "windows";
    case "darwin":
    case "macos":
      return "macos";
    case "linux":
      return "linux";
    default:
      throw new Error(`Unsupported bundled CLI platform: ${platform}`);
  }
}

export function getCliBinaryName(platform = process.platform) {
  return normalizePlatform(platform) === "windows"
    ? "openloomi-ctl.exe"
    : "openloomi-ctl";
}

export function getBundledCliSourceDir(root = webDir) {
  return path.join(root, "src-tauri", "cli");
}

export function getBundledCliBinaryPath(
  root = webDir,
  platform = process.platform,
) {
  return path.join(getBundledCliSourceDir(root), getCliBinaryName(platform));
}

export function hasExecutablePermission(mode) {
  return (mode & 0o111) !== 0;
}

export function stageBundledCli(root = webDir, platform = process.platform) {
  const binaryName = getCliBinaryName(platform);
  const source = path.join(root, "src-tauri", "target", "release", binaryName);
  if (!fs.existsSync(source)) {
    throw new Error(`Release CLI binary not found: ${source}`);
  }

  const destinationDir = getBundledCliSourceDir(root);
  fs.mkdirSync(destinationDir, { recursive: true });
  for (const generatedName of ["openloomi-ctl", "openloomi-ctl.exe"]) {
    fs.rmSync(path.join(destinationDir, generatedName), { force: true });
  }

  const destination = path.join(destinationDir, binaryName);
  fs.copyFileSync(source, destination);
  if (
    normalizePlatform(platform) !== "windows" &&
    process.platform !== "win32"
  ) {
    fs.chmodSync(destination, 0o755);
  }

  const verification = verifyBundledCliLayout(root, platform, {
    requireRuntime: false,
  });
  if (!verification.ok) {
    throw new Error(verification.error);
  }
  return verification;
}

export function verifyBundledCliLayout(
  inputPath,
  platform = process.platform,
  options = {},
) {
  const requireRuntime = options.requireRuntime !== false;
  const layout = findBundledCliLayout(inputPath, platform);
  if (!layout.binaryPath || !fs.existsSync(layout.binaryPath)) {
    return {
      ok: false,
      error: `bundled CLI binary not found under ${path.resolve(inputPath)}`,
      ...layout,
    };
  }

  if (
    normalizePlatform(platform) !== "windows" &&
    process.platform !== "win32"
  ) {
    const mode = fs.statSync(layout.binaryPath).mode;
    if (!hasExecutablePermission(mode)) {
      return {
        ok: false,
        error: `bundled CLI binary is not executable: ${layout.binaryPath}`,
        ...layout,
      };
    }
  }

  if (requireRuntime) {
    const runner = findNativeAgentRunner(layout.runtimeAppCandidates);
    if (!runner) {
      return {
        ok: false,
        error: `bundled native-agent runner not found under ${layout.resourceRoot}`,
        ...layout,
      };
    }

    const runtimeAppDir = path.dirname(path.dirname(runner));
    if (
      !fs.existsSync(runtimeAppDir) ||
      !fs.statSync(runtimeAppDir).isDirectory()
    ) {
      return {
        ok: false,
        error: `bundled apps/web runtime not found for runner ${runner}`,
        ...layout,
      };
    }

    return {
      ok: true,
      ...layout,
      runner,
      runtimeAppDir,
      runtimeRoot: path.resolve(runtimeAppDir, "..", "..", ".."),
    };
  }

  return { ok: true, ...layout };
}

export function findBundledCliLayout(inputPath, platform = process.platform) {
  const root = path.resolve(inputPath);
  const binaryName = getCliBinaryName(platform);
  const candidates = bundledLayoutCandidates(root, binaryName);
  const linuxDebCandidate = linuxDebLayoutCandidate(root, binaryName);
  if (linuxDebCandidate) {
    candidates.push(linuxDebCandidate);
  }
  const recursiveCandidate = findRecursiveCliCandidate(root, binaryName);
  if (recursiveCandidate) {
    candidates.push(recursiveCandidate);
  }
  const match = candidates.find((candidate) =>
    fs.existsSync(candidate.binaryPath),
  );
  const selected = match ?? candidates[0];

  return {
    inputPath: root,
    binaryPath: selected.binaryPath,
    cliDir: selected.cliDir,
    resourceRoot: selected.resourceRoot,
    runtimeAppCandidates: runtimeAppCandidates(selected.resourceRoot, root),
    layoutKind: selected.kind,
  };
}

function bundledLayoutCandidates(root, binaryName) {
  const candidates = [];

  candidates.push({
    kind: "source-root",
    cliDir: path.join(root, "src-tauri", "cli"),
    binaryPath: path.join(root, "src-tauri", "cli", binaryName),
    resourceRoot: root,
  });

  candidates.push({
    kind: "macos-app",
    cliDir: path.join(root, "Contents", "Resources", "cli"),
    binaryPath: path.join(root, "Contents", "Resources", "cli", binaryName),
    resourceRoot: path.join(root, "Contents", "Resources"),
  });

  candidates.push({
    kind: "resource-root",
    cliDir: path.join(root, "cli"),
    binaryPath: path.join(root, "cli", binaryName),
    resourceRoot: root,
  });

  candidates.push({
    kind: "nested-resource-root",
    cliDir: path.join(root, "resources", "cli"),
    binaryPath: path.join(root, "resources", "cli", binaryName),
    resourceRoot: path.join(root, "resources"),
  });

  return candidates;
}

function linuxDebLayoutCandidate(root, binaryName) {
  const binaryPath = path.join(root, "usr", "bin", binaryName);
  if (!fs.existsSync(binaryPath)) {
    return undefined;
  }

  return {
    kind: "linux-deb-system",
    cliDir: path.dirname(binaryPath),
    binaryPath,
    resourceRoot:
      findLinuxDebResourceRoot(root) ??
      path.join(root, "usr", "lib", "openloomi"),
  };
}

function findLinuxDebResourceRoot(root) {
  for (const libDir of [
    path.join(root, "usr", "lib"),
    path.join(root, "usr", "lib64"),
  ]) {
    const resourceRoot = findResourceRootWithNativeAgentRunner(libDir);
    if (resourceRoot) {
      return resourceRoot;
    }
  }
  return undefined;
}

function findResourceRootWithNativeAgentRunner(startDir) {
  if (!fs.existsSync(startDir) || !fs.statSync(startDir).isDirectory()) {
    return undefined;
  }

  const queue = [{ dir: startDir, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    if (depth > 4) {
      continue;
    }

    if (findNativeAgentRunner(runtimeAppCandidates(dir, startDir))) {
      return dir;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
      }
    }
  }

  return undefined;
}

function findRecursiveCliCandidate(root, binaryName) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return undefined;
  }

  const queue = [{ dir: root, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    if (depth > 8) {
      continue;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === binaryName) {
        const cliDir = path.dirname(child);
        const resourceRoot =
          path.basename(cliDir).toLowerCase() === "cli"
            ? path.dirname(cliDir)
            : cliDir;
        return {
          kind: "recursive-package",
          cliDir,
          binaryPath: child,
          resourceRoot,
        };
      }
      if (entry.isDirectory()) {
        queue.push({ dir: child, depth: depth + 1 });
      }
    }
  }

  return undefined;
}

function runtimeAppCandidates(resourceRoot, inputRoot) {
  return uniquePaths([
    path.join(resourceRoot, ".next", "standalone", "apps", "web"),
    path.join(resourceRoot, "_up_", ".next", "standalone", "apps", "web"),
    path.join(resourceRoot, "resources", ".next", "standalone", "apps", "web"),
    path.join(
      resourceRoot,
      "resources",
      "_up_",
      ".next",
      "standalone",
      "apps",
      "web",
    ),
    path.join(inputRoot, ".next", "standalone", "apps", "web"),
    path.join(inputRoot, "_up_", ".next", "standalone", "apps", "web"),
  ]);
}

function findNativeAgentRunner(runtimeCandidates) {
  for (const runtimeAppDir of runtimeCandidates) {
    for (const runnerName of RUNNER_NAMES) {
      const runner = path.join(runtimeAppDir, "cli-bundle", runnerName);
      if (fs.existsSync(runner)) {
        return runner;
      }
    }
  }
  return undefined;
}

function uniquePaths(paths) {
  return [...new Set(paths.map((candidate) => path.resolve(candidate)))];
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

async function main() {
  const command = process.argv[2] ?? "check";
  const args = process.argv.slice(3);
  const platform = parseOption(args, "--platform", process.platform);
  const targetPath = positionalArgs(args)[0] ?? webDir;

  if (command === "stage") {
    const result = stageBundledCli(webDir, platform);
    console.log(`[bundled CLI] Staged ${result.binaryPath}`);
    return;
  }

  if (command === "check") {
    const result = verifyBundledCliLayout(targetPath, platform);
    if (!result.ok) {
      console.error(result.error);
      process.exit(1);
    }
    console.log(`[bundled CLI] Verified ${result.binaryPath}`);
    console.log(`[bundled CLI] Runner ${result.runner}`);
    return;
  }

  console.error(
    "Usage: node scripts/cli-bundled.js [stage|check] [bundle-or-resource-path] [--platform <platform>]",
  );
  process.exit(2);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
