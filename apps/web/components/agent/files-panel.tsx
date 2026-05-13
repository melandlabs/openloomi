"use client";

import { toast } from "@/components/toast";
import { Button, Input, Label } from "@openloomi/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@openloomi/ui";
import { useIsMobile } from "@openloomi/hooks/use-is-mobile";
import {
  type KnowledgeFileDetail,
  useKnowledgeFiles,
} from "@/hooks/use-knowledge-files";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { enGB } from "date-fns/locale";
import { RemixIcon } from "@/components/remix-icon";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFilesPanelContext } from "./files-panel-context";
import "../../i18n";

/**
 * Detect if running in Tauri environment
 */
const isTauriEnv = typeof window !== "undefined" && "__TAURI__" in window;

/**
 * Dynamically import Tauri event API
 */
async function importTauriEvent() {
  if (!isTauriEnv) return null;
  try {
    return await import("@tauri-apps/api/event");
  } catch {
    return null;
  }
}

/**
 * Supported file MIME types
 */
const SUPPORTED_FILE_TYPES = [
  // Document types
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  // Apple office suite format (new version)
  "application/vnd.apple.pages",
  "application/vnd.apple.numbers",
  "application/vnd.apple.keynote",
  // Apple office suite format (old macOS)
  "application/x-iwork-pages-sffpages",
  "application/x-iwork-numbers-sffnumbers",
  "application/x-iwork-keynote-sffkeynote",
  // Image types
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

/**
 * File panel component
 * Connects to knowledge base, supports file create/delete/query
 */
export function FilesPanel() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  // Prefer Context, fall back to standalone hook if not available (backward compatibility)
  let filesContext: ReturnType<typeof useKnowledgeFiles>;
  try {
    filesContext = useFilesPanelContext();
  } catch {
    // If no Context, use standalone hook
    filesContext = useKnowledgeFiles();
  }

  const {
    files,
    isLoading,
    error,
    isUploading,
    uploadProgress,
    fetchFiles,
    uploadFile,
    fetchFileDetail,
    deleteFile,
    clearError,
  } = filesContext;

  const [searchTerm, setSearchTerm] = useState("");
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [viewingFile, setViewingFile] = useState<KnowledgeFileDetail | null>(
    null,
  );
  const [isViewDetailLoading, setIsViewDetailLoading] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  // Delete confirmation dialog state
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<{
    id: string;
    fileName: string;
  } | null>(null);

  /**
   * Filter files by search keyword
   */
  const filteredFiles = useMemo(() => {
    if (!searchTerm.trim()) {
      return files;
    }
    const lowerSearchTerm = searchTerm.toLowerCase();
    return files.filter((file) =>
      file.fileName.toLowerCase().includes(lowerSearchTerm),
    );
  }, [files, searchTerm]);

  /**
   * Format file size
   */
  const formatFileSize = useCallback((bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }, []);

  /**
   * Get file icon
   */
  const getFileIcon = useCallback((contentType: string) => {
    if (contentType.includes("pdf")) return "📄";
    if (contentType.includes("word") || contentType.includes("document"))
      return "📝";
    if (
      contentType.includes("presentation") ||
      contentType.includes("powerpoint")
    )
      return "📊";
    if (contentType.includes("sheet") || contentType.includes("excel"))
      return "📈";
    if (contentType.includes("text") || contentType.includes("markdown"))
      return "📃";
    // Image types
    if (contentType.startsWith("image/")) return "🖼️";
    return "📄";
  }, []);

  /**
   * Handle upload button click (for empty state upload button)
   */
  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  /**
   * Check if file type is supported (including extension check)
   */
  const isFileTypeSupported = useCallback((file: File): boolean => {
    // First check MIME type
    if (SUPPORTED_FILE_TYPES.includes(file.type)) {
      return true;
    }

    // Check file extension to support markdown files
    // Browsers usually identify .md files as text/plain, need special handling
    const fileExtension = file.name.toLowerCase().split(".").pop();
    if (fileExtension === "md") {
      return true;
    }

    return false;
  }, []);

  /**
   * Handle file upload (generic)
   */
  const handleFileUpload = useCallback(
    async (file: File) => {
      // Check file type
      if (!isFileTypeSupported(file)) {
        toast({
          type: "error",
          description: t(
            "agent.panels.files.unsupportedFileType",
            "Unsupported file type. Please upload PDF, Word, Excel, PowerPoint, or text files.",
          ),
        });
        return false;
      }

      // Check file size (100MB)
      const MAX_SIZE = 100 * 1024 * 1024;
      if (file.size > MAX_SIZE) {
        toast({
          type: "error",
          description: t(
            "agent.panels.files.fileTooLarge",
            "File too large. Maximum size is 10MB.",
          ),
        });
        return false;
      }

      // Upload file
      const result = await uploadFile(file);

      if (result.success) {
        toast({
          type: "success",
          description: t(
            "agent.panels.files.uploadSuccess",
            "File uploaded successfully",
          ),
        });
        return true;
      }
      toast({
        type: "error",
        description:
          result.error || t("agent.panels.files.uploadFailed", "Upload failed"),
      });
      return false;
    },
    [t, uploadFile, isFileTypeSupported],
  );

  /**
   * Handle file selection (for empty state upload)
   */
  const handleFileSelectForEmpty = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = event.target.files?.[0];
      if (!selectedFile) return;

      await handleFileUpload(selectedFile);

      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [handleFileUpload],
  );

  /**
   * Handle drag enter
   */
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (
      e.dataTransfer.types.includes("Files") &&
      dragCounterRef.current === 1
    ) {
      setIsDraggingOver(true);
    }
  }, []);

  /**
   * Handle drag leave
   */
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDraggingOver(false);
    }
  }, []);

  /**
   * Handle drag over
   */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  /**
   * Handle file drop
   */
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDraggingOver(false);

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      // Support multi-file upload
      for (let i = 0; i < files.length; i++) {
        await handleFileUpload(files[i]);
      }
    },
    [handleFileUpload],
  );

  /**
   * Handle Tauri file drop event
   * In Tauri environment, file drag uses native events to pass file paths
   */
  const handleTauriFileDrop = useCallback(
    async (paths: string[]) => {
      dragCounterRef.current = 0;
      setIsDraggingOver(false);

      if (paths.length === 0) return;

      try {
        // Dynamically import Tauri file system API
        const { readFileBinary } = await import("@/lib/tauri");

        // Support multi-file upload
        for (const filePath of paths) {
          // Read file contents
          const contents = await readFileBinary(filePath);
          const fileName = filePath.split(/[/\\]/).pop() || "file";

          // Detect based on MIME type
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
          };

          if (ext && ext in mimeTypes) {
            mimeType = mimeTypes[ext];
          }

          if (!contents) {
            console.error(`[FilesPanel] Failed to read file: ${filePath}`);
            return null;
          }

          // Create proper ArrayBuffer from Uint8Array for File constructor
          const arrayBuffer = new ArrayBuffer(contents.byteLength);
          new Uint8Array(arrayBuffer).set(contents);
          const file = new File([arrayBuffer], fileName, { type: mimeType });
          await handleFileUpload(file);
          return null; // Already handled via handleFileUpload
        }
      } catch (error) {
        console.error("Failed to handle Tauri file drop:", error);
        toast({
          type: "error",
          description: "Failed to load dropped files",
        });
      }
    },
    [handleFileUpload, t],
  );

  /**
   * Handle delete file
   */
  const handleDeleteClick = useCallback((fileId: string, fileName: string) => {
    setFileToDelete({ id: fileId, fileName });
    setIsDeleteDialogOpen(true);
  }, []);

  /**
   * Confirm delete file
   */
  const handleConfirmDelete = useCallback(async () => {
    if (!fileToDelete) return;

    const { id, fileName } = fileToDelete;
    const success = await deleteFile(id);

    if (success) {
      toast({
        type: "success",
        description: t(
          "agent.panels.files.deleteSuccess",
          'File "{fileName}" deleted',
          { fileName },
        ),
      });
    } else {
      toast({
        type: "error",
        description: t(
          "agent.panels.files.deleteFailed",
          "Failed to delete file",
        ),
      });
    }

    // Close dialog and clear state
    setIsDeleteDialogOpen(false);
    setFileToDelete(null);
  }, [fileToDelete, deleteFile, t]);

  /**
   * Cancel delete
   */
  const handleCancelDelete = useCallback(() => {
    setIsDeleteDialogOpen(false);
    setFileToDelete(null);
  }, []);

  /**
   * Handle view file
   */
  const handleView = useCallback(
    async (fileId: string) => {
      setIsViewDetailLoading(true);
      setIsViewDialogOpen(true);
      setViewingFile(null);

      const detail = await fetchFileDetail(fileId);

      setIsViewDetailLoading(false);

      if (detail) {
        setViewingFile(detail);
      } else {
        toast({
          type: "error",
          description: t(
            "agent.panels.files.fetchDetailFailed",
            "Failed to fetch file details",
          ),
        });
        setIsViewDialogOpen(false);
      }
    },
    [fetchFileDetail, t],
  );

  /**
   * Close view dialog
   */
  const handleCloseViewDialog = useCallback(() => {
    setIsViewDialogOpen(false);
    setViewingFile(null);
  }, []);

  /**
   * Listen for file drag events in Tauri environment
   */
  useEffect(() => {
    if (!isTauriEnv) {
      return;
    }

    let unlistenFileDrop: (() => void) | null = null;
    let unlistenFileDropHover: (() => void) | null = null;
    let unlistenFileDropCancelled: (() => void) | null = null;

    const setupTauriListeners = async () => {
      try {
        const eventModule = await importTauriEvent();
        if (!eventModule) return;

        // Listen for file drop event
        unlistenFileDrop = await eventModule.listen<string[]>(
          "tauri://file-drop",
          (event) => {
            handleTauriFileDrop(event.payload);
          },
        );

        // Listen for file hover event
        unlistenFileDropHover = await eventModule.listen<string[]>(
          "tauri://file-drop-hover",
          (event) => {
            if (event.payload.length > 0) {
              setIsDraggingOver(true);
            }
          },
        );

        // Listen for file drag cancel event
        unlistenFileDropCancelled = await eventModule.listen(
          "tauri://file-drop-cancelled",
          () => {
            setIsDraggingOver(false);
            dragCounterRef.current = 0;
          },
        );
      } catch (error) {
        console.error("Failed to setup Tauri file drop listeners:", error);
      }
    };

    setupTauriListeners();

    return () => {
      unlistenFileDrop?.();
      unlistenFileDropHover?.();
      unlistenFileDropCancelled?.();
    };
  }, [handleTauriFileDrop]);

  return (
    <div
      className={cn(
        "flex h-full flex-col bg-card/90 backdrop-blur-md overflow-hidden relative",
        isDraggingOver && "ring-2 ring-primary",
      )}
      role="region"
      aria-label={t("agent.panels.files.fileDropArea", "File drop area")}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag hint overlay */}
      {isDraggingOver && (
        <div className="absolute inset-0 bg-primary/10 backdrop-blur-sm flex items-center justify-center z-10 rounded-lg border-2 border-dashed border-primary pointer-events-none">
          <div className="text-center">
            <RemixIcon
              name="upload"
              size="size-16"
              className="text-primary mx-auto mb-4"
            />
            <p className="text-lg font-medium text-primary">
              {t(
                "agent.panels.files.dropFilesHere",
                "Drop files here to upload",
              )}
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              {t(
                "agent.panels.files.supportedFormats",
                "PDF, Word, Excel, PowerPoint, Text, Markdown",
              )}
            </p>
          </div>
        </div>
      )}

      {/* Toolbar - only search box kept */}
      <div className="px-4 py-4 flex items-center gap-3">
        {/* Search */}
        <div className="flex-1 relative">
          <RemixIcon
            name="search"
            size="size-4"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="text"
            placeholder={t(
              "agent.panels.files.searchPlaceholder",
              "Search files",
            )}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
            disabled={isLoading}
          />
        </div>

        {/* Hidden File Input - for upload in empty state */}
        <input
          ref={fileInputRef}
          type="file"
          accept={SUPPORTED_FILE_TYPES.join(",")}
          onChange={handleFileSelectForEmpty}
          className="hidden"
        />
      </div>

      {/* Error Display */}
      {error && (
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <RemixIcon
              name="error_warning"
              size="size-4"
              className="text-destructive shrink-0"
            />
            <p className="text-sm text-destructive flex-1">{error}</p>
            <Button
              variant="ghost"
              size="icon"
              onClick={clearError}
              className="shrink-0 h-6 w-6"
            >
              <RemixIcon name="close" size="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Content */}
      <div
        className={cn(
          "flex-1 min-h-0 w-full overflow-y-auto no-scrollbar px-4",
          // Desktop uses fixed spacing
          !isMobile && "pb-4 pt-0",
          // Mobile adds bottom spacing
          isMobile && "pb-[150px] pt-0",
        )}
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <RemixIcon
              name="loader_2"
              size="size-8"
              className="animate-spin text-muted-foreground"
            />
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <RemixIcon
              name="file_text"
              size="size-12"
              className="text-muted-foreground mb-4"
            />
            <p className="text-muted-foreground">
              {searchTerm
                ? t("agent.panels.files.noResults", "No files found")
                : t("agent.panels.files.empty", "No files uploaded yet")}
            </p>
            {!searchTerm && (
              <Button
                onClick={handleUploadClick}
                disabled={isUploading}
                variant="outline"
                className="mt-4"
              >
                <RemixIcon name="upload" size="size-4" className="mr-2" />
                {t("agent.panels.files.uploadFirst", "Upload your first file")}
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredFiles.map((file) => (
              <div
                key={file.id}
                className="flex items-center gap-4 py-3 px-4 border border-border rounded-lg hover:bg-accent/50 transition-colors"
              >
                {/* File Info */}
                <div className="flex-1 min-w-0">
                  <h3
                    className="font-medium text-foreground truncate cursor-pointer hover:text-primary transition-colors flex items-center gap-2"
                    onClick={() => handleView(file.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleView(file.id);
                      }
                    }}
                    aria-label={t(
                      "agent.panels.files.view",
                      "View file details",
                    )}
                  >
                    {/* File Icon - shrink and place on left side of file name */}
                    <span className="text-base shrink-0">
                      {getFileIcon(file.contentType)}
                    </span>
                    <span className="truncate">{file.fileName}</span>
                  </h3>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span>{formatFileSize(file.sizeBytes)}</span>
                    <span>•</span>
                    <span>
                      {format(new Date(file.uploadedAt), "dd/MM/yyyy", {
                        locale: enGB,
                      })}
                    </span>
                  </div>
                </div>

                {/* Actions - only delete button kept */}
                <div className="flex items-center gap-0 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDeleteClick(file.id, file.fileName)}
                    aria-label={t("agent.panels.files.delete", "Delete")}
                  >
                    <RemixIcon
                      name="delete_bin"
                      size="size-4"
                      className="text-destructive"
                    />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* View Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={handleCloseViewDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {viewingFile?.fileName ||
                t("agent.panels.files.view", "View File")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "agent.panels.files.viewDescription",
                "Document content and details",
              )}
            </DialogDescription>
          </DialogHeader>

          {isViewDetailLoading ? (
            <div className="flex items-center justify-center py-12">
              <RemixIcon
                name="loader_2"
                size="size-8"
                className="animate-spin text-muted-foreground"
              />
            </div>
          ) : viewingFile ? (
            <div className="flex-1 overflow-y-auto space-y-4">
              {/* File Metadata */}
              <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
                <div>
                  <Label className="text-xs text-muted-foreground">
                    {t("agent.panels.files.fileName", "File Name")}
                  </Label>
                  <p className="text-sm font-medium">{viewingFile.fileName}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">
                    {t("agent.panels.files.fileSize", "File Size")}
                  </Label>
                  <p className="text-sm font-medium">
                    {formatFileSize(viewingFile.sizeBytes)}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">
                    {t("agent.panels.files.fileType", "File Type")}
                  </Label>
                  <p className="text-sm font-medium">
                    {viewingFile.contentType}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">
                    {t("agent.panels.files.chunks", "Chunks")}
                  </Label>
                  <p className="text-sm font-medium">
                    {viewingFile.totalChunks}
                  </p>
                </div>
                <div className="col-span-2">
                  <Label className="text-xs text-muted-foreground">
                    {t("agent.panels.files.uploadedAt", "Uploaded At")}
                  </Label>
                  <p className="text-sm font-medium">
                    {format(new Date(viewingFile.uploadedAt), "PPpp", {
                      locale: enGB,
                    })}
                  </p>
                </div>
              </div>

              {/* Document Content */}
              <div>
                <Label className="text-sm font-medium mb-2 block">
                  {t("agent.panels.files.documentContent", "Document Content")}
                </Label>
                <div className="space-y-3">
                  {viewingFile.chunks.map((chunk) => (
                    <div
                      key={chunk.id}
                      className="p-3 bg-muted/30 rounded-lg border border-border"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-muted-foreground">
                          {t("agent.panels.files.chunk", "Chunk")}{" "}
                          {chunk.chunkIndex + 1}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">
                        {chunk.content}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-muted-foreground">
              {t("agent.panels.files.noContent", "No content available")}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={handleCancelDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("agent.panels.files.deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("agent.panels.files.deleteConfirmFull", {
                fileName: fileToDelete?.fileName || "",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="outline" onClick={handleCancelDelete}>
              {t("agent.panels.files.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              {t("agent.panels.files.delete", "Delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
