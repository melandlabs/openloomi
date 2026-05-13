/**
 * Skills Metadata API Route
 * PATCH: Update single skill metadata (e.g. avatar)
 * Read/write ~/.openloomi/skill-metadata.json, only allows .openloomi path under homedir
 */

import { type NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function getopenloomiDir(): string {
  return join(homedir(), ".openloomi");
}

function getSkillMetadataPath(): string {
  return join(getopenloomiDir(), "skill-metadata.json");
}

/** Ensure metadata file directory exists and write JSON */
function writeSkillMetadata(
  data: Record<string, { avatar?: string }>,
): { success: boolean; error?: string } {
  try {
    const dir = getopenloomiDir();
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const path = getSkillMetadataPath();
    writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
    return { success: true };
  } catch (e) {
    console.error("[SkillsMetadata] Write error:", e);
    return {
      success: false,
      error: e instanceof Error ? e.message : "Write failed",
    };
  }
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

/**
 * PATCH /api/workspace/skills/metadata
 * Body: { skillId: string, avatar?: string }
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { skillId, avatar } = body;

    if (typeof skillId !== "string" || !skillId.trim()) {
      return NextResponse.json(
        { success: false, error: "Invalid skillId" },
        { status: 400 },
      );
    }

    const metadata = readSkillMetadata();
    if (avatar === undefined || avatar === null || avatar === "") {
      if (metadata[skillId]) {
        metadata[skillId].avatar = undefined;
        const entry = metadata[skillId];
        if ((Object.keys(entry) as (keyof typeof entry)[]).every((k) => entry[k] === undefined)) {
          delete metadata[skillId];
        }
      }
    } else {
      metadata[skillId] = { ...metadata[skillId], avatar: String(avatar) };
    }

    const result = writeSkillMetadata(metadata);
    if (!result.success) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      avatar: metadata[skillId]?.avatar,
    });
  } catch (e) {
    console.error("[SkillsMetadata] PATCH error:", e);
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : "Update failed",
      },
      { status: 500 },
    );
  }
}
