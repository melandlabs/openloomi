import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";

// Regression test for the screen-memory capture wiring.
// ScreenMemoryCaptureProvider is the ONLY place in the app that calls
// useScreenMemoryCapture, which registers the global capture shortcut on the
// Tauri side.

const useScreenMemoryCapture = vi.fn();
const useChroniclePreferences = vi.fn(() => ({ chronicleEnabled: true }));
const useMeetingRecording = vi.fn(() => ({
  isRecording: false,
  durationText: "",
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
}));

vi.mock("@/hooks/use-screen-memory", () => ({
  useScreenMemoryCapture: (...args: unknown[]) =>
    (useScreenMemoryCapture as unknown as (...a: unknown[]) => unknown)(
      ...args,
    ),
  useChroniclePreferences: () =>
    (useChroniclePreferences as unknown as () => unknown)(),
}));

vi.mock("@/hooks/use-meeting-recording", () => ({
  useMeetingRecording: (...args: unknown[]) =>
    (useMeetingRecording as unknown as (...a: unknown[]) => unknown)(...args),
}));

vi.mock("@/lib/chronicle/analysis-queue", () => ({
  chronicleMeetingAnalysisQueue: { enqueue: vi.fn() },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe("ScreenMemoryCaptureProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset explicitly: clearAllMocks does not undo mockReturnValue, so a
    // test overriding the preference would otherwise leak into later tests.
    useChroniclePreferences.mockReturnValue({ chronicleEnabled: true });
  });

  it("should register screen capture via useScreenMemoryCapture on render", async () => {
    const { ScreenMemoryCaptureProvider } =
      await import("@/components/chronicle/screen-memory-provider");

    renderToString(React.createElement(ScreenMemoryCaptureProvider));

    expect(useScreenMemoryCapture).toHaveBeenCalledTimes(1);
    expect(useScreenMemoryCapture).toHaveBeenCalledWith(
      expect.objectContaining({ onCaptured: expect.any(Function) }),
    );
    // Enablement is owned by the hook (chronicleEnabled preference); the
    // provider must not pass a redundant `enabled` flag.
    expect(useScreenMemoryCapture.mock.calls[0][0]).not.toHaveProperty(
      "enabled",
    );
  });

  it("should keep meeting recording wired alongside screen capture", async () => {
    const { ScreenMemoryCaptureProvider } =
      await import("@/components/chronicle/screen-memory-provider");

    renderToString(React.createElement(ScreenMemoryCaptureProvider));

    expect(useMeetingRecording).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    );
  });

  it("should log only capture metadata, never raw screen content", async () => {
    const { ScreenMemoryCaptureProvider } =
      await import("@/components/chronicle/screen-memory-provider");

    renderToString(React.createElement(ScreenMemoryCaptureProvider));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { onCaptured } = useScreenMemoryCapture.mock.calls[0][0];
      onCaptured({
        screenshotPath: "/tmp/capture.png",
        description: "RAW-SCREEN-DESCRIPTION possibly with credentials",
        keyContent: ["RAW-KEY-CONTENT-1", "RAW-KEY-CONTENT-2"],
      });

      const logged = JSON.stringify(logSpy.mock.calls);
      expect(logged).toContain("/tmp/capture.png");
      expect(logged).not.toContain("RAW-SCREEN-DESCRIPTION");
      expect(logged).not.toContain("RAW-KEY-CONTENT");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("should disable meeting recording when chronicle is disabled", async () => {
    useChroniclePreferences.mockReturnValue({ chronicleEnabled: false });
    const { ScreenMemoryCaptureProvider } =
      await import("@/components/chronicle/screen-memory-provider");

    renderToString(React.createElement(ScreenMemoryCaptureProvider));

    expect(useMeetingRecording).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });
});
