import { EventEmitter } from "node:events";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
  exec: vi.fn(),
  spawn: vi.fn(),
}));
const fileSystemMocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));
const operatingSystemMocks = vi.hoisted(() => ({
  homedir: vi.fn(),
  platform: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    exec: childProcessMocks.exec,
    spawn: childProcessMocks.spawn,
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: fileSystemMocks.existsSync,
    readFileSync: fileSystemMocks.readFileSync,
  };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: operatingSystemMocks.homedir,
    platform: operatingSystemMocks.platform,
  };
});

const { createClaudeCodeProcessSpawner } =
  await import("@/lib/ai/extensions/agent/claude/process-spawner");

type FakeChildProcess = ChildProcess & {
  stderr: EventEmitter;
};

function createFakeChildProcess(): FakeChildProcess {
  const child = new EventEmitter() as FakeChildProcess;
  Object.defineProperties(child, {
    pid: {
      configurable: true,
      enumerable: true,
      value: 4321,
    },
    stderr: {
      configurable: true,
      enumerable: true,
      value: new EventEmitter(),
    },
  });
  return child;
}

function normalizePath(value: unknown): string {
  return String(value).replaceAll("\\", "/");
}

const originalClaudeCodeMarker = process.env.CLAUDECODE;

function restoreClaudeCodeMarker(): void {
  if (originalClaudeCodeMarker === undefined) {
    Reflect.deleteProperty(process.env, "CLAUDECODE");
  } else {
    process.env.CLAUDECODE = originalClaudeCodeMarker;
  }
}

describe("createClaudeCodeProcessSpawner", () => {
  beforeEach(() => {
    childProcessMocks.exec.mockReset();
    childProcessMocks.spawn.mockReset();
    fileSystemMocks.existsSync.mockReset().mockReturnValue(false);
    fileSystemMocks.readFileSync.mockReset();
    operatingSystemMocks.homedir.mockReset().mockReturnValue("C:/Users/test");
    operatingSystemMocks.platform.mockReset();
    restoreClaudeCodeMarker();
  });

  afterEach(() => {
    restoreClaudeCodeMarker();
  });

  it.each([
    {
      name: "the legacy bundled wrapper",
      platform: "win32",
      command: "C:/app/cli-bundle/claude.cmd",
      expectedCommand: "node",
      expectedArgumentPrefix: "C:/app/cli-bundle/cli.js",
      clearsChildMarker: true,
      killsWindowsTree: true,
    },
    {
      name: "an external Windows command wrapper",
      platform: "win32",
      command: "C:/tools/claude.cmd",
      expectedCommand: "cmd.exe",
      expectedArgumentPrefix: "/c",
      clearsChildMarker: false,
      killsWindowsTree: true,
    },
    {
      name: "a Unix shell wrapper",
      platform: "linux",
      command: "/opt/claude.sh",
      expectedCommand: "/bin/sh",
      expectedArgumentPrefix: "-c",
      clearsChildMarker: false,
      killsWindowsTree: false,
    },
    {
      name: "the bundled native executable",
      platform: "win32",
      command: "C:/app/cli-bundle/claude.exe",
      expectedCommand: "C:/app/cli-bundle/claude.exe",
      expectedArgumentPrefix: "--version",
      clearsChildMarker: true,
      killsWindowsTree: true,
    },
  ])(
    "registers process lifecycle and stderr handling for $name",
    ({
      platform,
      command,
      expectedCommand,
      expectedArgumentPrefix,
      clearsChildMarker,
      killsWindowsTree,
    }) => {
      operatingSystemMocks.platform.mockReturnValue(platform);
      const child = createFakeChildProcess();
      childProcessMocks.spawn.mockReturnValue(child);
      const controller = new AbortController();
      const diagnostics: string[] = [];
      const spawnClaudeCodeProcess = createClaudeCodeProcessSpawner(
        diagnostics.push.bind(diagnostics),
      );

      const result = spawnClaudeCodeProcess({
        command,
        args: ["--version"],
        cwd: "relative-workspace",
        env: {
          CLAUDECODE: "parent-session",
          OPENLOOMI_TEST_VALUE: "preserved",
        },
        signal: controller.signal,
      });

      expect(result).toBe(child);
      expect(childProcessMocks.spawn).toHaveBeenCalledOnce();
      const [spawnedCommand, spawnedArguments, spawnedOptions] =
        childProcessMocks.spawn.mock.calls[0];
      expect(normalizePath(spawnedCommand)).toBe(expectedCommand);
      expect(normalizePath(spawnedArguments[0])).toBe(expectedArgumentPrefix);
      expect(spawnedOptions).toMatchObject({
        cwd: join(process.cwd(), "relative-workspace"),
        signal: controller.signal,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      expect(spawnedOptions.env.OPENLOOMI_TEST_VALUE).toBe("preserved");
      expect(spawnedOptions.env.CLAUDECODE).toBe(
        clearsChildMarker ? "" : "parent-session",
      );

      expect(child.stderr.listenerCount("data")).toBe(1);
      expect(child.stderr.listenerCount("end")).toBe(1);
      expect(child.stderr.listenerCount("close")).toBe(1);
      child.stderr.emit("data", Buffer.from("fatal: tok"));
      child.stderr.emit("data", Buffer.from("en=value\npartial"));
      child.stderr.emit("end");
      child.stderr.emit("close");
      expect(diagnostics).toEqual(["fatal: token=value\n", "partial"]);

      controller.abort();
      if (killsWindowsTree) {
        expect(childProcessMocks.exec).toHaveBeenCalledOnce();
        expect(childProcessMocks.exec).toHaveBeenCalledWith(
          "taskkill /F /T /PID 4321",
          { windowsHide: true },
          expect.any(Function),
        );
      } else {
        expect(childProcessMocks.exec).not.toHaveBeenCalled();
      }
    },
  );

  it("does not kill a reused Windows PID after the Claude child has exited", () => {
    operatingSystemMocks.platform.mockReturnValue("win32");
    const child = createFakeChildProcess();
    childProcessMocks.spawn.mockReturnValue(child);
    const controller = new AbortController();

    createClaudeCodeProcessSpawner(vi.fn())({
      command: "C:/app/cli-bundle/claude.exe",
      args: [],
      env: {},
      signal: controller.signal,
    });

    child.emit("exit", 0, null);
    controller.abort();

    expect(childProcessMocks.exec).not.toHaveBeenCalled();
  });

  it("still kills the Windows tree when Node emits AbortError first", () => {
    operatingSystemMocks.platform.mockReturnValue("win32");
    const child = createFakeChildProcess();
    const controller = new AbortController();
    child.on("error", vi.fn());
    childProcessMocks.spawn.mockImplementation(() => {
      // Node registers its own signal handler inside spawn() before the custom
      // spawner can register tree cleanup. It emits AbortError first.
      controller.signal.addEventListener(
        "abort",
        () => child.emit("error", new Error("AbortError")),
        { once: true },
      );
      return child;
    });

    createClaudeCodeProcessSpawner(vi.fn())({
      command: "C:/app/cli-bundle/claude.exe",
      args: [],
      env: {},
      signal: controller.signal,
    });

    controller.abort();

    expect(childProcessMocks.exec).toHaveBeenCalledOnce();
    expect(childProcessMocks.exec).toHaveBeenCalledWith(
      "taskkill /F /T /PID 4321",
      { windowsHide: true },
      expect.any(Function),
    );
  });

  it("resolves a relocated legacy bundle through its marker file", () => {
    operatingSystemMocks.platform.mockReturnValue("win32");
    fileSystemMocks.existsSync.mockImplementation((path) => {
      const normalized = normalizePath(path);
      return (
        normalized.endsWith("/cli-bundle/.bundle-path") ||
        normalized === "D:/real-claude-bundle"
      );
    });
    fileSystemMocks.readFileSync.mockReturnValue("D:/real-claude-bundle\n");
    const child = createFakeChildProcess();
    childProcessMocks.spawn.mockReturnValue(child);

    createClaudeCodeProcessSpawner(vi.fn())({
      command: "C:/app/cli-bundle/claude.cmd",
      args: ["--version"],
      env: {},
      signal: new AbortController().signal,
    });

    const [spawnedCommand, spawnedArguments] =
      childProcessMocks.spawn.mock.calls[0];
    expect(spawnedCommand).toBe("node");
    expect(normalizePath(spawnedArguments[0])).toBe(
      "D:/real-claude-bundle/cli.js",
    );
  });
});
