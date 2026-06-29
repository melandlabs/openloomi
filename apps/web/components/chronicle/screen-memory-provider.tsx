"use client";

import {
  useChroniclePreferences,
  useScreenMemoryCapture,
} from "@/hooks/use-screen-memory";
import { useMeetingRecording } from "@/hooks/use-meeting-recording";
import { chronicleMeetingAnalysisQueue } from "@/lib/chronicle/analysis-queue";
import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Global screen memory capture component
 *
 * This component wires the global screen-capture shortcut (default Enter).
 * The actual key comes from user preferences; Tauri listens via device_query.
 * It should be placed at the app root level to ensure it's always active
 * when the user is logged in.
 *
 * Features:
 * - Listens for the configured global shortcut (default Enter)
 * - Checks if Chronicle is enabled before capturing
 * - Captures screen, analyzes with AI, and saves as memory
 * - 5-second debounce to prevent spam
 * - Meeting recording integration for Chronicle
 */
export function ScreenMemoryCaptureProvider() {
  const { chronicleEnabled } = useChroniclePreferences();

  // Screen capture via global shortcut. Registers the Tauri shortcut and
  // event listener; this is the only registration entry in the app.
  // Enablement is decided inside the hook (chronicleEnabled preference),
  // so no `enabled` is passed here. Log metadata only — description and
  // keyContent are AI-extracted screen content and may be sensitive.
  useScreenMemoryCapture({
    onCaptured: (memory) => {
      console.log("[ScreenMemory] Memory captured:", {
        path: memory.screenshotPath,
        descriptionLength: memory.description.length,
        keyContentCount: memory.keyContent.length,
      });
    },
  });

  // Meeting recording integration
  const handleRecordingComplete = async (result: {
    meetingId: string;
    audioPath: string;
    durationSeconds: number;
    startedAt: Date;
    endedAt: Date;
  }) => {
    console.log("[ScreenMemory] Meeting recording complete:", {
      meetingId: result.meetingId,
      duration: result.durationSeconds,
      audioPath: result.audioPath,
    });

    // Enqueue the meeting for analysis
    const { getAuthToken } = await import("@/lib/auth/token-manager");
    const cloudAuthToken = getAuthToken() || undefined;

    chronicleMeetingAnalysisQueue.enqueue(
      {
        id: result.meetingId,
        audioPath: result.audioPath,
        meetingStartTime: result.startedAt.toISOString(),
        meetingEndTime: result.endedAt.toISOString(),
        durationSeconds: result.durationSeconds,
        cloudAuthToken,
      },
      (analysisResult) => {
        console.log("[ScreenMemory] Meeting analysis complete:", {
          meetingId: result.meetingId,
          summary: analysisResult.summary.slice(0, 100),
          keyPoints: analysisResult.keyPoints.length,
          actionItems: analysisResult.actionItems.length,
        });
        toast.success("Meeting summary ready", {
          description: analysisResult.summary.slice(0, 100),
        });
      },
    );
  };

  const handleRecordingError = (error: string) => {
    console.error("[ScreenMemory] Meeting recording error:", error);
    toast.error("Meeting recording failed", { description: error });
  };

  const { isRecording, durationText, startRecording, stopRecording } =
    useMeetingRecording({
      enabled: chronicleEnabled,
      onRecordingComplete: handleRecordingComplete,
      onError: handleRecordingError,
    });

  // Log when component mounts
  useEffect(() => {
    console.log("[ScreenMemory] Provider mounted, capture function ready");
  }, []);

  // This component doesn't render anything
  return null;
}
