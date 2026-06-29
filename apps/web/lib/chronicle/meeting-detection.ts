/**
 * Chronicle Meeting Detection
 *
 * Provides two modes for detecting meeting start:
 * 1. Microphone Volume Detection - monitors mic input and auto-starts when
 *    continuous speech is detected for a configurable duration
 * 2. Manual Marking - user explicitly marks "I'm starting a meeting"
 *
 * This module is designed to be imported and used by the screen memory provider
 * or other components that need meeting recording capabilities.
 */

import { isTauri } from "@/lib/tauri";

// ─── Types ────────────────────────────────────────────────────────────────

export interface MeetingDetectionConfig {
  /** Minimum consecutive seconds of voice activity before triggering auto-start */
  voiceActivityThresholdSeconds?: number;
  /** RMS threshold for voice activity detection */
  voiceActivityRmsThreshold?: number;
  /** Whether to enable auto-detection mode */
  autoDetectionEnabled?: boolean;
}

export interface MeetingDetectionCallbacks {
  onMeetingStart?: (meetingId: string) => void;
  onMeetingEnd?: (meetingId: string) => void;
  onVoiceActivityDetected?: (level: number) => void;
  onError?: (error: string) => void;
}

const DEFAULT_CONFIG: Required<MeetingDetectionConfig> = {
  voiceActivityThresholdSeconds: 5,
  voiceActivityRmsThreshold: 0.08,
  autoDetectionEnabled: false, // Disabled by default, manual mode only
};

// ─── State ────────────────────────────────────────────────────────────────

let isDetecting = false;
let detectionInterval: ReturnType<typeof setInterval> | null = null;
let consecutiveVoiceSeconds = 0;
let currentMeetingId: string | null = null;

// ─── Microphone Monitoring ─────────────────────────────────────────────────

/**
 * Start monitoring microphone for voice activity.
 * When continuous voice is detected for threshold seconds, triggers auto-start.
 */
export async function startMeetingDetection(
  config: MeetingDetectionConfig = {},
  callbacks: MeetingDetectionCallbacks = {},
): Promise<boolean> {
  if (isDetecting) {
    console.log("[MeetingDetection] Already detecting");
    return true;
  }

  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  if (!mergedConfig.autoDetectionEnabled) {
    console.log(
      "[MeetingDetection] Auto-detection disabled, skipping monitor start",
    );
    return true;
  }

  // In Tauri, request microphone permission before calling getUserMedia.
  if (isTauri()) {
    const { isMicrophoneGranted, requestMicrophoneAccess } =
      await import("@/lib/permissions/service");
    const granted = await isMicrophoneGranted(true);
    if (!granted) {
      await requestMicrophoneAccess();
    }
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.75;

    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.fftSize);
    const rmsThreshold = mergedConfig.voiceActivityRmsThreshold;
    const thresholdFrames = mergedConfig.voiceActivityThresholdSeconds * 10; // ~10 frames/sec

    consecutiveVoiceSeconds = 0;
    let lastVoiceFrameTime = Date.now();

    isDetecting = true;

    detectionInterval = setInterval(() => {
      if (!isDetecting) return;

      analyser.getByteTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const normalized = (dataArray[i] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      const level = Math.min(rms * 3.5, 1);

      callbacks.onVoiceActivityDetected?.(level);

      if (rms >= rmsThreshold) {
        const now = Date.now();
        if (now - lastVoiceFrameTime < 200) {
          // Frames are close together, count as continuous
          consecutiveVoiceSeconds += 0.1;
        } else {
          // Gap too large, reset
          consecutiveVoiceSeconds = 0;
        }
        lastVoiceFrameTime = now;

        if (
          consecutiveVoiceSeconds >= mergedConfig.voiceActivityThresholdSeconds
        ) {
          // Trigger auto-start
          const meetingId = crypto.randomUUID();
          currentMeetingId = meetingId;
          console.log(
            `[MeetingDetection] Voice activity threshold reached (${consecutiveVoiceSeconds.toFixed(1)}s), starting meeting:`,
            meetingId,
          );
          callbacks.onMeetingStart?.(meetingId);

          // Reset for next detection
          consecutiveVoiceSeconds = 0;
        }
      } else {
        consecutiveVoiceSeconds = Math.max(0, consecutiveVoiceSeconds - 0.1);
      }
    }, 100);

    // Store stream reference to prevent garbage collection
    (
      globalThis as typeof globalThis & {
        __meetingDetectionStream?: MediaStream;
      }
    ).__meetingDetectionStream = stream;

    console.log("[MeetingDetection] Started monitoring microphone");
    return true;
  } catch (error) {
    console.error("[MeetingDetection] Failed to start:", error);
    callbacks.onError?.(
      error instanceof Error ? error.message : "Failed to access microphone",
    );
    return false;
  }
}

/**
 * Stop monitoring microphone.
 */
export function stopMeetingDetection(): void {
  if (detectionInterval) {
    clearInterval(detectionInterval);
    detectionInterval = null;
  }

  const stream = (
    globalThis as typeof globalThis & { __meetingDetectionStream?: MediaStream }
  ).__meetingDetectionStream;
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    (
      globalThis as typeof globalThis & {
        __meetingDetectionStream?: MediaStream;
      }
    ).__meetingDetectionStream = undefined;
  }

  isDetecting = false;
  consecutiveVoiceSeconds = 0;
  console.log("[MeetingDetection] Stopped monitoring");
}

/**
 * Check if meeting detection is currently active.
 */
export function isMeetingDetectionActive(): boolean {
  return isDetecting;
}

/**
 * Get the current active meeting ID, if any.
 */
export function getCurrentMeetingId(): string | null {
  return currentMeetingId;
}

// ─── Manual Meeting Marking ────────────────────────────────────────────────

/**
 * Manually mark the start of a meeting.
 * Returns a unique meeting ID that should be used when stopping.
 */
export function markMeetingStart(): string {
  const meetingId = crypto.randomUUID();
  currentMeetingId = meetingId;
  console.log("[MeetingDetection] Manual meeting start:", meetingId);
  return meetingId;
}

/**
 * Mark the end of the current meeting.
 * Returns the meeting ID that was ended, or null if no meeting was active.
 */
export function markMeetingEnd(): string | null {
  const meetingId = currentMeetingId;
  if (meetingId) {
    console.log("[MeetingDetection] Meeting ended:", meetingId);
    currentMeetingId = null;
    return meetingId;
  }
  return null;
}
