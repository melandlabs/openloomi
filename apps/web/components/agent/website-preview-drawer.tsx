"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useTranslation } from "react-i18next";
import { inlineResources } from "@/lib/files/inline-resources";
import { RemixIcon } from "@/components/remix-icon";
import { FilePreviewDrawerHeader } from "@/components/file-preview-drawer-header";

const WebsitePreview = dynamic(
  () =>
    import("@/components/website-preview").then((m) => ({
      default: m.WebsitePreview,
    })),
  { ssr: false },
);

interface WebsitePreviewDrawerProps {
  file: {
    path: string;
    name: string;
    type: string;
  };
  /** Pass taskId for workspace files, fetched via API */
  taskId?: string;
  onClose: () => void;
}

/**
 * Fetches HTML from disk/API and renders WebsitePreview inside a drawer; loading and error state header bar is consistent with library list cards.
 */
export function WebsitePreviewDrawer({
  file,
  taskId,
  onClose,
}: WebsitePreviewDrawerProps) {
  const { t } = useTranslation();
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const readFileContent = async () => {
      try {
        let content = "";
        let fileDir = "";
        let resolvedTaskId = taskId || "";

        const isTauriEnv = !!(window as any).__TAURI__;

        // Prefer externally passed taskId, or extract from path
        if (!resolvedTaskId) {
          // Try to extract taskId from path
          // Format: /Users/xxx/.openloomi/sessions/{taskId}/...
          const sessionMatch = file.path.match(
            /\/\.openloomi\/sessions\/([^\/]+)/,
          );
          if (sessionMatch) {
            resolvedTaskId = sessionMatch[1];
          }
        }

        // If taskId is available, read via API first (workspace files)
        if (resolvedTaskId) {
          // Extract relative path
          let relativePath = file.path;
          // Remove /Users/xxx/.openloomi/sessions/{taskId}/ prefix
          const sessionPathMatch = file.path.match(
            /\.openloomi\/sessions\/[^\/]+\/(.+)$/,
          );
          if (sessionPathMatch) {
            relativePath = sessionPathMatch[1];
          } else if (file.path.includes("/sessions/")) {
            // Try /sessions/{taskId}/... format
            const parts = file.path.split("/sessions/");
            if (parts.length >= 2) {
              relativePath = parts[1].split("/").slice(1).join("/");
            }
          }

          try {
            const response = await fetch(
              `/api/workspace/file/${encodeURIComponent(resolvedTaskId)}/${encodeURIComponent(relativePath)}`,
            );
            if (!response.ok) {
              throw new Error(t("common.filePreview.loadFromApiFailed"));
            }
            const data = await response.json();
            content = data.content || "";
            fileDir = relativePath.substring(0, relativePath.lastIndexOf("/"));
          } catch (apiError) {
            console.error("[WebsitePreview] API error:", apiError);
            // If API fails, try Tauri
            if (!isTauriEnv) {
              setError(
                `${t("common.filePreview.loadFromApiFailed")}: ${apiError instanceof Error ? apiError.message : String(apiError)}`,
              );
              setLoading(false);
              return;
            }
          }
        }

        // If not successfully read via API, try Tauri filesystem
        if (!content && isTauriEnv) {
          const { readFile, fileStat, homeDirCustom } =
            await import("@/lib/tauri");

          // Resolve path: absolute paths are used directly,
          // ~ is expanded to user home directory
          let filePath = file.path;
          if (filePath.startsWith("~")) {
            const homeDir = await homeDirCustom();
            if (homeDir) {
              filePath = filePath.replace(/^~/, homeDir);
            }
          }
          // If still not absolute and we have a resolvedTaskId, construct the full path
          if (!filePath.startsWith("/") && resolvedTaskId) {
            const homeDir = await homeDirCustom();
            if (homeDir) {
              filePath = `${homeDir}/.openloomi/sessions/${resolvedTaskId}/${filePath}`;
            }
          }

          let fileInfo: {
            size: number;
            isFile: boolean;
            isDir: boolean;
          } | null = null;
          try {
            fileInfo = await fileStat(filePath);
          } catch (e) {
            console.error("[WebsitePreview] fileStat error:", e);
            setError(
              `Failed to read file: ${e instanceof Error ? e.message : String(e)}`,
            );
            setLoading(false);
            return;
          }

          if (fileInfo && fileInfo.size > 100 * 1024 * 1024) {
            setError(t("common.filePreview.fileTooLargeForWebsite"));
            setLoading(false);
            return;
          }

          let fileContent: string | null = null;
          try {
            fileContent = await readFile(filePath);
          } catch (e) {
            console.error("[WebsitePreview] readFile error:", e);
            setError(
              `Failed to read file: ${e instanceof Error ? e.message : String(e)}`,
            );
            setLoading(false);
            return;
          }

          if (fileContent) {
            content = fileContent;
          }

          fileDir = filePath.substring(0, filePath.lastIndexOf("/"));
          const sessionMatch = filePath.match(
            /\/\.openloomi\/sessions\/([^\/]+)/,
          );
          if (sessionMatch) {
            resolvedTaskId = sessionMatch[1];
          }
        } else if (!content && !isTauriEnv) {
          // Non-Tauri environment (web version): supports three path formats
          // 1. Absolute path: /Users/xxx/.openloomi/sessions/{taskId}/{relativePath}
          // 2. Relative path with sessionDir context: ai-digest-dashboard.html (needs taskId to resolve)
          // 3. Legacy /sessions/{taskId}/{relativePath} format
          let taskId = "";
          let relativePath = "";

          // Check if path is absolute
          const isAbsolute = file.path.startsWith("/");

          if (isAbsolute) {
            // Absolute path: extract taskId and relativePath
            const sessionMatch = file.path.match(
              /\.openloomi\/sessions\/([^\/]+)\/(.+)$/,
            );
            if (sessionMatch) {
              taskId = sessionMatch[1];
              relativePath = sessionMatch[2];
            }
          }

          // If not resolved yet, try to use passed taskId for relative paths
          if (!taskId && !relativePath && resolvedTaskId) {
            // Path is relative, resolve using the session directory
            // For paths like "ai-digest-dashboard.html", resolve to session directory
            relativePath = file.path;
            taskId = resolvedTaskId;
          } else if (!taskId && !relativePath) {
            // Legacy /sessions/ format
            const pathParts = file.path.split("/sessions/");
            if (pathParts.length >= 2) {
              const taskIdAndPath = pathParts[1];
              const parts = taskIdAndPath.split("/");
              taskId = parts[0];
              relativePath = parts.slice(1).join("/");
            }
          }

          if (!taskId || !relativePath) {
            console.error("[WebsitePreview] Invalid path format:", file.path);
            setError(t("common.filePreview.invalidFilePath"));
            setLoading(false);
            return;
          }

          const response = await fetch(
            `/api/workspace/file/${encodeURIComponent(taskId)}/${encodeURIComponent(relativePath)}`,
          );
          if (!response.ok) {
            throw new Error(t("common.filePreview.loadFromApiFailed"));
          }

          const data = await response.json();
          content = data.content || "";

          const lastSlashIndex = relativePath.lastIndexOf("/");
          fileDir =
            lastSlashIndex > 0 ? relativePath.substring(0, lastSlashIndex) : "";
        }

        content = await inlineResources(content, fileDir, resolvedTaskId);
        setHtmlContent(content);
      } catch (err) {
        console.error("[WebsitePreview] Failed to read file:", err);
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[WebsitePreview] Error details:", {
          path: file.path,
          error: errorMsg,
          isTauri: !!(window as any).__TAURI__,
        });
        setError(errorMsg);
      } finally {
        setLoading(false);
      }
    };

    readFileContent();
  }, [file.path, file.name, taskId, t]);

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-white">
        <FilePreviewDrawerHeader fileName={file.name}>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 hover:bg-muted transition-colors"
            aria-label={t("common.close", "Close")}
          >
            <RemixIcon name="close" size="size-4" />
          </button>
        </FilePreviewDrawerHeader>
        <div className="flex-1 flex items-center justify-center">
          <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
        </div>
      </div>
    );
  }

  if (error || !htmlContent) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-white">
        <FilePreviewDrawerHeader fileName={file.name}>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 hover:bg-muted transition-colors"
            aria-label={t("common.close", "Close")}
          >
            <RemixIcon name="close" size="size-4" />
          </button>
        </FilePreviewDrawerHeader>
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <p className="text-6xl mb-4">❌</p>
          <p className="text-lg font-medium mb-2">
            {t("common.filePreview.websiteLoadFailed")}
          </p>
          <p className="text-sm text-muted-foreground">
            {error || t("common.filePreview.unknownError")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <WebsitePreview
      content={htmlContent}
      filename={file.name}
      filePath={file.path}
      taskId={taskId}
      onClose={onClose}
    />
  );
}
