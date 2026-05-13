"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button, Textarea } from "@openloomi/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@openloomi/ui";
import { toast } from "@/components/toast";
import { useTranslation } from "react-i18next";
import { RemixIcon } from "@/components/remix-icon";

interface InsightNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  insightId: string;
  onSave?: (note: any) => void;
  initialContent?: string;
  editNoteId?: string | null;
}

export function InsightNoteModal({
  isOpen,
  onClose,
  insightId,
  onSave,
  initialContent = "",
  editNoteId = null,
}: InsightNoteModalProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState(initialContent);
  const [isSaving, setIsSaving] = useState(false);

  // Reset content when modal opens or initialContent changes
  useEffect(() => {
    if (isOpen) {
      setContent(initialContent);
    }
  }, [isOpen, initialContent]);

  const handleSave = async () => {
    if (!content.trim()) {
      toast({
        type: "error",
        description: t("insightNote.emptyContent"),
      });
      return;
    }

    setIsSaving(true);
    try {
      const url = editNoteId
        ? `/api/notes/${editNoteId}`
        : `/api/insights/${insightId}/notes`;

      const method = editNoteId ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: content.trim(),
          source: "manual",
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to save note");
      }

      const data = await response.json();
      onSave?.(data.note);

      toast({
        type: "success",
        description: editNoteId
          ? t("insightNote.updated")
          : t("insightNote.created"),
      });

      setContent("");
      onClose();
    } catch (error) {
      console.error("Failed to save note:", error);
      toast({
        type: "error",
        description: t("insightNote.saveFailed"),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = useCallback(() => {
    if (!isSaving) {
      setContent("");
      onClose();
    }
  }, [isSaving, onClose]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSaving) {
        handleClose();
      }
      // Ctrl+Enter / Cmd+Enter to save
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleSave();
      }
    };

    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, isSaving, handleClose]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => !open && !isSaving && handleClose()}
    >
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {editNoteId
              ? t("insightNote.editTitle")
              : t("insightNote.addTitle")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Content Area */}
          <div className="space-y-2">
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t("insightNote.placeholder")}
              className="min-h-[200px] resize-none"
              disabled={isSaving}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              {t("insightNote.hint")}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={handleClose} disabled={isSaving}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleSave} disabled={isSaving || !content.trim()}>
              {isSaving ? (
                <>
                  <RemixIcon
                    name="loader_2"
                    size="size-4"
                    className="mr-2 animate-spin"
                  />
                  {t("common.saving")}
                </>
              ) : (
                <>{t("common.save")}</>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
