/**
 * Skills Toggle API Route
 *
 * Enable or disable a skill
 */

import { type NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Get openloomi skills directory path
function getopenloomiSkillsDir(): string {
  const homeDir = homedir();
  return join(homeDir, ".openloomi", "skills");
}

// Parse and update SKILL.md
function updateSkillEnabledStatus(
  skillPath: string,
  enabled: boolean,
): { success: boolean; error?: string } {
  try {
    const skillMdPath = join(skillPath, "SKILL.md");
    if (!existsSync(skillMdPath)) {
      return { success: false, error: "SKILL.md not found" };
    }

    const content = readFileSync(skillMdPath, "utf-8");

    // Check if frontmatter exists
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);

    if (!frontmatterMatch) {
      // No frontmatter, add it with enabled status
      const newContent = `---
enabled: ${enabled}
---
${content}`;
      writeFileSync(skillMdPath, newContent, "utf-8");
    } else {
      // Frontmatter exists, update or add enabled field
      const frontmatter = frontmatterMatch[1];
      const restContent = content.slice(frontmatterMatch[0].length);

      // Check if enabled already exists
      const enabledMatch = frontmatter.match(/^enabled:\s*(true|false)/m);

      let newFrontmatter: string;
      if (enabledMatch) {
        // Replace existing enabled value
        newFrontmatter = frontmatter.replace(
          /^enabled:\s*(true|false)/m,
          `enabled: ${enabled}`,
        );
      } else {
        // Add enabled field
        newFrontmatter = `enabled: ${enabled}\n${frontmatter}`;
      }

      writeFileSync(
        skillMdPath,
        `---\n${newFrontmatter}\n---${restContent}`,
        "utf-8",
      );
    }

    return { success: true };
  } catch (error) {
    console.error("[SkillsToggle] Failed to update skill status:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Update failed",
    };
  }
}

// POST /api/workspace/skills/toggle - Enable/disable a skill
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { skillId, enabled } = body;

    if (!skillId || typeof enabled !== "boolean") {
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 },
      );
    }

    const skillsDir = getopenloomiSkillsDir();
    const skillPath = join(skillsDir, skillId);

    if (!existsSync(skillPath)) {
      return NextResponse.json(
        { success: false, error: "Skill not found" },
        { status: 404 },
      );
    }

    const result = updateSkillEnabledStatus(skillPath, enabled);

    if (!result.success) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Skill ${enabled ? "enabled" : "disabled"}`,
    });
  } catch (error) {
    console.error("[SkillsToggle] Toggle error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Toggle failed",
      },
      { status: 500 },
    );
  }
}
