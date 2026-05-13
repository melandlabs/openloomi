import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import { db } from "@/lib/db/queries";
import {
  insight,
  ragDocuments,
  ragChunks,
  insightDocuments,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import type { TimelineData } from "@/lib/ai/subagents/insights";

/**
 * DELETE /api/insights/[id]/documents/[documentId]
 * Remove association between document and insight
 */
export async function DELETE(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ id: string; documentId: string }>;
  },
) {
  const session = await auth();
  if (!session?.user) {
    return new AppError("unauthorized:document").toResponse();
  }

  try {
    const { id: insightId, documentId } = await params;

    if (!insightId || !documentId) {
      return new AppError(
        "bad_request:document",
        "Insight ID and Document ID are required",
      ).toResponse();
    }

    // db is imported from @/lib/db/queries with lazy initialization

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

    // Verify user permission: validate through bot
    const { botExists } = await import("@/lib/db/queries");
    const botRecord = await botExists({
      id: insightResult[0].botId,
      userId: session.user.id,
    });

    if (!botRecord) {
      return new AppError("forbidden:insight", "Access denied").toResponse();
    }

    // Verify association exists and belongs to current user
    const existingAssociation = await db
      .select({ userId: insightDocuments.userId })
      .from(insightDocuments)
      .where(
        and(
          eq(insightDocuments.insightId, insightId),
          eq(insightDocuments.documentId, documentId),
        ),
      )
      .limit(1);

    if (existingAssociation.length === 0) {
      return new AppError(
        "not_found:document",
        "Association not found",
      ).toResponse();
    }

    if (existingAssociation[0].userId !== session.user.id) {
      return new AppError("forbidden:document", "Access denied").toResponse();
    }

    // Get document info for timeline entry before deletion
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

    // Delete association
    await db
      .delete(insightDocuments)
      .where(
        and(
          eq(insightDocuments.insightId, insightId),
          eq(insightDocuments.documentId, documentId),
        ),
      );

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
      ? `Removed file: ${docInfo[0].fileName}${fileInfo ? ` (${fileInfo})` : ""}`
      : "Removed file";

    // Create new timeline event for document removal
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
      { message: "Document association removed successfully" },
      { status: 200 },
    );
  } catch (error) {
    console.error("[Documents API] Failed to remove association:", error);
    return new AppError(
      "bad_request:database",
      `Failed to remove association. ${error instanceof Error ? error.message : String(error)}`,
    ).toResponse();
  }
}
