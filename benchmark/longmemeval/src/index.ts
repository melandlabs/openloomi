/**
 * LongMemEval Benchmark CLI
 *
 * Run via: pnpm benchmark:longmemeval -- --dataset dataset/longmemeval_s_cleaned.json --quick
 */

import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { loadLongMemEvalDatasetFromJson } from "./dataset";
import { LongMemEvalEvaluator } from "./evaluator";
import { findAvailablePort, DEFAULT_PORTS } from "./memory-adapter";
import type { EvaluationResult, Prediction } from "./types";
import { calculateCategoryMetrics } from "./metrics";
import { QUESTION_TYPE_NAMES } from "./scorer";

interface CliArgs {
  dataset: string;
  samples?: string[];
  quick?: boolean;
  output?: string;
  port?: number;
  tokenPath?: string;
  resume: boolean;
}

function parseCliArgs(): CliArgs {
  const args = process.argv.slice(2);
  const values: Record<
    string,
    string | boolean | number | string[] | undefined
  > = {
    quick: false,
    resume: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dataset" || arg === "-d") {
      values.dataset = args[++i];
    } else if (arg === "--samples" || arg === "-s") {
      values.samples = args[++i];
    } else if (arg === "--quick" || arg === "-q") {
      values.quick = true;
    } else if (arg === "--output" || arg === "-o") {
      values.output = args[++i];
    } else if (arg === "--port" || arg === "-p") {
      values.port = Number.parseInt(args[++i], 10);
    } else if (arg === "--token" || arg === "-t") {
      values.tokenPath = args[++i];
    } else if (arg === "--resume") {
      values.resume = true;
    } else if (arg === "--no-resume") {
      values.resume = false;
    }
  }

  if (!values.dataset) {
    console.error("Error: --dataset is required");
    console.error(
      "Usage: pnpm benchmark:longmemeval -- --dataset path/to/longmemeval_s_cleaned.json --quick",
    );
    process.exit(1);
  }

  let samples: string[] | undefined;
  if (values.samples) {
    samples = (values.samples as string)
      .split(",")
      .map((s: string) => s.trim());
  }

  return {
    dataset: values.dataset as string,
    samples,
    quick: values.quick as boolean,
    output: values.output as string | undefined,
    port: values.port as number | undefined,
    tokenPath: values.tokenPath as string | undefined,
    resume: values.resume !== false,
  };
}

async function printEvaluationSummary(
  resultsByType: Record<string, Prediction[]>,
): Promise<void> {
  console.log("=".repeat(80));
  console.log("LongMemEval Evaluation Results Summary");
  console.log("=".repeat(80));

  // Calculate overall metrics
  const allResults: Prediction[] = [];
  for (const [, results] of Object.entries(resultsByType)) {
    allResults.push(...results);
  }

  const overallMetrics = calculateCategoryMetrics(allResults);

  console.log("\n📊 Overall Results:");
  console.log(`  Total Questions: ${overallMetrics.count}`);
  console.log(
    `  LLM Judge Accuracy: ${overallMetrics.llm_judge_accuracy.toFixed(4)} (${overallMetrics.llm_judge_correct}/${overallMetrics.count})`,
  );
  console.log(`  F1 Score (Mean): ${overallMetrics.f1_mean.toFixed(4)}`);
  console.log(`  BLEU-1 (Mean): ${overallMetrics.bleu1_mean.toFixed(4)}`);
  console.log(`  BLEU-4 (Mean): ${overallMetrics.bleu4_mean.toFixed(4)}`);

  console.log(`\n${"=".repeat(80)}`);
  console.log("Results by Question Type");
  console.log("=".repeat(80));

  for (const [qtype, results] of Object.entries(resultsByType).sort()) {
    const metrics = calculateCategoryMetrics(results);
    const typeName = QUESTION_TYPE_NAMES[qtype] || qtype;

    console.log(`\n${qtype} (${typeName}):`);
    console.log(`  Count: ${metrics.count}`);
    console.log(
      `  LLM Judge Accuracy: ${metrics.llm_judge_accuracy.toFixed(4)} (${metrics.llm_judge_correct}/${metrics.count})`,
    );
    console.log(`  F1 Score: ${metrics.f1_mean.toFixed(4)}`);
    console.log(`  BLEU-1: ${metrics.bleu1_mean.toFixed(4)}`);
    console.log(`  BLEU-4: ${metrics.bleu4_mean.toFixed(4)}`);
  }

  console.log(`\n${"=".repeat(80)}`);
}

async function main() {
  const args = parseCliArgs();

  // Discover API port if not specified
  let port = args.port;
  if (!port) {
    try {
      port = await findAvailablePort();
      console.log(`🔌 Auto-discovered API port: ${port}`);
    } catch (error) {
      console.error(`Failed to discover API port: ${error}`);
      console.log(`Available ports: ${DEFAULT_PORTS.join(", ")}`);
      console.log("Specify port with --port flag");
      process.exit(1);
    }
  } else {
    console.log(`🔌 Using specified API port: ${port}`);
  }

  console.log(`\n📁 Loading dataset from: ${args.dataset}`);
  const entries = await loadLongMemEvalDatasetFromJson(args.dataset);

  // Filter entries if sample_ids provided
  let filteredEntries = entries;
  if (args.samples && args.samples.length > 0) {
    filteredEntries = entries.filter((e) =>
      args.samples?.includes(e.question_id),
    );
    console.log(`🔍 Filtered to ${filteredEntries.length} entries by ID`);
  }

  // Apply quick mode (first 5 entries only)
  if (args.quick) {
    filteredEntries = filteredEntries.slice(0, 5);
    console.log("⚡ Quick mode: limiting to first 5 entries");
  }

  console.log(
    `📊 Loaded ${filteredEntries.length} LongMemEval entries for evaluation\n`,
  );

  // Run evaluation
  const allPredictionsByType: Record<string, Prediction[]> = {};
  let correct = 0;
  let total = 0;

  for (const entry of filteredEntries) {
    const evaluator = new LongMemEvalEvaluator(
      port,
      args.tokenPath,
      undefined,
      args.resume,
    );

    try {
      // Load entry into storage
      await evaluator.loadEntry(entry);

      // Evaluate question
      const pred = await evaluator.evaluateQuestion(entry);

      // Organize predictions by question type
      const qtype = pred.question_type;
      if (!allPredictionsByType[qtype]) {
        allPredictionsByType[qtype] = [];
      }
      allPredictionsByType[qtype].push(pred);

      if (pred.correct) {
        correct++;
      }
      total++;

      console.log(
        `  ${entry.question_id}: ${pred.correct ? "✓" : "✗"} (${pred.question_type})`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `Error evaluating entry ${entry.question_id}: ${errorMessage}`,
      );

      // Record failed prediction
      const failedPred: Prediction = {
        question: entry.question,
        answer: entry.answer,
        response: `Error: ${errorMessage}`,
        prediction: `Error: ${errorMessage}`,
        ground_truth: entry.answer,
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

      const qtype = entry.question_type;
      if (!allPredictionsByType[qtype]) {
        allPredictionsByType[qtype] = [];
      }
      allPredictionsByType[qtype].push(failedPred);
      total++;
    }
  }

  // Print summary
  await printEvaluationSummary(allPredictionsByType);

  // Prepare output
  const overallAccuracy = total > 0 ? correct / total : 0;

  const output = {
    num_entries: filteredEntries.length,
    total_questions: total,
    total_correct: correct,
    overall_accuracy: overallAccuracy,
    results_by_type: Object.fromEntries(
      Object.entries(allPredictionsByType).map(([qtype, preds]) => {
        const metrics = calculateCategoryMetrics(preds);
        return [
          qtype,
          {
            count: metrics.count,
            accuracy: metrics.llm_judge_accuracy,
            f1_mean: metrics.f1_mean,
            bleu1_mean: metrics.bleu1_mean,
            bleu4_mean: metrics.bleu4_mean,
            predictions: preds.map((p) => ({
              question_id: p.question.slice(0, 50),
              correct: p.correct,
              llm_score: p.llm_score,
              f1_score: p.f1_score,
            })),
          },
        ];
      }),
    ),
    predictions: Object.values(allPredictionsByType).flat(),
  };

  // Save output if requested
  if (args.output) {
    await writeFile(args.output, JSON.stringify(output, null, 2), "utf-8");
    console.log(`\n💾 Results saved to: ${args.output}`);
  }

  return output;
}

main().catch(console.error);
