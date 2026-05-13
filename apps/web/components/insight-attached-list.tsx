"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { ScrollArea } from "@openloomi/ui";
import { Button, Input } from "@openloomi/ui";
import { useTranslation } from "react-i18next";
import { RemixIcon } from "@/components/remix-icon";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@openloomi/ui";
import { toast } from "@/components/toast";
import { MarkdownWithCitations } from "@/components/markdown-with-citations";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Spinner } from "@/components/spinner";
import { htmlToPlainText } from "@/components/insight-detail-footer";
import type { KnowledgeFile } from "@/hooks/use-knowledge-files";
import { cn } from "@/lib/utils";

/** Note item (consistent with API) */
interface InsightNote {
  id: string;
  content: string;
  source: "manual" | "ai_conversation";
  sourceMessageId?: string;
  createdAt: Date | number | string;
  updatedAt: Date | number | string;
}

/** Merged timeline item: note or file */
type AttachedItem =
  | { type: "note"; data: InsightNote }
  | { type: "file"; data: KnowledgeFile };

interface InsightAttachedListProps {
  insightId: string;
  onContentChange?: () => void;
  /** External refresh trigger (e.g., parent increments after footer addition, triggers refetch) */
  refreshKey?: number;
  /** Only show notes, not files */
  showNotesOnly?: boolean;
}

/**
 * Get unified time for sorting (notes use createdAt, files use uploadedAt)
 */
function getItemTime(item: AttachedItem): number {
  if (item.type === "note") {
    const t = item.data.createdAt;
    return typeof t === "string" ? new Date(t).getTime() : (t as number);
  }
  return new Date(item.data.uploadedAt).getTime();
}

/**
 * Insight attached list: mixed display of notes and files, sorted by time descending
 */
export function InsightAttachedList({
  insightId,
  onContentChange,
  refreshKey = 0,
  showNotesOnly = false,
}: InsightAttachedListProps) {
  const { t } = useTranslation();

  const [notes, setNotes] = useState<InsightNote[]>([]);
  const [documents, setDocuments] = useState<KnowledgeFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [searchTerm, setSearchTerm] = useState("");
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [editNote, setEditNote] = useState<InsightNote | null>(null);
  const [deleteNoteDialogOpen, setDeleteNoteDialogOpen] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null);
  const [unassociateDocDialogOpen, setUnassociateDocDialogOpen] =
    useState(false);
  const [documentToUnassociate, setDocumentToUnassociate] = useState<
    string | null
  >(null);
  const [addNoteContent, setAddNoteContent] = useState<string>("");
  const [isAddingNote, setIsAddingNote] = useState(false);

  const fetchNotes = useCallback(async () => {
    const response = await fetch(`/api/insights/${insightId}/notes`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.message || `Failed to fetch notes (${response.status})`,
      );
    }
    const data = await response.json();
    setNotes(data.notes || []);
  }, [insightId]);

  const fetchDocuments = useCallback(async () => {
    const response = await fetch(`/api/insights/${insightId}/documents`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.message || `Failed to fetch documents (${response.status})`,
      );
    }
    const data = await response.json();
    const formatted: KnowledgeFile[] = (data.documents || []).map(
      (doc: any) => ({
        id: doc.id,
        fileName: doc.fileName,
        contentType: doc.contentType,
        sizeBytes: Number(doc.sizeBytes),
        totalChunks: doc.totalChunks || 0,
        uploadedAt: new Date(doc.uploadedAt).toISOString(),
      }),
    );
    setDocuments(formatted);
  }, [insightId]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    Promise.all([fetchNotes(), fetchDocuments()])
      .catch((err) => {
        if (!cancelled) {
          console.error("Failed to fetch attached:", err);
          const errorMessage =
            err instanceof Error ? err.message : t("insightNote.fetchFailed");
          toast({ type: "error", description: errorMessage });
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [insightId, refreshKey, fetchNotes, fetchDocuments, t]);

  const mergedAndSorted = useMemo(() => {
    const items: AttachedItem[] = [
      ...notes.map((n) => ({ type: "note" as const, data: n })),
      ...(showNotesOnly
        ? []
        : documents.map((d) => ({ type: "file" as const, data: d }))),
    ];
    items.sort((a, b) => getItemTime(b) - getItemTime(a));
    return items;
  }, [notes, documents, showNotesOnly]);

  const filteredItems = useMemo(() => {
    if (!searchTerm.trim()) return mergedAndSorted;
    const lower = searchTerm.toLowerCase();
    return mergedAndSorted.filter((item) => {
      if (item.type === "note")
        return item.data.content.toLowerCase().includes(lower);
      return item.data.fileName.toLowerCase().includes(lower);
    });
  }, [mergedAndSorted, searchTerm]);

  const formatDate = useCallback((date: Date | number | string) => {
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    } as Intl.DateTimeFormatOptions);
  }, []);

  const handleNoteSaved = useCallback(
    (newNote: InsightNote) => {
      if (editNote) {
        setNotes((prev) =>
          prev.map((n) => (n.id === newNote.id ? newNote : n)),
        );
      } else {
        setNotes((prev) => [newNote, ...prev]);
      }
      setEditNote(null);
      onContentChange?.();
    },
    [editNote, onContentChange],
  );

  /**
   * Submit note content from top rich text input.
   * Trigger: Press `Ctrl/Cmd + Enter` when input is focused.
   */
  const handleSubmitAddNote = useCallback(async () => {
    if (isAddingNote) return;
    const content = htmlToPlainText(addNoteContent);
    if (!content.trim()) return;

    setIsAddingNote(true);
    try {
      const response = await fetch(`/api/insights/${insightId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!response.ok) throw new Error("Failed to add note");

      const data = await response.json();
      const newNote: InsightNote = {
        id: data.note.id,
        content: data.note.content,
        source: "manual",
        createdAt: data.note.createdAt,
        updatedAt: data.note.updatedAt,
      };

      setNotes((prev) => [newNote, ...prev]);
      setAddNoteContent("");
      onContentChange?.();
      toast({ type: "success", description: t("insightNote.addSuccess") });
    } catch (err) {
      console.error("Failed to add note:", err);
      toast({ type: "error", description: t("insightNote.addFailed") });
    } finally {
      setIsAddingNote(false);
    }
  }, [
    addNoteContent,
    htmlToPlainText,
    insightId,
    isAddingNote,
    onContentChange,
    t,
  ]);

  /**
   * Listen for top input keyboard submit shortcut.
   * Note: Only submit on `Ctrl/Cmd + Enter`, avoid regular Enter being interpreted as newline by tiptap.
   */
  const handleTopEditorKeyDownCapture = useCallback(
    (e: any) => {
      if ((e?.ctrlKey || e?.metaKey) && e?.key === "Enter") {
        e.preventDefault?.();
        e.stopPropagation?.();
        void handleSubmitAddNote();
      }
    },
    [handleSubmitAddNote],
  );

  /**
   * Availability of top editor “Save” button:
   * Has content and not currently submitting.
   */
  const canSaveAddNote = useMemo(() => {
    if (isAddingNote) return false;
    return htmlToPlainText(addNoteContent).trim().length > 0;
  }, [addNoteContent, htmlToPlainText, isAddingNote]);

  const handleDeleteNote = useCallback((noteId: string) => {
    setNoteToDelete(noteId);
    setDeleteNoteDialogOpen(true);
  }, []);

  const confirmDeleteNote = useCallback(async () => {
    if (!noteToDelete) return;
    try {
      const response = await fetch(`/api/notes/${noteToDelete}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete note");
      setNotes((prev) => prev.filter((n) => n.id !== noteToDelete));
      onContentChange?.();
      toast({ type: "success", description: t("insightNote.deleted") });
    } catch (err) {
      console.error("Delete note failed:", err);
      toast({ type: "error", description: t("insightNote.deleteFailed") });
    } finally {
      setDeleteNoteDialogOpen(false);
      setNoteToDelete(null);
    }
  }, [noteToDelete, onContentChange, t]);

  const handleUnassociateDocument = useCallback(
    async (documentId: string) => {
      try {
        const response = await fetch(
          `/api/insights/${insightId}/documents/${documentId}`,
          { method: "DELETE" },
        );
        if (!response.ok) throw new Error("Failed to unassociate");
        setDocuments((prev) => prev.filter((d) => d.id !== documentId));
        onContentChange?.();
        toast({
          type: "success",
          description: t("insightDocument.unassociated", "Disassociated"),
        });
      } catch (err) {
        console.error("Unassociate failed:", err);
        toast({
          type: "error",
          description: t(
            "insightDocument.unassociateFailed",
            "Failed to disassociate",
          ),
        });
      } finally {
        setUnassociateDocDialogOpen(false);
        setDocumentToUnassociate(null);
      }
    },
    [insightId, onContentChange, t],
  );

  /** Get RemixIcon name by file type - consistent with insight-files-view */
  const getFileIcon = useCallback((contentType: string) => {
    if (contentType.includes("pdf")) return "file_pdf";
    if (contentType.includes("word") || contentType.includes("document"))
      return "file_word";
    if (
      contentType.includes("presentation") ||
      contentType.includes("powerpoint")
    )
      return "presentation";
    if (contentType.includes("sheet") || contentType.includes("excel"))
      return "file_excel";
    if (contentType.includes("text") || contentType.includes("markdown"))
      return "file_text";
    if (contentType.includes("image")) return "file_image";
    return "file";
  }, []);

  /** Get color class name by file name - consistent with Library */
  const getFileColorClass = useCallback((contentType: string) => {
    if (contentType.includes("pdf")) return "text-red-500";
    if (contentType.includes("word") || contentType.includes("document"))
      return "text-blue-500";
    if (
      contentType.includes("presentation") ||
      contentType.includes("powerpoint")
    )
      return "text-orange-500";
    if (contentType.includes("sheet") || contentType.includes("excel"))
      return "text-green-500";
    if (contentType.includes("text") || contentType.includes("markdown"))
      return "text-gray-500";
    if (contentType.includes("image")) return "text-purple-500";
    return "text-blue-500";
  }, []);

  const formatFileSize = useCallback((bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size={20} />
      </div>
    );
  }

  const showViewToggle = !showNotesOnly && mergedAndSorted.length > 0;
  const effectiveViewMode = showNotesOnly ? "list" : viewMode;

  return (
    <>
      {/* Search + view toggle + add note - consistent with Library My Notes */}
      <div
        className={cn(
          "shrink-0 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-0 pt-0 pb-4",
          showViewToggle || showNotesOnly
            ? "sm:justify-between"
            : "sm:justify-end",
        )}
      >
        {/* Only show title in “notes mode” */}
        {showNotesOnly && (
          <div className="text-[16px] font-[600] leading-none">
            {t("insightAttached.notesTitle", "Notes")}
          </div>
        )}
        {showViewToggle && (
          <div className="flex rounded-md border border-border/60 overflow-hidden shrink-0">
            <Button
              variant={effectiveViewMode === "list" ? "secondary" : "ghost"}
              size="sm"
              className="h-9 rounded-none"
              onClick={() => setViewMode("list")}
              aria-label={t("workspace.viewList", "List")}
            >
              <RemixIcon name="list" size="size-4" />
            </Button>
            <Button
              variant={effectiveViewMode === "grid" ? "secondary" : "ghost"}
              size="sm"
              className="h-9 rounded-none"
              onClick={() => setViewMode("grid")}
              aria-label={t("workspace.viewGrid", "Grid")}
            >
              <RemixIcon name="layout_grid" size="size-4" />
            </Button>
          </div>
        )}
        <div
          className={cn(
            "flex items-center gap-2 shrink-0 min-w-0",
            !showViewToggle && "ml-auto",
          )}
        >
          <div className="relative w-full min-w-[120px] sm:w-48">
            <RemixIcon
              name="search"
              size="size-4"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <Input
              type="text"
              placeholder={t(
                showNotesOnly
                  ? "insightAttached.searchNotesPlaceholder"
                  : "insightAttached.searchPlaceholder",
                showNotesOnly ? "Search notes..." : "Search notes or files...",
              )}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 h-9 text-sm bg-muted/50 border border-border/60 rounded-md"
            />
          </div>
        </div>
      </div>

      {/* Rich text input displayed at top: add new note */}
      <div className="px-0 pt-0 pb-4">
        <div onKeyDownCapture={handleTopEditorKeyDownCapture}>
          <RichTextEditor
            content={addNoteContent}
            onChange={setAddNoteContent}
            placeholder={t(
              "workspace.addNotePlaceholder",
              "Enter note content...",
            )}
            disabled={isAddingNote}
            className="min-h-[160px]"
            toolbarRight={null}
            sendButton={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => void handleSubmitAddNote()}
                disabled={!canSaveAddNote}
                aria-label={t("common.save", "Save")}
              >
                <RemixIcon name="save" size="size-4" />
              </Button>
            }
          />
        </div>
      </div>

      {mergedAndSorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground text-sm">
          <RemixIcon
            name="file_text"
            size="size-10"
            className="mb-2 opacity-50"
          />
          <p>
            {showNotesOnly
              ? t("insightAttached.emptyNotes", "No notes yet")
              : t("insightAttached.empty", "No notes or files")}
          </p>
          <p className="text-xs mt-1">
            {showNotesOnly
              ? t(
                  "insightAttached.emptyNotesHint",
                  "Add notes directly in the input above",
                )
              : t(
                  "insightAttached.emptyHint",
                  "Add notes in the input above; use the bottom button to upload files",
                )}
          </p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground text-sm">
          <p>
            {t(
              showNotesOnly
                ? "insightAttached.noMatchingNotes"
                : "insightAttached.noMatch",
              showNotesOnly
                ? "No matching notes"
                : "No matching notes or files",
            )}
          </p>
        </div>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          <ul
            className={cn(
              effectiveViewMode === "grid"
                ? "grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 min-w-0 px-6 py-3"
                : "flex flex-col gap-4 px-0 pt-0 pb-0 min-w-0",
            )}
          >
            {filteredItems.map((item) =>
              item.type === "note" ? (
                effectiveViewMode === "grid" ? (
                  <li key={`note-${item.data.id}`} className="w-full min-w-0">
                    <div className="w-full min-w-0 flex flex-col items-stretch gap-1.5 p-3 rounded-lg border border-border/60 bg-card text-left overflow-hidden">
                      <div className="shrink-0 rounded-md flex items-center justify-center size-10 text-amber-500">
                        <RemixIcon name="file_text" size="size-6" />
                      </div>
                      <div className="prose prose-sm max-w-none dark:prose-invert line-clamp-3">
                        <MarkdownWithCitations insights={[]}>
                          {item.data.content}
                        </MarkdownWithCitations>
                      </div>
                      <p className="text-xs text-muted-foreground shrink-0">
                        {formatDate(item.data.createdAt)}
                      </p>
                      <div className="flex items-center gap-2 w-full flex-wrap shrink-0">
                        <div className="shrink-0 flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => {
                              setEditNote(item.data);
                              setIsNoteModalOpen(true);
                            }}
                            aria-label={t("common.edit")}
                          >
                            <RemixIcon name="edit" size="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDeleteNote(item.data.id)}
                            aria-label={t("common.delete")}
                          >
                            <RemixIcon name="delete_bin" size="size-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </li>
                ) : (
                  <li key={`note-${item.data.id}`} className="w-full min-w-0">
                    <div className="w-full min-w-0 flex flex-col gap-1 px-2 sm:px-4 py-4 rounded-lg border border-border/60 bg-card text-left overflow-visible">
                      <div className="min-w-0 flex flex-col text-left space-y-1.5">
                        {/* Title row: time + right-side action buttons */}
                        <div className="flex w-full items-center justify-between gap-0">
                          <div className="text-[16px] font-[600] font-serif leading-none">
                            {formatDate(item.data.createdAt)}
                          </div>
                          <div className="shrink-0 flex items-center gap-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              onClick={() => {
                                setEditNote(item.data);
                                setIsNoteModalOpen(true);
                              }}
                              aria-label={t("common.edit")}
                            >
                              <RemixIcon name="edit" size="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => handleDeleteNote(item.data.id)}
                              aria-label={t("common.delete")}
                            >
                              <RemixIcon name="delete_bin" size="size-4" />
                            </Button>
                          </div>
                        </div>

                        {/* Body: remove truncation, display full content */}
                        <div className="prose prose-sm max-w-none dark:prose-invert">
                          <MarkdownWithCitations insights={[]}>
                            {item.data.content}
                          </MarkdownWithCitations>
                        </div>
                      </div>
                    </div>
                  </li>
                )
              ) : effectiveViewMode === "grid" ? (
                <li key={`file-${item.data.id}`} className="w-full min-w-0">
                  <div className="w-full min-w-0 flex flex-col items-stretch gap-1.5 p-3 rounded-lg border border-border/60 bg-card text-left overflow-hidden">
                    <div
                      className={cn(
                        "shrink-0 rounded-md flex items-center justify-center size-10",
                        getFileColorClass(item.data.contentType),
                      )}
                    >
                      <RemixIcon
                        name={getFileIcon(item.data.contentType)}
                        size="size-6"
                      />
                    </div>
                    <p className="text-sm font-medium truncate min-w-0 overflow-hidden">
                      {item.data.fileName}
                    </p>
                    <p className="text-xs text-muted-foreground shrink-0">
                      {formatFileSize(item.data.sizeBytes)}
                    </p>
                    <div className="flex items-center gap-2 w-full flex-wrap shrink-0">
                      <div className="shrink-0 flex items-center gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              onClick={() => {
                                setDocumentToUnassociate(item.data.id);
                                setUnassociateDocDialogOpen(true);
                              }}
                            >
                              <RemixIcon name="close" size="size-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{t("common.unassociate", "Disassociate")}</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                </li>
              ) : (
                <li key={`file-${item.data.id}`} className="w-full min-w-0">
                  <div className="w-full min-w-0 flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-2 rounded-lg border border-border/60 bg-card text-left overflow-hidden">
                    <div
                      className={cn(
                        "shrink-0 rounded-md flex items-center justify-center size-9",
                        getFileColorClass(item.data.contentType),
                      )}
                    >
                      <RemixIcon
                        name={getFileIcon(item.data.contentType)}
                        size="size-5"
                      />
                    </div>
                    <div className="min-w-0 flex-1 text-left overflow-hidden space-y-0.5">
                      <p className="text-sm font-medium truncate">
                        {item.data.fileName}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatFileSize(item.data.sizeBytes)}</span>
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => {
                              setDocumentToUnassociate(item.data.id);
                              setUnassociateDocDialogOpen(true);
                            }}
                          >
                            <RemixIcon name="close" size="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{t("common.unassociate", "Disassociate")}</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </li>
              ),
            )}
          </ul>
        </ScrollArea>
      )}

      <AlertDialog
        open={deleteNoteDialogOpen}
        onOpenChange={setDeleteNoteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("insightNote.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("insightNote.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteNote}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={unassociateDocDialogOpen}
        onOpenChange={setUnassociateDocDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("insightDocument.unassociateTitle", "Disassociate")}
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
                if (documentToUnassociate) {
                  handleUnassociateDocument(documentToUnassociate);
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
