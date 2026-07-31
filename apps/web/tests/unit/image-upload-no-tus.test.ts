/**
 * Regression tests for issue #380.
 *
 * The desktop app's image attachments previously failed because every image
 * upload followed `uploadFile()` with an extra POST to `/api/ai/v1/upload`
 * (TUS chunked upload) — that route does not exist, so the second call
 * returned 404 and the user saw "Image upload failed".
 *
 * The fix routes images through `/api/files/upload` only. Local URLs remain
 * UI/download references; images are converted to base64 when sent to agents.
 * These tests guard against re-introducing the broken call or URL-as-model-input
 * behavior.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Hoisted mocks — referenced inside vi.mock factories.
const uploadFileMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/lib/files/upload", () => ({
  uploadFile: uploadFileMock,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock("sonner", () => ({
  toast: toastMock,
}));

vi.mock("@/lib/files/apple-preview", () => ({
  isLikelyZipFile: vi.fn().mockResolvedValue(false),
}));

// React's useState is used inside the hook; provide a minimal mock so the
// hook module loads in the node test environment.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
    useState: <T>(initial: T) => [initial, vi.fn()] as const,
  };
});

// ---------------------------------------------------------------------------
// Source-level regression checks
// ---------------------------------------------------------------------------

describe("issue #380 source regressions", () => {
  function readSource(relativePath: string): string {
    return readFileSync(join(__dirname, "../..", relativePath), "utf-8");
  }

  it("use-attachment-upload.ts does not import the broken TUS module", () => {
    const source = readSource(
      "components/task-composer/use-attachment-upload.ts",
    );
    expect(source).not.toContain("@/lib/files/tus-upload");
    // No actual invocation: `await uploadImageTUS(` is the call pattern.
    expect(source).not.toMatch(/await\s+uploadImageTUS\s*\(/);
  });

  it("task-composer.tsx does not import the broken TUS module for screenshots", () => {
    const source = readSource("components/task-composer/task-composer.tsx");
    expect(source).not.toContain("@/lib/files/tus-upload");
    expect(source).not.toMatch(/await\s+uploadImageTUS\s*\(/);
  });

  it("multimodal-input.tsx does not import the broken TUS module for clipboard images", () => {
    const source = readSource("components/multimodal-input.tsx");
    expect(source).not.toContain("@/lib/files/tus-upload");
    expect(source).not.toMatch(/await\s+uploadImageTUS\s*\(/);
  });

  it("chat-context.tsx image processing loop no longer calls uploadImageTUS", () => {
    const source = readSource("components/chat-context.tsx");
    // The image-extraction block ends at `if (isImageFile(part.mediaType)) continue;`.
    // The TUS-only workspace block lives AFTER that line. Inside the image
    // block we should never see an actual `await uploadImageTUS(` invocation
    // (comments mentioning the name are fine — the call pattern is what matters).
    const imageBlock = source.split(
      "if (isImageFile(part.mediaType)) continue;",
    )[0];
    expect(imageBlock).toBeDefined();
    expect(imageBlock).not.toMatch(/await\s+uploadImageTUS\s*\(/);
  });

  it("chat-context.tsx resolves local image parts to base64-only agent inputs", () => {
    const source = readSource("components/chat-context.tsx");
    const start = source.indexOf("Extract image attachments");
    const end = source.indexOf("Handle all file attachments", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const imageBlock = source.slice(start, end);
    expect(source).toContain("type AgentImageDataInput");
    expect(source).toContain("url?: never");
    expect(source).toContain("const images: AgentImageDataInput[] = [];");
    expect(imageBlock).toContain("resolveImagePartToBase64");
    expect(imageBlock).not.toContain("serverImageTUSUrl");
    expect(imageBlock).not.toMatch(/images\.push\(\s*{\s*url:/s);
  });

  it("chat-context.tsx converts blobPath references through the local download endpoint", () => {
    const source = readSource("components/chat-context.tsx");
    expect(source).toContain("function localDownloadUrlFromBlobPath");
    expect(source).toContain("/api/files/download?path=");
    expect(source).toContain("localDownloadUrlFromBlobPath(part.blobPath)");
  });

  it("input surfaces no longer forward serverImageTUSUrl", () => {
    const files = [
      "components/task-composer/use-attachment-upload.ts",
      "components/task-composer/task-composer.tsx",
      "components/multimodal-input.tsx",
      "components/agent/chat-panel.tsx",
    ];

    for (const file of files) {
      expect(readSource(file)).not.toContain("serverImageTUSUrl");
    }
  });
});

// ---------------------------------------------------------------------------
// Behavior check: hook delegates to uploadFile and keeps URLs UI-only
// ---------------------------------------------------------------------------

describe("issue #380 behavior — image uploads skip /api/ai/v1/upload", () => {
  beforeEach(() => {
    uploadFileMock.mockReset();
    toastMock.error.mockReset();
    toastMock.success.mockReset();
    // Track every fetch call so we can assert /api/ai/v1/upload is never hit.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        return new Response("not-found", {
          status: url.includes("/api/ai/v1/upload") ? 404 : 200,
        });
      }),
    );
  });

  it("uploads the image exactly once via /api/files/upload without setting a model URL", async () => {
    const localUrl = "/api/files/download?path=user-1/img.png";
    uploadFileMock.mockResolvedValueOnce({
      url: localUrl,
      downloadUrl: localUrl,
      blobPath: "user-1/img.png",
      name: "img.png",
      sanitizedName: "img.png",
      contentType: "image/png",
      size: 1024,
    });

    // Import after mocks so the module picks them up.
    const { useAttachmentUpload } =
      await import("@/components/task-composer/use-attachment-upload");

    type CapturedAttachment = {
      name?: string;
      url?: string;
      downloadUrl?: string;
      blobPath?: string;
      isUploading?: boolean;
    };

    let capturedAttachments: CapturedAttachment[] = [];
    // The hook's `setAttachments` parameter is typed with the hook's internal
    // `UploadingAttachment` interface. We accept the looser shape because we
    // only inspect the fields we care about.
    const setAttachments = ((updater: unknown) => {
      capturedAttachments =
        typeof updater === "function"
          ? (updater as (prev: CapturedAttachment[]) => CapturedAttachment[])(
              capturedAttachments,
            )
          : (updater as CapturedAttachment[]);
    }) as unknown as Parameters<
      typeof useAttachmentUpload
    >[0]["setAttachments"];

    const hook = useAttachmentUpload({ setAttachments });
    expect(hook.handleFileUpload).toBeDefined();

    const file = new File(["fake-bytes"], "img.png", { type: "image/png" });
    await hook.handleFileUpload([file]);

    // Allow the queued `forEach(async ...)` to finish.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(uploadFileMock).toHaveBeenCalledTimes(1);
    const fetchMock = vi.mocked(globalThis.fetch);
    const calledUrls = fetchMock.mock.calls.map(([arg]) =>
      typeof arg === "string" ? arg : (arg as Request).url,
    );
    expect(calledUrls.some((url) => url.includes("/api/ai/v1/upload"))).toBe(
      false,
    );

    const finished = capturedAttachments.find(
      (a) =>
        a && typeof a === "object" && a.name === "img.png" && !a.isUploading,
    );
    expect(finished?.url).toBe(localUrl);
    expect(finished?.downloadUrl).toBe(localUrl);
    expect(finished?.blobPath).toBe("user-1/img.png");
    expect(finished).not.toHaveProperty("serverImageTUSUrl");
  });

  it("keeps the attachment when uploadFile returns only a blobPath", async () => {
    uploadFileMock.mockResolvedValueOnce({
      url: "",
      downloadUrl: "",
      blobPath: "user-1/img.png",
      name: "img.png",
      sanitizedName: "img.png",
      contentType: "image/png",
      size: 1024,
    });

    const { useAttachmentUpload } =
      await import("@/components/task-composer/use-attachment-upload");

    type CapturedAttachment = { name?: string; isUploading?: boolean };
    let capturedAttachments: CapturedAttachment[] = [];
    const setAttachments = ((updater: unknown) => {
      capturedAttachments =
        typeof updater === "function"
          ? (updater as (prev: CapturedAttachment[]) => CapturedAttachment[])(
              capturedAttachments,
            )
          : (updater as CapturedAttachment[]);
    }) as unknown as Parameters<
      typeof useAttachmentUpload
    >[0]["setAttachments"];

    const hook = useAttachmentUpload({ setAttachments });

    const file = new File(["fake-bytes"], "img.png", { type: "image/png" });
    await hook.handleFileUpload([file]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(toastMock.error).not.toHaveBeenCalled();
    const finished = capturedAttachments.find(
      (a) =>
        a && typeof a === "object" && a.name === "img.png" && !a.isUploading,
    );
    expect(finished).toMatchObject({
      url: "",
      downloadUrl: "",
      blobPath: "user-1/img.png",
    });
  });
});
