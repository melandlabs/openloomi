"use client";

import { useState, useEffect } from "react";
import { RemixIcon } from "@/components/remix-icon";
import { Button } from "./ui/button";
import { inlineResources } from "@/lib/files/inline-resources";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { WebsitePreview } from "./website-preview";
import { toast } from "sonner";

interface HtmlToolPreviewProps {
  toolOutput?: any;
  generatedFile?: {
    name: string;
    path?: string;
    content?: string;
    type?: string;
  };
}

export function HtmlToolPreview({
  toolOutput,
  generatedFile,
}: HtmlToolPreviewProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [htmlContent, setHtmlContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

  // Extract filename and path
  const filename = generatedFile?.name || "index.html";
  const filePath = generatedFile?.path || toolOutput?.path || "";

  // Check if this is an HTML file
  const isHtmlFile =
    filename.endsWith(".html") ||
    filename.endsWith(".htm") ||
    generatedFile?.type === "html" ||
    generatedFile?.type === "website" ||
    toolOutput?.type === "text/html";

  // Load HTML content when dialog opens
  useEffect(() => {
    const loadContent = async () => {
      if (!isOpen) return;

      let content = "";
      let fileDir = "";
      let taskId = "";

      // If content is already provided, use it
      if (generatedFile?.content || toolOutput?.content) {
        content = generatedFile?.content || toolOutput?.content;
      } else if (filePath) {
        // Otherwise, load from file API
        setIsLoading(true);
        try {
          // Extract taskId from file path (format: /.openloomi/sessions/{taskId}/...)
          const pathParts = filePath.split("/sessions/");
          if (pathParts.length >= 2) {
            const taskIdAndPath = pathParts[1]; // {taskId}/index.html
            const parts = taskIdAndPath.split("/");
            taskId = parts[0];
            const relativePath = parts.slice(1).join("/");

            // Fetch from API
            const response = await fetch(
              `/api/workspace/file/${taskId}/${relativePath}`,
            );
            if (response.ok) {
              const data = await response.json();
              content = data.content || "";
            }
          }
        } catch (error) {
          console.error("[HtmlToolPreview] Failed to load HTML:", error);
          toast.error("Failed to load HTML content");
        } finally {
          setIsLoading(false);
        }
      }

      // Extract fileDir from filePath
      if (filePath) {
        const lastSlashIndex = filePath.lastIndexOf("/");
        fileDir = filePath.substring(0, lastSlashIndex);
      }

      // Inline CSS and JS resources
      try {
        content = await inlineResources(content, fileDir, taskId);
        setHtmlContent(content);
      } catch (error) {
        console.error("[HtmlToolPreview] Failed to inline resources:", error);
        setHtmlContent(content);
      }
    };

    loadContent();
  }, [isOpen, filePath, generatedFile, toolOutput]);

  // Always show button if it's an HTML file (even if we don't have content yet)
  if (!isHtmlFile) {
    return null;
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 inline-flex items-center gap-1.5"
          onClick={() => {
            setIsOpen(true);
          }}
        >
          <RemixIcon name="globe" size="size-4" />
          Preview Website
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-6xl w-full h-[80vh] p-0">
        <DialogHeader className="px-4 pt-4 pb-2 border-b">
          <DialogTitle className="flex items-center gap-2">
            <RemixIcon name="globe" size="size-5" />
            Website Preview
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 h-[calc(80vh-60px)]">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <RemixIcon
                name="loader_2"
                size="size-8"
                className="animate-spin text-muted-foreground"
              />
            </div>
          ) : (
            <WebsitePreview
              content={htmlContent}
              filename={filename}
              filePath={filePath}
              onClose={() => setIsOpen(false)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
