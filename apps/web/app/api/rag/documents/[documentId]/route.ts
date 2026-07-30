import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/dual-auth";
import {
  getDocument,
  getDocumentChunks,
  deleteDocument,
} from "@/lib/ai/rag/langchain-service";

/**
 * GET /api/rag/documents/[documentId]
 * Get a specific RAG document with its chunks
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const user = await getAuthUser(request);
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { documentId } = await params;

    const document = await getDocument(documentId);

    if (!document) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 },
      );
    }

    // Verify document ownership (IDOR protection)
    if (document.userId !== user.id) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 },
      );
    }

    // Get chunks for this document
    const chunks = await getDocumentChunks(documentId);

    return NextResponse.json({
      document: {
        id: document.id,
        fileName: document.fileName,
        contentType: document.contentType,
        blobPath: document.blobPath,
        sizeBytes: Number(document.sizeBytes),
        totalChunks: document.totalChunks,
        uploadedAt: document.uploadedAt,
        chunks: chunks.map((chunk: any) => ({
          id: chunk.id,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          createdAt: chunk.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error("RAG document fetch error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch document",
      },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/rag/documents/[documentId]
 * Delete a specific RAG document
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const user = await getAuthUser(request);
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { documentId } = await params;

    const document = await getDocument(documentId);

    if (!document) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 },
      );
    }

    // Verify document ownership (IDOR protection)
    if (document.userId !== user.id) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 },
      );
    }

    await deleteDocument(documentId);

    return NextResponse.json({
      success: true,
      message: "Document deleted from strategy memory",
    });
  } catch (error) {
    console.error("RAG document delete error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete document",
      },
      { status: 500 },
    );
  }
}
