# CL-bench Benchmark

CL-bench (Context Learning Benchmark) is Tencent's benchmark for evaluating context learning capabilities of AI models.

## Variants

- **CL-bench**: 1,899 tasks across 4 professional categories (Domain Knowledge Reasoning, Language Understanding, Information Extraction, Text Generation)
- **CL-bench-Life**: 405 tasks across 3 everyday life categories (Communication & Social Interactions, Daily Life Planning, Task Assistance)

## Setup

```bash
cd benchmark/clbench
pnpm install
```

## Download Datasets

```bash
# CL-bench (1,899 tasks)
curl -sL "https://huggingface.co/datasets/tencent/CL-bench/resolve/main/CL-bench.jsonl" -o dataset/clbench.jsonl

# CL-bench-Life (405 tasks)
curl -sL "https://huggingface.co/datasets/tencent/CL-bench-Life/resolve/main/CL-bench%20Life.jsonl" -o dataset/clbench-life.jsonl
```

## Configuration

Create a `.env` file with your OpenRouter API key for rubric evaluation:

```bash
OPENROUTER_API_KEY=your-api-key-here
```

## Usage

```bash
# Run CL-bench (professional tasks, low reasoning effort)
pnpm benchmark -- --dataset dataset/clbench.jsonl --benchmark clbench

# Run CL-bench-Life (everyday life tasks, high reasoning effort)
pnpm benchmark -- --dataset dataset/clbench-life.jsonl --benchmark clbench-life

# Quick test with first 5 tasks
pnpm benchmark -- --dataset dataset/clbench.jsonl --benchmark clbench --quick 5

# Specify API port
pnpm benchmark -- --dataset dataset/clbench.jsonl --benchmark clbench --port 3515

# Resume from checkpoints (enabled by default)
pnpm benchmark -- --dataset dataset/clbench.jsonl --benchmark clbench --resume

# Save output to file
pnpm benchmark -- --dataset dataset/clbench.jsonl --benchmark clbench --output results.json
```

## CLI Options

| Option               | Description                                |
| -------------------- | ------------------------------------------ |
| `--dataset <path>`   | Path to JSONL dataset (required)           |
| `--benchmark <type>` | `clbench` or `clbench-life` (required)     |
| `--quick <n>`        | Limit to first N tasks                     |
| `--port <n>`         | API port (default: auto-discover)          |
| `--token <path>`     | Auth token path                            |
| `--output <path>`    | Save results JSON to path                  |
| `--resume`           | Resume from checkpoints (default: enabled) |
| `--no-resume`        | Disable checkpoint resume                  |

## Checkpoints

Evaluations are checkpointed to:

```
~/.openloomi/data/memory/bench/checkpoints/clbench/
```

Each task's result is saved individually for resume support.

## Output Format

```json
{
  "benchmark": "clbench",
  "num_tasks": 5,
  "num_rubrics_passed": 12,
  "num_rubrics_total": 25,
  "rubric_pass_rate": 0.48,
  "predictions": [
    {
      "task_id": "...",
      "category": "Rule System Application",
      "response": "...",
      "rubrics": [{ "rubric": "...", "passed": true, "reasoning": "..." }],
      "all_rubrics_passed": false,
      "llm_score": 0,
      "correct": false,
      "f1_score": 0.0357,
      "bleu_score": 0.036,
      "bleu1": 0.036,
      "bleu2": 0.02,
      "bleu3": 0.01,
      "bleu4": 0.0
    }
  ],
  "results_by_category": {
    "Rule System Application": {
      "count": 5,
      "rubrics_passed": 12,
      "rubrics_total": 25,
      "rubric_pass_rate": 0.48
    }
  }
}
```

## Architecture

```
src/
├── index.ts        # CLI entry point
├── evaluator.ts    # CLBenchEvaluator, CLBenchLifeEvaluator
├── metrics.ts      # BLEU/F1, rubric evaluation with GPT judge
├── dataset.ts      # JSONL loading
├── types.ts        # TypeScript interfaces
├── prompts.ts      # Rubric evaluation prompts
├── scorer.ts       # Category mappings
├── memory-adapter.ts  # callAgentApi, port discovery
└── contracts.ts    # MemoryStorageAdapter interface
```

## Requirements

- Node.js 18+
- pnpm
- OpenLoomi server running on port 3515 (or auto-discovered)
- OpenRouter API key for rubric evaluation
