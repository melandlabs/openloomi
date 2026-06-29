/**
 * Server-side meeting audio transcription.
 *
 * NOTE: openloomi's audio transcription infrastructure is not yet wired up to
 * a backend provider (Vercel Blob + an AI transcription API). This module
 * provides the shape that the rest of the Chronicle meeting-audio pipeline
 * expects, but the actual transcription call throws a
 * `MeetingTranscriptionError` so callers fail fast instead of silently
 * returning empty transcripts.
 *
 * The signature mirrors the openloomi reference so the
 * `app/api/chronicle/analyze-meeting` route is type-compatible.
 */

export interface TranscribeMeetingAudioOptions {
  audioPath: string;
  requestUrl: string;
  cloudToken?: string;
  cookie?: string;
  model?: string;
}

export class MeetingTranscriptionError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "MeetingTranscriptionError";
  }
}

/**
 * Transcribe a meeting audio file. Throws `MeetingTranscriptionError`
 * because openloomi does not currently have a transcription provider wired
 * up; this stub exists to satisfy type-checkers while the rest of the
 * Chronicle pipeline is being ported.
 */
export async function transcribeMeetingAudio(
  _options: TranscribeMeetingAudioOptions,
): Promise<string> {
  throw new MeetingTranscriptionError(
    "Meeting audio transcription is not yet wired up in openloomi.",
  );
}
