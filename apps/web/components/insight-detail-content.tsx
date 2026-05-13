"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { DetailData } from "@/lib/ai/subagents/insights";
import { Button } from "@openloomi/ui";
import { ungzip } from "pako";
import ReactMarkdown, {
  type Components as MarkdownComponents,
} from "react-markdown";
import { useRemarkGfm } from "@/hooks/use-remark-gfm";
import remarkBreaks from "remark-breaks";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { openUrl } from "@/lib/tauri";
import { PreviewAttachment } from "@/components/preview-attachment";
import { deriveBlobPathFromUrl } from "@/lib/files/blob-path";
import { useFileStorageUsage } from "@/hooks/use-file-storage";
import { FILE_OPERATION_CREDIT_COST } from "@/lib/files/config";
import { isTauriMode } from "@/lib/env/client-mode";
import { toast } from "sonner";
import { getSecureFileUrl } from "@/lib/files/secure-url";
import { useRouter } from "next/navigation";
import { RemixIcon } from "@/components/remix-icon";
import type { Attachment } from "@openloomi/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@openloomi/ui";
import { cn, formatBytes } from "@/lib/utils";
import { useIntegrations } from "@/hooks/use-integrations";

import { ShadowHtmlRenderer } from "@/components/shadow-html-renderer";
import DOMPurify from "dompurify";
import { parseEmailAction } from "@/app/(chat)/actions";

const HTML_LIKE_REGEX =
  /<(?:!DOCTYPE|html|body|style|table|thead|tbody|tr|td|th|div|span|p|br|img|a|h1|h2|h3|h4|h5|h6|ul|ol|li|blockquote|pre|code|font|center)/i;

// Check if content is Markdown (after stripping potential HTML tags)
const MARKDOWN_LIKE_REGEX =
  /!\[.*?\]\(.*?\)|\[.*?\]\(https?:\/\/.*?\)|^#{1,6}\s+/m;

// Check if content has email headers (raw email format)
const EMAIL_HEADERS_REGEX =
  /^(Subject|From|To|Date|Content-Type|Message-ID):/im;
const BASE64_REGEX =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/;
const BLOCKED_TAGS = [
  // "script", // script is definitely blocked
  // "style", // Allow style tags for rich email rendering
  "link",
  "meta",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
];

function normalizeCid(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed
    .replace(/^<?\s*/u, "")
    .replace(/\s*>?$/u, "")
    .replace(/^cid:/i, "")
    .trim()
    .toLowerCase();
}

type ProcessedContent =
  | {
      type: "html";
      value: string;
      blockedRemoteImages: number;
    }
  | {
      type: "text";
      value: string;
    };

function mergeClassName(base: string, extra?: string | null) {
  return extra ? `${base} ${extra}` : base;
}

function decodeQuotedPrintable(value: string): string {
  const normalized = value.replace(/=\r?\n/g, "");
  // First convert =XX sequences to byte array, then use TextDecoder to correctly decode UTF-8 multi-byte characters
  const parts: (string | number)[] = [];
  let lastIndex = 0;
  const re = /=([0-9A-F]{2})/gi;
  let m: RegExpExecArray | null = re.exec(normalized);
  while (m !== null) {
    if (m.index > lastIndex) {
      parts.push(normalized.slice(lastIndex, m.index));
    }
    parts.push(Number.parseInt(m[1], 16));
    lastIndex = re.lastIndex;
    m = re.exec(normalized);
  }
  if (lastIndex < normalized.length) {
    parts.push(normalized.slice(lastIndex));
  }

  const bytes: number[] = [];
  const textParts: string[] = [];
  const flush = () => {
    if (bytes.length > 0) {
      try {
        textParts.push(
          new TextDecoder("utf-8", { fatal: false }).decode(
            new Uint8Array(bytes),
          ),
        );
      } catch {
        textParts.push(String.fromCharCode(...bytes));
      }
      bytes.length = 0;
    }
  };
  for (const part of parts) {
    if (typeof part === "number") {
      bytes.push(part);
    } else {
      flush();
      textParts.push(part);
    }
  }
  flush();
  return textParts.join("");
}

function base64ToUint8Array(base64: string): Uint8Array | null {
  try {
    if (typeof window !== "undefined" && typeof window.atob === "function") {
      const binaryString = window.atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes;
    }
    return Uint8Array.from(Buffer.from(base64, "base64"));
  } catch {
    return null;
  }
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function decodeWithTextDecoder(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return String.fromCharCode(...bytes);
  }
}

function decodeEmailPayload(raw: string): string {
  let working = raw ?? "";
  if (!working) return "";

  // Attempt to unwrap JSON string output (e.g. "<html>...</html>")
  if (working.startsWith('"') && working.endsWith('"')) {
    try {
      const unescaped = JSON.parse(working);
      if (typeof unescaped === "string") {
        working = unescaped;
      }
    } catch {
      // best effort
    }
  }

  const compact = working.replace(/\s+/g, "");
  if (
    compact.length >= 32 &&
    compact.length % 4 === 0 &&
    BASE64_REGEX.test(compact)
  ) {
    const bytes = base64ToUint8Array(compact);
    if (bytes) {
      try {
        working = isGzip(bytes)
          ? (ungzip(bytes, { to: "string" }) as string)
          : decodeWithTextDecoder(bytes);
      } catch {
        working = decodeWithTextDecoder(bytes);
      }
    }
  }

  if (/=([0-9A-F]{2})/i.test(working)) {
    working = decodeQuotedPrintable(working);
  }

  // Heuristic: Strip MIME headers if they appear at the top
  // Look for Content-Type: text/html followed by double newline
  const mimeHeaderMatch = working.match(
    /Content-Type:\s*text\/html[\s\S]*?\r?\n\r?\n/i,
  );
  if (mimeHeaderMatch && mimeHeaderMatch.index === 0) {
    working = working.slice(mimeHeaderMatch[0].length);
  }

  return working;
}

type SanitizedHtmlResult = {
  html: string;
  blockedRemoteImages: number;
};

function sanitizeHtml(
  html: string,
  attachments?: Attachment[],
  options?: { allowRemoteImages?: boolean },
): SanitizedHtmlResult {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return { html, blockedRemoteImages: 0 };
  }

  const allowRemoteImages = options?.allowRemoteImages ?? false;

  const purified = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: BLOCKED_TAGS,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|cid):|data:image\/|#|\/)/i,
    KEEP_CONTENT: false,
  });

  const parser = new DOMParser();
  const doc = parser.parseFromString(purified, "text/html");
  const cidMap = new Map<string, string>();
  let blockedRemoteImages = 0;
  attachments?.forEach((attachment) => {
    const cid = normalizeCid(attachment.cid);
    const resolvedUrl = attachment.downloadUrl ?? attachment.url;
    if (cid && resolvedUrl) {
      cidMap.set(cid, resolvedUrl);
    }
  });

  const isSafeHref = (href: string | null): string | null => {
    if (!href) return null;
    const trimmed = href.trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("javascript:")) return null;
    if (lower.startsWith("data:") && !lower.startsWith("data:image/")) {
      return null;
    }
    if (
      lower.startsWith("http://") ||
      lower.startsWith("https://") ||
      lower.startsWith("mailto:") ||
      lower.startsWith("tel:") ||
      lower.startsWith("#") ||
      lower.startsWith("/") ||
      lower.startsWith("cid:")
    ) {
      return trimmed;
    }
    return null;
  };

  const isSafeImgSrc = (src: string | null): string | null => {
    if (!src) return null;
    const trimmed = src.trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("cid:")) return trimmed;
    if (lower.startsWith("http://") || lower.startsWith("https://")) {
      return trimmed;
    }
    if (lower.startsWith("data:image/")) {
      return trimmed;
    }
    return null;
  };

  BLOCKED_TAGS.forEach((tag) => {
    const elements = doc.querySelectorAll(tag);
    elements.forEach((el) => el.remove());
  });

  doc.body.querySelectorAll("*").forEach((el) => {
    // Remove event handler attributes e.g. onclick
    Array.from(el.attributes).forEach((attr) => {
      if (attr.name.toLowerCase().startsWith("on")) {
        el.removeAttribute(attr.name);
      }
    });

    // Normalize anchor protocols and behavior
    if (el instanceof HTMLAnchorElement) {
      const safeHref = isSafeHref(el.getAttribute("href"));
      if (safeHref) {
        el.setAttribute("href", safeHref);
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      } else {
        el.removeAttribute("href");
      }
    }

    // Normalize image sources
    if (el instanceof HTMLImageElement) {
      const rawSrc = el.getAttribute("src");
      const normalizedCid = rawSrc?.toLowerCase().startsWith("cid:")
        ? normalizeCid(rawSrc.slice(4))
        : null;
      const cidResolvedSrc =
        normalizedCid && cidMap.has(normalizedCid)
          ? cidMap.get(normalizedCid)
          : null;
      const resolvedSrc = cidResolvedSrc ?? rawSrc;
      const isRemote =
        resolvedSrc &&
        typeof resolvedSrc === "string" &&
        resolvedSrc.toLowerCase().startsWith("http");
      const safeSrc = isSafeImgSrc(
        isRemote && !allowRemoteImages ? null : resolvedSrc,
      );
      if (!safeSrc) {
        if (resolvedSrc && isRemote && !allowRemoteImages) {
          blockedRemoteImages += 1;
          el.setAttribute("data-email-src", resolvedSrc);
          el.setAttribute("src", "");
          if (!el.getAttribute("alt")) {
            el.setAttribute("alt", "External image blocked");
          }
        } else {
          el.remove();
          return;
        }
      }
      if (safeSrc) {
        el.setAttribute("src", safeSrc);
      }
      if (!el.getAttribute("loading")) {
        el.setAttribute("loading", "lazy");
      }
      if (!el.style.maxWidth) {
        el.style.maxWidth = "100%";
      }
      if (!el.style.height) {
        el.style.height = "auto";
      }
    }

    // Allow inline styles but drop dangerous rules
    const styleAttr = el.getAttribute("style");
    if (styleAttr) {
      const safeStyles = styleAttr
        .split(";")
        .map((rule) => rule.trim())
        .filter((rule) => {
          if (!rule) return false;
          const lower = rule.toLowerCase();
          return (
            !lower.includes("expression") &&
            !lower.includes("javascript:") &&
            !lower.includes("url(") &&
            !lower.includes("position:") &&
            !lower.includes("z-index") &&
            !lower.includes("animation") &&
            !lower.includes("transition") &&
            !lower.includes("filter:") &&
            !lower.includes("transform")
          );
        })
        .join("; ");

      if (safeStyles) {
        el.setAttribute("style", safeStyles);
      } else {
        el.removeAttribute("style");
      }
    }
  });

  // Return both head (styles) and body content
  return {
    html: doc.head.innerHTML + doc.body.innerHTML,
    blockedRemoteImages,
  };
}

function normalizeTextContent(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Strip HTML tags from content (for HTML-wrapped Markdown)
 */
function stripHtmlTags(value: string): string {
  return value
    .replace(/<p>/gi, "")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n---\n")
    .replace(
      /<\/?(?:strong|b|em|i|u|s|strike|code|pre|a|div|span|h[1-6]|ul|ol|li|blockquote|table|thead|tbody|tr|td|th|img)[^>]*>/gi,
      "",
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .trim();
}

function linkifyBracketUrls(value: string): string {
  return value.replace(/\[https?:\/\/[^\]\s)>"']+\]/gi, (match) => {
    const url = match.slice(1, -1);
    return `[${url}](${url})`;
  });
}

const REMOTE_IMAGE_PREF_KEY = "openloomi.email.allowRemoteImages";

// rendering-hoist-jsx: Hoist static markdown component definitions to outside the component
// Avoid creating new component objects on every render, reduce memory allocation and GC pressure
const MemoizedAnchor = React.memo(
  ({ className, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      {...props}
      className={
        className
          ? `font-medium text-blue-600 underline-offset-4 transition hover:text-blue-500 hover:underline ${className}`
          : "font-medium text-blue-600 underline-offset-4 transition hover:text-blue-500 hover:underline"
      }
      target="_blank"
      rel="noopener noreferrer"
    />
  ),
);
MemoizedAnchor.displayName = "MemoizedAnchor";

const MemoizedParagraph = React.memo(
  ({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p
      {...props}
      className={
        className
          ? `text-[10px] leading-relaxed text-gray-700 sm:text-sm dark:text-gray-200 ${className}`
          : "text-[10px] leading-relaxed text-gray-700 sm:text-sm dark:text-gray-200"
      }
    />
  ),
);
MemoizedParagraph.displayName = "MemoizedParagraph";

const MemoizedUnorderedList = React.memo(
  ({ className, ...props }: React.HTMLAttributes<HTMLUListElement>) => (
    <ul
      {...props}
      className={
        className
          ? `ml-4 list-disc space-y-1 text-[10px] sm:text-sm text-gray-700 dark:text-gray-200 ${className}`
          : "ml-4 list-disc space-y-1 text-[10px] sm:text-sm text-gray-700 dark:text-gray-200"
      }
    />
  ),
);
MemoizedUnorderedList.displayName = "MemoizedUnorderedList";

const MemoizedOrderedList = React.memo(
  ({ className, ...props }: React.HTMLAttributes<HTMLOListElement>) => (
    <ol
      {...props}
      className={
        className
          ? `ml-4 list-decimal space-y-1 text-[10px] sm:text-sm text-gray-700 dark:text-gray-200 ${className}`
          : "ml-4 list-decimal space-y-1 text-[10px] sm:text-sm text-gray-700 dark:text-gray-200"
      }
    />
  ),
);
MemoizedOrderedList.displayName = "MemoizedOrderedList";

const MemoizedListItem = React.memo(
  ({ className, ...props }: React.HTMLAttributes<HTMLLIElement>) => (
    <li
      {...props}
      className={className ? `leading-relaxed ${className}` : "leading-relaxed"}
    />
  ),
);
MemoizedListItem.displayName = "MemoizedListItem";

const MemoizedStrong = React.memo(
  ({ className, ...props }: React.HTMLAttributes<HTMLElement>) => (
    <strong
      {...props}
      className={
        className
          ? `font-semibold text-gray-900 dark:text-gray-100 ${className}`
          : "font-semibold text-gray-900 dark:text-gray-100"
      }
    />
  ),
);
MemoizedStrong.displayName = "MemoizedStrong";

const MemoizedEmphasis = React.memo(
  ({ className, ...props }: React.HTMLAttributes<HTMLElement>) => (
    <em
      {...props}
      className={
        className
          ? `text-gray-700 italic dark:text-gray-200 ${className}`
          : "text-gray-700 italic dark:text-gray-200"
      }
    />
  ),
);
MemoizedEmphasis.displayName = "MemoizedEmphasis";

const MemoizedCode = React.memo(
  ({ className, ...props }: React.HTMLAttributes<HTMLElement>) => (
    <code
      {...props}
      className={
        className
          ? `rounded bg-slate-100 px-1 py-0.5 text-[10px] sm:text-xs text-slate-800 dark:bg-slate-800/80 dark:text-slate-100 ${className}`
          : "rounded bg-slate-100 px-1 py-0.5 text-[10px] sm:text-xs text-slate-800 dark:bg-slate-800/80 dark:text-slate-100"
      }
    />
  ),
);
MemoizedCode.displayName = "MemoizedCode";

const MemoizedPre = React.memo(
  ({ className, ...props }: React.HTMLAttributes<HTMLPreElement>) => (
    <pre
      {...props}
      className={
        className
          ? `whitespace-pre-wrap rounded-md bg-slate-100 p-2 text-[10px] leading-relaxed text-gray-800 sm:text-xs dark:bg-slate-800/60 dark:text-gray-100 ${className}`
          : "whitespace-pre-wrap rounded-md bg-slate-100 p-2 text-[10px] leading-relaxed text-gray-800 sm:text-xs dark:bg-slate-800/60 dark:text-gray-100"
      }
    />
  ),
);
MemoizedPre.displayName = "MemoizedPre";

const MemoizedBlockquote = React.memo(
  ({ className, ...props }: React.HTMLAttributes<HTMLElement>) => (
    <blockquote
      {...props}
      className={
        className
          ? `border-l-2 border-blue-200 pl-3 text-[10px] italic text-gray-700 sm:text-sm dark:border-blue-400/60 dark:text-gray-200 ${className}`
          : "border-l-2 border-blue-200 pl-3 text-[10px] italic text-gray-700 sm:text-sm dark:border-blue-400/60 dark:text-gray-200"
      }
    />
  ),
);
MemoizedBlockquote.displayName = "MemoizedBlockquote";

const MemoizedHr = React.memo(() => (
  <hr className="my-3 border-dashed border-slate-200 dark:border-slate-700" />
));
MemoizedHr.displayName = "MemoizedHr";

// Render-hoisted component set
const markdownComponents: Partial<MarkdownComponents> = {
  a: MemoizedAnchor,
  p: MemoizedParagraph,
  ul: MemoizedUnorderedList,
  ol: MemoizedOrderedList,
  li: MemoizedListItem,
  strong: MemoizedStrong,
  em: MemoizedEmphasis,
  code: MemoizedCode,
  pre: MemoizedPre,
  blockquote: MemoizedBlockquote,
  hr: MemoizedHr,
};

// rerender-memo: Extract expensive HTML/Markdown processing to a separate memo component
// This component only re-renders when its input props change, avoiding unnecessary computation caused by parent re-renders
interface ProcessedContentProps {
  content: string;
  platform?: string;
  attachments?: Attachment[];
  allowRemoteImages: boolean;
  deepParsedHtml: string | null;
  t: TFunction;
  onDownload: (attachment: Attachment) => void;
  onSave: (attachment: Attachment, target?: any) => void;
  savingUrl: string | null;
  canSaveFiles: boolean;
  hasExternalStorage: boolean;
  hasGoogleDriveIntegration: boolean;
  hasNotionIntegration: boolean;
  compactAttachments?: boolean;
}

const ProcessedInsightContent = React.memo(function ProcessedInsightContent({
  content,
  platform,
  attachments = [],
  allowRemoteImages,
  deepParsedHtml,
  t,
  onDownload,
  onSave,
  savingUrl,
  canSaveFiles,
  hasExternalStorage,
  hasGoogleDriveIntegration,
  hasNotionIntegration,
  compactAttachments = false,
}: ProcessedContentProps) {
  const displayContent = content ?? "";

  // Extracted processing logic - only recalculate when props change
  const processed = useMemo<ProcessedContent>(() => {
    const rawContent = displayContent;
    if (!rawContent) {
      return {
        type: "text" as const,
        value: "",
      };
    }

    // If we have a deep parsed result, use it
    if (deepParsedHtml) {
      const sanitized = sanitizeHtml(deepParsedHtml, attachments, {
        allowRemoteImages,
      });
      return {
        type: "html" as const,
        value: sanitized.html,
        blockedRemoteImages: sanitized.blockedRemoteImages,
      };
    }

    const shouldDecode = platform?.toLowerCase() === "gmail";
    const decoded = shouldDecode ? decodeEmailPayload(rawContent) : rawContent;
    const trimmed = decoded.trim();

    if (!trimmed) {
      return {
        type: "text" as const,
        value: "",
      };
    }

    const hasHtml = HTML_LIKE_REGEX.test(trimmed);
    const hasMarkdown = MARKDOWN_LIKE_REGEX.test(trimmed);

    // If content has HTML tags but also contains Markdown syntax,
    // it's likely HTML-wrapped Markdown - render as Markdown
    if (hasHtml && hasMarkdown) {
      const stripped = stripHtmlTags(trimmed);
      const normalized = normalizeTextContent(stripped);
      const linkified = linkifyBracketUrls(normalized);
      return {
        type: "text" as const,
        value: linkified,
      };
    }

    if (hasHtml) {
      const sanitized = sanitizeHtml(trimmed, attachments, {
        allowRemoteImages,
      });
      return {
        type: "html" as const,
        value: sanitized.html,
        blockedRemoteImages: sanitized.blockedRemoteImages,
      };
    }

    const normalized = normalizeTextContent(trimmed);
    const linkified = linkifyBracketUrls(normalized);

    return {
      type: "text" as const,
      value: linkified,
    };
  }, [
    displayContent,
    platform,
    deepParsedHtml,
    allowRemoteImages,
    attachments,
  ]);

  const showRemoteImageNotice =
    processed.type === "html" &&
    processed.blockedRemoteImages > 0 &&
    !allowRemoteImages;

  // ... Rendering logic will be here ...
  return null; // Temporarily return null, full implementation coming later
});

/** Display name mapping for attachment sources, consistent with preview-attachment */
const ATTACHMENT_SOURCE_LABEL: Record<string, string> = {
  telegram: "Telegram",
  slack: "Slack",
  discord: "Discord",
  gmail: "Gmail",
  whatsapp: "WhatsApp",
};

/**
 * Attachment details dialog: displays attachment name, type, size, source; images can preview full size; supports download, non-subscribers see "Upgrade to Save".
 */
function AttachmentDetailDialog({
  attachment,
  onOpenChange,
  onDownload,
  canSaveFiles = true,
  onUpgradeClick,
  t,
}: {
  attachment: Attachment | null;
  onOpenChange: (open: boolean) => void;
  onDownload: (a: Attachment) => void;
  /** Whether user can save files (has storage quota) */
  canSaveFiles?: boolean;
  /** Callback when non-subscriber clicks "Upgrade to Save" */
  onUpgradeClick?: () => void;
  t: TFunction;
}) {
  const displayUrl = attachment ? getSecureFileUrl(attachment) : "";
  const isImage = Boolean(attachment?.contentType?.startsWith("image/"));
  const sourceLabel = attachment?.source
    ? t(`chat.attachments.sources.${attachment.source}`, {
        defaultValue: ATTACHMENT_SOURCE_LABEL[attachment.source],
      })
    : null;

  const renderSource = () =>
    sourceLabel ? (
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("chat.attachments.viaSource", {
          source: sourceLabel,
          defaultValue: `From ${sourceLabel}`,
        })}
      </p>
    ) : null;

  const renderActionButtons = () => (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        className="h-8 w-8 p-0"
        onClick={() => attachment && onDownload(attachment)}
        aria-label={t("insight.attachments.download", "Download")}
      >
        <RemixIcon name="download" size="size-4" />
      </Button>
    </div>
  );

  return (
    <Dialog open={!!attachment} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">
            {attachment?.name ??
              t("insight.attachments.viewDetailTitle", "Attachment details")}
          </DialogTitle>
        </DialogHeader>
        {attachment ? (
          <div className="flex flex-col gap-4 overflow-y-auto min-h-0">
            {renderSource()}
            {isImage && displayUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={displayUrl}
                  alt={attachment.name ?? ""}
                  className="max-w-full max-h-[60vh] w-auto h-auto object-contain rounded-lg border border-border bg-muted/30"
                />
                <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
                  <span>{attachment.name}</span>
                  <span>
                    {attachment.sizeBytes
                      ? formatBytes(attachment.sizeBytes)
                      : ""}
                    {attachment.sizeBytes && attachment.contentType
                      ? " • "
                      : ""}
                    {attachment.contentType ?? ""}
                  </span>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center gap-4 py-6">
                <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-muted/50 border border-border">
                  <RemixIcon
                    name="file_text"
                    size="size-12"
                    className="text-muted-foreground"
                  />
                </div>
                <div className="text-center space-y-1">
                  <p className="font-medium text-foreground truncate max-w-md">
                    {attachment.name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {attachment.sizeBytes
                      ? formatBytes(attachment.sizeBytes)
                      : null}
                    {attachment.sizeBytes && attachment.contentType
                      ? " • "
                      : null}
                    {attachment.contentType ?? ""}
                  </p>
                </div>
                {renderActionButtons()}
              </div>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export default function InsightDetailContent({
  detail,
  contentBgClass,
  noBorder,
  showOriginal = false,
  showAttachmentDetailOnClick = false,
  compactAttachments = false,
  className,
}: {
  detail: DetailData;
  contentBgClass?: string;
  noBorder?: boolean;
  showOriginal?: boolean;
  /** When true, clicking attachment preview can open attachment detail dialog (used for info source cards, etc.) */
  showAttachmentDetailOnClick?: boolean;
  /** When true, only shows attachment preview, no source/name/size/format or save/download buttons (for info source cards) */
  compactAttachments?: boolean;
  className?: string;
}) {
  const remarkPlugins = useRemarkGfm([remarkBreaks]);
  const router = useRouter();
  const { usage: storageUsage, refresh: refreshStorageUsage } =
    useFileStorageUsage(true);
  const canSaveFiles = (storageUsage?.quotaBytes ?? 0) > 0;
  const [savingAttachmentUrl, setSavingAttachmentUrl] = useState<string | null>(
    null,
  );
  /** Attachment to view details for, used for attachment detail dialog inside info source cards */
  const [attachmentDetailOpen, setAttachmentDetailOpen] =
    useState<Attachment | null>(null);
  const [allowRemoteImages, setAllowRemoteImages] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [deepParsedHtml, setDeepParsedHtml] = useState<string | null>(null);
  const { t } = useTranslation();
  const { groupedByIntegration } = useIntegrations();

  // Determine which content to show: original or translated
  // For email platforms, prioritize when originalContent contains HTML (including tables and rich formatting)
  // to avoid losing table structure during Markdown conversion
  const isEmailPlatform = ["gmail", "outlook", "email"].includes(
    detail.platform?.toLowerCase() ?? "",
  );
  const originalHasHtml =
    detail.originalContent && HTML_LIKE_REGEX.test(detail.originalContent);
  const displayContent =
    showOriginal && detail.originalContent
      ? detail.originalContent
      : isEmailPlatform && originalHasHtml
        ? detail.originalContent
        : detail.content;

  // Auto-detect and parse raw MIME content
  useEffect(() => {
    const rawContent = displayContent ?? "";
    if (!rawContent || deepParsedHtml || isParsing) return;

    // Heuristic: If it looks like a raw MIME message (has headers), auto-parse it
    const hasMimeHeaders =
      /Content-Type:\s*multipart\/|MIME-Version:|Content-Transfer-Encoding:/i.test(
        rawContent,
      );

    // Check for email headers which indicate raw email format
    const hasEmailHeaders = EMAIL_HEADERS_REGEX.test(rawContent);

    // Also if it's Gmail but frontend failed to detect HTML (rendered as text),
    // it might be a complex MIME structure that our regex missed.
    const isGmail = detail.platform?.toLowerCase() === "gmail";
    const frontendDetectedHtml = HTML_LIKE_REGEX.test(rawContent);
    const suspiciousPlainText =
      isGmail && !frontendDetectedHtml && rawContent.length > 100;

    // For Gmail with email headers, always try server-side parsing
    const shouldParse =
      hasMimeHeaders || hasEmailHeaders || suspiciousPlainText;

    if (shouldParse) {
      console.log("[Auto-detect] Starting parseRawEmail...");
      setIsParsing(true);
      parseEmailAction(rawContent)
        .then((result) => {
          if (result.html) {
            setDeepParsedHtml(result.html);
          }
        })
        .finally(() => {
          setIsParsing(false);
        });
    }
  }, [displayContent, detail.platform, deepParsedHtml, isParsing]);

  const hasGoogleDriveIntegration =
    (groupedByIntegration.google_drive?.length ?? 0) > 0;
  const hasNotionIntegration = (groupedByIntegration.notion?.length ?? 0) > 0;
  const hasExternalStorage = hasGoogleDriveIntegration || hasNotionIntegration;

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(REMOTE_IMAGE_PREF_KEY);
      setAllowRemoteImages(stored === "true");
    } catch {
      setAllowRemoteImages(false);
    }
  }, [displayContent, detail.attachments, detail.time]);

  const attachments = useMemo(() => {
    if (!Array.isArray(detail.attachments)) {
      return [] as Attachment[];
    }
    return detail.attachments;
  }, [detail.attachments]);

  const processed = useMemo<ProcessedContent>(() => {
    const rawContent = displayContent ?? "";
    if (!rawContent) {
      return {
        type: "text" as const,
        value: "",
      };
    }

    // If we have a deep parsed result, use it
    if (deepParsedHtml) {
      const sanitized = sanitizeHtml(deepParsedHtml, attachments, {
        allowRemoteImages,
      });
      return {
        type: "html" as const,
        value: sanitized.html,
        blockedRemoteImages: sanitized.blockedRemoteImages,
      };
    }

    const shouldDecode = detail.platform?.toLowerCase() === "gmail";
    const decoded = shouldDecode ? decodeEmailPayload(rawContent) : rawContent;
    const trimmed = decoded.trim();

    if (!trimmed) {
      return {
        type: "text" as const,
        value: "",
      };
    }

    const hasHtml = HTML_LIKE_REGEX.test(trimmed);
    const hasMarkdown = MARKDOWN_LIKE_REGEX.test(trimmed);

    // If content has HTML tags but also contains Markdown syntax,
    // it's likely HTML-wrapped Markdown - render as Markdown
    if (hasHtml && hasMarkdown) {
      const stripped = stripHtmlTags(trimmed);
      const normalized = normalizeTextContent(stripped);
      const linkified = linkifyBracketUrls(normalized);
      return {
        type: "text" as const,
        value: linkified,
      };
    }

    if (hasHtml) {
      const sanitized = sanitizeHtml(trimmed, attachments, {
        allowRemoteImages,
      });
      return {
        type: "html" as const,
        value: sanitized.html,
        blockedRemoteImages: sanitized.blockedRemoteImages,
      };
    }

    const normalized = normalizeTextContent(trimmed);
    const linkified = linkifyBracketUrls(normalized);

    return {
      type: "text" as const,
      value: linkified,
    };
  }, [
    allowRemoteImages,
    attachments,
    displayContent,
    detail.platform,
    deepParsedHtml,
  ]);

  // Removed useEffect for manual DOM manipulation as ShadowHtmlRenderer handles it

  const handleDownloadAttachment = useCallback(
    async (attachment: Attachment) => {
      if (attachment.expired) {
        toast.info(
          t(
            "insight.attachments.expiredNotice",
            "This attachment has expired and is no longer available.",
          ),
        );
        return;
      }

      const resolvedBlobPath =
        attachment.blobPath ??
        deriveBlobPathFromUrl(attachment.downloadUrl ?? attachment.url ?? null);
      const fallbackUrl = attachment.downloadUrl ?? attachment.url;

      if (!resolvedBlobPath) {
        if (fallbackUrl) {
          openUrl(fallbackUrl);
          return;
        }
        toast.error(
          t(
            "insight.attachments.missingBlob",
            "We couldn't locate this file in the storage.",
          ),
        );
        return;
      }

      try {
        const response = await fetch("/api/files/insights/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blobPath: resolvedBlobPath }),
        });
        const payload = await response.json();
        if (!response.ok || !payload?.downloadUrl) {
          throw new Error(
            typeof payload?.error === "string"
              ? payload.error
              : "Download request failed.",
          );
        }
        if (isTauriMode()) {
          const fileResponse = await fetch(payload.downloadUrl);
          if (!fileResponse.ok) throw new Error("Failed to fetch file");
          const blob = await fileResponse.blob();
          const blobUrl = URL.createObjectURL(blob);
          const filename =
            attachment.name ?? resolvedBlobPath?.split("/").pop() ?? "download";
          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(blobUrl);
        } else {
          openUrl(payload.downloadUrl);
        }
      } catch (error) {
        if (fallbackUrl) {
          if (isTauriMode()) {
            try {
              const fileResponse = await fetch(fallbackUrl);
              if (!fileResponse.ok) throw new Error("Failed to fetch file");
              const blob = await fileResponse.blob();
              const blobUrl = URL.createObjectURL(blob);
              const filename =
                attachment.name ??
                resolvedBlobPath?.split("/").pop() ??
                "download";
              const a = document.createElement("a");
              a.href = blobUrl;
              a.download = filename;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(blobUrl);
            } catch {
              toast.error(
                t(
                  "insight.attachments.downloadFailed",
                  "Unable to download this file.",
                ),
              );
            }
          } else {
            openUrl(fallbackUrl);
          }
          return;
        }
        toast.error(
          t(
            "insight.attachments.downloadFailed",
            "Unable to download this file.",
          ),
        );
      }
    },
    [t],
  );

  const attachmentsSection =
    attachments.length > 0 ? (
      <div className="flex flex-col gap-4">
        {attachments.map((attachment, index) => {
          const resolvedBlobPath =
            attachment.blobPath ??
            deriveBlobPathFromUrl(
              attachment.downloadUrl ?? attachment.url ?? null,
            );
          const isExpired = attachment.expired === true;
          const expiredAt =
            typeof attachment.expiredAt === "string"
              ? attachment.expiredAt
              : null;
          const attachmentKey =
            resolvedBlobPath ??
            attachment.url ??
            attachment.downloadUrl ??
            `${index}-${attachment.name ?? "attachment"}`;

          const previewAttachment: Attachment = {
            ...attachment,
            blobPath: resolvedBlobPath ?? attachment.blobPath,
          };

          return (
            <div
              key={attachmentKey}
              className={
                compactAttachments
                  ? "rounded-lg overflow-hidden"
                  : "flex flex-col gap-3 rounded-xl border border-border/40 bg-surface/80 p-3"
              }
            >
              {showAttachmentDetailOnClick && !isExpired ? (
                <button
                  type="button"
                  onClick={() => setAttachmentDetailOpen(attachment)}
                  className="w-full cursor-pointer text-left rounded-lg overflow-hidden border-0 p-0 bg-transparent hover:opacity-90 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  aria-label={t(
                    "insight.attachments.viewDetail",
                    "View attachment details",
                  )}
                >
                  <PreviewAttachment
                    attachment={previewAttachment}
                    className={cn(
                      "w-full",
                      compactAttachments &&
                        "border-0 bg-transparent p-0 gap-0 rounded-md",
                    )}
                    showMetadata={!compactAttachments}
                    status={isExpired ? "expired" : undefined}
                  />
                </button>
              ) : (
                <PreviewAttachment
                  attachment={previewAttachment}
                  className={cn(
                    "w-full",
                    compactAttachments &&
                      "border-0 bg-transparent p-0 gap-0 rounded-md",
                  )}
                  showMetadata={!compactAttachments}
                  status={isExpired ? "expired" : undefined}
                />
              )}
              {!compactAttachments && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    {isExpired ? (
                      <p className="text-sm text-muted-foreground">
                        {t(
                          "insight.attachments.expiredNotice",
                          "This attachment has expired and is no longer available.",
                        )}
                      </p>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-8 w-8 p-0"
                          onClick={() => handleDownloadAttachment(attachment)}
                          aria-label={t(
                            "insight.attachments.download",
                            "Download",
                          )}
                        >
                          <RemixIcon name="download" size="size-4" />
                        </Button>
                      </>
                    )}
                  </div>
                  {!isExpired ? (
                    canSaveFiles ? (
                      <div className="text-xs text-muted-foreground">
                        {t("insight.attachments.saveCost", {
                          credits: FILE_OPERATION_CREDIT_COST,
                        })}
                      </div>
                    ) : null
                  ) : expiredAt ? (
                    <div className="text-xs text-muted-foreground">
                      {t("insight.attachments.expiredTimestamp", {
                        timestamp: new Date(expiredAt).toLocaleString(),
                      })}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    ) : null;

  const showRemoteImageNotice =
    processed.type === "html" &&
    processed.blockedRemoteImages > 0 &&
    !allowRemoteImages;

  if (processed.type === "html") {
    return (
      <>
        <div className="insight-detail-content space-y-2">
          {showRemoteImageNotice ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-100">
              <span>
                {t(
                  "insightDetail.remoteImagesBlockedNotice",
                  "External images were blocked for privacy. Load them to view full content.",
                )}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setAllowRemoteImages(true);
                  try {
                    window.localStorage.setItem(REMOTE_IMAGE_PREF_KEY, "true");
                  } catch {
                    // best effort
                  }
                }}
              >
                {t("insightDetail.remoteImagesLoadAction", "Load images")}
              </Button>
            </div>
          ) : null}
          <div className="relative group">
            <div
              className={`min-h-[600px] overflow-auto ${noBorder ? "rounded-lg" : "rounded-xl border border-blue-100 shadow-sm ring-1 ring-blue-100/60 backdrop-blur-sm dark:border-blue-400/40 dark:ring-blue-400/20"} ${noBorder ? "p-0" : "p-3"} transition-colors duration-300 sm:max-h-[600px] ${contentBgClass ?? "bg-white/90 dark:bg-slate-900/60"}`}
            >
              <ShadowHtmlRenderer
                html={processed.value}
                className="min-h-[600px] sm:max-h-[600px] text-gray-800 dark:text-gray-100"
              />
            </div>
            {!deepParsedHtml &&
              /Content-Type:\s*multipart\/|MIME-Version:|Content-Transfer-Encoding:/i.test(
                detail.content ?? "",
              ) && (
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 text-xs shadow-sm"
                    onClick={async () => {
                      setIsParsing(true);
                      try {
                        const result = await parseEmailAction(
                          detail.content ?? "",
                        );
                        if (result.html) {
                          setDeepParsedHtml(result.html);
                          toast.success(
                            t(
                              "insightDetail.deepParseSuccess",
                              "Formatting fixed",
                            ),
                          );
                        } else if (result.error) {
                          toast.error(
                            t(
                              "insightDetail.deepParseFailed",
                              `${result.error}`,
                            ),
                          );
                        } else {
                          toast.error(
                            t(
                              "insightDetail.deepParseFailed",
                              "Could not improve formatting - no readable content found",
                            ),
                          );
                        }
                      } catch (err) {
                        toast.error(
                          t(
                            "insightDetail.deepParseError",
                            `Parsing failed: ${err instanceof Error ? err.message : "Unknown error"}`,
                          ),
                        );
                      } finally {
                        setIsParsing(false);
                      }
                    }}
                    disabled={isParsing}
                  >
                    {isParsing ? (
                      <RemixIcon
                        name="loader_2"
                        size="size-3"
                        className="mr-1.5 animate-spin"
                      />
                    ) : (
                      <RemixIcon
                        name="wand_sparkles"
                        size="size-3"
                        className="mr-1.5"
                      />
                    )}
                    {t("insightDetail.fixFormatting", "Fix Formatting")}
                  </Button>
                </div>
              )}
          </div>
          {attachmentsSection}
        </div>
        <AttachmentDetailDialog
          attachment={attachmentDetailOpen}
          onOpenChange={(open) => !open && setAttachmentDetailOpen(null)}
          onDownload={handleDownloadAttachment}
          canSaveFiles={canSaveFiles}
          onUpgradeClick={() => router.push("/?page=profile")}
          t={t}
        />
      </>
    );
  }

  return (
    <div className={cn("insight-detail-content space-y-2", className)}>
      <div
        className={`${noBorder ? "rounded-lg" : "rounded-xl border border-slate-200 shadow-sm ring-1 ring-slate-100/80 dark:border-slate-700/60 dark:ring-slate-700/40"} ${noBorder ? "p-0" : "p-3"} ${contentBgClass ?? "bg-white/95 dark:bg-slate-900/60"}`}
      >
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          components={markdownComponents}
          className="space-y-2 break-words whitespace-pre-line"
        >
          {processed.value}
        </ReactMarkdown>
      </div>
      {attachmentsSection}
      <AttachmentDetailDialog
        attachment={attachmentDetailOpen}
        onOpenChange={(open) => !open && setAttachmentDetailOpen(null)}
        onDownload={handleDownloadAttachment}
        canSaveFiles={canSaveFiles}
        onUpgradeClick={() => router.push("/?page=profile")}
        t={t}
      />
    </div>
  );
}
