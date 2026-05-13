/**
 * Skills Loader
 *
 * Load skill definitions from ~/.openloomi/skills/ directory
 * and sync skills to ~/.claude/skills/ for Claude SDK usage
 */

import {
  readdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  lstatSync,
  unlinkSync,
  symlinkSync,
  mkdirSync,
  readlinkSync,
  rmSync,
} from "node:fs";
import { join, normalize } from "node:path";
import { homedir, platform } from "node:os";

export interface SkillMetadata {
  name: string;
  description: string;
  version?: string;
  author?: string;
  license?: string;
  argumentHint?: string;
  path: string;
}

/**
 * Get default skills directory path
 */
export function getDefaultSkillsDir(): string {
  return join(homedir(), ".openloomi", "skills");
}

/**
 * Get Claude SDK skills directory path (~/.claude/skills/)
 */
export function getClaudeSkillsDir(): string {
  return join(homedir(), ".claude", "skills");
}

/**
 * Get all skills source directories to sync from
 */
export function getAllSkillsDirs(): string[] {
  return [
    join(homedir(), ".openloomi", "skills"),
    join(homedir(), ".claude", "skills"),
    join(homedir(), ".agents", "skills"),
  ];
}

// Priority: openloomi > claude > agents (first wins in dedup)

/**
 * Determine if a directory entry is a valid skill (must be non-hidden and contain SKILL.md).
 */
function isValidSkillDir(sourceDir: string, entryName: string): boolean {
  if (entryName.startsWith(".")) return false;
  const skillDir = join(sourceDir, entryName);
  return existsSync(join(skillDir, "SKILL.md"));
}

/**
 * Sync skills from multiple sources to .claude/skills/ in project working directory.
 * Sources: ~/.openloomi/skills/, ~/.claude/skills/, ~/.agents/skills/
 * When using project source, SDK loads skills from .claude/skills/ in project directory
 *
 * On Windows: copy skills directory to avoid symlink/junction issues
 * On Unix: use symlinks to save space and keep skills updated
 */
export function syncSkillsToClaude(projectDir?: string): void {
  const start = Date.now();
  const sourceDirs = getAllSkillsDirs();
  const isWindows = platform() === "win32";

  // Collect all skills from all source directories (deduplicated by name)
  const skillsByName = new Map<string, string>();
  for (const sourceDir of sourceDirs) {
    if (!existsSync(sourceDir)) continue;
    try {
      const entries = readdirSync(sourceDir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.isDirectory() &&
          isValidSkillDir(sourceDir, entry.name) &&
          !skillsByName.has(entry.name)
        ) {
          skillsByName.set(entry.name, join(sourceDir, entry.name));
        }
      }
    } catch {
      // ignore individual source dir errors
    }
  }

  if (skillsByName.size === 0) return;

  // If projectDir starts with ~, expand to home directory
  const expandedProjectDir = projectDir?.startsWith("~")
    ? join(homedir(), projectDir.slice(1))
    : projectDir;

  const targetDir = expandedProjectDir
    ? join(expandedProjectDir, ".claude", "skills")
    : getClaudeSkillsDir();

  // Ensure target directory exists
  if (!existsSync(targetDir)) {
    try {
      mkdirSync(targetDir, { recursive: true });
    } catch {
      return;
    }
  }

  /**
   * Clean up legacy .git symlinks to prevent Tauri from scanning them and triggering permission errors.
   */
  const legacyGitPath = join(targetDir, ".git");
  if (existsSync(legacyGitPath)) {
    try {
      rmSync(legacyGitPath, { recursive: true, force: true });
    } catch {
      // ignore legacy cleanup errors
    }
  }

  try {
    let syncedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const [skillName, sourceSkillPath] of skillsByName) {
      const targetSkillPath = join(targetDir, skillName);

      if (existsSync(targetSkillPath)) {
        try {
          const targetStats = lstatSync(targetSkillPath);
          if (targetStats.isSymbolicLink()) {
            const existingTarget = readlinkSync(targetSkillPath);
            if (normalize(existingTarget) === normalize(sourceSkillPath)) {
              skippedCount++;
              continue;
            }
            unlinkSync(targetSkillPath);
          } else if (targetStats.isDirectory()) {
            try {
              if (isWindows) {
                rmSync(targetSkillPath, { recursive: true, force: true });
              } else {
                unlinkSync(targetSkillPath);
              }
            } catch {
              skippedCount++;
              continue;
            }
          }
        } catch {
          try {
            unlinkSync(targetSkillPath);
          } catch {
            skippedCount++;
            continue;
          }
        }
      }

      try {
        if (isWindows) {
          copyDirectoryRecursive(sourceSkillPath, targetSkillPath);
        } else {
          symlinkSync(sourceSkillPath, targetSkillPath);
        }
        syncedCount++;
      } catch {
        failedCount++;
      }
    }
  } catch {
    // ignore
  }
  console.log(`[SkillsLoader] syncSkillsToClaude done in ${Date.now() - start}ms: ${skillsByName.size} skills processed`);
}

/**
 * Recursively copy a directory (used on Windows where symlinks may not be recognized)
 */
function copyDirectoryRecursive(source: string, target: string): void {
  if (!existsSync(target)) {
    mkdirSync(target, { recursive: true });
  }

  const entries = readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, targetPath);
    } else {
      try {
        writeFileSync(targetPath, readFileSync(sourcePath));
      } catch {
        // ignore individual file copy errors
      }
    }
  }
}

/**
 * Clear skills from .claude/skills/ in the project directory.
 * Only needed on Windows where skills are copied (not symlinked).
 */
export function clearSkillsFromClaude(projectDir?: string): void {
  if (platform() !== "win32") return;

  const expandedProjectDir = projectDir?.startsWith("~")
    ? join(homedir(), projectDir.slice(1))
    : projectDir;

  const targetDir = expandedProjectDir
    ? join(expandedProjectDir, ".claude", "skills")
    : getClaudeSkillsDir();

  if (existsSync(targetDir)) {
    try {
      rmSync(targetDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * Parse frontmatter from SKILL.md file
 */
function parseSkillMetadata(content: string, skillPath: string): SkillMetadata {
  const frontmatterRegex = /^---\n([\s\S]+?)\n---/;
  const match = content.match(frontmatterRegex);

  const metadata: SkillMetadata = {
    name: "Unknown",
    description: "No description",
    path: skillPath,
  };

  if (match) {
    const frontmatter = match[1];
    const nameMatch = frontmatter.match(/name:\s*["'](.+?)["']/);
    const descMatch = frontmatter.match(/description:\s*["'](.+?)["']/);
    const versionMatch = frontmatter.match(/version:\s*["'](.+?)["']/);
    const authorMatch = frontmatter.match(/author:\s*["'](.+?)["']/);
    const licenseMatch = frontmatter.match(/license:\s*["'](.+?)["']/);
    const argHintMatch = frontmatter.match(/argument_hint:\s*["'](.+?)["']/);

    if (nameMatch) metadata.name = nameMatch[1];
    if (descMatch) metadata.description = descMatch[1];
    if (versionMatch) metadata.version = versionMatch[1];
    if (authorMatch) metadata.author = authorMatch[1];
    if (licenseMatch) metadata.license = licenseMatch[1];
    if (argHintMatch) metadata.argumentHint = argHintMatch[1];
  }

  return metadata;
}

/**
 * Load all available skills from all source directories.
 * Deduplicates by name, prioritizing in order: .openloomi > .agent > .claude
 */
export function loadSkills(): SkillMetadata[] {
  const skills: SkillMetadata[] = [];
  const skillsByName = new Map<string, SkillMetadata>();

  for (const dir of getAllSkillsDirs()) {
    if (!existsSync(dir)) continue;

    try {
      const skillFolders = readdirSync(dir, { withFileTypes: true });

      for (const folder of skillFolders) {
        if (!folder.isDirectory() || skillsByName.has(folder.name)) continue;

        const skillPath = join(dir, folder.name);
        const skillMdPath = join(skillPath, "SKILL.md");

        if (existsSync(skillMdPath)) {
          try {
            const content = readFileSync(skillMdPath, "utf-8");
            const metadata = parseSkillMetadata(content, skillPath);
            skillsByName.set(folder.name, metadata);
          } catch (error) {
            console.error(
              `[SkillsLoader] Failed to read skill ${folder.name}:`,
              error,
            );
          }
        }
      }
    } catch (error) {
      console.error(`[SkillsLoader] Failed to load skills from ${dir}:`, error);
    }
  }

  for (const skill of skillsByName.values()) {
    skills.push(skill);
  }

  console.log(`[SkillsLoader] Loaded ${skills.length} skills from all source directories`);
  return skills;
}

/**
 * Get SKILL.md content for a skill
 */
export function getSkillContent(skillPath: string): string | null {
  const skillMdPath = join(skillPath, "SKILL.md");

  if (!existsSync(skillMdPath)) {
    return null;
  }

  try {
    return readFileSync(skillMdPath, "utf-8");
  } catch (error) {
    console.error("[SkillsLoader] Failed to read skill content:", error);
    return null;
  }
}
