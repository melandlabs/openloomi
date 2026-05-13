/**
 * FileIngester implementation for apps/web
 *
 * Implements the FileIngester interface from @openloomi/integrations/core
 * using the external-ingest module from apps/web.
 */

import type {
  FileIngester,
  IngestExternalOptions,
  IngestResult,
  IngestedAttachment,
  AttachmentDownloadPayload,
  UserType as CoreUserType,
} from "@openloomi/integrations/core";
import {
  ingestExternalAttachment,
  type ExternalAttachmentIngestOptions,
} from "@/lib/files/external-ingest";
import { recordAttachmentIngestFailure } from "@/lib/files/monitoring";

/**
 * Implementation of FileIngester that uses apps/web's ingestExternalAttachment
 */
export class WebFileIngester implements FileIngester {
  async ingestExternal(options: IngestExternalOptions): Promise<IngestResult> {
    const { userId, downloadAttachment, ...rest } = options;

    const ingestOptions: ExternalAttachmentIngestOptions = {
      source: options.source,
      userId,
      downloadAttachment,
      originalFileName: options.originalFileName ?? null,
      mimeTypeHint: options.mimeTypeHint ?? null,
      sizeHintBytes: options.sizeHintBytes ?? null,
      maxSizeBytes: options.maxSizeBytes,
    };

    try {
      const result = await ingestExternalAttachment(ingestOptions);
      if (!result.success) {
        recordAttachmentIngestFailure({
          source: options.source,
          userId,
          reason: result.reason,
        });
      }
      // Map result to IngestResult - note the types may differ slightly
      return {
        success: result.success,
        reason: result.success ? undefined : result.reason,
        attachment: result.success
          ? {
              name: result.attachment.fileName,
              url: result.attachment.url,
              downloadUrl: result.attachment.downloadUrl,
              contentType: result.attachment.contentType,
              sizeBytes: result.attachment.sizeBytes,
              blobPath: result.attachment.blobPath,
              source: options.source,
            }
          : undefined,
      };
    } catch (error) {
      recordAttachmentIngestFailure({
        source: options.source,
        userId,
        reason: "exception",
      });
      return { success: false, reason: "fetch_failed" };
    }
  }

  async ingestForUser(options: {
    source: string;
    ownerUserId: string;
    ownerUserType?: CoreUserType;
    maxSizeBytes?: number;
    mimeTypeHint?: string | null;
    sizeHintBytes?: number | null;
    originalFileName?: string | null;
    contentId?: string | null;
    downloadAttachment: () => Promise<AttachmentDownloadPayload>;
    logger?: Pick<typeof console, "warn" | "error">;
    logContext?: string;
  }): Promise<IngestedAttachment | null> {
    const {
      source,
      ownerUserId,
      ownerUserType,
      maxSizeBytes,
      mimeTypeHint,
      sizeHintBytes,
      originalFileName,
      downloadAttachment,
      logger = console,
      logContext,
    } = options;

    if (!ownerUserId || !ownerUserType) {
      return null;
    }

    try {
      const ingestResult = await ingestExternalAttachment({
        source,
        userId: ownerUserId,
        maxSizeBytes,
        mimeTypeHint: mimeTypeHint ?? null,
        sizeHintBytes: sizeHintBytes ?? null,
        originalFileName: originalFileName ?? null,
        downloadAttachment,
      });

      if (!ingestResult.success) {
        recordAttachmentIngestFailure({
          source,
          userId: ownerUserId,
          reason: ingestResult.reason,
        });
        logger.warn(
          `[Attachment Collector]${logContext ? ` ${logContext}` : ""} skipped attachment due to ${ingestResult.reason}`,
        );
        return null;
      }

      const { attachment } = ingestResult;
      return {
        name: attachment.fileName,
        url: attachment.url,
        downloadUrl: attachment.downloadUrl,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes,
        blobPath: attachment.blobPath,
        source,
        cid: options.contentId
          ? options.contentId.toLowerCase().trim()
          : undefined,
      };
    } catch (error) {
      recordAttachmentIngestFailure({
        source,
        userId: ownerUserId,
        reason: "exception",
      });
      logger.error(
        `[Attachment Collector]${logContext ? ` ${logContext}` : ""} failed to ingest attachment`,
        error,
      );
      return null;
    }
  }

  async ingestMany(options: {
    source: string;
    ownerUserId: string;
    ownerUserType?: CoreUserType;
    maxSizeBytes?: number;
    attachments: Array<{
      mimeTypeHint?: string | null;
      sizeHintBytes?: number | null;
      originalFileName?: string | null;
      contentId?: string | null;
      downloadAttachment: () => Promise<AttachmentDownloadPayload>;
    }>;
    logger?: Pick<typeof console, "warn" | "error">;
    logContext?: string;
  }): Promise<IngestedAttachment[]> {
    const {
      source,
      ownerUserId,
      ownerUserType,
      maxSizeBytes,
      attachments,
      logger,
      logContext,
    } = options;
    const collected: IngestedAttachment[] = [];

    for (const attachment of attachments) {
      const ingested = await this.ingestForUser({
        source,
        ownerUserId,
        ownerUserType,
        maxSizeBytes,
        mimeTypeHint: attachment.mimeTypeHint,
        sizeHintBytes: attachment.sizeHintBytes,
        originalFileName: attachment.originalFileName,
        contentId: attachment.contentId,
        downloadAttachment: attachment.downloadAttachment,
        logger,
        logContext,
      });
      if (ingested) {
        collected.push(ingested);
      }
    }

    return collected;
  }
}

/**
 * Singleton instance of WebFileIngester
 */
export const fileIngester = new WebFileIngester();
