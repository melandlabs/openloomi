/**
 * TauriAudioBridge — bridges native system audio capture (via Tauri commands/events)
 * into a Web Audio `MediaStream` that can be merged with the microphone stream.
 *
 * ## Flow
 *
 * ```
 * Rust (cpal / ScreenCaptureKit)
 *   → emits "system-audio-chunk" events (base64 i16 PCM)
 *   → TauriAudioBridge receives chunks
 *   → schedules AudioBufferSourceNodes on an AudioContext timeline
 *   → routes through MediaStreamAudioDestinationNode
 *   → exposes a MediaStream
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * const bridge = new TauriAudioBridge();
 * await bridge.start();
 * const systemStream = bridge.stream;
 * // Merge with mic stream using mergeAudioStreams()
 * await bridge.stop();
 * ```
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

interface SystemAudioStartedPayload {
  sample_rate: number;
  channels: number;
}

interface SystemAudioChunkPayload {
  /** Base64-encoded 16-bit PCM, little-endian, mono. */
  data: string;
  samples: number;
  timestamp_ms: number;
}

interface SystemAudioErrorPayload {
  message: string;
}

/**
 * Decode a base64 string into an Int16Array.
 */
function base64ToInt16Array(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

const SYSTEM_AUDIO_START_TIMEOUT_MS = 15_000;

export class TauriAudioBridge {
  private ctx: AudioContext | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private baseContextTime = 0;
  private baseTimestampMs: number | null = null;
  private unlistenStarted: UnlistenFn | null = null;
  private unlistenChunk: UnlistenFn | null = null;
  private unlistenError: UnlistenFn | null = null;
  private onError: ((message: string) => void) | null = null;
  private active = false;
  private nativeSampleRate: number | null = null;

  /** The MediaStream containing the system audio. */
  get stream(): MediaStream | null {
    return this.destination?.stream ?? null;
  }

  /** Sample rate reported by native capture (set after start). */
  get sampleRate(): number | null {
    return this.nativeSampleRate;
  }

  /** Whether the bridge is currently active. */
  get isActive(): boolean {
    return this.active;
  }

  /**
   * Start capturing system audio via Tauri native commands.
   *
   * Listens for `system-audio-started` to create the AudioContext at the
   * correct sample rate, then processes incoming `system-audio-chunk` events.
   *
   * @param onError — called if the native capture reports an error
   */
  async start(onError?: (message: string) => void): Promise<void> {
    if (this.active) return;
    this.onError = onError ?? null;

    // Set active=true BEFORE invoking, so that if invoke fails we can
    // properly clean up via stop() without hitting the early-return guard.
    this.active = true;

    let resolveStarted!: (payload: SystemAudioStartedPayload) => void;
    let rejectStarted!: (error: Error) => void;
    const startedPromise = new Promise<SystemAudioStartedPayload>(
      (resolve, reject) => {
        resolveStarted = resolve;
        rejectStarted = reject;
      },
    );

    const rejectCapture = (error: Error) => {
      clearTimeout(startTimeout);
      rejectStarted(error);
    };

    const startTimeout = setTimeout(() => {
      rejectCapture(
        new Error("Timed out waiting for system-audio-started event"),
      );
    }, SYSTEM_AUDIO_START_TIMEOUT_MS);

    // Register listeners before starting native capture to avoid missing
    // early events emitted on a background thread.
    this.unlistenStarted = await listen<SystemAudioStartedPayload>(
      "system-audio-started",
      (event) => {
        clearTimeout(startTimeout);
        resolveStarted(event.payload);
      },
    );

    this.unlistenError = await listen<SystemAudioErrorPayload>(
      "system-audio-error",
      (event) => {
        this.onError?.(event.payload.message);
        rejectCapture(new Error(event.payload.message));
      },
    );

    try {
      await invoke("start_system_audio_capture");
      const startedInfo = await startedPromise;
      const sampleRate = startedInfo.sample_rate;
      this.nativeSampleRate = sampleRate;

      if (this.unlistenStarted) {
        await this.unlistenStarted();
        this.unlistenStarted = null;
      }

      this.ctx = new AudioContext({ sampleRate });
      void this.ctx.resume();
      this.destination = this.ctx.createMediaStreamDestination();
      this.baseContextTime = 0;
      this.baseTimestampMs = null;

      this.unlistenChunk = await listen<SystemAudioChunkPayload>(
        "system-audio-chunk",
        (event) => {
          this.pushChunk(event.payload);
        },
      );

      this.active = true;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  /**
   * Push a base64-encoded PCM chunk into the audio graph.
   * Decodes i16 → f32, creates an AudioBuffer, and schedules playback.
   */
  private pushChunk(payload: SystemAudioChunkPayload): void {
    if (!this.ctx || !this.destination) return;

    const pcm16 = base64ToInt16Array(payload.data);
    const sampleCount = payload.samples > 0 ? payload.samples : pcm16.length;
    const frameCount = Math.min(sampleCount, pcm16.length);
    if (frameCount === 0) return;

    // Convert Int16 to Float32
    const float32 = new Float32Array(frameCount);
    for (let i = 0; i < frameCount; i++) {
      float32[i] = pcm16[i] / 32768;
    }

    // Create AudioBuffer
    const buffer = this.ctx.createBuffer(
      1, // mono
      frameCount,
      this.ctx.sampleRate,
    );
    buffer.getChannelData(0).set(float32);

    // Anchor the first chunk to the AudioContext timeline using capture timestamps.
    if (this.baseTimestampMs === null) {
      this.baseTimestampMs = payload.timestamp_ms;
      this.baseContextTime = this.ctx.currentTime + 0.05;
    }

    const offsetSec = (payload.timestamp_ms - this.baseTimestampMs) / 1000;
    let startTime = this.baseContextTime + offsetSec;
    const currentTime = this.ctx.currentTime;
    if (startTime < currentTime) {
      // Chunk arrived late — play immediately to avoid dropping audio.
      startTime = currentTime;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.destination);
    source.start(startTime);
  }

  /**
   * Stop capturing system audio and clean up resources.
   */
  async stop(): Promise<void> {
    if (!this.active) return;
    this.active = false;

    // Unlisten from events
    if (this.unlistenStarted) {
      await this.unlistenStarted();
      this.unlistenStarted = null;
    }
    if (this.unlistenChunk) {
      await this.unlistenChunk();
      this.unlistenChunk = null;
    }
    if (this.unlistenError) {
      await this.unlistenError();
      this.unlistenError = null;
    }

    // Stop native capture
    try {
      await invoke("stop_system_audio_capture");
    } catch (e) {
      console.warn("[TauriAudioBridge] Error stopping capture:", e);
    }

    // Close AudioContext
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
    }
    this.destination = null;
    this.baseContextTime = 0;
    this.baseTimestampMs = null;
    this.nativeSampleRate = null;
    this.onError = null;
  }
}
