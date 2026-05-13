"use client";
import cx from "classnames";
import type React from "react";
import {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type Dispatch,
  type SetStateAction,
  memo,
} from "react";
import { toast } from "sonner";
import { useLocalStorage, useWindowSize } from "usehooks-ts";

import { ArrowUpIcon, StopIcon, LoaderIcon } from "./icons";
import { Textarea } from "./ui/textarea";
import { Button } from "./ui/button";
import { RemixIcon } from "@/components/remix-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { ScrollArea } from "./ui/scroll-area";
import { EventSearchDialog } from "./event-search-dialog";
import useSWR from "swr";
import { fetcher, fetcherWithCloudAuth } from "@/lib/utils";
import equal from "fast-deep-equal";
import type { UseChatHelpers } from "@ai-sdk/react";
import type { Attachment, ChatMessage } from "@openloomi/shared";
import { useTranslation } from "react-i18next";
import type { Insight } from "@/lib/db/schema";
import type { SuggestedPrompt } from "./suggested-actions";
import { SUPPORTED_FILE_EXTENSIONS } from "@/lib/files/config";
import { uploadFile, uploadRagFile } from "@/lib/files/upload";
import { getFileIcon, getFileColor } from "@/components/file-icons";
import { getSecureFileUrl } from "@/lib/files/secure-url";
import { formatBytes } from "@/lib/utils";
import { useChatContext } from "./chat-context";
import {
  buildRefMarker,
  extractRefsFromContent,
  getRefMarkerRangeBeforeCursor,
  type InlineRefKind,
} from "@openloomi/shared/ref";
import { InlineRefBadge } from "./inline-ref-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { getAuthToken } from "@/lib/auth/token-manager";
import { uploadImageTUS } from "@/lib/files/tus-upload";
import {
  MODELS,
  type ModelType,
  useModelPreference,
} from "@/components/agent/model-selector";

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
 * Mirror layer Ref Badge: precisely aligned with the original [[ref:kind:label]] markers in the textarea.
 * Uses transparent placeholder spans to match the same width as the markers, then overlays a styled pill,
 * achieving similar mention rendering to lexical-beautiful-mentions.
 */
function MirrorRefBadge({
  kind,
  label,
  t,
}: {
  kind: InlineRefKind;
  label: string;
  t: (key: string, fallback: string) => string;
}) {
  const marker = buildRefMarker(kind, label);
  return (
    <span className="relative inline-block align-baseline shrink-0" aria-hidden>
      {/* Transparent placeholder: same width as the same characters in textarea, ensuring consistent cursor/newline behavior */}
      <span className="invisible whitespace-pre select-none font-inherit text-inherit">
        {marker}
      </span>
      {/* Overlaid pill style, covering the full placeholder width */}
      <span className="absolute left-0 top-0 flex h-full min-h-[1.5em] w-full max-w-[120px] items-center overflow-hidden">
        <InlineRefBadge
          kind={kind}
          label={label}
          t={t}
          className="w-full min-w-0 max-w-[120px] truncate"
        />
      </span>
    </span>
  );
}

/** Workspace file list item */
type WorkspaceFileRef = { taskId: string; path: string; name: string };

function WorkspaceFilePickerContent({
  taskId,
  selectedRefs,
  onAdd,
  onRemove,
  onClose,
}: {
  taskId: string;
  selectedRefs: WorkspaceFileRef[];
  onAdd: (ref: WorkspaceFileRef) => void;
  onRemove: (path: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useSWR<{
    files: Array<{ name: string; path: string; type?: string }>;
  }>(
    taskId ? `/api/workspace/files?taskId=${encodeURIComponent(taskId)}` : null,
    fetcher,
  );
  const files = data?.files ?? [];
  return (
    <div className="flex flex-col gap-2 flex-1 min-h-0">
      <ScrollArea className="flex-1 min-h-[200px]">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t("common.loading", "Loading")}
          </div>
        ) : error || !data ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t(
              "chat.workspaceFilesEmpty",
              "No workspace files or loading failed",
            )}
          </div>
        ) : files.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t(
              "chat.workspaceFilesEmpty",
              "No workspace files in current conversation",
            )}
          </div>
        ) : (
          <div className="divide-y">
            {files.map((file) => {
              const ref: WorkspaceFileRef = {
                taskId,
                path: file.path,
                name: file.name,
              };
              const isSelected = selectedRefs.some(
                (r) => r.taskId === taskId && r.path === file.path,
              );
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() =>
                    isSelected ? onRemove(file.path) : onAdd(ref)
                  }
                  className={cx(
                    "w-full px-3 py-2 text-left text-sm hover:bg-muted/50",
                    isSelected && "bg-primary/10",
                  )}
                >
                  <span className="truncate block">{file.name}</span>
                  {file.path !== file.name && (
                    <span className="text-xs text-muted-foreground truncate block">
                      {file.path}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
      <Button variant="secondary" size="sm" onClick={onClose}>
        {t("common.done", "Done")}
      </Button>
    </div>
  );
}

/** Action item picker: after entering a title, insert it at the cursor position in the input as an inline reference */
function ReferencedTaskPickerContent({
  onInsert,
  onClose,
}: {
  onInsert: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [inputTitle, setInputTitle] = useState("");
  const handleAdd = () => {
    const title = inputTitle.trim();
    if (!title) return;
    const id = title.startsWith("manual:") ? title : `manual:${title}`;
    onInsert(id);
    setInputTitle("");
    onClose();
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {t(
          "chat.taskInsertHint",
          "Enter an action item title and click Add to insert at the cursor position.",
        )}
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={inputTitle}
          onChange={(e) => setInputTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder={t("chat.taskTitlePlaceholder", "Enter task title")}
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <Button type="button" size="sm" onClick={handleAdd}>
          {t("chat.add", "Add")}
        </Button>
      </div>
      <Button variant="secondary" size="sm" onClick={onClose}>
        {t("common.done", "Done")}
      </Button>
    </div>
  );
}

/** People picker: after clicking someone, insert them at the cursor position in the input as an inline reference */
function ReferencedPeoplePickerContent({
  onInsert,
  onClose,
}: {
  onInsert: (p: { id?: string; name: string }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data, error, isLoading } = useSWR<{
    people: Array<{ id?: string; name: string }>;
  }>("/api/people?limit=50", fetcherWithCloudAuth, {
    revalidateOnFocus: false,
  });
  const people = data?.people ?? [];
  return (
    <div className="flex flex-col gap-2 flex-1 min-h-0">
      <p className="text-sm text-muted-foreground">
        {t(
          "chat.peopleInsertHint",
          "Click on a person name to insert it at the cursor in the input box.",
        )}
      </p>
      <ScrollArea className="flex-1 min-h-[200px]">
        {error ? (
          <div className="py-8 text-center text-sm text-destructive">
            {t(
              "chat.peopleLoadFailed",
              "Failed to load people list, please try again later",
            )}
          </div>
        ) : isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t("common.loading", "Loading")}
          </div>
        ) : (
          <div className="divide-y">
            {people.map((person) => {
              const name =
                person.name ||
                (person as { displayName?: string }).displayName ||
                "";
              if (!name) return null;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    onInsert({ id: person.id, name });
                    onClose();
                  }}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-muted/50"
                >
                  {name}
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
      <Button variant="secondary" size="sm" onClick={onClose}>
        {t("common.done", "Done")}
      </Button>
    </div>
  );
}

/** Channel picker: after entering name and platform, insert it at the cursor position in the input as an inline reference */
function ReferencedChannelPickerContent({
  onInsert,
  onClose,
}: {
  onInsert: (c: { name: string; platform?: string }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [channelName, setChannelName] = useState("");
  const [platform, setPlatform] = useState<string>("");
  const handleAdd = () => {
    const name = channelName.trim();
    if (!name) return;
    onInsert({ name, platform: platform || undefined });
    setChannelName("");
    setPlatform("");
    onClose();
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {t(
          "chat.channelInsertHint",
          "Fill in the channel name and platform, then click Add to insert at the cursor position.",
        )}
      </p>
      <div className="flex flex-col gap-2">
        <input
          type="text"
          value={channelName}
          onChange={(e) => setChannelName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder={t("chat.channelNamePlaceholder", "Channel name")}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">
            {t("chat.channelPlatformOptional", "Platform (optional)")}
          </option>
          <option value="Slack">Slack</option>
          <option value="Discord">Discord</option>
          <option value="other">
            {t("chat.channelPlatformOther", "Other")}
          </option>
        </select>
        <Button type="button" size="sm" onClick={handleAdd}>
          {t("chat.add", "Add")}
        </Button>
      </div>
      <Button variant="secondary" size="sm" onClick={onClose}>
        {t("common.done", "Done")}
      </Button>
    </div>
  );
}

/** @ cascade sub-view: People (unified popup + global search + select one as badge) */
function AtMentionPeopleList({
  onSelect,
  onBack,
}: {
  onSelect: (p: { id?: string; name: string }) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  type Person = { id?: string; name: string; displayName?: string };
  return (
    <AtMentionSearchableList<Person>
      onBack={onBack}
      searchPlaceholder={t("chat.searchPeople", "Search people")}
      getItemKey={(p) => p.id ?? p.name}
      getItemLabel={(p) => p.name || p.displayName || ""}
      onSelect={(p) => {
        const name = p.name || (p as Person).displayName || "";
        if (name) onSelect({ id: p.id, name });
      }}
      emptyMessage={t("chat.peopleLoadFailed", "Failed to load people list")}
      fetchConfig={{
        getFetchKey: (q) =>
          `/api/people?limit=100${q ? `&search=${encodeURIComponent(q)}` : ""}`,
        parseResponse: (d: unknown) =>
          (d as { people?: Person[] })?.people ?? [],
      }}
    />
  );
}

/** Single task file item (when API is called with taskId) */
type WorkspaceFileSingle = {
  name: string;
  path: string;
  type?: string;
  isDirectory?: boolean;
};
/** Full workspace file item (when API is called without taskId, each item carries taskId) */
type WorkspaceFileWithTaskId = WorkspaceFileSingle & { taskId: string };

/** @ cascade sub-view: Workspace file list. Without taskId searches the entire workspace; with taskId only the current task (compatible with legacy usage) */
function AtMentionWorkspaceFileList({
  taskId,
  selectedRefs,
  onAdd,
  onBack,
}: {
  taskId?: string;
  selectedRefs: Array<{ taskId: string; path: string; name: string }>;
  onAdd: (ref: { taskId: string; path: string; name: string }) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const url =
    taskId != null
      ? `/api/workspace/files?taskId=${encodeURIComponent(taskId)}`
      : "/api/workspace/files";
  const { data, isLoading, error } = useSWR<{
    files: Array<WorkspaceFileSingle | WorkspaceFileWithTaskId>;
    scope?: "workspace";
  }>(url, fetcher);
  // Filter out directories - only show actual files
  const files = (data?.files ?? []).filter((file) => !file.isDirectory);
  const isFullWorkspace = taskId == null;

  return (
    <div className="flex flex-col gap-1 h-[240px] overflow-hidden">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded -ml-1"
      >
        <RemixIcon
          name="chevron_right"
          size="size-3.5"
          className="rotate-180"
        />
        {t("common.back", "Back")}
      </button>
      <ScrollArea className="flex-1 min-h-0">
        {isLoading ? (
          <div className="py-4 text-center text-sm text-muted-foreground">
            {t("common.loading", "Loading")}
          </div>
        ) : error || !data ? (
          <div className="py-4 text-center text-sm text-muted-foreground">
            {t("chat.workspaceFilesEmpty", "No workspace files")}
          </div>
        ) : files.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted-foreground">
            {t(
              "chat.workspaceFilesEmpty",
              "No workspace files in current conversation",
            )}
          </div>
        ) : (
          <div className="divide-y">
            {files.map((file) => {
              const fileTaskId = isFullWorkspace
                ? (file as WorkspaceFileWithTaskId).taskId
                : (taskId ?? "");
              const ref = {
                taskId: fileTaskId,
                path: file.path,
                name: file.name,
              };
              const isSelected = selectedRefs.some(
                (r) => r.taskId === ref.taskId && r.path === ref.path,
              );
              const key = `${ref.taskId}:${ref.path}`;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onAdd(ref)}
                  className={cx(
                    "w-full px-3 py-2 text-left text-sm hover:bg-accent",
                    isSelected && "bg-primary/10",
                  )}
                >
                  <span className="truncate block">{file.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

/** Unified searchable popup: search box on top + item list below, supports selecting one item as badge after global search to add to conversation */
function AtMentionSearchableList<T>({
  onBack,
  searchPlaceholder,
  items: itemsProp,
  getItemKey,
  getItemLabel,
  onSelect,
  emptyMessage,
  isLoading: isLoadingProp,
  extraSlot,
  addRow,
  fetchConfig,
}: {
  onBack: () => void;
  searchPlaceholder: string;
  items?: T[];
  getItemKey: (item: T) => string;
  getItemLabel: (item: T) => string;
  onSelect: (item: T) => void;
  emptyMessage?: string;
  isLoading?: boolean;
  /** @deprecated Use addRow instead, unified with events/people as "search + list" only */
  extraSlot?: React.ReactNode;
  /** A single row at the bottom of the list (e.g. "+ Add new action item"), same style as list, not a separate block */
  addRow?: React.ReactNode;
  /** Fetch by search keyword for server-side search (e.g. people); if not passed, uses items + client-side filtering */
  fetchConfig?: {
    getFetchKey: (query: string) => string;
    parseResponse: (data: unknown) => T[];
  };
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [query]);

  const fetchKey = fetchConfig
    ? fetchConfig.getFetchKey(debouncedQuery.trim())
    : null;
  const { data: fetchData, isLoading: fetchLoading } = useSWR<unknown>(
    fetchKey,
    fetcher,
    { revalidateOnFocus: false },
  );
  const fetchedItems =
    fetchConfig && fetchKey
      ? (fetchConfig.parseResponse(fetchData ?? {}) ?? [])
      : [];
  const items = itemsProp ?? fetchedItems;
  const isLoading = isLoadingProp ?? (fetchConfig ? fetchLoading : false);
  const filtered = useMemo(() => {
    let result: T[];
    if (fetchConfig) {
      result = items;
    } else {
      const q = query.trim().toLowerCase();
      if (!q) {
        result = items;
      } else {
        result = items.filter((item) =>
          getItemLabel(item).toLowerCase().includes(q),
        );
      }
    }
    // Deduplicate items by key to avoid React key conflicts
    const seen = new Set<string>();
    return result.filter((item) => {
      const key = getItemKey(item);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }, [items, query, getItemLabel, fetchConfig]);
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded -ml-1 self-start"
      >
        <RemixIcon
          name="chevron_right"
          size="size-3.5"
          className="rotate-180"
        />
        {t("common.back", "Back")}
      </button>
      <div className="relative flex items-center">
        <RemixIcon
          name="search"
          size="size-4"
          className="absolute left-2.5 text-muted-foreground pointer-events-none"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          autoFocus
        />
      </div>
      <div className="overflow-y-auto overflow-x-hidden">
        {isLoading ? (
          <div className="py-4 text-center text-sm text-muted-foreground">
            {t("common.loading", "Loading")}
          </div>
        ) : filtered.length === 0 && !extraSlot && !addRow ? (
          <div className="py-4 text-center text-sm text-muted-foreground">
            {emptyMessage ?? t("chat.noMatch", "No matching items")}
          </div>
        ) : (
          <div className="divide-y">
            {filtered.map((item) => (
              <button
                key={getItemKey(item)}
                type="button"
                onClick={() => onSelect(item)}
                className="w-full px-3 py-2 text-left text-sm hover:bg-accent rounded-sm"
              >
                <span className="truncate block">{getItemLabel(item)}</span>
              </button>
            ))}
            {addRow != null ? (
              <div className="border-t border-border/60">{addRow}</div>
            ) : null}
            {extraSlot != null ? (
              <div className="border-t border-border/60 pt-2 mt-1">
                {extraSlot}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

/** Unified file card: same style for local upload, RAG documents and workspace files, source distinguished in top-right corner */
function UnifiedFileCard({
  variant,
  attachment,
  workspaceRef,
  ragDoc,
  onRemove,
  isUploading,
}:
  | {
      variant: "local";
      attachment: Attachment;
      workspaceRef?: undefined;
      ragDoc?: undefined;
      onRemove: () => void;
      isUploading?: boolean;
    }
  | {
      variant: "workspace";
      attachment?: undefined;
      workspaceRef: { taskId: string; path: string; name: string };
      ragDoc?: undefined;
      onRemove: () => void;
      isUploading?: boolean;
    }
  | {
      variant: "rag";
      attachment?: undefined;
      workspaceRef?: undefined;
      ragDoc: { id: string; name: string };
      onRemove: () => void;
      isUploading?: boolean;
    }) {
  const { t } = useTranslation();
  const [imageLoadError, setImageLoadError] = useState(false);
  const isLocal = variant === "local";
  const isRag = variant === "rag";
  const name = isLocal
    ? attachment?.name
    : isRag
      ? ragDoc?.name
      : workspaceRef?.name;
  const displayUrl =
    isLocal && attachment ? getSecureFileUrl(attachment) : null;
  const isImage =
    isLocal && Boolean(attachment?.contentType?.startsWith("image/"));
  const showImage = isImage && displayUrl && !imageLoadError;

  const sourceLabel =
    isLocal || isRag
      ? t("chat.fileSourceLocal", "Local upload")
      : t("chat.fileSourceWorkspace", "In workspace");

  return (
    <div
      className={cx(
        "relative flex w-32 min-w-32 shrink-0 flex-col rounded-lg border border-border/50 bg-muted/40 p-2",
      )}
      data-testid={
        isLocal
          ? "input-attachment-preview"
          : isRag
            ? "rag-document-card"
            : "workspace-file-card"
      }
    >
      {/* Top-right: source label, workspace ⋮ (desktop), remove */}
      <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1">
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {sourceLabel}
        </span>
        {variant === "workspace" && workspaceRef && isTauriEnv ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="rounded-full bg-black/50 p-1 text-white hover:bg-black/70 transition-colors"
                aria-label={t("common.more", "More")}
              >
                <RemixIcon name="more_2" size="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-40 w-max max-w-[min(100vw-2rem,16rem)]"
            >
              <DropdownMenuItem
                onClick={async (e) => {
                  e.stopPropagation();
                  const { openWorkspaceFileInSystemDefaultApp } =
                    await import("@/lib/files/open-workspace-file-locally");
                  const r = await openWorkspaceFileInSystemDefaultApp({
                    taskId: workspaceRef.taskId,
                    path: workspaceRef.path,
                  });
                  if (!r.ok && r.reason !== "not_tauri") {
                    toast.error(
                      r.reason === "missing_file"
                        ? t(
                            "library.openWithLocalAppNotFound",
                            "File not found on this computer",
                          )
                        : t(
                            "library.openWithLocalAppFailed",
                            "Could not open the file with a default app",
                          ),
                    );
                  }
                }}
              >
                <RemixIcon name="folder_open" size="size-4" className="mr-2" />
                {t("library.openWithLocalApp", "Open with default app")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={async (e) => {
                  e.stopPropagation();
                  const { revealWorkspaceFileInParentFolder } =
                    await import("@/lib/files/open-workspace-file-locally");
                  const r = await revealWorkspaceFileInParentFolder({
                    taskId: workspaceRef.taskId,
                    path: workspaceRef.path,
                  });
                  if (!r.ok && r.reason !== "not_tauri") {
                    toast.error(
                      r.reason === "missing_file"
                        ? t(
                            "library.openWithLocalAppNotFound",
                            "File not found on this computer",
                          )
                        : t(
                            "library.revealInFolderFailed",
                            "Could not open the folder in the file manager",
                          ),
                    );
                  }
                }}
              >
                <RemixIcon name="folder_2" size="size-4" className="mr-2" />
                {t("library.revealInFolder", "Show in folder")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <button
          type="button"
          onClick={onRemove}
          className="rounded-full bg-black/50 p-1 text-white hover:bg-black/70 transition-colors disabled:opacity-50"
          disabled={isUploading}
          aria-label={t("common.remove", "Remove")}
        >
          <RemixIcon name="close" size="size-3" />
        </button>
      </div>

      {/* Preview area: uniform height */}
      <div className="relative flex h-20 w-full items-center justify-center overflow-hidden rounded-md bg-background/80">
        {isLocal && showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={displayUrl ?? ""}
            alt={name ?? ""}
            className="size-full object-cover"
            onError={() => setImageLoadError(true)}
          />
        ) : isLocal ? (
          <RemixIcon
            name="file_text"
            size="size-7"
            className="text-muted-foreground"
          />
        ) : isRag ? (
          (() => {
            const FileIcon = getFileIcon(ragDoc?.name ?? "");
            const fileColor = getFileColor(ragDoc?.name ?? "");
            return <FileIcon className={cx("h-7 w-7", fileColor)} />;
          })()
        ) : (
          (() => {
            const FileIcon = getFileIcon(workspaceRef?.name ?? "");
            const fileColor = getFileColor(workspaceRef?.name ?? "");
            return <FileIcon className={cx("h-7 w-7", fileColor)} />;
          })()
        )}
        {isLocal && isUploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 text-white">
            <span className="animate-spin">
              <LoaderIcon size={20} />
            </span>
          </div>
        )}
      </div>

      {/* File name */}
      <div className="mt-1.5 truncate text-xs font-medium text-foreground">
        {name}
      </div>
      {isLocal && attachment?.sizeBytes != null && (
        <div className="text-[10px] text-muted-foreground">
          {formatBytes(attachment.sizeBytes)}
        </div>
      )}
    </div>
  );
}

/** Pending upload file card: shows files being uploaded */
function PendingUploadCard({
  name,
  type,
  onRemove,
}: {
  name: string;
  type: "image" | "document";
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const isImage = type === "image";

  return (
    <div
      className={cx(
        "relative flex w-32 min-w-32 shrink-0 flex-col rounded-lg border border-border/50 bg-muted/40 p-2",
      )}
    >
      {/* Top-right: uploading label + remove button */}
      <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1">
        <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary animate-pulse">
          {t("chat.uploading", "Uploading")}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-full bg-black/50 p-1 text-white hover:bg-black/70 transition-colors"
          aria-label={t("common.remove", "Remove")}
        >
          <RemixIcon name="close" size="size-3" />
        </button>
      </div>

      {/* Preview area: uniform height */}
      <div className="relative flex h-20 w-full items-center justify-center overflow-hidden rounded-md bg-background/80">
        {isImage ? (
          <RemixIcon
            name="image"
            size="size-7"
            className="text-muted-foreground"
          />
        ) : (
          <RemixIcon
            name="file_text"
            size="size-7"
            className="text-muted-foreground"
          />
        )}
        {/* Upload overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <span className="animate-spin text-white">
            <LoaderIcon size={20} />
          </span>
        </div>
      </div>

      {/* File name */}
      <div className="mt-1.5 truncate text-xs font-medium text-foreground">
        {name}
      </div>
    </div>
  );
}

/** @ cascade sub-view: Action items (consistent with events/people: action items displayed by default, 5 by default) */
function AtMentionTaskForm({
  onInsert,
  onBack,
}: {
  onInsert: (id: string) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const { data, isLoading } = useSWR<{
    tasks: Array<{ id: string; title: string }>;
  }>("/api/mention/tasks?limit=50", fetcher, { revalidateOnFocus: false });
  const items = data?.tasks ?? [];
  return (
    <AtMentionSearchableList<{ id: string; title: string }>
      onBack={onBack}
      searchPlaceholder={t("chat.searchTasks", "Search tasks")}
      items={items}
      getItemKey={(item) => item.id}
      getItemLabel={(item) => item.title}
      onSelect={(item) => onInsert(item.id)}
      emptyMessage={t("chat.noTasksHint", "No tasks yet")}
      isLoading={isLoading}
    />
  );
}

/** @ cascade sub-view: Channels (consistent with events/people: channels displayed by default, 5 by default) */
function AtMentionChannelForm({
  onInsert,
  onBack,
}: {
  onInsert: (c: { name: string; platform?: string }) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const { data, isLoading } = useSWR<{
    channels: Array<{ name: string; platform?: string; description?: string }>;
  }>("/api/mention/channels?limit=200", fetcher, { revalidateOnFocus: false });
  const items = data?.channels ?? [];
  const getChannelLabel = (c: { name: string; platform?: string }) =>
    c.platform ? `${c.name} (${c.platform})` : c.name;
  return (
    <AtMentionSearchableList<{ name: string; platform?: string }>
      onBack={onBack}
      searchPlaceholder={t("chat.searchChannels", "Search channels")}
      items={items}
      getItemKey={(c) => (c.platform ? `${c.name}:${c.platform}` : c.name)}
      getItemLabel={getChannelLabel}
      onSelect={(c) => onInsert(c)}
      emptyMessage={t("chat.noChannelsHint", "No channels")}
      isLoading={isLoading}
    />
  );
}

/** @ cascade sub-view: Events (unified popup + global search + select one as badge) */
function AtMentionEventList({
  onSelect,
  onBack,
}: {
  onSelect: (insight: { id: string; title?: string | null }) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();

  return (
    <AtMentionSearchableList<{ id: string; title?: string | null }>
      onBack={onBack}
      searchPlaceholder={t("chat.searchEvents", "Search events")}
      getItemKey={(i) => i.id}
      getItemLabel={(i) => i.title || i.id}
      onSelect={onSelect}
      emptyMessage={t(
        "chat.noEventsHint",
        "No events, please focus or add an event first",
      )}
      fetchConfig={{
        getFetchKey: (q) => {
          // Use search API when there is a search term, recent events API when there is no search term
          if (q) {
            return `/api/search?q=${encodeURIComponent(q)}&types=events&limit=50`;
          }
          return "/api/insights?limit=50&days=0";
        },
        parseResponse: (data: unknown) => {
          // Search API response format: { events: SearchResultItem[] }
          // Recent events API response format: { items: Insight[] }
          const searchResult = data as
            | { events?: Array<{ id: string; title?: string | null }> }
            | undefined;
          if (searchResult?.events) {
            return searchResult.events;
          }
          const listResult = data as
            | { items?: Array<{ id: string; title?: string | null }> }
            | undefined;
          return listResult?.items ?? [];
        },
      }}
    />
  );
}

function PureMultimodalInput({
  chatId,
  input,
  setInput,
  stop,
  attachments,
  setAttachments,
  setMessages,
  sendMessage,
  className,
  selectedInsight,
  remainingSuggestions = [],
  onSuggestionClick,
}: {
  chatId: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  stop: () => void;
  attachments: Array<Attachment>;
  setAttachments: Dispatch<SetStateAction<Array<Attachment>>>;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  className?: string;
  selectedInsight?: Insight;
  remainingSuggestions?: SuggestedPrompt[];
  onSuggestionClick?: (suggestion: SuggestedPrompt) => void;
}) {
  const {
    focusedInsights,
    clearFocusedInsights,
    toggleFocusedInsight,
    isAgentRunning,
  } = useChatContext();
  const { t } = useTranslation();
  const [selectedModel, setSelectedModel] = useModelPreference();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputWrapperRef = useRef<HTMLDivElement>(null);
  const atMentionListRef = useRef<HTMLDivElement>(null);
  const slashListRef = useRef<HTMLDivElement>(null);
  const suggestionsContainerRef = useRef<HTMLDivElement>(null);

  /** @ dropdown: open state and fuzzy query after current input */
  const [isAtMentionOpen, setIsAtMentionOpen] = useState(false);
  /** / skill dropdown: open state and fuzzy query after current input (consistent with @ interaction) */
  const [isSlashOpen, setIsSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const slashRangeRef = useRef<{ start: number; end: number } | null>(null);
  const [slashHighlightedIndex, setSlashHighlightedIndex] = useState(0);
  const slashHighlightedItemRef = useRef<HTMLButtonElement | null>(null);
  const [atMentionQuery, setAtMentionQuery] = useState("");
  /** Replacement range when typing @; replaced by the selected item when inserting */
  const atMentionRangeRef = useRef<{ start: number; end: number } | null>(null);
  /** Sync cursor position after each input, used to calculate query after @ */
  const lastSelectionStartRef = useRef(0);
  /** Cursor position to restore after Backspace deletes the entire ref */
  const pendingSelectionAfterDeleteRef = useRef<number | null>(null);

  /** @ cascade dropdown single item type (with optional separator mark) */
  type AtMentionCategoryItem = {
    id: string;
    label: string;
    shortLabel: string;
    icon: string;
    dividerAfter?: boolean;
  };

  /** @ cascade dropdown category config: file types (from workspace/local upload) are pinned to top, separated from other items by divider */
  const atMentionCategories = useMemo<AtMentionCategoryItem[]>(
    () => [
      {
        id: "workspaceFile",
        label: t("chat.workspaceFiles", "Select files from workspace"),
        shortLabel: t("chat.addFileFromWorkspace", "Add files from workspace"),
        icon: "folder_open",
      },
      {
        id: "file",
        label: t("chat.uploadFile", "Upload file"),
        shortLabel: t("chat.uploadFileFromLocal", "Upload files from local"),
        icon: "attachment",
        dividerAfter: true,
      },
      {
        id: "event",
        label: t("chat.addEvent", "Add event"),
        shortLabel: t("chat.categoryEvent", "Event"),
        icon: "add",
      },
    ],
    [t],
  );

  /** Currently selected sub-category (cascading options in current container, not a separate popup) */
  const [atMentionSelectedCategory, setAtMentionSelectedCategory] = useState<
    string | null
  >(null);
  /** Keyboard-highlighted category index in cascade menu (only first-level category list) */
  const [atMentionHighlightedIndex, setAtMentionHighlightedIndex] = useState(0);

  /** Fuzzy filter categories by query (matches shortLabel / label / id, convenient for search results) */
  const filteredAtMentionCategories = useMemo(() => {
    const q = atMentionQuery.trim().toLowerCase();
    if (!q) return atMentionCategories;
    return atMentionCategories.filter(
      (c) =>
        c.shortLabel.toLowerCase().includes(q) ||
        c.label.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q),
    );
  }, [atMentionCategories, atMentionQuery]);

  /** Skill list (/ button and selecting skill after typing /) */
  type SkillItem = {
    id: string;
    name: string;
    description?: string;
    version?: string;
    author?: string;
    argumentHint?: string;
  };
  const { data: skillsData } = useSWR<{
    success: boolean;
    skills: SkillItem[];
  }>("/api/workspace/skills", fetcher, { revalidateOnFocus: false });
  const skillsList = skillsData?.skills ?? [];
  const filteredSlashSkills = useMemo(() => {
    const q = slashQuery.trim().toLowerCase();
    if (!q) return skillsList;
    return skillsList.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        (s.description ?? "").toLowerCase().includes(q),
    );
  }, [skillsList, slashQuery]);

  /** Insert /skillId at cursor; if a /-triggered replacement range exists, replace it first, and auto-add space after insertion */
  const insertSlashSkillAtCursor = useCallback(
    (skillId: string, replaceRange?: { start: number; end: number }) => {
      const range = replaceRange ?? slashRangeRef.current;
      let start: number;
      let end: number;
      if (range) {
        start = range.start;
        end = range.end;
        slashRangeRef.current = null;
      } else {
        start = end = lastCursorRef.current;
      }
      const token = `/${skillId} `;
      setInput((prev) => prev.slice(0, start) + token + prev.slice(end));
      lastCursorRef.current = start + token.length;
      // Clear slash state, prevent triggering menu from reopening
      setSlashQuery("");
      setIsSlashOpen(false);
      setTimeout(() => textareaRef.current?.focus(), 0);
    },
    [setInput, setSlashQuery],
  );

  /** After selecting a category, enter the cascade sub-view (no popup); only "file" directly triggers upload */
  const handleAtMentionSelectCategory = useCallback((id: string) => {
    lastCursorRef.current = textareaRef.current?.selectionStart ?? input.length;
    if (id === "file") {
      fileInputRef.current?.click();
      setIsAtMentionOpen(false);
      setAtMentionSelectedCategory(null);
      return;
    }
    setAtMentionSelectedCategory(id);
  }, []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; scrollLeft: number } | null>(null);
  const hasDraggedRef = useRef(false);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  /** Pending upload file list (shows uploading state) */
  const [pendingUploads, setPendingUploads] = useState<
    Array<{ id: string; name: string; type: "image" | "document"; file: File }>
  >([]);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragCounterRef = useRef(0);
  const [isEventSearchDialogOpen, setIsEventSearchDialogOpen] = useState(false);
  const [uploadedRagDocuments, setUploadedRagDocuments] = useState<
    Array<{ id: string; name: string }>
  >([]);
  /** File references selected from workspace (taskId is usually chatId) */
  const [workspaceFileRefs, setWorkspaceFileRefs] = useState<
    Array<{ taskId: string; path: string; name: string }>
  >([]);
  /** Cursor position used when inserting people/action items/channels (saved when opening picker) */
  const lastCursorRef = useRef(0);
  const [isWorkspaceFilePickerOpen, setIsWorkspaceFilePickerOpen] =
    useState(false);
  const [isTaskPickerOpen, setIsTaskPickerOpen] = useState(false);
  const [isPeoplePickerOpen, setIsPeoplePickerOpen] = useState(false);
  const [isChannelPickerOpen, setIsChannelPickerOpen] = useState(false);

  /** Insert inline reference marker at cursor; if an @-triggered replacement range exists, replace it first. Auto-append space after insertion for convenient continued typing (reference: lexical-beautiful-mentions automatic spacing). For events, label is recommended as id|title. */
  const insertRefAtCursor = useCallback(
    (
      kind: "people" | "task" | "channel" | "event",
      label: string,
      replaceRange?: { start: number; end: number },
    ) => {
      const range = replaceRange ?? atMentionRangeRef.current;
      let start: number;
      let end: number;
      if (range) {
        start = range.start;
        end = range.end;
        atMentionRangeRef.current = null;
      } else {
        start = end = lastCursorRef.current;
      }
      const marker = buildRefMarker(kind, label);
      const trailingSpace = " ";
      setInput(
        (prev) =>
          prev.slice(0, start) + marker + trailingSpace + prev.slice(end),
      );
      lastCursorRef.current = start + marker.length + trailingSpace.length;
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 0);
    },
    [setInput],
  );

  // Use ref to store the latest RAG document list, avoiding closure issues
  const uploadedRagDocumentsRef = useRef<Array<{ id: string; name: string }>>(
    [],
  );

  // Sync state and ref
  useEffect(() => {
    uploadedRagDocumentsRef.current = uploadedRagDocuments;
  }, [uploadedRagDocuments]);

  const { width } = useWindowSize();

  // Supported file types: images (for VLM conversation) and documents (for RAG)
  const acceptedMimeTypes = useMemo(
    () => [
      // Image types
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      // Document types (for RAG)
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
      "text/markdown",
      "text/html",
      "application/json",
      // Apple Office suite formats (new version)
      "application/vnd.apple.pages",
      "application/vnd.apple.numbers",
      "application/vnd.apple.keynote",
      // Apple Office suite formats (legacy macOS)
      "application/x-iwork-pages-sffpages",
      "application/x-iwork-numbers-sffnumbers",
      "application/x-iwork-keynote-sffkeynote",
    ],
    [],
  );

  // File input accept attribute (includes MIME types and file extensions)
  const fileInputAccept = useMemo(
    () =>
      [
        ...acceptedMimeTypes,
        // Add file extensions as fallback (browser may not recognize text/markdown)
        ".md",
        ".json",
        ".html",
        ".htm",
        // Apple Office suite formats
        ".pages",
        ".numbers",
        ".keynote",
      ].join(","),
    [acceptedMimeTypes],
  );

  // Check if file type is supported
  const isFileTypeSupported = useCallback(
    (file: File): boolean => {
      // First check MIME type
      if (file.type && acceptedMimeTypes.includes(file.type)) {
        return true;
      }

      // If MIME type detection fails (browser cannot recognize), check by file extension
      const fileName = file.name.toLowerCase();
      const hasSupportedExtension = SUPPORTED_FILE_EXTENSIONS.some((ext) =>
        fileName.endsWith(ext),
      );

      return hasSupportedExtension;
    },
    [acceptedMimeTypes],
  );
  /** IME composition state: when true or shortly after ending, do not respond to Enter send, to avoid accidental send during Chinese IME word selection */
  const isComposingOrJustEndedRef = useRef(false);
  const compositionEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    const pending = pendingSelectionAfterDeleteRef.current;
    if (pending !== null && textareaRef.current) {
      pendingSelectionAfterDeleteRef.current = null;
      textareaRef.current.selectionStart = pending;
      textareaRef.current.selectionEnd = pending;
    }
  }, [input]);

  const [localStorageInput, setLocalStorageInput] = useLocalStorage(
    "input",
    "",
  );

  useEffect(() => {
    if (textareaRef.current) {
      const domValue = textareaRef.current.value;
      const finalValue = domValue || localStorageInput || "";
      setInput(finalValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLocalStorageInput(input);
  }, [input, setLocalStorageInput]);

  /** When filtered categories change, clamp the keyboard highlight index to a valid range */
  useEffect(() => {
    if (!isAtMentionOpen || atMentionSelectedCategory) return;
    const len = filteredAtMentionCategories.length;
    setAtMentionHighlightedIndex((i) => (len ? Math.min(i, len - 1) : 0));
  }, [
    isAtMentionOpen,
    atMentionSelectedCategory,
    filteredAtMentionCategories.length,
  ]);

  /** When slash list changes, clamp the keyboard highlight index to a valid range */
  useEffect(() => {
    if (!isSlashOpen) return;
    const len = filteredSlashSkills.length;
    setSlashHighlightedIndex((i) => (len ? Math.min(i, len - 1) : 0));
  }, [isSlashOpen, filteredSlashSkills.length]);

  /** When keyboard highlight changes, scroll the current highlighted item into the visible area (reference: lexical-beautiful-mentions menu interaction) */
  const atMentionHighlightedItemRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!isAtMentionOpen || atMentionSelectedCategory) return;
    atMentionHighlightedItemRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [isAtMentionOpen, atMentionSelectedCategory, atMentionHighlightedIndex]);

  useEffect(() => {
    if (!isSlashOpen) return;
    slashHighlightedItemRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [isSlashOpen, slashHighlightedIndex]);

  /** Close @ and / cascade dropdowns when clicking outside the input area */
  useEffect(() => {
    if (!isAtMentionOpen && !isSlashOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        inputWrapperRef.current?.contains(target) ||
        atMentionListRef.current?.contains(target) ||
        slashListRef.current?.contains(target)
      )
        return;
      setIsAtMentionOpen(false);
      setIsSlashOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isAtMentionOpen, isSlashOpen]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = event.target.value;
    const cursor = event.target.selectionStart ?? v.length;
    lastSelectionStartRef.current = cursor;
    setInput(v);
    // Detect input / to open skill dropdown, and parse the fuzzy query after / (consistent with @ interaction)
    const lastSlash = v.lastIndexOf("/", cursor - 1);
    if (lastSlash !== -1 && cursor >= lastSlash) {
      const textAfterSlash = v.slice(lastSlash + 1, cursor);
      const query = textAfterSlash.trim();

      // Check if characters after / are valid skill candidates
      // If containing spaces, newlines, or special characters (/, :, . in URLs), do not trigger skill menu
      const isValidSkillTrigger = /^[\w-]*$/.test(query);
      // Require / to NOT follow an alphanumeric char (excludes URLs like https://)
      const charBeforeSlash = lastSlash > 0 ? v[lastSlash - 1] : "";
      const isValidCharBeforeSlash = !/[a-zA-Z0-9]/.test(charBeforeSlash);

      if (isValidSkillTrigger && isValidCharBeforeSlash) {
        slashRangeRef.current = { start: lastSlash, end: cursor };
        setSlashQuery(query);
        setSlashHighlightedIndex(0);
        setIsSlashOpen(true);
        setIsAtMentionOpen(false);
        return;
      }
    }
    if (!v.slice(0, cursor).includes("/")) {
      setIsSlashOpen(false);
      slashRangeRef.current = null;
    }
    // Detect input @ to open cascade dropdown, and parse the fuzzy query after @
    const lastAt = v.lastIndexOf("@", cursor - 1);
    if (lastAt !== -1 && cursor >= lastAt) {
      const query = v.slice(lastAt + 1, cursor).trim();
      atMentionRangeRef.current = { start: lastAt, end: cursor };
      setAtMentionQuery(query);
      setAtMentionSelectedCategory(null);
      setAtMentionHighlightedIndex(0);
      setIsAtMentionOpen(true);
      setIsSlashOpen(false);
    } else {
      if (!v.includes("@")) {
        setIsAtMentionOpen(false);
        atMentionRangeRef.current = null;
      }
    }
  };

  /** IME composition start (e.g. Chinese IME starts typing pinyin) */
  const handleCompositionStart = useCallback(() => {
    if (compositionEndTimerRef.current) {
      clearTimeout(compositionEndTimerRef.current);
      compositionEndTimerRef.current = null;
    }
    isComposingOrJustEndedRef.current = true;
  }, []);

  /** IME composition end (e.g. word selection confirmed); short delay before allowing Enter send, avoiding accidental Enter during word selection */
  const handleCompositionEnd = useCallback(() => {
    isComposingOrJustEndedRef.current = true;
    if (compositionEndTimerRef.current)
      clearTimeout(compositionEndTimerRef.current);
    compositionEndTimerRef.current = setTimeout(() => {
      compositionEndTimerRef.current = null;
      isComposingOrJustEndedRef.current = false;
    }, 120);
  }, []);

  useEffect(() => {
    return () => {
      if (compositionEndTimerRef.current) {
        clearTimeout(compositionEndTimerRef.current);
      }
    };
  }, []);

  /**
   * Handle file upload
   * Supports images (for VLM conversation) and documents (for RAG)
   */
  const handleFileUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;

      const fileArray = Array.from(files);

      // Check for unsupported file types
      const unsupportedFiles = fileArray.filter(
        (file) => !isFileTypeSupported(file),
      );

      // Display unsupported file list
      if (unsupportedFiles.length > 0) {
        const unsupportedNames = unsupportedFiles.map((f) => f.name).join(", ");
        toast.error(
          t(
            "chat.unsupportedFileTypes",
            "Unsupported file types: {{files}}. Supported types: Images (JPEG, PNG, WebP, GIF) and Documents (PDF, DOC, PPT, XLS, TXT, Markdown)",
            { files: unsupportedNames },
          ),
        );
      }

      // Filter out supported files
      const supportedFiles = fileArray.filter((file) =>
        isFileTypeSupported(file),
      );

      if (supportedFiles.length === 0) {
        return;
      }

      // Check attachment count limit (max 10)
      const MAX_ATTACHMENTS = 10;
      const currentCount =
        attachments.length +
        uploadedRagDocuments.length +
        workspaceFileRefs.length +
        pendingUploads.length;
      if (currentCount + supportedFiles.length > MAX_ATTACHMENTS) {
        toast.error(
          t(
            "chat.maxAttachmentsReached",
            "Maximum {{max}} attachments allowed. You currently have {{current}} attachments.",
            { max: MAX_ATTACHMENTS, current: currentCount },
          ),
        );
        return;
      }

      // Separate image files and document files
      const imageFiles = supportedFiles.filter((file) =>
        file.type.startsWith("image/"),
      );
      const documentFiles = supportedFiles.filter(
        (file) => !file.type.startsWith("image/"),
      );

      // Validate file size
      const validateFiles = (files: File[]) => {
        return files.filter((file) => {
          // Images max 5MB (VLM API base64 limit)
          // Document files max 100MB (RAG limit)
          const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB
          const maxSize = file.type.startsWith("image/")
            ? MAX_IMAGE_UPLOAD_BYTES
            : 100 * 1024 * 1024; // 100MB
          if (file.size > maxSize) {
            toast.error(
              `File too large: ${file.name}. Max size is ${maxSize / (1024 * 1024)}MB`,
            );
            return false;
          }
          return true;
        });
      };

      const validImageFiles = validateFiles(imageFiles);
      const validDocumentFiles = validateFiles(documentFiles);

      if (validImageFiles.length === 0 && validDocumentFiles.length === 0) {
        return;
      }

      // First add pending uploads to the list, showing uploading state
      const newPendingUploads = [
        ...validImageFiles.map((file) => ({
          id: `img-${Date.now()}-${file.name}`,
          name: file.name,
          type: "image" as const,
          file,
        })),
        ...validDocumentFiles.map((file) => ({
          id: `doc-${Date.now()}-${file.name}`,
          name: file.name,
          type: "document" as const,
          file,
        })),
      ];
      setPendingUploads((prev) => [...prev, ...newPendingUploads]);

      setIsUploadingFile(true);

      try {
        // Upload image files (for VLM conversation)
        for (const file of validImageFiles) {
          // Find the corresponding pending upload id
          const pendingId = newPendingUploads.find(
            (p) => p.name === file.name && p.type === "image",
          )?.id;

          const result = await uploadFile(file, { createRecord: false });
          // Immediately TUS-upload the image so the native agent route can fetch it
          const blobUrl = await uploadImageTUS(file);

          const newAttachment: Attachment & {
            file?: File;
            serverImageTUSUrl?: string;
          } = {
            name: result.name || file.name,
            url: result.url,
            contentType: result.contentType,
            sizeBytes: result.size,
            blobPath: result.blobPath, // local path for display
            serverImageTUSUrl: blobUrl || undefined, // cloud URL for agent
            downloadUrl: result.downloadUrl,
            // Save original file object for native agent to read directly
            file: file,
          };

          setAttachments((prev) => [...prev, newAttachment]);
          // Remove from pending upload list
          if (pendingId) {
            setPendingUploads((prev) => prev.filter((p) => p.id !== pendingId));
          }
        }

        // Upload document files (for RAG)
        for (const file of validDocumentFiles) {
          // Find the corresponding pending upload id
          const pendingId = newPendingUploads.find(
            (p) => p.name === file.name && p.type === "document",
          )?.id;
          // Get cloudAuthToken for authentication in local mode
          let cloudAuthToken: string | undefined;
          try {
            cloudAuthToken = getAuthToken() || undefined;
          } catch (error) {
            console.error("Failed to read cloud_auth_token:", error);
          }

          const result = await uploadRagFile(file, { cloudAuthToken });

          // Add to uploaded documents list, save ID and name
          setUploadedRagDocuments((prev) => [
            ...prev,
            {
              id: result.documentId || "",
              name: result.fileName || file.name,
            },
          ]);

          // Remove from pending upload list
          if (pendingId) {
            setPendingUploads((prev) => prev.filter((p) => p.id !== pendingId));
          }

          toast.success(
            t(
              "chat.documentUploaded",
              "Document '{{name}}' has been added to your strategy memory",
              { name: file.name },
            ),
          );

          // Show hint that user can chat with the document
          setTimeout(() => {
            toast.info(
              t(
                "chat.documentReady",
                "You can now ask questions about '{{name}}'",
                { name: result.fileName || file.name },
              ),
              { duration: 5000 },
            );
          }, 1000);
        }

        // Show success message
        if (validImageFiles.length > 0) {
          toast.success(
            t(
              "chat.imageUploadSuccess",
              validImageFiles.length > 1
                ? "{{count}} images uploaded"
                : "Image uploaded",
              { count: validImageFiles.length },
            ),
          );
        }
      } catch (error) {
        console.error("File upload error:", error);
        const errorMessage =
          error instanceof Error ? error.message : "Failed to upload file";
        // Use i18n to translate unsupported file type errors
        if (errorMessage.includes("Unsupported file type")) {
          toast.error(t("chat.unsupportedFileType"));
        } else {
          toast.error(errorMessage);
        }
      } finally {
        setIsUploadingFile(false);
        // Clean up all pending upload files
        setPendingUploads([]);
        // Reset file input
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [
      attachments.length,
      uploadedRagDocuments.length,
      workspaceFileRefs.length,
      pendingUploads.length,
      setAttachments,
      t,
      isFileTypeSupported,
      setUploadedRagDocuments,
    ],
  );

  /**
   * Handle paste event
   * Supports pasting images and files from clipboard
   */
  const handlePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = event.clipboardData?.items;
      if (!items) return;

      // Extract files from clipboard
      const files: File[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        // Check if it is a file type
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            files.push(file);
          }
        }
      }

      // If there are files, call file upload handler
      if (files.length > 0) {
        event.preventDefault(); // Prevent default text paste behavior

        // Use DataTransfer to create a real FileList object
        const dataTransfer = new DataTransfer();
        for (const file of files) {
          dataTransfer.items.add(file);
        }
        await handleFileUpload(dataTransfer.files);
      }
    },
    [handleFileUpload],
  );

  /**
   * Handle drag enter event.
   */
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDraggingFile(true);
    }
  }, []);

  /**
   * Handle drag leave event.
   */
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDraggingFile(false);
    }
  }, []);

  /**
   * Handle drag hover event.
   */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  /**
   * Handle file drop event.
   */
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingFile(false);
      dragCounterRef.current = 0;

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        await handleFileUpload(files);
      }
    },
    [handleFileUpload],
  );

  /**
   * Handle Tauri file drag and drop event
   * In Tauri environment, file drag uses native events to pass file paths
   */
  const handleTauriFileDrop = useCallback(
    async (paths: string[]) => {
      setIsDraggingFile(false);
      dragCounterRef.current = 0;

      if (paths.length === 0) return;

      try {
        // Dynamically import Tauri file system API
        const { readFileBinary } = await import("@/lib/tauri");

        // Convert file path to File object
        const filePromises = paths.map(async (filePath) => {
          // Read file content
          const contents = await readFileBinary(filePath);
          if (!contents) {
            console.error(`[MultimodalInput] Failed to read file: ${filePath}`);
            return null;
          }

          const fileName = filePath.split(/[/\\]/).pop() || "file";

          // Detect by MIME type
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

          // Create proper ArrayBuffer from Uint8Array for File constructor
          const arrayBuffer = new ArrayBuffer(contents.byteLength);
          new Uint8Array(arrayBuffer).set(contents);
          return new File([arrayBuffer], fileName, { type: mimeType });
        });

        const files = (await Promise.all(filePromises)).filter(
          (f): f is File => f !== null,
        ) as File[];
        await handleFileUpload(files as unknown as FileList);
      } catch (error) {
        console.error("Failed to handle Tauri file drop:", error);
        toast.error("Failed to load dropped files");
      }
    },
    [handleFileUpload],
  );

  /**
   * Remove attachment
   */
  const handleRemoveAttachment = useCallback(
    (index: number) => {
      setAttachments((prev) => prev.filter((_, i) => i !== index));
    },
    [setAttachments],
  );

  const submitForm = useCallback(() => {
    // If files are being uploaded, disable sending messages
    if (isUploadingFile) {
      toast.warning(
        t(
          "chat.uploadingInProgress",
          "Please wait for file upload to complete",
        ),
      );
      return;
    }

    // Filter out supported attachment types (images only)
    const supportedAttachments = attachments.filter((attachment) =>
      attachment.contentType.startsWith("image/"),
    );
    const unsupportedAttachments = attachments.filter(
      (attachment) => !attachment.contentType.startsWith("image/"),
    );

    // If there are unsupported attachments, show warning
    if (unsupportedAttachments.length > 0) {
      const unsupportedNames = unsupportedAttachments
        .map((a) => a.name)
        .join(", ");
      toast.warning(
        t(
          "chat.unsupportedFilesWarning",
          "The following file types are not yet supported for sending to AI: {{files}}. They have been automatically filtered, and only image attachments will be sent.",
          {
            files: unsupportedNames,
          },
        ),
      );
    }

    // If there is no valid content, do not send
    if (supportedAttachments.length === 0 && input.trim().length === 0) {
      return;
    }

    // Use ref to get the latest RAG document list, avoiding closure issues
    const currentRagDocuments = uploadedRagDocumentsRef.current;

    // Capture current focusedInsights before sending message, avoiding being affected by subsequent clearFocusedInsights
    const currentFocusedInsights = focusedInsights;

    // Check if sendMessage exists (chat instance may not be fully initialized)
    if (!sendMessage) {
      toast.error(
        t(
          "chat.notInitialized",
          "Chat is not ready. Please wait a moment and try again.",
        ),
      );
      return;
    }

    const messageObj = {
      role: "user",
      parts: [
        ...supportedAttachments.map((attachment) => ({
          type: "file" as const,
          url: attachment.url,
          name: attachment.name,
          mediaType: attachment.contentType,
          sizeBytes: attachment.sizeBytes,
          blobPath: attachment.blobPath,
          downloadUrl: attachment.downloadUrl,
          // Include original file object (if any) - used by Native Agent to extract files
          file: (attachment as Attachment & { file?: File }).file,
          // Include TUS upload URL for large images (>400KB)
          serverImageTUSUrl: (
            attachment as Attachment & { serverImageTUSUrl?: string }
          ).serverImageTUSUrl,
        })),
        {
          type: "text",
          text: input,
        },
      ],
      // Store RAG documents and Insights info in metadata
      // People/action items/channels parsed from [[ref:...]] in input content
      metadata: {
        ...(currentRagDocuments.length > 0
          ? { ragDocuments: currentRagDocuments }
          : {}),
        ...(workspaceFileRefs.length > 0 ? { workspaceFileRefs } : {}),
        ...(() => {
          const refs = extractRefsFromContent(input);
          const insightsToSend = currentFocusedInsights;
          const fromRefs = refs.eventIds ?? [];
          const fromInsights = insightsToSend.map((i) => i.id);
          const mergedInsightIds = Array.from(
            new Set([...fromRefs, ...fromInsights]),
          );
          return {
            ...(refs.people.length > 0
              ? { referencedPeople: refs.people }
              : {}),
            ...(refs.taskIds.length > 0
              ? { referencedTaskIds: refs.taskIds }
              : {}),
            ...(refs.channels.length > 0
              ? { referencedChannels: refs.channels }
              : {}),
            ...(mergedInsightIds.length > 0
              ? {
                  focusedInsights: insightsToSend.map((insight) => ({
                    id: insight.id,
                    title: insight.title,
                    description: insight.description,
                    details: insight.details,
                    groups: insight.groups,
                    platform: insight.platform,
                  })),
                  focusedInsightIds: mergedInsightIds,
                  referencedContextInsightIds: mergedInsightIds,
                }
              : {}),
          };
        })(),
      },
    } as any;

    sendMessage(messageObj)
      .then(() => {
        if (currentFocusedInsights.length > 0) {
          clearFocusedInsights();
        }
        setInput("");
        setAttachments([]);
        setUploadedRagDocuments([]);
        uploadedRagDocumentsRef.current = [];
        setWorkspaceFileRefs([]);
      })
      .catch((error) => {
        console.error("sendMessage failed:", error);
        toast.error(
          t("chat.sendMessageFailed", "Message send failed, please retry"),
        );
      });

    // Close all menus when sending message
    setIsAtMentionOpen(false);
    setIsSlashOpen(false);
    setLocalStorageInput("");

    if (width && width > 768) {
      textareaRef.current?.focus();
    }
  }, [
    input,
    setInput,
    attachments,
    sendMessage,
    setAttachments,
    setLocalStorageInput,
    width,
    chatId,
    uploadedRagDocuments,
    setUploadedRagDocuments,
    focusedInsights,
    clearFocusedInsights,
    workspaceFileRefs,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }

    const handleResize = () => {
      const isMobile = window.innerWidth < 768;
      if (!isMobile) {
        return;
      }
      // Mobile keyboard detection logic can be added here
    };

    handleResize();
    viewport.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    return () => {
      viewport.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
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
              setIsDraggingFile(true);
            }
          },
        );

        // Listen for file drag cancel event
        unlistenFileDropCancelled = await eventModule.listen(
          "tauri://file-drop-cancelled",
          () => {
            setIsDraggingFile(false);
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

  /**
   * Handle mouse drag start
   */
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const container = suggestionsContainerRef.current;
    if (!container) return;

    // Only start dragging on left mouse button press
    if (e.button !== 0) return;

    setIsDragging(true);
    hasDraggedRef.current = false; // Reset drag flag
    dragStartRef.current = {
      x: e.clientX,
      scrollLeft: container.scrollLeft,
    };

    // Prevent text selection
    e.preventDefault();
  }, []);

  /**
   * Handle mouse move (while dragging).
   */
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !dragStartRef.current) return;

      const container = suggestionsContainerRef.current;
      if (!container) return;

      const deltaX = e.clientX - dragStartRef.current.x;

      // If movement distance exceeds threshold, mark as dragged
      if (Math.abs(deltaX) > 3) {
        hasDraggedRef.current = true;
      }

      container.scrollLeft = dragStartRef.current.scrollLeft - deltaX;
    },
    [isDragging],
  );

  /**
   * Handle mouse release (drag end)
   */
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    dragStartRef.current = null;
    // Note: do not reset hasDraggedRef here, let onClick event check first
    // If no click event occurs within a period, reset the flag (prevent state residue)
    setTimeout(() => {
      if (!isDragging) {
        hasDraggedRef.current = false;
      }
    }, 100);
  }, [isDragging]);

  /**
   * Handle mouse leave from container (drag end).
   */
  const handleMouseLeave = useCallback(() => {
    setIsDragging(false);
    dragStartRef.current = null;
    // Do not reset hasDraggedRef, let potential click events check first
  }, []);

  /**
   * Add global mouse event listeners.
   */
  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      // Prevent text selection during drag
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    } else {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div
      className={cx("relative w-full max-h-[50dvh] max-md:pb-0", className)}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      role="region"
      aria-label={t("chat.fileDropArea", "File drop area")}
    >
      {/* File drag hint overlay */}
      {isDraggingFile && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-sm rounded-2xl border-2 border-dashed border-primary animate-in fade-in duration-200">
          <div className="flex flex-col items-center gap-3 text-primary">
            <div className="p-4 rounded-full bg-primary/20">
              <RemixIcon name="attachment" size="size-8" />
            </div>
            <div className="text-lg font-semibold">
              {t("chat.dropFilesHere", "Drop files here")}
            </div>
            <div className="text-sm opacity-80">
              {t(
                "chat.supportedFileTypes",
                "Images and documents (PDF, DOC, PPT, TXT)",
              )}
            </div>
          </div>
        </div>
      )}

      <div className="bg-popover rounded-2xl p-0 border border-border shadow-sm">
        {/* Input area container */}
        <div className="relative flex flex-col">
          {/* Attachments, RAG documents and workspace files: unified card preview, same row, source distinguished in top-right corner */}
          {(attachments.length > 0 ||
            workspaceFileRefs.length > 0 ||
            uploadedRagDocuments.length > 0 ||
            pendingUploads.length > 0) && (
            <div className="flex gap-2 p-2 overflow-x-auto border-b border-border/50">
              {/* Pending upload file card */}
              {pendingUploads.map((pending) => (
                <PendingUploadCard
                  key={pending.id}
                  name={pending.name}
                  type={pending.type}
                  onRemove={() =>
                    setPendingUploads((prev) =>
                      prev.filter((p) => p.id !== pending.id),
                    )
                  }
                />
              ))}
              {attachments.map((attachment, index) => (
                <UnifiedFileCard
                  key={attachment.url}
                  variant="local"
                  attachment={attachment}
                  onRemove={() => handleRemoveAttachment(index)}
                  isUploading={isUploadingFile}
                />
              ))}
              {workspaceFileRefs.map((ref) => (
                <UnifiedFileCard
                  key={`${ref.taskId}:${ref.path}`}
                  variant="workspace"
                  workspaceRef={ref}
                  onRemove={() =>
                    setWorkspaceFileRefs((prev) =>
                      prev.filter(
                        (r) =>
                          !(r.taskId === ref.taskId && r.path === ref.path),
                      ),
                    )
                  }
                />
              ))}
              {uploadedRagDocuments.map((doc) => (
                <UnifiedFileCard
                  key={doc.id}
                  variant="rag"
                  ragDoc={doc}
                  onRemove={() =>
                    setUploadedRagDocuments((prev) =>
                      prev.filter((d) => d.id !== doc.id),
                    )
                  }
                  isUploading={isUploadingFile}
                />
              ))}
            </div>
          )}

          <div ref={inputWrapperRef} className="relative">
            {/* / skill dropdown: consistent with @ interaction, single-layer list */}
            {isSlashOpen && (
              <div
                ref={slashListRef}
                className={cx(
                  "absolute bottom-full left-0 right-0 z-50 mb-2 w-full min-w-[220px] max-h-[320px] overflow-auto",
                  "rounded-xl border border-border/80 bg-popover/95 backdrop-blur-sm shadow-xl",
                  "p-1.5",
                  "animate-in fade-in-0 zoom-in-95 duration-150",
                )}
                role="listbox"
                aria-label={t("chat.slashMenu", "Select skill")}
              >
                {/* Close button */}
                <button
                  type="button"
                  onClick={() => setIsSlashOpen(false)}
                  className="absolute top-2 right-2 p-1 rounded-md hover:bg-accent transition-colors"
                  aria-label={t("common.close", "Close")}
                >
                  <RemixIcon
                    name="close"
                    size="size-4"
                    className="text-muted-foreground/60"
                  />
                </button>
                {filteredSlashSkills.length === 0 ? (
                  <div
                    className="flex flex-col items-center justify-center gap-2 px-4 py-6 text-center"
                    role="status"
                    aria-live="polite"
                  >
                    <span className="text-muted-foreground/80 text-sm">
                      {skillsList.length === 0
                        ? t("chat.noSkills", "No skills available")
                        : t("chat.noMatch", "No matching items")}
                    </span>
                    {skillsList.length > 0 && (
                      <span className="text-xs text-muted-foreground/60">
                        {t(
                          "chat.slashNoMatchHint",
                          "Try typing a skill name to search",
                        )}
                      </span>
                    )}
                  </div>
                ) : (
                  <div
                    className="list-none m-0 flex flex-col gap-0.5 p-0"
                    role="listbox"
                  >
                    {filteredSlashSkills.map((skill, index) => {
                      const isHighlighted = index === slashHighlightedIndex;
                      return (
                        <div
                          key={skill.id}
                          role="option"
                          aria-selected={isHighlighted}
                        >
                          <button
                            ref={isHighlighted ? slashHighlightedItemRef : null}
                            type="button"
                            className={cx(
                              "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                              "hover:bg-accent hover:text-accent-foreground",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover",
                              isHighlighted &&
                                "bg-accent text-accent-foreground shadow-sm",
                            )}
                            onClick={() => {
                              setIsSlashOpen(false);
                              insertSlashSkillAtCursor(skill.id);
                            }}
                          >
                            <span
                              className={cx(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                                isHighlighted
                                  ? "bg-primary/15 text-primary"
                                  : "bg-muted/80 text-muted-foreground",
                              )}
                            >
                              <RemixIcon name="sparkles" size="size-4" />
                            </span>
                            <div className="flex-1 min-w-0">
                              <span className="block truncate font-medium">
                                {skill.name}
                              </span>
                              {skill.description && (
                                <span className="block truncate text-xs text-muted-foreground">
                                  {skill.description}
                                </span>
                              )}
                            </div>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* @ cascade dropdown: first select type, then select options in current container */}
            {isAtMentionOpen && (
              <div
                ref={atMentionListRef}
                className={cx(
                  "absolute bottom-full left-0 right-0 z-50 mb-2 w-full min-w-[220px] max-h-[320px] overflow-auto",
                  "rounded-xl border border-border/80 bg-popover/95 backdrop-blur-sm shadow-xl",
                  "p-1.5",
                  "animate-in fade-in-0 zoom-in-95 duration-150",
                )}
                role="listbox"
                aria-label={t("chat.mentionMenu", "Reference type")}
              >
                {/* Close button */}
                <button
                  type="button"
                  onClick={() => setIsAtMentionOpen(false)}
                  className="absolute top-2 right-2 p-1 rounded-md hover:bg-accent transition-colors"
                  aria-label={t("common.close", "Close")}
                >
                  <RemixIcon
                    name="close"
                    size="size-4"
                    className="text-muted-foreground/60"
                  />
                </button>
                {atMentionSelectedCategory ? (
                  <>
                    {atMentionSelectedCategory === "people" && (
                      <AtMentionPeopleList
                        onSelect={(p) => {
                          setIsAtMentionOpen(false);
                          setAtMentionSelectedCategory(null);
                          insertRefAtCursor("people", p.name);
                        }}
                        onBack={() => setAtMentionSelectedCategory(null)}
                      />
                    )}
                    {atMentionSelectedCategory === "workspaceFile" && (
                      <AtMentionWorkspaceFileList
                        taskId={chatId}
                        selectedRefs={workspaceFileRefs}
                        onAdd={(ref) => {
                          setIsAtMentionOpen(false);
                          setAtMentionSelectedCategory(null);
                          setWorkspaceFileRefs((prev) =>
                            prev.some(
                              (r) =>
                                r.taskId === ref.taskId && r.path === ref.path,
                            )
                              ? prev
                              : [...prev, ref],
                          );
                        }}
                        onBack={() => setAtMentionSelectedCategory(null)}
                      />
                    )}
                    {atMentionSelectedCategory === "task" && (
                      <AtMentionTaskForm
                        onInsert={(id) => {
                          setIsAtMentionOpen(false);
                          setAtMentionSelectedCategory(null);
                          insertRefAtCursor("task", id);
                        }}
                        onBack={() => setAtMentionSelectedCategory(null)}
                      />
                    )}
                    {atMentionSelectedCategory === "channel" && (
                      <AtMentionChannelForm
                        onInsert={(c) => {
                          setIsAtMentionOpen(false);
                          setAtMentionSelectedCategory(null);
                          insertRefAtCursor(
                            "channel",
                            c.platform ? `${c.name}:${c.platform}` : c.name,
                          );
                        }}
                        onBack={() => setAtMentionSelectedCategory(null)}
                      />
                    )}
                    {atMentionSelectedCategory === "event" && (
                      <AtMentionEventList
                        onSelect={async (insight) => {
                          // Immediately close menu, prevent setInput from triggering handleInput to reopen
                          setIsAtMentionOpen(false);
                          setAtMentionSelectedCategory(null);
                          // Remove @ from input box
                          const range = atMentionRangeRef.current;
                          if (range) {
                            setInput(
                              (prev) =>
                                prev.slice(0, range.start) +
                                prev.slice(range.end),
                            );
                            atMentionRangeRef.current = null;
                          }
                          // Get full insight data and add to focused list
                          try {
                            const response = await fetch(
                              `/api/insights/${insight.id}?fetch=true`,
                            );
                            if (response.ok) {
                              const data = await response.json();
                              const fullInsight = data.insight;
                              if (fullInsight) {
                                toggleFocusedInsight(fullInsight);
                              }
                            }
                          } catch (e) {
                            console.error("Failed to fetch insight:", e);
                          }
                        }}
                        onBack={() => setAtMentionSelectedCategory(null)}
                      />
                    )}
                  </>
                ) : filteredAtMentionCategories.length === 0 ? (
                  <div
                    className="flex flex-col items-center justify-center gap-2 px-4 py-6 text-center"
                    role="status"
                    aria-live="polite"
                  >
                    <span className="text-muted-foreground/80 text-sm">
                      {t("chat.noMatch", "No matching items")}
                    </span>
                    <span className="text-xs text-muted-foreground/60">
                      {t(
                        "chat.noMatchHint",
                        "Try entering a category name to search, e.g.: Contacts, Action Items, Channels",
                      )}
                    </span>
                  </div>
                ) : (
                  <div
                    className="list-none m-0 flex flex-col gap-0.5 p-0"
                    role="listbox"
                  >
                    {filteredAtMentionCategories.map((cat, index) => {
                      const isHighlighted = index === atMentionHighlightedIndex;
                      const showDividerAfter = cat.dividerAfter === true;
                      return (
                        <div
                          key={cat.id}
                          role="option"
                          aria-selected={isHighlighted}
                        >
                          <button
                            ref={
                              isHighlighted ? atMentionHighlightedItemRef : null
                            }
                            type="button"
                            className={cx(
                              "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                              "hover:bg-accent hover:text-accent-foreground",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover",
                              isHighlighted &&
                                "bg-accent text-accent-foreground shadow-sm",
                            )}
                            onClick={() =>
                              handleAtMentionSelectCategory(cat.id)
                            }
                          >
                            <span
                              className={cx(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                                isHighlighted
                                  ? "bg-primary/15 text-primary"
                                  : "bg-muted/80 text-muted-foreground",
                              )}
                            >
                              <RemixIcon name={cat.icon} size="size-4" />
                            </span>
                            <span className="flex-1 truncate font-medium">
                              {cat.shortLabel}
                            </span>
                            <RemixIcon
                              name="chevron_right"
                              size="size-4"
                              className="shrink-0 text-muted-foreground/70"
                            />
                          </button>
                          {showDividerAfter && (
                            <div
                              className="my-1.5 border-t border-border/60"
                              role="separator"
                              aria-hidden
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="relative">
              <Textarea
                data-testid="multimodal-input"
                ref={textareaRef}
                id="openloomi-reply-textarea"
                placeholder={t("common.message")}
                value={input}
                onChange={handleInput}
                onPaste={handlePaste}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                className={cx(
                  "w-full rounded-xl px-4 py-3 min-h-[72px] max-h-[400px] border-0 bg-transparent",
                  "resize-none focus-visible:outline-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0",
                  "text-base md:text-sm",
                )}
                rows={1}
                onKeyDown={(event) => {
                  if (isSlashOpen) {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setIsSlashOpen(false);
                      return;
                    }
                    const list = filteredSlashSkills;
                    const len = list.length;
                    if (event.key === "ArrowDown" && len > 0) {
                      event.preventDefault();
                      setSlashHighlightedIndex((i) =>
                        i < len - 1 ? i + 1 : 0,
                      );
                      return;
                    }
                    if (event.key === "ArrowUp" && len > 0) {
                      event.preventDefault();
                      setSlashHighlightedIndex((i) =>
                        i > 0 ? i - 1 : len - 1,
                      );
                      return;
                    }
                    if (event.key === "Enter" && len > 0) {
                      event.preventDefault();
                      const skill = list[slashHighlightedIndex];
                      if (skill) {
                        insertSlashSkillAtCursor(skill.id);
                        setIsSlashOpen(false);
                      }
                      return;
                    }
                  }
                  if (isAtMentionOpen) {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      if (atMentionSelectedCategory) {
                        setAtMentionSelectedCategory(null);
                      } else {
                        setIsAtMentionOpen(false);
                      }
                      return;
                    }
                    if (!atMentionSelectedCategory) {
                      const list = filteredAtMentionCategories;
                      const len = list.length;
                      if (event.key === "ArrowDown" && len > 0) {
                        event.preventDefault();
                        setAtMentionHighlightedIndex((i) =>
                          i < len - 1 ? i + 1 : 0,
                        );
                        return;
                      }
                      if (event.key === "ArrowUp" && len > 0) {
                        event.preventDefault();
                        setAtMentionHighlightedIndex((i) =>
                          i > 0 ? i - 1 : len - 1,
                        );
                        return;
                      }
                      if (event.key === "Enter" && len > 0) {
                        event.preventDefault();
                        const cat = list[atMentionHighlightedIndex];
                        if (cat) handleAtMentionSelectCategory(cat.id);
                        return;
                      }
                    }
                  }
                  if (event.key === "Backspace" && !event.shiftKey) {
                    const ta = textareaRef.current;
                    if (ta && ta.selectionStart === ta.selectionEnd) {
                      const pos = ta.selectionStart;
                      const range = getRefMarkerRangeBeforeCursor(input, pos);
                      if (range) {
                        event.preventDefault();
                        setInput(
                          (prev) =>
                            prev.slice(0, range.start) + prev.slice(range.end),
                        );
                        pendingSelectionAfterDeleteRef.current = range.start;
                        return;
                      }
                    }
                  }
                  if (event.key !== "Enter" || event.shiftKey) return;
                  // Do not send during IME composition or shortly after it ends, avoiding accidental send during Chinese word selection/confirmation
                  if (
                    event.nativeEvent.isComposing ||
                    isComposingOrJustEndedRef.current
                  ) {
                    event.preventDefault();
                    return;
                  }
                  event.preventDefault();
                  if (isAgentRunning) {
                    toast.error(
                      "Please wait for the model to finish its response!",
                    );
                  } else {
                    submitForm();
                  }
                }}
              />
            </div>
          </div>

          {/* Bottom action bar */}
          <div className="h-14 rounded-b-xl flex items-center">
            <div className="absolute left-3 right-3 bottom-3 flex items-center justify-between w-[calc(100%-24px)]">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {/* + button: add file from space, upload from local (leftmost) */}
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-9 shrink-0 rounded-lg"
                          aria-label={t("chat.addFile", "Add file")}
                        >
                          +
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent>
                      <span className="text-xs">
                        {t(
                          "chat.addFileHint",
                          "Add from workspace or upload locally",
                        )}
                      </span>
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="start" className="w-[200px]">
                    <DropdownMenuItem
                      onClick={() => {
                        lastCursorRef.current =
                          textareaRef.current?.selectionStart ?? input.length;
                        setIsWorkspaceFilePickerOpen(true);
                      }}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <RemixIcon name="folder_open" size="size-4" />
                      {t(
                        "chat.addFileFromWorkspace",
                        "Add files from workspace",
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        lastCursorRef.current =
                          textareaRef.current?.selectionStart ?? input.length;
                        fileInputRef.current?.click();
                      }}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <RemixIcon name="attachment" size="size-4" />
                      {t("chat.uploadFileFromLocal", "Upload files from local")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 shrink-0 gap-1.5 rounded-lg px-2 sm:px-3"
                      onClick={() => {
                        lastCursorRef.current =
                          textareaRef.current?.selectionStart ?? input.length;
                        slashRangeRef.current = null;
                        setSlashQuery("");
                        setSlashHighlightedIndex(0);
                        setIsSlashOpen((open) => !open);
                        setIsAtMentionOpen(false);
                      }}
                      aria-label={t("chat.addSkill", "Select skill (/)")}
                    >
                      <RemixIcon
                        name="apps_2_ai"
                        size="size-4"
                        className="shrink-0"
                      />
                      <span className="hidden sm:inline">
                        {t("chat.skills", "Skills")}
                      </span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <span className="text-xs">
                      {t(
                        "chat.addSkillHint",
                        "Select skill, or type / to search",
                      )}
                    </span>
                  </TooltipContent>
                </Tooltip>

                {/* Hidden file input (triggered by "file" in @ menu) */}
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept={fileInputAccept}
                  multiple
                  onChange={(e) => handleFileUpload(e.target.files)}
                  disabled={isUploadingFile}
                />
              </div>

              <div className="shrink-0 ml-2 flex items-center gap-2">
                {/* Model selection: shows current model name + down arrow, placed to the left of send button */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 shrink-0 gap-1 rounded-lg px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                      aria-label={t("common.model", "Model")}
                    >
                      <span className="max-w-[120px] truncate">
                        {MODELS[selectedModel]?.name ?? selectedModel}
                      </span>
                      <RemixIcon name="arrow_down_s" size="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-[160px] max-h-[400px] overflow-y-auto"
                  >
                    {Object.entries(MODELS).map(([id, model]) => {
                      const isSelected = selectedModel === id;
                      return (
                        <DropdownMenuItem
                          key={id}
                          onClick={() => setSelectedModel(id as ModelType)}
                          className={cx(
                            "flex items-center justify-between gap-2 p-1.5 cursor-pointer",
                            isSelected ? "bg-accent" : "",
                          )}
                        >
                          <span className="text-xs font-medium">
                            {model.name}
                          </span>
                          {isSelected && (
                            <RemixIcon
                              name="check"
                              size="size-3"
                              className="text-primary"
                            />
                          )}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
                {isAgentRunning ? (
                  <StopButton stop={stop} setMessages={setMessages} />
                ) : (
                  <SendButton
                    input={input}
                    submitForm={submitForm}
                    isUploadingFile={isUploadingFile}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <EventSearchDialog
        open={isEventSearchDialogOpen}
        onOpenChange={setIsEventSearchDialogOpen}
      />

      {/* Workspace file selection */}
      <Dialog
        open={isWorkspaceFilePickerOpen}
        onOpenChange={setIsWorkspaceFilePickerOpen}
      >
        <DialogContent className="max-w-md max-h-[70vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {t("chat.workspaceFiles", "Select files from workspace")}
            </DialogTitle>
          </DialogHeader>
          <WorkspaceFilePickerContent
            taskId={chatId}
            selectedRefs={workspaceFileRefs}
            onAdd={(ref) =>
              setWorkspaceFileRefs((prev) =>
                prev.some((r) => r.taskId === ref.taskId && r.path === ref.path)
                  ? prev
                  : [...prev, ref],
              )
            }
            onRemove={(path) =>
              setWorkspaceFileRefs((prev) =>
                prev.filter((r) => r.path !== path),
              )
            }
            onClose={() => setIsWorkspaceFilePickerOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Action items: insert at cursor position in input as inline reference */}
      <Dialog open={isTaskPickerOpen} onOpenChange={setIsTaskPickerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("chat.addTask", "Add action item")}</DialogTitle>
          </DialogHeader>
          <ReferencedTaskPickerContent
            onInsert={(id) => {
              insertRefAtCursor("task", id);
              setIsTaskPickerOpen(false);
            }}
            onClose={() => setIsTaskPickerOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* People: click to insert at cursor position in input */}
      <Dialog open={isPeoplePickerOpen} onOpenChange={setIsPeoplePickerOpen}>
        <DialogContent className="max-w-md max-h-[70vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t("chat.addPeople", "Add people")}</DialogTitle>
          </DialogHeader>
          <ReferencedPeoplePickerContent
            onInsert={(p) => {
              insertRefAtCursor("people", p.name);
              setIsPeoplePickerOpen(false);
            }}
            onClose={() => setIsPeoplePickerOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Channel: insert at cursor position in input */}
      <Dialog open={isChannelPickerOpen} onOpenChange={setIsChannelPickerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("chat.addChannel", "Add channel")}</DialogTitle>
          </DialogHeader>
          <ReferencedChannelPickerContent
            onInsert={(c) => {
              insertRefAtCursor(
                "channel",
                c.platform ? `${c.name}:${c.platform}` : c.name,
              );
              setIsChannelPickerOpen(false);
            }}
            onClose={() => setIsChannelPickerOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export const MultimodalInput = memo(
  PureMultimodalInput,
  (prevProps, nextProps) => {
    if (prevProps.input !== nextProps.input) return false;
    if (!equal(prevProps.attachments, nextProps.attachments)) return false;

    return true;
  },
);

/**
 * Stop button component: displayed during AI response generation, click to interrupt
 * @param stop - Stop generation function
 * @param setMessages - Set messages function
 * @param title - Hover/accessibility tooltip
 */
function PureStopButton({
  stop,
  setMessages,
  title = "Stop generating",
}: {
  stop: () => void;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  title?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          data-testid="stop-button"
          type="button"
          className={cx(
            "size-9 shrink-0 rounded-full flex items-center justify-center",
            "bg-primary text-primary-foreground",
            "hover:bg-primary/85 focus-visible:ring-1 focus-visible:ring-offset-0 focus-visible:ring-ring",
          )}
          onClick={(event) => {
            event.preventDefault();
            stop();
            setMessages((messages) => messages);
          }}
          aria-label={title}
        >
          <StopIcon size={16} />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <span className="text-xs">{title}</span>
      </TooltipContent>
    </Tooltip>
  );
}

const StopButton = memo(PureStopButton);

/**
 * Send button component
 * @param submitForm - Submit form function
 * @param input - Input content
 * @param isUploadingFile - Whether file is being uploaded
 */
function PureSendButton({
  submitForm,
  input,
  isUploadingFile = false,
}: {
  submitForm: () => void;
  input: string;
  isUploadingFile?: boolean;
}) {
  const isDisabled = input.length === 0 || isUploadingFile;

  return (
    <Button
      data-testid="send-button"
      type="button"
      variant="magic-primary"
      size="icon"
      className={cx(
        "size-9 shrink-0 rounded-full",
        isDisabled ? "opacity-30" : "opacity-100",
      )}
      onClick={(event) => {
        event.preventDefault();
        submitForm();
      }}
      disabled={isDisabled}
      aria-label={isUploadingFile ? "Uploading file..." : "Send message"}
    >
      {isUploadingFile ? (
        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        <ArrowUpIcon size={16} />
      )}
    </Button>
  );
}

const SendButton = memo(PureSendButton, (prevProps, nextProps) => {
  if (
    prevProps.input !== nextProps.input ||
    prevProps.isUploadingFile !== nextProps.isUploadingFile
  )
    return false;
  return true;
});
