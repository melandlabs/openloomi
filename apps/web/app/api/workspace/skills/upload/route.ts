/**
 * Skills Upload API Route
 *
 * Handle skill upload from .zip files or folders
 */

import { type NextRequest, NextResponse } from "next/server";
import { existsSync, mkdirSync, writeFileSync, copyFileSync, readdirSync, } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import AdmZip from "adm-zip";

// Get openloomi skills directory path
function getopenloomiSkillsDir(): string {
  const homeDir = homedir();
  const skillsDir = join(homeDir, ".openloomi", "skills");
  if (!existsSync(skillsDir)) {
    mkdirSync(skillsDir, { recursive: true });
  }
  return skillsDir;
}

// Parse SKILL.md frontmatter
function parseSkillMetadata(content: string): {
  name?: string;
  description?: string;
  version?: string;
  author?: string;
} {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return {};

  const frontmatter = frontmatterMatch[1];
  const result: {
    name?: string;
    description?: string;
    version?: string;
    author?: string;
  } = {};

  const nameMatch = frontmatter.match(/^name:\s*["']?(.+?)["']?$/m);
  if (nameMatch) result.name = nameMatch[1].trim();

  const descMatch = frontmatter.match(/^description:\s*["']?(.+?)["']?$/m);
  if (descMatch) result.description = descMatch[1].trim();

  const versionMatch = frontmatter.match(/^version:\s*["']?(.+?)["']?$/m);
  if (versionMatch) result.version = versionMatch[1].trim();

  const authorMatch = frontmatter.match(/^author:\s*["']?(.+?)["']?$/m);
  if (authorMatch) result.author = authorMatch[1].trim();

  return result;
}

// Extract zip file to skills directory
function extractZipToSkillsDir(
  zipBuffer: Buffer,
  skillsDir: string,
): {
  success: boolean;
  skillName?: string;
  error?: string;
} {
  try {
    const zip = new AdmZip(zipBuffer);
    const zipEntries = zip.getEntries();

    // Find SKILL.md to determine skill name
    let skillName: string | undefined;
    let skillMdPath: string | undefined;

    for (const entry of zipEntries) {
      const entryName = entry.entryName;

      // Check for SKILL.md at root or in a subdirectory
      if (entryName.endsWith("/SKILL.md") || entryName === "SKILL.md") {
        skillMdPath = entryName;
        const content = zip.readAsText(entryName);
        const metadata = parseSkillMetadata(content);
        skillName = metadata.name;

        // If no name in metadata, use the folder name from the path
        if (!skillName) {
          const parts = entryName.split("/");
          skillName = parts.length > 1 ? parts[parts.length - 2] : parts[0].replace(".md", "");
        }
      }
    }

    // If no SKILL.md found, try to find a folder with SKILL.md
    if (!skillName && zipEntries.length > 0) {
      // Use the first folder name as skill name
      const firstEntry = zipEntries[0].entryName;
      const parts = firstEntry.split("/");
      skillName = parts[0];
    }

    if (!skillName) {
      return {
        success: false,
        error: "No SKILL.md file found in the uploaded archive",
      };
    }

    // Extract all files to the skill directory
    const skillPath = join(skillsDir, skillName);

    if (existsSync(skillPath)) {
      return {
        success: false,
        error: `Skill "${skillName}" already exists`,
      };
    }

    // Extract zip to a temp location first
    const tempPath = join(skillsDir, `.temp-${Date.now()}`);
    mkdirSync(tempPath, { recursive: true });

    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;

      const entryName = entry.entryName;
      const destPath = join(tempPath, entryName);

      // Ensure parent directory exists
      const parentDir = destPath.substring(0, destPath.lastIndexOf("/"));
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }

      const data = zip.readFile(entry);
      if (data === null) {
        console.warn(`Cannot read the zip file: ${entryName}`);
        continue;
      }
      writeFileSync(destPath, data);
    }

    // Move the extracted content to the final skill directory
    // Handle case where zip might have a root folder
    const fs = require("node:fs");
    const extractedEntries = fs.readdirSync(tempPath);
    if (extractedEntries.length === 1) {
      const singleEntry = extractedEntries[0];
      const singleEntryPath = join(tempPath, singleEntry);
      const stat = fs.statSync(singleEntryPath);
      if (stat.isDirectory()) {
        // Move the single directory content
        fs.renameSync(singleEntryPath, skillPath);
        fs.rmSync(tempPath, { recursive: true, force: true });
      } else {
        // It's a file, move the temp dir
        fs.renameSync(tempPath, skillPath);
      }
    } else {
      fs.renameSync(tempPath, skillPath);
    }

    return { success: true, skillName };
  } catch (error) {
    console.error("[SkillsUpload] Failed to extract zip:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to extract archive",
    };
  }
}

// Copy a folder to the skills directory
function copyFolderToSkillsDir(
  sourcePath: string,
  skillsDir: string,
): {
  success: boolean;
  skillName?: string;
  error?: string;
} {
  try {
    if (!existsSync(sourcePath)) {
      return {
        success: false,
        error: `Source path does not exist: ${sourcePath}`,
      };
    }

    const skillName = basename(sourcePath);
    const destPath = join(skillsDir, skillName);

    if (existsSync(destPath)) {
      return {
        success: false,
        error: `Skill "${skillName}" already exists`,
      };
    }

    // Ensure skills directory exists
    if (!existsSync(skillsDir)) {
      mkdirSync(skillsDir, { recursive: true });
    }

    // Check if source contains SKILL.md
    const skillMdPath = join(sourcePath, "SKILL.md");
    if (!existsSync(skillMdPath)) {
      return {
        success: false,
        error: "Selected folder must contain a SKILL.md file",
      };
    }

    // Copy folder recursively
    copyDirRecursive(sourcePath, destPath);

    return { success: true, skillName };
  } catch (error) {
    console.error("[SkillsUpload] Failed to copy folder:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to copy folder",
    };
  }
}

// Recursively copy directory
function copyDirRecursive(src: string, dest: string) {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  const entries = readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

// POST /api/workspace/skills/upload - Upload a skill or add from path
export async function POST(request: NextRequest) {
  try {
    // Check for JSON body with path (from Tauri dialog)
    const contentType = request.headers.get("content-type") || "";
    let path: string | undefined;
    let formData: FormData | undefined;
    let files: File[] = [];

    if (contentType.includes("application/json")) {
      const body = await request.json();
      path = body.path;
    } else if (contentType.includes("multipart/form-data")) {
      formData = await request.formData();
      files = formData.getAll("files") as File[];
    }

    const skillsDir = getopenloomiSkillsDir();
    const results: Array<{ name: string; success: boolean; error?: string }> = [];

    // Handle path-based import (from Tauri dialog)
    if (path) {
      const result = copyFolderToSkillsDir(path, skillsDir);
      return NextResponse.json({
        success: result.success,
        message: result.success
          ? `Successfully added skill "${result.skillName}"`
          : undefined,
        error: result.error,
        skillName: result.skillName,
      });
    }

    // Handle file upload
    if (!files || files.length === 0) {
      return NextResponse.json(
        { success: false, error: "No files or path provided" },
        { status: 400 },
      );
    }

    for (const file of files) {
      if (file.name.endsWith(".zip")) {
        // Handle zip upload
        const buffer = Buffer.from(await file.arrayBuffer());
        const result = extractZipToSkillsDir(buffer, skillsDir);
        results.push({
          name: file.name,
          success: result.success,
          error: result.error,
        });

        if (!result.success) {
          console.error(
            `[SkillsUpload] Failed to upload ${file.name}:`,
            result.error,
          );
        }
      } else {
        // Handle folder upload (each file is a file from the folder)
        // Extract skill name from file path
        const relativePath = (file as any).webkitRelativePath || file.name;
        const pathParts = relativePath.split("/");
        const skillName = pathParts[0];

        if (!skillName) {
          results.push({
            name: file.name,
            success: false,
            error: "Could not determine skill name from file path",
          });
          continue;
        }

        const skillPath = join(skillsDir, skillName);
        if (!existsSync(skillPath)) {
          mkdirSync(skillPath, { recursive: true });
        }

        const destPath = join(skillPath, ...pathParts.slice(1));
        const buffer = Buffer.from(await file.arrayBuffer());
        writeFileSync(destPath, buffer);

        results.push({ name: skillName, success: true });
      }
    }

    const successCount = results.filter((r) => r.success).length;

    return NextResponse.json({
      success: true,
      message: `Successfully uploaded ${successCount}/${results.length} skills`,
      results,
    });
  } catch (error) {
    console.error("[SkillsUpload] Upload error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Upload failed",
      },
      { status: 500 },
    );
  }
}
