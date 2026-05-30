/**
 * LoCoMo Benchmark CLI
 *
 * Run via: pnpm benchmark:locomo -- --dataset path/to/locomo10.json --mode observation --quick
 */

import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { loadLoCoMoDatasetFromJson } from "./dataset";
import { LoCoMoEvaluator, findAvailablePort, DEFAULT_PORTS } from "./evaluator";
import { RetrievalMode } from "./types";
import type { EvaluationResult, Prediction } from "./types";
import { calculateCategoryMetrics } from "./metrics";
import { CATEGORY_NAMES } from "./scorer";

interface CliArgs {
  dataset: string;
  mode: RetrievalMode;
  samples?: string[];
  quick?: boolean;
  output?: string;
  port?: number;
  tokenPath?: string;
  resume: boolean;
}

function parseCliArgs(): CliArgs {
  // Simple manual argument parsing for flexibility
  const args = process.argv.slice(2);
  const values: Record<
    string,
    string | boolean | number | string[] | undefined
  > = { mode: "observation", quick: false, resume: true };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dataset" || arg === "-d") {
      values.dataset = args[++i];
    } else if (arg === "--mode" || arg === "-m") {
      values.mode = args[++i];
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
      "Usage: pnpm benchmark:locomo -- --dataset path/to/locomo10.json --mode observation",
    );
    process.exit(1);
  }

  const mode = values.mode as RetrievalMode;
  if (!Object.values(RetrievalMode).includes(mode)) {
    console.error(
      `Error: Invalid mode '${mode}'. Must be one of: ${Object.values(RetrievalMode).join(", ")}`,
    );
    process.exit(1);
  }

  let samples: string[] | undefined;
  if (values.samples) {
    samples = values.samples.split(",").map((s: string) => s.trim());
  }

  return {
    dataset: values.dataset,
    mode,
    samples,
    quick: values.quick,
    output: values.output,
    port: values.port,
    tokenPath: values.tokenPath,
    resume: values.resume !== false,
  };
}

async function printEvaluationSummary(
  resultsByCategory: Record<string, Prediction[]>,
): Promise<void> {
  console.log("=".repeat(80));
  console.log("LoCoMo Evaluation Results Summary");
  console.log("=".repeat(80));

  // Calculate overall metrics
  const allResults: Prediction[] = [];
  for (const [category, results] of Object.entries(resultsByCategory)) {
    // Skip category 5 (adversarial questions)
    if (category === "5") {
      continue;
    }
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
  console.log("Results by Category");
  console.log("=".repeat(80));

  for (const category of Object.keys(resultsByCategory).sort()) {
    // Skip category 5
    if (category === "5") {
      continue;
    }

    const results = resultsByCategory[category];
    const metrics = calculateCategoryMetrics(results);

    const categoryName = CATEGORY_NAMES[category] || `category_${category}`;
    console.log(`\nCategory ${category} (${categoryName}):`);
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
  const samples = await loadLoCoMoDatasetFromJson(args.dataset);

  // Filter samples if sample_ids provided
  let filteredSamples = samples;
  if (args.samples && args.samples.length > 0) {
    filteredSamples = samples.filter((s) =>
      args.samples?.includes(s.sample_id),
    );
    console.log(`🔍 Filtered to ${filteredSamples.length} samples by ID`);
  }

  // Apply quick mode (first 5 questions only)
  if (args.quick) {
    console.log("⚡ Quick mode: limiting to first 5 questions per sample");
  }

  console.log(
    `📊 Loaded ${filteredSamples.length} LoCoMo samples for evaluation`,
  );
  console.log(`🔧 Retrieval mode: ${args.mode}\n`);

  // Run evaluation
  const resultsBySample: EvaluationResult[] = [];
  const allPredictionsByCategory: Record<string, Prediction[]> = {};

  for (const sample of filteredSamples) {
    const evaluator = new LoCoMoEvaluator(
      args.mode,
      port,
      args.tokenPath,
      args.quick ? 5 : undefined,
      args.resume,
    );

    try {
      // Load sample into storage
      await evaluator.loadSample(sample);

      // Evaluate QA
      const result = await evaluator.evaluateQA(sample);
      resultsBySample.push(result);

      // Organize predictions by category
      for (const pred of result.predictions) {
        const category = pred.category;
        if (!allPredictionsByCategory[category]) {
          allPredictionsByCategory[category] = [];
        }
        allPredictionsByCategory[category].push(pred);
      }

      console.log(
        `Sample ${sample.sample_id}: ${result.correct_answers}/${result.total_questions} correct (${(result.accuracy * 100).toFixed(2)}%)`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `Error evaluating sample ${sample.sample_id}: ${errorMessage}`,
      );

      resultsBySample.push({
        sample_id: sample.sample_id,
        retrieval_mode: args.mode,
        total_questions: sample.qa_pairs.length,
        correct_answers: 0,
        accuracy: 0,
        token_usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
        predictions: [],
        error: errorMessage,
      });
    }
  }

  // Aggregate results
  const totalQuestions = resultsBySample.reduce(
    (sum, r) => sum + (r.total_questions || 0),
    0,
  );
  const totalCorrect = resultsBySample.reduce(
    (sum, r) => sum + (r.correct_answers || 0),
    0,
  );
  const overallAccuracy =
    totalQuestions > 0 ? totalCorrect / totalQuestions : 0;

  const totalTokens = resultsBySample.reduce(
    (sum, r) => sum + (r.token_usage?.total_tokens || 0),
    0,
  );

  // Print summary
  await printEvaluationSummary(allPredictionsByCategory);

  // Prepare output
  const output = {
    retrieval_mode: args.mode,
    num_samples: resultsBySample.length,
    total_questions: totalQuestions,
    total_correct: totalCorrect,
    overall_accuracy: overallAccuracy,
    total_tokens: totalTokens,
    results_by_sample: resultsBySample.map((r) => ({
      sample_id: r.sample_id,
      accuracy: r.accuracy,
      correct: r.correct_answers,
      total: r.total_questions,
      token_usage: r.token_usage,
      error: r.error,
    })),
    results_by_category: allPredictionsByCategory,
  };

  // Save output if requested
  if (args.output) {
    await writeFile(args.output, JSON.stringify(output, null, 2), "utf-8");
    console.log(`\n💾 Results saved to: ${args.output}`);
  }

  return output;
}

main().catch(console.error);
