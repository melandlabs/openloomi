/**
 * LoCoMo Evaluator for Memory System.
 *
 * Uses OpenLoomi's MemoryStorageAdapter interface with in-memory implementation
 * for benchmarking the memory system.
 * Now uses /api/native/agent for answering questions.
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { MemoryRecord } from "./contracts";

import { RetrievalMode } from "./types";
import type { LoCoMoSample, EvaluationResult, Prediction } from "./types";
import {
  InMemoryStorageAdapter,
  callAgentApi,
  readAuthToken,
  findAvailablePort,
  DEFAULT_PORTS,
} from "./memory-adapter";
import { calculateMetrics, evaluateLLMJudge } from "./metrics";

/**
 * Write memory records to ~/.openloomi/data/memory/bench/ folder
 */
async function writeMemoryFiles(
  sample: LoCoMoSample,
  records: MemoryRecord[],
): Promise<void> {
  const memoryDir = join(
    homedir(),
    ".openloomi",
    "data",
    "memory",
    "bench",
    sample.sample_id,
  );

  await mkdir(memoryDir, { recursive: true });

  for (const record of records) {
    const filename = `${record.id}.md`;
    const filepath = join(memoryDir, filename);

    const content = `# ${record.dimensions?.type || "memory"} - ${sample.sample_id}\n\n${record.text}`;
    await writeFile(filepath, content, "utf-8");
  }

  console.log(`[LoCoMo] Wrote ${records.length} memory files to ${memoryDir}`);
}

/**
 * Format conversation data into memory records.
 */
function createMemoryRecordsFromDialog(sample: LoCoMoSample): MemoryRecord[] {
  const records: MemoryRecord[] = [];
  const speakerA = sample.conversation.speaker_a ?? "Speaker A";
  const speakerB = sample.conversation.speaker_b ?? "Speaker B";

  for (const key of Object.keys(sample.conversation).sort()) {
    if (!key.startsWith("session_") || key.endsWith("_date_time")) {
      continue;
    }

    const sessionNum = key.replace("session_", "");
    const datetimeKey = `session_${sessionNum}_date_time`;
    const sessionTimestamp = sample.conversation[datetimeKey] ?? "";
    const session = sample.conversation[key] as string[];

    const dialogParts: string[] = [];
    dialogParts.push(`# Conversation Session ${sessionNum}`);
    if (sessionTimestamp) {
      dialogParts.push(`# Timestamp: ${sessionTimestamp}`);
    }
    dialogParts.push(`# Speakers: ${speakerA}, ${speakerB}`);
    dialogParts.push("");

    for (const turn of session) {
      if (sessionTimestamp) {
        dialogParts.push(`[${sessionTimestamp}] ${turn}`);
      } else {
        dialogParts.push(turn);
      }
    }

    const content = dialogParts.join("\n");
    const id = `${sample.sample_id}_dialog_${sessionNum}`;

    records.push({
      id,
      userId: "benchmark_user",
      timestamp: parseTimestamp(sessionTimestamp) || Date.now(),
      text: content,
      tier: "long",
      dimensions: {
        sample_id: sample.sample_id,
        session_id: sessionNum,
        type: "dialog",
      },
      metadata: {
        sampleId: sample.sample_id,
        sessionId: sessionNum,
        contentType: "dialog",
      },
    });
  }

  return records;
}

/**
 * Format observation data into memory records.
 */
function createMemoryRecordsFromObservation(
  sample: LoCoMoSample,
): MemoryRecord[] {
  const records: MemoryRecord[] = [];

  for (const key of Object.keys(sample.observation).sort()) {
    if (!key.endsWith("_observation")) {
      continue;
    }

    const sessionNum = key.replace("_observation", "");
    const datetimeKey = `${sessionNum}_date_time`;
    const sessionTimestamp = sample.conversation[datetimeKey] ?? "";
    const obsContent = sample.observation[key];

    const obsParts: string[] = [];
    obsParts.push(`# Observation Summary ${sessionNum}`);
    if (sessionTimestamp) {
      obsParts.push(`# Session Date: ${sessionTimestamp}`);
    }
    obsParts.push("");

    // Add observation summary with dialog references
    if (typeof obsContent === "object" && obsContent !== null) {
      for (const [speaker, utterances] of Object.entries(obsContent)) {
        if (Array.isArray(utterances)) {
          for (const item of utterances) {
            if (Array.isArray(item) && item.length >= 2) {
              const [text, diaId] = item;
              // Include text and its dialog reference
              obsParts.push(`${speaker}: ${text} [Ref: ${diaId}]`);
            } else {
              obsParts.push(`${speaker}: ${item}`);
            }
          }
        }
      }
    } else {
      obsParts.push(String(obsContent));
    }

    obsParts.push("");

    // Add original dialog for this session to enable temporal reasoning
    const sessionKey = `session_${sessionNum}`;
    const dialogContent = sample.conversation[sessionKey];
    if (Array.isArray(dialogContent)) {
      obsParts.push("# Original Dialog (for date/time reasoning):");
      for (const turn of dialogContent) {
        if (
          typeof turn === "object" &&
          turn !== null &&
          "speaker" in turn &&
          "text" in turn
        ) {
          obsParts.push(`${turn.speaker}: ${turn.text}`);
        } else if (typeof turn === "string") {
          obsParts.push(turn);
        }
      }
    }

    const content = obsParts.join("\n");
    const id = `${sample.sample_id}_observation_${sessionNum}`;

    records.push({
      id,
      userId: "benchmark_user",
      timestamp: parseTimestamp(sessionTimestamp) || Date.now(),
      text: content,
      tier: "long",
      dimensions: {
        sample_id: sample.sample_id,
        session_id: sessionNum,
        type: "observation",
      },
      metadata: {
        sampleId: sample.sample_id,
        sessionId: sessionNum,
        contentType: "observation",
      },
    });
  }

  return records;
}

/**
 * Format session summary data into memory records.
 */
function createMemoryRecordsFromSummary(sample: LoCoMoSample): MemoryRecord[] {
  const records: MemoryRecord[] = [];

  for (const key of Object.keys(sample.session_summary).sort()) {
    if (!key.endsWith("_summary")) {
      continue;
    }

    const sessionNum = key.replace("_summary", "");
    const datetimeKey = `${sessionNum}_date_time`;
    const sessionTimestamp = sample.conversation[datetimeKey] ?? "";
    const summaryContent = sample.session_summary[key];

    const summaryParts: string[] = [];
    summaryParts.push(`# Session Summary ${sessionNum}`);
    if (sessionTimestamp) {
      summaryParts.push(`# Timestamp: ${sessionTimestamp}`);
    }
    summaryParts.push("");

    if (typeof summaryContent === "object" && summaryContent !== null) {
      for (const [speaker, text] of Object.entries(summaryContent)) {
        summaryParts.push(`${speaker}: ${text}`);
      }
    } else {
      summaryParts.push(String(summaryContent));
    }

    const content = summaryParts.join("\n");
    const id = `${sample.sample_id}_summary_${sessionNum}`;

    records.push({
      id,
      userId: "benchmark_user",
      timestamp: parseTimestamp(sessionTimestamp) || Date.now(),
      text: content,
      tier: "long",
      dimensions: {
        sample_id: sample.sample_id,
        session_id: sessionNum,
        type: "session_summary",
      },
      metadata: {
        sampleId: sample.sample_id,
        sessionId: sessionNum,
        contentType: "session_summary",
      },
    });
  }

  return records;
}

/**
 * Parse timestamp string to Unix ms.
 */
function parseTimestamp(ts: string): number | undefined {
  if (!ts) return undefined;
  try {
    const date = new Date(ts);
    if (!Number.isNaN(date.getTime())) {
      return date.getTime();
    }
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? undefined : parsed;
  } catch {
    return undefined;
  }
}

/**
 * Build prompt for agent API with question and conversation context.
 */
function buildAgentPrompt(question: string, sample: LoCoMoSample): string {
  const parts: string[] = [];

  // Add conversation context based on retrieval mode
  if (sample.conversation) {
    parts.push("# Conversation History\n");
    const speakerA = sample.conversation.speaker_a ?? "Speaker A";
    const speakerB = sample.conversation.speaker_b ?? "Speaker B";
    parts.push(`# Speakers: ${speakerA}, ${speakerB}\n`);

    for (const key of Object.keys(sample.conversation).sort()) {
      if (key.endsWith("_date_time")) {
        const sessionNum = key.replace("_date_time", "");
        const datetimeKey = `session_${sessionNum}_date_time`;
        const sessionKey = `session_${sessionNum}`;
        const session = sample.conversation[sessionKey];
        const timestamp = sample.conversation[datetimeKey];

        if (Array.isArray(session)) {
          parts.push(
            `\n## Session ${sessionNum} (${timestamp || "unknown"})\n`,
          );
          for (const turn of session) {
            parts.push(turn);
          }
        }
      }
    }
  }

  // Add observation context
  if (sample.observation) {
    parts.push("\n# Observations\n");
    for (const key of Object.keys(sample.observation).sort()) {
      if (key.endsWith("_observation")) {
        parts.push(`\n## ${key}\n`);
        parts.push(String(sample.observation[key]));
      }
    }
  }

  // Add session summary context
  if (sample.session_summary) {
    parts.push("\n# Session Summaries\n");
    for (const key of Object.keys(sample.session_summary).sort()) {
      if (key.endsWith("_summary")) {
        parts.push(`\n## ${key}\n`);
        parts.push(String(sample.session_summary[key]));
      }
    }
  }

  const context = parts.join("\n");

  return `You are a helpful assistant answering questions based on the conversation history provided below.

# INSTRUCTIONS:
1. Carefully analyze all provided conversation history and summaries
2. Pay special attention to timestamps to determine the answer
3. If the question asks about a specific event or fact, look for direct evidence in the memories
4. If the memories contain contradictory information, prioritize the most recent memory
5. If there is a question about time references (like "last year", "two months ago", etc.),
   calculate the actual date based on the memory timestamp. For example, if a memory from
   4 May 2022 mentions "went to India last year," then the trip occurred in 2021.
6. Always convert relative time references to specific dates, months, or years.
7. Focus only on the content of the memories. Do not confuse character names mentioned in memories with the speakers.

${context}

---

Question: ${question}

Answer based on the conversation history above:`;
}

/**
 * Evaluator for LoCoMo benchmark using OpenLoomi Memory API.
 */
export class LoCoMoEvaluator {
  private retrievalMode: RetrievalMode;
  private storage: InMemoryStorageAdapter;
  private port: number;
  private authToken?: string;
  private quickLimit?: number;
  private checkpointDir: string;
  private resume: boolean;

  constructor(
    retrievalMode: RetrievalMode | string = RetrievalMode.OBSERVATION,
    port?: number,
    tokenPath?: string,
    quickLimit?: number,
    resume = true,
  ) {
    // Convert string to enum if needed
    if (typeof retrievalMode === "string") {
      const modeMap: Record<string, RetrievalMode> = {
        dialog: RetrievalMode.DIALOG,
        observation: RetrievalMode.OBSERVATION,
        session_summary: RetrievalMode.SESSION_SUMMARY,
      };
      this.retrievalMode = modeMap[retrievalMode] || RetrievalMode.OBSERVATION;
    } else {
      this.retrievalMode = retrievalMode;
    }
    this.storage = new InMemoryStorageAdapter();
    this.port = port || DEFAULT_PORTS[0];
    this.authToken = readAuthToken(tokenPath);
    this.quickLimit = quickLimit;
    this.resume = resume;
    this.checkpointDir = join(
      homedir(),
      ".openloomi",
      "data",
      "memory",
      "bench",
      "checkpoints",
      String(this.retrievalMode),
    );
  }

  /**
   * Set API port (for auto-discovery)
   */
  setPort(port: number): void {
    this.port = port;
  }

  /**
   * Get checkpoint file path for a sample
   */
  private getCheckpointPath(sampleId: string): string {
    return join(this.checkpointDir, `${sampleId}.json`);
  }

  /**
   * Load checkpoint for a sample if it exists
   */
  private async loadCheckpoint(
    sampleId: string,
  ): Promise<Record<number, Prediction> | null> {
    if (!this.resume) return null;
    try {
      const path = this.getCheckpointPath(sampleId);
      const data = await readFile(path, "utf-8");
      const parsed = JSON.parse(data);
      // Return predictions keyed by question index
      return parsed as Record<number, Prediction>;
    } catch {
      return null;
    }
  }

  /**
   * Save checkpoint for a sample after each question is evaluated
   */
  private async saveCheckpoint(
    sampleId: string,
    predictions: Record<number, Prediction>,
  ): Promise<void> {
    try {
      await mkdir(this.checkpointDir, { recursive: true });
      const path = this.getCheckpointPath(sampleId);
      await writeFile(path, JSON.stringify(predictions, null, 2), "utf-8");
    } catch (error) {
      console.error(`Failed to save checkpoint: ${error}`);
    }
  }

  /**
   * Load a LoCoMo sample into the memory system.
   * Writes memory records to ~/.openloomi/data/memory/bench/ for the agent to search.
   */
  async loadSample(sample: LoCoMoSample): Promise<void> {
    this.storage.clear();

    // Build memory records based on retrieval mode
    let records: MemoryRecord[];

    if (this.retrievalMode === RetrievalMode.DIALOG) {
      records = createMemoryRecordsFromDialog(sample);
    } else if (this.retrievalMode === RetrievalMode.OBSERVATION) {
      records = createMemoryRecordsFromObservation(sample);
    } else if (this.retrievalMode === RetrievalMode.SESSION_SUMMARY) {
      records = createMemoryRecordsFromSummary(sample);
    } else {
      records = [];
    }

    // Store in memory adapter (for record count check)
    for (const record of records) {
      this.storage.addRecord(record);
    }

    // Write to memory files for agent to search
    await writeMemoryFiles(sample, records);

    console.log(
      `[LoCoMo] Loaded ${records.length} records (mode: ${this.retrievalMode})`,
    );
  }

  /**
   * Evaluate question answering on a LoCoMo sample.
   */
  async evaluateQA(sample: LoCoMoSample): Promise<EvaluationResult> {
    if (this.storage.recordCount === 0) {
      return {
        sample_id: sample.sample_id,
        retrieval_mode: this.retrievalMode,
        total_questions: sample.qa_pairs.length,
        correct_answers: 0,
        accuracy: 0,
        token_usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
        predictions: [],
        error: "No records in storage",
      };
    }

    // Load checkpoint for resume support
    const checkpoint = (await this.loadCheckpoint(sample.sample_id)) || {};
    const completedIndices = new Set(Object.keys(checkpoint).map(Number));
    const skippedCount = completedIndices.size;

    const predictions: Prediction[] = [];
    let correct = 0;

    // If we have checkpoint data, restore predictions
    if (skippedCount > 0) {
      for (const [idx, pred] of Object.entries(checkpoint)) {
        predictions.push(pred);
        if (pred.correct) correct++;
      }
      console.log(
        `[LoCoMo] Resuming from checkpoint: ${skippedCount} questions already evaluated`,
      );
    }

    // Limit questions if quick mode is enabled
    const questionsToEvaluate = this.quickLimit
      ? sample.qa_pairs.slice(0, this.quickLimit)
      : sample.qa_pairs;

    console.log(
      `[LoCoMo] Evaluating ${questionsToEvaluate.length} questions (quick limit: ${this.quickLimit || "none"})`,
    );

    for (let i = 0; i < questionsToEvaluate.length; i++) {
      const qa = questionsToEvaluate[i];

      // Skip if already evaluated (from checkpoint)
      if (completedIndices.has(i)) {
        continue;
      }

      try {
        // Query memory using agent API (which has memory search tools built in)
        const response = await this.queryMemory(qa.question, sample);

        // Evaluate answer correctness using LLM judge
        let isCorrect = false;
        try {
          isCorrect =
            (await evaluateLLMJudge(qa.question, qa.answer, response)) === 1;
          console.log(
            `[Q${i + 1}] ${isCorrect ? "✓" : "✗"} Q: "${qa.question.substring(0, 60)}..." GT: "${qa.answer}"`,
          );
          if (!isCorrect) {
            console.log(
              `    Agent response: "${response.substring(0, 300)}..."`,
            );
          }
        } catch (judgeError) {
          const errMsg =
            judgeError instanceof Error
              ? judgeError.message
              : String(judgeError);
          console.log(
            `[Q${i + 1}] ✗ Judge failed: ${errMsg.substring(0, 100)}`,
          );
        }

        if (isCorrect) {
          correct++;
        }

        // Calculate additional metrics
        const metrics = calculateMetrics(response, qa.answer);

        const pred: Prediction = {
          question: qa.question,
          answer: qa.answer,
          response,
          prediction: response,
          ground_truth: qa.answer,
          category: String(qa.category),
          llm_score: isCorrect ? 1 : 0,
          correct: isCorrect,
          f1_score: metrics.f1,
          bleu_score: metrics.bleu1,
          bleu1: metrics.bleu1,
          bleu2: metrics.bleu2,
          bleu3: metrics.bleu3,
          bleu4: metrics.bleu4,
          evidence: qa.evidence,
        };

        predictions.push(pred);

        // Save checkpoint after each question
        checkpoint[i] = pred;
        await this.saveCheckpoint(sample.sample_id, checkpoint);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const errorCause =
          error instanceof Error && error.cause ? String(error.cause) : "";
        console.error(
          `Error evaluating question: ${errorMessage}${errorCause ? ` (cause: ${errorCause})` : ""}`,
        );

        const pred: Prediction = {
          question: qa.question,
          answer: qa.answer,
          response: `Error: ${errorMessage}`,
          prediction: `Error: ${errorMessage}`,
          ground_truth: qa.answer,
          category: String(qa.category),
          llm_score: 0,
          correct: false,
          f1_score: 0.0,
          bleu_score: 0.0,
          bleu1: 0.0,
          bleu2: 0.0,
          bleu3: 0.0,
          bleu4: 0.0,
          evidence: qa.evidence,
        };

        predictions.push(pred);

        // Save checkpoint after each question
        checkpoint[i] = pred;
        await this.saveCheckpoint(sample.sample_id, checkpoint);
      }
    }

    const total = sample.qa_pairs.length;

    return {
      sample_id: sample.sample_id,
      retrieval_mode: this.retrievalMode,
      total_questions: total,
      correct_answers: correct,
      accuracy: total > 0 ? correct / total : 0,
      token_usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
      predictions,
    };
  }

  /**
   * Query memory using the agent API.
   * The agent will search through ~/.openloomi/data/memory/bench/ for relevant information.
   */
  private async queryMemory(
    question: string,
    sample: LoCoMoSample,
  ): Promise<string> {
    const memoryPath = `~/.openloomi/data/memory/bench/${sample.sample_id}/`;
    const prompt = `Please answer the following question based on the information in your memory files.

Question: ${question}

IMPORTANT INSTRUCTIONS:
1. Search your memory files in the directory: ${memoryPath}
2. Read ALL .md files in this directory and its subdirectories to find the answer
3. When answering, you MUST perform TEMPORAL REASONING:
   - If a memory mentions relative time like "yesterday", "last week", "two months ago", etc.
   - Find the session date/time in the same memory file
   - Calculate the actual date by combining the relative reference with the session date
   - For example: if a session is dated "8 May, 2023" and someone says "I went yesterday", the actual date is "7 May 2023"
   - Another example: if a session is dated "4 May 2022" and someone says "went to India last year", the trip occurred in 2021
4. Always provide SPECIFIC DATES (like "7 May 2023") not vague terms like "recently" or "before"
5. If you see references like [Ref: D1:3], these refer to specific dialog turns - use them to find more context`;

    return await callAgentApi(prompt, this.port, this.authToken);
  }
}

export { findAvailablePort, DEFAULT_PORTS };
