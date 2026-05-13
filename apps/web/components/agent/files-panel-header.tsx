"use client";

import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { cn } from "@/lib/utils";
import { AgentSectionHeader } from "./section-header";
import { toast } from "@/components/toast";
import "../../i18n";

/**
 * Supported file MIME types
 */
const SUPPORTED_FILE_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/plain",
  "text/markdown",
  "text/html",
  "text/csv",
  "application/json",
];

interface FilesPanelHeaderProps {
  /**
   * Whether loading
   */
  isLoading: boolean;
  /**
   * Whether uploading
   */
  isUploading: boolean;
  /**
   * Upload progress info
   */
  uploadProgress?: {
    fileName: string;
    progress: number;
  };
  /**
   * Refresh file list callback
   */
  onRefresh: () => Promise<void>;
  /**
   * Upload file callback
   */
  onUpload: (file: File) => Promise<{ success: boolean; error?: string }>;
  /**
   * Right-side action buttons like close button (passed from layout.tsx)
   */
  children?: React.ReactNode;
}

/**
 * File panel Header component
 * Contains refresh and upload buttons, placed on the left side of the close button
 */
export function FilesPanelHeader({
  isLoading,
  isUploading,
  uploadProgress,
  onRefresh,
  onUpload,
  children,
}: FilesPanelHeaderProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Handle refresh button click
   */
  const handleRefresh = useCallback(async () => {
    await onRefresh();
    toast({
      type: "success",
      description: t(
        "agent.panels.files.refreshSuccess",
        "File list refreshed",
      ),
    });
  }, [onRefresh, t]);

  /**
   * Handle upload button click
   */
  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  /**
   * Handle file selection
   */
  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = event.target.files?.[0];
      if (!selectedFile) return;

      // Check file type
      if (!SUPPORTED_FILE_TYPES.includes(selectedFile.type)) {
        toast({
          type: "error",
          description: t(
            "agent.panels.files.unsupportedFileType",
            "Unsupported file type. Please upload PDF, Word, Excel, PowerPoint, JSON, or text files.",
          ),
        });
        return;
      }

      // Check file size (100MB)
      const MAX_SIZE = 100 * 1024 * 1024;
      if (selectedFile.size > MAX_SIZE) {
        toast({
          type: "error",
          description: t(
            "agent.panels.files.fileTooLarge",
            "File too large. Maximum size is 10MB.",
          ),
        });
        return;
      }

      // Upload file
      const result = await onUpload(selectedFile);

      if (result.success) {
        toast({
          type: "success",
          description: t(
            "agent.panels.files.uploadSuccess",
            "File uploaded successfully",
          ),
        });
      } else {
        toast({
          type: "error",
          description:
            result.error ||
            t("agent.panels.files.uploadFailed", "Upload failed"),
        });
      }

      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [t, onUpload],
  );

  return (
    <AgentSectionHeader title={t("agent.panels.files.title", "Files")}>
      <div className="flex items-center gap-2">
        {/* Refresh button */}
        <Button
          variant="outline"
          size="icon"
          onClick={handleRefresh}
          disabled={isLoading}
          className="h-8 w-8 shrink-0"
          aria-label={t("agent.panels.files.refresh", "Refresh")}
        >
          <RemixIcon
            name="refresh"
            size="size-4"
            className={cn(isLoading && "animate-spin")}
          />
        </Button>

        {/* Upload button */}
        <Button
          variant="outline"
          size="icon"
          onClick={handleUploadClick}
          disabled={isUploading}
          className="h-8 w-8 shrink-0"
          aria-label={t("agent.panels.files.upload", "Upload")}
        >
          {isUploading ? (
            <RemixIcon name="loader_2" size="size-4" className="animate-spin" />
          ) : (
            <RemixIcon name="upload" size="size-4" />
          )}
        </Button>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept={SUPPORTED_FILE_TYPES.join(",")}
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Right-side action buttons like close button (passed from layout.tsx) */}
        {children}
      </div>
    </AgentSectionHeader>
  );
}
