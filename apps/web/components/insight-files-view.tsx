"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { RemixIcon } from "@/components/remix-icon";
import { ScrollArea } from "@openloomi/ui";
import { Button, Input } from "@openloomi/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openloomi/ui";
import { toast } from "@/components/toast";
import { cn } from "@/lib/utils";
import { getFileColor } from "@/components/file-icons";
import { uploadRagFile } from "@/lib/files/upload";
import { Spinner } from "@/components/spinner";
import { FilePreviewPanel } from "@/components/file-preview-panel";
import { FilePreviewDrawerShell } from "@/components/file-preview-drawer-shell";
import { FilePreviewDrawerHeader } from "@/components/file-preview-drawer-header";
import { useIsMobile } from "@openloomi/hooks/use-is-mobile";
import { useSidePanel } from "@/components/agent/side-panel-context";
import { useChatContextOptional } from "@/components/chat-context";
import { AgentChatPanel } from "@/components/agent/chat-panel";
import { getAuthToken } from "@/lib/auth/token-manager";

/** Knowledge base document */
interface KnowledgeFile {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  totalChunks: number;
  uploadedAt: string;
}

/** Timeline data structure (consistent with TimelineSchema) */
interface TimelineData {
  time?: number | null;
  summary?: string;
  label?: string;
}

/** Extracted timeline file */
interface ProcessedTimelineFile {
  name: string;
  summary: string;
  time: number;
}

/** Files generated in Chat */
interface ChatFile {
  id: string;
  fileName: string;
  path: string;
  size: number;
  type: string;
  taskId: string;
  createdAt: string;
}

/** Chat metadata (consistent with LibraryMetaResponse) */
interface ChatMeta {
  title: string;
}

/** Conversation info in Chat history */
interface ChatInfo {
  id: string;
  title: string | null;
}

interface InsightFilesViewProps {
  insightId: string;
  /** Optional insight timeline data, used to directly obtain timeline files */
  insightTimeline?: TimelineData[];
}

/** Filter type */
type FileTypeFilter =
  | "all"
  | "slides"
  | "website"
  | "document"
  | "imageVideo"
  | "audio"
  | "spreadsheet"
  | "other";

/** Remix icon name corresponding to filter type */
const FILTER_ICON_MAP: Record<FileTypeFilter, string> = {
  all: "filter",
  slides: "slideshow",
  website: "code",
  document: "file_text",
  imageVideo: "image",
  audio: "music_2",
  spreadsheet: "table_2",
  other: "more_2",
};

/** Format file size */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Get icon based on file type/extension */
function getFileIcon(fileName: string, contentType: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  if (contentType.includes("pdf") || ext === "pdf") return "file_pdf";
  if (
    contentType.includes("word") ||
    contentType.includes("document") ||
    ext === "doc" ||
    ext === "docx"
  )
    return "file_word";
  if (
    contentType.includes("presentation") ||
    contentType.includes("powerpoint") ||
    ext === "ppt" ||
    ext === "pptx"
  )
    return "presentation";
  if (
    contentType.includes("sheet") ||
    contentType.includes("excel") ||
    ext === "xls" ||
    ext === "xlsx"
  )
    return "file_excel";
  if (
    contentType.includes("text") ||
    contentType.includes("markdown") ||
    ext === "md" ||
    ext === "txt"
  )
    return "file_text";
  if (
    contentType.includes("image") ||
    ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp"].includes(ext)
  )
    return "file_image";
  if (ext === "html" || ext === "htm") return "globe";
  return "file";
}

/** Get filter type based on file type/extension */
function getFileType(fileName: string, contentType: string): FileTypeFilter {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  if (
    contentType.includes("presentation") ||
    contentType.includes("powerpoint") ||
    ext === "ppt" ||
    ext === "pptx" ||
    ext === "odp"
  )
    return "slides";
  if (ext === "html" || ext === "htm") return "website";
  if (
    contentType.includes("text") ||
    contentType.includes("markdown") ||
    contentType.includes("pdf") ||
    contentType.includes("word") ||
    contentType.includes("document") ||
    contentType.includes("rtf") ||
    ext === "md" ||
    ext === "txt" ||
    ext === "pdf" ||
    ext === "odt" ||
    ext === "doc" ||
    ext === "docx"
  )
    return "document";
  if (
    contentType.includes("image") ||
    contentType.includes("video") ||
    [
      "png",
      "jpg",
      "jpeg",
      "gif",
      "svg",
      "bmp",
      "mp4",
      "webm",
      "mov",
      "avi",
      "mkv",
    ].includes(ext)
  )
    return "imageVideo";
  if (
    contentType.includes("audio") ||
    ["mp3", "wav", "ogg", "m4a", "aac"].includes(ext)
  )
    return "audio";
  if (
    contentType.includes("sheet") ||
    contentType.includes("excel") ||
    ext === "xls" ||
    ext === "xlsx" ||
    ext === "csv"
  )
    return "spreadsheet";
  return "other";
}

/**
 * Insight Files View: displays all file details associated with this event
 * Style consistent with Library Page
 */
export function InsightFilesView({
  insightId,
  insightTimeline,
}: InsightFilesViewProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const isMobile = useIsMobile();
  const { openSidePanel } = useSidePanel() ?? {
    openSidePanel: () => {},
  };
  const { switchChatId } = useChatContextOptional() ?? {
    toggleFocusedInsight: () => {},
    focusedInsights: [],
    switchChatId: () => {},
  };

  const [documents, setDocuments] = useState<KnowledgeFile[]>([]);
  const [previewFile, setPreviewFile] = useState<{
    path: string;
    name: string;
    type: string;
    taskId?: string;
  } | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  // Knowledge base document preview state
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [isDocPreviewOpen, setIsDocPreviewOpen] = useState(false);
  const [timelineFiles, setTimelineFiles] = useState<ProcessedTimelineFile[]>(
    [],
  );
  const [chatFiles, setChatFiles] = useState<ChatFile[]>([]);
  const [chatMeta, setChatMeta] = useState<Record<string, ChatMeta>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [filterType, setFilterType] = useState<FileTypeFilter>("all");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingMyFiles, setIsUploadingMyFiles] = useState(false);

  // Fetch related knowledge base documents
  const fetchDocuments = useCallback(async () => {
    try {
      const response = await fetch(`/api/insights/${insightId}/documents`);
      if (!response.ok) throw new Error("Failed to fetch documents");
      const data = await response.json();
      const formatted: KnowledgeFile[] = (data.documents || []).map(
        (doc: any) => ({
          id: doc.id,
          fileName: doc.fileName,
          contentType: doc.contentType,
          sizeBytes: Number(doc.sizeBytes),
          totalChunks: doc.totalChunks || 0,
          uploadedAt: doc.uploadedAt,
        }),
      );
      setDocuments(formatted);
    } catch (err) {
      console.error("Failed to fetch documents:", err);
    }
  }, [insightId]);

  // Upload file to knowledge base and associate with Insight
  const handleMyFilesUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsUploadingMyFiles(true);
      try {
        let cloudAuthToken: string | undefined;
        try {
          cloudAuthToken = getAuthToken() || undefined;
        } catch {
          // ignore
        }
        const result = await uploadRagFile(file, { cloudAuthToken });
        if (result.success) {
          // Associate document with current Insight
          const docId = result.documentId;
          if (docId) {
            const associateResponse = await fetch(
              `/api/insights/${insightId}/documents`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ documentId: docId }),
              },
            );
            if (associateResponse.ok) {
              toast({
                type: "success",
                description: t("insightFiles.uploadSuccess"),
              });
            } else {
              toast({
                type: "error",
                description: t("insightFiles.associateFailed"),
              });
            }
          }
          // Refresh document list
          fetchDocuments();
        } else {
          toast({
            type: "error",
            description: result.error || t("insightFiles.uploadFailed"),
          });
        }
      } catch (err) {
        console.error("Upload failed:", err);
        toast({ type: "error", description: t("insightFiles.uploadFailed") });
      } finally {
        setIsUploadingMyFiles(false);
        // Clear input to allow selecting the same file again
        e.target.value = "";
      }
    },
    [fetchDocuments, insightId],
  );

  // Extract files from timeline data passed via props
  const processTimelineFiles = useCallback(
    (timeline: TimelineData[] | undefined) => {
      if (!timeline || timeline.length === 0) {
        setTimelineFiles([]);
        return;
      }
      // Extract timeline items with label "File"
      const files: ProcessedTimelineFile[] = timeline
        .filter((item) => item.label === "File" && item.summary)
        .map((item) => ({
          name: item.summary?.replace("Added file: ", "") || "Unknown file",
          summary: item.summary || "",
          time: item.time || 0,
        }));
      setTimelineFiles(files);
    },
    [],
  );

  // Fetch files generated in related chat
  const fetchChatFiles = useCallback(async () => {
    try {
      // Get related chat
      const historyResponse = await fetch(`/api/insights/${insightId}/history`);
      if (!historyResponse.ok) {
        console.error("Failed to fetch chat history");
        return;
      }
      const historyData = await historyResponse.json();
      const chats: ChatInfo[] = historyData.chats || [];

      if (chats.length === 0) {
        setChatFiles([]);
        setChatMeta({});
        return;
      }

      // Get all workspace files, then filter those belonging to related chat
      const chatIds = new Set(chats.map((c) => c.id));

      // Parallel requests: workspace files + chat metadata
      const [filesResponse, metaResponse] = await Promise.all([
        fetch("/api/workspace/files?pageSize=1000"),
        fetch(`/api/library/meta?chatIds=${Array.from(chatIds).join(",")}`),
      ]);

      if (filesResponse.ok) {
        const data = await filesResponse.json();
        const allFiles = data.files || [];

        // Filter files belonging to related chat
        const chatFiles = allFiles
          .filter((file: any) => file.taskId && chatIds.has(file.taskId))
          .map((file: any) => ({
            id: `${file.taskId}-${file.path}`,
            fileName: file.name || file.path?.split("/").pop() || "Unknown",
            path: file.path || "",
            size: file.size || 0,
            type: file.type || "",
            taskId: file.taskId,
            createdAt: file.modifiedTime || new Date().toISOString(),
          }));

        setChatFiles(chatFiles);
      }

      // Set chat metadata (title)
      if (metaResponse.ok) {
        const metaData = await metaResponse.json();
        setChatMeta(metaData.chats || {});
      }
    } catch (err) {
      console.error("Failed to fetch chat files:", err);
    }
  }, [insightId]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    // If timeline data was passed in props, use it directly
    if (insightTimeline) {
      processTimelineFiles(insightTimeline);
      Promise.all([fetchDocuments(), fetchChatFiles()])
        .catch((err) => {
          if (!cancelled) {
            console.error("Failed to fetch files:", err);
            toast({
              type: "error",
              description: t("insightFiles.fetchFailed"),
            });
          }
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }

    // Otherwise fetch via API
    Promise.all([
      fetchDocuments(),
      processTimelineFiles(undefined),
      fetchChatFiles(),
    ])
      .catch((err) => {
        if (!cancelled) {
          console.error("Failed to fetch files:", err);
          toast({ type: "error", description: t("insightFiles.fetchFailed") });
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    insightId,
    fetchDocuments,
    insightTimeline,
    processTimelineFiles,
    fetchChatFiles,
    t,
  ]);

  // Unify file types
  interface UnifiedFile {
    id: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    uploadedAt: string;
    source: "document" | "chat";
    taskId?: string;
    path?: string;
  }

  // Merge and sort all files
  const allFiles = useMemo((): UnifiedFile[] => {
    const items: UnifiedFile[] = [
      ...documents.map((d) => ({
        id: d.id,
        fileName: d.fileName,
        contentType: d.contentType,
        sizeBytes: d.sizeBytes,
        uploadedAt: d.uploadedAt,
        source: "document" as const,
      })),
      ...chatFiles.map((f) => ({
        id: f.id,
        fileName: f.fileName,
        contentType: f.type || "unknown",
        sizeBytes: f.size,
        uploadedAt: f.createdAt,
        source: "chat" as const,
        taskId: f.taskId,
        path: f.path,
      })),
    ];
    // Sort by time descending
    items.sort(
      (a, b) =>
        new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
    );
    return items;
  }, [documents, timelineFiles, chatFiles]);

  // Search + filter (directly filter all files)
  const filteredFiles = useMemo(() => {
    let files = allFiles;

    // Filter by type
    if (filterType !== "all") {
      files = files.filter((file) => {
        const type = getFileType(file.fileName, file.contentType);
        return type === filterType;
      });
    }

    // Filter by search term
    if (searchTerm.trim()) {
      const lower = searchTerm.toLowerCase();
      files = files.filter((file) =>
        file.fileName.toLowerCase().includes(lower),
      );
    }

    return files;
  }, [allFiles, filterType, searchTerm]);

  // Group by conversation (all files grouped by taskId)
  const groupedFiles = useMemo(() => {
    // Group by taskId
    const map = new Map<string, typeof filteredFiles>();
    filteredFiles.forEach((file) => {
      const key = file.taskId || "public";
      if (!map.has(key)) map.set(key, []);
      map.get(key)?.push(file);
    });
    return Array.from(map.entries()).map(([key, items]) => ({
      label:
        chatMeta[key]?.title?.trim() ||
        (key === "public"
          ? t("insightFiles.sourceDocument", "Knowledge base")
          : key) ||
        t("workspace.untitledChat", "Untitled chat"),
      items,
      key,
    }));
  }, [filteredFiles, chatMeta, t]);

  // Format date - consistent with Library Page
  const formatDate = useCallback((date: Date | string) => {
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
  }, []);

  // Total file count
  const totalFileCount = useMemo(() => allFiles.length, [allFiles]);

  if (isLoading) {
    return (
      <div className="flex flex-row items-center p-2 text-muted-foreground justify-center">
        <Spinner size={20} />
        <div>{t("common.loading")}</div>
      </div>
    );
  }

  // Get file icon color - consistent with Library
  const getColor = (fileName: string, source: string) => {
    if (source === "document") return "text-blue-500";
    if (source === "chat") return getFileColor(fileName);
    return getFileColor(fileName);
  };

  return (
    <div className="flex flex-col h-full flex-1 min-w-0">
      {/* View switch + filter + search box - always shown */}
      <div className="shrink-0 flex flex-col gap-2 px-0 py-0">
        <div className="flex items-center justify-between gap-2">
          <div className="text-base font-semibold shrink-0">
            {t("insightFiles.filesTitle", "Files")}
          </div>

          <div className="flex items-center justify-end gap-2 flex-1 min-w-0">
            {allFiles.length > 0 && (
              <>
                <div className="flex rounded-md border border-border/60 overflow-hidden shrink-0">
                  <Button
                    variant={viewMode === "list" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-9 rounded-none"
                    onClick={() => setViewMode("list")}
                    aria-label={t("workspace.viewList", "List")}
                  >
                    <RemixIcon name="list" size="size-4" />
                  </Button>
                  <Button
                    variant={viewMode === "grid" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-9 rounded-none"
                    onClick={() => setViewMode("grid")}
                    aria-label={t("workspace.viewGrid", "Grid")}
                  >
                    <RemixIcon name="layout_grid" size="size-4" />
                  </Button>
                </div>
                <Select
                  value={filterType}
                  onValueChange={(v: FileTypeFilter) => setFilterType(v)}
                >
                  <SelectTrigger
                    hideIcon
                    className={cn(
                      "h-9 w-9 p-0 shrink-0 [&>span:first-child]:flex [&>span:first-child]:flex-1 [&>span:first-child]:justify-center [&>span:first-child]:min-w-0 [&>span:first-child>*:not(:first-child)]:hidden [&>span:first-child>*:not(:first-child)]:w-0 [&>span:first-child>*:not(:first-child)]:overflow-hidden",
                      filterType !== "all" && "bg-secondary border-primary/50",
                    )}
                    aria-label={t("workspace.filterAll")}
                  >
                    <RemixIcon
                      name={FILTER_ICON_MAP[filterType]}
                      size="size-4"
                      className="shrink-0 text-muted-foreground"
                    />
                    <SelectValue placeholder="" />
                  </SelectTrigger>
                  <SelectContent className="[&>*]:justify-start">
                    <SelectItem value="all">
                      <RemixIcon
                        name="filter"
                        size="size-4"
                        className="shrink-0 text-muted-foreground"
                      />
                      {t("workspace.filterAll")}
                    </SelectItem>
                    <SelectItem value="slides">
                      <RemixIcon
                        name="slideshow"
                        size="size-4"
                        className="shrink-0 text-muted-foreground"
                      />
                      {t("workspace.filterSlides")}
                    </SelectItem>
                    <SelectItem value="website">
                      <RemixIcon
                        name="code"
                        size="size-4"
                        className="shrink-0 text-muted-foreground"
                      />
                      {t("workspace.filterWebsite")}
                    </SelectItem>
                    <SelectItem value="document">
                      <RemixIcon
                        name="file_text"
                        size="size-4"
                        className="shrink-0 text-muted-foreground"
                      />
                      {t("workspace.filterDocument")}
                    </SelectItem>
                    <SelectItem value="imageVideo">
                      <RemixIcon
                        name="image"
                        size="size-4"
                        className="shrink-0 text-muted-foreground"
                      />
                      {t("workspace.filterImageVideo")}
                    </SelectItem>
                    <SelectItem value="audio">
                      <RemixIcon
                        name="music_2"
                        size="size-4"
                        className="shrink-0 text-muted-foreground"
                      />
                      {t("workspace.filterAudio")}
                    </SelectItem>
                    <SelectItem value="spreadsheet">
                      <RemixIcon
                        name="table_2"
                        size="size-4"
                        className="shrink-0 text-muted-foreground"
                      />
                      {t("workspace.filterSpreadsheet")}
                    </SelectItem>
                    <SelectItem value="other">
                      <RemixIcon
                        name="more_2"
                        size="size-4"
                        className="shrink-0 text-muted-foreground"
                      />
                      {t("workspace.filterOther")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </>
            )}

            <div className="relative w-full sm:w-48 min-w-[120px] h-9">
              <RemixIcon
                name="search"
                size="size-4"
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <Input
                type="text"
                placeholder={t("insightFiles.search", "Search files...")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 h-9 text-sm bg-muted/50 border border-border/60 rounded-md"
              />
            </div>

            {/* Upload file button - always shown */}
            <input
              ref={(el) => {
                (
                  fileInputRef as React.MutableRefObject<HTMLInputElement | null>
                ).current = el;
              }}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.txt,.md,.html,.htm,.xls,.xlsx,.csv,.ppt,.pptx"
              onChange={handleMyFilesUpload}
            />
            <Button
              type="button"
              variant="default"
              size="sm"
              className="h-9 gap-1.5 shrink-0"
              disabled={isUploadingMyFiles}
              onClick={() => fileInputRef.current?.click()}
              aria-label={t("workspace.uploadFile", "Upload file")}
            >
              {isUploadingMyFiles ? (
                <Spinner size={16} />
              ) : (
                <RemixIcon name="upload_2" size="size-4" />
              )}
              <span className="hidden xs:inline">
                {t("workspace.uploadShort", "Upload")}
              </span>
            </Button>
          </div>
        </div>
      </div>

      {allFiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground text-sm">
          <RemixIcon
            name="folder_open"
            size="size-10"
            className="mb-2 opacity-50"
          />
          <p>{t("insightFiles.empty", "No associated files")}</p>
          <p className="text-xs mt-1">
            {t("insightFiles.emptyHint", "Associated files will appear here")}
          </p>
        </div>
      ) : filteredFiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground text-sm">
          <p>{t("insightFiles.noMatch", "No matching files")}</p>
        </div>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          <div
            className={cn(
              "px-6 py-3",
              viewMode === "grid"
                ? "grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 min-w-0"
                : "space-y-1",
            )}
          >
            {groupedFiles.map((group) => (
              <div key={group.key}>
                {/* Group title - only shown when multiple groups */}
                {groupedFiles.length > 1 && group.label && (
                  <p className="text-xs font-medium text-muted-foreground px-1 py-2 sticky top-0 bg-background z-10">
                    {group.label}
                  </p>
                )}
                <ul
                  className={cn(viewMode === "grid" ? "contents" : "space-y-1")}
                >
                  {group.items.map((file) => (
                    <li key={file.id} className="w-full min-w-0">
                      {viewMode === "grid" ? (
                        // Grid view - aligned with Library
                        <div className="w-full min-w-0 flex flex-col items-stretch gap-1.5 p-3 rounded-lg border border-border/60 bg-card text-left overflow-hidden">
                          <div
                            className={cn(
                              "shrink-0 rounded-md flex items-center justify-center size-10",
                              getColor(file.fileName, file.source),
                            )}
                          >
                            <RemixIcon
                              name={getFileIcon(
                                file.fileName,
                                file.contentType,
                              )}
                              size="size-6"
                            />
                          </div>
                          <p className="text-sm font-medium truncate min-w-0 text-left">
                            {file.fileName}
                          </p>
                          <p className="text-xs text-muted-foreground shrink-0">
                            {formatDate(file.uploadedAt)}
                            {file.sizeBytes > 0 &&
                              ` · ${formatFileSize(file.sizeBytes)}`}
                          </p>
                          <div className="flex items-center gap-2 shrink-0">
                            {/* Action buttons */}
                            {file.source === "chat" && file.taskId && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                aria-label={t("library.openChat", "Open chat")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const taskId = file.taskId;
                                  if (!taskId) return;
                                  switchChatId(taskId);
                                  if (isMobile) {
                                    router.push(
                                      `/?page=chat&chatId=${encodeURIComponent(taskId)}`,
                                    );
                                    return;
                                  }
                                  const ChatSidePanel = () => {
                                    const { closeSidePanel } =
                                      useSidePanel() ?? {
                                        closeSidePanel: () => {},
                                      };
                                    return (
                                      <div className="h-full flex flex-col bg-card">
                                        <div className="border-b border-border/60 bg-white/70 px-4 py-3 shrink-0 flex items-center justify-between">
                                          <span className="text-sm font-medium text-foreground truncate">
                                            {t("common.chat", "Chat")}
                                          </span>
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            onClick={closeSidePanel}
                                            className="h-7 w-7 shrink-0"
                                            aria-label={t(
                                              "common.close",
                                              "Close",
                                            )}
                                          >
                                            <RemixIcon
                                              name="close"
                                              size="size-3"
                                            />
                                          </Button>
                                        </div>
                                        <div className="flex-1 min-h-0 flex flex-col">
                                          <AgentChatPanel />
                                        </div>
                                      </div>
                                    );
                                  };
                                  openSidePanel({
                                    id: `file-chat-${taskId}`,
                                    content: <ChatSidePanel />,
                                    width: 400,
                                  });
                                }}
                              >
                                <RemixIcon name="external_link" size="size-4" />
                              </Button>
                            )}
                            {file.source === "chat" && file.path && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                aria-label={t(
                                  "insightFiles.preview",
                                  "Preview",
                                )}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewFile({
                                    path: file.path || "",
                                    name: file.fileName,
                                    type: file.contentType,
                                    taskId: file.taskId,
                                  });
                                  setIsPreviewOpen(true);
                                }}
                              >
                                <RemixIcon name="eye" size="size-4" />
                              </Button>
                            )}
                            {/* Knowledge base document preview button */}
                            {file.source === "document" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                aria-label={t(
                                  "insightFiles.preview",
                                  "Preview",
                                )}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewDocId(file.id);
                                  setIsDocPreviewOpen(true);
                                }}
                              >
                                <RemixIcon name="eye" size="size-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ) : (
                        // List view - aligned with Library
                        <div className="w-full min-w-0 flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-2 rounded-lg border border-border/60 bg-card text-left overflow-hidden">
                          {/* Icon */}
                          <div
                            className={cn(
                              "shrink-0 rounded-md flex items-center justify-center size-9",
                              getColor(file.fileName, file.source),
                            )}
                          >
                            <RemixIcon
                              name={getFileIcon(
                                file.fileName,
                                file.contentType,
                              )}
                              size="size-5"
                            />
                          </div>

                          {/* File name and time */}
                          <div className="min-w-0 flex-1 text-left overflow-hidden space-y-0.5">
                            {/* Chat files display conversation title */}
                            {file.source === "chat" && file.taskId && (
                              <p className="text-xs text-muted-foreground truncate">
                                {chatMeta[file.taskId]?.title?.trim() ||
                                  file.taskId ||
                                  t("workspace.untitledChat", "Untitled chat")}
                              </p>
                            )}
                            <p className="text-sm font-medium truncate">
                              {file.fileName}
                            </p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>{formatDate(file.uploadedAt)}</span>
                              {file.sizeBytes > 0 && (
                                <span>{formatFileSize(file.sizeBytes)}</span>
                              )}
                              <span
                                className={cn(
                                  "px-1.5 py-0.5 rounded text-[10px]",
                                  file.source === "document"
                                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                                    : file.source === "chat"
                                      ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300"
                                      : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
                                )}
                              >
                                {file.source === "document"
                                  ? t(
                                      "insightFiles.sourceDocument",
                                      "Knowledge base",
                                    )
                                  : file.source === "chat"
                                    ? t("insightFiles.sourceChat", "Chat")
                                    : t(
                                        "insightFiles.sourceTimeline",
                                        "Timeline",
                                      )}
                              </span>
                            </div>
                          </div>

                          {/* Action buttons */}
                          <div className="shrink-0 flex items-center gap-1">
                            {file.source === "chat" && file.taskId && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                aria-label={t("library.openChat", "Open chat")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const taskId = file.taskId;
                                  if (!taskId) return;
                                  switchChatId(taskId);
                                  if (isMobile) {
                                    router.push(
                                      `/?page=chat&chatId=${encodeURIComponent(taskId)}`,
                                    );
                                    return;
                                  }
                                  const ChatSidePanel = () => {
                                    const { closeSidePanel } =
                                      useSidePanel() ?? {
                                        closeSidePanel: () => {},
                                      };
                                    return (
                                      <div className="h-full flex flex-col bg-card">
                                        <div className="border-b border-border/60 bg-white/70 px-4 py-3 shrink-0 flex items-center justify-between">
                                          <span className="text-sm font-medium text-foreground truncate">
                                            {t("common.chat", "Chat")}
                                          </span>
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            onClick={closeSidePanel}
                                            className="h-7 w-7 shrink-0"
                                            aria-label={t(
                                              "common.close",
                                              "Close",
                                            )}
                                          >
                                            <RemixIcon
                                              name="close"
                                              size="size-3"
                                            />
                                          </Button>
                                        </div>
                                        <div className="flex-1 min-h-0 flex flex-col">
                                          <AgentChatPanel />
                                        </div>
                                      </div>
                                    );
                                  };
                                  openSidePanel({
                                    id: `file-chat-${taskId}`,
                                    content: <ChatSidePanel />,
                                    width: 400,
                                  });
                                }}
                              >
                                <RemixIcon name="external_link" size="size-4" />
                              </Button>
                            )}
                            {file.source === "chat" && file.path && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                aria-label={t(
                                  "insightFiles.preview",
                                  "Preview",
                                )}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewFile({
                                    path: file.path || "",
                                    name: file.fileName,
                                    type: file.contentType,
                                    taskId: file.taskId,
                                  });
                                  setIsPreviewOpen(true);
                                }}
                              >
                                <RemixIcon name="eye" size="size-4" />
                              </Button>
                            )}
                            {/* Knowledge base document preview button */}
                            {file.source === "document" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                aria-label={t(
                                  "insightFiles.preview",
                                  "Preview",
                                )}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewDocId(file.id);
                                  setIsDocPreviewOpen(true);
                                }}
                              >
                                <RemixIcon name="eye" size="size-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      {isPreviewOpen && previewFile && (
        <FilePreviewDrawerShell
          open={isPreviewOpen}
          onClose={() => setIsPreviewOpen(false)}
        >
          <FilePreviewPanel
            file={{
              path: previewFile.path,
              name: previewFile.name,
              type: previewFile.type,
            }}
            taskId={previewFile.taskId}
            onClose={() => setIsPreviewOpen(false)}
          />
        </FilePreviewDrawerShell>
      )}

      {isDocPreviewOpen && previewDocId && (
        <FilePreviewDrawerShell
          onClose={() => {
            setIsDocPreviewOpen(false);
            setPreviewDocId(null);
          }}
        >
          <KnowledgeDocPreviewPanel
            documentId={previewDocId}
            onClose={() => {
              setIsDocPreviewOpen(false);
              setPreviewDocId(null);
            }}
          />
        </FilePreviewDrawerShell>
      )}
    </div>
  );
}

/**
 * Knowledge base document preview: header consistent with library preview, body scrolls within the shell.
 */
function KnowledgeDocPreviewPanel({
  documentId,
  onClose,
}: {
  documentId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [doc, setDoc] = useState<{
    fileName: string;
    contentType: string;
    chunks: Array<{ content: string; chunkIndex: number }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check if it's a binary file type that doesn't support preview
  const isBinaryFile = doc?.contentType
    ? doc.contentType.includes("sheet") ||
      doc.contentType.includes("excel") ||
      doc.contentType.includes("presentation") ||
      doc.contentType.includes("powerpoint") ||
      doc.contentType.includes("audio") ||
      doc.contentType.includes("video") ||
      doc.contentType.includes("image")
    : false;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/rag/documents/${documentId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      })
      .then((data: any) => {
        if (cancelled) return;
        const d = data.document;
        if (d) {
          setDoc({
            fileName: d.fileName,
            contentType: d.contentType || "",
            chunks: (d.chunks ?? []).sort(
              (a: { chunkIndex: number }, b: { chunkIndex: number }) =>
                a.chunkIndex - b.chunkIndex,
            ),
          });
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  // Content section
  const content = (
    <>
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner size={20} />
        </div>
      ) : error ? (
        <div className="p-4 text-center text-destructive">
          {t("filePreview.failed", "Failed to load")}: {error}
        </div>
      ) : doc ? (
        isBinaryFile ? (
          <div className="p-8 text-center text-muted-foreground">
            <RemixIcon
              name="file_excel"
              size="size-10"
              className="mx-auto mb-2 opacity-50"
            />
            <p>
              {t(
                "insightFiles.previewNotSupported",
                "Preview not supported for this file type",
              )}
            </p>
            <p className="text-xs mt-1">{doc.contentType}</p>
          </div>
        ) : (
          <div className="p-4 space-y-4 min-w-0">
            {doc.chunks.map((chunk) => (
              <div key={chunk.chunkIndex} className="text-sm min-w-0">
                <p className="text-muted-foreground text-xs mb-1">
                  Chunk {chunk.chunkIndex + 1}
                </p>
                <p className="whitespace-pre-wrap break-all">{chunk.content}</p>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="p-4 text-center text-muted-foreground">
          {t("filePreview.noContent", "No content")}
        </div>
      )}
    </>
  );

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <FilePreviewDrawerHeader fileName={doc?.fileName ?? documentId}>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md p-1 hover:bg-muted transition-colors"
          aria-label={t("common.close", "Close")}
        >
          <RemixIcon name="close" size="size-4" />
        </button>
      </FilePreviewDrawerHeader>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">{content}</div>
    </div>
  );
}
