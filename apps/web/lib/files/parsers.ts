/**
 * LangChain-based document parser
 * Uses LangChain's built-in document loaders for better reliability
 * Supports Apple documents (.pages, .numbers, .keynote)
 */

import { Document } from "@langchain/core/documents";
import { unlink, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { isTauriMode } from "@/lib/env";
import { PDF_MAX_PAGES, PDF_MAX_SIZE_MB, PREFER_NATIVE_PDF } from "./config";

async function getJSZip() {
  const module = await import("jszip");
  return module.default ?? module;
}

/**
 * Get the appropriate base URL for vision API
 * - Web (cloud + local dev): Use external AI provider directly
 * - Tauri desktop app: Use local proxy which will forward to cloud
 */
function getVisionBaseUrl(): string {
  // In Web mode (cloud or local dev), use external AI provider directly
  if (!isTauriMode()) {
    const externalUrl =
      process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1";
    console.log(
      "[Vision Parser] Using external AI provider (web mode):",
      externalUrl,
    );
    return externalUrl;
  }

  // In Tauri mode, use local proxy
  // The local proxy will handle forwarding to cloud or using local AI provider
  const localProxyUrl =
    process.env.LLM_LOCAL_PROXY_URL ||
    process.env.NEXT_PUBLIC_CLOUD_API_URL ||
    "https://app.openloomi.ai";
  const proxyPath = "/api/ai/v1";
  const fullLocalUrl = `${localProxyUrl}${proxyPath}`;

  console.log("[Vision Parser] Using local proxy (Tauri mode):", fullLocalUrl);
  return fullLocalUrl;
}

// Configuration from environment
const OPENROUTER_API_KEY =
  process.env.OPENROUTER_API_KEY || process.env.LLM_API_KEY;

// Vision model - use OpenAI compatible multimodal model
// Can be overridden via LLM_VISION_LANGUAGE_MODEL env var
const VISION_MODEL =
  process.env.LLM_VISION_LANGUAGE_MODEL || "google/gemini-2.5-flash";

export type FileContent = {
  text: string;
  metadata?: {
    source?: string;
    [key: string]: any;
  };
};

/**
 * Parse a file buffer and extract text content using LangChain document loaders
 */
export async function parseFile(
  buffer: Buffer,
  contentType: string,
  cloudAuthToken?: string,
): Promise<FileContent> {
  // Check if this is an image - use Claude Vision API
  if (contentType.startsWith("image/")) {
    console.log(
      `[parseFile] Detected image type ${contentType}, using LLM Vision API`,
    );
    return parseImage(buffer, contentType, cloudAuthToken);
  }

  // For non-image files, use LangChain loaders
  // Create a temporary file for LangChain loaders (they expect file paths)
  const extension = getExtension(contentType);
  const tempFilePath = join(tmpdir(), `temp_${Date.now()}${extension}`);

  try {
    // Write buffer to temp file
    await writeFile(tempFilePath, buffer);

    // Use appropriate LangChain loader based on content type
    // getLoader is async and uses dynamic imports to reduce memory footprint
    const loader = await getLoader(contentType, tempFilePath);

    console.log(
      `[parseFile] Loading file with ${contentType}, temp path: ${tempFilePath}, file size: ${buffer.length} bytes`,
    );

    let docs: Document[];
    try {
      docs = await loader.load();
    } catch (loaderError) {
      console.error(
        `[parseFile] Loader error for ${contentType}:`,
        loaderError,
      );
      throw new Error(
        `Failed to parse ${contentType} file: ${loaderError instanceof Error ? loaderError.message : String(loaderError)}`,
      );
    }

    let text = docs.map((doc) => doc.pageContent).join("\n\n");

    // Fallback: if LangChain loader returned empty content for PDF, try pdf-parse
    if (
      (!text || text.trim().length === 0) &&
      contentType === "application/pdf"
    ) {
      console.log(
        "[parseFile] LangChain returned empty content for PDF, trying pdf-parse fallback...",
      );
      try {
        // Dynamic import pdf-parse to reduce memory footprint
        const pdfParse = (await import("pdf-parse")).default;
        const pdfResult = await pdfParse(buffer);
        text = pdfResult.text || "";
        console.log(`[parseFile] pdf-parse result: ${text.length} characters`);
      } catch (pdfError) {
        console.error("[parseFile] pdf-parse fallback failed:", pdfError);
      }
    }

    console.log(
      `[parseFile] Loaded docs, count: ${docs.length}, content length: ${text.length}`,
    );

    return {
      text,
      metadata: {
        source: tempFilePath,
      },
    };
  } finally {
    // Clean up temp file
    try {
      await unlink(tempFilePath);
    } catch (error) {
      console.warn("Failed to delete temp file:", tempFilePath);
    }
  }
}

/**
 * Get file extension from MIME type
 */
function getExtension(contentType: string): string {
  const mimeToExt: Record<string, string> = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      ".docx",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      ".pptx",
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      ".xlsx",
    "application/vnd.ms-excel": ".xls",
    "text/plain": ".txt",
    "text/markdown": ".md",
    "text/csv": ".csv",
    // Apple iWork suite formats
    "application/vnd.apple.pages": ".pages",
    "application/vnd.apple.numbers": ".numbers",
    "application/vnd.apple.keynote": ".keynote",
    "application/x-iwork-pages-sffpages": ".pages",
    "application/x-iwork-numbers-sffnumbers": ".numbers",
    "application/x-iwork-keynote-sffkeynote": ".keynote",
    // Images
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };

  return mimeToExt[contentType] || ".txt";
}

/**
 * Compress and resize image for Vision API
 * Reduces file size to avoid 413 Request Entity Too Large errors
 */
async function compressImage(
  buffer: Buffer,
  contentType: string,
): Promise<Buffer> {
  const MAX_DIMENSION = 2048; // Max width or height
  const JPEG_QUALITY = 85;

  // Dynamic import sharp to reduce memory footprint
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sharpModule = require("sharp");

  let image = sharpModule(buffer);

  // Get image metadata
  const metadata = await image.metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  console.log(
    `[Image Compress] Original: ${width}x${height}, ${buffer.length} bytes`,
  );

  // Resize if too large
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    image = image.resize(MAX_DIMENSION, MAX_DIMENSION, {
      fit: "inside",
      withoutEnlargement: true,
    });
    console.log(`[Image Compress] Resized to max ${MAX_DIMENSION}px`);
  }

  // Convert to JPEG with compression for better size reduction
  // Most Vision APIs accept JPEG even if original was PNG
  const compressedBuffer = await image
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  console.log(
    `[Image Compress] Compressed: ${compressedBuffer.length} bytes (${((1 - compressedBuffer.length / buffer.length) * 100).toFixed(1)}% reduction)`,
  );

  return compressedBuffer;
}

/**
 * Parse image using OpenAI-compatible Vision API
 * Extracts text, descriptions, and visual content from images
 */
async function parseImage(
  buffer: Buffer,
  contentType: string,
  cloudAuthToken?: string,
): Promise<FileContent> {
  // In Tauri mode with cloudAuthToken, use local proxy with JWT auth
  // Otherwise, require LLM_API_KEY for direct API access
  const useLocalProxy = isTauriMode() && cloudAuthToken;

  if (!useLocalProxy && !OPENROUTER_API_KEY) {
    throw new Error(
      "LLM_API_KEY is required for image RAG processing. Please set the environment variable.",
    );
  }

  // Compress image to avoid 413 Request Entity Too Large errors
  // This is especially important for scanned PDF pages which can be very large
  let imageBuffer = buffer;
  let finalContentType = contentType;

  try {
    imageBuffer = await compressImage(buffer, contentType);
    finalContentType = "image/jpeg"; // Use JPEG after compression
  } catch (compressError) {
    console.warn(
      "[Image Compress] Failed to compress image, using original:",
      compressError,
    );
  }

  // Convert buffer to base64 with data URL prefix
  const base64Image = `data:${finalContentType};base64,${imageBuffer.toString("base64")}`;

  // Initialize OpenAI client with appropriate base URL and auth
  // - Cloud mode: Direct connection to external AI provider with API key
  // - Tauri mode with cloudAuthToken: Use local proxy with JWT auth
  // Dynamic import OpenAI to reduce memory footprint
  const { default: OpenAI } = await import("openai");
  const openai = new OpenAI({
    apiKey: useLocalProxy ? cloudAuthToken : OPENROUTER_API_KEY,
    baseURL: getVisionBaseUrl(),
    timeout: 120000, // 2 minutes timeout for large images
    maxRetries: 2, // Retry up to 2 times on transient failures
  });

  try {
    // Use Vision API to analyze the image
    const response = await openai.chat.completions.create({
      model: VISION_MODEL,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: base64Image,
              },
            },
            {
              type: "text",
              text: `Please analyze this image and provide a detailed textual description for RAG (Retrieval-Augmented Generation) purposes.

Your task is to extract ALL information from this image in a structured, searchable format:

1. **Text Content (OCR)**: Extract any visible text, including:
   - Document text, headlines, captions
   - Labels, signs, posters
   - Form fields, tables, charts with data
   - Any other readable text

2. **Visual Description**: Describe the visual content:
   - Main subjects, objects, people
   - Scene setting, background
   - Colors, layout, composition
   - Charts, graphs, diagrams (describe the data/trends)
   - Actions, activities, emotions

3. **Context & Metadata**:
   - Document type (invoice, resume, slide, etc.)
   - Language(s) present
   - Key themes or topics
   - Any dates, numbers, or important data

4. **Structured Data** (if applicable):
   - Tables as markdown tables
   - Lists as bullet points
   - Key-value pairs

Format your response as clean, structured text that can be easily searched and retrieved. Use markdown formatting (headers, bullet points, tables) where appropriate.

This description will be used for semantic search, so be comprehensive and detailed.`,
            },
          ],
        },
      ],
    });

    console.log("[parseImage] Received response from Vision API:", {
      id: response.id,
      model: response.model,
      choices: response.choices?.length,
      contentLength: response.choices[0]?.message?.content?.length,
    });

    // Extract the text content from response
    const text = response.choices[0]?.message?.content || "";

    if (!text) {
      console.warn("[parseImage] Empty response from Vision API");
    }

    // Add metadata about the image processing
    const metadata = {
      source: "vision-parsing",
      model: VISION_MODEL,
      imageFormat: contentType,
      imageSize: buffer.length,
      timestamp: new Date().toISOString(),
    };

    return {
      text: text.trim(),
      metadata,
    };
  } catch (error) {
    // Enhanced error logging
    console.error("[parseImage] Vision API error:", {
      error: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : "Unknown",
      stack: error instanceof Error ? error.stack : undefined,
      contentType,
      imageSize: buffer.length,
      model: VISION_MODEL,
    });

    // Provide more detailed error information
    const errorMessage =
      error instanceof Error ? error.message : "Unknown parsing error";
    const isAuthError =
      errorMessage.includes("401") ||
      errorMessage.includes("403") ||
      errorMessage.includes("auth") ||
      errorMessage.includes("API key");
    const isModelError =
      errorMessage.includes("model") ||
      errorMessage.includes("400") ||
      errorMessage.includes("not found");
    const isRateLimitError =
      errorMessage.includes("429") || errorMessage.includes("rate limit");
    const isTimeoutError =
      errorMessage.includes("timeout") ||
      errorMessage.includes("TIMEOUT") ||
      errorMessage.includes("ETIMEDOUT") ||
      errorMessage.includes("AbortError");

    let helpText = "";
    if (isAuthError) {
      helpText =
        "\n**Authentication Error**: Your LLM_API_KEY may be invalid or expired.";
    } else if (isModelError) {
      helpText = `\n**Model Error**: The vision model '${VISION_MODEL}' may not be supported or available on your API endpoint. Try setting LLM_VISION_MODEL to a different model.`;
    } else if (isRateLimitError) {
      helpText =
        "\n**Rate Limit Error**: You have exceeded the API rate limit. Please try again later.";
    } else if (isTimeoutError) {
      helpText =
        "\n**Timeout Error**: The image processing took too long. This may happen with large or complex images. Try using a smaller image or reducing the image quality.";
    }

    // Provide a fallback basic description
    return {
      text: `[Image Content - ${contentType}]\n\nThis image was uploaded but could not be fully analyzed. Image size: ${buffer.length} bytes.\n\n**Error Details**: ${errorMessage}${helpText}\n\n**Configuration**: Model: ${VISION_MODEL}, Base URL: ${getVisionBaseUrl()}\n\n**Troubleshooting**:\n1. Ensure LLM_API_KEY is properly configured and valid\n2. Verify your vision model supports image analysis\n3. Try setting LLM_VISION_MODEL environment variable\n4. Check API logs for more details`,
      metadata: {
        source: "vision-parsing-fallback",
        error: errorMessage,
        imageFormat: contentType,
        model: VISION_MODEL,
      },
    };
  }
}

/**
 * Apple document loader
 * Extract text content from .pages, .numbers, .keynote files
 *
 * Note: Apple files need to include iCloud preview PDF to be parsed.
 * If parsing fails, ask user to export file as PDF on Mac and upload the exported PDF.
 */
class AppleDocumentLoader {
  constructor(private filePath: string) {}

  async load(): Promise<Document[]> {
    try {
      const fileBuffer = await readFile(this.filePath);
      const JSZip = await getJSZip();
      const zip = await JSZip.loadAsync(fileBuffer);

      // List all files for debugging
      const allFiles = Object.keys(zip.files);
      console.log("[AppleDocumentLoader] Files in archive:", allFiles);

      // Try multiple possible preview PDF paths
      const possiblePreviewPaths = [
        "QuickLook/Preview.pdf",
        "preview.pdf",
        "Preview.pdf",
      ];

      for (const previewPath of possiblePreviewPaths) {
        const previewFile = zip.file(previewPath);
        if (previewFile) {
          console.log(
            "[AppleDocumentLoader] Found preview PDF at:",
            previewPath,
          );
          // Save preview PDF to temp file, then use PDFLoader
          const tempPdfPath = join(tmpdir(), `apple_preview_${Date.now()}.pdf`);
          try {
            const pdfData = await previewFile.async("uint8array");
            await writeFile(tempPdfPath, Buffer.from(pdfData));
            // Dynamic import PDFLoader to reduce memory footprint
            const { PDFLoader } =
              await import("@langchain/community/document_loaders/fs/pdf");
            const loader = new PDFLoader(tempPdfPath, { splitPages: false });
            return await loader.load();
          } finally {
            try {
              await unlink(tempPdfPath);
            } catch {
              // Ignore cleanup errors
            }
          }
        }
      }

      // If no preview PDF, try to extract internal XML content
      const possibleXmlPaths = ["index.xml", "Document.xml", "content.xml"];

      for (const xmlPath of possibleXmlPaths) {
        const xmlFile = zip.file(xmlPath);
        if (xmlFile) {
          console.log("[AppleDocumentLoader] Found XML at:", xmlPath);
          const content = await xmlFile.async("text");
          return [
            new Document({
              pageContent: content,
              metadata: { source: this.filePath, type: "apple-document" },
            }),
          ];
        }
      }

      // If none found, throw clear error
      throw new Error(
        `Cannot parse Apple document. The file may not have an iCloud preview PDF. Please open the file on Mac, go to File > Export As > PDF, and upload the exported PDF instead.`,
      );
    } catch (error) {
      console.error("[AppleDocumentLoader] Failed to load:", error);
      throw error;
    }
  }
}

/**
 * Get appropriate LangChain document loader for content type
 * Uses dynamic imports to lazy-load LangChain modules only when needed
 */
async function getLoader(contentType: string, filePath: string) {
  const mimeType = contentType.toLowerCase();

  // PDF files
  if (mimeType === "application/pdf") {
    console.log(`[getLoader] Creating PDFLoader for: ${filePath}`);
    // Dynamic import PDFLoader to reduce memory footprint
    const { PDFLoader } =
      await import("@langchain/community/document_loaders/fs/pdf");
    return new PDFLoader(filePath, {
      splitPages: false, // Don't split into pages, return as single document
    });
  }

  // Word documents (.docx)
  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    // Dynamic import DocxLoader to reduce memory footprint
    const { DocxLoader } =
      await import("@langchain/community/document_loaders/fs/docx");
    return new DocxLoader(filePath);
  }

  // CSV files
  if (mimeType === "text/csv") {
    // Dynamic import CSVLoader to reduce memory footprint
    const { CSVLoader } =
      await import("@langchain/community/document_loaders/fs/csv");
    return new CSVLoader(filePath);
  }

  // Apple iWork suite format (new version)
  if (
    mimeType === "application/vnd.apple.pages" ||
    mimeType === "application/vnd.apple.numbers" ||
    mimeType === "application/vnd.apple.keynote"
  ) {
    console.log(`[getLoader] Creating AppleDocumentLoader for: ${filePath}`);
    return new AppleDocumentLoader(filePath);
  }

  // Apple iWork suite format (legacy macOS)
  if (
    mimeType === "application/x-iwork-pages-sffpages" ||
    mimeType === "application/x-iwork-numbers-sffnumbers" ||
    mimeType === "application/x-iwork-keynote-sffkeynote"
  ) {
    console.log(`[getLoader] Creating AppleDocumentLoader for: ${filePath}`);
    return new AppleDocumentLoader(filePath);
  }

  // PowerPoint and Excel - use generic text loader
  // Note: LangChain doesn't have dedicated loaders for PPTX/XLSX yet
  // For these, we'd need to use a different approach or the unstructured loader
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mimeType === "application/vnd.ms-powerpoint" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel"
  ) {
    // For now, create a simple loader that reads as text
    // In production, you might want to use the UnstructuredLoader or convert to text first
    return {
      async load() {
        const content = readFileSync(filePath, "utf-8");
        return [
          new Document({
            pageContent: content,
            metadata: { source: filePath },
          }),
        ];
      },
    };
  }

  // Default to text loader for .txt, .md, and others
  return {
    async load() {
      const content = readFileSync(filePath, "utf-8");
      return [
        new Document({
          pageContent: content,
          metadata: { source: filePath },
        }),
      ];
    },
  };
}

/**
 * Create a LangChain Document from text content
 */
export function createDocument(
  text: string,
  metadata?: Record<string, any>,
): Document {
  return new Document({
    pageContent: text,
    metadata: metadata || {},
  });
}

/**
 * Batch parse multiple files
 */
export async function parseFiles(
  files: Array<{ buffer: Buffer; contentType: string }>,
): Promise<FileContent[]> {
  const results = await Promise.allSettled(
    files.map((file) => parseFile(file.buffer, file.contentType)),
  );

  return results.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    } else {
      console.error(`Failed to parse file ${index}:`, result.reason);
      return {
        text: "",
        metadata: {
          error:
            result.reason instanceof Error
              ? result.reason.message
              : "Unknown error",
        },
      };
    }
  });
}

/**
 * Get PDF page count from buffer
 * Uses pdfjs-dist for accurate page count
 */
export async function getPdfPageCount(buffer: Buffer): Promise<number> {
  try {
    // Use the legacy bundle in Node.js to avoid DOM APIs (e.g., DOMMatrix) at runtime.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;
    return pdf.numPages;
  } catch (error) {
    console.error("[getPdfPageCount] Error:", error);
    // Fallback: try using PDFLoader (dynamic import to reduce memory footprint)
    const tempFilePath = join(tmpdir(), `temp_pdf_pages_${Date.now()}.pdf`);
    try {
      await writeFile(tempFilePath, buffer);
      const { PDFLoader } =
        await import("@langchain/community/document_loaders/fs/pdf");
      const loader = new PDFLoader(tempFilePath, { splitPages: false });
      const docs = await loader.load();
      return docs.length;
    } finally {
      try {
        await unlink(tempFilePath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Check if PDF should use native PDF API based on configuration
 */
export function shouldUseNativePdf(
  pageCount: number,
  bufferSizeBytes: number,
): { shouldUseNative: boolean; reason?: string } {
  const sizeMB = bufferSizeBytes / (1024 * 1024);

  if (!PREFER_NATIVE_PDF) {
    return {
      shouldUseNative: false,
      reason: "PREFER_NATIVE_PDF is disabled",
    };
  }

  if (pageCount > PDF_MAX_PAGES) {
    return {
      shouldUseNative: false,
      reason: `PDF has ${pageCount} pages, exceeds limit of ${PDF_MAX_PAGES}`,
    };
  }

  if (sizeMB > PDF_MAX_SIZE_MB) {
    return {
      shouldUseNative: false,
      reason: `PDF size is ${sizeMB.toFixed(2)}MB, exceeds limit of ${PDF_MAX_SIZE_MB}MB`,
    };
  }

  return { shouldUseNative: true };
}

/**
 * Native PDF result type for passing PDF data to agent
 */
export interface NativePdfResult {
  useNative: boolean;
  base64Data?: string;
  pageCount?: number;
  reason?: string;
}

/**
 * Prepare PDF for native API usage
 * Returns base64 data if PDF is suitable for native API, otherwise returns reason for fallback
 */
export async function prepareNativePdf(
  buffer: Buffer,
): Promise<NativePdfResult> {
  try {
    const pageCount = await getPdfPageCount(buffer);
    const { shouldUseNative, reason } = shouldUseNativePdf(
      pageCount,
      buffer.length,
    );

    if (!shouldUseNative) {
      return {
        useNative: false,
        pageCount,
        reason,
      };
    }

    // Convert buffer to base64
    const base64Data = buffer.toString("base64");

    return {
      useNative: true,
      base64Data,
      pageCount,
    };
  } catch (error) {
    console.error("[prepareNativePdf] Error:", error);
    return {
      useNative: false,
      reason: `Failed to process PDF: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Content block types for OpenAI-compatible APIs (including Google/Gemini)
 */
export type OpenAIContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "document"; document: { url?: string; data?: string } };

/**
 * Create content blocks for OpenAI-compatible APIs with PDF support
 * Google/Gemini models support PDF via inlineData format
 */
export function createPdfContentBlockForOpenAI(base64Data: string): {
  type: "document";
  source: { mime_type: string; data: string };
} {
  // Google/Gemini uses document block with source containing inlineData
  return {
    type: "document",
    source: {
      mime_type: "application/pdf",
      data: base64Data,
    },
  };
}

/**
 * Check if a model supports native PDF document blocks
 * Currently supports: Google/Gemini models
 */
export function modelSupportsNativePdf(modelName: string): boolean {
  const lowerModel = modelName.toLowerCase();
  // Google/Gemini models support PDF via document blocks
  return lowerModel.includes("gemini") || lowerModel.includes("google");
}
