"use client";

import type { MouseEvent } from "react";
import { cn } from "@/lib/utils";
import { RemixIcon } from "@/components/remix-icon";
import { Button } from "@openloomi/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@openloomi/ui";
import { toast } from "@/components/toast";
import { isTauri } from "@/lib/tauri";
import { LibraryGridPreviewPanel } from "@/components/library/library-grid-preview-panel";
import {
  useLibraryPreviewSnapshot,
  getLibraryPreviewKindFromExt,
} from "@/hooks/use-library-preview-snapshot";
import type {
  LibraryGridCardVariant,
  LibraryItem,
} from "@/components/library/library-types";

export type {
  LibraryGridCardVariant,
  LibraryItemKind,
  LibraryItem,
  ToolExecution,
} from "./library-types";

const LIBRARY_FILE_ICON_NAMES = new Set([
  "code",
  "csv",
  "css",
  "doc",
  "docx",
  "html",
  "js",
  "json",
  "pdf",
  "ppt",
  "pptx",
  "rar",
  "sql",
  "svg",
  "txt",
  "xml",
  "xls",
  "xlsx",
  "zip",
  "spreadsheets",
]);

/** Get extension from filename or type */
export function getExtFromItem(item: LibraryItem): string {
  if (item.workspaceFile?.type) return item.workspaceFile.type;
  if (item.kind === "workspace_file" && item.title.includes(".")) {
    return item.title.split(".").pop()?.toLowerCase() ?? "";
  }
  if (item.kind === "knowledge_file" && item.title.includes(".")) {
    return item.title.split(".").pop()?.toLowerCase() ?? "";
  }
  return "";
}

/** Returns the unified file type SVG path within the library based on extension (`/images/file/*.svg`) */
export function getLibraryFileIconSrc(extRaw: string): string {
  const ext = extRaw.toLowerCase().replace(/^\./, "").trim();
  if (!ext) {
    return "/images/file/default.svg";
  }

  const alias: Record<string, string> = {
    htm: "html",
    h5: "html",
    mjs: "js",
    cjs: "js",
    ts: "js",
    tsx: "js",
    jsx: "js",
    md: "txt",
    markdown: "txt",
    log: "txt",
    rtf: "txt",
    ods: "spreadsheets",
    odp: "pptx",
    key: "pptx",
    "7z": "zip",
    gz: "zip",
    tgz: "zip",
    tar: "zip",
  };

  let icon = alias[ext] ?? ext;

  const codeLike = new Set([
    "py",
    "rb",
    "go",
    "rs",
    "java",
    "kt",
    "kts",
    "vue",
    "php",
    "swift",
    "c",
    "h",
    "cpp",
    "cc",
    "cxx",
    "hpp",
    "cs",
    "scala",
    "r",
    "m",
    "sh",
    "bash",
    "zsh",
    "yaml",
    "yml",
    "toml",
    "ini",
    "dockerfile",
    "wasm",
    "graphql",
    "gql",
  ]);

  if (!LIBRARY_FILE_ICON_NAMES.has(icon)) {
    icon = codeLike.has(ext) ? "code" : "default";
  }

  return `/images/file/${icon}.svg`;
}

function LibraryFileTypeIcon({
  src,
  sizeClass,
}: {
  src: string;
  sizeClass: string;
}) {
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className={cn("object-contain pointer-events-none", sizeClass)}
      aria-hidden
    />
  );
}

function getLibraryPreviewLines(item: LibraryItem): {
  titleLine: string;
  bodyLine: string;
} {
  const titleLine = item.title;
  const bodyLine =
    item.subtitle ||
    item.workspaceFile?.name ||
    item.workspaceFile?.path ||
    item.knowledgeFile?.fileName ||
    "";
  return { titleLine, bodyLine };
}

export function LibraryItemRow({
  item,
  viewMode,
  gridCardVariant = "library",
  t,
  onOpenFile,
  onLocateToChat,
  onOpenEvent,
  onPreviewKnowledgeFile,
  onDeleteKnowledgeFile,
  onDeleteWorkspaceFile,
}: {
  item: LibraryItem;
  viewMode: "list" | "grid";
  /**
   * Only effective when `viewMode="grid"`. `library`: bottom bar + fixed snapshot above;
   * `inline`: top bar + scrollable inline preview below.
   */
  gridCardVariant?: LibraryGridCardVariant;
  t: (key: string, fallback?: string) => string;
  onOpenFile: (wf: {
    taskId: string;
    path: string;
    name: string;
    type?: string;
  }) => void;
  onLocateToChat?: (chatId: string) => void;
  onOpenEvent?: (insightId: string) => void;
  onPreviewKnowledgeFile?: (documentId: string) => void;
  onDeleteKnowledgeFile?: (documentId: string) => void;
  onDeleteWorkspaceFile?: (wf: { taskId: string; path: string }) => void;
}) {
  const ext = getExtFromItem(item);
  const fileIconSrc = getLibraryFileIconSrc(ext);
  const previewKind = getLibraryPreviewKindFromExt(ext);
  const { titleLine } = getLibraryPreviewLines(item);
  const gridPreviewEnabled = viewMode === "grid";
  const {
    snapshotText,
    snapshotHtml,
    snapshotLoading,
    pdfThumbDataUrl,
    spreadsheetSnapshot,
    pptxThumbDataUrl,
    docxThumbDataUrl,
    imageDataUrl,
    fullPdfPages,
    fullDocxHtml,
    fullSpreadsheetData,
    fullContentLoading,
    fullContentError,
  } = useLibraryPreviewSnapshot(item, previewKind, gridPreviewEnabled);

  /** Open fullscreen/drawer preview (workspace file or knowledge base document) */
  const openPreview = () => {
    if (item.workspaceFile) {
      onOpenFile(item.workspaceFile);
      return;
    }
    if (
      item.kind === "knowledge_file" &&
      item.knowledgeFile?.id &&
      onPreviewKnowledgeFile
    ) {
      onPreviewKnowledgeFile(item.knowledgeFile.id);
    }
  };

  const canOpenPreview =
    Boolean(item.workspaceFile) ||
    Boolean(
      item.kind === "knowledge_file" &&
      item.knowledgeFile?.id &&
      onPreviewKnowledgeFile,
    );

  // Skip showing date for epoch (1970) - used when date should not be displayed
  const showDate = item.date.getTime() > 0;
  const dateLabel = showDate
    ? item.date.toLocaleString(undefined, {
        dateStyle: "short",
        timeStyle: "short",
      })
    : null;

  const handleOpenWorkspaceFileLocally = async (e: MouseEvent) => {
    e.stopPropagation();
    const wf = item.workspaceFile;
    if (!wf) return;
    const { openWorkspaceFileInSystemDefaultApp } =
      await import("@/lib/files/open-workspace-file-locally");
    const r = await openWorkspaceFileInSystemDefaultApp({
      taskId: wf.taskId,
      path: wf.path,
    });
    if (!r.ok && r.reason !== "not_tauri") {
      toast({
        type: "error",
        description:
          r.reason === "missing_file"
            ? t(
                "library.openWithLocalAppNotFound",
                "File not found on this computer",
              )
            : t(
                "library.openWithLocalAppFailed",
                "Could not open the file with a default app",
              ),
      });
    }
  };

  const handleRevealWorkspaceFolder = async (e: MouseEvent) => {
    e.stopPropagation();
    const wf = item.workspaceFile;
    if (!wf) return;
    const { revealWorkspaceFileInParentFolder } =
      await import("@/lib/files/open-workspace-file-locally");
    const r = await revealWorkspaceFileInParentFolder({
      taskId: wf.taskId,
      path: wf.path,
    });
    if (!r.ok && r.reason !== "not_tauri") {
      toast({
        type: "error",
        description:
          r.reason === "missing_file"
            ? t(
                "library.openWithLocalAppNotFound",
                "File not found on this computer",
              )
            : t(
                "library.revealInFolderFailed",
                "Could not open the folder in the file manager",
              ),
      });
    }
  };

  const titleMenu = (
    <>
      {item.workspaceFile && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
              aria-label={t("common.more", "More")}
            >
              <RemixIcon name="more_2" size="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-40 w-max max-w-[min(100vw-2rem,16rem)]"
          >
            {isTauri() && (
              <>
                <DropdownMenuItem onClick={handleOpenWorkspaceFileLocally}>
                  <RemixIcon name="folder_open" size="size-4" />
                  <span>
                    {t("library.openWithLocalApp", "Open with default app")}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleRevealWorkspaceFolder}>
                  <RemixIcon name="folder_2" size="size-4" />
                  <span>{t("library.revealInFolder", "Show in folder")}</span>
                </DropdownMenuItem>
              </>
            )}
            {item.workspaceFile.taskId && onLocateToChat && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  const taskId = item.workspaceFile?.taskId;
                  if (!taskId) return;
                  onLocateToChat(taskId);
                }}
              >
                <RemixIcon name="external_link" size="size-4" />
                <span>{t("library.openChat", "Open chat")}</span>
              </DropdownMenuItem>
            )}
            {onDeleteWorkspaceFile && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  const wf = item.workspaceFile;
                  if (!wf) return;
                  onDeleteWorkspaceFile({ taskId: wf.taskId, path: wf.path });
                }}
              >
                <RemixIcon name="delete_bin" size="size-4" />
                <span>{t("common.delete", "Delete")}</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {item.kind === "knowledge_file" &&
        item.knowledgeFile &&
        (onPreviewKnowledgeFile ||
          onDeleteKnowledgeFile ||
          (item.knowledgeFile.insightId && onOpenEvent)) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={(e) => e.stopPropagation()}
                aria-label={t("common.more", "More")}
              >
                <RemixIcon name="more_2" size="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {onPreviewKnowledgeFile && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    const id = item.knowledgeFile?.id;
                    if (id) onPreviewKnowledgeFile(id);
                  }}
                >
                  <RemixIcon name="eye" size="size-4" />
                  <span>{t("library.preview", "Preview")}</span>
                </DropdownMenuItem>
              )}
              {item.knowledgeFile?.insightId && onOpenEvent && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    const insightId = item.knowledgeFile?.insightId;
                    if (insightId) onOpenEvent(insightId);
                  }}
                >
                  <RemixIcon name="external_link" size="size-4" />
                  <span>{t("library.openEvent", "Open event")}</span>
                </DropdownMenuItem>
              )}
              {onDeleteKnowledgeFile && (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    const id = item.knowledgeFile?.id;
                    if (id) onDeleteKnowledgeFile(id);
                  }}
                >
                  <RemixIcon name="delete_bin" size="size-4" />
                  <span>{t("common.delete", "Delete")}</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
    </>
  );

  if (viewMode === "grid" && gridCardVariant === "inline") {
    return (
      <li className="w-full min-w-0">
        <div className="w-full min-w-0 flex flex-col items-stretch gap-0 overflow-hidden rounded-lg border border-border/60 bg-card text-left shadow-none">
          <header className="flex min-w-0 items-center justify-between gap-2 border-b border-border/40 p-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-[8px] border border-border/60 p-0.5">
                <LibraryFileTypeIcon src={fileIconSrc} sizeClass="h-6 w-6" />
              </div>
              <p className="min-w-0 flex-1 truncate text-left text-sm font-normal">
                {item.title}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {item.workspaceFile?.taskId && onLocateToChat ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  aria-label={t("library.openChat", "Open chat")}
                  title={t("library.openChat", "Open chat")}
                  onClick={(e) => {
                    e.stopPropagation();
                    const wf = item.workspaceFile;
                    if (wf?.taskId) onLocateToChat(wf.taskId);
                  }}
                >
                  <RemixIcon name="chat_ai" size="size-4" />
                </Button>
              ) : null}
              {canOpenPreview ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  aria-label={t(
                    "library.openPreviewFullscreen",
                    "Open fullscreen preview",
                  )}
                  title={t(
                    "library.openPreviewFullscreen",
                    "Open fullscreen preview",
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    openPreview();
                  }}
                >
                  <RemixIcon name="fullscreen" size="size-4" />
                </Button>
              ) : null}
              {titleMenu}
            </div>
          </header>
          <div className="min-w-0">
            <LibraryGridPreviewPanel
              variant="inline"
              previewKind={previewKind}
              loading={snapshotLoading}
              snapshotHtml={snapshotHtml}
              snapshotText={snapshotText}
              titleLine={titleLine}
              fileIconSrc={fileIconSrc}
              t={t}
              previewTitle={item.title}
              pdfThumbDataUrl={pdfThumbDataUrl}
              spreadsheetSnapshot={spreadsheetSnapshot}
              pptxThumbDataUrl={pptxThumbDataUrl}
              docxThumbDataUrl={docxThumbDataUrl}
              imageDataUrl={imageDataUrl}
              workspaceFilePath={item.workspaceFile?.path}
              workspaceFileTaskId={item.workspaceFile?.taskId}
              fullPdfPages={fullPdfPages}
              fullDocxHtml={fullDocxHtml}
              fullSpreadsheetData={fullSpreadsheetData}
              fullContentLoading={fullContentLoading}
              fullContentError={fullContentError}
            />
          </div>
        </div>
      </li>
    );
  }

  if (viewMode === "grid") {
    return (
      <li className="w-full min-w-0">
        <div
          className="w-full min-w-0 flex flex-col items-stretch gap-0 p-0 rounded-lg border border-border/60 bg-card text-left overflow-hidden cursor-pointer"
          onClick={openPreview}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openPreview();
            }
          }}
        >
          <LibraryGridPreviewPanel
            variant="library"
            previewKind={previewKind}
            loading={snapshotLoading}
            snapshotHtml={snapshotHtml}
            snapshotText={snapshotText}
            titleLine={titleLine}
            fileIconSrc={fileIconSrc}
            t={t}
            previewTitle={item.title}
            pdfThumbDataUrl={pdfThumbDataUrl}
            spreadsheetSnapshot={spreadsheetSnapshot}
            pptxThumbDataUrl={pptxThumbDataUrl}
            docxThumbDataUrl={docxThumbDataUrl}
            imageDataUrl={imageDataUrl}
            workspaceFilePath={item.workspaceFile?.path}
            workspaceFileTaskId={item.workspaceFile?.taskId}
            fullPdfPages={fullPdfPages}
            fullDocxHtml={fullDocxHtml}
            fullSpreadsheetData={fullSpreadsheetData}
            fullContentLoading={fullContentLoading}
            fullContentError={fullContentError}
          />
          <div className="flex items-center justify-between gap-2 p-3 min-w-0">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-[8px] border border-border/60 p-0.5">
                <LibraryFileTypeIcon src={fileIconSrc} sizeClass="h-6 w-6" />
              </div>
              <div className="flex items-center gap-1 min-w-0 flex-1">
                <p className="min-w-0 flex-1 truncate text-left text-sm font-normal">
                  {item.title}
                </p>
                {item.isTemporary && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 shrink-0">
                    {t("common.temporary", "Temp")}
                  </span>
                )}
              </div>
            </div>
            {titleMenu}
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="w-full min-w-0">
      <div
        className="w-full min-w-0 flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-2 rounded-lg border border-border/60 bg-card text-left overflow-hidden cursor-pointer"
        onClick={openPreview}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPreview();
          }
        }}
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-[8px] border border-border/60 p-0.5">
          <LibraryFileTypeIcon src={fileIconSrc} sizeClass="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1 text-left overflow-hidden space-y-0.5">
          <div className="flex items-center gap-1">
            <p className="text-sm font-medium truncate">{item.title}</p>
            {item.isTemporary && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                {t("common.temporary", "Temp")}
              </span>
            )}
          </div>
          {dateLabel && (
            <p className="text-xs text-muted-foreground truncate">
              {dateLabel}
            </p>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-1">{titleMenu}</div>
      </div>
    </li>
  );
}
