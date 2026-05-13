/**
 * Skills Bundler - Stub/Facade Pattern
 *
 * This file is parsed by Next.js at build time (via Edge Runtime check),
 * it doesn't directly include top-level imports of Node.js modules, but dynamically loads them on demand at runtime.
 *
 * Non-Tauri environment: returns no-op
 * Tauri environment: dynamically imports actual Node.js modules and executes operations
 */

export async function getDefaultSkillsDir(): Promise<string> {
  const { join } = await import("node:path");
  const { homedir } = await import("node:os");
  return join(homedir(), ".openloomi", "skills");
}

export async function needsSkillsInitialization(): Promise<boolean> {
  const { existsSync, readdirSync } = await import("node:fs");
  const skillsDir = await getDefaultSkillsDir();
  return !existsSync(skillsDir) || readdirSync(skillsDir).length === 0;
}

export async function initializeBundledSkills(): Promise<void> {
  const { existsSync, mkdirSync } = await import("node:fs");
  const userSkillsDir = await getDefaultSkillsDir();

  // Ensure user directory exists
  if (!existsSync(userSkillsDir)) {
    mkdirSync(userSkillsDir, { recursive: true });
  }

  try {
    // Get bundled skills path
    const bundledSkillsPath = await getBundledSkillsPath();

    if (!bundledSkillsPath || !(await pathExists(bundledSkillsPath))) {
      return;
    }

    // Copy each skill
    const skillFolders = await readdir(bundledSkillsPath, {
      withFileTypes: true,
    });

    for (const folder of skillFolders) {
      if (!folder.isDirectory()) continue;

      const sourcePath = await joinPaths(bundledSkillsPath, folder.name);
      const targetPath = await joinPaths(userSkillsDir, folder.name);
      try {
        await copyDirectoryRecursive(sourcePath, targetPath);
      } catch (error) {
        console.error(`[SkillsBundler] Failed to copy skill ${folder.name}:`, error);
      }
    }
  } catch (error) {
    console.error(
      "[SkillsBundler] Failed to initialize bundled skills:",
      error,
    );
    throw error;
  }
}

export async function ensureSkillsInitialized(): Promise<void> {
  // Always try to initialize/update skills, initializeBundledSkills handles incremental updates
  await initializeBundledSkills();
}

// ============ Internal Helper Functions ============

async function getBundledSkillsPath(): Promise<string | null> {
  const { join, dirname } = await import("node:path");
  const { existsSync } = await import("node:fs");

  const isDev =
    process.env.NODE_ENV === "development" || process.env.TAURI_DEBUG === "true";

  // Tauri production: ask the Rust backend for the correct platform-specific path
  if (process.env.TAURI_MODE === "1" || process.env.IS_TAURI === "true") {
    try {
      // @ts-ignore — Tauri invoke is injected at runtime
      const { invoke } = await import("@tauri-apps/api/core");
      const rustPath: string = await invoke("get_bundled_skills_dir");
      if (rustPath && existsSync(rustPath)) {
        return rustPath;
      }
    } catch (_) {
      // invoke failed — fall through to manual path computation
    }

    // Manual fallback: only used as a last resort
    const possiblePaths: string[] = [];
    const execDir = dirname(process.execPath || process.cwd());
    const isMac = (await import("node:os")).platform() === "darwin";
    const isWindows = (await import("node:os")).platform() === "win32";

    if (isWindows) {
      // process.cwd() = apps/web/ where Next.js server runs
      // skills are at openloomi/_up_/_up_/_up_/skills
      // go up 5 from apps/web/ to reach openloomi/, then _up_/_up_/_up_/skills
      possiblePaths.push(
        join(process.cwd(), "..", "..", "..", "..", "..", "_up_", "_up_", "_up_", "skills"),
        join(process.cwd(), "..", "..", "..", "_up_", "_up_", "_up_", "skills"),
        // Production: portable exe with skills/ next to it
        join(execDir, "skills"),
        // Production: NSIS installer to Program Files
        join(execDir, "..", "install", "resources", "skills"),
        // Dev / portable with _up_ escape (e.g. dev install next to exe)
        join(execDir, "_up_", "_up_", "_up_", "skills"),
      );
    } else if (isMac) {
      possiblePaths.push(
        join(execDir, "Resources", "skills"),
        join(execDir, "Resources", "_up_", "_up_", "_up_", "skills"),
        "/Applications/openloomi.app/Contents/Resources/skills",
        "/Applications/openloomi.app/Contents/Resources/_up_/_up_/_up_/skills",
      );
    } else {
      // Linux: resource_dir/_up_/_up_/_up_/skills (e.g. /usr/lib/openloomi/_up_/_up_/_up_/skills)
      possiblePaths.push(
        join(execDir, "..", "lib", "openloomi", "_up_", "_up_", "_up_", "skills"),
        join("/usr", "lib", "openloomi", "_up_", "_up_", "_up_", "skills"),
        join(execDir, "_up_", "_up_", "_up_", "skills"),
      );
    }

    if (isDev) {
      possiblePaths.unshift(
        join(process.cwd(), "skills"),
        join(dirname(process.cwd()), "skills"),
        join(dirname(dirname(process.cwd())), "skills"),
      );
    }

    for (const path of possiblePaths) {
      if (existsSync(path)) return path;
    }
    return null;
  }

  // Non-Tauri (pure dev mode): look for skills in project directories
  let devSkillsPath = join(process.cwd(), "skills");
  if (!existsSync(devSkillsPath)) {
    devSkillsPath = join(dirname(process.cwd()), "skills");
  }
  if (!existsSync(devSkillsPath)) {
    devSkillsPath = join(dirname(dirname(process.cwd())), "skills");
  }
  if (existsSync(devSkillsPath)) return devSkillsPath;

  return null;
}

async function copyDirectoryRecursive(
  source: string,
  target: string,
): Promise<void> {
  const { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } =
    await import("node:fs");
  const { join } = await import("node:path");

  if (!existsSync(target)) {
    mkdirSync(target, { recursive: true });
  }

  const entries = readdirSync(source, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);

    // Skip node_modules directories to avoid copying large dependencies
    if (entry.isDirectory() && entry.name === "node_modules") {
      continue;
    }

    if (entry.isDirectory()) {
      await copyDirectoryRecursive(sourcePath, targetPath);
    } else {
      try {
        const content = readFileSync(sourcePath);
        writeFileSync(targetPath, content);
      } catch (error) {
        console.error(`[SkillsBundler] Failed to copy ${sourcePath}:`, error);
      }
    }
  }
}

async function joinPaths(...paths: string[]): Promise<string> {
  const { join } = await import("node:path");
  return join(...paths);
}

async function pathExists(path: string): Promise<boolean> {
  const { existsSync } = await import("node:fs");
  return existsSync(path);
}

async function readdir(path: string, options: any): Promise<any[]> {
  const { readdirSync } = await import("node:fs");
  return readdirSync(path, options);
}
