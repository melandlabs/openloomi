"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button, Input, Label } from "@openloomi/ui";
import { ScrollArea } from "@openloomi/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@openloomi/ui";
import { useTranslation } from "react-i18next";
import { formatDistanceToNow } from "date-fns";
import { zhCN, enUS } from "date-fns/locale";
import { RemixIcon } from "@/components/remix-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@openloomi/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@openloomi/ui";
import { toast } from "@/components/toast";
import {
  useKnowledgeFiles,
  type KnowledgeFile,
} from "@/hooks/use-knowledge-files";
import { cn } from "@/lib/utils";

// Supported file MIME types
const SUPPORTED_FILE_TYPES = [
  // Document type
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
  // Image type
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

interface InsightDocumentListProps {
  insightId: string;
  onDocumentChange?: () => void;
}

export function InsightDocumentList({
  insightId,
  onDocumentChange,
}: InsightDocumentListProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.includes("zh") ? zhCN : enUS;

  const [documents, setDocuments] = useState<KnowledgeFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isAssociating, setIsAssociating] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<string | null>(null);
  const [isFilePopoverOpen, setIsFilePopoverOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [documentSearchTerm, setDocumentSearchTerm] = useState("");
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  // Use knowledge files hook to get available files
  const {
    files: availableFiles,
    isLoading: isLoadingFiles,
    uploadFile,
  } = useKnowledgeFiles();

  // Fetch associated documents
  const fetchDocuments = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/insights/${insightId}/documents`);
      if (!response.ok) {
        throw new Error("Failed to fetch documents");
      }
      const data = await response.json();

      // Convert API-returned document format to KnowledgeFile format
      const formattedDocs: KnowledgeFile[] = data.documents.map((doc: any) => ({
        id: doc.id,
        fileName: doc.fileName,
        contentType: doc.contentType,
        sizeBytes: Number(doc.sizeBytes),
        totalChunks: doc.totalChunks || 0,
        uploadedAt: new Date(doc.uploadedAt).toISOString(),
      }));

      setDocuments(formattedDocs);
    } catch (error) {
      console.error("Failed to fetch documents:", error);
      toast({
        type: "error",
        description: t(
          "insightDocument.fetchFailed",
          "Failed to load document",
        ),
      });
    } finally {
      setIsLoading(false);
    }
  }, [insightId, t]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  // Associate document to insight
  const handleAssociateDocument = async (documentId: string) => {
    setIsAssociating(true);
    try {
      const response = await fetch(`/api/insights/${insightId}/documents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ documentId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to associate document");
      }

      toast({
        type: "success",
        description: t("insightDocument.associated", "Document associated"),
      });

      setIsFilePopoverOpen(false);
      onDocumentChange?.();
      await fetchDocuments();
    } catch (error) {
      console.error("Failed to associate document:", error);
      toast({
        type: "error",
        description: t(
          "insightDocument.associateFailed",
          "Failed to associate document",
        ),
      });
    } finally {
      setIsAssociating(false);
    }
  };

  // Check if file type is supported (including extension check)
  const isFileTypeSupported = useCallback((file: File): boolean => {
    // First check MIME type
    if (SUPPORTED_FILE_TYPES.includes(file.type)) {
      return true;
    }

    // Check file extension to support markdown files
    // Browser usually identifies .md files as text/plain, needs special handling
    const fileExtension = file.name.toLowerCase().split(".").pop();
    if (fileExtension === "md") {
      return true;
    }

    return false;
  }, []);

  // Upload new file and associate
  const handleUploadAndAssociate = async (file: File) => {
    // Check file type
    if (!isFileTypeSupported(file)) {
      toast({
        type: "error",
        description: t(
          "insightDocument.unsupportedFileType",
          "Unsupported file type. Please upload PDF, Word, Excel, PowerPoint or text files.",
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
          "insightDocument.fileTooLarge",
          "File is too large. Maximum supported size is 100MB.",
        ),
      });
      return false;
    }

    setIsUploading(true);
    try {
      // First upload to knowledge base
      const result = await uploadFile(file);

      if (result.success && result.documentId) {
        // Auto-associate after successful upload
        await handleAssociateDocument(result.documentId);

        toast({
          type: "success",
          description: t(
            "insightDocument.uploadedAndAssociated",
            "File uploaded and associated",
          ),
        });
        return true;
      } else {
        toast({
          type: "error",
          description:
            result.error || t("insightDocument.uploadFailed", "Upload failed"),
        });
        return false;
      }
    } catch (error) {
      console.error("Failed to upload file:", error);
      toast({
        type: "error",
        description: t("insightDocument.uploadFailed", "Upload failed"),
      });
      return false;
    } finally {
      setIsUploading(false);
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // Handle file selection
  const handleFileSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = event.target.files?.[0];
      if (!selectedFile) return;

      handleUploadAndAssociate(selectedFile);
    },
    [handleUploadAndAssociate],
  );

  // Handle drag enter
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

  // Handle drag leave
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDraggingOver(false);
    }
  }, []);

  // Handle drag over
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Handle file drop
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
        await handleUploadAndAssociate(files[i]);
      }
    },
    [handleUploadAndAssociate],
  );

  // Unassociate document
  const handleUnassociateDocument = async (documentId: string) => {
    try {
      const response = await fetch(
        `/api/insights/${insightId}/documents/${documentId}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        throw new Error("Failed to unassociate document");
      }

      toast({
        type: "success",
        description: t("insightDocument.unassociated", "Unassociated"),
      });

      onDocumentChange?.();
      await fetchDocuments();
    } catch (error) {
      console.error("Failed to unassociate document:", error);
      toast({
        type: "error",
        description: t(
          "insightDocument.unassociateFailed",
          "Failed to unassociate",
        ),
      });
    } finally {
      setDeleteDialogOpen(false);
      setDocumentToDelete(null);
    }
  };

  // Get file icon
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
    return "📄";
  }, []);

  // Format file size
  const formatFileSize = useCallback((bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }, []);

  // Filter out unassociated files
  const unassociatedFiles = availableFiles.filter(
    (file) => !documents.some((doc) => doc.id === file.id),
  );

  // Filter by search keyword (for file selection in Popover)
  const filteredFiles = unassociatedFiles.filter((file) =>
    file.fileName.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  // Filter associated documents by search keyword (for main list)
  const filteredDocuments = documents.filter((doc) =>
    doc.fileName.toLowerCase().includes(documentSearchTerm.toLowerCase()),
  );

  return (
    <>
      <div
        className={cn(
          "bg-white rounded-lg p-4 border border-border relative transition-colors",
          isDraggingOver && "ring-2 ring-primary",
        )}
        style={{
          width: "100%",
          boxSizing: "border-box",
        }}
        role="region"
        aria-label={t("insightDocument.title", "File")}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag and drop overlay */}
        {isDraggingOver && (
          <div className="absolute inset-0 bg-primary/10 backdrop-blur-sm flex items-center justify-center z-10 rounded-lg border-2 border-dashed border-primary pointer-events-none">
            <div className="text-center">
              <RemixIcon
                name="upload"
                size="size-12"
                className="text-primary mx-auto mb-3"
              />
              <p className="text-sm font-medium text-primary">
                {t(
                  "insightDocument.dropFilesHere",
                  "Drop files here to upload",
                )}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t(
                  "insightDocument.supportedFormats",
                  "PDF, Word, Excel, PowerPoint, Text",
                )}
              </p>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between gap-1.5 mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {t("insightDocument.title", "File")}
            </h3>
            {documents.length > 0 && (
              <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-semibold bg-gray-200 text-gray-700">
                {documents.length}
              </span>
            )}
          </div>

          {/* Quick action buttons */}
          <div className="flex items-center gap-1">
            {/* Search associated documents */}
            {documents.length > 0 && (
              <div className="relative">
                <RemixIcon
                  name="search"
                  size="size-3"
                  className="absolute left-2 top-1/2 transform -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="text"
                  placeholder={t(
                    "insightDocument.searchFiles",
                    "Search files...",
                  )}
                  value={documentSearchTerm}
                  onChange={(e) => setDocumentSearchTerm(e.target.value)}
                  className="pl-7 h-7 w-32 text-sm"
                />
              </div>
            )}
            {/* Upload new file button */}
            <input
              ref={fileInputRef}
              type="file"
              accept={SUPPORTED_FILE_TYPES.join(",")}
              onChange={handleFileSelect}
              className="hidden"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <RemixIcon
                      name="loader_2"
                      size="size-3"
                      className="animate-spin"
                    />
                  ) : (
                    <RemixIcon name="upload" size="size-3" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("insightDocument.uploadNew", "Upload new file")}</p>
              </TooltipContent>
            </Tooltip>

            {/* Select from knowledge base button */}
            <Popover
              open={isFilePopoverOpen}
              onOpenChange={setIsFilePopoverOpen}
            >
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 px-2">
                  <RemixIcon name="add" size="size-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0" align="end" sideOffset={4}>
                <div className="p-3 border-b border-border">
                  <Label className="text-xs text-muted-foreground">
                    {t(
                      "insightDocument.selectFromLibrary",
                      "Select from knowledge base",
                    )}
                  </Label>
                  <div className="mt-2 relative">
                    <RemixIcon
                      name="search"
                      size="size-3"
                      className="absolute left-2 top-1/2 transform -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                      type="text"
                      placeholder={t(
                        "insightDocument.searchFiles",
                        "Search files...",
                      )}
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-7 h-8 text-sm"
                    />
                  </div>
                </div>
                <ScrollArea className="max-h-[200px]">
                  {isLoadingFiles ? (
                    <div className="flex items-center justify-center py-8">
                      <RemixIcon
                        name="loader_2"
                        size="size-4"
                        className="animate-spin text-muted-foreground"
                      />
                    </div>
                  ) : filteredFiles.length === 0 ? (
                    <div className="py-6 px-3 text-center">
                      <RemixIcon
                        name="file_text"
                        size="size-6"
                        className="mx-auto mb-2 text-muted-foreground/50"
                      />
                      <p className="text-xs text-muted-foreground">
                        {searchTerm
                          ? t(
                              "insightDocument.noMatchingFiles",
                              "No matching files",
                            )
                          : t(
                              "insightDocument.noFilesInLibrary",
                              "No files in knowledge base yet",
                            )}
                      </p>
                    </div>
                  ) : (
                    <div className="py-1">
                      {filteredFiles.map((file) => (
                        <button
                          type="button"
                          key={file.id}
                          onClick={() => handleAssociateDocument(file.id)}
                          disabled={isAssociating}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <span className="text-base shrink-0">
                            {getFileIcon(file.contentType)}
                          </span>
                          <span className="flex-1 truncate">
                            {file.fileName}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {formatFileSize(file.sizeBytes)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Documents list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <RemixIcon
              name="loader_2"
              size="size-5"
              className="animate-spin text-muted-foreground"
            />
          </div>
        ) : documents.length === 0 ? (
          <div className="text-center py-6 px-4 rounded-lg border border-dashed border-border bg-muted/20">
            <RemixIcon
              name="file_text"
              size="size-8"
              className="mx-auto mb-2 text-muted-foreground/50"
            />
            <p className="text-sm text-muted-foreground">
              {t("insightDocument.empty", "No associated files")}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {t(
                "insightDocument.emptyHint",
                "Drop files, upload new files, or select from knowledge base to associate with this event",
              )}
            </p>
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div className="text-center py-6 px-4">
            <p className="text-sm text-muted-foreground">
              {t("insightDocument.noMatchingFiles", "No matching files")}
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[300px]">
            <div className="space-y-2 pr-4">
              {filteredDocuments.map((doc) => (
                <div
                  key={doc.id}
                  className="group relative p-3 rounded-lg border border-border bg-muted/30 hover:bg-muted/50 transition-colors flex items-start gap-3"
                >
                  {/* File icon */}
                  <div className="text-2xl shrink-0">
                    {getFileIcon(doc.contentType)}
                  </div>

                  {/* File info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {doc.fileName}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(doc.sizeBytes)}
                      </p>
                      <span className="text-xs text-muted-foreground">•</span>
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(doc.uploadedAt), {
                          addSuffix: true,
                          locale,
                        })}
                      </p>
                    </div>
                  </div>

                  {/* Delete button */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => {
                          setDocumentToDelete(doc.id);
                          setDeleteDialogOpen(true);
                        }}
                      >
                        <RemixIcon name="close" size="size-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{t("common.unassociate", "Unassociate")}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("insightDocument.unassociateTitle", "Unassociate")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "insightDocument.unassociateConfirm",
                "Are you sure you want to unassociate this file? The file will not be deleted, it just will no longer be displayed in this event.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("common.cancel", "Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (documentToDelete) {
                  handleUnassociateDocument(documentToDelete);
                }
              }}
            >
              {t("common.confirm", "Confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
