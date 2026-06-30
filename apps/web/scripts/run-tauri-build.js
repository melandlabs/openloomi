import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runRenderEnginePreflight } from "./render-engine-preflight.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const cwd = path.resolve(__dirname, "..");
const scriptsDir = path.resolve(__dirname);

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: "inherit",
      shell: true,
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed: ${cmd} ${args.join(" ")}`));
    });
  });
}

function nextBuildEnv(env) {
  if (process.platform !== "win32") {
    return env;
  }

  const buildHome = path.join(cwd, ".next-build-home");
  const appData = path.join(buildHome, "AppData", "Roaming");
  const localAppData = path.join(buildHome, "AppData", "Local");
  fs.mkdirSync(appData, { recursive: true });
  fs.mkdirSync(localAppData, { recursive: true });

  return {
    ...env,
    HOME: buildHome,
    USERPROFILE: buildHome,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
  };
}

async function main() {
  const env = { IS_TAURI: "true", NODE_ENV: "production" };

  console.log("[0/6] Validating render engine downloads...");
  await runRenderEnginePreflight({ ...process.env, ...env });

  console.log("[1/6] Bundling runtime...");
  await run("pnpm", ["--filter", "web", "bundle:runtime"], env);

  console.log("[2/6] Bundling native-agent CLI runner...");
  await run("node", [path.join(scriptsDir, "build-native-agent-cli.js")], env);

  console.log("[3/6] Building Next.js...");
  // Use Turbopack in CI (Windows) to avoid webpack glob EPERM errors.
  if (process.env.USE_TURBOPACK === "true") {
    await run("pnpm", ["--filter", "web", "build:turbo"], nextBuildEnv(env));
  } else {
    await run("pnpm", ["--filter", "web", "build"], nextBuildEnv(env));
  }

  console.log("[4/6] Fixing standalone...");
  await run("node", [path.join(scriptsDir, "fix-standalone-pnpm.js")]);

  console.log("[5/6] Building and staging bundled openloomi-ctl...");
  await run(
    "cargo",
    [
      "build",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--release",
      "--bin",
      "openloomi-ctl",
    ],
    env,
  );
  await run("node", [path.join(scriptsDir, "cli-bundled.js"), "stage"], env);

  console.log("[6/6] Render engine download preflight passed");
  console.log("Done!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
