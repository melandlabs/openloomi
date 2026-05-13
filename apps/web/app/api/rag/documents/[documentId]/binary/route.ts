import { NextResponse } from "next/server";
import { head } from "@vercel/blob";
import { auth } from "@/app/(auth)/auth";
import { getDocument } from "@/lib/ai/rag/langchain-service";
import { isTauriMode } from "@/lib/env";
import { fileExists, readFile } from "@/lib/storage";
import { fetchWithSSRFProtection } from "@openloomi/security/url-validator";

/**
 * Infer content type from filename extension.
 */
function inferContentType(fileName: string, fallback?: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    txt: "text/plain",
    md: "text/markdown",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    csv: "text/csv",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
  };
  return map[ext || ""] || fallback || "application/octet-stream";
}

/**
 * RAG `blob_path` may be a Vercel Blob pathname or a full blob HTTPS URL.
 * `getDownloadUrl` only accepts full URLs; for pathnames we use `head()` first.
 */
async function resolveBlobFetchUrl(blobPath: string): Promise<string> {
  const trimmed = blobPath.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  const meta = await head(trimmed);
  const url = meta.downloadUrl || meta.url;
  if (!url) {
    throw new Error("Blob metadata has no fetchable URL");
  }
  return url;
}

/**
 * GET /api/rag/documents/[documentId]/binary
 * Return original uploaded binary for a RAG document with ownership checks.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { documentId } = await params;
    const document = await getDocument(documentId);
    if (!document || document.userId !== session.user.id) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 },
      );
    }

    if (!document.blobPath) {
      return NextResponse.json(
        { error: "Original file is unavailable for this document" },
        { status: 404 },
      );
    }

    const contentType = inferContentType(
      document.fileName,
      document.contentType,
    );

    if (isTauriMode()) {
      // Local/Tauri mode: prefer local filesystem path.
      // Validate blobPath is a local file path (not a URL or API endpoint)
      const isLocalPath =
        document.blobPath &&
        !document.blobPath.includes("://") &&
        !document.blobPath.includes("?") &&
        !document.blobPath.startsWith("/api/");
      if (isLocalPath && fileExists(document.blobPath)) {
        const buffer = await readFile(document.blobPath);
        // Ensure buffer is a Buffer (readFile may return string in some cases)
        const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
        // Convert Buffer to Uint8Array for Response compatibility
        const uint8Data = new Uint8Array(data);
        // Encode filename for Content-Disposition header using RFC 5987 to handle Unicode
        const encodedFilename = encodeURIComponent(document.fileName);
        // Use Response directly to avoid potential header processing issues with NextResponse
        return new Response(uint8Data, {
          headers: {
            "Content-Type": contentType,
            "Content-Disposition": `inline; filename="${encodedFilename}"`,
            "Cache-Control": "no-cache",
          },
        });
      }
      // Stored path is not a file on disk; if it is not a remote URL, fail clearly.
      if (!/^https?:\/\//i.test(document.blobPath.trim())) {
        return NextResponse.json(
          { error: "Local original file not found for this document" },
          { status: 404 },
        );
      }
    }

    const fetchUrl = await resolveBlobFetchUrl(document.blobPath);
    const upstream = await fetchWithSSRFProtection(fetchUrl, {
      strictWhitelist: false,
      requireHttps: true,
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: "Failed to fetch document binary from storage" },
        { status: 502 },
      );
    }

    const data = Buffer.from(await upstream.arrayBuffer());
    return new NextResponse(data, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${document.fileName}"`,
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error("[RAG document binary] Failed to fetch binary", error);
    return NextResponse.json(
      { error: "Failed to fetch document binary" },
      { status: 500 },
    );
  }
}
