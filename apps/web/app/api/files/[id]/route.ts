import { deleteFile } from "@/lib/storage";
import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import { deleteUserFile, getUserStorageUsage } from "@/lib/db/storageService";
import { AppError } from "@openloomi/shared/errors";
import { deleteGoogleDriveFile } from "@/lib/files/google-drive";

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: fileId } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!fileId) {
    return NextResponse.json({ error: "Missing file id." }, { status: 400 });
  }

  try {
    const file = await deleteUserFile({
      userId: session.user.id,
      fileId,
    });

    if (file.storageProvider === "google_drive") {
      const driveId = file.providerFileId ?? file.blobPathname;
      if (driveId) {
        await deleteGoogleDriveFile({
          userId: session.user.id,
          fileId: driveId,
        }).catch((error) => {
          console.error("[storage] Failed to delete Google Drive file", error);
        });
      }
    } else if (file.storageProvider === "notion") {
      // Notion pages are left in place unless the user removes them manually.
    } else {
      // Use storage adapter (automatically switches between Vercel Blob or local file system)
      await deleteFile(file.blobUrl, file.blobPathname).catch((error) => {
        console.error("[storage] Failed to delete file", error);
      });
    }

    const usage = await getUserStorageUsage(session.user.id, session.user.type);

    return NextResponse.json({
      success: true,
      usage,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return error.toResponse();
    }

    console.error("[storage] Failed to delete file metadata", error);
    return NextResponse.json(
      { error: "Failed to delete file. Please try again later." },
      { status: 500 },
    );
  }
}
