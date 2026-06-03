# LongMemEval Benchmark

Benchmark suite for evaluating OpenLoomi's long-term memory retrieval system using the dataset.

## Overview

This benchmark evaluates how well the memory system answers questions from conversation history. It tests end-to-end query accuracy rather than retrieval recall - the system must not only retrieve the correct session but also correctly answer the question.

## Dataset

The LongMemEval dataset contains 500 question-answer pairs from conversation history. Each entry includes:

- **Conversation history** - Multi-session conversations between two people
- **Questions** - Queries about facts, preferences, temporal events, and multi-session information
- **Gold answers** - Ground truth answers for evaluation
- **Answer session IDs** - Which sessions contain the answer

### Question Types

| Type                        | Count | Description                                                  |
| --------------------------- | ----- | ------------------------------------------------------------ |
| `single-session-user`       | 70    | Questions about user preferences/facts from a single session |
| `single-session-preference` | 30    | Preference-related questions from one session                |
| `single-session-assistant`  | 56    | Questions about assistant behavior from one session          |
| `multi-session`             | 133   | Questions requiring information from multiple sessions       |
| `temporal-reasoning`        | 133   | Questions requiring date/time reasoning                      |
| `knowledge-update`          | 78    | Questions about evolving knowledge over time                 |

## Setup

```bash
# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env
```

Edit `.env` to add your API keys:

```env
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

## Dataset Download

The dataset is downloaded automatically or can be placed manually:

```bash
# Download from HuggingFace
curl -sL "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json" \
  -o dataset/longmemeval_s_cleaned.json
```

## Usage

```bash
# Run full benchmark
pnpm benchmark -- --dataset dataset/longmemeval_s_cleaned.json

# Quick mode (first 5 entries)
pnpm benchmark -- --dataset dataset/longmemeval_s_cleaned.json --quick

# Run with specific question IDs
pnpm benchmark -- --dataset dataset/longmemeval_s_cleaned.json --samples qid1,qid2,qid3

# Save results to file
pnpm benchmark -- --dataset dataset/longmemeval_s_cleaned.json --output results.json
```

### CLI Options

| Flag          | Short | Description                         | Default            |
| ------------- | ----- | ----------------------------------- | ------------------ |
| `--dataset`   | `-d`  | Path to LongMemEval JSON dataset    | Required           |
| `--samples`   | `-s`  | Comma-separated question IDs to run | All                |
| `--quick`     | `-q`  | Limit to first 5 entries            | false              |
| `--output`    | `-o`  | Save results JSON to path           | None               |
| `--port`      | `-p`  | API port for agent                  | Auto-discover      |
| `--token`     | `-t`  | Path to auth token                  | ~/.openloomi/token |
| `--resume`    |       | Resume from checkpoints             | true               |
| `--no-resume` |       | Start fresh (don't resume)          | false              |

## Output

The benchmark outputs:

- **Overall accuracy** - LLM judge accuracy across all question types
- **Per-type metrics** - F1, BLEU-1, BLEU-4 scores by question type
- **Per-question predictions** - Individual question results
- **Token totals** - Combined API token consumption

### Metrics

- **LLM Judge Accuracy** - Whether the LLM judge considers the answer correct
- **F1 Score** - Token-level precision/recall
- **BLEU-1/4** - N-gram overlap with brevity penalty

## Architecture

```
src/
├── index.ts           # CLI entry point
├── evaluator.ts       # LongMemEvalEvaluator - loads entries, runs QA evaluation
├── memory-adapter.ts  # InMemoryStorageAdapter + agent API calls
├── dataset.ts         # LongMemEval JSON parsing
├── metrics.ts         # BLEU, F1, LLM judge evaluation
├── scorer.ts          # Question type name mapping
├── prompts.ts         # LLM judge prompt template
├── contracts.ts       # MemoryStorageAdapter interface
└── types.ts           # TypeScript types
```

## Requirements

- Node.js 18+
- pnpm
- OpenLoomi API running on localhost (port auto-discovery or specify with `--port`)
- OpenRouter API key (for LLM judge evaluation)
