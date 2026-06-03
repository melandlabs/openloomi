import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { parseFile } from "@/lib/files/parsers";
import { randomUUID } from "node:crypto";
import {
  processDocumentFromFile,
  getUserRAGStats,
  shouldSkipRAGEmbeddings,
} from "@/lib/ai/rag/langchain-service";
import {
  SUPPORTED_RAG_MIME_TYPES,
  getMimeTypeFromExtension,
} from "@/lib/files/config";
import { uploadFile } from "@/lib/storage";
import { createWriteStream } from "node:fs";
import { unlink, readFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Initialize tempFilePath for cleanup in catch block
  let tempFilePath = "";

  try {
    const formData = await request.formData();
    const uploadedFile = formData.get("file");

    // Extract cloudAuthToken and skipEmbeddings from formData if provided.
    // Tauri skips embeddings unless a local/vector backend such as Chroma is configured.
    const cloudAuthToken = formData.get("cloudAuthToken") as string | null;
    const skipEmbeddings = shouldSkipRAGEmbeddings(
      formData.get("skipEmbeddings") === "true",
    );

    if (!(uploadedFile instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const file = uploadedFile;
    const fileName = file.name;
    let contentType = file.type;

    const { id: userId, type: userType } = session.user;

    // Detect file extension, used to correct MIME type or handle missing MIME type
    const fileExtension = fileName.toLowerCase().split(".").pop();
    if (
      !contentType ||
      contentType === "" ||
      contentType === "application/octet-stream"
    ) {
      // Infer MIME type from file extension
      const inferredMimeType = getMimeTypeFromExtension(`.${fileExtension}`);
      contentType = inferredMimeType || "text/plain";
    } else if (fileExtension === "md" && contentType === "text/plain") {
      // Browsers typically recognize .md files as text/plain, need to correct to text/markdown
      contentType = "text/markdown";
    }

    // Check if file type is supported for RAG
    if (!SUPPORTED_RAG_MIME_TYPES.includes(contentType as any)) {
      return NextResponse.json(
        {
          error: `Unsupported file type for RAG. Supported types: ${SUPPORTED_RAG_MIME_TYPES.join(", ")}`,
        },
        { status: 415 },
      );
    }

    // Check file size (max 100MB for RAG processing)
    const MAX_RAG_SIZE = 100 * 1024 * 1024; // 100MB
    if (file.size > MAX_RAG_SIZE) {
      return NextResponse.json(
        {
          error: `File too large for RAG processing. Maximum size is ${MAX_RAG_SIZE / (1024 * 1024)}MB`,
        },
        { status: 400 },
      );
    }

    // Stream file to temp file to avoid loading entire file into memory (OOM risk)
    tempFilePath = join(tmpdir(), `rag-upload-${Date.now()}-${randomUUID()}`);
    console.log("[RAG Upload] Streaming to temp file:", tempFilePath);

    await pipeline(file.stream() as any, createWriteStream(tempFilePath));
    console.log("[RAG Upload] File streamed to temp file successfully");

    // For images, skip initial parsing in route.ts and let processDocumentFromFile handle it
    // This avoids double parsing (the Vision API call is expensive)
    // For PDFs and other files, we need to parse first to check for scanned documents
    let content = "";
    let metadata: any;
    const isImage = contentType.startsWith("image/");

    if (!isImage) {
      // Read temp file as buffer for parsing
      const buffer = await readFile(tempFilePath);
      // Parse non-image files to validate content
      const parseResult = await parseFile(
        buffer,
        contentType,
        cloudAuthToken || undefined,
      );
      content = parseResult.text;
      metadata = parseResult.metadata;
      console.log(
        "[RAG Upload] File parsed successfully, content length:",
        content.length,
      );

      // For PDF files, check if the extracted content is too short (likely a scanned document)
      const MIN_PDF_CONTENT_LENGTH = 50;
      if (
        contentType === "application/pdf" &&
        content.trim().length < MIN_PDF_CONTENT_LENGTH
      ) {
        // Clean up temp file before returning error
        await unlink(tempFilePath).catch(console.error);
        console.log(
          `[RAG Upload] PDF content too short (${content.trim().length} chars), likely a scanned document`,
        );
        return NextResponse.json(
          {
            error:
              "No text content could be extracted from PDF. This may be a scanned document or image-based PDF. Please convert it to a text-based PDF or use OCR first.",
          },
          { status: 400 },
        );
      }

      // Validate that we extracted some content
      if (!content || content.trim().length === 0) {
        // Clean up temp file before returning error
        await unlink(tempFilePath).catch(console.error);
        return NextResponse.json(
          {
            error: "No text content could be extracted from file",
          },
          { status: 400 },
        );
      }
    } else {
      console.log(
        "[RAG Upload] Skipping initial parse for image, will process in processDocumentFromFile",
      );
    }

    // Process document with RAG using LangChain and billing
    console.log("[RAG Upload] Starting document processing with embeddings...");

    // Use cloudAuthToken if provided (for local mode authentication)
    if (cloudAuthToken) {
      console.log(
        "[RAG Upload] Using cloudAuthToken for authentication:",
        cloudAuthToken.substring(0, 50),
      );
    } else {
      console.log("[RAG Upload] No cloudAuthToken provided");
    }

    // Read buffer from temp file for upload and processing
    const buffer = await readFile(tempFilePath);
    console.log(
      "[RAG Upload] Buffer loaded from temp file, size:",
      buffer.length,
    );

    // Upload original file to storage system (for workspace export)
    let blobPath: string | undefined;
    try {
      const uploadResult = await uploadFile(
        `${userId}/rag/${randomUUID()}-${fileName}`,
        buffer,
        contentType,
      );
      blobPath = uploadResult.pathname;
      console.log(`[RAG Upload] Original file saved to storage: ${blobPath}`);
    } catch (error) {
      console.error(
        "[RAG Upload] Failed to save original file to storage:",
        error,
      );
      // Continue processing, RAG functionality still works
    }

    const result = await processDocumentFromFile(
      userId,
      userType,
      fileName,
      contentType,
      buffer,
      {
        chunkSize: 1000,
        chunkOverlap: 200,
        blobPath, // Pass original file path
        skipEmbeddings,
      },
      cloudAuthToken || undefined,
    );
    console.log("[RAG Upload] Document processed successfully");

    // Get updated stats
    const stats = await getUserRAGStats(userId);

    const responseData = {
      success: true,
      message: skipEmbeddings
        ? "Document successfully stored without embeddings"
        : "Document successfully processed and added to strategy memory",
      fileName,
      contentType,
      extractedLength: isImage ? 0 : content.length,
      chunksCount: result.chunksCount,
      documentId: result.documentId,
      metadata,
      billing: {
        tokensUsed: result.totalTokensUsed,
        creditCost: result.totalCreditCost,
      },
      stats: {
        totalDocuments: stats.totalDocuments,
        totalChunks: stats.totalChunks,
      },
      tip: "Your document has been processed!",
    };

    // Clean up temp file
    await unlink(tempFilePath).catch(console.error);
    console.log("[RAG Upload] Temp file cleaned up");

    // Use plain Response instead of NextResponse to avoid potential streaming issues
    // Add Connection: close to prevent keep-alive issues
    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
        Connection: "close",
      },
    });
  } catch (error) {
    // Clean up temp file on error (if it was created)
    if (tempFilePath) {
      await unlink(tempFilePath).catch(console.error);
    }
    console.error("RAG upload error:", error);

    // Handle quota errors specifically
    if (
      error instanceof Error &&
      error.message.includes("Insufficient quota")
    ) {
      return NextResponse.json(
        {
          error: error.message,
          code: "INSUFFICIENT_QUOTA",
        },
        { status: 402 }, // Payment Required
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to process document for RAG",
      },
      { status: 500 },
    );
  }
}
