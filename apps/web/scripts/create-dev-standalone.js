import fs from "node:fs";
import path from "node:path";

console.log("Creating dev mode standalone placeholder...");

console.log("Cleaning up potential build artifacts...");
const rm = (p) => {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true });
};

rm(".next/standalone/apps/web/.next");
rm(".next/standalone/apps/web/public");
rm(".next/standalone/apps/web/server.js");

const mkdir = (p) => {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
};

mkdir(".next/standalone/apps/web");
mkdir(".next/standalone/apps/web/.next");
mkdir(".next/standalone/apps/web/public");
mkdir(".next/standalone/apps/web/lib");
mkdir(".next/standalone/apps/web/cli-bundle");
mkdir(".next/standalone/node_modules");

fs.writeFileSync(
  ".next/standalone/apps/web/server.js",
  "// Dev placeholder. Next.js serves from source during tauri dev.\n",
);
fs.writeFileSync(".next/standalone/apps/web/.next/.placeholder", "");
fs.writeFileSync(".next/standalone/apps/web/public/.placeholder", "");
fs.writeFileSync(".next/standalone/apps/web/lib/.placeholder", "");
fs.writeFileSync(".next/standalone/apps/web/cli-bundle/.placeholder", "");

console.log("Copying native modules for standalone mode...");

const rootNodeModules = "../../node_modules";

const copyDirRec = (src, dest) => {
  if (!fs.existsSync(src)) return;
  if (fs.statSync(src).isDirectory()) {
    mkdir(dest);
    for (const item of fs.readdirSync(src)) {
      copyDirRec(path.join(src, item), path.join(dest, item));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
};

if (fs.existsSync(`${rootNodeModules}/better-sqlite3`)) {
  const dest = ".next/standalone/node_modules/better-sqlite3";
  mkdir(dest);
  mkdir(`${dest}/lib`);
  copyDirRec(`${rootNodeModules}/better-sqlite3/lib`, `${dest}/lib`);
  fs.copyFileSync(
    `${rootNodeModules}/better-sqlite3/package.json`,
    `${dest}/package.json`,
  );
  if (fs.existsSync(`${rootNodeModules}/better-sqlite3/build`)) {
    mkdir(`${dest}/build`);
    copyDirRec(`${rootNodeModules}/better-sqlite3/build`, `${dest}/build`);
  }
  if (fs.existsSync(`${rootNodeModules}/better-sqlite3/lib/binding`)) {
    mkdir(`${dest}/lib/binding`);
    copyDirRec(
      `${rootNodeModules}/better-sqlite3/lib/binding`,
      `${dest}/lib/binding`,
    );
  }
  console.log("  Copied better-sqlite3");
} else {
  console.log("  Warning: better-sqlite3 not found in", rootNodeModules);
}

if (fs.existsSync(`${rootNodeModules}/bindings`)) {
  const dest = ".next/standalone/node_modules/bindings";
  mkdir(dest);
  copyDirRec(`${rootNodeModules}/bindings`, dest);
  console.log("  Copied bindings");
}

for (const packageName of [
  "sqlite-vec",
  "sqlite-vec-darwin-arm64",
  "sqlite-vec-darwin-x64",
  "sqlite-vec-linux-arm64",
  "sqlite-vec-linux-x64",
  "sqlite-vec-windows-x64",
]) {
  const source = `${rootNodeModules}/${packageName}`;
  if (!fs.existsSync(source)) continue;

  copyDirRec(source, `.next/standalone/node_modules/${packageName}`);
  console.log(`  Copied ${packageName}`);
}

fs.writeFileSync(".next/standalone/package.json", "{}");
fs.writeFileSync(".next/standalone/apps/web/package.json", "{}");
fs.writeFileSync(".next/standalone/node_modules/package.json", "{}");

console.log("Done (dev mode will use source files with native modules)");
