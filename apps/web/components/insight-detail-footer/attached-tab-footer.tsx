"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button, Input, Label } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@openloomi/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@openloomi/ui";
import { ScrollArea } from "@openloomi/ui";
import { toast } from "@/components/toast";
import { useKnowledgeFiles } from "@/hooks/use-knowledge-files";
import { useEnterSendWithIme } from "@openloomi/hooks/use-enter-send-ime";

/** Supported file MIME types; consistent with insight-document-list */
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
  "text/csv",
  "application/json",
  // Apple Office suite formats (new versions)
  "application/vnd.apple.pages",
  "application/vnd.apple.numbers",
  "application/vnd.apple.keynote",
  // Apple Office suite formats (legacy macOS)
  "application/x-iwork-pages-sffpages",
  "application/x-iwork-numbers-sffnumbers",
  "application/x-iwork-keynote-sffkeynote",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

const MAX_FILE_SIZE = 100 * 1024 * 1024;

interface AttachedTabFooterProps {
  insightId: string;
  onContentChange?: () => void;
}

/**
 * Footer under the Attachments tab: quick note input on the left + add icon button on the right (dropdown: add note / upload file / add from library)
 */
export function AttachedTabFooter({
  insightId,
  onContentChange,
}: AttachedTabFooterProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [noteValue, setNoteValue] = useState("");
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [isLibraryPopoverOpen, setIsLibraryPopoverOpen] = useState(false);
  const [librarySearchTerm, setLibrarySearchTerm] = useState("");
  const [associatedDocIds, setAssociatedDocIds] = useState<string[]>([]);
  const [isAssociating, setIsAssociating] = useState(false);

  const {
    handleCompositionStart: enterSendCompositionStart,
    handleCompositionEnd: enterSendCompositionEnd,
    getEnterKeyDownHandler: getEnterSendKeyDown,
  } = useEnterSendWithIme();

  const {
    files: availableFiles,
    isLoading: isLoadingFiles,
    uploadFile,
  } = useKnowledgeFiles();

  /** Fetch the list of associated document IDs, used to filter already-associated items in the library */
  const fetchAssociatedIds = useCallback(async () => {
    try {
      const response = await fetch(`/api/insights/${insightId}/documents`);
      if (!response.ok) return;
      const data = await response.json();
      const ids = (data.documents || []).map((d: { id: string }) => d.id);
      setAssociatedDocIds(ids);
    } catch {
      setAssociatedDocIds([]);
    }
  }, [insightId]);

  useEffect(() => {
    if (isLibraryPopoverOpen) fetchAssociatedIds();
  }, [isLibraryPopoverOpen, fetchAssociatedIds]);

  /** Check if file type is supported (including .md extension) */
  const isFileTypeSupported = useCallback((file: File): boolean => {
    if (SUPPORTED_FILE_TYPES.includes(file.type)) return true;
    const ext = file.name.toLowerCase().split(".").pop();
    return ext === "md";
  }, []);

  /** Associate a document with the insight */
  const associateDocument = useCallback(
    async (documentId: string) => {
      const response = await fetch(`/api/insights/${insightId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to associate document");
      }
    },
    [insightId],
  );

  /** Add note (modal): close modal after save and notify refresh */
  const handleNoteSaved = useCallback(() => {
    setIsNoteModalOpen(false);
    onContentChange?.();
  }, [onContentChange]);

  /** Quick add note: submit the input field content */
  const handleSubmitQuickNote = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = noteValue.trim();
    if (!content) return;

    setIsSubmittingNote(true);
    try {
      const response = await fetch(`/api/insights/${insightId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, source: "manual" }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create note");
      }

      toast({
        type: "success",
        description: t("insightNote.created"),
      });
      setNoteValue("");
      onContentChange?.();
    } catch (error) {
      console.error("[AttachedTabFooter] Failed to create note:", error);
      toast({
        type: "error",
        description: t("insightNote.saveFailed"),
      });
    } finally {
      setIsSubmittingNote(false);
    }
  };

  /** Upload and associate after file selection */
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!isFileTypeSupported(file)) {
      toast({
        type: "error",
        description: t(
          "insightDocument.unsupportedFileType",
          "Unsupported file type. Please upload PDF, Word, Excel, PowerPoint, or text files.",
        ),
      });
      e.target.value = "";
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast({
        type: "error",
        description: t(
          "insightDocument.fileTooLarge",
          "File is too large. Maximum supported size is 10MB.",
        ),
      });
      e.target.value = "";
      return;
    }

    try {
      const result = await uploadFile(file);
      if (result.success && result.documentId) {
        await associateDocument(result.documentId);
        toast({
          type: "success",
          description: t(
            "insightDocument.uploadedAndAssociated",
            "File uploaded and associated",
          ),
        });
        onContentChange?.();
      } else {
        toast({
          type: "error",
          description:
            result.error || t("insightDocument.uploadFailed", "Upload failed"),
        });
      }
    } catch (error) {
      console.error("[AttachedTabFooter] Upload/associate failed:", error);
      toast({
        type: "error",
        description: t("insightDocument.uploadFailed", "Upload failed"),
      });
    }
    e.target.value = "";
  };

  /** Associate from library: associate after selection and close Popover */
  const handleSelectFromLibrary = async (documentId: string) => {
    setIsAssociating(true);
    try {
      await associateDocument(documentId);
      toast({
        type: "success",
        description: t("insightDocument.associated", "Document associated"),
      });
      setIsLibraryPopoverOpen(false);
      onContentChange?.();
      await fetchAssociatedIds();
    } catch (error) {
      console.error("[AttachedTabFooter] Associate failed:", error);
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

  /** Dropdown item: Add Note -> open note modal */
  const handleAddNoteClick = () => {
    setIsNoteModalOpen(true);
  };

  /** Dropdown item: Upload file -> trigger the hidden file input */
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  /** Dropdown item: Add from library -> open Popover (controlled by Popover's open state) */
  const handleAddFromLibraryClick = () => {
    setIsLibraryPopoverOpen(true);
  };

  const unassociatedFiles = availableFiles.filter(
    (f) => !associatedDocIds.includes(f.id),
  );
  const filteredLibraryFiles = librarySearchTerm.trim()
    ? unassociatedFiles.filter((f) =>
        f.fileName.toLowerCase().includes(librarySearchTerm.toLowerCase()),
      )
    : unassociatedFiles;

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const getFileIcon = (contentType: string) => {
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
  };

  return (
    <div className="bg-card shrink-0 border-t border-border flex flex-col gap-3 p-4 h-fit">
      <div className="flex items-center gap-2">
        <form
          onSubmit={handleSubmitQuickNote}
          className="flex-1 min-w-0 flex items-center gap-2"
        >
          <Input
            type="text"
            placeholder={t(
              "insightNote.quickNotePlaceholder",
              "Quick add a note...",
            )}
            value={noteValue}
            onChange={(e) => setNoteValue(e.target.value)}
            onCompositionStart={enterSendCompositionStart}
            onCompositionEnd={enterSendCompositionEnd}
            onKeyDown={getEnterSendKeyDown(() =>
              handleSubmitQuickNote({
                preventDefault: () => {},
              } as React.FormEvent),
            )}
            className="h-10 flex-1"
            disabled={isSubmittingNote}
          />
        </form>

        <div className="relative inline-flex shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept={SUPPORTED_FILE_TYPES.join(",")}
            onChange={handleFileSelect}
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0"
                aria-label={t("insightAttached.add", "Add")}
              >
                <RemixIcon name="add" size="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={handleAddNoteClick}>
                <RemixIcon name="file_text" size="size-4" className="mr-2" />
                {t("insightAttached.addNote", "Add note")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleUploadClick}>
                <RemixIcon name="upload_cloud" size="size-4" className="mr-2" />
                {t("insightAttached.uploadFile", "Upload file")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  handleAddFromLibraryClick();
                }}
              >
                <RemixIcon name="file_text" size="size-4" className="mr-2" />
                {t("insightAttached.addFromLibrary", "Add from library")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Add from library: standalone Popover anchored to button area, opened by dropdown item click */}
          <Popover
            open={isLibraryPopoverOpen}
            onOpenChange={(open) => {
              // Only allow closing when selecting a file or explicitly closing
              // Do not auto-close via external interaction to prevent accidental close when moving the window
              if (!open && isLibraryPopoverOpen) {
                // If transitioning from open to closed and not triggered internally, prevent close
                return;
              }
              setIsLibraryPopoverOpen(open);
            }}
          >
            <PopoverTrigger asChild>
              <span
                className="absolute inset-0 opacity-0 cursor-default pointer-events-none"
                aria-hidden
              />
            </PopoverTrigger>
            <PopoverContent
              className="w-80 p-0"
              align="end"
              side="top"
              sideOffset={4}
              onOpenAutoFocus={(e) => e.preventDefault()}
              onInteractOutside={(event) => {
                // Prevent all external interactions from closing; only allow closing via ESC, close button, or clicking a file
                event.preventDefault();
              }}
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <div className="p-3 border-b border-border flex items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground">
                  {t(
                    "insightDocument.selectFromLibrary",
                    "Select from library",
                  )}
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => setIsLibraryPopoverOpen(false)}
                  aria-label="Close"
                >
                  <RemixIcon name="close" size="size-3" />
                </Button>
              </div>
              <div className="p-3 border-b border-border">
                <div className="relative">
                  <RemixIcon
                    name="search"
                    size="size-3"
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    type="text"
                    placeholder={t(
                      "insightDocument.searchFiles",
                      "Search files...",
                    )}
                    value={librarySearchTerm}
                    onChange={(e) => setLibrarySearchTerm(e.target.value)}
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
                ) : filteredLibraryFiles.length === 0 ? (
                  <div className="py-6 px-3 text-center">
                    <RemixIcon
                      name="file_text"
                      size="size-6"
                      className="mx-auto mb-2 text-muted-foreground/50"
                    />
                    <p className="text-xs text-muted-foreground">
                      {librarySearchTerm
                        ? t(
                            "insightDocument.noMatchingFiles",
                            "No matching files",
                          )
                        : t(
                            "insightDocument.noFilesInLibrary",
                            "No files in library",
                          )}
                    </p>
                  </div>
                ) : (
                  <div className="py-1">
                    {filteredLibraryFiles.map((file) => (
                      <button
                        type="button"
                        key={file.id}
                        onClick={() => handleSelectFromLibrary(file.id)}
                        disabled={isAssociating}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <span className="text-base shrink-0">
                          {getFileIcon(file.contentType)}
                        </span>
                        <span className="flex-1 truncate">{file.fileName}</span>
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
    </div>
  );
}
