/**
 * File type configuration: unified management of MIME types, extensions, and display labels
 */
export const FILE_TYPE_CONFIG = {
  // Image types
  jpeg: { mime: "image/jpeg", extensions: [".jpg", ".jpeg"], label: "JPEG" },
  png: { mime: "image/png", extensions: [".png"], label: "PNG" },
  webp: { mime: "image/webp", extensions: [".webp"], label: "WebP" },
  gif: { mime: "image/gif", extensions: [".gif"], label: "GIF" },
  // Video types
  mp4: { mime: "video/mp4", extensions: [".mp4"], label: "MP4" },
  webm: { mime: "video/webm", extensions: [".webm"], label: "WebM" },
  mov: { mime: "video/quicktime", extensions: [".mov"], label: "QuickTime" },
  avi: { mime: "video/x-msvideo", extensions: [".avi"], label: "AVI" },
  mkv: { mime: "video/x-matroska", extensions: [".mkv"], label: "MKV" },
  // Audio types
  mp3: { mime: "audio/mpeg", extensions: [".mp3"], label: "MP3" },
  wav: { mime: "audio/wav", extensions: [".wav"], label: "WAV" },
  flac: { mime: "audio/flac", extensions: [".flac"], label: "FLAC" },
  aac: { mime: "audio/aac", extensions: [".aac"], label: "AAC" },
  ogg: { mime: "audio/ogg", extensions: [".ogg"], label: "OGG" },
  m4a: { mime: "audio/mp4", extensions: [".m4a"], label: "M4A" },
  // Document types
  pdf: { mime: "application/pdf", extensions: [".pdf"], label: "PDF" },
  doc: {
    mime: "application/msword",
    extensions: [".doc"],
    label: "Word",
  },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extensions: [".docx"],
    label: "Word",
  },
  xls: {
    mime: "application/vnd.ms-excel",
    extensions: [".xls"],
    label: "Excel",
  },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extensions: [".xlsx"],
    label: "Excel",
  },
  ppt: {
    mime: "application/vnd.ms-powerpoint",
    extensions: [".ppt"],
    label: "PowerPoint",
  },
  pptx: {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extensions: [".pptx"],
    label: "PowerPoint",
  },
  txt: { mime: "text/plain", extensions: [".txt"], label: "TXT" },
  md: { mime: "text/markdown", extensions: [".md"], label: "Markdown" },
  csv: { mime: "text/csv", extensions: [".csv"], label: "CSV" },
  tsv: {
    mime: "text/tab-separated-values",
    extensions: [".tsv"],
    label: "TSV",
  },
  json: { mime: "application/json", extensions: [".json"], label: "JSON" },
  html: { mime: "text/html", extensions: [".html", ".htm"], label: "HTML" },
  // Apple office suite formats
  pages: {
    mime: "application/vnd.apple.pages",
    extensions: [".pages"],
    label: "Pages",
  },
  numbers: {
    mime: "application/vnd.apple.numbers",
    extensions: [".numbers"],
    label: "Numbers",
  },
  keynote: {
    mime: "application/vnd.apple.keynote",
    extensions: [".keynote"],
    label: "Keynote",
  },
  // Archive types
  zip: { mime: "application/zip", extensions: [".zip"], label: "ZIP" },
  rar: { mime: "application/vnd.rar", extensions: [".rar"], label: "RAR" },
  "7z": {
    mime: "application/x-7z-compressed",
    extensions: [".7z"],
    label: "7Z",
  },
  tar: { mime: "application/x-tar", extensions: [".tar"], label: "TAR" },
  gz: { mime: "application/gzip", extensions: [".gz"], label: "GZIP" },
  tgz: {
    mime: "application/gzip",
    extensions: [".tgz"],
    label: "TGZ",
  },
  bz2: {
    mime: "application/x-bzip2",
    extensions: [".bz2"],
    label: "BZIP2",
  },
} as const;

export type FileTypeKey = keyof typeof FILE_TYPE_CONFIG;

/**
 * Get MIME type from file extension
 */
export function getMimeTypeFromExtension(
  extension: string,
): string | undefined {
  const ext = extension.toLowerCase().replace(".", "");
  const config = Object.values(FILE_TYPE_CONFIG).find((c) =>
    c.extensions.some((e) => e.replace(".", "") === ext),
  );
  return config?.mime;
}

/**
 * Get file extension from MIME type
 */
export function getExtensionsFromMimeType(
  mimeType: string,
): string[] | undefined {
  const config = Object.values(FILE_TYPE_CONFIG).find(
    (c) => c.mime === mimeType,
  );
  return config?.extensions.slice();
}

/**
 * Get all supported MIME types (for general attachments)
 */
export const SUPPORTED_ATTACHMENT_MIME_TYPES = [
  // Images
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  // Video
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
  // Audio
  "audio/mpeg",
  "audio/wav",
  "audio/flac",
  "audio/aac",
  "audio/ogg",
  "audio/mp4",
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
  "text/tab-separated-values",
  "text/html",
  // Apple office suite formats (new version)
  "application/vnd.apple.pages",
  "application/vnd.apple.numbers",
  "application/vnd.apple.keynote",
  // Apple office suite formats (old macOS)
  "application/x-iwork-pages-sffpages",
  "application/x-iwork-numbers-sffnumbers",
  "application/x-iwork-keynote-sffkeynote",
  // Archives
  "application/zip",
  "application/vnd.rar",
  "application/x-7z-compressed",
  "application/x-tar",
  "application/gzip",
  "application/x-bzip2",
] as const;

export type SupportedAttachmentMediaType =
  (typeof SUPPORTED_ATTACHMENT_MIME_TYPES)[number];

export const SUPPORTED_ATTACHMENT_MIME_TYPES_ARRAY = [
  ...SUPPORTED_ATTACHMENT_MIME_TYPES,
] as [SupportedAttachmentMediaType, ...SupportedAttachmentMediaType[]];

/**
 * RAG-supported document MIME types
 */
export const SUPPORTED_RAG_MIME_TYPES = [
  // Documents
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/plain",
  "text/markdown",
  "text/html",
  "text/csv",
  "application/json",
  // Images (for vision-based RAG)
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  // Apple office suite formats (new version)
  "application/vnd.apple.pages",
  "application/vnd.apple.numbers",
  "application/vnd.apple.keynote",
  // Apple office suite formats (old macOS)
  "application/x-iwork-pages-sffpages",
  "application/x-iwork-numbers-sffnumbers",
  "application/x-iwork-keynote-sffkeynote",
] as const;

export type SupportedRAGMediaType = (typeof SUPPORTED_RAG_MIME_TYPES)[number];

/**
 * Get all supported file extensions (for frontend file picker fallback check)
 */
export const SUPPORTED_FILE_EXTENSIONS = Object.values(FILE_TYPE_CONFIG)
  .flatMap((config) => config.extensions)
  .sort();

/**
 * Get RAG-supported file type labels (for UI display)
 */
export const RAG_FILE_TYPE_LABELS = Object.values(FILE_TYPE_CONFIG)
  .filter((config) => SUPPORTED_RAG_MIME_TYPES.includes(config.mime as any))
  .map((config) => config.label)
  .filter((label, index, self) => self.indexOf(label) === index); // Remove duplicates

export const FILE_STORAGE_PROVIDERS = [
  "vercel_blob",
  "google_drive",
  "notion",
  "local-fs",
] as const;

export type FileStorageProvider = (typeof FILE_STORAGE_PROVIDERS)[number];

export function isFileStorageProvider(
  value: unknown,
): value is FileStorageProvider {
  return (
    typeof value === "string" &&
    FILE_STORAGE_PROVIDERS.includes(
      value as (typeof FILE_STORAGE_PROVIDERS)[number],
    )
  );
}

// Maximum file size for uploads (100MB)
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

export const FILE_OPERATION_CREDIT_COST = 2;

const rawAttachmentTtl = process.env.UNSAVED_ATTACHMENT_TTL_HOURS;
export const DEFAULT_UNSAVED_ATTACHMENT_TTL_HOURS = rawAttachmentTtl
  ? Number(rawAttachmentTtl) || 24 * 7
  : 24 * 7;

const rawCleanupBatch = process.env.ATTACHMENT_CLEANUP_BATCH_SIZE;
export const DEFAULT_ATTACHMENT_CLEANUP_BATCH_SIZE = rawCleanupBatch
  ? Math.max(Number(rawCleanupBatch) || 50, 1)
  : 50;

// ============================================================================
// PDF Native API Configuration
// ============================================================================

/** Maximum pages allowed for native PDF API (Anthropic/Gemini) */
export const PDF_MAX_PAGES = Number(process.env.PDF_MAX_PAGES) || 50;

/** Maximum file size in MB for native PDF API */
export const PDF_MAX_SIZE_MB = Number(process.env.PDF_MAX_SIZE_MB) || 50;

/** Whether to prefer native PDF API over text extraction */
export const PREFER_NATIVE_PDF = process.env.PREFER_NATIVE_PDF !== "false";

/** Maximum pages for scanned PDF OCR (fallback for scanned documents) */
export const OCR_MAX_PAGES = Number(process.env.OCR_MAX_PAGES) || 20;
