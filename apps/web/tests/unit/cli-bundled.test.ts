import {
  chmodSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  findBundledCliLayout,
  getBundledCliBinaryPath,
  getBundledCliSourceDir,
  getCliBinaryName,
  hasExecutablePermission,
  stageBundledCli,
  verifyBundledCliLayout,
} from "../../scripts/cli-bundled.js";

const roots: string[] = [];

function tempRoot(name: string) {
  const root = join(
    tmpdir(),
    `openloomi-cli-bundled-${name}-${process.pid}-${Date.now()}`,
  );
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
}

function writeRuntime(root: string, prefix: string[] = []) {
  const runner = join(
    root,
    ...prefix,
    ".next",
    "standalone",
    "apps",
    "web",
    "cli-bundle",
    "native-agent-cli.cjs",
  );
  mkdirSync(dirname(runner), { recursive: true });
  writeFileSync(runner, "runner");
  return runner;
}

function writeBundledBinary(root: string, platform: NodeJS.Platform) {
  const binary = getBundledCliBinaryPath(root, platform);
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, "binary");
  if (platform !== "win32") {
    chmodSync(binary, 0o755);
  }
  return binary;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("bundled CLI resource checks", () => {
  it("uses platform-specific openloomi-ctl binary names", () => {
    expect(getCliBinaryName("win32")).toBe("openloomi-ctl.exe");
    expect(getCliBinaryName("darwin")).toBe("openloomi-ctl");
    expect(getCliBinaryName("linux")).toBe("openloomi-ctl");
  });

  it("stages the CLI binary into src-tauri/cli for Tauri resources", () => {
    const root = tempRoot("stage");
    const releaseDir = join(root, "src-tauri", "target", "release");
    const source = join(releaseDir, getCliBinaryName(process.platform));
    mkdirSync(releaseDir, { recursive: true });
    writeFileSync(source, "binary");
    if (process.platform !== "win32") {
      chmodSync(source, 0o755);
    }

    const result = stageBundledCli(root, process.platform);

    expect(result.ok).toBe(true);
    expect(result.binaryPath).toBe(
      getBundledCliBinaryPath(root, process.platform),
    );
    expect(existsSync(result.binaryPath)).toBe(true);
    expect(basename(getBundledCliSourceDir(root))).toBe("cli");
  });

  it("finds source-root bundled CLI layout and runtime", () => {
    const root = tempRoot("source-root");
    const binary = writeBundledBinary(root, "win32");
    const runner = writeRuntime(root);

    expect(findBundledCliLayout(root, "win32")).toMatchObject({
      binaryPath: binary,
      layoutKind: "source-root",
      resourceRoot: root,
    });
    expect(verifyBundledCliLayout(root, "win32")).toMatchObject({
      ok: true,
      binaryPath: binary,
      runner,
    });
  });

  it("finds macOS app bundle CLI layout and _up_ runtime", () => {
    const root = tempRoot("macos-app");
    const app = join(root, "openloomi.app");
    const resources = join(app, "Contents", "Resources");
    const binary = join(resources, "cli", "openloomi-ctl");
    mkdirSync(dirname(binary), { recursive: true });
    writeFileSync(binary, "binary");
    chmodSync(binary, 0o755);
    const runner = writeRuntime(resources, ["_up_"]);

    expect(verifyBundledCliLayout(app, "darwin")).toMatchObject({
      ok: true,
      binaryPath: binary,
      layoutKind: "macos-app",
      runner,
    });
  });

  it("finds resource-root CLI layout used by Windows and Linux bundles", () => {
    const root = tempRoot("resource-root");
    const binary = join(root, "cli", "openloomi-ctl.exe");
    mkdirSync(dirname(binary), { recursive: true });
    writeFileSync(binary, "binary");
    const runner = writeRuntime(root, ["_up_"]);

    expect(verifyBundledCliLayout(root, "win32")).toMatchObject({
      ok: true,
      binaryPath: binary,
      layoutKind: "resource-root",
      runner,
    });
  });

  it("maps Linux deb /usr/bin CLI binaries to /usr/lib/openloomi resources", () => {
    const root = tempRoot("linux-deb");
    const binary = join(root, "usr", "bin", "openloomi-ctl");
    mkdirSync(dirname(binary), { recursive: true });
    writeFileSync(binary, "binary");
    chmodSync(binary, 0o755);
    const resourceRoot = join(root, "usr", "lib", "openloomi");
    const runner = writeRuntime(resourceRoot);

    expect(findBundledCliLayout(root, "linux")).toMatchObject({
      binaryPath: binary,
      layoutKind: "linux-deb-system",
      resourceRoot,
    });
    expect(verifyBundledCliLayout(root, "linux")).toMatchObject({
      ok: true,
      binaryPath: binary,
      runner,
    });
  });

  it("requires the packaged native-agent runner in bundled resources", () => {
    const root = tempRoot("missing-runner");
    writeBundledBinary(root, "win32");

    expect(verifyBundledCliLayout(root, "win32")).toMatchObject({
      ok: false,
      error: expect.stringContaining("native-agent runner"),
    });
  });

  it("detects executable permission bits for macOS and Linux bundles", () => {
    expect(hasExecutablePermission(0o755)).toBe(true);
    expect(hasExecutablePermission(0o700)).toBe(true);
    expect(hasExecutablePermission(0o644)).toBe(false);
  });

  it.runIf(process.platform !== "win32")(
    "requires executable permissions for macOS and Linux bundles",
    () => {
      const root = tempRoot("linux-perms");
      const binary = getBundledCliBinaryPath(root, "linux");
      mkdirSync(dirname(binary), { recursive: true });
      writeFileSync(binary, "binary");
      chmodSync(binary, 0o644);
      writeRuntime(root);

      expect(verifyBundledCliLayout(root, "linux")).toMatchObject({
        ok: false,
        error: expect.stringContaining("not executable"),
      });

      chmodSync(binary, 0o755);
      expect(verifyBundledCliLayout(root, "linux")).toMatchObject({
        ok: true,
      });
    },
  );
});
