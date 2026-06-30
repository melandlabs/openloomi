import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, "..");
const entry = path.join(webDir, "scripts", "native-agent-cli.ts");
const outDir = path.join(webDir, "cli-bundle");
const output = path.join(outDir, "native-agent-cli.cjs");

fs.mkdirSync(outDir, { recursive: true });

console.log("[CLI] Bundling native-agent CLI runner...");
await build({
  entryPoints: [entry],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  conditions: ["react-server", "node"],
  tsconfig: path.join(webDir, "tsconfig.json"),
  logLevel: "info",
  sourcemap: false,
  external: [
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
  ],
});

if (!fs.existsSync(output)) {
  throw new Error(`native-agent CLI bundle was not created at ${output}`);
}

console.log(`[CLI] Native-agent CLI runner bundled: ${output}`);
