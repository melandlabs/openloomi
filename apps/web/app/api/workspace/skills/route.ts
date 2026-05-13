import { NextResponse } from "next/server";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Skill metadata file path (only under ~/.openloomi) */
function getSkillMetadataPath(): string {
  const homeDir = homedir();
  return join(homeDir, ".openloomi", "skill-metadata.json");
}

/** Read skill metadata: Record<skillId, { avatar?: string }> */
function readSkillMetadata(): Record<string, { avatar?: string }> {
  const path = getSkillMetadataPath();
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return {};
    return data as Record<string, { avatar?: string }>;
  } catch {
    return {};
  }
}

// Get all skills source directories (in priority order)
function getAllSkillsDirs(): string[] {
  const homeDir = homedir();
  // Priority: openloomi > claude > agents (first wins in dedup)
  return [
    join(homeDir, ".openloomi", "skills"),
    join(homeDir, ".claude", "skills"),
    join(homeDir, ".agents", "skills"),
  ];
}

// Load skills from a directory
function loadSkillsFromDir(skillsDir: string): any[] {
  // Check if skills directory exists
  if (!existsSync(skillsDir)) {
    return [];
  }

  // Read all subdirectories in skills directory
  const entries = readdirSync(skillsDir, { withFileTypes: true });
  const skills: any[] = [];

  for (const entry of entries) {
    // Check if it's a directory or a symlink to a directory
    let isDirectory = entry.isDirectory();
    const skillPath = join(skillsDir, entry.name);

    // If it's a symlink, check what it points to
    if (entry.isSymbolicLink()) {
      try {
        const stats = statSync(skillPath);
        isDirectory = stats.isDirectory();
      } catch {
        // Broken symlink — skip it
        continue;
      }
    }

    if (!isDirectory) continue;

    const skillMdPath = join(skillPath, "SKILL.md");

    // Default values
    let skillName = entry.name;
    let description = "";
    let version = "";
    let author = "";
    let argumentHint = "";

    // Try to read SKILL.md
    let enabled = true; // Default to enabled
    if (existsSync(skillMdPath)) {
      try {
        const content = readFileSync(skillMdPath, "utf-8");
        const frontmatter = parseSkillMdFrontmatter(content);

        if (frontmatter.name) skillName = frontmatter.name;
        if (frontmatter.description) description = frontmatter.description;
        if (frontmatter.version) version = frontmatter.version;
        if (frontmatter.author) author = frontmatter.author;
        if (frontmatter.argumentHint) argumentHint = frontmatter.argumentHint;
        if (frontmatter.enabled !== undefined) enabled = frontmatter.enabled;
      } catch (error) {
        console.error(
          `[API] Failed to read SKILL.md for ${entry.name}:`,
          error,
        );
      }
    }

    skills.push({
      id: entry.name,
      name: skillName,
      description,
      version,
      author,
      argumentHint,
      enabled,
      path: skillPath,
      source: skillsDir, // Track which directory this came from
    });
  }

  return skills;
}

// Parse YAML frontmatter from SKILL.md
function parseSkillMdFrontmatter(content: string): {
  name?: string;
  description?: string;
  version?: string;
  author?: string;
  argumentHint?: string;
  enabled?: boolean;
} {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return {};

  const frontmatter = frontmatterMatch[1];
  const result: {
    name?: string;
    description?: string;
    version?: string;
    author?: string;
    argumentHint?: string;
    enabled?: boolean;
  } = {};

  // Parse name
  const nameMatch = frontmatter.match(/^name:\s*["']?(.+?)["']?$/m);
  if (nameMatch) {
    result.name = nameMatch[1].trim();
  }

  // Parse description
  const descMatch = frontmatter.match(/^description:\s*["']?(.+?)["']?$/m);
  if (descMatch) {
    result.description = descMatch[1].trim();
  }

  // Parse version
  const versionMatch = frontmatter.match(/^version:\s*["']?(.+?)["']?$/m);
  if (versionMatch) {
    result.version = versionMatch[1].trim();
  }

  // Parse author
  const authorMatch = frontmatter.match(/^author:\s*["']?(.+?)["']?$/m);
  if (authorMatch) {
    result.author = authorMatch[1].trim();
  }

  // Parse argumentHint or argument-hint
  const argHintMatch =
    frontmatter.match(/^argumentHint:\s*["']?(.+?)["']?$/m) ||
    frontmatter.match(/^argument-hint:\s*["']?(.+?)["']?$/m);
  if (argHintMatch) {
    result.argumentHint = argHintMatch[1].trim();
  }

  // Parse enabled (defaults to true if not specified)
  const enabledMatch = frontmatter.match(/^enabled:\s*(true|false)/m);
  if (enabledMatch) {
    result.enabled = enabledMatch[1] === "true";
  } else {
    result.enabled = true; // Default to enabled
  }

  return result;
}

export async function GET() {
  try {
    const sourceDirs = getAllSkillsDirs();

    // Collect all skills from all source directories (deduplicated by name, first wins)
    const allSkills: any[] = [];
    const seenSkillIds = new Set<string>();

    for (const dir of sourceDirs) {
      const skills = loadSkillsFromDir(dir);
      for (const skill of skills) {
        if (!seenSkillIds.has(skill.id)) {
          seenSkillIds.add(skill.id);
          allSkills.push(skill);
        }
      }
    }

    const metadata = readSkillMetadata();
    const skillsWithAvatar = allSkills.map((s) => ({
      ...s,
      avatar: metadata[s.id]?.avatar,
    }));

    return NextResponse.json({
      success: true,
      skills: skillsWithAvatar,
      directories: {
        openloomi: sourceDirs[0],
        claude: sourceDirs[1],
        agents: sourceDirs[2],
      },
    });
  } catch (error) {
    console.error("[API] Failed to load skills:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        skills: [],
      },
      { status: 500 },
    );
  }
}
