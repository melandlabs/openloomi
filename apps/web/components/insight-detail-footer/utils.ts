import TurndownService from "turndown";

const turndownService = new TurndownService();

const escapeHtml = (input: string): string =>
  input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Convert plain text to HTML
 */
export const plainTextToHtml = (text: string): string => {
  if (!text) return "<p></p>";
  const paragraphs = text.split(/\n{2,}/);
  return paragraphs
    .map((paragraph) => {
      const safe = escapeHtml(paragraph);
      const withBreaks = safe.replace(/\n/g, "<br />");
      return withBreaks.length > 0 ? `<p>${withBreaks}</p>` : "<p><br /></p>";
    })
    .join("");
};

/**
 * Convert HTML to plain text
 */
export const htmlToPlainText = (html: string): string =>
  turndownService.turndown(html ?? "").trim();

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const DRAFT_STORAGE_KEY = "openloomi:insight-reply";
export const TG_SEND_INVALID_PEER_ID_ERR_MSG =
  "Could not find the input entity";

/**
 * Normalize translation output
 */
export const normalizeTranslationOutput = (raw: string): string | null => {
  let trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("```")) {
    trimmed = trimmed.replace(/^```(?:json|text)?/i, "");
    trimmed = trimmed.replace(/```$/, "");
    trimmed = trimmed.trim();
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  trimmed = trimmed
    .replace(/^(")?(translation|rewrite)\1?\s*[:=]\s*/i, "")
    .trim();
  trimmed = trimmed.replace(/^(")?(translation|rewrite)\1?\s*$/i, "").trim();
  if (!/[\p{L}\p{N}]/u.test(trimmed)) {
    return null;
  }
  return trimmed;
};

/**
 * Extract translation candidate from value (also supports extracting rewrite field for polishing)
 */
export const extractTranslationCandidate = (
  value: unknown,
  depth = 0,
): string | null => {
  if (depth > 4 || value == null) return null;
  if (typeof value === "string") {
    return normalizeTranslationOutput(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = extractTranslationCandidate(item, depth + 1);
      if (candidate) return candidate;
    }
    return null;
  }
  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    // Prioritize looking for translation field (used for translation)
    if (Object.prototype.hasOwnProperty.call(objectValue, "translation")) {
      const candidate = extractTranslationCandidate(
        objectValue.translation,
        depth + 1,
      );
      if (candidate) return candidate;
    }
    // Also look for rewrite field (used for polishing)
    if (Object.prototype.hasOwnProperty.call(objectValue, "rewrite")) {
      const candidate = extractTranslationCandidate(
        objectValue.rewrite,
        depth + 1,
      );
      if (candidate) return candidate;
    }
    for (const val of Object.values(objectValue)) {
      const candidate = extractTranslationCandidate(val, depth + 1);
      if (candidate) return candidate;
    }
  }
  return null;
};

/**
 * Detect if text might be partial JSON
 */
export const isLikelyPartialJson = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (
    (trimmed.startsWith("{") && !trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && !trimmed.endsWith("]")) ||
    (trimmed.startsWith('"') && !trimmed.endsWith('"'))
  ) {
    return true;
  }
  if (/^{"?\s*translation"?\s*:\s*$/i.test(trimmed)) return true;
  return false;
};

/**
 * Detect language from text
 */
export const detectLanguageFromText = (text: string): string | null => {
  if (!text) return null;
  const sample = text.slice(0, 400);
  if (/[\u4E00-\u9FFF]/.test(sample)) return "zh";
  if (/[ぁ-んァ-ン]/.test(sample)) return "ja";
  if (/[가-힣]/.test(sample)) return "ko";
  if (/[А-Яа-яЁё]/.test(sample)) return "ru";
  if (/[áéíóúñÁÉÍÓÚÑ]/.test(sample)) return "es";
  if (/[àâçéèêëîïôûùüÿ]/i.test(sample)) return "fr";
  if (/[äöüßÄÖÜ]/.test(sample)) return "de";
  if (/[A-Za-z]/.test(sample)) return "en";
  return null;
};

/**
 * Extract target language content from bilingual format text
 * Format: "Text\n\n[Lang]\nTranslation" or similar format
 * Returns target language part, returns original text if not found
 */
export const extractTargetLanguageContent = (
  text: string,
  targetLanguage: string,
  userLanguage?: string | null,
): string => {
  if (!text) return text;

  // If no user preferred language, return original text directly
  if (!userLanguage || userLanguage === targetLanguage) {
    return text;
  }

  // Try to match bilingual format: "Text\n\n[Lang]\nTranslation"
  // Format could be: "Chinese content\n\n[EN]\nEnglish content" or "English\n\n[ZH]\nChinese"
  const bilingualPattern = /^(.+?)\n\n\[([A-Z]{2})\]\n(.+)$/s;
  const match = text.match(bilingualPattern);

  if (match) {
    const [, firstPart, langCode, secondPart] = match;
    const langCodeLower = langCode.toLowerCase();

    // If second part is target language, return second part
    if (langCodeLower === targetLanguage.toLowerCase()) {
      return secondPart.trim();
    }
    // If first part is target language, return first part
    // Check language of first part
    const firstPartLang = detectLanguageFromText(firstPart);
    if (firstPartLang === targetLanguage) {
      return firstPart.trim();
    }
    // If neither matches, return the part corresponding to the target language
    // Default to returning the second part (usually the translation)
    return secondPart.trim();
  }

  // Try other possible bilingual formats
  // Format: "Text\n---\nTranslation" or "Text\n\nTranslation"
  const separatorPattern = /\n\n---\n\n|\n\n\n/;
  if (separatorPattern.test(text)) {
    const parts = text.split(separatorPattern);
    if (parts.length >= 2) {
      // Detect language of each part, return the part matching the target language
      for (const part of parts) {
        const partLang = detectLanguageFromText(part.trim());
        if (partLang === targetLanguage) {
          return part.trim();
        }
      }
      // If no match found, return the last part (usually the translation)
      return parts[parts.length - 1].trim();
    }
  }

  // If bilingual format cannot be recognized, return the original text
  return text;
};
