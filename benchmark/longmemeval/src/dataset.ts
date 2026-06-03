/**
 * LongMemEval dataset loader.
 */

import { readFile } from "node:fs/promises";
import type { LongMemEvalEntry } from "./types";

interface RawEntry {
  question_id: string;
  question_type: string;
  question: string;
  question_date: string;
  answer: string;
  answer_session_ids: string[];
  haystack_dates: string[];
  haystack_session_ids: string[];
  haystack_sessions: Array<Array<{ role: string; content: string }>>;
}

/**
 * Load LongMemEval dataset from JSON file.
 */
export async function loadLongMemEvalDatasetFromJson(
  jsonPath: string,
): Promise<LongMemEvalEntry[]> {
  const content = await readFile(jsonPath, "utf-8");
  const data = JSON.parse(content);

  if (!Array.isArray(data)) {
    throw new Error(`Expected array of entries, got ${typeof data}`);
  }

  return data as LongMemEvalEntry[];
}
