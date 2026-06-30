import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  findCliRunnerArtifact,
  getCliBinaryName,
  getCliReadmeContent,
  getCliReleaseArtifactName,
  hasExecutablePermission,
  packageCliArtifact,
  verifyCliArtifact,
} from "../../scripts/cli-artifact.js";

const roots: string[] = [];

function tempRoot(name: string) {
  const root = join(
    tmpdir(),
    `openloomi-cli-artifact-${name}-${process.pid}-${Date.now()}`,
  );
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
}

function writeRunnerArtifact(root: string) {
  const runner = join(
    root,
    "resources",
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

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("CLI artifact packaging checks", () => {
  it("uses platform-specific openloomi-ctl binary names", () => {
    expect(getCliBinaryName("win32")).toBe("openloomi-ctl.exe");
    expect(getCliBinaryName("darwin")).toBe("openloomi-ctl");
    expect(getCliBinaryName("linux")).toBe("openloomi-ctl");
  });

  it("uses platform and architecture in final release artifact names", () => {
    expect(getCliReleaseArtifactName("win32", "x64")).toBe(
      "openloomi-ctl-windows-x64.zip",
    );
    expect(getCliReleaseArtifactName("darwin", "arm64")).toBe(
      "openloomi-ctl-macos-arm64.tar.gz",
    );
    expect(getCliReleaseArtifactName("linux", "x64")).toBe(
      "openloomi-ctl-linux-x64.tar.gz",
    );
  });

  it("documents the system Node.js requirement in the artifact README", () => {
    const readme = getCliReadmeContent("linux", "x64");

    expect(readme).toContain("Node.js 22 or newer");
    expect(readme).toContain("OPENLOOMI_AUTH_TOKEN");
    expect(readme).toContain("--one-shot");
    expect(readme).toContain("--stdin");
  });

  it("accepts the Windows CLI executable artifact", () => {
    const root = tempRoot("win32");
    const artifact = join(root, "openloomi-ctl.exe");
    writeFileSync(artifact, "binary");
    writeRunnerArtifact(root);

    expect(verifyCliArtifact(root, "win32")).toEqual({
      ok: true,
      path: artifact,
    });
  });

  it("requires the packaged native-agent runner beside the CLI artifact", () => {
    const root = tempRoot("missing-runner");
    writeFileSync(join(root, "openloomi-ctl.exe"), "binary");

    expect(verifyCliArtifact(root, "win32")).toMatchObject({
      ok: false,
      error: expect.stringContaining("native-agent runner"),
    });
  });

  it("finds the packaged native-agent runner in standalone resources", () => {
    const root = tempRoot("runner");
    const runner = writeRunnerArtifact(root);

    expect(findCliRunnerArtifact(root)).toBe(runner);
  });

  it("detects executable permission bits for macOS and Linux artifacts", () => {
    expect(hasExecutablePermission(0o755)).toBe(true);
    expect(hasExecutablePermission(0o700)).toBe(true);
    expect(hasExecutablePermission(0o644)).toBe(false);
  });

  it.runIf(process.platform !== "win32")(
    "requires executable permissions for macOS and Linux artifacts",
    () => {
      const root = tempRoot("linux");
      const artifact = join(root, "openloomi-ctl");
      writeFileSync(artifact, "binary");
      writeRunnerArtifact(root);
      chmodSync(artifact, 0o644);

      expect(verifyCliArtifact(root, "linux")).toMatchObject({
        ok: false,
        error: expect.stringContaining("not executable"),
      });

      chmodSync(artifact, 0o755);
      expect(verifyCliArtifact(root, "linux")).toEqual({
        ok: true,
        path: artifact,
      });
    },
  );

  it("packages a final release archive from the staged CLI artifact", async () => {
    const root = tempRoot("package");
    const releaseDir = join(root, "src-tauri", "target", "release");
    const binary = join(releaseDir, getCliBinaryName(process.platform));
    mkdirSync(dirname(binary), { recursive: true });
    writeFileSync(binary, "binary");
    if (process.platform !== "win32") {
      chmodSync(binary, 0o755);
    }

    const standalone = join(root, ".next", "standalone", "apps", "web");
    mkdirSync(standalone, { recursive: true });
    writeFileSync(join(standalone, "package.json"), "{}");
    const cliBundle = join(root, "cli-bundle");
    mkdirSync(cliBundle, { recursive: true });
    writeFileSync(join(cliBundle, "native-agent-cli.cjs"), "runner");

    const result = await packageCliArtifact(root, process.platform, process.arch);

    expect(existsSync(result.artifactPath)).toBe(true);
    expect(basename(result.artifactPath)).toBe(
      getCliReleaseArtifactName(process.platform, process.arch),
    );
    expect(
      verifyCliArtifact(
        join(root, "src-tauri", "target", "release", "bundle", "cli"),
        process.platform,
      ),
    ).toMatchObject({ ok: true });
  });
});
