"use client";

import type React from "react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { Attachment } from "@openloomi/shared";
import {
  SUPPORTED_ATTACHMENT_MIME_TYPES,
  SUPPORTED_FILE_EXTENSIONS,
} from "@/lib/files/config";
import { isLikelyZipFile } from "@/lib/files/apple-preview";
import { uploadFile } from "@/lib/files/upload";

const isTauriEnv = typeof window !== "undefined" && "__TAURI__" in window;

async function readDroppedTauriFiles(paths: string[]) {
  const { readFileBinary } = await import("@/lib/tauri");

  const filePromises = paths.map(async (filePath) => {
    const contents = await readFileBinary(filePath);
    if (!contents) {
      console.error(`[TaskComposer] Failed to read file: ${filePath}`);
      return null;
    }

    const fileName = filePath.split(/[/\\]/).pop() || "file";
    const ext = fileName.split(".").pop()?.toLowerCase();
    let mimeType = "application/octet-stream";

    const mimeTypes: Record<string, string> = {
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ppt: "application/vnd.ms-powerpoint",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      txt: "text/plain",
      md: "text/markdown",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      mp3: "audio/mpeg",
      m4a: "audio/mp4",
      wav: "audio/wav",
      webm: "audio/webm",
    };

    if (ext && ext in mimeTypes) {
      mimeType = mimeTypes[ext];
    }

    const safeBytes = new Uint8Array(contents.byteLength);
    safeBytes.set(contents);
    return new File([safeBytes.buffer], fileName, { type: mimeType });
  });

  return (await Promise.all(filePromises)).filter(
    (file): file is File => file !== null,
  );
}

// Extended attachment type with upload state
interface UploadingAttachment extends Attachment {
  isUploading?: boolean;
  file?: File;
}

function isPendingAttachmentForUpload(
  attachment: UploadingAttachment,
  tempId: string,
  index: number,
): boolean {
  if (!attachment.blobPath?.startsWith(`pending:${tempId}:`)) {
    return false;
  }

  return Number.parseInt(attachment.blobPath.split(":")[2], 10) === index;
}

type UseAttachmentUploadOptions = {
  setAttachments: React.Dispatch<React.SetStateAction<UploadingAttachment[]>>;
  onUploadComplete?: () => void;
};

export function useAttachmentUpload({
  setAttachments,
  onUploadComplete,
}: UseAttachmentUploadOptions) {
  const { t } = useTranslation();
  const [isUploadingFile, setIsUploadingFile] = useState(false);

  const handleFileUpload = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files || files.length === 0) return;

      const fileArray = Array.from(files);

      const isSupported = async (file: File): Promise<boolean> => {
        if (
          file.type &&
          SUPPORTED_ATTACHMENT_MIME_TYPES.includes(
            file.type as (typeof SUPPORTED_ATTACHMENT_MIME_TYPES)[number],
          )
        ) {
          return true;
        }

        const lower = file.name.toLowerCase();
        if (!SUPPORTED_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
          return false;
        }
        if (lower.endsWith(".key")) {
          return await isLikelyZipFile(file);
        }
        return true;
      };

      const supportFlags = await Promise.all(fileArray.map(isSupported));
      const unsupported = fileArray.filter((_, index) => !supportFlags[index]);
      const supported = fileArray.filter((_, index) => supportFlags[index]);

      if (unsupported.length > 0) {
        toast.error(
          t("chat.unsupportedFileTypes", "Unsupported file types: {{files}}", {
            files: unsupported.map((file) => file.name).join(", "),
          }),
        );
      }

      if (supported.length === 0) return;

      const valid = supported.filter((file) => {
        const maxSize = file.type.startsWith("image/")
          ? 5 * 1024 * 1024
          : 100 * 1024 * 1024;
        if (file.size > maxSize) {
          toast.error(
            t(
              "chat.fileTooLarge",
              "File too large: {{file}}. Max size is {{max}}MB",
              {
                file: file.name,
                max: maxSize / (1024 * 1024),
              },
            ),
          );
          return false;
        }
        return true;
      });

      if (valid.length === 0) return;

      setIsUploadingFile(true);

      // Create a unique temp ID to track this attachment during upload
      const tempId = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Immediately add attachments in "uploading" state so UI shows them right away
      const initialAttachments: UploadingAttachment[] = valid.map(
        (file, idx) => ({
          name: file.name,
          url: "", // Will be set when upload completes
          contentType: file.type,
          sizeBytes: file.size,
          isUploading: true,
          file,
          // Placeholder - will be replaced when upload completes
          blobPath: `pending:${tempId}:${idx}`,
        }),
      );

      setAttachments((prev) => [...prev, ...initialAttachments]);

      // Track how many uploads are still in progress
      let pendingCount = valid.length;

      const finishUpload = () => {
        pendingCount--;
        if (pendingCount === 0) {
          setIsUploadingFile(false);
          onUploadComplete?.();
        }
      };

      // Upload files in background (not blocking)
      valid.forEach(async (file, idx) => {
        try {
          const result = await uploadFile(file, { createRecord: false });

          // Keep local URLs for UI only; images are converted to base64 when sent.
          // Update the attachment with upload results and mark as complete
          setAttachments((prev) =>
            prev.map((att) => {
              // Find by matching blobPath prefix (the placeholder we set)
              if (isPendingAttachmentForUpload(att, tempId, idx)) {
                return {
                  ...att,
                  name: result.name,
                  url: result.url,
                  downloadUrl: result.downloadUrl,
                  blobPath: result.blobPath,
                  isUploading: false,
                };
              }
              return att;
            }),
          );
        } catch (error) {
          console.error(`[TaskComposer] Failed to upload ${file.name}:`, error);
          toast.error(
            error instanceof Error
              ? error.message
              : t("chat.fileUploadFailed", "File upload failed"),
          );
          // Remove failed attachment
          setAttachments((prev) =>
            prev.filter(
              (att) => !isPendingAttachmentForUpload(att, tempId, idx),
            ),
          );
        } finally {
          finishUpload();
        }
      });
    },
    [onUploadComplete, setAttachments, t],
  );

  const handleTauriFileDrop = useCallback(
    async (paths: string[]) => {
      if (!isTauriEnv || paths.length === 0) return;

      try {
        const files = await readDroppedTauriFiles(paths);
        await handleFileUpload(files);
      } catch (error) {
        console.error("[TaskComposer] Failed to load dropped files:", error);
        toast.error(t("chat.fileUploadFailed", "File upload failed"));
      }
    },
    [handleFileUpload, t],
  );

  return {
    isUploadingFile,
    handleFileUpload,
    handleTauriFileDrop,
  };
}
