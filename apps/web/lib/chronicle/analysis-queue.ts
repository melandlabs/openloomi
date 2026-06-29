/**
 * Chronicle Analysis Queue
 *
 * An in-memory FIFO queue that decouples screenshot capture from LLM analysis.
 * After a screenshot is uploaded, the capture flow enqueues an analysis job and
 * returns immediately. The queue processes jobs one at a time in the background,
 * calling the analyze API then saving the result as a memory.
 *
 * Benefits over the old synchronous flow:
 *   - Captures happen on schedule regardless of LLM latency
 *   - A slow/failed analysis doesn't delay subsequent captures
 *   - The debounce timer resets immediately after upload, not after analysis
 */

export interface AnalysisJob {
  /** Unique job id (uuid) */
  id: string;
  /** Absolute path to the saved screenshot on the server */
  screenshotPath: string;
  /** Cloud auth token for the AI proxy (Tauri mode) */
  cloudAuthToken?: string;
}

export interface AnalysisResult {
  screenshotPath: string;
  description: string;
  keyContent: string[];
  extractedText: string;
  timestamp: Date;
}

/** Callback fired when a job completes successfully */
export type JobCompletionCallback = (result: AnalysisResult) => void;

interface QueueEntry {
  job: AnalysisJob;
  onComplete: JobCompletionCallback | null;
}

class ChronicleAnalysisQueue {
  private queue: QueueEntry[] = [];
  private processing = false;
  /** Total jobs enqueued since creation (for diagnostics) */
  private totalEnqueued = 0;
  /** Total jobs completed since creation */
  private totalCompleted = 0;

  // ─── Public API ───────────────────────────────────────────────────────

  /**
   * Enqueue a screenshot analysis job.
   *
   * @param job           Job metadata (screenshot path, auth token, etc.)
   * @param onComplete    Optional callback invoked when analysis + memory save succeed.
   *                      This is called asynchronously — the caller's `captureScreenMemory`
   *                      will have already returned and cleared the busy flag.
   */
  enqueue(job: AnalysisJob, onComplete?: JobCompletionCallback): void {
    this.totalEnqueued++;
    this.queue.push({ job, onComplete: onComplete ?? null });

    if (!this.processing) {
      // Kick off processing in a microtask so the caller can finish its
      // synchronous work (e.g. clearing the busy flag) first.
      queueMicrotask(() => void this.processNext());
    }
  }

  /** Number of jobs waiting to be processed */
  get pending(): number {
    return this.queue.length;
  }

  /** Whether a job is currently being processed */
  get isProcessing(): boolean {
    return this.processing;
  }

  /** Total jobs enqueued since the queue was created */
  get enqueuedCount(): number {
    return this.totalEnqueued;
  }

  /** Total jobs completed since the queue was created */
  get completedCount(): number {
    return this.totalCompleted;
  }

  // ─── Internal Processing ──────────────────────────────────────────────

  private async processNext(): Promise<void> {
    if (this.processing) return;

    const entry = this.queue.shift();
    if (!entry) return;

    this.processing = true;
    const { job, onComplete } = entry;

    console.log(
      `[ChronicleQueue] Processing job ${job.id} ` +
        `(pending=${this.queue.length}, total=${this.totalEnqueued})`,
    );

    try {
      const result = await this.executeJob(job);
      this.totalCompleted++;
      onComplete?.(result);
      console.log(
        `[ChronicleQueue] Job ${job.id} completed ` +
          `(completed=${this.totalCompleted}, pending=${this.queue.length})`,
      );
    } catch (err) {
      // Individual job failures never block the queue. Log and move on.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ChronicleQueue] Job ${job.id} failed: ${msg}`);
    } finally {
      this.processing = false;
      // Process next job if any — use queueMicrotask to avoid stack buildup
      // in the (unlikely) scenario of a rapid-fill queue.
      if (this.queue.length > 0) {
        queueMicrotask(() => void this.processNext());
      }
    }
  }

  /**
   * Execute a single analysis job:
   *   1. POST /api/chronicle/analyze  →  get description, keyContent, extractedText
   *   2. POST /api/chronicle/memories →  persist the memory
   *
   * Both calls are standard fetch requests to the same Next.js origin, so they
   * carry the session cookie and work identically in Tauri and browser modes.
   */
  private async executeJob(job: AnalysisJob): Promise<AnalysisResult> {
    const { screenshotPath, cloudAuthToken } = job;

    // ── Step 1: Analyze ────────────────────────────────────────────────
    const analyzeHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (cloudAuthToken) {
      analyzeHeaders.Authorization = `Bearer ${cloudAuthToken}`;
    }

    const analyzeResponse = await fetch("/api/chronicle/analyze", {
      method: "POST",
      headers: analyzeHeaders,
      body: JSON.stringify({ screenshotPath, cloudAuthToken }),
      signal: AbortSignal.timeout(300_000),
    });

    if (!analyzeResponse.ok) {
      const errText = await analyzeResponse.text().catch(() => "");
      throw new Error(
        `Analyze API ${analyzeResponse.status}: ${errText.slice(0, 300)}`,
      );
    }

    const analysis = (await analyzeResponse.json()) as {
      description: string;
      keyContent: string[];
      extractedText?: string;
    };

    const extractedText = analysis.extractedText ?? "";
    const timestamp = new Date();

    // ── Step 2: Save memory ────────────────────────────────────────────
    const memoryResponse = await fetch("/api/chronicle/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        screenshotPath,
        description: analysis.description,
        keyContent: analysis.keyContent,
        extractedText,
        capturedAt: timestamp.toISOString(),
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!memoryResponse.ok) {
      const errText = await memoryResponse.text().catch(() => "");
      throw new Error(
        `Memory save API ${memoryResponse.status}: ${errText.slice(0, 300)}`,
      );
    }

    return {
      screenshotPath,
      description: analysis.description,
      keyContent: analysis.keyContent,
      extractedText,
      timestamp,
    };
  }
}

// ─── Meeting Analysis Types ──────────────────────────────────────────────

export interface MeetingAnalysisJob {
  /** Unique job id (uuid) */
  id: string;
  /** Absolute path to the saved audio file on the server */
  audioPath: string;
  /** Optional meeting title */
  title?: string;
  /** Meeting start time */
  meetingStartTime?: string;
  /** Meeting end time */
  meetingEndTime?: string;
  /** Duration in seconds */
  durationSeconds?: number;
  /** Cloud auth token for the AI proxy (Tauri mode) */
  cloudAuthToken?: string;
}

export interface MeetingAnalysisResult {
  audioPath: string;
  title: string;
  transcript: string;
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  participants: string[];
  meetingStartTime: Date;
  meetingEndTime: Date;
}

/** Callback fired when a meeting job completes successfully */
export type MeetingJobCompletionCallback = (
  result: MeetingAnalysisResult,
) => void;

interface MeetingQueueEntry {
  job: MeetingAnalysisJob;
  onComplete: MeetingJobCompletionCallback | null;
}

// ─── Meeting Analysis Queue ─────────────────────────────────────────────

class ChronicleMeetingAnalysisQueue {
  private queue: MeetingQueueEntry[] = [];
  private processing = false;
  private totalEnqueued = 0;
  private totalCompleted = 0;

  enqueue(
    job: MeetingAnalysisJob,
    onComplete?: MeetingJobCompletionCallback,
  ): void {
    this.totalEnqueued++;
    this.queue.push({ job, onComplete: onComplete ?? null });

    if (!this.processing) {
      queueMicrotask(() => void this.processNextMeeting());
    }
  }

  get pending(): number {
    return this.queue.length;
  }

  get isProcessing(): boolean {
    return this.processing;
  }

  get enqueuedCount(): number {
    return this.totalEnqueued;
  }

  get completedCount(): number {
    return this.totalCompleted;
  }

  private async processNextMeeting(): Promise<void> {
    if (this.processing) return;

    const entry = this.queue.shift();
    if (!entry) return;

    this.processing = true;
    const { job, onComplete } = entry;

    console.log(
      `[ChronicleMeetingQueue] Processing job ${job.id} ` +
        `(pending=${this.queue.length}, total=${this.totalEnqueued})`,
    );

    try {
      const result = await this.executeMeetingJob(job);
      this.totalCompleted++;
      onComplete?.(result);
      console.log(
        `[ChronicleMeetingQueue] Job ${job.id} completed ` +
          `(completed=${this.totalCompleted}, pending=${this.queue.length})`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ChronicleMeetingQueue] Job ${job.id} failed: ${msg}`);
    } finally {
      this.processing = false;
      if (this.queue.length > 0) {
        queueMicrotask(() => void this.processNextMeeting());
      }
    }
  }

  private async executeMeetingJob(
    job: MeetingAnalysisJob,
  ): Promise<MeetingAnalysisResult> {
    const {
      audioPath,
      title,
      meetingStartTime,
      meetingEndTime,
      cloudAuthToken,
    } = job;

    // ── Step 1: Transcribe + Summarize ────────────────────────────────
    const analyzeHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (cloudAuthToken) {
      analyzeHeaders.Authorization = `Bearer ${cloudAuthToken}`;
    }

    const analyzeResponse = await fetch("/api/chronicle/analyze-meeting", {
      method: "POST",
      headers: analyzeHeaders,
      body: JSON.stringify({
        audioPath,
        title: title || "",
      }),
      signal: AbortSignal.timeout(780_000), // align with analyze route maxDuration (800s)
    });

    if (!analyzeResponse.ok) {
      const errText = await analyzeResponse.text().catch(() => "");
      throw new Error(
        `Analyze Meeting API ${analyzeResponse.status}: ${errText.slice(0, 300)}`,
      );
    }

    const analysis = (await analyzeResponse.json()) as {
      title: string;
      transcript: string;
      summary: string;
      keyPoints: string[];
      actionItems: string[];
      participants: string[];
    };

    const startTime = meetingStartTime
      ? new Date(meetingStartTime)
      : new Date();
    const endTime = meetingEndTime ? new Date(meetingEndTime) : new Date();

    // ── Step 2: Save meeting memory ─────────────────────────────────
    const memoryResponse = await fetch("/api/chronicle/meeting-memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audioPath,
        title: analysis.title || title,
        description: analysis.summary,
        transcript: analysis.transcript,
        summary: analysis.summary,
        keyPoints: analysis.keyPoints,
        actionItems: analysis.actionItems,
        participants: analysis.participants,
        meetingStartTime: startTime.toISOString(),
        meetingEndTime: endTime.toISOString(),
        durationSeconds: job.durationSeconds || 0,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!memoryResponse.ok) {
      const errText = await memoryResponse.text().catch(() => "");
      throw new Error(
        `Meeting Memory save API ${memoryResponse.status}: ${errText.slice(0, 300)}`,
      );
    }

    return {
      audioPath,
      title: analysis.title || title || "Meeting Recording",
      transcript: analysis.transcript,
      summary: analysis.summary,
      keyPoints: analysis.keyPoints,
      actionItems: analysis.actionItems,
      participants: analysis.participants,
      meetingStartTime: startTime,
      meetingEndTime: endTime,
    };
  }
}

/** Application-wide singleton. Survives React re-renders and component mounts. */
export const chronicleAnalysisQueue = new ChronicleAnalysisQueue();

/** Singleton for meeting analysis queue */
export const chronicleMeetingAnalysisQueue =
  new ChronicleMeetingAnalysisQueue();
