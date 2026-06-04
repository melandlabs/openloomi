/**
 * CL-bench dataset loader.
 */

import { readFile } from "node:fs/promises";
import type { CLBenchEntry } from "./types";

/**
 * Load CL-bench dataset from JSONL file.
 */
export async function loadCLBenchDataset(
  jsonlPath: string,
): Promise<CLBenchEntry[]> {
  const content = await readFile(jsonlPath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim().length > 0);

  const entries: CLBenchEntry[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      entries.push(parsed as CLBenchEntry);
    } catch (error) {
      console.warn(`Failed to parse line: ${error}`);
    }
  }

  return entries;
}

/**
 * Download dataset from HuggingFace Hub.
 *
 * Usage:
 *   npx huggingface-cli download tencent/CL-bench CL-bench.jsonl --local-dir dataset/
 *   npx huggingface-cli download tencent/CL-bench-Life CL-bench-Life.jsonl --local-dir dataset/
 *
 * Requires: huggingface-cli login
 */
export async function downloadDataset(
  repoId: string,
  localDir: string,
): Promise<void> {
  console.log(
    `To download datasets, use the HuggingFace CLI:\n` +
      `  huggingface-cli download ${repoId} <file> --local-dir ${localDir}\n` +
      `Requires: huggingface-cli login`,
  );
  throw new Error(
    "Download must be done via huggingface-cli. Run:\n" +
      `  huggingface-cli download ${repoId} CL-bench.jsonl --local-dir ${localDir}`,
  );
}
