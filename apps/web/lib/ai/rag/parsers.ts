/**
 * RAG document parsers — app-side re-export layer.
 * Configures the @openloomi/rag/parsers package with app-specific dependencies.
 */

import { estimateTokens } from "@openloomi/ai";
import {
  PDF_MAX_PAGES,
  PDF_MAX_SIZE_MB,
  PREFER_NATIVE_PDF,
} from "@/lib/files/config";
import {
  configureParsers,
  // Re-export everything from package
  TextLoader,
  AppleDocumentLoader,
  parseFile,
  parseFileToDocument,
  getPdfPageCount,
  shouldUseNativePdf,
  isSupportedContentType,
  type FileContent,
} from "@openloomi/rag/parsers";

// Configure the package parsers with app-specific dependencies
configureParsers({
  estimateTokens,
  pdfMaxPages: PDF_MAX_PAGES,
  pdfMaxSizeMb: PDF_MAX_SIZE_MB,
  preferNativePdf: PREFER_NATIVE_PDF,
});

export {
  TextLoader,
  AppleDocumentLoader,
  parseFile,
  parseFileToDocument,
  getPdfPageCount,
  shouldUseNativePdf,
  isSupportedContentType,
};
export type { FileContent };
