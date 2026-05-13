import { head } from "@vercel/blob";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import {
  FILE_OPERATION_CREDIT_COST,
  SUPPORTED_ATTACHMENT_MIME_TYPES_ARRAY,
  type FileStorageProvider,
} from "@/lib/files/config";
import { getChatById, getMessageById } from "@/lib/db/queries";
import { createUserFile, getUserStorageUsage } from "@/lib/db/storageService";
import { AppError } from "@openloomi/shared/errors";
import { uploadFileToGoogleDrive } from "@/lib/files/google-drive";
import {
  deriveNotionTextPreview,
  uploadFileToNotion,
} from "@/lib/files/notion";
import { isTauriMode } from "@/lib/env";
import { fileExists, readFile } from "@/lib/storage";
import { fetchWithSSRFProtection } from "@openloomi/security/url-validator";

function deriveBlobPathFromUrl(source?: string | null) {
  if (!source) return null;
  try {
    const parsed = new URL(source);
    if (!parsed.hostname.includes("vercel-storage.com")) {
      return null;
    }
    return decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    return null;
  }
}

const attachmentMimeEnum = z.enum(SUPPORTED_ATTACHMENT_MIME_TYPES_ARRAY);

const storageProviderEnum = z.enum([
  "vercel_blob",
  "google_drive",
  "notion",
  "local-fs",
] as const);

const saveRequestSchema = z.object({
  chatId: z.uuid(),
  messageId: z.uuid(),
  attachment: z.object({
    url: z.url(),
    blobPath: z.string().min(1).optional(),
    name: z.string().min(1).max(200),
    contentType: attachmentMimeEnum,
    sizeBytes: z.number().int().positive().optional(),
  }),
  storageProvider: storageProviderEnum
    .optional()
    .default(isTauriMode() ? "local-fs" : ("vercel_blob" as const)),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parseResult = saveRequestSchema.safeParse(await request.json());
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: "Invalid request body.",
        details: parseResult.error.issues,
      },
      { status: 400 },
    );
  }

  const { chatId, messageId, attachment } = parseResult.data;
  const storageProvider = parseResult.data
    .storageProvider as FileStorageProvider;
  const { user } = session;

  const storageUsage = await getUserStorageUsage(user.id, user.type);
  if (storageUsage.quotaBytes <= 0) {
    return NextResponse.json(
      {
        error:
          "Saving files is not available on your current plan. Upgrade to Basic or Pro to unlock file storage.",
      },
      { status: 403 },
    );
  }

  const [dbMessage] = await getMessageById({ id: messageId });
  if (!dbMessage || dbMessage.chatId !== chatId) {
    return NextResponse.json(
      { error: "Message not found in the specified chat." },
      { status: 404 },
    );
  }

  const chat = await getChatById({ id: chatId });
  if (!chat || chat.userId !== user.id) {
    return NextResponse.json(
      { error: "You do not have permission to save files from this chat." },
      { status: 403 },
    );
  }

  const resolvedBlobPath =
    attachment.blobPath ?? deriveBlobPathFromUrl(attachment.url);

  const attachmentExists =
    Array.isArray(dbMessage.attachments) &&
    dbMessage.attachments.some(
      (item: any) =>
        (item?.blobPath ?? item?.blobPathname ?? "") === resolvedBlobPath ||
        item?.url === attachment.url,
    );

  if (!attachmentExists) {
    return NextResponse.json(
      {
        error:
          "Attachment metadata does not match the recorded message attachments.",
      },
      { status: 400 },
    );
  }

  if (!resolvedBlobPath) {
    return NextResponse.json(
      {
        error:
          "Saving is unavailable for this attachment because it is not stored in openloomi.",
      },
      { status: 400 },
    );
  }

  // File validation: use different validation methods based on storage provider
  let validatedFileMetadata: {
    url: string;
    pathname: string;
    size: number;
    contentType?: string;
  };

  if (storageProvider === "local-fs") {
    // Local file validation
    if (!resolvedBlobPath) {
      return NextResponse.json(
        { error: "File path is required for local storage." },
        { status: 400 },
      );
    }

    if (!fileExists(resolvedBlobPath)) {
      return NextResponse.json(
        { error: "Local file not found." },
        { status: 404 },
      );
    }

    const buffer = await readFile(resolvedBlobPath);
    const actualSize = buffer.length;

    // Validate file size (if provided)
    if (
      typeof attachment.sizeBytes === "number" &&
      attachment.sizeBytes !== actualSize
    ) {
      return NextResponse.json(
        { error: "File size mismatch detected during validation." },
        { status: 400 },
      );
    }

    validatedFileMetadata = {
      url: attachment.url,
      pathname: resolvedBlobPath,
      size: actualSize,
      contentType: attachment.contentType,
    };
  } else {
    // Vercel Blob validation
    const headResult = await head(attachment.url).catch((error) => {
      console.error("[storage] Failed to inspect blob metadata", error);
      return null;
    });

    if (!headResult) {
      return NextResponse.json(
        { error: "Failed to inspect file metadata. Try again later." },
        { status: 502 },
      );
    }

    if (headResult.contentType !== attachment.contentType) {
      return NextResponse.json(
        { error: "File type mismatch detected during validation." },
        { status: 400 },
      );
    }

    if (
      typeof attachment.sizeBytes === "number" &&
      attachment.sizeBytes !== headResult.size
    ) {
      return NextResponse.json(
        { error: "File size mismatch detected during validation." },
        { status: 400 },
      );
    }

    validatedFileMetadata = {
      url: headResult.url,
      pathname: resolvedBlobPath ?? headResult.pathname,
      size: headResult.size,
      contentType: headResult.contentType,
    };
  }

  try {
    let fileRecord: Awaited<ReturnType<typeof createUserFile>>["file"];
    let usage: Awaited<ReturnType<typeof createUserFile>>["usage"];

    if (storageProvider === "google_drive") {
      // SSRF protection: validate URL before fetching
      const downloadResponse = await fetchWithSSRFProtection(
        validatedFileMetadata.url,
        {
          // Use relaxed validation for Google Drive URLs since we're validating
          // against existing message attachments
          strictWhitelist: false,
          requireHttps: true,
        },
      );
      if (!downloadResponse.ok) {
        throw new AppError(
          "bad_request:api",
          "Failed to download file from storage for Google Drive.",
        );
      }

      const buffer = Buffer.from(await downloadResponse.arrayBuffer());
      const uploaded = await uploadFileToGoogleDrive({
        userId: user.id,
        fileName: attachment.name,
        mimeType: attachment.contentType,
        data: buffer,
      });

      const { file, usage: usageResult } = await createUserFile({
        userId: user.id,
        userType: user.type,
        chatId,
        messageId,
        blobUrl:
          uploaded.webViewLink ??
          uploaded.webContentLink ??
          validatedFileMetadata.url,
        blobPathname: uploaded.id,
        name: uploaded.name ?? attachment.name,
        contentType: uploaded.mimeType ?? attachment.contentType,
        sizeBytes: uploaded.sizeBytes ?? buffer.length,
        storageProvider: "google_drive",
        providerFileId: uploaded.id,
        providerMetadata: {
          webViewLink: uploaded.webViewLink ?? null,
          webContentLink: uploaded.webContentLink ?? null,
          iconLink: uploaded.iconLink ?? null,
        },
      });

      fileRecord = file;
      usage = usageResult;
    } else if (storageProvider === "notion") {
      const sourceUrl =
        validatedFileMetadata.contentType === "notion"
          ? validatedFileMetadata.url
          : attachment.url;

      // SSRF protection: validate URL before fetching
      const downloadResponse = await fetchWithSSRFProtection(sourceUrl, {
        // Use relaxed validation for Notion URLs since we're validating
        // against existing message attachments
        strictWhitelist: false,
        requireHttps: true,
      });
      if (!downloadResponse.ok) {
        throw new AppError(
          "bad_request:api",
          "Failed to download file from storage for Notion.",
        );
      }

      const buffer = Buffer.from(await downloadResponse.arrayBuffer());
      const notionUpload = await uploadFileToNotion({
        userId: user.id,
        fileName: attachment.name,
        mimeType: attachment.contentType,
        fileUrl: sourceUrl,
        textPreview: deriveNotionTextPreview(buffer, attachment.contentType),
      });

      const { file, usage: usageResult } = await createUserFile({
        userId: user.id,
        userType: user.type,
        chatId,
        messageId,
        blobUrl: notionUpload.pageUrl ?? validatedFileMetadata.url,
        blobPathname: notionUpload.pageId,
        name: attachment.name,
        contentType: attachment.contentType,
        sizeBytes: validatedFileMetadata.size,
        storageProvider: "notion",
        providerFileId: notionUpload.pageId,
        providerMetadata: {
          pageUrl: notionUpload.pageUrl,
          target: notionUpload.target,
        },
      });

      fileRecord = file;
      usage = usageResult;
    } else {
      // vercel_blob or local-fs
      const { file, usage: usageResult } = await createUserFile({
        userId: user.id,
        userType: user.type,
        chatId,
        messageId,
        blobUrl: validatedFileMetadata.url,
        blobPathname: validatedFileMetadata.pathname,
        name: attachment.name,
        contentType: attachment.contentType,
        sizeBytes: validatedFileMetadata.size,
        storageProvider,
        providerFileId: validatedFileMetadata.pathname ?? null,
      });

      fileRecord = file;
      usage = usageResult;
    }

    return NextResponse.json(
      {
        file: fileRecord,
        usage: {
          usedBytes: usage.usedBytes,
          quotaBytes: storageUsage.quotaBytes,
        },
        storageProvider,
        creditsDeducted: FILE_OPERATION_CREDIT_COST,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return error.toResponse();
    }
    console.error("[storage] Failed to save file", error);
    return NextResponse.json(
      { error: "Failed to save file. Please try again later." },
      { status: 500 },
    );
  }
}
