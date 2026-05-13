import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

/**
 * Upload a single chunk
 *
 * Chunks are saved to temporary directory, to be merged after all chunks are uploaded
 */
const UPLOAD_TEMP_DIR = path.join(tmpdir(), "openloomi-uploads");

// Ensure temporary directory exists
async function ensureUploadDir() {
  if (!existsSync(UPLOAD_TEMP_DIR)) {
    await mkdir(UPLOAD_TEMP_DIR, { recursive: true });
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const uploadId = formData.get("uploadId") as string;
    const fileName = formData.get("fileName") as string;
    const chunkIndex = formData.get("chunkIndex") as string;
    const totalChunks = formData.get("totalChunks") as string;
    const chunk = formData.get("chunk") as File | null;

    if (!uploadId || !fileName || chunkIndex === null || !chunk) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    await ensureUploadDir();

    // Create independent directory for each upload
    const uploadDir = path.join(UPLOAD_TEMP_DIR, uploadId);
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    // Save chunk file
    const chunkFileName = `chunk_${String(chunkIndex).padStart(6, "0")}`;
    const chunkPath = path.join(uploadDir, chunkFileName);
    const buffer = Buffer.from(await chunk.arrayBuffer());

    await writeFile(chunkPath, buffer);

    console.log(
      `[Upload Chunk] Saved chunk ${chunkIndex}/${totalChunks} for ${uploadId} (${buffer.length} bytes)`,
    );

    return NextResponse.json({
      success: true,
      chunkIndex: Number.parseInt(chunkIndex, 10),
      size: buffer.length,
    });
  } catch (error) {
    console.error("[Upload Chunk] Error:", error);
    return NextResponse.json(
      { error: "Failed to upload chunk" },
      { status: 500 },
    );
  }
}
