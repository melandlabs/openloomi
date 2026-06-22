/**
 * File type config unit tests.
 *
 * Covers the .tsv and .tgz formats added to FILE_TYPE_CONFIG so the
 * MIME/extension lookups, attachment allowlist, and supported-extension
 * list stay in sync.
 */
import { describe, test, expect } from "vitest";

import {
  FILE_TYPE_CONFIG,
  SUPPORTED_ATTACHMENT_MIME_TYPES,
  SUPPORTED_FILE_EXTENSIONS,
  getMimeTypeFromExtension,
  getExtensionsFromMimeType,
} from "@/lib/files/config";
import {
  getLibraryFileIconSrc,
  getUploadFileIconSrc,
} from "@/components/file/file-icon-src";

describe("FILE_TYPE_CONFIG tsv/tgz support", () => {
  test("declares tsv with the tab-separated MIME type", () => {
    expect(FILE_TYPE_CONFIG.tsv).toEqual({
      mime: "text/tab-separated-values",
      extensions: [".tsv"],
      label: "TSV",
    });
  });

  test("declares tgz mapped to gzip", () => {
    expect(FILE_TYPE_CONFIG.tgz).toEqual({
      mime: "application/gzip",
      extensions: [".tgz"],
      label: "TGZ",
    });
  });

  test("resolves MIME types from the new extensions", () => {
    expect(getMimeTypeFromExtension(".tsv")).toBe("text/tab-separated-values");
    expect(getMimeTypeFromExtension("tsv")).toBe("text/tab-separated-values");
    // .tgz shares the gzip MIME with .gz; both extensions resolve to it.
    expect(getMimeTypeFromExtension(".tgz")).toBe("application/gzip");
  });

  test("maps the tab-separated MIME back to its extension", () => {
    expect(getExtensionsFromMimeType("text/tab-separated-values")).toEqual([
      ".tsv",
    ]);
  });

  test("includes the new extensions in the supported list", () => {
    expect(SUPPORTED_FILE_EXTENSIONS).toContain(".tsv");
    expect(SUPPORTED_FILE_EXTENSIONS).toContain(".tgz");
  });

  test("allows tab-separated uploads as attachments", () => {
    expect(SUPPORTED_ATTACHMENT_MIME_TYPES).toContain(
      "text/tab-separated-values",
    );
    // gzip is already permitted, which also covers .tgz uploads.
    expect(SUPPORTED_ATTACHMENT_MIME_TYPES).toContain("application/gzip");
  });
});

describe("file icon resolution for tsv/tgz", () => {
  test("library icons reuse spreadsheet/archive artwork", () => {
    expect(getLibraryFileIconSrc(".tsv")).toBe("/images/file/csv.svg");
    expect(getLibraryFileIconSrc("tgz")).toBe("/images/file/zip.svg");
  });

  test("upload icons reuse excel/zip artwork by extension", () => {
    expect(getUploadFileIconSrc(".tsv")).toBe(
      "/images/file/upload/icon_excel.svg",
    );
    expect(getUploadFileIconSrc("tgz")).toBe(
      "/images/file/upload/icon_zip.svg",
    );
  });

  test("upload icons resolve the tab-separated MIME type", () => {
    expect(getUploadFileIconSrc("text/tab-separated-values")).toBe(
      "/images/file/upload/icon_excel.svg",
    );
  });
});
