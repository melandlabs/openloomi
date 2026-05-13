"use client";

import { useState, useEffect, useMemo } from "react";
import { Button, Input } from "@openloomi/ui";
import { ScrollArea } from "@openloomi/ui";
import { useTranslation } from "react-i18next";
import { formatDistanceToNow } from "date-fns";
import { zhCN, enUS } from "date-fns/locale";
import { RemixIcon } from "@/components/remix-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@openloomi/ui";
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
import { InsightNoteModal } from "./insight-note-modal";
import { MarkdownWithCitations } from "@/components/markdown-with-citations";

interface InsightNote {
  id: string;
  content: string;
  source: "manual" | "ai_conversation";
  sourceMessageId?: string;
  createdAt: Date | number | string;
  updatedAt: Date | number | string;
}

interface InsightNoteListProps {
  insightId: string;
  onNoteChange?: () => void;
  /** Whether to trigger event refresh after note change */
  triggerInsightRefresh?: () => void | Promise<void>;
}

export function InsightNoteList({
  insightId,
  onNoteChange,
  triggerInsightRefresh,
}: InsightNoteListProps) {
  const { t, i18n } = useTranslation();
  const [notes, setNotes] = useState<InsightNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editNote, setEditNote] = useState<InsightNote | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null);

  // Fetch notes when insightId changes
  useEffect(() => {
    fetchNotes();
  }, [insightId]);

  const fetchNotes = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/insights/${insightId}/notes`);
      if (!response.ok) {
        throw new Error("Failed to fetch notes");
      }
      const data = await response.json();
      setNotes(data.notes || []);
    } catch (error) {
      console.error("Failed to fetch notes:", error);
      toast({
        type: "error",
        description: t("insightNote.fetchFailed"),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddNote = () => {
    setEditNote(null);
    setIsModalOpen(true);
  };

  const handleEditNote = (note: InsightNote) => {
    setEditNote(note);
    setIsModalOpen(true);
  };

  const handleDeleteNote = (noteId: string) => {
    setNoteToDelete(noteId);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!noteToDelete) return;

    try {
      const response = await fetch(`/api/notes/${noteToDelete}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete note");
      }

      setNotes((prev) => prev.filter((n) => n.id !== noteToDelete));
      onNoteChange?.();

      toast({
        type: "success",
        description: t("insightNote.deleted"),
      });
    } catch (error) {
      console.error("Failed to delete note:", error);
      toast({
        type: "error",
        description: t("insightNote.deleteFailed"),
      });
    } finally {
      setDeleteDialogOpen(false);
      setNoteToDelete(null);
    }
  };

  const handleNoteSaved = (newNote: InsightNote) => {
    if (editNote) {
      // Update existing note
      setNotes((prev) => prev.map((n) => (n.id === newNote.id ? newNote : n)));
    } else {
      // Add new note
      setNotes((prev) => [newNote, ...prev]);
    }
    onNoteChange?.();
    // Trigger insight refresh
    if (triggerInsightRefresh) {
      triggerInsightRefresh();
    }
    setEditNote(null);
  };

  const formatDate = (date: Date | number | string) => {
    const parsedDate = typeof date === "string" ? new Date(date) : date;
    const locale = i18n.language.includes("zh") ? zhCN : enUS;
    return formatDistanceToNow(parsedDate, {
      addSuffix: true,
      locale,
    });
  };

  // Filter notes by search keyword
  const filteredNotes = useMemo(() => {
    if (!searchTerm.trim()) {
      return notes;
    }
    const lowerSearchTerm = searchTerm.toLowerCase();
    return notes.filter((note) =>
      note.content.toLowerCase().includes(lowerSearchTerm),
    );
  }, [notes, searchTerm]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <RemixIcon
          name="loader_2"
          size="size-5"
          className="animate-spin text-muted-foreground"
        />
      </div>
    );
  }

  return (
    <>
      <div
        className="bg-white rounded-lg p-4 border border-border"
        style={{
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        {/* Header with add button and search */}
        <div className="flex items-center justify-between gap-1.5 mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {t("insightNote.title")}
            </h3>
            {notes.length > 0 && (
              <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-semibold bg-gray-200 text-gray-700">
                {notes.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Search input */}
            {notes.length > 0 && (
              <div className="relative">
                <RemixIcon
                  name="search"
                  size="size-3"
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="text"
                  placeholder={t("insightNote.searchNotes", "Search notes...")}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-7 h-7 w-32 text-sm"
                />
              </div>
            )}
            {/* Add button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2"
                  onClick={handleAddNote}
                  aria-label={t("insightNote.add")}
                >
                  <RemixIcon name="add" size="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("insightNote.add")}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Notes list - always shown */}
        {notes.length === 0 ? (
          <div className="text-center py-6 px-4 rounded-lg border border-dashed border-border bg-muted/20">
            <RemixIcon
              name="message"
              size="size-8"
              className="mx-auto mb-2 text-muted-foreground/50"
            />
            <p className="text-sm text-muted-foreground">
              {t("insightNote.empty")}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {t("insightNote.emptyHint")}
            </p>
          </div>
        ) : filteredNotes.length === 0 ? (
          <div className="text-center py-6 px-4">
            <p className="text-sm text-muted-foreground">
              {t("insightNote.noMatchingNotes", "No matching notes")}
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[300px]">
            <div className="space-y-3 pr-4">
              {filteredNotes.map((note) => (
                <div
                  key={note.id}
                  className="group relative p-3 rounded-lg border border-border bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  {/* Note content */}
                  <div className="pr-16">
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                      <MarkdownWithCitations insights={[]}>
                        {note.content}
                      </MarkdownWithCitations>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {formatDate(note.createdAt)}
                    </p>
                  </div>

                  {/* Action buttons */}
                  <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <RemixIcon name="more_vertical" size="size-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEditNote(note)}>
                          <RemixIcon
                            name="edit"
                            size="size-3"
                            className="mr-2"
                          />
                          {t("common.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleDeleteNote(note.id)}
                          className="text-destructive focus:text-destructive"
                        >
                          <RemixIcon
                            name="delete_bin"
                            size="size-3"
                            className="mr-2"
                          />
                          {t("common.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Add/Edit Note Modal */}
      <InsightNoteModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        insightId={insightId}
        initialContent={editNote?.content || ""}
        editNoteId={editNote?.id || null}
        onSave={handleNoteSaved}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("insightNote.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("insightNote.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
