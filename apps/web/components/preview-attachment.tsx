"use client";

import { cn, formatBytes } from "@/lib/utils";
import type { Attachment } from "@openloomi/shared";
import { LoaderIcon } from "./icons";
import { RemixIcon } from "./remix-icon";
import { useTranslation } from "react-i18next";
import { getSecureFileUrl } from "@/lib/files/secure-url";
import { useState } from "react";

/** Returns Remix icon name based on attachment content type */
function getAttachmentIconName(contentType: string | undefined): string {
  if (!contentType) return "file_text";
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType === "application/zip") return "file_archive";
  return "file_text";
}

const SOURCE_LABEL: Record<string, string> = {
  telegram: "Telegram",
  slack: "Slack",
  discord: "Discord",
  gmail: "Gmail",
  whatsapp: "WhatsApp",
};

export const PreviewAttachment = ({
  attachment,
  isUploading = false,
  className,
  showMetadata = true,
  enableImageLightbox = false,
  status,
}: {
  attachment: Attachment;
  isUploading?: boolean;
  className?: string;
  showMetadata?: boolean;
  enableImageLightbox?: boolean;
  status?: "expired";
}) => {
  const { name, contentType, sizeBytes } = attachment;
  const displayUrl = getSecureFileUrl(attachment);
  const isImage = Boolean(contentType?.startsWith("image/"));
  const iconName = getAttachmentIconName(contentType);
  const { t } = useTranslation();
  const [imageLoadError, setImageLoadError] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const fallbackSourceLabel = attachment.source
    ? SOURCE_LABEL[attachment.source]
    : undefined;
  const translatedSourceLabel = attachment.source
    ? t(`chat.attachments.sources.${attachment.source}`, {
        defaultValue: fallbackSourceLabel,
      })
    : undefined;
  const sourceLabel = translatedSourceLabel;
  const viaLabel = sourceLabel
    ? t("chat.attachments.viaSource", {
        source: sourceLabel,
        defaultValue: `via ${sourceLabel}`,
      })
    : null;
  const overlayLabel =
    status === "expired"
      ? t("chat.attachments.expiredOverlay", "Expired")
      : null;
  const imagePreview =
    isImage && displayUrl && !imageLoadError ? (
      // NOTE: it is recommended to use next/image for images
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={displayUrl}
        src={displayUrl}
        alt={name ?? "Attachment"}
        className="size-full object-cover"
        onError={() => {
          setImageLoadError(true);
        }}
      />
    ) : null;

  return (
    <div
      data-testid="input-attachment-preview"
      className={cn(
        "flex flex-col rounded-lg border border-border/50 bg-muted/40 overflow-hidden",
        // Fixed dimensions to ensure consistency
        "w-24",
        // Ignore external max-w/max-h class names to avoid inconsistent sizing
        "!max-w-xs !max-h-64 !max-w-[20rem] !max-h-[16rem]",
        className,
      )}
    >
      <div className="relative flex h-16 w-full items-center justify-center overflow-hidden bg-white">
        {imagePreview && enableImageLightbox ? (
          <button
            type="button"
            className="block size-full cursor-zoom-in"
            title={t("common.open", "Open")}
            onClick={() => setIsPreviewOpen(true)}
          >
            {imagePreview}
          </button>
        ) : imagePreview ? (
          imagePreview
        ) : (
          <RemixIcon name={iconName} size="size-6" className="text-slate-500" />
        )}

        {overlayLabel && !isUploading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
            <span className="text-xs font-semibold uppercase tracking-wide">
              {overlayLabel}
            </span>
          </div>
        ) : null}

        {isUploading && (
          <div
            data-testid="input-attachment-loader"
            className="absolute inset-0 flex items-center justify-center bg-black/20 text-white"
          >
            <div className="animate-spin">
              <LoaderIcon />
            </div>
          </div>
        )}
      </div>
      {showMetadata && (
        <div className="px-2 pb-2 flex flex-col gap-0.5 text-xs">
          {viaLabel ? (
            <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
              {viaLabel}
            </div>
          ) : null}
          <div className="truncate font-medium text-slate-800 text-[11px] leading-tight">
            {name}
          </div>
          <div className="text-slate-500 text-[10px] leading-tight truncate">
            {sizeBytes ? formatBytes(sizeBytes) : null}
            {sizeBytes && contentType ? " • " : null}
            {contentType}
          </div>
        </div>
      )}
      {imagePreview && enableImageLightbox && isPreviewOpen ? (
        <dialog
          open
          className="fixed inset-0 z-[1000] m-0 flex size-full max-h-none max-w-none items-center justify-center border-0 bg-transparent p-4"
          aria-modal="true"
          aria-label={name ?? t("common.imagePreview", "Image preview")}
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/80"
            aria-label={t("common.close", "Close")}
            onClick={() => setIsPreviewOpen(false)}
          />
          <button
            type="button"
            className="absolute right-4 top-4 z-20 flex size-9 items-center justify-center rounded-full bg-white/95 text-slate-900 shadow-md hover:bg-white"
            aria-label={t("common.close", "Close")}
            onClick={() => setIsPreviewOpen(false)}
          >
            <RemixIcon name="close" size="size-5" />
          </button>
          <img
            src={displayUrl}
            alt={name ?? "Attachment"}
            className="relative z-10 max-h-full max-w-full rounded-[8px] object-contain shadow-2xl"
          />
        </dialog>
      ) : null}
    </div>
  );
};
