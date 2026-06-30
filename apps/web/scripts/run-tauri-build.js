import { spawn } from "node:child_process";
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

async function main() {
  const env = { IS_TAURI: "true", NODE_ENV: "production" };

  console.log("[0/5] Validating render engine downloads...");
  await runRenderEnginePreflight({ ...process.env, ...env });

  console.log("[1/5] Bundling runtime...");
  await run("pnpm", ["--filter", "web", "bundle:runtime"], env);

  console.log("[2/5] Bundling native-agent CLI runner...");
  await run("node", [path.join(scriptsDir, "build-native-agent-cli.js")], env);

  console.log("[3/5] Building Next.js...");
  // Use Turbopack in CI (Windows) to avoid webpack glob EPERM errors
  if (process.env.USE_TURBOPACK === "true") {
    await run("pnpm", ["--filter", "web", "build:turbo"], env);
  } else {
    await run("pnpm", ["--filter", "web", "build"], env);
  }

  console.log("[4/5] Fixing standalone...");
  await run("node", [path.join(scriptsDir, "fix-standalone-pnpm.js")]);

  console.log("[5/5] Render engine download preflight passed");
  console.log("Done!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
