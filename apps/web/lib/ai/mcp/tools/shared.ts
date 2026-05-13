/**
 * Shared types and functions for MCP business tools
 */

import { coerceDate } from "@openloomi/shared";
import { formatToLocalTime } from "@/lib/utils";
import type { Insight } from "@/lib/db/schema";
import type { TimelineData } from "@/lib/ai/subagents/insights";
import { getDb } from "@/lib/db/adapters";
import {
  insight,
  ragDocuments,
  ragChunks,
  insightDocuments,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * Task type for createInsight tool
 */
export type TaskInput =
  | { text: string; completed?: boolean; deadline?: string; owner?: string }
  | string
  | undefined;

/**
 * Normalize task input to standard object format
 */
export function normalizeTask(task: TaskInput): {
  text: string;
  completed: boolean;
  deadline?: string;
  owner?: string;
} {
  if (!task) {
    return { text: "", completed: false };
  }

  if (typeof task === "string") {
    try {
      const parsed = JSON.parse(task);
      if (typeof parsed === "object" && parsed !== null) {
        if (typeof parsed.text === "string") {
          return { ...parsed, completed: parsed.completed ?? false };
        }
        return { text: task, completed: false };
      }
    } catch {
      // If not valid JSON, use string as text
    }
    return { text: task, completed: false };
  }

  if (task.text && typeof task.text === "string") {
    const trimmedText = task.text.trim();

    // Check for nested JSON object
    if (trimmedText.startsWith('"') && trimmedText.endsWith('"')) {
      try {
        const withoutOuterQuotes = trimmedText.slice(1, -1);
        const parsed = JSON.parse(withoutOuterQuotes.replace(/'/g, '"'));
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          typeof parsed.text === "string"
        ) {
          return {
            ...parsed,
            completed: task.completed ?? parsed.completed ?? false,
          };
        }
      } catch {
        // Parse failed
      }
    }

    // Check for JSON object
    if (trimmedText.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmedText.replace(/'/g, '"'));
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          typeof parsed.text === "string"
        ) {
          return {
            ...parsed,
            completed: task.completed ?? parsed.completed ?? false,
          };
        }
      } catch {
        // Parse failed
      }
    }
  }

  return { ...task, completed: task.completed ?? false };
}

/**
 * Normalize importance value
 */
export function normalizeImportance(importance: string | undefined): string {
  if (!importance) return "Important";
  const lower = importance.toLowerCase();
  if (lower === "general" || lower === "normal" || lower === "medium") {
    return "General";
  }
  if (lower === "not important" || lower === "low") {
    return "Not Important";
  }
  return "Important";
}

/**
 * Normalize urgency value
 */
export function normalizeUrgency(urgency: string | undefined): string {
  if (!urgency) return "Not Urgent";
  const lower = urgency.toLowerCase();
  if (
    lower === "asap" ||
    lower === "as soon as possible" ||
    lower === "urgent"
  ) {
    return "ASAP";
  }
  if (lower === "within 24 hours" || lower.includes("24hr")) {
    return "Within 24 hours";
  }
  return "Not urgent";
}

/**
 * Associate documents with an insight
 * Creates entries in the insight_documents junction table and adds timeline entries
 */
export async function associateDocumentsToInsight(
  insightId: string,
  documentIds: string[],
  userId: string,
): Promise<{ success: boolean; associated: string[]; failed: string[] }> {
  const db = getDb();
  const associated: string[] = [];
  const failed: string[] = [];

  for (const documentId of documentIds) {
    try {
      // Verify document exists and belongs to user
      const documentResult = await db
        .select({ userId: ragDocuments.userId })
        .from(ragDocuments)
        .where(eq(ragDocuments.id, documentId))
        .limit(1);

      if (documentResult.length === 0) {
        console.warn(`[associateDocuments] Document ${documentId} not found`);
        failed.push(documentId);
        continue;
      }

      if (documentResult[0].userId !== userId) {
        console.warn(
          `[associateDocuments] Document ${documentId} access denied`,
        );
        failed.push(documentId);
        continue;
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
        console.log(
          `[associateDocuments] Document ${documentId} already associated`,
        );
        associated.push(documentId);
        continue;
      }

      // Create association
      const result = await db
        .insert(insightDocuments)
        .values({
          insightId,
          documentId,
          userId,
        })
        .returning({ id: insightDocuments.id });

      if (result[0]?.id) {
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

        // Update insight's timeline
        await db
          .update(insight)
          .set({
            timeline: JSON.stringify([...currentTimeline, newTimelineEvent]),
          })
          .where(eq(insight.id, insightId));

        associated.push(documentId);
        console.log(
          `[associateDocuments] Document ${documentId} associated successfully`,
        );
      }
    } catch (error) {
      console.error(
        `[associateDocuments] Failed to associate document ${documentId}:`,
        error,
      );
      failed.push(documentId);
    }
  }

  return { success: failed.length === 0, associated, failed };
}

/**
 * Remove document associations from an insight
 */
export async function removeDocumentAssociations(
  insightId: string,
  documentIds: string[],
  userId: string,
): Promise<{ success: boolean; removed: string[]; failed: string[] }> {
  const db = getDb();
  const removed: string[] = [];
  const failed: string[] = [];

  for (const documentId of documentIds) {
    try {
      // Verify association exists and belongs to user
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
        console.warn(
          `[removeDocumentAssociations] Association not found for ${documentId}`,
        );
        failed.push(documentId);
        continue;
      }

      if (existingAssociation[0].userId !== userId) {
        console.warn(
          `[removeDocumentAssociations] Access denied for ${documentId}`,
        );
        failed.push(documentId);
        continue;
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

      // Delete association
      await db
        .delete(insightDocuments)
        .where(
          and(
            eq(insightDocuments.insightId, insightId),
            eq(insightDocuments.documentId, documentId),
          ),
        );

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
        ? `Removed file: ${docInfo[0].fileName}${fileInfo ? ` (${fileInfo})` : ""}`
        : "Removed file";

      // Create new timeline event for document removal
      const newTimelineEvent: TimelineData = {
        time: Date.now(),
        summary,
        label: "File",
      };

      // Update insight's timeline
      await db
        .update(insight)
        .set({
          timeline: JSON.stringify([...currentTimeline, newTimelineEvent]),
        })
        .where(eq(insight.id, insightId));

      removed.push(documentId);
      console.log(
        `[removeDocumentAssociations] Document ${documentId} removed successfully`,
      );
    } catch (error) {
      console.error(
        `[removeDocumentAssociations] Failed to remove document ${documentId}:`,
        error,
      );
      failed.push(documentId);
    }
  }

  return { success: failed.length === 0, removed, failed };
}

/**
 * Insight filter kinds
 */
export const INSIGHT_FILTER_KINDS = [
  "importance",
  "urgency",
  "platform",
  "task_label",
  "account",
  "category",
  "participants",
  "people",
  "groups",
  "keyword",
  "time_window",
  "has_tasks",
] as const;

/**
 * Get insight time
 */
export function insightTime(insight: Insight) {
  if (insight.details && insight.details.length > 0) {
    const time = insight.details[insight.details.length - 1].time;
    if (time) {
      return coerceDate(time);
    }
  }
  return new Date(insight.time);
}

/**
 * Format insight for response
 */
export function formatInsight(item: Insight, withDetail: boolean) {
  const processedDetails = item.details?.map((detail) => ({
    ...detail,
    time: detail.time ? coerceDate(detail.time) : detail.time,
  }));

  const baseInsight = {
    ...item,
    time: formatToLocalTime(insightTime(item)),
    details: processedDetails,
  };

  // Remove null/undefined values recursively
  const cleanedInsight = removeNullValues(baseInsight);

  if (!withDetail && "details" in cleanedInsight) {
    const { details, ...insightWithoutDetail } = cleanedInsight;
    return insightWithoutDetail;
  }
  return cleanedInsight;
}

/**
 * Recursively remove null and undefined values from an object
 */
function removeNullValues<T extends Record<string, any>>(obj: T): T {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === "object" && item !== null
          ? removeNullValues(item)
          : item,
      );
    } else if (typeof value === "object") {
      result[key] = removeNullValues(value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

/**
 * Callback type for insight changes
 */
export type InsightChangeCallback = (data: {
  action: "create" | "update" | "delete";
  insightId?: string;
  insight?: Record<string, unknown>;
}) => void;
