/**
 * DELETE /api/workspace/skills/[skillId]
 * Only allows deleting skill directories under ~/.openloomi/skills, and cleans up corresponding entries in skill-metadata.json
 */

import { type NextRequest, NextResponse } from "next/server";
import { existsSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import { homedir } from "node:os";

function getopenloomiSkillsDir(): string {
  return join(homedir(), ".openloomi", "skills");
}

function getSkillMetadataPath(): string {
  return join(homedir(), ".openloomi", "skill-metadata.json");
}

/** Ensure path is under base (normalized prefix matches), prevent directory traversal */
function isPathUnderBase(childPath: string, basePath: string): boolean {
  const normalized = normalize(childPath);
  const base = normalize(basePath);
  return normalized !== base && normalized.startsWith(base + sep);
}

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

function writeSkillMetadata(data: Record<string, { avatar?: string }>): void {
  const dir = join(homedir(), ".openloomi");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getSkillMetadataPath(), JSON.stringify(data, null, 2), "utf-8");
}

/**
 * DELETE /api/workspace/skills/[skillId]
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ skillId: string }> },
) {
  try {
    const { skillId } = await context.params;
    if (!skillId || skillId.includes("..") || /[\/\\]/.test(skillId)) {
      return NextResponse.json(
        { success: false, error: "Invalid skillId" },
        { status: 400 },
      );
    }

    const openloomiSkillsDir = getopenloomiSkillsDir();
    const skillPath = join(openloomiSkillsDir, skillId);

    if (!isPathUnderBase(skillPath, openloomiSkillsDir)) {
      return NextResponse.json(
        { success: false, error: "Skill can only be deleted from ~/.openloomi/skills" },
        { status: 403 },
      );
    }

    if (!existsSync(skillPath)) {
      return NextResponse.json(
        { success: false, error: "Skill not found" },
        { status: 404 },
      );
    }

    rmSync(skillPath, { recursive: true });

    const metadata = readSkillMetadata();
    if (metadata[skillId]) {
      delete metadata[skillId];
      writeSkillMetadata(metadata);
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[SkillsDelete] Error:", e);
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : "Delete failed",
      },
      { status: 500 },
    );
  }
}
