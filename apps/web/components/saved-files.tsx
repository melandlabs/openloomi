"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import useSWR from "swr";
import { format } from "date-fns";
import Link from "next/link";
import { RemixIcon } from "@/components/remix-icon";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Progress,
} from "@openloomi/ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@openloomi/ui";
import { useFileStorageUsage } from "@/hooks/use-file-storage";
import { formatBytes } from "@/lib/utils";
import { openUrl } from "@/lib/tauri";
import {
  MAX_UPLOAD_BYTES,
  SUPPORTED_ATTACHMENT_MIME_TYPES,
  type FileStorageProvider,
} from "@/lib/files/config";

type SavedFile = {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  savedAt: string;
  url: string;
  blobPathname: string;
  storageProvider: FileStorageProvider;
  providerFileId?: string | null;
  providerMetadata?: Record<string, unknown> | null;
};

type SavedFilesResponse = {
  files: SavedFile[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
  };
  usage: {
    usedBytes: number;
    quotaBytes: number;
  };
};

type UploadSavedFileResult = {
  file: SavedFile;
  usage?: SavedFilesResponse["usage"];
};

/**
 * Fetch file list data
 */
const fetcher = async (url: string): Promise<SavedFilesResponse> => {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("unauthorized");
    }
    const payload = await response.json().catch(() => ({}));
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : "Failed to fetch files";
    throw new Error(message);
  }
  return response.json();
};

/**
 * Saved files component
 * Manages user-saved files, including upload, download, and delete functionality
 */
export function SavedFiles() {
  const { t } = useTranslation();
  const { usage: storageUsage, refresh: refreshStorageUsage } =
    useFileStorageUsage(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const acceptedMimeTypes = useMemo(
    () => SUPPORTED_ATTACHMENT_MIME_TYPES.join(","),
    [],
  );
  const allowedMimeTypes = useMemo(
    () => new Set<string>(SUPPORTED_ATTACHMENT_MIME_TYPES),
    [],
  );
  const maxUploadSizeMb = useMemo(
    () => Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024)),
    [],
  );

  const { data, error, isLoading, mutate } = useSWR<SavedFilesResponse>(
    "/api/files/list?limit=50",
    fetcher,
  );

  const usage = data?.usage ?? storageUsage;
  const quotaBytes = usage?.quotaBytes ?? 0;
  const usedBytes = usage?.usedBytes ?? 0;
  const usagePercent = useMemo(() => {
    if (!quotaBytes) return 0;
    return Math.min(100, Math.round((usedBytes / quotaBytes) * 100));
  }, [quotaBytes, usedBytes]);

  const showUpgradeCta = quotaBytes > 0 && usagePercent >= 85;

  /**
   * Upload single file
   */
  const uploadFile = useCallback(
    async (file: File): Promise<UploadSavedFileResult> => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("createRecord", "true");

      let payload: any = null;
      const response = await fetch("/api/files/upload", {
        method: "POST",
        body: formData,
      });

      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const message =
          (payload && typeof payload.error === "string"
            ? payload.error
            : null) ?? t("common.uploadFailed", "Failed to upload file.");
        throw new Error(message);
      }

      const savedFilePayload = payload?.savedFile;
      if (!savedFilePayload) {
        throw new Error(
          t(
            "files.uploadMissingRecord",
            "Upload succeeded but the file could not be saved. Please try again.",
          ),
        );
      }

      const savedFile: SavedFile = {
        id: savedFilePayload.id,
        name: savedFilePayload.name ?? file.name,
        contentType:
          savedFilePayload.contentType ??
          savedFilePayload.mediaType ??
          file.type ??
          "application/octet-stream",
        sizeBytes: Number(savedFilePayload.sizeBytes ?? file.size),
        savedAt:
          typeof savedFilePayload.savedAt === "string"
            ? savedFilePayload.savedAt
            : new Date().toISOString(),
        url:
          savedFilePayload.url ??
          savedFilePayload.blobUrl ??
          payload?.url ??
          "",
        blobPathname:
          savedFilePayload.blobPathname ??
          savedFilePayload.blobPath ??
          payload?.blobPath ??
          payload?.pathname ??
          "",
        storageProvider:
          (savedFilePayload.storageProvider as FileStorageProvider) ??
          "vercel_blob",
        providerFileId:
          savedFilePayload.providerFileId ??
          savedFilePayload.blobPathname ??
          savedFilePayload.blobPath ??
          null,
        providerMetadata: savedFilePayload.providerMetadata ?? null,
      };

      return {
        file: savedFile,
        usage: payload?.usage
          ? {
              usedBytes: Number(payload.usage.usedBytes ?? 0),
              quotaBytes: Number(payload.usage.quotaBytes ?? 0),
            }
          : undefined,
      };
    },
    [t],
  );

  /**
   * Handle upload button click
   */
  const handleUploadClick = useCallback(() => {
    if (isUploading || quotaBytes === 0) {
      return;
    }
    fileInputRef.current?.click();
  }, [isUploading, quotaBytes]);

  /**
   * Handle file input change (upload files)
   */
  const handleFileInputChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(event.target.files ?? []);

      if (selectedFiles.length === 0) {
        return;
      }

      const disallowedTypes = selectedFiles.filter((file) => {
        if (!file.type) return false;
        return !allowedMimeTypes.has(file.type);
      });
      const oversizedFiles = selectedFiles.filter(
        (file) => file.size > MAX_UPLOAD_BYTES,
      );
      const disallowedSet = new Set(disallowedTypes);
      const oversizedSet = new Set(oversizedFiles);
      const validFiles = selectedFiles.filter(
        (file) => !disallowedSet.has(file) && !oversizedSet.has(file),
      );

      if (disallowedTypes.length > 0) {
        toast.error(
          t(
            "files.unsupportedTypeError",
            "Some files aren't supported. Upload images, video, or documents.",
          ),
        );
      }

      if (oversizedFiles.length > 0) {
        toast.error(
          t("files.oversizedError", {
            size: maxUploadSizeMb,
          }),
        );
      }

      if (validFiles.length === 0) {
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        return;
      }

      setIsUploading(true);
      setUploadProgress({
        current: 1,
        total: validFiles.length,
      });

      const successful: SavedFile[] = [];
      let latestUsage: SavedFilesResponse["usage"] | undefined;
      const errors: string[] = [];

      try {
        for (const [index, item] of validFiles.entries()) {
          setUploadProgress({
            current: index + 1,
            total: validFiles.length,
          });
          try {
            const result = await uploadFile(item);
            successful.push(result.file);
            if (result.usage) {
              latestUsage = result.usage;
            }
          } catch (uploadError) {
            console.error("[files] upload failed", uploadError);
            const message =
              uploadError instanceof Error
                ? uploadError.message
                : t("common.uploadFailed", "Failed to upload file.");
            errors.push(message);
          }
        }

        if (successful.length > 0) {
          const fallbackUsage =
            latestUsage ??
            (usage
              ? {
                  quotaBytes: usage.quotaBytes,
                  usedBytes:
                    usage.usedBytes +
                    successful.reduce(
                      (total, item) => total + item.sizeBytes,
                      0,
                    ),
                }
              : undefined);

          await mutate(
            (current) => {
              if (!current) {
                return {
                  files: successful,
                  pagination: {
                    nextCursor: null,
                    hasMore: false,
                  },
                  usage: fallbackUsage ?? {
                    quotaBytes,
                    usedBytes: successful.reduce(
                      (total, item) => total + item.sizeBytes,
                      0,
                    ),
                  },
                };
              }

              return {
                ...current,
                files: [...successful, ...current.files],
                usage: fallbackUsage ?? current.usage,
              };
            },
            { revalidate: false },
          );

          await refreshStorageUsage();
          toast.success(
            successful.length > 1
              ? t("files.uploadSuccessMultiple", "Files uploaded successfully.")
              : t("files.uploadSuccess", "File uploaded successfully."),
          );
        }

        if (errors.length > 0) {
          const errorMessage =
            successful.length > 0
              ? t(
                  "files.uploadFailedSome",
                  "Some files failed to upload. Try again.",
                )
              : errors[0];
          toast.error(errorMessage);
        }
      } finally {
        setUploadProgress(null);
        setIsUploading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [
      allowedMimeTypes,
      maxUploadSizeMb,
      mutate,
      quotaBytes,
      refreshStorageUsage,
      t,
      uploadFile,
      usage,
    ],
  );

  /**
   * Handle file download
   */
  const handleDownload = useCallback(
    async (fileId: string) => {
      try {
        const response = await fetch("/api/files/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId }),
        });

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(
            typeof payload?.error === "string"
              ? payload.error
              : t("files.downloadFailed", "Failed to start download."),
          );
        }

        if (typeof payload.downloadUrl === "string") {
          openUrl(payload.downloadUrl);
        }
      } catch (downloadError) {
        console.error("[files] download failed", downloadError);
        toast.error(
          downloadError instanceof Error
            ? downloadError.message
            : t("files.downloadFailed", "Failed to start download."),
        );
      }
    },
    [t],
  );

  /**
   * Handle file delete
   */
  const handleDelete = useCallback(
    async (file: SavedFile) => {
      try {
        const response = await fetch(`/api/files/${file.id}`, {
          method: "DELETE",
        });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(
            typeof payload?.error === "string"
              ? payload.error
              : t("files.deleteFailed", "Failed to delete file."),
          );
        }

        toast.success(t("files.deleted", "File deleted from your storage."));
        await Promise.all([mutate(), refreshStorageUsage()]);
      } catch (deleteError) {
        console.error("[files] delete failed", deleteError);
        toast.error(
          deleteError instanceof Error
            ? deleteError.message
            : t("files.deleteFailed", "Failed to delete file."),
        );
      }
    },
    [mutate, refreshStorageUsage, t],
  );

  const unauthorized = error?.message === "unauthorized";
  const files = data?.files ?? [];

  return (
    <div className="flex w-full flex-col gap-6">
      <p className="text-sm text-[#6f6e69]">
        {t(
          "files.subtitle",
          "Download, preview, and delete the files you've saved from conversations.",
        )}
      </p>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-slate-900">
              {t("files.uploadTitle", "Upload files")}
            </span>
            {quotaBytes === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t(
                  "files.uploadDisabled",
                  "Upgrade your plan to enable manual file uploads.",
                )}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept={acceptedMimeTypes}
                multiple
                onChange={handleFileInputChange}
              />
              <Button
                type="button"
                size="sm"
                onClick={handleUploadClick}
                disabled={isUploading || quotaBytes === 0}
              >
                {isUploading ? (
                  <RemixIcon
                    name="loader_2"
                    size="size-4"
                    className="mr-1.5 animate-spin"
                  />
                ) : (
                  <RemixIcon
                    name="upload_cloud"
                    size="size-4"
                    className="mr-1.5"
                  />
                )}
                {isUploading
                  ? t("files.uploading", "Uploading...")
                  : t("files.uploadButton", "Upload files")}
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={t(
                      "files.uploadInfoLabel",
                      "Upload requirements",
                    )}
                  >
                    <RemixIcon name="badge_help" size="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs leading-relaxed">
                  <p className="font-medium text-foreground">
                    {t(
                      "files.uploadDescription",
                      "Add files from your device to store them in openloomi for later analysis.",
                    )}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {t("files.uploadHint", {
                      size: maxUploadSizeMb,
                    })}
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
            {isUploading && uploadProgress ? (
              <span className="text-xs text-muted-foreground">
                {t("files.uploadProgress", {
                  current: uploadProgress.current,
                  total: uploadProgress.total,
                })}
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900">
              {t("files.storageUsage", "Storage usage")}
            </span>
            <span className="text-xs text-muted-foreground">
              {formatBytes(usedBytes)} / {formatBytes(quotaBytes)}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Progress value={usagePercent} className="h-1.5 flex-1" />
            <span className="text-xs font-medium text-muted-foreground">
              {usagePercent}%
            </span>
          </div>
          {quotaBytes === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t(
                "files.noStorage",
                "Upgrade to unlock cloud storage for saved files.",
              )}
            </p>
          ) : null}
          {showUpgradeCta ? (
            <div className="flex flex-col gap-2 rounded-md border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-amber-900 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs font-medium">
                {t(
                  "files.upgradeWarning",
                  "You're close to your storage limit. Upgrade to unlock more space.",
                )}
              </div>
              <Button
                asChild
                size="sm"
                className="bg-amber-600 text-white hover:bg-amber-700"
              >
                <Link href="/?page=profile">
                  {t("files.viewPlans", "View plans")}
                  <RemixIcon
                    name="arrow_right_up"
                    size="size-4"
                    className="ml-1"
                  />
                </Link>
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {unauthorized ? (
        <Card className="border-amber-200 bg-amber-50 text-amber-900">
          <CardContent className="flex flex-col gap-3 py-4 text-sm">
            <div>
              {t(
                "files.loadFailed",
                "We couldn't load your saved files right now.",
              )}
            </div>
            <div>
              <Button
                asChild
                size="sm"
                className="bg-amber-600 text-white hover:bg-amber-700"
              >
                <Link href="/login">{t("files.loginCTA", "Sign in")}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive">
          {error.message}
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">
            {t("files.savedItems", "Saved items")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading && files.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t("files.loading", "Loading your files...")}
            </div>
          ) : null}

          {files.length === 0 && !isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t(
                "files.empty",
                "You haven't saved any files yet. Save attachments from your chats to see them here.",
              )}
            </div>
          ) : null}

          {files.map((file) => (
            <div
              key={file.id}
              className="flex flex-col gap-3 rounded-lg border border-border/50 bg-white/95 p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-1 text-sm">
                <div className="font-medium text-slate-900">{file.name}</div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span>{t("files.storageProviderLabel", "Stored in")}:</span>
                  <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {t(
                      `files.providers.${file.storageProvider}`,
                      file.storageProvider === "google_drive"
                        ? "Google Drive"
                        : file.storageProvider === "notion"
                          ? "Notion"
                          : "openloomi Cloud",
                    )}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatBytes(file.sizeBytes)} - {file.contentType}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("files.savedAt", {
                    date: format(new Date(file.savedAt), "PPP p"),
                  })}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDownload(file.id)}
                >
                  <RemixIcon name="download" size="size-4" className="mr-1.5" />
                  {t("files.download", "Download")}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDelete(file)}
                >
                  <RemixIcon
                    name="delete_bin"
                    size="size-4"
                    className="mr-1.5"
                  />
                  {t("files.delete", "Delete")}
                </Button>
              </div>
            </div>
          ))}

          {data?.pagination?.hasMore ? (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                if (!data || !data.pagination.nextCursor) return;
                const url = new URL("/api/files/list", window.location.origin);
                url.searchParams.set("cursor", data.pagination.nextCursor);
                mutate(
                  async (current) => {
                    const next = await fetcher(url.toString());
                    if (!current) {
                      return next;
                    }
                    return {
                      ...next,
                      files: [...current.files, ...next.files],
                      usage: next.usage ?? current.usage,
                    };
                  },
                  { revalidate: false },
                );
              }}
            >
              {t("files.loadMore", "Load more")}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
