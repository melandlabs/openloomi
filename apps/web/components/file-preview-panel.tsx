"use client";

import { useState, useEffect } from "react";
import { RemixIcon } from "@/components/remix-icon";
import { ErrorBoundary } from "./error-boundary";
import { useTranslation } from "react-i18next";
import { IMAGE_FILE_EXTENSIONS } from "@/components/file-icons";
import { revealItemInDir, openPathCustom } from "@/lib/tauri";
import {
  isAppleDocumentFile,
  extractApplePreviewPdf,
} from "@/lib/files/apple-preview";
import { FilePreviewDrawerHeader } from "@/components/file-preview-drawer-header";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  usePdfPreview,
  PdfPreviewHeaderToolbar,
  PdfPreviewScrollBody,
} from "@/components/artifacts/pdf-preview";

// Helper function: converts Uint8Array to Base64 string (performance optimized)
function uint8ToBase64(uint8Array: Uint8Array): string {
  const len = uint8Array.byteLength;
  let binary = "";
  const chunkSize = 0x8000; // 32KB chunks to avoid stack overflow

  for (let i = 0; i < len; i += chunkSize) {
    const end = Math.min(i + chunkSize, len);
    binary += String.fromCharCode.apply(
      null,
      Array.from(uint8Array.slice(i, end)),
    );
  }

  return btoa(binary);
}

/**
 * Check if a path is a blob storage pathname (Vercel Blob).
 * Blob storage pathnames look like: cloud_{uuid}/{timestamp}-{uuid}-{filename}
 * or userId/{timestamp}-{uuid}-{filename}
 */
function isBlobStoragePath(path: string): boolean {
  if (!path) return false;
  // Match patterns like:
  // - cloud_d52f89fc-2436-405f-a8c8-ee278447297f/1777556638369-b8c27b6c-...
  // - {userId}/{timestamp}-{uuid}-{filename}
  // Check if path contains patterns typical of blob storage (starts with cloud_ or contains timestamp-uuid pattern)
  const trimmed = path.trim();
  if (trimmed.startsWith("cloud_")) return true;
  // Check for timestamp-uuid pattern: digits-digits-hyphenated-uuid
  if (
    /^\d+-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/.test(
      trimmed,
    )
  )
    return true;
  return false;
}

interface FilePreviewPanelProps {
  file: {
    path: string;
    name: string;
    type: string;
  } | null;
  /** Pass taskId for workspace files, fetched via API (non-Tauri environment) */
  taskId?: string;
  onClose: () => void;
  /** Optional delete callback */
  onDelete?: () => void;
}

const MAX_PREVIEW_SIZE = 100 * 1024 * 1024;

/**
 * File preview panel - displays file content in the right sidebar
 *
 * Supports previewing multiple file types:
 * - PPTX presentations (full slide preview)
 * - PDF documents (full rendering preview)
 * - Excel spreadsheets (multi-sheet preview)
 * - Code files (syntax highlighted)
 * - Other file types (show hints)
 */
export function FilePreviewPanel({
  file,
  taskId,
  onClose,
  onDelete,
}: FilePreviewPanelProps) {
  const { t } = useTranslation();

  // Use dynamic imports to avoid circular imports
  const [PptxPreview, setPptxPreview] = useState<any>(null);
  const [DocxPreviewComp, setDocxPreviewComp] = useState<any>(null);
  const [CodePreviewComp, setCodePreviewComp] = useState<any>(null);
  const [ExcelPreviewComp, setExcelPreviewComp] = useState<any>(null);
  const [CsvPreviewComp, setCsvPreviewComp] = useState<any>(null);
  const [WebsitePreviewComp, setWebsitePreviewComp] = useState<any>(null);
  const [MarkdownPreviewComp, setMarkdownPreviewComp] = useState<any>(null);
  const [VideoPreviewComp, setVideoPreviewComp] = useState<any>(null);
  const [AudioPreviewComp, setAudioPreviewComp] = useState<any>(null);
  const [ArchivePreviewComp, setArchivePreviewComp] = useState<any>(null);
  const [MindMapPreviewComp, setMindMapPreviewComp] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [codeContent, setCodeContent] = useState<string | null>(null);
  const [pdfContent, setPdfContent] = useState<Uint8Array | null>(null);
  const [fileTooLarge, setFileTooLarge] = useState<number | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [fullArtifactPath, setFullArtifactPath] = useState<string | null>(null);

  // Clean file type: remove whitespace (including newlines) and convert MIME type to extension
  const rawType = file?.type?.trim() || "";
  // If rawType looks like a MIME type (contains "/"), convert it to a file extension
  const cleanType = rawType.includes("/")
    ? (() => {
        const subtype = rawType.split("/")[1] ?? "";
        // Normalize common MIME type subtypes to extensions
        if (subtype === "jpeg") return "jpg";
        if (subtype === "tiff") return "jpg"; // Treat TIFF from phones as JPG
        return subtype;
      })()
    : rawType;

  const isPdfDrawerPreview =
    Boolean(file) &&
    pdfContent != null &&
    (cleanType === "pdf" || isAppleDocumentFile(cleanType));

  const pdfDrawerModel = usePdfPreview(isPdfDrawerPreview ? pdfContent : null, {
    path: fullArtifactPath ?? undefined,
    downloadFileName: file?.name ?? "document.pdf",
    enabled: isPdfDrawerPreview,
  });

  // Use shared image extension constants (without dot)
  const imageFileTypes = IMAGE_FILE_EXTENSIONS.map((ext) => ext.slice(1));

  // Dynamic import preview components
  useEffect(() => {
    Promise.all([
      import("./artifacts/pptx-preview"),
      import("./artifacts/docx-preview"),
      import("./artifacts/code-preview"),
      import("./artifacts/excel-preview"),
      import("./artifacts/csv-preview"),
      import("./website-preview"),
      import("./markdown-preview"),
      import("./artifacts/video-preview"),
      import("./artifacts/audio-preview"),
      import("./artifacts/archive-preview"),
      import("./artifacts/mindmap-preview"),
    ])
      .then(
        ([
          pptxModule,
          docxModule,
          codeModule,
          excelModule,
          csvModule,
          websiteModule,
          markdownModule,
          videoModule,
          audioModule,
          archiveModule,
          mindmapModule,
        ]) => {
          setPptxPreview(() => pptxModule.PptxPreview);
          setDocxPreviewComp(() => docxModule.DocxPreview);
          setCodePreviewComp(() => codeModule.CodePreview);
          setExcelPreviewComp(() => excelModule.ExcelPreview);
          setCsvPreviewComp(() => csvModule.CsvPreview);
          setWebsitePreviewComp(() => websiteModule.WebsitePreview);
          setMarkdownPreviewComp(() => markdownModule.MarkdownPreview);
          setVideoPreviewComp(() => videoModule.VideoPreview);
          setAudioPreviewComp(() => audioModule.AudioPreview);
          setArchivePreviewComp(() => archiveModule.ArchivePreview);
          setMindMapPreviewComp(() => mindmapModule.MindMapPreview);
          setLoading(false);
        },
      )
      .catch((err) => {
        console.error(
          "[FilePreviewPanel] Failed to load preview components:",
          err,
        );
        setError(t("common.filePreview.componentLoadFailed"));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!file || loading) return;

    const codeFileTypes = [
      "py",
      "js",
      "ts",
      "tsx",
      "jsx",
      "css",
      "json",
      "txt",
      "sh",
      "bash",
      "csv",
    ];
    const isCodeFile = codeFileTypes.includes(cleanType);
    const isHtmlFile = cleanType === "html" || cleanType === "htm";
    const isMarkdownFile = cleanType === "md" || cleanType === "markdown";
    const isPdfFile = cleanType === "pdf";
    const isImageFile = imageFileTypes.includes(cleanType);
    const isAppleFile = isAppleDocumentFile(cleanType);
    const videoFileTypes = ["mp4", "webm", "mov", "avi", "mkv", "flv"];
    const audioFileTypes = ["mp3", "wav", "flac", "aac", "ogg", "m4a"];
    const archiveFileTypes = ["zip", "rar", "7z", "tar", "gz", "bz2"];
    const isVideoFile = videoFileTypes.includes(cleanType);
    const isAudioFile = audioFileTypes.includes(cleanType);
    const isArchiveFile = archiveFileTypes.includes(cleanType);
    const isMindMapFile = cleanType === "mmark";

    if (
      !isCodeFile &&
      !isHtmlFile &&
      !isMarkdownFile &&
      !isPdfFile &&
      !isImageFile &&
      !isAppleFile &&
      !isVideoFile &&
      !isAudioFile &&
      !isArchiveFile &&
      !isMindMapFile
    )
      return;

    const readFileContent = async () => {
      try {
        // If taskId exists, fetch workspace file content via API (applicable to library page, etc.)
        if (taskId && file.path) {
          // Check if this is a blob storage path (not a workspace session file)
          // Blob storage paths look like: cloud_{uuid}/{timestamp}-{uuid}-{filename}
          // These should be routed to /api/files/download instead of workspace file API
          if (isBlobStoragePath(file.path)) {
            const mimeType = isImageFile
              ? `image/${cleanType === "jpg" ? "jpeg" : cleanType}`
              : isPdfFile
                ? "application/pdf"
                : "application/octet-stream";
            const res = await fetch(
              `/api/files/download?path=${encodeURIComponent(file.path)}`,
              {
                headers: {
                  Accept: mimeType,
                },
              },
            );
            if (!res.ok) {
              if (res.status === 404) {
                setError(
                  t("common.filePreview.fileNotFound") || "File not found",
                );
              } else {
                setError(
                  t("common.filePreview.loadFailed") || "Failed to load file",
                );
              }
              return;
            }
            const arrayBuffer = await res.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);

            if (isPdfFile) {
              setPdfContent(uint8Array);
            } else if (isImageFile) {
              const dataUrl = `data:${mimeType};base64,${uint8ToBase64(uint8Array)}`;
              setImageDataUrl(dataUrl);
            } else if (isAppleFile) {
              const pdfData = await extractApplePreviewPdf(arrayBuffer);
              if (pdfData) {
                setPdfContent(pdfData);
              } else {
                setError(
                  t("common.filePreview.previewNotAvailable") ||
                    "No preview available for this Apple document",
                );
              }
            }
            return;
          }
          // For image and PDF files, need to fetch binary data
          if (isPdfFile || isImageFile || isAppleFile) {
            const mimeType = isImageFile
              ? `image/${cleanType === "jpg" ? "jpeg" : cleanType}`
              : "application/octet-stream";
            const res = await fetch(
              `/api/workspace/file/${encodeURIComponent(taskId)}/${encodeURIComponent(file.path)}?binary=true`,
              {
                headers: {
                  Accept: mimeType,
                },
              },
            );
            if (!res.ok) {
              if (res.status === 404) {
                setError(
                  t("common.filePreview.fileNotFound") || "File not found",
                );
              } else {
                setError(
                  t("common.filePreview.loadFailed") || "Failed to load file",
                );
              }
              return;
            }
            const arrayBuffer = await res.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);

            if (isPdfFile) {
              setPdfContent(uint8Array);
            } else if (isImageFile) {
              const dataUrl = `data:${mimeType};base64,${uint8ToBase64(uint8Array)}`;
              setImageDataUrl(dataUrl);
            } else if (isAppleFile) {
              // Apple file: extract iCloud preview PDF
              const pdfData = await extractApplePreviewPdf(arrayBuffer);
              if (pdfData) {
                setPdfContent(pdfData);
              } else {
                setError(
                  t("common.filePreview.previewNotAvailable") ||
                    "No preview available for this Apple document",
                );
              }
            }
            return;
          }

          // For video, audio, and archive files, fetch binary data and create blob URL
          if (isVideoFile || isAudioFile || isArchiveFile) {
            const mimeTypeMap: Record<string, string> = {
              mp4: "video/mp4",
              webm: "video/webm",
              mov: "video/quicktime",
              avi: "video/x-msvideo",
              mkv: "video/x-matroska",
              flv: "video/x-flv",
              mp3: "audio/mpeg",
              wav: "audio/wav",
              flac: "audio/flac",
              aac: "audio/aac",
              ogg: "audio/ogg",
              m4a: "audio/mp4",
              zip: "application/zip",
              rar: "application/vnd.rar",
              "7z": "application/x-7z-compressed",
              tar: "application/x-tar",
              gz: "application/gzip",
              bz2: "application/x-bzip2",
            };
            const mimeType =
              mimeTypeMap[cleanType] || "application/octet-stream";
            const res = await fetch(
              `/api/workspace/file/${encodeURIComponent(taskId)}/${encodeURIComponent(file.path)}?binary=true`,
              {
                headers: {
                  Accept: mimeType,
                },
              },
            );
            if (!res.ok) {
              if (res.status === 404) {
                setError(
                  t("common.filePreview.fileNotFound") || "File not found",
                );
              } else {
                setError(
                  t("common.filePreview.loadFailed") || "Failed to load file",
                );
              }
              return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            setMediaUrl(url);
            return;
          }

          // For code/text files, fetch JSON format content
          const res = await fetch(
            `/api/workspace/file/${encodeURIComponent(taskId)}/${encodeURIComponent(file.path)}`,
          );
          if (!res.ok) {
            if (res.status === 404) {
              setError(
                t("common.filePreview.fileNotFound") || "File not found",
              );
            } else {
              setError(
                t("common.filePreview.loadFailed") || "Failed to load file",
              );
            }
            return;
          }
          const data = await res.json();
          const content = data.content as string | undefined;
          if (content == null) {
            setError(t("common.filePreview.loadFailed") || "No content");
            return;
          }
          setCodeContent(content);
          return;
        }

        // If path is an API URL (e.g., /api/rag/documents/...), fetch directly via HTTP
        if (file.path.startsWith("/api/")) {
          const res = await fetch(file.path, {
            headers: {
              Accept: isPdfFile
                ? "application/pdf"
                : isImageFile
                  ? `image/${cleanType === "jpg" ? "jpeg" : cleanType}`
                  : isVideoFile
                    ? "video/mp4"
                    : isAudioFile
                      ? "audio/mpeg"
                      : "application/octet-stream",
            },
          });
          if (!res.ok) {
            if (res.status === 404) {
              setError(
                t("common.filePreview.fileNotFound") || "File not found",
              );
            } else {
              setError(
                t("common.filePreview.loadFailed") || "Failed to load file",
              );
            }
            return;
          }
          const arrayBuffer = await res.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);

          if (isPdfFile) {
            setPdfContent(uint8Array);
          } else if (isImageFile) {
            const mimeType = `image/${cleanType === "jpg" ? "jpeg" : cleanType}`;
            const dataUrl = `data:${mimeType};base64,${uint8ToBase64(uint8Array)}`;
            setImageDataUrl(dataUrl);
          } else if (isAppleFile) {
            // Apple file: extract iCloud preview PDF
            const pdfData = await extractApplePreviewPdf(arrayBuffer);
            if (pdfData) {
              setPdfContent(pdfData);
            } else {
              setError(
                t("common.filePreview.previewNotAvailable") ||
                  "No preview available for this Apple document",
              );
            }
          } else if (isMindMapFile) {
            // Mind map file: decode as text
            const decoder = new TextDecoder("utf-8");
            const textContent = decoder.decode(arrayBuffer);
            setCodeContent(textContent);
          } else if (isCodeFile || isMarkdownFile || isHtmlFile) {
            // For text-based files, convert binary to text and set codeContent
            const decoder = new TextDecoder("utf-8");
            const textContent = decoder.decode(arrayBuffer);
            setCodeContent(textContent);
          } else {
            // For other types (video, audio, archive, etc.), create blob URL
            const blob = new Blob([arrayBuffer], {
              type: isVideoFile
                ? "video/mp4"
                : isAudioFile
                  ? "audio/mpeg"
                  : isArchiveFile
                    ? "application/zip"
                    : "application/octet-stream",
            });
            const url = URL.createObjectURL(blob);
            setMediaUrl(url);
          }
          return;
        }

        // Check if in Tauri environment
        const isTauri = !!(window as any).__TAURI__;

        if (!isTauri) {
          setError(t("common.filePreview.tauriOnly"));
          return;
        }

        const { readFileBinary, fileStat } = await import("@/lib/tauri");

        // Parse file path: prefer resolved fullArtifactPath, otherwise try to expand ~
        let filePath = fullArtifactPath || file.path;
        const originalPath = file.path;

        // Clean path: remove trailing whitespace, parentheses, quotes, etc.
        filePath = filePath.trim().replace(/[()\s"'\]]+$/g, "");

        // If path starts with ~ and not resolved, try to expand
        if (filePath.startsWith("~/") && !fullArtifactPath) {
          try {
            const { homeDirCustom } = await import("@/lib/tauri");
            const homePath = await homeDirCustom();
            if (homePath) {
              filePath = filePath.replace(/^~/, homePath);
            }
          } catch (pathErr) {
            console.error(
              "[FilePreviewPanel] Failed to expand ~ path:",
              pathErr,
            );
          }
        }

        // Verify path is absolute
        if (!filePath.startsWith("/")) {
          console.warn(
            "[FilePreviewPanel] Relative path detected, this should have been resolved before",
            filePath,
          );
        }

        const fileInfo = await fileStat(filePath);
        if (!fileInfo) {
          setError("Failed to get file info");
          return;
        }
        if (fileInfo.size > MAX_PREVIEW_SIZE) {
          setFileTooLarge(fileInfo.size);
          return;
        }

        const data = await readFileBinary(filePath);
        if (!data) {
          setError("Failed to get file content");
          return;
        }

        if (isPdfFile) {
          // PDF file: create completely independent Uint8Array copy
          // Use Array.from to create completely independent copy, avoid sharing underlying buffer
          const sourceArray = new Uint8Array(
            data.buffer,
            data.byteOffset,
            data.byteLength,
          );
          const uint8Array = new Uint8Array(sourceArray.length);
          for (let i = 0; i < sourceArray.length; i++) {
            uint8Array[i] = sourceArray[i];
          }
          setPdfContent(uint8Array);
        } else if (isImageFile) {
          // Image file: convert to Data URL
          const uint8Array = new Uint8Array(
            data.buffer,
            data.byteOffset,
            data.byteLength,
          );
          const mimeType = `image/${cleanType === "jpg" ? "jpeg" : cleanType}`;
          const dataUrl = `data:${mimeType};base64,${uint8ToBase64(uint8Array)}`;
          setImageDataUrl(dataUrl);
        } else if (isAppleFile) {
          // Apple file: extract iCloud preview PDF
          const arrayBuffer = data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength,
          );
          const pdfData = await extractApplePreviewPdf(arrayBuffer);
          if (pdfData) {
            setPdfContent(pdfData);
          } else {
            setError(
              t("common.filePreview.previewNotAvailable") ||
                "No preview available for this Apple document",
            );
          }
        } else if (isVideoFile || isAudioFile || isArchiveFile) {
          // Video, audio, or archive file: create blob URL
          const uint8Array = new Uint8Array(
            data.buffer,
            data.byteOffset,
            data.byteLength,
          );
          const mimeTypeMap: Record<string, string> = {
            mp4: "video/mp4",
            webm: "video/webm",
            mov: "video/quicktime",
            avi: "video/x-msvideo",
            mkv: "video/x-matroska",
            flv: "video/x-flv",
            mp3: "audio/mpeg",
            wav: "audio/wav",
            flac: "audio/flac",
            aac: "audio/aac",
            ogg: "audio/ogg",
            m4a: "audio/mp4",
            zip: "application/zip",
            rar: "application/vnd.rar",
            "7z": "application/x-7z-compressed",
            tar: "application/x-tar",
            gz: "application/gzip",
            bz2: "application/x-bzip2",
          };
          const mimeType = mimeTypeMap[cleanType] || "application/octet-stream";
          const blob = new Blob([new Uint8Array(uint8Array)], {
            type: mimeType,
          });
          const url = URL.createObjectURL(blob);
          setMediaUrl(url);
        } else {
          // Code file: decode to text
          const decoder = new TextDecoder("utf-8");
          const textContent = decoder.decode(data);
          setCodeContent(textContent);
        }
      } catch (err) {
        console.error("[FilePreviewPanel] Failed to read file:", {
          error: err,
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          path: file.path,
          type: cleanType,
        });
        setError(
          `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };

    readFileContent();
  }, [file, taskId, loading]);

  // Calculate absolute path needed in Tauri environment (for Excel/PPTX/DOCX components)
  useEffect(() => {
    const resolveFullPath = async () => {
      if (!file) {
        setFullArtifactPath(null);
        return;
      }

      // If path starts with ~, expand to user home directory path
      if (file.path?.startsWith("~/")) {
        try {
          const { homeDirCustom } = await import("@/lib/tauri");
          const homePath = await homeDirCustom();
          if (homePath) {
            setFullArtifactPath(file.path.replace(/^~/, homePath));
            return;
          }
        } catch (pathErr) {
          console.error("[FilePreviewPanel] Failed to expand ~ path:", pathErr);
        }
      }

      // If path looks like a real absolute path (starts with /Users/ or /home/),
      // use it directly. Otherwise treat it as relative to session directory.
      if (file.path?.startsWith("/Users/") || file.path?.startsWith("/home/")) {
        setFullArtifactPath(file.path);
        return;
      }

      // Only for truly relative paths (or LLM output like /output/xxx),
      // use taskId to construct path
      if (taskId && file.path) {
        // Construct: ~/.openloomi/sessions/{taskId}/{relativePath}
        try {
          const { homeDirCustom } = await import("@/lib/tauri");
          const homePath = await homeDirCustom();
          if (homePath) {
            setFullArtifactPath(
              `${homePath}/.openloomi/sessions/${taskId}/${file.path}`,
            );
            return;
          }
        } catch (pathErr) {
          console.error(
            "[FilePreviewPanel] Failed to resolve full path:",
            pathErr,
          );
        }
      }

      setFullArtifactPath(null);
    };

    resolveFullPath();
  }, [file, taskId]);

  const getFileTypeIconName = (type: string): string => {
    const iconMap: Record<string, string> = {
      pptx: "presentation",
      ppt: "presentation",
      pdf: "file_text",
      xlsx: "file_spreadsheet",
      xls: "file_spreadsheet",
      csv: "file_spreadsheet",
      docx: "file_text",
      doc: "file_text",
      py: "code",
      js: "code",
      ts: "code",
      tsx: "code",
      jsx: "code",
      html: "code",
      css: "code",
      json: "file_text",
      md: "file_type",
      markdown: "file_type",
      txt: "file_text",
      png: "file_image",
      jpg: "file_image",
      jpeg: "file_image",
      gif: "file_image",
      svg: "file_image",
      // Apple office suite format
      pages: "file_text",
      numbers: "file_spreadsheet",
      keynote: "presentation",
      // Video formats
      mp4: "video",
      webm: "video",
      mov: "video",
      avi: "video",
      mkv: "video",
      flv: "video",
      // Audio formats
      mp3: "music_2",
      wav: "music_2",
      flac: "music_2",
      aac: "music_2",
      ogg: "music_2",
      m4a: "music_2",
      // Archive formats
      zip: "file_archive",
      rar: "file_archive",
      "7z": "file_archive",
      tar: "file_archive",
      gz: "file_archive",
      bz2: "file_archive",
    };
    return iconMap[type] ?? "file";
  };

  if (!file) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <RemixIcon
          name="file_text"
          size="size-12"
          className="text-muted-foreground/50 mb-4"
        />
        <p className="text-sm text-muted-foreground">
          {t("common.filePreview.selectFile")}
        </p>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <RemixIcon
          name="loader_2"
          size="size-8"
          className="animate-spin text-primary mb-4"
        />
        <p className="text-sm text-muted-foreground">
          {t("common.filePreview.loading")}
        </p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-white">
        <FilePreviewDrawerHeader fileName={file.name}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={onClose}
                aria-label={t("common.close", "Close")}
              >
                <RemixIcon name="close" size="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{t("common.close", "Close")}</p>
            </TooltipContent>
          </Tooltip>
        </FilePreviewDrawerHeader>

        {/* Error Content */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <p className="text-6xl mb-4">❌</p>
          <p className="text-lg font-medium mb-2">
            {t("common.filePreview.loadFailed")}
          </p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  // HTML file preview - directly use WebsitePreview, no extra Header needed
  if (
    (cleanType === "html" || cleanType === "htm") &&
    WebsitePreviewComp &&
    codeContent
  ) {
    return (
      <WebsitePreviewComp
        content={codeContent}
        filename={file.name}
        filePath={fullArtifactPath || undefined}
        onClose={onClose}
      />
    );
  }

  // Markdown file preview - directly use MarkdownPreview, no extra Header needed
  if (
    (cleanType === "md" || cleanType === "markdown") &&
    MarkdownPreviewComp &&
    codeContent
  ) {
    return (
      <MarkdownPreviewComp
        content={codeContent}
        filename={file.name}
        filePath={fullArtifactPath || undefined}
        onClose={onClose}
      />
    );
  }

  // Mind map file preview
  if (cleanType === "mmark" && MindMapPreviewComp && codeContent) {
    return (
      <MindMapPreviewComp
        content={codeContent}
        filename={file.name}
        maxHeight="calc(100vh - 8rem)"
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <FilePreviewDrawerHeader fileName={file.name}>
        {isPdfDrawerPreview ? (
          <PdfPreviewHeaderToolbar model={pdfDrawerModel} />
        ) : null}
        {cleanType === "csv" && codeContent ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => {
                  const blob = new Blob([codeContent], {
                    type: "text/csv;charset=utf-8;",
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = file.name || "export.csv";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <RemixIcon name="download" size="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{t("common.spreadsheetPreview.exportCsv", "Export CSV")}</p>
            </TooltipContent>
          </Tooltip>
        ) : null}
        {fullArtifactPath && !isPdfDrawerPreview ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => revealItemInDir(fullArtifactPath)}
                >
                  <RemixIcon name="folder_open" size="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{t("common.filePreview.showInFolder", "Show in Folder")}</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => openPathCustom(fullArtifactPath)}
                >
                  <RemixIcon name="external_link" size="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>
                  {t(
                    "common.filePreview.openWithDefaultApp",
                    "Open with Default App",
                  )}
                </p>
              </TooltipContent>
            </Tooltip>
          </>
        ) : null}
        {onDelete ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-destructive hover:text-destructive"
                onClick={onDelete}
                aria-label={t("common.delete", "Delete")}
              >
                <RemixIcon name="delete" size="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{t("common.delete", "Delete")}</p>
            </TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={onClose}
              aria-label={t("common.close", "Close")}
            >
              <RemixIcon name="close" size="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{t("common.close", "Close")}</p>
          </TooltipContent>
        </Tooltip>
      </FilePreviewDrawerHeader>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto">
        {/* PPTX file preview - protected by error boundary */}
        {cleanType === "pptx" &&
        PptxPreview &&
        (fullArtifactPath || (!taskId && file.path?.startsWith("/"))) ? (
          <ErrorBoundary
            fallback={
              <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                <p className="text-6xl mb-4">📊</p>
                <p className="text-lg font-medium mb-2">
                  {t("common.filePreview.pptxFailed")}
                </p>
                <p className="text-sm text-muted-foreground mb-4">
                  {file.name}
                </p>
                <p className="text-xs text-muted-foreground max-w-md">
                  {t("common.filePreview.pptxFailedHint")}
                </p>
              </div>
            }
          >
            <PptxPreview
              artifact={{ ...file, path: fullArtifactPath || file.path }}
              taskId={taskId}
            />
          </ErrorBoundary>
        ) : null}

        {/* DOCX file preview */}
        {(cleanType === "docx" || cleanType === "doc") &&
        DocxPreviewComp &&
        (fullArtifactPath || (!taskId && file.path?.startsWith("/"))) ? (
          <ErrorBoundary
            fallback={
              <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                <p className="text-6xl mb-4">📄</p>
                <p className="text-lg font-medium mb-2">
                  {t(
                    "common.filePreview.docxFailed",
                    "Failed to preview document",
                  )}
                </p>
                <p className="text-sm text-muted-foreground mb-4">
                  {file.name}
                </p>
                <p className="text-xs text-muted-foreground max-w-md">
                  {t(
                    "common.filePreview.docxFailedHint",
                    "Please try opening the file in Microsoft Word",
                  )}
                </p>
              </div>
            }
          >
            <DocxPreviewComp
              artifact={{ ...file, path: fullArtifactPath || file.path }}
            />
          </ErrorBoundary>
        ) : null}

        {/* Excel file preview - requires absolute path to read */}
        {["xlsx", "xls"].includes(cleanType) &&
        ExcelPreviewComp &&
        (fullArtifactPath || (!taskId && file.path?.startsWith("/"))) ? (
          <ErrorBoundary
            fallback={
              <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                <p className="text-6xl mb-4">📊</p>
                <p className="text-lg font-medium mb-2">
                  {t("common.filePreview.excelFailed")}
                </p>
                <p className="text-sm text-muted-foreground mb-4">
                  {file.name}
                </p>
                <p className="text-xs text-muted-foreground max-w-md">
                  {t("common.filePreview.excelFailedHint")}
                </p>
              </div>
            }
          >
            <ExcelPreviewComp
              artifact={{ ...file, path: fullArtifactPath || file.path }}
            />
          </ErrorBoundary>
        ) : null}

        {/* CSV: papaparse table preview (supports taskId API to fetch text) */}
        {cleanType === "csv" && CsvPreviewComp ? (
          <div className="relative h-full min-h-0 px-4 py-3">
            {codeContent ? (
              <ErrorBoundary
                fallback={
                  <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                    <p className="text-lg font-medium mb-2">
                      {t(
                        "common.filePreview.excelFailed",
                        "Table preview failed",
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground">{file.name}</p>
                  </div>
                }
              >
                <CsvPreviewComp
                  content={codeContent}
                  maxHeight="calc(100vh - 8rem)"
                  hideFileTitleBar
                />
              </ErrorBoundary>
            ) : (
              <div className="flex items-center justify-center p-8">
                <RemixIcon
                  name="loader_2"
                  size="size-6"
                  className="animate-spin text-primary"
                />
              </div>
            )}
          </div>
        ) : null}

        {/* Code file preview */}
        {[
          "py",
          "js",
          "ts",
          "tsx",
          "jsx",
          "css",
          "json",
          "txt",
          "sh",
          "bash",
        ].includes(cleanType) &&
          CodePreviewComp && (
            <div className="p-4">
              {fileTooLarge ? (
                <div className="flex flex-col items-center justify-center p-8 text-center">
                  <p className="text-6xl mb-4">📦</p>
                  <p className="text-lg font-medium mb-2">
                    {t("common.filePreview.fileTooLarge")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t("common.filePreview.fileTooLargeDesc", {
                      size: (fileTooLarge / 1024 / 1024).toFixed(2),
                    })}
                  </p>
                </div>
              ) : codeContent ? (
                <CodePreviewComp
                  code={codeContent}
                  filename={file.name}
                  language={cleanType}
                  maxHeight="100%"
                />
              ) : (
                <div className="flex items-center justify-center p-8">
                  <RemixIcon
                    name="loader_2"
                    size="size-6"
                    className="animate-spin text-primary"
                  />
                </div>
              )}
            </div>
          )}

        {/* PDF file preview */}
        {(cleanType === "pdf" ||
          (isAppleDocumentFile(cleanType) && pdfContent)) && (
          <ErrorBoundary
            fallback={
              <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                <p className="text-6xl mb-4">📕</p>
                <p className="text-lg font-medium mb-2">
                  {isAppleDocumentFile(cleanType)
                    ? t("common.filePreview.previewNotAvailable")
                    : t("common.filePreview.pdfFailed")}
                </p>
                <p className="text-sm text-muted-foreground mb-4">
                  {file.name}
                </p>
                <p className="text-xs text-muted-foreground max-w-md">
                  {isAppleDocumentFile(cleanType)
                    ? t("common.filePreview.applePreviewFailed") ||
                      "This Apple document may not have an iCloud preview"
                    : t("common.filePreview.pdfFailedHint")}
                </p>
              </div>
            }
          >
            {pdfContent ? (
              <PdfPreviewScrollBody
                model={pdfDrawerModel}
                maxHeight="100%"
                className="h-full min-h-0"
              />
            ) : (
              <div className="flex items-center justify-center p-8">
                <RemixIcon
                  name="loader_2"
                  size="size-6"
                  className="animate-spin text-primary"
                />
              </div>
            )}
          </ErrorBoundary>
        )}

        {/* Image file preview */}
        {imageFileTypes.includes(cleanType) && (
          <div className="flex items-center justify-center p-4 h-full bg-muted/30">
            {imageDataUrl ? (
              <img
                src={imageDataUrl}
                alt={file.name}
                className="max-w-full max-h-full object-contain rounded-md shadow-sm"
              />
            ) : (
              <div className="flex items-center justify-center">
                <RemixIcon
                  name="loader_2"
                  size="size-6"
                  className="animate-spin text-primary"
                />
              </div>
            )}
          </div>
        )}

        {/* Video file preview */}
        {["mp4", "webm", "mov", "avi", "mkv", "flv"].includes(cleanType) &&
          VideoPreviewComp && (
            <div className="flex items-center justify-center p-4 h-full bg-neutral-900">
              {mediaUrl ? (
                <VideoPreviewComp
                  src={mediaUrl}
                  filename={file.name}
                  className="w-full max-w-3xl aspect-video"
                />
              ) : (
                <div className="flex items-center justify-center">
                  <RemixIcon
                    name="loader_2"
                    size="size-6"
                    className="animate-spin text-primary"
                  />
                </div>
              )}
            </div>
          )}

        {/* Audio file preview */}
        {["mp3", "wav", "flac", "aac", "ogg", "m4a"].includes(cleanType) &&
          AudioPreviewComp && (
            <div className="flex items-center justify-center p-4 h-full bg-neutral-50 dark:bg-neutral-900">
              {mediaUrl ? (
                <AudioPreviewComp
                  src={mediaUrl}
                  filename={file.name}
                  className="w-full max-w-md"
                />
              ) : (
                <div className="flex items-center justify-center">
                  <RemixIcon
                    name="loader_2"
                    size="size-6"
                    className="animate-spin text-primary"
                  />
                </div>
              )}
            </div>
          )}

        {/* Archive file preview */}
        {["zip", "rar", "7z", "tar", "gz", "bz2"].includes(cleanType) &&
          ArchivePreviewComp && (
            <div className="flex items-center justify-center p-4 h-full">
              {mediaUrl ? (
                <ArchivePreviewComp
                  src={mediaUrl}
                  filename={file.name}
                  className="w-full max-w-md"
                />
              ) : (
                <div className="flex items-center justify-center">
                  <RemixIcon
                    name="loader_2"
                    size="size-6"
                    className="animate-spin text-primary"
                  />
                </div>
              )}
            </div>
          )}

        {/* Other file types */}
        {!["pptx", "docx", "doc", "pdf", "xlsx", "xls", "csv"]
          .concat([
            "py",
            "js",
            "ts",
            "tsx",
            "jsx",
            "html",
            "htm",
            "css",
            "json",
            "md",
            "markdown",
            "mmark",
            "txt",
            "sh",
            "bash",
            "png",
            "jpg",
            "jpeg",
            "gif",
            "svg",
            "webp",
            "bmp",
            "ico",
            // Apple office suite format
            "pages",
            "numbers",
            "keynote",
            // Video formats
            "mp4",
            "webm",
            "mov",
            "avi",
            "mkv",
            "flv",
            // Audio formats
            "mp3",
            "wav",
            "flac",
            "aac",
            "ogg",
            "m4a",
            // Archive formats
            "zip",
            "rar",
            "7z",
            "tar",
            "gz",
            "bz2",
          ])
          .includes(cleanType) && (
          <div className="flex flex-col items-center justify-center p-8 text-center h-full">
            <div className="mb-4 flex size-20 items-center justify-center rounded-full bg-muted">
              <RemixIcon
                name={getFileTypeIconName(cleanType)}
                size="size-10"
                className="text-muted-foreground"
              />
            </div>
            <p className="text-lg font-medium mb-2">
              {t("common.filePreview.previewNotAvailable")}
            </p>
            <p className="text-sm text-muted-foreground mb-4">{file.name}</p>
            <p className="text-xs text-muted-foreground max-w-md">
              {t("common.filePreview.fileTypeNotSupported", {
                type: cleanType,
              })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
