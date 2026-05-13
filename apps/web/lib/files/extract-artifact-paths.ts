/**
 * Parses absolute paths of "previewable generated files" from Agent tool output or assistant messages.
 * Supports both macOS/Linux (/Users/...) and Windows (C:\Users\..., with / and \ intermixed in paths).
 */

const ARTIFACT_EXT =
  "pptx|pdf|xlsx|docx|py|js|ts|tsx|jsx|html|htm|md|mmark|txt|json";

/**
 * Path boundary: lookahead match that excludes separators (including Markdown backticks `) from the match result,
 * preventing dirty characters like "MD" in subtitles.
 */
const PATH_BOUNDARY = "(?=\\s|\\)|$|\\'|\\\"|\\u0060|,|\\]|\\}|\\|)";

/**
 * Returns the last segment (filename) of a path (compatible with Windows and POSIX).
 */
export function artifactPathBasename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/**
 * Extracts a clean extension (lowercase, alphanumeric only) from filename or type field, for use in icons and subtitles.
 */
export function sanitizeArtifactFileExtension(raw: string): string {
  const base = (raw || "").replace(/^\./, "").toLowerCase();
  const letters = base.replace(/[^a-z0-9]/g, "");
  return letters.slice(0, 16);
}

/**
 * Removes erroneously captured trailing punctuation (double protection, compatible with legacy data).
 */
export function normalizeExtractedArtifactPath(raw: string): string {
  let s = raw.trim().replace(/[()\s]+$/g, "");
  s = s.replace(/[`'"\s|\\),}\]]+$/g, "");
  return s;
}

function buildArtifactPathPatterns(): RegExp[] {
  const ext = ARTIFACT_EXT;
  const b = PATH_BOUNDARY;
  return [
    new RegExp(`/Users/[^/\\\\]+/Desktop/.+?\\.(${ext})${b}`, "gi"),
    new RegExp(
      `/Users/[^/\\\\]+/\\.openloomi/data/memory/.+?\\.(${ext})${b}`,
      "gi",
    ),
    new RegExp(
      `/Users/[^/\\\\]+/\\.openloomi/sessions/[^/\\\\]+(?:/[^/\\\\]+)?/.+?\\.(${ext})${b}`,
      "gi",
    ),
    new RegExp(`/(?:Users|home)/[^/\\\\].+?\\.(${ext})${b}`, "gi"),
    new RegExp(
      `[A-Za-z]:(?:\\\\|/)Users(?:\\\\|/)[^/\\\\\\n\\r]+(?:\\\\|/)Desktop(?:\\\\|/).+?\\.(${ext})${b}`,
      "gi",
    ),
    new RegExp(
      `[A-Za-z]:(?:\\\\|/)Users(?:\\\\|/)[^/\\\\\\n\\r]+(?:\\\\|/)\\.openloomi(?:\\\\|/)sessions(?:\\\\|/)[^/\\\\\\n\\r]+(?:\\\\|/)(?:[^/\\\\\\n\\r]+(?:\\\\|/))?.+?\\.(${ext})${b}`,
      "gi",
    ),
    new RegExp(
      `[A-Za-z]:(?:\\\\|/)Users(?:\\\\|/)[^/\\\\\\n\\r]+(?:\\\\|/)\\.openloomi(?:\\\\|/)data(?:\\\\|/)memory(?:\\\\|/).+?\\.(${ext})${b}`,
      "gi",
    ),
  ];
}

let cachedPatterns: RegExp[] | null = null;

/**
 * Extracts all matching artifact file absolute paths from text (deduplicated, with trailing noise removed).
 */
export function extractArtifactPathsFromText(text: string): string[] {
  if (!text || typeof text !== "string") return [];

  if (cachedPatterns === null) {
    cachedPatterns = buildArtifactPathPatterns();
  }
  const patterns = cachedPatterns;
  const raw: string[] = [];

  for (const p of patterns) {
    const re = new RegExp(p.source, p.flags);
    const matches = text.match(re);
    if (matches?.length) raw.push(...matches);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of raw) {
    const cleaned = normalizeExtractedArtifactPath(m);
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      out.push(cleaned);
    }
  }
  return out;
}

/**
 * When multiple paths exist, prefer HTML (consistent with original chat-context behavior), otherwise return the first one.
 */
export function pickPreferredArtifactPath(paths: string[]): string | null {
  if (paths.length === 0) return null;
  const html = paths.find((f) => /\.html?$/i.test(f));
  return html ?? paths[0];
}
