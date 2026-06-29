import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

/**
 * Chronicle meeting audio upload directory
 */
function getMeetingAudioDir(): string {
  const tmpDir = process.env.TMPDIR || "/tmp";
  return path.join(tmpDir, "chronicle", "meetings");
}

/**
 * POST /api/chronicle/meeting-audio
 * Upload and save meeting audio recording
 */
export async function POST(request: Request) {
  console.log("[Chronicle API] /api/chronicle/meeting-audio POST called");
  const session = await auth();
  if (!session?.user?.id) {
    console.log("[Chronicle API] Unauthorized");
    return new AppError("unauthorized:api").toResponse();
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const duration = formData.get("duration");
    const title = formData.get("title");

    console.log(
      "[Chronicle API] Audio received:",
      file?.name,
      file?.size,
      "bytes, duration:",
      duration,
    );

    if (!file) {
      console.log("[Chronicle API] No file provided");
      return new AppError(
        "bad_request:api",
        "No audio file provided",
      ).toResponse();
    }

    // Validate file type
    if (!file.type.startsWith("audio/")) {
      console.log("[Chronicle API] Invalid file type:", file.type);
      return new AppError(
        "bad_request:api",
        "Invalid audio file type",
      ).toResponse();
    }

    // Validate file size (max 500MB)
    const maxSize = 500 * 1024 * 1024;
    if (file.size > maxSize) {
      console.log("[Chronicle API] File too large:", file.size);
      return new AppError(
        "bad_request:api",
        "File too large (max 500MB)",
      ).toResponse();
    }

    // Create meeting audio directory if it doesn't exist
    const meetingAudioDir = getMeetingAudioDir();
    if (!existsSync(meetingAudioDir)) {
      console.log("[Chronicle API] Creating directory:", meetingAudioDir);
      await mkdir(meetingAudioDir, { recursive: true });
    }

    // Generate unique filename
    const fileId = uuidv4();
    const ext = file.name.split(".").pop() || "wav";
    const filename = `${fileId}.${ext}`;
    const filePath = path.join(meetingAudioDir, filename);
    console.log("[Chronicle API] Saving to:", filePath);

    // Save file
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await writeFile(filePath, buffer);
    console.log("[Chronicle API] Audio file saved successfully");

    // Clean up old audio files (older than 7 days)
    await cleanupOldAudioFiles(meetingAudioDir);

    return NextResponse.json({
      success: true,
      path: filePath,
      filename,
      size: file.size,
      duration: duration ? Number(duration) : null,
      title: title ? String(title) : null,
    });
  } catch (error) {
    console.error("[Chronicle API] Meeting audio upload failed:", error);
    return new AppError(
      "bad_request:api",
      "Failed to save meeting audio",
    ).toResponse();
  }
}

/**
 * Clean up audio files older than 7 days
 */
async function cleanupOldAudioFiles(dir: string): Promise<void> {
  try {
    const { readdir, stat, unlink } = await import("node:fs/promises");
    const cutoffTime = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days

    const files = await readdir(dir);

    for (const file of files) {
      try {
        const filePath = path.join(dir, file);
        const stats = await stat(filePath);

        if (stats.mtimeMs < cutoffTime) {
          await unlink(filePath);
          console.log("[Chronicle] Deleted old meeting audio:", file);
        }
      } catch (err) {
        // Ignore individual file errors
        console.warn("[Chronicle] Failed to process file:", file, err);
      }
    }
  } catch (error) {
    console.warn("[Chronicle] Failed to cleanup old meeting audio:", error);
  }
}
