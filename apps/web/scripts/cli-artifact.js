import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import * as tar from "tar";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, "..");
const NODE_REQUIREMENT = "Node.js 22 or newer";

export function getCliBinaryName(platform = process.platform) {
  return normalizePlatform(platform) === "windows"
    ? "openloomi-ctl.exe"
    : "openloomi-ctl";
}

export function getCliArtifactDir(root = webDir) {
  return path.join(root, "src-tauri", "target", "release", "bundle", "cli");
}

export function getCliReleaseArtifactDir(root = webDir) {
  return path.join(
    root,
    "src-tauri",
    "target",
    "release",
    "bundle",
    "cli-release",
  );
}

export function getCliReleaseArtifactName(
  platform = process.platform,
  arch = process.arch,
) {
  const releasePlatform = normalizePlatform(platform);
  const releaseArch = normalizeArch(arch);
  const extension = releasePlatform === "windows" ? "zip" : "tar.gz";
  return `openloomi-ctl-${releasePlatform}-${releaseArch}.${extension}`;
}

export function verifyCliArtifact(
  dir,
  platform = process.platform,
  options = { requireRunner: true },
) {
  const artifact = path.join(dir, getCliBinaryName(platform));
  if (!fs.existsSync(artifact)) {
    return {
      ok: false,
      path: artifact,
      error: `CLI artifact not found: ${artifact}`,
    };
  }

  if (normalizePlatform(platform) !== "windows") {
    const mode = fs.statSync(artifact).mode;
    if (!hasExecutablePermission(mode)) {
      return {
        ok: false,
        path: artifact,
        error: `CLI artifact is not executable: ${artifact}`,
      };
    }
  }

  if (options.requireRunner !== false) {
    const runner = findCliRunnerArtifact(dir);
    if (!runner) {
      return {
        ok: false,
        path: artifact,
        error: `CLI native-agent runner not found under artifact resources: ${dir}`,
      };
    }
  }

  return { ok: true, path: artifact };
}

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
      throw new Error(`Unsupported CLI artifact platform: ${platform}`);
  }
}

export function normalizeArch(arch = process.arch) {
  switch (arch) {
    case "x64":
    case "amd64":
    case "x86_64":
      return "x64";
    case "arm64":
    case "aarch64":
      return "arm64";
    default:
      throw new Error(`Unsupported CLI artifact architecture: ${arch}`);
  }
}

export function findCliRunnerArtifact(dir) {
  return getCliRunnerArtifactCandidates(dir).find((candidate) =>
    fs.existsSync(candidate),
  );
}

export function getCliRunnerArtifactCandidates(dir) {
  const names = ["native-agent-cli.cjs", "native-agent-cli.mjs"];
  const roots = [
    path.join(
      dir,
      "resources",
      ".next",
      "standalone",
      "apps",
      "web",
      "cli-bundle",
    ),
    path.join(
      dir,
      "resources",
      "_up_",
      ".next",
      "standalone",
      "apps",
      "web",
      "cli-bundle",
    ),
  ];

  return roots.flatMap((root) => names.map((name) => path.join(root, name)));
}

export function hasExecutablePermission(mode) {
  return (mode & 0o111) !== 0;
}

export function stageCliArtifact(
  root = webDir,
  platform = process.platform,
  arch = process.arch,
) {
  const binaryName = getCliBinaryName(platform);
  const source = path.join(root, "src-tauri", "target", "release", binaryName);
  if (!fs.existsSync(source)) {
    throw new Error(`Release CLI binary not found: ${source}`);
  }

  const artifactDir = getCliArtifactDir(root);
  fs.rmSync(artifactDir, { recursive: true, force: true });
  fs.mkdirSync(artifactDir, { recursive: true });
  const destination = path.join(artifactDir, binaryName);
  fs.copyFileSync(source, destination);
  if (normalizePlatform(platform) !== "windows") {
    fs.chmodSync(destination, 0o755);
  }

  stageCliResources(root, artifactDir);
  writeCliReadme(artifactDir, platform, arch);

  const verification = verifyCliArtifact(artifactDir, platform);
  if (!verification.ok) {
    throw new Error(verification.error);
  }
  return verification;
}

export async function packageCliArtifact(
  root = webDir,
  platform = process.platform,
  arch = process.arch,
) {
  const staged = stageCliArtifact(root, platform, arch);
  const releaseDir = getCliReleaseArtifactDir(root);
  fs.mkdirSync(releaseDir, { recursive: true });

  const releaseArtifact = path.join(
    releaseDir,
    getCliReleaseArtifactName(platform, arch),
  );
  fs.rmSync(releaseArtifact, { force: true });

  if (normalizePlatform(platform) === "windows") {
    const zip = new AdmZip();
    addDirectoryToZip(zip, getCliArtifactDir(root), "");
    zip.writeZip(releaseArtifact);
  } else {
    await tar.create(
      {
        gzip: true,
        cwd: getCliArtifactDir(root),
        file: releaseArtifact,
        portable: false,
      },
      ["."],
    );
  }

  if (!fs.existsSync(releaseArtifact)) {
    throw new Error(`CLI release artifact was not created: ${releaseArtifact}`);
  }

  return {
    ...staged,
    artifactPath: releaseArtifact,
    artifactName: path.basename(releaseArtifact),
  };
}

function copyDirRec(src, dest, options = {}) {
  if (!fs.existsSync(src)) {
    return;
  }
  if (options.skip?.(src)) {
    return;
  }
  const stat = fs.statSync(src);
  if (!stat.isDirectory()) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    return;
  }

  fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    copyDirRec(path.join(src, item), path.join(dest, item), options);
  }
}

function stageCliResources(root, artifactDir) {
  const envFile = path.join(root, ".env");
  if (fs.existsSync(envFile)) {
    fs.mkdirSync(path.join(artifactDir, "resources"), { recursive: true });
    fs.copyFileSync(envFile, path.join(artifactDir, "resources", ".env"));
  }

  const standalone = path.join(root, ".next", "standalone");
  if (!fs.existsSync(standalone)) {
    return;
  }

  const resourcesDir = path.join(
    artifactDir,
    "resources",
    ".next",
    "standalone",
  );
  if (fs.existsSync(resourcesDir)) {
    fs.rmSync(resourcesDir, { recursive: true, force: true });
  }
  copyDirRec(standalone, resourcesDir, {
    skip: (source) => shouldSkipStandalonePath(standalone, source),
  });

  const cliBundle = path.join(root, "cli-bundle");
  if (fs.existsSync(cliBundle)) {
    // The standalone trace does not always include files that are loaded by the
    // Rust CLI rather than by Next.js, so stage the native runner explicitly.
    copyDirRec(cliBundle, path.join(resourcesDir, "apps", "web", "cli-bundle"));
  }
}

function shouldSkipStandalonePath(standaloneRoot, source) {
  const relative = path
    .relative(standaloneRoot, source)
    .split(path.sep)
    .join("/");
  if (!relative) {
    return false;
  }

  const skipPrefixes = [
    "apps/web/src-tauri/target",
    "apps/web/.next/cache",
    "apps/web/.next/standalone",
    "apps/web/.turbo",
    "apps/web/coverage",
    "apps/web/playwright-report",
    "apps/web/test-results",
  ];

  if (
    skipPrefixes.some(
      (prefix) => relative === prefix || relative.startsWith(`${prefix}/`),
    )
  ) {
    return true;
  }

  const segments = relative.split("/");
  return segments.includes(".git") || segments.includes(".cache");
}

function addDirectoryToZip(zip, sourceDir, zipRoot) {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const zipPath = zipRoot ? path.posix.join(zipRoot, entry.name) : entry.name;
    if (entry.isDirectory()) {
      zip.addFile(`${zipPath}/`, Buffer.alloc(0));
      addDirectoryToZip(zip, source, zipPath);
    } else {
      zip.addLocalFile(source, zipRoot);
    }
  }
}

function writeCliReadme(
  artifactDir,
  platform = process.platform,
  arch = process.arch,
) {
  fs.writeFileSync(
    path.join(artifactDir, "README.md"),
    getCliReadmeContent(platform, arch),
  );
}

export function getCliReadmeContent(
  platform = process.platform,
  arch = process.arch,
) {
  const releasePlatform = normalizePlatform(platform);
  const releaseArch = normalizeArch(arch);
  const binaryName = getCliBinaryName(platform);
  const promptCommand =
    releasePlatform === "windows"
      ? `.${path.win32.sep}${binaryName}`
      : `./${binaryName}`;
  const tokenExport =
    releasePlatform === "windows"
      ? "set OPENLOOMI_AUTH_TOKEN=your-token"
      : "export OPENLOOMI_AUTH_TOKEN=your-token";
  const stdinCommand =
    releasePlatform === "windows"
      ? `type prompt.txt | ${promptCommand} --one-shot --stdin --json --permission-mode deny`
      : `cat prompt.txt | ${promptCommand} --one-shot --stdin --json --permission-mode deny`;

  return `# OpenLoomi standalone CLI

This archive contains the standalone OpenLoomi CLI release artifact for ${releasePlatform}-${releaseArch}.

## Contents

- \`${binaryName}\`
- \`resources/.next/standalone\`
- \`resources/.next/standalone/apps/web/cli-bundle/native-agent-cli.cjs\`

## Runtime Requirement

This artifact does not bundle Node.js. Install ${NODE_REQUIREMENT} and ensure \`node\` is on \`PATH\` before using \`--one-shot\`.

## Quick Start

\`\`\`bash
${promptCommand} --version
${tokenExport}
${promptCommand} --one-shot "Reply with exactly: OK" --json --permission-mode deny
\`\`\`

Use stdin for batch prompts:

\`\`\`bash
${stdinCommand}
\`\`\`

For CI, install Node.js 22+, set \`OPENLOOMI_AUTH_TOKEN\`, then run the CLI from the extracted directory:

\`\`\`yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
\`\`\`

\`\`\`bash
${tokenExport}
${promptCommand} --one-shot "Summarize the release notes" --json --permission-mode deny
\`\`\`

\`--permission-mode deny\` is the safest default for non-interactive pipelines. Use \`--permission-mode bypass\` only in trusted automation.

Set \`OPENLOOMI_API_URL\` only when you intentionally want the HTTP compatibility path to a running OpenLoomi API service. Without it, release builds use the packaged direct native-agent runner.
`;
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
  const arch = parseOption(args, "--arch", process.arch);
  const artifactDir = positionalArgs(args)[0] ?? getCliArtifactDir();

  if (command === "stage") {
    const result = stageCliArtifact(webDir, platform, arch);
    console.log(`[CLI] Staged ${result.path}`);
    return;
  }

  if (command === "package") {
    const result = await packageCliArtifact(webDir, platform, arch);
    console.log(`[CLI] Packaged ${result.artifactPath}`);
    return;
  }

  if (command === "check") {
    const result = verifyCliArtifact(artifactDir, platform);
    if (!result.ok) {
      console.error(result.error);
      process.exit(1);
    }
    console.log(`[CLI] Verified ${result.path}`);
    return;
  }

  console.error(
    "Usage: node scripts/cli-artifact.js [stage|package|check] [artifactDir] [--platform <platform>] [--arch <arch>]",
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
