"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  canCaptureSystemAudio,
  getMeetingRecordingStartErrorMessage,
  getSystemAudioPartialFailureMessage,
  isTauriEnv,
  prepareMeetingRecordingStream,
} from "@/lib/audio/system-audio";

export type MeetingSummaryState =
  | { phase: "idle" }
  | { phase: "awaiting_source_selection" }
  | { phase: "processing_audio" }
  | { phase: "generating_summary" };

export type MeetingSummaryAction =
  | { type: "SELECT_SPACE_AUDIO" }
  | { type: "UPLOAD_AUDIO" }
  | { type: "RECORD_AUDIO" }
  | { type: "AUDIO_SELECTED"; audioPath: string }
  | { type: "AUDIO_PROCESSING_START" }
  | { type: "AUDIO_PROCESSING_COMPLETE"; summary: MeetingSummary }
  | { type: "ERROR"; error: string }
  | { type: "RESET" };

export interface MeetingSummary {
  title: string;
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  participants: string[];
}

export interface UseMeetingSummaryOptions {
  chatId: string;
  onSummaryGenerated?: (summary: MeetingSummary) => void;
}

export interface UseMeetingSummaryReturn {
  state: MeetingSummaryState;
  dispatch: (action: MeetingSummaryAction) => Promise<void>;
  isRecording: boolean;
  duration: number;
  durationText: string;
  audioLevel: number;
  /** Whether system audio (e.g. remote participants) is being captured. */
  audioSource: "mic" | "mic+system";
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  selectAudioFile: () => void;
  uploadAudioFile: () => void;
  processAudio: (audioPath: string) => Promise<void>;
}

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

function generateRecordFileName(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  const random = Math.random().toString(36).substring(2, 8);
  return `record_${y}${m}${d}_${h}${min}${s}${ms}_${random}.webm`;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

// Flush interval for streaming upload (30 seconds)
const FLUSH_INTERVAL_MS = 30_000;

/**
 * Convert a Blob to base64 string (without the data: prefix)
 */
async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  const CHUNK_SIZE = 32768;
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

/**
 * Upload a blob chunk to the server via append API with retry logic
 */
async function uploadChunkWithRetry(
  taskId: string,
  fileName: string,
  base64Content: string,
  isFinal: boolean,
  maxRetries = 3,
): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch("/api/workspace/files", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          path: fileName,
          content: base64Content,
          isBase64: true,
          isFinal,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response;
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, attempt) * 1000),
      );
      console.warn(`Upload attempt ${attempt + 1} failed, retrying...`, error);
    }
  }
  throw new Error("Max retries exceeded");
}

export function useMeetingSummary({
  chatId,
  onSummaryGenerated,
}: UseMeetingSummaryOptions): UseMeetingSummaryReturn {
  const [state, setState] = useState<MeetingSummaryState>({ phase: "idle" });
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [hasSystemAudio, setHasSystemAudio] = useState(false);

  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;
  const { t } = useTranslation();

  // MediaRecorder refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  /** Original display stream from getDisplayMedia — kept for cleanup & onended listener. */
  const displayStreamRef = useRef<MediaStream | null>(null);
  /** Tauri native audio bridge — kept for cleanup when using native capture. */
  const tauriBridgeRef = useRef<
    import("@/lib/audio/tauri-audio-bridge").TauriAudioBridge | null
  >(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioRafRef = useRef<number | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  // Streaming upload refs
  const recordingFileNameRef = useRef<string | null>(null);
  const flushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const uploadedChunkCountRef = useRef<number>(0);
  const isFlushingRef = useRef(false);

  const stopAudioStreamTracks = useCallback(() => {
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }
    // Clean up the original getDisplayMedia stream. Clear `onended` first
    // to prevent the "system audio stopped" toast from firing when we
    // intentionally stop the tracks here (S-1 fix).
    if (displayStreamRef.current) {
      for (const track of displayStreamRef.current.getAudioTracks()) {
        track.onended = null;
      }
      for (const track of displayStreamRef.current.getTracks()) {
        track.stop();
      }
      displayStreamRef.current = null;
    }
    // Clean up Tauri native audio bridge if active
    if (tauriBridgeRef.current) {
      tauriBridgeRef.current.stop().catch((e) => {
        console.warn("[MeetingSummary] Error stopping Tauri bridge:", e);
      });
      tauriBridgeRef.current = null;
    }
    setHasSystemAudio(false);
  }, []);

  const stopAudioLevelMonitor = useCallback(() => {
    if (audioRafRef.current !== null) {
      cancelAnimationFrame(audioRafRef.current);
      audioRafRef.current = null;
    }
    analyserRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setAudioLevel(0);
  }, []);

  const startAudioLevelMonitor = useCallback(
    (stream: MediaStream) => {
      if (typeof window === "undefined") return;

      // Reuse existing AudioContext (e.g. from mergeAudioStreams) if available.
      let context = audioContextRef.current;
      if (!context) {
        stopAudioLevelMonitor();
        const AudioContextCtor =
          window.AudioContext ||
          (
            window as typeof window & {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext;
        if (!AudioContextCtor) return;
        context = new AudioContextCtor();
        audioContextRef.current = context;
      }

      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.75;
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);

      analyserRef.current = analyser;

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
        setAudioLevel((prev) => prev * 0.6 + Math.min(rms * 3.5, 1) * 0.4);
        audioRafRef.current = requestAnimationFrame(tick);
      };
      tick();
    },
    [stopAudioLevelMonitor],
  );

  /**
   * Flush accumulated audio chunks to the server via append API.
   */
  const flushAudioChunks = useCallback(
    async (
      isFinal: boolean,
    ): Promise<{ success: boolean; blobPath?: string }> => {
      // Skip concurrent non-final flushes
      if (isFlushingRef.current && !isFinal) {
        return { success: true };
      }

      isFlushingRef.current = true;
      try {
        const fileName = recordingFileNameRef.current;
        const currentChatId = chatIdRef.current;
        if (!fileName || !currentChatId) return { success: false };

        const chunks = audioChunksRef.current;
        if (chunks.length === 0 && !isFinal) return { success: true };

        const chunksToUpload = [...chunks];
        audioChunksRef.current = [];
        uploadedChunkCountRef.current += chunksToUpload.length;

        if (chunksToUpload.length === 0) return { success: true };

        const mimeType = mediaRecorderRef.current?.mimeType || "audio/webm";
        const segmentBlob = new Blob(chunksToUpload, { type: mimeType });
        const base64 = await blobToBase64(segmentBlob);

        const response = await uploadChunkWithRetry(
          currentChatId,
          fileName,
          base64,
          isFinal,
        );
        const data = await response.json();
        return { success: true, blobPath: data.blobPath };
      } catch (error) {
        console.error("Failed to flush audio chunks:", error);
        toast.error("录音数据上传失败，请检查网络后重试");
        return { success: false };
      } finally {
        isFlushingRef.current = false;
      }
    },
    [],
  );

  const startRecording = useCallback(async () => {
    if (
      typeof window === "undefined" ||
      (!canCaptureSystemAudio() && !navigator.mediaDevices?.getUserMedia)
    ) {
      toast.error(t("chronicle.meeting.audioNotSupported"));
      return;
    }

    try {
      const setup = await prepareMeetingRecordingStream({
        onSystemAudioPrePrompt: () => {
          if (!isTauriEnv()) {
            toast.info(t("chronicle.meeting.systemAudioPrePrompt"));
          }
        },
      });

      if (!setup.hasMic && setup.hasSystemAudio) {
        if (setup.micPermissionDenied) {
          toast.info(t("chronicle.meeting.micPermissionDenied"));
        } else {
          toast.info(t("chronicle.meeting.systemAudioOnly"));
        }
      }

      if (canCaptureSystemAudio() && !setup.hasSystemAudio && setup.hasMic) {
        toast.info(getSystemAudioPartialFailureMessage(t));
      }

      audioContextRef.current = setup.audioContext;
      displayStreamRef.current = setup.displayStream;
      if (setup.tauriBridge) {
        tauriBridgeRef.current = setup.tauriBridge;
      }
      setHasSystemAudio(setup.hasSystemAudio);

      if (setup.systemAudioStream) {
        const sysAudioTrack = setup.systemAudioStream.getAudioTracks()[0];
        if (sysAudioTrack) {
          sysAudioTrack.onended = () => {
            setHasSystemAudio(false);
            toast.info(t("chronicle.meeting.systemAudioStopped"));
          };
        }
      }

      const recordingStream = setup.recordingStream;
      mediaStreamRef.current = recordingStream;
      audioChunksRef.current = [];
      uploadedChunkCountRef.current = 0;
      recordingFileNameRef.current = generateRecordFileName();

      const mimeType = getSupportedAudioMimeType();
      const recorder = mimeType
        ? new MediaRecorder(recordingStream, { mimeType })
        : new MediaRecorder(recordingStream);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setIsRecording(false);
        stopAudioStreamTracks();
        if (flushIntervalRef.current) {
          clearInterval(flushIntervalRef.current);
          flushIntervalRef.current = null;
        }
        toast.error("Audio recording failed, please retry");
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      startAudioLevelMonitor(recordingStream);
      setIsRecording(true);
      setDuration(0);

      durationIntervalRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);

      // Periodic flush: upload accumulated chunks every 30 seconds
      flushIntervalRef.current = setInterval(async () => {
        if (audioChunksRef.current.length > 0) {
          await flushAudioChunks(false);
        }
      }, FLUSH_INTERVAL_MS);
    } catch (error) {
      console.error("Failed to start meeting recording:", error);
      stopAudioLevelMonitor();
      stopAudioStreamTracks();
      toast.error(getMeetingRecordingStartErrorMessage(error, t));
    }
  }, [
    startAudioLevelMonitor,
    stopAudioLevelMonitor,
    stopAudioStreamTracks,
    flushAudioChunks,
    t,
  ]);

  const stopRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    const fileName = recordingFileNameRef.current;
    if (!recorder || !fileName) return;

    setIsRecording(false);

    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (flushIntervalRef.current) {
      clearInterval(flushIntervalRef.current);
      flushIntervalRef.current = null;
    }

    // Wait for any in-progress flush to complete
    while (isFlushingRef.current) {
      await new Promise((r) => setTimeout(r, 100));
    }

    // Wait for recorder to stop and collect final chunks
    await new Promise<void>((resolve) => {
      recorder.onstop = () => {
        stopAudioLevelMonitor();
        stopAudioStreamTracks();
        resolve();
      };

      if (recorder.state === "recording") {
        try {
          recorder.requestData();
        } catch {
          // Ignore
        }
      }
      recorder.stop();
    });

    // Flush remaining chunks as the final segment
    const flushResult = await flushAudioChunks(true);

    mediaRecorderRef.current = null;
    recordingFileNameRef.current = null;

    if (flushResult.success) {
      toast.success(`录音已保存到对话空间: ${fileName}`);
    } else {
      toast.error("Failed to save recording");
    }
  }, [stopAudioLevelMonitor, stopAudioStreamTracks, flushAudioChunks]);

  const selectAudioFile = useCallback(() => {
    setState({ phase: "awaiting_source_selection" });
  }, []);

  const uploadAudioFile = useCallback(() => {
    setState({ phase: "awaiting_source_selection" });
  }, []);

  const processAudio = useCallback(
    async (audioPath: string) => {
      setState({ phase: "processing_audio" });

      try {
        const response = await fetch("/api/meeting-summary/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audioPath,
            chatId: chatIdRef.current,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to analyze meeting");
        }

        const result = await response.json();

        if (result.success) {
          const summary: MeetingSummary = {
            title: result.title || "会议摘要",
            summary: result.summary || "",
            keyPoints: result.keyPoints || [],
            actionItems: result.actionItems || [],
            participants: result.participants || [],
          };

          setState({ phase: "idle" });
          onSummaryGenerated?.(summary);
        } else {
          throw new Error(result.error || "Analysis failed");
        }
      } catch (error) {
        console.error("Failed to process audio:", error);
        setState({ phase: "idle" });
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to generate meeting summary",
        );
      }
    },
    [onSummaryGenerated],
  );

  const dispatch = useCallback(
    async (action: MeetingSummaryAction) => {
      switch (action.type) {
        case "SELECT_SPACE_AUDIO":
          setState({ phase: "awaiting_source_selection" });
          break;

        case "UPLOAD_AUDIO":
          setState({ phase: "awaiting_source_selection" });
          break;

        case "RECORD_AUDIO":
          setState({ phase: "awaiting_source_selection" });
          break;

        case "AUDIO_SELECTED":
          await processAudio(action.audioPath);
          break;

        case "AUDIO_PROCESSING_START":
          setState({ phase: "processing_audio" });
          break;

        case "AUDIO_PROCESSING_COMPLETE":
          setState({ phase: "idle" });
          break;

        case "ERROR":
          setState({ phase: "idle" });
          toast.error(action.error);
          break;

        case "RESET":
          setState({ phase: "idle" });
          break;
      }
    },
    [processAudio],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
      if (flushIntervalRef.current) {
        clearInterval(flushIntervalRef.current);
      }
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        // Flush remaining data before stopping
        mediaRecorderRef.current.onstop = async () => {
          if (audioChunksRef.current.length > 0) {
            try {
              await flushAudioChunks(true);
            } catch (error) {
              console.error("Failed to flush on unmount:", error);
            }
          }
        };
        mediaRecorderRef.current.stop();
      }
      stopAudioLevelMonitor();
      stopAudioStreamTracks();
    };
  }, [flushAudioChunks, stopAudioLevelMonitor, stopAudioStreamTracks]);

  return {
    state,
    dispatch,
    isRecording,
    duration,
    durationText: formatDuration(duration),
    audioLevel,
    audioSource: hasSystemAudio ? "mic+system" : "mic",
    startRecording,
    stopRecording,
    selectAudioFile,
    uploadAudioFile,
    processAudio,
  };
}

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

function audioBufferToWav(buffer: AudioBuffer): Blob {
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
