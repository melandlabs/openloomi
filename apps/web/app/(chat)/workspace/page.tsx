"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type LegacyRef,
} from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { RemixIcon } from "@/components/remix-icon";
import { Button, Input, Textarea } from "@openloomi/ui";
import { ScrollArea } from "@openloomi/ui";
import { usePullToRefresh } from "@openloomi/hooks/use-pull-to-refresh";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openloomi/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@openloomi/ui";
import { getToolDisplayName } from "@/lib/utils/tool-names";
import { FilePreviewPanel } from "@/components/file-preview-panel";
import { FilePreviewDrawerShell } from "@/components/file-preview-drawer-shell";
import { FilePreviewDrawerHeader } from "@/components/file-preview-drawer-header";
import { MarkdownWithCitations } from "@/components/markdown-with-citations";
import type { KnowledgeFile } from "@/hooks/use-knowledge-files";
import type { LibraryMetaResponse } from "@/app/(chat)/api/library/meta/route";
import type { LibraryNoteItem } from "@/app/(chat)/api/library/notes/route";
import { Spinner } from "@/components/spinner";
import {
  usePdfPreview,
  PdfPreviewHeaderToolbar,
  PdfPreviewScrollBody,
} from "@/components/artifacts/pdf-preview";
import { Button as DrawerHeaderIconButton } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useSpreadsheetPreview,
  SpreadsheetPreviewHeaderToolbar,
  SpreadsheetPreviewScrollBody,
} from "@/components/artifacts/spreadsheet-preview";
import { uploadRagFile } from "@/lib/files/upload";
import { useGlobalInsightDrawerOptional } from "@/components/global-insight-drawer";
import { toast } from "@/components/toast";
import "../../../i18n";
import { getAuthToken } from "@/lib/auth/token-manager";
import { useDiskUsage, useSessions } from "@/hooks/use-disk-usage";
import {
  LibraryItemRow,
  getExtFromItem,
  type LibraryItem,
  type ToolExecution,
} from "@/components/library/library-item-row";

/** Library top-level tabs: My notes, My files, Chat Vault */
export type LibraryTab = "mynotes" | "myfiles" | "stuff";

/** File type filter categories (consistent with screenshots + tools) */
export type FileTypeFilter =
  | "all"
  | "slides"
  | "website"
  | "document"
  | "imageVideo"
  | "audio"
  | "spreadsheet"
  | "other"
  | "tools";

/** Remix icon name for each filter type (used when buttons show icons only) */
const FILTER_ICON_MAP: Record<FileTypeFilter, string> = {
  all: "filter",
  slides: "slideshow",
  website: "code",
  document: "file_text",
  imageVideo: "image",
  audio: "music_2",
  spreadsheet: "table_2",
  other: "more_2",
  tools: "layers",
};

/** Grouping mode (none is only used for My files) */
export type GroupByMode = "conversation" | "time" | "event" | "folder" | "none";

/** Pagination constants */
// Frontend pagination size must match backend

/** Workspace file item (returned from API, includes taskId) */
const PAGE_SIZE = 25;

/** Workspace file item (returned from API, includes taskId) */
interface WorkspaceFileItem {
  taskId: string;
  name: string;
  path: string;
  type?: string;
  size?: number;
  isDirectory?: boolean;
  modifiedTime?: string;
}

/** Paginated response type */
interface PaginatedResponse<T> {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
  total?: number;
}

/** Return file type category based on extension */
function getFileTypeCategory(
  ext: string,
): Exclude<FileTypeFilter, "all" | "tools"> {
  const e = ext.toLowerCase();
  if (["ppt", "pptx", "odp", "key"].includes(e)) return "slides";
  if (["html", "htm"].includes(e)) return "website";
  if (["pdf", "doc", "docx", "odt", "rtf", "txt", "md"].includes(e))
    return "document";
  if (
    [
      "jpg",
      "jpeg",
      "png",
      "gif",
      "svg",
      "webp",
      "bmp",
      "ico",
      "mp4",
      "webm",
      "mov",
      "avi",
      "mkv",
      "flv",
    ].includes(e)
  )
    return "imageVideo";
  if (["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(e)) return "audio";
  if (["xls", "xlsx", "csv", "ods"].includes(e)) return "spreadsheet";
  return "other";
}

/**
 * Determine if a knowledge base document is spreadsheet-type (requires SheetJS to parse binary, cannot treat chunk as Markdown).
 */
function isKnowledgeSpreadsheetDocument(
  contentType: string | undefined,
  fileName: string,
): boolean {
  const ct = (contentType ?? "").toLowerCase();
  if (
    ct.includes("spreadsheetml") ||
    ct.includes("spreadsheet") ||
    ct.includes("excel") ||
    ct.includes("ms-excel") ||
    ct.includes("csv") ||
    ct.includes("opendocument.spreadsheet")
  ) {
    return true;
  }
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return ["xlsx", "xls", "csv", "ods"].includes(ext);
}

/**
 * Extract tool execution records from message list
 */
function extractToolExecutions(messages: unknown[]): ToolExecution[] {
  if (!messages?.length) return [];
  const tools: ToolExecution[] = [];
  const seenIds = new Set<string>();

  messages.forEach((message: any) => {
    if (message.parts && Array.isArray(message.parts)) {
      message.parts.forEach((part: any) => {
        if (part.type === "tool-native") {
          const id = part.toolUseId || `tool-${tools.length}`;
          if (!seenIds.has(id)) {
            seenIds.add(id);
            tools.push({
              id,
              name: part.toolName || "Unknown",
              status:
                part.status === "executing"
                  ? "running"
                  : part.status === "error"
                    ? "error"
                    : "completed",
              timestamp: message.createdAt
                ? new Date(message.createdAt)
                : new Date(),
            });
          }
        }
      });
    }
    if (message.type === "tool_use" || message.type === "tool_result") {
      const id = message.id || `tool-${tools.length}`;
      if (!seenIds.has(id)) {
        seenIds.add(id);
        tools.push({
          id,
          name: message.name || "Unknown",
          status:
            message.type === "tool_use"
              ? "running"
              : message.isError
                ? "error"
                : "completed",
          timestamp: message.timestamp
            ? new Date(message.timestamp)
            : new Date(),
        });
      }
    }
  });
  return tools;
}

/**
 * Get group display label by date
 */
function getDateGroupLabel(date: Date, locale: string): string {
  const formatter = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "numeric",
    day: "numeric",
  });
  return formatter.format(date);
}

/**
 * Parse folder from path (directory part of relative path), return "" for root directory
 */
function getFolderFromPath(path: string): string {
  const idx = path.lastIndexOf("/");
  if (idx <= 0) return "";
  return path.slice(0, idx);
}

/**
 * Library page: merge workspace files, knowledge base files, tools; group by conversation/time/event/folder; filter by file type
 * Supports pagination and pull-to-refresh
 */
export default function LibraryPage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const chatId = searchParams.get("chatId") ?? undefined;
  const tabParam = searchParams.get("tab");
  const activeTab: LibraryTab =
    tabParam === "mynotes" || tabParam === "myfiles" || tabParam === "stuff"
      ? tabParam
      : "stuff";

  const setLibraryTab = useCallback(
    (tab: LibraryTab) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("tab", tab);
      router.push(`/workspace?${next.toString()}`);
    },
    [router, searchParams],
  );

  /** Open event: prioritize opening global drawer; fallback to navigating to event page if drawer unavailable or request fails */
  const globalDrawer = useGlobalInsightDrawerOptional();
  const handleOpenEvent = useCallback(
    (insightId: string) => {
      if (globalDrawer) {
        fetch(`/api/insights/${encodeURIComponent(insightId)}?fetch=true`)
          .then((res) => {
            if (!res.ok) throw new Error(res.statusText);
            return res.json();
          })
          .then((data) => {
            if (data?.insight) {
              globalDrawer.openDrawer(data.insight);
            } else {
              router.push(
                `/?page=events&insightId=${encodeURIComponent(insightId)}`,
              );
            }
          })
          .catch(() => {
            router.push(
              `/?page=events&insightId=${encodeURIComponent(insightId)}`,
            );
          });
      } else {
        router.push(`/?page=events&insightId=${encodeURIComponent(insightId)}`);
      }
    },
    [globalDrawer, router],
  );

  /** Fixed display rule: Chat Vault groups by conversation; My notes / My files group by event (keep GroupByMode for future switching capability) */
  const effectiveGroupBy = (
    activeTab === "myfiles"
      ? "event"
      : activeTab === "mynotes"
        ? "event"
        : activeTab === "stuff"
          ? "conversation"
          : "none"
  ) as GroupByMode;

  const [filterType, setFilterType] = useState<FileTypeFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");

  // Workspace file pagination state
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileItem[]>([]);
  const [workspaceCursor, setWorkspaceCursor] = useState<string | null>(null);
  const [workspaceHasMore, setWorkspaceHasMore] = useState(true);
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);

  // Knowledge base file pagination state
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFile[]>([]);
  const [knowledgeCursor, setKnowledgeCursor] = useState<string | null>(null);
  const [knowledgeHasMore, setKnowledgeHasMore] = useState(true);
  const [loadingKnowledge, setLoadingKnowledge] = useState(true);

  // My notes: user notes from all events
  const [libraryNotes, setLibraryNotes] = useState<LibraryNoteItem[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);

  // Message loading state (current conversation)
  const [messages, setMessages] = useState<any[]>([]);

  // Metadata
  const [chatMeta, setChatMeta] = useState<LibraryMetaResponse["chats"]>({});

  // Preview panel state
  const [isPreviewPanelOpen, setIsPreviewPanelOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{
    path: string;
    name: string;
    type: string;
    taskId?: string;
  } | null>(null);

  /** My files: knowledge base document preview (open side panel) */
  const [previewKnowledgeDocumentId, setPreviewKnowledgeDocumentId] = useState<
    string | null
  >(null);

  /** My notes: add note dialog */
  const [isAddNoteDialogOpen, setIsAddNoteDialogOpen] = useState(false);
  const [addNoteDraft, setAddNoteDraft] = useState("");

  // Infinite load trigger ref
  const loadMoreRef = useRef<HTMLDivElement>(null);
  /** My files upload: hidden file input */
  const myFilesInputRef = useRef<HTMLInputElement>(null);

  // Use ref to store loading function to avoid circular dependency
  const loadWorkspaceFilesRef = useRef<
    ((refresh?: boolean) => Promise<void>) | undefined
  >(undefined);
  const loadKnowledgeFilesRef = useRef<
    ((refresh?: boolean) => Promise<void>) | undefined
  >(undefined);

  /** My files upload status */
  const [isUploadingMyFiles, setIsUploadingMyFiles] = useState(false);

  /**
   * Load workspace files (supports refresh)
   */
  const loadWorkspaceFiles = useCallback(
    async (refresh = false) => {
      if (refresh) {
        setLoadingWorkspace(true);
      }
      try {
        const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
        if (!refresh && workspaceCursor) {
          params.set("cursor", workspaceCursor);
        }
        const res = await fetch(`/api/workspace/files?${params.toString()}`);
        if (res.ok) {
          const data: PaginatedResponse<WorkspaceFileItem> & {
            files?: WorkspaceFileItem[];
          } = await res.json();
          const files = data.files || data.items || [];

          if (refresh) {
            setWorkspaceFiles(files);
            setWorkspaceCursor(data.nextCursor || null);
            setWorkspaceHasMore(!!data.hasMore);
          } else {
            // Use taskId + path as unique key for deduplication
            setWorkspaceFiles((prev) => {
              const existingKeys = new Set(
                prev.map((f) => `${f.taskId}:${f.path}`),
              );
              const newFiles = files.filter(
                (f) => !existingKeys.has(`${f.taskId}:${f.path}`),
              );
              return [...prev, ...newFiles];
            });
            setWorkspaceCursor(data.nextCursor || null);
            // If newly loaded files count is 0, loading is complete
            const noMoreFiles = files.length === 0;
            setWorkspaceHasMore(noMoreFiles ? false : !!data.hasMore);
          }
        } else {
          console.error(
            "[LibraryPage] loadWorkspaceFiles failed:",
            res.status,
            res.statusText,
          );
        }
      } catch (e) {
        console.error("[LibraryPage] loadWorkspaceFiles error:", e);
      } finally {
        setLoadingWorkspace(false);
      }
    },
    [workspaceCursor],
  );

  /**
   * Load knowledge base files (supports refresh)
   */
  const loadKnowledgeFiles = useCallback(
    async (refresh = false) => {
      if (refresh) {
        setLoadingKnowledge(true);
      }
      try {
        const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
        if (!refresh && knowledgeCursor) {
          params.set("cursor", knowledgeCursor);
        }
        const res = await fetch(`/api/rag/documents?${params.toString()}`);
        if (res.ok) {
          const data: PaginatedResponse<KnowledgeFile> & {
            documents?: KnowledgeFile[];
          } = await res.json();
          const docs = data.documents || data.items || [];

          if (refresh) {
            setKnowledgeFiles(docs);
            setKnowledgeCursor(data.nextCursor || null);
            setKnowledgeHasMore(!!data.hasMore);
          } else {
            // Use id for deduplication
            setKnowledgeFiles((prev) => {
              const existingIds = new Set(prev.map((f) => f.id));
              const newDocs = docs.filter((f) => !existingIds.has(f.id));
              return [...prev, ...newDocs];
            });
            setKnowledgeCursor(data.nextCursor || null);
            // If newly loaded files count is 0, loading is complete
            const noMoreDocs = docs.length === 0;
            setKnowledgeHasMore(noMoreDocs ? false : !!data.hasMore);
          }
        } else {
          console.error(
            "[LibraryPage] loadKnowledgeFiles failed:",
            res.status,
            res.statusText,
          );
        }
      } catch (e) {
        console.error("[LibraryPage] loadKnowledgeFiles error:", e);
      } finally {
        setLoadingKnowledge(false);
      }
    },
    [knowledgeCursor],
  );

  // Save loading functions to ref
  useEffect(() => {
    loadWorkspaceFilesRef.current = loadWorkspaceFiles;
    loadKnowledgeFilesRef.current = loadKnowledgeFiles;
  }, [loadWorkspaceFiles, loadKnowledgeFiles]);

  /**
   * My files: upload files to RAG, refresh list after success
   */
  const handleMyFilesUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
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
          await loadKnowledgeFiles(true);
          toast({
            type: "success",
            description: "File uploaded successfully",
          });
        } else {
          toast({
            type: "error",
            description: result.error || "File upload failed",
          });
        }
      } catch (err) {
        console.error("[My files] upload error:", err);
        const message =
          err instanceof Error ? err.message : "File upload failed";
        toast({
          type: "error",
          description: message,
        });
      } finally {
        setIsUploadingMyFiles(false);
      }
    },
    [loadKnowledgeFiles],
  );

  /**
   * My notes: pull all user notes from events
   */
  const loadLibraryNotes = useCallback(async (refresh = false) => {
    if (refresh) setLoadingNotes(true);
    try {
      const res = await fetch("/api/library/notes");
      if (res.ok) {
        const data: { notes: LibraryNoteItem[] } = await res.json();
        setLibraryNotes(data.notes ?? []);
      }
    } catch (e) {
      console.error("[LibraryPage] loadLibraryNotes error:", e);
    } finally {
      setLoadingNotes(false);
    }
  }, []);

  /**
   * My notes: delete note, remove from local list after success
   */
  const handleDeleteNote = useCallback(async (noteId: string) => {
    try {
      const res = await fetch(`/api/notes/${noteId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setLibraryNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch (err) {
      console.error("[My notes] delete error:", err);
    }
  }, []);

  /**
   * My notes: add note under "Public", refresh list after success
   */
  const handleAddNote = useCallback(
    async (content: string) => {
      try {
        const res = await fetch("/api/library/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: content.trim() }),
        });
        if (!res.ok) throw new Error("Create failed");
        await loadLibraryNotes(true);
      } catch (err) {
        console.error("[My notes] add note error:", err);
      }
    },
    [loadLibraryNotes],
  );

  /**
   * My files: delete knowledge base file, remove from local list after success
   */
  const handleDeleteKnowledgeFile = useCallback(async (documentId: string) => {
    try {
      const res = await fetch(`/api/rag/documents/${documentId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      setKnowledgeFiles((prev) => prev.filter((f) => f.id !== documentId));
    } catch (err) {
      console.error("[My files] delete error:", err);
    }
  }, []);

  /**
   * Chat vault: delete workspace file, and remove from local list after success.
   */
  const handleDeleteWorkspaceFile = useCallback(
    async (wf: { taskId: string; path: string }) => {
      try {
        const res = await fetch(
          `/api/workspace/file/${encodeURIComponent(wf.taskId)}/${encodeURIComponent(wf.path)}`,
          { method: "DELETE" },
        );
        if (!res.ok) throw new Error("Delete failed");
        setWorkspaceFiles((prev) =>
          prev.filter((f) => !(f.taskId === wf.taskId && f.path === wf.path)),
        );
      } catch (err) {
        console.error("[Chat vault] delete file error:", err);
      }
    },
    [],
  );

  /**
   * Load messages
   */
  const loadMessages = useCallback(async () => {
    if (!chatId) return;
    try {
      const res = await fetch(`/api/chat/${chatId}/messages`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch (e) {
      console.error("[LibraryPage] loadMessages:", e);
    }
  }, [chatId]);

  /**
   * Load more (infinite scroll): My files only loads knowledge base, Chat Vault only loads workspace
   */
  const loadMore = useCallback(async () => {
    if (activeTab === "myfiles") {
      if (loadingKnowledge || !knowledgeHasMore) return;
      await loadKnowledgeFiles(false);
    } else {
      if (loadingWorkspace || !workspaceHasMore) return;
      await loadWorkspaceFiles(false);
    }
  }, [
    activeTab,
    loadingWorkspace,
    loadingKnowledge,
    workspaceHasMore,
    knowledgeHasMore,
    loadWorkspaceFiles,
    loadKnowledgeFiles,
  ]);

  // Pull-to-refresh configuration
  const loadLibraryNotesRef =
    useRef<(refresh?: boolean) => Promise<void>>(loadLibraryNotes);
  useEffect(() => {
    loadLibraryNotesRef.current = loadLibraryNotes;
  }, [loadLibraryNotes]);

  // Whether there are filter conditions (disable pull-to-refresh when filtering, as filtering is only frontend, no need to re-request API)
  const hasFilter = filterType !== "all" || searchQuery.trim().length > 0;

  const {
    triggerRef,
    setupRefCallback: setupPullToRefresh,
    isRefreshing,
  } = usePullToRefresh({
    threshold: 60,
    maxDistance: 120,
    onRefresh: async () => {
      if (activeTab === "mynotes" && loadLibraryNotesRef.current) {
        await loadLibraryNotesRef.current(true);
      } else if (activeTab === "myfiles" && loadKnowledgeFilesRef.current) {
        await loadKnowledgeFilesRef.current(true);
      } else if (activeTab === "stuff" && loadWorkspaceFilesRef.current) {
        await loadWorkspaceFilesRef.current(true);
      }
    },
    enabled:
      !hasFilter &&
      (activeTab === "stuff" ||
        activeTab === "myfiles" ||
        activeTab === "mynotes"),
  });

  // Reset to "all" when switching to My files if currently filtering by "tools"
  useEffect(() => {
    if (activeTab === "myfiles" && filterType === "tools") {
      setFilterType("all");
    }
  }, [activeTab, filterType]);

  // Initial load
  useEffect(() => {
    loadWorkspaceFiles(true);
    loadKnowledgeFiles(true);
    loadLibraryNotes(true);
  }, [loadLibraryNotes]);

  // Load messages for current conversation
  useEffect(() => {
    if (chatId) loadMessages();
    else setMessages([]);
  }, [chatId, loadMessages]);

  // Listen to ScrollArea scroll, trigger infinite load
  useEffect(() => {
    const loadMoreElement = loadMoreRef.current;
    if (!loadMoreElement) return;

    const handleScroll = () => {
      const viewport = document.querySelector(
        "[data-radix-scroll-area-viewport]",
      ) as HTMLElement;
      if (!viewport) return;

      const { scrollTop, scrollHeight, clientHeight } = viewport;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 200;

      if (isNearBottom && (workspaceHasMore || knowledgeHasMore)) {
        loadMore();
      }
    };

    const viewport = document.querySelector(
      "[data-radix-scroll-area-viewport]",
    ) as HTMLElement;
    viewport?.addEventListener("scroll", handleScroll);
    return () => {
      viewport?.removeEventListener("scroll", handleScroll);
    };
  }, [workspaceHasMore, knowledgeHasMore, loadMore]);

  const toolExecutions = useMemo(
    () => extractToolExecutions(messages),
    [messages],
  );

  /** For Chat Vault: workspace files + tools only */
  const vaultItems = useMemo((): LibraryItem[] => {
    const items: LibraryItem[] = [];
    let wsIndex = 0;
    workspaceFiles
      .filter((f) => !f.isDirectory)
      .forEach((f) => {
        items.push({
          id: `ws-${wsIndex++}-${f.taskId}-${f.path}`,
          kind: "workspace_file",
          title: f.name,
          subtitle: f.taskId,
          date: f.modifiedTime ? new Date(f.modifiedTime) : new Date(),
          groupKey: f.taskId,
          workspaceFile: {
            taskId: f.taskId,
            path: f.path,
            name: f.name,
            type: f.type,
          },
        });
      });
    if (chatId) {
      toolExecutions.forEach((tool) => {
        items.push({
          id: `tool-${tool.id}`,
          kind: "tool",
          title: getToolDisplayName(tool.name, t),
          subtitle: undefined,
          date: tool.timestamp,
          groupKey: "tools",
          toolExecution: tool,
        });
      });
    }
    return items;
  }, [workspaceFiles, toolExecutions, chatId, t]);

  /** For My files: user-uploaded knowledge base files only; groupKey uses associated event id to support grouping by event */
  const myFilesItems = useMemo((): LibraryItem[] => {
    const items = knowledgeFiles.map((f) => ({
      id: `kb-${f.id}`,
      kind: "knowledge_file" as const,
      title: f.fileName,
      subtitle: undefined,
      date: new Date(f.uploadedAt),
      groupKey: f.insightId ?? "knowledge",
      knowledgeFile: f,
    }));
    return items;
  }, [knowledgeFiles]);

  /** Current tab's item list (used for filtering and grouping) */
  const allItems = useMemo(
    () => (activeTab === "myfiles" ? myFilesItems : vaultItems),
    [activeTab, myFilesItems, vaultItems],
  );

  /** Collect workspace-related chatIds, request library metadata (for Chat Vault grouping) */
  const uniqueChatIds = useMemo(() => {
    const ids = new Set<string>();
    vaultItems.forEach((item) => {
      if (
        item.groupKey &&
        item.groupKey !== "knowledge" &&
        item.groupKey !== "tools"
      ) {
        ids.add(item.groupKey);
      }
    });
    return Array.from(ids);
  }, [vaultItems]);

  useEffect(() => {
    if (uniqueChatIds.length === 0) {
      setChatMeta({});
      return;
    }
    const q = new URLSearchParams({ chatIds: uniqueChatIds.join(",") });
    fetch(`/api/library/meta?${q}`)
      .then((res) => (res.ok ? res.json() : { chats: {} }))
      .then((data: LibraryMetaResponse) => setChatMeta(data.chats ?? {}))
      .catch(() => setChatMeta({}));
  }, [uniqueChatIds.join(",")]);

  /** Filter by file type + tool + search */
  const filteredItems = useMemo(() => {
    let list = allItems;
    if (filterType === "tools") {
      list = list.filter((i) => i.kind === "tool");
    } else if (filterType !== "all") {
      list = list.filter((item) => {
        if (item.kind === "tool") return false;
        const cat = getFileTypeCategory(getExtFromItem(item));
        return cat === filterType;
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.subtitle?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [allItems, filterType, searchQuery]);

  /** Grouping (none / conversation / time / event / folder) */
  const grouped = useMemo(() => {
    const sortList = (arr: LibraryItem[]) =>
      [...arr].sort((a, b) => b.date.getTime() - a.date.getTime());

    if (effectiveGroupBy === "none") {
      return [
        {
          label: t("workspace.groupAll", "All"),
          items: sortList(filteredItems),
          key: "__all__",
        },
      ];
    }

    if (effectiveGroupBy === "conversation") {
      const map = new Map<string, LibraryItem[]>();
      filteredItems.forEach((item) => {
        const key = item.groupKey;
        if (!map.has(key)) map.set(key, []);
        map.get(key)?.push(item);
      });
      return Array.from(map.entries()).map(([key, list]) => {
        let label: string;
        if (key === "knowledge") label = t("workspace.knowledgeGroup");
        else if (key === "tools") label = t("workspace.toolsGroup");
        else
          label =
            chatMeta[key]?.title?.trim() || key || t("workspace.untitledChat");
        return { label, items: sortList(list), key };
      });
    }

    if (effectiveGroupBy === "time") {
      const byDay = new Map<string, LibraryItem[]>();
      filteredItems.forEach((item) => {
        const dayKey = item.date.toISOString().slice(0, 10);
        if (!byDay.has(dayKey)) byDay.set(dayKey, []);
        byDay.get(dayKey)?.push(item);
      });
      return Array.from(byDay.entries())
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([dayKey, list]) => ({
          label: getDateGroupLabel(
            new Date(`${dayKey}T12:00:00`),
            i18n.language,
          ),
          items: sortList(list),
          key: dayKey,
        }));
    }

    if (effectiveGroupBy === "event") {
      const map = new Map<string, LibraryItem[]>();
      const fallbackKey = "__unchained__";
      filteredItems.forEach((item) => {
        let key: string;
        // My files: knowledge base files with associated events are grouped by event
        if (
          item.kind === "knowledge_file" &&
          item.knowledgeFile?.insightId &&
          item.knowledgeFile?.insightTitle
        ) {
          key = `insight:${item.knowledgeFile.insightId}:${item.knowledgeFile.insightTitle}`;
        } else if (item.groupKey === "knowledge" || item.groupKey === "tools") {
          key = fallbackKey;
        } else {
          const meta = chatMeta[item.groupKey];
          const first = meta?.insights?.[0];
          key = first ? `insight:${first.id}:${first.title}` : fallbackKey;
        }
        if (!map.has(key)) map.set(key, []);
        map.get(key)?.push(item);
      });
      return Array.from(map.entries()).map(([key, list]) => {
        const label =
          key === fallbackKey
            ? activeTab === "myfiles"
              ? t("workspace.publicGroup")
              : t("workspace.unchainedEvent")
            : key.startsWith("insight:")
              ? key.replace(/^insight:[^:]+:/, "")
              : key;
        return { label, items: sortList(list), key };
      });
    }

    if (effectiveGroupBy === "folder") {
      const map = new Map<string, LibraryItem[]>();
      const uncategorizedKey = "__uncategorized__";
      filteredItems.forEach((item) => {
        let key: string;
        if (item.kind === "workspace_file" && item.workspaceFile?.path) {
          const folder = getFolderFromPath(item.workspaceFile.path);
          key = folder === "" ? "__root__" : folder;
        } else {
          key = uncategorizedKey;
        }
        if (!map.has(key)) map.set(key, []);
        map.get(key)?.push(item);
      });
      const rootLabel = t("workspace.groupRoot");
      const uncatLabel = t("workspace.groupUncategorized");
      return Array.from(map.entries())
        .sort(([a], [b]) => {
          if (a === "__root__") return -1;
          if (b === "__root__") return 1;
          if (a === uncategorizedKey) return 1;
          if (b === uncategorizedKey) return -1;
          return a.localeCompare(b);
        })
        .map(([key, list]) => ({
          label:
            key === "__root__"
              ? rootLabel
              : key === uncategorizedKey
                ? uncatLabel
                : key,
          items: sortList(list),
          key,
        }));
    }

    return [];
  }, [filteredItems, effectiveGroupBy, chatMeta, activeTab, t, i18n.language]);

  /** My notes: by search + grouping */
  const filteredNotes = useMemo(() => {
    let list = libraryNotes;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (n) =>
          n.content.toLowerCase().includes(q) ||
          n.insightTitle.toLowerCase().includes(q),
      );
    }
    return list;
  }, [libraryNotes, searchQuery]);

  const groupedNotes = useMemo(() => {
    const sortByDate = (arr: LibraryNoteItem[]) =>
      [...arr].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    if (effectiveGroupBy === "none" || activeTab !== "mynotes") {
      return [
        {
          label: t("workspace.groupAll", "All"),
          items: sortByDate(filteredNotes),
          key: "__all__",
        },
      ];
    }
    if (effectiveGroupBy === "time") {
      const byDay = new Map<string, LibraryNoteItem[]>();
      filteredNotes.forEach((n) => {
        const dayKey = new Date(n.createdAt).toISOString().slice(0, 10);
        if (!byDay.has(dayKey)) byDay.set(dayKey, []);
        byDay.get(dayKey)?.push(n);
      });
      return Array.from(byDay.entries())
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([dayKey, list]) => ({
          label: getDateGroupLabel(
            new Date(`${dayKey}T12:00:00`),
            i18n.language,
          ),
          items: sortByDate(list),
          key: dayKey,
        }));
    }
    if (effectiveGroupBy === "event") {
      const byEvent = new Map<string, LibraryNoteItem[]>();
      filteredNotes.forEach((n) => {
        const key = n.insightTitle.trim() || t("workspace.untitledChat");
        if (!byEvent.has(key)) byEvent.set(key, []);
        byEvent.get(key)?.push(n);
      });
      // Public groups use i18n display (backend common insight title is fixed as "Public")
      return Array.from(byEvent.entries()).map(([key, list]) => ({
        label: key === "Public" ? t("workspace.publicGroup") : key,
        items: sortByDate(list),
        key,
      }));
    }
    return [
      {
        label: t("workspace.groupAll", "All"),
        items: sortByDate(filteredNotes),
        key: "__all__",
      },
    ];
  }, [activeTab, effectiveGroupBy, filteredNotes, t, i18n.language]);

  const isLoading = isRefreshing
    ? false
    : activeTab === "mynotes"
      ? loadingNotes
      : activeTab === "myfiles"
        ? loadingKnowledge || isUploadingMyFiles
        : loadingWorkspace;
  // Disable infinite load when there are filter conditions (filtering is only frontend, no need to load more)
  const canLoadMore =
    hasFilter || activeTab === "mynotes"
      ? false
      : activeTab === "myfiles"
        ? knowledgeHasMore
        : workspaceHasMore;

  return (
    <>
      <div className="h-full flex-1 flex flex-col min-w-0">
        <div className="px-6 py-6">
          <div className="flex gap-1 rounded-lg border border-border/60 p-1 bg-surface-muted/50 overflow-x-auto no-scrollbar w-fit sm:shrink-0">
            <button
              type="button"
              onClick={() => setLibraryTab("myfiles")}
              className={cn(
                "flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 rounded-md text-sm font-medium transition-colors shrink-0",
                activeTab === "myfiles"
                  ? "bg-card text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface-hover",
              )}
            >
              <RemixIcon
                name="attachment"
                size="size-4"
                filled={activeTab === "myfiles"}
              />
              <span className="hidden xs:inline">
                {t("library.tabMyFiles", "My files")}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setLibraryTab("stuff")}
              className={cn(
                "flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 rounded-md text-sm font-medium transition-colors shrink-0",
                activeTab === "stuff"
                  ? "bg-card text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface-hover",
              )}
            >
              <RemixIcon
                name="folder_4_line"
                size="size-4"
                filled={activeTab === "stuff"}
              />
              <span className="hidden xs:inline">
                {t("library.tabChatVault", "Chat Vault")}
              </span>
            </button>
          </div>
        </div>

        {/* One row: view switch on left, search/filter/upload on right (shared layout for My notes, My files, Chat Vault) */}
        <div className="shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 px-6 py-0">
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
          <div className="flex items-center gap-2 shrink-0 min-w-0">
            <div className="relative w-full min-w-[120px] sm:w-48">
              <RemixIcon
                name="search"
                size="size-4"
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <Input
                placeholder={
                  activeTab === "mynotes"
                    ? t("workspace.searchPlaceholderNotes", "Search notes")
                    : t("workspace.searchPlaceholder", "Search files")
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-9 text-sm bg-muted/50 border border-border/60 rounded-md"
              />
            </div>
            {activeTab !== "mynotes" && (
              <Select
                value={
                  activeTab === "myfiles" && filterType === "tools"
                    ? "all"
                    : filterType
                }
                onValueChange={(v: FileTypeFilter) => setFilterType(v)}
              >
                <SelectTrigger
                  hideIcon
                  className={cn(
                    "h-9 w-9 p-0 shrink-0 [&>span:first-child]:flex [&>span:first-child]:flex-1 [&>span:first-child]:justify-center [&>span:first-child]:min-w-0 [&>span:first-child>*:not(:first-child)]:hidden [&>span:first-child>*:not(:first-child)]:w-0 [&>span:first-child>*:not(:first-child)]:overflow-hidden",
                    (activeTab === "myfiles" ? filterType !== "tools" : true) &&
                      filterType !== "all" &&
                      "bg-secondary border-primary/50",
                  )}
                  aria-label={t("workspace.filterAll")}
                >
                  <RemixIcon
                    name={
                      FILTER_ICON_MAP[
                        activeTab === "myfiles" && filterType === "tools"
                          ? "all"
                          : filterType
                      ]
                    }
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
                  {activeTab !== "myfiles" && (
                    <SelectItem value="tools">
                      <RemixIcon
                        name="layers"
                        size="size-4"
                        className="shrink-0 text-muted-foreground"
                      />
                      {t("workspace.filterTools")}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            )}
            {activeTab === "mynotes" && (
              <Button
                type="button"
                variant="default"
                size="sm"
                className="h-9 gap-1.5 shrink-0"
                onClick={() => setIsAddNoteDialogOpen(true)}
                aria-label={t("workspace.addNote", "Add note")}
              >
                <RemixIcon name="edit" size="size-4" />
                <span className="hidden xs:inline">
                  {t("workspace.addShort", "Add")}
                </span>
              </Button>
            )}
            {activeTab === "myfiles" && (
              <>
                <input
                  ref={myFilesInputRef}
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
                  onClick={() => myFilesInputRef.current?.click()}
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
              </>
            )}
          </div>
        </div>

        <ScrollArea ref={setupPullToRefresh} className="flex-1 min-h-0">
          {/* Pull-to-refresh trigger */}
          <div
            ref={triggerRef as LegacyRef<HTMLDivElement>}
            className="w-full h-1"
          />

          {isLoading ? (
            <div className="flex flex-row items-center p-2 text-muted-foreground justify-center">
              <Spinner size={20} />
              <div>{t("common.loading")}</div>
            </div>
          ) : activeTab === "mynotes" ? (
            groupedNotes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground text-sm">
                <RemixIcon
                  name="file_text"
                  size="size-10"
                  className="mb-2 opacity-50"
                />
                <p>{t("workspace.emptyStateMyNotes", "No notes yet")}</p>
              </div>
            ) : (
              <div key={effectiveGroupBy} className="px-6 py-3 space-y-6">
                {groupedNotes.map(({ label, items, key }) => (
                  <div key={key}>
                    <h2 className="text-sm font-medium text-muted-foreground mb-2">
                      {label}
                    </h2>
                    <ul
                      className={cn(
                        viewMode === "grid"
                          ? "grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-3 min-w-0"
                          : "space-y-3 min-w-0",
                      )}
                    >
                      {items.map((note) => (
                        <LibraryNoteRow
                          key={note.id}
                          note={note}
                          viewMode={viewMode}
                          t={t as (key: string, fallback?: string) => string}
                          onOpenEvent={handleOpenEvent}
                          onDeleteNote={handleDeleteNote}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )
          ) : grouped.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground text-sm">
              <RemixIcon
                name={activeTab === "myfiles" ? "file_input" : "folder_open"}
                size="size-10"
                className="mb-2 opacity-50"
              />
              <p>
                {activeTab === "myfiles"
                  ? t("workspace.emptyStateMyFiles", "No uploaded files")
                  : t("workspace.emptyState")}
              </p>
            </div>
          ) : (
            <div key={effectiveGroupBy} className="px-6 py-3 space-y-6">
              {grouped.map(({ label, items, key }) => (
                <div key={key}>
                  <h2 className="text-sm font-medium text-muted-foreground mb-2">
                    {label}
                  </h2>
                  <ul
                    className={cn(
                      viewMode === "grid"
                        ? "grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-3 min-w-0"
                        : "space-y-3 min-w-0",
                    )}
                  >
                    {items.map((item) => (
                      <LibraryItemRow
                        key={item.id}
                        item={item}
                        viewMode={viewMode}
                        t={t as (key: string, fallback?: string) => string}
                        onOpenFile={(wf) => {
                          setSelectedFile({
                            path: wf.path,
                            name: wf.name,
                            type: wf.type || "",
                            taskId: wf.taskId,
                          });
                          setIsPreviewPanelOpen(true);
                        }}
                        onLocateToChat={(chatId) =>
                          router.push(
                            `/?page=chat&chatId=${encodeURIComponent(chatId)}`,
                          )
                        }
                        onOpenEvent={
                          activeTab === "myfiles" ? handleOpenEvent : undefined
                        }
                        onPreviewKnowledgeFile={
                          activeTab === "myfiles"
                            ? setPreviewKnowledgeDocumentId
                            : undefined
                        }
                        onDeleteKnowledgeFile={
                          activeTab === "myfiles"
                            ? handleDeleteKnowledgeFile
                            : undefined
                        }
                        onDeleteWorkspaceFile={
                          activeTab === "stuff"
                            ? handleDeleteWorkspaceFile
                            : undefined
                        }
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* Infinite load trigger */}
          {canLoadMore && !isLoading && (
            <div ref={loadMoreRef} className="h-10 w-full">
              <div className="flex flex-row items-center p-2 text-muted-foreground justify-center">
                <Spinner size={20} />
                <div>{t("common.loading")}</div>
              </div>
            </div>
          )}
        </ScrollArea>

        {/* Storage space info display */}
        <StorageFooter />
      </div>

      {isPreviewPanelOpen && selectedFile && (
        <FilePreviewDrawerShell
          open={isPreviewPanelOpen}
          onClose={() => setIsPreviewPanelOpen(false)}
        >
          <FilePreviewPanel
            file={{
              path: selectedFile.path,
              name: selectedFile.name,
              type: selectedFile.type,
            }}
            taskId={selectedFile.taskId}
            onClose={() => setIsPreviewPanelOpen(false)}
          />
        </FilePreviewDrawerShell>
      )}

      {/* My files: knowledge base document preview sidebar */}
      {previewKnowledgeDocumentId && (
        <KnowledgeDocumentPreviewPanel
          documentId={previewKnowledgeDocumentId}
          onClose={() => setPreviewKnowledgeDocumentId(null)}
          t={t as (key: string, fallback?: string) => string}
        />
      )}

      {/* My notes: add note dialog (belongs to public) */}
      <Dialog open={isAddNoteDialogOpen} onOpenChange={setIsAddNoteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("workspace.addNote", "Add note")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t(
              "workspace.addNoteBelongCommon",
              "Notes will belong to 'Public'",
            )}
          </p>
          <Textarea
            placeholder={t(
              "workspace.addNotePlaceholder",
              "Enter note content...",
            )}
            value={addNoteDraft}
            onChange={(e) => setAddNoteDraft(e.target.value)}
            className="min-h-[120px] resize-y"
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsAddNoteDialogOpen(false);
                setAddNoteDraft("");
              }}
            >
              {t("common.cancel", "Cancel")}
            </Button>
            <Button
              disabled={!addNoteDraft.trim()}
              onClick={async () => {
                const content = addNoteDraft.trim();
                if (!content) return;
                await handleAddNote(content);
                setIsAddNoteDialogOpen(false);
                setAddNoteDraft("");
              }}
            >
              {t("common.confirm", "Confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Format bytes */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/** Storage space footer display component */
function StorageFooter() {
  const { t } = useTranslation();
  const router = useRouter();
  const { data: overview } = useDiskUsage();
  const { data: sessions } = useSessions();

  const isLoading = !overview;
  const totalBytes = overview?.totalBytes ?? 0;

  return (
    <div className="shrink-0 border-t border-border/60 bg-muted/20 px-6 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <RemixIcon name="hard_drive_3_line" size="size-3.5" />
            <span>
              {t("workspace.storage", "Storage")}:{" "}
              {isLoading ? "..." : formatBytes(totalBytes)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span>{t("workspace.storageCategory.sessions", "Sessions")}:</span>
            <span>{sessions.length}</span>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => router.push("/?page=storage-management")}
        >
          {t("workspace.storageManagement", "Manage")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Knowledge base document sidebar preview: shares {@link FilePreviewDrawerShell} and {@link FilePreviewDrawerHeader} with "My Files"; content area uses Pdf / Table / Markdown components consistent with library preview.
 */
function KnowledgeDocumentPreviewPanel({
  documentId,
  onClose,
  t,
}: {
  documentId: string;
  onClose: () => void;
  t: (key: string, fallback?: string) => string;
}) {
  const [doc, setDoc] = useState<{
    fileName: string;
    contentType?: string;
    blobPath?: string | null;
    chunks: Array<{ content: string; chunkIndex: number }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/rag/documents/${documentId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      })
      .then(
        (data: {
          document?: {
            fileName: string;
            contentType?: string;
            blobPath?: string | null;
            chunks?: Array<{ content: string; chunkIndex: number }>;
          };
        }) => {
          if (cancelled) return;
          const d = data.document;
          if (d) {
            setDoc({
              fileName: d.fileName,
              contentType: d.contentType,
              blobPath: d.blobPath ?? null,
              chunks: (d.chunks ?? []).sort(
                (a, b) => a.chunkIndex - b.chunkIndex,
              ),
            });
          }
        },
      )
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

  const displayName = doc?.fileName ?? documentId;

  const pdfBinaryUrl =
    doc?.contentType?.includes("pdf") && doc.blobPath
      ? `/api/rag/documents/${encodeURIComponent(documentId)}/binary`
      : null;

  const pdfDrawerModel = usePdfPreview(pdfBinaryUrl, {
    downloadFileName: doc?.fileName ?? "document.pdf",
    enabled: Boolean(pdfBinaryUrl),
  });

  const spreadsheetBinaryUrl =
    doc &&
    isKnowledgeSpreadsheetDocument(doc.contentType, doc.fileName) &&
    doc.blobPath
      ? `/api/rag/documents/${encodeURIComponent(documentId)}/binary`
      : null;

  const spreadsheetModel = useSpreadsheetPreview(spreadsheetBinaryUrl, {
    enabled: Boolean(spreadsheetBinaryUrl),
  });

  return (
    <FilePreviewDrawerShell onClose={onClose}>
      <div className="bg-background flex h-full min-h-0 flex-col">
        <FilePreviewDrawerHeader fileName={displayName}>
          {pdfBinaryUrl ? (
            <PdfPreviewHeaderToolbar model={pdfDrawerModel} />
          ) : null}
          {spreadsheetBinaryUrl ? (
            <SpreadsheetPreviewHeaderToolbar model={spreadsheetModel} />
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <DrawerHeaderIconButton
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={onClose}
                aria-label={t("common.close", "Close")}
              >
                <RemixIcon name="close" size="size-4" />
              </DrawerHeaderIconButton>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{t("common.close", "Close")}</p>
            </TooltipContent>
          </Tooltip>
        </FilePreviewDrawerHeader>
        <div className="flex min-h-0 flex-1 flex-col">
          {loading ? (
            <div className="flex flex-row items-center justify-center gap-2 p-2 text-muted-foreground">
              <Spinner size={20} />
              <div>{t("common.loading")}</div>
            </div>
          ) : error ? (
            <p className="px-4 py-3 text-sm text-destructive">{error}</p>
          ) : doc ? (
            pdfBinaryUrl ? (
              <PdfPreviewScrollBody
                model={pdfDrawerModel}
                maxHeight="100%"
                className="min-h-0 flex-1"
              />
            ) : spreadsheetBinaryUrl ? (
              <div className="flex min-h-[420px] flex-1 flex-col px-4 py-3">
                <SpreadsheetPreviewScrollBody
                  model={spreadsheetModel}
                  maxHeight="calc(100vh - 200px)"
                  className="min-h-0 flex-1"
                />
              </div>
            ) : (
              <div className="min-w-0 flex-1 overflow-auto break-words px-4 py-3 text-sm text-foreground">
                {doc.chunks.length === 0 ? (
                  <p className="text-muted-foreground">
                    {t("workspace.previewNoContent", "No content")}
                  </p>
                ) : (
                  <MarkdownWithCitations insights={[]}>
                    {doc.chunks.map((c) => c.content).join("\n\n")}
                  </MarkdownWithCitations>
                )}
              </div>
            )
          ) : null}
        </div>
      </div>
    </FilePreviewDrawerShell>
  );
}

/**
 * My notes card row: display note content preview, time, support opening event, deletion (don't show source event)
 */
function LibraryNoteRow({
  note,
  viewMode,
  t,
  onOpenEvent,
  onDeleteNote,
}: {
  note: LibraryNoteItem;
  viewMode: "list" | "grid";
  t: (key: string, fallback?: string) => string;
  onOpenEvent: (insightId: string) => void;
  onDeleteNote?: (noteId: string) => void;
}) {
  const contentPreview =
    note.content.length > 80
      ? `${note.content.slice(0, 80).trim()}…`
      : note.content;
  /** Unified time format and style (consistent with files, conversation space cards) */
  const dateLabel = new Date(note.createdAt).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });

  /** All are icon buttons, open event uses external_link; delete button placed on the far right */
  const actionButtons = (
    <div className="shrink-0 flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={(e) => {
          e.stopPropagation();
          onOpenEvent(note.insightId);
        }}
        aria-label={t("library.openEvent", "Open event")}
      >
        <RemixIcon name="external_link" size="size-4" />
      </Button>
      {onDeleteNote && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteNote(note.id);
          }}
          aria-label={t("common.delete", "Delete")}
        >
          <RemixIcon name="delete_bin" size="size-4" />
        </Button>
      )}
    </div>
  );

  if (viewMode === "grid") {
    return (
      <li className="w-full min-w-0">
        <div className="w-full min-w-0 flex flex-col items-stretch gap-1.5 p-3 rounded-lg border border-border/60 bg-card text-left overflow-hidden">
          <div className="shrink-0 rounded-md flex items-center justify-center size-10 text-amber-500">
            <RemixIcon name="file_text" size="size-6" />
          </div>
          <p className="text-sm font-medium line-clamp-2 break-words min-w-0 overflow-hidden">
            {contentPreview}
          </p>
          <p className="text-xs text-muted-foreground shrink-0">{dateLabel}</p>
          <div className="flex items-center gap-2 w-full flex-wrap shrink-0">
            {actionButtons}
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="w-full min-w-0">
      <div className="w-full min-w-0 flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-2 rounded-lg border border-border/60 bg-card text-left overflow-hidden">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-[8px] border border-border/60 p-0.5 text-amber-500">
          <RemixIcon name="file_text" size="size-5" />
        </div>
        <div className="min-w-0 flex-1 text-left space-y-0.5 overflow-hidden">
          <p className="text-sm line-clamp-2 break-words">{contentPreview}</p>
          <p className="text-xs text-muted-foreground truncate">{dateLabel}</p>
        </div>
        {actionButtons}
      </div>
    </li>
  );
}
