/**
 * CL-bench and CL-bench-Life Evaluators.
 *
 * Uses OpenLoomi's /api/native/agent for answering questions.
 * CL-bench: Professional tasks with low reasoning effort.
 * CL-bench-Life: Everyday life tasks with high reasoning effort.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { mkdir, writeFile, readFile } from "node:fs/promises";

import type { CLBenchEntry, CLBenchPrediction, RubricResult } from "./types";
import {
  callAgentApi,
  readAuthToken,
  findAvailablePort,
  DEFAULT_PORTS,
} from "./memory-adapter";
import {
  evaluateRubrics,
  calculateMetrics,
  calculateTaskPassRate,
} from "./metrics";

export { findAvailablePort, DEFAULT_PORTS };

/**
 * Base class for CL-bench evaluators.
 */
abstract class BaseCLBenchEvaluator {
  protected port: number;
  protected authToken?: string;
  protected quickLimit?: number;
  protected checkpointDir: string;
  protected resume: boolean;
  protected reasoningEffort: "low" | "high";

  constructor(
    port?: number,
    tokenPath?: string,
    quickLimit?: number,
    resume = true,
    reasoningEffort: "low" | "high" = "low",
  ) {
    this.port = port || 3515;
    this.authToken = readAuthToken(tokenPath);
    this.quickLimit = quickLimit;
    this.resume = resume;
    this.reasoningEffort = reasoningEffort;
    this.checkpointDir = join(
      homedir(),
      ".openloomi",
      "data",
      "memory",
      "bench",
      "checkpoints",
      "clbench",
    );
  }

  setPort(port: number): void {
    this.port = port;
  }

  private getCheckpointPath(taskId: string): string {
    return join(this.checkpointDir, `${taskId}.json`);
  }

  protected async loadCheckpoint(
    taskId: string,
  ): Promise<CLBenchPrediction | null> {
    if (!this.resume) return null;
    try {
      const path = this.getCheckpointPath(taskId);
      const data = await readFile(path, "utf-8");
      return JSON.parse(data) as CLBenchPrediction;
    } catch {
      return null;
    }
  }

  protected async saveCheckpoint(
    taskId: string,
    prediction: CLBenchPrediction,
  ): Promise<void> {
    try {
      await mkdir(this.checkpointDir, { recursive: true });
      const path = this.getCheckpointPath(taskId);
      await writeFile(path, JSON.stringify(prediction, null, 2), "utf-8");
    } catch (error) {
      console.error(`Failed to save checkpoint: ${error}`);
    }
  }

  /**
   * Build prompt from entry messages.
   */
  protected buildPrompt(entry: CLBenchEntry): string {
    const parts: string[] = [];

    for (const msg of entry.messages) {
      if (msg.role === "system") {
        parts.push(`System: ${msg.content}`);
      } else if (msg.role === "user") {
        parts.push(`User: ${msg.content}`);
      }
      // assistant messages are the context, not added as prompt
    }

    return parts.join("\n\n");
  }

  /**
   * Extract final answer from reasoning trace if present.
   */
  protected extractFinalAnswer(response: string): string {
    // Try to find a final answer section
    const lowerResponse = response.toLowerCase();

    // Look for "final answer:" or "answer:" markers
    const finalAnswerMatch = response.match(
      /(?:final\s+answer|answer)[:\s]*(.+?)(?:\n|$)/i,
    );
    if (finalAnswerMatch) {
      return finalAnswerMatch[1].trim();
    }

    // If reasoning is detected (common patterns), try to extract the last substantive response
    if (
      lowerResponse.includes("reasoning") ||
      lowerResponse.includes("thinking") ||
      lowerResponse.includes("let me")
    ) {
      // Split by common reasoning patterns and take the last meaningful chunk
      const chunks = response.split(
        /(?:\n(?:step \d+|reasoning|thinking)[:\s*]?|\*\*\w+\*\*[:\s]*)/i,
      );
      if (chunks.length > 1) {
        const lastChunk = chunks[chunks.length - 1].trim();
        if (lastChunk.length > 10) {
          return lastChunk;
        }
      }
    }

    return response;
  }

  /**
   * Evaluate a single task.
   */
  async evaluateTask(entry: CLBenchEntry): Promise<CLBenchPrediction> {
    const taskId = entry.metadata.task_id;

    // Check for checkpoint (resume support)
    const checkpoint = await this.loadCheckpoint(taskId);
    if (checkpoint?.response && !checkpoint.response.startsWith("Error:")) {
      console.log(`[CL-bench] Resuming from checkpoint for task ${taskId}`);
      return checkpoint;
    }

    try {
      // Build prompt from entry messages
      const prompt = this.buildPrompt(entry);

      // Call the agent API
      const response = await callAgentApi(prompt, this.port, this.authToken);

      // Extract final answer if reasoning model
      const finalResponse = this.extractFinalAnswer(response);

      // Evaluate rubrics with GPT-5.1 judge
      const rubricResults = await evaluateRubrics(
        taskId,
        entry.messages,
        entry.rubrics,
        finalResponse,
        this.reasoningEffort,
      );

      // Calculate metrics (using first rubric as ground truth proxy if available)
      const groundTruth = entry.rubrics[0] || "";
      const metrics = calculateMetrics(finalResponse, groundTruth);

      // Determine if all rubrics passed
      const allRubricsPassed = calculateTaskPassRate(rubricResults);

      const pred: CLBenchPrediction = {
        task_id: taskId,
        category: entry.metadata.context_category,
        response: finalResponse,
        rubrics: rubricResults,
        all_rubrics_passed: allRubricsPassed,
        llm_score: allRubricsPassed ? 1 : 0,
        correct: allRubricsPassed,
        f1_score: metrics.f1,
        bleu_score: metrics.bleu1,
        bleu1: metrics.bleu1,
        bleu2: metrics.bleu2,
        bleu3: metrics.bleu3,
        bleu4: metrics.bleu4,
      };

      // Save checkpoint
      await this.saveCheckpoint(taskId, pred);

      console.log(
        `[${taskId}] ${allRubricsPassed ? "✓" : "✗"} Category: ${entry.metadata.context_category}`,
      );

      return pred;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`Error evaluating task ${taskId}: ${errorMessage}`);

      const pred: CLBenchPrediction = {
        task_id: taskId,
        category: entry.metadata.context_category,
        response: `Error: ${errorMessage}`,
        rubrics: entry.rubrics.map((r) => ({
          rubric: r,
          passed: false,
          reasoning: `Evaluation failed: ${errorMessage}`,
        })),
        all_rubrics_passed: false,
        llm_score: 0,
        correct: false,
        f1_score: 0.0,
        bleu_score: 0.0,
        bleu1: 0.0,
        bleu2: 0.0,
        bleu3: 0.0,
        bleu4: 0.0,
      };

      await this.saveCheckpoint(taskId, pred);
      return pred;
    }
  }
}

/**
 * Evaluator for CL-bench (professional tasks, low reasoning effort).
 */
export class CLBenchEvaluator extends BaseCLBenchEvaluator {
  constructor(
    port?: number,
    tokenPath?: string,
    quickLimit?: number,
    resume = true,
  ) {
    super(port, tokenPath, quickLimit, resume, "low");
  }
}

/**
 * Evaluator for CL-bench-Life (everyday life tasks, high reasoning effort).
 */
export class CLBenchLifeEvaluator extends BaseCLBenchEvaluator {
  constructor(
    port?: number,
    tokenPath?: string,
    quickLimit?: number,
    resume = true,
  ) {
    super(port, tokenPath, quickLimit, resume, "high");
  }
}
