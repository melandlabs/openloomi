import { describe, expect, it } from "vitest";

import {
  sessionRelativePathFromStoredPath,
  workspaceFileReferenceFromStoredPath,
  workspaceSessionFileReferenceFromStoredPath,
} from "@/lib/files/open-workspace-file-locally";

describe("workspace file path references", () => {
  it("extracts the owning session from a stored macOS session path", () => {
    expect(
      workspaceSessionFileReferenceFromStoredPath(
        "/Users/alice/.openloomi/sessions/source-chat/reports/digest.md",
      ),
    ).toEqual({
      taskId: "source-chat",
      path: "reports/digest.md",
    });
  });

  it("extracts the owning session from a stored Windows session path", () => {
    expect(
      workspaceSessionFileReferenceFromStoredPath(
        String.raw`C:\Users\alice\.openloomi\sessions\source-chat\temp\digest.md`,
      ),
    ).toEqual({
      taskId: "source-chat",
      path: "temp/digest.md",
    });
  });

  it("keeps a cross-session artifact attached to its source session", () => {
    expect(
      workspaceFileReferenceFromStoredPath(
        "/Users/alice/.openloomi/sessions/source-chat/digest.md",
        "visible-chat",
      ),
    ).toEqual({
      taskId: "source-chat",
      path: "digest.md",
    });
  });

  it("falls back to the visible chat for ordinary relative paths", () => {
    expect(
      workspaceFileReferenceFromStoredPath("digest.md", "visible-chat"),
    ).toEqual({
      taskId: "visible-chat",
      path: "digest.md",
    });
  });

  it("still returns a session-relative path for same-session absolute paths", () => {
    expect(
      sessionRelativePathFromStoredPath(
        "/Users/alice/.openloomi/sessions/visible-chat/temp/digest.md",
        "visible-chat",
      ),
    ).toBe("temp/digest.md");
  });

  it("does not claim unrelated absolute paths belong to a workspace session", () => {
    expect(
      workspaceSessionFileReferenceFromStoredPath(
        "/Users/alice/Desktop/digest.md",
      ),
    ).toBeNull();
  });
});
