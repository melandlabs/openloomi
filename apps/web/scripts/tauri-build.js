import fs from "node:fs";
import { execSync } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { runRenderEnginePreflight } from "./render-engine-preflight.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const isDarwin = os.platform() === "darwin";

console.log("Starting Tauri build process...");

if (isDarwin) {
  console.log("Cleaning up residual disk mounts...");
  try {
    const output = execSync("hdiutil info 2>/dev/null", { encoding: "utf8" });
    const volumes = output
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("/Volumes/"));
    for (const vol of volumes) {
      const parts = vol.split(/\s+/);
      if (parts[2]) {
        try {
          execSync(`hdiutil detach "${parts[2]}" 2>/dev/null`, {
            stdio: "pipe",
          });
        } catch {}
      }
    }
  } catch {}
}

const webDir = __dirname;
process.chdir(webDir);

function nextBuildEnv() {
  if (!process.platform.startsWith("win")) {
    return process.env;
  }

  const buildHome = `${webDir}/.next-build-home`;
  const appData = `${buildHome}/AppData/Roaming`;
  const localAppData = `${buildHome}/AppData/Local`;
  fs.mkdirSync(appData, { recursive: true });
  fs.mkdirSync(localAppData, { recursive: true });

  return {
    ...process.env,
    HOME: buildHome,
    USERPROFILE: buildHome,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
  };
}

console.log("Web directory:", webDir);
console.log("Working directory:", process.cwd());

console.log("Validating render engine download URL...");
await runRenderEnginePreflight();

console.log("Creating standalone placeholder for Cargo build...");
const mkdir = (p) => {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
};
mkdir(".next/standalone/apps/web/public");
mkdir(".next/standalone/apps/web/.next");
mkdir(".next/standalone/node_modules");
fs.writeFileSync(".next/standalone/package.json", "{}");
fs.writeFileSync(".next/standalone/apps/web/package.json", "{}");
fs.writeFileSync(".next/standalone/node_modules/package.json", "{}");

console.log("Bundling Claude and Node.js runtime...");
execSync("pnpm bundle:runtime", { stdio: "inherit" });

console.log("Bundling native-agent CLI runner...");
execSync("node scripts/build-native-agent-cli.js", { stdio: "inherit" });

console.log("Running migrations and building Next.js...");
execSync("pnpm run build", {
  stdio: "inherit",
  env: {
    ...nextBuildEnv(),
    IS_TAURI: "true",
    SKIP_TYPE_CHECK: "true",
  },
});

console.log("Fixing standalone resources...");
execSync("node scripts/fix-standalone-pnpm.js", { stdio: "inherit" });

console.log("Building and staging bundled openloomi-ctl...");
execSync(
  "cargo build --manifest-path src-tauri/Cargo.toml --release --bin openloomi-ctl",
  { stdio: "inherit" },
);
execSync("node scripts/cli-bundled.js stage", { stdio: "inherit" });

console.log("Build complete!");
