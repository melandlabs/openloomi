import { uploadFile, deleteFile } from "@/lib/storage";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import {
  FILE_OPERATION_CREDIT_COST,
  MAX_UPLOAD_BYTES,
  SUPPORTED_ATTACHMENT_MIME_TYPES,
  type SupportedAttachmentMediaType,
} from "@/lib/files/config";
import { createUserFile, getUserStorageUsage } from "@/lib/db/storageService";
import {
  ensureExtension,
  getExtensionFromContentType,
  sanitizeFilename,
} from "@/lib/files/utils";
import { AppError } from "@openloomi/shared/errors";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as Blob;
  const createRecordField = formData.get("createRecord");
  const shouldCreateRecord =
    createRecordField === "true" ||
    createRecordField === "1" ||
    createRecordField === "on";

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  const { id: userId, type: userType } = session.user;
  const originalName =
    (file instanceof File && typeof file.name === "string"
      ? file.name
      : "upload") || "upload";
  const contentType = file.type || "application/octet-stream";

  const isSupportedMediaType = SUPPORTED_ATTACHMENT_MIME_TYPES.includes(
    contentType as SupportedAttachmentMediaType,
  );

  if (!isSupportedMediaType) {
    return NextResponse.json(
      {
        error: "Unsupported file type.",
      },
      { status: 415 },
    );
  }

  if (file.size <= 0) {
    return NextResponse.json(
      {
        error: "File is empty.",
      },
      { status: 400 },
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: `File exceeds the maximum size of ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB.`,
      },
      { status: 400 },
    );
  }

  let storageUsage: Awaited<ReturnType<typeof getUserStorageUsage>> | null =
    null;

  if (shouldCreateRecord) {
    storageUsage = await getUserStorageUsage(userId, userType);
    if (storageUsage.quotaBytes <= 0) {
      return NextResponse.json(
        {
          error:
            "Saving files is not available on your current plan. Upgrade to unlock file storage.",
        },
        { status: 403 },
      );
    }

    if (storageUsage.usedBytes + file.size > storageUsage.quotaBytes) {
      return NextResponse.json(
        {
          error:
            "Uploading this file would exceed your storage limit. Delete files or upgrade your plan to continue.",
        },
        { status: 413 },
      );
    }
  }

  const extension = getExtensionFromContentType(contentType);
  const sanitizedName = ensureExtension(
    sanitizeFilename(originalName),
    extension,
  );
  const pathname = `${userId}/${Date.now()}-${randomUUID()}-${sanitizedName}`;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const normalizedContentType = contentType as SupportedAttachmentMediaType;

    // Use storage adapter (automatically switches between Vercel Blob or local file system)
    const result = await uploadFile(
      pathname,
      arrayBuffer,
      normalizedContentType,
    );

    let savedFileRecord:
      | Awaited<ReturnType<typeof createUserFile>>["file"]
      | null = null;
    let updatedUsage: { usedBytes: number; quotaBytes: number } | null = null;

    // Determine storage provider
    const storageProvider =
      process.env.IS_TAURI === "true" ? "local-fs" : "vercel_blob";

    if (shouldCreateRecord) {
      try {
        const { file: createdFile, usage } = await createUserFile({
          userId,
          userType,
          chatId: null,
          messageId: null,
          blobUrl: result.url,
          blobPathname: result.pathname,
          name: sanitizedName,
          contentType: normalizedContentType,
          sizeBytes: file.size,
          storageProvider,
          providerFileId: result.pathname,
          providerMetadata: null,
        });

        savedFileRecord = createdFile;
        updatedUsage = {
          quotaBytes: storageUsage?.quotaBytes ?? 0,
          usedBytes: usage.usedBytes,
        };
      } catch (error) {
        await deleteFile(result.url, result.pathname).catch((cleanupError) => {
          console.error(
            "[upload] Failed to clean up file after error",
            cleanupError,
          );
        });

        if (error instanceof AppError) {
          return error.toResponse();
        }

        console.error("[upload] Failed to persist uploaded file", error);
        return NextResponse.json(
          {
            error: "Upload failed. Please try again.",
          },
          { status: 500 },
        );
      }
    }

    return NextResponse.json(
      {
        url: result.url,
        pathname: result.pathname,
        downloadUrl: result.downloadUrl,
        name: originalName,
        sanitizedName,
        contentType: normalizedContentType,
        size: file.size,
        blobPath: result.pathname,
        creditsDeducted: FILE_OPERATION_CREDIT_COST,
        savedFile: savedFileRecord
          ? {
              id: savedFileRecord.id,
              name: savedFileRecord.name,
              contentType: savedFileRecord.contentType,
              sizeBytes: savedFileRecord.sizeBytes,
              savedAt:
                savedFileRecord.savedAt instanceof Date
                  ? savedFileRecord.savedAt.toISOString()
                  : savedFileRecord.savedAt,
              url: savedFileRecord.blobUrl,
              blobPathname: savedFileRecord.blobPathname,
              chatId: savedFileRecord.chatId,
              messageId: savedFileRecord.messageId,
            }
          : undefined,
        usage: updatedUsage ?? undefined,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[upload] Failed to upload file", error);
    return NextResponse.json(
      {
        error: "Upload failed. Please try again.",
      },
      { status: 500 },
    );
  }
}
