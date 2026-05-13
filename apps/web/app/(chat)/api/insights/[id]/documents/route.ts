import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import { db } from "@/lib/db/queries";
import {
  insight,
  ragDocuments,
  ragChunks,
  insightDocuments,
} from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";
import type { TimelineData } from "@/lib/ai/subagents/insights";

/**
 * GET /api/insights/[id]/documents
 * Get all documents associated with specified insight
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:document").toResponse();
  }

  try {
    const { id: insightId } = await params;

    if (!insightId) {
      return new AppError(
        "bad_request:document",
        "Insight ID is required",
      ).toResponse();
    }

    // Verify insight exists and belongs to user's bot
    const insightResult = await db
      .select({ botId: insight.botId })
      .from(insight)
      .where(eq(insight.id, insightId))
      .limit(1);

    if (insightResult.length === 0) {
      return new AppError(
        "not_found:insight",
        "Insight not found",
      ).toResponse();
    }

    // Get all documents associated with this insight
    const documents = await db
      .select({
        id: ragDocuments.id,
        fileName: ragDocuments.fileName,
        contentType: ragDocuments.contentType,
        sizeBytes: ragDocuments.sizeBytes,
        totalChunks: ragDocuments.totalChunks,
        uploadedAt: ragDocuments.uploadedAt,
        updatedAt: ragDocuments.updatedAt,
        associatedAt: insightDocuments.createdAt,
      })
      .from(insightDocuments)
      .innerJoin(ragDocuments, eq(insightDocuments.documentId, ragDocuments.id))
      .where(eq(insightDocuments.insightId, insightId))
      .orderBy(desc(insightDocuments.createdAt));

    return Response.json({ documents }, { status: 200 });
  } catch (error) {
    console.error("[Documents API] Failed to get documents:", error);
    return new AppError(
      "bad_request:database",
      `Failed to get documents. ${error instanceof Error ? error.message : String(error)}`,
    ).toResponse();
  }
}

/**
 * POST /api/insights/[id]/documents
 * Associate document with specified insight
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:document").toResponse();
  }

  try {
    const { id: insightId } = await params;

    if (!insightId) {
      return new AppError(
        "bad_request:document",
        "Insight ID is required",
      ).toResponse();
    }

    const body = await request.json();
    const { documentId } = body as {
      documentId?: string;
    };

    if (!documentId) {
      return new AppError(
        "bad_request:document",
        "Document ID is required",
      ).toResponse();
    }

    // Verify insight exists and belongs to user's bot
    const insightResult = await db
      .select({ botId: insight.botId })
      .from(insight)
      .where(eq(insight.id, insightId))
      .limit(1);

    if (insightResult.length === 0) {
      return new AppError(
        "not_found:insight",
        "Insight not found",
      ).toResponse();
    }

    // Verify document exists and belongs to current user
    const documentResult = await db
      .select({ userId: ragDocuments.userId })
      .from(ragDocuments)
      .where(eq(ragDocuments.id, documentId))
      .limit(1);

    if (documentResult.length === 0) {
      return new AppError(
        "not_found:document",
        "Document not found",
      ).toResponse();
    }

    // Check if already associated
    const existingAssociation = await db
      .select({ id: insightDocuments.id })
      .from(insightDocuments)
      .where(
        and(
          eq(insightDocuments.insightId, insightId),
          eq(insightDocuments.documentId, documentId),
        ),
      )
      .limit(1);

    if (existingAssociation.length > 0) {
      return new AppError(
        "bad_request:document",
        "Document already associated with this insight",
      ).toResponse();
    }

    // Create association
    const result = await db
      .insert(insightDocuments)
      .values({
        insightId,
        documentId,
        userId: session.user.id,
      })
      .returning({ id: insightDocuments.id });

    const associationId = result[0]?.id;

    if (!associationId) {
      throw new Error("Failed to associate document");
    }

    // Get document info for timeline entry
    const docInfo = await db
      .select({
        fileName: ragDocuments.fileName,
        sizeBytes: ragDocuments.sizeBytes,
        uploadedAt: ragDocuments.uploadedAt,
        contentType: ragDocuments.contentType,
        totalChunks: ragDocuments.totalChunks,
      })
      .from(ragDocuments)
      .where(eq(ragDocuments.id, documentId))
      .limit(1);

    // Get first chunk content preview
    const chunkInfo = await db
      .select({ content: ragChunks.content })
      .from(ragChunks)
      .where(eq(ragChunks.documentId, documentId))
      .orderBy(ragChunks.chunkIndex)
      .limit(1);

    // Get current insight timeline
    // Note: In SQLite mode, timeline is stored as JSON string and needs parsing
    const currentInsight = await db
      .select({ timeline: insight.timeline })
      .from(insight)
      .where(eq(insight.id, insightId))
      .limit(1);

    const rawTimeline = currentInsight[0]?.timeline;
    let currentTimeline: TimelineData[] = [];
    if (rawTimeline) {
      if (Array.isArray(rawTimeline)) {
        currentTimeline = rawTimeline;
      } else if (typeof rawTimeline === "string") {
        try {
          currentTimeline = JSON.parse(rawTimeline);
        } catch {
          currentTimeline = [];
        }
      }
    }

    // Format file size
    const formatFileSize = (bytes: number | null | undefined) => {
      if (!bytes) return "";
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    // Format upload date
    const formatUploadDate = (date: Date | string | null | undefined) => {
      if (!date) return "";
      const d = new Date(date);
      const month = d.toLocaleString("en-US", { month: "short" });
      const day = d.getDate();
      const hour = d.getHours().toString().padStart(2, "0");
      const minute = d.getMinutes().toString().padStart(2, "0");
      return `${month} ${day}, ${hour}:${minute}`;
    };

    // Get file extension/type
    const getFileType = (
      contentType: string | null | undefined,
      fileName: string,
    ) => {
      if (contentType) {
        const parts = contentType.split("/");
        if (parts.length === 2) {
          return parts[1].toUpperCase();
        }
        return contentType;
      }
      // Fallback to extension from filename
      const ext = fileName.split(".").pop()?.toUpperCase();
      return ext || "";
    };

    // Build summary with file info
    const fileSize = formatFileSize(docInfo[0]?.sizeBytes);
    const uploadDate = formatUploadDate(docInfo[0]?.uploadedAt);
    const fileType = getFileType(
      docInfo[0]?.contentType,
      docInfo[0]?.fileName || "",
    );
    // Get first chunk content preview (first 30 characters)
    const contentPreview = chunkInfo[0]?.content
      ? `"${chunkInfo[0].content.slice(0, 30)}..."`
      : "";
    const fileInfo = [contentPreview, fileType, fileSize, uploadDate]
      .filter(Boolean)
      .join(" · ");
    const summary = docInfo[0]
      ? `Added file: ${docInfo[0].fileName}${fileInfo ? ` (${fileInfo})` : ""}`
      : "Added file";

    // Create new timeline event for document attachment
    const newTimelineEvent: TimelineData = {
      time: Date.now(),
      summary,
      label: "File",
    };

    // Update insight's timeline and updatedAt
    await db
      .update(insight)
      .set({
        timeline: JSON.stringify([...currentTimeline, newTimelineEvent]),
        updatedAt: new Date(),
      })
      .where(eq(insight.id, insightId));

    return Response.json(
      {
        message: "Document associated successfully",
        associationId,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[Documents API] Failed to associate document:", error);
    return new AppError(
      "bad_request:database",
      `Failed to associate document. ${error instanceof Error ? error.message : String(error)}`,
    ).toResponse();
  }
}
