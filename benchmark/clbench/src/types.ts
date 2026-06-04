/**
 * Types for CL-bench and CL-bench-Life benchmarks.
 */

export interface CLBenchMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CLBenchEntry {
  messages: CLBenchMessage[];
  rubrics: string[];
  metadata: {
    task_id: string;
    context_category: string;
  };
}

export interface RubricResult {
  rubric: string;
  passed: boolean;
  reasoning?: string;
}

export interface CLBenchPrediction {
  task_id: string;
  category: string;
  response: string;
  rubrics: RubricResult[];
  all_rubrics_passed: boolean;
  llm_score: number;
  correct: boolean;
  f1_score: number;
  bleu_score: number;
  bleu1: number;
  bleu2: number;
  bleu3: number;
  bleu4: number;
}

export interface CLBenchEvaluationResult {
  benchmark: "clbench" | "clbench-life";
  num_tasks: number;
  num_rubrics_passed: number;
  num_rubrics_total: number;
  rubric_pass_rate: number;
  predictions: CLBenchPrediction[];
  results_by_category: Record<string, CategoryMetrics>;
}

export interface CategoryMetrics {
  count: number;
  rubrics_passed: number;
  rubrics_total: number;
  rubric_pass_rate: number;
}
