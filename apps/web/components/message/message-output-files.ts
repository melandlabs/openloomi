import type { ChatMessage } from "@openloomi/shared";
import {
  artifactPathBasename,
  extractArtifactPathsFromText,
  normalizeExtractedArtifactPath,
  sanitizeArtifactFileExtension,
} from "@/lib/files/extract-artifact-paths";

/**
 * Checks if a file path is under the temp/ subdirectory (temporary file)
 */
export function isTemporaryFile(path: string): boolean {
  // Check if path contains /temp/ subdirectory
  // Matches: xxx/temp/xxx or xxx/temp/xxx.ext
  const normalizedPath = path.replace(/\\/g, "/");
  return /\/temp\//i.test(normalizedPath);
}

/** Single tool output file display reference (consistent with LibraryItemRow / preview panel) */
export type ToolOutputFileRef = {
  name: string;
  path: string;
  type: string;
  isTemporary?: boolean;
  modifiedTime?: string;
};

type ToolNativePart = {
  type?: string;
  generatedFile?: { name?: string; path?: string; type?: string };
  codeFile?: { name?: string; path?: string; language?: string };
};

/**
 * Collects previewable generated files from message parts (deduplicated by path):
 * tool-native's generatedFile/codeFile, plus session paths parsed from the body text.
 */
export function collectToolOutputFilesFromParts(
  parts: ChatMessage["parts"] | undefined,
): ToolOutputFileRef[] {
  if (!parts?.length) return [];
  const byPath = new Map<string, ToolOutputFileRef>();

  for (const part of parts) {
    if ((part as { type?: string }).type !== "tool-native") continue;
    const p = part as ToolNativePart;
    const candidates: Array<{
      name?: string;
      path?: string;
      type?: string;
      language?: string;
    }> = [];
    if (p.generatedFile) candidates.push(p.generatedFile);
    if (p.codeFile) candidates.push(p.codeFile);

    for (const f of candidates) {
      const nameRaw = f.name?.trim();
      const pathRaw = f.path?.trim();
      if (!nameRaw || !pathRaw) continue;
      const path = normalizeExtractedArtifactPath(pathRaw);
      const name = nameRaw.replace(/[`'"\s)]+$/, "");
      const type =
        sanitizeArtifactFileExtension(
          f.type || f.language || name.split(".").pop() || "",
        ) || "unknown";
      if (!byPath.has(path)) {
        byPath.set(path, {
          name,
          path,
          type,
          isTemporary: isTemporaryFile(path),
        });
      }
    }
  }

  const textBlob = parts
    .filter((p) => (p as { type?: string }).type === "text")
    .map((p) => {
      const t = p as { text?: string; content?: string };
      return String(t.text ?? t.content ?? "");
    })
    .join("\n");

  for (const raw of extractArtifactPathsFromText(textBlob)) {
    const path = normalizeExtractedArtifactPath(raw);
    if (!path) continue;
    const name = artifactPathBasename(path).replace(/[`'"\s)]+$/, "");
    const ext =
      sanitizeArtifactFileExtension(name.split(".").pop() || "") || "unknown";
    if (!byPath.has(path)) {
      byPath.set(path, {
        name,
        path,
        type: ext,
        isTemporary: isTemporaryFile(path),
      });
    }
  }

  return Array.from(byPath.values());
}
