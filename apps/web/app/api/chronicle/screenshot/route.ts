import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

/**
 * Chronicle screenshot upload directory
 */
function getChronicleDir(): string {
  const tmpDir = process.env.TMPDIR || "/tmp";
  return path.join(tmpDir, "chronicle", "screenshots");
}

/**
 * POST /api/chronicle/screenshot
 * Upload and save a screenshot from screen capture
 */
export async function POST(request: Request) {
  console.log("[Chronicle API] /api/chronicle/screenshot POST called");
  const session = await auth();
  if (!session?.user?.id) {
    console.log("[Chronicle API] Unauthorized");
    return new AppError("unauthorized:api").toResponse();
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    console.log(
      "[Chronicle API] File received:",
      file?.name,
      file?.size,
      "bytes",
    );

    if (!file) {
      console.log("[Chronicle API] No file provided");
      return new AppError(
        "bad_request:api",
        "No screenshot file provided",
      ).toResponse();
    }

    // Validate file type
    if (!file.type.startsWith("image/")) {
      console.log("[Chronicle API] Invalid file type:", file.type);
      return new AppError("bad_request:api", "Invalid file type").toResponse();
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      console.log("[Chronicle API] File too large:", file.size);
      return new AppError(
        "bad_request:api",
        "File too large (max 10MB)",
      ).toResponse();
    }

    // Create chronicle directory if it doesn't exist
    const chronicleDir = getChronicleDir();
    if (!existsSync(chronicleDir)) {
      console.log("[Chronicle API] Creating directory:", chronicleDir);
      await mkdir(chronicleDir, { recursive: true });
    }

    // Generate unique filename
    const fileId = uuidv4();
    const ext = file.name.split(".").pop() || "png";
    const filename = `${fileId}.${ext}`;
    const filePath = path.join(chronicleDir, filename);
    console.log("[Chronicle API] Saving to:", filePath);

    // Save file
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await writeFile(filePath, buffer);
    console.log("[Chronicle API] File saved successfully");

    // Clean up old screenshots (older than 6 hours)
    await cleanupOldScreenshots(chronicleDir);

    return NextResponse.json({
      success: true,
      path: filePath,
      filename,
      size: file.size,
    });
  } catch (error) {
    console.error("[Chronicle API] Screenshot upload failed:", error);
    return new AppError(
      "bad_request:api",
      "Failed to save screenshot",
    ).toResponse();
  }
}

/**
 * Clean up screenshots older than 6 hours
 */
async function cleanupOldScreenshots(dir: string): Promise<void> {
  try {
    const { readdir, stat, unlink } = await import("node:fs/promises");
    const cutoffTime = Date.now() - 6 * 60 * 60 * 1000; // 6 hours

    const files = await readdir(dir);

    for (const file of files) {
      try {
        const filePath = path.join(dir, file);
        const stats = await stat(filePath);

        if (stats.mtimeMs < cutoffTime) {
          await unlink(filePath);
          console.log("[Chronicle] Deleted old screenshot:", file);
        }
      } catch (err) {
        // Ignore individual file errors
        console.warn("[Chronicle] Failed to process file:", file, err);
      }
    }
  } catch (error) {
    console.warn("[Chronicle] Failed to cleanup old screenshots:", error);
  }
}
