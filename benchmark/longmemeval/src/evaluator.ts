/**
 * LongMemEval Evaluator for Memory System.
 *
 * Uses OpenLoomi's MemoryStorageAdapter interface with in-memory implementation
 * for benchmarking the memory system. Now uses /api/native/agent for answering questions.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import type { MemoryRecord } from "./contracts";

import type { LongMemEvalEntry, EvaluationResult, Prediction } from "./types";
import {
  InMemoryStorageAdapter,
  callAgentApi,
  readAuthToken,
  findAvailablePort,
  DEFAULT_PORTS,
} from "./memory-adapter";
import { calculateMetrics, evaluateLLMJudge } from "./metrics";

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
 * Write memory records to ~/.openloomi/data/memory/bench/ folder.
 * Each session becomes a memory file.
 */
async function writeMemoryFiles(
  entry: LongMemEvalEntry,
  records: MemoryRecord[],
): Promise<void> {
  const memoryDir = join(
    homedir(),
    ".openloomi",
    "data",
    "memory",
    "bench",
    `longmemeval_${entry.question_id}`,
  );

  await mkdir(memoryDir, { recursive: true });

  for (const record of records) {
    const filename = `${record.id}.md`;
    const filepath = join(memoryDir, filename);

    const content = `# ${record.dimensions?.type || "memory"} - ${entry.question_id}\n\n${record.text}`;
    await writeFile(filepath, content, "utf-8");
  }

  console.log(
    `[LongMemEval] Wrote ${records.length} memory files to ${memoryDir}`,
  );
}

/**
 * Convert LongMemEval entry haystack sessions into memory records.
 */
function createMemoryRecordsFromEntry(entry: LongMemEvalEntry): MemoryRecord[] {
  const records: MemoryRecord[] = [];

  const { haystack_sessions, haystack_session_ids, haystack_dates } = entry;

  for (
    let i = 0;
    i < Math.min(haystack_sessions.length, haystack_session_ids.length);
    i++
  ) {
    const session = haystack_sessions[i];
    const sessionId = haystack_session_ids[i];
    const date = haystack_dates[i] ?? "";

    // Build session content
    const parts: string[] = [];
    parts.push(`# Conversation Session ${sessionId}`);
    if (date) {
      parts.push(`# Date: ${date}`);
    }
    parts.push("");

    for (const turn of session) {
      const role = turn.role === "user" ? "User" : "Assistant";
      parts.push(`${role}: ${turn.content}`);
    }

    const content = parts.join("\n");
    const id = sessionId;

    records.push({
      id,
      userId: "benchmark_user",
      timestamp: parseTimestamp(date) || Date.now(),
      text: content,
      tier: "long",
      dimensions: {
        sample_id: entry.question_id,
        session_id: sessionId,
        type: "session",
      },
      metadata: {
        questionId: entry.question_id,
        sessionId,
        contentType: "session",
      },
    });
  }

  return records;
}

/**
 * Evaluator for LongMemEval benchmark using OpenLoomi Memory API.
 */
export { findAvailablePort, DEFAULT_PORTS };

export class LongMemEvalEvaluator {
  private storage: InMemoryStorageAdapter;
  private port: number;
  private authToken?: string;
  private quickLimit?: number;
  private checkpointDir: string;
  private resume: boolean;

  constructor(
    port?: number,
    tokenPath?: string,
    quickLimit?: number,
    resume = true,
  ) {
    this.storage = new InMemoryStorageAdapter();
    this.port = port || 3515;
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
      "longmemeval",
    );
  }

  /**
   * Set API port (for auto-discovery).
   */
  setPort(port: number): void {
    this.port = port;
  }

  /**
   * Get checkpoint file path for a question.
   */
  private getCheckpointPath(questionId: string): string {
    return join(this.checkpointDir, `${questionId}.json`);
  }

  /**
   * Load checkpoint for a question if it exists.
   */
  private async loadCheckpoint(questionId: string): Promise<Prediction | null> {
    if (!this.resume) return null;
    try {
      const path = this.getCheckpointPath(questionId);
      const data = await readFile(path, "utf-8");
      return JSON.parse(data) as Prediction;
    } catch {
      return null;
    }
  }

  /**
   * Save checkpoint after evaluation.
   */
  private async saveCheckpoint(
    questionId: string,
    prediction: Prediction,
  ): Promise<void> {
    try {
      await mkdir(this.checkpointDir, { recursive: true });
      const path = this.getCheckpointPath(questionId);
      await writeFile(path, JSON.stringify(prediction, null, 2), "utf-8");
    } catch (error) {
      console.error(`Failed to save checkpoint: ${error}`);
    }
  }

  /**
   * Load a LongMemEval entry into the memory system.
   */
  async loadEntry(entry: LongMemEvalEntry): Promise<void> {
    this.storage.clear();

    const records = createMemoryRecordsFromEntry(entry);

    for (const record of records) {
      this.storage.addRecord(record);
    }

    await writeMemoryFiles(entry, records);

    console.log(
      `[LongMemEval] Loaded ${records.length} session records for question ${entry.question_id}`,
    );
  }

  /**
   * Evaluate a single question.
   */
  async evaluateQuestion(entry: LongMemEvalEntry): Promise<Prediction> {
    // Check for checkpoint (resume support) - only use if not an error
    const checkpoint = await this.loadCheckpoint(entry.question_id);
    if (checkpoint?.response && !checkpoint.response.startsWith("Error:")) {
      console.log(
        `[LongMemEval] Resuming from checkpoint for question ${entry.question_id}`,
      );
      return checkpoint;
    }

    // Convert answer to string (may be number in dataset)
    const answerStr = String(entry.answer);

    try {
      const response = await this.queryMemory(entry);

      // Evaluate answer correctness using LLM judge
      let isCorrect = false;
      try {
        isCorrect =
          (await evaluateLLMJudge(entry.question, answerStr, response)) === 1;
        console.log(
          `[Q] ${isCorrect ? "✓" : "✗"} Q: "${entry.question.substring(0, 60)}..." GT: "${answerStr}"`,
        );
        if (!isCorrect) {
          console.log(`    Agent response: "${response.substring(0, 300)}..."`);
        }
      } catch (judgeError) {
        const errMsg =
          judgeError instanceof Error ? judgeError.message : String(judgeError);
        console.log(`[Q] ✗ Judge failed: ${errMsg.substring(0, 100)}`);
      }

      // Calculate additional metrics
      const metrics = calculateMetrics(response, answerStr);

      const pred: Prediction = {
        question: entry.question,
        answer: answerStr,
        response,
        prediction: response,
        ground_truth: answerStr,
        question_type: entry.question_type,
        llm_score: isCorrect ? 1 : 0,
        correct: isCorrect,
        f1_score: metrics.f1,
        bleu_score: metrics.bleu1,
        bleu1: metrics.bleu1,
        bleu2: metrics.bleu2,
        bleu3: metrics.bleu3,
        bleu4: metrics.bleu4,
        evidence_session_ids: entry.answer_session_ids,
      };

      // Save checkpoint
      await this.saveCheckpoint(entry.question_id, pred);

      return pred;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`Error evaluating question: ${errorMessage}`);

      const pred: Prediction = {
        question: entry.question,
        answer: answerStr,
        response: `Error: ${errorMessage}`,
        prediction: `Error: ${errorMessage}`,
        ground_truth: answerStr,
        question_type: entry.question_type,
        llm_score: 0,
        correct: false,
        f1_score: 0.0,
        bleu_score: 0.0,
        bleu1: 0.0,
        bleu2: 0.0,
        bleu3: 0.0,
        bleu4: 0.0,
        evidence_session_ids: entry.answer_session_ids,
      };

      await this.saveCheckpoint(entry.question_id, pred);
      return pred;
    }
  }

  /**
   * Query memory using the agent API.
   */
  private async queryMemory(entry: LongMemEvalEntry): Promise<string> {
    const memoryPath = `~/.openloomi/data/memory/bench/longmemeval_${entry.question_id}/`;

    // Build date context for temporal reasoning
    const dateRange =
      entry.haystack_dates.length > 0
        ? `${Math.min(...entry.haystack_dates.map((d) => new Date(d).getTime())) > 0 ? entry.haystack_dates.sort()[0] : "unknown"} to ${entry.haystack_dates.sort()[entry.haystack_dates.length - 1]}`
        : "unknown";

    const prompt = `Please answer the following question based on the information in your memory files.

Question: ${entry.question}
${entry.question_date ? `(This question was asked on: ${entry.question_date})` : ""}

IMPORTANT INSTRUCTIONS:
1. Search your memory files in the directory: ${memoryPath}
2. Read ALL .md files in this directory and its subdirectories to find the answer. Do NOT stop reading until you have checked every single file. Count the total number of files first, then read each one completely.
3. The memory files contain conversation history between two people
4. Pay attention to specific facts mentioned - the question is asking about the other person's life/experiences
5. CRITICAL: Distinguish between PLANNED/FUTURE actions ("I will...", "I'm going to...", "I plan to...") and COMPLETED/PAST actions ("I did...", "I have...", "I finished..."). A plan is NOT the same as an actual event. If someone SAYS they will do something but there's no later confirmation they actually did it, the answer should reflect that the action was NOT completed.

${
  entry.question_type === "temporal-reasoning"
    ? `\
6. For temporal questions:
   - ALWAYS find the EXACT date/time from each relevant memory file
   - Find when the event happened AND when the reference point is (e.g., "when did I go on my 10th jog outdoors?")
   - Calculate the EXACT difference in days/weeks/months
   - If question asks "how many weeks had passed since X when Y", find the date of X and the date of Y, then subtract
   - Use the session date shown at the top of each file as the authoritative date
   - Verify your calculation before answering
   - IMPORTANT: When the question asks about something like "when did X happen", check if the memory file contains actual completion of X, not just planning to do X`
    : `\
6. The conversation memories span from ${dateRange}. When answering temporal questions (e.g., "how many weeks ago", "how many months ago"), use the DATE shown at the top of each memory file (the session date), NOT today's date. Calculate the time difference from THAT session date.`
}

${
  entry.question_type === "multi-session"
    ? `\
7. For counting questions across multiple sessions:
   - FIRST: List ALL ${entry.haystack_sessions?.length || "?"} memory files and confirm you have read each one
   - Go through EVERY memory file systematically - do not skip any, even if you think you found the answer early
   - Keep a running list of every item you find with the source file
   - If the question asks "how many X", list each X you found with the file it came from
   - Make sure you don't count the same item twice
   - Add up the total count carefully
   - Do NOT stop reading at the first file that seems to answer the question - later files may have additional relevant information`
    : ""
}

${
  entry.question_type === "knowledge-update"
    ? `\
7. For knowledge-update questions:
   - Look for information that has been explicitly stated as completed or confirmed
   - If you only find someone planning to do something ("I will...", "I'm going to...") but no confirmation they actually did it, the information should be considered "not updated" or "not available"
   - If the information is not explicitly mentioned in any memory file, respond: "I don't know" or "The information is not available in my memory." Do NOT guess or infer.`
    : ""
}

${
  entry.question_type === "single-session-preference"
    ? `\
7. For preference questions, if no relevant preference information exists in the memory files, respond: "I don't know" or "I don't have information about your preference for this topic."`
    : ""
}

7. Provide a specific answer based on the evidence in the memories
8. If you cannot find the answer, say you don't know rather than guessing`;

    return await callAgentApi(prompt, this.port, this.authToken);
  }
}
