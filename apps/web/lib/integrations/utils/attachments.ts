import type { UserType } from "@/app/(auth)/auth";
import {
  type AttachmentDownloadPayload,
  ingestExternalAttachment,
} from "@/lib/files/external-ingest";
import type { Attachment } from "@openloomi/shared";
import { recordAttachmentIngestFailure } from "@/lib/files/monitoring";

type Logger = Pick<typeof console, "warn" | "error">;

export type AttachmentIngestParams = {
  source: string;
  ownerUserId?: string;
  ownerUserType?: UserType;
  maxSizeBytes?: number;
  mimeTypeHint?: string | null;
  sizeHintBytes?: number | null;
  originalFileName?: string | null;
  contentId?: string | null;
  downloadAttachment: () => Promise<AttachmentDownloadPayload>;
  logger?: Logger;
  logContext?: string;
};

function normalizeContentId(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed
    .replace(/^<?\s*/u, "")
    .replace(/\s*>?$/u, "")
    .replace(/^cid:/i, "")
    .trim()
    .toLowerCase();
}

export async function ingestAttachmentForUser(
  params: AttachmentIngestParams,
): Promise<Attachment | null> {
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
  } = params;

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
      cid: normalizeContentId(params.contentId) ?? undefined,
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

export async function ingestManyAttachments(
  params: AttachmentIngestParams[],
): Promise<Attachment[]> {
  const collected: Attachment[] = [];

  for (const param of params) {
    const attachment = await ingestAttachmentForUser(param);
    if (attachment) {
      collected.push(attachment);
    }
  }

  return collected;
}
