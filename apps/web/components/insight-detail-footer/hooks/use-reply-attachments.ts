"use client";

import { useState, useCallback, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { Attachment } from "@openloomi/shared";

/**
 * Attachment management related Hook
 * Handles file upload, attachment list management, etc.
 */
export function useReplyAttachments() {
  const { t } = useTranslation();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadQueue, setUploadQueue] = useState<string[]>([]);

  /**
   * Upload file
   */
  const uploadFile = useCallback(
    async (file: File): Promise<Attachment> => {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/files/upload", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message =
          typeof payload?.error === "string"
            ? payload.error
            : t(
                "common.uploadFailed",
                "Failed to upload file, please try again.",
              );
        throw new Error(message);
      }

      return {
        url: payload.url,
        name: payload.sanitizedName ?? payload.name ?? file.name,
        contentType: payload.contentType ?? file.type,
        sizeBytes: payload.size ?? file.size,
        blobPath: payload.blobPath ?? payload.pathname,
      };
    },
    [t],
  );

  /**
   * Handle file selection
   */
  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      if (files.length === 0) return;
      await processFiles(files);
    },
    [t, uploadFile],
  );

  /**
   * Handle file list (for drag & drop and paste)
   */
  const processFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setUploadQueue(files.map((file) => file.name));

      try {
        const results = await Promise.allSettled(
          files.map((file) => uploadFile(file)),
        );
        const accepted = results
          .filter(
            (result): result is PromiseFulfilledResult<Attachment> =>
              result.status === "fulfilled",
          )
          .map((result) => result.value);
        if (accepted.length > 0) {
          setAttachments((prev) => {
            const merged = new Map(prev.map((item) => [item.url, item]));
            for (const attachment of accepted) {
              merged.set(attachment.url, attachment);
            }
            return Array.from(merged.values());
          });
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t(
                "common.uploadFailed",
                "Failed to upload file, please try again.",
              );
        toast.error(message);
      } finally {
        setUploadQueue([]);
      }
    },
    [t, uploadFile],
  );

  /**
   * Remove attachment
   */
  const handleRemoveAttachment = useCallback((url: string) => {
    setAttachments((prev) =>
      prev.filter((attachment) => attachment.url !== url),
    );
  }, []);

  /**
   * Clear all attachments
   */
  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  return {
    attachments,
    uploadQueue,
    handleFileChange,
    processFiles,
    handleRemoveAttachment,
    clearAttachments,
  };
}
