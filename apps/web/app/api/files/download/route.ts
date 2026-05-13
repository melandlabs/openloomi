import { getDownloadUrl } from "@vercel/blob";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import {
  getUserFileById,
  getUserFileByBlobPathname,
} from "@/lib/db/storageService";
import { getChatById, getMessageById } from "@/lib/db/queries";
import { deriveBlobPathFromUrl } from "@/lib/files/blob-path";
import { isTauriMode, getAppUrl } from "@/lib/env";
import { readFile, fileExists } from "@/lib/storage";
import { fetchWithSSRFProtection } from "@openloomi/security/url-validator";

const downloadSchema = z.union([
  z.object({
    fileId: z.uuid(),
  }),
  z.object({
    blobPath: z.string().min(1),
    chatId: z.uuid(),
    messageId: z.uuid(),
  }),
]);

/**
 * GET - Handle file download (proxy mode)
 * Local mode: Read from local file system
 * Server mode: Read from Vercel Blob and return (as proxy, ensuring permission check)
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const pathname = searchParams.get("path");

  if (!pathname) {
    return NextResponse.json(
      { error: "Missing path parameter" },
      { status: 400 },
    );
  }

  // URL decode: Path was encoded with encodeURIComponent, needs decoding first
  const decodedPathname = decodeURIComponent(pathname);

  try {
    // Try to infer content type from path
    const ext = decodedPathname.split(".").pop()?.toLowerCase();
    const contentTypes: Record<string, string> = {
      pdf: "application/pdf",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      txt: "text/plain",
      json: "application/json",
      mp4: "video/mp4",
      mp3: "audio/mpeg",
      wav: "audio/wav",
    };

    const contentType = contentTypes[ext || ""] || "application/octet-stream";

    if (isTauriMode()) {
      // Tauri mode: Prioritize reading from local file system
      if (fileExists(decodedPathname)) {
        const buffer = await readFile(decodedPathname);
        // Ensure buffer is a Buffer (readFile may return string in some cases)
        const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
        // Convert Buffer to Uint8Array for NextResponse compatibility
        const uint8Data = new Uint8Array(data);
        return new NextResponse(uint8Data, {
          headers: {
            "Content-Type": contentType,
            "Content-Disposition": `inline; filename="${decodedPathname.split("/").pop()}"`,
            "Cache-Control": "public, max-age=31536000",
          },
        });
      }

      // Local file doesn't exist, fallback to querying database for Vercel Blob URL and proxy
      // (File might have been uploaded to Vercel Blob in server mode)
      const fileRecord = await getUserFileByBlobPathname({
        userId: session.user.id,
        blobPathname: decodedPathname,
      }).catch(() => null);

      if (fileRecord?.blobUrl) {
        try {
          const response = await fetchWithSSRFProtection(fileRecord.blobUrl, {
            strictWhitelist: false,
            requireHttps: true,
          });
          if (response.ok) {
            const buffer = Buffer.from(await response.arrayBuffer());
            return new NextResponse(buffer, {
              headers: {
                "Content-Type": contentType,
                "Content-Disposition": `inline; filename="${decodedPathname.split("/").pop()}"`,
                "Cache-Control": "public, max-age=31536000",
              },
            });
          }
        } catch (e) {
          console.error("[download GET] Vercel Blob fallback fetch failed", {
            pathname: decodedPathname,
            error: e,
          });
        }
      }

      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    // Server mode: Read from Vercel Blob and return as proxy
    // Need to get complete blobUrl (including base URL)
    // Query database for file record to get complete URL and verify permissions
    const fileRecord = await getUserFileByBlobPathname({
      userId: session.user.id,
      blobPathname: decodedPathname,
    }).catch(() => null);

    // Permission check: Ensure file belongs to current user
    if (!fileRecord) {
      console.error("[download GET] File not found or access denied", {
        pathname: decodedPathname,
        userId: session.user.id,
      });
      return NextResponse.json(
        { error: "File not found or access denied." },
        { status: 404 },
      );
    }

    let blobUrl = fileRecord?.blobUrl;

    // If no record in database, try using Vercel Blob's getDownloadUrl
    if (!blobUrl) {
      try {
        blobUrl = getDownloadUrl(decodedPathname);
        console.log("[download GET] Using getDownloadUrl fallback for", {
          pathname: decodedPathname,
          userId: session.user.id,
        });
      } catch (e) {
        console.error("[download GET] getDownloadUrl failed", {
          pathname: decodedPathname,
          error: e,
        });
      }
    }

    if (!blobUrl) {
      console.error("[download GET] File URL not found", {
        pathname: decodedPathname,
        userId: session.user.id,
        fileRecord: fileRecord ? "exists" : "null",
      });
      return NextResponse.json(
        { error: "File URL not found." },
        { status: 404 },
      );
    }

    // SSRF protection: validate URL before fetching
    // Use relaxed validation since URL comes from trusted database record
    const response = await fetchWithSSRFProtection(blobUrl, {
      strictWhitelist: false,
      requireHttps: true,
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch file from storage." },
        { status: 502 },
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${decodedPathname.split("/").pop()}"`,
        "Cache-Control": "public, max-age=31536000",
      },
    });
  } catch (error) {
    console.error("[download] Failed to download file", error);
    return NextResponse.json(
      { error: "Failed to download file" },
      { status: 500 },
    );
  }
}

/**
 * POST - Get file download URL
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = downloadSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  if ("fileId" in parsed.data) {
    const file = await getUserFileById({
      userId: session.user.id,
      fileId: parsed.data.fileId,
    });

    if (!file) {
      return NextResponse.json({ error: "File not found." }, { status: 404 });
    }

    if (file.storageProvider === "google_drive") {
      const metadata =
        (file.providerMetadata as Record<string, unknown> | null) ?? null;
      const webContentLink =
        metadata && typeof metadata.webContentLink === "string"
          ? (metadata.webContentLink as string)
          : null;
      const fallbackDownload =
        file.providerFileId && typeof file.providerFileId === "string"
          ? `https://drive.google.com/uc?id=${file.providerFileId}&export=download`
          : null;
      const driveUrl =
        webContentLink ??
        fallbackDownload ??
        (file.blobUrl && file.blobUrl.length > 0 ? file.blobUrl : null);

      if (!driveUrl) {
        return NextResponse.json(
          { error: "Download link unavailable for this file." },
          { status: 400 },
        );
      }

      return NextResponse.json({
        downloadUrl: driveUrl,
      });
    }

    if (file.storageProvider === "notion") {
      const metadata =
        (file.providerMetadata as Record<string, unknown> | null) ?? null;
      const pageUrl =
        (metadata?.pageUrl as string | undefined) ??
        (typeof file.blobUrl === "string" ? file.blobUrl : null);
      if (!pageUrl) {
        return NextResponse.json(
          { error: "Download link unavailable for this file." },
          { status: 400 },
        );
      }
      return NextResponse.json({ downloadUrl: pageUrl });
    }

    const downloadUrl = getDownloadUrl(file.blobUrl);

    // Tauri mode: Return local file download API URL
    const finalDownloadUrl = isTauriMode()
      ? `${getAppUrl()}/api/files/download?path=${encodeURIComponent(file.blobPathname)}`
      : downloadUrl;

    return NextResponse.json({
      downloadUrl: finalDownloadUrl,
    });
  }

  const normalizedBlobPath = parsed.data.blobPath.startsWith("http")
    ? deriveBlobPathFromUrl(parsed.data.blobPath)
    : parsed.data.blobPath;

  if (!normalizedBlobPath || normalizedBlobPath.includes("..")) {
    return NextResponse.json({ error: "Invalid blob path." }, { status: 400 });
  }

  const chat = await getChatById({ id: parsed.data.chatId });
  if (!chat || chat.userId !== session.user.id) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  const [message] = await getMessageById({ id: parsed.data.messageId });
  if (!message || message.chatId !== chat.id) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  const attachments = Array.isArray(message.attachments)
    ? (message.attachments as Array<Record<string, unknown>>)
    : [];

  const attachment = attachments.find((item) => {
    if (!item) return false;
    const directPath = typeof item.blobPath === "string" ? item.blobPath : null;
    const derivedPath =
      directPath ??
      deriveBlobPathFromUrl(
        typeof item.url === "string"
          ? item.url
          : typeof item.downloadUrl === "string"
            ? item.downloadUrl
            : null,
      );
    return derivedPath === normalizedBlobPath;
  });

  if (!attachment) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  const resolvedBlobPath =
    (typeof attachment.blobPath === "string" ? attachment.blobPath : null) ??
    deriveBlobPathFromUrl(
      typeof attachment.url === "string"
        ? attachment.url
        : typeof attachment.downloadUrl === "string"
          ? attachment.downloadUrl
          : null,
    );

  if (!resolvedBlobPath) {
    return NextResponse.json(
      { error: "Attachment is not stored in openloomi." },
      { status: 400 },
    );
  }

  // getDownloadUrl needs complete URL, get from attachment
  const attachmentUrl =
    (typeof attachment.url === "string" ? attachment.url : null) ??
    (typeof attachment.downloadUrl === "string"
      ? attachment.downloadUrl
      : null);

  if (!attachmentUrl) {
    return NextResponse.json(
      { error: "Attachment URL not found." },
      { status: 400 },
    );
  }

  const downloadUrl = getDownloadUrl(attachmentUrl);

  // Tauri mode: Return local file download API URL
  const finalDownloadUrl = isTauriMode()
    ? `${getAppUrl()}/api/files/download?path=${encodeURIComponent(resolvedBlobPath)}`
    : downloadUrl;

  return NextResponse.json({
    downloadUrl: finalDownloadUrl,
  });
}
