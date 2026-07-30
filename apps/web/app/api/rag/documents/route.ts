import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/dual-auth";
import {
  getUserDocuments,
  deleteUserDocuments,
} from "@/lib/ai/rag/langchain-service";
import { db } from "@/lib/db";
import { insightDocuments, insight } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";

/**
 * GET /api/rag/documents
 * Get all RAG documents for the current user
 * Supports pagination with cursor-based pagination for infinite scroll
 */
export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = user.id;
  const { searchParams } = new URL(request.url);

  // Pagination parameters
  const pageSize = Number.parseInt(searchParams.get("pageSize") || "50", 10);
  const cursor = searchParams.get("cursor"); // uploadedAt timestamp of previous document

  try {
    const documents = await getUserDocuments(userId);

    // Sort by uploadedAt in descending order
    const sortedDocs = documents
      .map((doc: any) => ({
        id: doc.id,
        fileName: doc.fileName,
        contentType: doc.contentType,
        sizeBytes: Number(doc.sizeBytes),
        totalChunks: doc.totalChunks,
        uploadedAt: doc.uploadedAt,
      }))
      .sort((a: any, b: any) => {
        const aTime = new Date(a.uploadedAt).getTime();
        const bTime = new Date(b.uploadedAt).getTime();
        return bTime - aTime;
      });

    // Cursor-based pagination
    let startIndex = 0;
    if (cursor) {
      // cursor is a timestamp string
      const cursorTime = Number.parseInt(cursor, 10);
      startIndex = sortedDocs.findIndex(
        (doc: any) => new Date(doc.uploadedAt).getTime() === cursorTime,
      );
      if (startIndex !== -1) {
        startIndex += 1;
      } else {
        startIndex = sortedDocs.findIndex(
          (doc: any) => new Date(doc.uploadedAt).getTime() < cursorTime,
        );
      }
    }

    let documentsPage = sortedDocs.slice(startIndex, startIndex + pageSize);
    const hasMore = startIndex + pageSize < sortedDocs.length;
    // nextCursor uses timestamp string to avoid colon issues in ISO strings
    const nextCursor = hasMore
      ? String(
          documentsPage[documentsPage.length - 1]?.uploadedAt
            ? new Date(
                documentsPage[documentsPage.length - 1].uploadedAt,
              ).getTime()
            : 0,
        )
      : null;

    // Associate events: Get the insight each document belongs to from insight_documents (for My files grouping by event)
    const docIds = documentsPage.map((d: { id: string }) => d.id);
    if (docIds.length > 0) {
      const links = await db
        .select({
          documentId: insightDocuments.documentId,
          insightId: insightDocuments.insightId,
          insightTitle: insight.title,
        })
        .from(insightDocuments)
        .innerJoin(insight, eq(insightDocuments.insightId, insight.id))
        .where(
          and(
            inArray(insightDocuments.documentId, docIds),
            eq(insightDocuments.userId, userId),
          ),
        );
      const docToInsight = new Map<
        string,
        { insightId: string; insightTitle: string }
      >();
      for (const row of links) {
        const docId = String(row.documentId);
        if (!docToInsight.has(docId)) {
          docToInsight.set(docId, {
            insightId: String(row.insightId),
            insightTitle: (row.insightTitle as string) ?? "",
          });
        }
      }
      documentsPage = documentsPage.map((d: Record<string, unknown>) => {
        const link = docToInsight.get(String(d.id));
        return {
          ...d,
          ...(link && {
            insightId: link.insightId,
            insightTitle: link.insightTitle,
          }),
        };
      });
    }

    return NextResponse.json({
      documents: documentsPage,
      hasMore,
      nextCursor,
      total: sortedDocs.length,
    });
  } catch (error) {
    console.error("RAG documents fetch error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch documents",
      },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/rag/documents
 * Delete all RAG documents for the current user
 */
export async function DELETE(request: Request) {
  const user = await getAuthUser(request);
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = user.id;

  try {
    await deleteUserDocuments(userId);

    return NextResponse.json({
      success: true,
      message: "All documents deleted from strategy memory",
    });
  } catch (error) {
    console.error("RAG documents delete error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete documents",
      },
      { status: 500 },
    );
  }
}
