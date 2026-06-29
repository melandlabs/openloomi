"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { fetchWithAuth } from "@/lib/utils";
import { v4 as uuidv4 } from "uuid";
import {
  formatVoiceDuration,
  MAX_WAVEFORM_SAMPLES,
  VOICE_SILENCE_TIMEOUT_MS,
  type VoiceInputPhase,
  type WaveformSample,
} from "@/lib/audio/voice-input";

/**
 * Detect if running in Tauri environment
 */
const isTauriEnv = typeof window !== "undefined" && "__TAURI__" in window;

function getSupportedAudioMimeType(): string {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

const DEFAULT_AUDIO_TRANSCRIPTION_MODEL = "gemini-2.5-flash-lite";
const VOICE_ACTIVITY_THRESHOLD = 0.12;
const MIN_VOICE_ACTIVITY_FRAMES = 4;
const MAX_MEETING_UPLOAD_BYTES = 500 * 1024 * 1024; // 500MB for meetings

/** Convert AudioBuffer to WAV Blob */
function audioBufferToWav(buffer: AudioBuffer): Blob {
  if (buffer.length === 0) {
    return new Blob([], { type: "audio/wav" });
  }

  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = buffer.length * numChannels * bytesPerSample;
  const bufferLength = 44 + dataLength;
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);

  const offset = 44;
  const channels: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  let index = 0;
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, channels[channel][i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset + index, intSample, true);
      index += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

/** Convert webm/opus Blob to WAV Blob using Web Audio API */
async function convertWebmToWav(webmBlob: Blob): Promise<Blob> {
  const arrayBuffer = await webmBlob.arrayBuffer();
  const audioContext = new AudioContext();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return audioBufferToWav(audioBuffer);
  } finally {
    await audioContext.close();
  }
}

export interface MeetingRecordingResult {
  meetingId: string;
  audioPath: string;
  durationSeconds: number;
  startedAt: Date;
  endedAt: Date;
}

export interface UseMeetingRecordingOptions {
  /** Called when recording completes and audio is uploaded */
  onRecordingComplete?: (result: MeetingRecordingResult) => void;
  /** Called on error */
  onError?: (error: string) => void;
  /** Whether recording is enabled */
  enabled?: boolean;
  /** Meeting title (optional) */
  meetingTitle?: string;
}

export interface UseMeetingRecordingReturn {
  phase: VoiceInputPhase;
  isRecording: boolean;
  audioLevel: number;
  waveformSamples: WaveformSample[];
  durationSeconds: number;
  durationText: string;
  canStop: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
}

/**
 * Hook for meeting audio recording.
 * Records audio from microphone, uploads to server, and triggers analysis.
 *
 * Key features:
 * - Long-duration recording for meetings
 * - Voice activity detection for auto-start option
 * - Automatic silence detection to stop recording
 * - WAV conversion for transcription compatibility
 * - Background upload to server
 */
export function useMeetingRecording(
  options: UseMeetingRecordingOptions = {},
): UseMeetingRecordingReturn {
  const {
    onRecordingComplete,
    onError,
    enabled = true,
    meetingTitle,
  } = options;
  const { t } = useTranslation();

  const [phase, setPhase] = useState<VoiceInputPhase>("idle");
  const [audioLevel, setAudioLevel] = useState(0);
  const [waveformSamples, setWaveformSamples] = useState<WaveformSample[]>([]);
  const [durationSeconds, setDurationSeconds] = useState(0);

  const phaseRef = useRef<VoiceInputPhase>("idle");
  const recordingStartedAtRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioRafRef = useRef<number | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const meetingIdRef = useRef<string | null>(null);
  const hasDetectedSpeechRef = useRef(false);
  const voiceActivityFramesRef = useRef(0);
  const lastVoiceActivityAtRef = useRef<number | null>(null);
  const silenceStopInFlightRef = useRef(false);

  // Use refs for callbacks
  const onRecordingCompleteRef = useRef(onRecordingComplete);
  onRecordingCompleteRef.current = onRecordingComplete;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const isStartingRef = useRef(false);
  const isCancelledRef = useRef(false);

  const resetVisualState = useCallback(() => {
    setAudioLevel(0);
    setWaveformSamples([]);
    setDurationSeconds(0);
    recordingStartedAtRef.current = null;
  }, []);

  const setPhaseState = useCallback((nextPhase: VoiceInputPhase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  const resetVoiceActivityState = useCallback(() => {
    hasDetectedSpeechRef.current = false;
    voiceActivityFramesRef.current = 0;
    lastVoiceActivityAtRef.current = null;
    silenceStopInFlightRef.current = false;
  }, []);

  const syncDurationFromStart = useCallback(() => {
    const startedAt = recordingStartedAtRef.current;
    if (startedAt == null) {
      setDurationSeconds(0);
      return;
    }
    const elapsedSeconds = Math.max(
      0,
      Math.floor((Date.now() - startedAt) / 1000),
    );
    setDurationSeconds(elapsedSeconds);
  }, []);

  const stopDurationTimer = useCallback(() => {
    syncDurationFromStart();
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  }, [syncDurationFromStart]);

  const stopAudioStreamTracks = useCallback(() => {
    if (!mediaStreamRef.current) return;
    for (const track of mediaStreamRef.current.getTracks()) {
      track.stop();
    }
    mediaStreamRef.current = null;
  }, []);

  const stopAudioLevelMonitor = useCallback(() => {
    if (audioRafRef.current !== null) {
      cancelAnimationFrame(audioRafRef.current);
      audioRafRef.current = null;
    }
    mediaStreamSourceRef.current?.disconnect();
    mediaStreamSourceRef.current = null;
    analyserRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setAudioLevel(0);
  }, []);

  const stopRecorder = useCallback(
    async (mode: "stop" | "cancel"): Promise<Blob | null> => {
      const recorder = mediaRecorderRef.current;
      if (!recorder) return null;

      stopDurationTimer();
      return await new Promise<Blob | null>((resolve) => {
        recorder.onstop = async () => {
          if (isCancelledRef.current) {
            resolve(null);
            return;
          }

          const audioBlob = new Blob(audioChunksRef.current, {
            type: recorder.mimeType || "audio/webm",
          });
          audioChunksRef.current = [];
          mediaRecorderRef.current = null;
          resolve(mode === "stop" ? audioBlob : null);
        };
        if (recorder.state === "recording") {
          try {
            recorder.requestData();
          } catch {
            // Keep stop flow if browser does not support requestData
          }
        }
        recorder.stop();
      });
    },
    [stopDurationTimer],
  );

  const uploadAndProcessAudio = useCallback(
    async (
      audioBlob: Blob,
      duration: number,
      startedAt: number | null,
      title?: string,
    ) => {
      if (!audioBlob.size) {
        onErrorRef.current?.("No audio captured");
        return;
      }

      if (audioBlob.size > MAX_MEETING_UPLOAD_BYTES) {
        onErrorRef.current?.(
          t(
            "chronicle.meeting.audioTooLarge",
            "Recording is too large. Please keep it under 500MB.",
          ),
        );
        return;
      }

      try {
        const wavBlob = await convertWebmToWav(audioBlob);
        const extension = "wav";
        const file = new File([wavBlob], `meeting_${Date.now()}.${extension}`, {
          type: "audio/wav",
        });

        const formData = new FormData();
        formData.append("file", file);
        formData.append("duration", String(duration));
        if (title) {
          formData.append("title", title);
        }

        const meetingId = uuidv4();
        meetingIdRef.current = meetingId;

        const response = await fetchWithAuth("/api/chronicle/meeting-audio", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          throw new Error(`Upload failed: ${response.status} ${errText}`);
        }

        const { path: audioPath } = (await response.json()) as {
          path: string;
        };

        const result: MeetingRecordingResult = {
          meetingId,
          audioPath,
          durationSeconds: duration,
          startedAt: new Date(startedAt ?? Date.now()),
          endedAt: new Date(),
        };

        onRecordingCompleteRef.current?.(result);
      } catch (error) {
        console.error("[MeetingRecording] Upload failed:", error);
        onErrorRef.current?.(
          error instanceof Error ? error.message : "Upload failed",
        );
      }
    },
    [t],
  );

  const handleSilenceTimeout = useCallback(async () => {
    if (silenceStopInFlightRef.current || phaseRef.current !== "recording") {
      return;
    }
    silenceStopInFlightRef.current = true;
    const duration = durationSeconds;
    const startedAt = recordingStartedAtRef.current;
    const title = meetingTitle;
    meetingIdRef.current = null;
    setPhaseState("idle");
    const audioBlob = await stopRecorder("stop");
    stopAudioLevelMonitor();
    stopAudioStreamTracks();
    resetVisualState();
    resetVoiceActivityState();

    if (audioBlob && hasDetectedSpeechRef.current) {
      toast.success(
        t(
          "chronicle.meeting.silenceDetected",
          "Silence detected, recording stopped",
        ),
      );
      void uploadAndProcessAudio(audioBlob, duration, startedAt, title);
    }
  }, [
    durationSeconds,
    meetingTitle,
    resetVisualState,
    resetVoiceActivityState,
    setPhaseState,
    stopRecorder,
    stopAudioLevelMonitor,
    stopAudioStreamTracks,
    uploadAndProcessAudio,
    t,
  ]);

  const startAudioLevelMonitor = useCallback(
    (stream: MediaStream) => {
      if (typeof window === "undefined") return;
      stopAudioLevelMonitor();

      const AudioContextCtor =
        window.AudioContext ||
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;
      if (!AudioContextCtor) return;

      const context = new AudioContextCtor();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.75;
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);

      audioContextRef.current = context;
      analyserRef.current = analyser;
      mediaStreamSourceRef.current = source;

      const dataArray = new Uint8Array(analyser.fftSize);
      const tick = () => {
        const currentAnalyser = analyserRef.current;
        if (!currentAnalyser) return;
        currentAnalyser.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const normalized = (dataArray[i] - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const normalized = Math.min(rms * 3.5, 1);
        const now = Date.now();

        if (normalized >= VOICE_ACTIVITY_THRESHOLD) {
          voiceActivityFramesRef.current += 1;
          if (voiceActivityFramesRef.current >= MIN_VOICE_ACTIVITY_FRAMES) {
            hasDetectedSpeechRef.current = true;
            lastVoiceActivityAtRef.current = now;
          }
        } else {
          voiceActivityFramesRef.current = 0;
        }

        setAudioLevel((prev) => prev * 0.6 + normalized * 0.4);
        setWaveformSamples((prev) => {
          const next = [...prev, normalized];
          return next.length > MAX_WAVEFORM_SAMPLES
            ? next.slice(next.length - MAX_WAVEFORM_SAMPLES)
            : next;
        });

        if (
          phaseRef.current === "recording" &&
          !silenceStopInFlightRef.current &&
          lastVoiceActivityAtRef.current !== null &&
          now - lastVoiceActivityAtRef.current >= VOICE_SILENCE_TIMEOUT_MS
        ) {
          void handleSilenceTimeout();
          return;
        }

        audioRafRef.current = requestAnimationFrame(tick);
      };
      tick();
    },
    [handleSilenceTimeout, stopAudioLevelMonitor],
  );

  const startRecording = useCallback(async () => {
    if (phase !== "idle" || !enabled) return;
    if (isStartingRef.current) return;
    isStartingRef.current = true;

    if (
      typeof window === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      isStartingRef.current = false;
      toast.error(
        t(
          "chronicle.meeting.audioNotSupported",
          "Current environment does not support audio recording",
        ),
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];

      const mimeType = getSupportedAudioMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        stopDurationTimer();
        setPhaseState("idle");
        audioChunksRef.current = [];
        stopAudioLevelMonitor();
        stopAudioStreamTracks();
        resetVisualState();
        resetVoiceActivityState();
        toast.error(
          t(
            "chronicle.meeting.recordFailed",
            "Audio recording failed, please retry",
          ),
        );
      };

      mediaRecorderRef.current = recorder;
      recorder.start(1000); // Chunk every second for meetings
      startAudioLevelMonitor(stream);
      resetVoiceActivityState();
      recordingStartedAtRef.current = Date.now();
      lastVoiceActivityAtRef.current = Date.now();
      setWaveformSamples([]);
      syncDurationFromStart();

      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
      durationIntervalRef.current = setInterval(() => {
        syncDurationFromStart();
      }, 250);

      meetingIdRef.current = uuidv4();
      setPhaseState("recording");

      console.log(
        "[MeetingRecording] Started recording, meetingId:",
        meetingIdRef.current,
      );
    } catch (error) {
      console.error("Failed to start meeting recording:", error);
      stopAudioLevelMonitor();
      stopAudioStreamTracks();
      resetVoiceActivityState();
      toast.error(
        t(
          "chronicle.meeting.permissionDenied",
          "Microphone permission denied, please enable and retry",
        ),
      );
    } finally {
      isStartingRef.current = false;
    }
  }, [
    phase,
    enabled,
    startAudioLevelMonitor,
    resetVisualState,
    resetVoiceActivityState,
    setPhaseState,
    syncDurationFromStart,
    stopAudioLevelMonitor,
    stopAudioStreamTracks,
    stopDurationTimer,
    t,
  ]);

  const stopRecording = useCallback(async () => {
    if (phase !== "recording") return;

    const duration = durationSeconds;
    const startedAt = recordingStartedAtRef.current;
    const title = meetingTitle;
    const meetingId = meetingIdRef.current;

    meetingIdRef.current = null;
    setPhaseState("idle");

    const audioBlob = await stopRecorder("stop");
    stopAudioLevelMonitor();
    stopAudioStreamTracks();
    resetVisualState();
    resetVoiceActivityState();

    if (!audioBlob) {
      return;
    }

    if (!hasDetectedSpeechRef.current) {
      toast.warning(
        t(
          "chronicle.meeting.noSpeechDetected",
          "No clear speech detected, recording discarded",
        ),
      );
      return;
    }

    console.log(
      "[MeetingRecording] Stopped recording, meetingId:",
      meetingId,
      "duration:",
      duration,
    );

    void uploadAndProcessAudio(audioBlob, duration, startedAt, title);
  }, [
    phase,
    durationSeconds,
    meetingTitle,
    stopRecorder,
    stopAudioLevelMonitor,
    stopAudioStreamTracks,
    resetVisualState,
    resetVoiceActivityState,
    setPhaseState,
    uploadAndProcessAudio,
    t,
  ]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Cleanup on unmount
  useEffect(() => {
    isCancelledRef.current = false;
    return () => {
      isCancelledRef.current = true;
      phaseRef.current = "idle";
      resetVoiceActivityState();
      stopDurationTimer();

      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        mediaRecorderRef.current.stop();
      }
      stopAudioLevelMonitor();
      stopAudioStreamTracks();
    };
  }, [
    resetVoiceActivityState,
    stopDurationTimer,
    stopAudioLevelMonitor,
    stopAudioStreamTracks,
  ]);

  return {
    phase,
    isRecording: phase === "recording",
    audioLevel,
    waveformSamples,
    durationSeconds,
    durationText: formatVoiceDuration(durationSeconds),
    canStop: phase === "recording",
    startRecording,
    stopRecording,
  };
}
