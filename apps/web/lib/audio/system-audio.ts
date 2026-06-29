/**
 * System audio capture and dual-stream merging utilities.
 *
 * ## Web path (Chrome/Edge)
 *
 * Uses `getDisplayMedia({ audio: true, video: true })` to capture system audio
 * (e.g., remote participants in an online meeting). The video track required by
 * the browser spec is stopped immediately. The system audio track is then merged
 * with the microphone stream via a Web Audio `AudioContext` so that `MediaRecorder`
 * receives a single combined stream.
 *
 * ## Tauri path (desktop app)
 *
 * Uses native Rust capture (ScreenCaptureKit on macOS, WASAPI loopback on Windows,
 * PulseAudio monitor on Linux) via `TauriAudioBridge`. Audio chunks are streamed
 * to the frontend via Tauri events and scheduled on an `AudioContext` timeline.
 *
 * ## Fallback
 *
 * If neither path is available, the caller should continue with microphone-only
 * recording.
 */

import { TauriAudioBridge } from "./tauri-audio-bridge";

/** Target sample rate for meeting recordings (mic + system audio merge). */
export const MEETING_AUDIO_SAMPLE_RATE = 48_000;

/** Microphone constraints aligned with {@link MEETING_AUDIO_SAMPLE_RATE}. */
export function getMeetingMicConstraints(): MediaTrackConstraints {
  return {
    sampleRate: { ideal: MEETING_AUDIO_SAMPLE_RATE },
    channelCount: { ideal: 1 },
    echoCancellation: true,
    noiseSuppression: true,
  };
}

/**
 * Detect whether we are running inside a Tauri desktop app.
 */
export function isTauriEnv(): boolean {
  return typeof window !== "undefined" && !!(window as any).__TAURI__;
}

/**
 * Check whether the browser supports `getDisplayMedia` (required for the web path).
 * Returns false on browsers like Firefox/Safari or Tauri WebView that lack this API.
 */
export function isDisplayMediaSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getDisplayMedia
  );
}

/**
 * Check whether system audio capture is possible (either via Tauri native or web API).
 */
export function canCaptureSystemAudio(): boolean {
  return isTauriEnv() || isDisplayMediaSupported();
}

export interface SystemAudioCaptureResult {
  /** MediaStream containing only the system audio track(s). */
  stream: MediaStream;
  /**
   * The original display stream — keep a reference so the caller can:
   *  - Listen for `onended` (user clicks browser "Stop sharing")
   *  - Stop all remaining tracks during cleanup
   */
  displayStream: MediaStream;
  /**
   * If capture was done via Tauri native bridge, this holds the bridge instance
   * so the caller can stop it during cleanup.
   */
  tauriBridge?: TauriAudioBridge;
  /** Native/system capture sample rate when known (Tauri path). */
  sampleRate?: number;
}

/**
 * Attempt to capture system audio.
 *
 * In Tauri: uses native Rust capture via `TauriAudioBridge`.
 * In browser: uses `getDisplayMedia`.
 *
 * @returns The captured system audio, or `null` when:
 *  - The API is not available (Firefox, Safari, Tauri WebView without native support, etc.)
 *  - The user cancels the picker (web path)
 *  - The user does not check "Share system audio" (web path)
 *  - Native capture fails (Tauri path)
 */
export async function captureSystemAudio(): Promise<SystemAudioCaptureResult | null> {
  // Tauri path: use native Rust capture
  if (isTauriEnv()) {
    return captureSystemAudioTauri();
  }

  // Web path: use getDisplayMedia
  return captureSystemAudioWeb();
}

export type SystemAudioCaptureErrorKind = "permission" | "capture";

export class SystemAudioCaptureError extends Error {
  readonly kind: SystemAudioCaptureErrorKind;

  constructor(message: string, kind: SystemAudioCaptureErrorKind = "capture") {
    super(message);
    this.name = "SystemAudioCaptureError";
    this.kind = kind;
  }
}

/**
 * Tauri path: capture system audio via native Rust bridge.
 */
async function captureSystemAudioTauri(): Promise<SystemAudioCaptureResult | null> {
  const bridge = new TauriAudioBridge();

  try {
    await bridge.start((msg) => {
      console.warn("[SystemAudio] Native capture error:", msg);
    });

    // Give the bridge a moment to receive the first chunk
    await new Promise((resolve) => setTimeout(resolve, 100));

    const stream = bridge.stream;
    if (!stream) {
      await bridge.stop();
      throw new SystemAudioCaptureError("System audio stream unavailable");
    }

    // Create a dummy "displayStream" for API compatibility.
    // In Tauri, there's no display stream to manage — cleanup is handled
    // by the bridge itself.
    const dummyDisplayStream = new MediaStream();

    return {
      stream,
      displayStream: dummyDisplayStream,
      tauriBridge: bridge,
      sampleRate: bridge.sampleRate ?? MEETING_AUDIO_SAMPLE_RATE,
    };
  } catch (error) {
    console.warn("[SystemAudio] Tauri capture failed:", error);
    await bridge.stop();
    if (error instanceof SystemAudioCaptureError) {
      throw error;
    }
    const message =
      error instanceof Error ? error.message : "System audio capture failed";
    throw new SystemAudioCaptureError(message);
  }
}

/**
 * Web path: capture system audio via `getDisplayMedia`.
 */
async function captureSystemAudioWeb(): Promise<SystemAudioCaptureResult | null> {
  if (!isDisplayMediaSupported()) {
    return null;
  }

  try {
    // `video: true` is required by the spec in most browsers;
    // we stop the video track immediately after obtaining the stream.
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });

    // Discard the video track — we only need audio.
    for (const track of displayStream.getVideoTracks()) {
      track.stop();
    }

    const audioTracks = displayStream.getAudioTracks();
    if (audioTracks.length === 0) {
      // User did not check "Share system audio" or the source has no audio.
      for (const track of displayStream.getTracks()) {
        track.stop();
      }
      return null;
    }

    const audioStream = new MediaStream(audioTracks);
    return { stream: audioStream, displayStream };
  } catch {
    // User cancelled the picker or an unexpected error occurred.
    return null;
  }
}

export interface MergedAudioResult {
  /** Combined MediaStream suitable for MediaRecorder. */
  stream: MediaStream;
  /** AudioContext that owns the graph — must be closed on recording stop. */
  audioContext: AudioContext;
}

/**
 * Merge a microphone stream and a system audio stream into a single
 * `MediaStream` via Web Audio `AudioContext`.
 *
 * Both sources are routed through `GainNode`s (unity gain) so that
 * levels can be adjusted later if needed.
 */
export class MeetingRecordingSetupError extends Error {
  constructor(
    message: string,
    public readonly code: "no_audio_source",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "MeetingRecordingSetupError";
  }
}

export interface MeetingRecordingSetup {
  recordingStream: MediaStream;
  /** Raw system stream when captured (for onended handlers). */
  systemAudioStream: MediaStream | null;
  audioContext: AudioContext | null;
  displayStream: MediaStream;
  tauriBridge: TauriAudioBridge | null;
  hasMic: boolean;
  hasSystemAudio: boolean;
  /** True when microphone getUserMedia failed due to permission denial. */
  micPermissionDenied: boolean;
}

export interface PrepareMeetingRecordingOptions {
  /** Called before attempting web `getDisplayMedia` (not used on Tauri). */
  onSystemAudioPrePrompt?: () => void;
  /**
   * When true, permissions were already checked/requested by the caller
   * (e.g. SystemAudioPermissionGuide). Skips consent prompts and retries
   * capture while TCC / Core Audio settle after a fresh grant.
   */
  permissionsVerified?: boolean;
}

const SYSTEM_AUDIO_CAPTURE_RETRY_DELAYS_MS = [300, 600, 1200];
/** Wait after a fresh TCC grant before probing mic / system audio capture. */
const PERMISSION_SETTLE_DELAY_MS = 400;

async function captureSystemAudioWithRetry(options?: {
  afterPermissionGrant?: boolean;
}): Promise<SystemAudioCaptureResult | null> {
  const delays = options?.afterPermissionGrant
    ? SYSTEM_AUDIO_CAPTURE_RETRY_DELAYS_MS
    : [150, 400];
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, delays[attempt - 1] ?? 500),
      );
    }

    try {
      const result = await captureSystemAudio();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
      if (
        error instanceof SystemAudioCaptureError &&
        error.kind === "permission"
      ) {
        throw error;
      }
    }
  }

  if (lastError instanceof SystemAudioCaptureError) {
    throw lastError;
  }
  return null;
}

/**
 * Acquire microphone and/or system audio for meeting recording.
 *
 * Microphone is optional — when unavailable, recording continues with system
 * audio alone (Tauri ScreenCaptureKit / WASAPI loopback, or browser share).
 */
export async function prepareMeetingRecordingStream(
  options?: PrepareMeetingRecordingOptions,
): Promise<MeetingRecordingSetup> {
  if (options?.permissionsVerified && isTauriEnv()) {
    // TCC may report granted before Core Audio / ScreenCaptureKit is ready.
    await new Promise((resolve) =>
      setTimeout(resolve, PERMISSION_SETTLE_DELAY_MS),
    );
  }

  let micStream: MediaStream | null = null;
  let micPermissionDenied = false;

  if (
    typeof navigator !== "undefined" &&
    navigator.mediaDevices?.getUserMedia
  ) {
    // In Tauri, request microphone permission before calling getUserMedia.
    // This ensures the TCC dialog appears on first launch. If the user denies,
    // we detect that via getUserMedia's NotAllowedError below.
    if (isTauriEnv()) {
      const { isMicrophoneGranted, requestMicrophoneAccess } =
        await import("@/lib/permissions/service");
      let granted = await isMicrophoneGranted(true);
      if (!granted) {
        // Request will show the TCC dialog when status is NotDetermined.
        const requested = await requestMicrophoneAccess();
        // Re-check after the dialog.
        granted = requested || (await isMicrophoneGranted(true));
      }
      if (!granted) {
        micPermissionDenied = true;
      }
    }

    if (!micPermissionDenied) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: getMeetingMicConstraints(),
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          micPermissionDenied = true;
        }
        console.warn("[MeetingRecording] Microphone unavailable:", error);
      }
    }
  }

  const canCaptureSystem = canCaptureSystemAudio();
  let systemCapture: SystemAudioCaptureResult | null = null;
  let systemCaptureError: unknown = null;

  if (canCaptureSystem) {
    let systemAudioPermissionGranted = true;
    if (isTauriEnv()) {
      const { isSystemAudioGranted, requestSystemAudioAccess } =
        await import("@/lib/permissions/service");
      systemAudioPermissionGranted = await isSystemAudioGranted(true);
      if (!systemAudioPermissionGranted) {
        // Request will show the TCC dialog when status is NotDetermined.
        const requested = await requestSystemAudioAccess();
        // Re-check after the dialog.
        systemAudioPermissionGranted =
          requested || (await isSystemAudioGranted(true));
      }
    } else {
      options?.onSystemAudioPrePrompt?.();
    }

    if (systemAudioPermissionGranted) {
      try {
        systemCapture = await captureSystemAudioWithRetry({
          afterPermissionGrant: options?.permissionsVerified,
        });
      } catch (error) {
        systemCaptureError = error;
        console.warn("[MeetingRecording] System audio capture failed:", error);
      }
    }
  }

  if (!micStream && !systemCapture) {
    const detail =
      systemCaptureError instanceof SystemAudioCaptureError
        ? systemCaptureError.message
        : "No microphone or system audio source available";
    throw new MeetingRecordingSetupError(detail, "no_audio_source", {
      cause: systemCaptureError,
    });
  } else if (!micStream && systemCapture) {
    return {
      recordingStream: systemCapture.stream,
      systemAudioStream: systemCapture.stream,
      audioContext: null,
      displayStream: systemCapture.displayStream,
      tauriBridge: systemCapture.tauriBridge ?? null,
      hasMic: false,
      hasSystemAudio: true,
      micPermissionDenied,
    };
  } else if (micStream && !systemCapture) {
    return {
      recordingStream: micStream,
      systemAudioStream: null,
      audioContext: null,
      displayStream: new MediaStream(),
      tauriBridge: null,
      hasMic: true,
      hasSystemAudio: false,
      micPermissionDenied: false,
    };
  }

  // After exhaustive if/else-if checks, both are guaranteed non-null.
  // TypeScript cannot narrow mutable let vars through await; use type assertion.
  const mic = micStream as MediaStream;
  const sys = systemCapture as SystemAudioCaptureResult;
  const merged = mergeAudioStreams(
    mic,
    sys.stream,
    sys.sampleRate ?? MEETING_AUDIO_SAMPLE_RATE,
  );

  return {
    recordingStream: merged.stream,
    systemAudioStream: sys.stream,
    audioContext: merged.audioContext,
    displayStream: sys.displayStream,
    tauriBridge: sys.tauriBridge ?? null,
    hasMic: true,
    hasSystemAudio: true,
    micPermissionDenied: false,
  };
}

export function mergeAudioStreams(
  micStream: MediaStream,
  systemStream: MediaStream,
  sampleRate: number = MEETING_AUDIO_SAMPLE_RATE,
): MergedAudioResult {
  const AudioContextCtor =
    typeof window !== "undefined"
      ? window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      : undefined;

  if (!AudioContextCtor) {
    throw new Error("AudioContext not available");
  }

  const ctx = new AudioContextCtor({ sampleRate });
  void ctx.resume();

  const micSource = ctx.createMediaStreamSource(micStream);
  const sysSource = ctx.createMediaStreamSource(systemStream);

  const micGain = ctx.createGain();
  micGain.gain.value = 1.0;
  const sysGain = ctx.createGain();
  sysGain.gain.value = 1.0;

  const destination = ctx.createMediaStreamDestination();

  micSource.connect(micGain).connect(destination);
  sysSource.connect(sysGain).connect(destination);

  return { stream: destination.stream, audioContext: ctx };
}

/** Toast copy when mic works but system audio capture did not start. */
export function getSystemAudioPartialFailureMessage(
  t: (key: string) => string,
): string {
  return isTauriEnv()
    ? t("chronicle.meeting.systemAudioCaptureUnavailable")
    : t("chronicle.meeting.systemAudioFallback");
}

/** User-facing message when starting a meeting recording fails. */
export function getMeetingRecordingStartErrorMessage(
  error: unknown,
  t: (key: string) => string,
): string {
  if (error instanceof MeetingRecordingSetupError) {
    const cause = error.cause;
    if (
      cause instanceof SystemAudioCaptureError &&
      cause.kind === "permission"
    ) {
      return t("chronicle.meeting.systemAudioCaptureFailed");
    }
    return t("chronicle.meeting.noAudioSource");
  }
  if (error instanceof SystemAudioCaptureError) {
    return error.kind === "permission"
      ? t("chronicle.meeting.systemAudioCaptureFailed")
      : t("chronicle.meeting.systemAudioCaptureUnavailable");
  }
  return t("chronicle.meeting.recordFailed");
}
