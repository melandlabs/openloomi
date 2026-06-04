/**
 * CL-bench and CL-bench-Life Benchmark CLI
 *
 * Run via:
 *   pnpm benchmark:clbench -- --dataset dataset/clbench.jsonl --benchmark clbench --quick 5
 *   pnpm benchmark:clbench -- --dataset dataset/clbench-life.jsonl --benchmark clbench-life --quick 5
 */

import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { loadCLBenchDataset } from "./dataset";
import {
  CLBenchEvaluator,
  CLBenchLifeEvaluator,
  findAvailablePort,
  DEFAULT_PORTS,
} from "./evaluator";
import type {
  CLBenchPrediction,
  CLBenchEvaluationResult,
  CategoryMetrics,
} from "./types";
import { calculateCategoryMetrics } from "./metrics";
import { CATEGORY_NAMES, getCategories, type BenchmarkType } from "./scorer";

interface CliArgs {
  dataset: string;
  benchmark: BenchmarkType;
  quick?: number;
  output?: string;
  port?: number;
  tokenPath?: string;
  resume: boolean;
}

function parseCliArgs(): CliArgs {
  const args = process.argv.slice(2);
  const values: Record<string, string | number | boolean | undefined> = {
    resume: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dataset" || arg === "-d") {
      values.dataset = args[++i];
    } else if (arg === "--benchmark" || arg === "-b") {
      const bench = args[++i] as string;
      if (bench !== "clbench" && bench !== "clbench-life") {
        console.error("Error: --benchmark must be 'clbench' or 'clbench-life'");
        process.exit(1);
      }
      values.benchmark = bench as BenchmarkType;
    } else if (arg === "--quick" || arg === "-q") {
      values.quick = Number.parseInt(args[++i], 10);
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
      "Usage: pnpm benchmark:clbench -- --dataset path/to/clbench.jsonl --benchmark clbench",
    );
    process.exit(1);
  }

  if (!values.benchmark) {
    console.error("Error: --benchmark is required (clbench or clbench-life)");
    process.exit(1);
  }

  return {
    dataset: values.dataset as string,
    benchmark: values.benchmark as BenchmarkType,
    quick: values.quick as number | undefined,
    output: values.output as string | undefined,
    port: values.port as number | undefined,
    tokenPath: values.tokenPath as string | undefined,
    resume: values.resume !== false,
  };
}

async function printEvaluationSummary(
  predictions: CLBenchPrediction[],
  benchmark: BenchmarkType,
): Promise<void> {
  const categories = getCategories(benchmark);

  console.log("=".repeat(80));
  console.log(`CL-bench Evaluation Results (${benchmark})`);
  console.log("=".repeat(80));

  // Overall metrics
  const overallMetrics = calculateCategoryMetrics(predictions);

  console.log("\n📊 Overall Results:");
  console.log(`  Total Tasks: ${overallMetrics.count}`);
  console.log(
    `  Rubric Pass Rate: ${overallMetrics.rubric_pass_rate.toFixed(4)}`,
  );
  console.log(`  F1 Score (Mean): ${overallMetrics.f1_mean.toFixed(4)}`);
  console.log(`  BLEU-1 (Mean): ${overallMetrics.bleu1_mean.toFixed(4)}`);
  console.log(`  BLEU-4 (Mean): ${overallMetrics.bleu4_mean.toFixed(4)}`);

  // Results by category
  console.log(`\n${"=".repeat(80)}`);
  console.log("Results by Category");
  console.log("=".repeat(80));

  const resultsByCategory: Record<string, CLBenchPrediction[]> = {};

  for (const pred of predictions) {
    if (!resultsByCategory[pred.category]) {
      resultsByCategory[pred.category] = [];
    }
    resultsByCategory[pred.category].push(pred);
  }

  for (const category of categories) {
    const categoryResults = resultsByCategory[category] || [];
    if (categoryResults.length === 0) continue;

    const metrics = calculateCategoryMetrics(categoryResults);
    const displayName = CATEGORY_NAMES[category] || category;

    console.log(`\n${displayName}:`);
    console.log(`  Count: ${metrics.count}`);
    console.log(`  Rubric Pass Rate: ${metrics.rubric_pass_rate.toFixed(4)}`);
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
  const entries = await loadCLBenchDataset(args.dataset);
  console.log(`📊 Loaded ${entries.length} entries`);

  // Apply quick mode limit
  let filteredEntries = entries;
  if (args.quick) {
    filteredEntries = entries.slice(0, args.quick);
    console.log(`⚡ Quick mode: limiting to first ${args.quick} entries`);
  }

  console.log(
    `📊 Running ${args.benchmark} evaluation on ${filteredEntries.length} tasks\n`,
  );

  // Create evaluator
  const evaluator =
    args.benchmark === "clbench-life"
      ? new CLBenchLifeEvaluator(port, args.tokenPath, args.quick, args.resume)
      : new CLBenchEvaluator(port, args.tokenPath, args.quick, args.resume);

  const predictions: CLBenchPrediction[] = [];
  let rubricsPassed = 0;
  let rubricsTotal = 0;

  for (const entry of filteredEntries) {
    try {
      const pred = await evaluator.evaluateTask(entry);
      predictions.push(pred);

      rubricsTotal += entry.rubrics.length;
      rubricsPassed += pred.rubrics.filter((r) => r.passed).length;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `Error evaluating entry ${entry.metadata.task_id}: ${errorMessage}`,
      );

      // Create a failed prediction
      const failedPred: CLBenchPrediction = {
        task_id: entry.metadata.task_id,
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
      predictions.push(failedPred);

      rubricsTotal += entry.rubrics.length;
    }
  }

  // Print summary
  await printEvaluationSummary(predictions, args.benchmark);

  // Prepare output
  const overallRubricPassRate =
    rubricsTotal > 0 ? rubricsPassed / rubricsTotal : 0;

  // Calculate results by category
  const resultsByCategory: Record<string, CategoryMetrics> = {};
  const resultsByCategoryMap: Record<string, CLBenchPrediction[]> = {};

  for (const pred of predictions) {
    if (!resultsByCategoryMap[pred.category]) {
      resultsByCategoryMap[pred.category] = [];
    }
    resultsByCategoryMap[pred.category].push(pred);
  }

  for (const [category, categoryPreds] of Object.entries(
    resultsByCategoryMap,
  )) {
    const metrics = calculateCategoryMetrics(categoryPreds);
    const catRubricsPassed = categoryPreds.reduce(
      (sum, p) => sum + p.rubrics.filter((r) => r.passed).length,
      0,
    );
    const catRubricsTotal = categoryPreds.reduce(
      (sum, p) => sum + p.rubrics.length,
      0,
    );
    resultsByCategory[category] = {
      count: metrics.count,
      rubrics_passed: catRubricsPassed,
      rubrics_total: catRubricsTotal,
      rubric_pass_rate:
        catRubricsTotal > 0 ? catRubricsPassed / catRubricsTotal : 0,
    };
  }

  const output: CLBenchEvaluationResult = {
    benchmark: args.benchmark,
    num_tasks: predictions.length,
    num_rubrics_passed: rubricsPassed,
    num_rubrics_total: rubricsTotal,
    rubric_pass_rate: overallRubricPassRate,
    predictions,
    results_by_category: resultsByCategory,
  };

  // Save output if requested
  if (args.output) {
    await writeFile(args.output, JSON.stringify(output, null, 2), "utf-8");
    console.log(`\n💾 Results saved to: ${args.output}`);
  }

  return output;
}

main().catch(console.error);
