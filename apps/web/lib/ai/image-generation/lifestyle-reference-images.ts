export type LifestyleReferenceImageRole = "style" | "subject";

export interface LifestyleReferenceImagePayload {
  b64Json: string;
  mimeType: string;
  role: LifestyleReferenceImageRole;
  note?: string;
}

export interface LifestyleReferenceImageSource {
  data?: unknown;
  dataUrl?: unknown;
  b64Json?: unknown;
  mimeType?: unknown;
  role?: unknown;
  note?: unknown;
}

export interface BuildLifestyleReferenceImagesOptions {
  maxImages?: number;
  defaultRole?: LifestyleReferenceImageRole;
}

export const MAX_LIFESTYLE_REFERENCE_IMAGES = 4;

const MAX_REFERENCE_NOTE_LENGTH = 160;
const SUPPORTED_REFERENCE_IMAGE_MIME_TYPES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export function buildLifestyleReferenceImages(
  sources: LifestyleReferenceImageSource[] | null | undefined,
  options: BuildLifestyleReferenceImagesOptions = {},
): LifestyleReferenceImagePayload[] {
  if (!sources?.length) return [];

  const maxImages = normalizeMaxImages(options.maxImages);
  const defaultRole = normalizeRole(options.defaultRole) ?? "style";
  const images: LifestyleReferenceImagePayload[] = [];

  for (const source of sources) {
    if (images.length >= maxImages) break;
    const image = normalizeLifestyleReferenceImage(source, { defaultRole });
    if (image) {
      images.push(image);
    }
  }

  return images;
}

export function normalizeLifestyleReferenceImage(
  source: LifestyleReferenceImageSource | null | undefined,
  options: { defaultRole?: LifestyleReferenceImageRole } = {},
): LifestyleReferenceImagePayload | null {
  if (!source) return null;

  const encodedImage = extractEncodedImage(source);
  if (!encodedImage) return null;

  const mimeType = normalizeMimeType(source.mimeType, encodedImage.mimeType);
  if (!mimeType || !SUPPORTED_REFERENCE_IMAGE_MIME_TYPES.has(mimeType)) {
    return null;
  }

  const b64Json = stripDataUrlPrefix(encodedImage.b64Json).trim();
  if (!b64Json) return null;

  const role = normalizeRole(source.role) ?? options.defaultRole ?? "style";
  const note = normalizeReferenceNote(source.note);

  return {
    b64Json,
    mimeType,
    role,
    ...(note ? { note } : {}),
  };
}

export function isSupportedLifestyleReferenceImageMimeType(
  mimeType: unknown,
): mimeType is string {
  const normalized = normalizeMimeType(mimeType);
  return Boolean(
    normalized && SUPPORTED_REFERENCE_IMAGE_MIME_TYPES.has(normalized),
  );
}

function extractEncodedImage(
  source: LifestyleReferenceImageSource,
): { b64Json: string; mimeType?: string } | null {
  const dataUrl = firstString(source.dataUrl);
  if (dataUrl) {
    const parsed = parseDataUrl(dataUrl);
    if (parsed) return parsed;
  }

  const b64Json = firstString(source.b64Json, source.data);
  return b64Json ? { b64Json } : null;
}

function parseDataUrl(
  value: string,
): { b64Json: string; mimeType: string } | null {
  const match = value.trim().match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match) return null;
  return {
    mimeType: match[1].toLowerCase(),
    b64Json: match[2],
  };
}

function stripDataUrlPrefix(value: string): string {
  const parsed = parseDataUrl(value);
  return parsed?.b64Json ?? value;
}

function normalizeMimeType(
  value: unknown,
  fallback?: string,
): string | undefined {
  const raw = firstString(value) ?? fallback;
  const normalized = raw?.trim().toLowerCase();
  return normalized?.startsWith("image/") ? normalized : undefined;
}

function normalizeRole(
  value: unknown,
): LifestyleReferenceImageRole | undefined {
  return value === "subject" || value === "style" ? value : undefined;
}

function normalizeReferenceNote(value: unknown): string | undefined {
  const note = firstString(value);
  if (!note) return undefined;
  return note.length > MAX_REFERENCE_NOTE_LENGTH
    ? `${note.slice(0, MAX_REFERENCE_NOTE_LENGTH - 3)}...`
    : note;
}

function normalizeMaxImages(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : MAX_LIFESTYLE_REFERENCE_IMAGES;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}
