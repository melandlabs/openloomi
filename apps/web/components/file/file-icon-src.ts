/**
 * Basenames that exist as SVG under public/images/file/.
 */
const LIBRARY_FILE_ICON_NAMES = new Set([
  "audio",
  "code",
  "csv",
  "css",
  "doc",
  "docx",
  "html",
  "js",
  "json",
  "image",
  "pdf",
  "ppt",
  "pptx",
  "rar",
  "sql",
  "svg",
  "txt",
  "video",
  "xml",
  "xls",
  "xlsx",
  "zip",
  "spreadsheets",
]);

const UPLOAD_FILE_ICON_PATHS = {
  audio: "/images/file/upload/icon_audio.svg",
  excel: "/images/file/upload/icon_excel.svg",
  file: "/images/file/upload/icon_file.svg",
  html: "/images/file/upload/icon_html.svg",
  pdf: "/images/file/upload/icon_pdf.svg",
  pic: "/images/file/upload/icon_pic.svg",
  ppt: "/images/file/upload/icon_ppt.svg",
  txt: "/images/file/upload/icon_txt.svg",
  unknown: "/images/file/upload/icon_unknown.svg",
  video: "/images/file/upload/icon_video.svg",
  word: "/images/file/upload/icon_word.svg",
  zip: "/images/file/upload/icon_zip.svg",
} as const;

/**
 * Returns the unified file type SVG path within the library based on extension
 * or MIME type (`/images/file/*.svg`).
 */
export function getLibraryFileIconSrc(extRaw: string): string {
  const ext = extRaw.toLowerCase().replace(/^\./, "").trim();
  if (!ext) {
    return "/images/file/default.svg";
  }

  if (ext.startsWith("image/")) {
    return "/images/file/image.svg";
  }

  if (ext.startsWith("audio/")) {
    return "/images/file/audio.svg";
  }

  if (ext.startsWith("video/")) {
    return "/images/file/video.svg";
  }

  // Apple iWork MIME types arrive intact via attachment badges; map them to
  // existing office-suite icons so users can tell the file apart at a glance.
  if (ext.includes("apple.pages") || ext.includes("x-iwork-pages")) {
    return "/images/file/docx.svg";
  }
  if (ext.includes("apple.numbers") || ext.includes("x-iwork-numbers")) {
    return "/images/file/spreadsheets.svg";
  }
  if (ext.includes("apple.keynote") || ext.includes("x-iwork-keynote")) {
    return "/images/file/pptx.svg";
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
    tsv: "csv",
    ods: "spreadsheets",
    odp: "pptx",
    // Apple iWork suite - reuse the closest existing icon so users can tell
    // a Pages/Numbers/Keynote attachment apart from a generic file.
    key: "pptx",
    keynote: "pptx",
    pages: "docx",
    numbers: "spreadsheets",
    "7z": "zip",
    gz: "zip",
    tgz: "zip",
    tar: "zip",
    jpg: "image",
    jpeg: "image",
    png: "image",
    gif: "image",
    webp: "image",
    bmp: "image",
    tif: "image",
    tiff: "image",
    heic: "image",
    heif: "image",
    avif: "image",
    ico: "image",
    mp3: "audio",
    wav: "audio",
    m4a: "audio",
    aac: "audio",
    ogg: "audio",
    oga: "audio",
    flac: "audio",
    opus: "audio",
    amr: "audio",
    wma: "audio",
    mid: "audio",
    midi: "audio",
    mp4: "video",
    mov: "video",
    webm: "video",
    avi: "video",
    mkv: "video",
    m4v: "video",
    mpg: "video",
    mpeg: "video",
    "3gp": "video",
    ogv: "video",
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

/**
 * Returns the upload-scene SVG path based on extension or MIME type.
 * The mapping is intentionally category-based so the same icon set can be
 * reused by multiple upload-related UIs.
 */
export function getUploadFileIconSrc(extRaw: string): string {
  const ext = extRaw.toLowerCase().replace(/^\./, "").trim();
  if (!ext) {
    return UPLOAD_FILE_ICON_PATHS.unknown;
  }

  const mimeCategoryMap: Record<string, keyof typeof UPLOAD_FILE_ICON_PATHS> = {
    "application/pdf": "pdf",
    "application/msword": "word",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "word",
    "application/vnd.ms-excel": "excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      "excel",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      "ppt",
    "text/plain": "txt",
    "text/markdown": "txt",
    "text/csv": "excel",
    "text/tab-separated-values": "excel",
    "text/html": "html",
    "application/json": "file",
    "application/zip": "zip",
    "application/vnd.rar": "zip",
    "application/x-7z-compressed": "zip",
    "application/x-tar": "zip",
    "application/gzip": "zip",
    "application/x-bzip2": "zip",
  };

  if (ext.startsWith("image/")) {
    return UPLOAD_FILE_ICON_PATHS.pic;
  }

  if (ext.startsWith("audio/")) {
    return UPLOAD_FILE_ICON_PATHS.audio;
  }

  if (ext.startsWith("video/")) {
    return UPLOAD_FILE_ICON_PATHS.video;
  }

  const mimeCategory = mimeCategoryMap[ext];
  if (mimeCategory) {
    return UPLOAD_FILE_ICON_PATHS[mimeCategory];
  }

  if (ext.includes("apple.pages") || ext.includes("x-iwork-pages")) {
    return UPLOAD_FILE_ICON_PATHS.word;
  }
  if (ext.includes("apple.numbers") || ext.includes("x-iwork-numbers")) {
    return UPLOAD_FILE_ICON_PATHS.excel;
  }
  if (ext.includes("apple.keynote") || ext.includes("x-iwork-keynote")) {
    return UPLOAD_FILE_ICON_PATHS.ppt;
  }

  const categoryMap: Record<string, keyof typeof UPLOAD_FILE_ICON_PATHS> = {
    jpg: "pic",
    jpeg: "pic",
    png: "pic",
    gif: "pic",
    webp: "pic",
    pdf: "pdf",
    doc: "word",
    docx: "word",
    rtf: "word",
    pages: "word",
    xls: "excel",
    xlsx: "excel",
    csv: "excel",
    tsv: "excel",
    ods: "excel",
    numbers: "excel",
    ppt: "ppt",
    pptx: "ppt",
    odp: "ppt",
    key: "ppt",
    keynote: "ppt",
    txt: "txt",
    md: "txt",
    markdown: "txt",
    log: "txt",
    html: "html",
    htm: "html",
    mp3: "audio",
    wav: "audio",
    flac: "audio",
    aac: "audio",
    ogg: "audio",
    m4a: "audio",
    mp4: "video",
    webm: "video",
    mov: "video",
    avi: "video",
    mkv: "video",
    zip: "zip",
    rar: "zip",
    "7z": "zip",
    tar: "zip",
    gz: "zip",
    tgz: "zip",
    bz2: "zip",
    json: "file",
  };

  const iconKey = categoryMap[ext];
  if (iconKey) {
    return UPLOAD_FILE_ICON_PATHS[iconKey];
  }

  return UPLOAD_FILE_ICON_PATHS.file;
}
