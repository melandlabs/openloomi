import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const __dirname = path.dirname(scriptPath);
const webDir = path.resolve(__dirname, "..");
const entry = path.join(webDir, "scripts", "native-agent-cli.ts");
const outDir = path.join(webDir, "cli-bundle");
const defaultOutput = path.join(outDir, "native-agent-cli.cjs");
const importMetaUrlIdentifier = "__openloomiCjsImportMetaUrl";

const external = [
  // Native modules stay external so they can be loaded from the packaged
  // standalone node_modules directory with their platform-specific binaries.
  "better-sqlite3",
  "sqlite3",
  "sqlite-vec",
  "sqlite-vec-windows-x64",
  "onnxruntime-node",
  "zlib-sync",
  "bun:sqlite",
  "@photon-ai/imessage-kit",
  "bufferutil",
  "utf-8-validate",
];

/**
 * Build the standalone native-agent runner used by packaged openloomi-ctl.
 *
 * esbuild cannot preserve import.meta.url when lowering nested ESM packages to
 * CommonJS: it otherwise emits an empty import_meta object. Several upstream
 * dependencies, including the Claude Agent SDK, pass that URL to
 * createRequire(). Replace every import.meta.url with the actual bundle URL so
 * Node receives a valid absolute module location at runtime.
 */
export async function buildNativeAgentCli({
  output = defaultOutput,
  logLevel = "info",
  quiet = false,
} = {}) {
  fs.mkdirSync(path.dirname(output), { recursive: true });

  if (!quiet) {
    console.log("[CLI] Bundling native-agent CLI runner...");
  }
  await build({
    entryPoints: [entry],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    conditions: ["react-server", "node"],
    tsconfig: path.join(webDir, "tsconfig.json"),
    logLevel,
    sourcemap: false,
    banner: {
      js: `const ${importMetaUrlIdentifier} = require("node:url").pathToFileURL(__filename).href;`,
    },
    define: {
      "import.meta.url": importMetaUrlIdentifier,
    },
    external,
  });

  if (!fs.existsSync(output)) {
    throw new Error(`native-agent CLI bundle was not created at ${output}`);
  }

  if (!quiet) {
    console.log(`[CLI] Native-agent CLI runner bundled: ${output}`);
  }
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await buildNativeAgentCli();
}
